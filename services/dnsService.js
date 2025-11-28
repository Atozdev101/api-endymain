const axios = require('axios');
const db = require('../config/supabaseConfig');
const { sendSlackMessage } = require('../config/slackConfig');
const dns = require('node:dns/promises');

const REQUIRED_NS = [
  'ns1.endyns.info.',
  'ns2.endyns.info.',
  'ns3.endyns.info.',
];

const connectCloudDNSDomain = async (domainName) => {
  try {
    const response = await axios.post('https://api.cloudns.net/dns/register.json', null, {
      params: {
        'auth-id': process.env.CLOUDNS_AUTH_ID,
        'auth-password': process.env.CLOUDNS_AUTH_PASSWORD,
        'domain-name': domainName,
        'zone-type': 'master',
        'ns[]': [
          process.env.CLOUDNS_NS1,
          process.env.CLOUDNS_NS2,
          process.env.CLOUDNS_NS3,
        ]
      }
    });

    return response.data;
  } catch (error) {
    console.error(`❌ CloudDNS API error:`, error?.response?.data || error.message);
    return { status: 'Failed', statusDescription: error.message };
  }
};

exports.checkDomainNS = async (domainData) => {
  const results = [];

  for (const domain of domainData) {
    const domainName = domain.domain_name;

    try {
      // 1️⃣ Check DB
      const { data: existingDomain, error: fetchError } = await db
        .from('domains')
        .select('status')
        .eq('domain_name', domainName)
        .single();

      if (fetchError) {
        console.error(`❌ DB error for ${domainName}:`, fetchError.message);
        sendSlackMessage(`❌ DB error for ${domainName}: ${fetchError.message}`, 'ERROR');
        results.push({
          domain: { domain_name: domainName },
          connected: false,
          connectedWith: null,
          currentNS: [],
        });
        continue;
      }

      if (existingDomain?.status === 'Active') {
        console.log(`✅ ${domainName} already active. Skipping.`);
        results.push({
          domain: { domain_name: domainName },
          connected: true,
          connectedWith: 'cloudns',
          currentNS: [],
        });
        continue;
      }

      // 2️⃣ Check zone
      const zoneInfo = await axios.post('https://api.cloudns.net/dns/get-zone-info.json', null, {
        params: {
          'auth-id': process.env.CLOUDNS_AUTH_ID,
          'auth-password': process.env.CLOUDNS_AUTH_PASSWORD,
          'domain-name': domainName,
        }
      });

      let zoneData = zoneInfo.data;

      if (zoneData?.status === 'Failed') {
        console.log(`🆕 No zone found. Creating zone for ${domainName}...`);
        const createRes = await connectCloudDNSDomain(domainName);

        if (createRes.status === 'Success') {
          await db
            .from('domains')
            .update({ status: 'Propagating', lastcheck: new Date(), ns: 'endyns.info' })
            .eq('domain_name', domainName);

          sendSlackMessage(`🌐 Zone created for ${domainName}. Waiting for NS propagation.`, 'INFO');
          results.push({
            domain: { domain_name: domainName },
            connected: false,
            connectedWith: null,
            currentNS: [],
          });
          continue;
        } else {
          console.error(`❌ Failed to create zone for ${domainName}: ${createRes.statusDescription}`);
          sendSlackMessage(`❌ Failed to create zone: ${createRes.statusDescription}`, 'ERROR');
          results.push({
            domain: { domain_name: domainName },
            connected: false,
            connectedWith: null,
            currentNS: [],
          });
          continue;
        }
      }

      // 3️⃣ Check actual NS using DNS lookup
      let resolvedNS = [];
      try {
        resolvedNS = await dns.resolveNs(domainName);
        resolvedNS = resolvedNS.map(ns => ns.toLowerCase().endsWith('.') ? ns.toLowerCase() : ns.toLowerCase() + '.');
      } catch (dnsErr) {
        console.error(`⚠️ DNS resolution failed for ${domainName}: ${dnsErr.message}`);
      }

      const isPropagated = REQUIRED_NS.every(required => resolvedNS.includes(required));

      if (isPropagated) {
        await db
          .from('domains')
          .update({ status: 'Active', lastcheck: new Date(), ns: 'endyns.info' })
          .eq('domain_name', domainName);

        console.log(`✅ ${domainName} is now Active.`);
        sendSlackMessage(`✅ ${domainName} fully propagated and Active.`, 'INFO');
        results.push({
          domain: { domain_name: domainName },
          connected: true,
          connectedWith: 'cloudns',
          currentNS: resolvedNS,
        });
      } else {
        await db
          .from('domains')
          .update({ status: 'Propagating', lastcheck: new Date(), ns: 'endyns.info' })
          .eq('domain_name', domainName);

        console.log(`⏳ ${domainName} still propagating...`);
        results.push({
          domain: { domain_name: domainName },
          connected: false,
          connectedWith: null,
          currentNS: resolvedNS,
        });
      }

    } catch (err) {
      console.error(`❌ Error processing ${domainName}: ${err.message}`);
      sendSlackMessage(`❌ Error checking ${domainName}: ${err.message}`, 'ERROR');
      results.push({
        domain: { domain_name: domainName },
        connected: false,
        connectedWith: null,
        currentNS: [],
      });
    }
  }

  return results;
};

exports.reCheckDomain = async (domainName) => {
  const results = [];

  for (const domainrecheck of domainName) {
    const domain = domainrecheck.domain_name;
    let resolvedNSLocal = [];
    let resolvedNSGoogle = [];

    try {
      // 1️⃣ Local DNS resolution
      try {
        resolvedNSLocal = await dns.resolveNs(domain);
        resolvedNSLocal = resolvedNSLocal.map(ns =>
          ns.toLowerCase().endsWith('.') ? ns.toLowerCase() : ns.toLowerCase() + '.'
        );
      } catch (err) {
        console.warn(`⚠️ Local DNS failed for ${domain}: ${err.message}`);
      }

      // 2️⃣ Google DNS resolution
      try {
        const { data } = await axios.get(`https://dns.google/resolve?name=${domain}&type=NS`);
        if (data.Answer) {
          resolvedNSGoogle = data.Answer
            .filter(ans => ans.type === 2)
            .map(ans => ans.data.toLowerCase().endsWith('.') ? ans.data.toLowerCase() : ans.data.toLowerCase() + '.');
        }
      } catch (err) {
        console.warn(`⚠️ Google DNS failed for ${domain}: ${err.message}`);
      }

      const allResolved = Array.from(new Set([...resolvedNSLocal, ...resolvedNSGoogle]));

      // 3️⃣ Check if ANY required NS is found in either local or Google DNS
      const isPropagated = REQUIRED_NS.some(ns => allResolved.includes(ns));

      if (isPropagated) {
        await db
          .from('domains')
          .update({ status: 'Active', lastcheck: new Date() })
          .eq('domain_name', domain);

        console.log(`✅ ${domain} is now Active.`);
        results.push({
          domain: { domain_name: domain },
          connected: true,
          connectedWith: 'cloudns',
          currentNS: allResolved,
        });
      } else {
        await db
          .from('domains')
          .update({ status: 'Propagating', lastcheck: new Date() })
          .eq('domain_name', domain);

        console.log(`⏳ ${domain} still propagating...`);
        results.push({
          domain: { domain_name: domain },
          connected: false,
          connectedWith: null,
          currentNS: allResolved,
        });
      }

    } catch (err) {
      console.error(`❌ Error processing ${domain}: ${err.message}`);
      sendSlackMessage(`❌ Error checking ${domain}: ${err.message}`, 'ERROR');
      results.push({
        domain: { domain_name: domain },
        connected: false,
        connectedWith: null,
        currentNS: [],
      });
    }
  }

  return results;
};

exports.deleteZone = async (domainName) => {
  try {
    const response = await axios.post('https://api.cloudns.net/dns/delete.json', null, {
      params: {
        'auth-id': process.env.CLOUDNS_AUTH_ID,
        'auth-password': process.env.CLOUDNS_AUTH_PASSWORD,
        'domain-name': domainName,
      }
    });

    if (response.data.status === 'Success') {
      console.log(`✅ Zone deleted successfully for domain: ${domainName}`);
      return true;
    } else {
      console.error(`❌ Failed to delete zone for domain: ${domainName}`, response.data);
      return false;
    }
  } catch (error) {
    console.error(`🔥 Error deleting zone for domain: ${domainName}`, error.response?.data || error.message);
    return false;
  }
};
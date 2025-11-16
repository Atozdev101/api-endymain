const { generateSuggestions } = require('../utils/domainSuggestion');
const { getDomainAvailability, getTLDPrices } = require('../services/namecheapService');
const { domainPurchase } = require('../controllers/walletController');
const { checkDomainNS, reCheckDomain, deleteZone } = require('../services/dnsService');
const logger = require('../utils/winstonLogger');
const db = require('../config/supabaseConfig');


exports.getUserDomains = async (req, res) => {
  const userId = req.user.id;

  try {
    // Fetch domains for the user
    const { data: domains, error } = await db
      .from('domains')
      .select('domain_id, domain_name,domain_source, status, mailbox_count, purchased_on, renews_on, redirectUrl')
      .eq('user_id', userId);

    if (error) {
      logger.error('Error fetching user domains:', error);
      return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }

    if (!domains || domains.length === 0) {
      return res.status(404).json({ message: 'No domains found for this user' });
    }

    // For each domain, check if DMARC record exists
    const domainResponses = await Promise.all(
      domains.map(async (domain) => {

        return {
          id: domain.domain_id.toString(),
          name: domain.domain_name,
          status: domain.status,
          mailboxCount: domain.mailbox_count || 0,
          source: domain.domain_source,
          purchaseDate: domain.purchased_on ? domain.purchased_on : 'N/A',
          renewalDate: domain.renews_on ? domain.renews_on : 'N/A',
          forwarding: domain.redirectUrl ? 'Active' : 'Not Assigned',
          dmarc: 'enabled',
          redirectUrl: domain.redirectUrl || null,
        };
      })
    );

    return res.json({
      status: 200,
      message: 'List of domains for the user',
      data: domainResponses,
    });

  } catch (err) {
    logger.error('Error fetching user domains:', err.message);
    return res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

exports.checkDomainAvailability = async (req, res) => {
  const domain = req.query.domain;
  if (!domain) return res.status(400).json({ message: 'Domain query param is required' });

  const tlds = ['.com', '.net', '.org', '.co', '.info'];
  const namePart = domain.includes('.') ? domain.split('.')[0] : domain;
  const suggestions = generateSuggestions(namePart);

  try {
    const availability = await getDomainAvailability(suggestions);
    const pricing = await getTLDPrices(tlds);

    const addMarkup = (price) => (parseFloat(price) * 1.20).toFixed(2);

    const formatted = availability.map((d) => {
      const tld = `.${d['@_Domain'].split('.').pop()}`;
      const price = pricing[tld] || { register: '12.99', renew: '12.99' };

      return {
        domainName: d['@_Domain'],
        status: d['@_Available'] === 'true' ? 'AVAILABLE' : 'UNAVAILABLE',
        domainPrice: addMarkup(price.register),
        renewPrice: addMarkup(price.renew),
      };
    });

    const exactMatch = formatted.find(d => d.domainName === domain) || formatted[0];
    const availableDomains = formatted.filter(
      d => d.domainName !== exactMatch.domainName && d.status === 'AVAILABLE'
    );

    return res.json({
      status: 200,
      message: 'List of available domains with real-time pricing',
      data: { exactMatch, availableDomains },
    });

  } catch (err) {
    console.error('Domain check failed:', err.message);
    return res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

exports.connectDomain = async (req, res) => {
  const userId = req.user.id;
  const { domainName } = req.body;

  //user can only connect how many mailbox they have in their account - calculate from mailbox_subscription
  const { data: subscriptions, error: subscriptionError } = await db
    .from('mailbox_subscription')
    .select('number_of_mailboxes')
    .eq('user_id', userId)
    .eq('mailbox_type', 'Gsuite')
    .in('status', ['Active', 'Cancel at Period End']);

  if (subscriptionError) {
    logger.error('Error fetching subscriptions:', subscriptionError);
    return res.status(500).json({ message: 'Internal Server Error', error: subscriptionError.message });
  }

  // Calculate total mailboxes from subscriptions
  const mailboxes_total = (subscriptions || []).reduce((total, sub) => total + (sub.number_of_mailboxes || 0), 0);

  if (mailboxes_total === 0) {
    return res.status(400).json({ message: 'No mailbox addons found Please purchase a mailboxs to connect domains' });
  }
  //check how many domain user already connected
  const { data: domainCount, error: domainCountError } = await db
    .from('domains')
    .select('domain_id')
    .eq('user_id', userId);

  if (domainCountError) {
    logger.error('Error fetching domain count:', domainCountError);
    return res.status(500).json({ message: 'Internal Server Error', error: domainCountError.message });
  }

  const totalDomains = domainCount.length + domainName.length;
  console.log(totalDomains, mailboxes_total);


  if (totalDomains > mailboxes_total) {
    return res.status(400).json({ message: 'You have reached the maximum number of domains you can connect! Please increase your mailbox addons to connect more domains' });
  }


  for (const domain of domainName) {
    const { data: domainData, error } = await db
      .from('domains')
      .select('domain_id, domain_name,domain_source, status, mailbox_count, purchased_on, renews_on, user_id')
      .eq('domain_name', domain)
      .eq('user_id', userId)

    console.log(domainData);

    if (domainData.domain_name === domain) {
      logger.error('Domain already connected:', domain);
      continue;
    }
    //insert domain into domains table
    const { data: insertDomain, error: insertDomainError } = await db
      .from('domains')
      .insert({
        domain_name: domain,
        user_id: userId,
        status: 'Pending',
        domain_source: 'Connected',
        ns: 'atozemailsns.com'
      });
    if (insertDomainError) {
      logger.error('Error inserting domain:', insertDomainError);
      continue;
    }
  }
  return res.status(200).json({ message: 'Domains connected ' });
};

exports.clearConnectDomain = async (req, res) => {
  const userId = req.user.id;
  const { domainName } = req.body;

  for (const domain of domainName) {
    const deleteZoneResponse = await deleteZone(domain);
    console.log(deleteZoneResponse);

    if (!deleteZoneResponse) {
      logger.error('Error deleting zone:', domain);
      const { error: updateError } = await db
        .from('domains')
        .update({ status: 'Disconnected' })
        .eq('domain_name', domain)
        .eq('user_id', userId);

      if (updateError) {
        logger.error('Error updating domain:', updateError);
        continue;
      }

      continue;
    } else {
      const { error: deleteError } = await db
        .from('domains')
        .delete()
        .eq('domain_name', domain)
        .eq('user_id', userId);

      if (deleteError) {
        logger.error('Error deleting domain:', deleteError);
        continue;
      }
    }


  }

  return res.json({ message: 'Domain disconnected' });
};

exports.checkConnectDomain = async (req, res) => {
  const userId = req.user.id;
  const { data: domainData, error } = await db
    .from('domains')
    .select('domain_name')
    .eq('user_id', userId)
    .eq('domain_source', 'Connected')
    .not('ns', 'is', null);

  if (error) {
    logger.error('Error fetching domain:', error);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }

  const results = await checkDomainNS(domainData);
  console.log(results);


  return res.json({ results });
};

exports.recheckConnectDomain = async (req, res) => {
  const userId = req.user.id;
  const { domainName } = req.body;

  const results = await reCheckDomain(domainName);
  console.log(results);

  return res.json({ results });
};

exports.walletPurchase = async (req, res) => {
  domainPurchase(req, res);
};

exports.addDomainRedirect = async (req, res) => {
  const { domainIds, redirectUrl } = req.body;
  const userId = req.user.id;
  console.log(domainIds, redirectUrl);

  //check domain updated at least 10 days ago
  const { data: domainData, error: domainError } = await db
    .from('domains')
    .select('updated_at, domain_name')
    .in('domain_id', domainIds)
    .eq('user_id', userId);

  if (domainError) {
    logger.error('Error fetching domain:', domainError);
    return res.status(500).json({ message: 'Internal Server Error', error: domainError.message });
  }

  // if less than 10 days, return error
  if (domainData.updated_at > Date.now() - 10 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ message: 'Domain updated less than 10 days ago' });
  }

  //update domains table with redirectUrl
  const { data: updateDomain, error: updateDomainError } = await db
    .from('domains')
    .update({ redirectUrl: redirectUrl })
    .in('domain_id', domainIds)
    .eq('user_id', userId);

  if (updateDomainError) {
    logger.error('Error updating domain:', updateDomainError);
    return res.status(500).json({ message: 'Internal Server Error', error: updateDomainError.message });
  }

  // insert job in jobs table
  const { error: insertJobErr } = await db.from('jobs').insert({
    user_id: userId,
    order_type: 'domain',
    job_type: redirectUrl ? 'domain_redirect' : 'domain_redirect_remove',
    status: 'new',
    metadata: {
      domainNames: domainData.map(domain => domain.domain_name),
      redirectUrl: redirectUrl,
    }
  });
  if (insertJobErr) {
    logger.error('Error inserting job:', insertJobErr);
    return res.status(500).json({ error: 'Failed to create job' });
  }

  const message = redirectUrl ? 'Domain redirect added' : 'Domain redirect removed';
  return res.json({ message });
}
const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const {sendSlackMessage} = require('../config/slackConfig');
const stripe = require('../config/stripeConfig');
const { logUserActivity } = require('../utils/userRecentActivityLogger');
const { v4: uuidv4 } = require('uuid');
const { getCurrencyByCountry, getAmountByCurrency, getAmountInSmallestUnit, formatAmountForDisplay } = require('../utils/currencyHelper');


exports.getMailboxPrice = async (req, res) => {

  const user_id = req.query.user_id ? req.query.user_id : null;
  let userPrice = null; // Declare userPrice variable

  if (user_id) {
    const { data: userData, error: userError } = await db
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    if (userError || !userData) {
      logger.error(`User not found: ${user_id}`, userError);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // check if user email in the specific_user_price table
    const { data: specificUserPrice, error: specificUserPriceError } = await db
      .from('specific_user_price')
      .select('*')
      .eq('email', userData.email)
      .eq('product', 'gsuite')
      .single();

    console.log("specificUserPrice", specificUserPrice);

    if (specificUserPrice && !specificUserPriceError) {
      userPrice = specificUserPrice.price;
    }

    if (specificUserPriceError && specificUserPriceError.code !== 'PGRST116') {
      logger.error(`Specific user price not found for user: ${user_id}`, specificUserPriceError);
    }
  }

  // Get user's current active subscription from gsuite_subscriptions
  let currentSubscription = null;
  let planPricePerMailbox = null;

  if (user_id) {
    const { data: subscription, error: subscriptionError } = await db
      .from('gsuite_subscriptions')
      .select('plan_id')
      .eq('user_id', user_id)
      .eq('status', 'Active')
      .single();

    if (subscriptionError && subscriptionError.code !== 'PGRST116') {
      logger.error('Error fetching user subscription:', subscriptionError);
      return res.status(500).json({ error: 'Error fetching user subscription' });
    }

    if (subscription) {
      currentSubscription = subscription;
      
      // Get plan details from plans table
      const { data: plan, error: planError } = await db
        .from('plans')
        .select('price_per_additional_mailbox')
        .eq('id', subscription.plan_id)
        .single();

      if (planError) {
        logger.error('Error fetching plan details:', planError);
        return res.status(500).json({ error: 'Error fetching plan details' });
      }

      if (plan) {
        planPricePerMailbox = plan.price_per_additional_mailbox;
      }
    }
  }

  // Determine the final price per additional mailbox
  let finalPricePerMailbox;
  
  if (userPrice) {
    // Use specific user price if available
    finalPricePerMailbox = userPrice;
  } else if (planPricePerMailbox) {
    // Use user's plan price if available
    finalPricePerMailbox = planPricePerMailbox;
  } else {
    // Fallback to default pricing if no active subscription
    const { data: defaultPlans, error: defaultPlansError } = await db
      .from('plans')
      .select('price_per_additional_mailbox')
      .eq('active', true)
      .order('price_monthly', { ascending: true })
      .limit(1)
      .single();

    if (defaultPlansError) {
      logger.error('Error fetching default plan:', defaultPlansError);
      return res.status(500).json({ error: 'Error fetching default plan' });
    }

    finalPricePerMailbox = defaultPlans?.price_per_additional_mailbox || 5; // fallback price
  }
  
  return res.status(200).json({ 
    price_per_additional_mailbox: finalPricePerMailbox,
    user_specific_price: userPrice ? true : false,
    plan_based_price: planPricePerMailbox ? true : false
  });
};
exports.getUserMailbox = async (req, res) => {
  try {
    const user_id = req.user.id;

    // Step 1: Calculate mailboxes from mailbox_subscription table
    const { data: subscriptions, error: subscriptionError } = await db
      .from('mailbox_subscription')
      .select('number_of_mailboxes, number_of_used_mailbox')
      .eq('user_id', user_id)
      .eq('mailbox_type', 'Gsuite')
      .in('status', ['Active', 'Cancel at Period End']);

    if (subscriptionError) {
      logger.error(`Error fetching subscriptions for user: ${user_id}`, subscriptionError);
      return res.status(500).json({ error: 'Error fetching subscriptions' });
    }

    // Calculate total and used mailboxes from subscriptions
    const mailboxes_total = (subscriptions || []).reduce((total, sub) => total + (sub.number_of_mailboxes || 0), 0);
    const mailboxes_used = (subscriptions || []).reduce((total, sub) => total + (sub.number_of_used_mailbox || 0), 0);
    // Step 2: Fetch domains linked to the user
    const { data: domains, error: domainsError } = await db
      .from('domains')
      .select('domain_id, domain_name')
      .eq('user_id', user_id);

    if (domainsError) {
      logger.error(`Error fetching domains for user: ${user_id}`, domainsError);
      return res.status(500).json({ error: 'Error fetching domains' });
    }

    const domainIds = (domains || []).map(domain => domain.domain_id);
    const domainMap = new Map((domains || []).map(domain => [domain.domain_id, domain.domain_name]));

    // Step 3: Fetch active mailboxes under user's domains (only if domains exist)
    let activeMailboxes = [];

    if (domainIds.length > 0) {
      const { data: mailboxes, error: mailboxesError } = await db
        .from('mailboxes')
        .select('*')
        .in('domain_id', domainIds);

      if (mailboxesError) {
        logger.error(`Error fetching mailboxes for user: ${user_id}`, mailboxesError);
        return res.status(500).json({ error: 'Error fetching mailboxes' });
      }
      activeMailboxes = (mailboxes || []).map(mailbox => ({
        id: mailbox.mailbox_id.toString(),
        firstName: mailbox.name.split(' ')[0] || '',
        lastName: mailbox.name.split(' ')[1] || '',
        //donot all space in username
        username: mailbox.email.split('@')[0].replace(/\s+/g, ''),
        status: mailbox.status,
        recoveryEmail: mailbox.recovery_email,
        createdAt: mailbox.created_at, // Send the raw UTC timestamp from database
        domain: domainMap.get(mailbox.domain_id) || null,
        password: mailbox.password,
        exported: mailbox.export_id !== null, // Add exported field based on export_id
      }));
    }

    // Step 4: Send response
    return res.status(200).json({
      mailboxes_total: mailboxes_total,
      mailboxes_used: mailboxes_used,
      activeMailboxes,
    });

  } catch (error) {
    logger.error('Unexpected error in getUserMailbox', error);
    sendSlackMessage(`🚨 Error in getUserMailbox: ${error.message}`, 'ERROR');
    return res.status(500).json({ error: 'Internal server error' });
  }
};
exports.assignMailboxes = async (req, res) => {
  const mailboxes = req.body.mailboxes;
  const user_id = req.user.id;
  const createdLogs = [];

  try {
    if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
      return res.status(400).json({ error: 'Mailboxes array is required' });
    }

    for (const mailbox of mailboxes) {
      let { firstName, lastName, username, domain, recoveryEmail, forwardingEmail } = mailbox;
      //remove all space in username
      username = username.replace(/\s+/g, '');
      if (!firstName || !lastName || !username || !domain) {
        return res.status(400).json({ error: 'Missing required mailbox fields.' });
      }

      // Step 1: Fetch domain_id
      const { data: domainData, error: domainError } = await db
        .from('domains')
        .select('domain_id, domain_name, mailbox_count')
        .eq('user_id', user_id)
        .eq('domain_name', domain)
        .single();

      if (domainError || !domainData) {
        logger.error(`Domain not found or error for user ${user_id} and domain ${domain}`, domainError);
        return res.status(404).json({ error: `Domain not found: ${domain}` });
      }

      // Clean username if it contains '@'
      let cleanedUsername = username.includes('@') ? username.split('@')[0] : username;
      const email = `${cleanedUsername}@${domain}`;

      // Step 2: Check if mailbox already exists
      const { data: existingMailbox } = await db
        .from('mailboxes')
        .select('email')
        .eq('email', email)
        .single();
      if (existingMailbox) {
        return res.status(400).json({ message: `Mailbox already exists: ${existingMailbox.email}` });
      }

      // Step 3: Get valid mailbox subscription (most old)
      const { data: subscriptions, error: subError } = await db
        .from('mailbox_subscription')
        .select('*')
        .eq('user_id', user_id)
        .in('status', ['Active', 'Cancel at Period End'])
        .eq('mailbox_type', 'Gsuite')
        .gt('number_of_mailboxes', 0)
        .order('created_at', { ascending: true });

      if (subError || !subscriptions || subscriptions.length === 0) {
        logger.error(`No active mailbox subscription for user ${user_id}`, subError);
        return res.status(403).json({ error: 'No active mailbox subscription available.' });
      }

      let selectedSub = null;

      for (const sub of subscriptions) {
        if (sub.number_of_used_mailbox < sub.number_of_mailboxes) {
          selectedSub = sub;
          break;
        }
      }

      if (!selectedSub) {
        return res.status(403).json({ error: 'All mailbox subscriptions are fully used.' });
      }

      //also check subscription_id mailbox_type is 'Gsuite' in mailbox_subscription

      const subscription_id = selectedSub.subscription_id;

      // Step 4: Insert new mailbox
      const { error: insertError } = await db.from('mailboxes').insert([
        {
          domain_id: domainData.domain_id,
          email: email.toLowerCase(),
          name: `${firstName} ${lastName}`,
          username: username,
          status: 'Pending',
          user_id: user_id,
          recovery_email: recoveryEmail || null,
          subscription_id,
        },
      ]);

    
      if (insertError) {
        logger.error(`Error inserting mailbox for user ${user_id}: ${email}`, insertError);
        return res.status(500).json({ error: `Failed to create mailbox: ${email}` });
      }

      // Step 5: Update domain mailbox_count
      const { error: updateError } = await db
        .from('domains')
        .update({ mailbox_count: domainData.mailbox_count + 1 })
        .eq('domain_id', domainData.domain_id);

      if (updateError) {
        logger.error(`Error updating mailbox_count for domain ${domain}`, updateError);
        return res.status(500).json({ error: 'Failed to update domain mailbox count' });
      }
      // Step 6: Increment mailbox usage in selected subscription
      const { error: subUpdateError } = await db
        .from('mailbox_subscription')
        .update({ number_of_used_mailbox: selectedSub.number_of_used_mailbox + 1 })
        .eq('subscription_id', selectedSub.subscription_id);

      if (subUpdateError) {
        logger.error(`Failed to update mailbox usage count for subscription ${selectedSub.id}`, subUpdateError);
        return res.status(500).json({ error: 'Failed to update subscription usage count' });
      }

      // Step 7: Collect log
      createdLogs.push(
        `✅ Created: ${email}  || ${firstName} ${lastName}  || ${recoveryEmail || 'N/A'}`
      );
    }

    // Step 9: Log and notify
    await logUserActivity(user_id, `${createdLogs.length} Mailbox assigned successfully`, { mailbox_assigned: createdLogs });

    if (createdLogs.length > 0) {
      const summary = `
*Log from: Atoz Emails Dashboard*
*Type: ALERT*
*Message:* :white_check_mark: Internal Mailbox Assignment Summary
*User ID:* ${user_id}

${createdLogs.join('\n')}
      `.trim();

      await sendSlackMessage(summary, "ALERT");
    }

    // insert job in jobs table
    const { error: insertJobErr } = await db.from('jobs').insert({
      user_id: user_id,
      order_type: 'gsuite',
      job_type: 'assign_mailboxes',
      status: 'new',
      metadata: {
        assign_type: 'internal',
        number_of_mailboxes: mailboxes.length,
        mailboxes: mailboxes.map(mailbox => ({
          firstName: mailbox.firstName,
          lastName: mailbox.lastName,
          username: mailbox.username,
          domain: mailbox.domain,
          recoveryEmail: mailbox.recoveryEmail,
        })),
      }
    });
    if (insertJobErr) {
      logger.error('Error inserting job:', insertJobErr);
      return res.status(500).json({ error: 'Failed to create job' });
    }

    res.status(200).json({ message: 'Mailboxes assigned successfully.' });

  } catch (error) {
    logger.error('Unexpected error in assignMailboxes:', error);
    sendSlackMessage(`🚨 Error in assignMailboxes: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.assignExternalMailboxes = async (req, res) => {
  const { mailboxes, external_provider, username: extUsername, password } = req.body;
  const user_id = req.user.id;


  const createdLogs = [];

  try {
    if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
      return res.status(400).json({ error: 'Mailboxes array is required' });
    }

    for (const mailbox of mailboxes) {
      const { firstName, lastName, username, domain, recoveryEmail, forwardingEmail } = mailbox;

      if (!firstName || !lastName || !username || !domain) {
        return res.status(400).json({ error: 'Missing required mailbox fields.' });
      }

      const email = `${username}@${domain}`.toLowerCase();

      // Step 1: Check or Insert Domain
      let { data: domainData, error: domainError } = await db
        .from('domains')
        .select('domain_id, domain_name, mailbox_count')
        .eq('user_id', user_id)
        .eq('domain_name', domain)
        .single();

      if (domainError && domainError.code !== 'PGRST116') {
        logger.error(`Error fetching domain: ${domain}`, domainError);
        return res.status(500).json({ error: 'Error checking domain' });
      }

      if (!domainData) {
        const { data: newDomainData, error: insertDomainError } = await db
          .from('domains')
          .insert([{
            user_id,
            domain_name: domain,
            mailbox_count: 0,
            domain_source: 'Connected',
            status: 'Pending',
            external_provider: external_provider,
            extUsername: extUsername,
            extPassword: password,
            // Let database handle timestamps with UTC default
          }])
          .select()
          .single();

        if (insertDomainError) {
          logger.error(`Failed to insert new domain: ${domain}`, insertDomainError);
          return res.status(500).json({ error: 'Error inserting new domain' });
        }

        domainData = newDomainData;
      }

      // Step 2: Check if mailbox already exists
      const { data: existingMailbox } = await db
        .from('mailboxes')
        .select('email')
        .eq('email', email)
        .single();

      if (existingMailbox) {
        await sendSlackMessage(`⚠️ Duplicate mailbox skipped: ${email}`, "WARN");
        continue;
      }

      // Step 3: Get valid mailbox subscription
      const { data: subscriptions, error: subError } = await db
      .from('mailbox_subscription')
      .select('*')
      .eq('user_id', user_id)
      .gt('number_of_mailboxes', 0)
      .or('status.eq.Active,status.eq.Cancel at Period End') // OR must be grouped
      .order('created_at', { ascending: false });
    
      if (subError || !subscriptions || subscriptions.length === 0) {
        logger.error(`No active mailbox subscription for user ${user_id}`, subError);
        return res.status(403).json({ error: 'No active mailbox subscription available.' });
      }

      let selectedSub = null;
      for (const sub of subscriptions) {
        if (sub.number_of_used_mailbox < sub.number_of_mailboxes) {
          selectedSub = sub;
          break;
        }
      }

      if (!selectedSub) {
        return res.status(403).json({ error: 'All mailbox subscriptions are fully used.' });
      }

      const subscription_id = selectedSub.subscription_id;

      // Step 4: Insert new mailbox
      const { error: insertError } = await db.from('mailboxes').insert([
        {
          user_id: user_id,
          domain_id: domainData.domain_id,
          email,
          name: `${firstName} ${lastName}`,
          username,
          status: 'Pending',
          recovery_email: recoveryEmail || null,
          subscription_id,
        },
      ]);

      if (insertError) {
        logger.error(`Error inserting external mailbox for user ${user_id}: ${email}`, insertError);
        return res.status(500).json({ error: `Failed to create mailbox: ${email}` });
      }

      // Step 5: Update domain mailbox_count
      const { error: updateError } = await db
        .from('domains')
        .update({ mailbox_count: domainData.mailbox_count + 1 })
        .eq('domain_id', domainData.domain_id);

      if (updateError) {
        logger.error(`Error updating mailbox_count for domain ${domain}`, updateError);
        return res.status(500).json({ error: 'Failed to update domain mailbox count' });
      }

      // Step 6: Increment mailbox usage in selected subscription
      const { error: subUpdateError } = await db
        .from('mailbox_subscription')
        .update({ number_of_used_mailbox: selectedSub.number_of_used_mailbox + 1 })
        .eq('subscription_id', subscription_id);

      if (subUpdateError) {
        logger.error(`Failed to update mailbox usage for subscription ${selectedSub.id}`, subUpdateError);
        return res.status(500).json({ error: 'Failed to update subscription usage count' });
      }

      // Step 7: Collect log
      createdLogs.push(`✅ Created: ${email} || ${firstName} ${lastName} || ${recoveryEmail || 'N/A'}`);
    }

  
    // Step 9: Logging and Slack notification
    await logUserActivity(user_id, `${createdLogs.length} External Mailboxes assigned`, { mailbox_assigned: createdLogs });

    if (createdLogs.length > 0) {
      const summary = `
*Log from: Atoz Emails Dashboard*
*Type: ALERT*
*Message:* :white_check_mark: External Mailbox Assignment Summary
*User ID:* ${user_id}

${createdLogs.join('\n')}
      `.trim();

      await sendSlackMessage(summary, "ALERT");
    }

    // insert job in jobs table
    const { error: insertJobErr } = await db.from('jobs').insert({
      user_id: user_id,
      order_type: 'gsuite',
      job_type: 'assign_mailboxes',
      status: 'new',
      metadata: {
        assign_type: 'external',
        number_of_mailboxes: mailboxes.length,
        external_provider: external_provider,
        extUsername: extUsername,
        extPassword: password,
        mailboxes: mailboxes.map(mailbox => ({
          firstName: mailbox.firstName,
          lastName: mailbox.lastName,
          username: mailbox.username,
          domain: mailbox.domain,
          recoveryEmail: mailbox.recoveryEmail,
        })),
      }
    });
    if (insertJobErr) {
      logger.error('Error inserting job:', insertJobErr);
      return res.status(500).json({ error: 'Failed to create job' });
    }

    res.status(200).json({ message: 'External mailboxes assigned successfully.' });

  } catch (error) {
    logger.error('Unexpected error in assignExternalMailboxes:', error);
    await sendSlackMessage(`🚨 Error in assignExternalMailboxes: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.deleteMailbox = async (req, res) => {
  const mailboxId = req.params.mailboxId;
  const userId = req.user.id;
  const createdLogs = [];
  try {
    // Step 1: Fetch mailbox
    const { data: mailboxData, error: mailboxError } = await db
      .from('mailboxes')
      .select('*')
      .eq('mailbox_id', mailboxId)
      .single();

    if (mailboxError || !mailboxData) {
      logger.error(`Mailbox not found for user ${userId}: ${mailboxId}`, mailboxError);
      return res.status(404).json({ error: 'Mailbox not found' });
    }

    // Step 2: Update the mailbox status to 'Scheduled for Deletion'
    const { error: updateMailboxError } = await db
      .from('mailboxes')
      .update({ status: 'Scheduled for Deletion', updated_at: new Date() })
      .eq('mailbox_id', mailboxId);
    if (updateMailboxError) {
      logger.error(`Error updating mailbox status for user ${userId}: ${mailboxId}`, updateError);
      return res.status(500).json({ error: 'Failed to update mailbox status' });
    }

    // Step 3: Update domain mailbox_count
    const { error: updateError } = await db
      .from('domains')
      .update({ mailbox_count: mailboxData.mailbox_count - 1 })
      .eq('domain_id', mailboxData.domain_id);

    if (updateError) {
      logger.error(`Error updating domain mailbox count for user ${userId}: ${mailboxId}`, updateError);
      return res.status(500).json({ error: 'Failed to update domain mailbox count' });
    }

    // Collect log line for this mailbox
    createdLogs.push(
      `✅ Deleted: ${mailboxData.email}  || ${mailboxData.name}  || ${mailboxData.recovery_email || 'N/A'}`
    );

    await sendSlackMessage(
      `📦 Mailbox deletion scheduled for user: ${userId} || /n ${createdLogs}`,
      'SUCCESS'
    );

    await logUserActivity(userId, `${createdLogs.length} Mailbox deleted successfully`, { mailbox_deleted: createdLogs });

    res.status(200).json({ message: 'Mailbox deleted successfully.' });
  } catch (error) {
  }
}
exports.deleteMailboxes = async (req, res) => {
  const mailboxIds = req.body.mailboxIds;
  const userId = req.user.id;
  const createdLogs = [];
  try {
    if (!Array.isArray(mailboxIds) || mailboxIds.length === 0) {
      return res.status(400).json({ error: 'Mailbox IDs array is required' });
    }
    for (const mailboxId of mailboxIds) {
      // Step 1: Fetch mailbox
      const { data: mailboxData, error: mailboxError } = await db
        .from('mailboxes')
        .select('*')
        .eq('mailbox_id', mailboxId)
        .single();

      if (mailboxError || !mailboxData) {
        logger.error(`Mailbox not found for user ${userId}: ${mailboxId}`, mailboxError);
        return res.status(404).json({ error: 'Mailbox not found' });
      }

      // Step 2: Update the mailbox status to 'Scheduled for Deletion'
      const { error: updateMailboxError } = await db
        .from('mailboxes')
        .update({ status: 'Scheduled for Deletion', updated_at: new Date() })
        .eq('mailbox_id', mailboxId);
      if (updateMailboxError) {
        logger.error(`Error updating mailbox status for user ${userId}: ${mailboxId}`, updateMailboxError);
        return res.status(500).json({ error: 'Failed to update mailbox status' });
      }

      // Step 3: Update domain mailbox_count
      const { error: updateError } = await db
        .from('domains')
        .update({ mailbox_count: mailboxData.mailbox_count - 1 })
        .eq('domain_id', mailboxData.domain_id);

      if (updateError) {
        logger.error(`Error updating domain mailbox count for user ${userId}: ${mailboxId}`, updateError);
        return res.status(500).json({ error: 'Failed to update domain mailbox count' });
      }

      // Collect log line for this mailbox
      createdLogs.push(
        `✅ Deleted: ${mailboxData.email}  || ${mailboxData.name}  || ${mailboxData.recovery_email || 'N/A'}`
      );
    }
    await sendSlackMessage(
      `📦 Mailbox deletion scheduled for user: ${userId} || /n ${createdLogs}`,
      'ALERT'
    );
    await logUserActivity(userId, `${createdLogs.length} Mailbox deleted successfully`, { mailbox_deleted: createdLogs });

    res.status(200).json({ message: 'Mailboxes deleted successfully.' });
  }
  catch (error) {
    logger.error('Unexpected error in deleteMailboxes:', error);
    sendSlackMessage(`🚨 Error in deleteMailboxes: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Internal server error' });
  }
  finally {
    // Clean up the created logs
    createdLogs.length = 0;
  }
}
exports.editMailbox = async (req, res) => {
  const mailboxId = req.params.mailboxId;
  const userId = req.user.id;
  try {
    const { firstName, lastName, username, recoveryEmail } = req.body;

    if (!firstName || !lastName || !username) {
      return res.status(400).json({ error: 'Missing required mailbox fields.' });
    }

    // Step 1: Fetch mailbox
    const { data: mailboxData, error: mailboxError } = await db
      .from('mailboxes')
      .select('*')
      .eq('mailbox_id', mailboxId)
      .single();
    if (mailboxError || !mailboxData) {
      logger.error(`Mailbox not found for user ${userId}: ${mailboxId}`, mailboxError);
      return res.status(404).json({ error: 'Mailbox not found' });
    }
    const email = username;
    // Step 3: Update mailbox
    const { error: updateError } = await db
      .from('mailboxes')
      .update({
        email,
        name: `${firstName} ${lastName}`,
        username,
        status: 'Pending',
        recovery_email: recoveryEmail || null,
        updated_at: new Date(),
      })
      .eq('mailbox_id', mailboxId);
    if (updateError) {
      logger.error(`Error updating mailbox for user ${userId}: ${mailboxId}`, updateError);
      return res.status(500).json({ error: 'Failed to update mailbox' });
    }
    // Step 4: Send a slack alart with requested changes
    const summary = `
*Message:* :white_check_mark: Mailbox Edit Summary
*User ID:* ${userId}
*Mailbox ID:* ${mailboxId}
*Email:* ${email}
*Name:* ${firstName} ${lastName}
*Recovery Email:* ${recoveryEmail || 'N/A'}

    `.trim();
    await sendSlackMessage(summary, "ALERT");
    await logUserActivity(userId, `Mailbox edited successfully`, { mailbox_edited: summary });
    res.status(200).json({ message: 'Mailbox updated successfully.' });
  } catch (error) {
  }
}
exports.purchaseMailbox = async (req, res) => {
  const userId = req.user.id;
  const { numberOfMailboxes } = req.body;
  let userPrice = null; // Declare userPrice variable

  if (!numberOfMailboxes || numberOfMailboxes <= 0) {
    return res.status(400).json({ error: 'Valid number of mailboxes required' });
  }

  // Check for user-specific pricing
  const { data: userData, error: userError } = await db
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !userData) {
    logger.error(`User not found: ${userId}`, userError);
    return res.status(404).json({ error: 'User not found' });
  }

  // Determine currency based on user's country (INR for India, USD for others)
  const currency = getCurrencyByCountry(userData?.country);

  // Check if user email in the specific_user_price table
  const { data: specificUserPrice, error: specificUserPriceError } = await db
    .from('specific_user_price')
    .select('*')
    .eq('email', userData.email)
    .eq('product', 'gsuite')
    .single();

  if (specificUserPrice && !specificUserPriceError) {
    userPrice = specificUserPrice.price;
  }

  if (specificUserPriceError && specificUserPriceError.code !== 'PGRST116') {
    logger.error(`Specific user price not found for user: ${userId}`, specificUserPriceError);
  }

  // Get user's current active subscription from gsuite_subscriptions
  let currentSubscription = null;
  let planPricePerMailbox = null;

  const { data: subscription, error: subscriptionError } = await db
    .from('gsuite_subscriptions')
    .select('plan_id')
    .eq('user_id', userId)
    .eq('status', 'Active')
    .single();

  if (subscriptionError && subscriptionError.code !== 'PGRST116') {
    logger.error('Error fetching user subscription:', subscriptionError);
    return res.status(500).json({ error: 'Error fetching user subscription' });
  }

  if (subscription) {
    currentSubscription = subscription;
    
    // Get plan details from plans table
    const { data: plan, error: planError } = await db
      .from('plans')
      .select('price_per_additional_mailbox')
      .eq('id', subscription.plan_id)
      .single();

    if (planError) {
      logger.error('Error fetching plan details:', planError);
      return res.status(500).json({ error: 'Error fetching plan details' });
    }

    if (plan) {
      planPricePerMailbox = plan.price_per_additional_mailbox;
    }
  }

  // Determine the final price per additional mailbox (in USD)
  let mailboxPriceUsd;
  
  if (userPrice) {
    // Use specific user price if available
    mailboxPriceUsd = userPrice;
  } else if (planPricePerMailbox) {
    // Use user's plan price if available
    mailboxPriceUsd = planPricePerMailbox;
  } else {
    // Fallback to default pricing if no active subscription
    const { data: defaultPlans, error: defaultPlansError } = await db
      .from('plans')
      .select('price_per_additional_mailbox')
      .eq('active', true)
      .order('price_monthly', { ascending: true })
      .limit(1)
      .single();

    if (defaultPlansError) {
      logger.error('Error fetching default plan:', defaultPlansError);
      return res.status(500).json({ error: 'Error fetching default plan' });
    }

    mailboxPriceUsd = defaultPlans?.price_per_additional_mailbox || 5; // fallback price
  }
  
  const totalAmountUsd = mailboxPriceUsd * numberOfMailboxes;
  
  // Convert to appropriate currency
  const totalAmount = getAmountByCurrency(totalAmountUsd, currency);
  const mailboxPrice = getAmountByCurrency(mailboxPriceUsd, currency);
  const totalAmountSmallestUnit = getAmountInSmallestUnit(totalAmount, currency);
  const priceDisplay = formatAmountForDisplay(mailboxPrice, currency);

  let product = null;
  let price = null;

  try {
    const { data: customerData } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    let customerId = customerData?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { user_id: userId }
      });

      await db.from('stripe_customers').insert([
        { user_id: userId, stripe_customer_id: customer.id }
      ]);
      customerId = customer.id;
    }

    // Create Stripe product and price with appropriate currency
    product = await stripe.products.create({ name: 'Mailbox Add-on' });

    price = await stripe.prices.create({
      unit_amount: totalAmountSmallestUnit,
      currency: currency,
      recurring: { interval: 'month' },
      product: product.id
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: price.id,
          quantity: 1
        }
      ],
      success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/profile`,
      metadata: {
        type: 'mailbox_addon',
        numberOfMailboxes,
        user_id: userId,
        original_currency: 'usd',
        charged_currency: currency,
      },
      allow_promotion_codes: true,
    });

    await db.from('transaction_history').insert([
      {
        user_id: userId,
        type: 'mailbox_addon',
        amount: totalAmountSmallestUnit,
        currency: currency,
        status: 'pending',
        payment_provider: 'stripe',
        checkout_session_id: session.id,
        description: `${numberOfMailboxes}x mailbox add-on @ ${priceDisplay} each`,
      }
    ]);

    res.json({ checkoutUrl: session.url });

  } catch (error) {


    logger.error('purchaseMailbox error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
exports.getMailboxsByWallet = async (req, res) => {
  const userId = req.user.id;
  const email = req.user.email;
  const { numberOfMailboxes, amount } = req.body;
  let userPrice = null; // Declare userPrice variable

  try {
    // 🔐 Validate input
    if (!numberOfMailboxes || numberOfMailboxes <= 0 || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid input data' });
    }

    // Check for user-specific pricing
    const { data: specificUserPrice, error: specificUserPriceError } = await db
      .from('specific_user_price')
      .select('*')
      .eq('email', email)
      .eq('product', 'gsuite')
      .single();

    if (specificUserPrice && !specificUserPriceError) {
      userPrice = specificUserPrice.price;
    }

    if (specificUserPriceError && specificUserPriceError.code !== 'PGRST116') {
      logger.error(`Specific user price not found for user: ${userId}`, specificUserPriceError);
    }

    // 🔎 Fetch wallet
    const { data: walletData, error: walletError } = await db
      .from('wallet')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (walletError || !walletData) {
      logger.error('Error fetching wallet:', walletError);
      return res.status(500).json({ error: 'Failed to fetch wallet' });
    }

    // 💰 Tiered price validation (only if no user-specific price)
    const getTieredPrice = (count) => {
      if (count >= 1000) return 2.00;
      if (count >= 500) return 2.25;
      if (count >= 100) return 2.50;
      if (count >= 20) return 2.75;
      return 3.00;
    };

    // Use user-specific price if available, otherwise use tiered pricing
    const pricePerMailbox = userPrice || getTieredPrice(numberOfMailboxes);
    const expectedTotal = (pricePerMailbox * numberOfMailboxes).toFixed(2);

    if (parseFloat(expectedTotal) !== parseFloat(amount)) {
      return res.status(400).json({
        error: `Amount mismatch. Expected $${expectedTotal}, received $${amount}`,
      });
    }

    if (walletData.balance < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // 💸 Deduct amount from wallet
    const { error: deductError } = await db
      .from('wallet')
      .update({ balance: walletData.balance - amount })
      .eq('wallet_id', walletData.wallet_id);

    if (deductError) {
      logger.error('Error deducting wallet balance:', deductError);
      return res.status(500).json({ error: 'Failed to deduct wallet balance' });
    }

    // 🧾 Record the wallet transaction with error handling
    const { error: insertError } = await db.from('wallet_transactions').insert({
      wallet_id: walletData.wallet_id,
      amount: amount,
      type: 'debit',
      description: `Purchased ${numberOfMailboxes} mailbox(es) at $${pricePerMailbox}/each`,
    });

    if (insertError) {
      logger.error('Error inserting wallet transaction:', insertError);
      return res.status(500).json({ error: 'Failed to insert wallet transaction' });
    }

    // 📅 Calculate renewal date
    const renewsOn = new Date();
    renewsOn.setMonth(renewsOn.getMonth() + 1);

    // 🧾 Create subscription record
    const subscription_id = `walg_${uuidv4()}`;

    const { error: insertSubErr } = await db.from('mailbox_subscription').insert({
      subscription_id: subscription_id,
      user_id: userId,
      status: 'Active',
      billing_date: new Date(),
      renews_on: renewsOn,
      number_of_mailboxes: numberOfMailboxes,
      price_per_mailbox: pricePerMailbox,
      total_amount: amount,
      number_of_used_mailbox: 0,
      payment_method: 'wallet',
      created_at: new Date(),
      updated_at: new Date(),
    });

    if (insertSubErr) {
      logger.error('Error inserting mailbox_subscription:', insertSubErr);
      return res.status(500).json({ error: 'Failed to create mailbox subscription' });
    }

    // insert order in orders table
    const { error: insertOrderErr } = await db.from('orders').insert({
      user_id: userId,
      type: 'gsuite',
      status: 'success',
      reference_id: subscription_id,
      amount: amount,
      payment_method: 'wallet',
      renews_on: renewsOn,
      metadata: {
        number_of_mailboxes: numberOfMailboxes,
        price_per_mailbox: pricePerMailbox,
      },
    });

    if (insertOrderErr) {
      logger.error('Error inserting order:', insertOrderErr);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    // ✅ Log success
    await logUserActivity(userId, `${numberOfMailboxes} Mailbox add-on successful from wallet`, {
      mailbox_count: numberOfMailboxes,
    });

    await logger.info({
      message: '📦 Mailbox add-on processed successfully',
      context: { userId, numberOfMailboxes, subscription_id },
    });

    await sendSlackMessage (
      `📦 Mailbox add-on processed\nUser: ${email}\nMailboxes: ${numberOfMailboxes}\n subscription_id: ${subscription_id}\n Amount: ${amount}\nRenewal Date: ${renewsOn.toISOString().split('T')[0]}`,
      'SUCCESS'
    );

    return res.status(200).json({
      message: 'Mailbox add-on successful',
      mailboxCount: numberOfMailboxes,
      renewsOn,
    });

  } catch (error) {
    logger.error('Unhandled error in getMailboxsByWallet:', error);
    await sendSlackMessage(`❌ Error processing mailbox add-on for ${email}: ${error.message}`, 'ERROR');
    return res.status(500).json({ error: 'Internal server error' });
  }
};
exports.bulkSetRecoveryEmail = async (req, res) => {
  const { mailboxIds, recoveryEmail } = req.body;
  const userId = req.user.id;
  const createdLogs = [];
  try {
    if (!Array.isArray(mailboxIds) || mailboxIds.length === 0) {
      return res.status(400).json({ error: 'Mailbox IDs array is required' });
    }

    for (const mailboxId of mailboxIds) {
      // Step 1: Fetch mailbox
      const { data: mailboxData, error: mailboxError } = await db
        .from('mailboxes')
        .select('*')
        .eq('mailbox_id', mailboxId)
        .single();

      if (mailboxError || !mailboxData) {
        logger.error(`Mailbox not found for user ${userId}: ${mailboxId}`, mailboxError);
        return res.status(404).json({ error: 'Mailbox not found' });
      }

      // Check if the mailbox in scheduled for deletion skip the update
      if (mailboxData.status === 'Scheduled for Deletion') {
        logger.warn(`Mailbox ${mailboxId} is scheduled for deletion, skipping update.`);
        continue;
      }
      // Step 2: Update the mailbox recovery email
      const { error: updateError } = await db
        .from('mailboxes')
        .update({ recovery_email: recoveryEmail, status: 'Pending', updated_at: new Date() })
        .eq('mailbox_id', mailboxId);

      if (updateError) {
        logger.error(`Error updating recovery email for user ${userId}: ${mailboxId}`, updateError);
        return res.status(500).json({ error: 'Failed to update recovery email' });
      }

      // Collect log line for this mailbox
      createdLogs.push(
        `✅ Updated Recovery Email: ${mailboxData.email}  || ${mailboxData.name}  || ${recoveryEmail}`
      );
    }

    await sendSlackMessage(
      `📧 Bulk Recovery Email Update for user: ${userId} || /n ${createdLogs}`,
      'ALERT'
    );

    await logUserActivity(userId, `${createdLogs.length} Mailbox recovery email updated successfully`, { recovery_email_updated: createdLogs });

    res.status(200).json({ message: 'Recovery emails updated successfully.' });
  }
  catch (error) {
    logger.error('Unexpected error in bulkSetRecoveryEmail:', error);
    sendSlackMessage(`🚨 Error in bulkSetRecoveryEmail: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Internal server error' });
  }
}
exports.exportOtherPlatform = async (req, res) => {
  const { mailboxIds, platform, platformUrl, email, password, workspace, notes } = req.body;
  const userId = req.user.id;
  const createdLogs = [];
  //get mailbox details
  for (const mailboxId of mailboxIds) {
    const { data: mailboxData, error: mailboxError } = await db
      .from('mailboxes')
      .select('*')
      .eq('mailbox_id', mailboxId)
      .single();

    if (mailboxError || !mailboxData) {
      logger.error(`Mailbox not found for user ${userId}: ${mailboxId}`, mailboxError);
      return res.status(404).json({ error: 'Mailbox not found' });
    }

    // Collect log line for this mailbox
    createdLogs.push(
      `✅ Exported: ${mailboxData.email}}`
    );
  }
  //send slack message with the details
  const summary = `
*Message:* :white_check_mark: Export Mailbox to Other Platform
*User ID:* ${userId}
*Mailbox IDs:* ${createdLogs}
*Platform:* ${platform}
*Platform URL:* ${platformUrl}
*Email:* ${email}
*Password:* ${password}
*Workspace:* ${workspace}
*Notes:* ${notes || 'N/A'}

  `.trim();

  const export_id = uuidv4();

  //insert in gsuite_mailbox_exports table
  const { error: insertExportErr } = await db.from('gsuite_mailbox_exports').insert({
    id: export_id,
    user_id: userId,
    platform: platform,
    status: 'pending',
    platform_url: platformUrl,  
    email: email,
    password: password,
    workspace: workspace,
    notes: notes,
  });

  if (insertExportErr) {
    logger.error('Error inserting export:', insertExportErr);
    return res.status(500).json({ error: 'Failed to create export' });
  }
  // insert export_id in mailbox table 
  for (const mailboxId of mailboxIds) {
  const { error: updateMailboxExportIdErr } = await db.from('mailboxes').update({ export_id: export_id }).eq('mailbox_id', mailboxId);
  if (updateMailboxExportIdErr) {
    await sendSlackMessage(`🚨 Error in exportOtherPlatforms Updating Data: ${updateMailboxExportIdErr.message}`, 'ERROR');
      await logger.error({

          message: '❌ Failed to update mailboxes table',
          context: { error: updateMailboxExportIdErr.message },
      });
  }
  }
  //insert job in jobs table
  const { error: insertJobErr } = await db.from('jobs').insert({
    user_id: userId,
    job_type: 'export',
    order_type: 'gsuite',
    status: 'new',
    metadata: {
      export_id: export_id,
      platform: platform,
      email: email,
      password: password,
      platform_url: platformUrl,
      workspace: workspace,
      notes: notes,
      exported_at: new Date(),
      //get the email from the mailboxes table for each mailboxId show as json array
      mailboxes: await Promise.all(mailboxIds.map(async (mailboxId) => {
        const { data: mailboxData, error: mailboxDataErr } = await db.from('mailboxes').select('email').eq('mailbox_id', mailboxId).single();
        if (mailboxDataErr) {
          await logger.error({
            message: '❌ Failed to get email from mailboxes table',
            context: { error: mailboxDataErr.message },
          });
        }
        return mailboxData.email;
      })),
    },
  });
  if (insertJobErr) {
    logger.error('Error inserting job:', insertJobErr);
    return res.status(500).json({ error: 'Failed to create job' });
  }

  await sendSlackMessage(summary, "ALERT");
  await logUserActivity(userId, `Mailbox export to other platform successfully`, { mailbox_export: summary });

  res.status(200).json({ message: 'Mailbox export request received.' });
}
exports.exportMailboxes = async (req, res) => {
  const { mailboxIds } = req.body;
  const userId = req.user.id;
  const createdLogs = [];
  try {
    if (!Array.isArray(mailboxIds) || mailboxIds.length === 0) {
      return res.status(400).json({ error: 'Mailbox IDs array is required' });
    }

    for (const mailboxId of mailboxIds) {
      // Step 1: Fetch mailbox
      const { data: mailboxData, error: mailboxError } = await db
        .from('mailboxes')
        .select('*')
        .eq('mailbox_id', mailboxId)
        .single();

      if (mailboxError || !mailboxData) {
        logger.error(`Mailbox not found for user ${userId}: ${mailboxId}`, mailboxError);
        return res.status(404).json({ error: 'Mailbox not found' });
      }

      // Collect log line for this mailbox
      createdLogs.push(
        `✅ Exported: ${mailboxData.email}`
      );
    }
    //send slack message with the details
    const summary = `
*Message:* :white_check_mark: Export Mailbox
*User ID:* ${userId}
*Mailbox IDs:* ${createdLogs}
  `.trim();

    await sendSlackMessage(summary, "ALERT");
    await logUserActivity(userId, `Mailbox export successfully`, { mailbox_export: summary });

    res.status(200).json({ message: 'Mailboxes export request received.' });
  }
  catch (error) {
    logger.error('Unexpected error in exportMailboxes:', error);
    sendSlackMessage(`🚨 Error in exportMailboxes: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Internal server error' });
  }
  finally {
    // Clean up the created logs
    createdLogs.length = 0;
  }
}
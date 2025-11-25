const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const stripe = require('../config/stripeConfig');
const namecheapService = require('../services/namecheapService');
const { sendSlackMessage } = require('../config/slackConfig');
const { logUserActivity } = require('../utils/userRecentActivityLogger');
const { v4: uuidv4 } = require('uuid');

/**
 * Purchase domains via API with billing details
 * POST /api/v1/domains/purchase
 * Body: { domains: [{ domain, year, price }], billing: { payment_method_id, ... } }
 */
exports.purchaseDomains = async (req, res) => {
  const userId = req.user.id;
  const { domains, billing } = req.body;

  try {
    // Validate input
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'domains array is required and must not be empty'
      });
    }

    if (!billing || !billing.payment_method_id) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'billing.payment_method_id is required'
      });
    }

    // Validate each domain object
    for (const domain of domains) {
      if (!domain.domain || !domain.year || !domain.price) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Each domain must have domain, year, and price fields'
        });
      }
    }

    // Calculate total amount
    const totalAmount = domains.reduce((sum, d) => sum + (d.price / 100), 0);

    // Get or create Stripe customer
    let { data: customerData } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    let customerId = customerData?.stripe_customer_id;

    if (!customerId) {
      const { data: userData } = await db
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

      const customer = await stripe.customers.create({
        email: userData?.email || req.user.email,
        metadata: { user_id: userId }
      });

      await db.from('stripe_customers').insert([{
        user_id: userId,
        stripe_customer_id: customer.id
      }]);

      customerId = customer.id;
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(billing.payment_method_id, {
      customer: customerId,
    });

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100),
      currency: 'usd',
      customer: customerId,
      payment_method: billing.payment_method_id,
      confirm: true,
      return_url: process.env.FRONTEND_URL || 'http://localhost:8080',
      metadata: {
        type: 'domain_purchase',
        user_id: userId,
        domains: domains.map(d => d.domain).join(','),
        years: domains.map(d => d.year).join(',')
      }
    });

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: 'Payment Failed',
        message: `Payment status: ${paymentIntent.status}`,
        payment_intent_id: paymentIntent.id
      });
    }

    // Record transaction
    const checkoutSessionId = `api_dom_${uuidv4()}`;
    await db.from('transaction_history').insert([{
      user_id: userId,
      type: 'domain_purchase',
      amount: Math.round(totalAmount * 100),
      currency: 'usd',
      status: 'succeeded',
      payment_provider: 'stripe',
      checkout_session_id: checkoutSessionId,
      reference_id: paymentIntent.id,
      description: `Domain purchase: ${domains.map(d => d.domain).join(', ')}`
    }]);

    // Create order
    await db.from('orders').insert([{
      user_id: userId,
      type: 'domain',
      status: 'success',
      amount: totalAmount,
      reference_id: checkoutSessionId,
      payment_method: 'stripe',
      renews_on: new Date(new Date().setFullYear(new Date().getFullYear() + Math.max(...domains.map(d => parseInt(d.year))))),
      metadata: {
        domain_name: domains.map(d => d.domain).join(', '),
        years: domains.map(d => d.year).join(', ')
      }
    }]);

    // Purchase domains from Namecheap
    const results = await Promise.allSettled(
      domains.map(d => namecheapService.purchaseDomain(d.year, d.domain))
    );

    const purchasedDomains = [];
    const failedDomains = [];

    for (let i = 0; i < domains.length; i++) {
      const { domain, year: currentYear } = domains[i];
      const purchasedOn = new Date();
      const renewsOn = new Date();
      renewsOn.setFullYear(renewsOn.getFullYear() + parseInt(currentYear));

      const result = results[i];

      if (result.status === 'fulfilled' && result.value.success) {
        // Insert domain
        const { error: insertErr } = await db.from('domains').insert([{
          user_id: userId,
          domain_name: domain,
          status: 'Active',
          domain_source: 'Purchased',
          mailbox_count: 0,
          purchased_on: purchasedOn,
          renews_on: renewsOn
        }]);

        if (!insertErr) {
          purchasedDomains.push(domain);
          await logUserActivity(userId, 'Domain purchased via API', { domain_name: domain });
        } else {
          failedDomains.push({ domain, error: 'Database insert failed' });
        }
      } else {
        const errorMsg = result.reason?.message || result.value?.message || 'Unknown error';
        failedDomains.push({ domain, error: errorMsg });
      }
    }

    // Create job
    await db.from('jobs').insert([{
      user_id: userId,
      job_type: 'domain',
      order_type: 'domain',
      status: 'new',
      metadata: {
        domain_name: domains.map(d => d.domain).join(', '),
        years: domains.map(d => d.year).join(', '),
        amount: totalAmount,
        reference_id: checkoutSessionId
      }
    }]);

    await sendSlackMessage(
      `✅ API Domain Purchase\nUser: ${userId}\nDomains: ${purchasedDomains.join(', ')}\nFailed: ${failedDomains.length}`,
      'SUCCESS'
    );

    return res.status(200).json({
      success: true,
      message: 'Domain purchase processed',
      payment_intent_id: paymentIntent.id,
      purchased_domains: purchasedDomains,
      failed_domains: failedDomains
    });

  } catch (error) {
    logger.error({
      message: 'Error in API domain purchase',
      error: error.message,
      user_id: userId
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
};

/**
 * Purchase mailboxes via API with billing details
 * POST /api/v1/mailboxes/purchase
 * Body: { numberOfMailboxes, billing: { payment_method_id, ... } }
 */
exports.purchaseMailboxes = async (req, res) => {
  const userId = req.user.id;
  const { numberOfMailboxes, billing } = req.body;

  try {
    // Validate input
    if (!numberOfMailboxes || numberOfMailboxes <= 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'numberOfMailboxes must be a positive number'
      });
    }

    if (!billing || !billing.payment_method_id) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'billing.payment_method_id is required'
      });
    }

    // Get user data for pricing
    const { data: userData, error: userError } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User associated with API key not found'
      });
    }

    // Calculate price (same logic as existing purchaseMailbox)
    let userPrice = null;
    const { data: specificUserPrice } = await db
      .from('specific_user_price')
      .select('*')
      .eq('email', userData.email)
      .eq('product', 'gsuite')
      .single();

    if (specificUserPrice) {
      userPrice = specificUserPrice.price;
    }

    let planPricePerMailbox = null;
    const { data: subscription } = await db
      .from('gsuite_subscriptions')
      .select('plan_id')
      .eq('user_id', userId)
      .eq('status', 'Active')
      .single();

    if (subscription) {
      const { data: plan } = await db
        .from('plans')
        .select('price_per_additional_mailbox')
        .eq('id', subscription.plan_id)
        .single();

      if (plan) {
        planPricePerMailbox = plan.price_per_additional_mailbox;
      }
    }

    let mailboxPrice;
    if (userPrice) {
      mailboxPrice = userPrice;
    } else if (planPricePerMailbox) {
      mailboxPrice = planPricePerMailbox;
    } else {
      const { data: defaultPlans } = await db
        .from('plans')
        .select('price_per_additional_mailbox')
        .eq('active', true)
        .order('price_monthly', { ascending: true })
        .limit(1)
        .single();

      mailboxPrice = defaultPlans?.price_per_additional_mailbox || 5;
    }

    const totalAmount = mailboxPrice * numberOfMailboxes;

    // Get or create Stripe customer
    let { data: customerData } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    let customerId = customerData?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.email,
        metadata: { user_id: userId }
      });

      await db.from('stripe_customers').insert([{
        user_id: userId,
        stripe_customer_id: customer.id
      }]);

      customerId = customer.id;
    }

    // Attach payment method to customer
    try {
      await stripe.paymentMethods.attach(billing.payment_method_id, {
        customer: customerId,
      });
    } catch (attachError) {
      // Payment method might already be attached, continue
      if (attachError.code !== 'resource_already_exists') {
        logger.error('Error attaching payment method', attachError);
        return res.status(400).json({
          error: 'Payment Method Error',
          message: 'Failed to attach payment method: ' + attachError.message
        });
      }
    }

    // Create product and price
    const product = await stripe.products.create({ name: 'Mailbox Add-on' });
    const price = await stripe.prices.create({
      unit_amount: Math.round(totalAmount * 100),
      currency: 'usd',
      recurring: { interval: 'month' },
      product: product.id
    });

    // Create subscription with payment method
    let subscriptionStripe;
    try {
      subscriptionStripe = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: price.id }],
        default_payment_method: billing.payment_method_id,
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          type: 'mailbox_addon',
          numberOfMailboxes,
          user_id: userId
        }
      });
    } catch (subError) {
      logger.error('Error creating subscription', subError);
      return res.status(400).json({
        error: 'Subscription Error',
        message: 'Failed to create subscription: ' + subError.message
      });
    }

    // Check payment intent status
    const paymentIntent = subscriptionStripe.latest_invoice.payment_intent;

    if (!paymentIntent) {
      return res.status(400).json({
        error: 'Payment Error',
        message: 'Payment intent not found in subscription'
      });
    }

    // If payment requires action, return error (user should handle 3D Secure on frontend)
    if (paymentIntent.status === 'requires_action') {
      return res.status(400).json({
        error: 'Payment Requires Action',
        message: 'Payment requires additional authentication',
        payment_intent: {
          id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status
        }
      });
    }

    // Confirm payment if needed
    if (paymentIntent.status !== 'succeeded') {
      try {
        const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id, {
          payment_method: billing.payment_method_id
        });

        if (confirmed.status === 'requires_action') {
          return res.status(400).json({
            error: 'Payment Requires Action',
            message: 'Payment requires additional authentication',
            payment_intent: {
              id: confirmed.id,
              client_secret: confirmed.client_secret,
              status: confirmed.status
            }
          });
        }

        if (confirmed.status !== 'succeeded') {
          return res.status(400).json({
            error: 'Payment Failed',
            message: `Payment status: ${confirmed.status}`,
            payment_intent_id: confirmed.id
          });
        }
      } catch (confirmError) {
        logger.error('Error confirming payment intent', confirmError);
        return res.status(400).json({
          error: 'Payment Confirmation Error',
          message: 'Failed to confirm payment: ' + confirmError.message
        });
      }
    }

    // Record transaction
    await db.from('transaction_history').insert([{
      user_id: userId,
      type: 'mailbox_addon',
      amount: Math.round(totalAmount * 100),
      currency: 'usd',
      status: 'succeeded',
      payment_provider: 'stripe',
      checkout_session_id: subscriptionStripe.id,
      description: `${numberOfMailboxes}x mailbox add-on @ $${mailboxPrice.toFixed(2)} each`
    }]);

    // Create subscription record
    const renewsOn = new Date();
    renewsOn.setMonth(renewsOn.getMonth() + 1);

    const subscription_id = `api_mb_${uuidv4()}`;
    await db.from('mailbox_subscription').insert([{
      subscription_id: subscription_id,
      user_id: userId,
      status: 'Active',
      billing_date: new Date(),
      renews_on: renewsOn,
      number_of_mailboxes: numberOfMailboxes,
      price_per_mailbox: mailboxPrice,
      total_amount: totalAmount,
      number_of_used_mailbox: 0,
      payment_method: 'stripe',
      mailbox_type: 'Gsuite',
      created_at: new Date(),
      updated_at: new Date()
    }]);

    await logUserActivity(userId, `${numberOfMailboxes} Mailbox add-on purchased via API`, {
      mailbox_count: numberOfMailboxes
    });

    await sendSlackMessage(
      `✅ API Mailbox Purchase\nUser: ${userId}\nMailboxes: ${numberOfMailboxes}\nSubscription: ${subscription_id}`,
      'SUCCESS'
    );

    return res.status(200).json({
      success: true,
      message: 'Mailbox purchase successful',
      subscription_id: subscription_id,
      subscription_stripe_id: subscriptionStripe.id,
      numberOfMailboxes,
      renewsOn
    });

  } catch (error) {
    logger.error({
      message: 'Error in API mailbox purchase',
      error: error.message,
      user_id: userId
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
};

/**
 * Assign mailboxes via API
 * POST /api/v1/mailboxes/assign
 * Body: { mailboxes: [{ firstName, lastName, username, domain, recoveryEmail }] }
 */
exports.assignMailboxes = async (req, res) => {
  const userId = req.user.id;
  const { mailboxes } = req.body;
  const createdLogs = [];

  try {
    if (!Array.isArray(mailboxes) || mailboxes.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'mailboxes array is required and must not be empty'
      });
    }

    for (const mailbox of mailboxes) {
      let { firstName, lastName, username, domain, recoveryEmail } = mailbox;
      
      username = username.replace(/\s+/g, '');
      
      if (!firstName || !lastName || !username || !domain) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Each mailbox must have firstName, lastName, username, and domain'
        });
      }

      // Fetch domain (must belong to user)
      const { data: domainData, error: domainError } = await db
        .from('domains')
        .select('domain_id, domain_name, mailbox_count')
        .eq('user_id', userId)
        .eq('domain_name', domain)
        .single();

      if (domainError || !domainData) {
        return res.status(404).json({
          error: 'Domain Not Found',
          message: `Domain ${domain} not found or does not belong to your account`
        });
      }

      let cleanedUsername = username.includes('@') ? username.split('@')[0] : username;
      const email = `${cleanedUsername}@${domain}`;

      // Check if mailbox exists
      const { data: existingMailbox } = await db
        .from('mailboxes')
        .select('email')
        .eq('email', email)
        .single();

      if (existingMailbox) {
        return res.status(400).json({
          error: 'Mailbox Exists',
          message: `Mailbox already exists: ${email}`
        });
      }

      // Get valid subscription
      const { data: subscriptions, error: subError } = await db
        .from('mailbox_subscription')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['Active', 'Cancel at Period End'])
        .eq('mailbox_type', 'Gsuite')
        .gt('number_of_mailboxes', 0)
        .order('created_at', { ascending: true });

      if (subError || !subscriptions || subscriptions.length === 0) {
        return res.status(403).json({
          error: 'No Active Subscription',
          message: 'No active mailbox subscription available'
        });
      }

      let selectedSub = null;
      for (const sub of subscriptions) {
        if (sub.number_of_used_mailbox < sub.number_of_mailboxes) {
          selectedSub = sub;
          break;
        }
      }

      if (!selectedSub) {
        return res.status(403).json({
          error: 'Subscription Full',
          message: 'All mailbox subscriptions are fully used'
        });
      }

      // Insert mailbox
      const { error: insertError } = await db.from('mailboxes').insert([{
        domain_id: domainData.domain_id,
        email: email.toLowerCase(),
        name: `${firstName} ${lastName}`,
        username: username,
        status: 'Pending',
        user_id: userId,
        recovery_email: recoveryEmail || null,
        subscription_id: selectedSub.subscription_id
      }]);

      if (insertError) {
        logger.error(`Error inserting mailbox: ${email}`, insertError);
        return res.status(500).json({
          error: 'Database Error',
          message: `Failed to create mailbox: ${email}`
        });
      }

      // Update domain mailbox count
      await db
        .from('domains')
        .update({ mailbox_count: domainData.mailbox_count + 1 })
        .eq('domain_id', domainData.domain_id);

      // Update subscription usage
      await db
        .from('mailbox_subscription')
        .update({ number_of_used_mailbox: selectedSub.number_of_used_mailbox + 1 })
        .eq('subscription_id', selectedSub.subscription_id);

      createdLogs.push(`Created: ${email} || ${firstName} ${lastName}`);
    }

    // Create job
    await db.from('jobs').insert([{
      user_id: userId,
      order_type: 'gsuite',
      job_type: 'assign_mailboxes',
      status: 'new',
      metadata: {
        assign_type: 'api',
        number_of_mailboxes: mailboxes.length,
        mailboxes: mailboxes.map(m => ({
          firstName: m.firstName,
          lastName: m.lastName,
          username: m.username,
          domain: m.domain,
          recoveryEmail: m.recoveryEmail
        }))
      }
    }]);

    await logUserActivity(userId, `${createdLogs.length} Mailbox assigned via API`, {
      mailbox_assigned: createdLogs
    });

    return res.status(200).json({
      success: true,
      message: 'Mailboxes assigned successfully',
      count: createdLogs.length
    });

  } catch (error) {
    logger.error({
      message: 'Error in API assign mailboxes',
      error: error.message,
      user_id: userId
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
};

/**
 * Delete mailboxes via API
 * DELETE /api/v1/mailboxes/:mailboxId
 * or POST /api/v1/mailboxes/delete with body: { mailboxIds: [...] }
 */
exports.deleteMailboxes = async (req, res) => {
  const userId = req.user.id;
  const mailboxIds = req.params.mailboxId 
    ? [req.params.mailboxId] 
    : (req.body.mailboxIds || []);

  try {
    if (!Array.isArray(mailboxIds) || mailboxIds.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'mailboxIds array is required or provide mailboxId in URL'
      });
    }

    const deletedLogs = [];

    for (const mailboxId of mailboxIds) {
      // Fetch mailbox (must belong to user)
      const { data: mailboxData, error: mailboxError } = await db
        .from('mailboxes')
        .select('*')
        .eq('mailbox_id', mailboxId)
        .single();

      if (mailboxError || !mailboxData) {
        return res.status(404).json({
          error: 'Mailbox Not Found',
          message: `Mailbox ${mailboxId} not found`
        });
      }

      // Verify ownership through domain
      const { data: domainData } = await db
        .from('domains')
        .select('user_id')
        .eq('domain_id', mailboxData.domain_id)
        .single();

      if (!domainData || domainData.user_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Mailbox ${mailboxId} does not belong to your account`
        });
      }

      // Update mailbox status
      await db
        .from('mailboxes')
        .update({ status: 'Scheduled for Deletion', updated_at: new Date() })
        .eq('mailbox_id', mailboxId);

      // Get current domain mailbox count
      const { data: currentDomainData } = await db
        .from('domains')
        .select('mailbox_count')
        .eq('domain_id', mailboxData.domain_id)
        .single();

      // Update domain mailbox count
      if (currentDomainData) {
        await db
          .from('domains')
          .update({ mailbox_count: Math.max(0, (currentDomainData.mailbox_count || 0) - 1) })
          .eq('domain_id', mailboxData.domain_id);
      }

      deletedLogs.push(`Deleted: ${mailboxData.email}`);
    }

    await logUserActivity(userId, `${deletedLogs.length} Mailbox deleted via API`, {
      mailbox_deleted: deletedLogs
    });

    await sendSlackMessage(
      `📦 API Mailbox Deletion\nUser: ${userId}\nCount: ${deletedLogs.length}`,
      'ALERT'
    );

    return res.status(200).json({
      success: true,
      message: 'Mailboxes deleted successfully',
      count: deletedLogs.length
    });

  } catch (error) {
    logger.error({
      message: 'Error in API delete mailboxes',
      error: error.message,
      user_id: userId
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
};


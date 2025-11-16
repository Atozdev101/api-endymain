const stripe = require('../config/stripeConfig');
const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const {cancelWalletSubscription} = require('../services/subscriptionService');
const {sendSlackMessage} = require('../config/slackConfig')

exports.getAddonSubscription = async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: addons, error } = await db
      .from('mailbox_subscription')
      .select(`
        total_amount,
        number_of_mailboxes,
        status,
        created_at,
        renews_on,
        subscription_id,
        mailbox_type,
        payment_method
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Addon fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch addon subscriptions' });
    }

    if (!addons || addons.length === 0) {
      return res.status(404).json({ error: 'No mailbox addon subscriptions found' });
    }
   
    const formattedAddons = addons.map(addon => ({
      plan: addon.mailbox_type === 'Gsuite' ? 'Gsuite Addon' : 'Pre-Warmed Addon',
      price: Number(addon.total_amount ?? 0),
      status: addon.status,
      mailboxesIncluded: addon.number_of_mailboxes ?? 0,
      purchasedOn: addon.created_at,
      renewsOn: addon.renews_on,
      subscription_id: addon.subscription_id,
      paymentMethod: addon.payment_method,
    }));
    
    return res.status(200).json({
      subscriptions: formattedAddons,
    });
    

  } catch (err) {
    logger.error('Get addon subscriptions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getCurrentSubscription = async (req, res) => {
  const userId = req.user.id;

  try {
    console.log('Fetching current subscription for user:', userId);
    
    // Get current active subscription from gsuite_subscriptions table
    const { data: currentSubscription, error } = await db
      .from('gsuite_subscriptions')
      .select(`
        subscription_id,
        status,
        renews_on,
        mailboxes_total,
        mailboxes_used,
        plan_id,
        created_at
      `)
      .eq('user_id', userId)
      .in('status', ['Active', 'Cancel at Period End'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    console.log('Current subscription query result:', { currentSubscription, error });

    if (error) {
      logger.error('Current subscription fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch current subscription' });
    }

    if (!currentSubscription) {
      return res.status(200).json(null);
    }

    // Fetch the plan for this subscription by plan_id
    const { data: plan, error: planError } = await db
      .from('plans')
      .select('*')
      .eq('id', currentSubscription.plan_id)
      .eq('active', true)
      .single();

    console.log('Plan query result:', { plan, planError });

    if (planError) {
      logger.error('Plan fetch error:', planError);
      return res.status(500).json({ error: 'Failed to fetch plan for subscription' });
    }

    const formattedSubscription = {
      subscription_id: currentSubscription.subscription_id,
      status: currentSubscription.status,
      renews_on: currentSubscription.renews_on,
      mailboxes_total: currentSubscription.mailboxes_total,
      mailboxes_used: currentSubscription.mailboxes_used,
      created_at: currentSubscription.created_at,
      plan: plan
    };
    
    console.log('Sending formatted subscription:', formattedSubscription);
    return res.status(200).json(formattedSubscription);

  } catch (err) {
    logger.error('Get current subscription error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createStripeSubscription = async (req, res) => {
  const userId = req.user.id;
  const { planId } = req.body;

  const { data: plan, error: planErr } = await db
    .from('plans')
    .select('*')
    .eq('id', planId)
    .single();

  if (planErr || !plan) {
    return res.status(400).json({ error: 'Plan not found' });
  }

  const stripePriceId = plan.stripe_price_id_monthly;

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

  

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1
        }
      ],
      success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/profile`,
      metadata: {
        type: 'mailbox_subscription',
        plan_id: plan.id,
        user_id: userId
      },
      allow_promotion_codes: true,
    });

   const {error: transactionErr} = await db.from('transaction_history').insert([
      {
        user_id: userId,
        type: 'mailbox_subscription',
        amount: plan.price_monthly * 100,
        currency: 'usd',
        status: 'pending',
        payment_provider: 'stripe',
        checkout_session_id: session.id,
        description: `Subscription for ${plan.name} successfully created`,
      }
    ]);
    if (transactionErr) {
      await logger.error('Failed to insert transaction history', transactionErr);
      console.log(transactionErr);
    }
    res.json({ checkoutUrl: session.url });

  } catch (error) {
    logger.error('purchaseMailbox error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }

};

exports.getSubscriptionByWallet = async (req, res) => {
  const userId = req.user.id;
  const { priceId } = req.body;

  try {
    // 1. Get Wallet
    const { data: wallet, error: walletErr } = await db
      .from('wallet')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (walletErr || !wallet) {
      await logger.error({ message: '❌ Wallet not found', user_id: userId, error: walletErr?.message });
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // 2. Get Plan
    const { data: plan, error: planErr } = await db
      .from('plans')
      .select('plan_id, price, duration, mailboxes_included')
      .eq('plan_id', priceId)
      .single();

    if (planErr || !plan) {
      await logger.error({ message: '❌ Plan not found', user_id: userId, priceId });
      return res.status(400).json({ error: 'Plan not found' });
    }

    const planPrice = parseFloat(plan.price);
    const walletBalance = parseFloat(wallet.balance);

    // 3. Insufficient Balance
    if (walletBalance < planPrice) {
      await logger.info({ message: '⚠️ Insufficient wallet balance', user_id: userId, balance: walletBalance, required: planPrice });
      return res.status(402).json({ error: 'Insufficient wallet balance' });
    }

    // 4. Deduct from wallet
    const newBalance = walletBalance - planPrice;

    const { error: updateErr } = await db
      .from('wallet')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('wallet_id', wallet.wallet_id);

    if (updateErr) {
      await logger.error({ message: '❌ Failed to update wallet balance', user_id: userId, error: updateErr.message });
      return res.status(500).json({ error: 'Wallet update failed' });
    }

    // 5. Log to wallet_transactions
    const txnTime = new Date().toISOString();
    const txnDescription = `Plan purchased: ${plan.priceId}`;

    await db.from('wallet_transactions').insert({
      wallet_id: wallet.wallet_id,
      type: 'debit',
      amount: planPrice,
      description: txnDescription,
      txn_time: txnTime,
    });

    // 6. Optional: Log to user_transactions
    await db.from('user_transactions').insert({
      user_id: userId,
      type: 'subscription',
      amount: Math.round(planPrice),
      currency: 'USD',
      status: 'succeeded',
      payment_provider: 'wallet',
      description: txnDescription,
      created_at: txnTime,
    });

    // 7. Apply Subscription
    const now = new Date();
    const renewDate = new Date(now);
    renewDate.setDate(now.getDate() + plan.duration);

    const subscriptionPayload = {
      subscription_id: `wallet-${Date.now()}`,
      priceId,
      status: 'active',
      billing_date: now.toISOString(),
      renews_on: renewDate.toISOString(),
      mailboxes_total: plan.mailboxes_included,
      mailboxes_used: 0,
      stripe: {
        current_period_start: now,
        current_period_end: renewDate,
        cancel_at_period_end: false,
        created_at: now.toISOString(),
      },
    };

    await applySubscription(userId, subscriptionPayload);

    // insert order in orders table
    await db.from('orders').insert({
      user_id: userId,
      type: 'gsuit',
      status: 'success',
      reference_id: subscriptionPayload.subscription_id,
      amount: planPrice,
      payment_method: 'wallet',
      metadata: {
        number_of_mailboxes: plan.mailboxes_included,
        price_per_mailbox: planPrice,
      },
    });

    await logger.info({ message: '✅ Wallet subscription applied', user_id: userId, plan_id, amount: planPrice });
    res.status(200).json({ message: 'Subscription activated using wallet' });

  } catch (err) {
    await logger.error({ message: '💥 Unexpected error in wallet subscription', user_id: userId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.cancelStripeSubscription = async (req, res) => {
  const userId = req.user.id;
  const { subscription_id, cancelImmediately } = req.body;
  console.log(subscription_id, cancelImmediately);
  try {
    // Step 1: Get Stripe data from mailbox_subscription
    const { data: subscriptionData, error: subErr } = await db
      .from('mailbox_subscription')
      .select('subscription_id, status, payment_method')
      .eq('user_id', userId)
      .eq('subscription_id', subscription_id)
      .single();
    if (subErr || !subscriptionData) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    if (subscriptionData.status !== 'Active') {
      return res.status(400).json({ error: 'Subscription is not active' });
    }

    let canceled;
    console.log(subscriptionData);

    // check if payment method is wallet
    if (subscriptionData.payment_method =='wallet' && cancelImmediately) {
      // check if wallet has enough balance
      console.log('wallet subscription immediate');
      await cancelWalletSubscription(subscriptionData);
      return res.status(200).json({ message: 'Subscription canceled immediately' });
      
    } else if (subscriptionData.payment_method =='wallet' && !cancelImmediately) {
      // cancel at period end
      console.log('wallet subscription at period end');
      // update the status to cancell at period end
      const { data: subscriptionData, error: subErr } = await db
        .from('mailbox_subscription')
        .update({ status: 'Cancel at Period End' })
        .eq('subscription_id', subscription_id);
      if (subErr) {
        return res.status(500).json({ error: 'Failed to update subscription status' });
      }
      await sendSlackMessage(`User ${userId} canceled wallet subscription ${subscription_id} at period end`);
      return res.status(200).json({ message: 'Subscription will be canceled at end of period' });
    }

    // Step 2: Cancel subscription on Stripe
    if (subscriptionData.payment_method =='stripe' && cancelImmediately) {
      // Immediate cancellation
      canceled = await stripe.subscriptions.cancel(subscription_id);
    } else if (subscriptionData.payment_method =='stripe' && !cancelImmediately) {
      // Cancel at period end
      canceled = await stripe.subscriptions.update(subscription_id, {
        cancel_at_period_end: true,
      });
    }

    if (!canceled) {
      return res.status(500).json({ error: 'Failed to cancel subscription on Stripe' });
    }

    // Step 4: Log cancellation
    const slackMessage = `User ${userId} canceled subscription ${subscription_id} on Stripe. Mode: ${cancelImmediately ? 'immediate' : 'end of period'}`;
    logger.info('Subscription canceled:', slackMessage);

    return res.status(200).json({ 
      message: cancelImmediately ? 'Subscription canceled immediately' : 'Subscription will be canceled at end of period',
      stripeStatus: canceled.status 
    });

  } catch (err) {
    logger.error('Cancel subscription error:', err);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
};

exports.customerPortal = async (req, res) => {
  const userId = req.user.id;

  try {
    const { data, error } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(400).json({ error: 'Stripe customer not found' });
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${frontendUrl}/profile/subscriptions`,
    });

    res.json({ url: session.url });

  } catch (err) {
    logger.error('Customer portal error:', err);
    res.status(500).json({ error: 'Could not generate billing portal' });
  }
};

exports.getInvoice = async (req, res) => {
  const userId = req.user.id;

  try {
    // Step 1: Get Stripe customer ID
    const { data: customerData, error: customerErr } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (customerErr || !customerData) {
      return res.status(400).json({ error: 'Stripe customer not found' });
    }

    // Step 2: Get active subscription ID
    const { data: activeSub, error: subErr } = await db
      .from('stripe_subscriptions')
      .select('subscription_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subErr || !activeSub) {
      return res.status(404).json({ error: 'Active subscription not found' });
    }

    // Step 3: Fetch invoices only for the active subscription
    const invoices = await stripe.invoices.list({
      customer: customerData.stripe_customer_id,
      subscription: activeSub.subscription_id,
      limit: 10,
    });

    // Step 4: Format and return
    const formatted = invoices.data.map(invoice => ({
      id: invoice.id,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency.toUpperCase(),
      status: invoice.status,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      created: new Date(invoice.created * 1000),
    }));

    return res.json({ invoice_url: invoices.hosted_invoice_url });

  } catch (err) {
    logger.error('Get invoice error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

exports.changePlan = async (req, res) => {
  const userId = req.user.id;
  const { newPlanId, action } = req.body;

  try {
    console.log('Plan change request:', { userId, newPlanId, action });

    // Get the new plan details
    const { data: newPlan, error: planError } = await db
      .from('plans')
      .select('*')
      .eq('id', newPlanId)
      .single();

    if (planError || !newPlan) {
      logger.error('Plan fetch error:', planError);
      console.log(planError);
      return res.status(400).json({ success: false, message: 'New plan not found' });
    }

    // Get current subscription from gsuite_subscriptions
    const { data: currentSubscription, error: subError } = await db
      .from('gsuite_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'Active')
      .single();

    if (subError || !currentSubscription) {
      logger.error('Current subscription fetch error:', subError);
      console.log(subError);
      return res.status(400).json({ success: false, message: 'No active subscription found' });
    }

    // Get current plan details
    const { data: currentPlan, error: currentPlanError } = await db
      .from('plans')
      .select('*')
      .eq('id', currentSubscription.plan_id)
      .single();

    if (currentPlanError || !currentPlan) {
      logger.error('Current plan fetch error:', currentPlanError);
      console.log(currentPlanError);
      return res.status(400).json({ success: false, message: 'Current plan not found' });
    }

    // Check if user is trying to change to the same plan
    if (currentSubscription.plan_id === newPlanId) {
      console.log('Already on this plan');
      return res.status(400).json({ success: false, message: 'Already on this plan' });
    }

    // Get Stripe customer
    const { data: customerData } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (!customerData?.stripe_customer_id) {
      console.log('No Stripe customer found');
      return res.status(400).json({ success: false, message: 'No Stripe customer found' });
    }

    // Handle Stripe subscription change
    let stripeSubscription;
    try {
      // Get current Stripe subscription
      const subscriptions = await stripe.subscriptions.list({
        customer: customerData.stripe_customer_id,
        status: 'active',
        limit: 1
      });

      if (subscriptions.data.length === 0) {
        console.log('No active Stripe subscription found');
        return res.status(400).json({ success: false, message: 'No active Stripe subscription found' });
      }

      const currentStripeSubscription = subscriptions.data[0];
      const currentPriceId = currentStripeSubscription.items.data[0].price.id;
      const newPriceId = newPlan.stripe_price_id_monthly;

      if (currentPriceId === newPriceId) {
        console.log('Already on this plan');
        return res.status(400).json({ success: false, message: 'Already on this plan' });
      }

      // Determine if it's an upgrade or downgrade
      const isUpgrade = newPlan.price_monthly > currentPlan.price_monthly;
      const prorationBehavior = isUpgrade ? 'create_prorations' : 'none';

      // Update Stripe subscription
      stripeSubscription = await stripe.subscriptions.update(currentStripeSubscription.id, {
        items: [{
          id: currentStripeSubscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: prorationBehavior,
        billing_cycle_anchor: 'now', // For immediate changes
      });

      console.log('Stripe subscription updated:', stripeSubscription.id);

    } catch (stripeError) {
      logger.error('Stripe subscription update error:', stripeError);
      return res.status(500).json({ success: false, message: 'Failed to update Stripe subscription' });
    }

    // Update gsuite_subscriptions table
    const { error: updateGsuiteError } = await db
      .from('gsuite_subscriptions')
      .update({
        plan_id: newPlanId,
        mailboxes_total: newPlan.included_mailboxes,
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', currentSubscription.subscription_id);

    if (updateGsuiteError) {
      logger.error('Gsuite subscription update error:', updateGsuiteError);
      return res.status(500).json({ success: false, message: 'Failed to update gsuite subscription' });
    }

    // Update mailbox_subscription table
    const { error: updateMailboxError } = await db
      .from('mailbox_subscription')
      .update({
        number_of_mailboxes: newPlan.included_mailboxes,
        price_per_mailbox: newPlan.price_per_additional_mailbox,
        total_amount: newPlan.price_monthly,
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', currentSubscription.subscription_id);

    if (updateMailboxError) {
      logger.error('Mailbox subscription update error:', updateMailboxError);
      return res.status(500).json({ success: false, message: 'Failed to update mailbox subscription' });
    }

    // Log the plan change
    await logger.info({
      message: `✅ Plan ${action} successful`,
      context: {
        userId,
        newPlanId,
        action,
        oldPlan: currentPlan.name,
        newPlan: newPlan.name,
        newPlanPrice: newPlan.price_monthly,
        stripeSubscriptionId: stripeSubscription?.id
      }
    });

    // Send Slack notification
    await sendSlackMessage(
      `🔄 Plan ${action} completed\nUser: ${userId}\nAction: ${action}\nOld Plan: ${currentPlan.name}\nNew Plan: ${newPlan.name}\nPrice: $${newPlan.price_monthly}/month\nMailboxes: ${newPlan.included_mailboxes}\nStripe: ${stripeSubscription?.id}`,
      'SUCCESS'
    );

    return res.status(200).json({
      success: true,
      message: `Plan ${action} successful`,
      data: {
        newPlan,
        action,
        stripeSubscriptionId: stripeSubscription?.id
      }
    });

  } catch (err) {
    logger.error('Plan change error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


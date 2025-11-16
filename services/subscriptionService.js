const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const {sendSlackMessage} = require('../config/slackConfig')

const cancelWalletSubscription = async (subscription) => {
  const { subscription_id } = subscription;
  console.log(subscription_id);
  const id = subscription_id;
  // get the number of mailboxes in the subscription
  const { data: subscriptionData, error: subscriptionErr } = await db
    .from('mailbox_subscription')
    .select('*')
    .eq('subscription_id', id)
    .single();
  if (subscriptionErr) {
    await logger.error('get the number of mailboxes in the subscription failed', subscriptionErr);
    return;
  }
  const numberOfMailboxes = subscriptionData.number_of_mailboxes;
  const userId = subscriptionData.user_id;
  const { data: userData, error: userErr } = await db.from('users').select('email').eq('id', userId).single();
  if (userErr) {
    await logger.error('get the email of the user failed', userErr);
    return;
  }
  const email = userData.email;
  // update the mailbox_subscription table
  const { error: updateErr } = await db
    .from('mailbox_subscription')
    .update({ status: 'Cancelled' })
    .eq('subscription_id', id);
  if (updateErr) {
    await logger.error({
      message: '❌ Wallet Subscription cancel update failed',
      context: { error: updateErr.message },
      user_id: userId,
    });
    await sendSlackMessage(`❌ Failed to update wallet cancel subscription status for ${id}`, 'ERROR');
    return;
  }

  if (subscriptionData.mailbox_type === 'Gsuite') {
    // find the mailboxes in the subscription using the subscription_id and updated the status to inactive
    const { data: mailboxes, error: mailboxesErr } = await db
      .from('mailboxes')
      .select('*')
      .eq('subscription_id', id);
    if (mailboxesErr) {
      await logger.error('find the mailboxes in the subscription using the subscription_id and updated the status to inactive failed', mailboxesErr);
      return;
    }
    // update the status to inactive for all mailboxes under the subscription_id
    const { error: updateStatusErr } = await db
      .from('mailboxes')
      .update({ status: 'Inactive' })
      .eq('subscription_id', id);
    if (updateStatusErr) {
      await logger.error('update the status to inactive for all mailboxes under the subscription_id failed', updateStatusErr);
      return;
    }
    // insert the job in the jobs table with the following data
    const { error: insertJobErr } = await db.from('jobs').insert({
      user_id: userId,
      job_type: 'cancel_subscription',
      order_type: 'gsuite',
      status: 'new',
      metadata: {
        subscriptionId: id,
        mailboxes: mailboxes.map(mailbox => mailbox.email),
      }
    });
    await sendSlackMessage(` ✅ Gsuite Wallet Subscription canceled successfully : ${id} for user ${userId}|| ${email} and ${mailboxes.length} mailboxes updated to inactive || ${mailboxes.map(mailbox => mailbox.email)}`, 'INFO');
    return;
  } else if (subscriptionData.mailbox_type === 'Pre-Warmed') {
    // find the mailboxes in the subscription using the subscription_id and updated the status to inactive
    const { data: mailboxes, error: mailboxesErr } = await db
      .from('prewarm_mailboxes')
      .select('*')
      .eq('subscription_id', id);
    if (mailboxesErr) {
      await logger.error('find the mailboxes in the subscription using the subscription_id and updated the status to inactive failed', mailboxesErr);
      return;
    }
    // update the status to inactive and null the subscription_id and user_id for all mailboxes under the subscription_id
    const { error: updateStatusErr } = await db
      .from('prewarm_mailboxes')
      .update({ status: 'Inactive', subscription_id: null, user_id: null, export_id: null })
      .eq('subscription_id', id);
    if (updateStatusErr) {
      await logger.error('update the status to inactive for all mailboxes under the subscription_id failed', updateStatusErr);
      return;
    }
    // insert the job in the jobs table with the following data
    const { error: insertJobErr } = await db.from('jobs').insert({
      user_id: userId,
      job_type: 'cancel_subscription',
      order_type: 'prewarm',
      status: 'new',
      metadata: {
        subscriptionId: id,
        mailboxes: mailboxes.map(mailbox => mailbox.email),
      }
    });
    if (insertJobErr) {
      await logger.error('insert the job in the jobs table with the following data failed', insertJobErr);
      return;
    }
    await sendSlackMessage(` ✅ Pre-Warmed Subscription canceled successfully : ${id} for user ${userId}|| ${email} and ${mailboxes.length} mailboxes updated to inactive || ${mailboxes.map(mailbox => mailbox.email)}`, 'INFO');
    return;
  }
};

const renewWalletSubscription = async (subscription) => {
  const { subscription_id } = subscription.body;
  
  try {
    // 🔍 Get subscription details
    const { data: subscriptionData, error: subscriptionErr } = await db
      .from('mailbox_subscription')
      .select('*')
      .eq('subscription_id', subscription_id)
      .single();

    if (subscriptionErr || !subscriptionData) {
      await logger.error('Failed to fetch subscription data', subscriptionErr);
      return { success: false, error: 'Subscription not found' };
    }

    const userId = subscriptionData.user_id;
    const numberOfMailboxes = subscriptionData.number_of_mailboxes;
    const pricePerMailbox = subscriptionData.price_per_mailbox;
    const totalAmount = subscriptionData.total_amount;

    // 👤 Get user email for logging
    const { data: userData, error: userErr } = await db
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (userErr) {
      await logger.error('Failed to fetch user data', userErr);
      return { success: false, error: 'User not found' };
    }

    const email = userData.email;

    // 💰 Check wallet balance
    const { data: walletData, error: walletErr } = await db
      .from('wallet')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (walletErr || !walletData) {
      await logger.error('Failed to fetch wallet data', walletErr);
      return { success: false, error: 'Wallet not found' };
    }

    await sendSlackMessage(
      `⚠️ Wallet gsuite subscription renewal failed - Insufficient balance\nUser: ${email}\nSubscription: ${subscription_id}\nRequired: $${totalAmount}\nAvailable: $${walletData.balance}`,
      'WARNING'
    );

    if (walletData.balance < totalAmount) {
      await logger.warn({
        message: '⚠️ Insufficient wallet balance for renewal',
        context: { userId, email, subscription_id, required: totalAmount, available: walletData.balance }
      });
      // cancel the subscription
      await cancelWalletSubscription({ subscription_id : subscription_id });

      // Update subscription status to 'Cancelled'
      await db
        .from('mailbox_subscription')
        .update({ status: 'Cancelled' })
        .eq('subscription_id', subscription_id);

      return { success: false, error: 'Insufficient wallet balance' };
    }

    // 💸 Deduct amount from wallet
    const { error: deductError } = await db
      .from('wallet')
      .update({ balance: walletData.balance - totalAmount })
      .eq('wallet_id', walletData.wallet_id);

    if (deductError) {
      await logger.error('Failed to deduct wallet balance', deductError);
      return { success: false, error: 'Failed to deduct wallet balance' };
    }

    // 🧾 Record wallet transaction
    const { error: transactionErr } = await db
      .from('wallet_transactions')
      .insert({
        wallet_id: walletData.wallet_id,
        amount: totalAmount,
        type: 'debit',
        description: `Renewed ${numberOfMailboxes} mailbox(es) subscription at $${pricePerMailbox}/each`,
        txn_time: new Date().toISOString()
      });

    if (transactionErr) {
      await logger.error('Failed to record wallet transaction', transactionErr);
      return { success: false, error: 'Failed to record transaction' };
    }

    // 📅 Calculate new renewal date (1 month from now)
    const newRenewalDate = new Date();
    newRenewalDate.setMonth(newRenewalDate.getMonth() + 1);

    // 🔄 Update subscription
    const { error: updateSubErr } = await db
      .from('mailbox_subscription')
      .update({
        status: 'Active',
        billing_date: new Date().toISOString(),
        renews_on: newRenewalDate.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', subscription_id);

    if (updateSubErr) {
      await logger.error('Failed to update subscription', updateSubErr);
      return { success: false, error: 'Failed to update subscription' };
    }

    // 🧾 Create order record
    const { error: orderErr } = await db
      .from('orders')
      .insert({
        user_id: userId,
        type: 'gsuite',
        status: 'success',
        reference_id: subscription_id,
        amount: totalAmount,
        payment_method: 'wallet',
        renews_on: newRenewalDate.toISOString(),
        metadata: {
          number_of_mailboxes: numberOfMailboxes,
          price_per_mailbox: pricePerMailbox,
          renewal: true
        }
      });

    if (orderErr) {
      await logger.error('Failed to create order record', orderErr);
      // Don't return error here as subscription is already renewed
    }

    // ✅ Log success
    await logger.info({
      message: '✅ Wallet subscription renewed successfully',
      context: { 
        userId, 
        email, 
        subscription_id, 
        numberOfMailboxes, 
        totalAmount,
        newRenewalDate: newRenewalDate.toISOString()
      }
    });

    await sendSlackMessage(
      `✅ Wallet subscription renewed\nUser: ${email}\nSubscription: ${subscription_id}\nMailboxes: ${numberOfMailboxes}\nAmount: $${totalAmount}\nNew Renewal: ${newRenewalDate.toISOString().split('T')[0]}`,
      'SUCCESS'
    );

    return { 
      success: true, 
      message: 'Subscription renewed successfully',
      data: {
        subscription_id,
        newRenewalDate: newRenewalDate.toISOString(),
        amount: totalAmount
      }
    };

  } catch (error) {
    await logger.error('Unexpected error in renewWalletSubscription', error);
    await sendSlackMessage(
      `❌ Unexpected error renewing wallet subscription ${subscription_id}: ${error.message}`,
      'ERROR'
    );
    return { success: false, error: 'Internal server error' };
  }
};

const applySubscription = async (userId, subscription) => {
  const { subscription_id, plan_id, status, billing_date, renews_on, mailboxes_total, price_per_mailbox, payment_method, total_amount } = subscription;
  const { data: subscriptionData, error: subscriptionErr } = await db
    .from('gsuite_subscriptions')
    .insert({
      user_id: userId,
      subscription_id,
      plan_id,
      status,
      billing_date,
      renews_on,
      mailboxes_total,
    });
    if (subscriptionErr) {
      await logger.error('Failed to apply subscription', subscriptionErr);
      await sendSlackMessage(`❌ Failed to apply subscription for ${userId}`, 'ERROR');
      return { success: false, error: 'Failed to apply subscription' };
    }
    // insert the subscription into the mailbox_subscription table
    const { error: insertSubscriptionErr } = await db
      .from('mailbox_subscription')
      .insert({
        user_id: userId,
        subscription_id,
        status,
        billing_date,
        renews_on,
        number_of_mailboxes: mailboxes_total,
        price_per_mailbox: price_per_mailbox,
        total_amount: total_amount,
        mailbox_type: 'Gsuite',
        payment_method: payment_method,
      });
    if (insertSubscriptionErr) {
      await logger.error('Failed to insert subscription into the mailbox_subscription table', insertSubscriptionErr);
    }
    return { success: true, message: 'Subscription applied successfully' };
};

const alertWalletSubscription = async (subscription) => {
  const { subscription_id } = subscription.body;
  console.log(subscription_id);
};

module.exports = { cancelWalletSubscription , renewWalletSubscription , applySubscription,alertWalletSubscription };

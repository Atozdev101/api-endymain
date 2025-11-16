const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const { sendSlackMessage } = require('../config/slackConfig')
const namecheapService = require('./namecheapService');
const stripe = require('../config/stripeConfig');
const { applySubscription } = require('./subscriptionService');
const { logUserActivity } = require('../utils/userRecentActivityLogger');
const axios = require('axios');
const { setupClientSlackChannel } = require('../utils/slackInvite');

const handleDomainPurchase = async (session) => {
    const userId = session.metadata.user_id;
    const amount = session.amount_total;
    const domainName = session.metadata.domains;
    const year = session.metadata.years;
    const email = session.customer_details.email;

    const { error: txnErr } = await db
        .from('transaction_history')
        .update({ status: 'succeeded', reference_id: session.payment_intent })
        .eq('checkout_session_id', session.id);

    if (txnErr) {
        await logger.error({
            message: '❌ Transaction update failed',
            context: { error: txnErr.message },
            user_id: userId,
        });
        await sendSlackMessage(`❌ Failed to update transaction for domain \`${domainName}\`\nUser: ${userId}\nReason: ${txnErr.message}`, 'ERROR');
        return;
    }
    await sendSlackMessage(`✅ Payment successfully received!\nUser: ${userId} (${email})\nContext: domain_purchase \nDomain: ${domainName}\nYears: ${year}`, 'SUCCESS');
    // insert order in orders table
    const { error: insertOrderErr } = await db.from('orders').insert({
        user_id: userId,
        type: 'domain',
        status: 'success',
        amount: amount,
        reference_id: session.payment_intent,
        payment_method: 'stripe',
        renews_on: new Date(new Date().setFullYear(new Date().getFullYear() + parseInt(year))),
        cupon_code: session.metadata.cupon_code,
        metadata: {
            amount: amount,
            domain_name: domainName,
            years: year,
        },
    });
    if (insertOrderErr) {
        await logger.error({
            message: '❌ Order insertion failed',
            context: { error: insertOrderErr.message },
            user_id: userId,
        });
    }

    // insert job in the jobs table with the following data
    const { error: insertJobErr } = await db.from('jobs').insert({
        user_id: userId,
        job_type: 'domain',
        order_type: 'domain',
        status: 'new',
        metadata: { domain_name: domainName, years: year, amount: amount, reference_id: session.payment_intent },
    });
    if (insertJobErr) {
        await logger.error({
            message: '❌ Job insertion failed',
            context: { error: insertJobErr.message },
            user_id: userId,
        });
    }

    // Slack invite after successful purchase
    try {
        const purchaseDetailsText = `Thank you for your domain purchase!\nDomain(s): ${domainName}\nYears: ${year}\nAmount: $${(amount / 100).toFixed(2)}`;
        await setupClientSlackChannel(email, purchaseDetailsText);
    } catch (err) {
        await logger.error({ message: 'Slack invite failed', context: { error: err.message, email }, user_id: userId });
    }

    try {
        const domainList = domainName.split(',').map((d) => d.trim());
        const results = await Promise.allSettled(
            domainList.map((domain, index) => namecheapService.purchaseDomain(year.split(',')[index] || year[0], domain))
        );

        for (let i = 0; i < domainList.length; i++) {
            const domain = domainList[i];
            const currentYear = parseInt(year.split(',')[i] || year[0]);
            const purchasedOn = new Date();
            const renewsOn = new Date();
            renewsOn.setFullYear(renewsOn.getFullYear() + currentYear);

            // Step 1: Insert domain with status 'Inactive'
            const { error: preInsertErr } = await db.from('domains').insert({
                user_id: userId,
                domain_name: domain,
                status: 'Inactive', // default to Inactive
                domain_source: 'Purchased',
                mailbox_count: 0,
                purchased_on: purchasedOn,
                renews_on: renewsOn,
            });

            if (preInsertErr) {
                await logger.warn({
                    message: '⚠️ Pre-insert domain failed',
                    context: { error: preInsertErr.message },
                    user_id: userId,
                });
                await sendSlackMessage(`⚠️ Could not pre-insert domain \`${domain}\`\n👤 *User ID:* \`${userId}\`\n❌ *Error:* ${preInsertErr.message}`, 'ERROR');
                continue; // Skip this domain if insert failed
            }

            // Step 2: Attempt to register domain with Namecheap
            const result = results[i];

            if (result.status === 'fulfilled' && result.value.success) {
                const { error: updateErr } = await db
                    .from('domains')
                    .update({ status: 'Active' })
                    .eq('user_id', userId)
                    .eq('domain_name', domain);

                if (updateErr) {
                    await logger.warn({
                        message: '⚠️ Domain registered but DB update to Active failed',
                        context: { error: updateErr.message },
                        user_id: userId,
                    });
                    await sendSlackMessage(`⚠️ Domain \`${domain}\` registered, but status update failed.\n👤 *User ID:* \`${userId}\`\n❌ *Error:* ${updateErr.message}`, 'ERROR');
                } else {
                    await logUserActivity(userId, 'Domain successfully registered', { domain_name: domain });
                    await sendSlackMessage(`✅ Domain \`${domain}\` successfully registered and updated in DB!\n👤 *User:* \`${userId}\` (${email})`, 'SUCCESS');
                }
            } else {
                const errorMsg = result.reason?.message || result.value?.message || 'Unknown error';
                await logger.error({
                    message: '❌ Domain registration failed',
                    context: { domain, error: errorMsg },
                    user_id: userId,
                });
                await sendSlackMessage(`❌ *Domain Registration Failed*\n🔗 \`${domain}\`\n👤 *User:* \`${userId}\` (${email})\n🧨 *Reason:* ${errorMsg}`, 'ERROR');
            }
        }

    } catch (err) {
        await logger.error({
            message: '❌ Domain purchase threw error',
            context: { error: err.message },
            user_id: userId,
        });
        await sendSlackMessage(`🚨 Exception while purchasing domain \`${domainName}\`\nUser: ${userId} (${email})\nError: ${err.message}`, 'ERROR');
    }
};
const handleWalletTopUp = async (session) => {
    const userId = session.metadata.user_id;
    const amountInCents = session.amount_total; // Stripe gives amount in cents
    const amount = (amountInCents / 100).toFixed(2);
    const referenceId = session.payment_intent;
    const currency = session.currency;
    const email = session.customer_details.email;

    const { error: txnErr } = await db
        .from('transaction_history')
        .update({ status: 'succeeded', reference_id: session.payment_intent })
        .eq('checkout_session_id', session.id);

    if (txnErr) {
        await logger.error({
            message: '❌ Transaction update failed',
            context: { error: txnErr.message },
            user_id: userId,
        });
        await sendSlackMessage(`❌ Failed to update transaction for Wallet \nUser: ${userId}\nReason: ${txnErr.message}`, 'ERROR');
        return;
    }
    await sendSlackMessage(`✅ Payment successfully received!\nUser: ${userId} (${email})\nContext: wallet_topup\nAmount: $${amount}\nReference ID: ${referenceId}`, 'SUCCESS');

    try {
        // 1. Find or create wallet
        const { data: wallets, error: walletFetchErr } = await db
            .from('wallet')
            .select('*')
            .eq('user_id', userId)
            .single();

        let walletId;

        if (walletFetchErr && walletFetchErr.code !== 'PGRST116') {
            // Unexpected error
            await logger.error({
                message: '❌ Failed to fetch wallet',
                context: { error: walletFetchErr.message },
                user_id: userId,
            });
            await sendSlackMessage(`❌ Wallet fetch failed for user: \`${userId}\`\nError: ${walletFetchErr.message}`, 'ERROR');
            return;
        }

        if (!wallets) {
            // No wallet, create one
            const { data: newWallet, error: walletCreateErr } = await db
                .from('wallet')
                .insert({
                    user_id: userId,
                    balance: amount,
                    last_topped_up_at: new Date(),
                })
                .select()
                .single();

            if (walletCreateErr) {
                await logger.error({
                    message: '❌ Wallet creation failed',
                    context: { error: walletCreateErr.message },
                    user_id: userId,
                });
                await sendSlackMessage(`❌ Wallet creation failed for user: \`${userId}\`\nError: ${walletCreateErr.message}`, 'ERROR');
                return;
            }

            walletId = newWallet.wallet_id;
        } else {
            // Existing wallet, update balance
            walletId = wallets.wallet_id;
            const updatedBalance = parseFloat(wallets.balance) + parseFloat(amount);

            const { error: walletUpdateErr } = await db
                .from('wallet')
                .update({
                    balance: updatedBalance,
                    last_topped_up_at: new Date(),
                })
                .eq('wallet_id', walletId);

            if (walletUpdateErr) {
                await logger.error({
                    message: '❌ Wallet balance update failed',
                    context: { error: walletUpdateErr.message },
                    user_id: userId,
                });
                await sendSlackMessage(`❌ Wallet update failed for user: \`${userId}\`\nError: ${walletUpdateErr.message}`, 'ERROR');
                return;
            }
        }

        // 2. Log transaction in wallet_transactions
        const { error: txnInsertErr } = await db.from('wallet_transactions').insert({
            wallet_id: walletId,
            type: 'credit',
            amount,
            description: 'Stripe wallet top-up',
        });

        if (txnInsertErr) {
            await logger.error({
                message: '❌ Wallet transaction insert failed',
                context: { error: txnInsertErr.message },
                user_id: userId,
            });
            await sendSlackMessage(`⚠️ Wallet balance updated, but failed to insert wallet transaction for \`${userId}\`\nError: ${txnInsertErr.message}`, 'ERROR');
        }
        await logUserActivity(userId, 'Wallet Top-Up Successfuls', { amount: amount });


        // 4. Final success Slack log
        await sendSlackMessage(`💸 Wallet Top-Up Successful\nUser: \`${userId}\` (${email})\nAmount: $${amount}\nPayment Intent: \`${referenceId}\``, 'SUCCESS');
    } catch (err) {
        await logger.error({
            message: '🚨 Wallet top-up webhook failed',
            context: { error: err.message },
            user_id: userId,
        });
        await sendSlackMessage(`🚨 Wallet top-up process failed for \`${userId}\`\nError: ${err.message}`, 'ERROR');
    }
};
const handleMailboxAddon = async (session) => {
    const userId = session.metadata.user_id;
    const numberOfMailboxes = parseInt(session.metadata.numberOfMailboxes);
    const amountInCents = session.amount_total;
    const amount = (amountInCents / 100).toFixed(2);
    const referenceId = session.invoice;
    const email = session.customer_details.email;
    try {
        // ✅ Update transaction status
        const { error: txnErr } = await db
            .from('transaction_history')
            .update({ status: 'succeeded', reference_id: referenceId })
            .eq('checkout_session_id', session.id);

        if (txnErr) {
            await logger.error({
                message: '❌ Transaction update failed',
                context: { error: txnErr.message },
                user_id: userId,
            });
            await sendSlackMessage(
                `❌ Failed to update transaction for Mailbox Add-on\nUser: ${userId}\nReason: ${txnErr.message}`,
                'ERROR'
            );
            return;
        }

        await sendSlackMessage(
            `✅ Payment received!\nUser: ${userId} (${email})\nMailbox Add-on\nMailboxes: ${numberOfMailboxes}\nAmount: $${amount}\nRef: ${referenceId}`,
            'SUCCESS'
        );

        const renewsOn = new Date();
        renewsOn.setMonth(renewsOn.getMonth() + 1);

        const { error: insertSubErr } = await db.from('mailbox_subscription').insert({
            user_id: userId,
            subscription_id: session.subscription,
            status: 'Active',
            billing_date: new Date(),
            renews_on: renewsOn,
            number_of_mailboxes: numberOfMailboxes,
            price_per_mailbox: amount / numberOfMailboxes,
            total_amount: amount,
            number_of_used_mailbox: 0,
            created_at: new Date(),
            updated_at: new Date()

        });

        if (insertSubErr) throw insertSubErr;

        await logUserActivity(userId, 'Mailbox add-on successfull', { mailbox_name: numberOfMailboxes });
        await logger.info({
            message: '📦 Mailbox add-on processed successfully',
            context: { userId, numberOfMailboxes, referenceId },
        });

        await logger.info({
            message: '📦 Mailbox add-on processed',
            context: { userId, numberOfMailboxes, referenceId },
        });
        // insert the order in the orders table with the following data
        const { error: insertOrderErr } = await db.from('orders').insert({
            user_id: userId,
            type: 'gsuite',
            status: 'success',
            amount: amount,
            reference_id: session.subscription,
            renews_on: renewsOn,
            payment_method: 'stripe',
            cupon_code: session.metadata.cupon_code,
            metadata: {
                numberOfMailboxes: numberOfMailboxes,
                price_per_mailbox: amount / numberOfMailboxes,
            }
        });
        if (insertOrderErr) throw insertOrderErr;

        // Slack invite after successful mailbox add-on purchase
        try {
            const purchaseDetailsText = `Thank you for your mailbox add-on purchase!\nMailboxes: ${numberOfMailboxes}\nAmount: $${amount}`;
            await setupClientSlackChannel(email, purchaseDetailsText);
        } catch (err) {
            await logger.error({ message: 'Slack invite failed', context: { error: err.message, email }, user_id: userId });
        }

        await sendSlackMessage(
            `📦 Mailbox add-on processed\nUser: ${email}\nMailboxes: ${numberOfMailboxes}\nRenews on: ${renewsOn.toISOString().split('T')[0]}`,
            'SUCCESS'
        );

    } catch (err) {
        await logger.error({
            message: '❌ Mailbox add-on processing failed',
            context: { error: err.message, sessionId: session.id },
        });
        await sendSlackMessage(`❌ Mailbox add-on failed: ${err.message}`, 'ERROR');
    }
};
const handlePreWarmMailbox = async (session) => {
    const userId = session.metadata.user_id;
    const emailListId = session.metadata.emailListId;
    const { data: emailData, error } = await db
        .from('tem_prewarm_selected_mailboxes')
        .select('emails')
        .eq('id', emailListId)
        .maybeSingle();

    if (error || !emailData) {
        logger.error('Error retrieving email list:', error);
        return;
    }

    const selectedMailboxes = emailData.emails;
    const numberOfMailboxes = session.metadata.numberOfMailboxes;
    const amountInCents = session.amount_total;
    const amount = (amountInCents / 100).toFixed(2);
    const referenceId = session.invoice;
    const email = session.customer_details.email;

    try {
        // Update transaction history
        const { error: txnErr } = await db
            .from('transaction_history')
            .update({ status: 'succeeded', reference_id: referenceId })
            .eq('checkout_session_id', session.id);

        if (txnErr) {
            await logger.error({ message: '❌ Transaction update failed', context: { error: txnErr.message }, user_id: userId });
            await sendSlackMessage(`❌ Failed to update transaction for Pre-Warm Mailbox\nUser: ${userId}\nReason: ${txnErr.message}`, 'ERROR');
            return;
        }

        await sendSlackMessage(`✅ Payment received!\nUser: ${userId} (${email})\nPre-Warm Mailbox\nMailboxes: ${numberOfMailboxes}\nAmount: $${amount}\nRef: ${referenceId}`, 'SUCCESS');

        const renewsOn = new Date();
        renewsOn.setMonth(renewsOn.getMonth() + 1);

        const { error: insertErr } = await db.from('mailbox_subscription').insert({
            user_id: userId,
            subscription_id: session.subscription,
            status: 'Active',
            mailbox_type: 'Pre-Warmed',
            billing_date: new Date(),
            renews_on: renewsOn,
            number_of_mailboxes: numberOfMailboxes,
            price_per_mailbox: amount / numberOfMailboxes,
            total_amount: amount,
            number_of_used_mailbox: 0,
            created_at: new Date(),
            updated_at: new Date()
        });
        if (insertErr) throw insertErr;
        // --- START DELETION SECTION ---

        const failedAccounts = [];
        let successCount = 0;

        for (const email of selectedMailboxes) {
            const { error: prewarmErr } = await db
                .from('prewarm_mailboxes')
                .update({
                    status: 'Active',
                    user_id: userId,
                    subscription_id: session.subscription,
                    updated_at: new Date(),
                })
                .eq('email', email);

            if (prewarmErr) {
                failedAccounts.push({ email, reason: `Prewarm update failed: ${prewarmErr.message}` });
                continue;
            }

            try {
                const response = await axios.delete(`https://api.instantly.ai/api/v2/accounts/${email}`, {
                    headers: { Authorization: process.env.INSTANTLY_API }
                });

                if (response.status === 200) {
                    successCount++;
                } else {
                    failedAccounts.push({ email, reason: `Unexpected status code: ${response.status}` });
                }

            } catch (err) {
                if (err.response) {
                    await logger.error({ message: '❌ Pre-Warm Mailbox processing failed', context: { error: err.response }, user_id: userId });
                    const status = err.response.status;
                    let reason = `HTTP ${status}`;
                    if (status === 404) reason = 'Account not found (404)';
                    else if (status === 401) reason = 'Unauthorized (401)';
                    else if (err.response.data?.message) reason = err.response.data.message;

                    failedAccounts.push({ email, reason });
                } else {
                    failedAccounts.push({ email, reason: `Axios error: ${err.message}` });
                }
            }
        }

        // insert new order in the orders table with the following data
        const { error: insertOrderErr } = await db.from('orders').insert({
            user_id: userId,
            type: 'prewarm',
            status: 'success',
            amount: amount,
            reference_id: session.subscription,
            renews_on: renewsOn,
            payment_method: 'stripe',
            cupon_code: session.metadata.cupon_code,
            metadata: {
                numberOfMailboxes: numberOfMailboxes,
                selectedMailboxes: selectedMailboxes,
                price_per_mailbox: amount / numberOfMailboxes,
            }
        });

        if (insertOrderErr) throw insertOrderErr;

        // Slack invite after successful prewarm mailbox purchase
        try {
            const purchaseDetailsText = `Thank you for your pre-warmed mailbox purchase!\nMailboxes: ${numberOfMailboxes}\nAmount: $${amount}`;
            await setupClientSlackChannel(email, purchaseDetailsText);
        } catch (err) {
            await logger.error({ message: 'Slack invite failed', context: { error: err.message, email }, user_id: userId });
        }

        // --- FINAL SUMMARY ---

        const failedCount = failedAccounts.length;

        const summary = `✅ Pre-Warm Mailbox processed\nUser: ${userId}\nTotal: ${selectedMailboxes.length}\nSuccess: ${successCount}\nFailed: ${failedCount}`;
        await sendSlackMessage(summary, failedCount === 0 ? 'SUCCESS' : 'ERROR');

        if (failedCount > 0) {
            const detailedFailures = failedAccounts
                .map(({ email, reason }) => `• ${email} → ${reason}`)
                .join('\n');

            await sendSlackMessage(`❌ Failed Instantly Account Deletions:\n${detailedFailures}`, 'ERROR');
        }


    } catch (err) {
        await logger.error({
            message: '❌ Pre-Warm Mailbox processing failed',
            context: { error: err.message, sessionId: session.id },
        });
        await sendSlackMessage(`❌ Pre-Warm Mailbox failed: ${err.message}`, 'ERROR');
    }
};
const handleSubscription = async (session) => {
    const userId = session.metadata.user_id;
    const email = session.customer_details.email;
    const priceId = session.metadata.plan_id;
    const amount = (session.amount_total / 100).toFixed(2);
    const referenceId = session.invoice;
    const now = new Date();

    await db.from('transaction_history')
        .update({ status: 'succeeded', reference_id: referenceId })
        .eq('checkout_session_id', session.id);

    const { data: planData, error: planErr } = await db
        .from('plans')
        .select('*')
        .eq('id', priceId)
        .single();

    if (planErr || !planData) {
        await sendSlackMessage(`❌ Plan not found for ${priceId}`, 'ERROR');
        return;
    }

    const renewDate = new Date(now);
    renewDate.setDate(now.getDate() + planData.duration);
    const pricePerMailbox = planData.price_monthly / planData.included_mailboxes;
    console.log(pricePerMailbox);
    const subscriptionPayload = {
        subscription_id: session.subscription,
        plan_id: planData.id,
        status: 'Active',
        billing_date: now.toISOString(),
        renews_on: renewDate.toISOString(),
        mailboxes_total: planData.included_mailboxes,
        price_per_mailbox: pricePerMailbox,
        total_amount: amount,
        payment_method: 'stripe',
        subscription_type: 'normal'
    };

    await applySubscription(userId, subscriptionPayload);
    await logUserActivity(userId, 'Subscription activated', { plan_name: planData.name });
    await sendSlackMessage(`🎉 Subscription activated for ${email}, $${amount} ${planData.name} `, 'SUCCESS');

};
const handleSubscriptionUpdate = async (subscription) => {
    const { id: subscriptionId, status, cancel_at_period_end, current_period_end, current_period_start } = subscription;

    const { data: subscriptionData, error: subscriptionErr } = await db
        .from('mailbox_subscription')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .single();

    if (subscriptionErr || !subscriptionData) {
        await logger.error('Failed to fetch subscription data', subscriptionErr || 'No data found');
        return;
    }

    const { user_id: userId, number_of_mailboxes, mailbox_type, status: currentStatus, renews_on } = subscriptionData;

    const { data: userData, error: userErr } = await db
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

    if (userErr || !userData) {
        await logger.error('Failed to fetch user email', userErr || 'No user found');
        return;
    }

    const email = userData.email;

    // ---------- Cancel at Period End ----------
    if (cancel_at_period_end && currentStatus !== 'Cancel at Period End') {
        const { error: updateErr } = await db
            .from('mailbox_subscription')
            .update({ status: 'Cancel at Period End' })
            .eq('subscription_id', subscriptionId);

        if (updateErr) {
            await logger.error('Failed to update subscription status to Cancel at Period End', updateErr);
            await sendSlackMessage(`❌ DB update failed for subscription: ${subscriptionId}`, 'ERROR');
            return;
        }

        await sendSlackMessage(
            `🟡 ${mailbox_type} subscription set to cancel at period end: ${subscriptionId} (User: ${email}) with ${number_of_mailboxes} mailboxes. Ends on: ${new Date(current_period_end * 1000).toLocaleString()}`,
            'INFO'
        );
        return;
    }

    const newRenewalDate = new Date();
    newRenewalDate.setMonth(newRenewalDate.getMonth() + 1);
    // ---------- Subscription Renewed ----------
    if (!cancel_at_period_end && currentStatus === 'Cancel at Period End') {
        const { error: updateErr } = await db
            .from('mailbox_subscription')
            .update({ status: 'Active', renews_on: newRenewalDate })
            .eq('subscription_id', subscriptionId);

        if (updateErr) {
            await logger.error('Failed to mark subscription as renewed', updateErr);
            await sendSlackMessage(`❌ Failed to reset Cancel at Period End for ${subscriptionId}`, 'ERROR');
            return;
        }

        await sendSlackMessage(
            `✅ Subscription renewed: ${subscriptionId} (User: ${email}) `,
            'INFO'
        );
        return;
    }
    await logger.info(`ℹ️ Subscription update processed for ${subscriptionId}`, { subscriptionStatus: status });
};
const handleSubscriptionCancel = async (subscription) => {
    const { id } = subscription;
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
            message: '❌ Subscription cancel update failed',
            context: { error: updateErr.message },
            user_id: userId,
        });
        await sendSlackMessage(`❌ Failed to update subscription status for ${id}`, 'ERROR');
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
        await sendSlackMessage(` ✅ Gsuite Subscription canceled successfully : ${id} for user ${userId}|| ${email} and ${mailboxes.length} mailboxes updated to inactive || ${mailboxes.map(mailbox => mailbox.email)}`, 'INFO');

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
    }
};
const handlePaymentSuccess = async (invoice) => {
    const userId = invoice.metadata?.user_id;
    await sendSlackMessage(`💰 Payment succeeded for invoice: ${invoice.id}, user: ${userId}`, 'SUCCESS');
};
const handlePaymentFailed = async (invoice) => {
    const userId = invoice.metadata?.user_id;
    await sendSlackMessage(`⚠️ Payment failed for invoice: ${invoice.id}, user: ${userId}`, 'ERROR');
};

const handleInvoicePaymentSucceeded = async (invoice) => {
    try {
        console.log('Processing invoice payment succeeded:', invoice.id);

        // Get the subscription from the invoice
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) {
            await logger.warn({
                message: '⚠️ Invoice has no subscription',
                context: { invoice_id: invoice.id }
            });
            return;
        }

        // Get subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const nextPeriodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null;
        let nextRenewalIso = nextPeriodEnd ? nextPeriodEnd.toISOString() : null;
        let displayNextRenewalDate = nextRenewalIso ? nextRenewalIso.split('T')[0] : null;
        if (!displayNextRenewalDate) {
            const invoicePeriodEnd = invoice?.lines?.data?.[0]?.period?.end;
            if (invoicePeriodEnd) {
                const invoiceEndIso = new Date(invoicePeriodEnd * 1000).toISOString();
                nextRenewalIso = nextRenewalIso || invoiceEndIso;
                displayNextRenewalDate = invoiceEndIso.split('T')[0];
            }
        }
        if (!displayNextRenewalDate) {
            const currentStart = subscription.current_period_start
                ? new Date(subscription.current_period_start * 1000)
                : new Date();
            const priceItem = subscription.items?.data?.[0]?.price;
            const interval = priceItem?.recurring?.interval;
            const intervalCount = priceItem?.recurring?.interval_count || 1;
            const computed = new Date(currentStart.getTime());
            if (interval === 'day') {
                computed.setDate(computed.getDate() + intervalCount);
            } else if (interval === 'week') {
                computed.setDate(computed.getDate() + 7 * intervalCount);
            } else if (interval === 'month') {
                computed.setMonth(computed.getMonth() + intervalCount);
            } else if (interval === 'year') {
                computed.setFullYear(computed.getFullYear() + intervalCount);
            }
            nextRenewalIso = nextRenewalIso || computed.toISOString();
            displayNextRenewalDate = computed.toISOString().split('T')[0];
        }
        const customerId = subscription.customer;

        // Get user from stripe_customers table
        const { data: customerData, error: customerError } = await db
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single();

        if (customerError || !customerData) {
            await logger.error({
                message: '❌ Customer not found for invoice payment',
                context: { customer_id: customerId, invoice_id: invoice.id }
            });
            return;
        }

        const userId = customerData.user_id;
        const priceId = subscription.items.data[0].price.id;

        // before check a plan that subscription is exists in gsuite_subscriptions table if not that is addon subscription
        const { data: gsuiteSubscription, error: gsuiteSubscriptionError } = await db
            .from('gsuite_subscriptions')
            .select('*')
            .eq('subscription_id', subscriptionId)
            .maybeSingle();
        if (gsuiteSubscriptionError) {
            await logger.error('Failed to query gsuite_subscriptions for subscription', gsuiteSubscriptionError);
        }
        if (gsuiteSubscription) {
            await logger.info('the subscription is exists in the gsuite_subscriptions table', gsuiteSubscription);
            // Get plan details from plans table based on price ID
            const { data: plan, error: planError } = await db
                .from('plans')
                .select('*')
                .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
                .single();

            if (planError || !plan) {
                await logger.error({
                    message: '❌ Plan not found for price ID',
                    context: { price_id: priceId, invoice_id: invoice.id }
                });
                return;
            }
            // update the gsuite_subscriptions table with the plan_id, mailboxes_total, status, renews_on, updated_at
            const { error: updateGsuiteError } = await db
                .from('gsuite_subscriptions')
                .update({
                    renews_on: nextRenewalIso,
                })
                .eq('subscription_id', subscriptionId);
            if (updateGsuiteError) {
                await logger.error('update the gsuite_subscriptions table with the plan_id, mailboxes_total, status, renews_on, updated_at failed', updateGsuiteError);
                return;
            }
            // update the mailbox_subscription table with the number_of_mailboxes, price_per_mailbox, total_amount, status, renews_on, updated_at
            const { error: updateMailboxError } = await db
                .from('mailbox_subscription')
                .update({
                    renews_on: nextRenewalIso,
                })
                .eq('subscription_id', subscriptionId);
            if (updateMailboxError) {
                await logger.error('update the mailbox_subscription table with the number_of_mailboxes, price_per_mailbox, total_amount, status, renews_on, updated_at failed', updateMailboxError);
                return;
            }
            // try to update next renewal date in Stripe (metadata)
            try {
                const existingMetadata = subscription.metadata || {};
                const nextRenewalForMetadata = displayNextRenewalDate || null;
                await stripe.subscriptions.update(subscriptionId, {
                    metadata: {
                        ...existingMetadata,
                        next_renewal_date: nextRenewalForMetadata || ''
                    }
                });
            } catch (stripeMetaErr) {
                await logger.warn({
                    message: '⚠️ Failed to update Stripe subscription metadata with next renewal date',
                    context: { error: stripeMetaErr.message, subscription_id: subscriptionId }
                });
            }
            // log success
            await logger.info({
                message: '✅ Invoice payment processed successfully',
                context: {
                    invoice_id: invoice.id,
                    subscription_id: subscriptionId,
                    plan_name: plan.name,
                    amount: invoice.amount_paid,
                    next_renewal: nextRenewalIso
                },
                user_id: userId
            });

            // Send Slack notification
            await sendSlackMessage(
                `🔄 Subscription renewed\nUser: ${userId}\nPlan: ${plan.name}\nAmount: $${(invoice.amount_paid / 100).toFixed(2)}\nSubscription: ${subscriptionId}\nNext renewal: ${displayNextRenewalDate || 'N/A'}`,
                'SUCCESS'
            );
        } else {
            // Addon subscription: no plan id; just update mailbox_subscription
            const { error: updateAddonError } = await db
                .from('mailbox_subscription')
                .update({
                    status: 'Active',
                    renews_on: nextRenewalIso,
                })
                .eq('subscription_id', subscriptionId);

            if (updateAddonError) {
                await logger.error('Failed to update mailbox_subscription for addon renewal', updateAddonError);
            }

            // Update Stripe metadata with next renewal date
            try {
                const existingMetadata = subscription.metadata || {};
                const nextRenewalForMetadata = displayNextRenewalDate || null;
                await stripe.subscriptions.update(subscriptionId, {
                    metadata: {
                        ...existingMetadata,
                        next_renewal_date: nextRenewalForMetadata || ''
                    }
                });
            } catch (stripeMetaErr) {
                await logger.warn({
                    message: '⚠️ Failed to update Stripe subscription metadata with next renewal date (addon)',
                    context: { error: stripeMetaErr.message, subscription_id: subscriptionId }
                });
            }

            await logger.info({
                message: '✅ Addon subscription renewal processed',
                context: {
                    invoice_id: invoice.id,
                    subscription_id: subscriptionId,
                    next_renewal: nextRenewalIso
                },
                user_id: userId
            });

            await sendSlackMessage(
                `🔄 Addon subscription renewed\nUser: ${userId}\nSubscription: ${subscriptionId}\nNext renewal: ${displayNextRenewalDate || 'N/A'}`,
                'SUCCESS'
            );
        }

    } catch (error) {
        await logger.error({
            message: '❌ Error processing invoice payment',
            context: { error: error.message, invoice_id: invoice?.id }
        });
        await sendSlackMessage(
            `❌ Error processing invoice payment ${invoice.id}: ${error.message}`,
            'ERROR'
        );
    }
};


module.exports = {
    handleDomainPurchase,
    handlePreWarmMailbox,
    handleWalletTopUp,
    handleMailboxAddon,
    handleSubscription,
    handleSubscriptionCancel,
    handlePaymentSuccess,
    handlePaymentFailed,
    handleSubscriptionUpdate,
    handleInvoicePaymentSucceeded
};

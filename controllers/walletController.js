const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const namecheapService = require('../services/namecheapService');
const { sendSlackMessage } = require('../config/slackConfig')
const { logUserActivity } = require('../utils/userRecentActivityLogger');
const { v4: uuidv4 } = require('uuid');

exports.getWallet = async (req, res) => {
    try {
        const userId = req.user.id;  // Assuming user is attached to request after auth middleware

        // Fetch wallet details
        const { data: wallet, error: walletErr } = await db
            .from('wallet')
            .select('wallet_id, balance, auto_topup')
            .eq('user_id', userId)
            .single();

        if (walletErr) {
            await logger.error({
                message: '❌ Error fetching wallet data',
                context: { error: walletErr.message },
                user_id: userId,
            });
            return res.status(500).json({ message: 'Error fetching wallet data' });
        }

        if (!wallet) {
            return res.status(404).json({ message: 'Wallet not found' });
        }
        // Fetch wallet transactions
        const { data: transactions, error: txnErr } = await db
            .from('wallet_transactions')
            .select('transaction_id, amount, type, txn_time, description') // Use txn_time, not txn_timeasdate
            .eq('wallet_id', wallet.wallet_id);


        if (txnErr) {
            console.error('Error fetching wallet:', txnErr);

            await logger.error({
                message: '❌ Error fetching wallet transactions',
                context: { error: txnErr.message },
                user_id: userId,
            });
            return res.status(500).json({ message: 'Error fetching 09[] transactions' });
        }
        // Structure the response
        const response = {
            balance: wallet.balance,
            autoTopup: wallet.auto_topup,
            transactions: transactions.map(txn => ({
                id: txn.id,
                amount: txn.amount,
                type: txn.type,
                date: txn.txn_time,
                description: txn.description
            }))
        };

        // Send the response
        res.status(200).json(response);
    } catch (error) {
        await logger.error({
            message: '❌ Error in getWallet controller',
            context: { error: error.message },
            user_id: req.user.id,
        });
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.domainPurchase = async (req, res) => {
    const { domains } = req.body;
    const userId = req.user.id;

    const { data: userData, error: userErr } = await db.from('users').select('email').eq('id', userId).single();
    if (userErr) {
        await logger.error('get the email of the user failed', userErr);
        return;
    }
    const email = userData.email;

    const { data: wallet, error: walletErr } = await db
        .from('wallet')
        .select('wallet_id, balance, auto_topup')
        .eq('user_id', userId)
        .single();

    if (walletErr) {
        await logger.error({
            message: '❌ Error fetching wallet data',
            context: { error: walletErr.message },
            user_id: userId,
        });
    }
    if (wallet.balance < domains.reduce((acc, domain) => acc + domain.price / 100, 0)) {
        return res.status(400).json({ message: 'Insufficient balance' });
    }
    //update the wallet balance
    const { data: updatedWallet, error: updateErr } = await db
        .from('wallet')
        .update({ balance: wallet.balance - domains.reduce((acc, domain) => acc + domain.price / 100, 0) })
        .eq('wallet_id', wallet.wallet_id);

    sendSlackMessage(`💰 Wallet debit for domain purchase user: ${email} || old balance: ${wallet.balance} || new balance:${wallet.balance - domains.reduce((acc, domain) => acc + domain.price / 100, 0)}`, 'INFO');
    if (updateErr) {
        await logger.error({
            message: '❌ Error updating wallet data',
            context: { error: updateErr.message },
            user_id: userId,
        });
    }
    //create a new wallet_transactions
    const { data: walletTransactions, error: walletTransactionsErr } = await db
        .from('wallet_transactions')
        .insert({
            wallet_id: wallet.wallet_id,
            type: 'debit',
            amount: domains.reduce((acc, domain) => acc + domain.price / 100, 0),
            description: `Purchased ${domains.length} domains`,
            txn_time: new Date().toISOString(),
        });

    if (walletTransactionsErr) {
        await logger.error({
            message: '❌ Error creating wallet transactions',
            context: { error: walletTransactionsErr.message },
            user_id: userId,
        });
        return res.status(500).json({ message: 'Error creating wallet transactions' });
    }
    const checkoutSessionId = `wald_${uuidv4()}`;
    //create a new transaction_history
    const { data: transactionHistory, error: transactionHistoryErr } = await db
        .from('transaction_history')
        .insert({
            user_id: userId,
            type: 'domain_purchase',
            amount: domains.reduce((acc, domain) => acc + domain.price, 0),
            currency: 'USD',
            status: 'succeeded',
            payment_provider: 'wallet',
            description: `Domain purchase: ${domains.map(d => d.domain).join(', ')}`,
            checkout_session_id: checkoutSessionId
        });
    if (transactionHistoryErr) {
        await logger.error({
            message: '❌ Error creating transaction history',
            context: { error: transactionHistoryErr.message },
            user_id: userId,
        });
        return res.status(500).json({ message: 'Error creating transaction history' });
    }

    //insert order in orders table
    const { error: insertOrderErr } = await db.from('orders').insert({
        user_id: userId,
        type: 'domain',
        status: 'success',
        amount: domains.reduce((acc, domain) => acc + domain.price / 100, 0),
        reference_id: checkoutSessionId,
        payment_method: 'wallet',
        renews_on: new Date(new Date().setFullYear(new Date().getFullYear() + parseInt(domains.map(d => d.year).join(', ')))),
        metadata: {
            domain_name: domains.map(d => d.domain).join(', '),
            years: domains.map(d => d.year).join(', '),
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
        metadata: { domain_name: domains.map(d => d.domain).join(', '), years: domains.map(d => d.year).join(', '), amount: domains.reduce((acc, domain) => acc + domain.price / 100, 0), reference_id: checkoutSessionId },
    });
    if (insertJobErr) {
        await logger.error({
            message: '❌ Job insertion failed',
            context: { error: insertJobErr.message },
            user_id: userId,
        });
    }

    //create a new domain
    try {
        const results = await Promise.allSettled(
            domains.map(d => namecheapService.purchaseDomain(d.year, d.domain))
        );

        for (let i = 0; i < domains.length; i++) {
            const { domain, year: currentYear } = domains[i];
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
        const domainName = domains.map(d => d.domain).join(', ');
        await sendSlackMessage(`🚨 Exception while purchasing domain \`${domainName}\`\nUser: ${userId} (${email})\nError: ${err.message}`, 'ERROR');
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    const url = `${frontendUrl}/payment-success?session_id=${checkoutSessionId}`

    return res.json({ url });
};

exports.cancelSubscription = async (req, res) => {

    const { wallet_subscription_id } = req.body;
    // get the number of mailboxes in the subscription
    const { data: subscriptionData, error: subscriptionErr } = await db
        .from('mailbox_subscription')
        .select('*')
        .eq('subscription_id', wallet_subscription_id)
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
}
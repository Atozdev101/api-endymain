const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const {sendSlackMessage} = require('../config/slackConfig')
const stripe = require('../config/stripeConfig');
const { logUserActivity } = require('../utils/userRecentActivityLogger');
const { v4: uuidv4 } = require('uuid');
const { getCurrencyByCountry, getAmountByCurrency, getAmountInSmallestUnit, formatAmountForDisplay } = require('../utils/currencyHelper');

exports.getAvailablePreWarmedMailboxes = async (req, res) => {
  try {
    // get the user_id from the request
    const user_id = req.user.id;

    // get the email id by user_id
    const { data: emailData, error: emailDataErr } = await db
      .from('users')
      .select('email')
      .eq('id', user_id)
      .single();

    if (emailDataErr) {
      await logger.error({
        message: '❌ Failed to get email id',
        context: { error: emailDataErr.message },
      });
    }

    const email = emailData.email;

    // get the price_email and price from specific_user_price table
    const { data: specificUserPrice, error: specificUserPriceErr } = await db
      .from('specific_user_price')
      .select('email,price')
      .eq('email', email)
      .eq('product',"prewarm")
      .single();

    if (specificUserPriceErr) {
      await logger.error({
        message: '❌ Failed to get specific user price',
        context: { error: specificUserPriceErr.message },
      });
    }

    const price_email = specificUserPrice?.email;
    const newPrice = specificUserPrice?.price;

    // get only required fields and manually extract domain and username
    const { data: availableMailboxes, error: availableMailboxesErr } = await db
      .from('prewarm_mailboxes')
      .select('email,first_name,last_name,price,status')
      .eq('status', 'Ready For Sale');

    if (availableMailboxesErr) {
      await logger.error({
        message: '❌ Failed to get available pre-warmed mailboxes',
        context: { error: availableMailboxesErr.message },
      });
    }

    // log for debugging
    console.log(email, price_email, newPrice);

    // iterate over results and enrich with domain and username
    const enrichedMailboxes = availableMailboxes.map(mailbox => {
      const [username, domain] = mailbox.email.split('@');
      return {
        ...mailbox,
        username,
        domain,
        price: (email === price_email && newPrice !== 0) ? newPrice : mailbox.price,
      };
    });

    return res.status(200).json({ data: enrichedMailboxes });

  } catch (err) {
    console.log(err);
    await logger.error({
      message: '❌ Failed to get available pre-warmed mailboxes',
      context: { error: err.message },
    });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.getUserPreWarmedMailboxes = async (req, res) => {
  const user_id = req.user.id;
  try {
    const { data: activeMailboxes, error: activeMailboxesErr } = await db
      .from('prewarm_mailboxes')
      .select('*') // keeping * for now in case other fields are still needed
      .eq('user_id', user_id)
      .neq('status', 'Ready For Sale');

    if (activeMailboxesErr) {
      await logger.error({
        message: '❌ Failed to get pre-warmed mailboxes',
        context: { error: activeMailboxesErr.message },
      });
      return res.status(500).json({ error: 'Failed to get pre-warmed mailboxes' });
    }

    // Calculate mailboxes from mailbox_subscription table for Pre-Warmed type
    const { data: subscriptions, error: subscriptionError } = await db
      .from('mailbox_subscription')
      .select('number_of_mailboxes, number_of_used_mailbox')
      .eq('user_id', user_id)
      .eq('mailbox_type', 'Pre-Warmed')
      .in('status', ['Active', 'Cancel at Period End']);

    if (subscriptionError) {
      await logger.error({
        message: '❌ Failed to get mailboxes from mailbox_subscription table',
        context: { error: subscriptionError.message },
      });
    }

    // Calculate total and used mailboxes from subscriptions
    const mailboxes_total = (subscriptions || []).reduce((total, sub) => total + (sub.number_of_mailboxes || 0), 0);
    const mailboxes_used = (subscriptions || []).reduce((total, sub) => total + (sub.number_of_used_mailbox || 0), 0);

    // Add renews_on, username, and domain to each mailbox
    const mailboxesWithRenewal = await Promise.all(
      activeMailboxes.map(async (mailbox) => {
        let renews_on = null;
        if (mailbox.subscription_id) {
          const { data: subscriptionData, error: subscriptionErr } = await db
            .from('mailbox_subscription')
            .select('renews_on')
            .eq('subscription_id', mailbox.subscription_id)
            .single();

          if (subscriptionErr) {
            await logger.warn({
              message: `⚠️ Failed to fetch renews_on for subscription_id ${mailbox.subscription_id}`,
              context: { error: subscriptionErr.message },
            });
          }

          renews_on = subscriptionData?.renews_on || null;
        }

        // Extract username and domain from email
        const [username, domain] = mailbox.email?.split('@') || [null, null];

        return {
          ...mailbox,
          renews_on,
          username,
          domain,
        };
      })
    );

    const formattedData = {
      mailboxes: mailboxesWithRenewal,
      mailboxes_total: mailboxes_total,
      mailboxes_used: mailboxes_used,
    };

    return res.status(200).json({ data: formattedData });

  } catch (err) {
    await logger.error({
      message: '❌ Failed to get pre-warmed mailboxes',
      context: { error: err.message },
    });
    return res.status(500).json({ error: 'Failed to get pre-warmed mailboxes' });
  }
};

exports.exportOtherPlatforms = async (req, res) => {
    const user_id = req.user.id;
    const { platform, email, password, platformUrl, workspace, notes ,mailboxIds } = req.body;
    console.log(req.body);
    try {
        // sendslack message to the user with the following message: with all the details  platform, email, password, platformUrl, workspace, notes
        await sendSlackMessage(`
        User ${user_id} export the pre-warmed mailboxes to other platforms
        Platform: ${platform}
        Email: ${email}
        Password: ${password}
        Platform URL: ${platformUrl}
        Workspace: ${workspace}
        Notes: ${notes}`, 'SUCCESS');

        if(mailboxIds.length > 0){
          // update the status to pending in prewarm_mailboxes table for each email in the array
          const { error: updatePwMailboxStatusErr } = await db.from('prewarm_mailboxes').update({ status: 'Pending' }).in('id', mailboxIds);
          if (updatePwMailboxStatusErr) {
              await logger.error({
                  message: '❌ Failed to update prewarm_mailboxes table',
                  context: { error: updatePwMailboxStatusErr.message },
              });
          }
        } else {
          // update the status to pending in prewarm_mailboxes table for all mailboxes under the user_id
          const { error: updatePwMailboxStatusErr } = await db.from('prewarm_mailboxes').update({ status: 'Pending' }).eq('user_id', user_id);
          if (updatePwMailboxStatusErr) {
            await sendSlackMessage(`🚨 Error in exportOtherPlatforms Updating Data: ${updatePwMailboxStatusErr.message}`, 'ERROR');
            await logger.error({
                message: '❌ Failed to update prewarm_mailboxes table',
                context: { error: updatePwMailboxStatusErr.message },
            });
          }
        }
        const exportId = uuidv4();
        // insert the data into the prewarm_mailbox_exports table id uuid primary key default gen_random_uuid(),
        const { error: insertPwMailboxExportsErr } = await db.from('prewarm_mailbox_exports').insert([
            {
                id: exportId,
                user_id: user_id,
                platform: platform,
                email: email,
                password: password,
                platform_url: platformUrl,
                workspace: workspace,
                notes: notes,
                exported_at: new Date(),
                status: 'Pending'
            }
        ]);

        if (insertPwMailboxExportsErr) {
          await sendSlackMessage(`🚨 Error in exportOtherPlatforms Inserting Data: ${insertPwMailboxExportsErr.message}`, 'ERROR');
            await logger.error({
                message: '❌ Failed to insert data into prewarm_mailbox_exports table',
                context: { error: insertPwMailboxExportsErr.message },
            });
        }
        if(mailboxIds.length > 0){
        // update the exportId in the prewarm_mailboxes table for each selectedMailboxes in the array
        const { error: updatePwMailboxExportIdErr } = await db.from('prewarm_mailboxes').update({ export_id: exportId }).in('id', mailboxIds);
        if (updatePwMailboxExportIdErr) {
          await sendSlackMessage(`🚨 Error in exportOtherPlatforms Updating Data: ${updatePwMailboxExportIdErr.message}`, 'ERROR');
            await logger.error({

                message: '❌ Failed to update prewarm_mailboxes table',
                context: { error: updatePwMailboxExportIdErr.message },
            });
        }
        } else {
          // update the exportId in the prewarm_mailboxes table for all mailboxes under the user_id
          const { error: updatePwMailboxExportIdErr } = await db.from('prewarm_mailboxes').update({ export_id: exportId }).eq('user_id', user_id);
          if (updatePwMailboxExportIdErr) {
            await sendSlackMessage(`🚨 Error in exportOtherPlatforms Updating Data: ${updatePwMailboxExportIdErr.message}`, 'ERROR');
          }
        }
      
        // insert the job in the jobs table with the following data
        const { error: insertJobErr } = await db.from('jobs').insert({
          user_id: user_id,
          job_type: 'export',
          order_type: 'prewarm',
          status: 'new',
          metadata: {
            exportId: exportId,
            platform: platform,
            email: email,
            password: password,
            platformUrl: platformUrl,
            workspace: workspace,
            notes: notes,
            exported_at: new Date(),
            mailboxes: await Promise.all(mailboxIds.map(async (mailboxId) => {
              const { data: mailboxData, error: mailboxDataErr } = await db.from('prewarm_mailboxes').select('email').eq('id', mailboxId).single();
              if (mailboxDataErr) {
                await logger.error({
                  message: '❌ Failed to get email from prewarm_mailboxes table',
                  context: { error: mailboxDataErr.message },
                });
              }
              return mailboxData.email;
            })),
          }
        });
        if (insertJobErr) {
          await sendSlackMessage(`🚨 Error in exportOtherPlatforms Inserting Data: ${insertJobErr.message}`, 'ERROR');
          await logger.error({
            message: '❌ Failed to insert data into jobs table',
            context: { error: insertJobErr.message },
          });
        }

        return res.status(200).json({ message: 'Pre-warmed mailboxes exported to other platforms successfully' });
    } catch (err) {
      await sendSlackMessage(`🚨 Error in exportOtherPlatforms: ${err.message}`, 'ERROR');
        await logger.error({
            message: '❌ Failed to export pre-warmed mailboxes to other platforms',
            context: { error: err.message },
        });
        return res.status(500).json({ error: 'Failed to export pre-warmed mailboxes to other platforms' });
    }
}

exports.purchaseDomainBasedPreWarmMailbox = async (req, res) => {
    const userId = req.user.id;
    //{emails: []}
          // get the email id and country by user_id
          const { data: userData, error: userDataErr } = await db.from('users').select('email, country').eq('id', userId).single();
          if (userDataErr) {
            await logger.error({
              message: '❌ Failed to get user data',
              context: { error: userDataErr.message },
            });
          }
          const email = userData.email;
          
          // Determine currency based on user's country (INR for India, USD for others)
          const currency = getCurrencyByCountry(userData?.country);
          
    const { selectedMailboxes, promo_code } = req.body;
    if (!selectedMailboxes || selectedMailboxes.length <= 0) {
      return res.status(400).json({ error: 'Valid number of mailboxes required' });
    }
    const { data: pwMailboxes, error: pwMailboxesErr } = await db.from('prewarm_mailboxes').select('*').in('email', selectedMailboxes).eq('status', 'Ready For Sale');
    if (pwMailboxesErr) {
      return res.status(400).json({ error: 'Invalid selected mailboxes' });
    }
    if (pwMailboxes.length !== selectedMailboxes.length) {
      return res.status(400).json({ error: 'Invalid selected mailboxes' }); 
    }
      //get the price_email and price from specific_user_price table
      const {data: specificUserPrice, error: specificUserPriceErr} = await db.from('specific_user_price').select('email,price').eq('email', email).eq('product',"prewarm").single();
      if(specificUserPriceErr){
        await logger.error({
          message: '❌ Failed to get specific user price',
          context: { error: specificUserPriceErr.message },
        });
      }
      const price_email = specificUserPrice?.email;
      const newPrice = specificUserPrice?.price;

    if(email == price_email && newPrice != 0){
      pwMailboxes.forEach(mailbox => {
        mailbox.price = newPrice;
      });
    }
    // Total price in USD
    const totalPriceUsd = pwMailboxes.reduce((acc, mailbox) => acc + mailbox.price, 0);
    
    // Convert to appropriate currency
    const totalPrice = getAmountByCurrency(totalPriceUsd, currency);
    const totalAmountSmallestUnit = getAmountInSmallestUnit(totalPrice, currency);
    const priceDisplay = formatAmountForDisplay(totalPrice, currency);

    const numberOfMailboxes = pwMailboxes.length;
    var emailListId = uuidv4();

    const { error: insertError } = await db
      .from('tem_prewarm_selected_mailboxes')
      .insert([
        {
          id: emailListId,
          user_id: userId,
          emails: selectedMailboxes
        }
      ]);
    
      if (insertError) {
        logger.error('Error saving selected mailboxes:', insertError);
        return res.status(500).json({ error: 'Internal Error Saving Mailboxes' });
      }
    
  
    let product = null;
    let price = null;
    try {
      const { data: customerData } = await db
        .from('stripe_customers')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .maybeSingle();
      let customerId = customerData?.stripe_customer_id;
      //check if the customer is already created
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
      product = await stripe.products.create({ name: 'Pre-Warmed Mailbox' });
      price = await stripe.prices.create({
        unit_amount: totalAmountSmallestUnit,
        currency: currency,
        recurring: { interval: 'month' },
        product: product.id
      });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
      var promotionCodeId;
      if (promo_code) {
        const promo = await stripe.promotionCodes.list({
          code: promo_code,
          active: true,
          limit: 1,
        });
        promotionCodeId = promo.data[0]?.id;
      }
      
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [
          {
            price: price.id,
            quantity: 1
          }
        ],
        discounts: [
          {
            promotion_code: promotionCodeId,
          },
        ],
        success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/profile`,
        metadata: {
          type: 'pre_warm_mailbox',
          emailListId: emailListId,
          numberOfMailboxes,
          user_id: userId,
          original_currency: 'usd',
          charged_currency: currency,
        },
        allow_promotion_codes: true,
      });
      const { data: transactionData, error: transactionError } = await db
      .from('transaction_history')
      .insert([
        {
          user_id: userId,
          type: 'mailbox_addon',
          amount: totalAmountSmallestUnit,
          currency: currency,
          status: 'pending',
        payment_provider: 'stripe',
        checkout_session_id: session.id,
        description: `${numberOfMailboxes}x Pre-Warmed Mailbox @ ${priceDisplay}`
      }
    ]);
    if (transactionError) {
      logger.error('Error inserting transaction history:', transactionError);
    }
      res.json({ url: session.url });
    } catch (error) {
      logger.error('purchasePreWarmMailbox error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
}
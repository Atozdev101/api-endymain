const stripe = require('../config/stripeConfig');
const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const { getCurrencyByCountry, getAmountByCurrency, getAmountInSmallestUnit, formatAmountForDisplay } = require('../utils/currencyHelper');

exports.createDomainPaymentIntent = async (req, res) => {
  try {
    const { amount, domains } = req.body;

    if (!amount || !domains || domains.length === 0) {
      return res.status(400).json({ message: 'Amount and domains are required' });
    }

    const userId = req.user.id;

    // Get user's country to determine currency
    const { data: userData, error: userError } = await db
      .from('users')
      .select('country')
      .eq('id', userId)
      .single();

    if (userError) {
      logger.error('Error fetching user country:', userError);
    }

    // Determine currency based on user's country (INR for India, USD for others)
    const currency = getCurrencyByCountry(userData?.country);
    
    // Convert amount based on currency
    const amountInUsd = Number(amount);
    const finalAmount = getAmountByCurrency(amountInUsd, currency);
    const parsedAmount = getAmountInSmallestUnit(finalAmount, currency);

    // Try to fetch existing Stripe customer
    const { data: customerData, error: customerError } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (customerError && customerError.code !== 'PGRST116') {
      logger.error('Supabase error fetching customer', customerError);
      return res.status(500).json({ message: 'Internal error fetching customer' });
    }

    let customerId = customerData?.stripe_customer_id;

    // If no customer exists, create a new Stripe customer and store it
    if (!customerId) {
      const newCustomer = await stripe.customers.create({
        metadata: { user_id: userId }
      });

      const { error: insertError } = await db.from('stripe_customers').insert([
        { user_id: userId, stripe_customer_id: newCustomer.id }
      ]);

      if (insertError) {
        logger.error('Error inserting new customer into Supabase', insertError);
        return res.status(500).json({ message: 'Could not save customer record' });
      }

      customerId = newCustomer.id;
    }

    // Map domain data into Stripe line items with appropriate currency
    const lineItems = domains.map(domain => {
      const domainPriceUsd = domain.price / 100; // Convert cents to dollars
      const domainPriceFinal = getAmountByCurrency(domainPriceUsd, currency);
      const domainPriceSmallestUnit = getAmountInSmallestUnit(domainPriceFinal, currency);
      const priceDisplay = formatAmountForDisplay(domainPriceFinal, currency);
      
      return {
        price_data: {
          currency,
          product_data: {
            name: `${domain.domain} - ${priceDisplay}`
          },
          unit_amount: domainPriceSmallestUnit,
        },
        quantity: 1,
      };
    });
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: req.user.email, // optional
      line_items: lineItems,
      success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/profile`,
      metadata: {
        type: 'domain_purchase',
        user_id: userId,
        domains: domains.map(d => d.domain).join(','), // Join domain names if needed
        years: domains.map(d => d.year).join(','), // Join years if needed
        original_currency: 'usd',
        charged_currency: currency,
      },
      // allow_promotion_codes: true,
    });
    // Insert the transaction into history
    const insertRes = await db.from('transaction_history').insert([
      {
        user_id: userId,
        type: 'domain_purchase',
        amount: parseInt(parsedAmount),
        currency,
        status: 'pending',
        payment_provider: 'stripe',
        checkout_session_id: session.id,
        description: `Domain purchase: ${domains.map(d => d.domain).join(', ')}`,
      }
    ]);

    if (insertRes.error) {
      logger.error('Failed to insert transaction history', insertRes.error);
    } else {
      logger.info(`Transaction history inserted for user ${userId} in ${currency.toUpperCase()}`);
    }
    // Return the Stripe Checkout session URL
    res.json({ url: session.url });

  } catch (err) {
    logger.error('Stripe error', err);
    res.status(500).json({ message: 'PaymentIntent creation failed', error: err.message });
  }
};

exports.createtopUpWalletPaymentIntent = async (req, res) => {
  try {
    const { amount } = req.body;
    const amountInUsd = Number(amount);
    
    if (!amountInUsd || amountInUsd < 1) {
      return res.status(400).json({ message: 'Amount must be at least $1.00' });
    }
    const userId = req.user.id;

    // Get user's country to determine currency
    const { data: userData, error: userError } = await db
      .from('users')
      .select('country')
      .eq('id', userId)
      .single();

    if (userError) {
      logger.error('Error fetching user country:', userError);
    }

    // Determine currency based on user's country (INR for India, USD for others)
    const currency = getCurrencyByCountry(userData?.country);
    
    // Convert amount based on currency
    const finalAmount = getAmountByCurrency(amountInUsd, currency);
    const parsedAmount = getAmountInSmallestUnit(finalAmount, currency);
    const displayAmount = formatAmountForDisplay(finalAmount, currency);

    // Try to fetch existing Stripe customer
    const { data: customerData, error: customerError } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (customerError && customerError.code !== 'PGRST116') {
      logger.error('Supabase error fetching customer', customerError);
      return res.status(500).json({ message: 'Internal error fetching customer' });
    }

    let customerId = customerData?.stripe_customer_id;

    // If no customer exists, create a new Stripe customer and store it
    if (!customerId) {
      const newCustomer = await stripe.customers.create({
        metadata: { user_id: userId }
      });

      const { error: insertError } = await db.from('stripe_customers').insert([
        { user_id: userId, stripe_customer_id: newCustomer.id }
      ]);

      if (insertError) {
        logger.error('Error inserting new customer into Supabase', insertError);
        return res.status(500).json({ message: 'Could not save customer record' });
      }

      customerId = newCustomer.id;
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';

    // Create Stripe checkout session for wallet top-up
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: req.user.email,
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: `Wallet Top-Up` },
            unit_amount: parsedAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/profile`,
      metadata: {
        type: 'wallet_topup',
        user_id: userId,
        parsedAmount,
        original_amount_usd: amountInUsd,
        charged_currency: currency,
      },
      allow_promotion_codes: true,
    });
    // Save transaction with 'pending' status
    const insertRes = await db.from('transaction_history').insert([
      {
        user_id: userId,
        type: 'wallet_topup',
        amount: parseInt(parsedAmount),
        currency,
        status: 'pending',
        payment_provider: 'stripe',
        checkout_session_id: session.id,
        description: `Wallet top-up of ${displayAmount}`
      }
    ]);

    if (insertRes.error) {
      logger.error('Failed to insert wallet top-up transaction', insertRes.error);
    }

    return res.json({ url: session.url });

  } catch (err) {
    logger.error('Stripe top-up error', err);
    res.status(500).json({ message: 'Top-up failed', error: err.message });
  }
};


exports.getTransactionBySessionId = async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session_id in query' });
  }

  const { data, error } = await db
    .from('transaction_history')
    .select('*')
    .eq('checkout_session_id', sessionId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const transformed = {
    amount: data.amount,
    currency: data.currency,
    status: data.status,
    payment_provider: data.payment_provider,
    reference_id: data.reference_id,
    description: data.description,
  };

  return res.status(200).json(transformed);
};

/**
 * Attach a payment method to a Stripe customer
 * POST /api/payments/attach-payment-method
 * Body: { payment_method_id }
 */
exports.attachPaymentMethod = async (req, res) => {
  try {
    const { payment_method_id } = req.body;
    const userId = req.user.id;

    if (!payment_method_id) {
      return res.status(400).json({ 
        error: 'Validation Error',
        message: 'payment_method_id is required' 
      });
    }

    // Get Stripe customer ID
    const { data: customerData, error: customerError } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (customerError && customerError.code !== 'PGRST116') {
      logger.error('Error fetching Stripe customer:', customerError);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'Failed to fetch customer data' 
      });
    }

    let customerId = customerData?.stripe_customer_id;

    // If no customer exists, create a new Stripe customer
    if (!customerId) {
      const { data: userData } = await db
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

      const newCustomer = await stripe.customers.create({
        email: userData?.email || req.user.email,
        metadata: { user_id: userId }
      });

      const { error: insertError } = await db.from('stripe_customers').insert([
        { user_id: userId, stripe_customer_id: newCustomer.id }
      ]);

      if (insertError) {
        logger.error('Error inserting new customer:', insertError);
        return res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'Failed to create customer record' 
        });
      }

      customerId = newCustomer.id;
    }

    // Attach payment method to customer
    try {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: customerId,
      });
    } catch (attachError) {
      // Payment method might already be attached
      if (attachError.code === 'resource_already_exists') {
        logger.info(`Payment method ${payment_method_id} already attached to customer ${customerId}`);
      } else {
        logger.error('Error attaching payment method:', attachError);
        return res.status(400).json({ 
          error: 'Payment Method Error',
          message: 'Failed to attach payment method: ' + attachError.message 
        });
      }
    }

    // Optionally set as default payment method
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: payment_method_id,
        },
      });
    } catch (updateError) {
      // Log but don't fail - attachment was successful
      logger.warn('Error setting default payment method:', updateError);
    }

    res.json({ 
      success: true, 
      message: 'Payment method attached successfully',
      payment_method_id,
      customer_id: customerId
    });
  } catch (error) {
    logger.error('Error in attachPaymentMethod:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Failed to attach payment method: ' + error.message 
    });
  }
};

/**
 * Get all saved payment methods for the authenticated user
 * GET /api/payments/payment-methods
 */
exports.getPaymentMethods = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get Stripe customer ID
    const { data: customerData, error: customerError } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (customerError && customerError.code !== 'PGRST116') {
      logger.error('Error fetching Stripe customer:', customerError);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'Failed to fetch customer data' 
      });
    }

    if (!customerData || !customerData.stripe_customer_id) {
      // No customer means no payment methods
      return res.json({ payment_methods: [] });
    }

    // List payment methods for customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerData.stripe_customer_id,
      type: 'card',
    });

    // Format response
    const formatted = paymentMethods.data.map(pm => ({
      id: pm.id,
      type: pm.type,
      card: {
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
        funding: pm.card.funding,
      },
      billing_details: {
        name: pm.billing_details.name,
        email: pm.billing_details.email,
      },
      created: pm.created,
    }));

    res.json({ 
      success: true,
      payment_methods: formatted 
    });
  } catch (error) {
    logger.error('Error in getPaymentMethods:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Failed to fetch payment methods: ' + error.message 
    });
  }
};

/**
 * Delete a payment method
 * DELETE /api/payments/payment-methods/:payment_method_id
 */
exports.deletePaymentMethod = async (req, res) => {
  try {
    const { payment_method_id } = req.params;
    const userId = req.user.id;

    if (!payment_method_id) {
      return res.status(400).json({ 
        error: 'Validation Error',
        message: 'payment_method_id is required' 
      });
    }

    // Get Stripe customer ID to verify ownership
    const { data: customerData, error: customerError } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (customerError || !customerData) {
      return res.status(404).json({ 
        error: 'Not Found',
        message: 'Stripe customer not found' 
      });
    }

    // Verify payment method belongs to customer
    try {
      const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);
      
      if (paymentMethod.customer !== customerData.stripe_customer_id) {
        return res.status(403).json({ 
          error: 'Forbidden',
          message: 'Payment method does not belong to your account' 
        });
      }

      // Detach payment method from customer
      await stripe.paymentMethods.detach(payment_method_id);

      res.json({ 
        success: true,
        message: 'Payment method deleted successfully' 
      });
    } catch (stripeError) {
      if (stripeError.code === 'resource_missing') {
        return res.status(404).json({ 
          error: 'Not Found',
          message: 'Payment method not found' 
        });
      }
      throw stripeError;
    }
  } catch (error) {
    logger.error('Error in deletePaymentMethod:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Failed to delete payment method: ' + error.message 
    });
  }
};





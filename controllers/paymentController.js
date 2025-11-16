const stripe = require('../config/stripeConfig');
const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');

exports.createDomainPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = 'usd', domains } = req.body;
    const parsedAmount = Math.round(Number(amount) * 100); // Convert to cents

    if (!parsedAmount || !domains || domains.length === 0) {
      return res.status(400).json({ message: 'Amount and domains are required' });
    }

    const userId = req.user.id;

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

    // Map domain data into Stripe line items
    const lineItems = domains.map(domain => ({
      price_data: {
        currency,
        product_data: {
          name: `${domain.domain} - $${(domain.price / 100).toFixed(2)}`
        },
        unit_amount: domain.price, // in cents
      },
      quantity: 1,
    }));
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
      logger.info(`Transaction history inserted for user ${userId}`);
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
    const { amount, currency = 'usd' } = req.body;
    const parsedAmount = Math.round(Number(amount) * 100); // Convert to cents
    if (!parsedAmount || parsedAmount < 100) {
      return res.status(400).json({ message: 'Amount must be at least $1.00' });
    }
    const userId = req.user.id;

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
        description: `Wallet top-up of $${(parsedAmount / 100).toFixed(2)}`
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





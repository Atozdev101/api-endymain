const Stripe = require('stripe');
const db = require('../config/supabaseConfig');
const logger = require('../utils/winstonLogger');
const {sendSlackMessage} = require('../config/slackConfig')
const {
  handleDomainPurchase,
  handleWalletTopUp,
  handleMailboxAddon,
  handlePreWarmMailbox,
  handleSubscription,
  handleSubscriptionCancel,
  handleSubscriptionUpdate,
  handleInvoicePaymentSucceeded,
} = require('../services/stripeService');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    await logger.warn({ message: '⚠️ Webhook signature verification failed.', context: { error: err.message } });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const logEvent = async (level, message, context = {}, userId = null) => {
    await logger[level]({ message, context, user_id: userId });
  };

  switch (event.type) {
    case 'payment_intent.succeeded':
      await logEvent('info', '✅ Payment succeeded', { id: event.data.object.id }, event.data.object.metadata?.user_id);
      break;

    case 'payment_intent.created':
      await logEvent('info', '🧾 PaymentIntent created', { id: event.data.object.id }, event.data.object.metadata?.user_id);
      break;

    case 'charge.succeeded':
      await logEvent('info', '🔁 Charge succeeded', { charge_id: event.data.object.id }, event.data.object.metadata?.user_id);
      break;
    
      case 'checkout.session.expired': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const numberOfMailboxes = session.metadata?.numberOfMailboxes;
      
        await logEvent('info', '⏰ Checkout session expired', { session_id: session.id }, userId);
      
        // Mark transaction as expired
        await db.from('transaction_history')
          .update({ status: 'expired' })
          .eq('checkout_session_id', session.id);
      
        try {
          // Retrieve session details with expanded price and product
          const sessionDetails = await stripe.checkout.sessions.retrieve(session.id, { 
            expand: ['line_items.data.price.product'] 
          });
          const priceId = sessionDetails.line_items?.data[0]?.price?.id;
          const productId = sessionDetails.line_items?.data[0]?.price?.product?.id;
          const product = sessionDetails.line_items?.data[0]?.price?.product;
      

        } catch (error) {
          await logEvent('error', '❌ Failed to handle product/price after session expiration', { error: error.message }, userId);
          await sendSlackMessage(`❌ Failed to handle Stripe entities for expired session \`${session.id}\`: ${error.message}`, 'ERROR');
        }
      
        break;
      }
      
    case 'checkout.session.completed': {
      const session = event.data.object;
      const context = session.metadata?.type;
      await logEvent('info', '✅ Checkout session completed', { session_id: session.id }, session.metadata?.user_id);

      switch (context) {
        case 'domain_purchase':
          await handleDomainPurchase(session);
          break;
        case 'wallet_topup':
          await handleWalletTopUp(session);
          break;
        case 'mailbox_subscription':
          await handleSubscription(session);
          break;
        case 'mailbox_addon':
          await handleMailboxAddon(session);
          break;
        case 'pre_warm_mailbox':
          await handlePreWarmMailbox(session);
          break;
        default:
          await logEvent('warn', '⚠️ Unknown session type in metadata', { session_id: session.id, context });
          await sendSlackMessage(`⚠️ Unknown session type: \`${context}\` for session \`${session.id}\``,'INFO');
      }
      break;
    }
    
    case 'customer.subscription.deleted':
      await logEvent('info', '❌ Subscription canceled or ended', { subscription_id: event.data.object.id }, event.data.object.metadata?.user_id);
      await handleSubscriptionCancel(event.data.object);
      break;
    case 'customer.subscription.updated':
      await logEvent('info', '🔄 Subscription updated', { subscription_id: event.data.object.id }, event.data.object.metadata?.user_id);
      await handleSubscriptionUpdate(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await logEvent('info', '✅ Invoice payment succeeded', { invoice_id: event.data.object.id }, event.data.object.metadata?.user_id);
      await handleInvoicePaymentSucceeded(event.data.object);
      break;
    default:
      await logEvent('info', `ℹ️ Unhandled event type ${event.type}`, { type: event.type });
  }

  res.status(200).json({ received: true });
};

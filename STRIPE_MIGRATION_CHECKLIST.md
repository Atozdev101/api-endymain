# Stripe Account Migration - Quick Checklist

Use this checklist as you go through the migration process. Check off each item as you complete it.

## Phase 1: Stripe Dashboard Setup

### API Keys
- [ ] Logged into new Stripe Dashboard
- [ ] Copied Secret Key (Test): `sk_test_...`
- [ ] Copied Secret Key (Live): `sk_live_...`
- [ ] Copied Publishable Key (Test): `pk_test_...`
- [ ] Copied Publishable Key (Live): `pk_live_...`

### Products & Prices
- [ ] Created Product: "Starter Plan" → Price ID: `price_...`
- [ ] Created Product: "Pro Plan" → Price ID: `price_...`
- [ ] Created Product: "Enterprise Plan" → Price ID: `price_...`
- [ ] (Add more plans as needed)
- [ ] Verified all prices match database plan prices

### Webhook Setup
- [ ] Created webhook endpoint: `https://your-domain.com/webhook`
- [ ] Selected all required events:
  - [ ] `checkout.session.completed`
  - [ ] `checkout.session.expired`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
  - [ ] `invoice.payment_succeeded`
  - [ ] `payment_intent.succeeded`
  - [ ] `payment_intent.created`
  - [ ] `charge.succeeded`
- [ ] Copied Webhook Signing Secret: `whsec_...`

### Billing Portal (Optional)
- [ ] Configured customer portal settings
- [ ] Set cancellation behavior
- [ ] Enabled payment method updates

---

## Phase 2: Environment Variables

### Development/Test
- [ ] Updated `.env` file with:
  - [ ] `STRIPE_SECRET_KEY=sk_test_...`
  - [ ] `STRIPE_WEBHOOK_SECRET=whsec_...`
- [ ] Verified no old keys remain
- [ ] Tested environment variables load correctly

### Production
- [ ] Updated production environment variables:
  - [ ] `STRIPE_SECRET_KEY=sk_live_...`
  - [ ] `STRIPE_WEBHOOK_SECRET=whsec_...`
- [ ] Verified production webhook URL matches Stripe dashboard

---

## Phase 3: Database Updates

### Plans Table
- [ ] Updated `plans` table with new `stripe_price_id_monthly`:
  - [ ] Plan 1: `price_...`
  - [ ] Plan 2: `price_...`
  - [ ] Plan 3: `price_...`
  - [ ] (Add more as needed)
- [ ] Verified prices match between Stripe and database
- [ ] Tested query: `SELECT id, name, stripe_price_id_monthly FROM plans;`

### Customer Records (Decision)
- [ ] Decided on approach:
  - [ ] Option A: Keep existing records (auto-create new customers)
  - [ ] Option B: Clear existing records
- [ ] (If Option B) Executed: `TRUNCATE TABLE stripe_customers;`

---

## Phase 4: Testing (Test Mode)

### Payment Flows
- [ ] Tested domain purchase (test card: 4242 4242 4242 4242)
- [ ] Tested wallet top-up
- [ ] Tested mailbox subscription creation
- [ ] Tested mailbox add-on purchase
- [ ] Tested pre-warmed mailbox purchase

### Subscription Management
- [ ] Tested subscription cancellation
- [ ] Tested subscription update
- [ ] Tested billing portal access

### Webhook Verification
- [ ] Verified webhook events received in Stripe Dashboard
- [ ] Checked application logs for webhook processing
- [ ] Verified database updates from webhooks
- [ ] Tested webhook signature verification

### Database Verification
- [ ] Checked `transaction_history` table for new records
- [ ] Checked `stripe_customers` table for new customers
- [ ] Checked `mailbox_subscription` table for subscriptions
- [ ] Checked `orders` table for order records

---

## Phase 5: Production Deployment

### Pre-Deployment
- [ ] All test mode tests passed
- [ ] Switched to live mode keys
- [ ] Updated production database with new Price IDs
- [ ] Updated production webhook URL in Stripe

### Deployment
- [ ] Updated production environment variables
- [ ] Restarted application server
- [ ] Verified application started successfully
- [ ] Checked application logs for errors

### Production Testing
- [ ] Performed small real transaction ($1-5)
- [ ] Verified webhook received and processed
- [ ] Verified database updated correctly
- [ ] Verified Slack notifications (if configured)
- [ ] Checked Stripe Dashboard for transaction

### Monitoring
- [ ] Set up monitoring/alerts for webhook failures
- [ ] Verified error logging works
- [ ] Checked first few real transactions
- [ ] Monitored for any issues

---

## Phase 6: Cleanup (Optional)

### Old Stripe Account
- [ ] Exported important data from old account
- [ ] Documented any active subscriptions
- [ ] (If needed) Migrated customers
- [ ] (If needed) Closed old account

### Documentation
- [ ] Updated internal documentation
- [ ] Noted new Stripe account details
- [ ] Saved webhook secrets securely
- [ ] Documented any custom configurations

---

## Quick Reference

### Stripe Test Cards
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- 3D Secure: `4000 0027 6000 3184`
- Any future date for expiry
- Any 3 digits for CVC

### Important URLs
- Stripe Dashboard: https://dashboard.stripe.com
- Webhook Events: https://dashboard.stripe.com/webhooks
- API Keys: https://dashboard.stripe.com/apikeys
- Products: https://dashboard.stripe.com/products

### Key Files
- `config/stripeConfig.js` - Stripe client initialization
- `controllers/stripeWebhookController.js` - Webhook handler
- `controllers/paymentController.js` - Payment creation
- `controllers/subscriptionController.js` - Subscription management
- `services/stripeService.js` - Stripe service logic

### Database Tables
- `stripe_customers` - User to Stripe customer mapping
- `plans` - Subscription plans with Price IDs
- `transaction_history` - All payment transactions
- `mailbox_subscription` - Mailbox subscriptions
- `gsuite_subscriptions` - Gsuite subscriptions
- `orders` - Order records

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| Webhook not receiving events | Check URL accessibility, verify secret |
| "No such customer" error | Normal - new customers auto-created |
| Price ID not found | Verify Price IDs in database match Stripe |
| Subscription not updating | Check webhook events, verify handler |
| Payment failing | Check API keys, verify test/live mode match |

---

## Notes Section

Use this space to jot down any important notes during migration:

```
Date: ___________
New Stripe Account Email: ___________
Webhook URL: ___________

Plan Price IDs:
- Plan 1: ___________
- Plan 2: ___________
- Plan 3: ___________

Issues Encountered:
1. 
2. 
3. 

Resolutions:
1. 
2. 
3. 
```

---

**Remember:** Always test in Stripe test mode before going live! 🚀


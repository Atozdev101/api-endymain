# Stripe Account Migration Guide

This guide will walk you through migrating from your current Stripe account to a completely new Stripe account.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Stripe Dashboard Setup](#stripe-dashboard-setup)
3. [Code Changes](#code-changes)
4. [Database Updates](#database-updates)
5. [Testing](#testing)
6. [Deployment](#deployment)

---

## Prerequisites

- Access to your new Stripe account dashboard
- Access to your database (Supabase)
- Access to your server environment variables
- Understanding of your current plans and pricing

---

## Part 1: Stripe Dashboard Setup

### Step 1: Get Your API Keys

1. Log in to your **new** Stripe Dashboard: https://dashboard.stripe.com
2. Go to **Developers** → **API keys**
3. Copy your **Secret key** (starts with `sk_live_` for production or `sk_test_` for testing)
4. Copy your **Publishable key** (starts with `pk_live_` or `pk_test_`)

**⚠️ Important:** 
- Use **Test mode** keys during development/testing
- Use **Live mode** keys only in production
- Never commit these keys to version control

### Step 2: Create Products and Prices

Your application uses Stripe for:
- **Domain purchases** (one-time payments)
- **Wallet top-ups** (one-time payments)
- **Mailbox subscriptions** (recurring monthly)
- **Mailbox add-ons** (recurring monthly)
- **Pre-warmed mailbox subscriptions** (recurring monthly)

#### 2.1: Create Subscription Plans (for mailbox subscriptions)

1. Go to **Products** in Stripe Dashboard
2. For each plan in your `plans` database table:
   - Click **Add product**
   - Name: Use your plan name (e.g., "Starter Plan", "Pro Plan")
   - Description: Add plan description
   - Pricing model: **Recurring**
   - Price: Enter the monthly price (e.g., $29.99)
   - Billing period: **Monthly**
   - Click **Save product**
   - **Copy the Price ID** (starts with `price_`) - you'll need this for the database

**Note:** Your code uses `stripe_price_id_monthly` from the `plans` table. Make sure to save these Price IDs.

#### 2.2: Dynamic Products (No Action Needed)

The following are created dynamically in code (no manual setup needed):
- Domain purchase products (created per checkout session)
- Wallet top-up products (created per checkout session)
- Mailbox add-on products (created per checkout session)
- Pre-warmed mailbox products (created per checkout session)

### Step 3: Set Up Webhook Endpoint

1. Go to **Developers** → **Webhooks** in Stripe Dashboard
2. Click **Add endpoint**
3. Enter your webhook URL: `https://your-domain.com/webhook`
   - Replace `your-domain.com` with your actual API domain
4. Select events to listen to:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `payment_intent.succeeded`
   - `payment_intent.created`
   - `charge.succeeded`
5. Click **Add endpoint**
6. **Copy the Signing secret** (starts with `whsec_`) - you'll need this for `STRIPE_WEBHOOK_SECRET`

### Step 4: Configure Billing Portal (Optional but Recommended)

1. Go to **Settings** → **Billing** → **Customer portal**
2. Configure the portal settings:
   - Allow customers to update payment methods
   - Allow customers to cancel subscriptions
   - Set cancellation behavior
3. Save settings

---

## Part 2: Code Changes

### Step 1: Update Environment Variables

Update your `.env` file or server environment variables:

```bash
# Old Stripe Account (remove or comment out)
# STRIPE_SECRET_KEY=sk_live_old_key_here
# STRIPE_WEBHOOK_SECRET=whsec_old_secret_here

# New Stripe Account
STRIPE_SECRET_KEY=sk_live_your_new_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_new_webhook_secret_here
```

**Files that use these:**
- `config/stripeConfig.js` - Uses `STRIPE_SECRET_KEY`
- `controllers/stripeWebhookController.js` - Uses both keys

### Step 2: Verify Configuration Files

No code changes needed! The following files automatically use the new keys from environment variables:

- ✅ `config/stripeConfig.js` - Already uses `process.env.STRIPE_SECRET_KEY`
- ✅ `controllers/stripeWebhookController.js` - Already uses environment variables

---

## Part 3: Database Updates

### Step 1: Update Plans Table with New Price IDs

You need to update the `plans` table with the new Stripe Price IDs from Step 2.1.

**SQL Query Example:**
```sql
-- Update each plan with its new Stripe Price ID
UPDATE plans 
SET stripe_price_id_monthly = 'price_new_monthly_id_here'
WHERE id = 'plan_id_here';

-- Example for multiple plans:
UPDATE plans SET stripe_price_id_monthly = 'price_1234567890' WHERE name = 'Starter Plan';
UPDATE plans SET stripe_price_id_monthly = 'price_0987654321' WHERE name = 'Pro Plan';
UPDATE plans SET stripe_price_id_monthly = 'price_1122334455' WHERE name = 'Enterprise Plan';
```

**⚠️ Important:**
- Make sure the Price IDs match the products you created in Stripe
- Verify the prices match between Stripe and your database
- Test with one plan first before updating all

### Step 2: Handle Existing Stripe Customers (Optional)

If you want to keep existing customer data but use a new Stripe account:

**Option A: Keep existing customer records (Recommended for fresh start)**
- The `stripe_customers` table will automatically create new customer records when users make purchases
- Old customer IDs from the previous Stripe account will become invalid
- Users will be treated as new customers in the new Stripe account

**Option B: Clear existing Stripe customer records**
```sql
-- WARNING: This will remove all existing Stripe customer mappings
-- Users will need to create new checkout sessions
TRUNCATE TABLE stripe_customers;
```

**⚠️ Recommendation:** Since you're using a completely different account, Option A is recommended. The system will automatically create new Stripe customers when needed.

### Step 3: Verify Database Schema

Ensure these tables exist and have the correct structure:
- `stripe_customers` - Maps `user_id` to `stripe_customer_id`
- `plans` - Contains `stripe_price_id_monthly` and `stripe_price_id_yearly` columns
- `transaction_history` - Tracks all transactions
- `mailbox_subscription` - Stores subscription details
- `gsuite_subscriptions` - Stores Gsuite subscription details

---

## Part 4: Testing

### Step 1: Test in Stripe Test Mode First

1. Use test mode API keys in your `.env`:
   ```bash
   STRIPE_SECRET_KEY=sk_test_your_test_key
   STRIPE_WEBHOOK_SECRET=whsec_your_test_webhook_secret
   ```

2. Use Stripe test cards:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - 3D Secure: `4000 0027 6000 3184`

3. Test each payment flow:
   - ✅ Domain purchase
   - ✅ Wallet top-up
   - ✅ Mailbox subscription creation
   - ✅ Mailbox add-on purchase
   - ✅ Pre-warmed mailbox purchase
   - ✅ Subscription cancellation
   - ✅ Webhook events

### Step 2: Verify Webhook Events

1. Check Stripe Dashboard → **Developers** → **Webhooks** → **Events**
2. Verify events are being received
3. Check your application logs for webhook processing
4. Verify database updates are happening correctly

### Step 3: Test Production (After Test Mode Success)

1. Switch to live mode keys
2. Perform a small real transaction
3. Verify webhook processing
4. Check database records
5. Verify Slack notifications (if configured)

---

## Part 5: Deployment

### Step 1: Update Production Environment Variables

Update your production server environment variables:

```bash
# SSH into your server or use your deployment method
export STRIPE_SECRET_KEY=sk_live_your_new_production_key
export STRIPE_WEBHOOK_SECRET=whsec_your_new_production_webhook_secret
```

Or update in your deployment platform (PM2, Docker, etc.)

### Step 2: Update Production Database

Run the SQL updates from Part 3, Step 1 on your production database.

### Step 3: Update Production Webhook URL

1. In Stripe Dashboard → **Developers** → **Webhooks**
2. Update the webhook endpoint URL to your production URL
3. Verify the webhook secret matches your production `STRIPE_WEBHOOK_SECRET`

### Step 4: Restart Your Application

```bash
# If using PM2
pm2 restart your-app-name

# If using systemd
sudo systemctl restart your-service

# If using Docker
docker-compose restart
```

### Step 5: Monitor

1. Check application logs for errors
2. Monitor Stripe Dashboard for transactions
3. Verify webhook events are being processed
4. Check database for new records
5. Monitor Slack notifications (if configured)

---

## Checklist

### Stripe Dashboard
- [ ] Created new Stripe account
- [ ] Copied Secret Key (test and live)
- [ ] Copied Publishable Key (test and live)
- [ ] Created all subscription plan products
- [ ] Copied all Price IDs
- [ ] Set up webhook endpoint
- [ ] Copied webhook signing secret
- [ ] Configured billing portal (optional)

### Code/Environment
- [ ] Updated `STRIPE_SECRET_KEY` in environment variables
- [ ] Updated `STRIPE_WEBHOOK_SECRET` in environment variables
- [ ] Verified no hardcoded Stripe keys in code
- [ ] Tested in test mode
- [ ] Verified webhook endpoint is accessible

### Database
- [ ] Updated `plans` table with new `stripe_price_id_monthly` values
- [ ] Verified plan prices match Stripe prices
- [ ] Decided on handling existing `stripe_customers` records

### Testing
- [ ] Tested domain purchase flow
- [ ] Tested wallet top-up flow
- [ ] Tested subscription creation
- [ ] Tested mailbox add-on purchase
- [ ] Tested pre-warmed mailbox purchase
- [ ] Tested subscription cancellation
- [ ] Verified webhook events are processed
- [ ] Verified database updates correctly
- [ ] Tested in production (small transaction)

### Deployment
- [ ] Updated production environment variables
- [ ] Updated production database
- [ ] Updated production webhook URL
- [ ] Restarted application
- [ ] Monitored for errors
- [ ] Verified first real transaction

---

## Important Notes

1. **Old Stripe Account:** The old Stripe account will continue to exist. You may want to:
   - Export any important data
   - Cancel any active subscriptions (if migrating customers)
   - Close the account (if no longer needed)

2. **Existing Subscriptions:** If you have active subscriptions in the old account:
   - They will NOT automatically transfer
   - Users will need to create new subscriptions
   - Consider a migration plan if needed

3. **Customer Data:** The `stripe_customers` table maps your users to Stripe customers. With a new account:
   - Old customer IDs become invalid
   - New customers will be created automatically
   - No manual migration needed

4. **Webhook Security:** Always use webhook signing secrets to verify webhook authenticity. Never skip webhook signature verification.

5. **Testing:** Always test in Stripe test mode before going live. Test mode and live mode are completely separate.

---

## Troubleshooting

### Webhook Not Receiving Events
- Verify webhook URL is accessible (not behind firewall)
- Check webhook endpoint is using `bodyParser.raw({ type: 'application/json' })`
- Verify webhook secret matches
- Check Stripe Dashboard → Webhooks → Events for delivery status

### "No such customer" Errors
- This is normal when switching accounts
- New customers will be created automatically
- Old customer IDs from previous account are invalid

### Price ID Not Found
- Verify Price IDs in database match Stripe Dashboard
- Check if prices are in the correct mode (test vs live)
- Ensure prices are active in Stripe

### Subscription Not Updating
- Check webhook events are being received
- Verify webhook handler is processing `customer.subscription.updated`
- Check application logs for errors

---

## Support

If you encounter issues:
1. Check Stripe Dashboard → **Developers** → **Logs** for API errors
2. Check your application logs
3. Verify environment variables are set correctly
4. Test webhook endpoint manually using Stripe CLI: `stripe listen --forward-to localhost:5000/webhook`

---

## Summary

The migration process involves:
1. ✅ Setting up new Stripe account (products, prices, webhooks)
2. ✅ Updating environment variables
3. ✅ Updating database with new Price IDs
4. ✅ Testing thoroughly
5. ✅ Deploying to production

No code changes are required - everything uses environment variables! 🎉


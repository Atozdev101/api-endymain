# Stripe Migration - Final Deployment Checklist

## ⚠️ CRITICAL: Information You Need to Get

### 1. Price IDs (Already Provided)

**Price IDs:**
- **Starter Plan** (prod_TRPdio3FoG7Gbr) → Price ID: `price_1SUWoTSEBS9h8bp0WXtEDp5S`
- **Growth Plan** (prod_TRPeTp4TyPWukF) → Price ID: `price_1SUWp1SEBS9h8bp0m7Q3iOP8`
- **Pro Plan** (prod_TRPeE3RvVXMIVP) → Price ID: `price_1SUWpLSEBS9h8bp0kj9mNr93`

### 2. Get Webhook Signing Secret (Not Webhook ID)

You provided webhook ID: `we_1SUUbqSEBS9h8bp0Ocnr6t66`

But you need the **Webhook Signing Secret** (starts with `whsec_`):

**How to get it:**
1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click on your webhook endpoint
3. Click **Reveal** next to "Signing secret"
4. Copy the secret (starts with `whsec_`)

---

## ✅ Code Status

**Good news:** Your code is already clean! No changes needed:
- ✅ All Stripe keys use environment variables
- ✅ No hardcoded Stripe values
- ✅ Webhook handler properly configured
- ✅ All controllers use the shared Stripe config

**Files verified:**
- `config/stripeConfig.js` - Uses `process.env.STRIPE_SECRET_KEY` ✅
- `controllers/stripeWebhookController.js` - Uses `process.env.STRIPE_WEBHOOK_SECRET` ✅
- All payment controllers use the shared Stripe instance ✅

---

## 📋 Deployment Steps

### Step 1: Get Missing Information

1. **Price IDs** - ✅ Already provided:
   - Starter Plan: `price_1SUWoTSEBS9h8bp0WXtEDp5S`
   - Growth Plan: `price_1SUWp1SEBS9h8bp0m7Q3iOP8`
   - Pro Plan: `price_1SUWpLSEBS9h8bp0kj9mNr93`
   
2. **Get Webhook Signing Secret** from Stripe Dashboard (see above)

### Step 2: Update Environment Variables

Set these in your production environment:

```bash
STRIPE_SECRET_KEY=sk_live_YOUR_STRIPE_SECRET_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SIGNING_SECRET_HERE
```

**Note:** Replace `whsec_YOUR_WEBHOOK_SIGNING_SECRET_HERE` with the actual signing secret from Step 1.

### Step 3: Clean Old Stripe Data (Database)

Run this SQL on your database to remove old Stripe customer mappings:

```sql
-- Clear all old Stripe customer records
TRUNCATE TABLE stripe_customers;
```

This ensures no old Stripe account data remains. New customers will be created automatically with the new account.

### Step 4: Update Plans Table with Price IDs

Run this SQL (Price IDs are already set):

```sql
-- Update Starter Plan
UPDATE plans 
SET stripe_price_id_monthly = 'price_1SUWoTSEBS9h8bp0WXtEDp5S'
WHERE name ILIKE '%starter%' OR name = 'Starter Plan';

-- Update Growth Plan
UPDATE plans 
SET stripe_price_id_monthly = 'price_1SUWp1SEBS9h8bp0m7Q3iOP8'
WHERE name ILIKE '%growth%' OR name = 'Growth Plan';

-- Update Pro Plan
UPDATE plans 
SET stripe_price_id_monthly = 'price_1SUWpLSEBS9h8bp0kj9mNr93'
WHERE name ILIKE '%pro%' OR name = 'Pro Plan';

-- Verify updates
SELECT id, name, stripe_price_id_monthly FROM plans;
```

**Or simply run:** `update-plans-with-price-ids.sql` file

### Step 5: Verify Webhook Endpoint

1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Verify your webhook endpoint URL is correct: `https://your-domain.com/webhook`
3. Verify these events are selected:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `payment_intent.succeeded`
   - `payment_intent.created`
   - `charge.succeeded`

### Step 6: Restart Application

```bash
# If using PM2
pm2 restart your-app-name

# Or if using systemd
sudo systemctl restart your-service

# Or if using Docker
docker-compose restart
```

### Step 7: Verify Deployment

1. Check application logs for errors
2. Test a small transaction
3. Verify webhook events are received
4. Check database for new records

---

## 🔍 Verification Checklist

- [x] Got Price IDs (already provided)
- [ ] Got Webhook Signing Secret (not Webhook ID) from Stripe Dashboard
- [ ] Updated `STRIPE_SECRET_KEY` in environment variables
- [ ] Updated `STRIPE_WEBHOOK_SECRET` in environment variables
- [ ] Ran `TRUNCATE TABLE stripe_customers;` on database
- [ ] Updated `plans` table with new Price IDs
- [ ] Verified webhook endpoint URL in Stripe Dashboard
- [ ] Verified webhook events are selected
- [ ] Restarted application
- [ ] Tested a transaction
- [ ] Verified webhook events are received
- [ ] Checked database for new records

---

## 📝 Quick Reference

### Your Stripe Account Details

**Live Keys:**
- Publishable Key: `pk_live_YOUR_PUBLISHABLE_KEY_HERE`
- Secret Key: `sk_live_YOUR_SECRET_KEY_HERE`

**Products (with Price IDs):**
- Starter Plan: `prod_TRPdio3FoG7Gbr` → Price ID: `price_1SUWoTSEBS9h8bp0WXtEDp5S`
- Growth Plan: `prod_TRPeTp4TyPWukF` → Price ID: `price_1SUWp1SEBS9h8bp0m7Q3iOP8`
- Pro Plan: `prod_TRPeE3RvVXMIVP` → Price ID: `price_1SUWpLSEBS9h8bp0kj9mNr93`

**Webhook:**
- Webhook ID: `we_1SUUbqSEBS9h8bp0Ocnr6t66`
- Need Signing Secret: `whsec_???` (get from Stripe Dashboard)

---

## 🚨 Important Notes

1. **Price IDs vs Product IDs:** The code uses Price IDs (`price_...`), not Product IDs (`prod_...`). Each product can have multiple prices (monthly, yearly, etc.). You need the monthly Price ID.

2. **Webhook Secret:** The webhook signing secret (`whsec_...`) is different from the webhook ID (`we_...`). You need the signing secret for `STRIPE_WEBHOOK_SECRET`.

3. **Old Stripe Data:** Running `TRUNCATE TABLE stripe_customers;` will remove all old Stripe customer mappings. This is safe because:
   - New customers will be created automatically
   - Old customer IDs from the previous account are invalid anyway
   - No user data is lost (only the Stripe customer ID mapping)

4. **No Code Changes:** Your code is already clean and uses environment variables. No code changes are needed.

5. **Testing:** Since you're deploying directly to live, make sure:
   - All Price IDs are correct
   - Webhook secret is correct
   - Webhook endpoint URL is accessible
   - Environment variables are set correctly

---

## 🆘 Troubleshooting

### "No such price" error
- Verify Price IDs in database match Stripe Dashboard
- Make sure you're using Price IDs (`price_...`), not Product IDs (`prod_...`)

### Webhook not receiving events
- Verify `STRIPE_WEBHOOK_SECRET` matches the signing secret in Stripe Dashboard
- Check webhook endpoint URL is accessible
- Verify events are selected in Stripe Dashboard

### "No such customer" error
- This is normal - new customers will be created automatically
- Old customer IDs from previous account are invalid

---

## ✅ Final Checklist Before Going Live

- [x] Got all Price IDs (already provided)
- [ ] Got Webhook Signing Secret from Stripe Dashboard
- [ ] Updated environment variables
- [ ] Cleared old Stripe customer data
- [ ] Updated plans table with Price IDs
- [ ] Verified webhook configuration
- [ ] Restarted application
- [ ] Ready to deploy! 🚀


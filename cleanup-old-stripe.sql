-- Cleanup script to remove old Stripe account data
-- Run this on your database to ensure no traces of old Stripe account

-- 1. Clear all old Stripe customer mappings
-- This will force the system to create new Stripe customers with the new account
TRUNCATE TABLE stripe_customers;

-- 2. Verify plans table has the correct structure
-- Make sure stripe_price_id_monthly column exists and is ready for new Price IDs
-- (No action needed if column already exists)

-- 3. Optional: Mark old transactions as from previous account
-- Uncomment if you want to keep transaction history but mark them
-- UPDATE transaction_history 
-- SET payment_provider = 'stripe_old' 
-- WHERE payment_provider = 'stripe' AND created_at < NOW() - INTERVAL '1 day';

-- 4. Optional: Clear pending transactions that might reference old Stripe sessions
-- Uncomment if you want to clear pending transactions
-- DELETE FROM transaction_history 
-- WHERE status = 'pending' AND payment_provider = 'stripe';

-- After running this:
-- 1. Update plans table with new Price IDs (see below)
-- 2. Update environment variables with new Stripe keys
-- 3. Restart your application


-- Update plans table with new Stripe Price IDs
-- 
-- Product IDs:
-- - Starter Plan: prod_TRPdio3FoG7Gbr
-- - Growth Plan: prod_TRPeTp4TyPWukF
-- - Pro Plan: prod_TRPeE3RvVXMIVP
--
-- Price IDs:
-- - Starter Plan: price_1SUWoTSEBS9h8bp0WXtEDp5S
-- - Growth Plan: price_1SUWp1SEBS9h8bp0m7Q3iOP8
-- - Pro Plan: price_1SUWpLSEBS9h8bp0kj9mNr93

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

-- Verify the updates:
SELECT id, name, stripe_price_id_monthly FROM plans;

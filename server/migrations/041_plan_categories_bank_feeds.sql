-- Keep the stable internal ID `business` while presenting the agreed Growth category.
UPDATE subscription_plans SET name='Growth' WHERE id='business';
UPDATE subscription_plans
SET features=ARRAY['core','operations','reports','automation','forecast','bank_feeds']
WHERE id='enterprise';

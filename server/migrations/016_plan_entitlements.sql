CREATE TABLE subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price text NOT NULL,
  features text[] NOT NULL,
  seat_limit integer NOT NULL CHECK(seat_limit > 0)
);
INSERT INTO subscription_plans VALUES
 ('starter','Starter','NGN 45,000 / mo',ARRAY['core'],5),
 ('business','Business','NGN 120,000 / mo',ARRAY['core','operations','reports'],25),
 ('business_pro','Business Pro','NGN 280,000 / mo',ARRAY['core','operations','reports','automation','forecast'],100),
 ('enterprise','Enterprise','Custom quote',ARRAY['core','operations','reports','automation','forecast'],1000);
ALTER TABLE tenants ADD COLUMN plan_id text NOT NULL DEFAULT 'business_pro' REFERENCES subscription_plans(id);
-- Existing workspaces retain their current breadth; billing must assign paid plans explicitly.

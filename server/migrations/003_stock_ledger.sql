CREATE TABLE stock_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  quantity_before bigint NOT NULL CHECK(quantity_before BETWEEN 0 AND 100000000),
  quantity_delta bigint NOT NULL,
  quantity_after bigint NOT NULL CHECK(quantity_after BETWEEN 0 AND 100000000),
  unit_cost numeric(20,2) NOT NULL CHECK(unit_cost > 0),
  value_delta numeric(30,2) NOT NULL,
  payload jsonb NOT NULL,
  CHECK(quantity_before + quantity_delta = quantity_after),
  CHECK(value_delta = quantity_delta * unit_cost)
);
CREATE INDEX stock_movements_tenant_product ON stock_movements(tenant_id,product_id,occurred_at DESC);
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movement_scope ON stock_movements
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
-- Preserve existing stock as explicitly labelled current baselines, not historical receipts.
-- Identity rows enumerate tenants; each business-data read still uses its RLS context.
DO $$
DECLARE current_tenant uuid;
BEGIN
  FOR current_tenant IN SELECT DISTINCT tenant_id FROM users LOOP
    PERFORM set_config('app.tenant_id',current_tenant::text,true);
    WITH openings AS (
      SELECT gen_random_uuid() AS id, p, (p->>'qty')::bigint AS qty,
             round((p->>'cost')::numeric,2) AS cost
      FROM tenants t CROSS JOIN LATERAL jsonb_array_elements(t.state->'products') p
      WHERE t.id=current_tenant
    )
    INSERT INTO stock_movements(id,tenant_id,product_id,occurred_at,quantity_before,quantity_delta,quantity_after,unit_cost,value_delta,payload)
    SELECT id,current_tenant,p->>'id',now(),0,qty,qty,cost,qty*cost,
      jsonb_build_object('id',id,'date',now(),'product',p->>'id','productName',p->>'name','sku',p->>'sku',
        'kind','baseline','before',0,'delta',qty,'after',qty,'unitCost',cost,'valueDelta',qty*cost,
        'reason','Opening snapshot; earlier movement history unavailable','source',p->>'id','actor','System migration')
    FROM openings;
  END LOOP;
  PERFORM set_config('app.tenant_id','',true);
END $$;

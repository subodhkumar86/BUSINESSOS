CREATE TABLE warehouse_stock (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  location_id uuid NOT NULL REFERENCES warehouse_locations(id),
  product_id text NOT NULL,
  quantity integer NOT NULL CHECK(quantity >= 0),
  PRIMARY KEY(tenant_id,location_id,product_id)
);
ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock FORCE ROW LEVEL SECURITY;
CREATE POLICY warehouse_stock_scope ON warehouse_stock
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE warehouse_movements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id),
  location_id uuid REFERENCES warehouse_locations(id),
  product_id text NOT NULL,
  quantity_delta integer NOT NULL CHECK(quantity_delta <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE warehouse_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY warehouse_movements_scope ON warehouse_movements
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER warehouse_movements_immutable BEFORE UPDATE OR DELETE ON warehouse_movements
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();

ALTER TABLE stock_transfers ADD COLUMN request_key uuid;
CREATE UNIQUE INDEX transfers_request ON stock_transfers(tenant_id,request_key);

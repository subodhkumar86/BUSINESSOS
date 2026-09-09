CREATE TABLE warehouse_shipments (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 order_ref text NOT NULL,
 customer text NOT NULL,
 product_id text NOT NULL,
 product_name text NOT NULL,
 quantity integer NOT NULL CHECK(quantity > 0 AND quantity <= 100000000),
 source_location_id uuid REFERENCES warehouse_locations(id),
 status text NOT NULL DEFAULT 'picking' CHECK(status IN ('picking','packed','dispatched','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 stock_movement_id uuid REFERENCES stock_movements(id),
 dispatched_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='dispatched') = (stock_movement_id IS NOT NULL AND dispatched_at IS NOT NULL))
);
CREATE INDEX warehouse_shipments_tenant ON warehouse_shipments(tenant_id,created_at DESC);
ALTER TABLE warehouse_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY shipment_scope ON warehouse_shipments
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE shipment_requests (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 response jsonb NOT NULL,
 PRIMARY KEY(tenant_id,request_key)
);
ALTER TABLE shipment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY shipment_request_scope ON shipment_requests
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER shipment_requests_immutable BEFORE UPDATE OR DELETE ON shipment_requests
 FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();

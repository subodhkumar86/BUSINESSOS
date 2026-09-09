CREATE TABLE shipment_returns (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 shipment_id uuid NOT NULL REFERENCES warehouse_shipments(id),
 quantity integer NOT NULL CHECK(quantity > 0 AND quantity <= 100000000),
 reason text NOT NULL,
 destination_location_id uuid REFERENCES warehouse_locations(id),
 status text NOT NULL DEFAULT 'inspecting' CHECK(status IN ('inspecting','inspected','restocked','closed_damaged','cancelled')),
 condition text CHECK(condition IN ('restockable','damaged')),
 inspection_notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 stock_movement_id uuid REFERENCES stock_movements(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='restocked') = (stock_movement_id IS NOT NULL)),
 CHECK(status NOT IN ('inspected','restocked','closed_damaged') OR (condition IS NOT NULL AND length(inspection_notes)>0)),
 CHECK(status <> 'restocked' OR condition='restockable'),
 CHECK(status <> 'closed_damaged' OR condition='damaged')
);
CREATE INDEX shipment_returns_scope ON shipment_returns(tenant_id,shipment_id);
ALTER TABLE shipment_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY shipment_return_scope ON shipment_returns
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE return_requests (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 response jsonb NOT NULL,
 PRIMARY KEY(tenant_id,request_key)
);
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY return_request_scope ON return_requests
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER return_requests_immutable BEFORE UPDATE OR DELETE ON return_requests FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();

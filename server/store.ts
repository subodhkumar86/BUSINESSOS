import { Pool, type PoolClient } from 'pg'
import type { State, Audit, Journal, StockMovement } from '../src/types.ts'
export class Store {
  readonly pool: Pool
  constructor(url: string) {
    this.pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 5000,
      max: 10,
    })
  }
  async tenant<T>(id: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [id])
      const result = await fn(c)
      await c.query('COMMIT')
      return result
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
  }
  async read(c: PoolClient, tenant: string, lock = false) {
    const { rows } = await c.query(
      'SELECT state,version FROM tenants WHERE id=$1' +
        (lock ? ' FOR UPDATE' : ' FOR SHARE'),
      [tenant],
    )
    if (!rows[0]) throw Error('Workspace not found')
    const audit = await c.query(
      'SELECT payload FROM audit WHERE tenant_id=$1 ORDER BY created_at DESC,id',
      [tenant],
    )
    const journals = await c.query(
      'SELECT payload FROM journals WHERE tenant_id=$1 ORDER BY created_at DESC,id',
      [tenant],
    )
    const movements=await c.query('SELECT payload FROM stock_movements WHERE tenant_id=$1 ORDER BY occurred_at DESC,id',[tenant])
    return {
      version: rows[0].version as number,
      state: {
        ...rows[0].state,
        audit: audit.rows.map((r) => r.payload),
        journals: journals.rows.map((r) => r.payload),
        stockMovements:movements.rows.map(r=>r.payload),
      } as State,
    }
  }
  async append(
    c: PoolClient,
    tenant: string,
    entry: Audit | Journal,
    table: 'audit' | 'journals' = 'audit',
  ) {
    await c.query(
      `INSERT INTO ${table}(id,tenant_id,payload) VALUES($1,$2,$3)`,
      [entry.id, tenant, entry],
    )
  }
  async appendStock(c:PoolClient,tenant:string,m:StockMovement){
    await c.query('INSERT INTO stock_movements(id,tenant_id,product_id,occurred_at,quantity_before,quantity_delta,quantity_after,unit_cost,value_delta,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[m.id,tenant,m.product,m.date,m.before,m.delta,m.after,m.unitCost,m.valueDelta,m])
  }
  async checkRuntime() {
    const role = await this.pool.query(
      'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
    if (role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls)
      throw Error(
        'API requires a non-superuser PostgreSQL role without BYPASSRLS.',
      )
    const migrations = await this.pool.query(
      "SELECT name FROM schema_migrations WHERE name='003_stock_ledger.sql'",
    )
    if (!migrations.rowCount)
      throw Error('Database migrations are pending. Run npm run db:migrate.')
  }
  close() {
    return this.pool.end()
  }
}

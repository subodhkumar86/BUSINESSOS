const fs=require('fs');let c=fs.readFileSync('server/store.ts','utf8').replace(/\r\n/g,'\n');c=c.replace('State, Audit, Journal','State, Audit, Journal, StockMovement');c=c.replace("    return {\n      version:","    const movements=await c.query('SELECT payload FROM stock_movements WHERE tenant_id=$1 ORDER BY occurred_at DESC,id',[tenant])\n    return {\n      version:");c=c.replace('journals: journals.rows.map((r) => r.payload),','journals: journals.rows.map((r) => r.payload),\n        stockMovements:movements.rows.map(r=>r.payload),');c=c.replace('  async checkRuntime()',`  async appendStock(c:PoolClient,tenant:string,m:StockMovement){
    await c.query('INSERT INTO stock_movements(id,tenant_id,product_id,occurred_at,quantity_before,quantity_delta,quantity_after,unit_cost,value_delta,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[m.id,tenant,m.product,m.date,m.before,m.delta,m.after,m.unitCost,m.valueDelta,m])
  }
  async checkRuntime()`);c=c.replace('002_account_security.sql','003_stock_ledger.sql');fs.writeFileSync('server/store.ts',c);
c=fs.readFileSync('server/app.ts','utf8').replace(/\r\n/g,'\n');c=c.replace("import { seed, transition } from '../src/domain.ts'","import { seed, transition } from '../src/domain.ts'\nimport { hydrateInventory } from '../src/inventory.ts'");
c=c.replace('            state.sampleData = b.sample',`            state.sampleData = b.sample
            state.stockMovements=hydrateInventory({...state,stockMovements:undefined}).stockMovements
            for(const m of state.stockMovements)m.actor=b.email`);
c=c.replace("              tenant,\n              state,", "              tenant,\n              {...state,stockMovements:[]},");
c=c.replace("            await store.append(c, tenant, {", "            for(const m of state.stockMovements)await store.appendStock(c,tenant,m)\n            await store.append(c, tenant, {");
c=c.replace('          next.audit[0].actor = s.user.email',`          for(const m of next.stockMovements.slice(0,next.stockMovements.length-current.state.stockMovements.length)){
            m.actor=s.user.email
            await store.appendStock(c,s.tenant,m)
          }
          next.audit[0].actor = s.user.email`);
c=c.replace('{ ...next, audit: [], journals: [] }','{ ...next, audit: [], journals: [], stockMovements:[] }');fs.writeFileSync('server/app.ts',c);
fs.writeFileSync('server/migrations/003_stock_ledger.sql',fs.readFileSync('server/migrations/003_stock_ledger.sql','utf8').replace(/^\uFEFF/,''));

const fs=require('fs');let c=fs.readFileSync('src/types.ts','utf8');c=c.replace('export interface State {',`export interface StockMovement {
 id:string
 date:string
 product:string
 productName:string
 sku:string
 kind:'baseline'|'opening'|'receipt'|'adjustment'|'count'
 before:number
 delta:number
 after:number
 unitCost:number
 valueDelta:number
 reason:string
 source:string
 actor:string
}
export interface State {`);c=c.replace('  journals: Journal[]','  journals: Journal[]\n  stockMovements:StockMovement[]');c=c.replace("'audit' | 'journals' | 'payroll'","'audit' | 'journals' | 'payroll' | 'stockMovements'");fs.writeFileSync('src/types.ts',c);
c=fs.readFileSync('src/domain.ts','utf8').replace(/\r\n/g,'\n');c=c.replace("import type { State, Action } from './types'","import type { State, Action } from './types'\nimport {hydrateInventory,stockMovement,inventoryValue} from './inventory.ts'");c=c.replace('export const seed = (): State => ({','export const seed = (): State => hydrateInventory({');c=c.replace('stock: s.products.reduce((a, x) => a + x.qty * x.cost, 0)', 'stock: s.products.reduce((a, x) => a + inventoryValue(x.qty,x.cost), 0)');c=c.replace('const s = structuredClone(state),','const s = hydrateInventory(state),');
c=c.replace("        s.products.unshift({ ...r, id })\n        break",`        const product={...r,id}
        const movement=stockMovement(product,0,r.qty,'opening','Opening stock at product registration',id,date)
        s.products.unshift(product)
        s.stockMovements.unshift(movement)
        if(movement.valueDelta>0)post(movement.valueDelta,'Inventory','Opening balance equity')
        break`);
c=c.replace("        p.qty += order.qty\n        post(order.qty * order.cost, 'Inventory', 'Accounts payable')",`        const movement=stockMovement(p,p.qty,p.qty+order.qty,'receipt','Goods received from '+order.name,order.id,date)
        p.qty=movement.after
        s.stockMovements.unshift(movement)
        post(inventoryValue(order.qty,order.cost), 'Inventory', 'Accounts payable')`);
c=c.replace("  } else if (action.type === 'payroll') {",`  } else if(action.type==='stock_adjust'||action.type==='stock_count'){
    const reason=z.string().trim().min(3,'Add a reason with at least 3 characters.').max(500)
    const base={product:textValue,reason,expectedQty:quantity}
    const result=action.type==='stock_adjust'?z.object({...base,delta:z.coerce.number().int().min(-100000000).max(100000000).refine(n=>n!==0,'Quantity change cannot be zero.')}).strict().safeParse(action.data):z.object({...base,counted:quantity}).strict().safeParse(action.data)
    if(!result.success)throw Error(result.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '))
    const data=result.data,p=s.products.find(p=>p.id===data.product)
    if(!p)throw Error('Product not found in this workspace.')
    if(p.qty!==data.expectedQty)throw Error('Stock changed since this form was opened. Review the latest quantity before saving.')
    const after='delta' in data?p.qty+data.delta:data.counted
    const movement=stockMovement(p,p.qty,after,action.type==='stock_adjust'?'adjustment':'count',data.reason,id,date)
    p.qty=after;s.stockMovements.unshift(movement)
    source=movement.id
    if(movement.delta<0)post(-movement.valueDelta,'Inventory adjustment expense','Inventory')
    if(movement.delta>0)post(movement.valueDelta,'Inventory','Inventory adjustment gain')
  } else if (action.type === 'payroll') {`);
c=c.replace("entity: action.collection || action.type,", "entity: action.type.startsWith('stock_')?'inventory':action.collection || action.type,");c=c.replace("String(action.data?.name || action.name || action.period || '')", "String(action.data?.reason || action.data?.name || action.name || action.period || '')");fs.writeFileSync('src/domain.ts',c);
c=fs.readFileSync('src/App.tsx','utf8').replace("import { Team } from './Team'","import { Team } from './Team'\nimport { hydrateInventory } from './inventory'\nimport { StockPanel } from './StockPanel'");c=c.replace('return { data: parsed, error:', 'return { data: hydrateInventory(parsed), error:');fs.writeFileSync('src/App.tsx',c);

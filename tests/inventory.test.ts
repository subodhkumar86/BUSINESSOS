import test from 'node:test'
import assert from 'node:assert/strict'
import {seed,transition,metrics} from '../src/domain.ts'
import {hydrateInventory,inventoryValue} from '../src/inventory.ts'
import type {State} from '../src/types.ts'
const adjust=(s:State,delta:unknown,reason='Damaged during inspection',product='p1',expectedQty=s.products.find(p=>p.id===product)?.qty)=>transition(s,{type:'stock_adjust',data:{product,delta,reason,expectedQty}})
const count=(s:State,counted:unknown,expectedQty=s.products[0].qty)=>transition(s,{type:'stock_count',data:{product:s.products[0].id,counted,expectedQty,reason:'Cycle count verification'}})
test('damage updates stock, valuation, source journal and audit together',()=>{
 const before=seed(),s=adjust(before,-2),p=s.products.find(p=>p.id==='p1')!,m=s.stockMovements[0],j=s.journals[0]
 assert.equal(p.qty,22);assert.equal(before.products[0].qty,24)
 assert.equal(metrics(s).stock,metrics(before).stock-36000)
 assert.deepEqual([m.before,m.delta,m.after,m.valueDelta],[24,-2,22,-36000])
 assert.deepEqual([j.debit,j.credit,j.amount,j.source],['Inventory adjustment expense','Inventory',36000,m.id])
 assert.equal(s.audit[0].entity,'inventory');assert.match(s.audit[0].detail,/Damaged/)
 assert.equal(metrics(s).cash,metrics(before).cash)
})
test('positive correction increases value and count can reduce to zero',()=>{
 let s=adjust(seed(),3,'Found unrecorded stock')
 assert.equal(s.products[0].qty,27);assert.equal(s.journals[0].credit,'Inventory adjustment gain')
 s=count(s,0);assert.equal(s.products[0].qty,0);assert.equal(s.stockMovements[0].delta,-27)
})
test('matching count records evidence without adding a financial posting',()=>{
 const before=seed(),s=count(before,24)
 assert.equal(s.stockMovements.length,before.stockMovements.length+1)
 assert.equal(s.stockMovements[0].kind,'count');assert.equal(s.stockMovements[0].delta,0)
 assert.equal(s.journals.length,before.journals.length)
})
test('negative stock, fractional input, blank values, forged fields and missing reason are rejected atomically',()=>{
 const s=seed(),saved=JSON.stringify(s)
 for(const invalid of [-25,1.5,0,Infinity,null,true,'','   '])assert.throws(()=>adjust(s,invalid))
 for(const invalid of [-1,1.2,null,true,'',' '])assert.throws(()=>count(s,invalid))
 assert.throws(()=>adjust(s,-1,'  '));assert.throws(()=>adjust(s,1,'Valid reason','foreign-product'))
 assert.throws(()=>transition(s,{type:'stock_adjust',data:{product:'p1',delta:1,expectedQty:24,reason:'Correction',unitCost:1}}))
 assert.equal(JSON.stringify(s),saved)
})
test('stale counts and adjustments cannot overwrite newer quantities',()=>{
 const s=adjust(seed(),4)
 assert.throws(()=>count(s,24,24),/Stock changed/)
 assert.throws(()=>adjust(s,-1,'Correction','p1',24),/Stock changed/)
})
test('purchase receipt adds a single movement linked to its order',()=>{
 let s=transition(seed(),{type:'create',collection:'orders',data:{name:'Supplier',product:'p2',qty:4}})
 const id=s.orders[0].id
 s=transition(s,{type:'status',collection:'orders',id,status:'Approved'})
 s=transition(s,{type:'status',collection:'orders',id,status:'Received'})
 assert.equal(s.stockMovements[0].kind,'receipt');assert.equal(s.stockMovements[0].source,id)
 assert.equal(s.stockMovements[0].delta,4)
 assert.throws(()=>transition(s,{type:'status',collection:'orders',id,status:'Received'}))
})
test('product opening creates stock evidence and opening equity entry',()=>{
 const s=transition(seed(),{type:'create',collection:'products',data:{name:'New item',sku:'NEW-01',qty:3,cost:0.1,min:0}})
 assert.equal(s.stockMovements[0].kind,'opening');assert.equal(s.stockMovements[0].valueDelta,0.3)
 assert.equal(s.journals[0].amount,0.3);assert.equal(s.journals[0].credit,'Opening balance equity')
 assert.equal(inventoryValue(3,0.1),0.3)
 assert.throws(()=>inventoryValue(100000000,1e12),/precision/)
})
test('legacy saved stock gets labelled baselines without inventing financial history',()=>{
 const legacy:Partial<State>=seed();delete legacy.stockMovements
 const s=hydrateInventory(legacy as State)
 assert.equal(s.stockMovements.length,s.products.length);assert.ok(s.stockMovements.every(m=>m.kind==='baseline'))
 assert.equal(s.journals.length,legacy.journals!.length)
 assert.deepEqual(hydrateInventory(s),s)
})
test('ledger deltas reconcile to stock through a sequence of adjustments and counts',()=>{
 let s=seed()
 for(let i=0;i<40;i++){s=adjust(s,i%2===0?2:-1,'Stock verification');if(i%5===0)s=count(s,s.products[0].qty)}
 for(const p of s.products)assert.equal(s.stockMovements.filter(m=>m.product===p.id).reduce((sum,m)=>sum+m.delta,0),p.qty)
})

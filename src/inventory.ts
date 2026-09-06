import type { State,Product,StockMovement } from './types.ts'
export const MAX_STOCK=100_000_000
export function inventoryValue(qty:number,cost:number){
 const minor=Math.round(cost*100)
 if(!Number.isSafeInteger(qty)||Math.abs(qty)>MAX_STOCK||!Number.isSafeInteger(minor)||minor<=0||!Number.isSafeInteger(qty*minor))throw Error('Stock value exceeds the supported precision or quantity range.')
 return qty*minor/100
}
export function stockMovement(product:Product,before:number,after:number,kind:StockMovement['kind'],reason:string,source:string,date=new Date().toISOString()):StockMovement{
 if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||before<0||after<0||after>MAX_STOCK)throw Error('Stock cannot be negative or exceed 100,000,000 units.')
 inventoryValue(before,product.cost);inventoryValue(after,product.cost)
 return {id:crypto.randomUUID(),date,product:product.id,productName:product.name,sku:product.sku,kind,before,delta:after-before,after,unitCost:Math.round(product.cost*100)/100,valueDelta:inventoryValue(after-before,product.cost),reason,source,actor:'Local workspace owner'}
}
// A baseline is a current snapshot, never a reconstruction of historical receipts.
export function hydrateInventory(state:Omit<State,'stockMovements'>&{stockMovements?:StockMovement[]}):State{
 const s=structuredClone(state)
 if(!Array.isArray(s.stockMovements))s.stockMovements=s.products.map(p=>stockMovement(p,0,p.qty,'baseline','Opening snapshot; earlier movement history unavailable',p.id))
 return s as State
}

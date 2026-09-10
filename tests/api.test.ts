import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { createApp } from '../server/app.ts'
import type { Snapshot } from '../src/types.ts'
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw Error(
    'Set TEST_DATABASE_URL and TEST_REDIS_URL to dedicated test services. These tests create isolated test tenants.',
  )
if (new URL(process.env.TEST_DATABASE_URL).pathname !== '/businessos_test')
  throw Error(
    'Integration tests require the dedicated businessos_test database. Use npm run test:stack.',
  )
const origin = 'http://127.0.0.1:5173'
const testPrefix = 'bos-test:' + randomUUID() + ':'
const app = await createApp({
  databaseUrl: process.env.TEST_DATABASE_URL,
  redisUrl: process.env.TEST_REDIS_URL,
  origins: [origin],
  prefix: testPrefix,
})
await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
const address = app.server.address()
if (!address || typeof address === 'string')
  throw Error('Test server did not bind')
const base = `http://127.0.0.1:${address.port}/api/v1`
// Each scenario has its own login-attempt window; production limits remain enabled.
test.beforeEach(async()=>{await app.redis.del(testPrefix+'attempts:127.0.0.1')})
interface Account {
  cookie: string
  snapshot: Snapshot
}
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  account?: Account,
  extra: Record<string, string> = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(account
        ? { Cookie: account.cookie, 'X-CSRF-Token': account.snapshot.csrf }
        : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get('set-cookie')?.split(';')[0] || '',
    headers: res.headers,
  }
}
async function register() {
  const r = await call('/auth/register', 'POST', {
    name: 'Test owner',
    organisation: 'Test ' + randomUUID(),
    email: randomUUID() + '@example.test',
    password: 'test-password-12345',
    sample: true,
  })
  assert.equal(r.status, 201)
  assert.match(r.headers.get('set-cookie') || '', /HttpOnly/)
  return { cookie: r.cookie, snapshot: r.data } as Account
}
let owner: Account, other: Account
const save = (
  account: Account,
  action: unknown,
  key = randomUUID(),
  version = account.snapshot.version,
) =>
  call('/actions', 'POST', { action, version }, account, {
    'Idempotency-Key': key,
  })
try {
  owner = await register()
  other = await register()
  await test('shipment returns enforce inspection and quantity caps and atomically reverse original COGS once',async()=>{
    const a=await register(),b=await register(),product=a.snapshot.state.products[0]
    const location=await call('/warehouse/locations','POST',{name:'Returns store',code:'RET'},a)
    assert.equal(location.status,201)
    assert.equal((await call('/warehouse/transfers','POST',{productId:product.id,quantity:4,sourceLocationId:null,destinationLocationId:location.data.id},a,{'Idempotency-Key':randomUUID()})).status,201)
    const shipment=await call('/warehouse/shipments','POST',{orderRef:'SO-RETURN',customer:'Customer',productId:product.id,quantity:4,sourceLocationId:location.data.id},a,{'Idempotency-Key':randomUUID()})
    assert.equal(shipment.status,201)
    const payload={shipmentId:shipment.data.id,quantity:3,reason:'Customer return',destinationLocationId:location.data.id}
    const create=(input:unknown,key=randomUUID(),actor=a)=>call('/warehouse/shipment-returns','POST',input,actor,{'Idempotency-Key':key})
    const update=(id:string,input:unknown,key=randomUUID(),actor=a)=>call('/warehouse/shipment-returns/'+id,'PATCH',input,actor,{'Idempotency-Key':key})
    assert.equal((await create(payload)).status,409)
    await call('/warehouse/shipments/'+shipment.data.id,'PATCH',{version:1,status:'packed'},a,{'Idempotency-Key':randomUUID()})
    assert.equal((await call('/warehouse/shipments/'+shipment.data.id,'PATCH',{version:2,status:'dispatched'},a,{'Idempotency-Key':randomUUID()})).status,200)
    assert.equal((await create(payload,randomUUID(),b)).status,404)
    const competing=await Promise.all([create(payload),create(payload)])
    assert.deepEqual(competing.map(r=>r.status).sort(),[201,409])
    const first=competing.find(r=>r.status===201)!
    assert.equal((await update(first.data.id,{version:1,status:'cancelled'})).status,200)
    const key=randomUUID(),restock=await create({...payload,quantity:2},key)
    assert.equal(restock.status,201)
    assert.equal((await create({...payload,quantity:2},key)).data.id,restock.data.id)
    assert.equal((await create({...payload,quantity:1},key)).status,409)
    const damaged=await create({...payload,quantity:2})
    assert.equal(damaged.status,201)
    assert.equal((await create({...payload,quantity:1})).status,409)
    assert.equal((await call('/warehouse/shipment-returns/'+restock.data.id,'GET',undefined,b)).status,404)
    assert.equal((await update(restock.data.id,{version:1,status:'restocked'})).status,409)
    assert.equal((await update(restock.data.id,{version:1,status:'inspected',condition:'restockable'})).status,400)
    assert.equal((await update(restock.data.id,{version:1,status:'inspected',condition:'restockable',inspectionNotes:'Sealed and undamaged'})).status,200)
    assert.equal((await update(restock.data.id,{version:1,status:'cancelled'})).status,409)
    const before=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(before.products.find((p:any)=>p.id===product.id).qty,product.qty-4)
    const restockKey=randomUUID(),posted=await Promise.all([update(restock.data.id,{version:2,status:'restocked'},restockKey),update(restock.data.id,{version:2,status:'restocked'},restockKey)])
    assert.deepEqual(posted.map(r=>r.status),[200,200])
    assert.equal(posted[0].data.stock_movement_id,posted[1].data.stock_movement_id)
    const after=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(after.products.find((p:any)=>p.id===product.id).qty,product.qty-2)
    assert.equal(after.journals.length,before.journals.length+1)
    const movement=after.stockMovements.find((m:any)=>m.id===posted[0].data.stock_movement_id)
    assert.equal(movement.kind,'return');assert.equal(movement.source,restock.data.id);assert.equal(movement.valueDelta,2*product.cost)
    const journal=after.journals.find((j:any)=>j.source===movement.id)
    assert.equal(journal.debit,'Inventory');assert.equal(journal.credit,'Cost of goods sold');assert.equal(journal.amount,2*product.cost)
    const tenantId=(await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1',[a.snapshot.user.id])).rows[0].tenant_id
    await app.store.tenant(tenantId,async c=>{assert.equal(Number((await c.query('SELECT quantity FROM warehouse_stock WHERE tenant_id=$1 AND location_id=$2 AND product_id=$3',[tenantId,location.data.id,product.id])).rows[0].quantity),2)})
    assert.equal((await update(damaged.data.id,{version:1,status:'inspected',condition:'damaged',inspectionNotes:'Broken casing'})).status,200)
    assert.equal((await update(damaged.data.id,{version:2,status:'restocked'})).status,409)
    assert.equal((await update(damaged.data.id,{version:2,status:'closed_damaged'})).status,200)
    const final=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(final.products.find((p:any)=>p.id===product.id).qty,product.qty-2)
    assert.equal(final.journals.length,after.journals.length)
    assert.equal((await update(restock.data.id,{version:3,status:'cancelled'})).status,409)
    assert.equal((await app.store.pool.query('SELECT * FROM shipment_returns')).rowCount,0)
    const audit=await call('/audit-logs','GET',undefined,a)
    assert.ok(audit.data.entries.some((row:any)=>row.action==='shipment_return_restocked'))
    const email=randomUUID()+'@example.test',password='return-test-password-123'
    await call('/users','POST',{name:'Return auditor',email,password,role:'auditor'},a)
    const login=await call('/auth/login','POST',{email,password}),auditor={cookie:login.cookie,snapshot:login.data} as Account
    assert.equal((await call('/warehouse/shipment-returns','GET',undefined,auditor)).status,200)
    assert.equal((await create(payload,randomUUID(),auditor)).status,403)
    assert.equal((await update(restock.data.id,{version:3,status:'cancelled'},randomUUID(),auditor)).status,403)
  })

  await test('shipments atomically post location stock and COGS with replay, concurrency and tenant protection',async()=>{
    const a=await register(),b=await register()
    const product=a.snapshot.state.products[0],initialQty=product.qty
    const location=await call('/warehouse/locations','POST',{name:'Dispatch warehouse',code:'DSP'},a)
    assert.equal(location.status,201)
    const transfer=await call('/warehouse/transfers','POST',{productId:product.id,quantity:4,sourceLocationId:null,destinationLocationId:location.data.id},a,{'Idempotency-Key':randomUUID()})
    assert.equal(transfer.status,201)
    const input={orderRef:'SO-INTEGRATED',customer:'Customer',productId:product.id,quantity:3,sourceLocationId:location.data.id}
    const create=(data:unknown,key=randomUUID(),account=a)=>call('/warehouse/shipments','POST',data,account,{'Idempotency-Key':key})
    const change=(id:string,version:number,status:string,key=randomUUID(),account=a)=>call('/warehouse/shipments/'+id,'PATCH',{version,status},account,{'Idempotency-Key':key})
    const createKey=randomUUID(),created=await create(input,createKey)
    assert.equal(created.status,201)
    assert.equal((await create(input,createKey)).data.id,created.data.id)
    assert.equal((await create({...input,quantity:2},createKey)).status,409)
    assert.equal((await create(input,randomUUID(),b)).status,404)
    assert.equal((await call('/warehouse/shipments/'+created.data.id,'GET',undefined,b)).status,404)
    assert.equal((await change(created.data.id,1,'packed',randomUUID(),b)).status,404)
    assert.equal((await change(created.data.id,1,'dispatched')).status,409)
    const before=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(before.products.find((p:any)=>p.id===product.id).qty,initialQty)
    assert.equal((await change(created.data.id,1,'packed')).status,200)
    assert.equal((await change(created.data.id,1,'cancelled')).status,409)
    const dispatchKey=randomUUID(),retries=await Promise.all([change(created.data.id,2,'dispatched',dispatchKey),change(created.data.id,2,'dispatched',dispatchKey)])
    assert.deepEqual(retries.map(result=>result.status),[200,200])
    assert.equal(retries[0].data.stock_movement_id,retries[1].data.stock_movement_id)
    const after=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(after.products.find((p:any)=>p.id===product.id).qty,initialQty-3)
    const movement=after.stockMovements.find((m:any)=>m.id===retries[0].data.stock_movement_id)
    assert.equal(movement.source,created.data.id)
    assert.equal(movement.actor,a.snapshot.user.email)
    assert.equal(movement.valueDelta,-3*product.cost)
    const journals=after.journals.filter((j:any)=>j.source===movement.id)
    assert.equal(journals.length,1)
    assert.equal(journals[0].debit,'Cost of goods sold')
    assert.equal(journals[0].credit,'Inventory')
    assert.equal(journals[0].amount,3*product.cost)
    const second=await create({...input,orderRef:'SO-INSUFFICIENT'})
    assert.equal((await change(second.data.id,1,'packed')).status,200)
    assert.equal((await change(second.data.id,2,'dispatched')).status,409)
    const still=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(still.journals.length,after.journals.length)
    assert.equal(still.products.find((p:any)=>p.id===product.id).qty,initialQty-3)
    assert.equal((await call('/warehouse/shipments/'+second.data.id,'GET',undefined,a)).data.shipments[0].status,'packed')
    const reserved=await create({...input,orderRef:'SO-UNALLOCATED',quantity:initialQty-3,sourceLocationId:null})
    assert.equal((await change(reserved.data.id,1,'packed')).status,200)
    assert.equal((await change(reserved.data.id,2,'dispatched')).status,409)
    assert.equal((await change(created.data.id,3,'cancelled')).status,409)
    const small=await create({...input,orderRef:'SO-SMALL',quantity:2,sourceLocationId:null})
    assert.equal((await change(small.data.id,1,'packed')).status,200)
    assert.equal((await change(small.data.id,2,'dispatched')).status,200)
    const final=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(final.products.find((p:any)=>p.id===product.id).qty,initialQty-5)
    assert.equal(final.journals.length,after.journals.length+1)
    const tenantId=(await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1',[a.snapshot.user.id])).rows[0].tenant_id
    await app.store.tenant(tenantId,async c=>{
      const balance=(await c.query('SELECT quantity FROM warehouse_stock WHERE tenant_id=$1 AND location_id=$2 AND product_id=$3',[tenantId,location.data.id,product.id])).rows[0]
      assert.equal(balance.quantity,1)
    })
    const contenderA=await create({...input,orderRef:'SO-RACE-A',quantity:1}),contenderB=await create({...input,orderRef:'SO-RACE-B',quantity:1})
    await change(contenderA.data.id,1,'packed');await change(contenderB.data.id,1,'packed')
    const concurrent=await Promise.all([change(contenderA.data.id,2,'dispatched'),change(contenderB.data.id,2,'dispatched')])
    assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409])
    const raced=(await call('/workspace','GET',undefined,a)).data.state
    assert.equal(raced.products.find((p:any)=>p.id===product.id).qty,initialQty-6)

    assert.equal((await app.store.pool.query('SELECT * FROM warehouse_shipments')).rowCount,0)
    const email=randomUUID()+'@example.test',password='shipment-test-password-123'
    assert.equal((await call('/users','POST',{name:'Shipment auditor',email,password,role:'auditor'},a)).status,201)
    const login=await call('/auth/login','POST',{email,password}),auditor={cookie:login.cookie,snapshot:login.data} as Account
    assert.equal((await call('/warehouse/shipments','GET',undefined,auditor)).status,200)
    assert.equal((await create(input,randomUUID(),auditor)).status,403)
    assert.equal((await change(second.data.id,2,'cancelled',randomUUID(),auditor)).status,403)
  })


  await test('platform plan assignment exposes metadata only and enforces administrator access and seat limits',async()=>{
    const adminOwner=await register(),target=await register()
    await app.store.pool.query("UPDATE users SET role='super_admin',session_version=session_version+1 WHERE id=$1",[adminOwner.snapshot.user.id])
    const logged=await call('/auth/login','POST',{email:adminOwner.snapshot.user.email,password:'test-password-12345'})
    assert.equal(logged.status,200)
    const admin={cookie:logged.cookie,snapshot:logged.data} as Account
    assert.equal((await call('/admin/tenants','GET',undefined,target)).status,403)
    const directory=await call('/admin/tenants','GET',undefined,admin)
    assert.equal(directory.status,200)
    const row=directory.data.tenants.find((item:any)=>item.name===target.snapshot.state.organisation)
    assert.ok(row)
    assert.deepEqual(Object.keys(row).sort(),['currency','id','name','plan_id','seats'])
    const path='/admin/tenants/'+row.id+'/plan'
    assert.equal((await call(path,'PATCH',{planId:'starter',expectedPlanId:'business_pro'},target)).status,403)
    assert.equal((await call(path,'PATCH',{planId:'starter',expectedPlanId:'business_pro'},admin)).status,200)
    assert.equal((await call(path,'PATCH',{planId:'enterprise',expectedPlanId:'business_pro'},admin)).status,409)
    assert.equal((await call('/workspace','GET',undefined,target)).data.entitlements.plan,'starter')
    assert.equal((await call('/workflows/goals','GET',undefined,target)).status,403)
    const response=await fetch(base+'/finance/export.xlsx',{headers:{Origin:origin,Cookie:target.cookie}})
    assert.equal(response.status,403)
    await app.store.tenant(row.id,async c=>{for(let i=0;i<5;i++)await c.query("INSERT INTO users(id,tenant_id,name,email,password,role) VALUES($1,$2,'Seat',$3,'unused','employee')",[randomUUID(),row.id,randomUUID()+'@example.test'])})
    assert.equal((await call(path,'PATCH',{planId:'starter',expectedPlanId:'starter'},admin)).status,409)
    const audit=await call('/audit-logs','GET',undefined,target)
    assert.ok(audit.data.entries.some((item:any)=>item.action==='tenant_plan_assigned'))
  })
  await test('PRD workflows persist, enforce roles and tenants, and reject conflicts and stale approvals', async()=>{
    const account=await register(),foreign=await register()
    const employeeId=account.snapshot.state.employees[0].id
    async function user(role:string){
      const email=randomUUID()+'@example.test',password='workflow-test-password-123'
      assert.equal((await call('/users','POST',{name:role,email,password,role},account)).status,201)
      const result=await call('/auth/login','POST',{email,password})
      return {cookie:result.cookie,snapshot:result.data} as Account
    }
    const hr=await user('hr_admin'),staff=await user('employee'),auditor=await user('auditor')
    const create=(kind:string,input:unknown,key=randomUUID(),actor=account)=>call('/workflows/'+kind,'POST',input,actor,{'Idempotency-Key':key})
    const leave={employeeId,startDate:'2026-11-01',endDate:'2026-11-03',reason:'Annual leave'}
    const key=randomUUID(),created=await create('leave',leave,key)
    assert.equal(created.status,201)
    assert.equal((await create('leave',leave,key)).data.id,created.data.id)
    assert.equal((await create('leave',{...leave,reason:'Changed'},key)).status,409)
    assert.equal((await create('leave',leave)).status,409)
    const path='/workflows/leave/'+created.data.id
    assert.equal((await call(path,'GET',undefined,foreign)).status,404)
    assert.equal((await call(path,'PATCH',{version:1,status:'approved'},account)).status,403)
    assert.equal((await call(path,'PATCH',{version:1,status:'approved'},hr)).status,200)
    assert.equal((await call(path,'PATCH',{version:1,status:'rejected'},hr)).status,409)
    assert.equal((await call('/workflows/leave','GET',undefined,staff)).status,403)
    assert.equal((await create('leave',{...leave,employeeId:'foreign'})).status,404)
    assert.equal((await create('leave',{...leave,startDate:'2026-12-01',endDate:'2026-12-02'},randomUUID(),auditor)).status,403)
    const appointment={title:'Visit',guest:'Guest',host:'Host',room:'Boardroom',startAt:'2026-11-01T09:00:00Z',endAt:'2026-11-01T10:00:00Z'}
    const bookings=await Promise.all([create('appointments',appointment),create('appointments',{...appointment,room:'boardroom'})])
    assert.deepEqual(bookings.map(r=>r.status).sort(),[201,409])
    assert.equal((await create('appointments',{...appointment,startAt:'2026-11-01T10:00:00Z',endAt:'2026-11-01T11:00:00Z'})).status,201)
    const goal=await create('goals',{employeeId,title:'Orders shipped',target:10,unit:'orders',dueDate:'2026-12-01'})
    assert.equal(goal.status,201)
    assert.equal((await call('/workflows/goals/'+goal.data.id,'PATCH',{version:1,status:'completed'},hr)).status,409)
    assert.equal((await call('/workflows/goals/'+goal.data.id,'PATCH',{version:1,status:'completed',progress:10},hr)).status,200)
    const finding=await create('findings',{title:'Safety audit',assignee:'Operations',severity:'high',dueDate:'2026-12-01',correctiveAction:'Repair fire door'})
    assert.equal(finding.status,201)
    const findingPath='/workflows/findings/'+finding.data.id
    assert.equal((await call(findingPath,'PATCH',{version:1,status:'in_progress'},account)).status,200)
    assert.equal((await call(findingPath,'PATCH',{version:2,status:'closed'},account)).status,409)
    assert.equal((await call(findingPath,'PATCH',{version:2,status:'closed',evidence:'Repair inspected'},account)).status,200)
    assert.equal((await create('certifications',{title:'Safety policy',issuer:'Operations',reference:'P1',expiresOn:'2027-01-01'})).status,201)
    const article=await create('knowledge',{title:'Returns',category:'Support',content:'Contact the support team with your order reference.'})
    assert.equal(article.status,201)
    const articlePath='/workflows/knowledge/'+article.data.id
    assert.equal((await call(articlePath,'GET',undefined,staff)).status,404)
    assert.equal((await call(articlePath,'PATCH',{version:1,status:'published'},account)).status,200)
    assert.equal((await call(articlePath,'GET',undefined,staff)).status,200)
    assert.equal((await call(articlePath,'PATCH',{version:2,status:'archived'},account)).status,200)
    assert.equal((await call(articlePath,'GET',undefined,staff)).status,404)
    const logs=await call('/audit-logs','GET',undefined,account)
    assert.ok(logs.data.entries.some((row:any)=>row.action==='leave_updated'))
    assert.equal((await call('/workflows/findings','GET',undefined,auditor)).status,200)
  })

  await test('recruitment isolates tenants, rejects stale and skipped stages, and audits changes', async () => {
    const created = await call('/hr/candidates','POST',{name:'Candidate',email:'candidate@example.test',position:'Engineer'},owner)
    assert.equal(created.status,201)
    const path='/hr/candidates/'+created.data.id
    assert.equal((await call(path,'PATCH',{version:1,status:'screening'},other)).status,404)
    const otherList=await call('/hr/candidates','GET',undefined,other)
    assert.ok(!otherList.data.candidates.some((row:any)=>row.id===created.data.id))
    assert.equal((await call(path,'PATCH',{version:1,status:'hired'},owner)).status,409)
    assert.equal((await call(path,'PATCH',{version:1,status:'screening'},owner)).status,200)
    assert.equal((await call(path,'PATCH',{version:1,status:'interview'},owner)).status,409)
    assert.equal((await call(path,'PATCH',{version:2,status:'interview'},owner)).status,200)
    assert.equal((await call('/hr/candidates','POST',{name:'Forged',email:'candidate@example.test',position:'Engineer',tenantId:randomUUID()},owner)).status,400)
    const logs=await call('/audit-logs','GET',undefined,owner)
    assert.ok(logs.data.entries.some((row:any)=>JSON.stringify(row).includes('candidate_stage_updated')))
  })
  await test('customer profiles and history enforce tenant boundaries, versions, validation and audit', async () => {
    const a=owner, b=other
    const profile={name:'Customer One',email:'customer@example.test',phone:'+2341234567',address:'Lagos',taxReference:'REF-01',status:'active'}
    const created=await call('/crm/customers','POST',profile,a)
    assert.equal(created.status,201)
    const path='/crm/customers/'+created.data.id
    assert.equal((await call(path,'GET',undefined,b)).status,404)
    assert.equal((await call(path+'/interactions','POST',{kind:'note',summary:'Forbidden',occurredAt:'2026-09-01T10:00:00Z'},b)).status,404)
    assert.equal((await call('/crm/customers','POST',{...profile,tenantId:'injected'},a)).status,400)
    assert.equal((await call(path,'PATCH',{...profile,name:'Updated',version:1},a)).status,200)
    assert.equal((await call(path,'PATCH',{...profile,version:1},a)).status,409)
    const interaction={kind:'call',summary:'Discussed delivery and next order',occurredAt:'2026-09-01T10:00:00Z',followUpOn:'2026-09-10'}
    assert.equal((await call(path+'/interactions','POST',interaction,a)).status,201)
    const history=await call(path+'/interactions','GET',undefined,a)
    assert.equal(history.data.interactions.length,1)
    assert.equal(history.data.interactions[0].summary,interaction.summary)
    assert.equal((await call(path+'/interactions','POST',{...interaction,occurredAt:'invalid'},a)).status,400)
    const audit=await call('/audit-logs','GET',undefined,a)
    assert.ok(audit.data.entries.some((row: any)=>JSON.stringify(row).includes('customer_interaction_logged')))
    const tenant=(await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1',[a.snapshot.user.id])).rows[0].tenant_id
    await app.store.tenant(tenant,async c=>{
      assert.equal((await c.query('SELECT count(*)::int AS n FROM customers')).rows[0].n,1)
    })
  })
  await test('financial statement API validates calendar periods and rejects unsupported parameters',async()=>{
    assert.equal((await call('/finance/statements?from=2026-09-01&to=2026-09-30','GET',undefined,owner)).status,200)
    assert.equal((await call('/finance/statements?from=2026-09-30&to=2026-09-01','GET',undefined,owner)).status,400)
    assert.equal((await call('/finance/statements?to=2026-02-30','GET',undefined,owner)).status,400)
    assert.equal((await call('/finance/statements?tenant=other','GET',undefined,owner)).status,400)
  })
  await test('unauthenticated, cross-origin and missing CSRF requests are rejected', async () => {
    assert.equal((await call('/workspace')).status, 401)
    assert.equal(
      (
        await call('/auth/register', 'POST', {}, undefined, {
          Origin: 'https://evil.example',
        })
      ).status,
      403,
    )
    assert.equal(
      (await call('/actions', 'POST', {}, owner, { 'X-CSRF-Token': '' }))
        .status,
      403,
    )
  })
  await test('tenant owners cannot access platform-admin endpoints', async () => {
    for (const path of [
      '/admin/overview',
      '/admin/plans',
      '/admin/integrations',
      '/admin/ai-controls',
    ]) {
      assert.equal((await call(path, 'GET', undefined, owner)).status, 403)
    }
  })
  await test('tenant is derived from session; foreign record IDs and tenant injection are rejected', async () => {
    const r = await save(other, {
      type: 'create',
      collection: 'tasks',
      data: { name: 'Private other task' },
    })
    assert.equal(r.status, 200)
    other.snapshot = r.data
    const id = r.data.state.tasks[0].id
    assert.equal(
      (
        await save(owner, {
          type: 'status',
          collection: 'tasks',
          id,
          status: 'Completed',
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await save(owner, {
          type: 'settings',
          name: 'Hijacked',
          tenant: other.snapshot.user.id,
        })
      ).status,
      400,
    )
    const workspace = await call('/workspace', 'GET', undefined, owner)
    assert.equal(
      workspace.data.state.tasks.some((t: { id: string }) => t.id === id),
      false,
    )
  })
  await test('version checking and idempotency preserve one invoice and one posting', async () => {
    const key = randomUUID(),
      action = {
        type: 'create',
        collection: 'invoices',
        data: { name: 'Integration invoice', amount: 1200 },
      },
      before = owner.snapshot.version
    const r = await save(owner, action, key)
    assert.equal(r.status, 200)
    owner.snapshot = r.data
    const again = await save(owner, action, key, before)
    assert.equal(again.status, 200)
    assert.equal(again.data.version, r.data.version)
    assert.equal(
      again.data.state.invoices.filter(
        (i: { name: string }) => i.name === 'Integration invoice',
      ).length,
      1,
    )
    assert.equal(
      (
        await save(
          owner,
          { ...action, data: { name: 'Changed', amount: 2 } },
          key,
        )
      ).status,
      409,
    )
    assert.equal(
      (
        await save(
          owner,
          { type: 'create', collection: 'tasks', data: { name: 'Stale' } },
          randomUUID(),
          before,
        )
      ).status,
      409,
    )
  })
  await test('strict server schema rejects omitted required values and forged posted status', async () => {
    assert.equal(
      (
        await save(owner, {
          type: 'create',
          collection: 'invoices',
          data: { name: 'Missing amount' },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await save(owner, {
          type: 'create',
          collection: 'invoices',
          data: { name: 'Forged', amount: 100, status: 'Paid' },
        })
      ).status,
      400,
    )
    assert.equal(
      (await save(owner, { type: 'payroll', period: '2026-13' })).status,
      400,
    )
  })
  await test('purchase lifecycle persists stock, payable and immutable source journal', async () => {
    const p = owner.snapshot.state.products[0],
      qty = p.qty
    const email = randomUUID() + '@example.test',
      password = 'procurement-role-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Procurement', email, password, role: 'operations_manager' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    const procurement = {
      cookie: login.cookie,
      snapshot: login.data,
    } as Account
    let r = await save(procurement, {
      type: 'create',
      collection: 'orders',
      data: { name: 'Integration supplier', product: p.id, qty: 3 },
    })
    assert.equal(r.status, 200)
    procurement.snapshot = r.data
    const id = r.data.state.orders[0].id
    assert.equal(
      (
        await save(procurement, {
          type: 'status',
          collection: 'orders',
          id,
          status: 'Approved',
        })
      ).status,
      400,
    )
    owner.snapshot = (await call('/workspace', 'GET', undefined, owner)).data
    r = await save(owner, {
      type: 'status',
      collection: 'orders',
      id,
      status: 'Approved',
    })
    assert.equal(r.status, 200)
    owner.snapshot = r.data
    assert.equal(
      r.data.state.orders.find((order: { id: string }) => order.id === id)
        .approvedBy,
      owner.snapshot.user.email,
    )
    r = await save(owner, {
      type: 'status',
      collection: 'orders',
      id,
      status: 'Received',
    })
    assert.equal(r.status, 200)
    owner.snapshot = r.data
    assert.equal(
      r.data.state.products.find((x: { id: string }) => x.id === p.id).qty,
      qty + 3,
    )
    assert.equal(r.data.state.journals[0].source, id)
    assert.equal(
      (
        await save(owner, {
          type: 'status',
          collection: 'orders',
          id,
          status: 'Received',
        })
      ).status,
      400,
    )
  })
  await test('auditor can read its workspace and cannot mutate or create users', async () => {
    const email = randomUUID() + '@example.test',
      password = 'auditor-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Auditor', email, password, role: 'auditor' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    assert.equal(login.status, 200)
    const auditor = { cookie: login.cookie, snapshot: login.data }
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      200,
    )
    assert.equal(
      (await save(auditor, { type: 'settings', name: 'Forbidden' })).status,
      403,
    )
    assert.equal((await call('/crm/customers','GET',undefined,auditor)).status,200)
    assert.equal((await call('/crm/customers','POST',{name:'Forbidden'},auditor)).status,403)
    assert.equal((await call('/users', 'GET', undefined, auditor)).status, 403)
    assert.equal((await call('/auth/logout', 'POST', {}, auditor)).status, 200)
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      401,
    )
  })
  await test('module roles can perform permitted actions and are denied outside their scope', async () => {
    const financeEmail = randomUUID() + '@example.test',
      employeeEmail = randomUUID() + '@example.test',
      password = 'role-password-123'
    for (const [name, email, role] of [
      ['Finance', financeEmail, 'finance_admin'],
      ['Employee', employeeEmail, 'employee'],
    ])
      assert.equal(
        (await call('/users', 'POST', { name, email, password, role }, owner))
          .status,
        201,
      )
    const financeLogin = await call('/auth/login', 'POST', {
      email: financeEmail,
      password,
    })
    const employeeLogin = await call('/auth/login', 'POST', {
      email: employeeEmail,
      password,
    })
    const finance = {
      cookie: financeLogin.cookie,
      snapshot: financeLogin.data,
    } as Account
    const employee = {
      cookie: employeeLogin.cookie,
      snapshot: employeeLogin.data,
    } as Account
    assert.equal(
      (
        await save(finance, {
          type: 'create',
          collection: 'expenses',
          data: { name: 'Role expense', amount: 10 },
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await save(finance, {
          type: 'create',
          collection: 'employees',
          data: { name: 'Denied', department: 'Ops', amount: 10 },
        })
      ).status,
      403,
    )
    employee.snapshot = (
      await call('/workspace', 'GET', undefined, employee)
    ).data
    assert.equal(employee.snapshot.state.invoices.length, 0)
    assert.equal(employee.snapshot.state.employees.length, 0)
    assert.equal(employee.snapshot.state.tasks.length > 0, true)
    assert.equal(finance.snapshot.state.employees.length, 0)
    assert.equal(
      (
        await save(employee, {
          type: 'create',
          collection: 'tasks',
          data: { name: 'My task' },
        })
      ).status,
      200,
    )
    assert.equal(
      (await call('/tax/filings', 'GET', undefined, finance)).status,
      200,
    )
    for (const path of [
      '/support/tickets',
      '/tax/filings',
      '/warehouse/locations',
      '/suppliers',
    ])
      assert.equal((await call(path, 'GET', undefined, employee)).status, 403)
  })
  await test('finance admins can register tenant-scoped bank accounts', async () => {
    const email = randomUUID() + '@example.test',
      password = 'bank-role-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Bank finance', email, password, role: 'finance_admin' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    const finance = { cookie: login.cookie, snapshot: login.data } as Account
    const created = await call(
      '/banks/accounts',
      'POST',
      {
        provider: 'manual',
        externalRef: randomUUID(),
        name: 'Operating account',
        currency: 'NGN',
      },
      finance,
    )
    assert.equal(created.status, 201)
    const listed = await call('/banks/accounts', 'GET', undefined, finance)
    assert.equal(listed.status, 200)
    assert.equal(listed.data.accounts.length, 1)
    const accountId = listed.data.accounts[0].id
    const invoice = await save(finance, {
      type: 'create',
      collection: 'invoices',
      data: { name: 'Bank matching invoice', amount: 2500 },
    })
    assert.equal(invoice.status, 200)
    finance.snapshot = invoice.data
    const transaction = await call(
      `/banks/accounts/${accountId}/transactions`,
      'POST',
      {
        externalRef: randomUUID(),
        occurredAt: new Date().toISOString(),
        amount: 2500,
        direction: 'credit',
        reference: 'Customer settlement',
      },
      finance,
    )
    assert.equal(transaction.status, 201)
    assert.equal(transaction.data.match_status, 'suggested')
    assert.equal(transaction.data.matched_entity_type, 'invoice')
    const reconciled = await call(
      `/banks/accounts/${accountId}/transactions/${transaction.data.id}`,
      'PATCH',
      { matchStatus: 'matched' },
      finance,
    )
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled.data))
    assert.equal(reconciled.data.invoiceSettled, true)
    const workspace = await call('/workspace', 'GET', undefined, finance)
    assert.equal(
      workspace.data.state.invoices.find(
        (item: { id: string }) => item.id === invoice.data.state.invoices[0].id,
      ).status,
      'Paid',
    )
    assert.equal(
      workspace.data.state.journals.some(
        (item: { source: string; debit: string; credit: string }) =>
          item.source === invoice.data.state.invoices[0].id &&
          item.debit === 'Cash' &&
          item.credit === 'Accounts receivable',
      ),
      true,
    )
    assert.equal(
      (
        await call(
          `/banks/accounts/${accountId}/transactions`,
          'GET',
          undefined,
          finance,
        )
      ).data.transactions[0].match_status,
      'matched',
    )
    assert.equal(
      (await call('/banks/accounts', 'GET', undefined, other)).data.accounts.length,
      0,
    )
  })
  await test('payroll payment batches require approval, finance authority, and an idempotency key', async () => {
    const password = 'payroll-workflow-password-123',
      hrEmail = randomUUID() + '@example.test',
      financeEmail = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Payroll HR', email: hrEmail, password, role: 'hr_admin' },
          owner,
        )
      ).status,
      201,
    )
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Payroll finance',
            email: financeEmail,
            password,
            role: 'finance_admin',
          },
          owner,
        )
      ).status,
      201,
    )
    const hrLogin = await call('/auth/login', 'POST', {
      email: hrEmail,
      password,
    })
    const financeLogin = await call('/auth/login', 'POST', {
      email: financeEmail,
      password,
    })
    const hr = { cookie: hrLogin.cookie, snapshot: hrLogin.data } as Account
    const finance = {
      cookie: financeLogin.cookie,
      snapshot: financeLogin.data,
    } as Account
    const drafted = await save(hr, { type: 'payroll', period: '2026-10' })
    assert.equal(drafted.status, 200)
    const payrollId = drafted.data.state.payroll[0].id
    const key = randomUUID()
    assert.equal(
      (
        await call(
          `/payroll/runs/${payrollId}/payment-batches`,
          'POST',
          {},
          finance,
          { 'Idempotency-Key': key },
        )
      ).status,
      400,
    )
    owner.snapshot = (await call('/workspace', 'GET', undefined, owner)).data
    const approved = await save(owner, {
      type: 'status',
      collection: 'payroll',
      id: payrollId,
      status: 'Approved',
    })
    assert.equal(approved.status, 200)
    finance.snapshot = (
      await call('/workspace', 'GET', undefined, finance)
    ).data
    assert.equal(
      (
        await call(
          `/payroll/runs/${payrollId}/payment-batches`,
          'POST',
          {},
          hr,
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
      403,
    )
    const created = await call(
      `/payroll/runs/${payrollId}/payment-batches`,
      'POST',
      {},
      finance,
      { 'Idempotency-Key': key },
    )
    assert.equal(created.status, 201)
    assert.equal(created.data.batch.status, 'pending')
    const retry = await call(
      `/payroll/runs/${payrollId}/payment-batches`,
      'POST',
      {},
      finance,
      { 'Idempotency-Key': key },
    )
    assert.equal(retry.status, 201)
    assert.equal(retry.data.batch.id, created.data.batch.id)
    assert.equal(
      (
        await call(
          `/payroll/runs/${payrollId}/payment-batches`,
          'POST',
          {},
          finance,
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
      409,
    )
  })
  await test('finance CSV exports are tenant-scoped, audited, and role-protected', async () => {
    const financeEmail = randomUUID() + '@example.test',
      password = 'export-role-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Export finance',
            email: financeEmail,
            password,
            role: 'finance_admin',
          },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', {
      email: financeEmail,
      password,
    })
    const finance = { cookie: login.cookie, snapshot: login.data } as Account
    const response = await fetch(base + '/finance/export.csv', {
      headers: { Origin: origin, Cookie: finance.cookie },
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /^text\/csv/)
    assert.match(
      response.headers.get('content-disposition') || '',
      /businessos-finance-report\.csv/,
    )
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(await response.text(), /Closing cash/)
    const workbookResponse=await fetch(base+'/finance/export.xlsx?from=2000-01-01&to=2000-01-31',{headers:{Origin:origin,Cookie:finance.cookie}})
    assert.equal(workbookResponse.status,200)
    assert.match(workbookResponse.headers.get('content-type')||'',/spreadsheetml/)
    const workbook=Buffer.from(await workbookResponse.arrayBuffer())
    assert.equal(workbook.readUInt32LE(0),0x04034b50)
    const periodResponse = await fetch(base + '/finance/export.csv?from=2000-01-01&to=2000-01-31', {headers:{Origin:origin,Cookie:finance.cookie}})
    assert.equal(periodResponse.status,200)
    const periodCsv=await periodResponse.text()
    assert.match(periodCsv,/2000-01-01/)
    assert.ok(!periodCsv.split('\r\n').some(line=>line.startsWith('"journal"')))
    const employeeEmail = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Export employee',
            email: employeeEmail,
            password,
            role: 'employee',
          },
          owner,
        )
      ).status,
      201,
    )
    const employeeLogin = await call('/auth/login', 'POST', {
      email: employeeEmail,
      password,
    })
    const employee = {
      cookie: employeeLogin.cookie,
      snapshot: employeeLogin.data,
    } as Account
    assert.equal(
      (await call('/finance/export.csv', 'GET', undefined, employee)).status,
      403,
    )
  })
  await test('decision intelligence returns scoped, explainable metrics and audits requests', async () => {
    const metrics = await call('/bi/metrics', 'GET', undefined, owner)
    assert.equal(metrics.status, 200)
    assert.equal(metrics.data.engine, 'deterministic-rules-v1')
    assert.equal(typeof metrics.data.metrics.cash, 'number')
    const answer = await call(
      '/ai/ask',
      'POST',
      { question: 'What is our cash runway?' },
      owner,
    )
    assert.equal(answer.status, 200)
    assert.equal(answer.data.engine, 'deterministic-rules-v1')
    assert.equal(answer.data.dataWindow, 'Current tenant workspace snapshot')
    assert.ok(Array.isArray(answer.data.sources))
    const forecast = await call(
      '/ai/forecast',
      'POST',
      { metric: 'cash' },
      owner,
    )
    assert.equal(forecast.status, 200)
    assert.equal(forecast.data.metric, 'cash')
    const audit = await call('/audit-logs', 'GET', undefined, owner)
    assert.ok(
      audit.data.entries.some(
        (entry: { action: string }) => entry.action === 'ai_question_asked',
      ),
    )
    const auditorEmail = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Insight auditor',
            email: auditorEmail,
            password: 'auditor-password-123',
            role: 'auditor',
          },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', {
      email: auditorEmail,
      password: 'auditor-password-123',
    })
    const auditor = { cookie: login.cookie, snapshot: login.data } as Account
    assert.equal(
      (await call('/ai/ask', 'POST', { question: 'What is cash?' }, auditor))
        .status,
      403,
    )
  })
  await test('owner disables and restores auditor without reviving old sessions', async () => {
    const email = randomUUID() + '@example.test',
      password = 'access-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Access auditor', email, password, role: 'auditor' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    assert.equal(login.status, 200)
    const auditor: Account = { cookie: login.cookie, snapshot: login.data },
      id = auditor.snapshot.user.id
    const members = await call('/users', 'GET', undefined, owner)
    assert.equal(
      members.data.users.find((u: { id: string }) => u.id === id).active,
      true,
    )
    assert.equal(
      (
        await call(
          '/users/' + owner.snapshot.user.id + '/access',
          'PATCH',
          { active: false },
          owner,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await call(
          '/users/' + id + '/access',
          'PATCH',
          { active: false },
          other,
        )
      ).status,
      404,
    )
    assert.equal(
      (
        await call(
          '/users/' + id + '/access',
          'PATCH',
          { active: false },
          auditor,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await call(
          '/users/' + id + '/access',
          'PATCH',
          { active: false },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      401,
    )
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      401,
    )
    assert.equal(
      (await call('/users/' + id + '/access', 'PATCH', { active: true }, owner))
        .status,
      200,
    )
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      401,
    )
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      200,
    )
  })
  await test('password change and sign-out-everywhere revoke every previous session', async () => {
    const email = randomUUID() + '@example.test',
      password = 'previous-password-123',
      newPassword = 'replacement-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Security auditor', email, password, role: 'auditor' },
          owner,
        )
      ).status,
      201,
    )
    const first = await call('/auth/login', 'POST', { email, password }),
      second = await call('/auth/login', 'POST', { email, password })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    const a: Account = { cookie: first.cookie, snapshot: first.data },
      b: Account = { cookie: second.cookie, snapshot: second.data }
    assert.equal(
      (
        await call(
          '/auth/password',
          'POST',
          { currentPassword: 'incorrect', newPassword },
          a,
        )
      ).status,
      400,
    )
    assert.equal((await call('/workspace', 'GET', undefined, b)).status, 200)
    assert.equal(
      (
        await call(
          '/auth/password',
          'POST',
          { currentPassword: password, newPassword },
          a,
        )
      ).status,
      200,
    )
    assert.equal((await call('/workspace', 'GET', undefined, a)).status, 401)
    assert.equal((await call('/workspace', 'GET', undefined, b)).status, 401)
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      401,
    )
    const fresh = await call('/auth/login', 'POST', {
      email,
      password: newPassword,
    })
    assert.equal(fresh.status, 200)
    const signedIn: Account = { cookie: fresh.cookie, snapshot: fresh.data }
    assert.equal(
      (await call('/auth/revoke-sessions', 'POST', {}, signedIn)).status,
      200,
    )
    assert.equal(
      (await call('/workspace', 'GET', undefined, signedIn)).status,
      401,
    )
  })
  await test('concurrent writes cannot both commit the same workspace version', async () => {
    owner.snapshot = (await call('/workspace', 'GET', undefined, owner)).data
    const result = await Promise.all([
      save(owner, {
        type: 'create',
        collection: 'tasks',
        data: { name: 'Concurrent A' },
      }),
      save(owner, {
        type: 'create',
        collection: 'tasks',
        data: { name: 'Concurrent B' },
      }),
    ])
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409])
    owner.snapshot = result.find((r) => r.status === 200)!.data
  })

  await test('module records are tenant-scoped and have an audited lifecycle', async () => {
    const initial = await call('/modules/billing', 'GET', undefined, owner)
    assert.equal(initial.status, 200)
    assert.ok(initial.data.records.length >= 3)
    const created = await call(
      '/modules/billing',
      'POST',
      { name: 'Integration plan', detail: 'Plan usage', status: 'Draft' },
      owner,
    )
    assert.equal(created.status, 201)
    const id = created.data.id
    assert.equal(
      (await call('/modules/billing?q=Integration', 'GET', undefined, owner))
        .data.records.length,
      1,
    )
    assert.equal(
      (
        await call(
          '/modules/billing/' + id,
          'PATCH',
          { status: 'Active' },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/modules/billing/' + id, 'DELETE', undefined, other)).status,
      404,
    )
    assert.equal(
      (await call('/modules/billing/' + id, 'DELETE', undefined, owner)).status,
      200,
    )
    assert.equal(
      (await call('/modules/billing?q=Integration', 'GET', undefined, owner))
        .data.records.length,
      0,
    )
    const email = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Module finance',
            email,
            password: 'module-finance-password',
            role: 'finance_admin',
          },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', {
      email,
      password: 'module-finance-password',
    })
    const finance = { cookie: login.cookie, snapshot: login.data } as Account
    assert.equal(
      (await call('/modules/billing', 'GET', undefined, finance)).status,
      200,
    )
    assert.equal(
      (await call('/modules/admin', 'GET', undefined, finance)).status,
      403,
    )
  })

  await test('in-app announcements are recipient-scoped, readable once, and tenant-isolated', async () => {
    const published = await call('/notifications', 'POST', { title: 'Operations update', body: 'Warehouse review starts at 10:00.', link: '/app/warehouse' }, owner)
    assert.equal(published.status, 201)
    assert.ok(published.data.delivered >= 1)
    const listed = await call('/notifications?unread=true', 'GET', undefined, owner)
    assert.equal(listed.status, 200)
    const notice = listed.data.notifications.find((item: { title: string }) => item.title === 'Operations update')
    assert.ok(notice)
    assert.equal((await call('/notifications?unread=true', 'GET', undefined, other)).data.notifications.some((item: { id: string }) => item.id === notice.id), false)
    assert.equal((await call('/notifications/' + notice.id + '/read', 'PATCH', {}, other)).status, 404)
    assert.equal((await call('/notifications/' + notice.id + '/read', 'PATCH', {}, owner)).status, 200)
    const unread = await call('/notifications?unread=true', 'GET', undefined, owner)
    assert.equal(unread.data.notifications.some((item: { id: string }) => item.id === notice.id), false)
  })

  await test('document metadata is validated, tenant-scoped, and archived instead of deleted', async () => {
    const created = await call(
      '/documents',
      'POST',
      { filename: 'policy.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      owner,
    )
    assert.equal(created.status, 201)
    assert.match(created.data.storageKey, /\/policy\.pdf$/)
    const id = created.data.id
    assert.equal(
      (await call('/documents/' + id, 'PATCH', { status: 'archived' }, owner))
        .status,
      200,
    )
    assert.equal(
      (await call('/documents/' + id, 'PATCH', { status: 'archived' }, other))
        .status,
      404,
    )
    const listed = await call('/documents', 'GET', undefined, owner)
    assert.equal(listed.status, 200)
    assert.equal(
      listed.data.documents.find(
        (document: { id: string }) => document.id === id,
      ).status,
      'archived',
    )
  })

  await test('document comments are immutable, attributed and tenant-scoped', async () => {
    const document = await call('/documents', 'POST', { filename: 'review.txt', mimeType: 'text/plain', sizeBytes: 1 }, owner)
    assert.equal(document.status, 201)
    const id = document.data.id
    const comment = await call('/documents/' + id + '/comments', 'POST', { body: 'Please review section 3.' }, owner)
    assert.equal(comment.status, 201)
    const listed = await call('/documents/' + id + '/comments', 'GET', undefined, owner)
    assert.equal(listed.status, 200)
    assert.equal(listed.data.comments[0].body, 'Please review section 3.')
    assert.equal((await call('/documents/' + id + '/comments', 'GET', undefined, other)).status, 404)
    assert.equal((await call('/documents/' + id + '/comments', 'POST', { body: 'cross tenant' }, other)).status, 404)
  })

  await test('document binaries require authorization and can be shared through an expiring token', async () => {
    const contents = 'confidential BusinessOS document'
    const created = await call(
      '/documents',
      'POST',
      {
        filename: 'confidential.txt',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(contents),
        contentBase64: Buffer.from(contents).toString('base64'),
      },
      owner,
    )
    assert.equal(created.status, 201)

    const download = await fetch(base + '/documents/' + created.data.id + '/content', {
      headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.snapshot.csrf },
    })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'text/plain')
    assert.match(download.headers.get('content-disposition') || '', /confidential\.txt/)
    assert.equal(await download.text(), contents)
    assert.equal((await call('/documents/' + created.data.id + '/content', 'GET', undefined, other)).status, 404)

    const share = await call('/documents/' + created.data.id + '/shares', 'POST', { expiresHours: 1 }, owner)
    assert.equal(share.status, 201)
    assert.match(share.data.token, /^[a-f0-9]{64}$/)
    const publicDownload = await fetch(base + '/shared-documents/' + share.data.token)
    assert.equal(publicDownload.status, 200)
    assert.equal(await publicDownload.text(), contents)
    assert.equal((await fetch(base + '/shared-documents/' + 'a'.repeat(64))).status, 404)
  })

  await test('document revisions preserve the previous binary and enforce tenant access', async () => {
    const first = 'first approved revision'
    const created = await call('/documents', 'POST', { filename: 'handbook.txt', mimeType: 'text/plain', sizeBytes: Buffer.byteLength(first), contentBase64: Buffer.from(first).toString('base64') }, owner)
    assert.equal(created.status, 201)
    const second = 'second approved revision'
    const revision = await call('/documents/' + created.data.id + '/versions', 'POST', { filename: 'handbook-v2.txt', mimeType: 'text/plain', sizeBytes: Buffer.byteLength(second), contentBase64: Buffer.from(second).toString('base64') }, owner)
    assert.equal(revision.status, 201)
    assert.equal(revision.data.version, 2)
    const history = await call('/documents/' + created.data.id + '/versions', 'GET', undefined, owner)
    assert.equal(history.status, 200)
    assert.equal(history.data.current.version, 2)
    assert.equal(history.data.versions[0].version, 1)
    const oldFile = await fetch(base + '/documents/' + created.data.id + '/versions/1/content', { headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.snapshot.csrf } })
    assert.equal(oldFile.status, 200)
    assert.equal(await oldFile.text(), first)
    assert.equal((await call('/documents/' + created.data.id + '/versions', 'GET', undefined, other)).status, 404)
  })

  await test('support tickets and tax filings enforce audited state transitions', async () => {
    const ticket = await call(
      '/support/tickets',
      'POST',
      {
        subject: 'Delivery update',
        customer: 'Northstar',
        priority: 'high',
        slaDueAt: null,
      },
      owner,
    )
    assert.equal(ticket.status, 201)
    assert.equal(
      (
        await call(
          '/support/tickets/' + ticket.data.id,
          'PATCH',
          { status: 'resolved' },
          owner,
        )
      ).status,
      200,
    )
    const filing = await call(
      '/tax/filings',
      'POST',
      {
        name: 'VAT September',
        territory: 'Nigeria',
        dueDate: '2026-09-21',
        amount: 5000,
      },
      owner,
    )
    assert.equal(filing.status, 201)
    assert.equal(
      (
        await call(
          '/tax/filings/' + filing.data.id,
          'PATCH',
          { status: 'ready' },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/support/tickets', 'GET', undefined, other)).status,
      200,
    )
    assert.equal(
      (await call('/tax/filings', 'GET', undefined, other)).status,
      200,
    )
  })

  await test('warehouse locations and suppliers enforce tenant-scoped operations', async () => {
    const location = await call(
      '/warehouse/locations',
      'POST',
      { name: 'Main warehouse', code: 'WH-01' },
      owner,
    )
    assert.equal(location.status, 201)
    assert.equal(
      (
        await call(
          '/warehouse/locations/' + location.data.id,
          'PATCH',
          { status: 'inactive' },
          owner,
        )
      ).status,
      200,
    )
    const supplier = await call(
      '/suppliers',
      'POST',
      { name: 'Kora Imports', contact: 'ops@kora.test', leadDays: 14 },
      owner,
    )
    assert.equal(supplier.status, 201)
    assert.equal(
      (
        await call(
          '/suppliers/' + supplier.data.id,
          'PATCH',
          { status: 'review' },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/warehouse/locations', 'GET', undefined, other)).status,
      200,
    )
    assert.equal(
      (await call('/suppliers', 'GET', undefined, other)).status,
      200,
    )
  })

  await test('fulfillment and returns enforce warehouse lifecycle transitions', async () => {
    const fulfillment = await call('/warehouse/fulfillments', 'POST', { orderRef: 'SO-9001', customer: 'Northstar', items: '2 keyboards', location: 'Lagos', assignee: 'Operations' }, owner)
    assert.equal(fulfillment.status, 201)
    assert.equal((await call('/warehouse/fulfillments/' + fulfillment.data.id, 'PATCH', { status: 'dispatched' }, owner)).status, 409)
    assert.equal((await call('/warehouse/fulfillments/' + fulfillment.data.id, 'PATCH', { status: 'packed' }, owner)).status, 200)
    assert.equal((await call('/warehouse/fulfillments/' + fulfillment.data.id, 'PATCH', { status: 'dispatched' }, owner)).status, 200)
    assert.equal((await call('/warehouse/fulfillments/' + fulfillment.data.id, 'PATCH', { status: 'packed' }, owner)).status, 409)
    assert.equal((await call('/warehouse/fulfillments/' + fulfillment.data.id, 'PATCH', { status: 'packed' }, other)).status, 404)
    const returnRecord = await call('/warehouse/returns', 'POST', { rma: 'RMA-9001', customer: 'Northstar', product: 'Keyboard', condition: 'restockable' }, owner)
    assert.equal(returnRecord.status, 201)
    assert.equal((await call('/warehouse/returns/' + returnRecord.data.id, 'PATCH', { status: 'restocked' }, owner)).status, 200)
    assert.equal((await call('/warehouse/returns/' + returnRecord.data.id, 'PATCH', { status: 'refunded' }, owner)).status, 409)
  })

  await test('operational records and warehouse transfers preserve tenant ownership and quantities', async () => {
    const asset=await call('/assets','POST',{name:'Laptop',serialNumber:randomUUID(),category:'IT',cost:10000},owner)
    assert.equal(asset.status,201)
    assert.equal((await call('/assets/'+asset.data.id,'PATCH',{status:'retired'},other)).status,404)
    const location=await call('/warehouse/locations','POST',{name:'Test warehouse',code:randomUUID().slice(0,8)},owner)
    assert.equal(location.status,201)
    owner.snapshot=(await call('/workspace','GET',undefined,owner)).data
    const product=owner.snapshot.state.products[0]
    const payload={sourceLocationId:null,destinationLocationId:location.data.id,productId:product.id,quantity:1}
    const key=randomUUID()
    const first=await call('/warehouse/transfers','POST',payload,owner,{'Idempotency-Key':key})
    assert.equal(first.status,201)
    assert.equal((await call('/warehouse/transfers','POST',payload,owner,{'Idempotency-Key':key})).data.id,first.data.id)
    assert.equal((await call('/warehouse/transfers','POST',{...payload,quantity:2},owner,{'Idempotency-Key':key})).status,409)
    assert.equal((await call('/warehouse/transfers','POST',payload,other,{'Idempotency-Key':randomUUID()})).status,404)
    const tenant=(await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1',[owner.snapshot.user.id])).rows[0].tenant_id
    await app.store.tenant(tenant,async c=>{
      assert.equal(Number((await c.query('SELECT quantity FROM warehouse_stock WHERE tenant_id=$1 AND location_id=$2',[tenant,location.data.id])).rows[0].quantity),1)
      assert.equal(Number((await c.query('SELECT SUM(quantity_delta) AS total FROM warehouse_movements WHERE transfer_id=$1',[first.data.id])).rows[0].total),0)
    })
  })
  await test('signed bank ingestion rejects forgery and ingests duplicate deliveries once without browser origin',async()=>{
    const account=await call('/banks/connect','POST',{provider:'mock',externalRef:randomUUID(),name:'Webhook test',currency:'NGN'},owner)
    assert.equal(account.status,201)
    const tenant=(await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1',[owner.snapshot.user.id])).rows[0].tenant_id
    const secret='test-only-signature-secret-1234567890'
    process.env.BANK_WEBHOOK_BINDINGS=JSON.stringify({mock:{tenantId:tenant,accountId:account.data.id,secret}})
    const payload={event:'transaction',data:{id:randomUUID(),amount:123,currency:'NGN',direction:'credit',reference:'fixture',occurredAt:'2026-09-01T00:00:00Z'}}
    const raw=JSON.stringify(payload), signature=createHmac('sha256',secret).update(raw).digest('hex')
    const deliver=(sig:string)=>fetch(base+'/webhooks/banks/mock',{method:'POST',headers:{'Content-Type':'application/json','X-BusinessOS-Signature':sig},body:raw})
    assert.equal((await deliver('forged')).status,401)
    const first=await deliver(signature);assert.equal(first.status,200)
    const firstData=await first.json()
    const second=await deliver(signature);assert.equal((await second.json()).transactionId,firstData.transactionId)
    delete process.env.BANK_WEBHOOK_BINDINGS
  })
  await test('subscription restrictions are enforced on APIs and action endpoints',async()=>{
    const tenant=(await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1',[owner.snapshot.user.id])).rows[0].tenant_id
    await app.store.tenant(tenant,c=>c.query("UPDATE tenants SET plan_id='starter' WHERE id=$1",[tenant]))
    try {
      assert.equal((await call('/assets','GET',undefined,owner)).status,403)
      assert.equal((await call('/finance/statements','GET',undefined,owner)).status,403)
      assert.equal((await call('/ai/forecast','POST',{metric:'cash'},owner)).status,403)
      owner.snapshot=(await call('/workspace','GET',undefined,owner)).data
      assert.deepEqual(owner.snapshot.entitlements?.features, ['core'])
      assert.equal((await save(owner,{type:'payroll',period:'2027-01'})).status,403)
      assert.equal((await call('/billing/entitlements','GET',undefined,owner)).data.plan,'starter')
    } finally { await app.store.tenant(tenant,c=>c.query("UPDATE tenants SET plan_id='business_pro' WHERE id=$1",[tenant])) }
  })
  await test('owners cannot grant platform privileges and seats are enforced on creation and reactivation', async () => {
    assert.equal((await call('/users', 'POST', { name: 'Forbidden admin', email: randomUUID() + '@example.test', password: 'test-password-12345', role: 'super_admin' }, owner)).status, 400)
    const users = (await call('/users', 'GET', undefined, owner)).data.users
    const auditor = users.find((user: { role: string; active: boolean }) => user.role === 'auditor' && user.active)
    assert.ok(auditor)
    assert.equal((await call('/users/' + auditor.id + '/access', 'PATCH', { active: false }, owner)).status, 200)
    const used = users.filter((user: { active: boolean }) => user.active).length - 1
    const oldLimit = (await app.store.pool.query("SELECT seat_limit FROM subscription_plans WHERE id='business_pro'")).rows[0].seat_limit
    await app.store.pool.query("UPDATE subscription_plans SET seat_limit=$1 WHERE id='business_pro'", [used])
    try {
      assert.equal((await call('/users', 'POST', { name: 'Extra seat', email: randomUUID() + '@example.test', password: 'test-password-12345', role: 'employee' }, owner)).status, 409)
      assert.equal((await call('/users/' + auditor.id + '/access', 'PATCH', { active: true }, owner)).status, 409)
      const workspace = await call('/workspace', 'GET', undefined, owner)
      assert.equal(workspace.data.entitlements.seatLimit, used)
      assert.equal(workspace.data.entitlements.plan, 'business_pro')
    } finally {
      await app.store.pool.query("UPDATE subscription_plans SET seat_limit=$1 WHERE id='business_pro'", [oldLimit])
      assert.equal((await call('/users/' + auditor.id + '/access', 'PATCH', { active: true }, owner)).status, 200)
    }
  })
  await test('production never returns development password reset tokens', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousReturnToken = process.env.RETURN_RESET_TOKEN
    process.env.NODE_ENV = 'production'
    process.env.RETURN_RESET_TOKEN = 'true'
    try {
      const result = await call('/auth/password-reset/request', 'POST', { email: owner.snapshot.user.email })
      assert.equal(result.status, 200)
      assert.deepEqual(result.data, { ok: true })
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      if (previousReturnToken === undefined) delete process.env.RETURN_RESET_TOKEN
      else process.env.RETURN_RESET_TOKEN = previousReturnToken
    }
  })
  await test('password recovery issues a single-use reset and revokes sessions', async () => {
    await app.redis.del(testPrefix + 'attempts:127.0.0.1')
    process.env.RETURN_RESET_TOKEN = 'true'
    const requested = await call('/auth/password-reset/request', 'POST', {
      email: owner.snapshot.user.email,
    })
    assert.equal(requested.status, 200)
    assert.ok(requested.data.developmentToken)
    const reset = await call('/auth/password-reset/confirm', 'POST', {
      token: requested.data.developmentToken,
      newPassword: 'recovered-password-123',
    })
    assert.equal(reset.status, 200)
    assert.equal(
      (await call('/workspace', 'GET', undefined, owner)).status,
      401,
    )
    assert.equal(
      (
        await call('/auth/login', 'POST', {
          email: owner.snapshot.user.email,
          password: 'recovered-password-123',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await call('/auth/password-reset/confirm', 'POST', {
          token: requested.data.developmentToken,
          newPassword: 'another-password-123',
        })
      ).status,
      400,
    )
    delete process.env.RETURN_RESET_TOKEN
  })

  await test('PostgreSQL FORCE RLS and ledger triggers enforce isolation and append-only writes', async () => {
    const roles = await app.store.pool.query(
      'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
    assert.equal(roles.rows[0].rolsuper, false)
    assert.equal(roles.rows[0].rolbypassrls, false)
    const a = (
      await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1', [
        owner.snapshot.user.id,
      ])
    ).rows[0].tenant_id
    const b = (
      await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1', [
        other.snapshot.user.id,
      ])
    ).rows[0].tenant_id
    await app.store.tenant(a, async (c) => {
      assert.equal(
        (await c.query('SELECT * FROM tenants WHERE id=$1', [b])).rowCount,
        0,
      )
    })
    await assert.rejects(
      app.store.tenant(a, (c) =>
        c.query('DELETE FROM journals WHERE tenant_id=$1', [a]),
      ),
      /append-only/,
    )
    await assert.rejects(
      app.store.tenant(a, (c) =>
        c.query("UPDATE audit SET payload='{}' WHERE tenant_id=$1", [a]),
      ),
      /append-only/,
    )
    assert.equal(
      (await app.store.pool.query('SELECT * FROM tenants')).rowCount,
      0,
    )
  })
  await test('completion expansion: PDF, forecasts, approvals, branches, interviews and outbox', async () => {
    const a = await register()
    const pdf = await fetch(base + '/finance/export.pdf', { headers: { Origin: origin, Cookie: a.cookie } })
    assert.equal(pdf.status, 200)
    assert.match(pdf.headers.get('content-type') || '', /application\/pdf/)
    assert.equal((await pdf.arrayBuffer()).byteLength > 100, true)
    const forecast = await call('/ai/forecast', 'POST', { metric: 'cash' }, a)
    assert.equal(forecast.status, 200)
    assert.ok(forecast.data.id)
    assert.equal((await call('/ai/forecasts', 'GET', undefined, a)).data.forecasts.length >= 1, true)
    assert.equal((await call('/ai/forecasts/' + forecast.data.id, 'GET', undefined, a)).status, 200)
    assert.equal((await call('/ai/forecasts', 'GET', undefined, other)).data.forecasts.some((r: { id: string }) => r.id === forecast.data.id), false)
    const chains = await call('/approvals/chains', 'GET', undefined, a)
    assert.equal(chains.status, 200)
    assert.ok(chains.data.chains.length >= 3)
    const req1 = await call('/approvals/requests', 'POST', { scope: 'purchase_order', entityType: 'purchase_order', entityId: randomUUID(), amount: 600000 }, a)
    assert.equal(req1.status, 201)
    assert.equal((await call('/approvals/requests/' + req1.data.id, 'PATCH', { version: 1, decision: 'approve' }, a)).data.status, 'pending')
    const branch = await call('/branches', 'POST', { name: 'Lagos HQ', code: 'lag' }, a)
    assert.equal(branch.status, 201)
    assert.equal(branch.data.code, 'LAG')
    assert.equal((await call('/branches', 'GET', undefined, a)).data.branches.length >= 1, true)
    const candidate = await call('/hr/candidates', 'POST', { name: 'Interviewee', email: 'i@example.test', position: 'Ops' }, a)
    assert.equal(candidate.status, 201)
    const interview = await call('/hr/candidates/' + candidate.data.id + '/interviews', 'POST', { interviewAt: new Date().toISOString(), interviewers: 'Owner' }, a)
    assert.equal(interview.status, 201)
    assert.equal((await call('/hr/candidates/' + candidate.data.id + '/interviews', 'GET', undefined, a)).data.interviews.length, 1)
    const queued = await call('/notifications/outbox', 'POST', { channel: 'email', recipient: 'ops@example.test', subject: 'Hi', body: 'Hello' }, a)
    assert.equal(queued.status, 201)
    assert.equal((await call('/notifications/outbox', 'GET', undefined, a)).data.messages.length >= 1, true)
    assert.equal((await call('/notifications/outbox/' + queued.data.id + '/deliver', 'POST', {}, a)).data.status, 'sent')
    const audit = await call('/audit-logs', 'GET', undefined, a)
    assert.ok(audit.data.entries.some((r: { action: string }) => r.action === 'approval_requested'))
  })
  await test('budgets, RFQ, lead scores, onboarding and detailed health are tenant-scoped and role-protected', async () => {
    const a = await register()

    // Onboarding — owner only
    const onboarding = await call('/onboarding', 'GET', undefined, a)
    assert.equal(onboarding.status, 200)
    assert.deepEqual(onboarding.data.completedSteps, [])
    assert.equal(onboarding.data.dismissed, false)
    assert.equal((await call('/onboarding', 'PATCH', { completedStep: 'profile' }, a)).status, 200)
    const updated = await call('/onboarding', 'GET', undefined, a)
    assert.ok(updated.data.completedSteps.includes('profile'))
    assert.equal((await call('/onboarding', 'PATCH', { completedStep: 'profile' }, a)).status, 200)
    const deduped = await call('/onboarding', 'GET', undefined, a)
    assert.equal(deduped.data.completedSteps.filter((s: string) => s === 'profile').length, 1)
    assert.equal((await call('/onboarding', 'PATCH', { dismissed: true }, a)).status, 200)
    assert.equal((await call('/onboarding', 'GET', undefined, a)).data.dismissed, true)
    assert.equal((await call('/onboarding', 'GET', undefined, other)).status, 200)

    // Budgets — owner and finance_admin can write; auditor reads
    const budget = await call('/budgets', 'POST', {
      name: 'Q4 Marketing',
      department: 'Marketing',
      periodFrom: '2026-10-01',
      periodTo: '2026-12-31',
      totalAmount: 500000,
    }, a)
    assert.equal(budget.status, 201)
    assert.equal(budget.data.status, 'active')
    assert.equal(budget.data.spentAmount, 0)
    assert.equal(budget.data.version, 1)
    const budgetId = budget.data.id
    assert.equal((await call('/budgets', 'GET', undefined, a)).data.budgets.length >= 1, true)
    assert.equal((await call('/budgets', 'GET', undefined, other)).data.budgets.length, 0)
    const patched = await call('/budgets/' + budgetId, 'PATCH', { version: 1, spentAmount: 120000 }, a)
    assert.equal(patched.status, 200)
    assert.equal(Number(patched.data.spent_amount), 120000)
    assert.equal((await call('/budgets/' + budgetId, 'PATCH', { version: 1, spentAmount: 200000 }, a)).status, 409)
    assert.equal((await call('/budgets', 'POST', { name: 'Bad period', department: '', periodFrom: '2026-12-01', periodTo: '2026-11-01', totalAmount: 1000 }, a)).status, 400)
    const auditorEmail = randomUUID() + '@example.test', auditorPw = 'budget-auditor-pw-123'
    await call('/users', 'POST', { name: 'Budget auditor', email: auditorEmail, password: auditorPw, role: 'auditor' }, a)
    const auditorLogin = await call('/auth/login', 'POST', { email: auditorEmail, password: auditorPw })
    const auditor = { cookie: auditorLogin.cookie, snapshot: auditorLogin.data } as Account
    assert.equal((await call('/budgets', 'GET', undefined, auditor)).status, 200)
    assert.equal((await call('/budgets', 'POST', { name: 'Forbidden', department: '', periodFrom: '2026-01-01', periodTo: '2026-12-31', totalAmount: 1 }, auditor)).status, 403)
    const closedBudget = await call('/budgets/' + budgetId, 'PATCH', { version: 2, status: 'closed' }, a)
    assert.equal(closedBudget.status, 200)
    const audit = await call('/audit-logs', 'GET', undefined, a)
    assert.ok(audit.data.entries.some((r: { action: string }) => r.action === 'budget_created'))
    assert.ok(audit.data.entries.some((r: { action: string }) => r.action === 'budget_updated'))

    // RFQ — operations_manager and owner can write; auditor reads
    const rfq = await call('/rfq', 'POST', {
      supplierName: 'Kora Supplies',
      productDescription: '500 reams A4 paper',
      quantity: 500,
      requiredBy: '2026-11-30',
      notes: 'Urgent',
    }, a)
    assert.equal(rfq.status, 201)
    assert.equal(rfq.data.status, 'sent')
    assert.match(rfq.data.rfqNumber, /^RFQ-[A-Z0-9]{8}$/)
    assert.equal(rfq.data.quotedAmount, null)
    const rfqId = rfq.data.id
    assert.equal((await call('/rfq', 'GET', undefined, a)).data.rfqs.length >= 1, true)
    assert.equal((await call('/rfq', 'GET', undefined, other)).data.rfqs.length, 0)
    const quoted = await call('/rfq/' + rfqId, 'PATCH', { version: 1, quotedAmount: 75000, status: 'quoted' }, a)
    assert.equal(quoted.status, 200)
    assert.equal(Number(quoted.data.quoted_amount), 75000)
    assert.equal((await call('/rfq/' + rfqId, 'PATCH', { version: 1, status: 'accepted' }, a)).status, 409)
    assert.equal((await call('/rfq/' + rfqId, 'PATCH', { version: 2, status: 'accepted' }, a)).status, 200)
    assert.equal((await call('/rfq', 'GET', undefined, auditor)).status, 200)
    assert.equal((await call('/rfq', 'POST', { supplierName: 'Forbidden', productDescription: 'x', quantity: 1 }, auditor)).status, 403)
    const rfqAudit = await call('/audit-logs', 'GET', undefined, a)
    assert.ok(rfqAudit.data.entries.some((r: { action: string }) => r.action === 'rfq_created'))
    assert.ok(rfqAudit.data.entries.some((r: { action: string }) => r.action === 'rfq_updated'))

    // Lead scores — deterministic, tenant-scoped
    const scores = await call('/crm/lead-scores', 'GET', undefined, a)
    assert.equal(scores.status, 200)
    assert.ok(Array.isArray(scores.data.scores))
    for (const s of scores.data.scores) {
      assert.ok(s.score >= 0 && s.score <= 100)
      assert.ok(typeof s.factors.stage === 'number')
      assert.ok(typeof s.factors.dealSize === 'number')
    }
    const otherScores = await call('/crm/lead-scores', 'GET', undefined, other)
    assert.equal(otherScores.data.scores.some((item: { leadId: string }) => scores.data.scores.some((own: { leadId: string }) => own.leadId === item.leadId)), false)

    // Detailed health — owner, auditor, super_admin only
    const health = await call('/admin/health/detailed', 'GET', undefined, a)
    assert.equal(health.status, 200)
    assert.equal(health.data.status, 'operational')
    assert.ok(health.data.checks.database.ok)
    assert.ok(health.data.checks.redis.ok)
    assert.ok(typeof health.data.checks.database.latencyMs === 'number')
    assert.ok(typeof health.data.uptime === 'number')
    assert.ok(typeof health.data.tenant.active_users === 'number')
    assert.equal((await call('/admin/health/detailed', 'GET', undefined, auditor)).status, 200)
    const financeEmail2 = randomUUID() + '@example.test'
    await call('/users', 'POST', { name: 'Finance', email: financeEmail2, password: 'finance-health-pw-123', role: 'finance_admin' }, a)
    const finLogin = await call('/auth/login', 'POST', { email: financeEmail2, password: 'finance-health-pw-123' })
    const fin = { cookie: finLogin.cookie, snapshot: finLogin.data } as Account
    assert.equal((await call('/admin/health/detailed', 'GET', undefined, fin)).status, 403)
  })

  await test('next completion: payment lifecycle, depreciation, polling, search, MFA and backups', async () => {
    const a = await register()
    const search = await call('/search?q=' + encodeURIComponent(a.snapshot.state.products[0].name.slice(0, 4)), 'GET', undefined, a)
    assert.equal(search.status, 200)
    assert.ok(search.data.results.length >= 1)
    assert.equal((await call('/search?q=x', 'GET', undefined, a)).data.results.length, 0)
    const asset = await call('/assets', 'POST', { name: 'Van', serialNumber: randomUUID(), category: 'Fleet', cost: 1200000, depreciationRate: 20 }, a)
    assert.equal(asset.status, 201)
    const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 7)
    const dep = await call('/assets/' + asset.data.id + '/depreciation', 'POST', { period: nextMonth }, a)
    assert.equal(dep.status, 201)
    assert.ok(dep.data.amount >= 0)
    assert.equal((await call('/assets/' + asset.data.id + '/depreciation', 'POST', { period: nextMonth }, a)).status, 409)
    assert.equal((await call('/assets/' + asset.data.id + '/depreciation', 'GET', undefined, a)).data.postings.length, 1)
    const refreshed = await call('/workspace', 'GET', undefined, a)
    assert.equal(refreshed.status, 200)
    a.snapshot = refreshed.data
    const hr = await save(a, { type: 'payroll', period: '2026-11' })
    assert.equal(hr.status, 200)
    a.snapshot = hr.data
    const runId = hr.data.state.payroll.find((run: { period: string }) => run.period === '2026-11')?.id
    assert.ok(runId)
    const approverEmail = randomUUID() + '@example.test'
    const approverPassword = 'payroll-approver-pw-123'
    assert.equal((await call('/users', 'POST', { name: 'Payroll finance', email: approverEmail, password: approverPassword, role: 'finance_admin' }, a)).status, 201)
    const approverLogin = await call('/auth/login', 'POST', { email: approverEmail, password: approverPassword })
    const approver = { cookie: approverLogin.cookie, snapshot: approverLogin.data } as Account
    const approved = await save(approver, { type: 'status', collection: 'payroll', id: runId, status: 'Approved' })
    assert.equal(approved.status, 200)
    const ownerRefresh = await call('/workspace', 'GET', undefined, a)
    assert.equal(ownerRefresh.status, 200)
    a.snapshot = ownerRefresh.data
    const batch = await call(`/payroll/runs/${runId}/payment-batches`, 'POST', {}, a, { 'Idempotency-Key': randomUUID() })
    assert.equal(batch.status, 201)
    assert.equal((await call(`/payroll/runs/${runId}/payment-batches`, 'PATCH', { status: 'confirmed' }, a)).status, 409)
    assert.equal((await call(`/payroll/runs/${runId}/payment-batches`, 'PATCH', { status: 'submitted' }, a)).data.batch.status, 'submitted')
    assert.equal((await call(`/payroll/runs/${runId}/payment-batches`, 'PATCH', { status: 'confirmed' }, a)).data.batch.status, 'confirmed')
    const account = await call('/banks/accounts', 'POST', { provider: 'manual', externalRef: randomUUID(), name: 'Poll account', currency: 'NGN' }, a)
    assert.equal(account.status, 201)
    assert.equal((await call(`/banks/accounts/${account.data.id}/poll`, 'POST', {}, a)).status, 201)
    assert.equal((await call(`/banks/accounts/${account.data.id}/poll`, 'GET', undefined, a)).data.polls.length, 1)
    const mfa = await call('/auth/mfa', 'POST', {}, a)
    assert.equal(mfa.status, 201)
    assert.equal((await call('/auth/mfa/verify', 'POST', { code: mfa.data.previewCode }, a)).data.verified, true)
    assert.equal((await call('/auth/mfa', 'GET', undefined, a)).data.verified, true)
    const backup = await call('/admin/backups', 'POST', { label: 'nightly' }, a)
    assert.equal(backup.status, 201)
    assert.equal((await call('/admin/backups', 'GET', undefined, a)).data.backups.length, 1)
  })
  await test('employee self-service: can submit own leave and goals, cannot approve own leave or access others', async () => {
    const a = await register()
    const firstEmp = a.snapshot.state.employees[0]
    if (!firstEmp) return
    const empEmail = randomUUID() + '@example.test'
    const empPw = 'employee-self-service-pw-123'
    // Create user whose display name matches the employee record
    assert.equal((await call('/users', 'POST', { name: firstEmp.name, email: empEmail, password: empPw, role: 'employee' }, a)).status, 201)
    const empLogin = await call('/auth/login', 'POST', { email: empEmail, password: empPw })
    const emp = { cookie: empLogin.cookie, snapshot: empLogin.data } as Account
    // Employee can read leave workflow
    assert.equal((await call('/workflows/leave', 'GET', undefined, emp)).status, 200)
    // Employee can submit leave for their own record
    const leaveKey = randomUUID()
    const leave = await call('/workflows/leave', 'POST',
      { employeeId: firstEmp.id, startDate: '2026-12-01', endDate: '2026-12-03', reason: 'Annual leave' },
      emp, { 'Idempotency-Key': leaveKey })
    assert.equal(leave.status, 201)
    assert.equal(leave.data.status, 'pending')
    // Idempotent retry returns same record
    assert.equal((await call('/workflows/leave', 'POST',
      { employeeId: firstEmp.id, startDate: '2026-12-01', endDate: '2026-12-03', reason: 'Annual leave' },
      emp, { 'Idempotency-Key': leaveKey })).data.id, leave.data.id)
    // Employee cannot approve their own leave
    assert.equal((await call('/workflows/leave/' + leave.data.id, 'PATCH', { version: 1, status: 'approved' }, emp)).status, 403)
    // HR admin can approve it
    const hrEmail = randomUUID() + '@example.test'
    await call('/users', 'POST', { name: 'HR Self', email: hrEmail, password: empPw, role: 'hr_admin' }, a)
    const hrLogin = await call('/auth/login', 'POST', { email: hrEmail, password: empPw })
    const hr = { cookie: hrLogin.cookie, snapshot: hrLogin.data } as Account
    assert.equal((await call('/workflows/leave/' + leave.data.id, 'PATCH', { version: 1, status: 'approved' }, hr)).status, 200)
    // Employee cannot submit leave for a different employee
    const otherEmp = a.snapshot.state.employees[1]
    if (otherEmp) {
      assert.equal((await call('/workflows/leave', 'POST',
        { employeeId: otherEmp.id, startDate: '2026-12-10', endDate: '2026-12-11', reason: 'Sick' },
        emp, { 'Idempotency-Key': randomUUID() })).status, 403)
    }
    // Employee can create and update their own goal
    const goal = await call('/workflows/goals', 'POST',
      { employeeId: firstEmp.id, title: 'Close 5 deals', target: 5, unit: 'deals', dueDate: '2026-12-31' },
      emp, { 'Idempotency-Key': randomUUID() })
    assert.equal(goal.status, 201)
    assert.equal((await call('/workflows/goals/' + goal.data.id, 'PATCH', { version: 1, progress: 3 }, emp)).status, 200)
    // Cannot complete without reaching target
    assert.equal((await call('/workflows/goals/' + goal.data.id, 'PATCH', { version: 2, status: 'completed', progress: 3 }, emp)).status, 409)
    // Can complete once target is reached
    assert.equal((await call('/workflows/goals/' + goal.data.id, 'PATCH', { version: 2, status: 'completed', progress: 5 }, emp)).status, 200)
    // Audit trail records self-service actions
    const audit = await call('/audit-logs', 'GET', undefined, a)
    assert.ok(audit.data.entries.some((r: { action: string }) => r.action === 'leave_created'))
    assert.ok(audit.data.entries.some((r: { action: string }) => r.action === 'goals_created'))
  })

  await test('production completion consumes materials and posts finished goods once', async () => {
    const a = await register()
    const material = a.snapshot.state.products[0]
    const output = a.snapshot.state.products[1]
    const originalMaterial = material.qty
    const originalOutput = output.qty
    const batch = await call('/production/batches', 'POST', {
      batchNumber: 'PROD-' + randomUUID().slice(0, 8),
      productName: output.name,
      outputProductId: output.id,
      materials: [{ productId: material.id, quantity: 2 }],
      plannedQty: 3,
    }, a)
    assert.equal(batch.status, 201)
    assert.equal((await call('/production/batches/' + batch.data.id, 'PATCH', { status: 'running' }, a)).status, 200)
    assert.equal((await call('/production/batches/' + batch.data.id, 'PATCH', { status: 'qa_check' }, a)).status, 200)
    assert.equal((await call('/production/batches/' + batch.data.id, 'PATCH', { status: 'completed', completedQty: 3, defectCount: 1 }, a)).status, 200)
    const refreshed = await call('/workspace', 'GET', undefined, a)
    assert.equal(refreshed.status, 200)
    assert.equal(refreshed.data.state.products.find((p: { id: string }) => p.id === material.id).qty, originalMaterial - 2)
    assert.equal(refreshed.data.state.products.find((p: { id: string }) => p.id === output.id).qty, originalOutput + 2)
  })} finally {
  await app.close()
}

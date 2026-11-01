import { z } from 'zod'
import { database } from './database'
import { fail, requireRole } from './security'
import { mutate, type WorkflowContext } from './records'
import { appendEvent } from './workspace'

export async function handleAdmin(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const { path, request, account } = ctx,
    method = request.method
  if (!path.startsWith('/admin/') || path.startsWith('/admin/backups')) return
  requireRole(account, ['super_admin'])
  const d = await database()
  if (path === '/admin/overview' && method === 'GET')
    return Response.json({
      tenantsCount: await d.tenants.countDocuments({
        _id: { $ne: account.tenant },
      }),
      usersCount: await d.users.countDocuments(),
      version: '0.0.0',
      status: 'operational',
      database: 'MongoDB',
      redis: 'Not required',
      aiEngine: 'Deterministic calculations',
    })
  if (path === '/admin/health/detailed' && method === 'GET') {
    const start = performance.now()
    await d.db.command({ ping: 1 })
    return Response.json({
      status: 'healthy',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          ok: true,
          latencyMs: Math.round(performance.now() - start),
          engine: 'MongoDB',
        },
      },
      tenant: {
        active_users: await d.users.countDocuments({
          tenant: account.tenant,
          active: true,
        }),
        audit_events: await d.audit.countDocuments({ tenant: account.tenant }),
        bank_transactions: 0,
      },
    })
  }
  if (path === '/admin/tenants' && method === 'GET') {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(new URL(request.url).searchParams.get('offset') || '0')
    const rows = await d.tenants
      .find(
        { _id: { $ne: account.tenant } },
        {
          projection: {
            _id: 1,
            plan: 1,
            'state.organisation': 1,
            'state.currency': 1,
          },
        },
      )
      .sort({ _id: 1 })
      .skip(offset)
      .limit(101)
      .toArray()
    return Response.json({
      tenants: await Promise.all(
        rows
          .slice(0, 100)
          .map(async (row) => ({
            id: row._id,
            name: row.state.organisation,
            currency: row.state.currency,
            plan_id: row.plan,
            seats: await d.users.countDocuments({
              tenant: row._id,
              active: true,
            }),
          })),
      ),
      nextOffset: rows.length > 100 ? offset + 100 : null,
    })
  }
  if (path === '/admin/plans') {
    if (method === 'GET')
      return Response.json({
        plans: (await d.plans.find().sort({ seatLimit: 1 }).toArray()).map(
          (plan) => ({
            id: plan._id,
            name: plan._id.replaceAll('_', ' '),
            price: plan.price || 'Not configured',
            features: plan.features,
            seat_limit: plan.seatLimit,
          }),
        ),
      })
    if (method !== 'PATCH') fail(405, 'Method not supported.')
    const input = z
      .object({
        id: z.enum(['starter', 'business', 'business_pro', 'enterprise']),
        price: z.string().trim().min(1).max(160),
        seatLimit: z.number().int().min(1).max(100000),
        features: z
          .array(
            z.enum([
              'core',
              'operations',
              'reports',
              'automation',
              'forecast',
              'bank_feeds',
            ]),
          )
          .min(1)
          .refine((v) => v.includes('core'), 'Core is required.'),
      })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const tenants = await d.tenants
          .find({ plan: input.id }, { session, projection: { _id: 1 } })
          .toArray()
        for (const tenant of tenants)
          if (
            (await d.users.countDocuments(
              { tenant: tenant._id, active: true },
              { session },
            )) > input.seatLimit
          )
            fail(409, 'An existing tenant exceeds this seat limit.')
        const updated = await d.plans.updateOne(
          { _id: input.id },
          {
            $set: {
              price: input.price,
              seatLimit: input.seatLimit,
              features: [...new Set(input.features)],
            },
          },
          { session },
        )
        if (!updated.matchedCount) fail(404, 'Plan not found.')
        await d.tenants.updateMany(
          { plan: input.id },
          { $inc: { securityRevision: 1 } },
          { session },
        )
        return { ok: true }
      }),
    )
  }
  const assignment = path.match(/^\/admin\/tenants\/([^/]+)\/plan$/)
  if (assignment) {
    if (method !== 'PATCH') fail(405, 'Method not supported.')
    const id = z.uuid().parse(assignment[1]),
      input = z
        .object({
          planId: z.enum(['starter', 'business', 'business_pro', 'enterprise']),
          expectedPlanId: z.string().min(1).max(100),
        })
        .strict()
        .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const plan = await d.plans.findOne({ _id: input.planId }, { session })
        if (!plan) fail(404, 'Plan not found.')
        if (
          (await d.users.countDocuments(
            { tenant: id, active: true },
            { session },
          )) > plan.seatLimit
        )
          fail(409, 'The target plan has too few seats for this tenant.')
        const changed = await d.tenants.updateOne(
          { _id: id, plan: input.expectedPlanId },
          { $set: { plan: input.planId }, $inc: { securityRevision: 1 } },
          { session },
        )
        if (!changed.matchedCount)
          fail(409, 'Tenant plan changed. Refresh before assigning a plan.')
        await d.records.updateMany(
          {
            tenant: id,
            kind: 'billing:change',
            'data.plan': input.planId,
            'data.status': 'requested',
          },
          {
            $set: {
              'data.status': 'approved',
              updated_at: new Date().toISOString(),
            },
            $inc: { version: 1 },
          },
          { session },
        )
        await appendEvent(
          id,
          account.email,
          'subscription_plan_assigned',
          id,
          input.planId,
          session,
        )
        return { ok: true }
      }),
    )
  }
  if (path === '/admin/integrations' && method === 'GET')
    return Response.json({
      integrations: await d.records
        .aggregate([
          { $match: { kind: 'connector' } },
          {
            $group: {
              _id: { category: '$data.category', status: '$data.status' },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    })
  if (path === '/admin/ai-controls' && method === 'GET')
    return Response.json({
      settings: {
        engine: 'Deterministic calculations and constant-baseline scenarios',
        autonomousApprovals: false,
        tenantIsolation: true,
        trainedForecasts: false,
        externalLLM: false,
      },
    })
  fail(404, 'Platform route not found.')
}

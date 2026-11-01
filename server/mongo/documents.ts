import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { database } from './database'
import { digest, fail, throttle } from './security'
import { transaction } from './database'
import { appendEvent } from './workspace'
import { canReadModule, canWriteModule } from '../modules'
import {
  expose,
  findRecord,
  insertRecord,
  listRecords,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'

const upload = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(
        (s) =>
          !s.includes('/') &&
          !s.includes('\\') &&
          ![...s].some((c) => c.charCodeAt(0) < 32),
        'Use a filename without path separators or control characters.',
      ),
    mimeType: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w.+-]+\/[\w.+-]+$/),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024),
    contentBase64: z
      .string()
      .min(4)
      .max(2796204)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    category: z
      .enum(['Procurement', 'HR', 'Legal', 'Finance', 'Operations'])
      .default('Operations'),
  })
  .strict()
  .refine(
    (b) => Buffer.from(b.contentBase64, 'base64').length === b.sizeBytes,
    'File size does not match its content.',
  )

async function download(tenant: string, id: string, revision?: number) {
  const doc = await findRecord(tenant, 'document', id)
  if (doc.data.status !== 'active') fail(404, 'Document is archived.')
  const binary = await (
    await database()
  ).records.findOne({
    tenant,
    kind: 'document:binary',
    'data.document_id': id,
    'data.revision': revision || doc.data.current_revision,
  })
  if (!binary) fail(404, 'Document content not found.')
  return new Response(
    Buffer.from(String(binary.data.content_base64), 'base64'),
    {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition':
          "attachment; filename*=UTF-8''" +
          encodeURIComponent(String(binary.data.filename)),
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    },
  )
}
export async function sharedDocument(
  path: string,
  method: string,
): Promise<Response | undefined> {
  const route = path.match(/^\/shared-documents\/([a-f0-9]{64})$/)
  if (!route) return
  if (method !== 'GET') fail(405, 'Method not supported.')
  const share = await (
    await database()
  ).records.findOne({
    kind: 'document:share',
    'data.token_digest': digest(route[1]),
    'data.expires_at': { $gt: new Date().toISOString() },
  })
  if (!share) fail(404, 'Share link is invalid or expired.')
  await throttle('shared-document:' + share._id, 60)
  const response = await download(
    share.tenant,
    String(share.data.document_id),
    Number(share.data.revision),
  )
  await transaction((session) =>
    appendEvent(
      share.tenant,
      'External share link',
      'shared_document_downloaded',
      String(share.data.document_id),
      'Revision ' + share.data.revision,
      session,
    ),
  )
  return response
}
export async function handleDocuments(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const route = ctx.path.match(
    /^\/documents(?:\/([^/]+)(?:\/(content|comments|versions|shares))?)?$/,
  )
  if (!route) return
  const { account, request } = ctx,
    tenant = account.tenant,
    method = request.method
  if (!canReadModule(account.role, 'documents'))
    fail(403, 'Your role cannot view documents.')
  const id = route[1] ? z.uuid().parse(route[1]) : undefined,
    action = route[2],
    d = await database()
  if (method === 'GET') {
    if (!id)
      return Response.json({ documents: await listRecords(tenant, 'document') })
    const row = await findRecord(tenant, 'document', id)
    if (action === 'content') return download(tenant, id)
    if (action === 'comments')
      return Response.json({
        comments: (
          await d.records
            .find({ tenant, kind: 'document:comment', 'data.document_id': id })
            .sort({ created_at: -1 })
            .limit(500)
            .toArray()
        ).map((row) => expose(row)),
      })
    if (action === 'versions')
      return Response.json({
        versions: (
          await d.records
            .find(
              { tenant, kind: 'document:binary', 'data.document_id': id },
              { projection: { 'data.content_base64': 0 } },
            )
            .sort({ 'data.revision': -1 })
            .limit(500)
            .toArray()
        ).map((row) => expose(row)),
      })
    if (action) fail(405, 'Method not supported.')
    return Response.json(expose(row))
  }
  if (!canWriteModule(account.role, 'documents'))
    fail(403, 'Your role cannot change documents.')
  if (method === 'PATCH' && id && !action) {
    const input = z
      .object({ status: z.enum(['active', 'archived']) })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const saved = await updateRecord(
          await findRecord(tenant, 'document', id, session),
          input,
          session,
        )
        if (input.status === 'archived')
          await d.records.deleteMany(
            { tenant, kind: 'document:share', 'data.document_id': id },
            { session },
          )
        return expose(saved)
      }),
    )
  }
  if (method !== 'POST' || (!!id && !action) || action === 'content')
    fail(405, 'Method not supported.')
  if (action === 'comments') {
    const input = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        await findRecord(tenant, 'document', id!, session)
        return expose(
          await insertRecord(
            tenant,
            'document:comment',
            { document_id: id, body: input.body, author: account.name },
            session,
          ),
        )
      }),
      { status: 201 },
    )
  }
  if (action === 'shares') {
    const input = z
      .object({ expiresHours: z.number().int().min(1).max(168) })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const doc = await findRecord(tenant, 'document', id!, session)
        if (doc.data.status !== 'active')
          fail(409, 'Restore archived documents before sharing.')
        const token = randomBytes(32).toString('hex'),
          expiresAt = new Date(
            Date.now() + input.expiresHours * 3600000,
          ).toISOString()
        await insertRecord(
          tenant,
          'document:share',
          {
            document_id: id,
            revision: doc.data.current_revision,
            token_digest: digest(token),
            expires_at: expiresAt,
          },
          session,
        )
        return { token, expiresAt }
      }),
      { status: 201 },
    )
  }
  const input = upload.parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      const previous = id
        ? await findRecord(tenant, 'document', id, session)
        : undefined
      if (previous && previous.data.status !== 'active')
        fail(409, 'Restore archived documents before uploading a revision.')
      const revision = Number(previous?.data.current_revision || 0) + 1
      const data = {
        filename: input.filename,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        status: 'active',
        category: previous?.data.category || input.category,
        uploaded_by: account.name,
        current_revision: revision,
        storage_key: 'mongodb',
      }
      const doc = previous
        ? await updateRecord(previous, data, session)
        : await insertRecord(tenant, 'document', data, session)
      await insertRecord(
        tenant,
        'document:binary',
        {
          document_id: doc._id,
          revision,
          filename: input.filename,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          content_base64: input.contentBase64,
        },
        session,
      )
      return expose(doc)
    }),
    { status: 201 },
  )
}

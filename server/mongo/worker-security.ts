import { timingSafeEqual } from 'node:crypto'
import { digest, fail } from './security'

export function requireWorker(request: Request) {
  const secret = process.env.CRON_SECRET || ''
  if (
    secret.trim().length < 32 ||
    !timingSafeEqual(
      Buffer.from(digest(request.headers.get('authorization') || '')),
      Buffer.from(digest('Bearer ' + secret)),
    )
  )
    fail(401, 'Worker authorization is required.')
}

import { z } from 'zod'
import { canPerformAction, userRoles, type Action, type User, type UserRole } from '../src/types.ts'
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.')
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Choose a different password.',
    path: ['newPassword'],
  })
export const storedSessionSchema = z
  .object({
    user: z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string(),
      role: z.enum(userRoles),
    }),
    tenant: z.string().uuid(),
    csrf: z.string().length(64),
    sessionVersion: z.number().int().nonnegative(),
  })
  .strict()
export type Session = z.infer<typeof storedSessionSchema>
export interface AccountRow extends User {
  tenant_id: string
  active: boolean
  session_version: number
}
export function sessionIsCurrent(
  session: Session,
  account: AccountRow | undefined,
) {
  return (
    !!account &&
    account.active &&
    account.id === session.user.id &&
    account.tenant_id === session.tenant &&
    account.session_version === session.sessionVersion
  )
}
export function accessChangeAllowed(actor: User, target: User) {
  return (
    actor.role === 'owner' &&
    target.role !== 'owner' &&
    actor.id !== target.id
  )
}

export function actionAllowed(role: UserRole, action: Action) {
  return canPerformAction(role, action)
}

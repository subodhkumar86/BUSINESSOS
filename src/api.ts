import type { Snapshot, Action } from './types'
const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiBase + '/api/v1' + path, {
      ...options,
      credentials: apiBase ? 'include' : 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new ApiError(
      503,
      'Cannot reach the API. Start the API, PostgreSQL, and Redis.',
    )
  }
  const data = await response
    .json()
    .catch(() => ({ error: 'API unavailable. Start the backend and refresh.' }))
  if (!response.ok) {
    if (
      response.status === 401 &&
      !['/auth/login', '/auth/register'].includes(path)
    )
      window.dispatchEvent(
        new CustomEvent('businessos:session-ended', {
          detail: data.error || 'Session expired. Sign in again.',
        }),
      )
    throw new ApiError(response.status, data.error || 'Request failed.')
  }
  return data as T
}
export function saveAction(snapshot: Snapshot, action: Action, key: string) {
  return request<Snapshot>('/actions', {
    method: 'POST',
    headers: { 'X-CSRF-Token': snapshot.csrf, 'Idempotency-Key': key },
    body: JSON.stringify({ version: snapshot.version, action }),
  })
}

import type { Snapshot, Action } from './types'
export class ApiError extends Error {
  public status: number
  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.status = status
  }
}
export async function request<T>(
  path: string,
  options: RequestInit & { sessionRequired?: boolean } = {},
): Promise<T> {
  let response: Response
  const { sessionRequired = true, ...fetchOptions } = options
  try {
    response = await fetch('/api/v1' + path, {
      ...fetchOptions,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new ApiError(
      503,
      'Cannot reach the API. Start the Next.js API and MongoDB.',
    )
  }
  const data: unknown = await response.json().catch(() => undefined)
  const errorMessage =
    data && typeof data === 'object' && 'error' in data &&
    typeof data.error === 'string' && data.error.trim()
      ? data.error
      : 'The server returned an unexpected response. Please try again.'
  if (!response.ok) {
    if (
      response.status === 401 &&
      sessionRequired &&
      !['/auth/login', '/auth/register'].includes(path)
    )
      window.dispatchEvent(
        new CustomEvent('businessos:session-ended', {
          detail: errorMessage,
        }),
      )
    throw new ApiError(response.status, errorMessage)
  }
  if (data === undefined)
    throw new ApiError(502, 'The server returned an invalid response. Changes could not be confirmed; refresh before retrying.')
  return data as T
}
export function saveAction(snapshot: Snapshot, action: Action, key: string) {
  return request<Snapshot>('/actions', {
    method: 'POST',
    headers: { 'X-CSRF-Token': snapshot.csrf, 'Idempotency-Key': key },
    body: JSON.stringify({ version: snapshot.version, action }),
  })
}

export type DiagScope = 'voice' | 'speech' | 'chat' | 'greeting' | 'assistant'

const LOG_PREFIX = '[Turbo AI]'

let enabledCache: boolean | null = null

function isEnabled(): boolean {
  if (enabledCache !== null) return enabledCache
  let dev = false
  try {
    dev = Boolean(import.meta.env?.DEV)
  } catch {
    dev = false
  }
  let flag = false
  try {
    flag = typeof localStorage !== 'undefined' && localStorage.getItem('thermos-diagnostics') === 'on'
  } catch {
    flag = false
  }
  enabledCache = dev || flag
  return enabledCache
}

/**
 * Safe diagnostics: event names, durations, status codes and error categories only.
 * Never logs API keys, authorization headers or transcript content.
 * Enabled during development, or in production when
 * localStorage.setItem('thermos-diagnostics', 'on').
 */
export function diag(
  scope: DiagScope,
  event: string,
  data?: Record<string, string | number | boolean>
): void {
  if (!isEnabled()) return
  try {
    const detail = data
      ? ' ' +
        Object.entries(data)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : ''
    console.log(`${LOG_PREFIX} ${scope}.${event}${detail}`)
  } catch {
    // diagnostics must never break the app
  }
}

/** Short correlation id shared between frontend and backend logs. */
export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

import type { Language } from '../i18n/translations'
import type { TelemetryData } from '../telemetry/types'
import { diag, newRequestId } from './diagnostics'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface SendChatOptions {
  messages: ChatTurn[]
  language: Language
  telemetry: TelemetryData
  timeoutMs?: number
  signal?: AbortSignal
  /** Correlation id sent to the backend and included in diagnostics. */
  requestId?: string
}

const CHAT_ERROR_CODES = [
  'network',
  'timeout',
  'aborted',
  'rate_limit',
  'missing_key',
  'missing_model',
  'auth',
  'model_unavailable',
  'invalid_request',
  'server_error',
  'upstream',
  'not_found',
  'unknown',
] as const

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number]

const DEFAULT_TIMEOUT_MS = 40000
const CHAT_ENDPOINT = '/api/chat'

export class ChatError extends Error {
  code: ChatErrorCode

  constructor(code: ChatErrorCode, message?: string) {
    super(message || code)
    this.name = 'ChatError'
    this.code = code
  }
}

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === 'string' && (CHAT_ERROR_CODES as readonly string[]).includes(value)
}

/**
 * Maps an HTTP status to an error code when the backend could not provide a
 * machine-readable code (for example a Vercel 404 HTML page).
 */
function inferCode(status: number, code: unknown): ChatErrorCode {
  if (isChatErrorCode(code)) return code
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 400 || status === 413 || status === 405) return 'invalid_request'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 503) return 'upstream'
  if (status >= 500) return 'server_error'
  return 'unknown'
}

const FRIENDLY_MESSAGES: Record<ChatErrorCode, Record<Language, string>> = {
  network: {
    en: "Couldn't reach the Turbo AI service. Check your connection (and the local server if you're running locally), then try again.",
    hi: 'Turbo AI सेवा से कनेक्ट नहीं हो पा रहा। अपना कनेक्शन जाँचें (और लोकल चलाने पर सर्वर भी), फिर पुनः प्रयास करें।',
  },
  timeout: {
    en: 'The assistant took too long to respond. Please try again.',
    hi: 'सहायक का उत्तर आने में बहुत समय लगा। कृपया पुनः प्रयास करें।',
  },
  aborted: {
    en: 'Request cancelled.',
    hi: 'अनुरोध रद्द किया गया।',
  },
  rate_limit: {
    en: 'The assistant is handling too many requests right now. Please try again in a moment.',
    hi: 'सहायक अभी बहुत अधिक अनुरोध संभाल रहा है। कुछ क्षण बाद पुनः प्रयास करें।',
  },
  missing_key: {
    en: "Turbo AI isn't configured on this server yet (missing GEMINI_API_KEY). Please try again later.",
    hi: 'इस सर्वर पर Turbo AI कॉन्फ़िगर नहीं है (GEMINI_API_KEY अनुपलब्ध)। कृपया बाद में पुनः प्रयास करें।',
  },
  missing_model: {
    en: "Turbo AI isn't configured on this server yet (missing GEMINI_MODEL). Please try again later.",
    hi: 'इस सर्वर पर Turbo AI कॉन्फ़िगर नहीं है (GEMINI_MODEL अनुपलब्ध)। कृपया बाद में पुनः प्रयास करें।',
  },
  auth: {
    en: 'Turbo AI could not authenticate with the AI service. Please contact support.',
    hi: 'Turbo AI AI सेवा से प्रमाणित नहीं हो सका। कृपया सपोर्ट से संपर्क करें।',
  },
  model_unavailable: {
    en: 'The AI model is unavailable right now. Please try again shortly.',
    hi: 'AI मॉडल अभी अनुपलब्ध है। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
  },
  invalid_request: {
    en: "The assistant couldn't process that request. Please rephrase and try again.",
    hi: 'सहायक यह अनुरोध नहीं समझ सका। कृपया दोबारा लिखकर पुनः प्रयास करें।',
  },
  server_error: {
    en: 'Something went wrong on the server. Please try again.',
    hi: 'सर्वर पर कुछ समस्या हुई। कृपया पुनः प्रयास करें।',
  },
  upstream: {
    en: 'The AI service is unavailable right now. Please try again shortly.',
    hi: 'AI सेवा अभी अनुपलब्ध है। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
  },
  not_found: {
    en: "The AI endpoint isn't available on this deployment. Please contact support.",
    hi: 'इस डिप्लॉयमेंट पर AI एंडपॉइंट उपलब्ध नहीं है। कृपया सपोर्ट से संपर्क करें।',
  },
  unknown: {
    en: "Couldn't get an answer from Turbo AI. Please try again.",
    hi: 'Turbo AI से उत्तर नहीं मिल सका। कृपया पुनः प्रयास करें।',
  },
}

interface ChatApiResponse {
  reply?: unknown
  error?: { code?: unknown; message?: unknown }
}

async function readJson(response: Response): Promise<ChatApiResponse | null> {
  try {
    return (await response.json()) as ChatApiResponse | null
  } catch {
    // Non-JSON bodies (for example a Vercel HTML error page) are expected here.
    return null
  }
}

/**
 * Sends one chat request to the backend (`/api/chat`) with:
 *  - a request timeout that works even when an external AbortSignal is supplied,
 *  - safe parsing of non-2xx and malformed responses,
 *  - a request id shared with backend logs.
 *
 * Never exposes API keys — those live only on the server.
 */
export async function sendChat(options: SendChatOptions): Promise<string> {
  const {
    messages,
    language,
    telemetry,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: externalSignal,
    requestId = newRequestId(),
  } = options

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const startedAt = Date.now()
  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
      signal: controller.signal,
      body: JSON.stringify({ messages, language, telemetry }),
    })

    const payload = await readJson(response)

    if (!response.ok) {
      const serverCode = payload?.error?.code
      const code = inferCode(response.status, serverCode)
      const message = typeof payload?.error?.message === 'string' ? payload.error.message : undefined
      diag('chat', 'http-error', { requestId, status: response.status, code })
      throw new ChatError(code, message)
    }

    const reply = payload?.reply
    if (typeof reply !== 'string' || !reply.trim()) {
      diag('chat', 'malformed-reply', { requestId, status: response.status })
      throw new ChatError('upstream')
    }

    diag('chat', 'ok', { requestId, status: response.status, ms: Date.now() - startedAt })
    return reply.trim()
  } catch (error) {
    if (error instanceof ChatError) throw error
    const name = (error as Error)?.name
    if (name === 'AbortError') {
      if (timedOut) {
        diag('chat', 'timeout', { requestId, ms: Date.now() - startedAt })
        throw new ChatError('timeout')
      }
      diag('chat', 'aborted', { requestId, ms: Date.now() - startedAt })
      throw new ChatError('aborted')
    }
    diag('chat', 'network-error', { requestId, ms: Date.now() - startedAt })
    throw new ChatError('network')
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Retries only rate-limited requests with bounded backoff. Auth, abort,
 * configuration and invalid-request errors are never retried.
 */
export async function sendChatWithRetry(options: SendChatOptions, maxRetries = 2): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendChat(options)
    } catch (error) {
      lastError = error
      const retryable = error instanceof ChatError && error.code === 'rate_limit'
      if (retryable && attempt < maxRetries) {
        const base = 1000 * Math.pow(2, attempt)
        const delay = Math.min(base + Math.random() * 1000, 8000)
        diag('chat', 'rate-limit-retry', { attempt: attempt + 1, delayMs: Math.round(delay) })
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  throw lastError
}

export function friendlyChatError(error: unknown, language: Language): string {
  const code = error instanceof ChatError && isChatErrorCode(error.code) ? error.code : 'unknown'
  return FRIENDLY_MESSAGES[code][language]
}

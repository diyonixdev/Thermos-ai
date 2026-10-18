import type { Language } from '../i18n/translations'
import type { TelemetryData } from '../telemetry/types'

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
}

const CHAT_ERROR_CODES = [
  'network',
  'timeout',
  'rate_limit',
  'missing_key',
  'missing_model',
  'auth',
  'model_unavailable',
  'invalid_request',
  'server_error',
  'upstream',
  'unknown',
] as const

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number]

const DEFAULT_TIMEOUT_MS = 40000

export async function sendChatWithRetry(options: SendChatOptions, maxRetries = 2): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendChat(options)
      return result
    } catch (error) {
      lastError = error
      if (error instanceof ChatError && error.code === 'rate_limit' && attempt < maxRetries) {
        // Bounded exponential backoff with jitter: 1000ms * 2^attempt + random 0-1000ms
        const base = 1000 * Math.pow(2, attempt)
        const jitter = Math.random() * 1000
        const delay = Math.min(base + jitter, 8000)
        console.log(`[ThermosAI DEBUG] Rate limit hit — retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      // Do not retry abort, auth, missing key/model, invalid request, model unavailable
      throw error
    }
  }
  throw lastError
}

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

const FRIENDLY_MESSAGES: Record<ChatErrorCode, Record<Language, string>> = {
  network: {
    en: "I can't reach the Thermos AI backend. Check that the server is running — showing built-in answers for now.",
    hi: 'AI बैकएंड से कनेक्ट नहीं हो पा रहा। सर्वर चालू है यह जाँचें — इस बीच बिल्ट-इन उत्तर दिखाए जा रहे हैं।',
  },
  timeout: {
    en: 'The Gemini model took too long to respond — showing local telemetry snapshot.',
    hi: 'Gemini मॉडल का उत्तर आने में बहुत समय लगा — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  rate_limit: {
    en: 'The Gemini service is rate limited right now — showing local telemetry snapshot.',
    hi: 'Gemini सेवा रेट लिमिटेड है — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  missing_key: {
    en: "Gemini isn't configured yet — set GEMINI_API_KEY in the server .env file. Showing local telemetry snapshot.",
    hi: 'Gemini सेटअप अधूरा है — सर्वर .env में GEMINI_API_KEY सेट करें। इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  missing_model: {
    en: "Gemini isn't configured yet — set GEMINI_MODEL in the server .env file. Showing local telemetry snapshot.",
    hi: 'Gemini सेटअप अधूरा है — सर्वर .env में GEMINI_MODEL सेट करें। इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  auth: {
    en: 'Gemini rejected the API key — showing local telemetry snapshot.',
    hi: 'Gemini ने API कुंजी अस्वीकार की — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  model_unavailable: {
    en: 'The selected Gemini model is unavailable right now — showing local telemetry snapshot.',
    hi: 'चुना गया Gemini मॉडल अभी उपलब्ध नहीं है — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  invalid_request: {
    en: "The assistant couldn't process your request — showing local telemetry snapshot.",
    hi: 'सहायक अनुरोध नहीं समझ सका — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  server_error: {
    en: "Something went wrong on the server — showing local telemetry snapshot.",
    hi: 'सर्वर पर कुछ समस्या हुई — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  upstream: {
    en: 'The Gemini service is unavailable right now — showing local telemetry snapshot.',
    hi: 'Gemini सेवा अभी अनुपलब्ध है — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
  unknown: {
    en: "Couldn't get an answer from the assistant — showing local telemetry snapshot.",
    hi: 'सहायक से उत्तर नहीं मिल सका — इस बीच स्थानीय डेटा दिखाया जा रहा है।',
  },
}

interface ChatApiResponse {
  reply?: unknown
  error?: { code?: unknown; message?: unknown }
}

export async function sendChat(options: SendChatOptions): Promise<string> {
  const { messages, language, telemetry, timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: externalSignal || controller.signal,
      body: JSON.stringify({ messages, language, telemetry }),
    })

    const payload: ChatApiResponse | null = await response.json().catch(() => null)

    if (!response.ok) {
      const code = payload?.error?.code
      const message = typeof payload?.error?.message === 'string' ? payload.error.message : undefined
      throw new ChatError(isChatErrorCode(code) ? code : 'unknown', message)
    }

    const reply = payload?.reply
    if (typeof reply !== 'string' || !reply.trim()) {
      throw new ChatError('upstream')
    }
    return reply.trim()
  } catch (error) {
    if (error instanceof ChatError) throw error
    if ((error as Error)?.name === 'AbortError') throw new ChatError('timeout')
    throw new ChatError('network')
  } finally {
    clearTimeout(timer)
  }
}

export function friendlyChatError(error: unknown, language: Language): string {
  const code = error instanceof ChatError && isChatErrorCode(error.code) ? error.code : 'unknown'
  return FRIENDLY_MESSAGES[code][language]
}

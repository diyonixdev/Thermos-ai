/**
 * Shared /api/chat implementation used by:
 *  - server/index.js  (local Express development server)
 *  - api/chat.js      (Vercel serverless function)
 *
 * The Gemini API key is read from the environment on the server only and is
 * never logged, echoed in error messages or exposed to the client.
 */

const DEFAULT_TIMEOUT_MS = 30000
const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 4000
const TELEMETRY_FIELDS = [
  'batteryCharge',
  'chargingEtaMinutes',
  'rpm',
  'temperatureCelsius',
  'pressureBar',
  'recoveredPowerWatts',
  'recoveryEfficiency',
]

export function readConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
  const rawTimeout = Number.parseInt(process.env.CHAT_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || '', 10)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS
  return { apiKey, model, timeoutMs }
}

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

function safeRequestId(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? ` rid=${raw}` : ''
}

function log(source, rid, event, detail) {
  console.log(`[chat:${source}] ${event}${detail || ''}${rid || ''}`)
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return { message: 'messages must be a non-empty array.' }
  if (messages.length > MAX_MESSAGES) return { message: `messages must contain at most ${MAX_MESSAGES} items.` }
  const cleaned = []
  for (const item of messages) {
    if (!item || typeof item !== 'object') return { message: 'each message must be an object with role and content.' }
    if (item.role !== 'user' && item.role !== 'assistant') return { message: "each message role must be 'user' or 'assistant'." }
    if (typeof item.content !== 'string' || !item.content.trim()) return { message: 'each message needs a non-empty string content.' }
    if (item.content.length > MAX_CONTENT_LENGTH) return { message: `message content must be at most ${MAX_CONTENT_LENGTH} characters.` }
    cleaned.push({ role: item.role, content: item.content.trim() })
  }
  return { messages: cleaned }
}

function sanitizeTelemetry(input) {
  if (!input || typeof input !== 'object') return null
  const clean = {}
  for (const field of TELEMETRY_FIELDS) {
    const value = Number(input[field])
    if (Number.isFinite(value)) clean[field] = Math.round(value * 10) / 10
  }
  return Object.keys(clean).length > 0 ? clean : null
}

function num(value) {
  return String(Math.round(value * 10) / 10)
}

export function buildSystemPrompt(language, telemetry) {
  const lines = [
    'You are Turbo AI, a natural, concise automotive energy assistant embedded in the Turbo AI vehicle dashboard.',
    language === 'hi'
      ? 'Respond in Hindi (हिंदी). The user may write in English, Hindi or Hinglish — understand all three.'
      : 'Respond in English. The user may write in English, Hindi or Hinglish — understand all three.',
    'Cover battery charge, engine RPM, exhaust temperature, exhaust pressure and energy recovery when asked.',
  ]
  if (telemetry) {
    lines.push(
      'Live values supplied by the dashboard — use these exact readings and never invent other live values:',
      `- Battery charge: ${num(telemetry.batteryCharge)}% | Time to full: ${num(telemetry.chargingEtaMinutes)} min`,
      `- Engine RPM: ${num(telemetry.rpm)}`,
      `- Exhaust temperature: ${num(telemetry.temperatureCelsius)} °C`,
      `- Exhaust pressure: ${num(telemetry.pressureBar)} bar`,
      `- Recovered power: ${num(telemetry.recoveredPowerWatts)} W | Recovery efficiency: ${num(telemetry.recoveryEfficiency)}%`
    )
  } else {
    lines.push('No live values were supplied for this message — say the reading is unavailable instead of guessing.')
  }
  lines.push(
    'These are simulated readings supplied by the app. You only read them: never claim to control, adjust or reset vehicle hardware or sensors.',
    'Keep replies to 1-3 sentences unless the user asks for more detail.'
  )
  return lines.join('\n')
}

export async function handleChat(req, res, options = {}) {
  const source = options.source || 'server'
  const startedAt = Date.now()
  const rid = safeRequestId(req.headers && req.headers['x-request-id'])

  if (req.method !== 'POST') {
    return fail(res, 405, 'invalid_request', 'Only POST requests are supported.')
  }

  const { apiKey, model, timeoutMs } = readConfig()
  const body = req.body

  if (!body || typeof body !== 'object') {
    return fail(res, 400, 'invalid_request', 'Request body must be a JSON object.')
  }

  const validated = validateMessages(body.messages)
  if (validated.message) {
    return fail(res, 400, 'invalid_request', validated.message)
  }

  const language = body.language === 'hi' ? 'hi' : 'en'
  const telemetry = sanitizeTelemetry(body.telemetry)

  if (!apiKey) {
    log(source, rid, 'missing-key', '| GEMINI_API_KEY is not configured')
    return fail(res, 503, 'missing_key', 'GEMINI_API_KEY is not configured on the server.')
  }
  if (!model) {
    log(source, rid, 'missing-model', '| GEMINI_MODEL is not configured')
    return fail(res, 503, 'missing_model', 'GEMINI_MODEL is not configured on the server.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const systemPrompt = buildSystemPrompt(language, telemetry)
    const payload = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...validated.messages.map((item) => ({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.content }],
        })),
      ],
      generationConfig: { temperature: 0.6, maxOutputTokens: 700 },
    })

    log(source, rid, 'request', `| lang=${language} | turns=${validated.messages.length} | model=${model} | chars=${payload.length}`)

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        // The key travels in a header so it never appears in URLs or access logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: payload,
      }
    )

    const data = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      const msg = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 300) : ''
      log(source, rid, 'upstream-error', `| status=${upstream.status} | ms=${Date.now() - startedAt}`)
      if (upstream.status === 429) {
        return fail(res, 429, 'rate_limit', msg || 'Rate limit reached.')
      }
      if (upstream.status === 401 || upstream.status === 402 || upstream.status === 403) {
        return fail(res, 502, 'auth', 'Gemini rejected the API key.')
      }
      if (upstream.status === 404) {
        return fail(res, 502, 'model_unavailable', msg || 'The configured Gemini model was not found.')
      }
      return fail(res, 502, 'upstream', msg || 'Gemini request failed.')
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof reply !== 'string' || !reply.trim()) {
      log(source, rid, 'empty-reply', `| ms=${Date.now() - startedAt}`)
      return fail(res, 502, 'upstream', 'The model returned an empty response.')
    }

    log(source, rid, 'ok', `| ms=${Date.now() - startedAt} | lang=${language} | model=${model}`)
    return res.status(200).json({ reply: reply.trim(), model })
  } catch (error) {
    const name = error && error.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      log(source, rid, 'timeout', `| after=${timeoutMs}ms`)
      return fail(res, 504, 'timeout', 'The model took too long to respond.')
    }
    log(source, rid, 'network-error', `| ms=${Date.now() - startedAt}`)
    return fail(res, 502, 'upstream', 'Could not reach Gemini.')
  } finally {
    clearTimeout(timer)
  }
}

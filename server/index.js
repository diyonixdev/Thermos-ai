import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })
dotenv.config({ path: path.join(__dirname, '.env') })

const DEFAULT_TIMEOUT_MS = 30000
const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 4000
const TELEMETRY_FIELDS = [
  'batteryCharge','chargingEtaMinutes','rpm','temperatureCelsius','pressureBar','recoveredPowerWatts','recoveryEfficiency',
]

const app = express()
app.use(cors())
app.use(express.json({ limit: '256kb' }))

function readConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
  const rawTimeout = Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS || '', 10)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS
  return { apiKey, model, timeoutMs }
}

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
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

function buildSystemPrompt(language, telemetry) {
  const lines = [
    'You are Thermos AI, a natural, concise automotive energy assistant embedded in the Thermos AI vehicle dashboard.',
    language === 'hi' ? 'Respond in Hindi (हिंदी). The user may write in English, Hindi or Hinglish — understand all three.' : 'Respond in English. The user may write in English, Hindi or Hinglish — understand all three.',
    'Cover battery charge, engine RPM, exhaust temperature, exhaust pressure and energy recovery when asked.',
  ]
  if (telemetry) {
    lines.push(
      'Live values supplied by the dashboard — use these exact readings and never invent other live values:',
      `- Battery charge: ${num(telemetry.batteryCharge)}% | Time to full: ${num(telemetry.chargingEtaMinutes)} min`,
      `- Engine RPM: ${num(telemetry.rpm)}`,
      `- Exhaust temperature: ${num(telemetry.temperatureCelsius)} °C`,
      `- Exhaust pressure: ${num(telemetry.pressureBar)} bar`,
      `- Recovered power: ${num(telemetry.recoveredPowerWatts)} W | Recovery efficiency: ${num(telemetry.recoveryEfficiency)}%`,
    )
  } else {
    lines.push('No live values were supplied for this message — say the reading is unavailable instead of guessing.')
  }
  lines.push('These are simulated readings supplied by the app. You only read them: never claim to control, adjust or reset vehicle hardware or sensors.', 'Keep replies to 1-3 sentences unless the user asks for more detail.')
  return lines.join('\n')
}

app.get('/api/health', (_req, res) => {
  const { apiKey, model } = readConfig()
  res.json({ ok: true, configured: Boolean(apiKey && model), model: model || null })
})

app.post('/api/chat', async (req, res) => {
  const startedAt = Date.now()
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
    console.log('[DEBUG] MISSING API KEY')
    return fail(res, 503, 'missing_key', 'GEMINI_API_KEY is not configured on the server.')
  }
  if (!model) {
    console.log('[DEBUG] MISSING MODEL')
    return fail(res, 503, 'missing_model', 'GEMINI_MODEL is not configured on the server.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const systemPrompt = buildSystemPrompt(language, telemetry)
    const requestPayload = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...validated.messages.map((item) => ({ role: item.role === 'user' ? 'user' : 'model', parts: [{ text: item.content }] })),
      ],
      generationConfig: { temperature: 0.6, maxOutputTokens: 700 },
    })

    console.log(`[DEBUG] /api/chat | env-loaded=${process.env.GEMINI_API_KEY ? 'yes' : 'no'} | model=${model} | apiKeyPresent=${Boolean(apiKey)} | payload-length=${requestPayload.length}`)

    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: requestPayload,
    })

    const data = await upstream.json().catch(() => null)
    console.log(`[DEBUG] Gemini response status=${upstream.status} | model=${model}`)

    if (!upstream.ok) {
      const msg = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 300) : ''
      if (upstream.status === 429) {
        return fail(res, 429, 'rate_limit', msg || 'Rate limit reached.')
      }
      if (upstream.status === 401 || upstream.status === 402 || upstream.status === 403) {
        return fail(res, 502, 'auth', msg || 'API key rejected.')
      }
      return fail(res, 502, 'upstream', msg || 'Gemini request failed.')
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof reply !== 'string' || !reply.trim()) {
      return fail(res, 502, 'upstream', 'The model returned an empty response.')
    }

    console.log(`[chat] ok in ${Date.now() - startedAt}ms | lang=${language} | turns=${validated.messages.length} | model=${model}`)
    return res.json({ reply: reply.trim(), model })
  } catch (error) {
    const name = error?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      console.log(`[chat] timeout after ${timeoutMs}ms | model=${model}`)
      return fail(res, 504, 'timeout', 'The model took too long to respond.')
    }
    console.log(`[chat] network error: ${error?.message} | model=${model}`)
    return fail(res, 502, 'upstream', 'Could not reach Gemini.')
  } finally {
    clearTimeout(timer)
  }
})

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return fail(res, 400, 'invalid_request', 'Request body must be valid JSON.')
  }
  if (error?.type === 'entity.too.large') {
    return fail(res, 413, 'invalid_request', 'Request body is too large.')
  }
  console.log(`[server] error: ${error?.message}`)
  return fail(res, 500, 'server_error', 'Unexpected server error.')
})

const port = Number.parseInt(process.env.PORT || '3001', 10)
const host = process.env.HOST || '127.0.0.1'
app.listen(port, host, () => {
  const { model, apiKey } = readConfig()
  console.log(`[server] Thermos AI backend on http://${host}:${port}`)
  console.log(`[server] model=${model || 'NOT SET'} | apiKey=${apiKey ? 'loaded' : 'MISSING'}`)
})

import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const DEFAULT_TIMEOUT_MS = 30000
const MAX_MESSAGES = 20
const TELEMETRY_FIELDS = [
  'batteryCharge','chargingEtaMinutes','rpm','temperatureCelsius','pressureBar','recoveredPowerWatts','recoveryEfficiency',
]

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

function readConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
  const rawTimeout = parseInt(process.env.OPENROUTER_TIMEOUT_MS || '', 10)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS
  return { apiKey, model, timeoutMs }
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

function buildSystemPrompt(language, telemetry) {
  const lines = [
    'You are Thermos AI, a natural, concise automotive energy assistant embedded in the Thermos AI vehicle dashboard.',
    language === 'hi' ? 'Respond in Hindi (हिंदी). The user may write in English, Hindi or Hinglish — understand all three.' : 'Respond in English. The user may write in English, Hindi or Hinglish — understand all three.',
    'Cover battery charge, engine RPM, exhaust temperature, exhaust pressure and energy recovery when asked.',
  ]
  if (telemetry) {
    const n = (v) => String(Math.round(v * 10) / 10)
    lines.push('Live values supplied by the dashboard — use these exact readings and never invent other live values:',
      `- Battery charge: ${n(telemetry.batteryCharge)}% | Time to full: ${n(telemetry.chargingEtaMinutes)} min`,
      `- Engine RPM: ${n(telemetry.rpm)}`,
      `- Exhaust temperature: ${n(telemetry.temperatureCelsius)} °C`,
      `- Exhaust pressure: ${n(telemetry.pressureBar)} bar`,
      `- Recovered power: ${n(telemetry.recoveredPowerWatts)} W | Recovery efficiency: ${n(telemetry.recoveryEfficiency)}%`)
  } else {
    lines.push('No live values were supplied for this message — say the reading is unavailable instead of guessing.')
  }
  lines.push('These are simulated readings supplied by the app. You only read them: never claim to control, adjust or reset vehicle hardware or sensors.', 'Keep replies to 1-3 sentences unless the user asks for more detail.')
  return lines.join('\n')
}

export default async function handler(req, res) {
  const startedAt = Date.now()
  const { apiKey, model, timeoutMs } = readConfig()
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'invalid_request', message: 'POST only' } })
    const body = req.body || {}
    const validated = { messages: Array.isArray(body.messages) ? body.messages.slice(0, 20) : [] }
    if (!validated.messages.length || validated.messages.some((m) => !m || typeof m !== 'object' || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim())) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'messages must be non-empty array of user/assistant with string content.' } })
    }
    const language = body.language === 'hi' ? 'hi' : 'en'
    const telemetry = sanitizeTelemetry(body.telemetry)
    if (!apiKey) return res.status(503).json({ error: { code: 'missing_key', message: 'OPENROUTER_API_KEY not configured.' } })
    if (!model) return res.status(503).json({ error: { code: 'missing_model', message: 'OPENROUTER_MODEL not configured.' } })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const systemPrompt = buildSystemPrompt(language, telemetry)
    const requestPayload = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...validated.messages.map((item) => ({ role: item.role === 'user' ? 'user' : 'model', parts: [{ text: item.content }] })),
      ],
      generationConfig: { temperature: 0.6, maxOutputTokens: 700 },
    })
    console.log(`[DEBUG] /api/chat | env-loaded=${process.env.GEMINI_API_KEY ? 'yes' : 'no'} | model=${model} | apiKeyPresent=${Boolean(apiKey)} | payload-length=${requestPayload.length}`)
    const upstream = await fetch(GEMINI_URL(model) + `?key=${apiKey}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: requestPayload,
    })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const msg = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 300) : ''
      console.log(`[vercel] upstream ${upstream.status} in ${Date.now() - startedAt}ms | model=${model}`)
      if (upstream.status === 429) return res.status(429).json({ error: { code: 'rate_limit', message: msg || 'Rate limit reached.' } })
      if (upstream.status === 401 || upstream.status === 402 || upstream.status === 403) return res.status(502).json({ error: { code: 'auth', message: 'Gemini API key rejected.' } })
      return res.status(502).json({ error: { code: 'upstream', message: msg || 'Gemini request failed.' } })
    }
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof reply !== 'string' || !reply.trim()) return res.status(502).json({ error: { code: 'upstream', message: 'The model returned an empty response.' } })
    console.log(`[vercel] ok in ${Date.now() - startedAt}ms | lang=${language} | model=${model}`)
    return res.status(200).json({ reply: reply.trim(), model })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return res.status(504).json({ error: { code: 'timeout', message: 'Model timeout.' } })
    console.log(`[vercel] network error: ${error?.message} | model=${model}`)
    return res.status(502).json({ error: { code: 'upstream', message: 'Could not reach OpenRouter.' } })
  } finally {
    clearTimeout(timer)
  }
}
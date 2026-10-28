import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { handleChat, readConfig } from './chatHandler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })
dotenv.config({ path: path.join(__dirname, '.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (_req, res) => {
  const { apiKey, model } = readConfig()
  res.json({ ok: true, configured: Boolean(apiKey && model), model: model || null })
})

// app.all so non-POST requests get the handler's 405 response instead of a 404.
app.all('/api/chat', (req, res) => handleChat(req, res, { source: 'dev' }))

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_request', message: 'Request body must be valid JSON.' } })
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'invalid_request', message: 'Request body is too large.' } })
  }
  console.log(`[server] error: ${error?.message}`)
  return res.status(500).json({ error: { code: 'server_error', message: 'Unexpected server error.' } })
})

const port = Number.parseInt(process.env.PORT || '3001', 10)
const host = process.env.HOST || '127.0.0.1'
app.listen(port, host, () => {
  const { model, apiKey } = readConfig()
  console.log(`[server] Turbo AI backend on http://${host}:${port}`)
  console.log(`[server] model=${model || 'NOT SET'} | apiKey=${apiKey ? 'loaded' : 'MISSING'}`)
})

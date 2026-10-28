import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleChat } from '../server/chatHandler.js'

// Local `vercel dev` support: on Vercel the environment is provided by the
// project settings, and this file is not present in the deployment.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
try {
  dotenv.config({ path: path.join(__dirname, '..', '.env') })
} catch {
  // no local .env file — rely on process.env
}

/**
 * Vercel serverless endpoint. Shares its request validation, Gemini integration
 * and response format with server/index.js through server/chatHandler.js, so
 * local development and the deployed version behave the same.
 */
export default async function handler(req, res) {
  return handleChat(req, res, { source: 'vercel' })
}

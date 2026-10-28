import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatError, friendlyChatError, sendChat, sendChatWithRetry } from './chatApi'
import type { ChatTurn, SendChatOptions } from './chatApi'

const telemetry = {
  batteryCharge: 72,
  chargingEtaMinutes: 24,
  rpm: 3100,
  temperatureCelsius: 610,
  pressureBar: 2.1,
  recoveredPowerWatts: 1800,
  recoveryEfficiency: 62,
} as unknown as SendChatOptions['telemetry']

function baseOptions(overrides: Partial<SendChatOptions> = {}): SendChatOptions {
  const messages: ChatTurn[] = [{ role: 'user', content: 'battery level?' }]
  return { messages, language: 'en', telemetry, ...overrides }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('sendChat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns the trimmed reply on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { reply: '  Charging in 24 min.  ' }))
    vi.stubGlobal('fetch', fetchMock)

    const reply = await sendChat(baseOptions({ timeoutMs: 5000 }))
    expect(reply).toBe('Charging in 24 min.')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    const body = JSON.parse(String(init.body))
    expect(body.language).toBe('en')
    expect(body.messages[0].content).toBe('battery level?')
  })

  it('aborts the request when the internal timeout fires even if an external signal is supplied', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const external = new AbortController()
    const pending = sendChat(baseOptions({ timeoutMs: 50, signal: external.signal }))
    const assertion = expect(pending).rejects.toMatchObject({ name: 'ChatError', code: 'timeout' })

    await vi.advanceTimersByTimeAsync(60)
    await assertion
    expect(external.signal.aborted).toBe(false)
  })

  it('reports aborted when the external signal fires first', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const external = new AbortController()
    const pending = sendChat(baseOptions({ timeoutMs: 60000, signal: external.signal }))
    const assertion = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    external.abort()
    await assertion
  })

  it('maps a non-JSON 404 page to not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => {
          throw new Error('not json')
        },
      })
    )

    await expect(sendChat(baseOptions({ timeoutMs: 5000 }))).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('maps server error codes from the JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: 'rate_limit', message: 'slow down' } }))
    )

    await expect(sendChat(baseOptions({ timeoutMs: 5000 }))).rejects.toMatchObject({
      code: 'rate_limit',
      message: 'slow down',
    })
  })

  it('throws upstream when the reply is missing or blank', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { reply: '   ' })))
    await expect(sendChat(baseOptions({ timeoutMs: 5000 }))).rejects.toMatchObject({
      code: 'upstream',
    })
  })

  it('throws network when fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(sendChat(baseOptions({ timeoutMs: 5000 }))).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('never includes an api key in the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { reply: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    await sendChat(baseOptions({ timeoutMs: 5000 }))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const serialized = JSON.stringify(init.headers) + String(init.body)
    expect(serialized).not.toMatch(/GEMINI|api[-_]?key/i)
    expect(url).not.toContain('key=')
  })
})

describe('sendChatWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries rate-limit errors then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: 'rate_limit' } }))
      .mockResolvedValueOnce(jsonResponse(200, { reply: 'recovered' }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = sendChatWithRetry(baseOptions({ timeoutMs: 5000 }))
    // Backoff uses a timer — let it elapse before awaiting the result.
    await vi.advanceTimersByTimeAsync(9000)
    await expect(pending).resolves.toBe('recovered')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry auth errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'auth' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendChatWithRetry(baseOptions({ timeoutMs: 5000 }))).rejects.toMatchObject({
      code: 'auth',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('friendlyChatError', () => {
  it('returns a friendly message per code and language', () => {
    const en = friendlyChatError(new ChatError('rate_limit'), 'en')
    const hi = friendlyChatError(new ChatError('rate_limit'), 'hi')
    expect(en).not.toMatch(/local|telemetry snapshot/i)
    expect(hi).not.toMatch(/local|टेलीमेट्री स्नैपशॉट/i)
    expect(friendlyChatError(new Error('boom'), 'en')).toBe(
      friendlyChatError(new Error('boom'), 'en')
    )
  })

  it('keeps API key details out of user-facing messages', () => {
    const message = friendlyChatError(new ChatError('missing_key'), 'en')
    expect(message).toContain('GEMINI_API_KEY')
    expect(message).not.toContain('sk-')
  })
})

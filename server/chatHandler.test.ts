import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSystemPrompt, handleChat, readConfig } from './chatHandler'

type Res = {
  statusCode: number
  body: unknown
  status: (code: number) => Res
  json: (payload: unknown) => Res
}

function makeRes(): Res {
  const res: Res = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

function req(body: unknown, method = 'POST', headers: Record<string, string> = {}) {
  return { method, body, headers } as unknown as Parameters<typeof handleChat>[0]
}

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

describe('readConfig', () => {
  it('falls back to defaults for missing optional values', async () => {
    await withEnv({ GEMINI_MODEL: undefined, CHAT_TIMEOUT_MS: undefined }, () => {
      const config = readConfig()
      expect(config.model).toBe('gemini-2.5-flash')
      expect(config.timeoutMs).toBe(30000)
      return Promise.resolve()
    })
  })

  it('reads model and timeout from the environment', async () => {
    await withEnv({ GEMINI_MODEL: 'gemini-custom', CHAT_TIMEOUT_MS: '12345' }, async () => {
      const config = readConfig()
      expect(config.model).toBe('gemini-custom')
      expect(config.timeoutMs).toBe(12345)
    })
  })
})

describe('buildSystemPrompt', () => {
  it('embeds live telemetry and the selected language', () => {
    const prompt = buildSystemPrompt('hi', {
      batteryCharge: 72,
      chargingEtaMinutes: 24,
      rpm: 3100,
      temperatureCelsius: 610,
      pressureBar: 2.1,
      recoveredPowerWatts: 1800,
      recoveryEfficiency: 62,
    } as never)
    expect(prompt).toContain('Hindi')
    expect(prompt).toContain('72')
    expect(prompt).toContain('3100')
    expect(prompt).toMatch(/never claim to control/i)
  })

  it('states that readings are unavailable when no telemetry is supplied', () => {
    const prompt = buildSystemPrompt('en', null)
    expect(prompt).toMatch(/no live values/i)
    expect(prompt).not.toContain('72')
  })
})

describe('handleChat', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects non-POST methods', async () => {
    const res = makeRes()
    await handleChat(req({}, 'GET'), res as never, { source: 'test' })
    expect(res.statusCode).toBe(405)
    expect((res.body as { error: { code: string } }).error.code).toBe('invalid_request')
  })

  it('rejects an empty or malformed messages array', async () => {
    const empty = makeRes()
    await handleChat(req({ messages: [] }), empty as never, { source: 'test' })
    expect(empty.statusCode).toBe(400)

    const badRole = makeRes()
    await handleChat(req({ messages: [{ role: 'tool', content: 'x' }] }), badRole as never, {
      source: 'test',
    })
    expect(badRole.statusCode).toBe(400)
  })

  it('reports 503 when GEMINI_API_KEY is not configured', async () => {
    await withEnv({ GEMINI_API_KEY: undefined }, async () => {
      const res = makeRes()
      await handleChat(
        req({ messages: [{ role: 'user', content: 'hi' }] }),
        res as never,
        { source: 'test' }
      )
      expect(res.statusCode).toBe(503)
      expect((res.body as { error: { code: string } }).error.code).toBe('missing_key')
      // The message must not leak any key material.
      expect(JSON.stringify(res.body)).not.toMatch(/sk-|AIza/)
    })
  })

  it('proxies a successful Gemini response and never exposes the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '  Battery is fine.  ' }] } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await withEnv(
      { GEMINI_API_KEY: 'test-secret-key-value', GEMINI_MODEL: 'gemini-2.5-flash' },
      async () => {
        const res = makeRes()
        await handleChat(
          req({ messages: [{ role: 'user', content: 'battery?' }], language: 'en' }),
          res as never,
          { source: 'test' }
        )
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual({ reply: 'Battery is fine.', model: 'gemini-2.5-flash' })
      }
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // Key travels in a header, never in the URL.
    expect(headers['x-goog-api-key']).toBe('test-secret-key-value')
    expect(fetchMock.mock.calls[0][0]).not.toContain('test-secret-key-value')
    expect(fetchMock.mock.calls[0][0]).not.toContain('key=')
  })

  it('maps upstream rate limits to 429 rate_limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'quota exceeded' } }),
      })
    )

    await withEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }, async () => {
      const res = makeRes()
      await handleChat(req({ messages: [{ role: 'user', content: 'hi' }] }), res as never, {
        source: 'test',
      })
      expect(res.statusCode).toBe(429)
      expect((res.body as { error: { code: string } }).error.code).toBe('rate_limit')
    })
  })

  it('maps upstream auth failures to 502 auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'bad key' } }),
      })
    )

    await withEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }, async () => {
      const res = makeRes()
      await handleChat(req({ messages: [{ role: 'user', content: 'hi' }] }), res as never, {
        source: 'test',
      })
      expect(res.statusCode).toBe(502)
      expect((res.body as { error: { code: string } }).error.code).toBe('auth')
      // Never echo upstream key details back to the client.
      expect(JSON.stringify(res.body)).not.toContain('bad key')
    })
  })

  it('reports 502 upstream when the model returns an empty reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    )

    await withEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }, async () => {
      const res = makeRes()
      await handleChat(req({ messages: [{ role: 'user', content: 'hi' }] }), res as never, {
        source: 'test',
      })
      expect(res.statusCode).toBe(502)
      expect((res.body as { error: { code: string } }).error.code).toBe('upstream')
    })
  })

  it('times out a hanging upstream request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
      )
    )

    await withEnv(
      { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', CHAT_TIMEOUT_MS: '50' },
      async () => {
        const res = makeRes()
        await handleChat(req({ messages: [{ role: 'user', content: 'hi' }] }), res as never, {
          source: 'test',
        })
        expect(res.statusCode).toBe(504)
        expect((res.body as { error: { code: string } }).error.code).toBe('timeout')
      }
    )
  })
})

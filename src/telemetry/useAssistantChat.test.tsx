import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceAssistantApi } from './useVoiceAssistant'
import { useAssistantChat } from './useAssistantChat'

const sendChatMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/chatApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/chatApi')>()
  return { ...actual, sendChatWithRetry: sendChatMock }
})

vi.mock('./useTelemetry', () => ({
  useTelemetry: () => ({
    telemetry: {
      batteryCharge: 72,
      chargingEtaMinutes: 24,
      rpm: 3100,
      temperatureCelsius: 610,
      pressureBar: 2.1,
      recoveredPowerWatts: 1800,
      recoveryEfficiency: 62,
    },
  }),
}))

function makeVoice(): VoiceAssistantApi {
  return {
    state: 'idle',
    message: '',
    isSupported: true,
    voiceActive: false,
    startListening: vi.fn(() => true),
    stopListening: vi.fn(),
    pauseVoice: vi.fn(),
    beginProcessing: vi.fn(),
    endProcessing: vi.fn(),
    speakResponse: vi.fn(async () => {}),
    interruptSpeech: vi.fn(),
  }
}

function setup() {
  const voice = makeVoice()
  const utils = renderHook(() =>
    useAssistantChat({ language: 'en', voice, greeting: 'Hello from Turbo AI' })
  )
  return { voice, ...utils }
}

describe('useAssistantChat', () => {
  beforeEach(() => {
    localStorage.clear()
    sendChatMock.mockReset()
  })

  it('starts with only the greeting message', () => {
    const { result } = setup()
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({ role: 'assistant', text: 'Hello from Turbo AI' })
    expect(result.current.loading).toBe(false)
  })

  it('appends the user question, shows the reply and clears loading', async () => {
    sendChatMock.mockResolvedValue('Battery is at 72%.')
    const { result, voice } = setup()

    act(() => result.current.ask('how much battery?'))

    expect(result.current.loading).toBe(true)
    expect(voice.beginProcessing).toHaveBeenCalledTimes(1)
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1]).toMatchObject({ role: 'user', text: 'how much battery?' })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.messages).toHaveLength(3)
    expect(result.current.messages[2]).toMatchObject({ role: 'assistant', text: 'Battery is at 72%.' })
    expect(voice.speakResponse).toHaveBeenCalledWith('Battery is at 72%.')
    expect(result.current.notice).toBeNull()
  })

  it('ignores empty and whitespace-only questions', () => {
    sendChatMock.mockResolvedValue('x')
    const { result } = setup()
    act(() => {
      result.current.ask('   ')
      result.current.ask('')
    })
    expect(sendChatMock).not.toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(1)
  })

  it('suppresses a duplicate question inside the dedupe window', async () => {
    sendChatMock.mockResolvedValue('ok')
    const { result } = setup()

    act(() => result.current.ask('same question'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.ask('same question'))
    expect(sendChatMock).toHaveBeenCalledTimes(1)

    // force:true (retry path) bypasses the dedupe window.
    act(() => result.current.ask('same question', { force: true }))
    expect(sendChatMock).toHaveBeenCalledTimes(2)
  })

  it('shows a retryable notice instead of a fake assistant answer on failure', async () => {
    const { ChatError } = await import('../lib/chatApi')
    sendChatMock.mockRejectedValue(new ChatError('network'))
    const { result, voice } = setup()

    act(() => result.current.ask('what is rpm?'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.notice).toBeTruthy()
    expect(result.current.retryText).toBe('what is rpm?')
    // Failure must never appear as a chat bubble.
    expect(result.current.messages).toHaveLength(2)
    expect(voice.endProcessing).toHaveBeenCalled()
    expect(voice.speakResponse).not.toHaveBeenCalled()
  })

  it('retries the failed question with force (bypassing dedupe)', async () => {
    const { ChatError } = await import('../lib/chatApi')
    sendChatMock.mockRejectedValueOnce(new ChatError('rate_limit')).mockResolvedValueOnce('recovered')
    const { result } = setup()

    act(() => result.current.ask('question one'))
    await waitFor(() => expect(result.current.retryText).toBe('question one'))

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.messages.at(-1)?.text).toBe('recovered'))
    expect(sendChatMock).toHaveBeenCalledTimes(2)
    expect(result.current.retryText).toBeNull()
    expect(result.current.notice).toBeNull()
  })

  it('drops a stale reply that resolves after an interrupt', async () => {
    let resolveReply: ((value: string) => void) | undefined
    sendChatMock.mockImplementation(
      () => new Promise<string>((resolve) => (resolveReply = resolve))
    )
    const { result, voice } = setup()

    act(() => result.current.ask('slow question'))
    expect(result.current.loading).toBe(true)

    act(() => result.current.interrupt())

    expect(result.current.loading).toBe(false)
    expect(voice.interruptSpeech).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBeTruthy()

    await act(async () => {
      resolveReply?.('stale answer that must be dropped')
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages.at(-1)?.role).toBe('user')
    expect(voice.speakResponse).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('blocks questions while paused and resumes listening after unpause', async () => {
    sendChatMock.mockResolvedValue('answer')
    const { result, voice } = setup()

    // Voice mode was already active before the agent was paused.
    voice.voiceActive = true
    act(() => result.current.togglePause())
    expect(result.current.agentPaused).toBe(true)
    expect(voice.pauseVoice).toHaveBeenCalledTimes(1)

    act(() => result.current.ask('question while paused'))
    expect(sendChatMock).not.toHaveBeenCalled()
    expect(result.current.notice).toBeTruthy()

    act(() => result.current.togglePause())
    expect(result.current.agentPaused).toBe(false)
    expect(voice.startListening).toHaveBeenCalled()
  })

  it('clearChat empties the conversation and notice', async () => {
    sendChatMock.mockResolvedValue('x')
    const { result } = setup()
    act(() => result.current.ask('q'))
    await waitFor(() => expect(result.current.messages).toHaveLength(3))

    act(() => result.current.clearChat())
    expect(result.current.messages).toHaveLength(0)
    expect(result.current.notice).toBeNull()
  })

  it('sends a bounded history of at most 12 turns', async () => {
    sendChatMock.mockResolvedValue('ok')
    const { result } = setup()

    for (let i = 0; i < 8; i++) {
      act(() => result.current.ask(`question ${i}`, { force: true }))
      await waitFor(() => expect(result.current.loading).toBe(false))
    }

    const lastCall = sendChatMock.mock.calls.at(-1)?.[0] as { messages: unknown[] }
    expect(lastCall.messages).toHaveLength(12)
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceAssistant } from './useVoiceAssistant'

type Handler = ((event: unknown) => void) | null

class FakeRecognition {
  static instances: FakeRecognition[] = []
  continuous = false
  interimResults = false
  maxAlternatives = 1
  lang = ''
  onresult: Handler = null
  onerror: Handler = null
  onend: Handler = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() {
    FakeRecognition.instances.push(this)
  }
  emitFinal(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript } }] })
  }
  emitInterim(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript } }] })
  }
}

function installRecognition() {
  FakeRecognition.instances = []
  Object.defineProperty(window, 'SpeechRecognition', {
    value: FakeRecognition,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    value: FakeRecognition,
    configurable: true,
    writable: true,
  })
}

function removeRecognition() {
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })
}

describe('useVoiceAssistant', () => {
  beforeEach(() => {
    localStorage.clear()
    installRecognition()
  })
  afterEach(() => {
    removeRecognition()
    vi.useRealTimers()
  })

  it('reports unsupported when the API is missing', () => {
    removeRecognition()
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    expect(result.current.isSupported).toBe(false)
    expect(result.current.state).toBe('error')
    expect(result.current.message).toBeTruthy()
  })

  it('does not touch synthesis until a lifecycle method is called', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    expect(result.current.state).toBe('idle')
    expect(result.current.voiceActive).toBe(false)
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('recreates recognition when the language changes', () => {
    const { rerender } = renderHook(({ lang }: { lang: 'en' | 'hi' }) => useVoiceAssistant(lang, 0.7), {
      initialProps: { lang: 'en' as 'en' | 'hi' },
    })
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(FakeRecognition.instances[0].lang).toBe('en-IN')

    rerender({ lang: 'hi' })
    expect(FakeRecognition.instances).toHaveLength(2)
    const latest = FakeRecognition.instances[1]
    expect(latest.lang).toBe('hi-IN')
  })

  it('startListening enables voice mode, starts recognition and invokes onResult with final transcripts only', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    const onResult = vi.fn()

    let started = false
    act(() => {
      started = result.current.startListening(onResult)
    })
    expect(started).toBe(true)
    expect(result.current.voiceActive).toBe(true)
    expect(result.current.state).toBe('listening')

    const rec = FakeRecognition.instances[0]
    expect(rec.start).toHaveBeenCalledTimes(1)

    // Interim results are ignored — only final transcripts reach the app.
    act(() => rec.emitInterim('battery le'))
    expect(onResult).not.toHaveBeenCalled()

    act(() => rec.emitFinal('battery level?'))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('battery level?')
  })

  it('suppresses an identical transcript resubmitted within the dedupe window', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    const onResult = vi.fn()
    act(() => result.current.startListening(onResult))

    const rec = FakeRecognition.instances[0]
    act(() => rec.emitFinal('same words'))
    act(() => rec.emitFinal('same words'))
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('stopListening disables voice mode and stops recognition', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    act(() => result.current.startListening(vi.fn()))
    const rec = FakeRecognition.instances[0]

    act(() => result.current.stopListening())
    expect(result.current.voiceActive).toBe(false)
    expect(result.current.state).toBe('idle')
    expect(rec.stop).toHaveBeenCalled()
  })

  it('beginProcessing suspends the mic and endProcessing returns to listening', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    const onResult = vi.fn()
    act(() => result.current.startListening(onResult))
    const rec = FakeRecognition.instances[0]

    act(() => result.current.beginProcessing())
    expect(result.current.state).toBe('processing')

    // beginProcessing stops the recognizer but handlers stay attached, so a late
    // final result (echo of the user's own question) must be suppressed.
    act(() => rec.emitFinal('echo of my own question'))
    expect(onResult).not.toHaveBeenCalled()

    act(() => result.current.endProcessing())
    expect(result.current.state).toBe('listening')
    expect(result.current.voiceActive).toBe(true)
  })

  it('pauseVoice stops listening and exposes the paused state', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    act(() => result.current.startListening(vi.fn()))
    act(() => result.current.pauseVoice())
    expect(result.current.state).toBe('paused')
    expect(result.current.voiceActive).toBe(false)
  })

  it('interruptSpeech stops speech and returns to listening when voice mode is on', () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    act(() => result.current.startListening(vi.fn()))
    act(() => result.current.beginProcessing())

    act(() => result.current.interruptSpeech())
    expect(result.current.state).toBe('listening')
  })

  it('surfaces an error state when recognition reports a fatal error', async () => {
    const { result } = renderHook(() => useVoiceAssistant('en', 0.7))
    act(() => result.current.startListening(vi.fn()))
    const rec = FakeRecognition.instances[0]

    act(() => rec.onerror?.({ error: 'not-allowed' }))
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.message).toBeTruthy()
  })
})

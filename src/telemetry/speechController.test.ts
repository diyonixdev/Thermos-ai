import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelSpeech,
  getEffectiveVolume,
  isSpeechActive,
  isVoiceOutputEnabled,
  pickVoice,
  speakOnce,
} from './speechController'

type SpeakHandler = (() => void) | undefined

class FakeUtterance {
  text: string
  lang = ''
  voice: SpeechSynthesisVoice | null = null
  rate = 1
  pitch = 1
  volume = 1
  onstart: SpeakHandler
  onend: SpeakHandler
  onerror: ((event: unknown) => void) | undefined
  constructor(text: string) {
    this.text = text
  }
}

function fakeVoice(lang: string, name = `voice-${lang}`): SpeechSynthesisVoice {
  return { lang, name, localService: true, default: false, voiceURI: name } as SpeechSynthesisVoice
}

function installSpeechSynthesis(voices: SpeechSynthesisVoice[]) {
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: vi.fn(() => voices),
    speak: vi.fn(function (this: { queue: FakeUtterance[] }, utter: FakeUtterance) {
      this.queue.push(utter)
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    queue: [] as FakeUtterance[],
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  })
  return synth
}

describe('getEffectiveVolume / isVoiceOutputEnabled', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('defaults to 0.7 when nothing is stored', () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    expect(getEffectiveVolume()).toBeCloseTo(0.7)
  })

  it('returns 0 when muted even if a volume is stored', () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    localStorage.setItem('thermos-volume', '80')
    localStorage.setItem('thermos-mute', 'true')
    expect(getEffectiveVolume()).toBe(0)
    expect(isVoiceOutputEnabled()).toBe(false)
  })

  it('uses the stored volume', () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    localStorage.setItem('thermos-volume', '40')
    expect(getEffectiveVolume()).toBeCloseTo(0.4)
    expect(isVoiceOutputEnabled()).toBe(true)
  })

  it('ignores invalid stored values', () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    localStorage.setItem('thermos-volume', 'not-a-number')
    expect(getEffectiveVolume()).toBeCloseTo(0.7)
  })
})

describe('pickVoice', () => {
  it('prefers en-IN for English', () => {
    const voices = [fakeVoice('en-US'), fakeVoice('en-IN', 'Hindi English'), fakeVoice('hi-IN')]
    expect(pickVoice(voices, 'en')?.name).toBe('Hindi English')
  })

  it('falls back through en-GB then en-US for English', () => {
    expect(pickVoice([fakeVoice('en-US'), fakeVoice('en-GB')], 'en')?.lang).toBe('en-GB')
    expect(pickVoice([fakeVoice('en-US'), fakeVoice('fr-FR')], 'en')?.lang).toBe('en-US')
  })

  it('prefers hi-IN for Hindi and returns undefined when no Hindi voice exists', () => {
    expect(pickVoice([fakeVoice('hi-IN'), fakeVoice('hi-IN-extra')], 'hi')?.lang).toBe('hi-IN')
    expect(pickVoice([fakeVoice('en-US')], 'hi')).toBeUndefined()
  })

  it('returns undefined for an empty voice list', () => {
    expect(pickVoice([], 'en')).toBeUndefined()
  })
})

describe('speakOnce', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    cancelSpeech('test-cleanup')
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('returns empty for blank text without touching synthesis', () => {
    const synth = installSpeechSynthesis([fakeVoice('en-IN')])
    return expect(speakOnce('   ', 'en')).resolves.toBe('empty').then(() => {
      expect(synth.speak).not.toHaveBeenCalled()
    })
  })

  it('returns muted when voice output is disabled', () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    localStorage.setItem('thermos-mute', 'true')
    return expect(speakOnce('hello', 'en')).resolves.toBe('muted')
  })

  it('returns unsupported when speechSynthesis is missing', () => {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true })
    return expect(speakOnce('hello', 'en')).resolves.toBe('unsupported')
  })

  it('cancels previous speech and speaks with the picked voice', async () => {
    const synth = installSpeechSynthesis([fakeVoice('en-IN', 'Indian English')])

    const pending = speakOnce('hello world', 'en')
    await vi.advanceTimersByTimeAsync(0)

    expect(synth.cancel).toHaveBeenCalled()
    expect(synth.speak).toHaveBeenCalledTimes(1)
    const utter = synth.speak.mock.calls[0][0] as FakeUtterance
    expect(utter.text).toBe('hello world')
    expect(utter.voice?.name).toBe('Indian English')

    utter.onstart?.()
    utter.onend?.()
    await expect(pending).resolves.toBe('ended')
  })

  it('resolves cancelled when superseded by a second speakOnce', async () => {
    const synth = installSpeechSynthesis([fakeVoice('en-IN')])

    const first = speakOnce('first', 'en')
    await vi.advanceTimersByTimeAsync(0)
    const second = speakOnce('second', 'en')
    await vi.advanceTimersByTimeAsync(0)

    await expect(first).resolves.toBe('cancelled')
    expect(synth.speak).toHaveBeenCalledTimes(2)
    const secondUtter = synth.speak.mock.calls[1][0] as FakeUtterance
    secondUtter.onstart?.()
    secondUtter.onend?.()
    await expect(second).resolves.toBe('ended')
  })

  it('resolves blocked when the utterance never starts (autoplay restriction)', async () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    const pending = speakOnce('hello', 'en')
    await vi.advanceTimersByTimeAsync(0)
    // START_TIMEOUT_MS (1200) elapses with no onstart → blocked.
    await vi.advanceTimersByTimeAsync(1300)
    await expect(pending).resolves.toBe('blocked')
  })

  it('cancelSpeech settles an in-flight utterance as cancelled', async () => {
    installSpeechSynthesis([fakeVoice('en-IN')])
    const pending = speakOnce('hello', 'en')
    await vi.advanceTimersByTimeAsync(0)
    expect(isSpeechActive()).toBe(true)
    cancelSpeech('user-interrupt')
    await expect(pending).resolves.toBe('cancelled')
    expect(isSpeechActive()).toBe(false)
  })

  it('reports the onStarted callback once speech actually starts', async () => {
    const synth = installSpeechSynthesis([fakeVoice('en-IN')])
    const onStarted = vi.fn()
    const pending = speakOnce('hello', 'en', { onStarted })
    await vi.advanceTimersByTimeAsync(0)
    expect(onStarted).not.toHaveBeenCalled()
    const utter = synth.speak.mock.calls[0][0] as FakeUtterance
    utter.onstart?.()
    expect(onStarted).toHaveBeenCalledTimes(1)
    utter.onend?.()
    await expect(pending).resolves.toBe('ended')
  })
})

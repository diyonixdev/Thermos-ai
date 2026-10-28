import { diag } from '../lib/diagnostics'

export type SpeakOutcome = 'ended' | 'blocked' | 'error' | 'cancelled' | 'muted' | 'unsupported' | 'empty'

export interface SpeakOptions {
  /** Fired every time this utterance actually starts (including a late autoplay start). */
  onStarted?: () => void
}

const SPEECH_VOLUME_KEY = 'thermos-volume'
const SPEECH_MUTE_KEY = 'thermos-mute'
const START_TIMEOUT_MS = 1200

/** Monotonic token: every new speak/cancel invalidates older utterances. */
let speechToken = 0
let settleCurrent: ((outcome: SpeakOutcome) => void) | null = null

export function getEffectiveVolume(): number {
  try {
    const mute = localStorage.getItem(SPEECH_MUTE_KEY) === 'true'
    if (mute) return 0
    const saved = localStorage.getItem(SPEECH_VOLUME_KEY)
    const value = saved ? parseInt(saved, 10) : 70
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : 0.7
  } catch {
    return 0.7
  }
}

function hasSpeechSynthesis(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.speechSynthesis) &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  )
}

/** True when the user enabled voice output (not muted and synthesis available). */
export function isVoiceOutputEnabled(): boolean {
  return hasSpeechSynthesis() && getEffectiveVolume() > 0
}

export function createUtterance(text: string, lang: 'en' | 'hi'): SpeechSynthesisUtterance {
  const utter = new window.SpeechSynthesisUtterance(text)
  utter.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'
  utter.rate = 1.05
  utter.pitch = 1
  utter.volume = getEffectiveVolume()
  return utter
}

/**
 * Loads available voices, waiting for the async `voiceschanged` event when the
 * browser has not populated its voice list yet (Chrome populates it late).
 */
export function getVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!hasSpeechSynthesis()) return Promise.resolve([])
  const synth = window.speechSynthesis
  let cached: SpeechSynthesisVoice[] = []
  try {
    cached = synth.getVoices() || []
  } catch {
    cached = []
  }
  if (cached.length > 0) return Promise.resolve(cached)

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        synth.removeEventListener('voiceschanged', finish)
      } catch {
        // ignore
      }
      let voices: SpeechSynthesisVoice[] = []
      try {
        voices = synth.getVoices() || []
      } catch {
        voices = []
      }
      diag('speech', 'voices-loaded', { count: voices.length })
      resolve(voices)
    }
    const timer = setTimeout(finish, timeoutMs)
    try {
      synth.addEventListener('voiceschanged', finish)
    } catch {
      finish()
    }
  })
}

function normalized(lang: string | undefined): string {
  return (lang || '').replace('_', '-').toLowerCase()
}

/**
 * Voice preference:
 *  - English: en-IN first, then other English voices.
 *  - Hindi: hi-IN first, then any Hindi voice.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: 'en' | 'hi'
): SpeechSynthesisVoice | undefined {
  if (!voices || voices.length === 0) return undefined
  const base = lang === 'hi' ? 'hi' : 'en'
  const exact = lang === 'hi' ? 'hi-in' : 'en-in'
  const sameLanguage = voices.filter((voice) => normalized(voice.lang).startsWith(base))
  if (sameLanguage.length === 0) return undefined
  return (
    sameLanguage.find((voice) => normalized(voice.lang) === exact) ??
    sameLanguage.find((voice) => normalized(voice.lang).startsWith(`${exact}-`)) ??
    (lang === 'en'
      ? sameLanguage.find((voice) => normalized(voice.lang).startsWith('en-gb')) ??
        sameLanguage.find((voice) => normalized(voice.lang).startsWith('en-us')) ??
        sameLanguage[0]
      : sameLanguage[0])
  )
}

/**
 * Speaks `text` exactly once. Guarantees at most one utterance is ever queued:
 * any previously pending/playing speech is cancelled first, and stale callbacks
 * from superseded utterances are ignored via the speech token.
 *
 * Resolves when the utterance ends, errors, is superseded/cancelled, or fails
 * to start within `START_TIMEOUT_MS` (browser autoplay restrictions).
 */
export async function speakOnce(
  text: string,
  lang: 'en' | 'hi',
  options: SpeakOptions = {}
): Promise<SpeakOutcome> {
  const trimmed = (text || '').trim()
  if (!trimmed) return 'empty'
  if (!hasSpeechSynthesis()) {
    diag('speech', 'unsupported')
    return 'unsupported'
  }
  if (getEffectiveVolume() <= 0) {
    diag('speech', 'skipped-muted')
    return 'muted'
  }

  const token = ++speechToken
  const previousSettle = settleCurrent
  settleCurrent = null
  previousSettle?.('cancelled')

  const voices = await getVoices()
  if (token !== speechToken) return 'cancelled'

  const synth = window.speechSynthesis
  const utter = createUtterance(trimmed, lang)
  const voice = pickVoice(voices, lang)
  if (voice) utter.voice = voice
  diag('speech', 'queue', { lang, voice: voice ? voice.name : 'default', chars: trimmed.length })

  return new Promise<SpeakOutcome>((resolve) => {
    let settled = false
    let started = false
    let startTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (outcome: SpeakOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(startTimer)
      if (settleCurrent === finish) settleCurrent = null
      resolve(outcome)
    }
    settleCurrent = finish

    utter.onstart = () => {
      if (token !== speechToken) return
      started = true
      diag('speech', 'start', { lang })
      try {
        options.onStarted?.()
      } catch {
        // listener errors must not break speech
      }
    }
    utter.onend = () => {
      if (token !== speechToken) return
      diag('speech', 'end', { lang })
      finish('ended')
    }
    utter.onerror = (event) => {
      if (token !== speechToken) return
      const code = (event as SpeechSynthesisErrorEvent)?.error || 'unknown'
      diag('speech', 'error', { code: String(code) })
      finish('error')
    }

    startTimer = setTimeout(() => {
      if (!started && !settled) {
        diag('speech', 'not-started')
        finish('blocked')
      }
    }, START_TIMEOUT_MS)

    try {
      synth.cancel()
      synth.speak(utter)
    } catch {
      diag('speech', 'throw')
      finish('error')
    }
  })
}

/** Immediately stops any ongoing or queued speech and settles its promise. */
export function cancelSpeech(reason = 'cancel'): void {
  speechToken += 1
  const settle = settleCurrent
  settleCurrent = null
  settle?.('cancelled')
  if (hasSpeechSynthesis()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }
  diag('speech', 'cancel', { reason })
}

/** True while an utterance started by speakOnce is still pending. */
export function isSpeechActive(): boolean {
  return settleCurrent !== null
}

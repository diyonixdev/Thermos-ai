import { useCallback, useEffect, useRef, useState } from 'react'
import { translations } from '../i18n/translations'
import type { Language, TranslationKey } from '../i18n/translations'
import { diag } from '../lib/diagnostics'
import { cancelSpeech, isVoiceOutputEnabled, speakOnce } from './speechController'

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'paused' | 'error'

export interface VoiceAssistantApi {
  /** Current lifecycle state of the voice pipeline. */
  state: VoiceState
  /** Localized status/error message for the current state, or ''. */
  message: string
  isSupported: boolean
  /** True while voice mode (hands-free listening) is enabled by the user. */
  voiceActive: boolean
  /** Enables voice mode and starts listening. Requests the microphone on call. */
  startListening: (onResult: (text: string) => void) => boolean
  /** Stop Voice Mode: stops recognition, timers and any ongoing speech. */
  stopListening: () => void
  /** Pause Agent: stops recognition and speech, keeps the paused state visible. */
  pauseVoice: () => void
  /** A question was submitted: suspends the mic so it cannot hear the reply. */
  beginProcessing: () => void
  /** Request finished without speech: resumes listening or returns to idle. */
  endProcessing: () => void
  /** Speaks one final AI response, then returns to listening/idle. */
  speakResponse: (text: string) => Promise<void>
  /** Interrupt: cancels current speech instantly and returns to listening/idle. */
  interruptSpeech: () => void
}

interface RecognitionResultLike {
  isFinal: boolean
  0?: { transcript?: string }
}

interface RecognitionEventLike {
  resultIndex?: number
  results: ArrayLike<RecognitionResultLike>
}

interface RecognitionErrorLike {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: ((event: unknown) => void) | null
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: RecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const NO_SPEECH_TIMEOUT_MS = 15000
const MAX_CONSECUTIVE_FAILURES = 5
const DUPLICATE_WINDOW_MS = 2500

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return ((w.SpeechRecognition || w.webkitSpeechRecognition) as SpeechRecognitionCtor | undefined) ?? null
}

export function recognitionLang(language: Language): string {
  return language === 'hi' ? 'hi-IN' : 'en-IN'
}

export function useVoiceAssistant(language: Language, volumeLevel = 0.7): VoiceAssistantApi {
  const [isSupported] = useState<boolean>(() => getRecognitionCtor() !== null)
  const [state, setState] = useState<VoiceState>(() => (isSupported ? 'idle' : 'error'))
  const [messageKey, setMessageKey] = useState<TranslationKey | null>(() =>
    isSupported ? null : 'voice.unsupported'
  )
  const [voiceActive, setVoiceActive] = useState(false)

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const wantListeningRef = useRef(false)
  const suspendedRef = useRef(false)
  const runningRef = useRef(false)
  const startingRef = useRef(false)
  const flowSeqRef = useRef(0)
  const failureCountRef = useRef(0)
  const lastSubmitRef = useRef<{ text: string; time: number } | null>(null)
  const onResultRef = useRef<((text: string) => void) | null>(null)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const languageRef = useRef<Language>(language)
  const volumeRef = useRef(volumeLevel)
  const mountedRef = useRef(false)

  useEffect(() => {
    languageRef.current = language
  }, [language])
  useEffect(() => {
    volumeRef.current = volumeLevel
  }, [volumeLevel])

  const message = messageKey ? translations[language][messageKey] : ''

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const clearInactivity = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
  }, [])

  const stopRec = useCallback(() => {
    const rec = recRef.current
    if (!rec) return
    try {
      rec.stop()
    } catch {
      // recognition may already be inactive
    }
  }, [])

  const scheduleRestart = useCallback(
    function scheduleRestartFn(delayMs: number): void {
      clearRestart()
      if (!mountedRef.current || !wantListeningRef.current || suspendedRef.current) return
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null
        const rec = recRef.current
        if (!rec || !mountedRef.current || !wantListeningRef.current || suspendedRef.current) return
        if (runningRef.current || startingRef.current) return
        startingRef.current = true
        try {
          rec.start()
          diag('voice', 'restart')
        } catch {
          startingRef.current = false
          failureCountRef.current += 1
          diag('voice', 'restart-failed', { failures: failureCountRef.current })
          if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
            wantListeningRef.current = false
            setVoiceActive(false)
            setState('error')
            setMessageKey('voice.recognitionFailed')
          } else {
            scheduleRestartFn(1000)
          }
        }
      }, delayMs)
    },
    [clearRestart]
  )

  const armInactivity = useCallback(() => {
    clearInactivity()
    inactivityTimerRef.current = setTimeout(() => {
      inactivityTimerRef.current = null
      if (!mountedRef.current || !wantListeningRef.current || suspendedRef.current) return
      diag('voice', 'no-speech-timeout')
      setState('error')
      setMessageKey('voice.noSpeech')
    }, NO_SPEECH_TIMEOUT_MS)
  }, [clearInactivity])

  const submitTranscript = useCallback((text: string) => {
    if (!wantListeningRef.current || suspendedRef.current) return
    const nowMs = Date.now()
    const last = lastSubmitRef.current
    if (last && last.text === text && nowMs - last.time < DUPLICATE_WINDOW_MS) {
      diag('voice', 'duplicate-suppressed', { chars: text.length })
      return
    }
    lastSubmitRef.current = { text, time: nowMs }
    failureCountRef.current = 0
    diag('voice', 'final-result', { chars: text.length })
    onResultRef.current?.(text)
  }, [])

  // True unmount teardown is deferred by one tick so React Strict Mode's
  // development remount (cleanup immediately followed by setup) never cancels
  // speech or stops a session that is still alive.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      setTimeout(() => {
        if (mountedRef.current) return
        wantListeningRef.current = false
        suspendedRef.current = false
        onResultRef.current = null
        cancelSpeech('unmount')
        diag('voice', 'unmounted')
      }, 0)
    }
  }, [])

  // Recognition instance: one per language, handlers detached on cleanup so
  // stale callbacks from an old instance can never fire. An unsupported browser
  // already has state/messageKey initialised above, so nothing to set here.
  useEffect(() => {
    mountedRef.current = true
    if (!isSupported) return
    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.lang = recognitionLang(language)

    rec.onstart = () => {
      if (recRef.current !== rec || !mountedRef.current) return
      runningRef.current = true
      startingRef.current = false
      failureCountRef.current = 0
      diag('voice', 'start', { lang: rec.lang })
      if (wantListeningRef.current && !suspendedRef.current) {
        setState('listening')
        setMessageKey(null)
        armInactivity()
      } else {
        try {
          rec.stop()
        } catch {
          // ignore
        }
      }
    }

    rec.onresult = (event) => {
      if (recRef.current !== rec || !mountedRef.current) return
      let finalText = ''
      try {
        const from = typeof event.resultIndex === 'number' ? event.resultIndex : 0
        for (let i = from; i < event.results.length; i++) {
          const item = event.results[i]
          if (item && item.isFinal) finalText += item[0]?.transcript || ''
        }
      } catch {
        finalText = ''
      }
      const text = finalText.trim()
      if (!text) return
      clearInactivity()
      submitTranscript(text)
    }

    rec.onerror = (event) => {
      if (recRef.current !== rec || !mountedRef.current) return
      const code = event?.error || 'unknown'
      diag('voice', 'error', { code: String(code) })
      clearInactivity()
      if (code === 'aborted') return

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        wantListeningRef.current = false
        setVoiceActive(false)
        clearRestart()
        setState('error')
        setMessageKey('voice.permissionDenied')
        return
      }
      if (code === 'audio-capture') {
        wantListeningRef.current = false
        setVoiceActive(false)
        clearRestart()
        setState('error')
        setMessageKey('voice.noMic')
        return
      }
      if (!wantListeningRef.current || suspendedRef.current) return

      failureCountRef.current += 1
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        wantListeningRef.current = false
        setVoiceActive(false)
        clearRestart()
        setState('error')
        setMessageKey('voice.recognitionFailed')
        return
      }
      setState('error')
      if (code === 'no-speech') setMessageKey('voice.noSpeech')
      else if (code === 'network') setMessageKey('voice.network')
      else setMessageKey('voice.recognitionFailed')
      armInactivity()
    }

    rec.onend = () => {
      if (recRef.current !== rec) return
      runningRef.current = false
      startingRef.current = false
      clearInactivity()
      diag('voice', 'end', { want: wantListeningRef.current, suspended: suspendedRef.current })
      if (!mountedRef.current) return
      if (wantListeningRef.current && !suspendedRef.current) scheduleRestart(300)
    }

    recRef.current = rec
    if (wantListeningRef.current && !suspendedRef.current) {
      startingRef.current = true
      try {
        rec.start()
      } catch {
        startingRef.current = false
      }
    }

    return () => {
      rec.onstart = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      if (recRef.current === rec) recRef.current = null
      runningRef.current = false
      startingRef.current = false
      try {
        if (typeof rec.abort === 'function') rec.abort()
        else rec.stop()
      } catch {
        // ignore
      }
      clearRestart()
      clearInactivity()
    }
  }, [language, isSupported, armInactivity, clearInactivity, clearRestart, scheduleRestart, submitTranscript])

  const startListening = useCallback(
    (onResult: (text: string) => void): boolean => {
      onResultRef.current = onResult
      wantListeningRef.current = true
      suspendedRef.current = false
      lastSubmitRef.current = null
      failureCountRef.current = 0
      setVoiceActive(true)
      clearRestart()
      const rec = recRef.current
      if (!isSupported || !rec) {
        setState('error')
        setMessageKey('voice.unsupported')
        return false
      }
      setState('listening')
      setMessageKey(null)
      if (runningRef.current || startingRef.current) return true
      startingRef.current = true
      try {
        rec.start()
        diag('voice', 'start-requested', { lang: rec.lang })
        return true
      } catch {
        startingRef.current = false
        setState('error')
        setMessageKey('voice.startFailed')
        return false
      }
    },
    [clearRestart, isSupported]
  )

  const hardStop = useCallback(
    (nextState: VoiceState) => {
      wantListeningRef.current = false
      suspendedRef.current = false
      onResultRef.current = null
      failureCountRef.current = 0
      flowSeqRef.current += 1
      clearRestart()
      clearInactivity()
      cancelSpeech('stop')
      stopRec()
      setVoiceActive(false)
      setState(nextState)
      setMessageKey(null)
      diag('voice', 'stop', { next: nextState })
    },
    [clearRestart, clearInactivity, stopRec]
  )

  const stopListening = useCallback(() => hardStop('idle'), [hardStop])
  const pauseVoice = useCallback(() => hardStop('paused'), [hardStop])

  const beginProcessing = useCallback(() => {
    flowSeqRef.current += 1
    suspendedRef.current = true
    clearRestart()
    clearInactivity()
    stopRec()
    setState('processing')
    setMessageKey(null)
    diag('voice', 'processing')
  }, [clearRestart, clearInactivity, stopRec])

  const endProcessing = useCallback(() => {
    flowSeqRef.current += 1
    suspendedRef.current = false
    setMessageKey(null)
    if (wantListeningRef.current) {
      setState('listening')
      scheduleRestart(300)
    } else {
      setState('idle')
    }
    diag('voice', 'processing-done')
  }, [scheduleRestart])

  const speakResponse = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = (text || '').trim()
      const enabled = volumeRef.current > 0 && isVoiceOutputEnabled()
      if (!trimmed || !enabled) {
        diag('speech', 'skipped', { reason: trimmed ? 'muted' : 'empty' })
        endProcessing()
        return
      }
      flowSeqRef.current += 1
      const mySeq = flowSeqRef.current
      suspendedRef.current = true
      clearRestart()
      clearInactivity()
      stopRec()
      setState('speaking')
      setMessageKey(null)

      const outcome = await speakOnce(trimmed, languageRef.current === 'hi' ? 'hi' : 'en')
      if (!mountedRef.current || mySeq !== flowSeqRef.current) {
        diag('speech', 'stale-outcome', { outcome })
        return
      }
      diag('speech', 'outcome', { outcome })
      suspendedRef.current = false
      if (outcome === 'error') setMessageKey('voice.ttsFailed')
      else setMessageKey(null)
      if (wantListeningRef.current) {
        setState('listening')
        scheduleRestart(300)
      } else {
        setState('idle')
      }
    },
    [clearRestart, clearInactivity, endProcessing, scheduleRestart, stopRec]
  )

  const interruptSpeech = useCallback(() => {
    flowSeqRef.current += 1
    suspendedRef.current = false
    cancelSpeech('interrupt')
    clearRestart()
    clearInactivity()
    setMessageKey(null)
    if (wantListeningRef.current) {
      setState('listening')
      scheduleRestart(300)
    } else {
      setState('idle')
    }
    diag('voice', 'interrupted')
  }, [clearRestart, clearInactivity, scheduleRestart])

  return {
    state,
    message,
    isSupported,
    voiceActive,
    startListening,
    stopListening,
    pauseVoice,
    beginProcessing,
    endProcessing,
    speakResponse,
    interruptSpeech,
  }
}

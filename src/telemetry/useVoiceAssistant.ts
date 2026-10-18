import { useCallback, useEffect, useRef, useState } from 'react'
import { createUtterance } from './speechController'

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error'

export function useVoiceAssistant(language: 'en' | 'hi', volumeLevel = 0.7) {
  const [state, setState] = useState<VoiceState>('idle')
  const [message, setMessage] = useState('')
  const [continuous, setContinuous] = useState(false)
  const continuousRef = useRef(false)
  const stateRef = useRef<VoiceState>('idle')
  // sync refs
  useEffect(() => { continuousRef.current = continuous }, [continuous])
  useEffect(() => { stateRef.current = state }, [state])
  const recRef = useRef<any>(null)
  const resultCallbackRef = useRef<((text: string) => void) | null>(null)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSupported = typeof window !== 'undefined' && !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isSupported) {
      setMessage(language === 'hi' ? 'इस ब्राउज़र में आवाज़ इनपुट समर्थित नहीं है। कृपya टेक्स्ट दर्ज करें।' : 'Voice input not supported. Please type your question.')
      setState('error')
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.continuous = true  // allow continuous recognition
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.lang = language === 'hi' ? 'hi-IN' : 'en-IN'

    rec.onstart = () => {
      setState('listening')
      setMessage(language === 'hi' ? 'सुन रहा हूँ...' : 'Listening...')
    }
    rec.onend = () => {
      // If continuous mode active and not deliberately stopped, restart after brief pause
      if (continuousRef.current && stateRef.current !== 'speaking' && stateRef.current !== 'processing' && stateRef.current !== 'error') {
        clearRestart()
        restartTimerRef.current = setTimeout(() => {
          if (continuousRef.current && recRef.current) {
            try { recRef.current.start() } catch (e) { /* ignore if already running */ }
          }
        }, 600)
      } else if (!continuousRef.current) {
        setState('idle')
        setMessage('')
      }
    }
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setMessage(language === 'hi' ? 'माइक्रोफोन अनुमति अस्वीकृत। कृपya सेटिंग्स से अनुमति दें।' : 'Microphone access denied. Enable permission in settings.')
      } else if (e.error === 'no-speech') {
        // no-speech is recoverable in continuous mode
        if (continuousRef.current) {
          clearRestart()
          restartTimerRef.current = setTimeout(() => {
            if (continuousRef.current && recRef.current) {
              try { recRef.current.start() } catch (e) {}
            }
          }, 800)
          return
        }
        setMessage(language === 'hi' ? 'कोई आवाज़ नहीं मिली। कृपya फिर से प्रयास करें।' : 'No speech detected. Please try again.')
      } else {
        setMessage(language === 'hi' ? 'वOICE त्रुटि। कृपya फिर से प्रयास करें।' : 'Voice error. Please try again.')
      }
      setState('error')
      if (!continuousRef.current) {
        setTimeout(() => { setState('idle'); setMessage('') }, 2500)
      }
    }
    rec.onresult = (event: any) => {
      const text = event.results[0][0].transcript
      if (text && text.trim()) {
        setState('processing')
        setMessage(language === 'hi' ? 'प्रक्रमण...' : 'Processing...')
        if (resultCallbackRef.current) resultCallbackRef.current(text)
      }
    }
    recRef.current = rec
  }, [language, isSupported])

  useEffect(() => {
    if (recRef.current) recRef.current.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  }, [language])

  const startListening = useCallback((onResult: (text: string) => void) => {
    resultCallbackRef.current = onResult
    setContinuous(true)
    clearRestart()
    if (!recRef.current) return false
    try {
      recRef.current.start()
      return true
    } catch (e) {
      setState('error')
      setMessage(language === 'hi' ? 'वOICE आरंभ विफल।' : 'Failed to start voice.')
      return false
    }
  }, [language, clearRestart])

  const stopListening = useCallback(() => {
    setContinuous(false)
    clearRestart()
    try {
      if (recRef.current) recRef.current.stop()
    } catch (e) { /* ignore */ }
    setState('idle')
    setMessage('')
  }, [clearRestart])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utter = createUtterance(text, language === 'hi' ? 'hi' : 'en')
    utter.onstart = () => setState('speaking')
    utter.onend = () => {
      setState('idle')
      // After speaking, resume listening if continuous
      if (continuousRef.current) {
        clearRestart()
        restartTimerRef.current = setTimeout(() => {
          if (continuousRef.current && recRef.current) {
            try { recRef.current.start() } catch (e) {}
          }
        }, 300)
      }
    }
    utter.onerror = () => {
      setState('idle')
      if (continuousRef.current) {
        clearRestart()
        restartTimerRef.current = setTimeout(() => {
          if (continuousRef.current && recRef.current) {
            try { recRef.current.start() } catch (e) {}
          }
        }, 300)
      }
    }
    const voices = window.speechSynthesis.getVoices()
    const preferred = voices.find((v: any) => v.lang === (language === 'hi' ? 'hi-IN' : 'en-IN'))
    if (preferred) utter.voice = preferred
    window.speechSynthesis.speak(utter)
  }, [language, continuous, clearRestart, volumeLevel])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    setState('idle')
    setMessage('')
  }, [])

  useEffect(() => {
    return () => {
      clearRestart()
      try { if (recRef.current) recRef.current.stop() } catch (e) {}
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    }
  }, [clearRestart])

  return { state, message, isSupported, continuous, startListening, stopListening, speak, stopSpeaking }
}

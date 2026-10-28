import { useCallback, useEffect, useRef, useState } from 'react'
import { translations } from '../i18n/translations'
import type { Language } from '../i18n/translations'
import { ChatError, friendlyChatError, sendChatWithRetry } from '../lib/chatApi'
import type { ChatTurn } from '../lib/chatApi'
import { diag, newRequestId } from '../lib/diagnostics'
import { useTelemetry } from './useTelemetry'
import type { VoiceAssistantApi } from './useVoiceAssistant'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  text: string
  time: string
}

interface UseAssistantChatOptions {
  language: Language
  voice: VoiceAssistantApi
  /** Opening greeting shown as the first assistant message. */
  greeting: string
}

const HISTORY_LIMIT = 12
const DUPLICATE_WINDOW_MS = 2500

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Shared question/answer pipeline for the main dashboard assistant and Driver
 * Mode: one request at a time, latest telemetry, request-id correlation,
 * stale-response protection, always-cleared loading state and a retryable
 * error notice (never a fabricated local answer).
 */
export function useAssistantChat({ language, voice, greeting }: UseAssistantChatOptions) {
  const { telemetry } = useTelemetry()

  const [messages, setMessages] = useState<AssistantMessage[]>(() => [
    { role: 'assistant', text: greeting, time: nowTime() },
  ])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [retryText, setRetryText] = useState<string | null>(null)
  const [agentPaused, setAgentPaused] = useState(false)

  const messagesRef = useRef(messages)
  const telemetryRef = useRef(telemetry)
  const languageRef = useRef(language)
  const voiceRef = useRef(voice)
  const pausedRef = useRef(false)
  const retryTextRef = useRef<string | null>(null)
  const voiceWasActiveRef = useRef(false)
  const requestSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const lastSubmitRef = useRef<{ text: string; time: number } | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    telemetryRef.current = telemetry
  }, [telemetry])
  useEffect(() => {
    languageRef.current = language
  }, [language])
  useEffect(() => {
    voiceRef.current = voice
  }, [voice])
  useEffect(() => {
    retryTextRef.current = retryText
  }, [retryText])

  // The greeting text follows the selected language while the conversation is
  // still only the greeting. Adjusted during render (React's "state derived
  // from props" pattern) so no effect has to setState.
  const [syncedGreeting, setSyncedGreeting] = useState(greeting)
  if (syncedGreeting !== greeting) {
    setSyncedGreeting(greeting)
    setMessages((prev) =>
      prev.length === 1 && prev[0].role === 'assistant'
        ? [{ ...prev[0], text: greeting }]
        : prev
    )
  }

  const ask = useCallback(
    (rawText: string, options?: { force?: boolean }): void => {
      const text = rawText.trim()
      if (!text) return
      const lang = languageRef.current

      if (pausedRef.current) {
        setNotice(translations[lang]['assistant.agentPaused'])
        return
      }

      if (!options?.force) {
        const nowMs = Date.now()
        const last = lastSubmitRef.current
        if (last && last.text === text && nowMs - last.time < DUPLICATE_WINDOW_MS) {
          diag('assistant', 'duplicate-question-suppressed', { chars: text.length })
          return
        }
      }
      lastSubmitRef.current = { text, time: Date.now() }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const seq = ++requestSeqRef.current
      const requestId = newRequestId()

      const timeStr = nowTime()
      const userEntry: AssistantMessage = { role: 'user', text, time: timeStr }
      const history: ChatTurn[] = [...messagesRef.current, userEntry]
        .slice(-HISTORY_LIMIT)
        .map((msg) => ({ role: msg.role, content: msg.text }))
      messagesRef.current = [...messagesRef.current, userEntry]
      setMessages((prev) => [...prev, userEntry])
      setNotice(null)
      setRetryText(null)
      setLoading(true)
      voiceRef.current.beginProcessing()

      const startedAt = Date.now()
      diag('assistant', 'ask', { requestId, turns: history.length, lang })

      sendChatWithRetry({
        messages: history,
        language: lang,
        telemetry: telemetryRef.current,
        signal: controller.signal,
        requestId,
      })
        .then((reply) => {
          if (seq !== requestSeqRef.current || controller.signal.aborted) {
            diag('assistant', 'stale-reply-dropped', { requestId })
            return
          }
          setMessages((prev) => [...prev, { role: 'assistant', text: reply, time: timeStr }])
          diag('assistant', 'reply', { requestId, ms: Date.now() - startedAt, chars: reply.length })
          void voiceRef.current.speakResponse(reply)
        })
        .catch((error) => {
          if (seq !== requestSeqRef.current || controller.signal.aborted) {
            diag('assistant', 'stale-error-dropped', { requestId })
            return
          }
          const code = error instanceof ChatError ? error.code : 'unknown'
          diag('assistant', 'ask-failed', { requestId, ms: Date.now() - startedAt, code })
          voiceRef.current.endProcessing()
          setNotice(friendlyChatError(error, languageRef.current))
          setRetryText(text)
        })
        .finally(() => {
          diag('assistant', 'ask-done', { requestId, ms: Date.now() - startedAt })
          if (seq === requestSeqRef.current) setLoading(false)
        })
    },
    []
  )

  const retry = useCallback(() => {
    const text = retryTextRef.current
    if (!text) return
    setRetryText(null)
    setNotice(null)
    ask(text, { force: true })
  }, [ask])

  const interrupt = useCallback(() => {
    requestSeqRef.current += 1
    abortRef.current?.abort()
    setLoading(false)
    voiceRef.current.interruptSpeech()
    setNotice(translations[languageRef.current]['assistant.interrupted'])
    diag('assistant', 'interrupted')
  }, [])

  const togglePause = useCallback(() => {
    const next = !pausedRef.current
    pausedRef.current = next
    setAgentPaused(next)
    if (next) {
      requestSeqRef.current += 1
      abortRef.current?.abort()
      setLoading(false)
      voiceWasActiveRef.current = voiceRef.current.voiceActive
      voiceRef.current.pauseVoice()
      setNotice(translations[languageRef.current]['assistant.agentPaused'])
      diag('assistant', 'paused')
    } else {
      setNotice(null)
      diag('assistant', 'resumed')
      if (voiceWasActiveRef.current) voiceRef.current.startListening(ask)
    }
  }, [ask])

  const clearChat = useCallback(() => {
    messagesRef.current = []
    setMessages([])
    setNotice(null)
    setRetryText(null)
  }, [])

  return {
    messages,
    loading,
    notice,
    retryText,
    agentPaused,
    ask,
    retry,
    interrupt,
    togglePause,
    clearChat,
  }
}

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { TelemetryData, TelemetrySample } from './types'
import { INITIAL_TELEMETRY, updateMockTelemetry, generateHistory } from './mockTelemetry'

const UPDATE_INTERVAL = 1500 // ms

interface TelemetryContextValue {
  telemetry: TelemetryData
  history: TelemetrySample[]
  isPaused: boolean
  togglePause: () => void
  reset: () => void
  setProfile: (profile: 'city' | 'highway' | 'idle') => void
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null)

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const [telemetry, setTelemetry] = useState<TelemetryData>(INITIAL_TELEMETRY)
  const [history, setHistory] = useState<TelemetrySample[]>(() =>
    generateHistory(100).map((d) => ({
      ...d,
      timeLabel: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }))
  )
  const [isPaused, setIsPaused] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pushToHistory = (sample: TelemetryData) => {
    const timeLabel = new Date(sample.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setHistory((prev) => {
      const next = [...prev, { ...sample, timeLabel }]
      return next.slice(-120)
    })
  }

  useEffect(() => {
    if (!isPaused) {
      intervalRef.current = setInterval(() => {
        setTelemetry((prev) => {
          const next = updateMockTelemetry(prev)
          pushToHistory(next)
          return next
        })
      }, UPDATE_INTERVAL)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPaused])

  const togglePause = () => setIsPaused((p) => !p)

  const reset = () => {
    setTelemetry(INITIAL_TELEMETRY)
    setHistory(
      generateHistory(100).map((d) => ({
        ...d,
        timeLabel: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }))
    )
    setIsPaused(false)
  }

  const setProfile = (_profile: 'city' | 'highway' | 'idle') => {
    // Future: adjust mock parameters per profile
  }

  const value = useMemo<TelemetryContextValue>(
    () => ({
      telemetry,
      history,
      isPaused,
      togglePause,
      reset,
      setProfile,
    }),
    [telemetry, history, isPaused]
  )

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider')
  return ctx
}
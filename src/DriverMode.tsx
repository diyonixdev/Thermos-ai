import { useState, useRef, useEffect, useCallback } from 'react'
import { Leaf, Mic, Send, Battery, Cog, Thermometer, Activity, Clock3, Zap, Truck, Pause, Play } from 'lucide-react'
import { useLanguage } from './i18n/LanguageContext'
import { useTelemetry } from './telemetry/useTelemetry'
import { sendChatWithRetry } from './lib/chatApi'
import { classifyQuestion, answerQuestion } from './telemetry/questionResolver'
import { useVoiceAssistant } from './telemetry/useVoiceAssistant'
import { createUtterance } from './telemetry/speechController'

export function DriverModePanel({ onClose, volume = 70 }: { onClose: () => void; volume?: number }) {
  const { t, language } = useLanguage()
  const { telemetry } = useTelemetry()
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string; time: string }[]>([
    { role: 'assistant', text: language === 'hi' ? 'नमस्ते! मैं Thermos AI हूँ, आपका स्मार्ट ऊर्जा सहायक।' : "Hello! I'm Thermos AI, your intelligent energy assistant.", time: '06:30 PM' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(true)
  const [spokenGreeting, setSpokenGreeting] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const [agentPaused, setAgentPaused] = useState(false)
  const messagesRef = useRef(messages)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const { isSupported, continuous, startListening, stopListening, speak, stopSpeaking } = useVoiceAssistant(language, volume ? volume / 100 : 0.7)

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Speak greeting once when permitted (shared speech controller, no duplicate)
  useEffect(() => {
    if (!spokenGreeting && isSupported && !agentPaused && !interrupted) {
      setSpokenGreeting(true)
      const greetingText = messages[0]?.text || (language === 'hi' ? 'नमस्ते!' : 'Hello!')
      const utter = createUtterance(greetingText, language === 'hi' ? 'hi' : 'en')
      utter.onstart = () => console.log('[ThermosAI] Driver greeting started')
      utter.onerror = () => console.log('[ThermosAI] Driver greeting error')
      utter.onend = () => console.log('[ThermosAI] Driver greeting ended')
      try { window.speechSynthesis.speak(utter) } catch(e){}
    }
  }, [language, isSupported, agentPaused, interrupted, spokenGreeting, messages])

  const processQuestion = useCallback((text: string) => {
    if (agentPaused) {
      setLoading(false)
      return
    }
    if (interrupted) setInterrupted(false)
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()
    const controller = abortControllerRef.current
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userEntry = { role: 'user' as const, text, time: timeStr }
    const history = [...messagesRef.current, userEntry].slice(-12).map((m) => ({ role: m.role, content: m.text }))
    messagesRef.current = [...messagesRef.current, userEntry]
    setMessages((prev) => [...prev, userEntry])
    setLoading(true)
    sendChatWithRetry({ messages: history, language, telemetry, signal: controller.signal })
      .then((reply) => {
        if (interrupted || controller.signal.aborted) return
        setMessages((prev) => [...prev, { role: 'assistant', text: reply, time: timeStr }])
        if (isSupported && !agentPaused) speak(reply)
      })
      .catch((_err) => {
        if (interrupted || controller.signal.aborted) return
        const fallback = answerQuestion(classifyQuestion(text), telemetry, language)
        setMessages((prev) => [...prev, { role: 'assistant', text: fallback + ' (local answer — AI unavailable)', time: timeStr }])
        if (isSupported && !agentPaused) speak(fallback + ' (local answer — AI unavailable)')
      })
      .finally(() => setLoading(false))
  }, [language, telemetry, isSupported, speak, interrupted, agentPaused])

  const examplesHi = `उदाहरण: "बैटरी कितना चार्ज है?" | "RPM कितना है?" | "तापमान ज्यादा है?"`
  const examplesEn = `Examples: "How much battery left?" | "Engine RPM?" | "Is temperature high?"`

  const statusText = loading ? (language === 'hi' ? 'सोच रहा हूँ...' : 'Thinking...') : (language === 'hi' ? 'तैयार' : 'Ready')

  return (
    <div className="driver-overlay" role="dialog" aria-modal="true" aria-label={language === 'hi' ? 'डriver मोड' : 'Driver Mode'}>
      <div className="driver-panel">
        <div className="driver-header">
          <div className="heading-title">
            <Truck size={28} />
            <div>
              <h2>Thermos AI — Driver Assistant</h2>
              <span>{language === 'hi' ? 'डriver सहायिका' : 'Driver Assistant'}</span>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label={language === 'hi' ? 'बंद करें' : 'Close'}>
            ✕
          </button>
        </div>

        <div className="driver-help">
          <button type="button" className="help-toggle" onClick={() => setShowHelp(s => !s)}>
            {language === 'hi' ? 'इस्तेमाल कैसे करें' : 'How to Use'}
          </button>
          {showHelp && (
            <div className="help-body">
              <p><strong>{language === 'hi' ? ' निर्देश:' : 'Instructions:'}</strong></p>
              <ol>
                <li>{language === 'hi' ? 'माइक्रोफोन दबाएँ या प्रश्न टाइप करें।' : 'Tap microphone or type a question.'}</li>
                <li>{language === 'hi' ? 'बैटरी, RPM, तापमान, दबाव, या ऊर्जा के बारे में पूछें।' : 'Ask about battery, RPM, temperature, pressure, or energy.'}</li>
                <li>{language === 'hi' ? 'Thermos AI का इंतज़ार करें।' : 'Wait while Thermos AI prepares the answer.'}</li>
                <li>{language === 'hi' ? 'उत्तर पढ़ें या सुनें।' : 'Read or listen to the answer.'}</li>
                <li>{language === 'hi' ? 'रोकें (Interrupt) से वर्तमान उत्तर रोकें।' : 'Use Interrupt to stop the current answer.'}</li>
                <li>{language === 'hi' ? 'Pause Agent से अस्थायी रूप से रोकें।' : 'Use Pause Agent to temporarily pause.'}</li>
                <li>{language === 'hi' ? 'Stop Voice Mode से Listening रोकें।' : 'Use Stop Voice Mode when done.'}</li>
                <li>{language === 'hi' ? 'भाषा बदलने के लिए शीर्षक का उपयोग करें।' : 'Use the language selector in the header.'}</li>
              </ol>
              <p><strong>{language === 'hi' ? 'उदाहरण:' : 'Examples:'}</strong> {language === 'hi' ? examplesHi : examplesEn}</p>
              <p style={{fontSize:12,color:'var(--muted)'}}>{language === 'hi' ? 'सभी पढ़ने सिम्युलेटेड हैं। वाहन हार्डवेयर नियंत्रित नहीं किया जाता।' : 'All readings are simulated. No vehicle hardware is controlled.'}</p>
            </div>
          )}
        </div>

        <div className="driver-telemetry-row">
          {[
            { icon: <Battery size={28} />, label: language === 'hi' ? 'बैटरी चार्ज' : 'Battery Charge', value: `${Math.round(telemetry.batteryCharge)}%`, tone: 'green' },
            { icon: <Cog size={28} />, label: language === 'hi' ? 'RPM' : 'RPM', value: String(Math.round(telemetry.rpm)), tone: 'green' },
            { icon: <Thermometer size={28} />, label: language === 'hi' ? 'एग्जॉस्ट तापमान' : 'Exhaust Temp', value: `${Math.round(telemetry.temperatureCelsius)}°C`, tone: 'amber' },
            { icon: <Activity size={28} />, label: language === 'hi' ? 'दबाव' : 'Pressure', value: `${telemetry.pressureBar} bar`, tone: 'cyan' },
            { icon: <Zap size={28} />, label: language === 'hi' ? 'पुनर्प्राप्त शक्ति' : 'Recovered Power', value: `${telemetry.recoveredPowerWatts} W`, tone: 'amber' },
            { icon: <Clock3 size={28} />, label: language === 'hi' ? 'चार्ज समय' : 'Charging ETA', value: `${telemetry.chargingEtaMinutes} min`, tone: 'cyan' },
          ].map((card, idx) => (
            <div key={idx} className={`metric-card ${card.tone}`} style={{ minWidth: 0 }}>
              <div className="metric-icon">{card.icon}</div>
              <div>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            </div>
          ))}
        </div>

        <div className="driver-chat-window">
          {messages.map((msg, i: number) => (
            <div key={i} className={`message ${msg.role}`}>
              {msg.role === 'assistant' && <div className="assistant-avatar"><Leaf size={26} /></div>}
              <div className={msg.role === 'assistant' ? 'message-bubble' : undefined}>
                <p>{msg.text}</p>
                <time>{msg.time}</time>
              </div>
            </div>
          ))}
          {loading && (
            <div className="message assistant">
              <div className="assistant-avatar"><Leaf size={26} /></div>
              <div className="message-bubble"><p style={{color:'var(--muted)'}}>{statusText}</p></div>
            </div>
          )}
        </div>

        <div className="driver-controls">
          <button type="button" className="icon-button large" aria-label={language === 'hi' ? 'बोलने के लिए टैप करें' : 'Tap to speak'} onClick={() => {
            if (continuous) { stopListening(); }
            else if (isSupported) { startListening((txt) => processQuestion(txt)); }
          }}>
            <Mic size={40} />
          </button>
          <button type="button" className="icon-button" aria-label={language === 'hi' ? 'रोकें' : 'Interrupt'} onClick={() => { setInterrupted(true); stopSpeaking(); if (abortControllerRef.current) abortControllerRef.current.abort(); }}>
            <Pause size={20} />
          </button>
          <button type="button" className="icon-button" aria-label={agentPaused ? (language === 'hi' ? 'जारी रखें' : 'Resume') : (language === 'hi' ? 'रोकें' : 'Pause')} onClick={() => { if (agentPaused) { setAgentPaused(false); if (continuous) startListening((txt) => processQuestion(txt)); } else { setAgentPaused(true); stopListening(); stopSpeaking(); if (abortControllerRef.current) abortControllerRef.current.abort(); } }}>
            {agentPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <div className="chat-input driver-input">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && processQuestion(input.trim())} placeholder={language === 'hi' ? 'प्रश्न लिखें...' : 'Type your question...'} />
            <button type="button" aria-label={t('assistant.send')} onClick={() => { if (input.trim()) processQuestion(input.trim()); setInput('') }}><Send size={24} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

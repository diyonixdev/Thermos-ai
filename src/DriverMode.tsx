import { useEffect, useRef, useState } from 'react'
import { Leaf, Mic, Send, Battery, Cog, Thermometer, Activity, Clock3, Zap, Truck, Pause, Play } from 'lucide-react'
import { useLanguage } from './i18n/LanguageContext'
import { useTelemetry } from './telemetry/useTelemetry'
import { useVoiceAssistant } from './telemetry/useVoiceAssistant'
import { useAssistantChat } from './telemetry/useAssistantChat'
import { isVoiceOutputEnabled, speakOnce } from './telemetry/speechController'
import { diag } from './lib/diagnostics'

const GREETING_EN = "Hello! I'm Turbo AI, your intelligent energy assistant."
const GREETING_HI = 'नमस्ते! मैं टर्बो AI हूँ, आपका स्मार्ट ऊर्जा सहायक।'

export function DriverModePanel({ onClose, volume = 70 }: { onClose: () => void; volume?: number }) {
  const { t, language } = useLanguage()
  const { telemetry } = useTelemetry()
  const [input, setInput] = useState('')
  const [showHelp, setShowHelp] = useState(true)

  const greeting = language === 'hi' ? GREETING_HI : GREETING_EN
  const voice = useVoiceAssistant(language, volume ? volume / 100 : 0.7)
  const { messages, loading, notice, retryText, agentPaused, ask, retry, interrupt, togglePause } =
    useAssistantChat({ language, voice, greeting })

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const spokenGreetingLanguages = useRef<Set<string>>(new Set())

  const greetingBusy = loading || voice.state === 'processing' || voice.state === 'speaking'

  // One greeting per selected language, never during an answer, never twice
  // (the language Set plus the single-attempt speak call guard Strict Mode
  // double-effects and rerenders).
  useEffect(() => {
    if (spokenGreetingLanguages.current.has(language)) return
    if (greetingBusy) return
    if (!isVoiceOutputEnabled()) {
      spokenGreetingLanguages.current.add(language)
      diag('greeting', 'driver-skipped-muted', { lang: language })
      return
    }
    spokenGreetingLanguages.current.add(language)
    diag('greeting', 'driver-play', { lang: language })
    void speakOnce(greeting, language === 'hi' ? 'hi' : 'en').then((outcome) => {
      diag('greeting', 'driver-outcome', { outcome })
    })
  }, [language, greeting, greetingBusy])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submitInput = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    ask(text)
  }

  const examplesHi = `उदाहरण: "बैटरी कितना चार्ज है?" | "RPM कितना है?" | "तापमान ज्यादा है?"`
  const examplesEn = `Examples: "How much battery left?" | "Engine RPM?" | "Is temperature high?"`

  const statusText = loading
    ? language === 'hi'
      ? 'सोच रहा हूँ...'
      : 'Thinking...'
    : voice.state === 'processing'
      ? language === 'hi'
        ? 'प्रोसेसिंग...'
        : 'Processing...'
      : voice.state === 'speaking'
        ? language === 'hi'
          ? 'बोल रहा हूँ...'
          : 'Speaking...'
        : voice.message
          ? voice.message
          : language === 'hi'
            ? 'तैयार'
            : 'Ready'

  return (
    <div className="driver-overlay" role="dialog" aria-modal="true" aria-label={language === 'hi' ? 'डriver मोड' : 'Driver Mode'}>
      <div className="driver-panel">
        <div className="driver-header">
          <div className="heading-title">
            <Truck size={28} />
            <div>
              <h2>Turbo AI — Driver Assistant</h2>
              <span>{language === 'hi' ? 'डriver सहायिका' : 'Driver Assistant'}</span>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label={language === 'hi' ? 'बंद करें' : 'Close'}>
            ✕
          </button>
        </div>

        <div className="driver-help">
          <button type="button" className="help-toggle" onClick={() => setShowHelp((s) => !s)}>
            {language === 'hi' ? 'इस्तेमाल कैसे करें' : 'How to Use'}
          </button>
          {showHelp && (
            <div className="help-body">
              <p><strong>{language === 'hi' ? ' निर्देश:' : 'Instructions:'}</strong></p>
              <ol>
                <li>{language === 'hi' ? 'माइक्रोफोन दबाएँ या प्रश्न टाइप करें।' : 'Tap microphone or type a question.'}</li>
                <li>{language === 'hi' ? 'बैटरी, RPM, तापमान, दबाव, या ऊर्जा के बारे में पूछें।' : 'Ask about battery, RPM, temperature, pressure, or energy.'}</li>
                <li>{language === 'hi' ? 'टर्बो AI का इंतज़ार करें।' : 'Wait while Turbo AI prepares the answer.'}</li>
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

        {notice && (
          <div className="chat-notice" role="alert">
            <span>{notice}</span>
            {retryText && (
              <button
                type="button"
                className="icon-button"
                style={{ marginLeft: 10, fontSize: 11 }}
                onClick={retry}
                aria-label={language === 'hi' ? 'पुनः प्रयास' : 'Retry'}
              >
                {language === 'hi' ? 'पुनः प्रयास' : 'Retry'}
              </button>
            )}
          </div>
        )}

        <div className="driver-controls">
          <button
            type="button"
            className="icon-button large"
            aria-label={voice.voiceActive ? (language === 'hi' ? 'आवाज़ रोकें' : 'Stop voice') : language === 'hi' ? 'बोलने के लिए टैप करें' : 'Tap to speak'}
            onClick={() => {
              if (voice.voiceActive) voice.stopListening()
              else if (voice.state === 'speaking') voice.interruptSpeech()
              else if (voice.isSupported) voice.startListening(ask)
            }}
          >
            <Mic size={40} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={language === 'hi' ? 'रोकें' : 'Interrupt'}
            title={language === 'hi' ? 'रोकें' : 'Interrupt'}
            onClick={interrupt}
          >
            <Pause size={20} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={agentPaused ? (language === 'hi' ? 'जारी रखें' : 'Resume') : (language === 'hi' ? 'रोकें' : 'Pause')}
            title={agentPaused ? (language === 'hi' ? 'जारी रखें' : 'Resume') : (language === 'hi' ? 'रोकें' : 'Pause')}
            onClick={togglePause}
          >
            {agentPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <div className="chat-input driver-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitInput()}
              placeholder={language === 'hi' ? 'प्रश्न लिखें...' : 'Type your question...'}
            />
            <button type="button" aria-label={t('assistant.send')} onClick={submitInput}>
              <Send size={24} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

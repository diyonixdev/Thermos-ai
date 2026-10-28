import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Battery,
  BatteryCharging,
  Bot,
  Car,
  Clock3,
  Cog,
  Leaf,
  Mic,
  Moon,
  Pause,
  Play,
  Send,
  Sun,
  Thermometer,
  Trash2,
  Truck,
  Volume2,
  VolumeX,
  Volume,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { LanguageProvider, useLanguage } from './i18n/LanguageContext'
import { formatHeaderDate, formatHeaderTime } from './i18n/translations'
import type { Language, TranslationKey } from './i18n/translations'
import { TelemetryProvider, useTelemetry } from './telemetry/useTelemetry'

import { useVoiceAssistant } from './telemetry/useVoiceAssistant'
import { useAssistantChat } from './telemetry/useAssistantChat'
import { cancelSpeech, isVoiceOutputEnabled, speakOnce } from './telemetry/speechController'
import { diag } from './lib/diagnostics'
import { DriverModePanel } from './DriverMode'

type Theme = 'dark' | 'light'

const sparkPath = 'M2 30 L14 25 L24 27 L36 18 L48 22 L60 11 L72 24 L84 18 L96 22 L108 16 L120 19 L132 12 L146 18'

const gaugeTicks = Array.from({ length: 17 }, (_, index) => index)

const chartTabs = ['rpm', 'temperature', 'pressure', 'recoveredPower'] as const
type ChartTab = (typeof chartTabs)[number]

const chartTabLabels: Record<ChartTab, TranslationKey> = {
  rpm: 'chart.rpm',
  temperature: 'chart.temperature',
  pressure: 'chart.pressure',
  recoveredPower: 'chart.recoveredPower',
}

const assistantChips = ['batteryEta', 'rpm', 'temperature', 'pressure', 'allSystems'] as const
type AssistantChip = (typeof assistantChips)[number]

const assistantChipLabels: Record<AssistantChip, TranslationKey> = {
  batteryEta: 'assistant.batteryEta',
  rpm: 'chart.rpm',
  temperature: 'chart.temperature',
  pressure: 'chart.pressure',
  allSystems: 'assistant.allSystems',
}

const GREETING_EN =
  "Hello! I'm Turbo AI, your intelligent energy assistant. How can I help you today? You can ask me about battery charging time, engine RPM, exhaust temperature, or pressure."
const GREETING_HI =
  'नमस्ते! मैं टर्बो AI हूँ, आपका स्मार्ट ऊर्जा सहायक। मैं आपकी क्या मदद कर सकता हूँ? आप मुझसे बैटरी चार्ज होने के समय, इंजन RPM, एग्जॉस्ट तापमान या दबाव के बारे में पूछ सकते हैं।'

/* ================= Main App ================= */

function App() {
  return (
    <LanguageProvider>
      <TelemetryProvider>
        <Dashboard />
      </TelemetryProvider>
    </LanguageProvider>
  )
}

function Dashboard() {
  const { language } = useLanguage()
  const [theme, setTheme] = useState<Theme>(() => {
    return localStorage.getItem('thermos-theme') === 'light' ? 'light' : 'dark'
  })
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('thermos-volume')
    const v = saved ? parseInt(saved, 10) : 70
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 70
  })
  const [isMute, setIsMute] = useState<boolean>(() => localStorage.getItem('thermos-mute') === 'true')
  const [driverModeOpen, setDriverModeOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('thermos-theme', theme)
  }, [theme])
  useEffect(() => {
    localStorage.setItem('thermos-volume', String(volume))
  }, [volume])
  useEffect(() => {
    localStorage.setItem('thermos-mute', String(isMute))
  }, [isMute])

  const effectiveVolume = isMute ? 0 : volume

  return (
    <main className="dashboard" data-theme={theme} data-lang={language}>
      <TopStatusBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} volume={effectiveVolume} setVolume={setVolume} isMute={isMute} setIsMute={setIsMute} onOpenDriver={() => setDriverModeOpen(true)} />
      <section className="dashboard-grid">
        <LeftTelemetry />
        <section className="center-stack">
          <EnergyRecoveryPanel />
          <TelemetryChart />
        </section>
        <AIAssistantPanel volume={effectiveVolume} />
      </section>
      <DiagnosticFooter />
      {driverModeOpen && (
        <DriverModePanel onClose={() => setDriverModeOpen(false)} volume={effectiveVolume} />
      )}
    </main>
  )
}

/* ================= Top Status Bar ================= */

function TopStatusBar({ theme, onToggleTheme, volume, setVolume, isMute, setIsMute, onOpenDriver }: { theme: Theme; onToggleTheme: () => void; volume: number; setVolume: (v: number) => void; isMute: boolean; setIsMute: (m: boolean) => void; onOpenDriver: () => void }) {
  const { language, setLanguage, t } = useLanguage()
  const [now, setNow] = useState(() => new Date())
  const [volumeOpen, setVolumeOpen] = useState(false)
  const volumeRef = useRef<HTMLDivElement>(null)

  // Immediately mute current audible output when muted
  useEffect(() => {
    if (isMute) cancelSpeech('muted')
  }, [isMute])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setVolumeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <Leaf size={35} />
        </div>
        <div>
          <div className="brand-title">
            TURBO <span>AI</span>
          </div>
          <div className="brand-subtitle">
            {t('header.subtitle')} <i />
          </div>
        </div>
      </div>

      <div className="topbar-center">
        <div className="status-pill">
          <span className="status-dot" />
          {t('header.systemOnline')}
        </div>
        <div className="car-window" aria-hidden="true">
          <svg viewBox="0 0 210 64">
            <path className="car-glow" d="M24 45 C57 31, 74 20, 119 19 C150 19, 171 28, 189 43" />
            <path d="M35 43 L55 26 L112 20 L143 29 L167 43 Z" />
            <path d="M67 27 L92 24 L90 40 L49 41 Z" />
            <path d="M99 24 L121 25 L140 39 L96 40 Z" />
            <circle cx="67" cy="45" r="9" />
            <circle cx="151" cy="45" r="9" />
            <path d="M18 49 H195" />
          </svg>
        </div>
        <div className="clock-block">
          <span>{formatHeaderDate(language, now)}</span>
          <strong>{formatHeaderTime(language, now)}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="language-switch">
          <button
            type="button"
            className={language === 'en' ? 'active' : ''}
            aria-pressed={language === 'en'}
            onClick={() => setLanguage('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={language === 'hi' ? 'active' : ''}
            aria-pressed={language === 'hi'}
            onClick={() => setLanguage('hi')}
          >
            हिंदी
          </button>
        </div>
        <div ref={volumeRef} className="volume-control">
          <button
            type="button"
            className="icon-button"
            aria-label={isMute ? (language === 'hi' ? 'अनम्यूट' : 'Unmute') : (language === 'hi' ? 'म्यूट' : 'Mute')}
            title={isMute ? (language === 'hi' ? 'अनम्यूट' : 'Unmute') : (language === 'hi' ? 'म्यूट' : 'Mute')}
            onClick={() => setVolumeOpen(v => !v)}
          >
            {isMute || volume === 0 ? <VolumeX size={22} /> : volume < 30 ? <Volume size={22} /> : <Volume2 size={22} />}
          </button>
          {volumeOpen && (
            <div className="volume-popover">
              <div className="volume-row">
                <span className="volume-label">{isMute || volume === 0 ? (language === 'hi' ? 'म्यूट' : 'Muted') : `${volume}%`}</span>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => setIsMute(!isMute)}
                  aria-label={isMute ? (language === 'hi' ? 'अनम्यूट' : 'Unmute') : (language === 'hi' ? 'म्यूट' : 'Mute')}
                >
                  {isMute ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value, 10))}
                className="volume-slider"
                aria-label={language === 'hi' ? 'आवाज़' : 'Volume'}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={language === 'hi' ? 'डriver मोड' : 'Driver Mode'}
          title={language === 'hi' ? 'डriver मोड' : 'Driver Mode'}
          onClick={onOpenDriver}
          style={{ color: 'var(--amber)' }}
        >
          <Truck size={22} />
        </button>
        <IconButton label={t('header.switchTheme')} onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={21} /> : <Moon size={21} />}
        </IconButton>
      </div>
    </header>
  )
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}

/* ================= Left Telemetry ================= */

function LeftTelemetry() {
  const { t } = useLanguage()
  const { telemetry } = useTelemetry()
  const { batteryCharge, chargingEtaMinutes, rpm, temperatureCelsius, pressureBar } = telemetry

  return (
    <aside className="left-column">
      <TelemetryPanel
        icon={<BatteryCharging size={24} />}
        title={t('telemetry.battery')}
        badge={batteryCharge >= 100 ? t('telemetry.normal') : t('telemetry.charging')}
        tone="green"
        gauge={<CircularGauge value={Math.round(batteryCharge)} tone="green" label={`${Math.round(batteryCharge)}%`} />}
      >
        <div className="battery-detail">
          <span>{t('telemetry.estTimeRemaining')}</span>
          <strong>{chargingEtaMinutes} min</strong>
          <div className="bar">
            <i style={{ width: `${Math.min(100, Math.max(0, batteryCharge))}%` }} />
          </div>
          <Sparkline tone="cyan" />
        </div>
      </TelemetryPanel>

      <TelemetryPanel
        icon={<Cog size={25} />}
        title={t('telemetry.engineRpm')}
        badge={rpm < 3000 ? t('telemetry.normal') : 'HIGH'}
        tone="green"
        gauge={<ArcGauge value={String(Math.round(rpm))} unit="RPM" tone="rpm" rpmValue={rpm} />}
      >
        <SparkBlock tone="green" />
      </TelemetryPanel>

      <TelemetryPanel
        icon={<Thermometer size={25} />}
        title={t('telemetry.exhaustTemperature')}
        badge={temperatureCelsius > 220 ? t('telemetry.high') : t('telemetry.normal')}
        tone="amber"
        gauge={<ArcGauge value={String(Math.round(temperatureCelsius))} unit="°C" tone="hot" tempValue={temperatureCelsius} />}
      >
        <SparkBlock tone="red" />
      </TelemetryPanel>

      <TelemetryPanel
        icon={<Activity size={25} />}
        title={t('telemetry.exhaustPressure')}
        badge={pressureBar > 2.2 ? t('telemetry.high') : t('telemetry.normal')}
        tone="cyan"
        gauge={<ArcGauge value={String(Math.round(pressureBar * 10) / 10)} unit="bar" tone="pressure" />}>
        <SparkBlock tone="cyan" />
      </TelemetryPanel>
    </aside>
  )
}

function TelemetryPanel({
  icon,
  title,
  badge,
  tone,
  gauge,
  children,
}: {
  icon: React.ReactNode
  title: string
  badge: string
  tone: 'green' | 'amber' | 'cyan'
  gauge: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useLanguage()
  return (
    <article className={`panel telemetry telemetry-${tone}`}>
      <div className="panel-heading">
        <div className="heading-title">
          {icon}
          <h2>{title}</h2>
        </div>
        <span className="badge">{badge}</span>
      </div>
      <div className="telemetry-body">
        {gauge}
        <div className="telemetry-side">
          {children}
          <small>{t('telemetry.simulatedData')}</small>
        </div>
      </div>
    </article>
  )
}

function CircularGauge({ value, label, tone }: { value: number; label: string; tone: string }) {
  const circumference = 2 * Math.PI * 45
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={`circle-gauge ${tone}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="track" cx="60" cy="60" r="45" />
        <circle
          className="progress"
          cx="60"
          cy="60"
          r="45"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
        />
      </svg>
      <strong>{label}</strong>
    </div>
  )
}

function ArcGauge({
  value,
  unit,
  tone,
  rpmValue,
  tempValue,
}: {
  value: string
  unit: string
  tone: 'rpm' | 'hot' | 'pressure'
  rpmValue?: number
  tempValue?: number
}) {
  const pct = useMemo(() => {
    if (tone === 'rpm') {
      return Math.min(1, Math.max(0, (rpmValue ?? 2450) / 6000))
    }
    if (tone === 'hot') {
      return Math.min(1, Math.max(0, (tempValue ?? 185) / 350))
    }
    return Math.min(1, Math.max(0, parseFloat(value) / 3.0))
  }, [tone, rpmValue, tempValue, value])

  const rot = -90 + pct * 180
  return (
    <div className={`arc-gauge ${tone}`}>
      <svg viewBox="0 0 150 96" aria-hidden="true">
        <path className="arc-track" d="M18 82 A57 57 0 0 1 132 82" />
        <path className="arc-main" d="M18 82 A57 57 0 0 1 132 82" />
        {gaugeTicks.map((tick) => (
          <line
            key={tick}
            className="tick"
            x1="75"
            y1="24"
            x2="75"
            y2="32"
            transform={`rotate(${-90 + tick * 11.25} 75 82)`}
          />
        ))}
        {tone === 'rpm' && <path className="arc-warn" d="M92 31 A57 57 0 0 1 132 82" />}
        {tone === 'hot' && <path className="arc-warn" d="M72 25 A57 57 0 0 1 132 82" />}
        <line
          className="needle"
          x1="75"
          y1="82"
          x2="75"
          y2="36"
          transform={`rotate(${rot} 75 82)`}
        />
      </svg>
      <div className="arc-reading">
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      {tone === 'rpm' && (
        <div className="scale">
          <span>0</span>
          <span>8K</span>
        </div>
      )}
    </div>
  )
}

function SparkBlock({ tone }: { tone: 'green' | 'cyan' | 'red' }) {
  return (
    <div className="spark-block">
      <Sparkline tone={tone} />
    </div>
  )
}

function Sparkline({ tone }: { tone: 'green' | 'cyan' | 'red' }) {
  return (
    <svg className={`sparkline ${tone}`} viewBox="0 0 150 42" preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-grid" d="M0 10 H150 M0 24 H150 M0 38 H150" />
      <path className="spark-path" d={sparkPath} />
    </svg>
  )
}

/* ================= Energy Recovery Panel ================= */

function EnergyRecoveryPanel() {
  const { t } = useLanguage()
  const { telemetry } = useTelemetry()
  return (
    <article className="panel energy-panel">
      <div className="panel-heading">
        <div className="heading-title">
          <Cog size={24} />
          <h2>{t('energy.title')}</h2>
        </div>
        <span className="badge active">
          <span className="status-dot" />
          {t('energy.simulationActive')}
        </span>
      </div>
      <EnergyFlowArt telemetry={telemetry} />
      <div className="metric-row">
        <MetricCard
          icon={<Zap size={35} />}
          label={t('energy.recoveredPower')}
          value={`${telemetry.recoveredPowerWatts} W`}
          tone="amber"
          spark
        />
        <MetricCard
          icon={<Battery size={35} />}
          label={t('energy.batteryCharge')}
          value={`${Math.round(telemetry.batteryCharge)}%`}
          tone="green"
          progress
          progressValue={Math.round(telemetry.batteryCharge)}
        />
        <MetricCard
          icon={<Clock3 size={35} />}
          label={t('energy.chargingEta')}
          value={`${telemetry.chargingEtaMinutes} min`}
          tone="cyan"
          spark
        />
      </div>
    </article>
  )
}

function EnergyFlowArt({ telemetry }: { telemetry: import('./telemetry/types').TelemetryData }) {
  // Drive visual effects from telemetry using inline styles / CSS variables
  const heatInt = Math.min(1, telemetry.temperatureCelsius / 350)
  const particleSpeed = Math.min(1, telemetry.recoveredPowerWatts / 800)
  const glow = Math.min(1, telemetry.recoveredPowerWatts / 800)
  const batteryFill = Math.min(1, telemetry.batteryCharge / 100)

  return (
    <div
      className="flow-art"
      style={
        {
          '--heat-intensity': heatInt,
          '--particle-speed': particleSpeed,
          '--electrical-glow': glow,
          '--battery-fill': batteryFill,
        } as React.CSSProperties
      }
    >
      <FlowStageLabel className="label-exhaust" textKey="energy.exhaustHeat" />
      <FlowStageLabel className="label-module" textKey="energy.heatRecoveryModule" />
      <FlowStageLabel className="label-electric" textKey="energy.electricalConversion" />
      <FlowStageLabel className="label-battery" textKey="energy.batteryCharging" />
      <svg viewBox="0 0 820 310" aria-hidden="true">
        <defs>
          <linearGradient id="engineMetal" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#182624" />
            <stop offset="45%" stopColor="#6e7d77" />
            <stop offset="100%" stopColor="#15211f" />
          </linearGradient>
          <linearGradient id="heatRibbon" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#ff4b2f" />
            <stop offset="55%" stopColor="#ffb547" />
            <stop offset="100%" stopColor="#22f5a0" />
          </linearGradient>
          <linearGradient id="electricRibbon" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#24d9f2" />
            <stop offset="100%" stopColor="#48ff91" />
          </linearGradient>
          <filter id="energyGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="engine">
          <rect x="18" y="150" width="118" height="58" rx="8" fill="url(#engineMetal)" />
          <rect x="37" y="115" width="78" height="42" rx="8" fill="#0c1715" stroke="#49645f" />
          <path d="M18 182 H0 M45 208 V240 H110 V208 M69 116 V96 H108 V116" stroke="#566b66" strokeWidth="8" fill="none" />
          <g stroke="#17211f" strokeWidth="5">
            <line x1="32" y1="154" x2="32" y2="207" />
            <line x1="58" y1="154" x2="58" y2="207" />
            <line x1="84" y1="154" x2="84" y2="207" />
            <line x1="110" y1="154" x2="110" y2="207" />
          </g>
        </g>

        <g className="energy-ribbons" filter="url(#energyGlow)">
          <path className="heat heat-one" d="M112 155 C175 101, 245 133, 304 156 C343 171, 377 174, 410 162" />
          <path className="heat heat-two" d="M116 178 C184 142, 248 156, 312 177 C347 188, 382 188, 415 177" />
          <path className="heat heat-three" d="M118 201 C185 189, 255 195, 321 201 C360 205, 387 202, 416 193" />
          <path className="electric" d="M485 170 C560 148, 614 151, 688 166" />
          <path className="electric electric-two" d="M486 192 C560 191, 611 188, 688 178" />
        </g>

        <g className="particles">
          {Array.from({ length: 24 }, (_, index) => (
            <circle
              key={index}
              cx={150 + index * 22}
              cy={122 + (index % 5) * 22}
              r={index % 3 === 0 ? 2.3 : 1.5}
              style={{ animationDuration: `${2 + index * 0.15}s` }}
            />
          ))}
        </g>

        <g className="module">
          <ellipse cx="445" cy="176" rx="61" ry="69" fill="#081411" stroke="#4b6b62" strokeWidth="4" />
          <rect x="386" y="112" width="116" height="126" rx="22" fill="url(#engineMetal)" stroke="#1c6c5a" strokeWidth="4" />
          <rect x="404" y="126" width="78" height="98" rx="13" fill="#12211e" stroke="#758b82" />
          <g stroke="#ffb547" strokeWidth="2">
            <circle cx="420" cy="150" r="5" />
            <circle cx="465" cy="150" r="5" />
            <circle cx="420" cy="199" r="5" />
            <circle cx="465" cy="199" r="5" />
          </g>
          <path d="M505 175 H560" stroke="#24d9f2" strokeWidth="8" />
        </g>

        <g className="battery-art">
          <rect x="676" y="113" width="112" height="126" rx="14" fill="#0a1b18" stroke="#2effa7" strokeWidth="4" />
          <rect x="704" y="96" width="56" height="18" rx="5" fill="#0a1b18" stroke="#2effa7" strokeWidth="4" />
          <rect x="696" y="134" width="18" height="84" rx="4" />
          <rect x="725" y="134" width="18" height="84" rx="4" />
          <rect x="754" y="134" width="18" height={`${84 * (telemetry.batteryCharge / 100)}`} rx="4" />
          <path d="M646 175 H677" stroke="#48ff91" strokeWidth="10" />
        </g>

        <g className="connectors">
          <path d="M153 77 V102" />
          <path d="M445 73 V101" />
          <path d="M590 78 V112" />
          <path d="M733 78 V106" />
        </g>
      </svg>
    </div>
  )
}

function FlowStageLabel({ className, textKey }: { className: string; textKey: TranslationKey }) {
  const { t } = useLanguage()
  const lines = t(textKey).split('\n')
  return (
    <div className={`stage-label ${className}`}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </div>
  )
}

export function MetricCard({
  icon,
  label,
  value,
  tone,
  spark,
  progress,
  progressValue,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'green' | 'cyan' | 'amber'
  spark?: boolean
  progress?: boolean
  progressValue?: number
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {spark && <Sparkline tone={tone === 'amber' ? 'green' : 'cyan'} />}
        {progress && (
          <div className="bar">
            <i style={{ width: `${Math.min(100, Math.max(0, progressValue ?? 68))}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= Telemetry Chart ================= */

function TelemetryChart() {
  const { t } = useLanguage()
  const { history } = useTelemetry()
  const [activeTab, setActiveTab] = useState<ChartTab>('rpm')
  const [range, setRange] = useState('1M')
  const ranges = ['1M', '5M', '15M']

  const filteredHistory = useMemo(() => {
    const count = range === '1M' ? 20 : range === '5M' ? 50 : 100
    return history.slice(-count)
  }, [history, range])

  const chartData = useMemo(() => {
    return filteredHistory.map((d) => {
      if (activeTab === 'rpm') return { time: d.timeLabel, value: d.rpm }
      if (activeTab === 'temperature') return { time: d.timeLabel, value: d.temperatureCelsius }
      if (activeTab === 'pressure') return { time: d.timeLabel, value: d.pressureBar }
      return { time: d.timeLabel, value: d.recoveredPowerWatts }
    })
  }, [filteredHistory, activeTab])

  const currentValue = useMemo(() => {
    const last = filteredHistory[filteredHistory.length - 1]
    if (!last) return 0
    if (activeTab === 'rpm') return last.rpm
    if (activeTab === 'temperature') return last.temperatureCelsius
    if (activeTab === 'pressure') return last.pressureBar
    return last.recoveredPowerWatts
  }, [filteredHistory, activeTab])

  const unit = activeTab === 'rpm' ? 'RPM' : activeTab === 'temperature' ? '°C' : activeTab === 'pressure' ? 'bar' : 'W'

  const yAxisConfig = useMemo(() => {
    if (activeTab === 'rpm') return { domain: [0, 8000], ticks: [0, 2000, 4000, 6000, 8000], fmt: (v: number) => (v === 0 ? '0' : `${v / 1000}K`) }
    if (activeTab === 'temperature') return { domain: [0, 350], ticks: [0, 100, 200, 300, 350], fmt: (v: number) => `${v}°C` }
    if (activeTab === 'pressure') return { domain: [0, 3.5], ticks: [0, 1, 2, 3], fmt: (v: number) => `${v} bar` }
    return { domain: [0, 800], ticks: [0, 200, 400, 600, 800], fmt: (v: number) => `${v} W` }
  }, [activeTab])

  // Gradient id unique per tab to avoid conflicts
  const gradientId = `fill-${activeTab}`

  const fixedLabel = useMemo(() => {
    if (activeTab === 'rpm') return `${currentValue.toLocaleString()} RPM`
    if (activeTab === 'temperature') return `${currentValue}°C`
    if (activeTab === 'pressure') return `${currentValue.toFixed(1)} bar`
    return `${currentValue} W`
  }, [currentValue, activeTab])

  const fixedSub = chartData.length ? chartData[chartData.length - 1].time : '--:--'

  return (
    <article className="panel chart-panel">
      <div className="chart-controls">
        <div className="tabs">
          {chartTabs.map((tab) => (
            <button
              className={activeTab === tab ? 'active' : ''}
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {t(chartTabLabels[tab])}
            </button>
          ))}
        </div>
        <div className="ranges">
          {ranges.map((item) => (
            <button className={range === item ? 'active' : ''} key={item} type="button" onClick={() => setRange(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--green)" stopOpacity={0.42} />
                <stop offset="90%" stopColor="var(--green)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--grid-line)" vertical horizontal />
            <XAxis dataKey="time" stroke="var(--muted)" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              stroke="var(--muted)"
              tickLine={false}
              axisLine={false}
              domain={yAxisConfig.domain as [number, number]}
              ticks={yAxisConfig.ticks}
              tickFormatter={yAxisConfig.fmt}
            />
            <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: 'var(--green)', strokeDasharray: '3 4' }} />
            <Area type="monotone" dataKey="value" stroke="var(--green)" strokeWidth={3} fill={`url(#${gradientId})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="fixed-tooltip">
          <strong>{fixedLabel}</strong>
          <span>{fixedSub}</span>
        </div>
      </div>
    </article>
  )
}

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: Array<{ value: number }>; unit: string }) {
  if (!active || !payload?.length) {
    return null
  }
  const val = payload[0].value
  const text = unit === 'W' ? `${val} W` : unit === 'RPM' ? `${val.toLocaleString()} RPM` : unit === '°C' ? `${val}°C` : `${val} bar`
  return (
    <div className="chart-tooltip">
      <strong>{text}</strong>
    </div>
  )
}

/* ================= AI Assistant ================= */

function AIAssistantPanel({ volume = 70 }: { volume?: number }) {
  const { t, language } = useLanguage()
  const { telemetry } = useTelemetry()
  const [chip, setChip] = useState<AssistantChip>('batteryEta')
  const [input, setInput] = useState('')

  const greeting = language === 'hi' ? GREETING_HI : GREETING_EN
  const volumeLevel = (volume ?? 70) / 100

  const voice = useVoiceAssistant(language, volumeLevel)
  const { messages, loading, notice, retryText, agentPaused, ask, retry, interrupt, togglePause, clearChat } =
    useAssistantChat({ language, voice, greeting })

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const spokenLangRef = useRef<Language | null>(null)

  // Greeting waits while a question or an answer is in flight so it can never
  // interrupt a user-requested answer.
  const greetingBusy = loading || voice.state === 'processing' || voice.state === 'speaking'

  useEffect(() => {
    if (spokenLangRef.current === language) return
    if (greetingBusy) return
    if (!isVoiceOutputEnabled()) {
      spokenLangRef.current = language
      diag('greeting', 'skipped-muted', { lang: language })
      return
    }
    spokenLangRef.current = language
    diag('greeting', 'play', { lang: language })
    void speakOnce(greeting, language === 'hi' ? 'hi' : 'en').then((outcome) => {
      diag('greeting', 'outcome', { outcome })
    })
  }, [language, greeting, greetingBusy])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const statusText = useMemo(() => {
    if (voice.state === 'processing') return t('voice.processing')
    if (voice.state === 'speaking') return t('voice.speaking')
    if (voice.state === 'paused') return t('voice.paused')
    if (voice.message) return voice.message
    if (voice.state === 'listening') return t('voice.listening')
    if (voice.state === 'error') return t('voice.error')
    return voice.voiceActive ? t('voice.active') : t('assistant.tapToSpeak')
  }, [voice.state, voice.message, voice.voiceActive, t])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    ask(text)
  }

  return (
    <aside className="panel assistant-panel">
      <div className="assistant-header">
        <div className="heading-title">
          <Bot size={25} />
          <div>
            <h2>TURBO AI</h2>
            <span>{t('assistant.energyCopilot')}</span>
          </div>
        </div>
      </div>

      <div className="assistant-intro">
        <VoiceOrb />
        <div className="ready-card">
          <strong>
            <span className="status-dot" />
            {t('assistant.ready')}
          </strong>
          <p>{t('assistant.intro')}</p>
        </div>
      </div>

      <div className="chips">
        {assistantChips.map((item) => (
          <button className={chip === item ? 'active' : ''} key={item} type="button" onClick={() => setChip(item)}>
            {t(assistantChipLabels[item])}
          </button>
        ))}
      </div>

      <div className="chat-window">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="assistant-avatar">
                <Leaf size={26} />
              </div>
            )}
            <div className={msg.role === 'assistant' ? 'message-bubble' : undefined}>
              <p>{msg.text}</p>
              <time>{msg.time}</time>
              {msg.role === 'assistant' && i === messages.length - 1 && (
                <div className="mini-card">
                  <BatteryCharging size={30} />
                  <div>
                    <strong>{telemetry.chargingEtaMinutes} min</strong>
                    <span>{t('assistant.estimatedTimeRemaining')}</span>
                  </div>
                  <div className="mini-charge">
                    <span>{t('assistant.charge')}</span>
                    <strong>{Math.round(telemetry.batteryCharge)}%</strong>
                    <div className="bar">
                      <i style={{ width: `${Math.round(telemetry.batteryCharge)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="assistant-avatar">
              <Leaf size={26} />
            </div>
            <div className="message-bubble">
              <p style={{ color: 'var(--muted)' }}>{language === 'hi' ? 'सोच रहा हूँ...' : 'Thinking...'}</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="voice-control">
        <WaveBars />
        <button
          type="button"
          aria-label={voice.voiceActive ? t('assistant.stopVoice') : t('assistant.tapToSpeak')}
          title={voice.voiceActive ? t('assistant.stopVoice') : t('assistant.tapToSpeak')}
          onClick={() => {
            if (voice.voiceActive) {
              voice.stopListening()
            } else if (voice.state === 'speaking') {
              voice.interruptSpeech()
            } else {
              voice.startListening(ask)
            }
          }}
          style={
            voice.voiceActive
              ? { borderColor: 'var(--amber)', boxShadow: '0 0 22px var(--amber)' }
              : voice.state === 'speaking'
                ? { borderColor: 'var(--cyan)' }
                : undefined
          }
        >
          <Mic size={38} />
        </button>
        <WaveBars reverse />
        <span>{statusText}</span>
      </div>
      {!voice.isSupported && (
        <div style={{ padding: '0 14px 8px', fontSize: 12, color: 'var(--muted)' }}>
          {t('voice.unsupported')}
        </div>
      )}

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={t('assistant.placeholder')}
        />
        <button type="button" aria-label={t('assistant.send')} title={t('assistant.send')} onClick={handleSend}>
          <Send size={23} />
        </button>
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
              aria-label={t('assistant.retry')}
            >
              {t('assistant.retry')}
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
        <button
          type="button"
          className="icon-button"
          aria-label={t('assistant.interrupt')}
          title={t('assistant.interrupt')}
          onClick={interrupt}
        >
          <Pause size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={agentPaused ? t('assistant.resumeAgent') : t('assistant.pauseAgent')}
          title={agentPaused ? t('assistant.resumeAgent') : t('assistant.pauseAgent')}
          onClick={togglePause}
        >
          {agentPaused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button
          onClick={clearChat}
          className="icon-button"
          title={t('assistant.clearChat')}
          aria-label={t('assistant.clearChat')}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  )
}

function VoiceOrb() {
  return (
    <div className="voice-orb" aria-hidden="true">
      <span />
      <svg viewBox="0 0 110 110">
        <circle cx="55" cy="55" r="42" />
        <circle cx="55" cy="55" r="24" />
        <path d="M19 56 H36 L40 47 L45 65 L51 37 L58 75 L64 44 L70 62 L75 52 L91 52" />
      </svg>
    </div>
  )
}

function WaveBars({ reverse }: { reverse?: boolean }) {
  const bars = [14, 23, 32, 40, 29, 20, 14]
  return (
    <div className={`wave-bars ${reverse ? 'reverse' : ''}`} aria-hidden="true">
      {bars.map((height, index) => (
        <i key={index} style={{ height }} />
      ))}
    </div>
  )
}

/* ================= Diagnostic Footer ================= */

function DiagnosticFooter() {
  const { language, t } = useLanguage()
  const { telemetry, isPaused, togglePause } = useTelemetry()

  // Format last update using telemetry timestamp
  const lastTime = new Date(telemetry.timestamp)
  const lastStr = lastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })

  return (
    <footer className="diagnostic-footer">
      <div className="footer-left">
        <Car size={25} />
        <span>
          {t('footer.dataSourceLabel')} <strong>{t('footer.dataSourceValue')}</strong>
        </span>
        <i />
        <span>
          {t('footer.recoveryStatusLabel')} <strong>{isPaused ? 'PAUSED' : t('footer.recoveryStatusValue')}</strong>
        </span>
        <i />
        <span>
          {t('footer.lastUpdateLabel')} <strong>{language === 'hi' ? lastStr.toUpperCase() : lastStr}</strong>
        </span>
      </div>
      <button type="button" className="pause-button" onClick={togglePause} aria-label={isPaused ? 'Resume' : 'Pause'}>
        {isPaused ? <Play size={19} /> : <Pause size={19} />}
        {isPaused ? 'RESUME SIMULATION' : t('footer.pauseSimulation')}
      </button>
    </footer>
  )
}

export default App

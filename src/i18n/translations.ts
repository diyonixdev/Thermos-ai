export type Language = 'en' | 'hi'

const en = {
  'header.subtitle': 'EXHAUST ENERGY MANAGEMENT',
  'header.systemOnline': 'SYSTEM ONLINE',
  'header.audio': 'Audio',
  'header.switchTheme': 'Switch theme',
  'header.settings': 'Settings',
  'telemetry.battery': 'BATTERY',
  'telemetry.charging': 'CHARGING',
  'telemetry.estTimeRemaining': 'EST. TIME REMAINING',
  'telemetry.engineRpm': 'ENGINE RPM',
  'telemetry.normal': 'NORMAL',
  'telemetry.exhaustTemperature': 'EXHAUST TEMPERATURE',
  'telemetry.high': 'HIGH',
  'telemetry.exhaustPressure': 'EXHAUST PRESSURE',
  'telemetry.simulatedData': 'Simulated data',
  'energy.title': 'ENERGY RECOVERY FLOW',
  'energy.simulationActive': 'SIMULATION ACTIVE',
  'energy.exhaustHeat': 'EXHAUST\nHEAT',
  'energy.heatRecoveryModule': 'HEAT RECOVERY\nMODULE',
  'energy.electricalConversion': 'ELECTRICAL\nCONVERSION',
  'energy.batteryCharging': 'BATTERY\nCHARGING',
  'energy.recoveredPower': 'RECOVERED POWER',
  'energy.batteryCharge': 'BATTERY CHARGE',
  'energy.chargingEta': 'CHARGING ETA',
  'chart.rpm': 'RPM',
  'chart.temperature': 'TEMPERATURE',
  'chart.pressure': 'PRESSURE',
  'chart.recoveredPower': 'RECOVERED POWER',
  'assistant.energyCopilot': 'ENERGY COPILOT',
  'assistant.ready': 'READY',
  'assistant.intro': 'Ask me about battery, RPM, temperature or pressure.',
  'assistant.batteryEta': 'BATTERY ETA',
  'assistant.allSystems': 'ALL SYSTEMS',
  'assistant.tapToSpeak': 'Tap to speak',
  'assistant.placeholder': 'Type your question in English, Hindi or Hinglish...',
  'assistant.send': 'Send',
  'assistant.sampleUserMessage': 'How much time will the battery take to charge?',
  'assistant.sampleReply':
    'The battery will take approximately 18 minutes to charge. This is a simulated estimate.',
  'assistant.estimatedTimeRemaining': 'Estimated time remaining',
  'assistant.charge': 'Charge',
  'footer.dataSourceLabel': 'DATA SOURCE:',
  'footer.dataSourceValue': 'MOCK SENSORS',
  'footer.recoveryStatusLabel': 'RECOVERY STATUS:',
  'footer.recoveryStatusValue': 'SIMULATED',
  'footer.lastUpdateLabel': 'LAST UPDATE:',
  'footer.pauseSimulation': 'PAUSE SIMULATION',
} as const

export type TranslationKey = keyof typeof en

const hi: Record<TranslationKey, string> = {
  'header.subtitle': 'एग्जॉस्ट ऊर्जा प्रबंधन',
  'header.systemOnline': 'सिस्टम चालू',
  'header.audio': 'ऑडियो',
  'header.switchTheme': 'थीम बदलें',
  'header.settings': 'सेटिंग्स',
  'telemetry.battery': 'बैटरी',
  'telemetry.charging': 'चार्ज हो रही है',
  'telemetry.estTimeRemaining': 'अनुमानित शेष समय',
  'telemetry.engineRpm': 'इंजन RPM',
  'telemetry.normal': 'सामान्य',
  'telemetry.exhaustTemperature': 'एग्जॉस्ट तापमान',
  'telemetry.high': 'अधिक',
  'telemetry.exhaustPressure': 'एग्जॉस्ट दबाव',
  'telemetry.simulatedData': 'सिम्युलेटेड डेटा',
  'energy.title': 'ऊर्जा पुनर्प्राप्ति प्रवाह',
  'energy.simulationActive': 'सिमुलेशन सक्रिय',
  'energy.exhaustHeat': 'एग्जॉस्ट की\nऊष्मा',
  'energy.heatRecoveryModule': 'ऊष्मा\nपुनर्प्राप्ति मॉड्यूल',
  'energy.electricalConversion': 'विद्युत\nरूपांतरण',
  'energy.batteryCharging': 'बैटरी\nचार्जिंग',
  'energy.recoveredPower': 'पुनर्प्राप्त ऊर्जा',
  'energy.batteryCharge': 'बैटरी चार्ज',
  'energy.chargingEta': 'चार्ज होने का अनुमानित समय',
  'chart.rpm': 'RPM',
  'chart.temperature': 'तापमान',
  'chart.pressure': 'दबाव',
  'chart.recoveredPower': 'पुनर्प्राप्त ऊर्जा',
  'assistant.energyCopilot': 'ऊर्जा सहायक',
  'assistant.ready': 'तैयार',
  'assistant.intro': 'बैटरी, RPM, तापमान या दबाव के बारे में पूछें।',
  'assistant.batteryEta': 'बैटरी चार्ज समय',
  'assistant.allSystems': 'सभी पैरामीटर',
  'assistant.tapToSpeak': 'बोलने के लिए टैप करें',
  'assistant.placeholder': 'अंग्रेज़ी, हिंदी या हिंग्लिश में अपना सवाल लिखें...',
  'assistant.send': 'भेजें',
  'assistant.sampleUserMessage': 'बैटरी चार्ज होने में कितना समय लगेगा?',
  'assistant.sampleReply': 'बैटरी को चार्ज होने में लगभग 18 मिनट लगेंगे। यह एक सिम्युलेटेड अनुमान है।',
  'assistant.estimatedTimeRemaining': 'अनुमानित शेष समय',
  'assistant.charge': 'चार्ज',
  'footer.dataSourceLabel': 'डेटा स्रोत:',
  'footer.dataSourceValue': 'सिम्युलेटेड सेंसर',
  'footer.recoveryStatusLabel': 'रिकवरी स्थिति:',
  'footer.recoveryStatusValue': 'सिम्युलेटेड',
  'footer.lastUpdateLabel': 'अंतिम अपडेट:',
  'footer.pauseSimulation': 'सिमुलेशन रोकें',
}

export const translations: Record<Language, Record<TranslationKey, string>> = { en, hi }

const mockTimestamp = new Date(2026, 9, 14, 18, 38, 12)

export function formatHeaderDate(language: Language, date: Date): string {
  if (language === 'hi') {
    return new Intl.DateTimeFormat('hi-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''

  return `${part('weekday')}, ${part('day')} ${part('month')} ${part('year')}`.toUpperCase()
}

export function formatHeaderTime(language: Language, date: Date): string {
  if (language === 'hi') {
    return new Intl.DateTimeFormat('hi-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
      .format(date)
      .toUpperCase()
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

export function formatLastUpdateTime(language: Language): string {
  if (language === 'hi') {
    return new Intl.DateTimeFormat('hi-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
      .format(mockTimestamp)
      .toUpperCase()
  }
  return '06:38:12 PM'
}

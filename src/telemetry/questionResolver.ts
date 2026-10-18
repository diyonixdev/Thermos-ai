import type { TelemetryData } from './types'

export type AssistantQuestion = 'battery' | 'rpm' | 'temperature' | 'pressure' | 'all' | 'unknown'

export function classifyQuestion(input: string): AssistantQuestion {
  const s = input.toLowerCase()
  if (s.includes('battery') || s.includes('बैटरी') || s.includes('charge') || s.includes('चार्ज') || s.includes('eta') || s.includes('time') || s.includes('सम') || s.includes('kitna')) {
    if (s.includes('all') || s.includes('सभी') || s.includes('saare')) return 'all'
    return 'battery'
  }
  if ((s.includes('rpm') || s.includes('engine')) && (s.includes('kitna') || s.includes('how') || s.includes('क्या') || s.includes('aaj')))
    return 'rpm'
  if (s.includes('temperature') || s.includes('temp') || s.includes('तापमान') || s.includes('exhaust'))
    return 'temperature'
  if (s.includes('pressure') || s.includes('dbaav') || s.includes('दबाव') || s.includes('bar'))
    return 'pressure'
  if (s.includes('all') || s.includes('सभी') || s.includes('saare')) return 'all'
  return 'unknown'
}

function fmt(val: number, decimals = 0) {
  return decimals > 0 ? val.toFixed(decimals) : String(Math.round(val))
}

export function answerQuestion(q: AssistantQuestion, data: TelemetryData, lang: 'en' | 'hi'): string {
  if (q === 'battery') {
    const eta = data.chargingEtaMinutes
    if (lang === 'hi') {
      return `बैटरी ${fmt(data.batteryCharge, 0)}% चार्ज है। चार्ज होने में लगभग ${eta} मिनट लगेंगे।`
    }
    return `Battery is at ${fmt(data.batteryCharge, 0)}%. Estimated time to full charge is approximately ${eta} minutes.`
  }
  if (q === 'rpm') {
    if (lang === 'hi') {
      return `वर्तमान RPM ${fmt(data.rpm)} है।`
    }
    return `Current RPM is ${fmt(data.rpm)}.`
  }
  if (q === 'temperature') {
    if (lang === 'hi') {
      return `एग्जॉस्ट तापमान ${fmt(data.temperatureCelsius)}°C है।`
    }
    return `Exhaust temperature is ${fmt(data.temperatureCelsius)}°C.`
  }
  if (q === 'pressure') {
    if (lang === 'hi') {
      return `एग्जॉस्ट दबाव ${fmt(data.pressureBar, 1)} bar है।`
    }
    return `Exhaust pressure is ${fmt(data.pressureBar, 1)} bar.`
  }
  if (q === 'all') {
    const eta = data.chargingEtaMinutes
    if (lang === 'hi') {
      return `बैटरी ${fmt(data.batteryCharge, 0)}% (${eta} मिनट), RPM ${fmt(data.rpm)}, तापमान ${fmt(data.temperatureCelsius)}°C, दबाव ${fmt(data.pressureBar, 1)} bar, पुनर्प्राप्त शक्ति ${fmt(data.recoveredPowerWatts)} W।`
    }
    return `Battery ${fmt(data.batteryCharge, 0)}% (${eta} min to full), RPM ${fmt(data.rpm)}, Temperature ${fmt(data.temperatureCelsius)}°C, Pressure ${fmt(data.pressureBar, 1)} bar, Recovered Power ${fmt(data.recoveredPowerWatts)} W.`
  }
  if (lang === 'hi') {
    return `मैं बैटरी, RPM, तापमान, दबाव और पुनर्प्राप्त शक्ति के बारे में जानकारी दे सकता हूँ। कृपya पूछें।`
  }
  return `I can report battery, RPM, temperature, pressure, and recovered power. Try asking about any of those.`
}

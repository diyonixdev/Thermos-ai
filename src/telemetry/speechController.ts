function getEffectiveVolume(): number {
  try {
    const mute = localStorage.getItem('thermos-mute') === 'true'
    if (mute) return 0
    const saved = localStorage.getItem('thermos-volume')
    const v = saved ? parseInt(saved, 10) : 70
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : 0.7
  } catch {
    return 0.7
  }
}

export function createUtterance(text: string, lang: 'en' | 'hi'): SpeechSynthesisUtterance {
  const utter = new (window as any).SpeechSynthesisUtterance(text)
  utter.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'
  utter.rate = 1.05
  utter.pitch = 1
  utter.volume = getEffectiveVolume()
  return utter
}

export function speakText(text: string, lang: 'en' | 'hi'): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utter = createUtterance(text, lang)
  window.speechSynthesis.speak(utter)
}

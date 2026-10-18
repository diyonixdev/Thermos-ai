import type { TelemetryData } from './types'

const INITIAL: TelemetryData = {
  batteryCharge: 68,
  chargingEtaMinutes: 18,
  rpm: 2450,
  temperatureCelsius: 185,
  pressureBar: 1.8,
  recoveredPowerWatts: 320,
  recoveryEfficiency: 42,
  timestamp: Date.now(),
}

export const INITIAL_TELEMETRY = INITIAL

export function updateMockTelemetry(prev: TelemetryData): TelemetryData {
  // RPM changes smoothly
  const rpmDelta = (Math.random() - 0.5) * 120
  let rpm = Math.round(prev.rpm + rpmDelta)
  rpm = Math.max(800, Math.min(6000, rpm))

  // Temperature responds gradually to RPM
  const tempTarget = 120 + (rpm / 6000) * 220 + (Math.random() - 0.5) * 30
  let temperatureCelsius = Math.round(prev.temperatureCelsius + (tempTarget - prev.temperatureCelsius) * 0.08 + (Math.random() - 0.5) * 3)
  temperatureCelsius = Math.max(50, Math.min(350, temperatureCelsius))

  // Pressure fluctuates
  let pressureBar = prev.pressureBar + (Math.random() - 0.5) * 0.08
  pressureBar = Math.max(0.5, Math.min(3.0, Math.round(pressureBar * 10) / 10))

  // Recovered power coherent with conditions
  const basePower = 180 + (rpm / 6000) * 450 + (temperatureCelsius / 350) * 120
  let recoveredPowerWatts = Math.round(basePower + (Math.random() - 0.5) * 60)
  recoveredPowerWatts = Math.max(0, Math.min(800, recoveredPowerWatts))

  // Recovery efficiency linked to power and temp
  let recoveryEfficiency = Math.round(30 + (recoveredPowerWatts / 800) * 60 + (Math.random() - 0.5) * 5)
  recoveryEfficiency = Math.max(0, Math.min(100, recoveryEfficiency))

  // Battery charge increases gradually while charging; ETA decreases accordingly
  let batteryCharge = prev.batteryCharge
  let chargingEtaMinutes = prev.chargingEtaMinutes
  if (batteryCharge < 100) {
    batteryCharge = Math.min(100, batteryCharge + 0.08 + Math.random() * 0.06)
    chargingEtaMinutes = Math.max(0, Math.round(chargingEtaMinutes - (0.08 + Math.random() * 0.06) * 2.5))
  } else {
    chargingEtaMinutes = 0
  }
  batteryCharge = Math.round(batteryCharge * 10) / 10

  return {
    batteryCharge,
    chargingEtaMinutes,
    rpm,
    temperatureCelsius,
    pressureBar,
    recoveredPowerWatts,
    recoveryEfficiency,
    timestamp: Date.now(),
  }
}

export function generateHistory(count = 80): TelemetryData[] {
  const arr: TelemetryData[] = []
  let current = { ...INITIAL }
  current.timestamp = Date.now() - count * 1200
  for (let i = 0; i < count; i++) {
    current = updateMockTelemetry(current)
    current.timestamp = Date.now() - (count - i - 1) * 1200
    arr.push({ ...current })
  }
  return arr
}

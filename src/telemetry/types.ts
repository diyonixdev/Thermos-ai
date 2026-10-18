export interface TelemetryData {
  batteryCharge: number;         // 0 - 100
  chargingEtaMinutes: number;    // minutes
  rpm: number;                    // 800 - 6000
  temperatureCelsius: number;     // 50 - 350
  pressureBar: number;            // 0.5 - 3.0
  recoveredPowerWatts: number;    // 0 - 800
  recoveryEfficiency: number;     // 0 - 100
  timestamp: number;              // ms
}

export interface TelemetrySample extends TelemetryData {
  timeLabel: string; // HH:MM format
}

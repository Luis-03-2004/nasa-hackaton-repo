// Generator for public/mocks/fire-data.json. The dashboard reads that file.
import type { FireDataResponse, HarmonizedDataPoint, LocalForecast } from '../types/api'

export interface RegionDataset extends FireDataResponse {
  id: string
}

interface RegionProfile {
  id: string
  region_name: string
  lat: number
  lon: number
  calibration_status: FireDataResponse['calibration_status']
  peakWeek: number
  scale: number
  yearBoost: Record<number, number>
  alert_level: LocalForecast['alert_level']
  recent_anomaly_pct: number
}

const PROFILES: RegionProfile[] = [
  {
    id: 'cerrado',
    region_name: 'Cerrado Central',
    lat: -12,
    lon: -46,
    calibration_status: 'calibrated_local',
    peakWeek: 36,
    scale: 82,
    yearBoost: { 2020: 0.92, 2021: 0.86, 2022: 1.04, 2023: 0.97, 2024: 1.36, 2025: 1.18 },
    alert_level: 'ALERTA_ALTO',
    recent_anomaly_pct: 34,
  },
  {
    id: 'pantanal',
    region_name: 'Pantanal',
    lat: -17.5,
    lon: -57.2,
    calibration_status: 'calibrated_local',
    peakWeek: 32,
    scale: 64,
    yearBoost: { 2020: 1.55, 2021: 0.72, 2022: 0.84, 2023: 0.9, 2024: 1.48, 2025: 1.26 },
    alert_level: 'CRITICO',
    recent_anomaly_pct: 61,
  },
  {
    id: 'brasil',
    region_name: 'Brasil',
    lat: -14.2,
    lon: -51.9,
    calibration_status: 'calibrated_local',
    peakWeek: 35,
    scale: 120,
    yearBoost: { 2020: 1.02, 2021: 0.88, 2022: 1.06, 2023: 0.96, 2024: 1.31, 2025: 1.14 },
    alert_level: 'ALERTA_ALTO',
    recent_anomaly_pct: 27,
  },
  {
    id: 'world',
    region_name: 'Mundo',
    lat: 0,
    lon: 0,
    calibration_status: 'global_standard',
    peakWeek: 30,
    scale: 40,
    yearBoost: { 2020: 0.96, 2021: 0.94, 2022: 1, 2023: 1.02, 2024: 1.08, 2025: 1.04 },
    alert_level: 'NORMAL',
    recent_anomaly_pct: 6,
  },
  {
    id: 'california',
    region_name: 'Califórnia',
    lat: 37.5,
    lon: -120.5,
    calibration_status: 'global_standard',
    peakWeek: 38,
    scale: 48,
    yearBoost: { 2020: 1.4, 2021: 1.1, 2022: 0.82, 2023: 0.9, 2024: 1.18, 2025: 1.05 },
    alert_level: 'ATENCAO',
    recent_anomaly_pct: 15,
  },
  {
    id: 'angola',
    region_name: 'Angola',
    lat: -12.5,
    lon: 18.5,
    calibration_status: 'global_standard',
    peakWeek: 28,
    scale: 76,
    yearBoost: { 2020: 0.98, 2021: 1.04, 2022: 0.95, 2023: 1.08, 2024: 1.16, 2025: 1.1 },
    alert_level: 'ATENCAO',
    recent_anomaly_pct: 21,
  },
  {
    id: 'australia',
    region_name: 'Austrália',
    lat: -25.5,
    lon: 134,
    calibration_status: 'global_standard',
    peakWeek: 42,
    scale: 58,
    yearBoost: { 2020: 1.22, 2021: 0.8, 2022: 0.86, 2023: 1.14, 2024: 1.2, 2025: 0.98 },
    alert_level: 'NORMAL',
    recent_anomaly_pct: 4,
  },
]

function round(value: number) {
  return Math.round(value * 10) / 10
}

function weekStart(year: number, week: number) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4))
  const weekday = januaryFourth.getUTCDay() || 7
  const monday = new Date(januaryFourth)
  monday.setUTCDate(januaryFourth.getUTCDate() - weekday + 1 + (week - 1) * 7)
  return monday.toISOString().slice(0, 10)
}

function baselineFor(week: number, profile: RegionProfile) {
  const peak = Math.exp(-((week - profile.peakWeek) ** 2) / 80)
  return 4 + peak * profile.scale
}

function buildSeries(profile: RegionProfile): HarmonizedDataPoint[] {
  const series: HarmonizedDataPoint[] = []

  for (let year = 2020; year <= 2025; year += 1) {
    for (let week = 1; week <= 52; week += 1) {
      const baseline = baselineFor(week, profile)
      const seasonalNoise = 1 + 0.06 * Math.sin(week * 0.65 + year)
      const index = baseline * profile.yearBoost[year] * seasonalNoise
      series.push({
        iso_year: year,
        iso_week: week,
        week_start: weekStart(year, week),
        harmonized_index: round(index),
        n_modis: Math.round(index * 0.27),
        n_viirs_snpp: Math.round(index * 0.41),
        n_viirs_jpss1: Math.round(index * 0.32),
        baseline_mean: round(baseline),
        anomaly_pct: round(((index - baseline) / baseline) * 100),
      })
    }
  }

  return series
}

function buildForecast(series: HarmonizedDataPoint[], profile: RegionProfile): LocalForecast {
  const recent = series.slice(-4)
  const forecasts = [1, 2, 3, 4].map((step, index) => {
    const reference = recent[index]?.harmonized_index ?? recent.at(-1)?.harmonized_index ?? 0
    const eased = reference * (1 + profile.recent_anomaly_pct / 100) * (1 - step * 0.04)
    return round(eased)
  })

  return {
    cell_id: profile.id,
    alert_level: profile.alert_level,
    recent_anomaly_pct: profile.recent_anomaly_pct,
    forecast_w1: forecasts[0],
    forecast_w2: forecasts[1],
    forecast_w3: forecasts[2],
    forecast_w4: forecasts[3],
    band_p10_p90: {
      p10: forecasts.map((value) => round(value * 0.78)),
      p90: forecasts.map((value) => round(value * 1.24)),
    },
  }
}

export const regions: RegionDataset[] = PROFILES.map((profile) => {
  const historical_series = buildSeries(profile)
  return {
    id: profile.id,
    region_name: profile.region_name,
    coordinates: { lat_center: profile.lat, lon_center: profile.lon },
    calibration_status: profile.calibration_status,
    historical_series,
    forecast: buildForecast(historical_series, profile),
  }
})

export function regionById(id: string) {
  return regions.find((region) => region.id === id) ?? regions[0]
}

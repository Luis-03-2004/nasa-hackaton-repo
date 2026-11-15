import type { Locale } from '../i18n'
export type Metric = 'records' | 'detections' | 'frp' | 'harmonized'
export type Resolution = 'monthly' | 'yearly' | 'weekly' | 'daily'
export type MapMode = '3d' | '2d' | 'heat3d' | 'heat2d'
export interface Query {
  country: string | null
  point_ids: string[]
  start_date: string
  end_date: string
  months: number[]
  sensors: string[]
  metric: Metric
  resolution: Resolution
  locale: Locale
}
export interface Country { id: string; name: string; first_year?: number; last_year?: number }
export interface Coverage { partial: boolean; effective_start?: string; effective_end?: string; available_sensor_years?: unknown[] }
export interface TimePoint { period: string; value: number | null; sensors: Record<string, number | null> }
export interface Analysis {
  timeseries: TimePoint[]
  calendar: Array<{ year: number; month: number; value: number | null; baseline_mean: number | null; anomaly_pct: number | null; anomaly_zscore: number | null }>
  totals: { value: number | null; records: number; detections: number; frp: number }
  selected_count: number; processed_count: number; missing_count: number
  coverage: Coverage; unit: string; resolution: Resolution; metric: Metric; method: string; notices: string[]; filters: Query
}
export interface MapPoint { point_id: string; lat_center: number; lon_center: number; value: number; country?: string }
export interface MapData { points: MapPoint[]; domain: [number, number]; unit: string; coverage: Coverage; notices: string[]; selected_count?: number }
export interface ForecastMapPoint {
  point_id: string
  lat_center: number
  lon_center: number
  country: string
  observed: number
  h1: number
  h2: number
  h3: number
  h4: number
  baseline_h1: number
  anomaly_pct_h1: number
  mode: 'F2' | 'F0'
}
export interface ForecastSelection {
  available: boolean
  reason?: string
  reference_date: string
  period_end?: string
  telemetry_reference_date?: string
  is_future_cycle?: boolean
  risk_level?: 'NORMAL' | 'ATENCAO' | 'CRITICO' | null
  forecasts: Array<{ horizon: number; value: number; baseline: number; anomaly_pct: number | null; target_date?: string; actual?: number | null }>
  recent_observed?: Array<{ offset: number; period: string; value: number; baseline: number; anomaly_pct: number | null }>
  observed?: number | {
    value: number
    baseline?: number
    anomaly_pct?: number | null
    frp_sum_mw: number
    merged_count: number
    night_count: number
    night_ratio: number | null
    delta_t_k?: number | null
  }
  map_points?: ForecastMapPoint[]
  coverage: { selected_count: number; processed_count: number; missing_count: number; imputed_count: number; f2_count?: number; fallback_count?: number }
  method: string
  validation?: Record<string, unknown> | null
  provenance?: string
  notices?: string[]
}
export interface CalendarDayCell {
  day: number
  date: string
  weekday: number
  value: number | null
  baseline_mean: number | null
  anomaly_pct: number | null
  anomaly_zscore: number | null
}
export interface CalendarMonthData {
  year: number
  month: number
  days_in_month: number
  first_weekday: number
  source: 'exact_daily' | 'weekly_distributed'
  unit: string
  days: CalendarDayCell[]
}

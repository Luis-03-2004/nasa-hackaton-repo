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
export interface ForecastSelection {
  available: boolean
  reason?: string
  reference_date: string
  forecasts: Array<{ horizon: number; value: number; baseline: number; anomaly_pct: number | null; target_date?: string }>
  observed?: number | Record<string, number>
  coverage: { selected_count: number; processed_count: number; missing_count: number; imputed_count: number; f2_count?: number; fallback_count?: number }
  method: string
  validation?: Record<string, unknown> | null
  provenance?: string
  notices?: string[]
}

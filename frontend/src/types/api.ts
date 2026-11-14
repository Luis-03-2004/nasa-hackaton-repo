export interface HarmonizedDataPoint {
  iso_year: number
  iso_week: number
  month?: number
  week_start: string
  harmonized_index: number
  n_modis: number | null
  n_viirs_snpp: number | null
  n_viirs_jpss1: number | null
  baseline_mean: number
  anomaly_pct: number
  anomaly_zscore?: number | null
}

export interface MonthlyCalendarCell {
  year: number
  month: number
  harmonized_1km_cells: number
  clim_mean_2003_2023: number
  anomaly_pct: number
  anomaly_zscore: number | null
}

export interface LocalForecast {
  cell_id: string
  alert_level: 'NORMAL' | 'WATCH' | 'HIGH_ALERT' | 'CRITICAL'
  recent_anomaly_pct: number
  forecast_w1: number
  forecast_w2: number
  forecast_w3: number
  forecast_w4: number
  anomaly_pct: number[]
  band_p10_p90: { p10: number[]; p90: number[] } | null
  reference_year: number
  reference_iso_week: number
  reference_date: string
  drivers: { frp_sum_mw: number; delta_t_k: number; merged_count: number; observed_1km_cells: number }
  validation_scope: string
  validation: { mae: number; corr: number; skill_f2_vs_f0_pct: number }
  provenance: string
}

export interface WorldPoint {
  point_id: string
  lat_center: number
  lon_center: number
  country: string
  zone: string
  ref_year: number
  ref_iso_week: number
  obs_t_1km_cells: number
  obs_t_merged_count: number
  obs_t_frp_sum_mw: number
  obs_t_delta_t_k: number
  pred_h1_1km_cells: number
  pred_h1_anom_pct: number
  risk_level: 'NORMAL' | 'ATENCAO' | 'CRITICO'
}

export interface FireDataResponse {
  region_name: string
  coordinates: { lat_center: number; lon_center: number }
  calibration_status: 'calibrated_local' | 'global_standard'
  historical_series: HarmonizedDataPoint[]
  temporal_resolution: 'monthly'
  monthly_calendar: MonthlyCalendarCell[]
  forecast: LocalForecast | null
  nearest_point?: WorldPoint & { distance_km: number }
  provenance: string
}

export interface FireDataCatalog {
  regions: Array<FireDataResponse & { id: string }>
  provenance: string
}

export interface FireObservation {
  id: number
  latitude: number
  longitude: number
  period_start: string
  satellite: string
  merged_count: number
  frp_sum: number | null
}

export interface AreaResponse {
  features: {
    last_fire: string | null
    observations_total: number
    detections_total: number
    by_satellite: Array<{ satellite: string; observations: number; detections: number }>
  }
  points: FireObservation[]
  truncated: boolean
  limit: number
}

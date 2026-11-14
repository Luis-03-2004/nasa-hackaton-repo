export interface HarmonizedDataPoint {
  iso_year: number
  iso_week: number
  week_start: string
  harmonized_index: number
  n_modis: number
  n_viirs_snpp: number
  n_viirs_jpss1: number
  baseline_mean: number
  anomaly_pct: number
}

export interface LocalForecast {
  cell_id: string
  alert_level: 'NORMAL' | 'ATENCAO' | 'ALERTA_ALTO' | 'CRITICO'
  recent_anomaly_pct: number
  forecast_w1: number
  forecast_w2: number
  forecast_w3: number
  forecast_w4: number
  band_p10_p90: { p10: number[]; p90: number[] }
}

export interface FireDataResponse {
  region_name: string
  coordinates: { lat_center: number; lon_center: number }
  calibration_status: 'calibrated_local' | 'global_standard'
  historical_series: HarmonizedDataPoint[]
  forecast: LocalForecast
}

export interface FireDataCatalog {
  regions: Array<FireDataResponse & { id: string }>
}

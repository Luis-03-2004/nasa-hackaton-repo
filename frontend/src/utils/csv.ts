import type { HarmonizedDataPoint } from '../types/api'

const COLUMNS = [
  'iso_year',
  'iso_week',
  'week_start',
  'harmonized_index',
  'n_modis',
  'n_viirs_snpp',
  'n_viirs_jpss1',
  'baseline_mean',
  'anomaly_pct',
] as const

export function downloadSeriesCsv(filename: string, series: HarmonizedDataPoint[]) {
  const lines = [
    COLUMNS.join(','),
    ...series.map((point) => COLUMNS.map((column) => point[column]).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

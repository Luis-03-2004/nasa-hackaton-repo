import type { HarmonizedDataPoint } from '../types/api'

const COLUMNS = [
  'year', 'month', 'iso_week', 'period_start', 'temporal_resolution',
  'harmonized_1km_cells', 'modis_cells', 'viirs_snpp_cells', 'viirs_jpss1_cells',
  'climatology_mean_2003_2023', 'anomaly_pct', 'anomaly_zscore',
]

export function downloadSeriesCsv(filename: string, series: HarmonizedDataPoint[]) {
  const lines = [
    COLUMNS.join(','),
    ...series.map((point) => [
      point.iso_year,
      point.month ?? Number(point.week_start.slice(5, 7)),
      point.iso_week > 0 ? point.iso_week : '',
      point.week_start,
      point.iso_week > 0 ? 'weekly' : 'monthly',
      point.harmonized_index,
      point.n_modis ?? '', point.n_viirs_snpp ?? '', point.n_viirs_jpss1 ?? '',
      point.baseline_mean, point.anomaly_pct, point.anomaly_zscore ?? '',
    ].join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

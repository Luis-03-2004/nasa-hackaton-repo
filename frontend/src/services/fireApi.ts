import type { AreaResponse, FireDataCatalog, FireDataResponse, WorldPoint } from '../types/api'

const API_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
  })
  if (!response.ok) {
    let detail = ''
    try { const body = await response.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail) } catch { /* status supplies context */ }
    throw new Error(`API ${response.status}: ${detail || 'não foi possível carregar os dados'}`)
  }
  return response.json() as Promise<T>
}

export function fetchFireCatalog(signal?: AbortSignal) {
  return request<FireDataCatalog>('/catalog', signal)
}

export function fetchWorldPoints(signal?: AbortSignal) {
  return request<{ points: WorldPoint[]; provenance: string }>('/world-points', signal)
}

export function fetchLocationForecast(lat: number, lon: number, signal?: AbortSignal) {
  return request<FireDataResponse>(`/forecast/location?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`, signal)
}

export function fetchArea(bounds: [number, number, number, number], month: string, signal?: AbortSignal) {
  const [west, south, east, north] = bounds
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return request<AreaResponse>(`/observations/area?${new URLSearchParams({
    top_left_lat: String(north), top_left_lon: String(west), bottom_right_lat: String(south), bottom_right_lon: String(east),
    start_date: `${month}-01`, end_date: `${month}-${lastDay}`, limit: '100',
  })}`, signal)
}

export function fetchSensorSeries(region: string, year: number, signal?: AbortSignal) {
  return request<{ series: Array<{ month: number; week_start: string; n_modis: number | null; n_viirs_snpp: number | null; n_viirs_jpss1: number | null }>; provenance: string }>(`/observations/region-series?${new URLSearchParams({ region, year: String(year) })}`, signal)
}

export async function postApi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000),
  })
  if (!response.ok) {
    let detail = ''
    try { const data = await response.json(); detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail) } catch { /* Response status gives context. */ }
    throw new Error(`${response.status}: ${detail || 'API request failed'}`)
  }
  return response.json() as Promise<T>
}
export function getApi<T>(path: string, signal?: AbortSignal) { return request<T>(path, signal) }

import { useEffect, useMemo, useState } from 'react'
import type { Hotspot } from '../components/webgl/HotspotMarker'
import { fetchWorldPoints } from '../services/fireApi'
import type { WorldPoint } from '../types/api'

export function useGlobeHotspots() {
  const [points, setPoints] = useState<WorldPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchWorldPoints(controller.signal).then((data) => { setPoints(data.points); setError(null) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Erro ao carregar pontos') })
    return () => controller.abort()
  }, [attempt])
  const hotspots = useMemo<Hotspot[]>(() => points.map((point) => ({
    id: point.point_id, lat: point.lat_center, lon: point.lon_center,
    label: `${point.country.replaceAll('_', ' ')} · ${point.point_id}`,
    color: point.risk_level === 'CRITICO' ? '#ef4444' : point.risk_level === 'ATENCAO' ? '#f59e0b' : '#10b981',
    alertLevel: point.risk_level === 'CRITICO' ? 'CRITICAL' : point.risk_level === 'ATENCAO' ? 'WATCH' : 'NORMAL',
  })), [points])
  return { points, hotspots, error, reload: () => setAttempt((value) => value + 1) }
}

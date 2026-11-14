import { useEffect, useRef, useState } from 'react'
import { fetchArea } from '../../services/fireApi'
import type { AreaResponse } from '../../types/api'
import type { GlobePick } from '../webgl/EarthGlobe'

export function ObservationQuery({ pick, month }: { pick: GlobePick | null; month: string }) {
  const [bounds, setBounds] = useState('')
  const [data, setData] = useState<AreaResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    controller.current?.abort(); setData(null); setLoading(false); setError('')
    if (pick) setBounds([pick.lon - .1, pick.lat - .1, pick.lon + .1, pick.lat + .1].map((v) => v.toFixed(3)).join(', '))
  }, [pick, month])
  useEffect(() => () => controller.current?.abort(), [])
  async function query() {
    controller.current?.abort()
    const values = bounds.split(',').map((v) => Number(v.trim()))
    if (values.length !== 4 || values.some((v) => !Number.isFinite(v)) || bounds.split(',').some((v) => !v.trim())) { setError('Informe oeste, sul, leste, norte separados por vírgula.'); return }
    if (!month) { setError('Selecione um mês para consultar as observações.'); return }
    const next = new AbortController(); controller.current = next
    setLoading(true); setError(''); setData(null)
    try { const result = await fetchArea(values as [number, number, number, number], month, next.signal); if (!next.signal.aborted) setData(result) }
    catch (reason) { if (!next.signal.aborted) setError(reason instanceof Error ? reason.message : 'Erro na consulta') }
    finally { if (!next.signal.aborted) setLoading(false) }
  }
  return <div className="space-y-3 px-4 pb-4 text-xs">
    <p className="text-[#9bb0d1]">Leitura dos Parquet de 1 km. Área máxima: 25 graus²; até 100 registros exibidos. O resumo considera todos os registros da área e mês.</p>
    <form onSubmit={(e) => { e.preventDefault(); void query() }} className="flex flex-wrap gap-2">
      <input aria-label="Área oeste sul leste norte" required value={bounds} onChange={(e) => { controller.current?.abort(); setBounds(e.target.value); setData(null); setLoading(false) }} placeholder="oeste, sul, leste, norte" className="min-w-48 flex-1 rounded-lg border border-white/15 bg-black/20 px-3 py-2 font-mono" />
      <button disabled={loading} className="rounded-lg border border-white/15 px-3 py-2 disabled:opacity-40" type="submit">{loading ? 'Consultando…' : `Consultar ${month || 'mês'}`}</button>
    </form>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {data && <div>
      <p role="status" className="mb-2 font-mono">{data.features.observations_total.toLocaleString('pt-BR')} células-semana/sensor · {data.features.detections_total.toLocaleString('pt-BR')} detecções representadas</p>
      <p className="mb-2 text-[#9bb0d1]">{data.truncated ? 'Resultado truncado para exibição. ' : ''}Sensores preservados; registros de sensores diferentes não são incêndios únicos.</p>
      <div className="max-h-48 overflow-auto"><table className="w-full text-left font-mono"><thead><tr><th>Semana (UTC)</th><th>Sensor</th><th>Lat / Lon</th><th>Detecções</th></tr></thead><tbody>{data.points.map((point) => <tr key={point.id} className="border-t border-white/10"><td className="py-1">{point.period_start}</td><td>{point.satellite}</td><td>{point.latitude.toFixed(2)} / {point.longitude.toFixed(2)}</td><td>{point.merged_count}</td></tr>)}</tbody></table></div>
      {data.points.length === 0 && <p>Nenhum registro encontrado no recorte.</p>}
    </div>}
  </div>
}

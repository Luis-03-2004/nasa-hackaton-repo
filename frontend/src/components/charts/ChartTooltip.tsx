import type { TooltipContentProps } from 'recharts'

export function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload as { anomaly_pct?: number } | undefined
  const rows = payload.filter((item) => item.value != null)

  return (
    <div className="max-w-56 rounded-lg border border-white/10 bg-[#071a3d] px-3 py-2 text-xs shadow-lg">
      <p className="font-mono text-[#9bb0d1]">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((item) => (
          <li key={String(item.dataKey)} className="flex justify-between gap-4 text-[#f7f9fc]">
            <span>{typeof item.name === 'string' ? item.name : String(item.dataKey)}</span>
            <span className="font-mono">{item.value}</span>
          </li>
        ))}
      </ul>
      {typeof row?.anomaly_pct === 'number' ? (
        <p className="mt-1 text-[#ffb0a1]">Anomalia {row.anomaly_pct}%</p>
      ) : null}
      <p className="mt-2 text-[10px] leading-snug text-[#9bb0d1]">
        Contagem de pixels FIRMS. Um pixel não é um incêndio único nem confirma fogo sob nuvem.
      </p>
    </div>
  )
}

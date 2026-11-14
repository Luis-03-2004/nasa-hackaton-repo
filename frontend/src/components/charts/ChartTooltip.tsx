import type { TooltipContentProps } from 'recharts'

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as { anomaly_pct?: number | null } | undefined
  const rows = payload.filter((item) => item.value != null)

  return (
    <div className="max-w-72 rounded-lg border border-white/10 bg-[#071a3d] px-3 py-2 text-xs shadow-lg">
      <p className="font-mono text-[#9bb0d1]">{String(label).slice(0, 7)}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((item) => (
          <li key={String(item.dataKey)} className="flex justify-between gap-4 text-[#f7f9fc]">
            <span>{typeof item.name === 'string' ? item.name : String(item.dataKey)}</span>
            <span className="font-mono">{typeof item.value === 'number' ? number.format(item.value) : String(item.value)}</span>
          </li>
        ))}
      </ul>
      {typeof row?.anomaly_pct === 'number' ? (
        <p className="mt-1 text-[#fdba74]">Anomalia: {number.format(row.anomaly_pct)}%</p>
      ) : null}
      <p className="mt-2 text-[10px] leading-snug text-[#9bb0d1]">
        Índice mensal harmonizado. Uma célula não é um incêndio único.
      </p>
    </div>
  )
}

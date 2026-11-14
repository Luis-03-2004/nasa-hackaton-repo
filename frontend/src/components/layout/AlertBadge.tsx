import type { LocalForecast } from '../../types/api'

const LEVELS: Record<
  LocalForecast['alert_level'],
  { label: string; dot: string; chip: string }
> = {
  NORMAL: {
    label: 'Normal',
    dot: 'bg-[#3dd6f5]',
    chip: 'border-[#3dd6f5]/40 bg-[#3dd6f5]/10 text-[#b7f3ff]',
  },
  ATENCAO: {
    label: 'Atenção',
    dot: 'bg-[#f5b942]',
    chip: 'border-[#f5b942]/40 bg-[#f5b942]/10 text-[#ffe3a3]',
  },
  ALERTA_ALTO: {
    label: 'Alerta alto',
    dot: 'bg-[#ff6a2c]',
    chip: 'border-[#ff6a2c]/50 bg-[#ff6a2c]/15 text-[#ffd0bc]',
  },
  CRITICO: {
    label: 'Janela crítica',
    dot: 'bg-[#ff4d4d]',
    chip: 'border-[#ff4d4d]/50 bg-[#ff4d4d]/15 text-[#ffc7c7]',
  },
}

export function AlertBadge({ level }: { level: LocalForecast['alert_level'] }) {
  const tone = LEVELS[level]

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide uppercase ${tone.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  )
}

import type { LocalForecast } from '../../types/api'

const LEVELS: Record<
  LocalForecast['alert_level'],
  { label: string; dot: string; chip: string }
> = {
  NORMAL: {
    label: 'Normal',
    dot: 'bg-[#6ea2ff]',
    chip: 'border-[#6ea2ff]/40 bg-[#0b3d91]/40 text-[#d6e6ff]',
  },
  WATCH: {
    label: 'Watch',
    dot: 'bg-white',
    chip: 'border-white/40 bg-white/10 text-white',
  },
  HIGH_ALERT: {
    label: 'High alert',
    dot: 'bg-[#fc3d21]',
    chip: 'border-[#fc3d21]/60 bg-[#fc3d21]/15 text-[#ffd4cc]',
  },
  CRITICAL: {
    label: 'Critical window',
    dot: 'bg-white',
    chip: 'border-[#fc3d21] bg-[#fc3d21] text-white',
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

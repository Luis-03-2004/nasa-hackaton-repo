import type { ReactNode } from 'react'
import { InfoToggle } from './InfoToggle'
import { useI18n } from '../../i18n'

export function Panel({ eyebrow, title, action, info, children, className = '' }: {
  eyebrow: string; title: string; action?: ReactNode; info?: ReactNode; children: ReactNode; className?: string
}) {
  const { t } = useI18n()
  return <section className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0F1623] ${className}`}>
    <header className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-[10px] tracking-[0.14em] text-slate-400 uppercase">{eyebrow}</p><h2 className="mt-1 text-sm font-semibold text-white">{title}</h2></div>{action}</div>
      {info && <InfoToggle label={`${t('Informações', 'Information')}: ${title}`}>{info}</InfoToggle>}
    </header>
    <div className="min-h-0 min-w-0 flex-1">{children}</div>
  </section>
}

import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'

export function InfoToggle({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const { t } = useI18n()
  return <div className="min-w-0">
    <button type="button" aria-label={label ?? t('Informações', 'Information')} aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)} className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${open ? 'border-orange-300 bg-orange-400/15 text-orange-200' : 'border-slate-500/50 text-slate-300 hover:border-orange-300'}`}><span aria-hidden="true">i</span></button>
    <div id={id} hidden={!open} className="mt-2 rounded-lg border border-slate-700 bg-[#0b1220] p-3 text-xs leading-relaxed text-slate-300">{children}</div>
  </div>
}

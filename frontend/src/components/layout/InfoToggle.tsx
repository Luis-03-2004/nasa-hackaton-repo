import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
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

export function MetricInfo({
  term,
  children,
  align = 'left',
}: {
  term: string
  children: ReactNode
  align?: 'left' | 'right' | 'center'
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setPinned(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setPinned(false)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const posClass =
    align === 'right'
      ? 'right-0'
      : align === 'center'
        ? 'left-1/2 -translate-x-1/2'
        : 'left-0'

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label={`${t('Explicação sobre', 'Explanation for')} ${term}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          event.stopPropagation()
          if (pinned) {
            setPinned(false)
            setOpen(false)
          } else {
            setPinned(true)
            setOpen(true)
          }
        }}
        className={`ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-mono font-bold leading-none transition ${
          open
            ? 'border-orange-400 bg-orange-500/25 text-orange-200 shadow-sm'
            : 'border-slate-500/60 bg-slate-900/80 text-slate-300 hover:border-orange-300 hover:text-orange-200'
        }`}
        title={`${term} — ${t('clique ou passe o mouse para detalhes', 'click or hover for details')}`}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          onClick={(event) => event.stopPropagation()}
          className={` absolute top-full z-50 mt-1.5 w-72 max-w-[85vw] rounded-xl border border-orange-500/40 bg-[#080f1d]/95 p-3 text-left font-sans text-xs font-normal normal-case tracking-normal leading-relaxed text-slate-200 shadow-2xl backdrop-blur-md ${posClass}`}
        >
          <span className="mb-1 flex items-center justify-between gap-2 border-b border-slate-800 pb-1 font-semibold text-orange-200">
            <span>{term}</span>
            {pinned && (
              <span
                role="button"
                tabIndex={0}
                onClick={() => {
                  setPinned(false)
                  setOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setPinned(false)
                    setOpen(false)
                  }
                }}
                className="cursor-pointer rounded px-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </span>
            )}
          </span>
          <span className="block text-[11px] leading-relaxed text-slate-300">{children}</span>
        </span>
      )}
    </span>
  )
}

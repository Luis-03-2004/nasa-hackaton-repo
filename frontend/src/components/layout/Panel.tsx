import type { ReactNode } from 'react'

export function Panel({
  eyebrow,
  title,
  action,
  children,
  className = 'min-h-[340px]',
}: {
  eyebrow: string
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#071a3a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}
    >
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-[#9bb0d1] uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-sm font-semibold tracking-tight text-white">{title}</h2>
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

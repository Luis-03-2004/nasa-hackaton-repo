import type { ReactNode } from 'react'

export function Panel({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex h-full min-h-[340px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121826]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-[#93a4bd] uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-sm font-semibold tracking-tight text-[#f4f7fb]">{title}</h2>
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

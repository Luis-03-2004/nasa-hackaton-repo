import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'pt-BR' | 'en'
interface I18n {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (pt: string, en: string) => string
  number: (value: number, options?: Intl.NumberFormatOptions) => string
  date: (value: string, options?: Intl.DateTimeFormatOptions) => string
}
const Context = createContext<I18n | null>(null)
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try { return localStorage.getItem('firecal.locale') === 'en' ? 'en' : 'pt-BR' } catch { return 'pt-BR' }
  })
  useEffect(() => {
    document.documentElement.lang = locale
    try { localStorage.setItem('firecal.locale', locale) } catch { /* Browser storage may be disabled. */ }
  }, [locale])
  const value = useMemo<I18n>(() => ({
    locale, setLocale,
    t: (pt, en) => locale === 'pt-BR' ? pt : en,
    number: (value, options) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...options }).format(value),
    date: (value, options) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)),
  }), [locale])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useI18n() {
  const context = useContext(Context)
  if (!context) throw new Error('I18nProvider is required')
  return context
}
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n()
  return <label className="flex items-center gap-2 text-xs text-slate-300">
    <span>{t('Idioma', 'Language')}</span>
    <select aria-label={t('Idioma', 'Language')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)} className="rounded-lg border border-white/15 bg-[#0f1623] px-2 py-2 text-white">
      <option value="pt-BR">PT-BR</option><option value="en">EN</option>
    </select>
  </label>
}

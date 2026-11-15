import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { postApi } from '../../services/fireApi'
import type { Query } from '../../types/exploration'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
  tools_used?: string[]
}

interface ChatResponse {
  reply: string
  model: string
  blocked: boolean
  intent?: string
  tools_used?: string[]
}

function renderMarkdownLine(line: string, index: number) {
  const formatInline = (text: string) => {
    const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return tokens.map((tok, idx) => {
      if (tok.startsWith('**') && tok.endsWith('**')) {
        return <strong key={idx} className="font-semibold text-white">{tok.slice(2, -2)}</strong>
      }
      if (tok.startsWith('`') && tok.endsWith('`')) {
        return <code key={idx} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-amber-200">{tok.slice(1, -1)}</code>
      }
      return tok
    })
  }

  const trimmed = line.trim()
  if (!trimmed) return <div key={index} className="h-1.5" />
  if (trimmed === '---') return <hr key={index} className="my-2 border-white/10" />
  if (trimmed.startsWith('### ')) {
    return <h4 key={index} className="mt-2 font-semibold text-amber-300 text-xs">{formatInline(trimmed.slice(4))}</h4>
  }
  if (trimmed.startsWith('## ')) {
    return <h3 key={index} className="mt-2 font-semibold text-white text-xs">{formatInline(trimmed.slice(3))}</h3>
  }
  if (trimmed.startsWith('> ')) {
    return <blockquote key={index} className="border-l-2 border-amber-400/50 pl-2 text-[11px] text-slate-300 italic">{formatInline(trimmed.slice(2))}</blockquote>
  }
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return <li key={index} className="ml-4 list-disc text-slate-200 leading-relaxed">{formatInline(trimmed.slice(2))}</li>
  }
  return <p key={index} className="text-slate-200 leading-relaxed">{formatInline(line)}</p>
}

export function ChatAssistant({
  query,
  referenceDate,
  focus,
  onCoordinate,
}: {
  query: Query
  referenceDate: string
  focus: { lat: number; lon: number } | null
  onCoordinate?: (lat: number, lon: number, isGps?: boolean) => void
}) {
  const { locale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [gpsNotice, setGpsNotice] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  async function sendQuestion(customText?: string, overrideCoords?: { lat: number; lon: number }) {
    const question = (customText ?? input).trim()
    if (!question || loading) return
    if (!customText) setInput('')

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: question }]
    setMessages(nextMessages)
    setLoading(true)

    const activeUserCoords = overrideCoords ?? userCoords
    try {
      const response = await postApi<ChatResponse>('/chat', {
        message: question,
        history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        ui_context: {
          country: query.country,
          point_ids: query.point_ids.slice(0, 500),
          start_date: query.start_date,
          end_date: query.end_date,
          reference_date: referenceDate,
          metric: query.metric,
          resolution: query.resolution,
          focus_lat: focus?.lat ?? null,
          focus_lon: focus?.lon ?? null,
          user_lat: activeUserCoords?.lat ?? null,
          user_lon: activeUserCoords?.lon ?? null,
        },
        locale,
      })

      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: response.reply,
          model: response.model,
          tools_used: response.tools_used,
        },
      ])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('Falha ao consultar o assistente.', 'Failed to query the assistant.')
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: `⚠️ ${msg}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function requestUserGps() {
    if (!navigator.geolocation) {
      setGpsNotice(t('Geolocalização não suportada neste navegador.', 'Geolocation is not supported in this browser.'))
      return
    }
    setGpsLoading(true)
    setGpsNotice('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(4)),
          lon: Number(pos.coords.longitude.toFixed(4)),
        }
        setUserCoords(coords)
        setGpsLoading(false)
        setGpsNotice(t(`GPS ativo: (${coords.lat}, ${coords.lon})`, `GPS active: (${coords.lat}, ${coords.lon})`))
        onCoordinate?.(coords.lat, coords.lon, true)
        void sendQuestion(
          t(
            `Como está a minha região na coordenada ${coords.lat}, ${coords.lon}?`,
            `How is my region at coordinate ${coords.lat}, ${coords.lon}?`,
          ),
          coords,
        )
      },
      () => {
        setGpsLoading(false)
        setGpsNotice(
          t(
            'Permissão de GPS negada. Você pode digitar sua coordenada (ex: -12.5, -46.2) diretamente no chat.',
            'GPS permission denied. You can type your coordinates (e.g. -12.5, -46.2) directly in the chat.',
          ),
        )
      },
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  const quickPrompts = [
    t('Resumo de queimadas dos últimos 7 dias no Brasil', 'Fire summary for the last 7 days in Brazil'),
    t('Como interpretar os gráficos e o modelo F₂?', 'How to interpret the charts and F₂ model?'),
    t('O que acontece na coordenada -12.5, -46.2?', 'What happens at coordinate -12.5, -46.2?'),
    t('Como filtrar área e exportar CSV?', 'How to filter an area and export CSV?'),
  ]

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end">
      {open && (
        <section
          aria-label={t('Assistente BAT', 'BAT Assistant')}
          className="mb-3 flex h-[540px] max-h-[82vh] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0B1220]/95 shadow-2xl backdrop-blur-md md:w-[430px]"
        >
          {/* Cabeçalho */}
          <header className="flex items-center justify-between border-b border-white/10 bg-[#0F172A] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-orange-400" />
                <h2 className="font-semibold text-sm text-white">
                  {t('Assistente BAT', 'BAT Assistant')}
                </h2>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                {t('Brightness Anomaly Tracker · 2000–2025', 'Brightness Anomaly Tracker · 2000–2025')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('Fechar assistente', 'Close assistant')}
              className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
            >
              ✕
            </button>
          </header>

          {/* Barra de GPS / Minha Região */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3.5 py-2 text-[11px]">
            <button
              type="button"
              onClick={requestUserGps}
              disabled={gpsLoading || loading}
              className="flex items-center gap-1.5 rounded-lg border border-orange-400/40 bg-orange-500/10 px-2.5 py-1 font-medium text-orange-200 hover:bg-orange-500/20 disabled:opacity-50"
            >
              <span>📍</span>
              <span>
                {gpsLoading
                  ? t('Obtendo GPS…', 'Getting GPS…')
                  : t('Analisar minha região (GPS)', 'Analyze my region (GPS)')}
              </span>
            </button>
            {userCoords && (
              <span className="font-mono text-[10px] text-emerald-300">
                {userCoords.lat}, {userCoords.lon}
              </span>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="text-[11px] text-slate-400 hover:text-white"
              >
                {t('Limpar', 'Clear')}
              </button>
            )}
          </div>
          {gpsNotice && (
            <p className="border-b border-white/10 bg-amber-500/10 px-3.5 py-1.5 text-[11px] text-amber-200">
              {gpsNotice}
            </p>
          )}

          {/* Lista de mensagens */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-xs">
            {messages.length === 0 && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-slate-200 leading-relaxed">
                  {t(
                    'Olá! Sou o assistente do BAT (Brightness Anomaly Tracker, 2000–2025). Posso explicar os gráficos, ensinar a usar as ferramentas ou consultar dados reais por país, período, coordenada (x, y) ou sua localização.',
                    'Hello! I am the BAT (Brightness Anomaly Tracker, 2000–2025) assistant. I can explain charts, guide you through the tools, or query real records by country, period, coordinates (x, y), or your location.',
                  )}
                </p>
                <div className="space-y-1.5">
                  <p className="font-mono text-[10px] text-slate-400 uppercase">
                    {t('Sugestões rápidas:', 'Quick suggestions:')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendQuestion(prompt)}
                        className="rounded-lg border border-white/15 bg-[#0F1623] px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-orange-400/50 hover:bg-white/10"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] space-y-1 rounded-2xl px-3.5 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-[#fc3d21]/90 text-white'
                      : 'border border-white/10 bg-[#131C2E] text-slate-100'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-1">
                      {msg.content.split('\n').map((line, lineIdx) => renderMarkdownLine(line, lineIdx))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#131C2E] px-3 py-2 text-xs text-slate-300">
                <span className="h-2 w-2 animate-ping rounded-full bg-orange-400" />
                <span>{t('Consultando base científica e gerando resposta…', 'Querying scientific database and generating response…')}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input de envio */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void sendQuestion()
            }}
            className="flex items-center gap-2 border-t border-white/10 bg-[#0F172A] p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t(
                'Pergunte sobre gráficos, Brasil, coord -12,-46…',
                'Ask about charts, Brazil, coord -12,-46…',
              )}
              maxLength={600}
              disabled={loading}
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#070b12] px-3 py-2 text-xs text-white placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-[#fc3d21] px-3.5 py-2 font-semibold text-xs text-white hover:bg-[#e0351b] disabled:opacity-40"
            >
              {t('Enviar', 'Send')}
            </button>
          </form>
        </section>
      )}

      {/* Botão flutuante de abrir/fechar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-orange-400/40 bg-[#0F172A] px-4 py-2.5 font-semibold text-xs text-white shadow-xl hover:bg-[#16223b]"
      >
        <span className="flex h-2.5 w-2.5 rounded-full bg-[#fc3d21]" />
        <span>{open ? t('Fechar Assistente', 'Close Assistant') : t('Assistente IA BAT', 'BAT AI Assistant')}</span>
      </button>
    </div>
  )
}

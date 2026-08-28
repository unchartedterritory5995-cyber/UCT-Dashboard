import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import CompassOrb from '../../../components/voice/CompassOrb'
import VoiceInputButton from '../../journal-2-0/components/VoiceInputButton'
import ShareToFloor from '../../../components/community/ShareToFloor'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import { mergeBasicWidgetSettings, basicWidgetStyleVars, basicDefaultsForTheme, isLegacyBasicLightDefault } from './basicWidgetSettings'
import { resolveGlobalPrefSettings, tagAppTheme } from '../../../components/chart/chartThemes'
import styles from './AiSearchWidget.module.css'

const AIS_SETTINGS_KEY = 'aisearch_settings'

// Saved answers persist per-browser so a member can reopen a good answer later.
const SAVED_KEY = 'uct.aisearch.saved'
const loadSaved = () => {
  try { const a = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); return Array.isArray(a) ? a : [] }
  catch { return [] }
}
const persistSaved = (list) => {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 30))) } catch { /* quota/full — non-fatal */ }
}

// Plain-text answer (link syntax + bold stripped) for copy / Floor-share teasers.
const plainAnswer = (a) => String(a || '')
  .replace(/\[([^\]]+)\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)/g, '$1')
  .replace(/\*\*/g, '')

// Anonymous per-widget-session id for de-identified conversation threading in the
// capture log — random, NOT tied to the user. Minted once per mounted widget.
const newConversationId = () => {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { /* older browsers */ }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// Best-effort quality signal (save/share/copy) on an answer, joined by its stable
// answer_id. Fire-and-forget — never blocks or surfaces an error to the member.
const emitSignal = (answerId, kind) => {
  if (!answerId) return
  try {
    fetch('/api/ai-search/signal', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_id: answerId, kind }),
    }).catch(() => {})
  } catch { /* noop */ }
}

// Server-side saved answers (cross-device; the localStorage list stays as the
// offline cache). Fire-and-forget both ways — saving must never block reading.
const serverSaveAnswer = (item) => {
  if (!item?.answerId) return
  try {
    fetch('/api/ai-search/saved', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_id: item.answerId, q: item.q, answer: item.answer,
                             citations: item.citations || [], personal: !!item.personal }),
    }).catch(() => {})
  } catch { /* noop */ }
}
const serverUnsaveAnswer = (answerId) => {
  if (!answerId) return
  try {
    fetch(`/api/ai-search/saved/${encodeURIComponent(answerId)}`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {})
  } catch { /* noop */ }
}

// Handoff seam: a frozen journal embed (or any other surface) can drop a thread
// here and navigate to /ai-search, which picks it up as the live conversation.
export const AIS_HANDOFF_KEY = 'uct.aisearch.handoff'

// Human labels for the backend's grounding source keys (the "grounded on" chips).
const GROUNDING_LABELS = {
  quote: 'Live quote', regime: 'Regime', catalyst: 'Catalyst', tape: 'Tape',
  patterns: 'Patterns', flow: 'Options flow', fundamentals: 'Fundamentals',
  analyst: 'Analyst', insider: 'Insider', earnings_deep: 'Earnings intel',
  call_recap: 'Call recap', posture: 'Technicals', verdict: 'Desk verdict',
  levels: 'Levels', playbook: 'UCT playbook', news_ticker: 'News',
  movers: 'Movers', breadth: 'Breadth', earnings: 'Earnings today',
  uct20: 'UCT20', candidates: 'Scanner', news: 'Headlines',
  wire: 'Exposure dial', sector: 'Sectors', cot: 'COT',
  // agent-lane tool names (the intents list carries what the agent called)
  agent: 'Desk agent', web_search: 'Web',
  get_quote: 'Live quote', get_regime: 'Regime', get_breadth: 'Breadth',
  get_movers: 'Movers', find_patterns_on_ticker: 'Patterns',
  grade_ticker: 'Desk verdict', ask_the_brain: 'UCT playbook',
  get_earnings_intel: 'Earnings intel', get_options_flow: 'Options flow',
  get_short_interest: 'Short interest', get_sector_strength: 'Sectors',
  get_bar_summary: 'Chart read', get_polygon_news: 'News',
  get_scanner_candidates: 'Scanner', get_fundamentals: 'Fundamentals',
  get_insider_activity: 'Insider',
}
const groundingChips = (g) => {
  if (!g) return []
  const keys = [...(g.sources || []), ...(g.intents || [])]
  const out = []
  for (const k of keys) {
    const label = GROUNDING_LABELS[k] || null
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}

// ── Inline sparklines under the newest answer: 30 daily closes per mentioned
// ticker (max 3), tiny SVG, colored by the 30-day change. Session-cached so a
// re-render or thread restore never refetches. Silent on any failure.
const _sparkCache = new Map()
async function fetchSparkCloses(sym) {
  if (_sparkCache.has(sym)) return _sparkCache.get(sym)
  const p = fetch(`/api/bars/${encodeURIComponent(sym)}?tf=D&bars=30`, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const bars = Array.isArray(d?.bars) ? d.bars : (Array.isArray(d) ? d : [])
      const closes = bars.map((b) => Number(b?.c ?? b?.close)).filter(Number.isFinite)
      return closes.length >= 2 ? closes : null
    })
    .catch(() => null)
  _sparkCache.set(sym, p)
  // Cache successes only: a transient failure (deploy-swap 502, network blip)
  // must not suppress this ticker's sparkline for the whole browser session.
  p.then((res) => { if (res == null) _sparkCache.delete(sym) })
  return p
}

function Sparkline({ closes }) {
  const w = 64, h = 20
  const min = Math.min(...closes), max = Math.max(...closes)
  const span = max - min || 1
  const pts = closes.map((c, i) => `${(i / (closes.length - 1)) * w},${h - 2 - ((c - min) / span) * (h - 4)}`).join(' ')
  const up = closes[closes.length - 1] >= closes[0]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="1.4"
        stroke={up ? 'var(--gain, #4ade80)' : 'var(--loss, #f87171)'} strokeLinejoin="round" />
    </svg>
  )
}

function AnswerSparklines({ tickers, onTicker }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    let live = true
    Promise.all(tickers.slice(0, 3).map(async (t) => {
      const closes = await fetchSparkCloses(t)
      if (!closes) return null
      const pct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
      return { sym: t, closes, pct }
    })).then((r) => { if (live) setRows(r.filter(Boolean)) })
    return () => { live = false }
  }, [tickers.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null
  return (
    <div className={styles.sparkRow}>
      {rows.map((r) => (
        <button key={r.sym} type="button" className={styles.sparkItem}
          onClick={() => onTicker(r.sym)} title={`Open ${r.sym} on the chart`}>
          <span className={styles.sparkSym}>{r.sym}</span>
          <Sparkline closes={r.closes} />
          <span style={{ color: r.pct < 0 ? 'var(--loss)' : 'var(--gain)', fontWeight: 600 }}>
            {r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%
          </span>
        </button>
      ))}
      <span className={styles.sparkNote}>30d</span>
    </div>
  )
}

// Tickers mentioned in an answer (link form + bare cashtag), first few, deduped.
const extractTickers = (text) => {
  const out = []
  const re = /\[[^\]]+\]\(\$([A-Za-z][A-Za-z.\-]{0,6})\)|\$([A-Z]{1,5}(?:\.[A-Z])?)\b/g
  let m
  while ((m = re.exec(String(text || '')))) {
    const t = (m[1] || m[2] || '').toUpperCase()
    if (t && !out.includes(t)) out.push(t)
  }
  return out.slice(0, 6)
}

// Spread across the tool's real range so the first impression isn't "it only
// tells me why a stock moved": live movers, head-to-head compare, setup/levels
// (patterns grounding), an earnings recap, a sympathy list, and market breadth.
const EXAMPLES = [
  'Why is SMCI moving today?',
  'Compare NVDA vs AMD as swing setups',
  'Is TSLA extended or setting up here?',
  "What was JPM's last earnings like?",
  'Best sympathy stocks for NBIS',
  "How's market breadth today?",
]

// AI icon — the Compass brand orb (sized wrapper; CompassOrb fills its container).
// state='thinking' spins the bearing ring while a search is in flight.
function Spark({ size = 15, state = 'idle' }) {
  return (
    <span style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }} aria-hidden="true">
      <CompassOrb state={state} />
    </span>
  )
}

// Rotating status lines so a 5-10s Perplexity search never looks hung.
const SEARCH_PHASES = [
  'Searching the markets…',
  'Reading sources…',
  'Cross-checking the numbers…',
  'Writing it up…',
]

// Splits inline text into: [Label]($TICKER) links, bare $TICKERS, **bold**, and ±pct%.
// Everything else is plain text. Ticker/name links + bare cashtags render as gold
// clickable buttons; percentages use the chart-matched gain/loss colors.
const RICH_RE = /(\[[^\]]+\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)|\$[A-Z]{1,5}(?:\.[A-Z])?\b|\*\*[^*]+\*\*|[+-]\d+(?:\.\d+)?%|\[\d{1,2}\])/g

function renderRich(text, onTicker, cites) {
  const src = String(text || '')
  const parts = src.split(RICH_RE)
  return parts.map((p, i) => {
    if (!p) return null
    // [Display]($TICKER) — company name OR ticker, clickable, ticker explicit
    let m = /^\[([^\]]+)\]\(\$([A-Za-z][A-Za-z.\-]{0,6})\)$/.exec(p)
    if (m) {
      const tk = m[2].toUpperCase()
      return (
        <button key={i} type="button" className={styles.ticker} title={`Open ${tk} on the chart`} onClick={() => onTicker(tk)}>
          {m[1]}
        </button>
      )
    }
    // bare $TICKER cashtag
    m = /^\$([A-Z]{1,5}(?:\.[A-Z])?)$/.exec(p)
    if (m) {
      const tk = m[1]
      return (
        <button key={i} type="button" className={styles.ticker} title={`Open ${tk} on the chart`} onClick={() => onTicker(tk)}>
          {tk}
        </button>
      )
    }
    // [n] citation marker → superscript link to that source
    m = /^\[(\d{1,2})\]$/.exec(p)
    if (m) {
      const n = parseInt(m[1], 10)
      const src = Array.isArray(cites) ? cites[n - 1] : null
      const url = typeof src === 'string' ? src : (src?.url || '')
      if (url) {
        return (
          <a key={i} className={styles.cite} href={url} target="_blank" rel="noreferrer" title={url}>{n}</a>
        )
      }
      return <span key={i}>{p}</span>
    }
    // **bold** — recurse so tickers / ±pct / [n] cites nested INSIDE a bold span
    // still render as links/colors instead of leaking raw [Label]($SYM) markdown.
    // The system prompt asks for a bolded lead line with bolded tickers, so this
    // is the most common answer shape. Inner text has no '*' (RICH_RE's [^*]+),
    // so the recursion can't re-enter this branch.
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{renderRich(p.slice(2, -2), onTicker, cites)}</strong>
    // ±pct — chart-matched green/red (widget CSS overrides --gain/--loss to chart colors)
    if (/^[+-]\d+(?:\.\d+)?%$/.test(p)) {
      return <span key={i} style={{ color: p[0] === '-' ? 'var(--loss)' : 'var(--gain)', fontWeight: 600 }}>{p}</span>
    }
    return <span key={i}>{p}</span>
  })
}

// Exported: the Deep Research panel renders finished reports with the same
// subset renderer (headers/bullets/bold/tickers/[n] cites) so the two surfaces
// can never drift on what answer markdown means.
export function AnswerBody({ text, onTicker, cites }) {
  const lines = String(text || '').split('\n')
  return (
    <>
      {lines.map((ln, i) => {
        const t = ln.trim()
        if (!t) return <div key={i} className={styles.gap} />
        // "## Section" markdown headers (Perplexity emits them on longer answers)
        if (/^#{1,4}\s+/.test(t)) {
          return (
            <div key={i} className={styles.subhead}>
              {renderRich(t.replace(/^#{1,4}\s+/, ''), onTicker, cites)}
            </div>
          )
        }
        const bullet = /^[-*•]\s+/.test(t)
        const body = bullet ? t.replace(/^[-*•]\s+/, '') : t
        return (
          <div key={i} className={bullet ? styles.bullet : styles.para}>
            {bullet && <span className={styles.dot}>•</span>}
            <span>{renderRich(body, onTicker, cites)}</span>
          </div>
        )
      })}
    </>
  )
}

// One-tap confirm for a server-proposed action. The server NEVER auto-creates
// — this button is the member's consent, posting to the existing alerts API.
function ProposalChip({ proposal }) {
  const [state, setState] = useState('idle')   // idle | busy | done | error
  const [detail, setDetail] = useState(null)   // server's actionable refusal reason
  if (!proposal) return null
  // deep_briefing rides the same briefings API — it is a briefing row whose
  // cadence is weekly_deep (a Sunday Deep Research report, not a text brief)
  const isDeep = proposal.kind === 'deep_briefing'
  const isBriefing = proposal.kind === 'briefing' || isDeep
  if (!isBriefing && proposal.kind !== 'price_alert') return null
  const label = isDeep
    ? `Schedule weekly deep report${proposal.sym ? `: ${proposal.sym}` : ''}`
    : isBriefing
      ? `Schedule ${proposal.cadence === 'postmarket' ? 'closing' : 'morning'} brief${proposal.sym ? `: ${proposal.sym}` : ''}`
      : `Set alert: ${proposal.sym} ${proposal.direction} $${proposal.price}`
  const confirm = () => {
    setState('busy')
    const req = isBriefing
      ? fetch('/api/ai-search/briefings', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: proposal.query, sym: proposal.sym,
                                 cadence: proposal.cadence }),
        })
      : fetch('/api/watchlist-alerts', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sym: proposal.sym, target_price: proposal.price,
                                 direction: proposal.direction }),
        })
    try {
      Promise.resolve(req)
        .then(async (r) => {
          if (r?.ok) {
            setState('done')
            if (isBriefing) {
              // the My-briefings rail lives on /ai-search — tell it to refresh
              try { window.dispatchEvent(new Event('ais:briefings-changed')) } catch { /* noop */ }
            }
            return
          }
          // the server's 422 reason is actionable ("capped at 3 — pause one
          // first") — a bare Retry that can never succeed is a dead end
          const d = await r?.json?.().catch(() => null)
          setDetail(d?.detail || null)
          setState('error')
        })
        .catch(() => setState('error'))
    } catch { setState('error') }
  }
  if (state === 'done') {
    return (
      <span className={styles.proposalDone}>
        <UIcon name="check" size={11} /> {isDeep
          ? 'Deep report scheduled — every Sunday'
          : isBriefing
            ? `Briefing scheduled — every ${proposal.cadence === 'postmarket' ? 'close' : 'morning'}`
            : `Alert set — ${proposal.sym} ${proposal.direction} $${proposal.price}`}
      </span>
    )
  }
  return (
    <button type="button" className={styles.proposalBtn} onClick={confirm}
      disabled={state === 'busy'}
      title={isDeep
        ? 'Schedule a full Deep Research report every Sunday (you get an alert when each one is ready)'
        : isBriefing
          ? 'Schedule this as a standing brief (delivered via bell, email and Discord)'
          : 'Create this price alert (delivered via bell, email and Discord per your settings)'}>
      <UIcon name={isBriefing ? 'clock' : 'bell'} size={11} /> {state === 'error' ? (detail || `Retry — ${label}`) : label}
    </button>
  )
}

// Read an answer aloud with the browser's own voice — zero backend, and the
// same accessibility door the transcript player already opens elsewhere.
const ttsAvailable = () => {
  try { return typeof window !== 'undefined' && !!window.speechSynthesis } catch { return false }
}

// One completed Q/A turn in the conversation thread. Follow-ups + the compliance
// line render only on the latest turn (isLast) so a long thread stays clean.
function Exchange({ entry, isLast, onTicker, onCopy, copied, onSave, isSaved, onFollow, readOnly = false, speakingId = null, onSpeak = null }) {
  const chips = groundingChips(entry.grounding)
  return (
    <div className={styles.exchange}>
      <div className={styles.qLabel}>
        <span className={styles.askedText}>{entry.q}</span>
      </div>
      {entry.stale && (
        <div className={styles.outageNote}>
          Live web search is down — this is the most recent saved answer to this question.
        </div>
      )}
      {entry.degraded && (
        <div className={styles.outageNote}>
          Live web search is down — answered from UCT desk data only.
        </div>
      )}
      <div className={styles.answerText}>
        <AnswerBody text={entry.answer} onTicker={onTicker} cites={entry.citations} />
      </div>

      {/* Sparklines are the "click a bar to open the chart" affordance — skip
          them on a restored answer (no live turn happened this session) so
          reopening a saved answer or a journal handoff doesn't fetch 30-day
          bars for every ticker in old prose. */}
      {isLast && !readOnly && entry.answerId && (
        <AnswerSparklines tickers={extractTickers(entry.answer)} onTicker={onTicker} />
      )}

      {chips.length > 0 && (
        <div className={styles.chipsRow}>
          <span className={styles.chipsLabel}>Grounded on</span>
          {chips.map((c) => <span key={c} className={styles.chip}>{c}</span>)}
        </div>
      )}

      {isLast && !readOnly && <ProposalChip proposal={entry.proposal} />}

      <div className={styles.answerActions}>
        <button className={styles.actionBtn} onClick={() => onCopy(entry)} title="Copy answer text">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        {onSpeak && ttsAvailable() && (
          <button className={styles.actionBtn} onClick={() => onSpeak(entry)}
            title={speakingId === entry.id ? 'Stop reading' : 'Read this answer aloud'}>
            {speakingId === entry.id ? 'Stop' : 'Listen'}
          </button>
        )}
        {!readOnly && (
          <button className={styles.actionBtn} onClick={() => onSave(entry)} title="Save this answer (reopen it later)">
            {isSaved ? 'Saved ✓' : 'Save'}
          </button>
        )}
        {/* Personal answers (position-aware) are never eligible for community
            sharing — they're grounded in the member's own book, not a public take. */}
        {!readOnly && !entry.personal && (
          <ShareToFloor
            compact
            label="Share"
            card={{ kind: 'ai', q: entry.q, a: plainAnswer(entry.answer), tickers: extractTickers(entry.answer) }}
            onShared={() => emitSignal(entry.answerId, 'share')}
          />
        )}
      </div>

      {!readOnly && isLast && entry.related?.length > 0 && (
        <div className={styles.followups}>
          <span className={styles.followLabel}>Follow-ups</span>
          <div className={styles.followList}>
            {entry.related.map((q) => (
              <button key={q} className={styles.follow} onClick={() => onFollow(q)}>
                <span className={styles.followArrow}>↳</span>{q}
              </button>
            ))}
          </div>
        </div>
      )}

      {entry.citations?.length > 0 && (
        <div className={styles.citations}>
          <span className={styles.citLabel}>Sources</span>
          <div className={styles.citList}>
            {entry.citations.map((c, i) => {
              const url = typeof c === 'string' ? c : (c?.url || '')
              if (!url) return null
              let host = url
              try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
              return (
                <a key={i} className={styles.cit} href={url} target="_blank" rel="noreferrer" title={url}>
                  <span className={styles.citNum}>{i + 1}</span>{host}
                </a>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * `scope` — narrow this widget to ONE company (the earnings modal's Ask AI
 * section). `{sym, suggestions}`: the empty state names the company and offers
 * `suggestions` instead of the general EXAMPLES, and the ask box says so too.
 * The ENDPOINT is unchanged — scoping is what we ask FOR, not what we allow.
 *
 * `chrome` — false strips the ⚙ appearance panel and the saved-answers list.
 * Both are charts-workspace furniture: the gear edits a WIDGET canvas colour,
 * which is meaningless inside a modal that paints its own surface.
 *
 * Both default to today's behaviour, so /charts and /ai-search are untouched by
 * construction — `AiSearchWidget.test.jsx` pins that with a no-props render.
 */
export default function AiSearchWidget({
  initialQuery = null, color = null, onTicker = null,
  scope = null, chrome = true,
  initialThread = null, onThread = null,
  // Frozen-embed mode (journal host): the restored conversation is EVIDENCE —
  // no ask bar, no new paid queries from inside a note.
  readOnly = false,
  // Continue an existing SERVER thread (the /ai-search history page restoring a
  // past conversation) — new turns persist under the same thread id instead of
  // forking a duplicate. Null = mint a fresh anonymous id (default behavior).
  threadId = null,
}) {
  const { aiSearchBus, setGroupSym } = useWorkspace()
  const scopeSym = scope?.sym ? String(scope.sym).toUpperCase() : null
  const scopeExamples = Array.isArray(scope?.suggestions) ? scope.suggestions : null

  // ── Basic appearance settings (⚙): canvas + text. Uncustomized → the DEFAULTS
  // FOR THE CURRENT APP THEME (light → white canvas + dark text). ──
  const { prefs, setPref } = usePreferences()
  const placedTheme = usePlacedTheme()
  const aisSettings = useMemo(
    () => {
      // Ignore the stale legacy white/black auto-default so the widget follows the
      // app theme (dark on OLED) like the sibling widgets; genuine picks are kept.
      const saved = parsePref(prefs?.[AIS_SETTINGS_KEY], null)
      const eff = isLegacyBasicLightDefault(saved) ? null : saved
      return mergeBasicWidgetSettings(resolveGlobalPrefSettings(eff, placedTheme, basicDefaultsForTheme))
    },
    [prefs, placedTheme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  // ── Send this conversation to the Journal (the capture door — shared flow:
  // last-active note → inbox fallback). The THREAD is the frozen params;
  // AiSearchEmbed replays it read-only. Hidden until an answer exists and in
  // readOnly (an embed offering the door is circular). ──
  const [journalMsg, setJournalMsg] = useJournalToast()
  const gearRef = useRef(null)
  const rootRef = useRef(null)
  const rootStyle = useMemo(() => {
    const v = basicWidgetStyleVars(aisSettings)
    return v['--basic-canvas'] ? { ...v, background: v['--basic-canvas'] } : v
  }, [aisSettings])
  const patchSettings = useCallback((patch) => setPref(AIS_SETTINGS_KEY, JSON.stringify(tagAppTheme({ ...aisSettings, ...patch }, placedTheme))), [aisSettings, setPref, placedTheme])
  const resetSettings = useCallback(() => setPref(AIS_SETTINGS_KEY, JSON.stringify(basicDefaultsForTheme(placedTheme))), [setPref, prefs])
  const menuVars = useMemo(() => {
    const canvas = aisSettings.bgMode === 'gradient' ? (aisSettings.bgGradient?.top || aisSettings.bg) : aisSettings.bg
    return menuThemeVars(canvas) || {}
  }, [aisSettings])

  // Clicking a ticker/company name in an answer loads it on the chart linked to
  // THIS widget's color group (or a caller-supplied handler, e.g. the temp popup).
  const handleTicker = useCallback((tk) => {
    if (!tk) return
    if (onTicker) { onTicker(tk); return }
    if (color && setGroupSym) setGroupSym(color, tk)
  }, [onTicker, color, setGroupSym])

  const [query, setQuery] = useState('')
  // Conversation thread: every completed {id, q, answer, citations, related}
  // exchange this session, oldest → newest. The widget shows the whole thread so
  // a member can scroll back through the conversation, not just the last answer.
  // `initialThread` restores a conversation this widget produced EARLIER (the
  // earnings modal unmounts inactive panels, so leaving Ask AI and coming back
  // is a remount). Read ONCE at mount: the restored turns are the widget's own
  // output in the widget's own shape, never re-derived by the caller.
  const [thread, setThread] = useState(() => (Array.isArray(initialThread) ? initialThread : []))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [limitMsg, setLimitMsg] = useState(null)
  const [phase, setPhase] = useState(0)
  const [copiedId, setCopiedId] = useState(null)
  const [speakingId, setSpeakingId] = useState(null)   // answer being read aloud
  const [saved, setSaved] = useState(loadSaved)   // answers pinned to localStorage (+ server sync)
  const [savedOpen, setSavedOpen] = useState(false)   // saved list visible mid-thread
  const [pending, setPending] = useState(null)   // question in flight (shown at the tail)
  const [streamText, setStreamText] = useState('')   // partial answer while streaming
  const [deep, setDeep] = useState(false)   // reasoning tier — longer silent think phase
  const [quota, setQuota] = useState(null)   // {used, limit} — today's research budget
  const [agentActivity, setAgentActivity] = useState(null)   // "checking grade_ticker — NVDA…"
  // Mode picker: Auto (routed by phrasing) → Deep (sonar reasoning tier) →
  // Agent (the desk's tool-calling brain). Cycles on tap; persisted per-browser
  // (migrates the old boolean deep toggle).
  const [askMode, setAskMode] = useState(() => {
    try {
      const m = localStorage.getItem('uct.aisearch.mode')
      // a stored value — 'auto' included — is authoritative; the legacy deep
      // key only fills in when the new key has never been written
      if (m === 'auto' || m === 'reasoning' || m === 'agent') return m
      const legacy = localStorage.getItem('uct.aisearch.deep') === '1'
      try { localStorage.removeItem('uct.aisearch.deep') } catch { /* noop */ }
      const migrated = legacy ? 'reasoning' : 'auto'
      try { localStorage.setItem('uct.aisearch.mode', migrated) } catch { /* noop */ }
      return migrated
    } catch { return 'auto' }
  })
  const cycleAskMode = useCallback(() => {
    setAskMode((cur) => {
      const next = cur === 'auto' ? 'reasoning' : (cur === 'reasoning' ? 'agent' : 'auto')
      try { localStorage.setItem('uct.aisearch.mode', next) } catch { /* noop */ }
      return next
    })
  }, [])
  const askModeRef = useRef(askMode)
  askModeRef.current = askMode
  const [personalPending, setPersonalPending] = useState(false)   // branch entered a personal (position-aware) answer — shown before the final payload confirms it
  const inputRef = useRef(null)
  const bodyRef = useRef(null)
  // threadRef mirrors `thread` so run()/tryStream (stable callbacks) always read
  // the current turns without stale closures; idRef gives each turn a stable key.
  const threadRef = useRef(Array.isArray(initialThread) ? initialThread : [])
  // Seed PAST the restored turns' ids — `++idRef.current` from 0 against a
  // restored thread would hand turn 5 the key React already has on turn 1.
  const idRef = useRef(threadRef.current.reduce((m, e) => Math.max(m, e?.id || 0), 0))
  // Conversation memory sent with each ask (derived from threadRef at send time)
  // so follow-ups can resolve "it"/"that move". Never drives rendering.
  const historyRef = useRef([])
  // In-flight AbortController so a member can Stop a long (reasoning) search;
  // stoppedRef distinguishes a user cancel from a network error so we don't fall
  // back to the single-shot endpoint after an intentional stop.
  const abortRef = useRef(null)
  const stoppedRef = useRef(false)
  // Anonymous conversation threading for the capture log (not identity): a random
  // per-session id + a turn counter, sent with each ask. Never rendered.
  // ⛔ TWO ids, TWO lanes, NEVER shared (2026-08-28 review): conversationIdRef
  // goes to the DE-IDENTIFIED capture log with every ask and must stay random —
  // seeding it from a member-keyed thread id (or reusing it as one) would make
  // ai_search_log JOIN-able back to a user, defeating the HMAC bucket design.
  // persistIdRef keys the member-consented thread store and MAY be seeded from
  // a restored thread so continuing doesn't fork a duplicate conversation.
  const conversationIdRef = useRef(newConversationId())
  const persistIdRef = useRef(threadId || newConversationId())
  const turnRef = useRef(0)
  // Persist only conversations the member actually ASKED in this session — a
  // restored saved answer or a journal handoff must not mint junk thread rows.
  const askedRef = useRef(false)

  // Rotate the loading status line so a long search reads as progress, not a hang.
  useEffect(() => {
    if (!loading) { setPhase(0); return undefined }
    const t = setInterval(() => setPhase((p) => (p + 1) % SEARCH_PHASES.length), 2400)
    return () => clearInterval(t)
  }, [loading])

  // Chat-style autoscroll: follow the newest turn while it streams in.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [pending, streamText, thread])

  // Hand the finished thread back to a caller that wants to restore it later.
  // Deliberately an EFFECT on `thread` rather than a call beside each
  // `setThread`: there are two mutation sites today and a third added later
  // would silently stop notifying. One authority, derived from the state that
  // actually rendered. The ref keeps the effect off the caller's prop identity.
  const onThreadRef = useRef(onThread)
  onThreadRef.current = onThread
  useEffect(() => { onThreadRef.current?.(thread) }, [thread])

  // Auto-grow the ask box so a long question stays fully visible while typing
  // (caps at ~4 lines, then scrolls inside the box). Empty stays single-line —
  // Chrome counts the WRAPPED placeholder in scrollHeight, which would balloon
  // the idle row in a narrow widget.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = query ? `${Math.min(el.scrollHeight, 92)}px` : ''
  }, [query])

  const applyFinal = useCallback((question, d) => {
    const entry = {
      id: ++idRef.current,
      q: question,
      answer: d.answer || '',
      answerId: d.answer_id || null,   // stable server id → join save/share/pin signals
      citations: Array.isArray(d.citations) ? d.citations : [],
      related: Array.isArray(d.related_questions) ? d.related_questions.slice(0, 3) : [],
      personal: !!d.personal,   // position-aware answer — gates ShareToFloor + the retention disclaimer
      grounding: d.grounding || null,   // which desk feeds grounded this answer (chips)
      stale: !!d.stale,         // outage: last-known-good served, clearly labeled
      degraded: !!d.degraded,   // outage: desk-data-only synthesis, clearly labeled
      proposal: d.proposal || null,   // one-tap action ("set alert NVDA above 190")
    }
    if (d.quota && Number.isFinite(d.quota.used)) setQuota(d.quota)
    askedRef.current = true   // a LIVE turn — this conversation may persist now
    threadRef.current = [...threadRef.current, entry]
    setThread(threadRef.current)
    setCopiedId(null)
  }, [])

  // Streaming path: POST /api/ai-search/stream and render tokens as they
  // arrive. Returns 'done' | 'limit' | null (null → caller falls back to the
  // single-shot endpoint).
  const tryStream = useCallback(async (question, signal) => {
    // One retry on a transient 5xx (Railway/Cloudflare blip) before falling
    // back to the single-shot endpoint — the audit saw ~4% transient 502s
    // under load that succeeded immediately on retry.
    const payload = JSON.stringify({
      query: question, history: historyRef.current,
      conversation_id: conversationIdRef.current, turn_index: turnRef.current,
      ...(askModeRef.current !== 'auto' ? { mode: askModeRef.current } : {}),   // Deep / Agent
    })
    let r = await fetch('/api/ai-search/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal,
    })
    if (r.status >= 502 && r.status <= 504) {
      await new Promise((res) => setTimeout(res, 400))
      r = await fetch('/api/ai-search/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal,
      })
    }
    if (r.status === 429) {
      const d = await r.json().catch(() => null)
      setLimitMsg(d?.detail || "You've hit today's research limit — it resets at midnight ET.")
      return 'limit'
    }
    if (!r.ok || !r.body?.getReader) return null
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let text = ''
    let final = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2)
        const line = block.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let ev
        try { ev = JSON.parse(line.slice(5)) } catch { continue }
        if (ev.type === 'activity' && ev.text) {
          setAgentActivity(ev.text)
        } else if (ev.type === 'meta') {
          // reasoning tier goes silent through its (stripped) think phase —
          // tell the member it's a deeper pass so the wait doesn't read as hung.
          if (ev.mode === 'reasoning') setDeep(true)
          if (ev.mode === 'agent') setAgentActivity('the desk agent is picking its tools…')
          // backend entered the personal (position-aware) branch — swap the
          // waiting line before the final payload confirms it.
          if (ev.personal) setPersonalPending(true)
        } else if (ev.type === 'delta' && ev.text) {
          text += ev.text
          setStreamText(text)
        } else if (ev.type === 'final') {
          final = ev
        } else if (ev.type === 'error') {
          return null   // backend says fall back
        }
      }
    }
    if (!final || final.error) return null
    applyFinal(question, final)
    return 'done'
  }, [applyFinal])

  // Submitting appends a new turn to the thread: the question shows at the tail
  // with the answer streaming beneath it, the input clears for the next ask, and
  // every earlier turn stays on screen (scroll back through the conversation).
  // `pending`/`streamText` render the in-flight turn; a failed ask restores the
  // question to the input.
  const run = useCallback(async (q) => {
    const question = (q ?? query).trim()
    if (!question || loading) return
    // Conversation memory = the last 3 completed turns (reference resolution,
    // not a full transcript). Sent with both the stream and single-shot calls.
    historyRef.current = threadRef.current.slice(-3).map((e) => ({ q: e.q, a: String(e.answer || '').slice(0, 1200) }))
    turnRef.current += 1   // this ask's turn index (anon threading for the log)
    stoppedRef.current = false
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null); setLimitMsg(null); setPending(question); setQuery(''); setStreamText(''); setDeep(false); setPersonalPending(false); setAgentActivity(null)
    try {
      let outcome = null
      try {
        outcome = await tryStream(question, ctrl.signal)
      } catch (e) {
        // A user-pressed Stop aborts the fetch — restore the question, don't
        // fall back to single-shot (the member wanted to cancel).
        if (stoppedRef.current || e?.name === 'AbortError') { setQuery(question); return }
        outcome = null   // network/parse hiccup → single-shot fallback
      }
      if (outcome === 'limit') { setQuery(question); return }
      if (outcome === 'done') return
      if (stoppedRef.current) { setQuery(question); return }
      // stream died mid-run — clear its transient status flags so the
      // single-shot fallback shows the rotating phrases, not a stale
      // "running the desk verdict…" line for 30 seconds
      setAgentActivity(null); setDeep(false); setPersonalPending(false)

      const singleShot = () => fetch('/api/ai-search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: question, history: historyRef.current,
          conversation_id: conversationIdRef.current, turn_index: turnRef.current,
          ...(askModeRef.current !== 'auto' ? { mode: askModeRef.current } : {}),
        }),
        signal: ctrl.signal,
      })
      let r = await singleShot()
      if (r.status >= 502 && r.status <= 504) {   // retry once on a transient blip
        await new Promise((res) => setTimeout(res, 400))
        if (stoppedRef.current) { setQuery(question); return }
        r = await singleShot()
      }
      const d = await r.json().catch(() => null)
      if (r.status === 429) {
        setLimitMsg(d?.detail || "You've hit today's research limit — it resets at midnight ET.")
        setQuery(question)   // give the question back so it isn't lost
        return
      }
      if (!r.ok) throw new Error(d?.detail || `Request failed (${r.status})`)
      if (!d || d.error) throw new Error(d?.error || 'No answer')
      applyFinal(question, d)
    } catch (e) {
      if (stoppedRef.current || e?.name === 'AbortError') { setQuery(question); return }
      setError(e.message || 'Something went wrong')
      setQuery(question)   // restore for a one-keystroke retry
    } finally {
      setLoading(false)
      setPending(null)
      setStreamText('')
      setAgentActivity(null)
      abortRef.current = null
    }
  }, [query, loading, tryStream, applyFinal])

  // Stop the in-flight search (long reasoning passes especially). Marks the
  // cancel so run() restores the question instead of falling back or erroring.
  const stop = useCallback(() => {
    stoppedRef.current = true
    try { abortRef.current?.abort() } catch { /* already settled */ }
  }, [])

  // Follow-ups run directly; keep focus in the (bottom) ask box for the next one.
  const askFollowUp = (q) => { run(q); inputRef.current?.focus() }

  // Read-aloud: browser speechSynthesis, one answer at a time, toggles off on
  // a second tap. speechSynthesis is a BROWSER-GLOBAL queue — the unmount
  // cleanup cancels only when THIS widget owns the active utterance (a ref,
  // because the []-dep cleanup closure would only ever see the initial state),
  // so closing widget B never cuts widget A (or Compass) off mid-sentence.
  const speakingIdRef = useRef(null)
  const speakExchange = useCallback((entry) => {
    try {
      const synth = window.speechSynthesis
      if (!synth) return
      if (speakingId === entry.id) {
        synth.cancel(); setSpeakingId(null); speakingIdRef.current = null; return
      }
      synth.cancel()
      const u = new SpeechSynthesisUtterance(plainAnswer(entry.answer))
      const clear = () => {
        setSpeakingId((cur) => (cur === entry.id ? null : cur))
        if (speakingIdRef.current === entry.id) speakingIdRef.current = null
      }
      u.onend = clear
      u.onerror = clear
      setSpeakingId(entry.id)
      speakingIdRef.current = entry.id
      synth.speak(u)
    } catch { /* noop */ }
  }, [speakingId])
  useEffect(() => () => {
    try { if (speakingIdRef.current != null) window.speechSynthesis?.cancel() } catch { /* noop */ }
  }, [])

  const copyExchange = useCallback((entry) => {
    // Strip the [Label]($TICKER) link syntax and bold markers for a clean paste.
    const plain = String(entry?.answer || '')
      .replace(/\[([^\]]+)\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)/g, '$1')
      .replace(/\*\*/g, '')
    navigator.clipboard?.writeText(plain)
      .then(() => { setCopiedId(entry.id); setTimeout(() => setCopiedId(null), 1600); emitSignal(entry.answerId, 'copy') })
      .catch(() => { /* clipboard unavailable — button just doesn't confirm */ })
  }, [])

  // Save / unsave an answer to localStorage (keyed by question) so a member can
  // reopen it in a later session; restore drops the saved turn back into the thread.
  // A new save also emits a best-effort 'save' quality signal (joined by answerId).
  const toggleSave = useCallback((entry) => {
    setSaved((prev) => {
      const exists = prev.some((s) => s.q === entry.q)
      if (!exists) emitSignal(entry.answerId, 'save')
      // answerId rides along (was dropped before 2026-08-28) so a restored turn
      // keeps its signal join AND the save syncs server-side for cross-device.
      const item = { q: entry.q, answer: entry.answer, citations: entry.citations || [],
                     related: entry.related || [], personal: !!entry.personal,
                     answerId: entry.answerId || null }
      const next = exists
        ? prev.filter((s) => s.q !== entry.q)
        : [item, ...prev].slice(0, 30)
      if (exists) {
        const gone = prev.find((s) => s.q === entry.q)
        serverUnsaveAnswer(gone?.answerId || entry.answerId)
      } else {
        serverSaveAnswer(item)
      }
      persistSaved(next)
      return next
    })
  }, [])
  const restoreSaved = useCallback((item) => {
    const entry = { id: ++idRef.current, q: item.q, answer: item.answer || '',
                    citations: item.citations || [], related: item.related || [],
                    personal: !!item.personal, answerId: item.answerId || null }
    threadRef.current = [...threadRef.current, entry]
    setThread(threadRef.current)
    setSavedOpen(false)
  }, [])
  const removeSaved = useCallback((item) => {
    setSaved((prev) => {
      // Delete EVERY server row for this question (stale duplicates included)
      // so the delete sticks across devices instead of resurrecting on reload.
      prev.filter((s) => s.q === item.q && s.answerId).forEach((s) => serverUnsaveAnswer(s.answerId))
      if (item.answerId && !prev.some((s) => s.answerId === item.answerId)) serverUnsaveAnswer(item.answerId)
      const next = prev.filter((s) => s.q !== item.q)
      persistSaved(next)
      return next
    })
  }, [])

  // Cross-device saved answers: hydrate from the server once per mount and merge
  // over the localStorage cache (server wins on the same question). Best-effort.
  useEffect(() => {
    if (!chrome || readOnly) return
    let live = true
    try {
      Promise.resolve(fetch('/api/ai-search/saved', { credentials: 'include' }))
        .then((r) => (r?.ok ? r.json() : null))
        .then((d) => {
          if (!live || !Array.isArray(d?.saved)) return
          const server = d.saved.map((s) => ({
            q: s.q || '', answer: s.answer || '', citations: s.citations || [],
            related: [], personal: !!s.personal, answerId: s.answer_id || null,
          })).filter((s) => s.answer)
          setSaved((prev) => {
            // Dedupe server rows by question (list is newest-first; keep the
            // first) — duplicate q's under different answer_ids rendered twin
            // rows with duplicate React keys that resurrected after delete.
            const seen = new Set()
            const uniq = server.filter((s) => (seen.has(s.q) ? false : (seen.add(s.q), true)))
            const next = [...uniq, ...prev.filter((p) => !seen.has(p.q))].slice(0, 30)
            persistSaved(next)
            return next
          })
        })
        .catch(() => {})
    } catch { /* fetch stubbed out (tests) — localStorage cache stands alone */ }
    return () => { live = false }
  }, [chrome, readOnly])

  // Conversations survive a refresh: after each finished turn, persist the whole
  // thread server-side (debounced; replace semantics — idempotent). The thread id
  // is the same per-mount conversation id the capture log threads on.
  const persistTimerRef = useRef(null)
  useEffect(() => {
    // Gates: never in readOnly; never for a thread with no LIVE ask this
    // session (askedRef — restored/handoff content must not mint junk rows);
    // chrome=false persists ONLY for the scoped earnings modal (its surface
    // tag exists so those conversations survive a refresh too).
    if ((!chrome && !scopeSym) || readOnly || thread.length === 0 || !askedRef.current) return undefined
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      try {
        fetch('/api/ai-search/threads', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thread_id: persistIdRef.current,   // member lane — NEVER the capture-log id
            surface: scopeSym ? `modal:${scopeSym}` : 'widget',
            turns: thread.slice(-10).map((e) => ({
              q: e.q, a: e.answer, citations: e.citations || [],
              personal: !!e.personal,
            })),
          }),
        }).catch(() => {})
      } catch { /* noop */ }
    }, 800)
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current) }
  }, [thread, chrome, readOnly, scopeSym])

  // Register with the workspace AI bus so a chart's "AI search" action runs here,
  // and auto-run an initialQuery (used by the temp popup + /ai-search?q= deep-link).
  // runRef keeps the subscription stable while always calling the latest run.
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!aiSearchBus?.subscribe) return undefined
    return aiSearchBus.subscribe((q) => { runRef.current(q) })
  }, [aiSearchBus])
  useEffect(() => {
    if (initialQuery) runRef.current(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() }
  }

  const empty = thread.length === 0 && !loading && !error && !limitMsg

  // `rootStyle` carries the ⚙ appearance settings — a WIDGET's canvas and text
  // colour. With the gear hidden those are unreachable settings being applied
  // anyway, and they would repaint a host surface the reader never chose, so the
  // bare variant takes the ambient theme instead.
  return (
    <div
      className={`${styles.root}${chrome ? '' : ` ${styles.rootBare}`}`}
      ref={rootRef}
      style={chrome ? rootStyle : undefined}
    >
      {chrome && settingsOpen && (
        <NewsSettingsPanel
          title="AI Search Settings"
          widgetType="aisearch"
          showPerf={false}
          settings={aisSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}
      {chrome && !readOnly && thread.length > 0 && (
        <button
          type="button"
          className={styles.gearBtn}
          style={{ right: 30 }}
          onClick={async () => {
            setJournalMsg('sending…')
            setJournalMsg(await sendCaptureToJournal('aisearch', { thread: thread.slice(-10), settings: aisSettings },
              { label: thread[thread.length - 1]?.q ? `"${String(thread[thread.length - 1].q).slice(0, 32)}"` : 'AI answer' }))
          }}
          title="Send this conversation to Journal"
          aria-label="Send this conversation to Journal"
        ><UIcon name="journal" size={13} /></button>
      )}
      <JournalToast msg={journalMsg} style={{ top: 26, right: 6 }} />
      {chrome && (
        <button
          ref={gearRef}
          type="button"
          className={styles.gearBtn}
          onClick={() => setSettingsOpen(o => !o)}
          title="AI Search settings"
          aria-label="AI Search settings"
        ><UIcon name="gear" size={13} /></button>
      )}
      {/* Saved answers used to vanish the moment a thread existed (empty-state
          only) — exactly when a member wants to pull one up for comparison. */}
      {chrome && !readOnly && saved.length > 0 && thread.length > 0 && (
        <button
          type="button"
          className={styles.gearBtn}
          style={{ right: 54 }}
          onClick={() => setSavedOpen((o) => !o)}
          title="Saved answers"
          aria-label="Saved answers"
        ><UIcon name="pin" size={13} /></button>
      )}
      <div className={styles.body} ref={bodyRef}>
        {chrome && savedOpen && !empty && saved.length > 0 && (
          <div className={styles.savedWrap}>
            <span className={styles.savedLabel}>Saved answers</span>
            <div className={styles.savedList}>
              {saved.map((s) => (
                <div key={s.answerId || s.q} className={styles.savedRow}>
                  <button className={styles.savedItem} onClick={() => restoreSaved(s)} title="Reopen this answer">{s.q}</button>
                  <button className={styles.savedDel} onClick={() => removeSaved(s)} title="Remove from saved">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {empty && (
          <div className={styles.empty}>
            <span className={styles.emptySpark}><Spark size={34} /></span>
            <div className={styles.emptyTitle}>
              {scopeSym ? `Ask AI about ${scopeSym}` : 'Ask the markets anything'}
            </div>
            <div className={styles.emptySub}>
              {scopeSym
                ? 'What do you want to know?'
                : 'Earnings recaps, sympathy plays, catalysts, comparables — cited, current.'}
            </div>
            <div className={styles.exampleWrap}>
              {(scopeExamples || EXAMPLES).map((ex) => (
                <button key={ex} className={styles.example} onClick={() => run(ex)}>{ex}</button>
              ))}
            </div>
            {chrome && saved.length > 0 && (
              <div className={styles.savedWrap}>
                <span className={styles.savedLabel}>Saved answers</span>
                <div className={styles.savedList}>
                  {saved.map((s) => (
                    <div key={s.answerId || s.q} className={styles.savedRow}>
                      <button className={styles.savedItem} onClick={() => restoreSaved(s)} title="Reopen this answer">{s.q}</button>
                      <button className={styles.savedDel} onClick={() => removeSaved(s)} title="Remove from saved">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {thread.map((entry, i) => (
          <Exchange
            key={entry.id}
            entry={entry}
            isLast={i === thread.length - 1 && !loading}
            onTicker={handleTicker}
            onCopy={copyExchange}
            copied={copiedId === entry.id}
            onSave={toggleSave}
            isSaved={saved.some((s) => s.q === entry.q)}
            onFollow={askFollowUp}
            readOnly={readOnly}
            speakingId={speakingId}
            onSpeak={speakExchange}
          />
        ))}

        {loading && (
          <div className={styles.exchange}>
            {pending && (
              <div className={styles.qLabel}><span className={styles.askedText}>{pending}</span></div>
            )}
            {streamText ? (
              <div className={styles.answerText}>
                <AnswerBody text={streamText} onTicker={handleTicker} cites={[]} />
              </div>
            ) : (
              <div className={styles.status}>
                <span className={styles.spinner} /> {personalPending
                  ? 'Checking your positions and the desk read…'
                  : (agentActivity || (deep ? 'Reasoning through this — a deeper pass, ~20-30s…' : SEARCH_PHASES[phase]))}
              </div>
            )}
          </div>
        )}

        {!loading && error && (
          <div className={styles.error}>
            {error}
            <button type="button" className={styles.retryBtn} onClick={() => run()}
              disabled={!query.trim()} title="Ask the restored question again">
              Retry
            </button>
          </div>
        )}
        {!loading && limitMsg && <div className={styles.limit}>{limitMsg}</div>}

        {/* Retention disclaimer is FALSE for a personal (position-aware) turn —
            those questions are never logged/retained de-identified — so it's
            gated on the latest turn's personal flag, not shown blanket. */}
        {thread.length > 0 && !thread[thread.length - 1]?.personal && (
          <div className={styles.disclaimer}>
            AI-generated research — verify before trading. Questions are retained de-identified to improve the research desk.
          </div>
        )}
      </div>

      {/* Ask bar pinned at the BOTTOM (chat layout): after reading an answer the
          follow-up input is right here — no scrolling back up to continue.
          Hidden in readOnly (frozen embed) — the thread is evidence. */}
      {!readOnly && (
      <div className={styles.searchRow}>
        <span className={styles.spark}><Spark state={loading ? 'thinking' : 'idle'} /></span>
        <textarea
          ref={inputRef}
          className={styles.input}
          placeholder={thread.length > 0
            ? 'Ask a follow-up…'
            : (scopeSym ? `Ask anything about ${scopeSym}…` : 'Ask anything about the markets…')}
          aria-label={scopeSym ? `Ask anything about ${scopeSym}` : 'Ask anything about the markets'}
          value={query}
          rows={1}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && !loading && (
          <button className="btn btn-ghost btn-sm" title="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>✕</button>
        )}
        {/* Dictate into the ask box (paid — Whisper; renders null for free users). */}
        <VoiceInputButton
          disabled={loading}
          onTranscript={(t) => {
            const add = String(t || '').trim()
            if (!add) return
            setQuery((q) => (q ? `${q} ${add}` : add))
            inputRef.current?.focus()
          }}
        />
        <button
          type="button"
          className={`${styles.deepToggle}${askMode !== 'auto' ? ` ${styles.deepToggleOn}` : ''}`}
          onClick={cycleAskMode}
          title={askMode === 'agent'
            ? 'Agent mode — the desk brain picks its own tools (live data + web, 2 units). Tap to cycle.'
            : askMode === 'reasoning'
              ? 'Deep mode — slower reasoning pass (2 units). Tap to cycle.'
              : 'Auto mode — routed by phrasing. Tap for Deep, then Agent.'}
          aria-label="Ask mode"
        >{askMode === 'agent' ? 'Agent' : askMode === 'reasoning' ? 'Deep' : 'Auto'}</button>
        {loading ? (
          <button className={styles.stopBtn} onClick={stop} title="Stop this search" aria-label="Stop search">
            <span className={styles.stopSquare} aria-hidden="true" />Stop
          </button>
        ) : (
          <button className={styles.askBtn} onClick={() => run()} disabled={!query.trim()}>Ask</button>
        )}
        {quota && quota.limit > 0 && (
          <span className={styles.quotaNote} title="Today's research budget (resets midnight ET)">
            {quota.used}/{quota.limit}
          </span>
        )}
      </div>
      )}
      {readOnly && thread.length > 0 && (
        <div className={styles.continueRow}>
          <button
            type="button"
            className={styles.continueBtn}
            onClick={() => {
              try { localStorage.setItem(AIS_HANDOFF_KEY, JSON.stringify(thread.slice(-10))) } catch { /* noop */ }
              window.location.href = '/ai-search'
            }}
            title="Reopen this conversation live in AI Search"
          >Continue in AI Search →</button>
        </div>
      )}
    </div>
  )
}

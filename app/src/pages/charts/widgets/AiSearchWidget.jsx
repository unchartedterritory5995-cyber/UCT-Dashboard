import { useState, useCallback, useRef, useEffect } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import CompassOrb from '../../../components/voice/CompassOrb'
import styles from './AiSearchWidget.module.css'

const EXAMPLES = [
  "What was JPM's last earnings report like?",
  'Best sympathy stocks for NBIS?',
  'Why is SMCI moving today?',
  'Recent analyst upgrades on NVDA',
]

// AI icon — the Compass brand orb (sized wrapper; CompassOrb fills its container).
function Spark({ size = 15 }) {
  return (
    <span style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }} aria-hidden="true">
      <CompassOrb />
    </span>
  )
}

// Splits inline text into: [Label]($TICKER) links, bare $TICKERS, **bold**, and ±pct%.
// Everything else is plain text. Ticker/name links + bare cashtags render as gold
// clickable buttons; percentages use the chart-matched gain/loss colors.
const RICH_RE = /(\[[^\]]+\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)|\$[A-Z]{1,5}(?:\.[A-Z])?\b|\*\*[^*]+\*\*|[+-]\d+(?:\.\d+)?%)/g

function renderRich(text, onTicker) {
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
    // **bold**
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
    // ±pct — chart-matched green/red (widget CSS overrides --gain/--loss to chart colors)
    if (/^[+-]\d+(?:\.\d+)?%$/.test(p)) {
      return <span key={i} style={{ color: p[0] === '-' ? 'var(--loss)' : 'var(--gain)', fontWeight: 600 }}>{p}</span>
    }
    return <span key={i}>{p}</span>
  })
}

function AnswerBody({ text, onTicker }) {
  const lines = String(text || '').split('\n')
  return (
    <>
      {lines.map((ln, i) => {
        const t = ln.trim()
        if (!t) return <div key={i} className={styles.gap} />
        const bullet = /^[-*•]\s+/.test(t)
        const body = bullet ? t.replace(/^[-*•]\s+/, '') : t
        return (
          <div key={i} className={bullet ? styles.bullet : styles.para}>
            {bullet && <span className={styles.dot}>•</span>}
            <span>{renderRich(body, onTicker)}</span>
          </div>
        )
      })}
    </>
  )
}

export default function AiSearchWidget({ initialQuery = null, color = null, onTicker = null }) {
  const { aiSearchBus, setGroupSym } = useWorkspace()

  // Clicking a ticker/company name in an answer loads it on the chart linked to
  // THIS widget's color group (or a caller-supplied handler, e.g. the temp popup).
  const handleTicker = useCallback((tk) => {
    if (!tk) return
    if (onTicker) { onTicker(tk); return }
    if (color && setGroupSym) setGroupSym(color, tk)
  }, [onTicker, color, setGroupSym])

  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState(null)
  const [citations, setCitations] = useState([])
  const [related, setRelated] = useState([])
  const [asked, setAsked] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const run = useCallback(async (q) => {
    const question = (q ?? query).trim()
    if (!question || loading) return
    setLoading(true); setError(null); setAnswer(null); setCitations([]); setRelated([]); setAsked(question)
    try {
      const r = await fetch('/api/ai-search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.detail || `Request failed (${r.status})`)
      if (!d || d.error) throw new Error(d?.error || 'No answer')
      setAnswer(d.answer || '')
      setCitations(Array.isArray(d.citations) ? d.citations : [])
      setRelated(Array.isArray(d.related_questions) ? d.related_questions.slice(0, 3) : [])
    } catch (e) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [query, loading])

  const askFollowUp = (q) => { setQuery(q); run(q) }

  // Register with the workspace AI bus so a chart's "AI search" action runs here,
  // and auto-run an initialQuery (used by the temporary popup). runRef keeps the
  // subscription stable while always calling the latest run.
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!aiSearchBus?.subscribe) return undefined
    return aiSearchBus.subscribe((q) => { setQuery(q); runRef.current(q) })
  }, [aiSearchBus])
  useEffect(() => {
    if (initialQuery) runRef.current(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() }
  }

  return (
    <div className={styles.root}>
      <div className={styles.searchRow}>
        <span className={styles.spark}><Spark /></span>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="Ask anything about the markets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && !loading && (
          <button className={styles.clearBtn} title="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>✕</button>
        )}
        <button className={styles.askBtn} onClick={() => run()} disabled={loading || !query.trim()}>
          {loading ? <span className={styles.spinner} /> : 'Ask'}
        </button>
      </div>

      <div className={styles.body}>
        {loading && (
          <div className={styles.status}>
            <span className={styles.spinner} /> Searching the markets…
          </div>
        )}
        {!loading && error && <div className={styles.error}>{error}</div>}

        {!loading && !error && answer == null && (
          <div className={styles.empty}>
            <span className={styles.emptySpark}><Spark size={34} /></span>
            <div className={styles.emptyTitle}>Ask the markets anything</div>
            <div className={styles.emptySub}>Earnings recaps, sympathy plays, catalysts, comparables — cited, current.</div>
            <div className={styles.exampleWrap}>
              {EXAMPLES.map((ex) => (
                <button key={ex} className={styles.example} onClick={() => { setQuery(ex); run(ex) }}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {!loading && !error && answer != null && (
          <div className={styles.answer}>
            {asked && <div className={styles.asked}>{asked}</div>}
            <div className={styles.answerText}><AnswerBody text={answer} onTicker={handleTicker} /></div>

            {related.length > 0 && (
              <div className={styles.followups}>
                <span className={styles.followLabel}>Follow-ups</span>
                <div className={styles.followList}>
                  {related.map((q) => (
                    <button key={q} className={styles.follow} onClick={() => askFollowUp(q)}>
                      <span className={styles.followArrow}>↳</span>{q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {citations.length > 0 && (
              <div className={styles.citations}>
                <span className={styles.citLabel}>Sources</span>
                <div className={styles.citList}>
                  {citations.map((c, i) => {
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
        )}
      </div>
    </div>
  )
}

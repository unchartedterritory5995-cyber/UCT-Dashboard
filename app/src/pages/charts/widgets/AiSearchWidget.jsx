import { useState, useCallback, useRef, useEffect } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import CompassOrb from '../../../components/voice/CompassOrb'
import styles from './AiSearchWidget.module.css'

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

function AnswerBody({ text, onTicker, cites }) {
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
  const [limitMsg, setLimitMsg] = useState(null)
  const [phase, setPhase] = useState(0)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(null)   // question in flight (shown in the body)
  const [streamText, setStreamText] = useState('')   // partial answer while streaming
  const [deep, setDeep] = useState(false)   // reasoning tier — longer silent think phase
  const inputRef = useRef(null)
  const bodyRef = useRef(null)
  // Conversation memory: last few Q/A exchanges from this widget session,
  // sent with each ask so follow-ups can resolve "it"/"that move". A ref —
  // it never drives rendering. Cleared only by unmount.
  const historyRef = useRef([])
  // In-flight AbortController so a member can Stop a long (reasoning) search;
  // stoppedRef distinguishes a user cancel from a network error so we don't fall
  // back to the single-shot endpoint after an intentional stop.
  const abortRef = useRef(null)
  const stoppedRef = useRef(false)

  // Rotate the loading status line so a long search reads as progress, not a hang.
  useEffect(() => {
    if (!loading) { setPhase(0); return undefined }
    const t = setInterval(() => setPhase((p) => (p + 1) % SEARCH_PHASES.length), 2400)
    return () => clearInterval(t)
  }, [loading])

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
    setAsked(question)
    setAnswer(d.answer || '')
    setCitations(Array.isArray(d.citations) ? d.citations : [])
    setRelated(Array.isArray(d.related_questions) ? d.related_questions.slice(0, 3) : [])
    setCopied(false)
    historyRef.current = [
      ...historyRef.current.slice(-2),
      { q: question, a: String(d.answer || '').slice(0, 1200) },
    ]
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [])

  // Streaming path: POST /api/ai-search/stream and render tokens as they
  // arrive. Returns 'done' | 'limit' | null (null → caller falls back to the
  // single-shot endpoint).
  const tryStream = useCallback(async (question, signal) => {
    // One retry on a transient 5xx (Railway/Cloudflare blip) before falling
    // back to the single-shot endpoint — the audit saw ~4% transient 502s
    // under load that succeeded immediately on retry.
    let r = await fetch('/api/ai-search/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question, history: historyRef.current }),
      signal,
    })
    if (r.status >= 502 && r.status <= 504) {
      await new Promise((res) => setTimeout(res, 400))
      r = await fetch('/api/ai-search/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question, history: historyRef.current }),
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
        if (ev.type === 'meta') {
          // reasoning tier goes silent through its (stripped) think phase —
          // tell the member it's a deeper pass so the wait doesn't read as hung.
          if (ev.mode === 'reasoning') setDeep(true)
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

  // Conversation flow: submitting moves the question OUT of the input (which
  // clears for the next ask) and down into the body immediately, with the
  // answer streaming in beneath it. The previous answer stays on screen
  // (dimmed) until the new one starts rendering — never blank the widget
  // mid-read. `asked` only advances on success; a failed ask puts the
  // question back in the input.
  const run = useCallback(async (q) => {
    const question = (q ?? query).trim()
    if (!question || loading) return
    stoppedRef.current = false
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null); setLimitMsg(null); setPending(question); setQuery(''); setStreamText(''); setDeep(false)
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

      const singleShot = () => fetch('/api/ai-search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question, history: historyRef.current }),
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
      abortRef.current = null
    }
  }, [query, loading, tryStream, applyFinal])

  // Stop the in-flight search (long reasoning passes especially). Marks the
  // cancel so run() restores the question instead of falling back or erroring.
  const stop = useCallback(() => {
    stoppedRef.current = true
    try { abortRef.current?.abort() } catch { /* already settled */ }
  }, [])

  // Follow-ups run directly — the input stays clear (conversation flow).
  const askFollowUp = (q) => { run(q) }

  const copyAnswer = () => {
    // Strip the [Label]($TICKER) link syntax and bold markers for a clean paste.
    const plain = String(answer || '')
      .replace(/\[([^\]]+)\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)/g, '$1')
      .replace(/\*\*/g, '')
    navigator.clipboard?.writeText(plain)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) })
      .catch(() => { /* clipboard unavailable — button just doesn't confirm */ })
  }

  // Register with the workspace AI bus so a chart's "AI search" action runs here,
  // and auto-run an initialQuery (used by the temporary popup). runRef keeps the
  // subscription stable while always calling the latest run.
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

  return (
    <div className={styles.root}>
      <div className={styles.searchRow}>
        <span className={styles.spark}><Spark state={loading ? 'thinking' : 'idle'} /></span>
        <textarea
          ref={inputRef}
          className={styles.input}
          placeholder="Ask anything about the markets…"
          aria-label="Ask anything about the markets"
          value={query}
          rows={1}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && !loading && (
          <button className={styles.clearBtn} title="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>✕</button>
        )}
        {loading ? (
          <button className={styles.stopBtn} onClick={stop} title="Stop this search" aria-label="Stop search">
            <span className={styles.stopSquare} aria-hidden="true" />Stop
          </button>
        ) : (
          <button className={styles.askBtn} onClick={() => run()} disabled={!query.trim()}>Ask</button>
        )}
      </div>

      <div className={styles.body} ref={bodyRef}>
        {loading && (
          <>
            {pending && (
              <div className={styles.asked}><span className={styles.askedText}>{pending}</span></div>
            )}
            {streamText ? (
              <div className={styles.answerText}>
                <AnswerBody text={streamText} onTicker={handleTicker} cites={[]} />
              </div>
            ) : (
              <div className={styles.status}>
                <span className={styles.spinner} /> {deep ? 'Reasoning through this — a deeper pass, ~20-30s…' : SEARCH_PHASES[phase]}
              </div>
            )}
          </>
        )}
        {!loading && error && <div className={styles.error}>{error}</div>}
        {!loading && limitMsg && <div className={styles.limit}>{limitMsg}</div>}

        {!loading && !error && !limitMsg && answer == null && (
          <div className={styles.empty}>
            <span className={styles.emptySpark}><Spark size={34} /></span>
            <div className={styles.emptyTitle}>Ask the markets anything</div>
            <div className={styles.emptySub}>Earnings recaps, sympathy plays, catalysts, comparables — cited, current.</div>
            <div className={styles.exampleWrap}>
              {EXAMPLES.map((ex) => (
                <button key={ex} className={styles.example} onClick={() => run(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {answer != null && !(loading && streamText) && (
          <div className={`${styles.answer} ${loading ? styles.answerStale : ''}`}>
            {asked && !loading && (
              <div className={styles.asked}>
                <span className={styles.askedText}>{asked}</span>
                <button className={styles.copyBtn} onClick={copyAnswer} title="Copy answer text">
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            )}
            <div className={styles.answerText}><AnswerBody text={answer} onTicker={handleTicker} cites={citations} /></div>

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

            <div className={styles.disclaimer}>AI-generated research — verify before trading.</div>
          </div>
        )}
      </div>
    </div>
  )
}

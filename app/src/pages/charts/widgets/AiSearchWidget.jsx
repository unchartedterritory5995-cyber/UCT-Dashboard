import { useState, useCallback, useRef, useEffect } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import CompassOrb from '../../../components/voice/CompassOrb'
import VoiceInputButton from '../../journal-2-0/components/VoiceInputButton'
import ShareToFloor from '../../../components/community/ShareToFloor'
import styles from './AiSearchWidget.module.css'

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

// One completed Q/A turn in the conversation thread. Follow-ups + the compliance
// line render only on the latest turn (isLast) so a long thread stays clean.
function Exchange({ entry, isLast, onTicker, onCopy, copied, onSave, isSaved, onFollow }) {
  return (
    <div className={styles.exchange}>
      <div className={styles.qLabel}>
        <span className={styles.askedText}>{entry.q}</span>
      </div>
      <div className={styles.answerText}>
        <AnswerBody text={entry.answer} onTicker={onTicker} cites={entry.citations} />
      </div>

      <div className={styles.answerActions}>
        <button className={styles.actionBtn} onClick={() => onCopy(entry)} title="Copy answer text">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button className={styles.actionBtn} onClick={() => onSave(entry)} title="Save this answer (reopen it later)">
          {isSaved ? 'Saved ✓' : 'Save'}
        </button>
        <ShareToFloor
          compact
          label="Share"
          card={{ kind: 'ai', q: entry.q, a: plainAnswer(entry.answer), tickers: extractTickers(entry.answer) }}
          onShared={() => emitSignal(entry.answerId, 'share')}
        />
      </div>

      {isLast && entry.related?.length > 0 && (
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
  // Conversation thread: every completed {id, q, answer, citations, related}
  // exchange this session, oldest → newest. The widget shows the whole thread so
  // a member can scroll back through the conversation, not just the last answer.
  const [thread, setThread] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [limitMsg, setLimitMsg] = useState(null)
  const [phase, setPhase] = useState(0)
  const [copiedId, setCopiedId] = useState(null)
  const [saved, setSaved] = useState(loadSaved)   // answers pinned to localStorage
  const [pending, setPending] = useState(null)   // question in flight (shown at the tail)
  const [streamText, setStreamText] = useState('')   // partial answer while streaming
  const [deep, setDeep] = useState(false)   // reasoning tier — longer silent think phase
  const inputRef = useRef(null)
  const bodyRef = useRef(null)
  // threadRef mirrors `thread` so run()/tryStream (stable callbacks) always read
  // the current turns without stale closures; idRef gives each turn a stable key.
  const threadRef = useRef([])
  const idRef = useRef(0)
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
  const conversationIdRef = useRef(newConversationId())
  const turnRef = useRef(0)

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
    }
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
    let r = await fetch('/api/ai-search/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question, history: historyRef.current, conversation_id: conversationIdRef.current, turn_index: turnRef.current }),
      signal,
    })
    if (r.status >= 502 && r.status <= 504) {
      await new Promise((res) => setTimeout(res, 400))
      r = await fetch('/api/ai-search/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question, history: historyRef.current, conversation_id: conversationIdRef.current, turn_index: turnRef.current }),
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
        body: JSON.stringify({ query: question, history: historyRef.current, conversation_id: conversationIdRef.current, turn_index: turnRef.current }),
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

  // Follow-ups run directly; keep focus in the (bottom) ask box for the next one.
  const askFollowUp = (q) => { run(q); inputRef.current?.focus() }

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
      const next = exists
        ? prev.filter((s) => s.q !== entry.q)
        : [{ q: entry.q, answer: entry.answer, citations: entry.citations || [], related: entry.related || [] }, ...prev].slice(0, 30)
      persistSaved(next)
      return next
    })
  }, [])
  const restoreSaved = useCallback((item) => {
    const entry = { id: ++idRef.current, q: item.q, answer: item.answer || '', citations: item.citations || [], related: item.related || [] }
    threadRef.current = [...threadRef.current, entry]
    setThread(threadRef.current)
  }, [])
  const removeSaved = useCallback((item) => {
    setSaved((prev) => { const next = prev.filter((s) => s.q !== item.q); persistSaved(next); return next })
  }, [])

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

  return (
    <div className={styles.root}>
      <div className={styles.body} ref={bodyRef}>
        {empty && (
          <div className={styles.empty}>
            <span className={styles.emptySpark}><Spark size={34} /></span>
            <div className={styles.emptyTitle}>Ask the markets anything</div>
            <div className={styles.emptySub}>Earnings recaps, sympathy plays, catalysts, comparables — cited, current.</div>
            <div className={styles.exampleWrap}>
              {EXAMPLES.map((ex) => (
                <button key={ex} className={styles.example} onClick={() => run(ex)}>{ex}</button>
              ))}
            </div>
            {saved.length > 0 && (
              <div className={styles.savedWrap}>
                <span className={styles.savedLabel}>Saved answers</span>
                <div className={styles.savedList}>
                  {saved.map((s) => (
                    <div key={s.q} className={styles.savedRow}>
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
                <span className={styles.spinner} /> {deep ? 'Reasoning through this — a deeper pass, ~20-30s…' : SEARCH_PHASES[phase]}
              </div>
            )}
          </div>
        )}

        {!loading && error && <div className={styles.error}>{error}</div>}
        {!loading && limitMsg && <div className={styles.limit}>{limitMsg}</div>}

        {thread.length > 0 && (
          <div className={styles.disclaimer}>AI-generated research — verify before trading.</div>
        )}
      </div>

      {/* Ask bar pinned at the BOTTOM (chat layout): after reading an answer the
          follow-up input is right here — no scrolling back up to continue. */}
      <div className={styles.searchRow}>
        <span className={styles.spark}><Spark state={loading ? 'thinking' : 'idle'} /></span>
        <textarea
          ref={inputRef}
          className={styles.input}
          placeholder={thread.length > 0 ? 'Ask a follow-up…' : 'Ask anything about the markets…'}
          aria-label="Ask anything about the markets"
          value={query}
          rows={1}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && !loading && (
          <button className={styles.clearBtn} title="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>✕</button>
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
        {loading ? (
          <button className={styles.stopBtn} onClick={stop} title="Stop this search" aria-label="Stop search">
            <span className={styles.stopSquare} aria-hidden="true" />Stop
          </button>
        ) : (
          <button className={styles.askBtn} onClick={() => run()} disabled={!query.trim()}>Ask</button>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AiSearchWidget, { AIS_HANDOFF_KEY } from './charts/widgets/AiSearchWidget'
import { WorkspaceContext, WORKSPACE_FALLBACK } from './charts/WorkspaceContext'
import styles from './AiSearchPage.module.css'

/**
 * Standalone AI Search page — the mobile home for the widget (the /charts
 * workspace that hosts it on desktop collapses to a single chart on phones)
 * AND the app-wide deep-link target. Works at any viewport.
 *
 * Deep-link: /ai-search?q=<question>. The FIRST question auto-runs on mount;
 * a LATER ?q= (following a second "Ask AI about $SYM" from anywhere) is
 * delivered through a live aiSearchBus and APPENDS a turn — it used to remount
 * the widget on the query key and destroy the whole conversation, silently.
 *
 * Recollection doors:
 *  - "Past conversations" lists the member's server-side threads; opening one
 *    restores it as the live thread under its own thread id (no fork).
 *  - A frozen journal embed can hand its thread here via localStorage
 *    (AIS_HANDOFF_KEY) — picked up once, then cleared.
 *
 * Ticker clicks in answers load the symbol on the mobile chart: the charts
 * phone fallback reads localStorage['charts_mobile_sym'] on mount.
 */
export default function AiSearchPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim() || null

  // Handoff from a frozen embed — read ONCE, then cleared.
  const handoffRef = useRef(undefined)
  if (handoffRef.current === undefined) {
    let thread = null
    try {
      const raw = localStorage.getItem(AIS_HANDOFF_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length) thread = parsed
        localStorage.removeItem(AIS_HANDOFF_KEY)
      }
    } catch { /* noop */ }
    handoffRef.current = thread
  }

  // `session` decides what the (single) widget mount restores. Changing its key
  // is the ONLY thing that remounts the widget — a new ?q never does.
  const [session, setSession] = useState(() => ({
    key: 'live',
    initialQuery: handoffRef.current ? null : q,
    initialThread: handoffRef.current,
    threadId: null,
  }))

  // Live bus: a later deep-link question appends a turn on the mounted widget.
  const busRef = useRef({
    fn: null,
    subscribe(fn) { busRef.current.fn = fn; return () => { if (busRef.current.fn === fn) busRef.current.fn = null } },
    request(query) { if (busRef.current.fn) { busRef.current.fn(query); return true } return false },
  })
  const ctxValue = useMemo(() => ({ ...WORKSPACE_FALLBACK, aiSearchBus: busRef.current }), [])
  const firstQRef = useRef(q)
  useEffect(() => {
    if (!q || q === firstQRef.current) return
    firstQRef.current = q
    busRef.current.request(q)
  }, [q])

  // Past conversations (server-side, member-scoped).
  const [threads, setThreads] = useState([])
  const [threadsOpen, setThreadsOpen] = useState(false)
  useEffect(() => {
    try {
      Promise.resolve(fetch('/api/ai-search/threads', { credentials: 'include' }))
        .then((r) => (r?.ok ? r.json() : null))
        .then((d) => { if (Array.isArray(d?.threads)) setThreads(d.threads) })
        .catch(() => {})
    } catch { /* noop */ }
  }, [session.key])

  const openThread = useCallback((t) => {
    try {
      Promise.resolve(fetch(`/api/ai-search/threads/${encodeURIComponent(t.thread_id)}`, { credentials: 'include' }))
        .then((r) => (r?.ok ? r.json() : null))
        .then((d) => {
          if (!Array.isArray(d?.turns) || !d.turns.length) return
          const restored = d.turns.map((turn, i) => ({
            id: i + 1, q: turn.q, answer: turn.a,
            citations: turn.citations || [], related: [],
            personal: !!turn.personal, answerId: turn.answer_id || null,
          }))
          setThreadsOpen(false)
          setSession({ key: t.thread_id, initialQuery: null, initialThread: restored, threadId: t.thread_id })
        })
        .catch(() => {})
    } catch { /* noop */ }
  }, [])

  const onTicker = useCallback((tk) => {
    try { localStorage.setItem('charts_mobile_sym', tk) } catch { /* noop */ }
    navigate('/charts')
  }, [navigate])

  const fmtWhen = (iso) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  return (
    <div className={styles.page}>
      {threads.length > 0 && (
        <div className={styles.historyBar}>
          <button
            type="button"
            className={styles.historyToggle}
            onClick={() => setThreadsOpen((o) => !o)}
            aria-expanded={threadsOpen}
          >
            Past conversations {threadsOpen ? '▴' : '▾'}
          </button>
          {session.key !== 'live' && (
            <button
              type="button"
              className={styles.historyToggle}
              onClick={() => setSession({ key: `live-${Date.now()}`, initialQuery: null, initialThread: null, threadId: null })}
            >
              + New conversation
            </button>
          )}
          {threadsOpen && (
            <div className={styles.historyList}>
              {threads.slice(0, 15).map((t) => (
                <button key={t.thread_id} type="button" className={styles.historyRow} onClick={() => openThread(t)}>
                  <span className={styles.historyTitle}>{t.title || 'Conversation'}</span>
                  <span className={styles.historyMeta}>{t.turns} turn{t.turns === 1 ? '' : 's'} · {fmtWhen(t.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <WorkspaceContext.Provider value={ctxValue}>
        <AiSearchWidget
          key={session.key}
          initialQuery={session.initialQuery}
          initialThread={session.initialThread}
          threadId={session.threadId}
          onTicker={onTicker}
        />
      </WorkspaceContext.Provider>
    </div>
  )
}

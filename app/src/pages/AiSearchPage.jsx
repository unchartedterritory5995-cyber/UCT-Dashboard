import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AiSearchWidget, { AIS_HANDOFF_KEY, AnswerBody } from './charts/widgets/AiSearchWidget'
import { WorkspaceContext, WORKSPACE_FALLBACK } from './charts/WorkspaceContext'
import styles from './AiSearchPage.module.css'

/**
 * Deep Research rail — async multi-step reports (plan → desk data + house KB +
 * web sweeps → Opus-written cited report, 1-3 minutes). Jobs are member-keyed
 * server-side; this panel submits, polls while anything runs, and renders a
 * finished report with the widget's own answer renderer so report markdown can
 * never drift from answer markdown.
 */
function DeepResearchPanel({ onTicker }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [jobs, setJobs] = useState([])
  const [expanded, setExpanded] = useState(null)   // job_id
  const [detail, setDetail] = useState(null)       // fetched report
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(() => {
    try {
      Promise.resolve(fetch('/api/ai-search/deep', { credentials: 'include' }))
        .then((r) => (r?.ok ? r.json() : null))
        .then((d) => { if (Array.isArray(d?.jobs)) setJobs(d.jobs) })
        .catch(() => {})
    } catch { /* noop */ }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const anyLive = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  useEffect(() => {
    if (!anyLive) return undefined
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [anyLive, refresh])

  const submit = () => {
    const query = q.trim()
    if (query.length < 8 || submitting) return   // a double-click billed twice
    setNotice(null)
    setSubmitting(true)
    try {
      Promise.resolve(fetch('/api/ai-search/deep', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      }))
        .then(async (r) => {
          const d = await r.json().catch(() => null)
          if (r?.ok) { setQ(''); refresh() }
          else setNotice(d?.detail || 'Could not start the report.')
        })
        .catch(() => setNotice('Could not start the report.'))
        .finally(() => setSubmitting(false))
    } catch { setNotice('Could not start the report.'); setSubmitting(false) }
  }

  const fetchDetail = useCallback((jobId) => {
    try {
      Promise.resolve(fetch(`/api/ai-search/deep/${encodeURIComponent(jobId)}`, { credentials: 'include' }))
        .then((r) => (r?.ok ? r.json() : null))
        .then((d) => { if (d?.report) setDetail(d) })
        .catch(() => {})
    } catch { /* noop */ }
  }, [])

  const openJob = (j) => {
    if (expanded === j.job_id) { setExpanded(null); setDetail(null); return }
    setExpanded(j.job_id); setDetail(null)
    if (j.status === 'done') fetchDetail(j.job_id)
  }

  // Watching a running report is the natural flow — when the 5s poll flips it
  // to done, load the report the member is already looking at.
  useEffect(() => {
    if (!expanded || detail) return
    const j = jobs.find((x) => x.job_id === expanded)
    if (j?.status === 'done') fetchDetail(expanded)
  }, [jobs, expanded, detail, fetchDetail])

  const removeJob = (j) => {
    try {
      Promise.resolve(fetch(`/api/ai-search/deep/${encodeURIComponent(j.job_id)}`, {
        method: 'DELETE', credentials: 'include',
      })).then(() => refresh()).catch(() => {})
    } catch { /* noop */ }
    if (expanded === j.job_id) { setExpanded(null); setDetail(null) }
  }

  const statusWord = (j) => (
    j.status === 'done' ? 'ready'
      : j.status === 'error' ? (j.error || 'error')
        : (j.progress || j.status))

  return (
    <div className={styles.deepBar}>
      <button type="button" className={styles.historyToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Deep research {anyLive ? '· running' : ''} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className={styles.deepPanel}>
          <div className={styles.deepAskRow}>
            <textarea
              className={styles.deepInput}
              rows={2}
              placeholder="One big question — the desk plans the research, sweeps sources, and writes a cited report (1-3 min)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="button" className={styles.historyToggle} onClick={submit}
              disabled={q.trim().length < 8 || submitting}>
              {submitting ? 'Starting…' : 'Research'}
            </button>
          </div>
          {notice && <div className={styles.deepNotice}>{notice}</div>}
          {jobs.slice(0, 10).map((j) => (
            <div key={j.job_id} className={styles.deepJob}>
              <button type="button" className={styles.historyRow} onClick={() => openJob(j)}>
                <span className={styles.historyTitle}>{j.query}</span>
                <span className={styles.historyMeta}>{statusWord(j)}</span>
              </button>
              {expanded === j.job_id && j.status === 'done' && detail?.report && (
                <div className={styles.deepReport}>
                  <AnswerBody text={detail.report} onTicker={onTicker} cites={detail.citations || []} />
                  {(detail.citations || []).length > 0 && (
                    <div className={styles.deepSources}>
                      {(detail.citations || []).map((c, i) => {
                        let host = c
                        try { host = new URL(c).hostname.replace(/^www\./, '') } catch { /* raw */ }
                        return <a key={c} href={c} target="_blank" rel="noreferrer">[{i + 1}] {host}</a>
                      })}
                    </div>
                  )}
                  <button type="button" className={styles.deepDelete} onClick={() => removeJob(j)}>Delete report</button>
                </div>
              )}
              {expanded === j.job_id && j.status === 'error' && (
                <div className={styles.deepNotice}>{j.error || 'The researcher hit an error — resubmit.'}
                  <button type="button" className={styles.deepDelete} onClick={() => removeJob(j)}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
/** Standing briefings — list / pause / delete. Creation happens through the
 * ask box's proposal chip ("brief me on CRM every morning"). */
function BriefingsRail() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [notice, setNotice] = useState(null)   // server refusal ("capped at 1 — pause one first")
  const refresh = useCallback(() => {
    try {
      Promise.resolve(fetch('/api/ai-search/briefings', { credentials: 'include' }))
        .then((r) => (r?.ok ? r.json() : null))
        .then((d) => { if (Array.isArray(d?.briefings)) setRows(d.briefings) })
        .catch(() => {})
    } catch { /* noop */ }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  // The proposal chip (inside the widget) creates briefings — it announces via
  // a window event so this rail appears/refreshes without a page reload.
  useEffect(() => {
    const onChanged = () => refresh()
    window.addEventListener('ais:briefings-changed', onChanged)
    return () => window.removeEventListener('ais:briefings-changed', onChanged)
  }, [refresh])
  const toggle = (b) => {
    setNotice(null)
    try {
      Promise.resolve(fetch(
        `/api/ai-search/briefings/${encodeURIComponent(b.briefing_id)}/toggle?enabled=${b.enabled ? 'false' : 'true'}`,
        { method: 'POST', credentials: 'include' },
      ))
        // the toggle endpoint answers 200 with {ok:false, reason} on a cap
        // refusal (resume re-check) — dropping the body made Resume look
        // like a dead button (2026-08-28 review)
        .then((r) => r?.json?.().catch(() => null))
        .then((d) => { if (d && d.ok === false && d.reason) setNotice(d.reason) })
        .then(() => refresh()).catch(() => {})
    } catch { /* noop */ }
  }
  const remove = (b) => {
    try {
      Promise.resolve(fetch(`/api/ai-search/briefings/${encodeURIComponent(b.briefing_id)}`, {
        method: 'DELETE', credentials: 'include',
      })).then(() => refresh()).catch(() => {})
    } catch { /* noop */ }
  }
  if (!rows.length) return null
  return (
    <div className={styles.deepBar}>
      <button type="button" className={styles.historyToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        My briefings ({rows.filter((b) => b.enabled).length}) {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className={styles.deepPanel}>
          {notice && <div className={styles.outageNote}>{notice}</div>}
          {rows.map((b) => (
            <div key={b.briefing_id} className={styles.historyRow} style={{ cursor: 'default' }}>
              <span className={styles.historyTitle}>
                {b.sym ? `${b.sym} · ` : ''}{b.query}
              </span>
              <span className={styles.historyMeta}>
                {b.cadence === 'weekly_deep' ? 'deep report every Sunday'
                  : b.cadence === 'postmarket' ? 'each close' : 'each morning'}
                {b.last_status ? ` · ${b.last_status}` : ''}
              </span>
              <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                <button type="button" className={styles.deepDelete} onClick={() => toggle(b)}>
                  {b.enabled ? 'Pause' : 'Resume'}
                </button>
                <button type="button" className={styles.deepDelete} onClick={() => remove(b)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


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
      <DeepResearchPanel onTicker={onTicker} />
      <BriefingsRail />
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

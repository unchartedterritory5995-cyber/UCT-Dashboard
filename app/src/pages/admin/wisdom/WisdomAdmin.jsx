// app/src/pages/admin/wisdom/WisdomAdmin.jsx
//
// The Wisdom Loop admin surface: the owner's review queue and the loop's health
// (docs/wisdom/CONTRACTS.md §6.6). Admin cohort only — AuthGuard restricts
// /admin/* and every endpoint below is require_admin on the server.
//
// ⛔ THE SERVER IS THE ONE AUTHORITY FOR EVERY LIST AND EVERY NUMBER ON THIS PAGE.
//   - queue tabs come from /queue/counts (never a second tab list here);
//   - every rate renders the server's `display` string, which always carries its
//     n and prints 0/0 as 0/0 (W1 §0.6) — this file formats no ratio of its own;
//   - "can I rule on this item" is the server's `can_act` (owner only), never a
//     guess from the signed-in identity.
//
// ⛔ NO POLLING. Every useSWR here is (key, jsonFetcher) with no refreshInterval;
// an action re-fetches exactly the keys it changed.
import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import UIcon from '../../../components/ui/UIcon'
import styles from './WisdomAdmin.module.css'

const API = '/api/admin/wisdom/publish'

const SECTIONS = [
  { key: 'queue', label: 'Queue', icon: 'check' },
  { key: 'metrics', label: 'Metrics', icon: 'chart' },
  { key: 'capture', label: 'Capture health', icon: 'camera' },
  { key: 'jobs', label: 'Jobs', icon: 'clock' },
  { key: 'budget', label: 'Budget & flags', icon: 'dollar' },
  { key: 'reports', label: 'Reports', icon: 'document' },
]

const ACTIONS = [
  { key: 'accept', label: 'Accept', done: 'Accepted.' },
  { key: 'veto', label: 'Veto', done: 'Vetoed.' },
  { key: 'resolve', label: 'Resolve', done: 'Resolved.' },
]

const POST_JSON = { method: 'POST', headers: { 'Content-Type': 'application/json' } }

export const OWNER_ONLY_TEXT = 'Only the owner can rule on queue items.'

export function tabLabel(key) {
  const text = String(key || '').replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function actionErrorText(err, action) {
  if (err?.status === 403) return OWNER_ONLY_TEXT
  if (err?.status === 409) return 'This item was already decided.'
  if (err?.status === 400 && action === 'resolve') return 'Not saved: resolving needs a note stating the ruling.'
  return `Not saved (${err?.status ?? 'network error'}).`
}

function LoadError({ error, what }) {
  return (
    <p className={styles.error} role="alert">
      <UIcon name="warning" size={14} /> Could not load {what} ({error?.status ?? 'network error'}).
    </p>
  )
}

function Json({ value }) {
  if (value === null || value === undefined) return <p className={styles.muted}>none</p>
  return <pre className={styles.pre}>{JSON.stringify(value, null, 2)}</pre>
}

function triggerText(trigger) {
  if (!trigger) return '—'
  if (trigger.kind === 'interval') return `every ${trigger.seconds}s`
  const hh = String(trigger.hour ?? '*').padStart(2, '0')
  const mm = String(trigger.minute ?? '*').padStart(2, '0')
  const days = [trigger.day_of_week, trigger.day ? `day ${trigger.day}` : null].filter(Boolean).join(' ')
  return `${days || 'daily'} ${hh}:${mm} ET`
}

// ── Queue ────────────────────────────────────────────────────────────────────

function ItemDetail({ itemId, onChanged }) {
  const { data, error, mutate } = useSWR(`${API}/queue/${itemId}`, jsonFetcher)
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)

  const act = useCallback(async (action) => {
    setBusy(true)
    setFeedback(null)
    try {
      await jsonFetcher(`${API}/queue/${itemId}/action`, {
        ...POST_JSON,
        body: JSON.stringify({ action: action.key, note: note.trim() || null }),
      })
      setFeedback({ ok: true, text: action.done })
      setNote('')
    } catch (err) {
      setFeedback({ ok: false, text: actionErrorText(err, action.key) })
    } finally {
      setBusy(false)
      mutate()
      onChanged()
    }
  }, [itemId, note, mutate, onChanged])

  if (error) return <LoadError error={error} what="this item" />
  if (!data) return <p className={styles.muted}>Loading item…</p>

  const canAct = data.can_act === true
  return (
    <section className={styles.detail} aria-label="Review item">
      <h3 className={styles.detailTitle}>{data.summary}</h3>
      <p className={styles.meta}>
        {tabLabel(data.tab)} · {data.subject_ref} · <span className={styles.status}>{data.status}</span>
      </p>
      {data.recommendation && (
        <p className={styles.recommendation}><strong>Recommended:</strong> {data.recommendation}</p>
      )}
      <div className={styles.compare}>
        <div><h4 className={styles.h4}>Old</h4><Json value={data.old} /></div>
        <div><h4 className={styles.h4}>New</h4><Json value={data.new} /></div>
      </div>
      <h4 className={styles.h4}>Evidence</h4>
      <Json value={data.evidence} />
      {data.golden_candidate && (
        <p className={styles.meta}>Golden candidate recorded ({data.golden_candidate.split} split).</p>
      )}
      {data.status === 'open' && (
        <div className={styles.actions}>
          <label className={styles.noteLabel} htmlFor={`note-${itemId}`}>Note</label>
          <textarea
            id={`note-${itemId}`}
            className={styles.note}
            value={note}
            maxLength={4000}
            onChange={(e) => setNote(e.target.value)}
            disabled={!canAct || busy}
          />
          <div className={styles.actionRow}>
            {ACTIONS.map((action) => (
              <button
                key={action.key}
                type="button"
                className={styles.actionBtn}
                disabled={!canAct || busy}
                onClick={() => act(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
          {!canAct && <p className={styles.muted}>{OWNER_ONLY_TEXT}</p>}
        </div>
      )}
      {feedback && (
        <p className={feedback.ok ? styles.ok : styles.error} role="status">{feedback.text}</p>
      )}
      {data.actions?.length > 0 && (
        <>
          <h4 className={styles.h4}>History</h4>
          <ul className={styles.history}>
            {data.actions.map((a) => (
              <li key={a.action_id}>{a.created_at} · {a.actor} · {a.action}{a.note ? ` — ${a.note}` : ''}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function QueuePanel() {
  const counts = useSWR(`${API}/queue/counts`, jsonFetcher)
  const [picked, setPicked] = useState(null)
  const [status, setStatus] = useState('open')
  const [selected, setSelected] = useState(null)

  const tabs = useMemo(() => Object.entries(counts.data?.tabs || {}), [counts.data])
  const firstWithOpen = useMemo(() => (tabs.find(([, c]) => c.open > 0) || tabs[0] || [null])[0], [tabs])
  const tab = picked || firstWithOpen

  const listKey = tab ? `${API}/queue?tab=${encodeURIComponent(tab)}&status=${status}` : null
  const list = useSWR(listKey, jsonFetcher)

  const refresh = useCallback(() => {
    counts.mutate()
    list.mutate()
  }, [counts, list])

  const pickTab = useCallback((key) => {
    setPicked(key)
    setSelected(null)
  }, [])

  if (counts.error) return <LoadError error={counts.error} what="the review queue" />
  if (!counts.data) return <p className={styles.muted}>Loading queue…</p>

  return (
    <div className={styles.queue}>
      <div className={styles.queueTabs} role="tablist" aria-label="Queue tabs">
        {tabs.map(([key, c]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === tab}
            className={`${styles.queueTab} ${key === tab ? styles.queueTabActive : ''}`}
            onClick={() => pickTab(key)}
          >
            {tabLabel(key)} <span className={styles.count}>{c.open}</span>
          </button>
        ))}
      </div>
      <div className={styles.filterRow}>
        <label htmlFor="queue-status" className={styles.muted}>Show</label>
        <select id="queue-status" className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
        </select>
        <span className={styles.muted}>Open across all tabs: {counts.data.totals.open}</span>
      </div>
      <div className={styles.split}>
        <div className={styles.list}>
          {list.error && <LoadError error={list.error} what="items" />}
          {!list.error && !list.data && <p className={styles.muted}>Loading items…</p>}
          {list.data && list.data.items.length === 0 && (
            <p className={styles.muted}>Nothing {status === 'open' ? 'open ' : ''}in {tabLabel(tab)}.</p>
          )}
          {list.data?.items.map((item) => (
            <button
              key={item.item_id}
              type="button"
              className={`${styles.listItem} ${item.item_id === selected ? styles.listItemActive : ''}`}
              onClick={() => setSelected(item.item_id)}
            >
              <span className={styles.listSummary}>{item.summary}</span>
              <span className={styles.listMeta}>{item.status} · {item.created_at}</span>
            </button>
          ))}
        </div>
        <div className={styles.detailWrap}>
          {selected ? <ItemDetail itemId={selected} onChanged={refresh} /> : (
            <p className={styles.muted}>Pick an item to see old, new and evidence.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Dashboard-backed panels ─────────────────────────────────────────────────

function useDashboard() {
  return useSWR(`${API}/dashboard`, jsonFetcher)
}

function SectionError({ section }) {
  if (!section?.error) return null
  return <p className={styles.error} role="alert">Section unavailable: {section.error}</p>
}

function Table({ headers, rows, empty = 'Nothing yet.' }) {
  if (!rows.length) return <p className={styles.muted}>{empty}</p>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MetricsPanel() {
  const { data, error } = useDashboard()
  if (error) return <LoadError error={error} what="metrics" />
  if (!data) return <p className={styles.muted}>Loading metrics…</p>
  const metrics = data.metrics || {}
  const rows = (metrics.rows || []).map((r) => [
    r.metric, Object.keys(r.slice || {}).length ? JSON.stringify(r.slice) : 'all', r.display, r.method_version, r.computed_at,
  ])
  const evalRows = (data.extractor?.eval_runs || []).map((r) => [r.kind, r.extractor_version, r.method_version, r.n, r.created_at])
  return (
    <div>
      <SectionError section={metrics} />
      <p className={styles.muted}>Every rate is k/n; 0/0 is printed as 0/0.</p>
      <Table headers={['Metric', 'Slice', 'k/n', 'Method', 'Computed']} rows={rows} empty="No metric has been computed yet." />
      {metrics.not_computed?.length > 0 && (
        <p className={styles.muted}>Not computed yet: {metrics.not_computed.join(', ')}</p>
      )}
      <h3 className={styles.h3}>Extractor gate runs</h3>
      <SectionError section={data.extractor} />
      <Table headers={['Kind', 'Extractor', 'Method', 'n', 'Created']} rows={evalRows} empty="No extractor evaluation recorded yet." />
    </div>
  )
}

function CapturePanel() {
  const { data, error } = useDashboard()
  if (error) return <LoadError error={error} what="capture health" />
  if (!data) return <p className={styles.muted}>Loading capture health…</p>
  const capture = data.capture_health || {}
  const rows = (capture.datasets || []).map((d) => [
    d.dataset, d.session_date, d.row_count, d.trailing_median, d.health, d.consecutive_ok_sessions,
  ])
  return (
    <div>
      <SectionError section={capture} />
      {capture.source && <p className={styles.muted}>Source: {capture.source}</p>}
      <Table headers={['Dataset', 'Last session', 'Rows', 'Trailing median', 'Health', 'Consecutive ok']}
        rows={rows} empty="No capture run recorded yet." />
    </div>
  )
}

function JobsPanel() {
  const { data, error } = useDashboard()
  if (error) return <LoadError error={error} what="jobs" />
  if (!data) return <p className={styles.muted}>Loading jobs…</p>
  const jobRows = (data.jobs || []).map((j) => [
    j.job_id, triggerText(j.trigger), j.enabled ? 'on' : 'off',
    j.heartbeat?.last_status, j.heartbeat?.last_ok_at, j.heartbeat?.consecutive_failures,
  ])
  const chains = Object.entries(data.chains || {})
  const notBuilt = Object.entries(data.chain_catalogue || {}).flatMap(([name, steps]) =>
    steps.filter((s) => s.available === false).map((s) => `${name}: ${s.step}`))
  return (
    <div>
      <p className={styles.muted}>Master switch: {data.master_switch_on ? 'on' : 'off'}</p>
      <Table headers={['Job', 'Slot', 'Switch', 'Last status', 'Last ok', 'Failures']} rows={jobRows} />
      <h3 className={styles.h3}>Chains — last runs</h3>
      {chains.map(([name, run]) => (
        <div key={name} className={styles.chain}>
          <h4 className={styles.h4}>{tabLabel(name)}</h4>
          {!run ? <p className={styles.muted}>Never ran.</p> : (
            <>
              <p className={styles.muted}>
                {run.due_key} · ok {run.summary.ok} · failed {run.summary.failed} · not built {run.summary.not_available} · skipped {run.summary.skipped}{run.dry_run ? ' · dry run' : ''}
              </p>
              <ul className={styles.steps}>
                {run.steps.map((s) => (
                  <li key={s.step} className={styles[`step_${s.status}`]}>
                    {s.step}: {s.status}{s.reason ? ` — ${s.reason}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
      {notBuilt.length > 0 && <p className={styles.muted}>Steps not built yet: {notBuilt.join(', ')}</p>}
    </div>
  )
}

function BudgetFlagsPanel() {
  const { data, error } = useDashboard()
  if (error) return <LoadError error={error} what="budget and flags" />
  if (!data) return <p className={styles.muted}>Loading budget and flags…</p>
  const budget = data.budget || {}
  const budgetRows = budget.error ? [] : [
    ['This week', budget.this_week?.batches, budget.this_week?.actual_usd, budget.this_week?.pending_estimate_usd],
    ['To date', budget.to_date?.batches, budget.to_date?.actual_usd, budget.to_date?.pending_estimate_usd],
  ]
  const flagRows = (data.flags || []).map((f) => [f.env, f.on ? 'on' : 'off', f.member_visible ? 'member-visible (owner flips)' : 'internal'])
  const gateRows = (data.scheduled_gates?.gates || []).map((g) => [g.gate, g.due, g.status, g.evidence])
  return (
    <div>
      <h3 className={styles.h3}>Batch spend</h3>
      <SectionError section={budget} />
      <Table headers={['Window', 'Batches', 'Actual USD', 'Pending estimate USD']} rows={budgetRows} />
      {!budget.error && (
        <p className={styles.muted}>Budget cap: {budget.budget_cap_usd ?? '—'} ({budget.budget_cap_source}).</p>
      )}
      <h3 className={styles.h3}>Flags</h3>
      <Table headers={['Flag', 'State', 'Kind']} rows={flagRows} />
      <h3 className={styles.h3}>Scheduled gates</h3>
      <SectionError section={data.scheduled_gates} />
      <Table headers={['Gate', 'Due', 'Status', 'Evidence']} rows={gateRows} />
      <p className={styles.muted}>D16b: {data.d16b}.</p>
    </div>
  )
}

// ── Reports ──────────────────────────────────────────────────────────────────

function ReportView({ reportId }) {
  const { data, error } = useSWR(`${API}/reports/${reportId}`, jsonFetcher)
  if (error) return <LoadError error={error} what="this report" />
  if (!data) return <p className={styles.muted}>Loading report…</p>
  return <pre className={styles.report}>{data.markdown}</pre>
}

function ReportsPanel() {
  const { data, error, mutate } = useSWR(`${API}/reports`, jsonFetcher)
  const [selected, setSelected] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const preview = useCallback(async () => {
    setFeedback(null)
    try {
      await jsonFetcher(`${API}/reports/preview`, POST_JSON)
      setFeedback({ ok: true, text: 'Preview started. Refresh in a minute to see it.' })
    } catch (err) {
      setFeedback({ ok: false, text: err?.status === 409 ? 'A preview is already being built.' : `Preview not started (${err?.status ?? 'network error'}).` })
    }
    mutate()
  }, [mutate])

  if (error) return <LoadError error={error} what="reports" />
  if (!data) return <p className={styles.muted}>Loading reports…</p>
  const state = data.preview || {}
  return (
    <div>
      <div className={styles.filterRow}>
        <button type="button" className={styles.actionBtn} onClick={preview} disabled={state.running}>
          <UIcon name="document" size={14} /> Generate preview
        </button>
        <button type="button" className={styles.actionBtn} onClick={() => mutate()}>
          <UIcon name="refresh" size={14} /> Refresh
        </button>
        {state.running && <span className={styles.muted}>Building preview…</span>}
        {state.error && <span className={styles.error}>Last preview failed: {state.error}</span>}
      </div>
      {feedback && <p className={feedback.ok ? styles.ok : styles.error} role="status">{feedback.text}</p>}
      {data.reports.length === 0 && <p className={styles.muted}>No report stored yet.</p>}
      <ul className={styles.reportList}>
        {data.reports.map((r) => (
          <li key={r.report_id}>
            <button type="button" className={`${styles.listItem} ${r.report_id === selected ? styles.listItemActive : ''}`}
              onClick={() => setSelected(r.report_id)}>
              <span className={styles.listSummary}>{r.kind === 'weekly' ? 'Weekly report' : 'Recognition packet'} {r.period_key} ({r.variant})</span>
              <span className={styles.listMeta}>{r.generated_at} · delivery {r.delivery_status}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <ReportView reportId={selected} />}
    </div>
  )
}

const PANELS = {
  queue: QueuePanel,
  metrics: MetricsPanel,
  capture: CapturePanel,
  jobs: JobsPanel,
  budget: BudgetFlagsPanel,
  reports: ReportsPanel,
}

export default function WisdomAdmin() {
  const [section, setSection] = useState('queue')
  const Panel = PANELS[section]
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.h1}><UIcon name="library" size={20} /> Wisdom Loop</h1>
        <p className={styles.sub}>Review queue and loop health. Rulings are the owner&apos;s; every rate shows its n.</p>
      </header>
      <nav className={styles.sections} role="tablist" aria-label="Wisdom admin sections">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === section}
            className={`${styles.sectionTab} ${s.key === section ? styles.sectionTabActive : ''}`}
            onClick={() => setSection(s.key)}
          >
            <UIcon name={s.icon} size={15} /> {s.label}
          </button>
        ))}
      </nav>
      <main className={styles.panel}><Panel /></main>
    </div>
  )
}

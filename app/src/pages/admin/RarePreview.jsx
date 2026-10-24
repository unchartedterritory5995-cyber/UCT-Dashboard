import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import Textarea from '../../components/ui/Textarea'
import styles from './GoldReview.module.css'
import { drawingToAnnotations, releaseLine, ymd } from './rarePreviewDrawing'

// Rare-pattern preview: every live instance of cup without handle, high tight flag, IPO base and saucer that
// the daily scan recorded (api/services/rare_preview.py), each on its real chart with Approve / Reject.
// ADMIN ONLY (the /admin prefix in AuthGuard + require_admin on every route) and DARK: the API answers 404
// while AUTO_STRUCTURES_RARE_PREVIEW_ENABLED is off. A verdict releases nothing: a pattern reaches members only
// by a later commit, after >= 12 approvals at >= 80% (the release line below is the server's own count).

const API = '/api/patterns/admin/rare-preview'
const NO_ROWS = Object.freeze([])

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`)
    e.status = r.status
    throw e
  }
  return r.json()
})

const VERDICT_LABEL = { approve: 'approved', reject: 'rejected' }
const VERDICT_CLASS = { approve: 'v_ok', reject: 'v_not_a_pattern' }

export default function RarePreview() {
  const [pattern, setPattern] = useState('')
  const url = pattern ? `${API}/instances?pattern=${encodeURIComponent(pattern)}` : `${API}/instances`
  const { data, error, mutate } = useSWR(url, fetcher, { revalidateOnFocus: false })
  const all = data?.instances || NO_ROWS
  const patterns = data?.patterns || NO_ROWS
  const nameOf = useMemo(() => Object.fromEntries(patterns.map((p) => [p.id, p.name])), [patterns])

  const [hideDecided, setHideDecided] = useState(false)
  const [local, setLocal] = useState({})
  const verdictOf = useCallback((it) => local[it.instance_id] || it.verdict?.verdict || null, [local])
  const items = useMemo(() => (hideDecided ? all.filter((i) => !verdictOf(i)) : all), [all, hideDecided, verdictOf])

  const [selId, setSelId] = useState(null)
  const sel = useMemo(() => items.find((i) => i.instance_id === selId) || items[0] || null, [items, selId])
  const selIdx = sel ? items.findIndex((i) => i.instance_id === sel.instance_id) : -1
  const annotations = useMemo(() => drawingToAnnotations(sel?.drawing), [sel])

  const [note, setNote] = useState('')
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [focusNonce, setFocusNonce] = useState(0)
  const lastKey = useRef(null)
  const selKey = sel?.instance_id || null
  if (selKey !== lastKey.current) {
    lastKey.current = selKey
    setNote(sel?.verdict?.note || '')
    setFocusNonce((n) => n + 1)
  }

  async function decide(verdict) {
    if (!sel || saving) return
    setSaving(true)
    setStatus(null)
    try {
      const r = await fetch(`${API}/instances/${encodeURIComponent(sel.instance_id)}/verdict`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, note: note.trim() || null }),
      })
      if (!r.ok) {
        setStatus({ kind: 'error', text: `Save failed (${r.status}). Nothing was recorded.` })
        return
      }
      const id = sel.instance_id
      setLocal((m) => ({ ...m, [id]: verdict }))
      setStatus({ kind: 'ok', text: `Saved ${sel.ticker} ${nameOf[sel.pattern_id] || sel.pattern_id}: ${VERDICT_LABEL[verdict]}.` })
      mutate()
      const i = items.findIndex((x) => x.instance_id === id)
      const next = [...items.slice(i + 1), ...items.slice(0, Math.max(0, i))].find((x) => !verdictOf(x) && x.instance_id !== id)
      if (next) setSelId(next.instance_id)
    } catch {
      setStatus({ kind: 'error', text: 'Save failed (network). Nothing was recorded.' })
    } finally {
      setSaving(false)
    }
  }

  async function scanNow() {
    setStatus(null)
    try {
      const r = await fetch(`${API}/scan`, { method: 'POST', credentials: 'include' })
      const j = r.ok ? await r.json() : null
      setStatus(j?.started
        ? { kind: 'ok', text: 'Scan started over the daily scan universe. Reload in a few minutes.' }
        : { kind: 'error', text: r.ok ? 'A scan is already running.' : `Scan failed (${r.status}).` })
    } catch {
      setStatus({ kind: 'error', text: 'Scan failed (network).' })
    }
  }

  if (error) {
    return (
      <div className={styles.empty}>
        {error.status === 404
          ? 'The rare-pattern preview is off (AUTO_STRUCTURES_RARE_PREVIEW_ENABLED).'
          : `Could not load the preview (${error.message}).`}
      </div>
    )
  }
  if (!data) return <div className={styles.empty}>Loading the rare-pattern preview…</div>

  return (
    <div className={styles.wrap}>
      <h1 className={styles.progress}>Rare-pattern preview</h1>
      <div className={styles.hint} data-testid="rare-release">
        {patterns.map((p) => (
          <div key={p.id}>{p.name}: {releaseLine(data.release?.[p.id])}</div>
        ))}
      </div>
      <div className={styles.toolbar}>
        <select aria-label="Pattern" className={styles.select} value={pattern}
          onChange={(e) => { setPattern(e.target.value); setSelId(null) }}>
          <option value="">All patterns</option>
          {patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className={styles.toggle}>
          <input type="checkbox" checked={hideDecided}
            onChange={(e) => { setHideDecided(e.target.checked); setSelId(null) }} />
          Hide decided
        </label>
        <button onClick={scanNow} disabled={!!data.scan?.running}>
          {data.scan?.running ? 'Scan running…' : 'Scan now'}
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.list}>
          {items.length === 0 && <div className={styles.empty}>No instances recorded yet.</div>}
          {items.map((it) => {
            const v = verdictOf(it)
            return (
              <button key={it.instance_id}
                className={`${styles.row} ${sel && it.instance_id === sel.instance_id ? styles.rowActive : ''}`}
                onClick={() => { setSelId(it.instance_id); setStatus(null) }}>
                <span className={styles.rowSym}>{it.ticker}</span>
                <span className={styles.rowLabel}>{nameOf[it.pattern_id] || it.pattern_id}</span>
                <span className={styles.rowDate}>{ymd(it.last_asof_t)}</span>
                <span className={v ? styles[VERDICT_CLASS[v]] : styles.vTodo}>{v ? VERDICT_LABEL[v] : 'to do'}</span>
              </button>
            )
          })}
        </div>

        <div className={styles.detail}>
          {sel && (
            <>
              <div className={styles.detailHead}>
                <span className={styles.detailSym} data-testid="rare-ticker">{sel.ticker}</span>
                <span className={styles.detailLabel}>{sel.label || nameOf[sel.pattern_id]}</span>
                <span className={styles.detailDate}>{ymd(sel.start_t)} → {ymd(sel.last_asof_t)}</span>
                <span className={styles.position}>{selIdx + 1} / {items.length}</span>
              </div>
              <div className={styles.hint}>
                Buy point {Number(sel.buy_point).toFixed(2)} (the ceiling bar&apos;s high + $0.10). First seen {ymd(sel.first_asof_t)},
                seen on {sel.seen_count} scan{sel.seen_count === 1 ? '' : 's'}.
              </div>
              <div className={styles.chartWrap}>
                <StockChart
                  sym={sel.ticker}
                  tf="D"
                  liveUpdates={false}
                  showDrawingTools={false}
                  focusDate={ymd(sel.last_asof_t)}
                  focusStartDate={ymd(sel.start_t)}
                  focusNonce={focusNonce}
                  annotations={annotations}
                  annotationsVisible
                />
              </div>
              <div className={styles.actions}>
                <button className={styles.ok} disabled={saving} onClick={() => decide('approve')}>Approve</button>
                <button className={styles.reject} disabled={saving} onClick={() => decide('reject')}>Reject</button>
              </div>
              {status && (
                <div role="status" className={status.kind === 'error' ? styles.err : styles.saved}>{status.text}</div>
              )}
              <Textarea aria-label="Verdict note" className={styles.note}
                placeholder="Optional note (why approve, or what is wrong with it)…"
                value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

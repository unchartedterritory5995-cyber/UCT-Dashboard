import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import Textarea from '../../components/ui/Textarea'
import styles from './GoldReview.module.css'

// Gold-set drawing review. Items are auto-drawn charts loaded in batches by an
// ops script (POST /api/patterns/admin/gold-items); a trader confirms the seed
// geometry, fixes it, rejects it, or skips. Saves go ONLY to
// gold_review_corrections — never to the judge's exemplars.

const ITEMS_URL = '/api/patterns/admin/gold-items'
const MAX_DRAWINGS_BYTES = 64 * 1024   // mirrors GOLD_MAX_DRAWINGS_BYTES on the server

const NO_ITEMS = Object.freeze([])

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

function parseDrawings(json) {
  if (!json) return []
  try {
    const d = typeof json === 'string' ? JSON.parse(json) : json
    if (!Array.isArray(d)) return []
    // StockChart's annotation CRUD addresses drawings by id; give any seed
    // object without one a stable id so it stays editable.
    return d.filter((x) => x && typeof x === 'object')
      .map((x, i) => (x.id ? x : { ...x, id: `seed-${i}` }))
  } catch {
    return []
  }
}

const VERDICT_LABEL = {
  ok: 'correct as drawn',
  fixed: 'fixed',
  not_a_pattern: 'not a pattern',
  skip: 'skipped',
}

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function GoldReview() {
  const { data, error, mutate } = useSWR(ITEMS_URL, fetcher, { revalidateOnFocus: false })
  const allItems = data?.items || NO_ITEMS

  const [batch, setBatch] = useState('')
  const [hideReviewed, setHideReviewed] = useState(false)
  const batches = useMemo(
    () => [...new Set(allItems.map((i) => i.batch).filter(Boolean))].sort(),
    [allItems],
  )
  const batchItems = useMemo(
    () => (batch ? allItems.filter((i) => i.batch === batch) : allItems),
    [allItems, batch],
  )
  // Optimistic local verdicts so the list and the counter move the moment a
  // save lands, before the revalidation comes back.
  const [localVerdicts, setLocalVerdicts] = useState({})
  const verdictOf = useCallback(
    (it) => localVerdicts[it.item_id] || it.correction?.verdict || null,
    [localVerdicts],
  )
  const items = useMemo(
    () => (hideReviewed ? batchItems.filter((i) => !verdictOf(i)) : batchItems),
    [batchItems, hideReviewed, verdictOf],
  )

  const done = batchItems.filter((i) => verdictOf(i) && verdictOf(i) !== 'skip').length
  const skipped = batchItems.filter((i) => verdictOf(i) === 'skip').length

  const [selId, setSelId] = useState(null)
  const sel = useMemo(
    () => items.find((i) => i.item_id === selId) || items[0] || null,
    [items, selId],
  )
  const selIdx = sel ? items.findIndex((i) => i.item_id === sel.item_id) : -1

  const seed = useMemo(() => parseDrawings(sel?.seed_drawings_json), [sel])
  const [draft, setDraft] = useState([])
  const [note, setNote] = useState('')
  const [status, setStatus] = useState(null)   // {kind: 'ok'|'error', text}
  const [saving, setSaving] = useState(false)
  const [focusNonce, setFocusNonce] = useState(0)

  // Reset per-item editing state when the selection changes. A saved fix is
  // resumed from its own drawings; everything else starts from the seed.
  const lastKey = useRef(null)
  const selKey = sel?.item_id || null
  if (selKey !== lastKey.current) {
    lastKey.current = selKey
    const c = sel?.correction
    setDraft(c?.verdict === 'fixed' && c.drawings_json ? parseDrawings(c.drawings_json) : seed)
    setNote(c?.note || '')
    setFocusNonce((n) => n + 1)
  }

  const go = useCallback((delta) => {
    if (!items.length) return
    const i = selIdx < 0 ? 0 : selIdx
    const next = items[Math.min(items.length - 1, Math.max(0, i + delta))]
    if (next) { setSelId(next.item_id); setStatus(null) }
  }, [items, selIdx])

  const advance = useCallback((fromId) => {
    // Next item after the one just saved that has no verdict yet; else stay.
    const i = items.findIndex((x) => x.item_id === fromId)
    const rest = [...items.slice(i + 1), ...items.slice(0, Math.max(0, i))]
    const next = rest.find((x) => x.item_id !== fromId && !verdictOf(x))
    if (next) setSelId(next.item_id)
  }, [items, verdictOf])

  async function save(verdict) {
    if (!sel || saving) return
    let drawings = null
    if (verdict === 'ok') drawings = seed
    else if (verdict === 'fixed') drawings = draft
    const drawingsJson = drawings ? JSON.stringify(drawings) : null
    if (drawingsJson && drawingsJson.length > MAX_DRAWINGS_BYTES) {
      setStatus({ kind: 'error', text: 'Too many drawings to save — remove some and try again.' })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const r = await fetch(`${ITEMS_URL}/${encodeURIComponent(sel.item_id)}/correction`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, drawings_json: drawingsJson, note: note.trim() || null }),
      })
      if (!r.ok) {
        setStatus({ kind: 'error', text: `Save failed (${r.status}). Nothing was recorded.` })
        return
      }
      const savedId = sel.item_id
      setLocalVerdicts((m) => ({ ...m, [savedId]: verdict }))
      setStatus({ kind: 'ok', text: `Saved ${sel.ticker}: ${VERDICT_LABEL[verdict]}.` })
      mutate()
      advance(savedId)
    } catch {
      setStatus({ kind: 'error', text: 'Save failed (network). Nothing was recorded.' })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ']') { e.preventDefault(); go(1) }
      else if (e.key === '[') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  if (error) {
    return <div className={styles.empty}>Could not load the gold set ({error.message}).</div>
  }
  if (!data) return <div className={styles.empty}>Loading the gold set…</div>
  if (allItems.length === 0) {
    return <div className={styles.empty}>No gold-set items loaded yet.</div>
  }

  const draftChanged = JSON.stringify(draft) !== JSON.stringify(seed)
  const selVerdict = sel ? verdictOf(sel) : null

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.progress} data-testid="gold-progress">
          {done} of {batchItems.length} reviewed{skipped ? ` · ${skipped} skipped` : ''}
        </span>
        {batches.length > 1 && (
          <select aria-label="Batch" className={styles.select} value={batch}
            onChange={(e) => { setBatch(e.target.value); setSelId(null) }}>
            <option value="">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <label className={styles.toggle}>
          <input type="checkbox" checked={hideReviewed}
            onChange={(e) => { setHideReviewed(e.target.checked); setSelId(null) }} />
          Hide reviewed
        </label>
      </div>

      <div className={styles.body}>
        <div className={styles.list}>
          {items.length === 0 && <div className={styles.empty}>Everything here is reviewed.</div>}
          {items.map((it) => {
            const v = verdictOf(it)
            return (
              <button key={it.item_id}
                className={`${styles.row} ${sel && it.item_id === sel.item_id ? styles.rowActive : ''}`}
                onClick={() => { setSelId(it.item_id); setStatus(null) }}>
                <span className={styles.rowSym}>{it.ticker}</span>
                <span className={styles.rowLabel}>{it.label || '—'}</span>
                <span className={styles.rowDate}>{it.asof_date}</span>
                <span className={v ? styles[`v_${v}`] : styles.vTodo}>{v ? VERDICT_LABEL[v] : 'to do'}</span>
              </button>
            )
          })}
        </div>

        <div className={styles.detail}>
          {sel && (
            <>
              <div className={styles.detailHead}>
                <span className={styles.detailSym} data-testid="gold-ticker">{sel.ticker}</span>
                <span className={styles.detailLabel}>{sel.label || 'unlabelled'}</span>
                <span className={styles.detailDate}>
                  {sel.start_date ? `${sel.start_date} → ` : ''}{sel.asof_date}
                </span>
                <span className={styles.position}>{selIdx + 1} / {items.length}</span>
              </div>
              <div className={styles.hint}>
                {seed.length
                  ? `Auto-drawn: ${seed.length} object${seed.length === 1 ? '' : 's'}. Drag to correct, then Save fix — or confirm as drawn.`
                  : 'No auto-drawn geometry for this item. Draw it, then Save fix.'}
                {selVerdict && ` Current verdict: ${VERDICT_LABEL[selVerdict]}.`}
              </div>

              <div className={styles.chartWrap}>
                <StockChart
                  sym={sel.ticker}
                  tf={sel.tf || 'D'}
                  liveUpdates={false}
                  showDrawingTools={false}
                  focusDate={sel.asof_date}
                  focusStartDate={sel.start_date || null}
                  focusNonce={focusNonce}
                  annotations={draft}
                  annotationsVisible
                  annotationsEditable
                  onAnnotationsChange={setDraft}
                />
              </div>

              <div className={styles.actions}>
                <button className={styles.ok} disabled={saving} onClick={() => save('ok')}>
                  Correct as drawn
                </button>
                <button className={styles.fixed} disabled={saving} onClick={() => save('fixed')}>
                  Save fix
                </button>
                <button className={styles.reject} disabled={saving} onClick={() => save('not_a_pattern')}>
                  Not a pattern
                </button>
                <button disabled={saving} onClick={() => save('skip')}>Skip</button>
                <button disabled={!draftChanged} onClick={() => setDraft(seed)}>Reset to auto-drawn</button>
                <span className={styles.nav}>
                  <button aria-label="Previous item" disabled={selIdx <= 0} onClick={() => go(-1)}>‹ Prev</button>
                  <button aria-label="Next item" disabled={selIdx >= items.length - 1} onClick={() => go(1)}>Next ›</button>
                </span>
              </div>
              {status && (
                <div role="status" className={status.kind === 'error' ? styles.err : styles.saved}>
                  {status.text}
                </div>
              )}
              <Textarea aria-label="Gold note"
                className={styles.note}
                placeholder="Optional note (what you changed, or why it is not the pattern)…"
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className={styles.keys}>Keys: [ previous · ] next</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StockChart from '../../../components/StockChart'
import CompanyLogo from '../../../components/CompanyLogo'
import UIcon from '../../../components/ui/UIcon'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { GRADES } from '../../../constants/setupGroups'
import styles from './ChartExampleKit.module.css'

// Parameterized extraction of the Setup Library "charted example" trio
// (SetupsView.jsx:342-807) so My Playbook can reuse the exact chart recipe.
// Instead of hardwired /api/modelbook fetches + isAdmin, callers supply:
//   api = {
//     create(body): Promise      — POST a new example (ExampleForm)
//     update(id, patch): Promise — PUT the full form body (ExampleForm edit)
//     patch(id, patchBody): Promise — partial PUT (annotations / migrations)
//     remove(id): Promise        — DELETE an example
//   }
//   canEdit — replaces isAdmin everywhere (annotate / edit / delete gates).
// v1 cut: the admin custom-bars CSV upload is OMITTED entirely — no
// barsOverride plumbing beyond passing undefined to StockChart.

// Entry/stop/target price-line colors (same palette as Throughout the Years).
const ENTRY_COLOR = '#1ae51a'   // exact bold candle green so the entry line matches the candles
const STOP_COLOR = '#ff5b5b'    // brighter red — reads clearly on the dark chart
const TARGET_COLOR = '#c9a84c'
// ONE module-level frozen empty array, reused whenever there are no price
// lines. A fresh [] per render re-runs StockChart's setData mid-zoom
// (background-chart flash) — identity stability is load-bearing.
const NO_PRICE_LINES = Object.freeze([])
// Watermarks are pinned top-left on every example chart, so there's no
// per-example position to persist. This stub stays wired as onWatermarkCommit
// purely so a stray drag can never fall through to writing the user's GLOBAL
// chart_settings watermark position (which would affect charts site-wide).
const NOOP_WATERMARK_COMMIT = () => { /* position is fixed top-left — nothing to save */ }

// Parse a stored drawings_json (chart annotations) → array; [] on missing/bad.
function parseDrawings(json) {
  if (!json) return []
  try { const d = JSON.parse(json); return Array.isArray(d) ? d : [] }
  catch { return [] }
}

// Cap horizontal rays at the setup's candle so they stop there instead of
// streaking to the right edge. rightBoundTime is injected at RENDER time only
// — never stored back into drawings_json.
function boundHrays(drawings, labelDate) {
  if (!labelDate) return drawings
  return drawings.map(d => (d.type === 'hray' ? { ...d, rightBoundTime: labelDate } : d))
}

// Default lead-up when no explicit zoom start is saved: ~80 trading bars
// (the old focus-zoom default) ≈ 120 calendar days before the setup day.
function isoDaysBefore(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// The ~50-prop StockChart recipe from SetupsView.jsx:752-802 as one pure
// helper. Returns every prop EXCEPT the two state-bound callbacks
// (onAnnotationsChange / onAnnotationsMigrate), which the consuming component
// wires itself. Callers rendering StockChart from this MUST memoize the result
// (ExampleBlock does) — the returned priceLines/annotations arrays need stable
// identity across unrelated re-renders or StockChart re-runs setData mid-zoom.
export function buildExampleChartProps(ex, { view = 'setup', annotating = false, draft = null } = {}) {
  // Frame: no setup day → calendar-year frame from `year`; with a setup day →
  // zoom start (or ~120 calendar days of lead-up) through the setup day as the
  // LAST candle. Result view swaps to the "after" window: result start
  // (default = the setup frame's left edge, so the pattern stays in view) →
  // result end, keeping bars after the exit.
  const year = ex.year || new Date().getFullYear()
  let frame
  if (!ex.label_date) {
    frame = { start: `${year}-01-01`, end: `${year}-12-31` }
  } else {
    const setupStart = ex.frame_start_date || isoDaysBefore(ex.label_date, 120)
    frame = (view === 'result' && ex.result_end_date)
      ? { start: ex.result_start_date || setupStart, end: ex.result_end_date }
      : { start: setupStart, end: ex.label_date }
  }

  // Setup annotations PERSIST into the Result view — they stay anchored to
  // their candles/prices; result-specific annotations layer additively on top.
  const setupD = boundHrays(parseDrawings(ex.drawings_json), ex.label_date)
  let drawings = setupD
  if (view === 'result') {
    const resultD = boundHrays(parseDrawings(ex.result_drawings_json), ex.label_date)
    drawings = resultD.length ? [...setupD, ...resultD] : setupD
  }

  const lines = []
  if (ex.entry_price != null) lines.push({ price: ex.entry_price, color: ENTRY_COLOR, lineStyle: 2, title: `Entry $${Number(ex.entry_price).toFixed(2)}` })
  if (ex.stop_price != null) lines.push({ price: ex.stop_price, color: STOP_COLOR, lineStyle: 2, title: `Stop $${Number(ex.stop_price).toFixed(2)}` })
  if (ex.target_price != null) lines.push({ price: ex.target_price, color: TARGET_COLOR, lineStyle: 2, title: `Target $${Number(ex.target_price).toFixed(2)}` })
  const priceLines = lines.length ? lines : NO_PRICE_LINES

  // NOTE: colorByNetChange is deliberately NOT passed — it is a dead prop
  // (zero hits in StockChart); cargo-culting it would just add noise.
  return {
    sym: ex.symbol,
    tf: ex.timeframe || 'D',
    height: '100%',
    liveUpdates: false,
    showDrawingTools: false,
    barsOverride: undefined,        // custom-bars upload cut from v1
    barsOverridePending: false,
    entryDate: frame.start,
    exitDate: frame.end,
    exactDateRange: true,
    frameRightPadFrac: 0.09,
    keepBarsAfterExit: view === 'result',
    fitPriceToCandles: true,
    frozen: !annotating,
    hideCrosshair: !annotating,
    hideLegend: !annotating,
    forceScaleMode: ex.scale_mode === 'log' ? 'log' : 'arith',
    boldCandles: true,
    hideLastValue: true,
    showVolume: true,
    volumeSeparatePane: true,
    markVolumeExtremes: true,
    volumePaneHeightPct: 12,
    volumeMa: 50,
    priceScaleTopMargin: 0.07,
    priceScaleBottomMargin: 0.07,
    watermarkOpacity: 0.82,
    watermarkX: 0,
    watermarkY: 0,
    watermarkPad: 24,
    watermarkCenterX: 175,
    onWatermarkCommit: NOOP_WATERMARK_COMMIT,
    watermarkName: ex.company || null,
    watermarkSector: ex.sector || null,
    watermarkIndustry: ex.industry || null,
    priceLines,
    hideJournalOverlay: true,
    annotations: annotating ? draft : (drawings.length ? drawings : null),
    annotationsVisible: annotating || drawings.length > 0,
    annotationsEditable: annotating,
    annotationsTextVisible: true,
    annotationsFadeWhole: false,
    candleFrameFade: false,
    instantFrameFlip: true,
    highlightBarTime: ex.label_date || null,
    highlightColor: '#ffffff',      // setup candle stays WHITE (Setup Library match)
  }
}

// Predictive ticker input backed by /api/ticker-search (same source as the
// Charts hub autocomplete). Picking a result also hands back the company name.
export function TickerSearchInput({ value, onChange, onPick }) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const timer = useRef(null)
  function handleChange(e) {
    const v = e.target.value.toUpperCase()
    onChange(v)
    clearTimeout(timer.current)
    if (!v.trim()) { setResults([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(v.trim())}&limit=8`, { credentials: 'include' })
        const j = await r.json()
        setResults(j?.results || [])
        setOpen(true)
      } catch { setResults([]) }
    }, 150)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className={styles.tickerSearch}>
      <input
        className={styles.exInput} value={value} placeholder="Ticker" required
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className={styles.tickerDrop}>
          {results.map(r => (
            <button
              key={r.ticker} type="button" className={styles.tickerRow}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(r); setOpen(false) }}
            >
              <span className={styles.tickerSym}>{r.ticker}</span>
              {r.name && <span className={styles.tickerName}>{r.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Add / edit a charted example. `initial` with an id → edit (api.update);
// otherwise create (api.create). The api wrappers must reject on failure —
// the form stays open with an inline error so nothing is silently lost.
export function ExampleForm({ initial, onSaved, onCancel, api }) {
  const isEdit = !!initial?.id
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(() => ({
    symbol: initial?.symbol || '',
    year: initial?.year || new Date().getFullYear(),
    timeframe: initial?.timeframe || 'D',
    scale_mode: initial?.scale_mode || 'arith',
    label_date: initial?.label_date || '',
    frame_start_date: initial?.frame_start_date || '',
    result_start_date: initial?.result_start_date || '',
    result_end_date: initial?.result_end_date || '',
    entry_price: initial?.entry_price ?? '',
    stop_price: initial?.stop_price ?? '',
    target_price: initial?.target_price ?? '',
    grade: initial?.grade || '',
    notes: initial?.notes || '',
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  // Picking the setup day auto-fills the chart year from it.
  function setLabelDate(v) {
    setForm(f => ({ ...f, label_date: v, year: v ? parseInt(v.slice(0, 4), 10) : f.year }))
  }
  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const num = v => (v === '' || v == null ? null : parseFloat(v))
      const body = {
        symbol: form.symbol.trim().toUpperCase(),
        year: parseInt(form.year, 10),
        timeframe: form.timeframe || 'D',
        scale_mode: form.scale_mode || 'arith',
        label_date: form.label_date || null,
        frame_start_date: form.frame_start_date || null,
        result_start_date: form.result_start_date || null,
        result_end_date: form.result_end_date || null,
        entry_price: num(form.entry_price),
        stop_price: num(form.stop_price),
        target_price: num(form.target_price),
        grade: form.grade || null,
        notes: form.notes || null,
      }
      if (isEdit) await api.update(initial.id, body)
      else await api.create(body)
      onSaved?.()
    } catch (err) {
      setError(err?.message || 'Save failed — check the fields and try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className={styles.exForm} onSubmit={submit}>
      <div className={styles.exFormRow}>
        <TickerSearchInput
          value={form.symbol}
          onChange={v => set('symbol', v)}
          onPick={r => set('symbol', r.ticker)}
        />
        <input className={styles.exInput} type="number" placeholder="Year" value={form.year} required
          onChange={e => set('year', e.target.value)} />
        <select className={styles.exInput} value={form.timeframe} onChange={e => set('timeframe', e.target.value)}
          title="Chart timeframe for this example">
          <option value="D">Daily</option>
          <option value="W">Weekly</option>
          <option value="M">Monthly</option>
        </select>
        <select className={styles.exInput} value={form.scale_mode} onChange={e => set('scale_mode', e.target.value)}
          title="Price-scale mode for this example's chart">
          <option value="arith">Arithmetic</option>
          <option value="log">Logarithmic</option>
        </select>
        <select className={styles.exInput} value={form.grade} onChange={e => set('grade', e.target.value)}>
          <option value="">Grade…</option>
          {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className={styles.exFormRow}>
        <label className={styles.exDateField}>
          <span className={styles.exDateLabel}>Setup day (last candle)</span>
          <input className={styles.exInput} type="date" value={form.label_date}
            onChange={e => setLabelDate(e.target.value)} />
        </label>
        <label className={styles.exDateField}>
          <span className={styles.exDateLabel}>Zoom start (optional)</span>
          <input className={styles.exInput} type="date" value={form.frame_start_date}
            max={form.label_date || undefined}
            onChange={e => set('frame_start_date', e.target.value)} />
        </label>
      </div>
      <div className={styles.exFormRow}>
        <label className={styles.exDateField}>
          <span className={styles.exDateLabel}>Result end — the “after” view (optional)</span>
          <input className={styles.exInput} type="date" value={form.result_end_date}
            min={form.label_date || undefined}
            onChange={e => set('result_end_date', e.target.value)} />
        </label>
        <label className={styles.exDateField}>
          <span className={styles.exDateLabel}>Result start (optional — defaults to zoom start)</span>
          <input className={styles.exInput} type="date" value={form.result_start_date}
            max={form.result_end_date || undefined}
            onChange={e => set('result_start_date', e.target.value)} />
        </label>
      </div>
      <div className={styles.exFormRow}>
        <input className={styles.exInput} type="number" step="0.01" placeholder="Entry" value={form.entry_price}
          onChange={e => set('entry_price', e.target.value)} />
        <input className={styles.exInput} type="number" step="0.01" placeholder="Stop" value={form.stop_price}
          onChange={e => set('stop_price', e.target.value)} />
        <input className={styles.exInput} type="number" step="0.01" placeholder="Target" value={form.target_price}
          onChange={e => set('target_price', e.target.value)} />
      </div>
      <textarea className={styles.exTextarea} placeholder="Notes — why this is a textbook example"
        value={form.notes} onChange={e => set('notes', e.target.value)} />
      {error && <div className={styles.exFormError}>{error}</div>}
      <div className={styles.exFormActions}>
        <button className={styles.exSaveBtn} type="submit" disabled={saving}>
          {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Save example')}
        </button>
        <button className={styles.exCancelBtn} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// One charted example: header strip + a chart framed ON the setup window
// (zoom start → setup day as the last candle), with the white setup candle,
// entry/stop/target lines, and drawing annotations saved per example.
export function ExampleBlock({ ex, canEdit, api, onChanged }) {
  // Show the company name beside the ticker. Prefer a curated `ex.company`
  // (SetupsView rows); fall back to the live ticker-meta name (same source
  // the watermark uses) so the header is never ticker-only.
  const meta = useTickerMeta(ex.company ? null : ex.symbol)
  const companyName = ex.company || meta.name || null
  const [annotating, setAnnotating] = useState(false)
  const [draft, setDraft] = useState([])
  const [editing, setEditing] = useState(false)
  // Setup vs Result carry SEPARATE annotation sets (drawings_json vs
  // result_drawings_json). The flip is an instant snap, so the annotation set
  // switches with it immediately (no lagged crossfade).
  const [view, setView] = useState('setup')
  const activeField = view === 'result' ? 'result_drawings_json' : 'drawings_json'
  // Legacy volume-pane annotations get re-anchored to the pane (paneRelY) once
  // the chart settles. Persist immediately when viewing; fold into the draft
  // (saved on Save) when authoring, so it never jumps onto the chart after a
  // Result flip. Mirrors SetupsView.jsx:558-566.
  const migrateDrawings = useCallback((next) => {
    if (annotating) { setDraft(next); return }
    if (!canEdit) return  // viewers can't persist — an owner view migrates it for everyone
    Promise.resolve(api.patch(ex.id, { [activeField]: JSON.stringify(next) }))
      .then(() => onChanged?.())
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotating, canEdit, ex.id, onChanged, activeField])

  const hasResult = !!(ex.result_end_date && ex.label_date)

  function startAnnotate() {
    setDraft(parseDrawings(ex[activeField]))
    setAnnotating(true)
  }
  async function saveAnnotations() {
    setAnnotating(false)
    await api.patch(ex.id, { [activeField]: JSON.stringify(draft) })
    onChanged?.()
  }
  async function del() {
    if (!window.confirm(`Remove the ${ex.symbol} ${ex.year} example?`)) return
    await api.remove(ex.id)
    onChanged?.()
  }

  // Memoized so priceLines/annotations keep a stable identity across
  // unrelated re-renders (fresh arrays re-run StockChart's setData mid-zoom).
  const chartProps = useMemo(
    () => buildExampleChartProps(ex, { view, annotating, draft }),
    [ex, view, annotating, draft],
  )

  return (
    <div className={styles.exBlock} id={`setup-ex-${ex.id}`}>
      <div className={styles.exBlockHead}>
        <CompanyLogo sym={ex.symbol} size={22} round name={companyName} alt={ex.data_symbol} />
        <span className={styles.exSym}>{ex.symbol}</span>
        {companyName && <span className={styles.exCo}>{companyName}</span>}
        <span className={styles.exYear}>{ex.year}</span>
        {ex.grade && <span className={styles.exGrade}>{ex.grade}</span>}
        {ex.advance_note && <span className={styles.exAdvanceText}>{ex.advance_note}</span>}
        <span className={styles.exTools}>
          {hasResult && (
            <span className={styles.exViewSwitch}>
              <button
                className={`${styles.exViewBtn} ${view === 'setup' ? styles.exViewBtnActive : ''}`}
                onClick={() => setView('setup')}
              >Setup</button>
              <button
                className={`${styles.exViewBtn} ${view === 'result' ? styles.exViewBtnActive : ''}`}
                onClick={() => setView('result')}
              >Result →</button>
            </span>
          )}
          {canEdit && !annotating && (
            <button className={styles.exTool} onClick={startAnnotate} title="Draw annotations on this example"><UIcon name="edit" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Annotate</button>
          )}
          {canEdit && annotating && (
            <>
              <button className={styles.exToolSave} onClick={saveAnnotations}>Save</button>
              <button className={styles.exTool} onClick={() => setAnnotating(false)}>Cancel</button>
            </>
          )}
          {canEdit && !annotating && (
            <button className={styles.exTool} onClick={() => setEditing(v => !v)}><UIcon name="edit" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Edit</button>
          )}
          {canEdit && !annotating && (
            <button className={styles.exToolDanger} onClick={del} title="Delete this example"><UIcon name="trash" size={14} /></button>
          )}
        </span>
      </div>
      {editing && (
        <ExampleForm
          initial={ex}
          api={api}
          onSaved={() => { setEditing(false); onChanged?.() }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className={styles.exChart}>
        <StockChart
          {...chartProps}
          onAnnotationsChange={setDraft}
          onAnnotationsMigrate={canEdit ? migrateDrawings : null}
        />
      </div>
      {ex.notes && <p className={styles.exNotes}>{ex.notes}</p>}
    </div>
  )
}

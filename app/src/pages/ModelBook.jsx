import { useState, useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import StockChart from '../components/StockChart'
import { useAuth } from '../context/AuthContext'
import { SETUP_GROUPS, SETUPS, GRADES } from '../constants/setupGroups'
import styles from './ModelBook.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// Year tabs always shown, even before any stocks are curated for them.
// Any year that has stocks (from the API) is unioned in on top of these.
const BASE_YEARS = [2025, 2024, 2023, 2022, 2021, 2020]

const ENTRY_COLOR = '#3cb868'
const STOP_COLOR = '#e74c3c'
const TARGET_COLOR = '#c9a84c'
const CATALYST_GOLD = '#e6b800'   // ⚡ catalyst markers + gold candle (matches StockChart's highlight gold)

// Stable empty reference for priceLines. Returning a fresh [] on every render
// gives StockChart a new prop identity each time the selected setup changes,
// which re-runs its updateChart (setData) mid-zoom — the "background chart"
// flash. Reusing one array keeps the reference stable when there are no lines.
const NO_PRICE_LINES = []

// Parse a setup's stored drawings_json (annotations) → array; [] on missing/bad.
function parseDrawings(json) {
  if (!json) return []
  try { const d = JSON.parse(json); return Array.isArray(d) ? d : [] }
  catch { return [] }
}

function fmtPrice(v) {
  return v == null ? '—' : `$${Number(v).toFixed(2)}`
}

function fmtVol(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(Math.round(n))
}

function pctStr(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${Math.round(v)}%`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
function ordinal(d) {
  const rem100 = d % 100
  if (rem100 >= 11 && rem100 <= 13) return `${d}th`
  switch (d % 10) {
    case 1: return `${d}st`
    case 2: return `${d}nd`
    case 3: return `${d}rd`
    default: return `${d}th`
  }
}
// label_date is ISO "YYYY-MM-DD" — parse the parts directly (no Date(), which
// would shift to the prior day under negative UTC offsets). → "August 22nd".
function fmtSetupDate(dateStr) {
  if (!dateStr) return ''
  const [, mm, dd] = dateStr.split('-')
  const month = MONTHS[parseInt(mm, 10) - 1]
  const day = parseInt(dd, 10)
  return month && day ? `${month} ${ordinal(day)}` : ''
}

// ── Earnings table (per-quarter EPS + revenue vs estimate for the year) ───────
// "Reported" is the report date → "May 2020". Surprise % cells are colored.
function fmtReported(dateStr) {
  if (!dateStr) return '—'
  const [y, m] = dateStr.split('-')
  const mon = MONTHS[parseInt(m, 10) - 1]
  return mon ? `${mon.slice(0, 3)} ${y}` : (y || '—')
}
function fmtEps(v) {
  return v == null ? '—' : Number(v).toFixed(2)
}
function fmtRevenue(v) {
  if (v == null) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
// Surprise % → display text + up/down sign for coloring.
function pctCell(v) {
  if (v == null) return { text: '—', dir: 0 }
  const r = Math.round(v)
  return { text: `${r >= 0 ? '+' : ''}${r.toLocaleString()}%`, dir: r >= 0 ? 1 : -1 }
}

// Label a row by fiscal quarter ("Q1 2025"); fall back to the report month.
function fmtQuarter(r) {
  return (r.quarter && r.year) ? `Q${r.quarter} ${r.year}` : fmtReported(r.date)
}

function EarningsTable({ rows, loading }) {
  if (loading) return <p className={styles.noSetups}>Loading earnings…</p>
  if (!rows.length) return <p className={styles.noSetups}>No earnings reports found for this year.</p>
  return (
    <table className={styles.earnTable}>
      <thead>
        <tr>
          <th className={styles.earnTh}>Quarter</th>
          <th className={styles.earnTh}>EPS</th>
          <th className={styles.earnTh}>% Chg</th>
          <th className={styles.earnTh}>Revenue</th>
          <th className={styles.earnTh}>% Chg</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const eps = pctCell(r.eps_surprise_pct)
          const rev = pctCell(r.revenue_surprise_pct)
          const dirCls = d => (d > 0 ? styles.earnUp : d < 0 ? styles.earnDown : '')
          return (
            <tr key={(r.quarter ?? r.date) || i}>
              <td className={`${styles.earnTd} ${styles.earnReported}`}>{fmtQuarter(r)}</td>
              <td className={styles.earnTd}>{fmtEps(r.eps_actual)}</td>
              <td className={`${styles.earnTd} ${dirCls(eps.dir)}`}>{eps.text}</td>
              <td className={styles.earnTd}>{fmtRevenue(r.revenue_actual)}</td>
              <td className={`${styles.earnTd} ${dirCls(rev.dir)}`}>{rev.text}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Admin: add a curated stock to a year ──────────────────────────────────────
function AddStockForm({ year, onAdded }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const empty = { year, symbol: '', company: '', sort_order: '', gain_pct: '', thesis: '' }
  const [form, setForm] = useState(empty)

  useEffect(() => { setForm(f => ({ ...f, year })) }, [year])

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        year: parseInt(form.year, 10),
        symbol: form.symbol.trim().toUpperCase(),
        company: form.company || null,
        sort_order: form.sort_order === '' ? 0 : parseInt(form.sort_order, 10),
        gain_pct: form.gain_pct === '' ? null : parseFloat(form.gain_pct),
        thesis: form.thesis || null,
      }
      const r = await fetch('/api/modelbook/stocks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        setForm({ ...empty, year: form.year })
        setOpen(false)
        onAdded?.()
      }
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ Add Stock</button>
  }
  return (
    <form className={styles.adminForm} onSubmit={submit}>
      <div className={styles.formRow}>
        <input className={styles.input} type="number" placeholder="Year" value={form.year}
          onChange={e => setForm(f => ({ ...f, year: e.target.value }))} required />
        <input className={styles.input} placeholder="Ticker" value={form.symbol}
          onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} required />
        <input className={styles.input} placeholder="Company" value={form.company}
          onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
        <input className={styles.input} type="number" placeholder="Rank" value={form.sort_order}
          onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
        <input className={styles.input} type="number" step="0.1" placeholder="Gain %" value={form.gain_pct}
          onChange={e => setForm(f => ({ ...f, gain_pct: e.target.value }))} />
      </div>
      <textarea className={styles.textarea} placeholder="Why it's a model stock (thesis)" value={form.thesis}
        onChange={e => setForm(f => ({ ...f, thesis: e.target.value }))} />
      <div className={styles.formActions}>
        <button className={styles.saveBtn} type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Stock'}</button>
        <button className={styles.cancelBtn} type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

// ── Admin: shared add/edit form for a labeled setup ───────────────────────────
// `initial` with an id → edit mode (PUT); otherwise create mode (POST).
function SetupForm({ stockId, year, initial, onSaved, onCancel }) {
  const isEdit = !!initial?.id
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => ({
    setup_type: initial?.setup_type || '',
    label_date: initial?.label_date || '',
    frame_start_date: initial?.frame_start_date || '',
    timeframe: initial?.timeframe || 'D',
    entry_price: initial?.entry_price ?? '',
    stop_price: initial?.stop_price ?? '',
    target_price: initial?.target_price ?? '',
    grade: initial?.grade || '',
    notes: initial?.notes || '',
  }))
  // Free-text fallback when the desired setup isn't in SETUP_GROUPS. Starts on
  // automatically when editing a setup whose type was typed in (not a known one).
  const [customSetup, setCustomSetup] = useState(
    () => !!initial?.setup_type && !SETUPS.includes(initial.setup_type),
  )

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const num = v => (v === '' || v == null ? null : parseFloat(v))
      const body = {
        setup_type: form.setup_type,
        label_date: form.label_date,
        frame_start_date: form.frame_start_date || null,
        timeframe: form.timeframe,
        entry_price: num(form.entry_price),
        stop_price: num(form.stop_price),
        target_price: num(form.target_price),
        grade: form.grade || null,
        notes: form.notes || null,
      }
      const url = isEdit ? `/api/modelbook/setup/${initial.id}` : `/api/modelbook/stock/${stockId}/setups`
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.adminForm} onSubmit={submit}>
      <div className={styles.formRow}>
        {customSetup ? (
          <div className={styles.setupCell}>
            <input className={styles.input} type="text" required autoFocus
              placeholder="Custom setup name" value={form.setup_type}
              onChange={e => setForm(f => ({ ...f, setup_type: e.target.value }))} />
            <button type="button" className={styles.toggleLink}
              onClick={() => { setCustomSetup(false); setForm(f => ({ ...f, setup_type: '' })) }}>
              ← Pick from list
            </button>
          </div>
        ) : (
          <select className={styles.input} value={form.setup_type} required
            onChange={e => {
              const v = e.target.value
              if (v === '__custom__') { setCustomSetup(true); setForm(f => ({ ...f, setup_type: '' })) }
              else setForm(f => ({ ...f, setup_type: v }))
            }}>
            <option value="">Setup…</option>
            {SETUP_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.setups.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
            <option value="__custom__">+ Custom setup…</option>
          </select>
        )}
        <select className={styles.input} value={form.timeframe}
          onChange={e => setForm(f => ({ ...f, timeframe: e.target.value }))}>
          <option value="D">Daily</option>
          <option value="W">Weekly</option>
        </select>
        <select className={styles.input} value={form.grade}
          onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}>
          <option value="">Grade…</option>
          {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className={styles.formRow}>
        <label className={styles.dateField}>
          <span className={styles.dateLabel}>Setup day (last candle)</span>
          <input className={styles.input} type="date" value={form.label_date}
            min={`${year}-01-01`} max={`${year}-12-31`} required
            onChange={e => setForm(f => ({ ...f, label_date: e.target.value }))} />
        </label>
        <label className={styles.dateField}>
          <span className={styles.dateLabel}>Zoom start (optional)</span>
          {/* No `min`: the zoom frame may begin in a PRIOR year (e.g. a base that
              started in 2024 for a 2025 setup). Pinning min to the book year also
              made the native month segment auto-commit "01" — leaving min off lets
              the year drop below `max`, so two-digit months (10/11/12) type freely.
              `max` still keeps the zoom start on/before the setup day. */}
          <input className={styles.input} type="date" value={form.frame_start_date}
            max={form.label_date || `${year}-12-31`}
            onChange={e => setForm(f => ({ ...f, frame_start_date: e.target.value }))} />
        </label>
      </div>
      <div className={styles.formRow}>
        <input className={styles.input} type="number" step="0.01" placeholder="Entry" value={form.entry_price}
          onChange={e => setForm(f => ({ ...f, entry_price: e.target.value }))} />
        <input className={styles.input} type="number" step="0.01" placeholder="Stop" value={form.stop_price}
          onChange={e => setForm(f => ({ ...f, stop_price: e.target.value }))} />
        <input className={styles.input} type="number" step="0.01" placeholder="Target" value={form.target_price}
          onChange={e => setForm(f => ({ ...f, target_price: e.target.value }))} />
      </div>
      <textarea className={styles.textarea} placeholder="Teaching notes — why this setup worked / failed" value={form.notes}
        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      <div className={styles.formActions}>
        <button className={styles.saveBtn} type="submit" disabled={saving}>
          {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Save Setup')}
        </button>
        <button className={styles.cancelBtn} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ── Admin: "+ Label Setup" toggle that opens the create form ──────────────────
function AddSetupForm({ stockId, year, onAdded }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ Label Setup</button>
  }
  return (
    <SetupForm
      stockId={stockId}
      year={year}
      onSaved={() => { setOpen(false); onAdded?.() }}
      onCancel={() => setOpen(false)}
    />
  )
}

// ── Admin: add/edit a single catalyst ─────────────────────────────────────────
// `initial` with an id → edit mode (PUT); otherwise create mode (POST).
function CatalystForm({ stockId, year, initial, onSaved, onCancel }) {
  const isEdit = !!initial?.id
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => ({
    catalyst_date: initial?.catalyst_date || '',
    title: initial?.title || '',
    description: initial?.description || '',
    move_pct: initial?.move_pct ?? '',
  }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        catalyst_date: form.catalyst_date,
        title: form.title.trim(),
        description: form.description || null,
        move_pct: form.move_pct === '' ? null : parseFloat(form.move_pct),
        source: initial?.source || 'manual',
      }
      const url = isEdit ? `/api/modelbook/catalyst/${initial.id}` : `/api/modelbook/stock/${stockId}/catalysts`
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.adminForm} onSubmit={submit}>
      <input className={styles.input} type="text" required autoFocus
        placeholder="Catalyst (e.g. Q3 earnings beat)" value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
      <div className={styles.formRow}>
        <label className={styles.dateField}>
          <span className={styles.dateLabel}>Date</span>
          <input className={styles.input} type="date" required value={form.catalyst_date}
            min={`${year}-01-01`} max={`${year}-12-31`}
            onChange={e => setForm(f => ({ ...f, catalyst_date: e.target.value }))} />
        </label>
        <label className={styles.dateField}>
          <span className={styles.dateLabel}>Move %</span>
          <input className={styles.input} type="number" step="0.1" placeholder="e.g. 18.5" value={form.move_pct}
            onChange={e => setForm(f => ({ ...f, move_pct: e.target.value }))} />
        </label>
      </div>
      <textarea className={styles.textarea} placeholder="What happened and why it moved the stock" value={form.description}
        onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      <div className={styles.formActions}>
        <button className={styles.saveBtn} type="submit" disabled={saving}>
          {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Save catalyst')}
        </button>
        <button className={styles.cancelBtn} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function AddCatalystForm({ stockId, year, onAdded }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ Add</button>
  }
  return (
    <CatalystForm
      stockId={stockId}
      year={year}
      onSaved={() => { setOpen(false); onAdded?.() }}
      onCancel={() => setOpen(false)}
    />
  )
}

// ── Stock detail: chart with setups labeled + the setup list ──────────────────
function StockDetail({ stockId, isAdmin }) {
  const { data: stock, mutate } = useSWR(
    stockId ? `/api/modelbook/stock/${stockId}` : null, fetcher,
    {
      revalidateOnFocus: false,
      // Poll while year stats (avg vol) are warming or descriptions haven't been
      // attempted yet (desc_at unset). Stops once an attempt is recorded.
      refreshInterval: (d) => (d && !d.error && (d.avg_vol == null || (!d.company_desc && !d.desc_at))) ? 5000 : 0,
    },
  )
  // Chronological so the list reads as a time-ordered guide to the buy spots
  // (e.g. Flat Base Breakout · Aug → High Tight Flag · Oct → · Nov).
  const setups = useMemo(
    () => (stock?.setups || []).slice().sort((a, b) => (a.label_date || '').localeCompare(b.label_date || '')),
    [stock],
  )
  const [pickedSetupId, setPickedSetupId] = useState(null)
  const [editingSetupId, setEditingSetupId] = useState(null)  // admin: setup row being edited inline
  // Right panel: Setups | Catalysts tab. Persisted + survives stock switches.
  const [panelTab, setPanelTab] = useState(() => {
    try { return localStorage.getItem('modelbook_panel_tab') === 'catalysts' ? 'catalysts' : 'setups' } catch { return 'setups' }
  })
  const [editingCatalystId, setEditingCatalystId] = useState(null)  // admin: catalyst row being edited inline
  const [genningCats, setGenningCats] = useState(false)             // admin: AI catalyst generation in flight
  const [catError, setCatError] = useState('')                     // generation error message
  const [annotateMode, setAnnotateMode] = useState(false)     // admin: drawing annotations on the focused setup
  const [annotationDraft, setAnnotationDraft] = useState([])  // working annotation set while in annotate mode
  // "Show all" overlay: render every setup's annotations on the zoomed-out chart.
  // Persisted (and survives stock switches, since StockDetail isn't remounted) so
  // it stays on as you browse from stock to stock until explicitly turned off.
  const [showAllAnnotations, setShowAllAnnotations] = useState(() => {
    try { return localStorage.getItem('modelbook_show_all_annotations') === '1' } catch { return false }
  })
  function toggleShowAll() {
    setShowAllAnnotations(v => {
      const nv = !v
      try { localStorage.setItem('modelbook_show_all_annotations', nv ? '1' : '0') } catch { /* ignore */ }
      return nv
    })
  }
  // Animated chart focus: which setup the chart is zoomed into + a nonce that
  // bumps on every click so re-clicking the same setup still re-fires the zoom.
  // stockId/tf are stamped so the focus auto-invalidates (derived below) when
  // the stock or timeframe changes.
  const [focus, setFocus] = useState({ id: null, date: null, startDate: null, nonce: 0, stockId: null, tf: null })
  const [chartTf, setChartTf] = useState('D')
  const [infoOpen, setInfoOpen] = useState(true)
  const [editNarr, setEditNarr] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [storyDraft, setStoryDraft] = useState('')

  // When the user switches to a DIFFERENT stock, hard-clear the prior stock's
  // focus + annotation state. Stamping stockId on `focus` only DEACTIVATES it
  // while you're on another stock (focusActive guard below) — but returning to
  // the original stock would re-satisfy `focus.stockId === stockId` and
  // REACTIVATE the stale zoom, leaving annotations on the zoomed-out chart.
  // Clearing on stockId change makes the focus unrecoverable. This is React's
  // "reset state when a prop changes" idiom (setState during render via a
  // previous-value tracker) — no extra paint, and no visible flash since the
  // focusActive guard has already hidden annotations for the new stock by
  // render time. `nonce` is left unchanged so the chart's focus effect doesn't
  // fire a stray zoom animation on the freshly-loaded stock.
  const [prevStockId, setPrevStockId] = useState(stockId)
  if (stockId !== prevStockId) {
    setPrevStockId(stockId)
    setFocus(f => ({ id: null, date: null, startDate: null, nonce: f.nonce, stockId: null, tf: null }))
    setPickedSetupId(null)
    setAnnotateMode(false)
    setAnnotationDraft([])
    setEditingSetupId(null)
    setEditingCatalystId(null)
    setCatError('')
  }
  // Derived: the picked setup if still present, else the first one (so its
  // price lines show by default). Avoids a setState-in-effect on stock change.
  const selectedSetupId = (pickedSetupId != null && setups.some(s => s.id === pickedSetupId))
    ? pickedSetupId
    : (setups[0]?.id ?? null)

  const priceLines = useMemo(() => {
    const s = setups.find(x => x.id === selectedSetupId)
    if (!s) return NO_PRICE_LINES
    const lines = []
    if (s.entry_price != null) lines.push({ price: s.entry_price, color: ENTRY_COLOR, lineStyle: 2, title: `Entry ${fmtPrice(s.entry_price)}` })
    if (s.stop_price != null) lines.push({ price: s.stop_price, color: STOP_COLOR, lineStyle: 2, title: `Stop ${fmtPrice(s.stop_price)}` })
    if (s.target_price != null) lines.push({ price: s.target_price, color: TARGET_COLOR, lineStyle: 2, title: `Target ${fmtPrice(s.target_price)}` })
    return lines.length ? lines : NO_PRICE_LINES
  }, [setups, selectedSetupId])

  // Click a setup → select it (price lines) and smoothly zoom the chart so the
  // setup's day is the last candle on screen. Click the same setup again to
  // zoom back out to the full year.
  function onSetupClick(s) {
    if (annotateMode) return  // lock setup switching while drawing; Save/Cancel first
    setPickedSetupId(s.id)
    setFocus(f => {
      // sameTarget only when currently zoomed IN on this setup (date set). On
      // toggle-off we KEEP the id (date=null) so its drawings can fade out; a
      // re-click then re-focuses it.
      const sameTarget = f.id === s.id && f.date != null && f.stockId === stockId && f.tf === chartTf
      return sameTarget
        ? { id: s.id, date: null, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
        : { id: s.id, date: s.label_date, startDate: s.frame_start_date || null, nonce: f.nonce + 1, stockId, tf: chartTf }
    })
  }
  // A focus only applies to the stock + timeframe it was set on; switching either
  // drops the zoom request (the chart re-frames the year on its own).
  const focusActive = focus.stockId === stockId && focus.tf === chartTf
  const focusDate = focusActive ? focus.date : null
  const focusStartDate = focusActive ? focus.startDate : null

  // ── Per-setup annotations ──
  // The focused setup (id retained through zoom-out so its drawings fade rather
  // than vanish). Drawings render when zoomed in and fade out on zoom-out.
  const focusedSetup = focusActive && focus.id != null ? setups.find(s => s.id === focus.id) : null
  const savedDrawings = useMemo(() => parseDrawings(focusedSetup?.drawings_json), [focusedSetup])

  // "Show all": every setup's drawings overlaid on the (zoomed-out) chart. Each
  // setup's horizontal rays get a rightBoundTime of that setup's candle so they
  // stop at the setup instead of streaking across the whole year when zoomed out.
  const allDrawings = useMemo(() => setups.flatMap(s => {
    const ds = parseDrawings(s.drawings_json)
    return s.label_date
      ? ds.map(d => (d.type === 'hray' ? { ...d, rightBoundTime: s.label_date } : d))
      : ds
  }), [setups])
  const hasAnnotations = allDrawings.length > 0
  // All setup days — painted gold on the chart while "show all" is on so each
  // setup candle stands out alongside its annotations. Stable ref for StockChart.
  const setupTimes = useMemo(() => setups.map(s => s.label_date).filter(Boolean), [setups])

  // Precedence: admin authoring > show-all overlay > single-setup focus.
  let annotations, annotationsVisible
  if (annotateMode) {
    annotations = annotationDraft
    annotationsVisible = true
  } else if (showAllAnnotations) {
    annotations = allDrawings
    annotationsVisible = true
  } else {
    annotations = focusedSetup ? savedDrawings : null
    annotationsVisible = !!focusDate
  }

  // ── Catalysts ──
  // The year's most impactful, move-driving events (AI-generated, admin-editable).
  // Ordered by the API (sort_order). Shown as gold ⚡ markers + gold candles when
  // the Catalysts tab is active; clicking one zooms to it.
  const catalysts = useMemo(() => stock?.catalysts || [], [stock])
  const catalystMarkers = useMemo(() => catalysts
    .filter(c => c.catalyst_date)
    .map(c => ({
      time: c.catalyst_date,
      position: 'aboveBar',
      color: CATALYST_GOLD,
      shape: 'circle',
      text: c.title || (c.move_pct != null ? `${c.move_pct >= 0 ? '+' : ''}${Math.round(c.move_pct)}%` : ''),
      size: 2,
    })), [catalysts])
  const catalystTimes = useMemo(() => catalysts.map(c => c.catalyst_date).filter(Boolean), [catalysts])

  const onCatalystTab = panelTab === 'catalysts'
  const onSetupsTab = !onCatalystTab
  // The chart shows setup overlays on the Setups tab and catalyst markers on the
  // Catalysts tab — never both.
  const chartMarkers = onCatalystTab && catalystMarkers.length ? catalystMarkers : null
  const chartPriceLines = onSetupsTab ? priceLines : NO_PRICE_LINES
  const chartAnnotations = onSetupsTab ? annotations : null
  const chartAnnotationsVisible = onSetupsTab ? annotationsVisible : false
  const chartAnnotateMode = onSetupsTab ? annotateMode : false
  const chartHighlight = onCatalystTab
    ? (catalystTimes.length ? catalystTimes : focusDate)
    : (showAllAnnotations && hasAnnotations ? setupTimes : focusDate)

  // Quarterly earnings for the year — fetched for EVERY stock (the table is a
  // permanent overlay on the chart, not a tab). Finnhub-backed + cached server-side.
  const { data: earningsData } = useSWR(
    stock?.symbol
      ? `/api/modelbook/year-earnings?symbol=${encodeURIComponent(stock.symbol)}&year=${stock.year}`
      : null,
    fetcher, { revalidateOnFocus: false },
  )
  const earningsRows = useMemo(() => earningsData?.rows || [], [earningsData])

  // Switch the right-panel tab. Zoom the chart back out to the full year so the
  // new tab shows its overview; only animate when currently zoomed in.
  function selectTab(tab) {
    if (tab === panelTab) return
    setPanelTab(tab)
    try { localStorage.setItem('modelbook_panel_tab', tab) } catch { /* ignore */ }
    setAnnotateMode(false)
    setAnnotationDraft([])
    setCatError('')
    setFocus(f => (f.date != null
      ? { id: null, date: null, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
      : { id: null, date: null, startDate: null, nonce: f.nonce, stockId: null, tf: null }))
  }

  // Click a catalyst → zoom so its day is the last candle; click again to zoom out.
  function onCatalystClick(c) {
    setFocus(f => {
      const sameTarget = f.id === c.id && f.date != null && f.stockId === stockId && f.tf === chartTf
      return sameTarget
        ? { id: c.id, date: null, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
        : { id: c.id, date: c.catalyst_date, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
    })
  }

  async function generateCatalysts() {
    // Catalysts persist in the DB forever once generated; regenerating re-runs
    // the AI (spends tokens), so it's gated behind a confirm + an explicit force.
    const isRegen = catalysts.length > 0
    if (isRegen && !window.confirm('Regenerate catalysts? This re-runs the AI (spends tokens) and replaces the current set.')) return
    setCatError('')
    setGenningCats(true)
    try {
      const url = `/api/modelbook/stock/${stock.id}/catalysts/generate${isRegen ? '?force=true' : ''}`
      const r = await fetch(url, { method: 'POST', credentials: 'include' })
      if (r.ok) mutate()
      else {
        const e = await r.json().catch(() => ({}))
        setCatError(e.detail || 'Could not generate catalysts. Try again.')
      }
    } catch {
      setCatError('Could not generate catalysts. Try again.')
    } finally {
      setGenningCats(false)
    }
  }

  async function deleteCatalyst(id) {
    await fetch(`/api/modelbook/catalyst/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }

  function startAnnotate() {
    setAnnotationDraft(savedDrawings)
    setAnnotateMode(true)
  }
  function cancelAnnotate() {
    setAnnotateMode(false)
    setAnnotationDraft([])
  }
  async function saveAnnotations() {
    if (focus.id == null) return
    await fetch(`/api/modelbook/setup/${focus.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawings_json: JSON.stringify(annotationDraft) }),
    })
    setAnnotateMode(false)
    setAnnotationDraft([])
    mutate()
  }

  async function deleteSetup(id) {
    await fetch(`/api/modelbook/setup/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }

  async function saveNarrative() {
    await fetch(`/api/modelbook/stock/${stock.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_desc: descDraft, run_story: storyDraft }),
    })
    setEditNarr(false)
    mutate()
  }

  if (!stockId) {
    return <div className={styles.emptyDetail}><p>Select a stock to view its chart and labeled setups.</p></div>
  }
  if (!stock) return <div className={styles.loading}>Loading…</div>
  if (stock.error) return <div className={styles.loading}>Not found.</div>

  return (
    <div className={styles.detail}>
      <div className={styles.dvTop}>
      <div className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailName}>
            {stock.symbol}
            {stock.company && <span className={styles.detailNameCo}>({stock.company})</span>}
            <button
              className={styles.infoToggle}
              onClick={() => setInfoOpen(v => !v)}
              title={infoOpen ? 'Hide details' : 'Show details'}
              aria-label="Toggle stock details"
            >{infoOpen ? '▾' : '▸'}</button>
            {stock.gain_pct != null && (
              <span className={styles.detailGain}>{stock.gain_pct >= 0 ? '+' : ''}{Math.round(stock.gain_pct)}%</span>
            )}
          </h2>
        </div>
        <div className={styles.headerTools}>
          {/* Annotate: only when admin has a setup zoomed in (Setups tab). */}
          {isAdmin && onSetupsTab && focusDate && !annotateMode && (
            <button className={styles.annotateBtn} onClick={startAnnotate} title="Draw annotations on this setup">✏️ Annotate</button>
          )}
          {isAdmin && annotateMode && (
            <>
              <button className={styles.annotateSave} onClick={saveAnnotations}>Save</button>
              <button className={styles.annotateCancel} onClick={cancelAnnotate}>Cancel</button>
            </>
          )}
          <div className={styles.tfToggle}>
            <button className={`${styles.tfBtn} ${chartTf === 'D' ? styles.tfBtnActive : ''}`} onClick={() => setChartTf('D')}>D</button>
            <button className={`${styles.tfBtn} ${chartTf === 'W' ? styles.tfBtnActive : ''}`} onClick={() => setChartTf('W')}>W</button>
          </div>
        </div>
      </div>

      <div className={styles.dvBody}>
        <div className={styles.chartWrap}>
          <StockChart
            sym={stock.symbol}
            tf={chartTf}
            height="100%"
            liveUpdates={false}
            showDrawingTools={false}
            entryDate={`${stock.year}-01-01`}
            exitDate={`${stock.year}-12-31`}
            exactDateRange
            forceLogScale
            boldCandles
            hideLastValue
            showVolume
            volumeSeparatePane
            markVolumeExtremes
            volumePaneHeightPct={18}
            volumeMa={50}
            priceScaleTopMargin={0.14}
            priceScaleBottomMargin={0.06}
            watermarkOpacity={0.13}
            priceLines={chartPriceLines}
            markers={chartMarkers}
            focusDate={focusDate}
            focusStartDate={focusStartDate}
            focusNonce={focus.nonce}
            annotations={chartAnnotations}
            annotationsVisible={chartAnnotationsVisible}
            annotationsEditable={chartAnnotateMode}
            onAnnotationsChange={setAnnotationDraft}
            highlightBarTime={chartHighlight}
            onFocusEscape={() => setFocus(f => ({ ...f, date: null, startDate: null }))}
            className={styles.chart}
          />
        </div>

        {infoOpen && (
          <aside className={styles.infoSide}>
            <div className={styles.statsRow}>
              <div className={styles.infoStatsV}>
                <div className={styles.infoStat}>
                  <span className={styles.infoStatLabel}>{stock.year} Gain</span>
                  <span className={`${styles.infoStatVal} ${stock.oc_pct != null ? styles.infoStatGreen : ''}`}>{pctStr(stock.oc_pct)}</span>
                </div>
                <div className={styles.infoStat}>
                  <span className={styles.infoStatLabel}>Low → High</span>
                  <span className={`${styles.infoStatVal} ${stock.lh_pct != null ? styles.infoStatGreen : ''}`}>{pctStr(stock.lh_pct)}</span>
                </div>
                <div className={styles.infoStat}>
                  <span className={styles.infoStatLabel}>Avg Daily $ Vol</span>
                  <span className={styles.infoStatVal}>{stock.avg_vol == null ? '—' : `$${fmtVol(stock.avg_vol)}`}</span>
                </div>
              </div>
              {earningsRows.length > 0 && (
                <div className={styles.earnPanel}>
                  <div className={styles.earnPanelHead}>{stock.year} Earnings</div>
                  <EarningsTable rows={earningsRows} />
                </div>
              )}
            </div>

            <div className={styles.infoNarrative}>
              {editNarr ? (
                <>
                  <span className={styles.sectionLabel}>WHAT THE COMPANY DOES</span>
                  <textarea className={styles.textarea} style={{ minHeight: 50 }} value={descDraft}
                    placeholder="One sentence on what the company does"
                    onChange={e => setDescDraft(e.target.value)} />
                  <span className={styles.sectionLabel} style={{ marginTop: 8, display: 'inline-block' }}>WHY IT RAN THAT YEAR</span>
                  <textarea className={styles.textarea} style={{ minHeight: 110 }} value={storyDraft}
                    placeholder="Catalysts, drivers, the theme behind the move"
                    onChange={e => setStoryDraft(e.target.value)} />
                  <div className={styles.formActions}>
                    <button className={styles.saveBtn} onClick={saveNarrative}>Save</button>
                    <button className={styles.cancelBtn} onClick={() => setEditNarr(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  {stock.company_desc && <p className={styles.infoDesc}>{stock.company_desc}</p>}
                  {stock.run_story && <p className={styles.infoStory}>{stock.run_story}</p>}
                  {!stock.company_desc && !stock.run_story && !stock.desc_at &&
                    <p className={styles.infoStoryMuted}>Generating summary…</p>}
                  {isAdmin && (
                    <button className={styles.infoEditLink}
                      onClick={() => { setDescDraft(stock.company_desc || ''); setStoryDraft(stock.run_story || ''); setEditNarr(true) }}>
                      edit
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Setups (buy spots) + Catalysts (move-driving events) — two tabbed
                guides to the chart. Click a row to focus/zoom that point. */}
            <div className={styles.panelSetups}>
              <div className={styles.setupSectionHead}>
                <div className={styles.panelTabs}>
                  <button className={`${styles.panelTab} ${onSetupsTab ? styles.panelTabActive : ''}`}
                    onClick={() => selectTab('setups')}>
                    Setups{setups.length ? ` (${setups.length})` : ''}
                  </button>
                  <button className={`${styles.panelTab} ${onCatalystTab ? styles.panelTabActive : ''}`}
                    onClick={() => selectTab('catalysts')}>
                    Catalysts{catalysts.length ? ` (${catalysts.length})` : ''}
                  </button>
                </div>
                <div className={styles.setupHeadTools}>
                  {onSetupsTab && hasAnnotations && (
                    <button
                      className={`${styles.showAllToggle} ${showAllAnnotations ? styles.showAllToggleOn : ''}`}
                      onClick={toggleShowAll}
                      aria-pressed={showAllAnnotations}
                      title={showAllAnnotations
                        ? 'Hide setup annotations (only show on click)'
                        : 'Show every setup’s annotations on the chart'}
                    >
                      <span className={styles.showAllTrack}><span className={styles.showAllKnob} /></span>
                      Show all
                    </button>
                  )}
                  {onSetupsTab && isAdmin && <AddSetupForm stockId={stock.id} year={stock.year} onAdded={mutate} />}
                  {onCatalystTab && isAdmin && (
                    <>
                      <button className={styles.annotateBtn} onClick={generateCatalysts} disabled={genningCats}
                        title="Find this year's most impactful catalysts with AI">
                        {genningCats ? 'Generating…' : (catalysts.length ? '↻ Regenerate' : '✨ Generate')}
                      </button>
                      <AddCatalystForm stockId={stock.id} year={stock.year} onAdded={mutate} />
                    </>
                  )}
                </div>
              </div>

              {onCatalystTab ? (
                <>
                  {catError && <p className={styles.catError}>{catError}</p>}
                  {catalysts.length === 0 ? (
                    <p className={styles.noSetups}>
                      {isAdmin
                        ? 'No catalysts yet — use ✨ Generate to find this year’s biggest movers.'
                        : 'No catalysts labeled for this year yet.'}
                    </p>
                  ) : (
                    <div className={styles.setupListC}>
                      {catalysts.map(c => (
                        editingCatalystId === c.id ? (
                          <CatalystForm
                            key={c.id}
                            stockId={stock.id}
                            year={stock.year}
                            initial={c}
                            onSaved={() => { setEditingCatalystId(null); mutate() }}
                            onCancel={() => setEditingCatalystId(null)}
                          />
                        ) : (
                          <div
                            key={c.id}
                            className={styles.catRow}
                            onClick={() => onCatalystClick(c)}
                            title={c.description || undefined}
                          >
                            <div className={styles.catRowTop}>
                              <span className={styles.catTitle}>{c.title}</span>
                              {c.move_pct != null && (
                                <span className={`${styles.catMove} ${c.move_pct >= 0 ? styles.catMoveUp : styles.catMoveDown}`}>
                                  {c.move_pct >= 0 ? '+' : ''}{Math.round(c.move_pct)}%
                                </span>
                              )}
                              <span className={styles.catDate}>{fmtSetupDate(c.catalyst_date)}</span>
                              {isAdmin && (
                                <>
                                  <button
                                    className={styles.setupEditC}
                                    title="Edit catalyst"
                                    onClick={e => { e.stopPropagation(); setEditingCatalystId(c.id) }}
                                  >✎</button>
                                  <button
                                    className={styles.setupDelC}
                                    title="Delete catalyst"
                                    onClick={e => { e.stopPropagation(); deleteCatalyst(c.id) }}
                                  >×</button>
                                </>
                              )}
                            </div>
                            {c.description && <p className={styles.catDesc}>{c.description}</p>}
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </>
              ) : setups.length === 0 ? (
                <p className={styles.noSetups}>No setups labeled on this chart yet.</p>
              ) : (
                <div className={styles.setupListC}>
                  {setups.map(s => (
                    editingSetupId === s.id ? (
                      <SetupForm
                        key={s.id}
                        stockId={stock.id}
                        year={stock.year}
                        initial={s}
                        onSaved={() => { setEditingSetupId(null); mutate() }}
                        onCancel={() => setEditingSetupId(null)}
                      />
                    ) : (
                      <div
                        key={s.id}
                        className={`${styles.setupRowC} ${selectedSetupId === s.id ? styles.setupRowCActive : ''}`}
                        onClick={() => onSetupClick(s)}
                        title={s.notes || undefined}
                      >
                        <span className={styles.setupNameC}>{s.setup_type}</span>
                        <span className={styles.setupMonthC}>{fmtSetupDate(s.label_date)}</span>
                        {isAdmin && (
                          <>
                            <button
                              className={styles.setupEditC}
                              title="Edit setup"
                              onClick={e => { e.stopPropagation(); setEditingSetupId(s.id) }}
                            >✎</button>
                            <button
                              className={styles.setupDelC}
                              title="Delete setup"
                              onClick={e => { e.stopPropagation(); deleteSetup(s.id) }}
                            >×</button>
                          </>
                        )}
                      </div>
                    )
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
      </div>
    </div>
  )
}

export default function ModelBook() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const { data: yearsData, mutate: mutateYears } = useSWR('/api/modelbook/years', fetcher, { revalidateOnFocus: false })
  // Show the fixed baseline year tabs plus any data-driven years, newest first.
  const years = useMemo(() => {
    const set = new Set([...(yearsData?.years || []), ...BASE_YEARS])
    return [...set].sort((a, b) => b - a)
  }, [yearsData])

  // Derived effective year: the picked year if it still exists, else newest.
  // Avoids a setState-in-effect when years load.
  const [pickedYear, setPickedYear] = useState(null)
  const year = (pickedYear != null && years.includes(pickedYear)) ? pickedYear : (years[0] ?? null)

  const { data: stocksData, mutate: mutateStocks } = useSWR(
    year != null ? `/api/modelbook/stocks?year=${year}` : null, fetcher,
    { revalidateOnFocus: false },
  )
  const stocks = useMemo(() => stocksData?.stocks || [], [stocksData])

  // Per-stock year price stats (open→close %, low→high %), keyed by symbol.
  // The endpoint returns instantly (persisted values); any not-yet-computed
  // stat comes back null and is warmed server-side — so poll every few seconds
  // while something is missing, then stop once everything has landed.
  const { data: statsData } = useSWR(
    year != null ? `/api/modelbook/year-stats?year=${year}` : null, fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: (d) => {
        const st = d?.stats
        if (!st) return 4000
        return Object.values(st).some(v => v?.open_close_pct == null) ? 4000 : 0
      },
    },
  )
  const yearStats = useMemo(() => statsData?.stats || {}, [statsData])

  // Sortable gallery — defaults to top gainers (highest yearly gain first).
  const [sort, setSort] = useState({ key: 'gain', dir: 'desc' })
  function toggleSort(key) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'gain' ? 'desc' : 'asc' })  // gain defaults to top-gainers
  }
  const sortedStocks = useMemo(() => {
    const gain = sym => yearStats[sym]?.open_close_pct
    const arr = [...stocks]
    arr.sort((a, b) => {
      if (sort.key === 'gain') {
        const ga = gain(a.symbol), gb = gain(b.symbol)
        if (ga == null && gb == null) return (a.sort_order || 0) - (b.sort_order || 0)
        if (ga == null) return 1   // missing gains sink to the bottom
        if (gb == null) return -1
        return sort.dir === 'asc' ? ga - gb : gb - ga
      }
      const ra = a.sort_order || 0, rb = b.sort_order || 0
      return sort.dir === 'asc' ? ra - rb : rb - ra
    })
    return arr
  }, [stocks, yearStats, sort])
  const sortArrow = key => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  const [selectedId, setSelectedId] = useState(null)
  // Auto-show the top stock of the current (sorted) list until the user picks
  // one — so switching years immediately renders a chart instead of a prompt.
  const activeId = (selectedId != null && sortedStocks.some(s => s.id === selectedId))
    ? selectedId
    : (sortedStocks[0]?.id ?? null)

  function selectYear(y) {
    setPickedYear(y)
    setSelectedId(null)
  }

  function onStockAdded() {
    mutateYears()
    mutateStocks()
  }

  // Keyboard nav: ↑/↓ moves through the stock list, ←/→ switches years.
  // A ref holds the latest list/selection/years so the listener is bound once.
  const navRef = useRef({ list: [], id: null, years: [], year: null })
  useEffect(() => { navRef.current = { list: sortedStocks, id: activeId, years, year } }, [sortedStocks, activeId, years, year])
  useEffect(() => {
    const onKey = e => {
      const t = e.target
      const tag = (t?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return

      // ←/→ : switch year (years are newest→oldest, so Left = newer, Right = older)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const { years: ys, year: cur } = navRef.current
        if (!ys.length) return
        const idx = ys.indexOf(cur)
        let ni = idx === -1 ? 0 : (e.key === 'ArrowLeft' ? idx - 1 : idx + 1)
        ni = Math.max(0, Math.min(ys.length - 1, ni))
        if (ys[ni] !== cur) {
          e.preventDefault()
          setPickedYear(ys[ni])
          setSelectedId(null)
        }
        return
      }

      // ↑/↓ : move through the stock list
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const { list, id } = navRef.current
      if (!list.length) return
      e.preventDefault()
      const idx = list.findIndex(s => s.id === id)
      let next = idx === -1 ? 0 : (e.key === 'ArrowDown' ? idx + 1 : idx - 1)
      next = Math.max(0, Math.min(list.length - 1, next))
      const target = list[next]
      setSelectedId(target.id)
      document.querySelector(`[data-stock-id="${target.id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drag-resizable gallery sidebar (persisted). v2 key resets the old wider
  // default now that company names no longer live in the list.
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = Number(localStorage.getItem('modelbook_panel_width_v2'))
    return v >= 170 && v <= 760 ? v : 200
  })
  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    let finalW = startW
    const onMove = ev => {
      finalW = Math.min(760, Math.max(170, startW + (ev.clientX - startX)))
      setPanelWidth(finalW)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      try { localStorage.setItem('modelbook_panel_width_v2', String(finalW)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>MODEL BOOK</h1>
        <div className={styles.yearTabs}>
          {years.map(y => (
            <button key={y} className={`${styles.yearTab} ${year === y ? styles.yearTabActive : ''}`}
              onClick={() => selectYear(y)}>{y}</button>
          ))}
          {years.length === 0 && (
            <span className={styles.emptyYears}>
              No years curated yet.{isAdmin ? ' Use “+ Add Stock” to start.' : ''}
            </span>
          )}
        </div>
        <span className={styles.count}>Top stocks in history</span>
        {isAdmin && <AddStockForm year={year ?? new Date().getFullYear()} onAdded={onStockAdded} />}
      </div>

      <div className={styles.layout}>
        {/* Left — stock gallery */}
        <div className={styles.listPanel} style={{ width: panelWidth, minWidth: panelWidth }}>
          {stocks.length > 0 && (
            <div className={styles.galleryHead}>
              <button className={styles.colHead} onClick={() => toggleSort('rank')}>
                Stock{sortArrow('rank')}
              </button>
              <button className={`${styles.colHead} ${styles.colHeadRight}`} onClick={() => toggleSort('gain')}>
                {year} Gain{sortArrow('gain')}
              </button>
            </div>
          )}
          {stocks.length === 0 && year != null && (
            <div className={styles.empty}>No stocks curated for {year}.</div>
          )}
          {sortedStocks.map((s, i) => {
            const st = yearStats[s.symbol]
            return (
              <div
                key={s.id}
                data-stock-id={s.id}
                className={`${styles.stockCard} ${activeId === s.id ? styles.stockCardActive : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <div className={styles.stockCardTop}>
                  <span className={styles.rank}>#{i + 1}</span>
                  <span className={styles.stockSym}>{s.symbol}</span>
                  <div className={styles.cardStats}>
                    {st?.open_close_pct != null
                      ? <span className={`${styles.yearGain} ${st.open_close_pct >= 0 ? styles.gain : styles.loss}`}>
                          {st.open_close_pct >= 0 ? '+' : ''}{Math.round(st.open_close_pct)}%
                        </span>
                      : <span className={styles.statMuted}>—</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Drag to resize the gallery so long company names fit */}
        <div
          className={styles.resizer}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
        />

        {/* Right — chart + setups */}
        <div className={styles.detailPanel}>
          <StockDetail stockId={activeId} isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useMemo, useRef } from 'react'
import useSWR, { preload } from 'swr'
import StockChart from '../components/StockChart'
import CompanyLogo from '../components/CompanyLogo'
import { prefetchBars } from '../utils/prefetchBars'
import { useAuth } from '../context/AuthContext'
import { SETUP_GROUPS, SETUPS, GRADES } from '../constants/setupGroups'
import styles from './ModelBook.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// Year tabs always shown, even before any stocks are curated for them.
// Any year that has stocks (from the API) is unioned in on top of these.
// Baseline year tabs, newest→oldest (2025 down to 1990). Data-driven years from
// the API merge in on top of these.
const BASE_YEARS = Array.from({ length: 2025 - 1990 + 1 }, (_, i) => 2025 - i)

const ENTRY_COLOR = '#3cb868'
const STOP_COLOR = '#e74c3c'
const TARGET_COLOR = '#c9a84c'

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

// Normalize a TradingView/broker CSV cell to an ISO YYYY-MM-DD date string.
function toIsoDate(s) {
  if (s == null) return null
  s = String(s).trim().replace(/^"|"$/g, '')
  if (!s) return null
  if (/^\d{9,11}$/.test(s)) return new Date(parseInt(s, 10) * 1000).toISOString().slice(0, 10)  // unix seconds
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`           // ISO date/datetime
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`  // MM/DD/YYYY
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

// Parse a TradingView-exported CSV (time,open,high,low,close,Volume[,indicators…])
// into daily bars [{t,o,h,l,c,v}]. Header-driven (extra indicator columns ignored).
function parseBarsCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const find = (...names) => header.findIndex(h => names.includes(h))
  const oi = find('open'), hi = find('high'), li = find('low'), ci = find('close', 'close/last', 'price')
  const vi = find('volume', 'vol')
  let ti = find('time', 'date', 'datetime'); if (ti < 0) ti = 0
  const hasHeader = oi >= 0 && ci >= 0
  const out = []
  for (let r = hasHeader ? 1 : 0; r < lines.length; r++) {
    const cols = lines[r].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const t = toIsoDate(cols[ti]); if (!t) continue
    const num = i => { const v = parseFloat(cols[i]); return Number.isFinite(v) ? v : null }
    const o = num(oi), h = num(hi), l = num(li), c = num(ci)
    if (o == null || h == null || l == null || c == null) continue
    const v = vi >= 0 ? (parseFloat(cols[vi]) || 0) : 0
    out.push({ t, o, h, l, c, v })
  }
  return out
}

// Resample daily bars → weekly (Mon-anchored) for the W timeframe.
function resampleWeekly(daily) {
  const weeks = new Map()
  for (const b of daily) {
    const d = new Date(b.t + 'T00:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7            // Mon=0
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow)
    const key = mon.toISOString().slice(0, 10)
    const w = weeks.get(key)
    if (!w) weeks.set(key, { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    else { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += (b.v || 0) }
  }
  return [...weeks.values()].sort((a, b) => a.t.localeCompare(b.t))
}

// Cap each horizontal ray at the setup's candle so it stops there instead of
// streaking to the right edge — applied for display (both "show all" and a
// single focused setup), NOT to the raw drawings used for admin editing.
function boundHrays(drawings, labelDate) {
  if (!labelDate) return drawings
  return drawings.map(d => (d.type === 'hray' ? { ...d, rightBoundTime: labelDate } : d))
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
  const empty = { year, symbol: '', company: '', sector: '', industry: '', sort_order: '', gain_pct: '', thesis: '' }
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
        sector: form.sector || null,
        industry: form.industry || null,
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
      <div className={styles.formRow}>
        <input className={styles.input} placeholder="Sector (optional — AI-filled)" value={form.sector}
          onChange={e => setForm(f => ({ ...f, sector: e.target.value }))} />
        <input className={styles.input} placeholder="Industry (optional — AI-filled)" value={form.industry}
          onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} />
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
function StockDetail({ stockId, isAdmin, catNavRef }) {
  // GLOBAL ^IXIC index-pane annotations (measure marks for Nasdaq corrections) —
  // one shared set drawn once by an admin, shown read-only on every stock.
  const { data: indexDrawingsData, mutate: mutateIndexDrawings } = useSWR(
    '/api/modelbook/index-drawings?symbol=%5EIXIC', fetcher, { revalidateOnFocus: false },
  )
  const indexDrawings = useMemo(() => parseDrawings(indexDrawingsData?.drawings_json), [indexDrawingsData])
  const { data: stock, mutate } = useSWR(
    stockId ? `/api/modelbook/stock/${stockId}` : null, fetcher,
    {
      revalidateOnFocus: false,
      // Keep the previous stock's detail visible while the next one loads, so
      // switching tickers updates the chart IN PLACE instead of unmounting it to a
      // "Loading…" state and remounting a fresh chart — the remount is what briefly
      // showed the latest-date view before snapping back to the book year ("flip to
      // now"). With this, StockChart persists across switches and just re-frames.
      keepPreviousData: true,
      // Poll while year stats (avg vol) are warming, descriptions haven't been
      // attempted (desc_at unset), or catalysts are auto-generating on first view
      // (none yet + catalysts_at unset). Stops once each attempt is recorded.
      refreshInterval: (d) => {
        if (!d || d.error) return 0
        // A delisted stock served from uploaded bars will never get provider
        // stats — don't poll forever waiting on avg_vol for it.
        const statsPending = d.avg_vol == null && !d.has_custom_bars
        const descPending = !d.company_desc && !d.desc_at
        const catalystsPending = !(d.catalysts && d.catalysts.length) && !d.catalysts_at
        return (statsPending || descPending || catalystsPending) ? 5000 : 0
      },
    },
  )
  // Uploaded historical bars for a delisted stock (fetched once when present) —
  // passed straight to StockChart as barsOverride, bypassing the data providers.
  const { data: customBarsData, mutate: mutateCustomBars } = useSWR(
    (stockId && stock?.has_custom_bars) ? `/api/modelbook/stock/${stockId}/bars` : null,
    fetcher, { revalidateOnFocus: false },
  )
  const customBars = useMemo(
    () => (Array.isArray(customBarsData?.bars) && customBarsData.bars.length ? customBarsData.bars : null),
    [customBarsData],
  )
  const barsFileRef = useRef(null)
  const [barsMsg, setBarsMsg] = useState(null)  // upload status line (admin)
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
  const [expandedCatalystId, setExpandedCatalystId] = useState(null)  // catalyst row whose details are dropped down
  const [annotateMode, setAnnotateMode] = useState(false)     // admin: drawing annotations on the focused setup
  const [annotationDraft, setAnnotationDraft] = useState([])  // working annotation set while in annotate mode
  const [annotateTarget, setAnnotateTarget] = useState('setup') // 'setup' (focused setup) | 'stock' (full-year chart)
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
  // Same "show all" idea for catalysts — default OFF so they only appear on click.
  const [showAllCatalysts, setShowAllCatalysts] = useState(() => {
    try { return localStorage.getItem('modelbook_show_all_catalysts') === '1' } catch { return false }
  })
  function toggleShowAllCatalysts() {
    setShowAllCatalysts(v => {
      const nv = !v
      try { localStorage.setItem('modelbook_show_all_catalysts', nv ? '1' : '0') } catch { /* ignore */ }
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
  const [genningDesc, setGenningDesc] = useState(false)  // admin: forcing a description regen

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
    setExpandedCatalystId(null)
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
  // Always select+zoom a setup (no toggle) — used by ↑/↓ arrow navigation.
  function selectSetup(s) {
    if (!s || annotateMode) return
    setPickedSetupId(s.id)
    setFocus(f => ({ id: s.id, date: s.label_date, startDate: s.frame_start_date || null, nonce: f.nonce + 1, stockId, tf: chartTf }))
    document.querySelector(`[data-setup-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest' })
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
  // Raw drawings of the focused setup (unbounded) — used to seed admin editing.
  const savedDrawings = useMemo(() => parseDrawings(focusedSetup?.drawings_json), [focusedSetup])
  // Stock-level annotations: drawn on the full-year chart, independent of setups.
  const stockDrawings = useMemo(() => parseDrawings(stock?.drawings_json), [stock])

  // Setup→setup crossfade (show-all OFF): briefly fade the annotation layer out,
  // swap to the new setup's drawings, fade in — instead of a hard snap. The
  // DISPLAYED setup lags focus.id during the fade so the OLD one fades out and the
  // NEW one fades in. annoOpacity multiplies the overlay's wrapper opacity.
  const [drawFocusId, setDrawFocusId] = useState(null)
  const [annoOpacity, setAnnoOpacity] = useState(1)
  const lastFocusIdRef = useRef(null)
  useEffect(() => {
    const fid = focusActive ? focus.id : null
    const prev = lastFocusIdRef.current
    lastFocusIdRef.current = fid
    if (fid != null && prev != null && fid !== prev && !showAllAnnotations && !annotateMode) {
      setAnnoOpacity(0)                                  // fade old out
      const t = setTimeout(() => { setDrawFocusId(fid); setAnnoOpacity(1) }, 160)  // swap + fade new in
      return () => clearTimeout(t)
    }
    setDrawFocusId(p => (p === fid ? p : fid))           // no-op if unchanged (avoid extra render)
    setAnnoOpacity(p => (p === 1 ? p : 1))
  }, [focusActive, focus.id, showAllAnnotations, annotateMode])
  const displaySetup = drawFocusId != null ? setups.find(s => s.id === drawFocusId) : null
  // Display version: horizontal rays bounded to stop at the setup candle, so they
  // never extend past it even when zoomed into a single setup ("show all" off).
  const displayDrawings = useMemo(
    () => (displaySetup ? boundHrays(parseDrawings(displaySetup.drawings_json), displaySetup.label_date) : null),
    [displaySetup],
  )

  // "Show all": every setup's drawings overlaid on the (zoomed-out) chart. Each
  // setup's horizontal rays get a rightBoundTime of that setup's candle so they
  // stop at the setup instead of streaking across the whole year when zoomed out.
  const allDrawings = useMemo(() => {
    const focusedId = (focusActive && focusDate) ? focus.id : null
    return setups.flatMap(s => {
      const ds = boundHrays(parseDrawings(s.drawings_json), s.label_date)
      // Show-all ON: a setup's TEXT box only renders for the focused setup; its
      // lines/labels always show. Non-focused setups keep everything but text.
      return s.id === focusedId ? ds : ds.filter(d => d.type !== 'text')
    })
  }, [setups, focusActive, focusDate, focus.id])
  // All setup days — painted gold on the chart while "show all" is on so each
  // setup candle stands out alongside its annotations. Stable ref for StockChart.
  const setupTimes = useMemo(() => setups.map(s => s.label_date).filter(Boolean), [setups])

  // While annotating the index (Nasdaq) pane, the draft belongs to THAT pane —
  // the price-pane layers keep their normal read-only display.
  const annotatingIndex = annotateMode && annotateTarget === 'index'
  const annotatingPrice = annotateMode && !annotatingIndex
  // Index-pane annotations: the editable draft while annotating the index, else
  // the saved global set — but only when "Show all" is on (the same toggle that
  // governs the setup annotations now controls the Nasdaq marks too).
  const indexAnnotations = annotatingIndex
    ? annotationDraft
    : (showAllAnnotations ? indexDrawings : [])

  // Precedence: admin authoring > show-all overlay > single-setup focus.
  let annotations, annotationsVisible
  if (annotatingPrice) {
    annotations = annotationDraft
    annotationsVisible = true
  } else if (showAllAnnotations) {
    annotations = allDrawings
    annotationsVisible = true
  } else {
    annotations = displaySetup ? displayDrawings : null
    annotationsVisible = !!focusDate
  }

  // ── Catalysts ──
  // The year's most impactful, move-driving events (AI-generated, admin-editable).
  // Ordered by the API (sort_order). Shown as gold ⚡ markers + gold candles when
  // the Catalysts tab is active; clicking one zooms to it.
  const catalysts = useMemo(
    () => [...(stock?.catalysts || [])].sort(
      (a, b) => String(a.catalyst_date || '').localeCompare(String(b.catalyst_date || ''))),
    [stock])
  // Catalyst chart labels: placed in blank space above the candle with a diagonal
  // leader line (AmiBroker-style) so they never cover candles — see ChartCalloutOverlay.
  const catalystCallouts = useMemo(() => catalysts
    .filter(c => c.catalyst_date)
    .map(c => ({
      time: c.catalyst_date,
      text: c.title || (c.move_pct != null ? `${c.move_pct >= 0 ? '+' : ''}${Math.round(c.move_pct)}%` : ''),
    })), [catalysts])
  const catalystTimes = useMemo(() => catalysts.map(c => c.catalyst_date).filter(Boolean), [catalysts])

  const onCatalystTab = panelTab === 'catalysts'
  const onSetupsTab = !onCatalystTab
  // The catalyst the chart is currently zoomed into (click a row → focus). Used
  // to show just that one when "show all" is off.
  const focusedCatalyst = (onCatalystTab && focusActive && focus.id != null)
    ? catalysts.find(c => c.id === focus.id) : null
  // The chart shows setup overlays on the Setups tab and catalyst markers on the
  // Catalysts tab — never both. On the Catalysts tab, "show all" mirrors setups:
  // off → only the clicked catalyst (when zoomed in); on → every catalyst.
  const chartCallouts = onCatalystTab
    ? (showAllCatalysts
        ? (catalystCallouts.length ? catalystCallouts : null)
        : (focusedCatalyst && focusDate ? [{ time: focusedCatalyst.catalyst_date, text: focusedCatalyst.title }] : null))
    : null
  const chartPriceLines = onSetupsTab ? priceLines : NO_PRICE_LINES
  // Price-pane annotations render/edit on ANY tab while annotating the price pane
  // (so you can annotate the main chart from the Catalysts tab too); otherwise
  // they stay scoped to the Setups tab (setup overlays don't bleed onto Catalysts).
  const chartAnnotations = (onSetupsTab || annotatingPrice) ? annotations : null
  const chartAnnotationsVisible = (onSetupsTab || annotatingPrice) ? annotationsVisible : false
  const chartAnnotateMode = annotatingPrice
  const chartHighlight = onCatalystTab
    ? (showAllCatalysts && catalystTimes.length ? catalystTimes : focusDate)
    : (showAllAnnotations && setupTimes.length ? setupTimes : focusDate)
  // Uploaded-bars override for the chart: daily as stored, resampled for Weekly.
  const chartBars = useMemo(() => {
    if (!customBars) return null
    return chartTf === 'W' ? resampleWeekly(customBars) : customBars
  }, [customBars, chartTf])

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
    setFocus(f => (f.date != null
      ? { id: null, date: null, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
      : { id: null, date: null, startDate: null, nonce: f.nonce, stockId: null, tf: null }))
  }

  // Click a catalyst → drop down its details AND zoom so its day is the last
  // candle; click again to collapse + zoom out.
  function onCatalystClick(c) {
    setExpandedCatalystId(prev => (prev === c.id ? null : c.id))
    setFocus(f => {
      const sameTarget = f.id === c.id && f.date != null && f.stockId === stockId && f.tf === chartTf
      return sameTarget
        ? { id: c.id, date: null, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
        : { id: c.id, date: c.catalyst_date, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }
    })
  }

  // Always select+zoom a catalyst (no toggle) — used by ↑/↓ arrow navigation.
  function selectCatalyst(c) {
    if (!c) return
    setExpandedCatalystId(c.id)
    setFocus(f => ({ id: c.id, date: c.catalyst_date, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }))
    document.querySelector(`[data-catalyst-id="${c.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  // Track whether the user's last click landed inside the setups/catalysts panel,
  // so ↑/↓ only scroll that list while focused there. Clicking ANYWHERE else
  // (chart, ticker list, info panel) hands the arrows back to ticker navigation —
  // even if a setup/catalyst is still open.
  const panelFocusedRef = useRef(false)
  useEffect(() => {
    const onDown = e => { panelFocusedRef.current = !!e.target?.closest?.('[data-panel-section]') }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [])
  // Expose the active tab's list/selection to ModelBook's keyboard handler so
  // ↑/↓ scroll the Setups OR Catalysts list, whichever tab is showing.
  useEffect(() => {
    if (!catNavRef) return
    catNavRef.current = {
      list: onCatalystTab ? catalysts : setups,
      id: onCatalystTab ? expandedCatalystId : selectedSetupId,
      select: onCatalystTab ? selectCatalyst : selectSetup,
      isActive: () => panelFocusedRef.current && (
        (onCatalystTab && expandedCatalystId != null) ||
        (onSetupsTab && selectedSetupId != null)),
    }
  })

  async function deleteCatalyst(id) {
    await fetch(`/api/modelbook/catalyst/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }

  function startAnnotate(target = 'setup') {
    setAnnotateTarget(target)
    setAnnotationDraft(
      target === 'index' ? indexDrawings
        : target === 'stock' ? stockDrawings
        : savedDrawings,
    )
    // Stock-chart annotations belong to the full main chart — if zoomed into a
    // setup, zoom back out first so you're drawing on the whole year.
    if (target === 'stock' && focusDate) {
      setFocus(f => ({ id: null, date: null, startDate: null, nonce: f.nonce + 1, stockId, tf: chartTf }))
    }
    setAnnotateMode(true)
  }
  function cancelAnnotate() {
    setAnnotateMode(false)
    setAnnotationDraft([])
  }
  async function saveAnnotations() {
    // Index (Nasdaq) pane annotations are GLOBAL — saved to the shared store, not
    // the stock or setup. Optimistically update the index-drawings SWR cache.
    if (annotateTarget === 'index') {
      const json = JSON.stringify(annotationDraft)
      mutateIndexDrawings({ drawings_json: json }, { revalidate: false })
      setAnnotateMode(false)
      setAnnotationDraft([])
      try {
        await fetch('/api/modelbook/index-drawings?symbol=%5EIXIC', {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drawings_json: json }),
        })
      } finally {
        mutateIndexDrawings()
      }
      return
    }
    // Route to the stock (full-year) or the focused setup based on the target.
    const isStock = annotateTarget === 'stock'
    const url = isStock
      ? `/api/modelbook/stock/${stock.id}`
      : (focus.id != null ? `/api/modelbook/setup/${focus.id}` : null)
    if (!url) return
    const json = JSON.stringify(annotationDraft)
    // Optimistically write the new drawings into the SWR cache so they appear the
    // instant you hit Save (no blink to the old set while the PUT + refetch runs).
    mutate((cur) => {
      if (!cur) return cur
      if (isStock) return { ...cur, drawings_json: json }
      return { ...cur, setups: (cur.setups || []).map(s => (s.id === focus.id ? { ...s, drawings_json: json } : s)) }
    }, { revalidate: false })
    setAnnotateMode(false)
    setAnnotationDraft([])
    try {
      await fetch(url, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawings_json: json }),
      })
    } finally {
      mutate()   // revalidate from the server
    }
  }

  async function deleteSetup(id) {
    await fetch(`/api/modelbook/setup/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }

  // Upload a TradingView (or broker) OHLCV CSV → parsed client-side → stored as
  // this stock's chart data (for delisted tickers the providers no longer carry).
  async function onBarsFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-selecting the same file
    if (!file) return
    setBarsMsg('Parsing…')
    try {
      const bars = parseBarsCsv(await file.text())
      if (!bars.length) { setBarsMsg('No valid rows found — expected time,open,high,low,close,Volume.'); return }
      setBarsMsg(`Uploading ${bars.length} bars…`)
      const res = await fetch(`/api/modelbook/stock/${stock.id}/bars`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bars }),
      })
      if (!res.ok) { setBarsMsg(`Upload failed: ${(await res.text()).slice(0, 140)}`); return }
      const j = await res.json()
      setBarsMsg(`✓ Uploaded ${j.count} bars (${j.first} → ${j.last}).`)
      await mutate()           // detail → has_custom_bars true
      await mutateCustomBars() // pull the bars → chart swaps to them
      setTimeout(() => setBarsMsg(null), 5000)
    } catch (err) {
      setBarsMsg('Error: ' + (err?.message || 'failed to read file'))
    }
  }
  async function clearBars() {
    if (!window.confirm('Remove the uploaded historical data for this stock?')) return
    await fetch(`/api/modelbook/stock/${stock.id}/bars`, { method: 'DELETE', credentials: 'include' })
    setBarsMsg('Cleared.')
    await mutate(); await mutateCustomBars()
    setTimeout(() => setBarsMsg(null), 3000)
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

  // Admin: force-regenerate the AI company description + year narrative when the
  // auto pass came back empty. Synchronous on the server (one LLM call).
  async function generateDescription() {
    if (genningDesc) return
    setGenningDesc(true)
    try {
      const r = await fetch(`/api/modelbook/stock/${stock.id}/descriptions/generate`,
        { method: 'POST', credentials: 'include' })
      if (r.ok) {
        const updated = await r.json()
        mutate(updated, { revalidate: false })
      }
    } finally {
      setGenningDesc(false)
    }
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
        <div className={styles.detailTitleRow}>
          <CompanyLogo sym={stock.symbol} size={30} round />
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
          {/* Annotate the focused setup (only when zoomed into one). */}
          {isAdmin && onSetupsTab && focusDate && !annotateMode && (
            <button className={styles.annotateBtn} onClick={() => startAnnotate('setup')} title="Draw annotations on this focused setup">✏️ Annotate Setup</button>
          )}
          {/* Annotate the stock's main price chart (saved per stock) — always
              available, exactly like Annotate Nasdaq but on the price pane. */}
          {isAdmin && !annotateMode && (
            <button className={styles.annotateBtn} onClick={() => startAnnotate('stock')} title="Draw annotations on the stock's main chart (saved per stock)">✏️ Annotate Chart</button>
          )}
          {/* Measure-mark the Nasdaq pane (GLOBAL — shown on every stock). */}
          {isAdmin && !annotateMode && (
            <button className={styles.annotateBtn} onClick={() => startAnnotate('index')} title="Measure-mark Nasdaq corrections on the top pane (shared across every stock)">📐 Annotate Nasdaq</button>
          )}
          {/* Upload historical OHLCV for a delisted stock the data providers dropped. */}
          {isAdmin && !annotateMode && (
            <>
              <button className={styles.annotateBtn} onClick={() => barsFileRef.current?.click()}
                title="Upload a TradingView OHLCV CSV as this stock's chart data (for delisted tickers)">
                📈 {stock.has_custom_bars ? 'Replace Data' : 'Upload Data'}
              </button>
              {stock.has_custom_bars && (
                <button className={styles.annotateCancel} onClick={clearBars} title="Remove uploaded data">Clear Data</button>
              )}
              <input ref={barsFileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onBarsFile} />
            </>
          )}
          {barsMsg && <span style={{ fontSize: 11, color: 'var(--color-text-muted, #9aa)', marginLeft: 4 }}>{barsMsg}</span>}
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
            volumePaneHeightPct={10}
            volumeMa={50}
            indexPaneSymbol="^IXIC"
            indexPaneLabel="IXIC (Nasdaq Composite)"
            indexPaneHeightPct={15}
            barsOverride={chartBars}
            barsOverridePending={!!(stock.has_custom_bars && !chartBars)}
            indexAnnotations={indexAnnotations}
            indexAnnotationsEditable={annotatingIndex}
            onIndexAnnotationsChange={setAnnotationDraft}
            priceScaleTopMargin={0.12}
            priceScaleBottomMargin={0.07}
            watermarkOpacity={0.34}
            watermarkX={0.2}
            watermarkY={0.2}
            watermarkName={stock.company || null}
            watermarkSector={stock.sector || null}
            watermarkIndustry={stock.industry || null}
            priceLines={chartPriceLines}
            callouts={chartCallouts}
            focusDate={focusDate}
            focusStartDate={focusStartDate}
            focusNonce={focus.nonce}
            annotations={chartAnnotations}
            annotationsVisible={chartAnnotationsVisible}
            annotationsOpacity={annoOpacity}
            annotationsFadeWhole={!showAllAnnotations}
            staticAnnotations={(onSetupsTab && showAllAnnotations && !(annotateMode && annotateTarget === 'stock')) ? stockDrawings : null}
            annotationsEditable={chartAnnotateMode}
            onAnnotationsChange={setAnnotationDraft}
            highlightBarTime={chartHighlight}
            highlightColor="#ffffff"
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
                  {/* Auto pass already ran (desc_at set) but produced nothing — let
                      an admin retry it on demand instead of waiting for the window. */}
                  {!stock.company_desc && !stock.run_story && stock.desc_at &&
                    <p className={styles.infoStoryMuted}>{genningDesc ? 'Generating summary…' : 'No summary generated yet.'}</p>}
                  {isAdmin && (
                    <div className={styles.infoNarrActions}>
                      {!stock.company_desc && !stock.run_story && (
                        <button className={styles.infoEditLink} disabled={genningDesc} onClick={generateDescription}>
                          {genningDesc ? 'generating…' : 'generate'}
                        </button>
                      )}
                      <button className={styles.infoEditLink}
                        onClick={() => { setDescDraft(stock.company_desc || ''); setStoryDraft(stock.run_story || ''); setEditNarr(true) }}>
                        edit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Setups (buy spots) + Catalysts (move-driving events) — two tabbed
                guides to the chart. Click a row to focus/zoom that point. */}
            <div className={styles.panelSetups} data-panel-section>
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
                  {onSetupsTab && setups.length > 0 && (
                    <button
                      className={`${styles.showAllToggle} ${showAllAnnotations ? styles.showAllToggleOn : ''}`}
                      onClick={toggleShowAll}
                      aria-pressed={showAllAnnotations}
                      title={showAllAnnotations
                        ? 'Hide all setups (only show on click)'
                        : 'Show every setup on the chart'}
                    >
                      <span className={styles.showAllTrack}><span className={styles.showAllKnob} /></span>
                      Show all
                    </button>
                  )}
                  {onSetupsTab && isAdmin && <AddSetupForm stockId={stock.id} year={stock.year} onAdded={mutate} />}
                  {onCatalystTab && catalysts.length > 0 && (
                    <button
                      className={`${styles.showAllToggle} ${showAllCatalysts ? styles.showAllToggleOn : ''}`}
                      onClick={toggleShowAllCatalysts}
                      aria-pressed={showAllCatalysts}
                      title={showAllCatalysts
                        ? 'Hide catalysts (only show on click)'
                        : 'Show every catalyst on the chart'}
                    >
                      <span className={styles.showAllTrack}><span className={styles.showAllKnob} /></span>
                      Show all
                    </button>
                  )}
                  {onCatalystTab && isAdmin && (
                    <AddCatalystForm stockId={stock.id} year={stock.year} onAdded={mutate} />
                  )}
                </div>
              </div>

              {onCatalystTab ? (
                <>
                  {catalysts.length === 0 ? (
                    <p className={styles.noSetups}>
                      {!stock.catalysts_at
                        ? 'Finding this year’s bullish catalysts…'
                        : 'No catalysts found for this year.'}
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
                            data-catalyst-id={c.id}
                            className={`${styles.catRow} ${expandedCatalystId === c.id ? styles.catRowOpen : ''}`}
                          >
                            <div className={styles.catRowTop} onClick={() => onCatalystClick(c)}>
                              <span className={styles.catChevron}>{expandedCatalystId === c.id ? '▾' : '▸'}</span>
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
                            {expandedCatalystId === c.id && c.description && (
                              <p className={styles.catDesc}>{c.description}</p>
                            )}
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
                        data-setup-id={s.id}
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

// A 10-dot meter for how hospitable a year was to a momentum swing trader.
function TraderMeter({ score }) {
  const s = Math.max(0, Math.min(10, Math.round(score)))
  const color = s >= 8 ? '#4ade80' : s >= 6 ? '#c9a84c' : s >= 4 ? '#e0a33e' : '#e74c3c'
  return (
    <span className={styles.meterWrap} title={`Momentum swing-trader climate: ${s}/10`}>
      <span className={styles.meterLabel}>Trader climate</span>
      <span className={styles.meterDots} aria-label={`${s} of 10`}>
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} className={styles.meterDot}
            style={{ background: i < s ? color : 'rgba(255,255,255,0.12)' }} />
        ))}
      </span>
    </span>
  )
}

// Hover-a-year-tab → a recap of that market year (broad market, leadership
// themes, momentum-trader climate). Generated server-side on first request and
// cached forever; polls while it's still being written.
function YearRecapPopover({ year, anchor }) {
  const { data } = useSWR(
    year != null ? `/api/modelbook/year-recap?year=${year}` : null, fetcher,
    {
      revalidateOnFocus: false,
      keepPreviousData: false,
      refreshInterval: d => (d && (d.status === 'ready' || d.status === 'unavailable')) ? 0 : 2500,
    },
  )
  if (year == null || !anchor) return null
  const ready = data && data.status === 'ready'
  const unavailable = data && data.status === 'unavailable'
  const W = Math.min(480, window.innerWidth - 24)
  const top = Math.round(anchor.bottom + 8)
  const left = Math.round(Math.min(Math.max(8, anchor.left - 30), window.innerWidth - W - 8))
  return (
    <div className={styles.recapPop} role="tooltip"
      style={{ top, left, width: W, maxHeight: `calc(100vh - ${top + 12}px)`, overflowY: 'auto' }}>
      <div className={styles.recapHead}>
        <span className={styles.recapYearTag}>{year}</span>
        {ready && data.market_tone && <span className={styles.recapTone}>{data.market_tone}</span>}
      </div>
      {!ready && !unavailable && <div className={styles.recapLoading}>Writing the {year} market recap…</div>}
      {unavailable && <div className={styles.recapLoading}>Recap for {year} isn’t available yet — hover again shortly.</div>}
      {ready && (
        <>
          {data.headline && <div className={styles.recapHeadline}>{data.headline}</div>}
          {typeof data.trader_score === 'number' && (
            <div className={styles.recapMeterRow}><TraderMeter score={data.trader_score} /></div>
          )}
          {Array.isArray(data.themes) && data.themes.length > 0 && (
            <div className={styles.recapThemes}>
              {data.themes.map(t => <span key={t} className={styles.recapChip}>{t}</span>)}
            </div>
          )}
          {data.recap && <p className={styles.recapText}>{data.recap}</p>}
        </>
      )}
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

  // Quick-filter the year's gallery by ticker or company name.
  const [query, setQuery] = useState('')
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

  // Apply the search filter (ticker or company name) on top of the sort.
  const visibleStocks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sortedStocks
    return sortedStocks.filter(s =>
      (s.symbol || '').toLowerCase().includes(q) ||
      (s.company || '').toLowerCase().includes(q))
  }, [sortedStocks, query])

  const [selectedId, setSelectedId] = useState(null)
  // Auto-show the top stock of the current (sorted) list until the user picks
  // one — so switching years immediately renders a chart instead of a prompt.
  const activeId = (selectedId != null && sortedStocks.some(s => s.id === selectedId))
    ? selectedId
    : (sortedStocks[0]?.id ?? null)

  function selectYear(y) {
    setPickedYear(y)
    setSelectedId(null)
    setQuery('')
  }

  // Year-tab hover → recap popover. A short debounce so scrubbing across many
  // tabs doesn't fire (and prefetch) a recap for every one in passing.
  const [recap, setRecap] = useState({ year: null, anchor: null })
  const recapTimer = useRef(null)
  function onYearHover(y, el) {
    clearTimeout(recapTimer.current)
    const rect = el.getBoundingClientRect()
    recapTimer.current = setTimeout(() => setRecap({ year: y, anchor: rect }), 220)
  }
  function onYearLeave() {
    clearTimeout(recapTimer.current)
    setRecap({ year: null, anchor: null })
  }
  useEffect(() => () => clearTimeout(recapTimer.current), [])

  // Warm the client cache for EVERY year's recap as soon as the page opens, so
  // hovering a year is instant (served from SWR cache, no per-hover round-trip).
  // Trickled ~70ms apart so it's a gentle background fetch, not a 30-request burst.
  useEffect(() => {
    if (!years.length) return
    let i = 0, cancelled = false
    const list = [...years]
    const tick = () => {
      if (cancelled || i >= list.length) return
      preload(`/api/modelbook/year-recap?year=${list[i]}`, fetcher)
      i += 1
      setTimeout(tick, 70)
    }
    tick()
    return () => { cancelled = true }
  }, [years])

  // Warm EVERY stock in the OPEN year (chart bars + detail + custom bars +
  // earnings) the moment the year loads — with PRIORITY so this year's charts jump
  // ahead of the background catalog warm below. So switching to a year makes its
  // tickers instant almost immediately. Chart bars go through prefetchBars' shared
  // bounded queue, so it never starves the chart you're actively viewing.
  useEffect(() => {
    if (!stocks.length || year == null) return
    prefetchBars(stocks.map(s => s.symbol).filter(Boolean), 'D', { priority: true })
    let i = 0, cancelled = false
    const trickle = () => {
      if (cancelled || i >= stocks.length) return
      const s = stocks[i]; i += 1
      if (s?.id != null) {
        preload(`/api/modelbook/stock/${s.id}`, fetcher)        // setups + catalysts
        preload(`/api/modelbook/stock/${s.id}/bars`, fetcher)   // custom bars (delisted); empty+cheap otherwise
      }
      if (s?.symbol) {
        preload(`/api/modelbook/year-earnings?symbol=${encodeURIComponent(s.symbol)}&year=${year}`, fetcher)
      }
      setTimeout(trickle, 120)
    }
    trickle()
    return () => { cancelled = true }
  }, [stocks, year])

  // Catalog-wide warm on open: every OTHER year's gallery list + gains, then every
  // stock's chart/detail/earnings across ALL years (newest first, background
  // priority) — so switching to ANY year and scrolling its tickers is instant on
  // first view after a refresh, not just the year you happened to land on.
  useEffect(() => {
    if (!years.length) return
    let cancelled = false
    // Gallery lists + gain stats for every year → the stock list + gains paint
    // instantly the moment you click a different year (tiny JSON, fire now).
    years.forEach(y => {
      preload(`/api/modelbook/stocks?year=${y}`, fetcher)
      preload(`/api/modelbook/year-stats?year=${y}`, fetcher)
    })
    ;(async () => {
      let all = []
      try {
        const r = await fetch('/api/modelbook/all-stocks', { credentials: 'include' })
        all = (await r.json())?.stocks || []
      } catch { return }
      if (cancelled || !all.length) return
      all.sort((a, b) => (b.year - a.year) || 0)  // newest years first
      prefetchBars(all.map(s => s.symbol).filter(Boolean), 'D')  // background priority
      let i = 0
      const trickle = () => {
        if (cancelled || i >= all.length) return
        const s = all[i]; i += 1
        if (s?.id != null) {
          preload(`/api/modelbook/stock/${s.id}`, fetcher)
          preload(`/api/modelbook/stock/${s.id}/bars`, fetcher)
        }
        if (s?.symbol) preload(`/api/modelbook/year-earnings?symbol=${encodeURIComponent(s.symbol)}&year=${s.year}`, fetcher)
        setTimeout(trickle, 90)
      }
      trickle()
    })()
    return () => { cancelled = true }
  }, [years])

  // Horizontal-scroll the year strip (arrows) + keep the active year in view when
  // it changes (e.g. via ←/→ keyboard nav) — scrolls the strip only, never the page.
  const yearStripRef = useRef(null)
  function scrollYears(dir) {
    const el = yearStripRef.current
    if (el) el.scrollBy({ left: dir * Math.max(220, el.clientWidth * 0.8), behavior: 'smooth' })
  }
  useEffect(() => {
    const el = yearStripRef.current
    if (!el || year == null) return
    const btn = el.querySelector(`[data-year="${year}"]`)
    if (!btn) return
    const bl = btn.offsetLeft, br = bl + btn.offsetWidth
    if (bl < el.scrollLeft) el.scrollTo({ left: Math.max(0, bl - 8), behavior: 'smooth' })
    else if (br > el.scrollLeft + el.clientWidth) el.scrollTo({ left: br - el.clientWidth + 8, behavior: 'smooth' })
  }, [year])

  function onStockAdded() {
    mutateYears()
    mutateStocks()
  }

  // Admin: right-click a gallery card → delete the stock from the Model Book.
  const [stockCtx, setStockCtx] = useState(null)  // { x, y, stock } | null
  function onStockContext(e, s) {
    if (!isAdmin) return
    e.preventDefault()
    setStockCtx({ x: e.clientX, y: e.clientY, stock: s })
  }
  async function deleteStockFromBook(s) {
    setStockCtx(null)
    if (!window.confirm(`Remove ${s.symbol} from the ${year} Model Book? This deletes its setups, catalysts, annotations and any uploaded data.`)) return
    await fetch(`/api/modelbook/stock/${s.id}`, { method: 'DELETE', credentials: 'include' })
    if (selectedId === s.id) setSelectedId(null)
    mutateStocks()
    mutateYears()
  }

  // Keyboard nav: ↑/↓ moves through the stock list, ←/→ switches years.
  // A ref holds the latest list/selection/years so the listener is bound once.
  const navRef = useRef({ list: [], id: null, years: [], year: null })
  useEffect(() => { navRef.current = { list: sortedStocks, id: activeId, years, year } }, [sortedStocks, activeId, years, year])

  // Warm the DIRECTION OF TRAVEL: whenever the selection changes, prefetch the
  // nearest neighbours (a few rows up and down the gallery) at PRIORITY so the
  // next ↑/↓ scroll lands on an already-warm SWR cache. A COLD ticker loads its
  // bars in two phases (empty IDB → network ~1s) and re-frames the book year
  // across a ~1.2s settle window; meanwhile the ^IXIC pane line — already cached
  // and the same for every stock in the year — gets drawn/re-positioned during
  // that settle. That is the "Nasdaq pane skips for a second on each new ticker"
  // glitch (the price pane is still blank so only the thin line is seen moving).
  // Warming the neighbours collapses the cold two-phase load to a single instant
  // phase, so the line stays locked in place from the FIRST scroll-through —
  // recreating the smoothness you previously only got after scanning the whole
  // year once. Forward neighbours are queued first (scrolling down is the common
  // direction); the bounded/deferred prefetch queue still lets the active chart
  // fetch win, so this never starves the chart you just landed on.
  useEffect(() => {
    if (!sortedStocks.length || activeId == null) return
    const idx = sortedStocks.findIndex(s => s.id === activeId)
    if (idx < 0) return
    const RADIUS = 3
    const syms = []
    for (let d = 1; d <= RADIUS; d++) {
      const nxt = sortedStocks[idx + d]?.symbol
      const prv = sortedStocks[idx - d]?.symbol
      if (nxt) syms.push(nxt)
      if (prv) syms.push(prv)
    }
    if (syms.length) prefetchBars(syms, 'D', { priority: true })
  }, [activeId, sortedStocks])

  // Warm the ^IXIC index-pane bars ONCE on open, into the exact SWR key StockChart
  // uses for the Nasdaq top pane (an ARRAY key, so prefetchBars' URL-string cache
  // doesn't cover it). The line is shared by every chart, so warming it up front
  // means even the very first ticker's Nasdaq pane paints in its final position
  // instead of fetching on first view. Matches StockChart's fetcher shape (returns
  // the bars array) so the cached value is used directly.
  useEffect(() => {
    preload(['index-pane-bars', '^IXIC', 'D', 8000], async () => {
      const res = await fetch('/api/bars/%5EIXIC?tf=D&bars=8000')
        .then(r => (r.ok ? r.json() : { bars: [] }))
        .catch(() => ({ bars: [] }))
      return res?.bars || []
    })
  }, [])
  // When "clicked into" a catalyst (expanded on the Catalysts tab), ↑/↓ scroll
  // through the catalysts instead of the stock list. StockDetail populates this
  // ref (it owns the catalyst state); cleared when none is open, so the arrows
  // revert to ticker navigation.
  const catNavRef = useRef({ active: false, list: [], id: null, select: null })
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
          // Move focus to the newly-active year button so its focus ring follows
          // the selection — otherwise the previously-clicked year keeps a stale
          // gold ring around it while a different year is active.
          try { document.querySelector(`[data-year="${ys[ni]}"]`)?.focus({ preventScroll: true }) } catch { /* ignore */ }
        }
        return
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

      // ↑/↓ while clicked into a catalyst → scroll through the catalysts.
      const cn = catNavRef.current
      if (cn.isActive?.() && cn.list.length) {
        e.preventDefault()
        const ci = cn.list.findIndex(c => c.id === cn.id)
        let cnext = ci === -1 ? 0 : (e.key === 'ArrowDown' ? ci + 1 : ci - 1)
        cnext = Math.max(0, Math.min(cn.list.length - 1, cnext))
        if (cn.list[cnext] && cn.list[cnext].id !== cn.id) cn.select?.(cn.list[cnext])
        return
      }

      // ↑/↓ : move through the stock list
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
        <div className={styles.yearNav}>
          <button className={styles.yearArrow} onClick={() => scrollYears(-1)} aria-label="Scroll years left" title="Older / newer years">‹</button>
          <div className={styles.yearTabs} ref={yearStripRef}>
            {years.map(y => (
              <button key={y} data-year={y} className={`${styles.yearTab} ${year === y ? styles.yearTabActive : ''}`}
                onClick={() => selectYear(y)}
                onMouseEnter={e => onYearHover(y, e.currentTarget)}
                onMouseLeave={onYearLeave}>{y}</button>
            ))}
            {years.length === 0 && (
              <span className={styles.emptyYears}>
                No years curated yet.{isAdmin ? ' Use “+ Add Stock” to start.' : ''}
              </span>
            )}
          </div>
          <button className={styles.yearArrow} onClick={() => scrollYears(1)} aria-label="Scroll years right" title="Older / newer years">›</button>
        </div>
        <span className={styles.count}>Top stocks in history</span>
        {isAdmin && <AddStockForm year={year ?? new Date().getFullYear()} onAdded={onStockAdded} />}
      </div>

      <YearRecapPopover year={recap.year} anchor={recap.anchor} />

      <div className={styles.layout}>
        {/* Left — stock gallery */}
        <div className={styles.listPanel} style={{ width: panelWidth, minWidth: panelWidth }}>
          {stocks.length > 0 && (
            <div className={styles.listStickyHead}>
              <div className={styles.searchWrap}>
                <span className={styles.searchIcon} aria-hidden>⌕</span>
                <input
                  className={styles.searchInput}
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Search ${year ?? ''}`}
                  aria-label="Search tickers"
                />
                {query && (
                  <button className={styles.searchClear} onClick={() => setQuery('')} aria-label="Clear search">×</button>
                )}
              </div>
              <div className={styles.galleryHead}>
                <button className={styles.colHead} onClick={() => toggleSort('rank')}>
                  Stock{sortArrow('rank')}
                </button>
                <button className={`${styles.colHead} ${styles.colHeadRight}`} onClick={() => toggleSort('gain')}>
                  {year} Gain{sortArrow('gain')}
                </button>
              </div>
            </div>
          )}
          {stocks.length === 0 && year != null && (
            <div className={styles.empty}>No stocks curated for {year}.</div>
          )}
          {stocks.length > 0 && visibleStocks.length === 0 && (
            <div className={styles.empty}>No tickers match “{query}”.</div>
          )}
          {visibleStocks.map((s) => {
            const st = yearStats[s.symbol]
            return (
              <div
                key={s.id}
                data-stock-id={s.id}
                className={`${styles.stockCard} ${activeId === s.id ? styles.stockCardActive : ''}`}
                onClick={() => setSelectedId(s.id)}
                onContextMenu={(e) => onStockContext(e, s)}
              >
                <div className={styles.stockCardTop}>
                  <span className={styles.rankLogo}><CompanyLogo sym={s.symbol} size={28} round /></span>
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
          <StockDetail stockId={activeId} isAdmin={isAdmin} catNavRef={catNavRef} />
        </div>
      </div>

      {/* Admin: right-click-a-card context menu (delete from the book). */}
      {stockCtx && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setStockCtx(null)}
            onContextMenu={(e) => { e.preventDefault(); setStockCtx(null) }}
          />
          <div
            style={{
              position: 'fixed', top: stockCtx.y, left: stockCtx.x, zIndex: 1000,
              background: '#1a1a1e', border: '1px solid #333', borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.5)', padding: 4, minWidth: 190,
              font: '13px "Instrument Sans", system-ui, sans-serif',
            }}
          >
            <button
              onClick={() => deleteStockFromBook(stockCtx.stock)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
                background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer',
                borderRadius: 4, fontSize: 13,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,107,107,0.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              🗑 Delete {stockCtx.stock.symbol} from {year}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

import { useState, useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import StockChart from '../components/StockChart'
import { useAuth } from '../context/AuthContext'
import { SETUP_GROUPS, GRADES } from '../constants/setupGroups'
import styles from './ModelBook.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// Year tabs always shown, even before any stocks are curated for them.
// Any year that has stocks (from the API) is unioned in on top of these.
const BASE_YEARS = [2025, 2024, 2023, 2022, 2021, 2020]

const ENTRY_COLOR = '#3cb868'
const STOP_COLOR = '#e74c3c'
const TARGET_COLOR = '#c9a84c'

// Marker color by grade: A/A+ green, B gold, C/F red, ungraded muted.
function gradeColor(grade) {
  if (grade === 'A+' || grade === 'A') return ENTRY_COLOR
  if (grade === 'B') return TARGET_COLOR
  if (grade === 'C' || grade === 'F') return STOP_COLOR
  return '#8a8a8a'
}

function GradePill({ grade }) {
  if (!grade) return null
  const cls = grade === 'A+' || grade === 'A' ? styles.gA
    : grade === 'B' ? styles.gB : styles.gC
  return <span className={`${styles.gradePill} ${cls}`}>{grade}</span>
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

function riskReward(s) {
  if (s.entry_price == null || s.stop_price == null || s.target_price == null) return null
  const risk = s.entry_price - s.stop_price
  const reward = s.target_price - s.entry_price
  if (!risk) return null
  return (reward / risk).toFixed(1)
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

// ── Admin: label a playbook setup on a stock ──────────────────────────────────
function AddSetupForm({ stockId, year, onAdded }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const empty = {
    setup_type: '', label_date: '', timeframe: 'D', entry_price: '', stop_price: '',
    target_price: '', grade: '', notes: '', marker_side: 'belowBar', marker_shape: 'arrowUp',
  }
  const [form, setForm] = useState(empty)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const num = v => (v === '' ? null : parseFloat(v))
      const body = {
        setup_type: form.setup_type,
        label_date: form.label_date,
        timeframe: form.timeframe,
        entry_price: num(form.entry_price),
        stop_price: num(form.stop_price),
        target_price: num(form.target_price),
        grade: form.grade || null,
        notes: form.notes || null,
        marker_side: form.marker_side,
        marker_shape: form.marker_shape,
      }
      const r = await fetch(`/api/modelbook/stock/${stockId}/setups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        setForm(empty)
        setOpen(false)
        onAdded?.()
      }
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ Label Setup</button>
  }
  return (
    <form className={styles.adminForm} onSubmit={submit}>
      <div className={styles.formRow}>
        <select className={styles.input} value={form.setup_type} required
          onChange={e => setForm(f => ({ ...f, setup_type: e.target.value }))}>
          <option value="">Setup…</option>
          {SETUP_GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.setups.map(s => <option key={s} value={s}>{s}</option>)}
            </optgroup>
          ))}
        </select>
        <input className={styles.input} type="date" value={form.label_date}
          min={`${year}-01-01`} max={`${year}-12-31`} required
          onChange={e => setForm(f => ({ ...f, label_date: e.target.value }))} />
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
        <input className={styles.input} type="number" step="0.01" placeholder="Entry" value={form.entry_price}
          onChange={e => setForm(f => ({ ...f, entry_price: e.target.value }))} />
        <input className={styles.input} type="number" step="0.01" placeholder="Stop" value={form.stop_price}
          onChange={e => setForm(f => ({ ...f, stop_price: e.target.value }))} />
        <input className={styles.input} type="number" step="0.01" placeholder="Target" value={form.target_price}
          onChange={e => setForm(f => ({ ...f, target_price: e.target.value }))} />
        <select className={styles.input} value={form.marker_side}
          onChange={e => setForm(f => ({ ...f, marker_side: e.target.value }))}>
          <option value="belowBar">Below bar</option>
          <option value="aboveBar">Above bar</option>
        </select>
        <select className={styles.input} value={form.marker_shape}
          onChange={e => setForm(f => ({ ...f, marker_shape: e.target.value }))}>
          <option value="arrowUp">Arrow ↑</option>
          <option value="arrowDown">Arrow ↓</option>
          <option value="circle">Circle</option>
          <option value="square">Square</option>
        </select>
      </div>
      <textarea className={styles.textarea} placeholder="Teaching notes — why this setup worked / failed" value={form.notes}
        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      <div className={styles.formActions}>
        <button className={styles.saveBtn} type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Setup'}</button>
        <button className={styles.cancelBtn} type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

// ── Stock detail: chart with setups labeled + the setup list ──────────────────
function StockDetail({ stockId, isAdmin }) {
  const { data: stock, mutate } = useSWR(
    stockId ? `/api/modelbook/stock/${stockId}` : null, fetcher,
    {
      revalidateOnFocus: false,
      // Poll while the year stats (avg vol) or AI descriptions are still warming.
      refreshInterval: (d) => (d && !d.error && (d.avg_vol == null || !d.company_desc)) ? 5000 : 0,
    },
  )
  const setups = useMemo(() => stock?.setups || [], [stock])
  const [pickedSetupId, setPickedSetupId] = useState(null)
  const [infoOpen, setInfoOpen] = useState(true)
  const [editNarr, setEditNarr] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [storyDraft, setStoryDraft] = useState('')
  // Derived: the picked setup if still present, else the first one (so its
  // price lines show by default). Avoids a setState-in-effect on stock change.
  const selectedSetupId = (pickedSetupId != null && setups.some(s => s.id === pickedSetupId))
    ? pickedSetupId
    : (setups[0]?.id ?? null)

  const markers = useMemo(() => setups.map(s => ({
    time: s.label_date,
    position: s.marker_side || 'belowBar',
    color: gradeColor(s.grade),
    shape: s.marker_shape || 'arrowUp',
    text: `${s.setup_type}${s.grade ? ` ${s.grade}` : ''}`,
  })), [setups])

  const priceLines = useMemo(() => {
    const s = setups.find(x => x.id === selectedSetupId)
    if (!s) return []
    const lines = []
    if (s.entry_price != null) lines.push({ price: s.entry_price, color: ENTRY_COLOR, lineStyle: 2, title: `Entry ${fmtPrice(s.entry_price)}` })
    if (s.stop_price != null) lines.push({ price: s.stop_price, color: STOP_COLOR, lineStyle: 2, title: `Stop ${fmtPrice(s.stop_price)}` })
    if (s.target_price != null) lines.push({ price: s.target_price, color: TARGET_COLOR, lineStyle: 2, title: `Target ${fmtPrice(s.target_price)}` })
    return lines
  }, [setups, selectedSetupId])

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
      </div>

      <div className={styles.dvBody}>
        <div className={styles.chartWrap}>
          <StockChart
            sym={stock.symbol}
            tf="D"
            height="100%"
            liveUpdates={false}
            showDrawingTools={false}
            entryDate={`${stock.year}-01-01`}
            exitDate={`${stock.year}-12-31`}
            exactDateRange
            forceLogScale
            priceScaleTopMargin={0.06}
            markers={markers}
            priceLines={priceLines}
            className={styles.chart}
          />
        </div>

        {infoOpen && (
          <aside className={styles.infoSide}>
            <div className={styles.infoStatsV}>
              <div className={styles.infoStat}>
                <span className={styles.infoStatLabel}>{stock.year} Gain</span>
                <span className={`${styles.infoStatVal} ${styles.infoStatGreen}`}>{pctStr(stock.oc_pct)}</span>
              </div>
              <div className={styles.infoStat}>
                <span className={styles.infoStatLabel}>Low → High</span>
                <span className={`${styles.infoStatVal} ${styles.infoStatGreen}`}>{pctStr(stock.lh_pct)}</span>
              </div>
              <div className={styles.infoStat}>
                <span className={styles.infoStatLabel}>Avg Daily Vol</span>
                <span className={styles.infoStatVal}>{fmtVol(stock.avg_vol)}</span>
              </div>
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
                  {stock.run_story
                    ? <p className={styles.infoStory}>{stock.run_story}</p>
                    : !stock.company_desc && <p className={styles.infoStoryMuted}>Generating summary…</p>}
                  {isAdmin && (
                    <button className={styles.infoEditLink}
                      onClick={() => { setDescDraft(stock.company_desc || ''); setStoryDraft(stock.run_story || ''); setEditNarr(true) }}>
                      edit
                    </button>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      </div>

      <div className={styles.setupSection}>
        <div className={styles.setupSectionHead}>
          <span className={styles.sectionLabel}>LABELED SETUPS ({setups.length})</span>
          {isAdmin && <AddSetupForm stockId={stock.id} year={stock.year} onAdded={mutate} />}
        </div>
        {setups.length === 0 ? (
          <p className={styles.noSetups}>No setups labeled on this chart yet.</p>
        ) : (
          <div className={styles.setupList}>
            {setups.map(s => {
              const rr = riskReward(s)
              return (
                <div
                  key={s.id}
                  className={`${styles.setupRow} ${selectedSetupId === s.id ? styles.setupRowActive : ''}`}
                  onClick={() => setPickedSetupId(s.id)}
                >
                  <div className={styles.setupMain}>
                    <span className={styles.setupName}>{s.setup_type}</span>
                    <GradePill grade={s.grade} />
                    <span className={styles.setupDate}>{s.label_date}</span>
                  </div>
                  <div className={styles.setupNums}>
                    <span>E {fmtPrice(s.entry_price)}</span>
                    <span style={{ color: STOP_COLOR }}>S {fmtPrice(s.stop_price)}</span>
                    <span style={{ color: ENTRY_COLOR }}>T {fmtPrice(s.target_price)}</span>
                    {rr && <span className={styles.rr}>{rr}:1</span>}
                  </div>
                  {s.notes && <p className={styles.setupNotes}>{s.notes}</p>}
                  {isAdmin && (
                    <button className={styles.deleteBtn} onClick={e => { e.stopPropagation(); deleteSetup(s.id) }}>Delete</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
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

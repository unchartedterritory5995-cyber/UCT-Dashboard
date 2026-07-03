import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import useTickerMeta from '../../hooks/useTickerMeta'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { useAuth } from '../../context/AuthContext'
import { GRADES } from '../../constants/setupGroups'
import { SETUP_CATALOG, SETUP_CATEGORIES, SETUP_FAMILIES, DIRECTION_META } from './setupCatalog'
import { SETUP_PLAYBOOKS } from './setupPlaybooks'
import { parseBarsCsv, resampleWeekly, resampleMonthly } from '../../utils/barsCsv'
import styles from './SetupsView.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// Entry/stop/target price-line colors (same palette as Throughout the Years).
const ENTRY_COLOR = '#1ae51a'   // exact bold candle green so the entry line matches the candles
const STOP_COLOR = '#ff5b5b'    // brighter red — reads clearly on the dark chart
const TARGET_COLOR = '#c9a84c'
const NO_PRICE_LINES = []

// Small decorative pattern used as the Setup Library wordmark mark (a clean
// base-breakout sketch). Rendered by <SetupGlyph/> like any other pattern.
const WORDMARK_GLYPH = { candles: [1.5, 4, 7, -1, 0.6, -0.8, 0.5, 8], pivot: { idx: 2, side: 'h' } }

// Parse a stored drawings_json (chart annotations) → array; [] on missing/bad.
function parseDrawings(json) {
  if (!json) return []
  try { const d = JSON.parse(json); return Array.isArray(d) ? d : [] }
  catch { return [] }
}

// Cap horizontal rays at the setup's candle so they stop there instead of
// streaking to the right edge (mirrors Throughout the Years).
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

// ── Mini pattern glyph ─────────────────────────────────────────────────────────
// Hand-drawn idealized candlestick sketch of the setup (data in setupCatalog.js).
// Pure SVG, no chart lib — these are illustrations, not data.
function buildCandles(moves) {
  let price = 100
  return moves.map(m => {
    // [body%, upperWick%, lowerWick%, gap%] — gap offsets the open vs prior close.
    const [b, uw, dw, g] = Array.isArray(m) ? m : [m]
    const auto = Math.abs(b) * 0.15 + 0.35
    const o = g ? price * (1 + g / 100) : price
    const c = o * (1 + b / 100)
    const h = Math.max(o, c) * (1 + (uw ?? auto) / 100)
    const l = Math.min(o, c) * (1 - (dw ?? auto) / 100)
    price = c
    return { o, c, h, l, up: c >= o }
  })
}

// Standard playbook MA colors: 9 EMA green, 20 EMA purple, 50 SMA blue,
// 200 SMA orange (legacy single `ema` blue).
const EMA_COLORS = { 9: '#5fd98a', 20: '#b07ce8', 50: '#62a8d8', 200: '#e09a5a' }
// Glyph smoothing per nominal period — tuned so each line SITS where it would
// in the real pattern across a ~10-candle sketch (9 hugs price, 200 lags deepest).
const EMA_EFF = { 9: 3, 20: 7, 50: 10, 200: 14 }

// Smooth a polyline through quadratic midpoint curves so the MA reads as a
// flowing line rather than segments.
function smoothPath(pts) {
  const f = n => Number(n).toFixed(1)
  if (pts.length < 3) return 'M' + pts.map(p => `${f(p[0])} ${f(p[1])}`).join(' L')
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`
  }
  const last = pts[pts.length - 1]
  return `${d} L${f(last[0])} ${f(last[1])}`
}

export function SetupGlyph({ setup, className }) {
  const { candles, pivot, trend, ema, emas } = setup
  const W = 132, H = 72, PX = 6, PY = 8
  const data = useMemo(() => buildCandles(candles), [candles])
  const hi = Math.max(...data.map(d => d.h))
  const lo = Math.min(...data.map(d => d.l))
  const y = v => PY + ((hi - v) / (hi - lo || 1)) * (H - PY * 2)
  const step = (W - PX * 2) / data.length
  const bodyW = Math.min(step * 0.58, 9)
  const x = i => PX + step * i + step / 2

  // Moving-average curves. `emas: [9, 20]` draws the playbook pair (9 green /
  // 20 purple); legacy `ema: N` draws a single blue line. The glyphs only have
  // ~7-10 candles, so a nominal period maps to a faster smoothing factor that
  // reproduces where the line would SIT in the real pattern (9 hugs price, 20
  // lags beneath it) rather than the literal math.
  const maLines = (emas || (ema ? [ema] : [])).map(p => {
    const eff = emas ? (EMA_EFF[p] || Math.max(2, Math.round(p / 3))) : p
    const k = 2 / (eff + 1)
    let v = data[0].o
    const pts = data.map((d, i) => {
      v = d.c * k + v * (1 - k)
      return [x(i), y(v)]
    })
    const color = emas ? (EMA_COLORS[p] || '#62a8d8') : '#62a8d8'
    return (
      <path key={p} d={smoothPath(pts)} stroke={color} strokeWidth="0.45" strokeLinecap="round"
        strokeLinejoin="round" fill="none" opacity="0.75" />
    )
  })

  // Both dashed trigger lines run up to — but never through — the final
  // (trigger) candle: they stop right at its leading edge.
  const lineEnd = x(data.length - 1) - bodyW / 2 - 1.5

  // Diagonal dashed trendline: anchored on two candles' highs (or lows).
  let trendEl = null
  if (trend && data[trend.from] && data[trend.to]) {
    const side = trend.side === 'l' ? 'l' : 'h'
    const x1 = x(trend.from), y1 = y(data[trend.from][side])
    const x2 = x(trend.to), y2 = y(data[trend.to][side])
    const slope = (y2 - y1) / (x2 - x1 || 1)
    const xs = x1 - bodyW / 2
    trendEl = (
      <line
        x1={xs} y1={y1 + slope * (xs - x1)} x2={lineEnd} y2={y1 + slope * (lineEnd - x1)}
        stroke="#e6c965" strokeWidth="1" strokeDasharray="3 3" opacity="0.8"
      />
    )
  }

  let pivotEl = null
  if (pivot && data[pivot.idx]) {
    const d = data[pivot.idx]
    const lvl = pivot.side === 'l' ? d.l : pivot.side === 'c' ? d.c : d.h
    pivotEl = (
      <line
        x1={x(pivot.idx) - bodyW / 2} y1={y(lvl)} x2={lineEnd} y2={y(lvl)}
        stroke="#e6c965" strokeWidth="1" strokeDasharray="3 3" opacity="0.8"
      />
    )
  }

  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {/* faint chart-paper rules */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1="2" y1={H * f} x2={W - 2} y2={H * f} stroke="#c9a84c" strokeWidth="0.6" opacity="0.09" />
      ))}
      {maLines}
      {trendEl}
      {pivotEl}
      {data.map((d, i) => {
        const color = d.up ? '#1ae51a' : '#c41f2d'   // match the chart candles (MB_UP / MB_DOWN)
        const top = y(Math.max(d.o, d.c))
        const bot = y(Math.min(d.o, d.c))
        // Fully-opaque bodies + precision rendering: a translucent body let the
        // wick line ghost through as a faint stripe down the candle's middle.
        return (
          <g key={i} shapeRendering="geometricPrecision">
            <line x1={x(i)} y1={y(d.h)} x2={x(i)} y2={y(d.l)} stroke={color} strokeWidth="1" />
            <rect
              x={x(i) - bodyW / 2} y={top}
              width={bodyW} height={Math.max(bot - top, 1.6)}
              fill={color} rx="0.6"
            />
          </g>
        )
      })}
    </svg>
  )
}

// ── Rail row (left index) ────────────────────────────────────────────────────
// One entry in the setup index: name + full description + a direction dot.
// Selecting it loads the setup into the stage — the same "click a row, study
// the chart" rhythm as a stock in Throughout the Years.
function RailRow({ setup, active, expanded, onSelect, onHover, onLeave }) {
  const dir = DIRECTION_META[setup.direction] || DIRECTION_META.long
  return (
    <button
      type="button"
      data-setup-name={setup.name}
      className={`${styles.railRow} ${active ? styles.railRowActive : ''}`}
      aria-expanded={expanded}
      onClick={() => onSelect(setup)}
      onMouseEnter={e => onHover?.(setup, e.currentTarget)}
      onMouseLeave={onLeave}
    >
      <span className={styles.railText}>
        <span className={styles.railNameRow}>
          <span className={`${styles.railDot} ${styles['railDir_' + dir.cls]}`} title={dir.label} aria-hidden="true" />
          <span className={styles.railName}>{setup.name}</span>
        </span>
        <span className={styles.railEssence}>{setup.essence}</span>
      </span>
      <span className={`${styles.railCaret} ${expanded ? styles.railCaretOpen : ''}`} aria-hidden="true">▾</span>
    </button>
  )
}

// Click a setup → a dropdown of its charted examples (logo · symbol · year ·
// grade). Picking one scrolls the right pane to that example. Shares the SWR
// cache key with ExamplesPane, so opening the menu warms the same data.
function ExampleJumpList({ setup, onPick }) {
  const { data } = useSWR(
    `/api/modelbook/setup-examples?setup=${encodeURIComponent(setup.name)}`,
    fetcher, { revalidateOnFocus: false },
  )
  const examples = data?.examples || []
  return (
    <div className={styles.jumpWrap} role="menu">
      {!data && <div className={styles.jumpMsg}>Loading examples…</div>}
      {data && examples.length === 0 && <div className={styles.jumpMsg}>No charted examples yet</div>}
      {examples.length > 0 && (
        <div className={styles.jumpChips}>
          {examples.map(ex => (
              <button
                key={ex.id}
                type="button"
                role="menuitem"
                className={styles.jumpChip}
                onClick={() => onPick(ex)}
              >
                <span className={styles.jumpChipLogo}>
                  <CompanyLogo sym={ex.symbol} size={16} round name={ex.company} />
                </span>
                <span className={styles.jumpChipSym}>{ex.symbol}</span>
                <span className={styles.jumpChipYear}>{ex.year}</span>
                {ex.grade && <span className={styles.jumpChipGrade}>{ex.grade}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

// ── Playbook write-up ──────────────────────────────────────────────────────────
// The firm's full dossier for a setup: drop-cap lede, labeled section rows with
// accent diamonds (entry green / stop red / exit gold), and a common-mistakes
// warning card. Data in setupPlaybooks.js.
function Playbook({ pb, hideIntro }) {
  return (
    <div className={styles.playbook}>
      {!hideIntro && <p className={styles.pbLede}>{pb.intro}</p>}
      <div className={styles.pbGrid}>
        {pb.sections.map(s => (
          <div key={s.label} className={styles.pbRow}>
            <div className={`${styles.pbLabel} ${s.accent ? styles['pbAccent_' + s.accent] : ''}`}>
              <span className={styles.pbDiamond} aria-hidden="true" />
              {s.label}
            </div>
            <p className={styles.pbBody}>{s.body}</p>
          </div>
        ))}
      </div>
      {pb.mistakes?.length > 0 && (
        <div className={styles.pbMistakes}>
          <div className={styles.pbMistakesLabel}>Common Mistakes</div>
          <ul className={styles.pbMistakesList}>
            {pb.mistakes.map(m => (
              <li key={m} className={styles.pbMistake}>
                <span className={styles.pbX} aria-hidden="true"><UIcon name="x" size={13} /></span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Playbook hover panel ───────────────────────────────────────────────────────
// Hovering a setup name (in the rail, or the stage identity header) pops up its
// full playbook in a floating panel — the same hover-to-read rhythm as the
// year-recap popover in Throughout the Years. The charts own the stage; the
// write-up lives one hover away. pointer-events stay ON so a long dossier can be
// scrolled (the parent keeps it open via a short close delay while the cursor
// crosses from the row into the panel).
function PlaybookPopover({ setup, anchor, onEnter, onLeave }) {
  if (!setup || !anchor) return null
  const pb = SETUP_PLAYBOOKS[setup.name]
  const dir = DIRECTION_META[setup.direction] || DIRECTION_META.long
  const gap = 10
  const W = Math.min(440, window.innerWidth - 24)
  // Prefer popping to the RIGHT of the anchor (out over the chart area); fall
  // back to the left, then below, so a wide stage header still lands cleanly.
  let left = anchor.right + gap
  let top = Math.min(Math.max(8, anchor.top - 6), Math.max(8, window.innerHeight - 120))
  if (left + W > window.innerWidth - 8) {
    const leftAlt = anchor.left - W - gap
    if (leftAlt >= 8) {
      left = leftAlt
    } else {
      left = Math.min(Math.max(8, anchor.left), window.innerWidth - W - 8)
      top = anchor.bottom + gap
    }
  }
  const maxH = Math.max(160, window.innerHeight - top - 14)
  return (
    <div
      className={styles.pbPop}
      role="tooltip"
      style={{ top, left, width: W, maxHeight: maxH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={styles.pbPopHead}>
        <SetupGlyph setup={setup} className={styles.pbPopGlyph} />
        <div className={styles.pbPopId}>
          <span className={styles.pbPopName}>{setup.name}</span>
          <span className={styles.pbPopChips}>
            <span className={`${styles.dirChip} ${styles[dir.cls]}`}>{dir.label}</span>
            <span className={styles.catChip}>{setup.family.toUpperCase()}</span>
          </span>
        </div>
      </div>
      <div className={styles.pbPopBody}>
        {pb ? (
          <Playbook pb={pb} />
        ) : (
          <p className={styles.placeholderText}>
            The full write-up for this setup — definition, qualifying criteria, entry trigger,
            risk placement, and trade management — is being authored and will live here.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Charted examples (right pane) ──────────────────────────────────────────────
// Predictive ticker input backed by /api/ticker-search (same source as the
// Charts hub autocomplete). Picking a result also auto-fills the company name.
function TickerSearchInput({ value, onChange, onPick }) {
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

// Admin: add / edit a charted example. `initial` with an id → edit (PUT).
function ExampleForm({ setupName, initial, onSaved, onCancel }) {
  const isEdit = !!initial?.id
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => ({
    symbol: initial?.symbol || '',
    company: initial?.company || '',
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
    try {
      const num = v => (v === '' || v == null ? null : parseFloat(v))
      const body = {
        setup_name: setupName,
        symbol: form.symbol.trim().toUpperCase(),
        company: form.company || null,
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
      const r = await fetch(
        isEdit ? `/api/modelbook/setup-example/${initial.id}` : '/api/modelbook/setup-examples',
        {
          method: isEdit ? 'PUT' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (r.ok) onSaved?.()
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
          onPick={r => setForm(f => ({ ...f, symbol: r.ticker, company: f.company || r.name || '' }))}
        />
        <input className={styles.exInput} placeholder="Company (optional)" value={form.company}
          onChange={e => set('company', e.target.value)} />
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
// (zoom start → setup day as the last candle, arithmetic scale), with the
// white setup candle, entry/stop/target lines, and admin drawing annotations
// saved per example.
function ExampleBlock({ ex, isAdmin, onChanged }) {
  // Show the company name beside the ticker for every example. Prefer the
  // curated `ex.company`; when it's missing, fall back to the live ticker-meta
  // name (same source the watermark uses) so the header is never ticker-only.
  const meta = useTickerMeta(ex.company ? null : ex.symbol)
  const companyName = ex.company || meta.name || null
  const [annotating, setAnnotating] = useState(false)
  const [draft, setDraft] = useState([])
  const [editing, setEditing] = useState(false)
  // Setup vs Result get SEPARATE annotation sets (drawings_json vs
  // result_drawings_json). `view` is the live toggle; `shownView` lags it so the
  // outgoing set fades out before the incoming one fades in (a crossfade rather
  // than a swap). Editing targets the live view's set.
  const [view, setView] = useState('setup')
  const [shownView, setShownView] = useState('setup')
  const activeField = view === 'result' ? 'result_drawings_json' : 'drawings_json'
  useEffect(() => {
    if (annotating) { setShownView(view); return }
    if (shownView === view) return
    const t = setTimeout(() => setShownView(view), 280)
    return () => clearTimeout(t)
  }, [view, annotating, shownView])
  // Inline header "advance" blurb (e.g. "160% in 26 days"), admin-editable.
  const [advance, setAdvance] = useState(ex.advance_note || '')
  useEffect(() => { setAdvance(ex.advance_note || '') }, [ex.advance_note])
  // Local mirror of the watermark position so a drag-commit sticks across
  // re-renders without waiting on a refetch (and never snaps back).
  const [wmPos, setWmPos] = useState({ x: ex.watermark_x ?? 0.2, y: ex.watermark_y ?? 0.2 })
  useEffect(() => {
    setWmPos({ x: ex.watermark_x ?? 0.2, y: ex.watermark_y ?? 0.2 })
  }, [ex.watermark_x, ex.watermark_y])

  // PUT a partial field update on this example (admin-only paths).
  async function patchExample(body) {
    await fetch(`/api/modelbook/setup-example/${ex.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  function saveAdvance() {
    const v = advance.trim()
    if (v === (ex.advance_note || '')) return  // unchanged — skip the write
    patchExample({ advance_note: v || null }).then(() => onChanged?.())
  }
  // Legacy volume-pane annotations get re-anchored to the pane (paneRelY) once the
  // chart settles. Persist immediately when viewing; fold into the draft (saved on
  // Save) when authoring, so it never jumps onto the chart after a Result flip.
  const migrateDrawings = useCallback((next) => {
    if (annotating) { setDraft(next); return }
    if (!isAdmin) return  // viewers can't persist — an admin view migrates it for everyone
    patchExample({ [activeField]: JSON.stringify(next) }).then(() => onChanged?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotating, isAdmin, ex.id, onChanged, activeField])
  // Per-example watermark position: drag commits persist HERE only, never the
  // global chart_settings, so other charts site-wide are unaffected.
  function saveWatermark({ x, y }) {
    setWmPos({ x, y })            // keep the dragged spot across re-renders
    if (!isAdmin) return
    patchExample({ watermark_x: x, watermark_y: y })
  }
  // Setup annotations PERSIST into the Result view — they stay anchored to their
  // candles/prices and glide with the chart during the Setup⇄Result transition
  // (they are not faded out or swapped). Any result-specific annotations layer
  // additively on top once the Result view has settled.
  const drawings = useMemo(() => {
    const setupD = boundHrays(parseDrawings(ex.drawings_json), ex.label_date)
    if (shownView !== 'result') return setupD
    const resultD = boundHrays(parseDrawings(ex.result_drawings_json), ex.label_date)
    return resultD.length ? [...setupD, ...resultD] : setupD
  }, [ex.drawings_json, ex.result_drawings_json, shownView, ex.label_date])
  const priceLines = useMemo(() => {
    const lines = []
    if (ex.entry_price != null) lines.push({ price: ex.entry_price, color: ENTRY_COLOR, lineStyle: 2, title: `Entry $${Number(ex.entry_price).toFixed(2)}` })
    if (ex.stop_price != null) lines.push({ price: ex.stop_price, color: STOP_COLOR, lineStyle: 2, title: `Stop $${Number(ex.stop_price).toFixed(2)}` })
    if (ex.target_price != null) lines.push({ price: ex.target_price, color: TARGET_COLOR, lineStyle: 2, title: `Target $${Number(ex.target_price).toFixed(2)}` })
    return lines.length ? lines : NO_PRICE_LINES
  }, [ex.entry_price, ex.stop_price, ex.target_price])

  // The chart frames the setup window itself — zoom start (or ~80 bars of
  // lead-up) through the setup day, which renders as the LAST candle (bars
  // after it are cut by exactDateRange). Examples without a setup day fall
  // back to the calendar-year frame. When a result end date is saved, a
  // Setup/Result flip swaps to the "after" view: result start (default = the
  // setup frame's left edge, so the pattern stays in view) → result end.
  const hasResult = !!(ex.result_end_date && ex.label_date)
  const frame = useMemo(() => {
    if (!ex.label_date) return { start: `${ex.year}-01-01`, end: `${ex.year}-12-31` }
    const setupStart = ex.frame_start_date || isoDaysBefore(ex.label_date, 120)
    if (view === 'result' && ex.result_end_date) {
      return { start: ex.result_start_date || setupStart, end: ex.result_end_date }
    }
    return { start: setupStart, end: ex.label_date }
  }, [view, ex.label_date, ex.frame_start_date, ex.result_start_date, ex.result_end_date, ex.year])

  function startAnnotate() {
    setDraft(parseDrawings(view === 'result' ? ex.result_drawings_json : ex.drawings_json))
    setAnnotating(true)
  }
  async function saveAnnotations() {
    setAnnotating(false)
    await fetch(`/api/modelbook/setup-example/${ex.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [activeField]: JSON.stringify(draft) }),
    })
    onChanged?.()
  }
  async function del() {
    if (!window.confirm(`Remove the ${ex.symbol} ${ex.year} example?`)) return
    await fetch(`/api/modelbook/setup-example/${ex.id}`, { method: 'DELETE', credentials: 'include' })
    onChanged?.()
  }

  // Uploaded historical bars (fetched only when present) — passed straight to
  // StockChart as barsOverride, bypassing the data providers. Lets a delisted /
  // renamed / foreign ticker (e.g. an old CGC the provider no longer carries)
  // still render from an admin-supplied TradingView CSV.
  const { data: customBarsData, mutate: mutateCustomBars } = useSWR(
    ex.has_custom_bars ? `/api/modelbook/setup-example/${ex.id}/bars` : null,
    fetcher, { revalidateOnFocus: false },
  )
  const customBars = useMemo(
    () => (Array.isArray(customBarsData?.bars) && customBarsData.bars.length ? customBarsData.bars : null),
    [customBarsData],
  )
  // Daily as stored; resampled for the Weekly/Monthly timeframe (matches Model Book).
  const chartBars = useMemo(() => {
    if (!customBars) return null
    const tf = ex.timeframe || 'D'
    if (tf === 'W') return resampleWeekly(customBars)
    if (tf === 'M') return resampleMonthly(customBars)
    return customBars
  }, [customBars, ex.timeframe])
  const barsFileRef = useRef(null)
  const [barsMsg, setBarsMsg] = useState(null)

  // Upload a TradingView (or broker) OHLCV CSV → parsed client-side → stored as
  // this example's chart data.
  async function onBarsFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBarsMsg('Parsing…')
    try {
      const bars = parseBarsCsv(await file.text())
      if (!bars.length) { setBarsMsg('No valid rows found — expected time,open,high,low,close,Volume.'); return }
      setBarsMsg(`Uploading ${bars.length} bars…`)
      const res = await fetch(`/api/modelbook/setup-example/${ex.id}/bars`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bars }),
      })
      if (!res.ok) { setBarsMsg(`Upload failed: ${(await res.text()).slice(0, 140)}`); return }
      const j = await res.json()
      setBarsMsg(`✓ Uploaded ${j.count} bars (${j.first} → ${j.last}).`)
      await onChanged?.()        // refetch examples → has_custom_bars true
      await mutateCustomBars()   // pull the bars → chart swaps to them
      setTimeout(() => setBarsMsg(null), 5000)
    } catch (err) {
      setBarsMsg('Error: ' + (err?.message || 'failed to read file'))
    }
  }
  async function clearBars() {
    if (!window.confirm('Remove the uploaded chart data for this example?')) return
    await fetch(`/api/modelbook/setup-example/${ex.id}/bars`, { method: 'DELETE', credentials: 'include' })
    setBarsMsg('Cleared.')
    await onChanged?.()
    await mutateCustomBars()
    setTimeout(() => setBarsMsg(null), 3000)
  }

  return (
    <div className={styles.exBlock} id={`setup-ex-${ex.id}`}>
      <div className={styles.exBlockHead}>
        <CompanyLogo sym={ex.symbol} size={22} round name={companyName} alt={ex.data_symbol} />
        <span className={styles.exSym}>{ex.symbol}</span>
        {companyName && <span className={styles.exCo}>{companyName}</span>}
        <span className={styles.exYear}>{ex.year}</span>
        {ex.grade && <span className={styles.exGrade}>{ex.grade}</span>}
        {isAdmin ? (
          <input
            className={styles.exAdvance}
            value={advance}
            placeholder="+ advance (e.g. 160% in 26 days)"
            onChange={e => setAdvance(e.target.value)}
            onBlur={saveAdvance}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          />
        ) : (
          ex.advance_note && <span className={styles.exAdvanceText}>{ex.advance_note}</span>
        )}
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
          {isAdmin && !annotating && (
            <button className={styles.exTool} onClick={startAnnotate} title="Draw annotations on this example"><UIcon name="edit" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Annotate</button>
          )}
          {isAdmin && annotating && (
            <>
              <button className={styles.exToolSave} onClick={saveAnnotations}>Save</button>
              <button className={styles.exTool} onClick={() => setAnnotating(false)}>Cancel</button>
            </>
          )}
          {isAdmin && !annotating && (
            <button className={styles.exTool} onClick={() => setEditing(v => !v)}><UIcon name="edit" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Edit</button>
          )}
          {isAdmin && !annotating && (
            <button className={styles.exTool} onClick={() => barsFileRef.current?.click()}
              title="Upload a TradingView OHLCV CSV as this example's chart data (for delisted/renamed/foreign tickers)">
              <UIcon name="equity" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{ex.has_custom_bars ? 'Replace Data' : 'Upload Data'}
            </button>
          )}
          {isAdmin && !annotating && ex.has_custom_bars && (
            <button className={styles.exTool} onClick={clearBars} title="Remove uploaded data">Clear Data</button>
          )}
          <input ref={barsFileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onBarsFile} />
          {isAdmin && !annotating && (
            <button className={styles.exToolDanger} onClick={del} title="Delete this example"><UIcon name="trash" size={14} /></button>
          )}
        </span>
      </div>
      {barsMsg && <div className={styles.exBarsMsg}>{barsMsg}</div>}
      {editing && (
        <ExampleForm
          setupName={ex.setup_name}
          initial={ex}
          onSaved={() => { setEditing(false); onChanged?.() }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className={styles.exChart}>
        <StockChart
          sym={ex.symbol}
          tf={ex.timeframe || 'D'}
          height="100%"
          liveUpdates={false}
          showDrawingTools={false}
          barsOverride={chartBars}
          barsOverridePending={!!(ex.has_custom_bars && !chartBars)}
          entryDate={frame.start}
          exitDate={frame.end}
          exactDateRange
          frameRightPadFrac={0.09}
          keepBarsAfterExit={view === 'result'}
          fitPriceToCandles
          frozen={!annotating}
          hideCrosshair={!annotating}
          hideLegend={!annotating}
          forceScaleMode={ex.scale_mode === 'log' ? 'log' : 'arith'}
          boldCandles
          colorByNetChange
          hideLastValue
          showVolume
          volumeSeparatePane
          markVolumeExtremes
          volumePaneHeightPct={12}
          volumeMa={50}
          priceScaleTopMargin={0.07}
          priceScaleBottomMargin={0.07}
          watermarkOpacity={0.62}
          watermarkX={wmPos.x}
          watermarkY={wmPos.y}
          onWatermarkCommit={saveWatermark}
          watermarkName={ex.company || null}
          priceLines={priceLines}
          hideJournalOverlay
          annotations={annotating ? draft : (drawings.length ? drawings : null)}
          annotationsVisible={annotating || drawings.length > 0}
          annotationsEditable={annotating}
          annotationsTextVisible={true}
          annotationsFadeWhole={false}
          candleFrameFade={false}
          instantFrameFlip
          onAnnotationsChange={setDraft}
          onAnnotationsMigrate={isAdmin ? migrateDrawings : null}
          highlightBarTime={ex.label_date || null}
          highlightColor="#ffffff"
        />
      </div>
      {ex.notes && <p className={styles.exNotes}>{ex.notes}</p>}
    </div>
  )
}

// The scrollable right pane: admin add form + the example charts. The section
// label + Add button moved up into the stage header (DetailStage) so the first
// chart sits right under the identity strip with no wasted band.
function ExamplesPane({ setup, scrollReq, isAdmin, adding, setAdding }) {
  const { data, mutate } = useSWR(
    `/api/modelbook/setup-examples?setup=${encodeURIComponent(setup.name)}`,
    fetcher, { revalidateOnFocus: false },
  )
  const examples = useMemo(() => data?.examples || [], [data])

  // Jump to a specific example when the rail dropdown asks for it (once the
  // examples have loaded and the block is mounted).
  useEffect(() => {
    if (!scrollReq?.exampleId || !examples.length) return
    const el = document.getElementById(`setup-ex-${scrollReq.exampleId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollReq, examples])

  return (
    <div className={styles.exPane}>
      {adding && (
        <ExampleForm
          setupName={setup.name}
          onSaved={() => { setAdding(false); mutate() }}
          onCancel={() => setAdding(false)}
        />
      )}
      {examples.length === 0 && !adding && (
        <div className={styles.exEmpty}>
          <p className={styles.placeholderText}>
            Real historical examples of this setup will be charted here
            {isAdmin ? ' — use “+ Add Example” to chart the first one.' : '.'}
          </p>
        </div>
      )}
      {examples.map(ex => (
        <ExampleBlock key={ex.id} ex={ex} isAdmin={isAdmin} onChanged={mutate} />
      ))}
    </div>
  )
}

// ── Setup stage (right pane) ─────────────────────────────────────────────────
// The selected setup's charted examples fill the stage — the chart-dominant
// right side of Throughout the Years. A slim identity header up top (glyph +
// name + chips + one-line essence) names the setup; hovering it (or its rail
// row) pops up the full playbook in a floating panel instead of spending a
// permanent column on it. The `key` forces a fresh mount per setup so the
// cascade + chart reset cleanly.
function DetailStage({ setup, scrollReq }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [adding, setAdding] = useState(false)
  const dir = DIRECTION_META[setup.direction] || DIRECTION_META.long
  // The DetailStage instance persists across setup changes (only the inner DOM
  // is keyed), so reset the add form when switching setups.
  useEffect(() => { setAdding(false) }, [setup.name])
  return (
    <div className={styles.stage} key={setup.name}>
      {/* Slim identity header — hover the rail row (left) for the playbook.
          Carries the section's Add-Example control (admins) on the right. */}
      <div className={styles.stageHeader}>
        <span className={styles.stageGlyphWrap}>
          <SetupGlyph setup={setup} className={styles.pbGlyph} />
        </span>
        <div className={styles.stageHeadText}>
          <h2 className={styles.stageSetupName}>{setup.name}</h2>
          <div className={styles.stageHeadMeta}>
            <span className={`${styles.dirChip} ${styles[dir.cls]}`}>{dir.label}</span>
            <span className={styles.catChip}>{setup.family.toUpperCase()}</span>
            <span className={styles.stageEssence}>{setup.essence}</span>
          </div>
        </div>
        <div className={styles.stageHeadRight}>
          <span className={styles.stagePbHint} aria-hidden="true">Hover a setup for its playbook</span>
          {isAdmin && (
            <button className={styles.stageAddBtn} onClick={() => setAdding(a => !a)}>
              {adding ? 'Close' : '+ Add Example'}
            </button>
          )}
        </div>
      </div>

      {/* Charted examples — full width */}
      <div className={styles.stageExamplesFull}>
        <ExamplesPane
          setup={setup}
          scrollReq={scrollReq}
          isAdmin={isAdmin}
          adding={adding}
          setAdding={setAdding}
        />
      </div>
    </div>
  )
}

// ── Library screen ─────────────────────────────────────────────────────────────
// A terminal-style two-pane reference, echoing Throughout the Years: a slim
// top bar (back + wordmark + family filter), a left index rail of setups
// (grouped, searchable, each with its pattern glyph), and a main stage that
// loads the selected setup's playbook + charted examples — content is on
// screen the moment you open it, no marketing landing page.
export default function SetupsView({ onExit }) {
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState(SETUP_CATALOG[0]?.name || null)
  const isPhone = useIsPhone()
  const [mobileView, setMobileView] = useState('list')   // phone: list ⇄ detail

  // Playbook hover panel. A short enter-debounce so scrubbing the rail doesn't
  // flash a panel for every row in passing; a short close-delay bridges the gap
  // between the row and the panel so the cursor can move onto it (and scroll a
  // long dossier). Disabled on phones — there's no hover, and tapping selects.
  const [hoverPb, setHoverPb] = useState({ setup: null, anchor: null })
  const pbEnterTimer = useRef(null)
  const pbLeaveTimer = useRef(null)
  const onPbHover = useCallback((setup, el) => {
    if (isPhone) return
    clearTimeout(pbLeaveTimer.current)
    clearTimeout(pbEnterTimer.current)
    const rect = el.getBoundingClientRect()
    pbEnterTimer.current = setTimeout(() => setHoverPb({ setup, anchor: rect }), 180)
  }, [isPhone])
  const onPbLeave = useCallback(() => {
    clearTimeout(pbEnterTimer.current)
    clearTimeout(pbLeaveTimer.current)
    pbLeaveTimer.current = setTimeout(() => setHoverPb({ setup: null, anchor: null }), 140)
  }, [])
  const onPbPopEnter = useCallback(() => clearTimeout(pbLeaveTimer.current), [])
  useEffect(() => () => { clearTimeout(pbEnterTimer.current); clearTimeout(pbLeaveTimer.current) }, [])

  // Click a setup → a dropdown of its charted examples under the row. The menu
  // belongs to the selected setup; picking an example scrolls the right pane to
  // it via a bumped request (so re-picking the same one re-scrolls).
  const [exMenuOpen, setExMenuOpen] = useState(false)
  const [scrollReq, setScrollReq] = useState(null)
  function jumpToExample(ex) {
    setScrollReq(prev => ({ exampleId: ex.id, seq: (prev?.seq || 0) + 1 }))
    if (isPhone) setMobileView('detail')
  }
  // Switching setups always starts fresh at the first example — drop any pending
  // example-scroll request so a stale one (e.g. the last ticker clicked in a
  // setup you're returning to) can't re-fire and jump the pane down.
  useEffect(() => { setScrollReq(null) }, [selectedName])

  const counts = useMemo(() => {
    const c = { All: SETUP_CATALOG.length }
    for (const s of SETUP_CATALOG) c[s.family] = (c[s.family] || 0) + 1
    return c
  }, [])

  // Filter by family pill + free-text query (name or essence).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SETUP_CATALOG.filter(s =>
      (filter === 'All' || s.family === filter) &&
      (!q || s.name.toLowerCase().includes(q) || s.essence.toLowerCase().includes(q)))
  }, [filter, query])

  // Group the visible setups by family so the rail reads like a field-guide
  // index — a labeled divider per family.
  const groups = useMemo(() => {
    return SETUP_FAMILIES
      .map(cat => ({ cat, setups: visible.filter(s => s.family === cat) }))
      .filter(g => g.setups.length)
  }, [visible])

  const selected = useMemo(
    () => SETUP_CATALOG.find(s => s.name === selectedName) || null,
    [selectedName],
  )

  // Flat list of setups in the rail's visual order (group order, then within
  // each group) — drives ↑/↓ keyboard navigation.
  const visibleFlat = useMemo(() => groups.flatMap(g => g.setups), [groups])

  function openSetup(s) {
    if (s.name === selectedName) {
      setExMenuOpen(o => !o)          // re-click the open setup → toggle its menu
    } else {
      setSelectedName(s.name)
      setExMenuOpen(true)             // new setup → open its examples menu
    }
    if (isPhone) setMobileView('detail')
  }

  // ↑/↓ steps through the rail (like the arrow nav in Throughout the Years).
  // Ignored while typing in the search box; off on phones (rail is view-switched).
  useEffect(() => {
    if (isPhone) return
    function onKey(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (!visibleFlat.length) return
      e.preventDefault()
      const idx = visibleFlat.findIndex(s => s.name === selectedName)
      const next = idx === -1
        ? visibleFlat[0]
        : visibleFlat[e.key === 'ArrowDown' ? Math.min(idx + 1, visibleFlat.length - 1) : Math.max(idx - 1, 0)]
      if (!next) return
      // Keep the examples menu's open/closed state as-is: since the dropdown is a
      // single element gated on `exMenuOpen && name === selectedName`, changing the
      // selection makes it close under the old setup and re-open under the new one.
      setSelectedName(next.name)
      requestAnimationFrame(() => {
        document.querySelector(`[data-setup-name="${next.name}"]`)?.scrollIntoView({ block: 'nearest' })
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleFlat, selectedName, isPhone])

  // Clicking a family pill filters the rail AND loads that family's first setup
  // into the stage, so the filter feels responsive instead of leaving a stale
  // selection on screen. Stays in list view on phone (you're still browsing).
  function selectFilter(cat) {
    setFilter(cat)
    setExMenuOpen(false)
    const first = cat === 'All' ? SETUP_CATALOG[0] : SETUP_CATALOG.find(s => s.family === cat)
    if (first) setSelectedName(first.name)
  }

  return (
    <div className={styles.root}>
      <div className={styles.libBg} aria-hidden="true" />

      {/* Slim top bar — back + wordmark + family filter (mirrors the year strip
          in Throughout the Years). */}
      <div className={styles.topbar}>
        <button className={styles.backBtn} onClick={onExit}>‹ Model Book</button>
        <div className={styles.wordmark}>
          <SetupGlyph setup={WORDMARK_GLYPH} className={styles.wordmarkGlyph} />
          {/* Real heading (not a span): the page's accessible title — screen
              readers and tests find the library by its name again. */}
          <h1 className={styles.wordmarkText}>Setup Library</h1>
        </div>
        <div className={styles.pills}>
          {SETUP_CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              className={`${styles.pill} ${filter === cat ? styles.pillActive : ''}`}
              onClick={() => selectFilter(cat)}
            >
              {cat} <span className={styles.pillCount}>{counts[cat] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.shell}>
        {/* Left — the setup index */}
        {(!isPhone || mobileView === 'list') && (
          <aside className={styles.rail}>
            <div className={styles.railHead}>
              <div className={styles.searchWrap}>
                <span className={styles.searchIcon} aria-hidden="true">⌕</span>
                <input
                  className={styles.searchInput}
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search setups"
                  aria-label="Search setups"
                />
                {query && (
                  <button className={styles.searchClear} onClick={() => setQuery('')} aria-label="Clear search">×</button>
                )}
              </div>
            </div>
            <div className={styles.railScroll}>
              {groups.length === 0 && (
                <div className={styles.railEmpty}>No setups match “{query}”.</div>
              )}
              {groups.map(g => (
                <div key={g.cat} className={styles.railGroup}>
                  <div className={styles.railGroupHead}>
                    <span className={styles.railGroupLabel}>{g.cat}</span>
                    <span className={styles.railGroupCount}>{g.setups.length}</span>
                  </div>
                  {g.setups.map(s => (
                    <Fragment key={s.name}>
                      <RailRow
                        setup={s}
                        active={s.name === selectedName}
                        expanded={exMenuOpen && s.name === selectedName}
                        onSelect={openSetup}
                        onHover={onPbHover}
                        onLeave={onPbLeave}
                      />
                      {exMenuOpen && s.name === selectedName && (
                        <ExampleJumpList setup={s} onPick={jumpToExample} />
                      )}
                    </Fragment>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Right — the selected setup's study stage */}
        {(!isPhone || mobileView === 'detail') && (
          <main className={styles.stageWrap}>
            {isPhone && (
              <button className={styles.mobileBack} onClick={() => setMobileView('list')}>‹ All setups</button>
            )}
            {selected
              ? <DetailStage setup={selected} scrollReq={scrollReq} />
              : <div className={styles.stageEmpty}>Select a setup to study its playbook.</div>}
          </main>
        )}
      </div>

      {!isPhone && (
        <PlaybookPopover
          setup={hoverPb.setup}
          anchor={hoverPb.anchor}
          onEnter={onPbPopEnter}
          onLeave={onPbLeave}
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import CompanyLogo from '../../components/CompanyLogo'
import useTickerMeta from '../../hooks/useTickerMeta'
import { useAuth } from '../../context/AuthContext'
import { GRADES } from '../../constants/setupGroups'
import { SETUP_CATALOG, SETUP_CATEGORIES, SETUP_FAMILIES, FAMILY_CHIP, DIRECTION_META } from './setupCatalog'
import { SETUP_PLAYBOOKS } from './setupPlaybooks'
import styles from './SetupsView.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// Entry/stop/target price-line colors (same palette as Throughout the Years).
const ENTRY_COLOR = '#3cb868'
const STOP_COLOR = '#e74c3c'
const TARGET_COLOR = '#c9a84c'
const NO_PRICE_LINES = []

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
        const color = d.up ? '#3cb868' : '#e05252'
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

// ── Library card ───────────────────────────────────────────────────────────────
function SetupCard({ setup, index, onOpen }) {
  const dir = DIRECTION_META[setup.direction] || DIRECTION_META.long
  return (
    <button type="button" className={styles.card} style={{ '--i': index }} onClick={() => onOpen(setup)}>
      <span className={styles.glyphWrap}>
        <SetupGlyph setup={setup} className={styles.glyph} />
      </span>
      <span className={styles.cardName}>{setup.name}</span>
      <span className={styles.cardEssence}>{setup.essence}</span>
      <span className={styles.cardFoot}>
        <span className={`${styles.dirChip} ${styles[dir.cls]}`}>{dir.label}</span>
        <span className={styles.catChip}>{FAMILY_CHIP[setup.family] || setup.family.toUpperCase()}</span>
        <span className={styles.cardCta}>Study →</span>
      </span>
    </button>
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
                <span className={styles.pbX} aria-hidden="true">✕</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
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
  const drawings = useMemo(
    () => boundHrays(parseDrawings(ex.drawings_json), ex.label_date),
    [ex.drawings_json, ex.label_date],
  )
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
  const [view, setView] = useState('setup')
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
    setDraft(parseDrawings(ex.drawings_json))
    setAnnotating(true)
  }
  async function saveAnnotations() {
    setAnnotating(false)
    await fetch(`/api/modelbook/setup-example/${ex.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawings_json: JSON.stringify(draft) }),
    })
    onChanged?.()
  }
  async function del() {
    if (!window.confirm(`Remove the ${ex.symbol} ${ex.year} example?`)) return
    await fetch(`/api/modelbook/setup-example/${ex.id}`, { method: 'DELETE', credentials: 'include' })
    onChanged?.()
  }

  return (
    <div className={styles.exBlock}>
      <div className={styles.exBlockHead}>
        <CompanyLogo sym={ex.symbol} size={22} round name={companyName} alt={ex.data_symbol} />
        <span className={styles.exSym}>{ex.symbol}</span>
        {companyName && <span className={styles.exCo}>{companyName}</span>}
        <span className={styles.exYear}>{ex.year}</span>
        {ex.grade && <span className={styles.exGrade}>{ex.grade}</span>}
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
            <button className={styles.exTool} onClick={startAnnotate} title="Draw annotations on this example">✏️ Annotate</button>
          )}
          {isAdmin && annotating && (
            <>
              <button className={styles.exToolSave} onClick={saveAnnotations}>Save</button>
              <button className={styles.exTool} onClick={() => setAnnotating(false)}>Cancel</button>
            </>
          )}
          {isAdmin && !annotating && (
            <button className={styles.exTool} onClick={() => setEditing(v => !v)}>✎ Edit</button>
          )}
          {isAdmin && !annotating && (
            <button className={styles.exToolDanger} onClick={del} title="Delete this example">🗑</button>
          )}
        </span>
      </div>
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
          tf="D"
          height="100%"
          liveUpdates={false}
          showDrawingTools={false}
          entryDate={frame.start}
          exitDate={frame.end}
          exactDateRange
          frozen={!annotating}
          hideCrosshair={!annotating}
          hideLegend={!annotating}
          forceScaleMode="arith"
          boldCandles
          colorByNetChange
          hideLastValue
          showVolume
          volumeSeparatePane
          markVolumeExtremes
          volumePaneHeightPct={12}
          volumeMa={50}
          priceScaleTopMargin={0.12}
          priceScaleBottomMargin={0.07}
          watermarkOpacity={0.3}
          watermarkX={0.2}
          watermarkY={0.2}
          watermarkName={ex.company || null}
          priceLines={priceLines}
          annotations={annotating ? draft : (drawings.length ? drawings : null)}
          annotationsVisible={annotating || drawings.length > 0}
          annotationsEditable={annotating}
          onAnnotationsChange={setDraft}
          highlightBarTime={ex.label_date || null}
          highlightColor="#ffffff"
        />
      </div>
      {ex.notes && <p className={styles.exNotes}>{ex.notes}</p>}
    </div>
  )
}

// The scrollable right pane: header + admin add form + the example charts.
function ExamplesPane({ setup }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data, mutate } = useSWR(
    `/api/modelbook/setup-examples?setup=${encodeURIComponent(setup.name)}`,
    fetcher, { revalidateOnFocus: false },
  )
  const examples = useMemo(() => data?.examples || [], [data])
  const [adding, setAdding] = useState(false)
  return (
    <div className={styles.exPane}>
      <div className={styles.exHead}>
        <span className={styles.exHeadLabel}>
          Charted Examples{examples.length > 0 && <span className={styles.exCount}> · {examples.length}</span>}
        </span>
        {isAdmin && !adding && (
          <button className={styles.exAddBtn} onClick={() => setAdding(true)}>+ Add Example</button>
        )}
      </div>
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

// ── Setup detail scaffold ──────────────────────────────────────────────────────
// The full per-setup page: glyph + identity up top, then the playbook write-up
// and charted examples. Both sections are scaffolded ready for content — the
// write-ups are authored by the firm and examples are charted with the same
// annotated chart layout as Throughout the Years.
function SetupDetail({ setup, onBack }) {
  const dir = DIRECTION_META[setup.direction] || DIRECTION_META.long
  const playbook = SETUP_PLAYBOOKS[setup.name]
  return (
    <div className={styles.detailSplit}>
      {/* Left half — identity + the playbook write-up */}
      <div className={styles.detailLeft}>
        <div className={styles.detailTop}>
          <button className={styles.backBtn} onClick={onBack}>‹ Setup Library</button>
        </div>

        <div className={styles.detailHero}>
          <div className={styles.detailGlyphPanel}>
            <SetupGlyph setup={setup} className={styles.detailGlyph} />
            <div className={styles.detailGlyphCaption}>Idealized pattern</div>
          </div>
          <div className={styles.detailId}>
            <h1 className={styles.detailName}>{setup.name}</h1>
            <div className={styles.detailChips}>
              <span className={`${styles.dirChip} ${styles[dir.cls]}`}>{dir.label}</span>
              <span className={styles.catChip}>{setup.family.toUpperCase()}</span>
            </div>
            {/* The study screen shows the full playbook intro; the landing-page
                cards keep the short essence. */}
            <p className={styles.detailEssence}>{playbook?.intro || setup.essence}</p>
          </div>
        </div>

        <div className={styles.sectionHead}>
          <span className={styles.sectionRule} />
          <span className={styles.sectionLabel}>The Playbook</span>
          <span className={styles.sectionRule} />
        </div>
        {playbook ? (
          <Playbook pb={playbook} hideIntro />
        ) : (
          <div className={styles.placeholderPanel}>
            <p className={styles.placeholderText}>
              The full write-up for this setup — definition, qualifying criteria, entry trigger,
              risk placement, and trade management — is being authored and will live here.
            </p>
          </div>
        )}
      </div>

      <div className={styles.splitDivider} aria-hidden="true" />

      {/* Right half — scrollable charted examples */}
      <div className={styles.detailRight}>
        <ExamplesPane setup={setup} />
      </div>
    </div>
  )
}

// ── Library (landing) screen ───────────────────────────────────────────────────
export default function SetupsView({ onExit }) {
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

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

  // Group the visible setups by family so the grid reads like a field-guide
  // index (a labeled divider per group when "All" is showing).
  const groups = useMemo(() => {
    return SETUP_FAMILIES
      .map(cat => ({ cat, setups: visible.filter(s => s.family === cat) }))
      .filter(g => g.setups.length)
  }, [visible])

  if (selected) {
    return <SetupDetail setup={selected} onBack={() => setSelected(null)} />
  }

  let cardIndex = 0
  return (
    <div className={styles.library}>
      <div className={styles.libBg} aria-hidden="true" />
      <div className={styles.libTop}>
        <button className={styles.backBtn} onClick={onExit}>‹ Model Book</button>
      </div>

      <div className={styles.hero}>
        <SetupGlyph
          setup={{ candles: [2, 5, 8, -1.2, 0.8, -0.9, 0.6, 9], pivot: { idx: 2, side: 'h' } }}
          className={styles.heroGlyph}
        />
        <h1 className={styles.heroTitle}>Setup Library</h1>
        <p className={styles.heroTagline}>
          Every pattern in the playbook — defined, illustrated, and backed by real charted examples
          from the greatest stocks in history.
        </p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.pills}>
          {SETUP_CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              className={`${styles.pill} ${filter === cat ? styles.pillActive : ''}`}
              onClick={() => setFilter(cat)}
            >
              {cat} <span className={styles.pillCount}>{counts[cat] || 0}</span>
            </button>
          ))}
        </div>
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

      {groups.length === 0 && (
        <div className={styles.emptySearch}>No setups match “{query}”.</div>
      )}

      {groups.map(g => (
        <section key={g.cat} className={styles.group}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionRule} />
            <span className={styles.sectionLabel}>
              {g.cat} — {g.setups.length} {g.setups.length === 1 ? 'pattern' : 'patterns'}
            </span>
            <span className={styles.sectionRule} />
          </div>
          <div className={styles.grid}>
            {g.setups.map(s => (
              <SetupCard key={s.name} setup={s} index={cardIndex++} onOpen={setSelected} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

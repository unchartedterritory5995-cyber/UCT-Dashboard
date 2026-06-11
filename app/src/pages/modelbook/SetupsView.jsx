import { useMemo, useState } from 'react'
import { SETUP_CATALOG, SETUP_CATEGORIES, SETUP_FAMILIES, FAMILY_CHIP, DIRECTION_META } from './setupCatalog'
import styles from './SetupsView.module.css'

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

  // Diagonal dashed trendline: anchored on two candles' highs (or lows),
  // extended a candle past the second anchor so the trigger breaks through it.
  let trendEl = null
  if (trend && data[trend.from] && data[trend.to]) {
    const side = trend.side === 'l' ? 'l' : 'h'
    const x1 = x(trend.from), y1 = y(data[trend.from][side])
    const x2 = x(trend.to), y2 = y(data[trend.to][side])
    const slope = (y2 - y1) / (x2 - x1 || 1)
    const xs = x1 - bodyW / 2
    const xe = x(Math.min(data.length - 1, trend.to + (trend.ext ?? 1))) + bodyW / 2
    trendEl = (
      <line
        x1={xs} y1={y1 + slope * (xs - x1)} x2={xe} y2={y1 + slope * (xe - x1)}
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
        x1={x(pivot.idx) - bodyW / 2} y1={y(lvl)} x2={W - 2} y2={y(lvl)}
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

// ── Setup detail scaffold ──────────────────────────────────────────────────────
// The full per-setup page: glyph + identity up top, then the playbook write-up
// and charted examples. Both sections are scaffolded ready for content — the
// write-ups are authored by the firm and examples are charted with the same
// annotated chart layout as Throughout the Years.
function SetupDetail({ setup, onBack }) {
  const dir = DIRECTION_META[setup.direction] || DIRECTION_META.long
  return (
    <div className={styles.detail}>
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
          <p className={styles.detailEssence}>{setup.essence}</p>
        </div>
      </div>

      <div className={styles.sectionHead}>
        <span className={styles.sectionRule} />
        <span className={styles.sectionLabel}>The Playbook</span>
        <span className={styles.sectionRule} />
      </div>
      <div className={styles.placeholderPanel}>
        <p className={styles.placeholderText}>
          The full write-up for this setup — definition, qualifying criteria, entry trigger,
          risk placement, and trade management — is being authored and will live here.
        </p>
      </div>

      <div className={styles.sectionHead}>
        <span className={styles.sectionRule} />
        <span className={styles.sectionLabel}>Charted Examples</span>
        <span className={styles.sectionRule} />
      </div>
      <div className={`${styles.placeholderPanel} ${styles.placeholderDashed}`}>
        <svg className={styles.placeholderIcon} viewBox="0 0 48 32" fill="none" aria-hidden="true">
          <g stroke="#c9a84c" strokeWidth="1.4" opacity="0.7">
            <line x1="8" y1="6" x2="8" y2="26" />
            <rect x="5" y="12" width="6" height="9" rx="1" fill="rgba(201,168,76,0.18)" />
            <line x1="24" y1="3" x2="24" y2="23" />
            <rect x="21" y="7" width="6" height="11" rx="1" fill="rgba(201,168,76,0.18)" />
            <line x1="40" y1="9" x2="40" y2="29" />
            <rect x="37" y="13" width="6" height="10" rx="1" fill="rgba(201,168,76,0.18)" />
          </g>
        </svg>
        <p className={styles.placeholderText}>
          Real historical examples of this setup will be charted here — each one opens the
          full annotated chart, exactly like Throughout the Years.
        </p>
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

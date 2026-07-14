import { useMemo, useState } from 'react'
import StockChart from '../../components/StockChart'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import {
  BOTTOM_SIGNPOSTS, BOTTOMS, BOTTOM_TYPES, EXECUTION,
} from './bottomsCatalog'
import styles from './BottomsView.module.css'

// ── Bottom glyph (hero centerpiece) ─────────────────────────────────────────────
// A hand-drawn idealized price arc of a market bottom: descent into a climactic
// low (capitulation wick) → the turn (gold pivot dot) → recovery. Pure SVG.
const GLYPH_SHAPES = {
  'V-Bottom':       { pts: [0.95, 0.74, 0.46, 0.12, 0.42, 0.7, 0.95], lowIdx: 3 },
  'Double Bottom':  { pts: [0.95, 0.6, 0.16, 0.46, 0.1, 0.52, 0.86], lowIdx: 4 },
  'Rounded Bottom': { pts: [0.94, 0.66, 0.4, 0.2, 0.12, 0.12, 0.2, 0.42, 0.7, 0.93], lowIdx: 4 },
}

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

export function BottomGlyph({ type = 'V-Bottom', className }) {
  const shape = GLYPH_SHAPES[type] || GLYPH_SHAPES['V-Bottom']
  const W = 132, H = 72, PX = 8, PY = 9
  const n = shape.pts.length
  const x = i => PX + ((W - PX * 2) / (n - 1)) * i
  const y = v => PY + (1 - v) * (H - PY * 2)
  const pts = shape.pts.map((v, i) => [x(i), y(v)])
  const line = smoothPath(pts)
  const area = `${line} L${x(n - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`
  const lowX = x(shape.lowIdx)
  const lowY = y(shape.pts[shape.lowIdx])

  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="bgHeroArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9a84c" stopOpacity="0.22" />
          <stop offset="1" stopColor="#c9a84c" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(fr => (
        <line key={fr} x1="2" y1={H * fr} x2={W - 2} y2={H * fr} stroke="#c9a84c" strokeWidth="0.6" opacity="0.09" />
      ))}
      <path d={area} fill="url(#bgHeroArea)" />
      <path d={line} stroke="#e6c965" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      <line x1={lowX} y1={lowY} x2={lowX} y2={Math.min(H - 2, lowY + 9)} stroke="#e05252" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <circle cx={lowX} cy={lowY} r="3.1" fill="#f0d479" stroke="#0d0d10" strokeWidth="0.8" />
      <circle cx={lowX} cy={lowY} r="5.4" fill="none" stroke="#f0d479" strokeWidth="0.7" opacity="0.4" />
    </svg>
  )
}

function fmtPct(v) {
  return v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`
}

const SIGNPOST_BY_KEY = Object.fromEntries(BOTTOM_SIGNPOSTS.map(s => [s.key, s]))
// Deepest drawdown in the library — the shared scale for the depth meters so
// every bottom's bar is comparable at a glance.
const MAX_DRAWDOWN = Math.max(...BOTTOMS.map(b => Math.abs(b.drawdownPct || 0)))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const mon = MONTHS[parseInt(m, 10) - 1]
  return mon ? `${mon} ${parseInt(d, 10)}, ${y}` : y
}

// ── Anatomy of a Bottom: a phased process flow (not a card grid) ────────────────
// The signposts laid along a left-to-right track grouped under the three phases
// of a bottom (Exhaustion → Turn → Confirmation), color-coded fear → pivot →
// thrust. Reads as a process, not a catalog.
function AnatomyFlow() {
  const phases = useMemo(() => {
    const order = ['Exhaustion', 'Turn', 'Confirmation']
    return order.map(phase => ({
      phase,
      steps: BOTTOM_SIGNPOSTS.filter(s => s.phase === phase),
    }))
  }, [])
  return (
    <div className={styles.flow}>
      {phases.map((p, pi) => (
        <div key={p.phase} className={styles.flowPhase} style={{ '--i': pi }}>
          <div className={`${styles.flowPhaseLabel} ${styles['phase_' + p.phase.toLowerCase()]}`}>
            {p.phase}
          </div>
          <div className={styles.flowSteps}>
            {p.steps.map(sp => (
              <div key={sp.key} className={`${styles.flowStep} ${styles['accent_' + sp.accent]}`}>
                <div className={styles.flowNode}>{String(sp.num).padStart(2, '0')}</div>
                <div className={styles.flowStepBody}>
                  <div className={styles.flowName}>{sp.name}</div>
                  <div className={styles.flowBlurb}>{sp.blurb}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Vertical "depth" meter — a bar hanging down from the prior-high line, length
// proportional to the drawdown, on a scale shared across the whole ledger.
function DepthMeter({ pct }) {
  const frac = Math.min(1, Math.abs(pct || 0) / MAX_DRAWDOWN)
  return (
    <div className={styles.depth}>
      <div className={styles.depthPct}>{fmtPct(pct)}</div>
      <div className={styles.depthTrack}>
        <div className={styles.depthBar} style={{ height: `${(frac * 100).toFixed(1)}%` }} />
      </div>
      <div className={styles.depthCap}>trough</div>
    </div>
  )
}

// ── Ledger entry (one bottom, a row on the chronological timeline) ──────────────
function LedgerEntry({ bottom, index, onOpen }) {
  return (
    <button type="button" className={styles.entry} style={{ '--i': index }} onClick={() => onOpen(bottom)}>
      <div className={styles.rail}>
        <span className={styles.railNode} />
        <span className={styles.railYear}>{bottom.era}</span>
        {bottom.legendary && <span className={styles.railStar} title="Legendary"><UIcon name="star-fill" size={13} /></span>}
      </div>
      <DepthMeter pct={bottom.drawdownPct} />
      <div className={styles.entryBody}>
        <div className={styles.entryTop}>
          <span className={styles.entryName}>{bottom.name}</span>
          <span className={styles.entryType}>{bottom.type}</span>
          <span className={styles.entryIndex}>{bottom.index}</span>
          <span className={styles.entryDur}>{bottom.durationLabel}</span>
        </div>
        <p className={styles.entryChar}>{bottom.character}</p>
        <div className={styles.entryPips}>
          {(bottom.signposts || []).map((sp, i) => {
            const meta = SIGNPOST_BY_KEY[sp.key]
            return (
              <span
                key={i}
                className={`${styles.pip} ${styles['accent_' + (meta?.accent || 'gold')]}`}
                title={`${meta?.name || sp.key} — ${fmtDate(sp.date)}`}
              />
            )
          })}
          <span className={styles.pipLabel}>{(bottom.signposts || []).length} signposts</span>
        </div>
      </div>
      <span className={styles.entryCta}>Study →</span>
    </button>
  )
}

// ── Detail / study view (one bottom) ────────────────────────────────────────────
const ACCENT_MARKER = {
  red:   { shape: 'circle',  color: '#e05252', position: 'aboveBar' },
  gold:  { shape: 'arrowUp', color: '#f0d479', position: 'belowBar' },
  green: { shape: 'arrowUp', color: '#3cb868', position: 'belowBar' },
}

function BottomDetail({ bottom, onBack }) {
  const markers = useMemo(() => {
    return (bottom.signposts || [])
      .filter(sp => sp.date)
      .map(sp => {
        const meta = SIGNPOST_BY_KEY[sp.key]
        const m = ACCENT_MARKER[meta?.accent] || ACCENT_MARKER.gold
        return { time: sp.date, ...m, text: meta?.name || '' }
      })
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [bottom])

  return (
    <div className={styles.detail}>
      <div className={styles.libBg} aria-hidden="true" />
      <div className={styles.detailTop}>
        <button className={styles.backBtn} onClick={onBack}>‹ Bottoms</button>
      </div>

      <div className={styles.detailHead}>
        <div className={styles.detailId}>
          <div className={styles.detailEra}>{bottom.era} · {bottom.index}</div>
          <h1 className={styles.detailName}>{bottom.name}</h1>
          <div className={styles.detailChips}>
            <span className={styles.typeChip}>{bottom.type}</span>
            {bottom.legendary && <span className={styles.legendaryChip}><UIcon name="star-fill" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Legendary</span>}
          </div>
          <p className={styles.detailChar}>{bottom.character}</p>
        </div>
        <div className={styles.statStrip}>
          <div className={styles.stat}>
            <span className={styles.statVal}>{fmtPct(bottom.drawdownPct)}</span>
            <span className={styles.statLabel}>Peak → Trough</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>{bottom.durationLabel}</span>
            <span className={styles.statLabel}>Bear Duration</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>{fmtDate(bottom.lowDate)}</span>
            <span className={styles.statLabel}>The Low</span>
          </div>
        </div>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartHead}>
          <span className={styles.chartTitle}>{bottom.index} — anatomy of the low</span>
          <span className={styles.chartLegend}>
            <span className={`${styles.legDot} ${styles.legRed}`} /> Selling phase
            <span className={`${styles.legDot} ${styles.legGold}`} /> The turn
            <span className={`${styles.legDot} ${styles.legGreen}`} /> Confirmation
          </span>
        </div>
        <div className={styles.chart}>
          <StockChart
            sym={bottom.chartSym}
            tf="D"
            height="100%"
            liveUpdates={false}
            showDrawingTools={false}
            hideJournalOverlay
            entryDate={bottom.frameStart}
            exitDate={bottom.frameEnd}
            exactDateRange
            frozen
            hideLastValue
            forceScaleMode="arith"
            boldCandles
            showVolume
            volumeSeparatePane
            markVolumeExtremes
            volumePaneHeightPct={14}
            priceScaleTopMargin={0.12}
            priceScaleBottomMargin={0.08}
            watermarkOpacity={0.22}
            watermarkName={bottom.index}
            markers={markers}
            highlightBarTime={bottom.lowDate}
            highlightColor="#f0d479"
          />
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionRule} />
          <span className={styles.sectionLabel}>How It Bottomed</span>
          <span className={styles.sectionRule} />
        </div>
        <p className={styles.narrative}>{bottom.summary}</p>
      </section>

      {bottom.signposts?.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionRule} />
            <span className={styles.sectionLabel}>Signposts That Fired</span>
            <span className={styles.sectionRule} />
          </div>
          <ol className={styles.timeline}>
            {bottom.signposts.map((sp, i) => {
              const meta = SIGNPOST_BY_KEY[sp.key]
              return (
                <li key={i} className={`${styles.tlRow} ${styles['accent_' + (meta?.accent || 'gold')]}`}>
                  <span className={styles.tlDot} />
                  <div className={styles.tlBody}>
                    <div className={styles.tlTopline}>
                      <span className={styles.tlName}>{meta?.name || sp.key}</span>
                      <span className={styles.tlDate}>{fmtDate(sp.date)}</span>
                    </div>
                    <p className={styles.tlNote}>{sp.note}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {bottom.leaders?.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionRule} />
            <span className={styles.sectionLabel}>Leadership That Emerged</span>
            <span className={styles.sectionRule} />
          </div>
          <div className={styles.leaderRow}>
            {bottom.leaders.map(sym => (
              <span key={sym} className={styles.leaderChip}>
                <CompanyLogo sym={sym} size={20} round />
                <span className={styles.leaderSym}>{sym}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionRule} />
          <span className={styles.sectionLabel}>Executing the Turn</span>
          <span className={styles.sectionRule} />
        </div>
        <p className={styles.narrative}>{bottom.execution}</p>
      </section>
    </div>
  )
}

// ── Landing screen ──────────────────────────────────────────────────────────────
export default function BottomsView({ onExit }) {
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(null)

  const counts = useMemo(() => {
    const c = { All: BOTTOMS.length }
    for (const b of BOTTOMS) c[b.type] = (c[b.type] || 0) + 1
    return c
  }, [])

  const visible = useMemo(
    () => BOTTOMS.filter(b => filter === 'All' || b.type === filter),
    [filter],
  )

  if (selected) {
    return <BottomDetail bottom={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className={styles.library}>
      <div className={styles.libBg} aria-hidden="true" />
      <div className={styles.libTop}>
        <button className={styles.backBtn} onClick={onExit}>‹ Model Book</button>
      </div>

      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroGlyphWrap}>
          <BottomGlyph type="V-Bottom" className={styles.heroGlyph} />
        </div>
        <div className={styles.heroText}>
          <h1 className={styles.heroTitle}>Bottoms</h1>
          <p className={styles.heroTagline}>
            How major markets bottom — the anatomy of capitulation, the turn, and the thrust. Study the great historical
            lows so you know when to start hunting a tradable bottom, and how to execute it.
          </p>
        </div>
      </div>

      {/* Anatomy of a Bottom — phased process flow */}
      <section className={styles.anatomy}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionRule} />
          <span className={styles.sectionLabel}>The Anatomy of a Bottom</span>
          <span className={styles.sectionRule} />
        </div>
        <p className={styles.anatomyIntro}>
          A bottom isn’t a moment — it’s a process. The same tells appear, in roughly this order, as a bear market runs
          out of sellers and the next cycle quietly begins.
        </p>
        <AnatomyFlow />
      </section>

      {/* Execution strip */}
      <section className={styles.execStrip}>
        <div className={styles.execHead}>
          <span className={styles.execTitle}>{EXECUTION.title}</span>
          <p className={styles.execBlurb}>{EXECUTION.blurb}</p>
        </div>
        <div className={styles.execVehicles}>
          {EXECUTION.vehicles.map(v => (
            <div key={v.name} className={styles.vehicle}>
              <div className={styles.vehicleTop}>
                <span className={styles.vehicleName}>{v.name}</span>
                {v.tickers.length > 0 && (
                  <span className={styles.vehicleTickers}>
                    {v.tickers.map(t => <span key={t} className={styles.vehicleTicker}>{t}</span>)}
                  </span>
                )}
              </div>
              <p className={styles.vehicleNote}>{v.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The ledger of historical bottoms — a chronological timeline */}
      <section className={styles.gallery}>
        <div className={styles.galleryHead}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionRule} />
            <span className={styles.sectionLabel}>The Ledger of Market Lows</span>
            <span className={styles.sectionRule} />
          </div>
          <div className={styles.pills}>
            {BOTTOM_TYPES.map(t => (
              <button
                key={t}
                type="button"
                className={`${styles.pill} ${filter === t ? styles.pillActive : ''}`}
                onClick={() => setFilter(t)}
              >
                {t} <span className={styles.pillCount}>{counts[t] || 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.ledger}>
          {visible.map((b, i) => (
            <LedgerEntry key={b.id} bottom={b} index={i} onOpen={setSelected} />
          ))}
        </div>
      </section>
    </div>
  )
}

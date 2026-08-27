import { useMemo, useState } from 'react'
import styles from './DailyOverview.module.css'
import DayPath from '../../components/breadth/DayPath'
import useSessionPath from '../../hooks/useSessionPath'
import { drillTarget } from './liveDrill'

/**
 * The Daily tab: today's tape, readable in ten seconds.
 *
 * The hero is the session drawn as one line — the intraday path the live feed
 * records all day and, until this page, showed only as an 84px thumbnail.
 * While the day is provisional the path comes off the live payload; after the
 * 4:15 collector writes the row, `/api/breadth-monitor/session-path/{date}`
 * serves the finished shape (the path is history, not an estimate). No path
 * at all — a holiday, a store gap — falls back to the last 30 sessions of
 * Health, so the page never goes blank.
 */

// The seven metrics the intraday store records (breadth_intraday.PATH_METRICS).
// Labels here, formatting/color from the monitor's own column defs so this
// page never becomes a second authority over a threshold.
const HERO_METRICS = [
  { key: 'pct_above_50sma', label: '% Above 50-Day', pct: true },
  { key: 'breadth_score', label: 'Health' },
  { key: 'pct_above_20ema', label: '% Above 20-EMA', pct: true },
  { key: 'up_4pct_today', label: 'Up 4%' },
  { key: 'down_4pct_today', label: 'Dn 4%', bear: true },
  { key: 'new_52w_highs', label: 'New 52w Highs' },
  { key: 'adv_decline', label: 'Adv − Dec' },
]

const TILE_KEYS = [
  'up_4pct_today', 'down_4pct_today', 'new_52w_highs', 'new_52w_lows',
  'pct_above_20ema', 'pct_above_50sma', 'pct_above_200sma',
  'ratio_5day', 'ratio_10day', 'mcclellan_osc',
]
// A rise in these is deterioration — deltas and mini paths must not read green.
const BEAR_KEYS = new Set(['down_4pct_today', 'new_52w_lows'])

const TONE_HUE = { gain: '#2faf68', loss: '#df4646', gold: '#dcbb5e' }

function tierTone(tier) {
  if (!tier) return null
  if (tier.startsWith('g')) return 'gain'
  if (tier.startsWith('r')) return 'loss'
  if (tier === 'a') return 'gold'
  return null
}

function toneOf(col, row, val) {
  if (!col) return null
  if (col.rowColorFn && row) return tierTone(col.rowColorFn(row))
  if (col.colorFn && val != null) return tierTone(col.colorFn(val))
  return null
}

function fmtVal(col, v) {
  if (col?.fmt) return col.fmt(v)
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1)
}

function fmtDelta(d) {
  if (d == null || !Number.isFinite(d)) return null
  const a = Math.abs(d)
  const body = a >= 10 ? String(Math.round(a))
    : a >= 1 ? a.toFixed(1).replace(/\.0$/, '')
    : a.toFixed(2).replace(/0$/, '').replace(/\.$/, '')
  return `${d > 0 ? '+' : d < 0 ? '-' : ''}${body}`
}

function dateText(iso) {
  if (!iso) return ''
  // Noon anchors the label to the typed day regardless of the viewer's zone.
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .replace(',', ' ·')
}

const ET = 'America/New_York'
function etMinutes(epoch) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(epoch * 1000))
  const h = +(parts.find(p => p.type === 'hour')?.value ?? 0)
  const m = +(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

// Geometry for the hero canvas, in a fixed 1000×200 viewBox. The x-domain is
// the WHOLE session (9:30–4:00 ET), not just the sampled span, so a live
// morning reads as a line with the day still ahead of it.
function buildSession(series, openVal) {
  const pts = (series ?? []).filter(p => Number.isFinite(Number(p?.[1])))
  if (pts.length < 2) return null
  const first = pts[0][0]
  const mins = etMinutes(first)
  const openEpoch = mins > 570 ? first - (mins - 570) * 60 : first
  const closeEpoch = Math.max(openEpoch + 390 * 60, pts[pts.length - 1][0])
  const vals = pts.map(p => Number(p[1]))
  const base = openVal != null ? [...vals, Number(openVal)] : vals
  let lo = Math.min(...base), hi = Math.max(...base)
  if (hi === lo) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.12
  hi += pad; lo -= pad
  const X = e => ((e - openEpoch) / (closeEpoch - openEpoch)) * 1000
  const Y = v => 200 - ((v - lo) / (hi - lo)) * 200
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(Number(p[1])).toFixed(1)}`).join('')
  const area = `${d}L${X(pts[pts.length - 1][0]).toFixed(1)},200L${X(pts[0][0]).toFixed(1)},200Z`
  let hiPt = pts[0], loPt = pts[0]
  for (const p of pts) {
    if (Number(p[1]) > Number(hiPt[1])) hiPt = p
    if (Number(p[1]) < Number(loPt[1])) loPt = p
  }
  const hours = []
  for (let e = Math.ceil(openEpoch / 3600) * 3600; e < closeEpoch; e += 3600) {
    const hm = etMinutes(e)
    if (hm % 60 !== 0) continue
    const h = hm / 60
    hours.push({ x: X(e), label: h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a` })
  }
  return {
    d, area, hours,
    open: openVal != null ? { v: Number(openVal), y: Y(Number(openVal)) } : null,
    tip: { x: X(pts[pts.length - 1][0]), y: Y(Number(pts[pts.length - 1][1])) },
    hi: { v: Number(hiPt[1]), x: X(hiPt[0]) },
    lo: { v: Number(loPt[1]), x: X(loPt[0]) },
    now: Number(pts[pts.length - 1][1]),
    openV: openVal != null ? Number(openVal) : Number(pts[0][1]),
  }
}

// The quiet fallback: the last 30 stored sessions of Health, x by index.
function buildTrend(rows) {
  const vals = rows.map(r => r.breadth_score).filter(v => v != null).map(Number)
  if (vals.length < 2) return null
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi === lo) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.12
  hi += pad; lo -= pad
  const X = i => (i / (vals.length - 1)) * 1000
  const Y = v => 200 - ((v - lo) / (hi - lo)) * 200
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  return {
    d, area: `${d}L1000,200L0,200Z`, hours: [], open: null,
    tip: { x: 1000, y: Y(vals[vals.length - 1]) },
    hi: null, lo: null, now: vals[vals.length - 1], openV: vals[0],
  }
}

export default function DailyOverview({ rows, live, cols, phaseClassFn, onDrill }) {
  const colsByKey = useMemo(() => Object.fromEntries((cols ?? []).map(c => [c.key, c])), [cols])
  const today = rows?.[0] ?? null
  const prev = rows?.[1] ?? null
  const isLive = !!live?.row
  const livePathReady = isLive && Object.keys(live?.path ?? {}).length > 0

  // Whose finished path to fetch: after the close, the top stored row's day;
  // pre-open (a carried live row with no samples yet), the previous session.
  const fetchDate = !today ? null
    : livePathReady ? null
    : isLive ? (prev?.date ?? null)
    : today.date
  const storedPath = useSessionPath(fetchDate)
  const session = livePathReady
    ? { path: live.path, open: live.openValues ?? {}, date: today?.date, live: true }
    : { path: storedPath.path, open: storedPath.open, date: fetchDate, live: false }

  // The row that describes the session on the canvas — for a pre-open carried
  // morning that is YESTERDAY's stored row, not today's carried one.
  const sessionRow = useMemo(
    () => rows?.find(r => !r._live && r.date === session.date) ?? today,
    [rows, session.date, today],
  )

  const heroChoices = HERO_METRICS.filter(m => (session.path?.[m.key]?.length ?? 0) >= 2)
  const [heroKey, setHeroKey] = useState(HERO_METRICS[0].key)
  const active = heroChoices.find(m => m.key === heroKey) ?? heroChoices[0] ?? null

  const storedRows = useMemo(() => rows?.filter(r => !r._live) ?? [], [rows])
  const geom = useMemo(() => {
    if (active) return buildSession(session.path[active.key], session.open?.[active.key])
    return buildTrend(storedRows.slice(0, 30).reverse())
  }, [active, session.path, session.open, storedRows])

  if (!today) {
    return (
      <div className={styles.empty}>
        No session recorded yet — the path starts at the open.
      </div>
    )
  }

  const phase = today.webster_phase ?? today.market_phase
  const state = isLive
    ? live.marketOpen
      ? { kind: 'live', text: `LIVE · ${live.clock} ET` }
      : { kind: 'provisional', text: `PROVISIONAL · ${live.clock} ET` }
    : { kind: 'final', text: 'FINAL' }

  const activeCol = active ? colsByKey[active.key] : null
  const sinceOpen = geom && active ? geom.now - geom.openV : null
  const heroTone = active
    ? (toneOf(activeCol, sessionRow, geom?.now)
        ?? (sinceOpen == null || sinceOpen === 0 ? null
          : (sinceOpen > 0) !== !!active.bear ? 'gain' : 'loss'))
    : null
  const sinceTone = sinceOpen == null || sinceOpen === 0 ? null
    : (sinceOpen > 0) !== !!active?.bear ? 'gain' : 'loss'
  const heroHue = TONE_HUE[heroTone] ?? 'rgba(255,255,255,0.55)'
  const heroValue = active
    ? `${fmtVal(activeCol, geom?.now)}${active.pct ? '%' : ''}`
    : fmtVal(colsByKey.breadth_score, geom?.now)

  const heroEyebrow = active
    ? session.live
      ? 'The session'
      : session.date === today.date ? 'The session — final' : `Previous session · ${session.date}`
    : 'Last 30 sessions · Health'

  const scoreMini = (key, label) => {
    const col = colsByKey[key]
    const v = today[key]
    const d = v != null && prev?.[key] != null ? v - prev[key] : null
    return (
      <div className={styles.scoreMini} key={key}>
        <span className={styles.scoreLabel}>{label}</span>
        <span className={styles.scoreValue} data-tone={toneOf(col, today, v)}>{fmtVal(col, v)}</span>
        {d != null && d !== 0 && (
          <span className={styles.delta} data-tone={d > 0 ? 'gain' : 'loss'}>{fmtDelta(d)}</span>
        )}
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.masthead}>
        <div>
          <div className={styles.dateLine}>{dateText(today.date)}</div>
          <div className={styles.stateRow}>
            <span className={styles.stateBadge} data-kind={state.kind}>
              {state.kind === 'live' && <span className={styles.pulse} aria-hidden="true" />}
              {state.text}
            </span>
            {phase && (
              <span className={`${styles.phaseChip} ${phaseClassFn ? phaseClassFn(phase, styles) : ''}`}>
                {phase}
              </span>
            )}
          </div>
        </div>
        <div className={styles.scores}>
          {scoreMini('breadth_score', 'Health')}
          {scoreMini('uct_exposure', 'UCT Exposure')}
        </div>
      </header>

      {geom && (
        <section className={styles.hero} style={{ '--hero-hue': heroHue }}>
          <div className={styles.heroHead}>
            <span className={styles.eyebrow}>{heroEyebrow}</span>
            {heroChoices.length > 1 && (
              <div className={styles.chipRail} role="tablist" aria-label="Session metric">
                {heroChoices.map(m => (
                  <button
                    key={m.key}
                    role="tab"
                    aria-selected={m.key === active?.key}
                    className={`${styles.chip} ${m.key === active?.key ? styles.chipActive : ''}`}
                    onClick={() => setHeroKey(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.heroReadout}>
            <span className={styles.heroValue} data-tone={heroTone}>{heroValue}</span>
            {active && sinceOpen != null && (
              <span className={styles.sinceOpen} data-tone={sinceTone}>
                {fmtDelta(sinceOpen) ?? '0'}{active.pct ? ' pts' : ''} since open
              </span>
            )}
          </div>
          <div className={styles.canvas}>
            {/* key remounts the path so the draw-in replays on metric switch */}
            <svg viewBox="0 0 1000 200" preserveAspectRatio="none" key={active?.key ?? 'trend'}>
              {geom.hours.map(h => (
                <line key={h.x} x1={h.x} y1="0" x2={h.x} y2="200" className={styles.hourLine} />
              ))}
              {geom.open && (
                <line x1="0" y1={geom.open.y} x2="1000" y2={geom.open.y} className={styles.openLine} />
              )}
              <path d={geom.area} className={styles.heroArea} />
              <path d={geom.d} pathLength="1" className={styles.heroLine} />
            </svg>
            <span
              className={`${styles.tipDot} ${session.live && live.marketOpen ? styles.tipLive : ''}`}
              style={{ left: `${geom.tip.x / 10}%`, top: `${geom.tip.y / 2}%` }}
              aria-hidden="true"
            />
            {geom.open && (
              <span className={styles.openLabel} style={{ top: `${geom.open.y / 2}%` }}>
                open {fmtVal(activeCol, geom.open.v)}
              </span>
            )}
            {geom.hi && geom.hi.v !== geom.lo?.v && (
              <span className={styles.hiLabel} style={{ left: `${geom.hi.x / 10}%` }}>
                H {fmtVal(activeCol, geom.hi.v)}
              </span>
            )}
            {geom.lo && geom.hi?.v !== geom.lo.v && (
              <span className={styles.loLabel} style={{ left: `${geom.lo.x / 10}%` }}>
                L {fmtVal(activeCol, geom.lo.v)}
              </span>
            )}
          </div>
          {geom.hours.length > 0 && (
            <div className={styles.hourRow}>
              {geom.hours.map(h => (
                <span key={h.x} style={{ left: `${h.x / 10}%` }}>{h.label}</span>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <div className={styles.eyebrow}>Today's tape</div>
        <div className={styles.tapeGrid}>
          {TILE_KEYS.map(k => {
            const col = colsByKey[k]
            if (!col) return null
            const v = today[k]
            const pv = prev?.[k]
            const d = v != null && pv != null ? v - pv : null
            const bear = BEAR_KEYS.has(k)
            const deltaTone = d == null || d === 0 ? null : (d > 0) !== bear ? 'gain' : 'loss'
            const target = onDrill ? drillTarget(today, col, live) : null
            const pts = session.path?.[k]
            const drillProps = target ? {
              role: 'button', tabIndex: 0,
              title: 'Click to see stocks',
              onClick: () => onDrill(today, col, live),
              onKeyDown: e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrill(today, col, live) }
              },
            } : {}
            return (
              <div key={k} className={`${styles.tile} ${target ? styles.tileDrill : ''}`} {...drillProps}>
                <div className={styles.tileLabel}>{col.label}</div>
                <div className={styles.tileValue} data-tone={toneOf(col, today, v)}>{fmtVal(col, v)}</div>
                <div className={styles.tileFoot}>
                  {d != null && (
                    <span className={styles.delta} data-tone={deltaTone}>
                      {fmtDelta(d) ?? '0'} vs prior day
                    </span>
                  )}
                  {(pts?.length ?? 0) >= 2 && (
                    <DayPath points={pts} width={64} height={16} showDelta={false}
                             polarity={bear ? 'bear' : 'bull'} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

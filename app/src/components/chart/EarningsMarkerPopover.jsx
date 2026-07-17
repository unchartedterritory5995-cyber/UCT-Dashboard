import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './EarningsMarkerPopover.module.css'

// Themed (OLED) earnings panel shown when an earnings marker is clicked on the
// chart. Data comes straight off the marker (/api/chart/markers → FMP), so it
// opens instantly with no extra fetch. Self-contained: figures only, no footer.

const DIM = '#8a8a90'

// EPS / plain numbers: up to 2 decimals, trailing zeros kept for cents-like reads.
function fmtNum(v, dp = 2) {
  if (v == null || !Number.isFinite(+v)) return '—'
  return (+v).toFixed(dp)
}

// Revenue / large notional: $23.86B, $412.0M, $1.2T.
function fmtBig(v) {
  if (v == null || !Number.isFinite(+v)) return '—'
  const n = +v
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
  return `${sign}${a.toFixed(0)}`
}

function fmtDate(iso) {
  if (!iso) return ''
  // Parse as a plain calendar date (no TZ shift) so 'YYYY-MM-DD' reads as itself.
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(iso)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function pctStr(p) {
  if (p == null || !Number.isFinite(+p)) return null
  return `${+p >= 0 ? '+' : ''}${(+p).toFixed(1)}%`
}

// One "Surprise" line: absolute beat/miss + the %, colored by the SIGN (beat color
// for an upside surprise, miss color for a downside). `pctNum` is the raw number
// used for the sign; `pctStr` is the display text. (The prior bug colored every row
// red because it took `+"+32.8%"` → NaN → treated as negative.)
function SurpriseRow({ label, absStr, pctNum, pctText, beatColor, missColor }) {
  if (absStr == null && pctText == null) return null
  const up = pctNum != null ? pctNum >= 0 : true
  const color = up ? beatColor : missColor
  return (
    <div className={styles.row}>
      <span className={styles.k} style={{ color }}>{label}</span>
      <span className={styles.v} style={{ color }}>
        {absStr != null ? absStr : ''}{pctText != null ? ` (${pctText})` : ''}
      </span>
    </div>
  )
}

export default function EarningsMarkerPopover({ data, x, y, sym, beatColor = '#1ae51a', missColor = '#c41f2d', onClose }) {
  const ref = useRef(null)
  // Position is finalized after mount using the popover's REAL size, so it never
  // overhangs the viewport bottom (badges now sit low on the chart → clicks land
  // near the bottom edge; a fixed-height guess overlapped the OS taskbar area).
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const MARGIN = 16
    const w = el.offsetWidth || 232
    const h = el.offsetHeight || 300
    const vw = window.innerWidth, vh = window.innerHeight
    const left = Math.max(MARGIN, Math.min(x, vw - w - MARGIN))
    // Prefer opening downward; if it wouldn't clear the bottom, flip ABOVE the click.
    let top = y
    if (top + h + MARGIN > vh) top = Math.max(MARGIN, y - h - 24)   // open upward from the click
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN))          // final safety clamp
    setPos({ left, top })
  }, [x, y, data])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    window.addEventListener('keydown', onKey)
    // Defer so the opening click itself doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); clearTimeout(t) }
  }, [onClose])

  if (!data) return null

  // NB: `+null === 0` (finite), so every numeric check must reject null FIRST.
  const isNum = (v) => v != null && Number.isFinite(+v)

  const epsA = data.eps_actual, epsE = data.eps_estimate
  const epsSurpAbs = (isNum(epsA) && isNum(epsE)) ? `${+epsA - +epsE >= 0 ? '+' : ''}${(+epsA - +epsE).toFixed(2)}` : null
  const epsPctNum = data.eps_surprise_pct != null ? +data.eps_surprise_pct
    : (data.surprise != null ? +data.surprise : null)
  const epsPctText = pctStr(epsPctNum)

  const revA = data.revenue_actual, revE = data.revenue_estimate
  const hasRev = isNum(revA) || isNum(revE)
  const revSurpAbs = (isNum(revA) && isNum(revE)) ? `${+revA - +revE >= 0 ? '+' : ''}${fmtBig(+revA - +revE)}` : null
  const revPctNum = data.revenue_surprise_pct != null ? +data.revenue_surprise_pct : null
  const revPctText = pctStr(revPctNum)

  // First paint renders off-screen (measure), then useLayoutEffect pins the real
  // position before the browser shows it — so there's no visible jump.
  const style = pos
    ? { left: pos.left, top: pos.top }
    : { left: x, top: y, visibility: 'hidden' }

  return createPortal(
    <div ref={ref} className={styles.pop} style={style} role="dialog" aria-label={`${sym || ''} earnings`}>
      <div className={styles.head}>
        <span className={styles.title}>{sym ? `${sym} · Earnings` : 'Earnings'}</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className={styles.dateRow}>
        <span className={styles.k} style={{ color: DIM }}>Date</span>
        <span className={styles.v}>{fmtDate(data.date)}</span>
      </div>

      <div className={styles.sectionLabel}>EPS</div>
      <div className={styles.row}><span className={styles.k}>Reported</span><span className={styles.v}>{fmtNum(epsA)}</span></div>
      <div className={styles.row}><span className={styles.k}>Estimate</span><span className={styles.v}>{fmtNum(epsE, 3).replace(/0+$/, '').replace(/\.$/, '')}</span></div>
      <SurpriseRow label="Surprise" absStr={epsSurpAbs} pctNum={epsPctNum} pctText={epsPctText} beatColor={beatColor} missColor={missColor} />

      {hasRev && (<>
        <div className={styles.sectionLabel}>Revenue</div>
        <div className={styles.row}><span className={styles.k}>Reported</span><span className={styles.v}>{fmtBig(revA)}</span></div>
        <div className={styles.row}><span className={styles.k}>Estimate</span><span className={styles.v}>{fmtBig(revE)}</span></div>
        <SurpriseRow label="Surprise" absStr={revSurpAbs} pctNum={revPctNum} pctText={revPctText} beatColor={beatColor} missColor={missColor} />
      </>)}
    </div>,
    document.body,
  )
}

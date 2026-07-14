// app/src/pages/charts/widgets/ChartMarketClock.jsx
// Compact live market clock for the Charts-workspace TF bar (far right, same row
// as Market Cap / Next Earnings). Live ET time (ticks every second) + a pulsing
// session dot + status label + a live countdown to the next session boundary.
// Reuses the shared session logic (useMarketOpen + sessionModel) so it can never
// disagree with the Dashboard's session pill.
import { useEffect, useState } from 'react'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { sessionModel, nextOpenHint } from '../../../components/dashboard/MarketStatusBar'
import styles from '../ChartsWorkspace.module.css'

// Session boundaries in seconds since ET midnight (match useMarketOpen).
const OPEN_S = (9 * 60 + 30) * 60   // 9:30 AM
const CLOSE_S = 16 * 60 * 60        // 4:00 PM
const EXT_END_S = 20 * 60 * 60      // 8:00 PM

function fmtCountdown(secs) {
  if (secs <= 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export default function ChartMarketClock() {
  const session = useMarketOpen()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { label, tone } = sessionModel(session)
  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })

  // ET seconds-since-midnight for the live countdown to the next boundary.
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const nowS = et.getHours() * 3600 + et.getMinutes() * 60 + et.getSeconds()
  let countdown = null
  if (session.isOpen) countdown = { verb: 'CLOSES', txt: fmtCountdown(CLOSE_S - nowS) }
  else if (session.isPremarket) countdown = { verb: 'OPENS', txt: fmtCountdown(OPEN_S - nowS) }
  else if (session.isExtended) countdown = { verb: 'ENDS', txt: fmtCountdown(EXT_END_S - nowS) }

  const toneCls = tone === 'open' ? styles.clkOpen : tone === 'ext' ? styles.clkExt : styles.clkClosed

  return (
    <div className={`${styles.marketClock} ${toneCls}`} title={`New York · ${label}`}>
      <span className={styles.clockDot} aria-hidden="true" />
      <span className={styles.clockTime}>{time}</span>
      <span className={styles.clockEt}>ET</span>
      <span className={styles.clockDivider} aria-hidden="true" />
      <span className={styles.clockStatus}>{label}</span>
      {countdown && countdown.txt ? (
        <span className={styles.clockCountdown}>· {countdown.verb} {countdown.txt}</span>
      ) : (
        !session.isOpen && <span className={styles.clockCountdown}>· {nextOpenHint()}</span>
      )}
    </div>
  )
}

// app/src/pages/charts/widgets/ChartMarketClock.jsx
// Minimal live market clock for the far right of the Charts-workspace TF bar:
// a session-tone dot (green open / amber pre/after-hours / grey closed) + live
// ET time (ticks every second) + an "ET" tag. Reuses useMarketOpen + sessionModel
// so the dot color can never disagree with the Dashboard's session pill.
import { useEffect, useState } from 'react'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { sessionModel } from '../../../components/dashboard/MarketStatusBar'
import styles from '../ChartsWorkspace.module.css'

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
  const toneCls = tone === 'open' ? styles.clkOpen : tone === 'ext' ? styles.clkExt : styles.clkClosed

  return (
    <div className={`${styles.marketClock} ${toneCls}`} title={`New York · ${label}`}>
      <span className={styles.clockDot} aria-hidden="true" />
      <span className={styles.clockTime}>{time}</span>
      <span className={styles.clockEt}>ET</span>
    </div>
  )
}

// app/src/components/tiles/MarketClock.jsx
// Ambient market clock for the Morning Wire's top-left corner. Live ET time +
// session status (open / pre-market / after-hours / closed) + next-open hint.
// Reuses the shared session logic from useMarketOpen + MarketStatusBar so the
// status can never disagree with the Dashboard's session pill.
import { useEffect, useState } from 'react'
import useMarketOpen from '../../hooks/useMarketOpen'
import { sessionModel, nextOpenHint } from '../dashboard/sessionModel'
import styles from './MarketClock.module.css'

function useEtNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function MarketClock() {
  const session = useMarketOpen()
  const now = useEtNow()
  const { label, tone } = sessionModel(session)

  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
  const toneCls = tone === 'open' ? styles.open : tone === 'ext' ? styles.ext : styles.closed

  return (
    <div className={styles.clock}>
      <div className={styles.market}>New York · ET</div>
      <div className={styles.time}>{time}</div>
      <div className={`${styles.session} ${toneCls}`}>
        <span className={styles.dot} aria-hidden="true" />
        {label}
      </div>
      {!session.isOpen && <div className={styles.hint}>{nextOpenHint()}</div>}
    </div>
  )
}

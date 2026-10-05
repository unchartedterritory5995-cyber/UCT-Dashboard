// app/src/pages/terminal/L0Strip.jsx — the L0 status strip (V7).
//
// An always-on status strip mounted at the top of the Terminal shell's `.bar`:
// a ticking ET clock + session label, the market-regime/exposure chip, an
// alert-inbox affordance, and the active channel. Every data source here is
// REUSED, not reinvented:
//   * the clock/session reads S11's shared market-clock stack the exact same
//     way `components/tiles/MarketClock.jsx` does — `useMarketOpen()` (backed
//     by `lib/marketClock/marketClock.js::sessionState`) + `sessionModel()`
//     for the label/tone, and a plain `toLocaleTimeString` in `America/New_York`
//     for the digits. No new clock logic.
//   * the regime chip reads `/api/breadth` via `useMobileSWR`, the exact same
//     hook + endpoint `components/tiles/MarketBreadth.jsx` uses for its
//     Exposure Rating, and renders the SAME `data.exposure.score` field
//     MarketBreadth already displays. SWR dedupes the key, so mounting this
//     strip alongside MarketBreadth (or alone) never double-fetches.
//   * the alert-inbox affordance is the existing `<AlertBell/>` component,
//     rendered as-is (it owns its own feed, auth-gating and dropdown).
//   * the active-channel chip renders `activeChannelOf(layout)`, already
//     computed by TerminalShell and passed in as a prop.
import { useEffect, useState } from 'react'
import useMarketOpen from '../../hooks/useMarketOpen'
import useMobileSWR from '../../hooks/useMobileSWR'
import { sessionModel } from '../../components/dashboard/sessionModel'
import AlertBell from '../../components/AlertBell'
import { activeChannelOf } from './boardModel'
import styles from './L0Strip.module.css'

const breadthFetcher = (url) => fetch(url).then((r) => r.json())

function useEtNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Pure: 0-150 exposure score → the same tone buckets MarketBreadth paints with. */
function regimeTone(score) {
  if (score == null) return 'muted'
  if (score >= 70) return 'bull'
  if (score >= 50) return 'neutral'
  if (score >= 30) return 'caution'
  return 'bear'
}

export default function L0Strip({ layout, isPhone }) {
  const session = useMarketOpen()
  const now = useEtNow()
  const { label, tone } = sessionModel(session)

  // Same key + fetcher MarketBreadth.jsx uses for `/api/breadth` — SWR's
  // cache dedupes this against any other mounted consumer of the same key.
  const { data: breadth } = useMobileSWR('/api/breadth', breadthFetcher, { refreshInterval: 60000, marketHoursOnly: true })
  const expScore = breadth?.exposure?.score ?? null
  const rTone = regimeTone(expScore)

  const activeChannel = activeChannelOf(layout)

  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    ...(isPhone ? {} : { second: '2-digit' }),
    hour12: true,
  })

  const toneCls = tone === 'open' ? styles.toneOpen : tone === 'ext' ? styles.toneExt : styles.toneClosed

  return (
    <div className={styles.strip} data-testid="terminal-l0-strip" data-phone={isPhone ? 'true' : 'false'}>
      <div className={styles.clock} data-testid="l0-clock" title={`${label} · ${time} ET`}>
        <span className={`${styles.sessionDot} ${toneCls}`} aria-hidden="true" />
        <span className={styles.time}>{time}</span>
        <span className={styles.etLabel}>ET</span>
        {!isPhone && <span className={`${styles.sessionLabel} ${toneCls}`}>{label}</span>}
      </div>

      <div
        className={`${styles.chip} ${styles[`regime_${rTone}`]}`}
        data-testid="l0-regime-chip"
        title="UCT Exposure Rating"
      >
        <span className={styles.chipLabel}>{isPhone ? 'EXP' : 'EXPOSURE'}</span>
        <span className={styles.chipValue}>{expScore == null ? '—' : Math.round(expScore)}</span>
      </div>

      <div className={styles.chip} data-testid="l0-channel-chip" title="Active channel">
        <span className={styles.chipLabel}>CH</span>
        <span className={styles.chipValue}>{activeChannel}</span>
      </div>

      <div className={styles.bellWrap} data-testid="l0-alert-bell">
        <AlertBell />
      </div>
    </div>
  )
}

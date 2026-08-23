/**
 * MarketStatusBar — the command-center header strip on the Dashboard.
 * Session pill (live dot + ET clock) · live index chips · UCT Exposure chip,
 * with the daily quote as one italic line beneath. Replaces the tall
 * FuturesStrip row on desktop (mobile keeps FuturesStrip).
 * Null-safe by construction: chips render only for feeds that have data.
 */
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import useMobileSWR from '../../hooks/useMobileSWR'
import useMarketOpen from '../../hooks/useMarketOpen'
import useQuoteOfTheDay from '../../hooks/useQuoteOfTheDay'
import { sessionModel, nextOpenHint } from './sessionModel'
import styles from './MarketStatusBar.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const INDEX_ORDER = ['SPY', 'QQQ', 'IWM', 'DIA', 'BTC', 'VIX']

function useEtClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  })
}

export default function MarketStatusBar() {
  const session = useMarketOpen()
  const clock = useEtClock()
  const { data: snap } = useSWR('/api/snapshot', fetcher, { refreshInterval: 10_000 })
  // Same key MarketBreadth uses → SWR dedupes; no extra request load.
  const { data: breadth } = useMobileSWR('/api/breadth', fetcher, {
    refreshInterval: 60_000, marketHoursOnly: true,
  })

  const { label, tone } = sessionModel(session)
  const { quote } = useQuoteOfTheDay()
  const expScore = breadth?.exposure?.score

  const chips = INDEX_ORDER.map((sym) => {
    const d = sym === 'BTC' ? snap?.futures?.BTC : snap?.etfs?.[sym]
    if (!d || !Number.isFinite(d.chg)) return null
    return { sym, chg: d.chg }
  }).filter(Boolean)

  const toneCls = tone === 'open' ? styles.open : tone === 'ext' ? styles.ext : styles.closed

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={`${styles.session} ${toneCls}`}>
          <span className={styles.dot} aria-hidden="true" />
          {label}
          <span className={styles.clock}> · {clock} ET</span>
          {!session.isOpen && (
            <span className={styles.nextOpen}> · {nextOpenHint()}</span>
          )}
        </span>

        {chips.length > 0 && (
          <div className={styles.chips} aria-label="Index performance">
            {chips.map((c) => (
              <span key={c.sym} className={styles.chip}>
                <span className={styles.chipSym}>{c.sym}</span>
                <span className={c.chg >= 0 ? styles.pos : styles.neg}>
                  {c.chg >= 0 ? '+' : ''}{c.chg.toFixed(2)}%
                </span>
              </span>
            ))}
          </div>
        )}

        {Number.isFinite(expScore) && (
          <span className={styles.exposure} title="UCT Exposure Rating">
            EXPOSURE <strong>{Math.round(expScore)}</strong>
          </span>
        )}
      </div>

      {quote && (
        <div className={styles.quoteLine}>
          <span className={styles.quoteText}>&#8220;{quote.t}&#8221;</span>
          <span className={styles.quoteAuthor}> — {quote.a}</span>
          {quote.src && <span className={styles.quoteSrc}> · {quote.src}</span>}
        </div>
      )}
    </div>
  )
}

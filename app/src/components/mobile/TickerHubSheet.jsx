import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet'
import { useTickerHub } from './TickerHubContext'
import { useFlagged } from '../../hooks/useFlagged'
import useLivePrices from '../../hooks/useLivePrices'
import useWatchlistAlerts from '../../hooks/useWatchlistAlerts'
import useTickerTweets from '../../hooks/useTickerTweets'
import CompassAssistButton from '../voice/CompassAssistButton'
import UIcon from '../ui/UIcon'
import styles from './TickerHubSheet.module.css'

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, timeframe bar, market-cap/earnings/UCT-rating meta, settings
// gear and drawing tools. Lazy, so none of it lands in the eager entry chunk.
const ChartPane = lazy(() => import('../chart/pane/ChartPane'))
const FundamentalSnapshot = lazy(() => import('../FundamentalSnapshot'))

// The sheet's chart is only 240px tall — `density="compact"` on ChartPane
// drops the meta row, session toggle, and clock so the canonical timeframe
// bar + chart still fit. These are the same three codes the retired local
// TFS row offered.
const TF_CODES = ['D', 'W', 'M']

// Outer gate: only mount the body (and its data hooks) when a ticker is open,
// so live-price polling / flag state don't run app-wide while the hub is closed.
export default function TickerHubSheet() {
  const { sym, closeTicker } = useTickerHub()
  if (!sym) return null
  return <TickerHubBody sym={sym} onClose={closeTicker} />
}

function TickerHubBody({ sym, onClose }) {
  const navigate = useNavigate()
  const { isFlagged, toggle } = useFlagged()
  const { prices } = useLivePrices([sym])
  const { createAlert, hasAlert } = useWatchlistAlerts()
  const { data: tweets } = useTickerTweets(sym, { hours: 24 })

  const [tf, setTf] = useState('D')
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertDir, setAlertDir] = useState('above')
  const [alertPrice, setAlertPrice] = useState('')
  const [showFund, setShowFund] = useState(false)

  const live = prices[sym] || prices[String(sym).toUpperCase()]
  const flagged = isFlagged(sym)

  const go = (to) => { onClose(); navigate(to) }
  const openChart = () => {
    try { localStorage.setItem('charts_mobile_sym', sym) } catch { /* noop */ }
    go('/charts')
  }
  const submitAlert = () => {
    const p = parseFloat(alertPrice)
    if (!p || p <= 0) return
    createAlert(sym, p, alertDir)
    setAlertPrice('')
    setAlertOpen(false)
  }

  const topTweets = Array.isArray(tweets) ? tweets.slice(0, 2) : []

  return (
    <Sheet open onClose={onClose} variant="bottom-sheet" title={sym}>
      <div className={styles.body}>
        {live?.price != null && (
          <div className={styles.quote}>
            <span className={styles.price}>${live.price.toFixed(2)}</span>
            {live.change_pct != null && (
              <span className={live.change_pct >= 0 ? styles.up : styles.down}>
                {live.change_pct >= 0 ? '+' : ''}{live.change_pct.toFixed(2)}%
              </span>
            )}
          </div>
        )}

        {/* Mini-chart — ChartPane is the SAME chart /charts renders. `density`
            compact drops the meta row, session toggle and clock so the pane
            fits in 240px; `tfCodes` locks the bar to the retired TFS row's
            three codes; `onSymbolChange` is omitted so the identity row is a
            static label — the sheet's ticker isn't user-retargetable here.
            `stored={null}` with no `onStore` = the user's own chart everywhere. */}
        <div className={styles.chartWrap}>
          <Suspense fallback={<div className={styles.chartLoading}>Loading chart…</div>}>
            <ChartPane
              sym={sym}
              tf={tf}
              onTfChange={setTf}
              stored={null}
              tfCodes={TF_CODES}
              density="compact"
              stockChartProps={{
                height: '240px',
                showDrawingTools: false,
                hideReplay: true,
                hidePatterns: true,
                hideCompare: true,
                hideCountdown: true,
              }}
            />
          </Suspense>
        </div>

        {/* Action row */}
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={openChart}>
            <span className={styles.aicon} aria-hidden="true"><UIcon name="equity" size={14} /></span>Chart
          </button>
          <button
            type="button"
            className={`${styles.action} ${hasAlert(sym) ? styles.on : ''}`}
            onClick={() => setAlertOpen((o) => !o)}
          >
            <span className={styles.aicon} aria-hidden="true"><UIcon name="bell" size={14} /></span>Alert
          </button>
          <button
            type="button"
            className={`${styles.action} ${flagged ? styles.on : ''}`}
            onClick={() => toggle(sym)}
          >
            <span className={styles.aicon} aria-hidden="true"><UIcon name="flag" size={14} /></span>Flag
          </button>
          <button type="button" className={styles.action} onClick={() => go('/journal')}>
            <span className={styles.aicon} aria-hidden="true"><UIcon name="journal" size={14} /></span>Journal
          </button>
          <button
            type="button"
            className={`${styles.action} ${showFund ? styles.on : ''}`}
            onClick={() => setShowFund((o) => !o)}
            aria-expanded={showFund}
          >
            <span className={styles.aicon} aria-hidden="true"><UIcon name="breadth" size={14} /></span>Funds
          </button>
        </div>

        {/* Fundamentals snapshot — lazy + fetch-gated on open */}
        {showFund && (
          <Suspense fallback={<div className={styles.chartLoading}>Loading fundamentals…</div>}>
            <FundamentalSnapshot sym={sym} enabled={showFund} />
          </Suspense>
        )}

        {/* Inline alert form */}
        {alertOpen && (
          <div className={styles.alertForm}>
            <select className={styles.alertSel} value={alertDir} onChange={(e) => setAlertDir(e.target.value)}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input
              className={styles.alertInput}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="$ price"
              value={alertPrice}
              onChange={(e) => setAlertPrice(e.target.value)}
            />
            <button
              type="button"
              className={styles.alertSet}
              disabled={!alertPrice || parseFloat(alertPrice) <= 0}
              onClick={submitAlert}
            >Set</button>
          </div>
        )}

        {/* Compass voice (real; self-hides if no VoiceProvider) */}
        <div className={styles.compassRow}>
          <CompassAssistButton pageHint={`chart of ${sym}`} label={`🧭 Ask Compass about ${sym}`} />
        </div>

        {/* Why it's moving — recent tweets */}
        {topTweets.length > 0 && (
          <div className={styles.why}>
            <div className={styles.whyHdr}>Why it's moving</div>
            {topTweets.map((t) => (
              <p key={t.id} className={styles.tweet}>{t.text}</p>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

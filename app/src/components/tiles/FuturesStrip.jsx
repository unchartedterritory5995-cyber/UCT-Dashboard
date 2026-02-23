// app/src/components/tiles/FuturesStrip.jsx
import useSWR from 'swr'
import styles from './FuturesStrip.module.css'
import TickerPopup from '../TickerPopup'

const fetcher = url => fetch(url).then(r => r.json())

// Display order: 2 rows of 3
const ORDER = ['QQQ', 'SPY', 'IWM', 'DIA', 'BTC', 'VIX']

// ─── Sparkline ────────────────────────────────────────────────────────────────
const SPARK = {
  pos: [
    '0,32 9,28 18,30 27,24 36,22 45,20 54,18 63,15 72,12 81,14 90,10 100,8',
    '0,30 9,32 18,26 27,28 36,22 45,24 54,18 63,16 72,20 81,14 90,12 100,8',
    '0,34 9,30 18,28 27,32 36,26 45,22 54,20 63,18 72,14 81,16 90,10 100,7',
  ],
  neg: [
    '0,10 9,12 18,9 27,14 36,18 45,20 54,22 63,26 72,24 81,28 90,30 100,32',
    '0,8 9,14 18,12 27,16 36,14 45,20 54,24 63,22 72,26 81,28 90,32 100,34',
    '0,12 9,10 18,14 27,18 36,16 45,22 54,20 63,24 72,28 81,26 90,32 100,33',
  ],
  neu: [
    '0,20 9,18 18,22 27,19 36,21 45,20 54,22 63,19 72,21 81,20 90,19 100,21',
  ],
}
const SYM_IDX = { QQQ: 0, SPY: 1, IWM: 2, DIA: 0, BTC: 1, VIX: 2 }

function Sparkline({ sym, css }) {
  const bucket = css === 'pos' ? SPARK.pos : css === 'neg' ? SPARK.neg : SPARK.neu
  const pts = bucket[(SYM_IDX[sym] ?? 0) % bucket.length]
  const color = css === 'pos' ? 'var(--gain)' : css === 'neg' ? 'var(--loss)' : 'var(--text-muted)'
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
      aria-hidden="true"
    >
      <polygon
        points={`${pts} 100,40 0,40`}
        style={{ fill: color, fillOpacity: 0.1, stroke: 'none' }}
      />
      <polyline
        points={pts}
        style={{ fill: 'none', stroke: color, strokeOpacity: 0.2, strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }}
      />
    </svg>
  )
}

// TradingView symbol overrides
const TV_SYMS = { BTC: 'BTCUSD' }
// Symbols with no Finviz equity chart — TradingView only
const TV_ONLY = new Set(['BTC', 'VIX'])
// Symbols that use our /api/chart endpoint instead of Finviz or TradingView
const CUSTOM_CHART = new Set(['VIX'])
const TAB_TO_TF = { '5min': '5', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W' }

function Cell({ sym, price, chg, css }) {
  const tintClass = css === 'pos' ? styles.cellPos : css === 'neg' ? styles.cellNeg : ''
  const customChartFn = CUSTOM_CHART.has(sym)
    ? (tab) => `/api/chart/${sym}?tf=${TAB_TO_TF[tab]}`
    : undefined
  return (
    <TickerPopup
      sym={sym}
      tvSym={TV_SYMS[sym]}
      showFinviz={!TV_ONLY.has(sym)}
      customChartFn={customChartFn}
      as="div"
    >
      <div className={`${styles.cellInner} ${tintClass}`}>
        <Sparkline sym={sym} css={css} />
        <div className={styles.cellContent}>
          <div className={styles.sym}>{sym}</div>
          <div className={styles.price}>{price}</div>
          <div className={`${styles.chg} ${css === 'neg' ? styles.neg : styles.pos}`}>{chg}</div>
        </div>
      </div>
    </TickerPopup>
  )
}

export default function FuturesStrip({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/snapshot',
    fetcher,
    { refreshInterval: 10000 }
  )
  const data = propData !== undefined ? propData : fetched

  if (!data) {
    return <div className={styles.strip}><p className={styles.loading}>Loading prices…</p></div>
  }

  return (
    <div className={styles.strip}>
      <div className={styles.grid}>
        {ORDER.map(sym => {
          // BTC comes from futures bucket, everything else from etfs
          const d = sym === 'BTC' ? data.futures?.BTC : data.etfs?.[sym]
          if (!d) return null
          return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} />
        })}
      </div>
    </div>
  )
}

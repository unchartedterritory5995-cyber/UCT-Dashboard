// app/src/components/tiles/FuturesStrip.jsx
import useSWR from 'swr'
import styles from './FuturesStrip.module.css'
import TickerPopup from '../TickerPopup'

const fetcher = url => fetch(url).then(r => r.json())
const FUTURES_ORDER = ['NQ', 'ES', 'RTY', 'BTC']
const ETF_ORDER     = ['QQQ', 'SPY', 'IWM', 'DIA', 'VIX']

// TradingView continuous-contract symbols for futures + VIX index
const TV_SYMS = { NQ: 'NQ1!', ES: 'ES1!', RTY: 'RTY1!', BTC: 'BTCUSD', VIX: 'TVC:VIX' }
// Tickers that have no Finviz equity chart (use TradingView-only mode)
const TV_ONLY = new Set(['NQ', 'ES', 'RTY', 'BTC', 'VIX'])

function Cell({ sym, price, chg, css, large }) {
  const tintClass = css === 'pos' ? styles.cellPos : css === 'neg' ? styles.cellNeg : ''
  return (
    <TickerPopup
      sym={sym}
      tvSym={TV_SYMS[sym]}
      showFinviz={!TV_ONLY.has(sym)}
      as="div"
    >
      <div className={`${styles.cellInner} ${large ? styles.large : styles.small} ${tintClass}`}>
        <div className={styles.sym}>{sym}</div>
        <div className={styles.price}>{price}</div>
        <div className={`${styles.chg} ${css === 'neg' ? styles.neg : styles.pos}`}>{chg}</div>
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
      <div className={styles.rowLabel}>FUTURES</div>
      <div className={styles.futuresRow}>
        {FUTURES_ORDER.map(sym => {
          const d = data.futures?.[sym]
          if (!d) return null
          return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} large />
        })}
      </div>
      <div className={styles.rowDivider} />
      <div className={styles.rowLabel}>ETFs</div>
      <div className={styles.etfRow}>
        {ETF_ORDER.map(sym => {
          const d = data.etfs?.[sym]
          if (!d) return null
          return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} />
        })}
      </div>
    </div>
  )
}

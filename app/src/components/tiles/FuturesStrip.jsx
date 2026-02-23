// app/src/components/tiles/FuturesStrip.jsx
import useSWR from 'swr'
import styles from './FuturesStrip.module.css'
import TickerPopup from '../TickerPopup'

const fetcher = url => fetch(url).then(r => r.json())

// Display order: 2 rows of 3
const ORDER = ['QQQ', 'SPY', 'IWM', 'DIA', 'BTC', 'VIX']

// TradingView symbol overrides
const TV_SYMS = { BTC: 'BTCUSD', VIX: 'CBOE:VIX' }
// Neither BTC nor VIX have Finviz equity charts — TradingView only
const TV_ONLY = new Set(['BTC', 'VIX'])

function Cell({ sym, price, chg, css }) {
  const tintClass = css === 'pos' ? styles.cellPos : css === 'neg' ? styles.cellNeg : ''
  return (
    <TickerPopup
      sym={sym}
      tvSym={TV_SYMS[sym]}
      showFinviz={!TV_ONLY.has(sym)}
      as="div"
    >
      <div className={`${styles.cellInner} ${tintClass}`}>
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

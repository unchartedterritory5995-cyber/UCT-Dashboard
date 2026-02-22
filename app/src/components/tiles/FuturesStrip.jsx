// app/src/components/tiles/FuturesStrip.jsx
import useSWR from 'swr'
import styles from './FuturesStrip.module.css'

const fetcher = url => fetch(url).then(r => r.json())
const FUTURES_ORDER = ['NQ', 'ES', 'RTY', 'BTC']
const ETF_ORDER = ['QQQ', 'SPY', 'IWM', 'DIA', 'VIX']

function Cell({ sym, price, chg, css, large }) {
  return (
    <div className={`${styles.cell} ${large ? styles.large : styles.small}`}>
      <div className={styles.sym}>{sym}</div>
      <div className={styles.price}>{price}</div>
      <div className={`${styles.chg} ${css === 'neg' ? styles.neg : styles.pos}`}>{chg}</div>
    </div>
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
    return (
      <div className={styles.strip}>
        <p className={styles.loading}>Loading prices…</p>
      </div>
    )
  }

  return (
    <div className={styles.strip}>
      <div className={styles.futuresRow}>
        {FUTURES_ORDER.map(sym => {
          const d = data.futures?.[sym]
          if (!d) return null
          return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} large />
        })}
      </div>
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

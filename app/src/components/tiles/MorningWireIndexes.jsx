// app/src/components/tiles/MorningWireIndexes.jsx
// Top-of-page index strip for the Morning Wire tab. Reuses FuturesStrip's Cell
// (sparkline + tint + TickerPopup) so the cards match the dashboard exactly, but
// drops the Quote-of-the-Day panel and splits the six indices into two groups:
// SPY QQQ DIA (left) · IWM BTC VIX (right).
import useSWR from 'swr'
import { Cell } from './FuturesStrip'
import styles from './MorningWireIndexes.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const LEFT  = ['SPY', 'QQQ', 'DIA']
const RIGHT = ['IWM', 'BTC', 'VIX']
const ALL   = [...LEFT, ...RIGHT]

// BTC lives in the futures bucket; everything else in etfs.
const pick = (data, sym) => (sym === 'BTC' ? data.futures?.BTC : data.etfs?.[sym])

function cell(data, sym) {
  const d = pick(data, sym)
  if (!d) return null
  return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} />
}

function Group({ data, syms }) {
  return <div className={styles.group}>{syms.map(sym => cell(data, sym))}</div>
}

// `grid` renders the six indices as a 3×2 grid (SPY QQQ DIA over IWM BTC VIX)
// for the Morning Wire's top-right corner; otherwise a horizontal split strip.
export default function MorningWireIndexes({ grid = false }) {
  const { data } = useSWR('/api/snapshot', fetcher, { refreshInterval: 10000 })

  // Render nothing until prices arrive — keeps the page header clean and avoids
  // a loading placeholder above the fold.
  if (!data) return null

  if (grid) {
    return <div className={styles.gridStrip}>{ALL.map(sym => cell(data, sym))}</div>
  }

  return (
    <div className={styles.strip}>
      <Group data={data} syms={LEFT} />
      <Group data={data} syms={RIGHT} />
    </div>
  )
}

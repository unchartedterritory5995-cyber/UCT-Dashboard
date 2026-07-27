// app/src/components/tiles/MorningWireIndexes.jsx
// Top-of-page index strip for the Morning Wire tab. Reuses FuturesStrip's Cell
// (sparkline + tint + TickerPopup) so the cards match the dashboard exactly, but
// drops the Quote-of-the-Day panel and splits the six indices into two groups:
// SPY QQQ DIA (left) · IWM BTC VIX (right).
import useSWR from 'swr'
import { Cell } from './FuturesStrip'
import styles from './MorningWireIndexes.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// Index ETFs + VIX live in data.etfs; BTC is the lone survivor of data.futures.
// Index futures (ES/NQ/YM/RTY) were dropped 2026-07-27 (owner call): yfinance's
// futures previous_close is a session stale, so their day-change was measured off
// the wrong baseline — the wire published "NQ down 1.41%" against a real -0.29%.
// The corrected moves just tracked SPY/QQQ/IWM anyway. This also restores the
// layout this file's own header comment has always described.
const LEFT  = ['SPY', 'QQQ', 'DIA']
const RIGHT = ['IWM', 'BTC', 'VIX']
const ALL   = [...LEFT, ...RIGHT]

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

// app/src/components/tiles/KeyLevels.jsx
import { useState } from 'react'
import TileCard from '../TileCard'
import styles from './KeyLevels.module.css'

const DEFAULT_TICKER = 'QQQ'
const QUICK_TICKERS = ['QQQ', 'SPY', 'IWM', 'VIX', 'NVDA', 'META']

export default function KeyLevels({ initialTicker = DEFAULT_TICKER }) {
  const [ticker, setTicker] = useState(initialTicker)
  const [input, setInput] = useState('')

  const chartUrl = `https://finviz.com/chart.ashx?t=${ticker}&ty=c&ta=1&p=d&s=m`

  function handleSubmit(e) {
    e.preventDefault()
    if (input.trim()) {
      setTicker(input.trim().toUpperCase())
      setInput('')
    }
  }

  return (
    <TileCard title={`Key Levels · ${ticker}`}>
      <div className={styles.quickTickers}>
        {QUICK_TICKERS.map(t => (
          <button
            key={t}
            className={`${styles.qBtn} ${ticker === t ? styles.qBtnActive : ''}`}
            onClick={() => setTicker(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div data-testid="key-levels-chart" className={styles.chartWrap}>
        <img
          src={chartUrl}
          alt={`${ticker} chart`}
          className={styles.chart}
          onError={e => { e.target.style.display = 'none' }}
        />
      </div>
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Enter ticker…"
          maxLength={8}
        />
        <button type="submit" className={styles.go}>Go</button>
      </form>
    </TileCard>
  )
}

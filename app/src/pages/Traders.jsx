import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './Traders.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function Traders() {
  const { data: traders } = useSWR('/api/traders', fetcher, { refreshInterval: 60000 })

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Traders</h1>
      {traders
        ? (
          <div className={styles.grid}>
            {traders.map(trader => (
              <TileCard key={trader.name} title={trader.name}>
                <div className={styles.tickers}>
                  {trader.tickers.map(sym => (
                    <a
                      key={sym}
                      className={styles.ticker}
                      href={`https://finviz.com/quote.ashx?t=${sym}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {sym}
                    </a>
                  ))}
                </div>
              </TileCard>
            ))}
          </div>
        )
        : <p className={styles.loading}>Loading traders…</p>
      }
    </div>
  )
}

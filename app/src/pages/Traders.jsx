import useMobileSWR from '../hooks/useMobileSWR'
import TileCard from '../components/TileCard'
import styles from './Traders.module.css'

// ⛔ NOT `fetch(url).then(r => r.json())` — a 402 answers JSON too, and
// its `{detail}` body is truthy, so every `!data` loading guard below is
// skipped and the consumer throws on an error object. See utils/jsonFetcher.js.
import fetcher from '../utils/jsonFetcher'

export default function Traders() {
  const { data: traders, error } = useMobileSWR('/api/traders', fetcher, { refreshInterval: 60000 })

  // ⭐ THE REFUSAL IS SAID OUT LOUD. Checking `r.ok` stops the white screen; it
  // does not by itself tell the member anything. Without this branch a 402
  // leaves `traders` undefined forever and the page reads "Loading traders…"
  // — which is the same picture as a slow network, and neither is true.
  // `/api/traders` is paid-gated, so 402 is the expected refusal, not an outage.
  const refused = error?.status === 402 || error?.status === 403

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Traders</h1>
      {error
        ? (
          <p className={styles.loading} role="status">
            {refused
              ? 'The Traders feed is part of a paid plan.'
              : 'The Traders feed could not be loaded. Retrying…'}
          </p>
        )
        : traders
        ? (
          <div className={styles.grid}>
            {traders.map(trader => (
              <TileCard key={trader.name} icon="user" title={trader.name}>
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

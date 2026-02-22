import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './PostMarket.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function PostMarket() {
  const { data } = useSWR('/api/rundown?type=post_market', fetcher)

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Post Market Recap</h1>
      <TileCard title="End of Day Summary">
        {data?.html
          ? <div className={styles.content} dangerouslySetInnerHTML={{ __html: data.html }} />
          : <div className={styles.placeholder}>
              <p className={styles.placeholderTitle}>Post Market Recap</p>
              <p className={styles.placeholderText}>The end-of-day summary is generated after market close at 4:30 PM ET. Check back after the session ends.</p>
            </div>
        }
      </TileCard>
    </div>
  )
}

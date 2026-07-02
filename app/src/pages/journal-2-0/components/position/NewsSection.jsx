/** RH-style News section — recent per-ticker headlines (chart-news feed). */
import { timeAgo } from '../../../../utils/timeAgo'
import styles from './PositionDetailPage.module.css'

const MAX_ITEMS = 8

export default function NewsSection({ items }) {
  const news = (items || []).slice(0, MAX_ITEMS)
  if (!news.length) return null
  return (
    <section className={styles.section} aria-label="News">
      <h2 className={styles.sectionTitle}>News</h2>
      <ul className={styles.newsList}>
        {news.map((n) => (
          <li key={`${n.url}-${n.time_published}`} className={styles.newsItem}>
            <div className={styles.newsMeta}>
              <span className={styles.newsSource}>{n.source}</span>
              {Number.isFinite(n.time_published) && (
                <span className={styles.newsTime}>{timeAgo(n.time_published * 1000)}</span>
              )}
            </div>
            {n.url ? (
              <a className={styles.newsHeadline} href={n.url} target="_blank" rel="noreferrer">
                {n.headline}
              </a>
            ) : (
              <span className={styles.newsHeadline}>{n.headline}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

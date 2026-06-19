// app/src/components/tiles/TapeFeed.jsx
import useTweetFeed from '../../hooks/useTweetFeed'
import TileCard from '../TileCard'
import NewsFeed from './NewsFeed'
import { SkeletonTileContent } from '../Skeleton'
import { timeAgo } from '../../utils/timeAgo'
import styles from './TapeFeed.module.css'

// Master kill-switch shared with MoversSidebar / MorningWire:
// VITE_TWITTER_UI_ENABLED="0" hides the tweet surfaces. When off we fall back
// to the legacy headline NewsFeed so the dashboard slot is never empty.
const UI_ENABLED = (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'

function isRecent(raw) {
  if (!raw) return false
  const dt = new Date(raw)
  return !isNaN(dt) && (Date.now() - dt.getTime()) < 15 * 60 * 1000
}

// Style cashtags ($AAPL) in brand gold while keeping plain text intact.
// Author handles are intentionally NOT rendered — content only.
function renderTweetText(text) {
  if (!text) return null
  const parts = text.split(/(\$[A-Z]{1,5}\b)/g)
  return parts.map((p, i) =>
    /^\$[A-Z]{1,5}$/.test(p)
      ? <span key={i} className={styles.cashtag}>{p}</span>
      : <span key={i}>{p}</span>,
  )
}

export default function TapeFeed({ data: propData }) {
  const { data: fetched } = useTweetFeed({ hours: 12, limit: 50 })

  // Twitter UI disabled → preserve the original headline news feed.
  if (!UI_ENABLED) return <NewsFeed />

  const tweets = propData !== undefined ? propData : fetched

  return (
    <TileCard icon="wire" title="News">
      {tweets == null ? (
        <SkeletonTileContent lines={5} />
      ) : tweets.length === 0 ? (
        <p className={styles.empty}>Nothing on the tape yet</p>
      ) : (
        <div className={styles.feed}>
          {tweets.map((t) => (
            <div
              key={t.id}
              className={`${styles.item} ${t.is_retweet ? styles.retweet : ''}`}
            >
              <div className={styles.text}>
                {renderTweetText(t.text)}
              </div>
              <div className={styles.meta}>
                {isRecent(t.created_at) && <span className={styles.newDot} title="New" />}
                <span className={styles.time}>{timeAgo(t.created_at)}</span>
                <a
                  className={styles.link}
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="open on X"
                >↗</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </TileCard>
  )
}

// app/src/pages/desk/PostsSection.jsx
// The Desk → Posts: a board of the firm's OWN official Twitter/X accounts
// (flagged is_official), one column/feed per person. Reuses the tweet pipeline.
import { useAuth } from '../../context/AuthContext'
import useTweetFeed from '../../hooks/useTweetFeed'
import { PostIcon } from '../education/icons'
import styles from './Desk.module.css'

function timeAgo(unixSec) {
  if (!unixSec) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function PostCard({ t }) {
  return (
    <a className={styles.postCard} href={t.url} target="_blank" rel="noopener noreferrer">
      <div className={styles.postHead}>
        <span className={styles.postTime}>{timeAgo(t.created_at)}</span>
      </div>
      <div className={styles.postText}>{t.text}</div>
      {Array.isArray(t.media) && t.media.length > 0 && (
        <div
          className={[styles.postMedia, t.media.length === 1 ? styles.postMediaSingle : '']
            .filter(Boolean).join(' ')}
        >
          {t.media.map((src) => (
            <img key={src} className={styles.postMediaImg} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
      {Array.isArray(t.tickers) && t.tickers.length > 0 && (
        <div className={styles.postTickers}>
          {t.tickers.map((sym) => <span key={sym} className={styles.postTicker}>${sym}</span>)}
        </div>
      )}
    </a>
  )
}

// Group the flat official feed into one bucket per author, preserving the
// newest-first order within each, and order columns by who posted most recently.
function groupByAuthor(posts) {
  const byHandle = new Map()
  for (const t of posts) {
    const key = (t.author_handle || '').toLowerCase()
    if (!byHandle.has(key)) {
      byHandle.set(key, {
        handle: t.author_handle,
        name: t.author_name || `@${t.author_handle}`,
        latest: t.created_at || 0,
        posts: [],
      })
    }
    const col = byHandle.get(key)
    col.posts.push(t)
    if ((t.created_at || 0) > col.latest) col.latest = t.created_at || 0
  }
  return [...byHandle.values()].sort((a, b) => (b.latest || 0) - (a.latest || 0))
}

export default function PostsSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Wider window than the market tape — our own posts are lower-frequency
  // (e.g. Bracco posts ~1×/3 days). Pull a full week (== tweet retention) and a
  // higher limit so each person's column has depth.
  const { data, isLoading } = useTweetFeed({ hours: 168, limit: 150, official: true })
  const posts = Array.isArray(data) ? data : []
  const columns = groupByAuthor(posts)

  return (
    <div className={`${styles.section} ${styles.sectionWide}`}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadMain}>
          <span className={styles.sectionIcon} aria-hidden="true"><PostIcon /></span>
          <div>
            <div className={styles.eyebrow}>UCT INTELLIGENCE</div>
            <h1 className={styles.sectionTitle}>Posts</h1>
            <div className={styles.sectionSub}>Latest from our team’s X accounts</div>
          </div>
        </div>
      </div>

      {isLoading && <div className={styles.note}>Loading…</div>}

      {!isLoading && columns.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true"><PostIcon size={30} /></span>
          <div className={styles.emptyTitle}>No posts yet</div>
          <div className={styles.emptyText}>
            {isAdmin
              ? 'Mark your firm’s X accounts as “Official” in Admin → Twitter Accounts. Their posts will stream here automatically.'
              : 'Our team’s posts will appear here shortly.'}
          </div>
        </div>
      )}

      {columns.length > 0 && (
        <div className={styles.postBoard}>
          {columns.map((col) => (
            <div className={styles.postColumn} key={col.handle}>
              <a
                className={styles.postColHead}
                href={`https://x.com/${col.handle}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={styles.postColName}>{col.name}</span>
                <span className={styles.postColHandle}>@{col.handle}</span>
              </a>
              <div className={styles.postColFeed}>
                {col.posts.map((t) => <PostCard key={t.id} t={t} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

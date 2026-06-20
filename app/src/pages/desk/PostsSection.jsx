// app/src/pages/desk/PostsSection.jsx
// The Desk → Posts: a board of the firm's OWN official Twitter/X accounts
// (flagged is_official), one column/feed per person. Reuses the tweet pipeline.
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import useTweetFeed from '../../hooks/useTweetFeed'
import { PostIcon } from '../education/icons'
import styles from './Desk.module.css'

const teamFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const handleOf = (url) => (url || '').replace(/\/+$/, '').split('/').pop().replace(/^@/, '').toLowerCase()

// Round account avatar in the column header: prefers the firm's own Team photo
// (same crisp avatars), falls back to the live X avatar, then a monogram.
function PostAvatar({ src, name }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <div className={styles.postColAvatarFallback} aria-hidden="true">
      {(name || '?')[0].toUpperCase()}
    </div>
  }
  return <img className={styles.postColAvatar} src={src} alt="" loading="lazy"
              onError={() => setFailed(true)} />
}

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

// Fixed left-to-right column order (by X handle, lowercased). Accounts not listed
// fall after these, ordered by who posted most recently.
const COLUMN_ORDER = ['tsdr_trading', 'braczyy', '1chartmaster']
const columnRank = (handle) => {
  const i = COLUMN_ORDER.indexOf((handle || '').toLowerCase())
  return i === -1 ? COLUMN_ORDER.length : i
}

// Group the flat official feed into one bucket per author, preserving the
// newest-first order within each, then order columns by the fixed priority above
// (TSDR → Bracco → 1ChartMaster), with any others by most-recent post.
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
  return [...byHandle.values()].sort((a, b) => {
    const ra = columnRank(a.handle), rb = columnRank(b.handle)
    if (ra !== rb) return ra - rb
    return (b.latest || 0) - (a.latest || 0)
  })
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

  // Map each X handle → the firm's own Team avatar (when that account is a team
  // member), so the Posts headers reuse the crisp photos instead of a monogram.
  const { data: teamData } = useSWR('/api/desk/team', teamFetcher)
  const avatarByHandle = useMemo(() => {
    const m = new Map()
    for (const mem of teamData?.team || []) {
      const h = handleOf(mem.twitter_url)
      if (h && mem.has_photo) m.set(h, `/api/desk/team/${mem.id}/photo`)
    }
    return m
  }, [teamData])
  const avatarFor = (handle) =>
    avatarByHandle.get((handle || '').toLowerCase()) ||
    (handle ? `https://unavatar.io/x/${handle}?fallback=false` : null)

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
                <PostAvatar src={avatarFor(col.handle)} name={col.name} />
                <span className={styles.postColMeta}>
                  <span className={styles.postColName}>{col.name}</span>
                  <span className={styles.postColHandle}>@{col.handle}</span>
                </span>
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

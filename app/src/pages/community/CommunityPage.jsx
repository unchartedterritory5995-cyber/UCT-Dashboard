import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import ThreadView from './ThreadView'
import { useCommunityStatus, useSpaces, useThreads } from './hooks/useCommunity'
import styles from './Community.module.css'

function timeAgo(epoch) {
  if (!epoch) return ''
  const s = Math.max(1, Math.floor(Date.now() / 1000 - epoch))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function CommunityPage() {
  const navigate = useNavigate()
  const { threadId } = useParams()
  const { data: status } = useCommunityStatus()
  const enabled = !!status?.enabled
  const [space, setSpace] = useState('mentor-desk')
  const { data: spaces } = useSpaces(enabled)
  const { data: threadsData } = useThreads(space, enabled && !threadId)

  if (status && !enabled) {
    return (
      <div className={styles.comingSoon}>
        <UIcon name="community" size={40} />
        <h2 className="t-page-title">The Floor</h2>
        <p className="t-body">The UCT community space is opening soon.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <aside className={styles.rail}>
        <div className={styles.railTitle}>
          <UIcon name="community" size={16} /> The Floor
        </div>
        {(spaces || []).map((s) => (
          <button
            key={s.key}
            className={`${styles.railItem} ${space === s.key && !threadId ? styles.railItemActive : ''}`}
            onClick={() => { setSpace(s.key); navigate('/community') }}
          >
            <span>{s.label}</span>
            {s.unread > 0 && <span className={styles.railBadge}>{s.unread > 9 ? '9+' : s.unread}</span>}
          </button>
        ))}
      </aside>
      <main className={styles.main}>
        {threadId ? (
          <ThreadView threadId={threadId} />
        ) : (
          <ThreadList
            threads={threadsData?.threads || []}
            onOpen={(id) => navigate(`/community/${id}`)}
          />
        )}
      </main>
    </div>
  )
}

function ThreadList({ threads, onOpen }) {
  if (!threads.length) {
    return <div className={styles.empty}>No threads here yet.</div>
  }
  return (
    <div className={styles.threadList}>
      {threads.map((t) => (
        <button key={t.id} className={styles.threadRow} onClick={() => onOpen(t.id)}>
          <div className={styles.threadTitleRow}>
            {!!t.pinned && <span className={styles.pinIcon}><UIcon name="pin" size={13} /></span>}
            <span className={styles.threadTitle}>{t.title}</span>
            {!!t.answered && <span className={styles.answeredTick}>Answered</span>}
          </div>
          <div className={styles.meta}>
            <span className={t.author?.is_mentor ? styles.mentorBadge : ''}>
              {t.author?.name || 'member'}
            </span>
            {(t.ticker_tags || []).map((tk) => (
              <span key={tk} className={styles.tickerChip}>${tk}</span>
            ))}
            <span>{t.reply_count} repl{t.reply_count === 1 ? 'y' : 'ies'}</span>
            <span>{timeAgo(t.last_activity_at)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

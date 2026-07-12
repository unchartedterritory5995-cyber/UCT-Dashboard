// app/src/pages/community/components/FloorSearch.jsx
// Search across live-chat messages + forum threads (v1 LIKE search, 250ms debounce).
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { searchFloor } from '../../../lib/chatStreamManager'
import styles from '../Community.module.css'

function ago(epoch) {
  if (!epoch) return ''
  const s = Math.max(1, Math.floor(Date.now() / 1000 - epoch))
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function FloorSearch({ onOpenChannel, onOpenThread }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const tRef = useRef(null)

  useEffect(() => {
    clearTimeout(tRef.current)
    if (q.trim().length < 2) { setRes(null); return }
    tRef.current = setTimeout(async () => {
      try { setRes(await searchFloor(q.trim())) } catch (_) { setRes(null) }
    }, 250)
    return () => clearTimeout(tRef.current)
  }, [q])

  return (
    <div className={styles.inboxWrap}>
      <button className={styles.bellBtn} onClick={() => setOpen((o) => !o)}
        title="Search The Floor" aria-label="Search">
        <UIcon name="search" size={15} />
      </button>
      {open && (
        <div className={styles.inbox}>
          <div className={styles.searchBox}>
            <input autoFocus className={styles.searchInput} placeholder="Search the floor…"
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }} />
          </div>
          {res && (res.messages?.length || res.threads?.length) ? (
            <>
              {(res.messages || []).map((m) => (
                <button key={`m${m.id}`} className={styles.inboxItem}
                  onClick={() => { onOpenChannel?.(m.channel_slug); setOpen(false) }}>
                  <div className={styles.inboxTop}>
                    <span className={m.author?.is_mentor ? styles.mentorBadge : styles.msgAuthor}>
                      {m.author?.name || 'member'}
                    </span>
                    <span className={styles.msgTime}>#{String(m.channel_slug).replace(/^board:/, '')} · {ago(m.created_at)}</span>
                  </div>
                  <div className={styles.inboxSnippet}>{m.snippet}</div>
                </button>
              ))}
              {(res.threads || []).map((t) => (
                <button key={`t${t.id}`} className={styles.inboxItem}
                  onClick={() => { onOpenThread?.(t.id); setOpen(false) }}>
                  <div className={styles.inboxTop}>
                    <span className={styles.msgAuthor}><UIcon name="library" size={11} /> Board thread</span>
                    <span className={styles.msgTime}>{ago(t.last_activity_at)}</span>
                  </div>
                  <div className={styles.inboxSnippet}>{t.title}</div>
                </button>
              ))}
            </>
          ) : (
            <div className={styles.inboxEmpty}>
              {q.trim().length < 2 ? 'Type to search messages and threads.' : 'No matches.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

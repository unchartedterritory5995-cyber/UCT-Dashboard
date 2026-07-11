// app/src/pages/community/components/MentionInbox.jsx
import { useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import { fetcher, apiCall } from '../hooks/useCommunity'
import styles from '../Community.module.css'

function ago(epoch) {
  if (!epoch) return ''
  const s = Math.max(1, Math.floor(Date.now() / 1000 - epoch))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function MentionInbox({ onOpenChannel }) {
  const [open, setOpen] = useState(false)
  const { data, mutate } = useSWR('/api/community/chat/mentions', fetcher, { refreshInterval: 25_000 })
  const unseen = data?.unseen || 0
  const mentions = data?.mentions || []

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && unseen > 0) {
      await apiCall('/api/community/chat/mentions/read', {})
      mutate({ ...data, unseen: 0, mentions: mentions.map((m) => ({ ...m, seen: 1 })) }, false)
    }
  }

  return (
    <div className={styles.inboxWrap}>
      <button className={styles.bellBtn} onClick={toggle} title="Mentions" aria-label="Mentions">
        <UIcon name="bell" size={15} />
        {unseen > 0 && <span className={styles.bellBadge}>{unseen > 9 ? '9+' : unseen}</span>}
      </button>
      {open && (
        <div className={styles.inbox}>
          <div className={styles.inboxHead}>Mentions</div>
          {mentions.length === 0 ? (
            <div className={styles.inboxEmpty}>No mentions yet.</div>
          ) : (
            mentions.map((m) => (
              <button key={m.id} className={styles.inboxItem}
                onClick={() => { onOpenChannel?.(m.channel_slug); setOpen(false) }}>
                <div className={styles.inboxTop}>
                  <span className={m.author?.is_mentor ? styles.mentorBadge : styles.msgAuthor}>
                    {m.author?.name || 'member'}
                  </span>
                  <span className={styles.msgTime}>#{String(m.channel_slug).replace(/^board:/, '')} · {ago(m.created_at)}</span>
                </div>
                <div className={styles.inboxSnippet}>{m.snippet || 'mentioned you'}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

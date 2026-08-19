import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TickerPopup from '../../components/TickerPopup'
import UIcon from '../../components/ui/UIcon'
import Composer from './Composer'
import FloorAvatar from './components/FloorAvatar'
import ProfileCard from './components/ProfileCard'
import { useThread, useCommunityStatus, apiCall } from './hooks/useCommunity'
import { renderBodyHTML } from './lib/renderBody'
import { useAuth } from '../../context/AuthContext'
import { subscribeBoardActivity } from '../../lib/chatStreamManager'
import styles from './Community.module.css'

// Icon names come from the UIcon registry (never emoji): `flame` added for
// fire, `equity` (rising chart + arrow) for bullish, `star` for respect.
const REACTIONS = [
  { kind: 'fire', icon: 'flame', label: 'Fire' },
  { kind: 'bullish', icon: 'equity', label: 'Bullish' },
  { kind: 'salute', icon: 'star', label: 'Respect' },
]

function Author({ author, authorId, onOpenProfile }) {
  const open = (e) => {
    if (!onOpenProfile) return
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    onOpenProfile({ userId: authorId || null, name: author?.name, isMentor: author?.is_mentor, x: r.right + 10, y: r.top })
  }
  return (
    <span className={styles.authorWrap}>
      <button className={styles.avatarBtn} onClick={open} aria-label={`${author?.name || 'member'} profile`}>
        <FloorAvatar authorId={authorId} name={author?.name} isMentor={author?.is_mentor} size={26} />
      </button>
      <span className={author?.is_mentor ? styles.mentorBadge : styles.authorName}
        role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter') open(e) }}>
        {author?.name || 'member'}
        {author?.is_mentor && <span className={styles.mentorChip}>UCT MENTOR</span>}
      </span>
    </span>
  )
}

function Post({ post, replies, onReact, onReply, isMentor, onHighlight, onReport, onDelete, meId, onOpenProfile }) {
  // Memoized {__html} object — React 19 diffs dangerouslySetInnerHTML by
  // object identity, so an inline literal re-renders the body on every poll.
  const bodyHtml = useMemo(
    () => (post.deleted ? null : { __html: renderBodyHTML(post.body) }),
    [post.body, post.deleted],
  )
  return (
    <div className={`${styles.post} ${post.author?.is_mentor ? styles.postMentor : ''} ${post.mentor_highlight ? styles.postHighlight : ''}`}>
      <div className={styles.postHead}>
        <Author author={post.author} authorId={post.author_id} onOpenProfile={onOpenProfile} />
        {!!post.mentor_highlight && <span className={styles.highlightTag}>Mentor take</span>}
      </div>
      {post.deleted ? (
        <div className={styles.deletedBody}>removed by moderator</div>
      ) : (
        <div
          className={styles.postBody}
          dangerouslySetInnerHTML={bodyHtml}
        />
      )}
      {!post.deleted && (
        <div className={styles.postActions}>
          {REACTIONS.map((r) => (
            <button key={r.kind} className={styles.reactBtn} title={r.label}
                    onClick={() => onReact(post.id, r.kind)}>
              <UIcon name={r.icon} size={14} />
              {post.reactions?.[r.kind] ? <span>{post.reactions[r.kind]}</span> : null}
            </button>
          ))}
          {!post.parent_post_id && (
            <button className={styles.replyBtn} onClick={() => onReply(post.id)}>Reply</button>
          )}
          {isMentor && !post.parent_post_id && (
            <button className={styles.modBtn}
                    onClick={() => onHighlight(post.id, !post.mentor_highlight)}>
              {post.mentor_highlight ? 'Unhighlight' : 'Highlight'}
            </button>
          )}
          <button className={styles.reportBtn} onClick={() => onReport({ post_id: post.id })}>Report</button>
          {(isMentor || post.author_id === meId) && (
            <button className={styles.reportBtn} onClick={() => onDelete(post.id)}>Remove</button>
          )}
        </div>
      )}
      {replies.length > 0 && (
        <div className={styles.replies}>
          {replies.map((r) => (
            <Post key={r.id} post={r} replies={[]} onReact={onReact} onReply={onReply}
                  isMentor={isMentor} onHighlight={onHighlight} onReport={onReport}
                  onDelete={onDelete} meId={meId} onOpenProfile={onOpenProfile} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ThreadView({ threadId }) {
  const { data: thread, mutate } = useThread(threadId)
  const { data: status } = useCommunityStatus()
  const isMentor = !!status?.is_mentor
  const { user } = useAuth()
  const meId = user?.id
  const [replyTo, setReplyTo] = useState(null)
  const [profile, setProfile] = useState(null)
  // Clickable $TICKER chips (sanitized static HTML → delegated handler + controlled popup)
  const [chipSym, setChipSym] = useState(null)
  const onChipClick = (e) => {
    const chip = e.target.closest?.('.community-ticker-chip')
    if (chip?.dataset?.ticker) setChipSym(chip.dataset.ticker)
  }

  // Live Boards: revalidate this thread the instant a reply/reaction/mod lands on it.
  useEffect(() => {
    const tid = Number(threadId)
    return subscribeBoardActivity((p) => {
      if (p.thread_id === tid || (thread?.space && p.space === thread.space)) mutate()
    })
  }, [threadId, thread?.space, mutate])

  // mark read once loaded
  useEffect(() => {
    if (!thread?.id) return
    const posts = thread.posts || []
    const lastId = posts.length ? posts[posts.length - 1].id : 0
    apiCall(`/api/community/threads/${thread.id}/read`, { last_seen_post_id: lastId })
      .catch(() => {})
  }, [thread?.id, thread?.posts?.length])

  const { topLevel, byParent } = useMemo(() => {
    const posts = thread?.posts || []
    const top = posts.filter((p) => !p.parent_post_id)
    // highlighted mentor take floats to the front of top-level replies
    top.sort((a, b) => (b.mentor_highlight - a.mentor_highlight) || (a.id - b.id))
    const map = {}
    posts.filter((p) => p.parent_post_id).forEach((p) => {
      ;(map[p.parent_post_id] = map[p.parent_post_id] || []).push(p)
    })
    return { topLevel: top, byParent: map }
  }, [thread?.posts])

  // Memoized {__html} object — see the note in Post above.
  const threadBodyHtml = useMemo(
    () => ({ __html: renderBodyHTML(thread?.body || '') }),
    [thread?.body],
  )

  if (!thread) return <div className={styles.empty}>Loading…</div>

  const onReact = async (postId, kind) => {
    try {
      await apiCall(`/api/community/posts/${postId}/reactions`, { kind })
      mutate()
    } catch { /* noop */ }
  }

  const onReply = (postId) => setReplyTo(postId)

  const mod = async (patch) => {
    await apiCall(`/api/community/threads/${thread.id}/mod`, patch, 'PATCH')
    mutate()
  }
  const reportItem = async (target) => {
    const reason = window.prompt('Why are you reporting this?') || ''
    if (!reason.trim()) return
    await apiCall('/api/community/reports', { ...target, reason })
    window.alert('Reported — a moderator will review it.')
  }
  const onHighlight = async (postId, value) => {
    await apiCall(`/api/community/posts/${postId}/highlight`, { value }, 'PATCH')
    mutate()
  }
  const onDelete = async (postId) => {
    if (!window.confirm('Remove this post?')) return
    await apiCall(`/api/community/posts/${postId}`, undefined, 'DELETE')
    mutate()
  }

  return (
    <div className={styles.threadView} onClick={onChipClick}>
      {chipSym && <TickerPopup sym={chipSym} open onClose={() => setChipSym(null)} />}
      {profile && <ProfileCard profile={profile} onClose={() => setProfile(null)} />}
      <Link to="/community" className={styles.backLink}>&larr; The Floor</Link>
      <div className={styles.opCard}>
        <h2 className={styles.opTitle}>
          {!!thread.pinned && <span className={styles.pinIcon}><UIcon name="pin" size={14} /></span>}
          {thread.title}
          {!!thread.answered && <span className={styles.answeredTick}>Answered</span>}
        </h2>
        <div className={styles.postHead}>
          <Author author={thread.author} authorId={thread.author_id} onOpenProfile={setProfile} />
          {(thread.ticker_tags || []).map((tk) => (
            <span key={tk} className={styles.tickerChip}>${tk}</span>
          ))}
        </div>
        <div className={styles.postBody}
             dangerouslySetInnerHTML={threadBodyHtml} />
        <div className={styles.postActions}>
          {isMentor && (
            <>
              <button className={styles.modBtn} onClick={() => mod({ pinned: !thread.pinned })}>
                {thread.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button className={styles.modBtn} onClick={() => mod({ locked: !thread.locked })}>
                {thread.locked ? 'Unlock' : 'Lock'}
              </button>
              {thread.space === 'questions' && (
                <button className={styles.modBtn} onClick={() => mod({ answered: !thread.answered })}>
                  {thread.answered ? 'Unmark Answered' : 'Mark Answered'}
                </button>
              )}
            </>
          )}
          <button className={styles.reportBtn} onClick={() => reportItem({ thread_id: thread.id })}>
            Report
          </button>
        </div>
      </div>
      <div className={styles.postsList}>
        {topLevel.map((p) => (
          <Post key={p.id} post={p} replies={byParent[p.id] || []}
                onReact={onReact} onReply={onReply}
                isMentor={isMentor} onHighlight={onHighlight}
                onReport={reportItem} onDelete={onDelete} meId={meId}
                onOpenProfile={setProfile} />
        ))}
      </div>
      {!thread.locked && (
        <div className={styles.replyComposer}>
          {replyTo && (
            <div className={styles.replyingChip}>
              Replying to a comment
              <button onClick={() => setReplyTo(null)}>×</button>
            </div>
          )}
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            onSubmit={async (body) => {
              await apiCall(`/api/community/threads/${thread.id}/posts`,
                { body, parent_post_id: replyTo })
              setReplyTo(null)
              mutate()
            }}
          />
        </div>
      )}
      {!!thread.locked && <div className={styles.lockedNote}>This thread is locked.</div>}
    </div>
  )
}

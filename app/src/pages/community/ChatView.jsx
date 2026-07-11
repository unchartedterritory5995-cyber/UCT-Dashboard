// app/src/pages/community/ChatView.jsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import UIcon from '../../components/ui/UIcon'
import { useAuth } from '../../context/AuthContext'
import { renderBodyHTML } from './lib/renderBody'
import CardRenderer from './components/CardRenderer'
import MentionInbox from './components/MentionInbox'
import Composer from './Composer'
import * as chat from '../../lib/chatStreamManager'
import styles from './Community.module.css'

const REACTIONS = [
  { kind: 'fire', icon: 'flame' },
  { kind: 'bullish', icon: 'equity' },
  { kind: 'salute', icon: 'star' },
]
const GROUP_WINDOW = 5 * 60 // seconds

function timeLabel(epoch) {
  try {
    return new Date(epoch * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch (_) { return '' }
}
function dayLabel(epoch) {
  try {
    return new Date(epoch * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  } catch (_) { return '' }
}

export default function ChatView({ channel }) {
  const { user } = useAuth()
  const meId = user?.id
  const isMentor = user?.role === 'admin'

  useEffect(() => { chat.ensureStarted([channel]) }, [channel])

  const subscribe = useCallback((cb) => chat.subscribeChannel(channel, cb), [channel])
  const snap = useSyncExternalStore(subscribe, () => chat.getChannelSnapshot(channel))
  const meta = useSyncExternalStore(chat.subscribeMeta, chat.getMetaSnapshot)

  const messages = snap.messages
  const [reply, setReply] = useState(null) // {id, name, snippet}
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const scrollRef = useRef(null)
  const lastLenRef = useRef(0)

  const maxId = useMemo(
    () => messages.reduce((mx, m) => (m.pending ? mx : Math.max(mx, m.id || 0)), 0),
    [messages],
  )

  // auto-scroll to bottom on new messages when the user is already there
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const grew = messages.length > lastLenRef.current
    lastLenRef.current = messages.length
    if (atBottom) {
      el.scrollTop = el.scrollHeight
      setNewCount(0)
    } else if (grew) {
      setNewCount((n) => n + 1)
    }
  }, [messages, atBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAtBottom(bottom)
    if (bottom) setNewCount(0)
  }
  const jumpToLatest = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setAtBottom(true); setNewCount(0)
  }

  // mark read when at bottom + tab visible
  useEffect(() => {
    if (atBottom && maxId && document.visibilityState === 'visible') {
      const t = setTimeout(() => chat.markRead(channel, maxId), 400)
      return () => clearTimeout(t)
    }
  }, [atBottom, maxId, channel])

  const grouped = useMemo(() => groupMessages(messages), [messages])

  const send = async (body, tickers) => {
    await chat.sendMessage(channel, { body, tickers, replyTo: reply?.id || null })
    setReply(null)
    setAtBottom(true)
  }

  return (
    <div className={styles.chat}>
      <div className={styles.chatHead}>
        <span className={styles.presenceDot} />
        <b>{snap.presence.count}</b>&nbsp;on the floor
        {meta.reconnecting && <span className={styles.reconnPill}>reconnecting…</span>}
        <div className={styles.chatHeadRight}>
          <MentionInbox />
        </div>
      </div>

      <div className={styles.chatScroll} ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className={styles.chatEmpty}>
            <UIcon name="community" size={28} />
            <p>The floor is quiet. Start the conversation.</p>
          </div>
        )}
        {grouped.map((item) =>
          item.type === 'day' ? (
            <div key={`d${item.key}`} className={styles.dayDivider}><span>{item.label}</span></div>
          ) : (
            <MessageRow
              key={item.msg.id}
              msg={item.msg}
              grouped={item.grouped}
              meId={meId}
              isMentor={isMentor}
              channel={channel}
              onReply={setReply}
            />
          ),
        )}
      </div>

      {!atBottom && newCount > 0 && (
        <button className={styles.jumpPill} onClick={jumpToLatest}>
          {newCount} new — jump to latest ↓
        </button>
      )}

      {reply && (
        <div className={styles.replyBar}>
          <span className={styles.replyingTo}>Replying to <b>{reply.name}</b>: {reply.snippet}</span>
          <button onClick={() => setReply(null)} aria-label="Cancel reply"><UIcon name="x" size={14} /></button>
        </div>
      )}
      <Composer
        mode="chat"
        placeholder={`Message #${channel}`}
        onSubmit={send}
        onTyping={() => chat.sendTyping(channel)}
      />
    </div>
  )
}

function MessageRow({ msg, grouped, meId, isMentor, channel, onReply }) {
  const mine = msg.author_id === meId || msg.author_id === '__me__'
  const mentor = msg.author?.is_mentor
  const html = useMemo(() => (msg.deleted ? null : renderBodyHTML(msg.body)), [msg.body, msg.deleted])

  return (
    <div className={`${styles.msg} ${grouped ? styles.msgGrouped : ''} ${mentor ? styles.msgMentor : ''} ${msg.pending ? styles.msgPending : ''}`}>
      {!grouped && (
        <div className={styles.msgHead}>
          <span className={mentor ? styles.mentorBadge : styles.msgAuthor}>{msg.author?.name || 'member'}</span>
          <span className={styles.msgTime}>{timeLabel(msg.created_at)}</span>
          {msg.failed && <span className={styles.msgFailed}>failed — tap to retry</span>}
        </div>
      )}
      {msg.reply_preview && (
        <div className={styles.quoteStub}>↳ {msg.reply_preview.snippet || 'message'}</div>
      )}
      {msg.deleted ? (
        <div className={styles.msgDeleted}>removed by moderator</div>
      ) : (
        <>
          <div className={styles.msgBody} dangerouslySetInnerHTML={{ __html: html }} />
          {msg.card && <CardRenderer card={msg.card} />}
        </>
      )}
      {!msg.deleted && !msg.pending && (
        <div className={styles.msgActions}>
          {REACTIONS.map((r) => (
            <button key={r.kind} className={styles.reactBtn}
              onClick={() => chat.toggleReaction(channel, msg.id, r.kind)}>
              <UIcon name={r.icon} size={13} />
              {msg.reactions?.[r.kind] ? <span>{msg.reactions[r.kind]}</span> : null}
            </button>
          ))}
          <button className={styles.reactBtn} title="Reply"
            onClick={() => onReply({ id: msg.id, name: msg.author?.name || 'member', snippet: previewText(msg) })}>
            <UIcon name="chat" size={13} />
          </button>
          {(mine || isMentor) && (
            <button className={styles.reactBtn} title="Delete"
              onClick={() => chat.deleteMessage(msg.id)}>
              <UIcon name="trash" size={13} />
            </button>
          )}
          {!mine && (
            <button className={styles.reactBtn} title="Report"
              onClick={() => reportMessage(msg.id)}>
              <UIcon name="flag" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function reportMessage(id) {
  const reason = window.prompt('Report this message — reason (optional):')
  if (reason === null) return
  fetch('/api/community/chat/reports', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: id, reason: reason || '' }),
  }).catch(() => {})
}

function previewText(msg) {
  const el = document.createElement('div')
  el.innerHTML = renderBodyHTML(msg.body)
  return (el.textContent || '').trim().slice(0, 60)
}

function groupMessages(messages) {
  const out = []
  let prev = null
  let prevDay = null
  for (const msg of messages) {
    const day = new Date((msg.created_at || 0) * 1000).toDateString()
    if (day !== prevDay) {
      out.push({ type: 'day', key: day, label: dayLabel(msg.created_at) })
      prevDay = day
      prev = null
    }
    const grouped =
      prev &&
      prev.author_id === msg.author_id &&
      !msg.reply_preview &&
      Math.abs((msg.created_at || 0) - (prev.created_at || 0)) < GROUP_WINDOW &&
      !msg.card
    out.push({ type: 'msg', msg, grouped: !!grouped })
    prev = msg
  }
  return out
}

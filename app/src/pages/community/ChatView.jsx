// app/src/pages/community/ChatView.jsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import TickerPopup from '../../components/TickerPopup'
import UIcon from '../../components/ui/UIcon'
import { useAuth } from '../../context/AuthContext'
import { renderBodyHTML } from './lib/renderBody'
import CardRenderer from './components/CardRenderer'
import FloorAvatar from './components/FloorAvatar'
import FloorSearch from './components/FloorSearch'
import MentionInbox from './components/MentionInbox'
import Composer from './Composer'
import * as chat from '../../lib/chatStreamManager'
import styles from './Community.module.css'

const REACTIONS = [
  { kind: 'fire', icon: 'flame', label: 'Fire' },
  { kind: 'bullish', icon: 'equity', label: 'Bullish' },
  { kind: 'salute', icon: 'star', label: 'Respect' },
]

function pinMessage(id, pinned) {
  fetch(`/api/community/chat/messages/${id}/pin`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  }).catch(() => {})
}
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

const SPACES = [
  { key: 'trade-ideas', label: 'Trade Ideas' },
  { key: 'questions', label: 'Questions & Reviews' },
  { key: 'wins-lessons', label: 'Wins & Lessons' },
  { key: 'mentor-desk', label: 'Mentor Desk', mentorOnly: true },
]

export default function ChatView({ channel, onSelectChannel }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const meId = user?.id
  const isMentor = user?.role === 'admin'
  const [graduating, setGraduating] = useState(null) // message being graduated

  useEffect(() => { chat.setSelfId(meId) }, [meId])
  useEffect(() => { chat.ensureStarted([channel]) }, [channel])

  const subscribe = useCallback((cb) => chat.subscribeChannel(channel, cb), [channel])
  const snap = useSyncExternalStore(subscribe, () => chat.getChannelSnapshot(channel))
  const meta = useSyncExternalStore(chat.subscribeMeta, chat.getMetaSnapshot)

  const messages = snap.messages
  const [reply, setReply] = useState(null) // {id, name, snippet}
  const [atBottom, setAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const scrollRef = useRef(null)
  const lastMaxRef = useRef(0)

  const maxId = useMemo(
    () => messages.reduce((mx, m) => (m.pending ? mx : Math.max(mx, m.id || 0)), 0),
    [messages],
  )

  // auto-scroll to bottom when a NEWER message arrives and the user is already there.
  // Keys on the newest id (not length) so loading earlier history never yanks the view
  // or bumps the "N new" pill.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const newer = maxId > lastMaxRef.current
    lastMaxRef.current = maxId
    if (atBottom) {
      el.scrollTop = el.scrollHeight
      setNewCount(0)
    } else if (newer) {
      setNewCount((n) => n + 1)
    }
  }, [maxId, atBottom])

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

  // re-mark-read when the tab regains focus (otherwise unread lingers until next msg)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && atBottom && maxId) chat.markRead(channel, maxId)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [atBottom, maxId, channel])

  // Clickable $TICKER chips: chips are sanitized static HTML, so one delegated
  // handler on the scroll container opens a controlled TickerPopup (live chart).
  const [chipSym, setChipSym] = useState(null)
  const onChipClick = (e) => {
    const chip = e.target.closest?.('.community-ticker-chip')
    if (chip?.dataset?.ticker) setChipSym(chip.dataset.ticker)
  }

  // Live prices for every marked ticker in view — powers "@price → +X% since".
  const markedTickers = useMemo(() => {
    const s = new Set()
    for (const m of messages) for (const t of Object.keys(m.ticker_marks || {})) s.add(t)
    return [...s].slice(0, 25).sort()
  }, [messages])
  const { data: livePrices } = useSWR(
    markedTickers.length ? `/api/live-prices?tickers=${markedTickers.join(',')}` : null,
    (u) => fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
    { refreshInterval: 30_000 },
  )

  const grouped = useMemo(() => groupMessages(messages), [messages])
  const pinned = useMemo(() => messages.filter((m) => m.pinned && !m.deleted), [messages])
  const newestPin = pinned.length ? pinned[pinned.length - 1] : null
  const typingNames = (snap.typing || []).filter((t) => t.user_id !== meId).map((t) => t.name)

  // clear stale typing labels in a quiet room (bump is event-driven only)
  useEffect(() => {
    if (!typingNames.length) return
    const t = setTimeout(() => chat.pokeTyping(channel), 4600)
    return () => clearTimeout(t)
  }, [snap.typing, channel]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadEarlier = async () => {
    const el = scrollRef.current
    const prevH = el ? el.scrollHeight : 0
    const n = await chat.loadEarlier(channel)
    // preserve the reading position: keep the same content under the viewport.
    if (el && n) requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - prevH })
  }

  const scrollToMessage = (id) => {
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add(styles.flash) ; setTimeout(() => el.classList.remove(styles.flash), 1600) }
  }

  const send = async (body, tickers) => {
    await chat.sendMessage(channel, { body, tickers, replyTo: reply?.id || null })
    setReply(null)
    setAtBottom(true)
  }
  const runCommand = async (cmd) => {
    if (cmd.type === 'chart') {
      await chat.sendMessage(channel, { card: { kind: 'chart', ticker: cmd.ticker, tf: 'D' } })
    } else if (cmd.type === 'poll') {
      await chat.sendMessage(channel, { card: { kind: 'poll', question: cmd.question, options: cmd.options } })
    } else if (cmd.type === 'idea') {
      await chat.sendMessage(channel, { card: { kind: 'idea', ...cmd } })
    } else if (cmd.type === 'ask') {
      await chat.askCompass(channel, cmd.question)
    }
    setAtBottom(true)
  }

  return (
    <div className={styles.chat}>
      <div className={styles.chatHead}>
        <span className={styles.presenceDot} />
        <b>{snap.presence.count}</b>&nbsp;on the floor
        {meta.reconnecting && <span className={styles.reconnPill}>reconnecting…</span>}
        <div className={styles.chatHeadRight}>
          <FloorSearch onOpenChannel={onSelectChannel} onOpenThread={(tid) => navigate(`/community/${tid}`)} />
          <MentionInbox onOpenChannel={onSelectChannel} onOpenMessage={scrollToMessage} />
        </div>
      </div>

      {newestPin && (
        <button className={styles.pinnedBanner} onClick={() => scrollToMessage(newestPin.id)}>
          <UIcon name="pin" size={12} />
          <span className={styles.pinnedAuthor}>{newestPin.author?.name || 'member'}:</span>
          <span className={styles.pinnedSnippet}>{previewText(newestPin)}</span>
          {pinned.length > 1 && <span className={styles.pinnedCount}>+{pinned.length - 1}</span>}
        </button>
      )}

      <div className={styles.chatScroll} ref={scrollRef} onScroll={onScroll} onClick={onChipClick}>
        {messages.length === 0 && (
          <div className={styles.chatEmpty}>
            <UIcon name="community" size={28} />
            <p>The floor is quiet. Start the conversation.</p>
          </div>
        )}
        {messages.filter((m) => !m.pending).length >= 50 && (
          <button className={styles.loadEarlier} onClick={loadEarlier}>Load earlier</button>
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
              livePrices={livePrices}
              onReply={setReply}
              onGraduate={setGraduating}
              onOpenThread={(tid) => navigate(`/community/${tid}`)}
            />
          ),
        )}
      </div>

      {chipSym && (
        <TickerPopup sym={chipSym} open onClose={() => setChipSym(null)} />
      )}

      {graduating && (
        <GraduateDialog
          msg={graduating}
          isMentor={isMentor}
          onClose={() => setGraduating(null)}
          onDone={(tid) => { setGraduating(null); navigate(`/community/${tid}`) }}
        />
      )}

      {!atBottom && newCount > 0 && (
        <button className={styles.jumpPill} onClick={jumpToLatest}>
          {newCount} new — jump to latest ↓
        </button>
      )}

      <div className={styles.typingRow}>
        {typingNames.length === 1 && `${typingNames[0]} is typing…`}
        {typingNames.length === 2 && `${typingNames[0]} and ${typingNames[1]} are typing…`}
        {typingNames.length > 2 && `${typingNames.length} people are typing…`}
      </div>

      {reply && (
        <div className={styles.replyBar}>
          <span className={styles.replyingTo}>Replying to <b>{reply.name}</b>: {reply.snippet}</span>
          <button onClick={() => setReply(null)} aria-label="Cancel reply"><UIcon name="x" size={14} /></button>
        </div>
      )}
      <Composer
        mode="chat"
        placeholder={`Message #${channel}   ·   /chart · /bull · /idea · /poll · /ask`}
        onSubmit={send}
        onCommand={runCommand}
        onTyping={() => chat.sendTyping(channel)}
      />
    </div>
  )
}

function TickerMarks({ marks, livePrices }) {
  const entries = Object.entries(marks || {})
  if (!entries.length) return null
  return (
    <div className={styles.marksRow}>
      {entries.map(([tk, at]) => {
        const now = livePrices?.[tk]?.price
        const pct = now && at ? ((now - at) / at) * 100 : null
        return (
          <span key={tk} className={`${styles.markChip} community-ticker-chip`} data-ticker={tk}>
            ${tk} @ {Number(at).toFixed(2)}
            {pct != null && (
              <b className={pct >= 0 ? styles.cardWin : styles.cardLoss}>
                {' '}→ {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </b>
            )}
          </span>
        )
      })}
    </div>
  )
}

function MessageRow({ msg, grouped, meId, isMentor, channel, livePrices, onReply, onGraduate, onOpenThread }) {
  const mine = msg.author_id === meId || msg.author_id === '__me__'
  const mentor = msg.author?.is_mentor
  const html = useMemo(() => (msg.deleted || !msg.body ? null : renderBodyHTML(msg.body)), [msg.body, msg.deleted])
  const canGraduate = (mine || isMentor) && !msg.pending && !msg.deleted
  // pending optimistic messages carry the '__me__' placeholder — resolve to the real id
  const avatarId = msg.author_id === '__me__' ? meId : msg.author_id

  return (
    <div data-mid={msg.id}
      className={`${styles.msg} ${grouped ? styles.msgGrouped : ''} ${mentor ? styles.msgMentor : ''} ${msg.pending ? styles.msgPending : ''} ${msg.pinned ? styles.msgPinned : ''}`}>
      <div className={styles.msgGutter}>
        {!grouped ? (
          <FloorAvatar authorId={avatarId} name={msg.author?.name} isMentor={mentor} />
        ) : (
          <span className={styles.gutterTime}>{timeLabel(msg.created_at)}</span>
        )}
      </div>
      <div className={styles.msgContent}>
      {!grouped && (
        <div className={styles.msgHead}>
          {!!msg.pinned && <UIcon name="pin" size={11} />}
          <span className={mentor ? styles.mentorBadge : styles.msgAuthor}>{msg.author?.name || 'member'}</span>
          {mentor && <span className={styles.mentorTag}>MENTOR</span>}
          {(msg.author?.badges || []).includes('green_week') && (
            <span className={styles.badgeGreen} title="Net positive R this week (verified from journal)">green wk</span>
          )}
          {(msg.author?.badges || []).includes('hot_hand') && (
            <span className={styles.badgeHot} title="Last 3 closed trades were wins (verified from journal)">
              <UIcon name="flame" size={10} /> hot hand
            </span>
          )}
          <span className={styles.msgTime}>{timeLabel(msg.created_at)}</span>
        </div>
      )}
      {msg.failed && (
        <div className={styles.msgFailedRow}>
          <button className={styles.retryBtn} onClick={() => chat.retryMessage(channel, msg.client_msg_id)}>
            failed — tap to retry
          </button>
          <button className={styles.discardBtn} title="Discard"
            onClick={() => chat.discardPending(channel, msg.client_msg_id)}><UIcon name="x" size={12} /></button>
        </div>
      )}
      {msg.reply_preview && (
        <div className={styles.quoteStub}>↳ {msg.reply_preview.snippet || 'message'}</div>
      )}
      {msg.deleted ? (
        <div className={styles.msgDeleted}>removed by moderator</div>
      ) : (
        <>
          {html && <div className={styles.msgBody} dangerouslySetInnerHTML={{ __html: html }} />}
          <TickerMarks marks={msg.ticker_marks} livePrices={livePrices} />
          {msg.card && (
            <CardRenderer card={msg.card}
              onVote={(key) => chat.votePoll(channel, msg.id, key)}
              onImIn={() => chat.imIn(channel, msg.id)}
              onOutcome={(o) => chat.setIdeaOutcome(channel, msg.id, o)}
              canMark={mine || isMentor} />
          )}
          {msg.graduated_thread_id > 0 && (
            <button className={styles.gradLink} onClick={() => onOpenThread(msg.graduated_thread_id)}>
              <UIcon name="library" size={12} /> Saved to the Boards →
            </button>
          )}
        </>
      )}
      {!msg.deleted && !msg.pending && (
        <div className={styles.msgActions}>
          {REACTIONS.map((r) => {
            const active = (msg.my_reactions || []).includes(r.kind)
            return (
              <button key={r.kind} title={r.label}
                className={`${styles.reactBtn} ${active ? styles.reactActive : ''}`}
                onClick={() => chat.toggleReaction(channel, msg.id, r.kind)}>
                <UIcon name={r.icon} size={13} />
                {msg.reactions?.[r.kind] ? <span>{msg.reactions[r.kind]}</span> : null}
              </button>
            )
          })}
          <button className={styles.reactBtn} title="Reply"
            onClick={() => onReply({ id: msg.id, name: msg.author?.name || 'member', snippet: previewText(msg) })}>
            <UIcon name="chat" size={13} />
          </button>
          {isMentor && (
            <button className={styles.reactBtn} title={msg.pinned ? 'Unpin' : 'Pin'}
              onClick={() => pinMessage(msg.id, !msg.pinned)}>
              <UIcon name="pin" size={13} />
            </button>
          )}
          {canGraduate && !(msg.graduated_thread_id > 0) && (
            <button className={styles.reactBtn} title="Graduate to the Boards"
              onClick={() => onGraduate(msg)}>
              <UIcon name="library" size={13} />
            </button>
          )}
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
    </div>
  )
}

function GraduateDialog({ msg, isMentor, onClose, onDone }) {
  const spaces = SPACES.filter((s) => !s.mentorOnly || isMentor)
  const [space, setSpace] = useState(spaces[0].key)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async () => {
    if (!title.trim()) { setErr('Give it a title'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/community/chat/messages/${msg.id}/graduate`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space, title: title.trim() }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || `Error ${r.status}`)
      onDone(data.thread_id)
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <div className={styles.gradBackdrop} onClick={onClose}>
      <div className={styles.gradCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.gradTitle}><UIcon name="library" size={15} /> Save to the Boards</div>
        <p className={styles.gradHint}>Turn this moment into a permanent thread the room can find later.</p>
        <label className={styles.gradLabel}>Board</label>
        <select className={styles.gradSelect} value={space} onChange={(e) => setSpace(e.target.value)}>
          {spaces.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className={styles.gradLabel}>Thread title</label>
        <input className={styles.gradInput} placeholder="e.g. NVDA breakout — why it worked"
          maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        {err && <div className={styles.composerError}>{err}</div>}
        <div className={styles.gradFoot}>
          <button className={styles.cancel} onClick={onClose}>Cancel</button>
          <button className={styles.composerSubmit} onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Graduate'}
          </button>
        </div>
      </div>
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

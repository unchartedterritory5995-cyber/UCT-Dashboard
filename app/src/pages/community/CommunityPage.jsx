import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import PageHeader from '../../components/PageHeader'
import TickerPopup from '../../components/TickerPopup'
import ThreadView from './ThreadView'
import ChatView from './ChatView'
import Composer from './Composer'
import AckGate from './AckGate'
import * as chat from '../../lib/chatStreamManager'
import {
  useCommunityStatus, useSpaces, useThreads, useChatChannels, useTape, apiCall,
} from './hooks/useCommunity'
import styles from './Community.module.css'

const LAST_CH_KEY = 'uct.floor.lastChannel'

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
  const { data: status, mutate: refreshStatus } = useCommunityStatus()
  const enabled = !!status?.enabled
  const chatOn = !!status?.chat_enabled

  // Selection: a live pulse channel OR a forum board space. Pulse leads when live.
  const [sel, setSel] = useState(null) // { type:'pulse'|'board', key }
  const { data: chan } = useChatChannels(chatOn && !threadId)
  const { data: tape } = useTape(chatOn)
  const { data: spaces } = useSpaces(enabled)
  const boardSpace = sel?.type === 'board' ? sel.key : null
  const { data: threadsData, mutate: refreshThreads } =
    useThreads(boardSpace, enabled && !threadId && !!boardSpace)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [posting, setPosting] = useState(false)

  // Live Boards: subscribe the pooled connection to every board room + pulse channel,
  // and revalidate the visible thread list the instant a board event lands.
  const liveRooms = useMemo(() => {
    const pulse = (chan?.channels || []).map((c) => c.slug)
    const boards = (spaces || []).map((s) => `board:${s.key}`)
    return [...pulse, ...boards]
  }, [chan, spaces])
  useEffect(() => {
    if (!chatOn || !liveRooms.length) return
    chat.ensureStarted(liveRooms)
    return chat.subscribeBoardActivity((p) => {
      if (sel?.type === 'board' && sel.key === p.space) refreshThreads()
    })
  }, [chatOn, liveRooms, sel, refreshThreads])

  // Default selection: last channel (persisted) → first pulse channel → mentor-desk.
  // When chat is on, WAIT for the channel list before choosing so we land on the
  // live Pulse (not prematurely on a Board while chan is still loading).
  useEffect(() => {
    if (sel || threadId) return
    if (chatOn && !chan) return
    if (chatOn && chan?.channels?.length) {
      const saved = localStorage.getItem(LAST_CH_KEY)
      const pick = chan.channels.find((c) => c.slug === saved) || chan.channels[0]
      setSel({ type: 'pulse', key: pick.slug })
    } else if (spaces?.length) {
      setSel({ type: 'board', key: 'mentor-desk' })
    }
  }, [chatOn, chan, spaces, sel, threadId])

  if (status && !enabled) {
    return (
      <div className={styles.comingSoon}>
        <UIcon name="community" size={40} />
        <h2 className="t-page-title">The Floor</h2>
        <p className="t-body">The UCT community space is opening soon.</p>
      </div>
    )
  }

  const chooseBoard = (key) => { setSel({ type: 'board', key }); navigate('/community') }
  const choosePulse = (key) => {
    setSel({ type: 'pulse', key }); localStorage.setItem(LAST_CH_KEY, key); navigate('/community')
  }
  const space = boardSpace
  const canPost = space && (!(spaces?.find((s) => s.key === space)?.mentor_only) || status?.is_mentor)

  return (
    <div className={styles.floorRoot}>
      <PageHeader icon="community" title="Community" />
      {chatOn && tape && (tape.online > 0 || (tape.hot_tickers || []).length > 0) && (
        <div className={styles.tape}>
          <span className={styles.tapePresence}><span className={styles.presenceDot} /> {tape.online} on the floor</span>
          {(tape.hot_tickers || []).length > 0 && (
            <span className={styles.tapeHot}>
              <UIcon name="bolt" size={12} /> Hot now:
              {tape.hot_tickers.map((h) => (
                <TickerPopup key={h.ticker} sym={h.ticker} as="button" className={styles.tapeChip}>
                  ${h.ticker}
                </TickerPopup>
              ))}
            </span>
          )}
        </div>
      )}
      <div className={styles.page}>
        <AckGate status={status} onAcked={() => refreshStatus()} />
      <aside className={styles.rail}>
        <div className={styles.railTitle}>
          <UIcon name="community" size={16} /> The Floor
          {status && status.public === false && (
            <span className={styles.previewPill} title="Visible to admins only — not yet launched to members">
              Preview
            </span>
          )}
        </div>

        {chatOn && (chan?.channels?.length > 0) && (
          <>
            <div className={styles.railSection}><UIcon name="bolt" size={13} /> Live Pulse</div>
            {chan.channels.map((c) => {
              const active = sel?.type === 'pulse' && sel.key === c.slug && !threadId
              return (
                <button key={c.slug}
                  className={`${styles.railItem} ${active ? styles.railItemActive : ''}`}
                  onClick={() => choosePulse(c.slug)}>
                  <span className={styles.railPresence}>
                    <span className={styles.presenceDot} />#{c.slug}
                  </span>
                  {c.unread > 0 && <span className={styles.activityDot} title="new messages" />}
                </button>
              )
            })}
          </>
        )}

        <div className={styles.railSection}><UIcon name="document" size={13} /> The Boards</div>
        {(spaces || []).map((s) => {
          const active = sel?.type === 'board' && sel.key === s.key && !threadId
          return (
            <button key={s.key}
              className={`${styles.railItem} ${active ? styles.railItemActive : ''}`}
              onClick={() => chooseBoard(s.key)}>
              <span>{s.label}</span>
              {s.unread > 0 && <span className={styles.railBadge}>{s.unread > 9 ? '9+' : s.unread}</span>}
            </button>
          )
        })}
      </aside>

      <main className={styles.main}>
        {threadId ? (
          <ThreadView threadId={threadId} />
        ) : sel?.type === 'pulse' ? (
          <ChatView channel={sel.key}
            onSelectChannel={(slug) => {
              if (String(slug).startsWith('board:')) chooseBoard(slug.slice(6))
              else choosePulse(slug)
            }} />
        ) : (
          <>
            {canPost && (
              <button className={styles.newThreadBtn} onClick={() => setComposing(true)}>
                New Thread
              </button>
            )}
            {composing && (
              <div className={styles.newThreadCard}>
                <input
                  className={styles.titleInput}
                  placeholder="Title"
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Composer
                  submitLabel="Post Thread"
                  busy={posting}
                  onSubmit={async (body, tickers) => {
                    setPosting(true)
                    try {
                      const { id } = await apiCall('/api/community/threads',
                        { space, title, body, ticker_tags: tickers })
                      setComposing(false); setTitle('')
                      refreshThreads()
                      navigate(`/community/${id}`)
                    } finally {
                      setPosting(false)
                    }
                  }}
                />
              </div>
            )}
            <ThreadList
              threads={threadsData?.threads || []}
              onOpen={(id) => navigate(`/community/${id}`)}
            />
          </>
        )}
        </main>
      </div>
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

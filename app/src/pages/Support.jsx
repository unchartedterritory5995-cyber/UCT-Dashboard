import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import UIcon from '../components/ui/UIcon'
import styles from './Support.module.css'

const CATEGORIES = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'account', label: 'Account Issue' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
]

const CAT_CLASS = {
  bug: 'catBug',
  feature: 'catFeature',
  account: 'catAccount',
  question: 'catQuestion',
  other: 'catOther',
  general: 'catOther',
}

function timeAgo(dateString) {
  if (!dateString) return '\u2014'
  const now = Date.now()
  const then = new Date(dateString).getTime()
  if (isNaN(then)) return '\u2014'
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function categoryLabel(cat) {
  const found = CATEGORIES.find(c => c.value === cat)
  return found ? found.label : cat
}

function StatusBadge({ status }) {
  const cls = status === 'open' ? styles.statusOpen
    : status === 'in_progress' ? styles.statusInProgress
    : styles.statusResolved
  const label = status === 'in_progress' ? 'In Progress' : status
  return <span className={`${styles.statusBadge} ${cls}`}>{label}</span>
}

function CategoryBadge({ category }) {
  const cls = CAT_CLASS[category] || 'catOther'
  return <span className={`${styles.categoryBadge} ${styles[cls]}`}>{categoryLabel(category)}</span>
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
]

// Self-serve answers for the questions that would otherwise become tickets.
// Each links straight into the matching Settings section.
const FAQS = [
  {
    q: 'How do I connect my brokerage to the Journal?',
    a: <>Go to <Link to="/settings?section=connections">Settings → Connections</Link> and
      click Connect. Your trades, open positions, and balances auto-import
      (read-only) — 30+ US brokers supported.</>,
  },
  {
    q: 'How do I upgrade, manage billing, or cancel?',
    a: <>Everything lives in <Link to="/settings?section=billing">Settings → Plan &amp; Billing</Link>.
      "Manage Billing" opens the secure billing portal to update your card, view
      invoices, or cancel anytime.</>,
  },
  {
    q: 'How do I change my password or profile details?',
    a: <>Head to <Link to="/settings?section=account">Settings → Account</Link> to edit
      your name, upload an avatar, or change your password.</>,
  },
  {
    q: 'How do I customize how charts look?',
    a: <>Use <Link to="/settings?section=charts">Settings → Charts</Link> for presets,
      candle colors, indicators, and volume — or click the gear icon on any
      chart's toolbar for the same controls in place.</>,
  },
  {
    q: 'How do price alerts and notification sounds work?',
    a: <>Right-click any ticker anywhere in the app to set a price alert. Delivery
      and alert tones are in <Link to="/settings?section=preferences">Settings → Preferences</Link>.</>,
  },
  {
    q: 'Can I export my data?',
    a: <>Yes — <Link to="/settings?section=legal">Settings → Data &amp; Legal</Link> lets
      you download your watchlists, journal, trades, and settings as JSON anytime.</>,
  },
]

function QuickAnswers() {
  const [open, setOpen] = useState(null)
  return (
    <div className={styles.faqWrap}>
      <div className={styles.faqTitle}>
        <UIcon name="sparkle" size={13} />
        Quick answers
      </div>
      {FAQS.map((f, i) => (
        <div key={i} className={styles.faqItem}>
          <button
            className={styles.faqQ}
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <UIcon name={open === i ? 'chevronDown' : 'chevronRight'} size={11} />
            {f.q}
          </button>
          {open === i && <div className={styles.faqA}>{f.a}</div>}
        </div>
      ))}
    </div>
  )
}

export default function Support() {
  // View + open ticket live in the URL (?view=new, ?t=<id>) so browser
  // back/forward and refresh keep your place.
  const [searchParams, setSearchParams] = useSearchParams()
  const tParam = searchParams.get('t')
  const activeTicketId = tParam && /^\d+$/.test(tParam) ? Number(tParam) : null
  const view = activeTicketId ? 'thread' : searchParams.get('view') === 'new' ? 'new' : 'list'

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [thread, setThread] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  // New ticket form
  const [category, setCategory] = useState('bug')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reply
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const messagesEndRef = useRef(null)

  // ── Fetch tickets ──
  const fetchTickets = useCallback(() => {
    setLoading(true)
    fetch('/api/auth/tickets')
      .then(r => r.ok ? r.json() : [])
      .then(d => setTickets(Array.isArray(d) ? d : []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // ── Fetch thread ──
  const fetchThread = useCallback((ticketId) => {
    setThreadLoading(true)
    fetch(`/api/auth/tickets/${ticketId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setThread(d))
      .catch(() => setThread(null))
      .finally(() => setThreadLoading(false))
  }, [])

  // Load (or clear) the thread whenever the ?t= param changes — covers clicks,
  // browser back/forward, and opening a ticket link directly.
  useEffect(() => {
    if (activeTicketId) {
      fetchThread(activeTicketId)
    } else {
      setThread(null)
      setReply('')
    }
  }, [activeTicketId, fetchThread])

  // Auto-scroll messages
  useEffect(() => {
    if (thread && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread?.messages?.length])

  // Live polling: refresh thread every 3s when viewing a conversation
  useEffect(() => {
    if (view !== 'thread' || !activeTicketId) return
    const interval = setInterval(() => {
      fetch(`/api/auth/tickets/${activeTicketId}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setThread(prev => {
          // Only update if message count changed (avoids unnecessary re-renders)
          if (!prev || d.messages?.length !== prev.messages?.length) return d
          return prev
        })})
        .catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [view, activeTicketId])

  function openThread(ticketId) {
    setSearchParams({ t: String(ticketId) })
  }

  function goBack() {
    setSearchParams({})
    fetchTickets()
  }

  // ── Submit new ticket ──
  async function handleSubmit(e) {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim(), category }),
      })
      if (res.ok) {
        setSubject('')
        setMessage('')
        setCategory('bug')
        setSearchParams({})
        fetchTickets()
      }
    } catch { /* silent */ }
    finally { setSubmitting(false) }
  }

  // ── Send reply ──
  async function handleReply() {
    if (!reply.trim() || !activeTicketId) return
    setReplying(true)
    try {
      const res = await fetch(`/api/auth/tickets/${activeTicketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply.trim() }),
      })
      if (res.ok) {
        setReply('')
        fetchThread(activeTicketId)
      }
    } catch { /* silent */ }
    finally { setReplying(false) }
  }

  // ── Reopen ticket ──
  // Posting any user message to a resolved ticket reopens it server-side, so
  // we just send one immediately (using whatever's typed, or a default line).
  async function handleReopen() {
    if (!activeTicketId || replying) return
    const msg = reply.trim() || 'I would like to reopen this ticket.'
    setReplying(true)
    try {
      const res = await fetch(`/api/auth/tickets/${activeTicketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      if (res.ok) {
        setReply('')
        fetchThread(activeTicketId)
      }
    } catch { /* silent */ }
    finally { setReplying(false) }
  }

  // ── Ticket List View ──
  if (view === 'list') {
    const visibleTickets = statusFilter === 'all'
      ? tickets
      : tickets.filter(t => t.status === statusFilter)

    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Support</h1>
          <button className={styles.newBtn} onClick={() => setSearchParams({ view: 'new' })}>New Ticket</button>
        </div>

        <div className={styles.metaStrip}>
          <span className={styles.metaItem}>
            <UIcon name="clock" size={11} />
            Typical response: within 1 business day
          </span>
          <span className={styles.metaDivider}>·</span>
          <a className={styles.metaMail} href="mailto:contact@uctintelligence.com">
            contact@uctintelligence.com
          </a>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><UIcon name="chat" size={30} /></div>
            <div>No support tickets yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "New Ticket" to get help — or check the quick answers below</div>
          </div>
        ) : (
          <>
            <div className={styles.filterChips}>
              {STATUS_FILTERS.map(f => {
                const count = f.key === 'all'
                  ? tickets.length
                  : tickets.filter(t => t.status === f.key).length
                if (f.key !== 'all' && count === 0) return null
                return (
                  <button
                    key={f.key}
                    className={`${styles.chip} ${statusFilter === f.key ? styles.chipActive : ''}`}
                    onClick={() => setStatusFilter(f.key)}
                  >
                    {f.label}
                    <span className={styles.chipCount}>{count}</span>
                  </button>
                )
              })}
            </div>
            <div className={styles.ticketList}>
              {visibleTickets.length === 0 ? (
                <div className={styles.loading}>No {statusFilter.replace('_', ' ')} tickets</div>
              ) : visibleTickets.map(t => (
                <div key={t.id} className={styles.ticketCard} onClick={() => openThread(t.id)}>
                  <div className={styles.ticketCardTop}>
                    <span className={styles.ticketSubject}>{t.subject}</span>
                    <CategoryBadge category={t.category} />
                    <StatusBadge status={t.status} />
                  </div>
                  <div className={styles.ticketPreview}>
                    {t.last_message ? t.last_message.slice(0, 100) : ''}
                  </div>
                  <div className={styles.ticketMeta}>
                    {t.last_sender === 'admin' && (
                      <span><span className={styles.adminDot} /> Admin replied</span>
                    )}
                    <span>{t.message_count} message{t.message_count !== 1 ? 's' : ''}</span>
                    <span>{timeAgo(t.updated_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && <QuickAnswers />}
      </div>
    )
  }

  // ── New Ticket Form ──
  if (view === 'new') {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Support</h1>
        </div>
        <div className={styles.formWrap}>
          <button className={styles.backLink} onClick={goBack}>
            &#8592; Back to tickets
          </button>
          <div className={styles.formTitle}>New Support Ticket</div>
          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Category</label>
              <select
                className={styles.formSelect}
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Subject</label>
              <input
                className={styles.formInput}
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Brief description of your issue"
                maxLength={200}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Message</label>
              <textarea
                className={styles.formTextarea}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Describe your issue in detail..."
              />
            </div>
            <button
              className={styles.submitBtn}
              type="submit"
              disabled={submitting || !subject.trim() || !message.trim()}
            >
              {submitting ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Thread View ──
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Support</h1>
      </div>
      <button className={styles.backLink} onClick={goBack}>
        &#8592; Back to tickets
      </button>

      {threadLoading ? (
        <div className={styles.loading}>Loading conversation...</div>
      ) : !thread ? (
        <div className={styles.loading}>Ticket not found</div>
      ) : (
        <>
          <div className={styles.threadHeader}>
            <span className={styles.threadSubject}>{thread.ticket.subject}</span>
            <CategoryBadge category={thread.ticket.category} />
            <StatusBadge status={thread.ticket.status} />
          </div>

          {thread.ticket.status === 'resolved' && (
            <div className={styles.resolvedBanner}>
              <span>This ticket has been resolved</span>
              <button className={styles.reopenBtn} onClick={handleReopen}>Reopen</button>
            </div>
          )}

          <div className={styles.messageList}>
            {thread.messages.map(m => (
              <div
                key={m.id}
                className={`${styles.msgBubble} ${m.sender_role === 'admin' ? styles.msgAdmin : styles.msgUser}`}
              >
                <div className={styles.msgMeta}>
                  <span className={styles.msgSender}>
                    {m.sender_role === 'admin' ? (m.display_name || 'Support') : (m.display_name || 'You')}
                  </span>
                  <span className={styles.msgTime}>{timeAgo(m.created_at)}</span>
                </div>
                <div className={styles.msgText}>{m.message}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.replyWrap}>
            <textarea
              className={styles.replyInput}
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Type your reply..."
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleReply()
                }
              }}
            />
            <button
              className={styles.replyBtn}
              onClick={handleReply}
              disabled={replying || !reply.trim()}
            >
              {replying ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

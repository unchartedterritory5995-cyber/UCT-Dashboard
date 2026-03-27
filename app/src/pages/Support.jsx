import { useState, useEffect, useCallback, useRef } from 'react'
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


export default function Support() {
  const [view, setView] = useState('list') // list | new | thread
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTicketId, setActiveTicketId] = useState(null)
  const [thread, setThread] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)

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

  // Auto-scroll messages
  useEffect(() => {
    if (thread && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread])

  function openThread(ticketId) {
    setActiveTicketId(ticketId)
    setView('thread')
    fetchThread(ticketId)
  }

  function goBack() {
    setView('list')
    setThread(null)
    setActiveTicketId(null)
    setReply('')
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
        setView('list')
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
  async function handleReopen() {
    if (!activeTicketId) return
    // User sends a message to reopen
    if (!reply.trim()) {
      setReply('I would like to reopen this ticket.')
    }
  }

  // ── Ticket List View ──
  if (view === 'list') {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Support</h1>
          <button className={styles.newBtn} onClick={() => setView('new')}>New Ticket</button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className={styles.emptyState}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>&#x1F3AB;</div>
            <div>No support tickets yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "New Ticket" to get help</div>
          </div>
        ) : (
          <div className={styles.ticketList}>
            {tickets.map(t => (
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
        )}
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
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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

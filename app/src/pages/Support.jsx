import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import UIcon from '../components/ui/UIcon'
import { useAuth } from '../context/AuthContext'
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

// Split a message into its human body and any trailing ```diagnostics``` fence
// captured on ticket creation. Users read the words; the diagnostic block is
// tucked into a collapsed "Diagnostic info" details block so it doesn't
// clutter the conversation.
function extractDiagnostics(text) {
  if (!text) return { body: '', diag: null }
  const m = text.match(/^([\s\S]*?)\n*```diagnostics\n([\s\S]*?)\n```\s*$/)
  if (!m) return { body: text, diag: null }
  return { body: m[1].trim(), diag: m[2].trim() }
}

// Picker + preview strip for images attached to a NEW-ticket form or a REPLY
// that hasn't been submitted yet. Files live in local state until the parent
// message is created, then get uploaded and removed from state.
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif'
const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

function AttachmentPicker({ files, setFiles, id }) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')

  const addFiles = (list) => {
    setError('')
    const additions = []
    for (const file of list) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files can be attached')
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name}" is over 5 MB`)
        continue
      }
      additions.push({
        id: Math.random().toString(36).slice(2),
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }
    setFiles(prev => {
      const remaining = Math.max(0, MAX_ATTACHMENTS - prev.length)
      if (remaining < additions.length) setError(`Maximum ${MAX_ATTACHMENTS} attachments`)
      return [...prev, ...additions.slice(0, remaining)]
    })
  }

  const onPick = (e) => addFiles(Array.from(e.target.files || []))
  const onDrop = (e) => {
    e.preventDefault(); setDragActive(false)
    if (files.length >= MAX_ATTACHMENTS) return
    const items = Array.from(e.dataTransfer?.files || [])
    if (items.length) addFiles(items)
  }
  const onPaste = (e) => {
    // Ctrl+V of a screenshot straight into the picker area lands here.
    const items = Array.from(e.clipboardData?.items || [])
      .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
      .map(i => i.getAsFile())
      .filter(Boolean)
    if (items.length) { e.preventDefault(); addFiles(items) }
  }

  const remove = (id) => {
    setFiles(prev => {
      const removed = prev.find(p => p.id === id)
      if (removed) { try { URL.revokeObjectURL(removed.previewUrl) } catch {} }
      return prev.filter(p => p.id !== id)
    })
  }

  return (
    <div className={styles.attachWrap}>
      <div
        className={`${styles.attachDrop} ${dragActive ? styles.attachDropActive : ''}`}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        tabIndex={0}
        role="button"
        aria-label="Add screenshots or drop image files here"
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
      >
        <UIcon name="paperclip" size={13} />
        <span>
          <strong>Add screenshots</strong>
          <span className={styles.attachHint}>
            Drop images, paste from clipboard, or click. Up to {MAX_ATTACHMENTS} · 5 MB each
          </span>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES}
          style={{ display: 'none' }}
          onChange={onPick}
          aria-label={`Add attachments to ${id}`}
        />
      </div>
      {error && <div className={styles.attachErr}>{error}</div>}
      {files.length > 0 && (
        <div className={styles.attachThumbs}>
          {files.map(p => (
            <div key={p.id} className={styles.attachThumb}>
              <img src={p.previewUrl} alt={p.file.name} />
              <button
                type="button"
                className={styles.attachRemove}
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.file.name}`}
              >
                <UIcon name="x" size={10} />
              </button>
              <span className={styles.attachName}>{p.file.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ m, attachments }) {
  const [showDiag, setShowDiag] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const { body, diag } = extractDiagnostics(m.message)
  const copyDiag = () => {
    if (!diag) return
    try {
      navigator.clipboard.writeText(diag)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }
  return (
    <div className={`${styles.msgBubble} ${m.sender_role === 'admin' ? styles.msgAdmin : styles.msgUser}`}>
      <div className={styles.msgMeta}>
        <span className={styles.msgSender}>
          {m.sender_role === 'admin' ? (m.display_name || 'Support') : (m.display_name || 'You')}
        </span>
        <span className={styles.msgTime}>{timeAgo(m.created_at)}</span>
      </div>
      <div className={styles.msgText}>{body}</div>
      {diag && (
        <div className={styles.diagBlock}>
          <button
            className={styles.diagToggle}
            onClick={() => setShowDiag(s => !s)}
            aria-expanded={showDiag}
          >
            <UIcon name={showDiag ? 'chevronDown' : 'chevronRight'} size={11} />
            Diagnostic info
          </button>
          {showDiag && (
            <>
              <pre className={styles.diagCode}>{diag}</pre>
              <button className={styles.diagCopy} onClick={copyDiag}>
                {copied ? (
                  <><UIcon name="check" size={11} /> Copied</>
                ) : (
                  <><UIcon name="copy" size={11} /> Copy diagnostics</>
                )}
              </button>
            </>
          )}
        </div>
      )}
      {attachments && attachments.length > 0 && (
        <div className={styles.msgAttachments}>
          {attachments.map(a => (
            <button
              key={a.id}
              type="button"
              className={styles.msgAttachThumb}
              onClick={() => setLightbox(a)}
              aria-label={`Enlarge ${a.filename}`}
              style={{ aspectRatio: a.width && a.height ? `${a.width} / ${a.height}` : undefined }}
            >
              <img src={a.url} alt="attachment" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-label="Attachment preview">
          <img src={lightbox.url} alt="attachment" />
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label="Close">
            <UIcon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
]

// ── Self-serve knowledge base ─────────────────────────────────────────────
//
// One entry = one help article. Each carries:
//   id       — stable identifier used for helpfulness votes + URL fragments
//   topic    — coarse routing key that matches page paths for contextual boost
//              (e.g. "journal" articles rise when the user came from /journal)
//   q        — the question, phrased as the user would type it
//   keywords — extra tokens the article-suggestion search matches on (never
//              shown; keep them lowercase and specific)
//   a        — the answer JSX (uses <Link> to deep-link into Settings sections)
//
// This is the source of truth for both "Quick answers" AND the article
// suggestions that appear inline on the new-ticket form. If you add an
// article here, both surfaces pick it up.
const FAQS = [
  {
    id: 'connect-broker',
    topic: 'journal',
    q: 'How do I connect my brokerage to the Journal?',
    keywords: 'broker brokerage snaptrade robinhood schwab connect import trade sync journal',
    a: <>Go to <Link to="/settings?section=connections">Settings → Connections</Link> and
      click Connect. Your trades, open positions, and balances auto-import
      (read-only) — 30+ US brokers supported.</>,
  },
  {
    id: 'billing-manage',
    topic: 'billing',
    q: 'How do I upgrade, manage billing, or cancel?',
    keywords: 'upgrade pro subscription plan cancel invoice payment card stripe billing renew',
    a: <>Everything lives in <Link to="/settings?section=billing">Settings → Plan &amp; Billing</Link>.
      "Manage Billing" opens the secure billing portal to update your card, view
      invoices, or cancel anytime.</>,
  },
  {
    id: 'account-profile',
    topic: 'account',
    q: 'How do I change my password or profile details?',
    keywords: 'password change reset profile name avatar photo email account',
    a: <>Head to <Link to="/settings?section=account">Settings → Account</Link> to edit
      your name, upload an avatar, or change your password.</>,
  },
  {
    id: 'chart-customize',
    topic: 'charts',
    q: 'How do I customize how charts look?',
    keywords: 'chart candle color indicator sma ema volume theme preset gear',
    a: <>Use <Link to="/settings?section=charts">Settings → Charts</Link> for presets,
      candle colors, indicators, and volume — or click the gear icon on any
      chart's toolbar for the same controls in place.</>,
  },
  {
    id: 'alerts-setup',
    topic: 'alerts',
    q: 'How do price alerts and notification sounds work?',
    keywords: 'alert notification sound tone browser email discord price target ticker',
    a: <>Right-click any ticker anywhere in the app to set a price alert. Delivery
      and alert tones are in <Link to="/settings?section=preferences">Settings → Preferences</Link>.</>,
  },
  {
    id: 'data-export',
    topic: 'account',
    q: 'Can I export my data?',
    keywords: 'export download data json watchlist trade journal settings',
    a: <>Yes — <Link to="/settings?section=legal">Settings → Data &amp; Legal</Link> lets
      you download your watchlists, journal, trades, and settings as JSON anytime.</>,
  },
  {
    id: 'chart-blank',
    topic: 'charts',
    q: 'A chart is blank, stuck, or showing wrong prices — what should I do?',
    keywords: 'chart blank stuck frozen wrong price bar candle stale broken empty',
    a: <>Try a hard refresh first (Ctrl+Shift+R / Cmd+Shift+R). Ninety-plus
      percent of chart oddities are resolved the moment a fresh bundle loads.
      Still broken? Open a ticket with the ticker and screenshot — we
      auto-attach your browser info so we can reproduce it.</>,
  },
  {
    id: 'wire-missing',
    topic: 'wire',
    q: 'The Morning Wire is late or missing this morning',
    keywords: 'morning wire brief late missing empty rundown premarket',
    a: <>The wire runs at 7:35 AM ET and takes ~7 minutes to publish. If it
      still isn't there by ~7:45 AM ET, ping us — the engine occasionally hits
      a data source that's slow, and we manually replay when needed.</>,
  },
  {
    id: 'compass-voice',
    topic: 'compass',
    q: 'Compass voice or read-aloud stopped working',
    keywords: 'compass voice speak talk read aloud audio mic microphone jarvis wake word',
    a: <>Check <Link to="/settings?section=compass">Settings → Compass &amp; Voice</Link> —
      voice needs a paid plan and the "Compass voice + read-aloud enabled"
      toggle. On Chrome, mic permission has to be granted for the site (padlock
      icon → Site settings → Microphone → Allow).</>,
  },
  {
    id: 'not-loading',
    topic: 'account',
    q: 'A whole page (Journal / Charts / Options Flow) won\'t load',
    keywords: 'page load loading blank white screen broken crash error 404 500',
    a: <>First try a hard refresh (Ctrl+Shift+R). If a single tab is broken but
      others work, the SPA state is stuck — refresh from the URL bar. If
      everything is down, check the status pill at the top of this page — if
      we're investigating, you'll see it there.</>,
  },
]

const FAQ_BY_ID = Object.fromEntries(FAQS.map(f => [f.id, f]))

// ── Contextual ordering ───────────────────────────────────────────────────
//
// The user landed on /support from somewhere. If it was /journal, prioritize
// journal-topic articles; if /charts, charts articles; and so on. The user's
// prior route beats document.referrer (which only fires on hard reloads and
// leaks nothing about intra-SPA navigation).
function inferSourceTopic(location) {
  const from = location?.state?.from || document.referrer || ''
  const path = typeof from === 'string' ? from : from.pathname || ''
  const s = path.toLowerCase()
  if (/journal|broker/.test(s)) return 'journal'
  if (/chart|breadth|screener|watchlist|theme/.test(s)) return 'charts'
  if (/settings|billing|account|subscribe|profile/.test(s)) {
    if (/billing|subscribe/.test(s)) return 'billing'
    return 'account'
  }
  if (/wire|leader|uct-20/.test(s)) return 'wire'
  if (/voice|compass/.test(s)) return 'compass'
  if (/alert|notif/.test(s)) return 'alerts'
  return null
}

function orderFaqsByContext(faqs, sourceTopic) {
  if (!sourceTopic) return faqs
  // Stable partition: matching topics first, everything else in original order.
  return [...faqs].sort((a, b) => {
    const aM = a.topic === sourceTopic ? 0 : 1
    const bM = b.topic === sourceTopic ? 0 : 1
    return aM - bM
  })
}

// ── Article-suggestion search (Intercom's killer feature) ─────────────────
//
// As the user types a ticket subject, surface the top 3 matching articles so
// they can self-serve before submitting. Case-insensitive token AND: every
// term the user typed must appear in the question OR the keywords string.
function searchFaqs(query, faqs) {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return []
  const terms = q.split(/\s+/).filter(t => t.length >= 2)
  if (terms.length === 0) return []
  const scored = faqs.map(f => {
    const hay = (f.q + ' ' + f.keywords).toLowerCase()
    const hits = terms.filter(t => hay.includes(t)).length
    return { faq: f, score: hits }
  }).filter(r => r.score === terms.length)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map(r => r.faq)
}

// ── Diagnostic capture ────────────────────────────────────────────────────
//
// Captured at ticket-create time and prepended to the first message inside a
// fenced code block so the owner can copy-paste it into a bug tracker. Nothing
// here is sensitive — no session token, no keys, only what the browser already
// exposes to any page the user visits.
function captureDiagnostics(user, plan, location) {
  const s = (typeof screen !== 'undefined') ? screen : {}
  const from = location?.state?.from || document.referrer || ''
  const path = typeof from === 'string' ? from : (from.pathname || '')
  const lines = [
    `User: ${user?.email || 'anonymous'} (${user?.id ? String(user.id).slice(0, 8) : '—'})`,
    `Plan: ${plan || 'free'}${user?.role === 'admin' ? ' · admin' : ''}`,
    `From: ${path || '(direct)'}`,
    `URL:  ${window.location.href}`,
    `UA:   ${navigator.userAgent}`,
    `Viewport: ${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`,
    `Screen:   ${s.width || '?'}×${s.height || '?'}`,
    `Locale:   ${navigator.language || 'en-US'} / ${Intl.DateTimeFormat().resolvedOptions().timeZone || '?'}`,
    `Time:     ${new Date().toISOString()}`,
  ]
  return lines.join('\n')
}

function withDiagnostics(userMessage, diagnostics) {
  return userMessage.trim() + '\n\n```diagnostics\n' + diagnostics + '\n```'
}

// ── System status widget ──────────────────────────────────────────────────
//
// Polls /api/support/status (30s cache on the server, another 30s here) and
// shows a small traffic light. If everything is operational we keep it green
// and out of the way; if something is degraded, the pill turns amber and the
// components list is expandable so users can see what's affected before
// filing a ticket about "is X down?"
function StatusPill() {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/support/status')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setStatus(d) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])
  if (!status) return null
  const dotClass = status.status === 'operational' ? styles.statusDotGreen
    : status.status === 'degraded' ? styles.statusDotAmber
    : styles.statusDotRed
  const bad = status.status !== 'operational'
  return (
    <button
      type="button"
      className={`${styles.statusPill} ${bad ? styles.statusPillBad : ''}`}
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      aria-label={`System status: ${status.label}`}
    >
      <span className={`${styles.statusDot} ${dotClass}`} />
      <span className={styles.statusLabel}>{status.label}</span>
      {(bad || open) && (
        <UIcon name={open ? 'chevronDown' : 'chevronRight'} size={10} />
      )}
      {open && (
        <div className={styles.statusPop} onClick={e => e.stopPropagation()}>
          {status.components.map(c => (
            <div key={c.name} className={styles.statusRow}>
              <span className={`${styles.statusDot} ${
                c.status === 'operational' ? styles.statusDotGreen
                : c.status === 'degraded' ? styles.statusDotAmber
                : styles.statusDotRed}`} />
              <span className={styles.statusRowName}>{c.name}</span>
              {c.detail && <span className={styles.statusRowDetail}>{c.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </button>
  )
}

// ── Was-this-helpful vote row ─────────────────────────────────────────────
//
// One click submits; a second click on the same button withdraws. The vote
// summary is loaded once for the whole page (batch endpoint) and lives in
// `votes` state up in the parent so a single vote won't refetch everything.
function VoteRow({ faqId, votes, onVote }) {
  const v = votes[faqId] || { up: 0, down: 0, own: null }
  const onClick = (kind) => {
    if (v.own === kind) onVote(faqId, null)
    else onVote(faqId, kind)
  }
  return (
    <div className={styles.voteRow}>
      <span className={styles.voteLabel}>Was this helpful?</span>
      <button
        className={`${styles.voteBtn} ${v.own === 'up' ? styles.voteBtnActive : ''}`}
        onClick={() => onClick('up')}
        aria-label="Yes, this was helpful"
      >
        <UIcon name="thumbsUp" size={12} />
        <span className={styles.voteCount}>{v.up}</span>
      </button>
      <button
        className={`${styles.voteBtn} ${v.own === 'down' ? styles.voteBtnActive : ''}`}
        onClick={() => onClick('down')}
        aria-label="No, this wasn't helpful"
      >
        <UIcon name="thumbsDown" size={12} />
        <span className={styles.voteCount}>{v.down}</span>
      </button>
    </div>
  )
}

function QuickAnswers({ faqs, votes, onVote }) {
  const [open, setOpen] = useState(null)
  return (
    <div className={styles.faqWrap}>
      <div className={styles.faqTitle}>
        <UIcon name="sparkle" size={13} />
        Quick answers
      </div>
      {faqs.map((f, i) => (
        <div key={f.id} className={styles.faqItem}>
          <button
            className={styles.faqQ}
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <UIcon name={open === i ? 'chevronDown' : 'chevronRight'} size={11} />
            {f.q}
          </button>
          {open === i && (
            <div className={styles.faqA}>
              {f.a}
              <VoteRow faqId={f.id} votes={votes} onVote={onVote} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Article suggestion box shown BELOW the subject field on the new-ticket form.
// Kept quiet (no border, subtle background) so it doesn't compete with the
// form — the goal is to catch the user in the moment of typing, not to
// interrupt them.
function ArticleSuggestions({ query, faqs, onDismiss }) {
  const matches = searchFaqs(query, faqs)
  const [openId, setOpenId] = useState(null)
  if (matches.length === 0) return null
  return (
    <div className={styles.suggestWrap}>
      <div className={styles.suggestTitle}>
        <UIcon name="sparkle" size={12} />
        Before you submit — this might help
        <button className={styles.suggestDismiss} onClick={onDismiss} aria-label="Hide suggestions">
          <UIcon name="x" size={11} />
        </button>
      </div>
      {matches.map(f => (
        <div key={f.id} className={styles.suggestItem}>
          <button
            className={styles.suggestQ}
            onClick={() => setOpenId(openId === f.id ? null : f.id)}
            aria-expanded={openId === f.id}
          >
            <UIcon name={openId === f.id ? 'chevronDown' : 'chevronRight'} size={11} />
            {f.q}
          </button>
          {openId === f.id && <div className={styles.suggestA}>{f.a}</div>}
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
  // Ticket IDs are UUIDs — accept any non-empty alphanumeric-ish string.
  const activeTicketId = tParam && /^[A-Za-z0-9-]{1,64}$/.test(tParam) ? tParam : null
  const view = activeTicketId ? 'thread' : searchParams.get('view') === 'new' ? 'new' : 'list'

  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [thread, setThread] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [ticketSearch, setTicketSearch] = useState('')

  // New ticket form
  const [category, setCategory] = useState('bug')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [urgent, setUrgent] = useState(false)
  const [includeDiag, setIncludeDiag] = useState(true)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  // Pending attachments the user picked before the ticket exists. Each entry
  // is { id, file, previewUrl } — id is a temp local uuid, previewUrl comes
  // from URL.createObjectURL. Cleared after the ticket is submitted (or
  // released if the user removes an entry).
  const [pendingFiles, setPendingFiles] = useState([])

  // Reply
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const [replyFiles, setReplyFiles] = useState([])
  const [attachmentsByMsg, setAttachmentsByMsg] = useState({})
  const messagesEndRef = useRef(null)

  // ── Contextual FAQ + votes ──
  const location = useLocation()
  const { user, plan } = useAuth()
  const sourceTopic = useMemo(() => inferSourceTopic(location), [location])
  const orderedFaqs = useMemo(() => orderFaqsByContext(FAQS, sourceTopic), [sourceTopic])

  const [votes, setVotes] = useState({})
  useEffect(() => {
    fetch('/api/auth/faq-votes')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.votes) return
        const map = {}
        for (const v of d.votes) map[v.faq_id] = { up: v.up, down: v.down, own: v.own }
        setVotes(map)
      })
      .catch(() => {})
  }, [])

  const handleVote = useCallback((faqId, kind) => {
    // Optimistic — the UI reflects the click before the network settles so
    // votes feel weightless. Roll back on error.
    setVotes(prev => {
      const cur = prev[faqId] || { up: 0, down: 0, own: null }
      const next = { ...cur }
      // Undo the previous vote's count.
      if (cur.own === 'up') next.up = Math.max(0, cur.up - 1)
      if (cur.own === 'down') next.down = Math.max(0, cur.down - 1)
      // Apply the new vote (or clear).
      if (kind === 'up') { next.up += 1; next.own = 'up' }
      else if (kind === 'down') { next.down += 1; next.own = 'down' }
      else { next.own = null }
      return { ...prev, [faqId]: next }
    })
    if (kind === null) {
      fetch(`/api/auth/faq-vote/${faqId}`, { method: 'DELETE' }).catch(() => {})
    } else {
      fetch(`/api/auth/faq-vote/${faqId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful: kind === 'up' }),
      }).catch(() => {})
    }
  }, [])

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
    // Pair the thread fetch with the attachments list so a message and its
    // screenshots always render in the same paint.
    Promise.all([
      fetch(`/api/auth/tickets/${ticketId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/auth/tickets/${ticketId}/attachments`).then(r => r.ok ? r.json() : { attachments: [] }),
    ])
      .then(([thread, atts]) => {
        setThread(thread)
        const map = {}
        for (const a of atts?.attachments || []) {
          if (!map[a.message_id]) map[a.message_id] = []
          map[a.message_id].push(a)
        }
        setAttachmentsByMsg(map)
      })
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
  //
  // Compose the outgoing message so the engineering side has what it needs
  // without asking the user for it:
  //   [URGENT] prefix on the subject so admin filters catch priority tickets
  //   diagnostic block appended (unless the user opted out) so we know
  //     browser/OS/URL/plan without a follow-up round trip
  async function handleSubmit(e) {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) return
    setSubmitting(true)
    try {
      const finalSubject = (urgent ? '[URGENT] ' : '') + subject.trim()
      const diag = includeDiag ? captureDiagnostics(user, plan, location) : null
      const finalMessage = diag ? withDiagnostics(message, diag) : message.trim()
      const res = await fetch('/api/auth/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: finalSubject,
          message: finalMessage,
          category,
        }),
      })
      if (res.ok) {
        // Upload any pending screenshots against the ticket's first message.
        // Failed uploads are silent (owner will see the ticket regardless).
        try {
          const body = await res.json()
          const ticketId = body.id
          const msgId = body.message_id
          if (ticketId && msgId && pendingFiles.length > 0) {
            for (const p of pendingFiles) {
              const fd = new FormData()
              fd.append('file', p.file)
              await fetch(`/api/auth/tickets/${ticketId}/messages/${msgId}/attachments`, {
                method: 'POST', body: fd,
              }).catch(() => {})
            }
          }
        } catch { /* ignore body-parse errors */ }
        // Release object URLs to prevent leaking blobs.
        pendingFiles.forEach(p => { try { URL.revokeObjectURL(p.previewUrl) } catch {} })
        setPendingFiles([])
        setSubject('')
        setMessage('')
        setCategory('bug')
        setUrgent(false)
        setSuggestionsDismissed(false)
        setSearchParams({})
        fetchTickets()
      }
    } catch { /* silent */ }
    finally { setSubmitting(false) }
  }

  // ── Send reply ──
  async function handleReply() {
    // Text is required unless the user is only sending images.
    if (!activeTicketId) return
    if (!reply.trim() && replyFiles.length === 0) return
    setReplying(true)
    try {
      const textBody = reply.trim() || '(screenshot attached)'
      const res = await fetch(`/api/auth/tickets/${activeTicketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textBody }),
      })
      if (res.ok) {
        try {
          const body = await res.json()
          const msgId = body.id
          if (msgId && replyFiles.length > 0) {
            for (const p of replyFiles) {
              const fd = new FormData()
              fd.append('file', p.file)
              await fetch(`/api/auth/tickets/${activeTicketId}/messages/${msgId}/attachments`, {
                method: 'POST', body: fd,
              }).catch(() => {})
            }
          }
        } catch { /* ignore */ }
        replyFiles.forEach(p => { try { URL.revokeObjectURL(p.previewUrl) } catch {} })
        setReplyFiles([])
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
    const statusFiltered = statusFilter === 'all'
      ? tickets
      : tickets.filter(t => t.status === statusFilter)
    const q = ticketSearch.trim().toLowerCase()
    const visibleTickets = q.length === 0 ? statusFiltered : statusFiltered.filter(t => {
      const hay = (t.subject + ' ' + (t.last_message || '') + ' ' + (t.category || '')).toLowerCase()
      return hay.includes(q)
    })

    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Support</h1>
          <div className={styles.headerRight}>
            <StatusPill />
            <button className={styles.newBtn} onClick={() => setSearchParams({ view: 'new' })}>
              New Ticket
            </button>
          </div>
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
            <div className={styles.filterRow}>
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
              {tickets.length > 3 && (
                <div className={styles.searchWrap}>
                  <UIcon name="search" size={12} className={styles.searchIcon} />
                  <input
                    className={styles.searchInput}
                    type="text"
                    value={ticketSearch}
                    onChange={e => setTicketSearch(e.target.value)}
                    placeholder="Search your tickets..."
                    aria-label="Search tickets"
                  />
                  {ticketSearch && (
                    <button
                      className={styles.searchClear}
                      onClick={() => setTicketSearch('')}
                      aria-label="Clear search"
                    >
                      <UIcon name="x" size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className={styles.ticketList}>
              {visibleTickets.length === 0 ? (
                <div className={styles.loading}>No {statusFilter.replace('_', ' ')} tickets</div>
              ) : visibleTickets.map(t => {
                // Owner-side [URGENT] prefix bubbles up as a pill on the row
                // so admins scanning the list see priority at a glance.
                const isUrgent = /^\[URGENT\]/i.test(t.subject || '')
                const displaySubject = isUrgent ? t.subject.replace(/^\[URGENT\]\s*/i, '') : t.subject
                // Diagnostic block appears in the raw last_message; strip it
                // from the preview so the human words show, not the metadata.
                const preview = (t.last_message || '').replace(/```diagnostics[\s\S]*?```/g, '').trim()
                return (
                  <div key={t.id} className={styles.ticketCard} onClick={() => openThread(t.id)}>
                    <div className={styles.ticketCardTop}>
                      <span className={styles.ticketSubject}>{displaySubject}</span>
                      {isUrgent && <span className={styles.urgentBadge}>Urgent</span>}
                      <CategoryBadge category={t.category} />
                      <StatusBadge status={t.status} />
                    </div>
                    <div className={styles.ticketPreview}>
                      {preview ? preview.slice(0, 100) : ''}
                    </div>
                    <div className={styles.ticketMeta}>
                      {t.last_sender === 'admin' && (
                        <span><span className={styles.adminDot} /> Admin replied</span>
                      )}
                      <span>{t.message_count} message{t.message_count !== 1 ? 's' : ''}</span>
                      <span>{timeAgo(t.updated_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!loading && <QuickAnswers faqs={orderedFaqs} votes={votes} onVote={handleVote} />}
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
              {!suggestionsDismissed && (
                <ArticleSuggestions
                  query={subject}
                  faqs={FAQS}
                  onDismiss={() => setSuggestionsDismissed(true)}
                />
              )}
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
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Screenshots (optional)</label>
              <AttachmentPicker files={pendingFiles} setFiles={setPendingFiles} id="new-ticket" />
            </div>
            <div className={styles.formOptions}>
              <label className={styles.formCheck}>
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={e => setUrgent(e.target.checked)}
                />
                <span>
                  <span className={styles.formCheckLabel}>Mark as urgent</span>
                  <span className={styles.formCheckHint}>Use for account access, billing, or trading-day outages.</span>
                </span>
              </label>
              <label className={styles.formCheck}>
                <input
                  type="checkbox"
                  checked={includeDiag}
                  onChange={e => setIncludeDiag(e.target.checked)}
                />
                <span>
                  <span className={styles.formCheckLabel}>Include diagnostic info</span>
                  <span className={styles.formCheckHint}>Attaches your browser, plan, and current page so we can reproduce faster.</span>
                </span>
              </label>
            </div>
            <button
              className="btn btn-primary"
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
          {(() => {
            const raw = thread.ticket.subject || ''
            const isUrgent = /^\[URGENT\]/i.test(raw)
            const cleanSubject = isUrgent ? raw.replace(/^\[URGENT\]\s*/i, '') : raw
            return (
              <div className={styles.threadHeader}>
                <span className={styles.threadSubject}>{cleanSubject}</span>
                {isUrgent && <span className={styles.urgentBadge}>Urgent</span>}
                <CategoryBadge category={thread.ticket.category} />
                <StatusBadge status={thread.ticket.status} />
              </div>
            )
          })()}

          {thread.ticket.status === 'resolved' && (
            <div className={styles.resolvedBanner}>
              <span>This ticket has been resolved</span>
              <button className={styles.reopenBtn} onClick={handleReopen}>Reopen</button>
            </div>
          )}

          <div className={styles.messageList}>
            {thread.messages.map(m => (
              <MessageBubble key={m.id} m={m} attachments={attachmentsByMsg[m.id]} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.replyWrap}>
            <div className={styles.replyComposer}>
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
              <div className={styles.replyKeys}>
                <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for newline
              </div>
              <AttachmentPicker files={replyFiles} setFiles={setReplyFiles} id="reply" />
            </div>
            <button
              className={styles.replyBtn}
              onClick={handleReply}
              disabled={replying || (!reply.trim() && replyFiles.length === 0)}
            >
              {replying ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

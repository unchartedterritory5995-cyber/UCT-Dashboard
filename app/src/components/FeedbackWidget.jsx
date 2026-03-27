import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const WIDGET_STYLES = {
  btn: {
    position: 'fixed', bottom: 24, right: 24, width: 48, height: 48,
    borderRadius: '50%', background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c', fontSize: 22, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 400, transition: 'all 0.2s', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  popup: {
    position: 'fixed', bottom: 84, right: 24, width: 320,
    background: '#1a1c17', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12, padding: 20, zIndex: 401,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  title: {
    fontSize: 13, color: '#e8e3d6', fontWeight: 600, letterSpacing: 0.5,
  },
  textarea: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#e8e3d6', padding: '8px 12px', borderRadius: 8,
    fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 80,
    outline: 'none',
  },
  starsRow: {
    display: 'flex', gap: 4, alignItems: 'center',
  },
  star: (active) => ({
    fontSize: 20, cursor: 'pointer', color: active ? '#c9a84c' : 'rgba(255,255,255,0.15)',
    transition: 'color 0.15s', background: 'none', border: 'none', padding: '0 2px',
  }),
  sendBtn: {
    background: 'rgba(201,168,76,0.2)', color: '#c9a84c',
    border: '1px solid rgba(201,168,76,0.4)', padding: '8px 16px',
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'background 0.15s',
  },
  success: {
    color: '#4ade80', fontSize: 13, textAlign: 'center', padding: 16,
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 399, background: 'transparent',
  },
}

export default function FeedbackWidget() {
  const { user } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [rating, setRating] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  // Hide if not logged in or on admin page
  if (!user || location.pathname.startsWith('/admin')) return null

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/auth/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          page: location.pathname,
          rating: rating || null,
        }),
      })
      if (res.ok) {
        setSent(true)
        setTimeout(() => { setOpen(false); setSent(false); setMessage(''); setRating(0) }, 2000)
      }
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  return (
    <>
      {open && <div style={WIDGET_STYLES.backdrop} onClick={() => setOpen(false)} />}
      {open && (
        <div style={WIDGET_STYLES.popup}>
          {sent ? (
            <div style={WIDGET_STYLES.success}>Thanks! We read every message.</div>
          ) : (
            <>
              <div style={WIDGET_STYLES.title}>Send Feedback</div>
              <textarea
                style={WIDGET_STYLES.textarea}
                placeholder="What's on your mind?"
                value={message}
                onChange={e => setMessage(e.target.value)}
                autoFocus
              />
              <div style={WIDGET_STYLES.starsRow}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginRight: 4 }}>Rating:</span>
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    style={WIDGET_STYLES.star(n <= rating)}
                    onClick={() => setRating(n === rating ? 0 : n)}
                  >
                    &#9733;
                  </button>
                ))}
              </div>
              <button
                style={{
                  ...WIDGET_STYLES.sendBtn,
                  opacity: (!message.trim() || sending) ? 0.5 : 1,
                  cursor: (!message.trim() || sending) ? 'not-allowed' : 'pointer',
                }}
                onClick={handleSend}
                disabled={!message.trim() || sending}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </>
          )}
        </div>
      )}
      <button
        style={WIDGET_STYLES.btn}
        onClick={() => { setOpen(v => !v); setSent(false) }}
        title="Send feedback"
      >
        ?
      </button>
    </>
  )
}

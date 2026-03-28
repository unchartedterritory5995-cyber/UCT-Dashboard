import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const S = {
  btn: {
    position: 'fixed', top: 10, right: 14, width: 24, height: 24,
    borderRadius: '50%', background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 500, transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    lineHeight: 1,
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 498, background: 'transparent',
  },
  menu: {
    position: 'fixed', top: 40, right: 14, width: 170,
    background: '#1a1c17', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, zIndex: 499, boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', cursor: 'pointer', fontSize: 12,
    color: '#e8e3d6', fontFamily: 'IBM Plex Mono, monospace',
    fontWeight: 600, letterSpacing: 0.3,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    transition: 'background 0.12s',
  },
  popup: {
    position: 'fixed', top: 40, right: 14, width: 300,
    background: '#1a1c17', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: 18, zIndex: 499,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  title: { fontSize: 12, color: '#c9a84c', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' },
  textarea: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#e8e3d6', padding: '8px 10px', borderRadius: 6,
    fontSize: 12, fontFamily: 'inherit', resize: 'vertical', minHeight: 70, outline: 'none',
  },
  starsRow: { display: 'flex', gap: 3, alignItems: 'center' },
  star: (active) => ({
    fontSize: 17, cursor: 'pointer', color: active ? '#c9a84c' : 'rgba(255,255,255,0.15)',
    transition: 'color 0.15s', background: 'none', border: 'none', padding: '0 2px',
  }),
  sendBtn: {
    background: 'rgba(201,168,76,0.18)', color: '#c9a84c',
    border: '1px solid rgba(201,168,76,0.35)', padding: '7px 14px',
    borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  success: { color: '#4ade80', fontSize: 12, textAlign: 'center', padding: 14 },
}

export default function FeedbackWidget() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(null) // null | 'menu' | 'feedback'
  const [message, setMessage] = useState('')
  const [rating, setRating] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [hovered, setHovered] = useState(null)

  if (!user || location.pathname.startsWith('/admin')) return null

  function close() { setMode(null); setSent(false); setMessage(''); setRating(0) }

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/auth/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), page: location.pathname, rating: rating || null }),
      })
      if (res.ok) {
        setSent(true)
        setTimeout(close, 2000)
      }
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  return (
    <>
      {mode && <div style={S.backdrop} onClick={close} />}

      {mode === 'menu' && (
        <div style={S.menu}>
          <div
            style={{ ...S.menuItem, background: hovered === 'feedback' ? 'rgba(255,255,255,0.05)' : 'transparent' }}
            onMouseEnter={() => setHovered('feedback')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setMode('feedback')}
          >
            💬 Send Feedback
          </div>
          <div
            style={{ ...S.menuItem, borderBottom: 'none', background: hovered === 'ticket' ? 'rgba(255,255,255,0.05)' : 'transparent' }}
            onMouseEnter={() => setHovered('ticket')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => { close(); navigate('/support') }}
          >
            🎫 Support Ticket
          </div>
        </div>
      )}

      {mode === 'feedback' && (
        <div style={S.popup}>
          {sent ? (
            <div style={S.success}>Thanks! We read every message.</div>
          ) : (
            <>
              <div style={S.title}>Send Feedback</div>
              <textarea
                style={S.textarea}
                placeholder="What's on your mind?"
                value={message}
                onChange={e => setMessage(e.target.value)}
                autoFocus
              />
              <div style={S.starsRow}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginRight: 3 }}>Rating:</span>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} style={S.star(n <= rating)} onClick={() => setRating(n === rating ? 0 : n)}>★</button>
                ))}
              </div>
              <button
                style={{ ...S.sendBtn, opacity: (!message.trim() || sending) ? 0.5 : 1, cursor: (!message.trim() || sending) ? 'not-allowed' : 'pointer' }}
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
        style={S.btn}
        onClick={() => mode ? close() : setMode('menu')}
        title="Help & Feedback"
      >
        ?
      </button>
    </>
  )
}

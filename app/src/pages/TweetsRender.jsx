// app/src/pages/TweetsRender.jsx — headless, token-gated "Top Tweets" export.
//
// Renders the top-N recent notable tweets (that mention tickers) as branded cards
// for the Morning Wire → Substack newsletter. A headless browser navigates here,
// waits for window.__panelReady, and screenshots #panel-export.
//
// Public route (no AuthGuard). Data from /api/r/tweets?token= (token-gated public
// twin of the auth-gated /api/tweets/*). ?token= checked against VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)))
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
}

// Render tweet text with $CASHTAGS gold and @handles dimmed.
function renderText(text) {
  const parts = decodeEntities(text).split(/(\$[A-Za-z]{1,6}\b|@\w+)/g)
  return parts.map((p, i) => {
    if (/^\$[A-Za-z]{1,6}$/.test(p)) return <span key={i} style={{ color: '#c9a84c', fontWeight: 700 }}>{p}</span>
    if (/^@\w+$/.test(p)) return <span key={i} style={{ color: '#7f8ea3' }}>{p}</span>
    return <span key={i}>{p}</span>
  })
}

function TweetCard({ t }) {
  return (
    <div style={{ padding: '13px 16px', background: '#121212', border: '1px solid #232323', borderRadius: 10, marginBottom: 11 }}>
      {/* Author (name/handle) intentionally omitted — headline + tickers only. */}
      <div style={{ display: 'flex' }}>
        <span style={{ marginLeft: 'auto', color: '#6f6f6f', fontSize: 11.5 }}>{timeAgo(t.created_at)}</span>
      </div>
      <div style={{ color: '#d7d7d7', fontSize: 13.5, lineHeight: 1.5, marginTop: 2 }}>{renderText(t.text)}</div>
      {Array.isArray(t.tickers) && t.tickers.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {t.tickers.slice(0, 8).map((tk) => (
            <span key={tk} style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', padding: '2px 8px', borderRadius: 999 }}>
              {String(tk).toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TweetsRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const n = Math.min(8, Math.max(1, parseInt(sp.get('n') || '5', 10)))
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  const [tweets, setTweets] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/tweets?token=${encodeURIComponent(token)}&n=${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setTweets(Array.isArray(d.tweets) ? d.tweets : []))
      .catch(() => setErr('data unavailable'))
  }, [token, n])

  useEffect(() => {
    if (tweets == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1200)
    return () => clearTimeout(t)
  }, [tweets])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (tweets == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>ON THE TAPE — TOP TWEETS</span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '16px 18px 8px' }}>
          {tweets.length === 0 && <div style={{ color: '#888', padding: 12 }}>No tweets.</div>}
          {tweets.map((t, i) => <TweetCard key={i} t={t} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Curated market tape</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}

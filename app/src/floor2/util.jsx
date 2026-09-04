import { useState } from 'react'

export const REACTION_PALETTE = ['🔥', '🚀', '💯', '🧠', '👀', '🙌', '😂', '💎', '🫡', '🤯']

export function timeAgo(epoch) {
  const s = Math.max(1, Math.floor((Date.now() - epoch) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

// A post/comment is "new" if created within the last ~4 hours (for the NEW badge).
export const isFresh = (epoch) => Date.now() - epoch < 4 * 3600 * 1000
// "Old" enough that replying to it visibly revives it.
export const isOld = (epoch) => Date.now() - epoch > 21 * 24 * 3600 * 1000

// Stable per-id color (author ids are opaque strings from the backend).
function colorFor(id) {
  const palette = ['#6ea8fe', '#4ade80', '#f472b6', '#22d3ee', '#fb923c',
    '#a78bfa', '#f87171', '#34d399', '#e879f9', '#60a5fa']
  let h = 0
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function initialsFor(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]).join('').toUpperCase() || '?'
}

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  r = Math.max(0, Math.min(255, r + (r * pct) / 100))
  g = Math.max(0, Math.min(255, g + (g * pct) / 100))
  b = Math.max(0, Math.min(255, b + (b * pct) / 100))
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

// Avatar/Author take the API author object (`info` = {name, is_mentor}) plus the
// opaque author id (drives the stable color). Shows the user's uploaded avatar
// when one exists (/api/auth/avatar/{id} serves a 1x1 transparent pixel when
// missing — detected via naturalWidth>2, same trick as CompanyLogo/FloorAvatar),
// otherwise the colored initial monogram.
export function Avatar({ id, info, size = 26 }) {
  const [imgOk, setImgOk] = useState(true)
  const name = info?.name || 'member'
  const mentor = !!info?.is_mentor
  const color = colorFor(id || name)
  // The monogram always renders underneath; the avatar image overlays it. When a
  // user has no avatar the endpoint returns a 1x1 transparent pixel (so the
  // monogram shows through), and a real upload covers it — no onLoad/naturalWidth
  // gate, so a first-time cross-user view shows reliably regardless of caching.
  const style = {
    width: size, height: size, fontSize: size * 0.4, position: 'relative', overflow: 'hidden',
    background: mentor
      ? 'linear-gradient(145deg, #3a3110, #241d07)'
      : `linear-gradient(145deg, ${color}, ${shade(color, -22)})`,
    color: mentor ? '#ddc06a' : '#0d0f14',
    border: mentor ? '1px solid rgba(201,168,76,.5)' : 'none',
  }
  return (
    <span className="avatar" style={style} title={name}>
      {initialsFor(name)}
      {id && imgOk && (
        <img src={`/api/auth/avatar/${id}`} alt="" width={size} height={size}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgOk(false)} />
      )}
    </span>
  )
}

export function Author({ info }) {
  const name = info?.name || 'member'
  const mentor = !!info?.is_mentor
  return (
    <span className="author">
      <span className="name">{name}</span>
      {mentor && <span className="mentor-tag">Mentor</span>}
    </span>
  )
}

export function highlightTickers(text) {
  const parts = String(text).split(/(\$[A-Z]{1,5}\b)/g)
  return parts.map((part, i) =>
    /^\$[A-Z]{1,5}$/.test(part)
      ? <span key={i} className="tk" data-ticker={part.slice(1)}>{part}</span>
      : part,
  )
}

// ---- TipTap doc rendering ---------------------------------------------------
// Bodies are TipTap doc JSON strings. We render them ourselves (React escapes all
// text, and image srcs are gated to /api/community/images/) so the exact
// prototype look is preserved: paragraphs with $TICKER chips + an image grid.

function parseDoc(body) {
  if (!body) return null
  try {
    const d = typeof body === 'string' ? JSON.parse(body) : body
    return d && d.type === 'doc' ? d : null
  } catch { return null }
}

function nodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content || []).map(nodeText).join('')
}

export function docSnippet(body) {
  const doc = parseDoc(body)
  if (!doc) return ''
  for (const n of doc.content || []) {
    if (n.type === 'paragraph') {
      const t = nodeText(n).trim()
      if (t) return t
    }
  }
  return ''
}

export function docImages(body) {
  const doc = parseDoc(body)
  if (!doc) return []
  const out = []
  const walk = (n) => {
    if (!n) return
    if (n.type === 'image' && (n.attrs?.src || '').startsWith('/api/community/images/')) out.push(n.attrs.src)
    ;(n.content || []).forEach(walk)
  }
  ;(doc.content || []).forEach(walk)
  return out
}

// Full body render: paragraphs (with $TICKER highlight) then any images in a grid.
export function RenderDoc({ body, className, images = true }) {
  const doc = parseDoc(body)
  if (!doc) return null
  const paras = []
  const imgs = []
  ;(doc.content || []).forEach((n, i) => {
    if (n.type === 'paragraph') {
      paras.push(<p key={`p${i}`}>{highlightTickers(nodeText(n))}</p>)
    } else if (n.type === 'image' && (n.attrs?.src || '').startsWith('/api/community/images/')) {
      imgs.push(n.attrs.src)
    }
  })
  return (
    <div className={className}>
      {paras}
      {images && imgs.length > 0 && (
        <div className="post-images">
          {imgs.map((src, i) => <img key={i} src={src} alt="attachment" />)}
        </div>
      )}
    </div>
  )
}

// ---- misc helpers -----------------------------------------------------------
export function countComments(commentsOrPost) {
  const comments = Array.isArray(commentsOrPost) ? commentsOrPost : (commentsOrPost?.comments || [])
  let n = 0
  const walk = (list) => list.forEach((c) => { n++; walk(c.replies || []) })
  walk(comments)
  return n
}

// Normalize away punctuation/dashes/$ so "gap up" == "gap-up".
const normText = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Wrap query words (2+ chars) in a gold highlight, ignoring punctuation.
export function highlightMatch(text, query) {
  const tokens = [...new Set(normText(query).split(' ').filter((t) => t.length >= 2))]
  if (!tokens.length) return text
  const re = new RegExp(`(${tokens.map(escRe).join('|')})`, 'ig')
  const set = new Set(tokens)
  return String(text).split(re).map((p, i) =>
    p && set.has(p.toLowerCase()) ? <mark key={i} className="search-hl">{p}</mark> : p,
  )
}

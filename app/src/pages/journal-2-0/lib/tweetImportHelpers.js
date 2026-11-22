/**
 * Import a tweet -- the client half that loads on use: the fetch calls and the text helpers of
 * the sheet (`components/notebook/ImportTweetSheet.jsx`) and the card (`TweetCard.jsx`). The flag
 * check and the event name are `tweetImport.js`, which IS on the Notebook's first open.
 * The server is `api/routers/notebook_tweet_capture.py`.
 */
import { formatCurrency, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { formatSessionDate } from '../../../lib/presentation/presentationDates'
import { call } from './researchCapture'

const BASE = '/api/j2/research-capture/tweets'

/** The posts UCT holds from the last week, newest first: `scope` is 'ticker' or 'all'. */
export const fetchRecent = ({ symbol, scope }) => {
  const q = new URLSearchParams({ scope })
  if (symbol) q.set('symbol', symbol)
  return call(`${BASE}/recent?${q}`).then((d) => (Array.isArray(d?.posts) ? d.posts : []))
}

/** A pasted X link as a post. */
export const resolveLink = (url) =>
  call(`${BASE}/resolve`, { method: 'POST', body: { url } }).then((d) => d.post)

/** Posts into a note. A 200 can carry `stopped`: some saved, and the note's revision still moved. */
export const saveTweets = ({ noteId, tweetIds }) =>
  call(`${BASE}/save`, { method: 'POST', body: { noteId, tweetIds } })

/** The same shape the server's `parse_status_id` accepts, so the sentence can answer at once. */
const STATUS_LINK = /^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/(?:[A-Za-z0-9_]{1,15}\/status(?:es)?|i\/web\/status)\/\d{1,25}(?:[/?#].*)?$/i

export const isPostLink = (url) => STATUS_LINK.test(String(url || '').trim())

/** A stored link as a safe href: only a post on X, always absolute. Otherwise null. */
export function postHref(url) {
  const link = String(url || '').trim()
  if (!isPostLink(link)) return null
  return /^https?:\/\//i.test(link) ? link : `https://${link}`
}

const AVATAR_TINTS = ['#7a4cc2', '#2f7f6f', '#b5683a', '#3468a8', '#a13f62']

export const authorInitials = (name) =>
  String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/** One author, one colour, in the sheet and on the card. */
export function avatarTint(handle) {
  let h = 0
  for (const c of String(handle || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

/** A post's words split on its cashtags: the odd indexes are the cashtags. */
export const splitCashtags = (text) => String(text || '').split(/(\$[A-Z]{1,5}\b)/)

/** My take. It lives on the excerpt row, so it moves no note revision and has none to settle. */
export const saveTake = (excerptId, annotation) =>
  call(`/api/j2/excerpts/${encodeURIComponent(excerptId)}`, { method: 'PATCH', body: { annotation } })

/** The same write for a page that is going away: `keepalive` outlives it, and no one is left to tell. */
export function saveTakeOnLeave(excerptId, annotation) {
  fetch(`/api/j2/excerpts/${encodeURIComponent(excerptId)}`, {
    method: 'PATCH',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotation }),
  }).catch(() => {})
}

/** Trash a note an import created and then put nothing in. */
export const discardEmptyNote = (noteId) =>
  call(`/api/j2/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' })

export const snapshotKey = (symbol) => `/api/snapshot/${encodeURIComponent(symbol)}`

/** The latest price in a `/api/snapshot/{ticker}` answer: `ext_price`, else `close`, else null. */
export function nowPriceOf(snapshot) {
  for (const value of [snapshot?.ext_price, snapshot?.close]) {
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

const PRICE_WORDS = { posted: 'when posted', premarket: 'premarket', after_hours: 'after hours' }

function priceWords({ label, sessionDate }) {
  if (label !== 'close') return PRICE_WORDS[label] || null
  const day = formatSessionDate(sessionDate)
  return day ? `close on ${day}` : 'close'
}

/**
 * The card's price line, or null when there is no price to state. With no usable `nowPrice` only
 * `thenText` is filled in. `tone` follows the sign printed in `pctText`.
 */
export function priceLineParts(price, nowPrice) {
  const words = price && priceWords(price)
  if (!words || !price.symbol || !(Number.isFinite(price.price) && price.price > 0)) return null
  const thenText = `$${price.symbol} ${words} ${formatCurrency(price.price)}`
  if (!(Number.isFinite(nowPrice) && nowPrice > 0)) {
    return { thenText, nowText: null, pctText: null, tone: null }
  }
  const pct = ((nowPrice - price.price) / price.price) * 100
  const pctText = `${formatPercent(pct, { decimals: 1, signed: true })} since`
  return {
    thenText,
    nowText: `Now ${formatCurrency(nowPrice)}`,
    pctText,
    tone: pctText.startsWith('-') ? 'down' : 'up',
  }
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/**
 * Posts as `[{day, posts}]`, newest day first, in the member's own timezone: "Today", then
 * "Friday, Nov 6". `postedAt` is UNIX SECONDS.
 */
export function groupByDay(posts, now = Date.now()) {
  const today = dayKey(new Date(now))
  const groups = []
  const byKey = new Map()
  const newestFirst = [...(posts || [])].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0))
  for (const post of newestFirst) {
    const at = new Date((post.postedAt || 0) * 1000)
    const key = dayKey(at)
    let group = byKey.get(key)
    if (!group) {
      group = {
        day: key === today ? 'Today' : at.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        posts: [],
      }
      byKey.set(key, group)
      groups.push(group)
    }
    group.posts.push(post)
  }
  return groups
}

/** "2h", "40m", or the short weekday once it is a day old. */
export function postAge(postedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor(now / 1000) - (postedAt || 0))
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return new Date((postedAt || 0) * 1000).toLocaleDateString('en-US', { weekday: 'short' })
}

// After an import the first card takes the cursor. The sheet closes first and the card mounts
// later, so the id waits here until that card asks for it, once.
let pendingFocus = null

export function setPendingFocus(excerptId) {
  pendingFocus = excerptId || null
}

/** True only for the card that was named, and only once. */
export function consumePendingFocus(excerptId) {
  if (!excerptId || pendingFocus !== excerptId) return false
  pendingFocus = null
  return true
}

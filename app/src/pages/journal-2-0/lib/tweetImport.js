/**
 * Import a tweet -- the client half (dark behind `notebook_tweet_import_enabled`).
 *
 * The server is `api/routers/notebook_tweet_capture.py`. This module is on the Notebook's first
 * open (SlashMenu reads the flag and the event), so the sheet's weight stays in
 * `components/notebook/ImportTweetSheet.jsx`, which loads on use.
 */
import { notebookFlag } from './offline/notebookFlags'
import { call } from './researchCapture'

export const TWEET_IMPORT_FLAG = 'notebook_tweet_import_enabled'

/** The editor's "/tweet" and its toolbar button ask THIS editor's host to open the sheet --
 *  dispatched on the editor's own DOM root, never `window` (the I5 rule SlashMenu's events follow). */
export const TWEET_EVENT = 'uct-notebook:tweet-import'

const BASE = '/api/j2/research-capture/tweets'

export function tweetImportEnabled() {
  return notebookFlag(TWEET_IMPORT_FLAG) === true
}

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
const STATUS_LINK = /^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{1,25}(?:[/?#].*)?$/i

export const isPostLink = (url) => STATUS_LINK.test(String(url || '').trim())

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

// LEARN: the teaching UCT already has about one stock, the pure half (no React, so an agent
// capability can reuse it).
//
// ⭐ NO NEW ROUTE. Three reads the app already serves, each until now reachable from one place:
//
//   GET /api/desk/articles/for-ticker/{sym}?limit=   Desk articles that covered the stock
//       (api/routers/desk.py; gate `require_article_reader`: 401 signed out, 402 unpaid, unless
//       DESK_ARTICLES_ACCESS opens it). The research page's "in Sunday Scans" card reads it.
//       { ticker, total, articles: [{ id, title, display_title, slug, published_at (unix seconds),
//         reading_minutes, publication_name, ... }] }, newest first. `total` is the whole count;
//         the list is capped at `limit`.
//   GET /api/education/tickers/{sym}/mentions        Desk video moments that mention the stock
//       (api/routers/education.py, `require_paid`). The chart's Desk markers read it.
//       { mentions: [{ video_id, youtube_id, title, anchor_date, t (seconds into the video),
//         note }], as_of }, newest session first, at most 50. An unknown stock is 200 with [].
//   GET /api/modelbook/appearances/{symbol}          Model Book years the stock is in
//       (api/routers/modelbook.py, `require_paid`). The research page's Model Book tab reads it.
//       { symbol, appearances: [{ id, year, gain_pct, setup_count, thesis, ... }], as_of },
//         newest year first. An empty list is a real answer.
//
// ⛔ THE TRADER ARCHIVE IS NOT SHOWN HERE (owner ruling 2026-10-17: "what the team said" is not
// shown to members). The mentions route can ALSO carry team call and mention rows
// (api/services/wisdom/publish/adapters/desk_markers.py, merged in when
// WISDOM_DESK_MARKERS_ENABLED is on): each is stamped `source: 'wisdom'` and carries `kind`,
// `speaker`, `status` and, for an archive row, `source_detail: 'archive'`. `isDeskVideoMoment`
// keeps ONLY a plain Desk video row and fails closed: any of those marks, or no video to open,
// and the row is dropped. Nothing here counts or mentions what was dropped.
//
// THE LINKS ARE THE APP'S OWN: an article opens `/desk/article/{slug}` (research/DeskCoverage.jsx),
// a video moment opens `/desk?section=videos&v={youtube_id}&t={seconds}` (StockChart.jsx
// `deskMentionHref`), and the Model Book opens `/model-book` (it takes no year or ticker in its
// address: research/tabs/ModelBookTab.jsx).
import { fmtTime } from '../../../components/video/playerUtils'
import { etYmd } from '../../../lib/marketClock/etTime'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const LEARN_CODE = 'LEARN'
/** Articles asked for (the route allows 1 to 50; `total` still counts them all). */
export const ARTICLES_LIMIT = 20

const enc = (sym) => encodeURIComponent(String(sym ?? '').trim().toUpperCase())
export const deskArticlesUrl = (sym) => `/api/desk/articles/for-ticker/${enc(sym)}?limit=${ARTICLES_LIMIT}`
export const deskMomentsUrl = (sym) => `/api/education/tickers/${enc(sym)}/mentions`
export const modelBookUrl = (sym) => `/api/modelbook/appearances/${enc(sym)}`

/** Where each lesson opens. */
export const articleHref = (slug) => `/desk/article/${slug}`
export function momentHref(youtubeId, seconds) {
  const t = Number.isFinite(seconds) && seconds >= 0 ? `&t=${Math.round(seconds)}` : ''
  return `/desk?section=videos&v=${encodeURIComponent(youtubeId)}${t}`
}
export const MODEL_BOOK_HREF = '/model-book'
/** The Desk's own article search for a stock: where the rest of a capped list is. */
export const articleSearchHref = (sym) => `/desk?section=articles&q=${enc(sym)}`

/** This panel has no arguments: its command is the ticker and the code. */
export const learnCommandArgs = () => []
/** Pure: the command that opens this panel for a stock (`NVDA LEARN`). */
export const learnCommand = (sym, code = LEARN_CODE) => `${String(sym ?? '').trim().toUpperCase()} ${code}`.trim()

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dayOf = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v)); return m ? `${m[1]}-${m[2]}-${m[3]}` : null }

/**
 * Pure: the Desk articles answer.
 *   state  'ok' (rows may be empty: nothing on record) | 'failed' (not an articles answer)
 *   rows   [{ key, title, date, minutes, publication, href }] newest first; `date` is the Eastern
 *          calendar date it was published. An article with no slug cannot be opened and is dropped.
 *   total  how many articles covered the stock (never less than the rows)
 */
export function articlesRead(body) {
  if (!isObj(body) || !Array.isArray(body.articles)) return { state: 'failed', rows: [], total: 0 }
  const rows = []
  const seen = new Set()
  for (const a of body.articles) {
    const slug = text(a?.slug)
    const title = text(a?.display_title) || text(a?.title)
    if (!slug || !title || seen.has(slug)) continue
    seen.add(slug)
    const at = num(a.published_at)
    const minutes = num(a.reading_minutes)
    rows.push({
      key: `article-${slug}`,
      title,
      date: at !== null && at > 0 ? etYmd(at * 1000) : null,
      minutes: minutes !== null && minutes > 0 ? Math.round(minutes) : null,
      publication: text(a.publication_name) || null,
      href: articleHref(slug),
    })
  }
  const total = num(body.total)
  return { state: 'ok', rows, total: total !== null && total > rows.length ? Math.round(total) : rows.length }
}

/** The marks a team call, a team mention or an archive row carries and a Desk video row never does. */
const NOT_A_VIDEO_ROW = ['source', 'source_detail', 'kind', 'speaker', 'status', 'locator', 'call', 'archive_ticker']

/** Pure: is this mentions row a plain Desk video moment (and nothing from the trader archive)? */
export function isDeskVideoMoment(m) {
  if (!isObj(m)) return false
  if (NOT_A_VIDEO_ROW.some((k) => m[k] !== undefined && m[k] !== null && m[k] !== '')) return false
  return !!text(m.youtube_id) && m.video_id !== undefined && m.video_id !== null
}

/**
 * Pure: the Desk video moments answer.
 *   state  'ok' | 'failed'
 *   rows   [{ key, title, date, seconds, at, note, href }] as sent (newest session first, then by
 *          time in the video); `at` is the moment as a clock (`12:05`), `href` opens the video there.
 *          Only plain Desk video rows: see `isDeskVideoMoment`.
 */
export function momentsRead(body) {
  if (!isObj(body) || !Array.isArray(body.mentions)) return { state: 'failed', rows: [] }
  const rows = []
  const seen = new Set()
  for (const m of body.mentions) {
    if (!isDeskVideoMoment(m)) continue
    const yt = text(m.youtube_id)
    const raw = Number(m.t)
    const seconds = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0
    const key = `moment-${yt}-${seconds}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      key,
      title: text(m.title) || 'Desk video',
      date: dayOf(m.anchor_date),
      seconds,
      at: fmtTime(seconds),
      note: text(m.note) || null,
      href: momentHref(yt, seconds),
    })
  }
  return { state: 'ok', rows }
}

/**
 * Pure: the Model Book answer.
 *   state  'ok' | 'failed'
 *   rows   [{ key, year, gainPct, setupCount, href }] newest year first
 */
export function modelBookRead(body) {
  if (!isObj(body) || !Array.isArray(body.appearances)) return { state: 'failed', rows: [] }
  const rows = []
  const seen = new Set()
  for (const a of body.appearances) {
    const year = num(a?.year)
    if (year === null || !Number.isInteger(year) || seen.has(year)) continue
    seen.add(year)
    const setups = num(a.setup_count)
    rows.push({
      key: `modelbook-${year}`,
      year,
      gainPct: num(a.gain_pct),
      setupCount: setups !== null && setups > 0 ? Math.round(setups) : 0,
      href: MODEL_BOOK_HREF,
    })
  }
  rows.sort((a, b) => b.year - a.year)
  return { state: 'ok', rows }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Pure: what is on record, in one sentence, for the sections that answered. Each count is a
 *  number, or null for a section that did not answer (it is left out, never counted as 0). */
export function lessonsSentence(sym, { articles = null, moments = null, modelBook = null } = {}) {
  const parts = []
  if (articles !== null) parts.push(plural(articles, 'Desk article', 'Desk articles'))
  if (moments !== null) parts.push(plural(moments, 'Desk video moment', 'Desk video moments'))
  if (modelBook !== null) parts.push(plural(modelBook, 'Model Book year', 'Model Book years'))
  if (!parts.length) return ''
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `On record for ${sym}: ${list}.`
}

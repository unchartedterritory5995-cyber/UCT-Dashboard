// Stand-ins for POST /api/trade-exchange-news/day and GET /days over a synthetic
// archive, for the widget tests and the visual harness. They apply the widget's OWN
// filter rule (visibleItems) and the server's day order and cursor rules -- the real
// server's agreement with them is proven server-side
// (tests/test_trade_exchange_news_archive.py). Synthetic data only.
import { dayCmp, etDateKey, visibleItems } from '../../pages/charts/widgets/tradeExchangeNewsModel'

const keyOf = (it) => [it.received_at_ms || 0, it.seq]
const before = (it, cur) => dayCmp(it, { received_at_ms: cur[0], seq: cur[1] }) > 0      // older than the cursor
const after = (it, cur) => dayCmp(it, { received_at_ms: cur[0], seq: cur[1] }) < 0       // newer than the cursor

/** `archive` any order; `body` the widget's day request. `atMs(date, 'HH:MM')` maps a
 *  time jump to an instant (tests pass one; default: the archive's own ET reading). */
export function fakeNewsDay(archive, body = {}, { epoch = 'e', today = null, atMs = null } = {}) {
  const date = body.date || today || etDateKey(Date.now())
  const day = archive.filter((it) => etDateKey(it.received_at_ms) === date)
  const shownRule = { query: body.query || '', linkedSym: body.symbol || null,
    watchSet: Array.isArray(body.symbols) ? new Set(body.symbols) : null,
    categories: body.categories || null, hidePlaceholders: !!body.hide_placeholders }
  const match = visibleItems(day, shownRule).sort(dayCmp)
  const limit = Math.max(1, Math.min(200, body.limit || 60))
  let lo = 0
  let hi
  let atMatch = null
  if (body.cursor && body.direction === 'newer') {
    hi = match.findIndex((it) => !after(it, body.cursor))
    if (hi < 0) hi = match.length
    lo = Math.max(0, hi - limit)
  } else {
    if (body.cursor) {
      lo = match.findIndex((it) => before(it, body.cursor))
      if (lo < 0) lo = match.length
    } else if (body.at) {
      const at = atMs ? atMs(date, body.at) : null
      lo = at == null ? 0 : match.findIndex((it) => (it.received_at_ms || 0) <= at)
      atMatch = 'at_or_before'
      if (lo < 0) { lo = Math.max(0, match.length - limit); atMatch = 'after' }
    }
    hi = Math.min(match.length, lo + limit)
  }
  const items = match.slice(lo, hi)
  return {
    date, epoch, total: match.length, day_total: day.length, at_match: atMatch,
    hidden_placeholders: body.hide_placeholders ? day.filter((it) => it.placeholder === 'graphic').length : 0,
    has_newer: lo > 0, has_older: hi < match.length,
    newer_cursor: items.length ? keyOf(items[0]) : null, older_cursor: items.length ? keyOf(items.at(-1)) : null,
    top: archive.reduce((m, it) => Math.max(m, it.seq), 0), items,
    coverage: { complete: true, gaps: [] }, tickers_provisional: true,
  }
}

/** GET /days over the same archive. */
export function fakeNewsDays(archive, { today = null, firstDayPartial = false } = {}) {
  const counts = new Map()
  for (const it of archive) {
    const k = etDateKey(it.received_at_ms)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const days = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count }))
  return { today: today || etDateKey(Date.now()), first_day: days[0]?.date || null, first_day_partial: firstDayPartial,
    days, oldest_ms: Math.min(...archive.map((it) => it.received_at_ms)), retention: { permanent: true } }
}

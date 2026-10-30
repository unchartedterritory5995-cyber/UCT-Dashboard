// A stand-in for POST /api/trade-exchange-news/pages over a synthetic archive, for
// the widget tests and the visual harness. It applies the widget's OWN filter rule
// (visibleItems) -- the real server's agreement with that rule is proven on the
// server side (tests/test_trade_exchange_news_pages.py). Synthetic data only.
import { visibleItems } from '../../pages/charts/widgets/tradeExchangeNewsModel'

/** `archive` seq ascending; `body` the widget's page request. */
export function fakeNewsPage(archive, body = {}, { epoch = 'e' } = {}) {
  const last = archive.length ? archive[archive.length - 1].seq : 0
  const reset = !!body.epoch && body.epoch !== epoch
  const top = !reset && body.top > 0 && body.top <= last ? body.top : last
  const size = Math.max(1, Math.min(100, body.size || 25))
  const snap = archive.filter((it) => it.seq <= top)
  const matches = visibleItems(snap, {
    query: body.query || '', linkedSym: body.symbol || null,
    watchSet: Array.isArray(body.symbols) ? new Set(body.symbols) : null,
    categories: body.categories || null, hidePlaceholders: !!body.hide_placeholders,
  })
  const pages = Math.max(1, Math.ceil(matches.length / size))
  const page = Math.max(1, Math.min(pages, body.page || 1))
  return {
    epoch, reset, top, page, size, pages, total: matches.length, archive_total: snap.length,
    hidden_placeholders: body.hide_placeholders ? snap.filter((it) => it.placeholder === 'graphic').length : 0,
    items: matches.slice((page - 1) * size, page * size),
    first_seq: archive[0]?.seq || 0, last_seq: last, oldest_ms: archive[0]?.received_at_ms ?? null,
    coverage: { complete: true, gaps: [] }, tickers_provisional: true,
  }
}

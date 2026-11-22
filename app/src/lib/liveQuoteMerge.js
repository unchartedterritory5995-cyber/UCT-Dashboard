// app/src/lib/liveQuoteMerge.js
//
// How one symbol's live quote is put together from the two feeds (moved out of `hooks/useRealtimePrices.js`,
// 2026-11-20, so the hook and the chart's per-symbol read, `lib/liveQuote.js`, share it: one merge, never two).

import { extSessionStartSec } from './extSession'

// Set merged.change_pct / merged.change so the day % TICKS with every trade.
//
// The day % drives the header day-change, the chart legend %, the watchlist %, and
// the theme %. We deliberately do NOT trust the SSE stream's own change_pct: its
// prev_close isn't seeded, so it flashes 0.00% (that's why % used to be routed
// straight from the server). But the REST feed is 15s-cached, so sourcing % ONLY
// from it pinned every % to a 15s cadence — the "not updating / updating slowly"
// regression. Instead we recompute the REGULAR-SESSION % on the client from the
// live streamed price + the OFFICIAL prev close (REST): it ticks with every trade
// AND can't flash 0 (the streamed PRICE is a real trade; a bad/≤0 price or missing
// prev close falls back to the server %). Extended hours keeps REST's frozen
// regular-session % — a post-market print must not move the day % — detected via
// ext_session (null only during regular trading).
// The stream's OWN session fields are UNTRUSTED: its change/change_pct are
// computed against an unseeded baseline (measured 2026-08-21: ORCL streamed
// +0.20% while the true day move was +3.78%), and a null field in a stream
// entry would clobber a real REST value in the spread. price / volume /
// timestamps are the stream's only trusted contribution; everything
// session-scoped (prev_close, change, change_pct, day_*, ext_*) belongs to
// REST or to _applyLiveChange's recompute. Without this strip, any moment
// REST is absent (first render, hidden-tab wake, REST blip) painted the
// stream's garbage % on every row.
export function _streamSafe(streamed) {
  if (!streamed) return streamed
  const {
    change_pct: _c1, change: _c2, prev_close: _c3,
    day_open: _c4, day_high: _c5, day_low: _c6, day_close: _c7,
    ext_price: _c8, ext_session: _c9,
    ...safe
  } = streamed
  return safe
}

export function _applyLiveChange(merged, rest) {
  if (!rest) return
  const px = Number(merged.price)
  const prevClose = Number(rest.prev_close)
  if (rest.ext_session == null && px > 0 && prevClose > 0) {
    merged.change_pct = ((px - prevClose) / prevClose) * 100
    merged.change = px - prevClose
  } else {
    if (rest.change_pct != null) merged.change_pct = rest.change_pct
    if (rest.change != null) merged.change = rest.change
  }
}

// Freshen `ext_price` — the extended-hours last trade — from the stream.
//
// WHY: ext_price/ext_session are produced ONLY by the 15s-cached REST snapshot
// (`lastTrade.p`); realtime_stream's _STREAM_FIELDS strips them, so nothing on the
// SSE path could ever advance them. The chart's orange "Pre"/"Post" axis chip reads
// ext_price, so pre-market it crawled at 15s while the watchlist's Price cell — fed
// by the same Massive tick feed at ~1s — ran ahead of it. Same feed, same instant,
// two different numbers on screen.
//
// PROVENANCE IS THE WHOLE POINT of doing this here rather than server-side: only
// this merge knows whether `price` came from the STREAM (a real extended-hours
// print) or from REST's fallback chain. That chain is `day.c || lastTrade.p ||
// prevDay.c`, and post-market `day.c` is the REGULAR-session close — promoting that
// to ext_price would paint the 4pm close as the live post-market price. So we only
// promote a STREAMED price, and only while REST says we're in an extended session.
// Exported for test: the "only a STREAMED price, only in an extended session" rule
// is the guard that stops the regular-session close being painted as a live
// post-market print, and it deserves a rail of its own.
export function _applyLiveExtPrice(merged, rest, streamed) {
  if (!rest || rest.ext_session == null) return
  const px = Number(streamed?.price)
  if (px > 0) {
    merged.ext_price = px
    // ext_fresh (owner 11-14): a streamed trade received after THIS extended session began
    // is a print of it, so the Watchlist's EXT mode starts moving on the first live trade.
    const start = extSessionStartSec(rest.market_session)
    const at = Number(streamed?.updated_at)
    if (start != null && Number.isFinite(at) && at >= start) merged.ext_fresh = true
  }
}

/**
 * ONE symbol's quote: the 2 s REST poll's entry (`rest`: day OHLC, prev close, volume, session) merged with the
 * stream's (`streamed`: price, change, time), exactly as every reader of this hook gets it. null when neither has
 * a price or a day open. Shared with `lib/liveQuote.js` (the chart's per-symbol read), so the two can never drift.
 */
export function mergeLiveQuote(rest, streamed) {
  const merged = { ...rest, ..._streamSafe(streamed) }
  _applyLiveChange(merged, rest)
  _applyLiveExtPrice(merged, rest, streamed)
  return (merged.price != null || merged.day_open != null) ? merged : null
}

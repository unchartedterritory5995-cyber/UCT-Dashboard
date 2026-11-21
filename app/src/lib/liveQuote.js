// app/src/lib/liveQuote.js
//
// ⭐ ONE SYMBOL'S LIVE QUOTE, READ WHEN IT IS NEEDED, NOT RENDERED ON EVERY TICK (2026-11-20).
//
// `useRealtimePrices` hands its host a fresh `prices` object whenever the shared price stream publishes (about
// once a second, for ANY symbol any component in the tab streams: a watchlist's tick re-rendered every chart) and
// whenever the 2 s REST poll lands. On a chart that meant a full StockChart render per publish, measured on the
// owner's layout (state probe, 2026-11-20): 19 renders per typed switch after it settled, 6-10 more in its first
// 1.5 s, plus ~4 from the poll.
//
// The same two stores (`priceStreamManager`, `hooks/livePriceStore`) are synchronous singletons, so a reader can
// ask for one symbol's merged quote at the moment it needs it (`readLiveQuote`), keep that symbol in the stream
// and the poll (`watchLiveQuote`), and decide for itself which changes are worth a render. The merge is the
// hook's own (`mergeLiveQuote`), so a quote read here is the object the hook would have handed out.

import * as priceStreamManager from './priceStreamManager'
import { registerTickers, subscribe as subscribeRest, getSnapshot as getRestSnapshot } from '../hooks/livePriceStore'
import { mergeLiveQuote } from './liveQuoteMerge'

const _memo = new Map()   // sym → { rest, streamed, quote }: the same entries give the same quote object
const MEMO_CAP = 64

/** `sym`'s merged quote now (null when the feed has nothing for it). Identity-stable while its entries are. */
export function readLiveQuote(sym) {
  if (!sym) return null
  const rest = getRestSnapshot()[sym]
  const streamed = priceStreamManager.getSnapshot().prices[sym]
  const m = _memo.get(sym)
  if (m && m.rest === rest && m.streamed === streamed) return m.quote
  const quote = mergeLiveQuote(rest, streamed)
  if (_memo.size >= MEMO_CAP && !m) _memo.delete(_memo.keys().next().value)
  _memo.set(sym, { rest, streamed, quote })
  return quote
}

const _setMemo = new Map()   // 'A,B' → { quotes, prices }: the same quotes give the same prices object
/** `{ [ticker]: quote }` for a sorted, comma-joined ticker list (tickers with no quote left out), identity-stable
 *  while every quote is. */
export function readLiveQuotes(sorted) {
  if (!sorted) return EMPTY_QUOTES
  const list = sorted.split(',')
  const quotes = list.map((t) => readLiveQuote(t))
  const m = _setMemo.get(sorted)
  if (m && m.quotes.every((x, i) => x === quotes[i])) return m.prices
  const prices = {}
  quotes.forEach((x, i) => { if (x) prices[list[i]] = x })
  if (_setMemo.size >= MEMO_CAP && !m) _setMemo.delete(_setMemo.keys().next().value)
  _setMemo.set(sorted, { quotes, prices })
  return prices
}
const EMPTY_QUOTES = Object.freeze({})

/** The feed's connectivity for `sym`: the stream connected, and whether `sym` has gone stale on it. */
export function readLiveFeed(sym) {
  const s = priceStreamManager.getSnapshot()
  return {
    isStreaming: !!s.connected,
    isStale: !!(sym && s.staleSymbols && s.staleSymbols.has(String(sym).toUpperCase())),
  }
}

/** Keep `tickers` in the stream and the REST poll while watched; `onChange` runs when either store publishes (for
 *  any symbol: the reader compares what it cares about). Returns the unwatch. */
export function watchLiveQuotes(tickers, onChange) {
  const list = [...new Set((tickers || []).filter(Boolean))]
  if (!list.length) return () => {}
  const unregister = registerTickers(list)
  const offRest = subscribeRest(onChange)
  const offStream = priceStreamManager.subscribe(list, onChange)
  return () => { offStream(); offRest(); unregister() }
}

/** Test seam: forget the memo. */
export function __resetLiveQuoteForTests() { _memo.clear(); _setMemo.clear() }

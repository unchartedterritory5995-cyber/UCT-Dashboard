// app/src/data/barStore/network.js — the BarStore's server I/O (P2b;
// docs/architecture/barstore.md §Network).
//
// ⭐ ONE LOOP PER SUBSCRIBED KEY, ≤1 REQUEST IN FLIGHT PER KEY (S9). Tail polls, one-shot
// `fetchOnce` (ensure / prefetch) and scroll-back windows of a key share ONE slot: a tail
// request asked while one is in flight JOINS it, a scroll-back waits for it. Every request
// has its own AbortController; stopping the last subscriber aborts it and clears the timer,
// so an unsubscribed key sends nothing more.
//
// ⭐ GEN. Every action this module dispatches carries the snapshot `gen` its request was
// issued under; the reducer drops it when the entry was invalidated (or its history moved)
// meanwhile — a request from before an invalidate can never land after it.
//
// ⭐ WHAT IS ASKED. A `since=` delta from `snapshot.deltaFrom` (the first row after the
// newest seal — `since` is exclusive server-side, so `deltaFrom - 1`) when the entry holds a
// seal and does not need a full read; otherwise a FULL read. D/W/M are never sealed (P1 §8)
// and always read whole, as today. `session=` is sent per key (#1061): the 60m keys carry
// their grid; 1–30m keys use the session their subscribers asked for (eth wins: its answer
// is judged against the wider frontier).
//
// ⭐ CADENCE — one policy, imported: utils/intradayTailPoll `nextTailPollMs` (fast catch-up
// for a tail that is behind or `tail_status: unverified`, honoring the answer's
// `retry_after`, then the 30 s cadence) with `intradayDedupMs` as the floor between two
// requests; a 503 honors Retry-After with a bounded backoff; D/W/M poll every 5 min (the
// chart's daily refresh). Paused while the document is hidden; resumed on visible.
//
// ⭐ THE GATE — the existing one: utils/prefetchBars `barsLaneRequest` (joins in-flight
// chart-lane / warm requests of the same URL, shares the warm queue's concurrency and the
// server's 503 backoff). Priorities: visible (never queued) > urgent > grid > background.
//
// ⭐ SCROLL-BACK — the "N bars before my oldest bar" window of #1116 (utils/historyPrepend):
// its `historyWindowUrl` over prefetchBars `barsBeforeUrl` (the one `to=` URL builder),
// `HISTORY_WINDOW_BARS`, and its `prependOlder` basis/seam rule — a window whose seam bar
// disagrees >2% with the oldest held bar (a split / re-basis since) is refused whole.
// Intraday only (#1116's scope); D/W/M depth comes from the full read.
//
// ⭐ THE ONE /api/bars URL BUILDER of the BarStore is `barsUrl` below (rails: one-url census
// owner). No other barStore file spells the endpoint.

import { barsLaneRequest, barsBeforeUrl } from '../../utils/prefetchBars'
import { historyWindowUrl, prependOlder, etDateOf, HISTORY_WINDOW_BARS } from '../../utils/historyPrepend'
import {
  nextTailPollMs, createTailPollState, intradayDedupMs, INTRADAY_POLL_MS, REPAIR_DEDUP_MS,
} from '../../utils/intradayTailPoll'
import { classifyIntradayTail } from '../../utils/marketSession'
import { firstPaintBarsFor, fullBarsFor, FIRST_PAINT_BARS } from '../../utils/barsBackfill'
import { barsSessionQuery } from '../../components/chart/barTime'
import { ACTION, parseKey, isIntradayTf, PERIOD_SEC } from './types'

/** The D/W/M refresh cadence (StockChart's daily `refreshInterval`). */
export const DAILY_POLL_MS = 300_000
/** Error backoff: first retry, cap. */
export const ERROR_RETRY_MS = 1500
export const ERROR_RETRY_MAX_MS = 30_000
/** A terminal `no_data` key is re-asked this rarely (a listing can start trading). */
export const NO_DATA_POLL_MS = 300_000
export const PRIORITIES = Object.freeze(['visible', 'urgent', 'grid', 'background'])

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** Bars to ask for: the chart's first-paint count, or the depth a caller ensured. */
export function barsCountFor(key, { depth = 0, session = 'rth' } = {}) {
  const p = parseKey(key)
  if (!p) return FIRST_PAINT_BARS
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  const base = isIntradayTf(p.tf) ? firstPaintBarsFor(p.tf, eth) : FIRST_PAINT_BARS
  const want = Math.max(base, Math.floor(Number(depth) || 0))
  return Math.min(want, fullBarsFor(p.tf) || want)
}

/**
 * Is a since= delta from `deltaFrom` still smaller than the full read it replaces? A seal
 * restored from a copy days old would otherwise ask the server for every bucket since then;
 * past the full read's own bar count (wall-clock buckets — an over-estimate across nights,
 * so the cut errs toward the bounded full read) the full read is asked instead.
 */
export function deltaWithinBudget(tf, deltaFrom, nowMs, bars) {
  const period = PERIOD_SEC[String(tf)]
  if (!period || !finite(deltaFrom)) return false
  return (nowMs / 1000 - deltaFrom) / period <= bars
}

/** THE BarStore /api/bars URL. `session` applies to intraday; a 60m key carries its own. */
export function barsUrl(key, { bars, since = null, to = null, session = 'rth' } = {}) {
  const p = parseKey(key)
  if (!p) return null
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  const sess = isIntradayTf(p.tf) ? barsSessionQuery(p.tf, eth) : ''
  const toDate = to ?? (p.window ? etDateOf(p.window.to) : null)
  let u = `/api/bars/${encodeURIComponent(p.sym)}?tf=${p.tf}&bars=${bars ?? barsCountFor(key, { session })}${sess}`
  if (since != null) u += `&since=${since}`
  if (toDate) u += `&to=${encodeURIComponent(toDate)}`
  return u
}

/** The left (older) window ending at the ET date of `oldestT` (#1116's builder). */
export function historyUrl(key, oldestT, { bars = HISTORY_WINDOW_BARS, session = 'rth' } = {}) {
  const p = parseKey(key)
  if (!p || !isIntradayTf(p.tf) || p.window) return null
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  return historyWindowUrl(barsBeforeUrl, p.sym, p.tf, oldestT, barsSessionQuery(p.tf, eth), bars)
}

const _defaultHidden = () => typeof document !== 'undefined' && !!document.hidden
const _defaultOnVisible = (cb) => {
  if (typeof document === 'undefined') return () => {}
  const h = () => { if (!document.hidden) cb() }
  document.addEventListener('visibilitychange', h)
  return () => document.removeEventListener('visibilitychange', h)
}
const _isAbort = (e) => e?.name === 'AbortError'

/**
 * @param {object} o
 * @param {ReturnType<import('./registry').createRegistry>} o.registry
 * @param {(url:string, opts:{priority:string, signal:AbortSignal}) => Promise<object>} [o.request]
 */
export function createNetwork({
  registry, request = barsLaneRequest,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
  now = () => Date.now(), isHidden = _defaultHidden, onVisible = _defaultOnVisible,
  dailyPollMs = DAILY_POLL_MS,
} = {}) {
  /** key → per-key slot + loop state */
  const keys = new Map()
  let requests = 0

  function _rec(key) {
    let r = keys.get(key)
    if (!r) {
      r = {
        key, refs: 0, sessions: new Map(), priority: 'background', depth: 0,
        inflight: null,           // { ac, kind, promise }
        queue: [],                // pending scroll-back jobs
        timer: null, paused: false, lastStart: -Infinity, errors: 0,
        pollSt: createTailPollState(),
      }
      keys.set(key, r)
    }
    return r
  }
  const _session = (r) => ([...r.sessions.keys()].includes('eth') ? 'eth' : 'rth')

  // ── one request ───────────────────────────────────────────────────────────
  function _tailJob(r, priority) {
    const s = registry.getSnapshot(r.key)
    const p = parseKey(r.key)
    const gen = s.gen
    const session = _session(r)
    const bars = barsCountFor(r.key, { depth: Math.max(r.depth, s.depthFloor || 0), session })
    const delta = isIntradayTf(p.tf) && !p.window && !s.needsFull && s.deltaFrom != null && s.sealedSpans.length > 0 &&
      deltaWithinBudget(p.tf, s.deltaFrom, now(), bars)
    const url = barsUrl(r.key, { bars, since: delta ? s.deltaFrom - 1 : null, session })
    return _send(r, 'tail', url, priority, async (json) => {
      if (json?.no_data) {
        registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: 'no_data', terminal: true } })
        return { noData: true }
      }
      if (!json || !Array.isArray(json.bars) || json.error) {
        registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: json?.error || 'bad_answer' } })
        return { error: true, retryAfterSec: json?.retry_after ?? null }
      }
      const type = delta ? ACTION.REST_DELTA : ACTION.REST_FULL
      registry.dispatch(r.key, { type, key: r.key, gen, payload: delta ? { ...json, since: s.deltaFrom } : json })
      return { ok: true, delta, retryAfterSec: json.retry_after ?? null }
    }, gen)
  }

  function _scrollJob(r, opts) {
    const s = registry.getSnapshot(r.key)
    const oldest = s.bars.length ? s.bars[0].t : s.developing?.t
    if (!finite(oldest)) return Promise.resolve({ empty: true })
    const gen = s.gen
    const url = historyUrl(r.key, oldest, { bars: opts.bars, session: _session(r) })
    if (!url) return Promise.resolve({ empty: true })
    return _send(r, 'scroll', url, opts.priority || 'urgent', async (json) => {
      if (!json || !Array.isArray(json.bars)) return { error: true }
      const before = registry.getSnapshot(r.key)
      // #1116's seam rule: nothing older, or a window on another basis ⇒ refused whole.
      if (prependOlder(before.bars, json.bars) === before.bars) return { ok: true, added: 0, refused: true }
      const after = registry.dispatch(r.key, { type: ACTION.SCROLL_BACK, key: r.key, gen, payload: json })
      return { ok: true, added: after.depth - before.depth }
    }, gen)
  }

  function _send(r, kind, url, priority, onJson) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    r.lastStart = now()
    requests++
    const promise = (async () => {
      let json
      try {
        json = await request(url, { priority, signal: ac?.signal ?? null })
      } catch (e) {
        if (_isAbort(e) || ac?.signal.aborted) return { aborted: true }
        const gen = registry.getSnapshot(r.key).gen
        if (kind === 'tail') {
          registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: e?.warming ? 'warming' : String(e?.status || 'network') } })
        }
        return { error: true, retryAfterMs: e?.retryAfterMs ?? null }
      }
      if (ac?.signal.aborted) return { aborted: true }   // a joined request outlived our abort
      return onJson(json)
    })()
    r.inflight = { ac, kind, promise }
    promise.finally(() => {
      if (r.inflight?.promise === promise) r.inflight = null
      _drain(r)
    })
    return promise
  }

  /** Run the next queued job once the slot is free. */
  function _drain(r) {
    if (r.inflight || !r.queue.length) return
    const job = r.queue.shift()
    job.run().then(job.resolve, job.resolve)
  }

  /** A tail request for `r` — joins the one in flight. */
  function _tail(r, priority = r.priority) {
    if (r.inflight?.kind === 'tail') return r.inflight.promise
    if (r.inflight) {
      return new Promise((resolve) => { r.queue.push({ run: () => _tailJob(r, priority), resolve }) })
    }
    return _tailJob(r, priority)
  }

  // ── the loop ──────────────────────────────────────────────────────────────
  function _schedule(r, ms) {
    if (r.timer != null) clearTimer(r.timer)
    r.timer = setTimer(() => { r.timer = null; _tick(r) }, Math.max(0, ms))
  }

  async function _tick(r) {
    if (r.refs <= 0 || keys.get(r.key) !== r) return
    if (isHidden()) { r.paused = true; return }
    const res = await _tail(r)
    if (r.refs <= 0 || keys.get(r.key) !== r || res?.aborted) return
    const ms = _nextDelay(r, res)
    if (Number.isFinite(ms)) _schedule(r, ms)   // a windowed (replay) key is read once
  }

  function _nextDelay(r, res) {
    const s = registry.getSnapshot(r.key)
    const p = parseKey(r.key)
    if (res?.noData) return NO_DATA_POLL_MS
    if (res?.error) {
      r.errors++
      const backoff = Math.min(ERROR_RETRY_MAX_MS, ERROR_RETRY_MS * 2 ** Math.min(r.errors - 1, 8))
      const ra = finite(res.retryAfterMs) ? res.retryAfterMs : (Number(res.retryAfterSec) > 0 ? Number(res.retryAfterSec) * 1000 : 0)
      return Math.max(backoff, Math.min(ra, ERROR_RETRY_MAX_MS))
    }
    r.errors = 0
    // A delta that found a new history needs the full read NOW (bounded: needsFull clears on it).
    if (res?.delta && s.needsFull) return 0
    if (!isIntradayTf(p.tf) || p.window) return p.window ? Infinity : dailyPollMs
    const tailT = s.developing ? s.developing.t : (s.bars.length ? s.bars[s.bars.length - 1].t : null)
    const ms = nextTailPollMs(r.pollSt, r.key, { tailT, tf: p.tf, tailStatus: s.tailStatus, retryAfterSec: res?.retryAfterSec ?? null })
    const floor = intradayDedupMs({ tailClass: tailT ? classifyIntradayTail(tailT, p.tf) : null, tailStatus: s.tailStatus })
    return Math.max(ms, Math.min(floor, INTRADAY_POLL_MS))
  }

  const offVisible = onVisible(() => {
    for (const r of keys.values()) if (r.paused && r.refs > 0) { r.paused = false; _schedule(r, 0) }
  })

  const _gc = (r) => { if (r.refs <= 0 && !r.inflight && !r.queue.length && keys.get(r.key) === r) keys.delete(r.key) }

  const api = {
    /** Start (refcount) the loop for `key`. First start requests immediately. */
    start(key, { session = 'rth', priority = 'visible', depth = 0 } = {}) {
      const r = _rec(key)
      r.refs++
      r.sessions.set(session, (r.sessions.get(session) || 0) + 1)
      r.priority = _best(r.priority, priority)
      r.depth = Math.max(r.depth, depth || 0)
      if (r.refs === 1) _schedule(r, 0)
      let done = false
      return () => {
        if (done) return
        done = true
        const n = (r.sessions.get(session) || 1) - 1
        if (n > 0) r.sessions.set(session, n); else r.sessions.delete(session)
        api.stop(key)
      }
    },
    /** Drop one ref; the last one aborts the request in flight and clears the timer. */
    stop(key) {
      const r = keys.get(key)
      if (!r) return
      if (--r.refs > 0) return
      if (r.timer != null) { clearTimer(r.timer); r.timer = null }
      if (r.inflight) { r.inflight.ac?.abort(); r.inflight = null }
      for (const j of r.queue.splice(0)) j.resolve({ aborted: true })
      keys.delete(key)
    },
    setPriority(key, priority) { const r = keys.get(key); if (r) r.priority = priority },
    /** Poll `key` now. `abort`: drop the request in flight first (invalidate). */
    kick(key, { abort = false } = {}) {
      const r = keys.get(key)
      if (!r || r.refs <= 0) return
      if (abort && r.inflight) { r.inflight.ac?.abort(); r.inflight = null }   // its answer is dropped
      // An explicit kick (stream reconnect, invalidate) still never sends two requests
      // inside the repair dedupe window — unless it aborted the one in flight.
      _schedule(r, abort ? 0 : Math.max(0, REPAIR_DEDUP_MS - (now() - r.lastStart)))
    },
    /** One request for `key` (ensure / prefetch), sharing the key's single slot. */
    fetchOnce(key, { priority = 'urgent', depth = 0, session = 'rth' } = {}) {
      const r = _rec(key)
      r.depth = Math.max(r.depth, depth || 0)
      if (!r.sessions.size) r.sessions.set(session, 0)
      const out = _tail(r, priority)
      out.finally(() => _gc(r))
      return out
    },
    /** Prepend one older window. Serialized behind the key's tail request. */
    scrollBack(key, { bars = HISTORY_WINDOW_BARS, priority = 'urgent' } = {}) {
      const r = _rec(key)
      const run = () => _scrollJob(r, { bars, priority })
      const out = r.inflight ? new Promise((resolve) => { r.queue.push({ run, resolve }) }) : run()
      out.finally(() => _gc(r))
      return out
    },
    /** Requests in flight for `key` (0|1), or across all keys. */
    inflight(key) {
      if (key != null) return keys.get(key)?.inflight ? 1 : 0
      let n = 0
      for (const r of keys.values()) if (r.inflight) n++
      return n
    },
    stats() { return { keys: keys.size, requests, inflight: api.inflight() } },
    dispose() {
      offVisible?.()
      for (const k of [...keys.keys()]) { const r = keys.get(k); r.refs = 1; api.stop(k) }
    },
  }
  return api
}

const _RANK = { visible: 0, urgent: 1, grid: 2, background: 3 }
function _best(a, b) { return (_RANK[b] ?? 3) < (_RANK[a] ?? 3) ? b : a }

export { etDateOf, HISTORY_WINDOW_BARS }

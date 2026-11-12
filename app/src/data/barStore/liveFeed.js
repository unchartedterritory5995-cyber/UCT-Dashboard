// app/src/data/barStore/liveFeed.js — the BarStore's own live subscriptions (P2b;
// docs/architecture/barstore.md §Live feed). Turns feed events into reducer actions; it never
// merges a bar itself (the reducer is the only merge path).
//
// ⭐ PUSH FIRST. Native intraday keys subscribe to lib/barsStreamManager (`?v=2`): every
// frame becomes `push-bar`, a `final: true` frame `push-final` — including the v2 correction
// whose `t` is OLDER than the developing bar (the reducer replaces that closed row in place
// by rev, never a sealed one). The pool already drops non-final stragglers per key.
//
// ⭐ TICKS ONLY AS A FALLBACK (S6). lib/realtimeCandle (the trade feed) — or, when it has
// not ticked for this symbol recently, the live-price stream (lib/priceStreamManager, the
// app's `livePrices`) — becomes `tick-fallback`, and ONLY while the push feed is not
// delivering for this key (`barsStreamManager.getStatus().delivering`, with the pool's own
// hysteresis). The same flag rides on the dispatch as `ctx.streamLive`, so the reducer
// enforces it too. Exactly one tick source feeds a key at a time (never two feeds racing
// the developing bar — audit D2). Sanity is the reducer's (`liveTickBaseline`, keyed to the
// symbol: a store never sees another symbol's closes).
//
// ⭐ D/W/M FOLD THE 1m STREAM (Writer E moves here). The store keeps the server's developing
// period bar as the BASE (authoritative) and folds RTH 1m frames into it: open = the base's,
// high/low = the union, close = the newest minute's.
// ⛔ VOLUME IS NEVER COUNTED TWICE. The contract says nothing about how far the base's volume
// reaches: `developing.rev` is the series' last WRITE (hours old on a daily series) or null
// when not store-backed — it is not a read time. The only sound anchor the client has is
// when the answer ARRIVED: the server read it no later than that. So only minutes that
// START after the arrival minute plus one minute of clock-skew margin
// (`FOLD_SKEW_MARGIN_S`) add volume; every earlier minute contributes H/L/C only. The
// result can only under-count (v ≤ the true sum) until the next REST answer settles it.
// The folded bar goes to the reducer as a `push-bar` for the period (rev-gated, I1–I3).

import * as barsStream from '../../lib/barsStreamManager'
import * as candleFeed from '../../lib/realtimeCandle'
import * as priceStream from '../../lib/priceStreamManager'
import { realtimeBarsEnabled } from '../../lib/realtimeBarsGate'
import { isRthBar, computeBarTime } from '../../components/chart/barTime'
import { ACTION, parseKey, isDateTf, isIntradayTf, DEV_SRC, dateLabelToUnix } from './types'

/** Client↔exchange clock margin for the fold's volume anchor (one minute). */
export const FOLD_SKEW_MARGIN_S = 60

/** The first minute start whose volume may be added to a base that arrived at `arrivedMs`. */
export function foldAnchor(arrivedMs) {
  return Math.floor(arrivedMs / 60000) * 60 + 60 + FOLD_SKEW_MARGIN_S
}

/** The trade feed counts as "ticking" for a symbol within this window; else livePrices. */
export const CANDLE_ACTIVE_MS = 10_000

const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const tMs = (t) => (t > 1e11 ? t : t * 1000)

/** The ET trading date of a ms instant (the day the live day-volume belongs to). */
function etDay(ms) { return computeBarTime('D', Math.floor(ms / 1000)) }

/** Period (`D`/`W`/`M`) label-unix of a unix second. */
function periodOf(tf, sec) { return dateLabelToUnix(computeBarTime(tf, sec)) }

/**
 * Pure D/W/M fold step. `st` = {base, anchor, minutes: Map<t, {h,l,c,v}>, rev}; `anchor` =
 * foldAnchor(arrival of the base). Returns the frame to dispatch (or null); mutates `st`.
 * @param {object} st
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number}} m   a 1m bar (unix s)
 * @param {string} tf
 */
export function foldMinute(st, m, tf, rev) {
  if (!st.base || !m || !finite(m.t) || !finite(m.c)) return null
  if (!isRthBar(m.t)) return null                       // the period bar is RTH (TradingView)
  if (periodOf(tf, m.t) !== st.base.t) return null      // another period: the next REST opens it
  const anchor = finite(st.anchor) ? st.anchor : Infinity   // no anchor ⇒ never add volume
  // A minute that ended before the base arrived adds nothing the base lacks except, at
  // most, an extreme the cache missed — H/L only; its close is older than the base's.
  const closeFrom = anchor - 60 - FOLD_SKEW_MARGIN_S
  st.minutes.set(m.t, { h: m.h, l: m.l, c: m.c, v: m.v, counted: m.t >= anchor, closes: m.t >= closeFrom })
  let h = st.base.h, l = st.base.l, v = st.base.v, c = st.base.c, lastT = -Infinity
  for (const [t, x] of st.minutes) {
    if (finite(x.h)) h = Math.max(h, x.h)
    if (finite(x.l)) l = Math.min(l, x.l)
    if (x.counted && finite(x.v)) v += x.v
    if (x.closes && t > lastT) { lastT = t; c = x.c }
  }
  st.rev = Math.max(st.rev ?? -Infinity, finite(rev) ? rev : -Infinity)
  return { t_s: st.base.t, bar: { t: st.base.t * 1000, o: st.base.o, h: Math.max(h, c), l: Math.min(l, c), c, v, final: false }, rev: finite(st.rev) ? st.rev : null }
}

/**
 * ⭐ THE PERIOD BAR'S VOLUME FROM THE LIVE DAY-VOLUME SOURCE (P3-S2b) — when push is not the
 * live source (prod: VITE_REALTIME_BARS=0), the D/W/M developing bar's volume comes from the
 * live-price feed's cumulative DAY volume, the source the legacy chart overlaid. One owner:
 *   D    the day's volume IS the bar's: max(base.v, dayVol);
 *   W/M  base.v + the day volume added SINCE the base arrived (dayVol − dayVol at arrival) —
 *        the base already holds the earlier part, so nothing is counted twice; an unknown
 *        arrival reading, or another trading day than the base's arrival, adds nothing (v ≤ truth,
 *        settled by the next REST answer, as the 1m fold).
 * Pure; `st` = the fold state ({base, dayVol0, day0}). Returns the volume or null.
 */
export function periodTickVolume(st, tf, dayVol, day) {
  if (!st?.base || !finite(dayVol) || dayVol <= 0) return null
  const bv = finite(st.base.v) ? st.base.v : 0
  if (tf === 'D') return Math.max(bv, dayVol)
  if (!finite(st.dayVol0) || st.day0 !== day) return null
  return bv + Math.max(0, dayVol - st.dayVol0)
}

/**
 * @param {object} o
 * @param {ReturnType<import('./registry').createRegistry>} o.registry
 * @param {object} [o.stream]  barsStreamManager-shaped ({subscribe, getStatus})
 * @param {object} [o.candle]  realtimeCandle-shaped ({subscribe, getCandle, getLastTickAt})
 * @param {object} [o.prices]  priceStreamManager-shaped ({subscribe, getSnapshot})
 * @param {(key:string, lastBarT:number|null) => void} [o.onReconnect]  gap-backfill hook (network.kick)
 * @param {() => boolean} [o.pushEnabled]  the push feed build gate (lib/realtimeBarsGate, the
 *   ONE owner legacy Writer B's useRealtimeBars reads). Off ⇒ no stream subscription and the push
 *   feed never counts as delivering, so the tick fallback is the live source (as legacy).
 */
export function createLiveFeed({
  registry, stream = barsStream, candle = candleFeed, prices = priceStream,
  onReconnect = null, now = () => Date.now(), pushEnabled = realtimeBarsEnabled,
} = {}) {
  const attached = new Map()   // key → { refs, off: Function[], fold? }

  function streamTf(p) { return isDateTf(p.tf) ? '1' : p.tf }
  function streamSession(p, session) { return p.session || session || 'rth' }

  /** Is the push feed delivering for this key? (D/W/M: the 1m stream it folds.) */
  function isStreamLive(key, session) {
    const p = parseKey(key)
    if (!p || !stream?.getStatus || !pushEnabled()) return false
    try { return !!stream.getStatus(p.sym, streamTf(p), streamSession(p, session))?.delivering } catch { return false }
  }

  function _dispatchFrame(key, data) {
    const final = data?.final === true || data?.bar?.final === true
    registry.dispatch(key, { type: final ? ACTION.PUSH_FINAL : ACTION.PUSH_BAR, key, event: data })
  }

  /** The live-price feed's cumulative day volume for `sym` (or null). */
  function _dayVol(sym) {
    try { const v = Number(prices?.getSnapshot?.()?.prices?.[sym]?.volume); return finite(v) && v > 0 ? v : null } catch { return null }
  }

  function _dispatchTick(key, session, price, tsMs, a = null) {
    const live = isStreamLive(key, session)
    if (live || !finite(price) || !finite(tsMs)) return   // S6: push owns the developing bar
    const p = parseKey(key)
    const event = { price, ts: tsMs }
    if (p && isDateTf(p.tf)) {
      // The period bar is RTH (TradingView) — the same rule as the 1m fold (foldMinute).
      if (!isRthBar(Math.floor(tsMs / 1000))) return
      const v = periodTickVolume(a?.fold, p.tf, _dayVol(p.sym), etDay(tsMs))
      if (v != null) event.v = v
    }
    registry.dispatch(key, { type: ACTION.TICK_FALLBACK, key, event }, { streamLive: live })
  }

  function _attach(key, session) {
    const p = parseKey(key)
    const off = []
    const a = { refs: 0, off, fold: null }
    if (!p || p.window) return a   // a replay slice has no live edge
    const sTf = streamTf(p)
    const sSess = streamSession(p, session)

    // ⭐ THE D/W/M FOLD BASE — one owner for BOTH live sources (the push 1m fold and the tick
    // fallback's volume): the SERVER's developing period bar; anchor = its arrival (P3-S2b: tracked
    // whether or not push is on, so the tick fallback folds the same period bar).
    if (isDateTf(p.tf)) {
      a.fold = { base: null, anchor: null, minutes: new Map(), rev: null, dayVol0: null, day0: null }
      const rebase = (d) => {
        a.fold.base = d; a.fold.anchor = foldAnchor(now()); a.fold.minutes = new Map()
        a.fold.dayVol0 = _dayVol(p.sym); a.fold.day0 = etDay(now())
      }
      off.push(registry.subscribe(key, (s) => {
        const d = s.developing
        // (a bar the tick fallback touched is still `src: server` but no longer the server's values)
        if (d && d.src === DEV_SRC.SERVER && !d.ticked && d !== a.fold.base) rebase(d)
        else if (!d) { a.fold.base = null; a.fold.minutes = new Map() }
      }))
      const d0 = registry.getSnapshot(key).developing
      if (d0 && d0.src === DEV_SRC.SERVER) rebase(d0)
    }
    // ⛔ THE PUSH FEED IS DARK UNLESS ITS BUILD GATE IS ON (barsStreamManager does not gate itself).
    if (pushEnabled() && (isIntradayTf(p.tf) || isDateTf(p.tf))) {
      off.push(stream.subscribe(p.sym, sTf, {
        session: sSess,
        onBar: (data) => {
          if (!isDateTf(p.tf)) { _dispatchFrame(key, data); return }
          const b = data?.bar
          if (!b) return
          const t = finite(data.t_s) ? data.t_s : Math.floor(tMs(b.t) / 1000)
          const frame = foldMinute(a.fold, { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }, p.tf, data.rev)
          if (frame) registry.dispatch(key, { type: ACTION.PUSH_BAR, key, event: { sym: p.sym, ...frame } })
        },
        onReconnect: (lastBarT) => { try { onReconnect?.(key, lastBarT) } catch { /* never break the pool */ } },
      }))
    }

    // Tick fallback: one source at a time — the trade feed while it ticks, else livePrices.
    if (candle?.subscribe) {
      off.push(candle.subscribe(p.sym, () => {
        const c = candle.getCandle(p.sym, '1')
        if (!c || !finite(c.c) || !finite(c.t)) return
        const at = candle.getLastTickAt?.(p.sym) || now()
        // Trade time ≈ receipt, clamped into the candle's own minute.
        const ts = Math.min(Math.max(at, c.t * 1000), c.t * 1000 + 59_999)
        _dispatchTick(key, session, c.c, ts, a)
      }))
    }
    if (prices?.subscribe) {
      off.push(prices.subscribe([p.sym], () => {
        if (candle?.getLastTickAt && now() - (candle.getLastTickAt(p.sym) || 0) < CANDLE_ACTIVE_MS) return
        const px = prices.getSnapshot?.()?.prices?.[p.sym]?.price
        _dispatchTick(key, session, Number(px), now(), a)
      }))
    }
    return a
  }

  return {
    /** Start the live subscriptions of `key` (refcounted). Returns its detach function. */
    attach(key, { session = 'rth' } = {}) {
      let a = attached.get(key)
      if (!a) { a = _attach(key, session); attached.set(key, a) }
      a.refs++
      let done = false
      return () => {
        if (done) return
        done = true
        if (--a.refs > 0) return
        for (const f of a.off) { try { f?.() } catch { /* ignore */ } }
        attached.delete(key)
      }
    },
    isStreamLive,
    /** Feed one push frame (tests / an external consumer). */
    applyFrame: _dispatchFrame,
    stats() { return { keys: attached.size } },
  }
}

// app/src/data/barStore/liveFeed.js — the BarStore's own live subscriptions (P2b;
// docs/architecture/barstore.md §Live feed). Turns feed events into reducer actions; it never
// merges a bar itself (the reducer is the only merge path).
//
// ⭐ PUSH FIRST. Native intraday keys subscribe to lib/barsStreamManager (`?v=2`): every
// frame becomes `push-bar`, a `final: true` frame `push-final` — including the v2 correction
// whose `t` is OLDER than the developing bar (the reducer replaces that closed row in place
// by rev, never a sealed one). The pool already drops non-final stragglers per key.
//
// ⭐ TICKS ONLY AS A FALLBACK (S6). The live-price stream (lib/priceStreamManager, the app's
// `livePrices`) and lib/realtimeCandle (the Finnhub trade feed) become `tick-fallback`, and ONLY
// while the push feed is not delivering for this key (`barsStreamManager.getStatus().delivering`,
// with the pool's own hysteresis). The same flag rides on the dispatch as `ctx.streamLive`, so the reducer
// enforces it too. ONE SOURCE PER BUCKET (arbitrateTick — audit D2): the Massive-stamped live price
// is primary, the trade feed takes a bucket only while Massive is quiet, and the holder is sticky
// for the rest of the bucket until it goes quiet itself. Sanity is the reducer's (`liveTickBaseline`,
// keyed to the symbol: a store never sees another symbol's closes). Every tick carries its OWN trade
// time (liveTickTime / getLastTrade): the reducer buckets it with the one bucket rule (reducer.bucketOf).
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
import { bucketOf, tickAdmission } from './reducer'

/** Client↔exchange clock margin for the fold's volume anchor (one minute). */
export const FOLD_SKEW_MARGIN_S = 60

/** The first minute start whose volume may be added to a base that arrived at `arrivedMs`. */
export function foldAnchor(arrivedMs) {
  return Math.floor(arrivedMs / 60000) * 60 + 60 + FOLD_SKEW_MARGIN_S
}

/** A live source is QUIET once its newest trade is this far behind (by trade time) — the
 *  staleness bound of the tick-source arbitration (arbitrateTick). */
export const SOURCE_QUIET_MS = 3_000

/** The tick sources of the fallback. MASSIVE = a live-price entry stamped with the Massive trade
 *  time (`trade_ts`: the sub-second consolidated tape — primary); TRADE = the Finnhub trade feed
 *  (realtimeCandle, its own trade time); UNTIMED = a live-price entry without `trade_ts` (its
 *  `updated_at` is the server's SEND / receipt time — api/routers/stream.py, realtime_stream.py). */
export const TICK_SRC = Object.freeze({ MASSIVE: 'massive', TRADE: 'trade', UNTIMED: 'untimed' })

const _ms = (x) => (finite(x) && x > 0 ? (x > 1e11 ? x : x * 1000) : null)

/**
 * ⭐ THE TIME OF A LIVE-PRICE TICK — the one owner. `trade_ts` (ms) is the Massive TRADE time and
 * the only trusted one. Without it, `updated_at` is when the server SENT (or received) the price —
 * never a trade time — and only an entry with neither falls back to its arrival. `trusted` says
 * whether the time may decide a bucket boundary (arbitrateTick: an untimed tick never does).
 */
export function liveTickTime(entry, receiptMs) {
  const tt = _ms(Number(entry?.trade_ts))
  if (tt != null) return { ms: tt, trusted: true }
  return { ms: _ms(Number(entry?.updated_at)) ?? receiptMs, trusted: false }
}

/** The time of a live-price tick (ms): liveTickTime(entry, receiptMs).ms. */
export function liveTickTimeMs(entry, receiptMs) {
  return liveTickTime(entry, receiptMs).ms
}

/**
 * ⭐ TICK-SOURCE ARBITRATION — the ONE rule: one source per bucket, quality-ranked, sticky.
 * (D2: the trade feed owned for 3 s after each of its prints, so on a liquid name with a trickling
 * Finnhub feed one bucket alternated between two feeds — close flipped, H/L widened from the worse
 * feed's prints. 2026-11-12 stall: a trade feed whose prints lagged the wall clock held the key.)
 *   • MASSIVE is primary: its tick may always claim a bucket nobody holds.
 *   • TRADE claims a bucket only while MASSIVE is quiet: its trade is ≥ SOURCE_QUIET_MS newer than
 *     Massive's newest (never Massive's — a lagging trade feed never displaces a live tape).
 *   • STICKY: once a bucket is held, the other source takes it over only when the holder has gone
 *     quiet (≥ SOURCE_QUIET_MS behind the challenger's own trade) — so within a bucket the source
 *     can change only after the holder stopped printing, never back and forth tick by tick.
 *   • Quiet is judged in TRADE time (both feeds' own clocks), never by arrival or a wall clock — a
 *     feed that lags is simply older, whatever its ticks' arrival.
 *   • UNTIMED (send-time `updated_at`) is the last resort — a symbol outside Massive coverage with
 *     no Finnhub trades — and acts only while both trusted sources are quiet by the wall clock (the
 *     only clock it has): it folds into the developing bar's own bucket, or opens the WALL-CLOCK
 *     bucket when its own time lies in it — never a past bucket, never a future one, so it never
 *     closes a bucket early. It holds nothing (any trusted tick outranks it).
 *   • Quiet counts only ADMISSIBLE prints (reducer.tickAdmission — the caller's job): a print the
 *     reducer refuses never claims a bucket nor keeps its source live.
 *   • Never an older bucket than the developing / newest closed one (the reducer's rule too).
 * Pure. Returns {accept, arb} — `arb` = {bucket, src} the holder after this tick.
 * @param {{bucket:number, src:string}|null} arb
 * @param {{src:string, ms:number}} tick          its own time (UNTIMED: send / arrival time)
 * @param {{massive?:number|null, trade?:number|null}} last   each trusted source's newest trade (ms)
 * @param {object} state                          the key's snapshot (tf / grid / developing / bars)
 * @param {number} nowMs
 */
export function arbitrateTick(arb, tick, last, state, nowMs) {
  const no = { accept: false, arb }
  if (!tick || !finite(tick.ms) || !state) return no
  const tb = bucketOf(Math.floor(tick.ms / 1000), state)
  if (!finite(tb)) return no
  const devT = finite(state.developing?.t) ? state.developing.t : null
  const bars = state.bars
  const lastT = bars?.length ? bars[bars.length - 1].t : null
  if ((devT != null && tb < devT) || (lastT != null && tb <= lastT)) return no
  const quiet = (src, atMs) => !finite(last?.[src]) || atMs - last[src] >= SOURCE_QUIET_MS
  if (tick.src === TICK_SRC.UNTIMED) {
    if (!quiet(TICK_SRC.MASSIVE, nowMs) || !quiet(TICK_SRC.TRADE, nowMs)) return no
    const opensWall = finite(nowMs) && tb === bucketOf(Math.floor(nowMs / 1000), state) && (devT == null || tb > devT)
    if (tb !== devT && !opensWall) return no
    return { accept: true, arb }
  }
  if (tick.src !== TICK_SRC.MASSIVE && tick.src !== TICK_SRC.TRADE) return no
  const claim = { accept: true, arb: { bucket: tb, src: tick.src } }
  if (arb && arb.bucket === tb) {
    if (arb.src === tick.src) return { accept: true, arb }
    return quiet(arb.src, tick.ms) ? claim : no
  }
  if (arb && arb.bucket > tb) return no
  return tick.src === TICK_SRC.MASSIVE || quiet(TICK_SRC.MASSIVE, tick.ms) ? claim : no
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const _num = (x) => (x != null && finite(Number(x)) ? Number(x) : null)
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
 * live source (prod: VITE_REALTIME_BARS=0), the D/W/M developing bar's volume moves with the
 * live-price feed's cumulative DAY volume — but the SERVER's period bar is the definition:
 *   the server's D bar is the Massive DAILY aggregate (all of the day's trades, extended hours
 *   included); the feed's day volume is the snapshot's regular-session `day.v` during RTH and a
 *   summed-aggregates total outside it. Two different definitions — so the feed never REPLACES
 *   the server's number. It only adds what traded SINCE the server's bar arrived:
 *   v = base.v + (dayVol − dayVol at arrival), for D, W and M alike. An unknown arrival reading,
 *   or another trading day than the arrival's, adds nothing (v ≤ truth until the next REST answer,
 *   as the 1m fold); the reducer never lowers the bar's volume within its period (S4).
 * ⛔ THE FEED'S VOLUME CHANGES DEFINITION AT THE OPEN AND THE CLOSE (P3-S2c): pre-market it is a
 * summed-aggregates total, at 09:30 it becomes the regular-session `day.v` — which restarts BELOW the
 * pre-market total. A delta across that switch would freeze the bar (dayVol < dayVol0) and
 * under-count for the whole morning. So the anchor records the feed's definition (`def0`: 'rth' |
 * 'ext', from the snapshot's ext_session, else the clock) and `anchorTick` RE-ANCHORS only when the
 * definition or the day changes: dayVol0 = the reading now, vBase = the volume already shown (never
 * lower); the first RTH tick after a pre-market anchor asks the server for the bar (what traded
 * between 09:30 and that tick).
 * ⛔ WITHIN ONE DEFINITION AND DAY A FALLING READING IS NOT A NEW ANCHOR (a stale / lagging snapshot
 * dips and recovers): re-anchoring down would count the recovery twice. The fold keeps the reading's
 * HIGH-WATER MARK (`hwm`): v = vBase + (hwm − dayVol0).
 * Pure; `st` = the fold state ({base, vBase, dayVol0, hwm, day0, def0}). Returns the volume or null.
 */
export function periodTickVolume(st, tf, dayVol, day) {
  if (!st?.base || !finite(dayVol) || dayVol <= 0) return null
  if (!finite(st.dayVol0) || st.day0 !== day) return null
  const bv = finite(st.vBase) ? st.vBase : (finite(st.base.v) ? st.base.v : 0)
  const hwm = Math.max(finite(st.hwm) ? st.hwm : st.dayVol0, dayVol)
  return bv + Math.max(0, hwm - st.dayVol0)
}

/**
 * Re-anchor the fold when the feed's reading is no longer comparable with its anchor (another
 * definition / day, no anchor yet); else only raise the high-water mark. Mutates `st`. `heldV` = the period bar's
 * volume on screen. Returns {reanchored, toRth} — toRth: an anchor taken under another definition
 * (pre-market) met the first regular-session reading (the caller asks the server once).
 */
export function anchorTick(st, { dayVol, day, def, heldV }) {
  if (!st?.base || !finite(dayVol) || dayVol <= 0) return { reanchored: false, toRth: false }
  if (finite(st.dayVol0) && st.day0 === day && st.def0 === def) {
    st.hwm = Math.max(finite(st.hwm) ? st.hwm : st.dayVol0, dayVol)   // a dip never re-anchors
    return { reanchored: false, toRth: false }
  }
  const toRth = def === 'rth' && finite(st.dayVol0) && st.def0 != null && st.def0 !== 'rth'
  const bv = finite(st.vBase) ? st.vBase : (finite(st.base.v) ? st.base.v : 0)
  st.vBase = Math.max(bv, finite(heldV) ? heldV : 0)
  st.dayVol0 = dayVol; st.hwm = dayVol; st.day0 = day; st.def0 = def
  return { reanchored: true, toRth }
}

/**
 * @param {object} o
 * @param {ReturnType<import('./registry').createRegistry>} o.registry
 * @param {object} [o.stream]  barsStreamManager-shaped ({subscribe, getStatus})
 * @param {object} [o.candle]  realtimeCandle-shaped ({subscribe, getLastTrade})
 * @param {object} [o.prices]  priceStreamManager-shaped ({subscribe, getSnapshot})
 * @param {(key:string, lastBarT:number|null) => void} [o.onReconnect]  gap-backfill hook (network.kick)
 * @param {(key:string) => void} [o.onReanchor]  a D/W/M fold re-anchored into the regular session
 *   (network.kick: one read of the period bar)
 * @param {() => boolean} [o.pushEnabled]  the push feed build gate (lib/realtimeBarsGate, the
 *   ONE owner legacy Writer B's useRealtimeBars reads). Off ⇒ no stream subscription and the push
 *   feed never counts as delivering, so the tick fallback is the live source (as legacy).
 */
export function createLiveFeed({
  registry, stream = barsStream, candle = candleFeed, prices = priceStream,
  onReconnect = null, onReanchor = null, now = () => Date.now(), pushEnabled = realtimeBarsEnabled,
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

  /** The feed volume's definition right now. The server's `ext_session` is the session STRING
   *  ('pre_market' | 'post_market') during an extended session with a print, else null
   *  (api/routers/live_prices.py, massive._ext_price_for) — null cannot tell "regular" from an
   *  empty extended read, so it falls back to the clock. */
  function _feedDef(sym, tsMs) {
    try {
      const x = prices?.getSnapshot?.()?.prices?.[sym]
      if (x && x.ext_session != null && x.ext_session !== false) return 'ext'
    } catch { /* fall through to the clock */ }
    return isRthBar(Math.floor(tsMs / 1000)) ? 'rth' : 'ext'
  }

  function _dispatchTick(key, session, price, tsMs, a = null) {
    const live = isStreamLive(key, session)
    if (live || !finite(price) || !finite(tsMs)) return   // S6: push owns the developing bar
    const p = parseKey(key)
    const event = { price, ts: tsMs }
    if (p && isDateTf(p.tf)) {
      // The period bar is RTH (TradingView) — the same rule as the 1m fold (foldMinute).
      if (!isRthBar(Math.floor(tsMs / 1000))) return
      const f = a?.fold
      const sec = Math.floor(tsMs / 1000)
      // Volume only for the base's own period (a tick of a NEW period opens it at the next answer).
      if (f?.base && periodOf(p.tf, sec) === f.base.t) {
        const dayVol = _dayVol(p.sym), day = etDay(tsMs)
        const held = registry.getSnapshot(key).developing
        const r = anchorTick(f, { dayVol, day, def: _feedDef(p.sym, tsMs), heldV: held && held.t === f.base.t ? held.v : null })
        if (r.toRth) { try { onReanchor?.(key) } catch { /* never break the feed */ } }
        const v = periodTickVolume(f, p.tf, dayVol, day)
        if (v != null) event.v = v
      }
    }
    registry.dispatch(key, { type: ACTION.TICK_FALLBACK, key, event }, { streamLive: live })
  }

  function _attach(key, session) {
    const p = parseKey(key)
    const off = []
    const a = { refs: 0, off, fold: null, arb: null, live: { massive: null, trade: null } }
    if (!p || p.window) return a   // a replay slice has no live edge
    const sTf = streamTf(p)
    const sSess = streamSession(p, session)

    // ⭐ THE D/W/M FOLD BASE — one owner for BOTH live sources (the push 1m fold and the tick
    // fallback's volume): the SERVER's developing period bar; anchor = its arrival (P3-S2b: tracked
    // whether or not push is on, so the tick fallback folds the same period bar).
    if (isDateTf(p.tf)) {
      a.fold = { base: null, anchor: null, minutes: new Map(), rev: null, dayVol0: null, hwm: null, day0: null, def0: null, vBase: null }
      const rebase = (d) => {
        a.fold.base = d; a.fold.anchor = foldAnchor(now()); a.fold.minutes = new Map()
        a.fold.dayVol0 = _dayVol(p.sym); a.fold.hwm = a.fold.dayVol0; a.fold.day0 = etDay(now()); a.fold.def0 = _feedDef(p.sym, now()); a.fold.vBase = null
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

    // Tick fallback: ONE source per bucket (arbitrateTick), each tick at its OWN trade time. The
    // holder lives here with the key's subscriptions (no invalidation needed: it names a bucket, and
    // a later bucket or a quiet holder replaces it).
    const tick = (src, price, ms) => {
      if (!finite(price) || !finite(ms) || isStreamLive(key, session)) return
      const st = registry.peek(key) ?? { key, sym: p.sym, tf: p.tf, bars: [], developing: null }
      // A print the reducer would refuse (sanity, a closed / past bucket) neither claims a bucket
      // nor keeps its source live — else a stream of refused prints froze the bar (#1157 review).
      if (!tickAdmission(st, { price, ts: ms })) return
      if (src !== TICK_SRC.UNTIMED) a.live[src] = Math.max(finite(a.live[src]) ? a.live[src] : -Infinity, ms)
      // the period bar is RTH: an extended-hours print (it still proves its source live) never
      // claims the day (see _dispatchTick)
      if (isDateTf(p.tf) && !isRthBar(Math.floor(ms / 1000))) return
      const r = arbitrateTick(a.arb, { src, ms }, a.live, st, now())
      if (!r.accept) return
      const before = registry.peek(key)?.developing ?? null
      _dispatchTick(key, session, price, ms, a)
      const after = registry.peek(key)?.developing ?? null
      // The holder is committed only once the bar took the print (it moved, or already shows it).
      if (after && (after !== before || (after.t === r.arb?.bucket && after.c === price))) a.arb = r.arb
    }
    if (candle?.subscribe) {
      off.push(candle.subscribe(p.sym, () => {
        const tr = candle.getLastTrade?.(p.sym)
        if (tr) tick(TICK_SRC.TRADE, Number(tr.price), _num(tr.tradeMs))
      }))
    }
    if (prices?.subscribe) {
      off.push(prices.subscribe([p.sym], () => {
        const x = prices.getSnapshot?.()?.prices?.[p.sym]
        if (!x) return
        const lt = liveTickTime(x, now())
        tick(lt.trusted ? TICK_SRC.MASSIVE : TICK_SRC.UNTIMED, Number(x.price), lt.ms)
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

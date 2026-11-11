// Single global registry. All chart instances subscribe here for live state.
// Replaces per-component liveBarRef + series.update logic; multi-chart sync is automatic.

import { LIVE_UI_CADENCE_MS } from '../utils/streamStatus';

const _state = new Map(); // sym -> { tf -> {o,h,l,c,v,t} }
const _subscribers = new Map(); // sym -> Set<callback>
const _correctionSubscribers = new Map(); // sym -> Set<callback>
const _lastTickAt = new Map(); // sym -> Date.now() of the last applyTick (fallback-writer arbitration)

function _notify(sym) {
  const subs = _subscribers.get(sym);
  if (!subs) return;
  subs.forEach(cb => { try { cb(); } catch {} });
}

// Coalesce the candle repaint to the shared live-UI cadence (in lockstep with
// priceStreamManager's PUBLISH_THROTTLE_MS). The o/h/l/c/v state is ALWAYS updated
// immediately (getCandle stays current for a freshly-mounting chart); only the
// subscriber repaint is throttled per-symbol: leading edge fires at once, then at
// most once per window, with a trailing flush so the final tick of a burst always
// paints. Bar closes/corrections bypass this and notify immediately — they're
// once-a-minute discrete events, not churn, and accuracy matters more than calm.
const _tickThrottleTimers = new Map(); // sym -> timeout id (throttle window open)
const _tickPending = new Map();        // sym -> true if a repaint was requested mid-window

function _notifyTickThrottled(sym) {
  if (_tickThrottleTimers.has(sym)) { _tickPending.set(sym, true); return; }
  _notify(sym); // leading edge
  _tickThrottleTimers.set(sym, setTimeout(() => {
    _tickThrottleTimers.delete(sym);
    if (_tickPending.get(sym)) { _tickPending.delete(sym); _notify(sym); }
  }, LIVE_UI_CADENCE_MS));
}

function _notifyCorrection(sym) {
  const subs = _correctionSubscribers.get(sym);
  if (!subs) return;
  subs.forEach(cb => { try { cb(); } catch {} });
}

export function getCandle(sym, tf) {
  return _state.get(String(sym).toUpperCase())?.[tf] || null;
}

/**
 * Apply a live tick to the developing 1-minute candle.
 *
 * ⚠️ `vol` is the bar's volume SO FAR (cumulative), NOT a per-trade delta.
 * The server builds it that way — api/services/realtime_candle.py does
 * `cur["v"] += size` per trade — and api/routers/stream.py emits that running
 * total verbatim as the tick's `vol`. This used to ADD it to the previous
 * value, so every tick inside a minute re-added the whole running total:
 *
 *     tick 1  cum 1,000  ->  v = 1,000        correct
 *     tick 2  cum 2,500  ->  v = 3,500        wrong
 *     tick 3  cum 4,000  ->  v = 7,500        wrong  ...compounding
 *
 * On a busy name that reached tens of millions inside one bar — the phantom
 * volume spike on the current/most-recent candle, which vanished as soon as
 * authoritative bar data replaced it. Take the cumulative value as-is;
 * Math.max keeps the bar monotonic if a tick ever arrives out of order.
 */
export function applyTick(sym, price, vol, ts) {
  if (price == null || ts == null) return;
  sym = String(sym).toUpperCase();
  const symState = _state.get(sym) || {};
  const t = Math.floor(ts / 60) * 60;
  const prev = symState["1"];
  // A late print for an EARLIER minute (feeds reorder at the boundary) must never
  // reset the developing minute back to the older bucket — that reverted the new
  // candle to a fresh {o=h=l=c} at the old time and then re-opened it on the next
  // tick (the boundary "glitch"). It can't move the closed minute either: that
  // minute's truth arrives via bar_close / the poll.
  if (prev && Number.isFinite(prev.t) && t < prev.t) return;
  _lastTickAt.set(sym, Date.now());
  if (!prev || prev.t !== t) {
    // `partial`: the registry joined this minute mid-way (no tick seen for the symbol
    // before it opened), so its o/h/l are only "since we subscribed" — the chart treats
    // such a minute as PROVISIONAL (lib/liveBarMerge I6). A minute opened by the first
    // tick AFTER a prior minute was tracked is the real first trade.
    symState["1"] = { t, o: price, h: price, l: price, c: price, v: vol || 0, partial: !prev };
  } else {
    symState["1"] = {
      ...prev,
      c: price,
      h: Math.max(prev.h, price),
      l: Math.min(prev.l, price),
      v: Math.max(prev.v || 0, vol || 0),
    };
  }
  _state.set(sym, symState);
  _notifyTickThrottled(sym);
}

/**
 * Apply a closed (or corrected) bar. The server's 1m bar_close carries only
 * {t, c, v} — NO o/h/l (api/routers/stream.py). Storing it verbatim left the
 * registry candle with undefined o/h/l, and Writer C then called series.update()
 * with them: the just-closed 1m candle painted BLANK until the next setData.
 * So MERGE: fields the payload carries win, the rest come from the developing
 * candle we already built for that minute; with nothing to merge from, the close
 * stands in for the missing extremes (a real, if narrow, bar — never undefined).
 * A close for an OLDER minute than the one now developing never clobbers it.
 */
export function applyBarClose(sym, tf, bar) {
  if (!bar || !bar.t) return;
  sym = String(sym).toUpperCase();
  const symState = _state.get(sym) || {};
  const prev = symState[tf];
  if (prev && Number.isFinite(prev.t) && bar.t < prev.t) return;
  const same = prev && prev.t === bar.t ? prev : null;
  const fin = (v) => Number.isFinite(v) && v > 0;
  const c = fin(bar.c) ? bar.c : same?.c;
  if (!fin(c)) return;
  const o = fin(bar.o) ? bar.o : (fin(same?.o) ? same.o : c);
  const h = fin(bar.h) ? bar.h : Math.max(fin(same?.h) ? same.h : c, c);
  const l = fin(bar.l) ? bar.l : Math.min(fin(same?.l) ? same.l : c, c);
  const v = Number.isFinite(bar.v) ? bar.v : (Number.isFinite(same?.v) ? same.v : 0);
  symState[tf] = { ...(same || {}), ...bar, t: bar.t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v };
  // A server bar carrying its own o/h/l is the minute's truth, never partial.
  if (fin(bar.o) && fin(bar.h) && fin(bar.l)) symState[tf].partial = false;
  _state.set(sym, symState);
  _notify(sym);
}

/** Date.now() of the last live tick for sym (0 if none) — lets the chart's two
 *  fallback writers decide which one owns the developing candle. */
export function getLastTickAt(sym) {
  return _lastTickAt.get(String(sym).toUpperCase()) || 0;
}

export function applyCorrection(sym, tf, corrected) {
  applyBarClose(sym, tf, corrected);
  _notifyCorrection(String(sym).toUpperCase());
}

export function subscribe(sym, callback) {
  sym = String(sym).toUpperCase();
  if (!_subscribers.has(sym)) _subscribers.set(sym, new Set());
  _subscribers.get(sym).add(callback);
  return () => _subscribers.get(sym)?.delete(callback);
}

export function onCorrection(sym, callback) {
  sym = String(sym).toUpperCase();
  if (!_correctionSubscribers.has(sym)) _correctionSubscribers.set(sym, new Set());
  _correctionSubscribers.get(sym).add(callback);
  return () => _correctionSubscribers.get(sym)?.delete(callback);
}

// Test/debug helper
export function _reset() {
  _state.clear();
  _subscribers.clear();
  _correctionSubscribers.clear();
  _lastTickAt.clear();
  for (const t of _tickThrottleTimers.values()) clearTimeout(t);
  _tickThrottleTimers.clear();
  _tickPending.clear();
}

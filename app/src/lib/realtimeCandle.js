// Single global registry. All chart instances subscribe here for live state.
// Replaces per-component liveBarRef + series.update logic; multi-chart sync is automatic.

import { LIVE_UI_CADENCE_MS } from '../utils/streamStatus';

const _state = new Map(); // sym -> { tf -> {o,h,l,c,v,t} }
const _subscribers = new Map(); // sym -> Set<callback>
const _correctionSubscribers = new Map(); // sym -> Set<callback>

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

export function applyTick(sym, price, vol, ts) {
  if (price == null || ts == null) return;
  sym = String(sym).toUpperCase();
  const symState = _state.get(sym) || {};
  const t = Math.floor(ts / 60) * 60;
  const prev = symState["1"];
  if (!prev || prev.t !== t) {
    symState["1"] = { t, o: price, h: price, l: price, c: price, v: vol || 0 };
  } else {
    symState["1"] = {
      ...prev,
      c: price,
      h: Math.max(prev.h, price),
      l: Math.min(prev.l, price),
      v: (prev.v || 0) + (vol || 0),
    };
  }
  _state.set(sym, symState);
  _notifyTickThrottled(sym);
}

export function applyBarClose(sym, tf, bar) {
  if (!bar || !bar.t) return;
  sym = String(sym).toUpperCase();
  const symState = _state.get(sym) || {};
  symState[tf] = { ...bar };
  _state.set(sym, symState);
  _notify(sym);
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
  for (const t of _tickThrottleTimers.values()) clearTimeout(t);
  _tickThrottleTimers.clear();
  _tickPending.clear();
}

// app/src/components/chart/useDarkPoolBars.js
//
// Dark-pool overlay logic EXTRACTED VERBATIM from OptionsFlow.jsx so the Live
// Flow chart popup (TickerPopup) and OptionsFlow can share ONE implementation
// instead of each carrying its own copy. OptionsFlow.jsx is partner-owned +
// perf-guarded and is NOT edited — this module is a copy of the inline helpers
// (stripCancelledPrints, clusterDarkPoolPrintsForOverlay) and the useDarkPoolBars
// hook that lived inline there. Keep the two in sync if the source ever changes.

import { useState, useEffect, useMemo } from 'react';

// ─── Dark Pool overlay helpers ───────────────────────────────────────────────
// Mirror of the logic in DarkPool.jsx so the chart modal can fetch + filter
// + cluster dark pool prints without depending on DarkPool's internal state.

// Filter "Cancelled" prints AND the original print they reference, so the
// chart only shows trades that actually settled (matches DarkPool's logic).
function stripCancelledPrints(prints) {
  // Array-shaped guard, not a truthy/length one: a non-array object passes
  // `length === 0` and reaches .map() below (see the coercion in the hook).
  if (!Array.isArray(prints) || prints.length === 0) return [];
  const readNum = (...vals) => { for (const v of vals) if (v != null && v !== "") return Number(v); return 0; };
  const readStr = (...vals) => { for (const v of vals) if (v != null) return String(v); return ""; };
  const readPrice  = p => readNum(p?.price, p?.p);
  const readVolume = p => readNum(p?.volume, p?.v);
  const readMsg    = p => readStr(p?.message, p?.msg, p?.Message);
  const readDate   = p => readStr(p?.date, p?.Date).trim();
  const readTime   = p => readStr(p?.time, p?.timestamp, p?.Timestamp, p?.t).trim();
  const isCancelled = p => readMsg(p).startsWith("Cancelled");
  const parseClock = s => {
    const m = String(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!m) return 0;
    let h = parseInt(m[1]);
    const mins = parseInt(m[2]);
    const secs = parseInt(m[3] || "0");
    const ampm = (m[4] || "").toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 3600 + mins * 60 + secs;
  };
  const normalizeDate = d => {
    if (!d) return "";
    if (d.includes("-") && /^\d{4}-/.test(d)) return d;
    const parts = d.split("/");
    if (parts.length === 3) {
      const [m, day, y] = parts;
      return `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    }
    return d;
  };
  const sortKey = e => e.date + ":" + String(e.clock).padStart(6, "0");
  const enriched = prints.map((p, i) => ({
    p, idx: i,
    cancel: isCancelled(p),
    price: readPrice(p), volume: readVolume(p),
    date: normalizeDate(readDate(p)),
    clock: parseClock(readTime(p)),
  }));
  const excluded = new Set();
  for (const cur of enriched) {
    if (!cur.cancel) continue;
    excluded.add(cur.idx);
    const curKey = sortKey(cur);
    let best = null, bestKey = "";
    for (const cand of enriched) {
      if (cand.idx === cur.idx || cand.cancel || excluded.has(cand.idx)) continue;
      if (cand.price !== cur.price || cand.volume !== cur.volume) continue;
      const candKey = sortKey(cand);
      if (candKey >= curKey) continue;
      if (!best || candKey > bestKey) { best = cand; bestKey = candKey; }
    }
    if (best) excluded.add(best.idx);
  }
  return prints.filter((_, i) => !excluded.has(i));
}

// Cluster prints within 2% of each other into single zones. See DarkPool.jsx
// for the rationale and full algorithm doc.
function clusterDarkPoolPrintsForOverlay(prints, { zonePct = 0.02 } = {}) {
  if (!Array.isArray(prints) || prints.length === 0) return [];
  const readPrice    = p => (p?.price ?? p?.p ?? 0);
  const readNotional = p => (p?.notional ?? p?.n ?? p?.premium ?? 0);
  const readVolume   = p => (p?.volume ?? p?.v ?? 0);
  const sorted = [...prints].sort((a, b) => readPrice(a) - readPrice(b));
  const zones = [];
  let current = null;
  for (const p of sorted) {
    const price = readPrice(p);
    const notional = readNotional(p);
    const volume = readVolume(p);
    if (price <= 0) continue;
    const ref = current?.price ?? price;
    const tol = ref * zonePct;
    if (current && Math.abs(price - ref) <= tol) {
      current._members.push(p);
      current.notional += notional;
      current.volume += volume;
      const wSum = current._members.reduce((s, x) => s + readPrice(x) * (readVolume(x) || 1), 0);
      const wDen = current._members.reduce((s, x) => s + (readVolume(x) || 1), 0);
      current.price = wDen > 0 ? wSum / wDen : price;
      current.priceLow = Math.min(current.priceLow, price);
      current.priceHigh = Math.max(current.priceHigh, price);
      if (p.time && (!current.time || String(p.time) > String(current.time))) current.time = p.time;
    } else {
      current = { ...p, price, notional, volume, priceLow: price, priceHigh: price, _members: [p] };
      zones.push(current);
    }
  }
  // Sortable numeric key from a M/D/YYYY (or M/D) dark-pool date → YYYYMMDD.
  const _dnum = x => {
    const parts = String(x?.dateRaw ?? x?.date ?? "").split("/");
    if (parts.length < 2) return 0;
    const m = parseInt(parts[0], 10) || 0, day = parseInt(parts[1], 10) || 0;
    const y = parts.length >= 3 ? (parseInt(parts[2], 10) || 0) : 0;
    return y * 10000 + m * 100 + day;
  };
  return zones.map(z => {
    if (z._members.length === 1) {
      const { _members, priceLow, priceHigh, ...single } = z;
      return single;
    }
    const { _members, ...out } = z;
    // Label a merged zone by its MOST RECENT print, not the first (lowest-price)
    // member the zone object was seeded from. Otherwise a multi-day cluster shows
    // the OLDEST date and reads as if it's missing the newest prints — they're
    // actually summed in. (2026-08-06: SNDK's $830M zone spanned 8/3–8/6 but its
    // tooltip said "Aug 3", hiding the 8/6 print folded inside.)
    const latest = _members.reduce((a, b) => (_dnum(b) > _dnum(a) ? b : a), _members[0]);
    return {
      ...out,
      date: latest.date ?? out.date,
      dateLong: latest.dateLong ?? out.dateLong,
      dateRaw: latest.dateRaw ?? out.dateRaw,
      // Inherit LATEST if any member is the newest print, so a merged zone
      // containing today's print is flagged rather than reading as an old zone.
      isLatest: _members.some(m => m?.isLatest) || out.isLatest || false,
      _isCluster: true,
      _clusterCount: _members.length,
      _latestDate: latest.dateLong ?? latest.date,
    };
  });
}

// Fetches + filters + clusters dark pool prints for the active sym. Returns
// a stable bars array suitable for the StockChart's darkPoolBars prop, or
// an empty array when disabled or no data.
export function useDarkPoolBars(sym, enabled) {
  const [raw, setRaw] = useState(null);
  useEffect(() => {
    if (!enabled || !sym) { setRaw(null); return; }
    let cancelled = false;
    // order=notional: the overlay is size-ranked, so fetch the BIGGEST prints
    // across the window (not just the most recent 100) — otherwise a heavy dark-flow
    // name like SMH exhausts the cap on the last few days and hides large historical
    // zones at other price levels. limit raised to 200 for more price-diverse zones.
    fetch(`/api/darkpool/ticker-detail?sym=${encodeURIComponent(sym)}&days=180&limit=200&order=notional`)
      .then(r => r.ok ? r.json() : null)
      // ⛔ COERCE TO AN ARRAY. This was `j?.prints || j || []`, so a 200 whose
      // body is an OBJECT without `prints` (an error payload, a shape change)
      // stored the object itself; the helpers below guard on `.length === 0`,
      // which a non-array passes, and the next `.map` threw
      // "prints.map is not a function" — crashing <TickerPopup>, the app's
      // universal ticker surface, for every caller.
      .then(j => {
        if (cancelled) return;
        setRaw(Array.isArray(j?.prints) ? j.prints : Array.isArray(j) ? j : []);
      })
      .catch(() => { if (!cancelled) setRaw([]); });
    return () => { cancelled = true; };
  }, [sym, enabled]);
  return useMemo(() => {
    if (!enabled || !raw) return [];
    const active = stripCancelledPrints(raw);
    return clusterDarkPoolPrintsForOverlay(active);
  }, [raw, enabled]);
}

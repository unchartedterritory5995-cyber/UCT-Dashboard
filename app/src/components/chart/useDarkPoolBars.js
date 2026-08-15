// app/src/components/chart/useDarkPoolBars.js
//
// Dark-pool chart overlay for the Live Flow popup (TickerPopup).
//
// Zones are now clustered SERVER-SIDE (`GET /api/darkpool/zones`) over EVERY
// print in the window — no per-print cap — so a level accumulated across
// back-to-back days shows its TRUE cumulative notional. The browser renders the
// returned zones directly; there is no client-side stripping/clustering here
// anymore. (OptionsFlow.jsx keeps its own inline stripCancelledPrints /
// clusterDarkPoolPrintsForOverlay path — it is partner-owned and not edited here;
// the server endpoint mirrors that same greedy 2%-band algorithm.)

import { useState, useEffect, useMemo } from 'react';

// Fetches server-clustered dark-pool zones for the active sym. Each zone already
// carries the shape StockChart's `darkPoolBars` prop expects (price, notional,
// priceLow/priceHigh, date, dateLong, pctAvgVol, isLatest, printCount). Returns a
// stable array, or an empty array when disabled or on any non-array response
// (the overlay is decoration — it must degrade to "no overlay", never crash).
export function useDarkPoolBars(sym, enabled) {
  const [zones, setZones] = useState(null);
  useEffect(() => {
    if (!enabled || !sym) { setZones(null); return; }
    let cancelled = false;
    fetch(`/api/darkpool/zones?sym=${encodeURIComponent(sym)}&days=180&limit=25`)
      .then(r => (r.ok ? r.json() : null))
      // ⛔ COERCE TO AN ARRAY. A 200 whose body is an OBJECT without `zones` (an
      // error payload, a shape change) must degrade to "no overlay", never store a
      // non-array that a downstream `.map` would crash on. See
      // useDarkPoolBars.shape.test.jsx for the outage this guard exists for.
      .then((j) => {
        if (cancelled) return;
        setZones(Array.isArray(j?.zones) ? j.zones : Array.isArray(j) ? j : []);
      })
      .catch(() => { if (!cancelled) setZones([]); });
    return () => { cancelled = true; };
  }, [sym, enabled]);
  return useMemo(() => (!enabled || !zones ? [] : zones), [zones, enabled]);
}

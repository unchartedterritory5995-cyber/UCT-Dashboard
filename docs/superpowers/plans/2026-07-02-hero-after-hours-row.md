# Hero After-Hours / Overnight Row Implementation Plan

Deferred RH-spec item (spec `2026-07-01-robinhood-journal-design.md`: "extended-hours
shows a separate After-Hours/Overnight delta"). User-approved 2026-07-02.

**Behavior:** regular session/closed → unchanged single "Today" line. POST-market →
main line = Today FROZEN at the 4pm close (Σ signed×(day_close − ref), ref = fill if
opened today else prev_close) + a second smaller stacked line "After-Hours" =
Σ signed×(ext_price − day_close), both colored, on the 1D range only. PRE-market →
the single line relabels "Overnight" (the whole move since prev close IS the overnight
move; value unchanged).

**Tasks:**
1. Backend: `day_close` field in `/api/live-prices` payload (`day.c`, null when 0 —
   pre-market has no day bar). Extend the live-prices test.
2. Pure `extendedSessionSplit(positions, prices, {cash, optionMarketValue, todayIso})`
   in `calculations.js` → null when no `ext_session` in feed; `{session:'pre_market'}`
   pre-market; full `{session, regularDollar, regularPct, extDollar, extPct}` post-market
   (pcts vs net-liq at close = cash + Σ signed×day_close + optionMarketValue). TDD.
3. `BrokerAccountHero`: compute split; render the second line (post) / relabel (pre);
   only when `isIntraday && !scrubbing`. Hero tests for both sessions.
4. Full journal suite + build → ship + chunk-verify (`After-Hours` marker).

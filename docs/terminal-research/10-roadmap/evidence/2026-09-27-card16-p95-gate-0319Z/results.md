# CARD 16 p95 gate — 2026-09-27 03:19Z (23:19 ET, Saturday)

Runner: `tools/bars_warmth_gate.py`. Instrument: `tools/bars_warmth_audit.py` (unmodified — the buckets, the percentile and the per-symbol probe are imported from it).

* gate: `docs/terminal-research/10-roadmap/roadmap.md` §2.3 clause 2 — p95 <= 250 ms per timeframe
* origin: `https://uctintelligence.com`
* timeframes: D, 5 · sample: 40 symbols per timeframe
* pod floor: 300 s · tier alarm: `fetch`/`miss` > ~10% on intraday during RTH
* market-hours authority: `api.services.screener.scan_evaluator._live_session_state`
* ET at start: 2026-09-26 23:19:37 (EDT, UTC-0400)

**status: REFUSED — INCONCLUSIVE (exit 2). Nothing was measured.**

`uptime_seconds` as read: 302 · `/api/health` status: 200

## Preconditions that refused

* INCONCLUSIVE — Saturday 2026-09-26 23:19 ET is **not inside regular trading hours** (the clock says `closed`), per `api.services.screener.scan_evaluator._live_session_state`, which reads the NYSE calendar: weekends, full closures, and 13:00 ET half-days. Clause 2's tier alarm is only meaningful during RTH, and a weekend or holiday cache is not representative of what a member waits for. ⛔ NOT a pass and NOT a failure — the gate was not taken.

⛔ No p95 was taken. A reading under these conditions would be real numbers under invalid conditions — which is worthless for the gate and worse than nothing, because it is quotable.

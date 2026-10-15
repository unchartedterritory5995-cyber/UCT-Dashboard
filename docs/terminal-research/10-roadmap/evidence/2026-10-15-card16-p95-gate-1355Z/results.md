# CARD 16 p95 gate — 2026-10-15 13:55Z (09:55 ET, Thursday)

Runner: `tools/bars_warmth_gate.py`. Instrument: `tools/bars_warmth_audit.py` (unmodified — the buckets, the percentile and the per-symbol probe are imported from it).

* gate: `docs/terminal-research/10-roadmap/roadmap.md` §2.3 clause 2 — p95 <= 250 ms per timeframe
* origin: `https://uctintelligence.com`
* timeframes: D, 5 · sample: 40 symbols per timeframe
* pod floor: 300 s · tier alarm: `fetch`/`miss` > ~10% on intraday during RTH
* market-hours authority: `api.services.screener.scan_evaluator._live_session_state`
* ET at start: 2026-10-15 09:55:12 (EDT, UTC-0400)

**status: WITHIN THE BAR (exit 0)**

WITHIN THE BAR — tf=D p95 154 ms <= 250 ms, tf=5 p95 112 ms <= 250 ms. Measured under valid conditions.

Validity evidence carried by this result: pod `uptime_seconds` = **44513** (floor 300 s), `/api/health` = **200**, and the ET stamp in the title. A recorded number without these is not a recorded gate reading.

## The p95, the bar, and which side of it

| tf | p95 | bar | side | p50 | no-wait n | sampled | server p95 (beside, not an input) |
|---|---|---|---|---|---|---|---|
| D | 154 ms | 250 ms | WITHIN | 105 ms | 40 | 40 | 70 ms |
| 5 | 112 ms | 250 ms | WITHIN | 85 ms | 40 | 40 | 37 ms |

## Tier mix — BESIDE the numbers, never a pass/fail input

⛔ Clause 2 says so explicitly, because a pass bought by serving stale data is not a pass. `verdict()` cannot see any of this: its only argument is the p95 per timeframe.

| tf | warm | stale-served | waited | layers |
|---|---|---|---|---|
| D | 40/40 | 0/40 | 0/40 | `{'sqlite': 40}` |
| 5 | 40/40 | 0/40 | 0/40 | `{'sqlite': 40}` |

## The one tier alarm

* No alarm: no intraday timeframe exceeded ~10% `fetch`/`miss` during RTH.

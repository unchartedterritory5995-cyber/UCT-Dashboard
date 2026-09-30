# CARD 16 p95 gate — 2026-09-30 16:27Z (12:27 ET, Wednesday)

Runner: `tools/bars_warmth_gate.py`. Instrument: `tools/bars_warmth_audit.py` (unmodified — the buckets, the percentile and the per-symbol probe are imported from it).

* gate: `docs/terminal-research/10-roadmap/roadmap.md` §2.3 clause 2 — p95 <= 250 ms per timeframe
* origin: `https://uctintelligence.com`
* timeframes: D, 5 · sample: 40 symbols per timeframe
* pod floor: 300 s · tier alarm: `fetch`/`miss` > ~10% on intraday during RTH
* market-hours authority: `api.services.screener.scan_evaluator._live_session_state`
* ET at start: 2026-09-30 12:27:51 (EDT, UTC-0400)

**status: WITHIN THE BAR (exit 0)**

WITHIN THE BAR — tf=D p95 96 ms <= 250 ms, tf=5 p95 79 ms <= 250 ms. Measured under valid conditions.

Validity evidence carried by this result: pod `uptime_seconds` = **334** (floor 300 s), `/api/health` = **200**, and the ET stamp in the title. A recorded number without these is not a recorded gate reading.

## The p95, the bar, and which side of it

| tf | p95 | bar | side | p50 | no-wait n | sampled |
|---|---|---|---|---|---|---|
| D | 96 ms | 250 ms | WITHIN | 96 ms | 2 | 40 |
| 5 | 79 ms | 250 ms | WITHIN | 79 ms | 1 | 40 |

## Tier mix — BESIDE the numbers, never a pass/fail input

⛔ Clause 2 says so explicitly, because a pass bought by serving stale data is not a pass. `verdict()` cannot see any of this: its only argument is the p95 per timeframe.

| tf | warm | stale-served | waited | layers |
|---|---|---|---|---|
| D | 0/40 | 2/40 | 38/40 | `{'fetch': 38, 'stale-swr': 2}` |
| 5 | 1/40 | 0/40 | 39/40 | `{'fetch': 38, 'sqlite': 1, 'miss': 1}` |

## The one tier alarm

* ⚠️ TIER ALARM — `fetch`/`miss` share is **98%** on intraday (tf=5) during RTH, over clause 2's ~10% line. ⛔ REPORTED, NOT a pass/fail input: it does not move the exit code.

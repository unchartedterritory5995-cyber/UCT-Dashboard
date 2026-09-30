# CARD 16 p95 gate — 2026-09-30 16:25Z (12:25 ET, Wednesday)

Runner: `tools/bars_warmth_gate.py`. Instrument: `tools/bars_warmth_audit.py` (unmodified — the buckets, the percentile and the per-symbol probe are imported from it).

* gate: `docs/terminal-research/10-roadmap/roadmap.md` §2.3 clause 2 — p95 <= 250 ms per timeframe
* origin: `https://uctintelligence.com`
* timeframes: D, 5 · sample: 40 symbols per timeframe
* pod floor: 300 s · tier alarm: `fetch`/`miss` > ~10% on intraday during RTH
* market-hours authority: `api.services.screener.scan_evaluator._live_session_state`
* ET at start: 2026-09-30 12:25:15 (EDT, UTC-0400)

**status: REFUSED — INCONCLUSIVE (exit 2). Nothing was measured.**

`uptime_seconds` as read: 178 · `/api/health` status: 200

## Preconditions that refused

* INCONCLUSIVE — the pod is **178 s old**, under clause 2's floor of 300 s. A reading this early measures the BOOT — cold caches, warm-on-boot still running — not the product a member gets. Re-run in 122 s.

⛔ No p95 was taken. A reading under these conditions would be real numbers under invalid conditions — which is worthless for the gate and worse than nothing, because it is quotable.

# Catalyst Curator — guardrail (can't-break-silently)

**Date:** 2026-07-23
**Status:** built; ships flag-gated on `CATALYST_CURATOR_ALERT_ENABLED` (default ON).

## Why

The swing-trader Curator shipped 2026-07-23 *looking* live — flag on, healthcheck
green — but was **silently falling back** to the mechanical 10/5/3/2 quota on the
real pool (a truncated JSON contract, then Sonnet-5 thinking starving the output).
The list stayed populated, just **not curated**, and nothing surfaced it. Only the
owner's "recompute it so I can test" caught it.

The lesson: a "never-break" `try/except` fallback + a flag-based status made a
silent failure indistinguishable from success. This guardrail closes that gap so
the owner can *rely* on the curator.

## What

1. **A real "did it run" signal** (shipped with the fix): `curator.curator_ran(md)`
   + `curator.last_fallback_reason(md)`, and `run_refresh` sets
   `summary["curator"] = ran | fallback | off` from the actual run, not the flag.

2. **`api/services/catalyst/curator_health.py`** — `check_and_alert(md)`, called by
   `run_refresh` right after `curator.curate()`. If the curator is **enabled but did
   not run** (fell back), it logs an ERROR and fires a **deduped** (once per
   market_date) Discord alert to the admin channel with the fallback reason. Never
   raises — a guardrail must not break the refresh it guards. No-op when the flag is
   off or the curator ran.

3. **Admin visibility** — `GET /api/admin/catalyst-stats` now returns a `curator`
   block: `{enabled, status, ran, kept, cut, last_fallback_reason, model}`.

## Env

- `CATALYST_CURATOR_ALERT_ENABLED` (default `1`) — the Discord alert. Logging + the
  admin-stats block are always on.

## Tests

`tests/test_catalyst_curator_health.py` (6): alerts on enabled+fallback, no alert
when it ran / flag off / alert disabled, deduped once per day, never raises.

## Not in scope (the source-completeness roadmap — separate pieces, owner-sequenced)

Options flow / unusual options (biggest signal) → FMP analyst → Brain setup-grading
→ Finviz/AV news. This guardrail is step 1 (reliability); those are step 2
(completeness).

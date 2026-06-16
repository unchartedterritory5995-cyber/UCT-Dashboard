# Stock Catalysts — Evidence-Based Auto-Tuning (2026-06-15)

## Goal
Close the precision loop: the catalyst tradeability gate tunes itself nightly from accumulated evidence — tightening toward the user's 👎 taste and loosening when it falsely drops real movers — **auto-applied within hard guardrails, fully reversible.**

User decisions (2026-06-15): auto-apply (not recommend-only) but reversible; v1 scope = the four tradeability/junk knobs only.

## Scope — v1 auto-tunable knobs (KNOBS)
Only the deterministic tradeability gates in `filters.quality_gate`, each with `(default, min, max)` bounds:
| Knob | default | min | max | feedback metric field |
|------|---------|-----|-----|-----------------------|
| `CATALYST_MIN_PRICE` | 3.0 | 2.0 | 8.0 | `price` |
| `CATALYST_MIN_DOLLAR_VOL` | 5_000_000 | 3_000_000 | 40_000_000 | `dollar_vol` |
| `CATALYST_MIN_FLOAT` | 5_000_000 | 2_000_000 | 25_000_000 | `float_shares` |
| `CATALYST_MIN_MARKET_CAP` | 300_000_000 | 100_000_000 | 1_000_000_000 | `market_cap` |

Out of scope v1 (stay manual): activity gate (move%/vol×), scoring weights — they trade off coverage more delicately.

## Override resolution (precedence: explicit env > auto-override > default)
New `api/services/catalyst/tuning.py::get_threshold(name, default)`:
1. If env var `name` is set → use it (a manual operator override always wins).
2. Else if the overrides file has `name` → use it, clamped to the knob's `[min,max]`.
3. Else `default`.

Overrides persisted to `/data/catalyst_tuning_overrides.json` (path env `CATALYST_TUNING_OVERRIDES_PATH`), cached in-process and reloaded on mtime change (cheap; read on every gate call).

`filters.quality_gate` switches its four knobs from `_f(...)` to `tuning.get_threshold(...)` (same defaults). Everything else in filters unchanged (fail-open preserved).

## The analyzer — `tuning.run_autotune()` (nightly)
Gated by `CATALYST_AUTOTUNE_ENABLED` (default on). Per knob:
- **Tighten signal (precision):** from 👎 feedback rows in the last `LOOKBACK_DAYS` (30). If `count >= MIN_SAMPLES` (10), candidate = 75th percentile of the 👎 metric values, but **never above `min(good-feedback metric)`** (don't tighten past a row the user liked). Tighten only if candidate > current.
- **Loosen signal (coverage):** from the coverage audit's `buckets.excluded` (movers a gate dropped) over the window. Count excluded-movers whose drop reason maps to this knob (reason leading word → knob: `price→MIN_PRICE`, `liquidity→MIN_DOLLAR_VOL`, `float→MIN_FLOAT`, `market→MIN_MARKET_CAP`). If `count >= 3`, loosen by one bounded step (the gate is costing us real movers).
- **Priority: coverage > precision** — if a loosen signal exists, loosen; else if a valid tighten signal exists, tighten; else no change.
- **Bounded step:** move current→target by at most `MAX_STEP_FRAC` (15%) per night, then clamp to `[min,max]`. Skip if net change < 1%.

Each applied change appends to `catalyst_tuning_log {ts, knob, old_value, new_value, evidence}` and updates the overrides file. Evidence = the counts/percentiles that drove it.

### Feedback enrichment (so DOLLAR_VOL + FLOAT have a tighten signal)
`catalyst_feedback` gains `dollar_vol` + `float_shares` columns. `store.record_feedback` populates them via a `ticker_metadata.get_metadata(ticker)` lookup at feedback time: `float_shares = float_shares or shares_outstanding`; `dollar_vol = price * avg_volume_30d`. (price + market_cap already captured.) New accessor `store.recent_feedback(verdict, days)` returns rows with the metric fields.

## Reversibility + admin surface (`api/routers/catalysts.py`, `require_admin`)
- `GET /api/admin/catalyst-tuning` — effective value + source (`env` / `auto` / `default`) for each knob, plus the recent `catalyst_tuning_log`.
- `POST /api/admin/catalyst-tuning/revert` — restore the previous snapshot from the log (per-knob `old_value`), or `?clear=1` to wipe all overrides back to env/defaults. Logs the revert.
- `POST /api/admin/catalyst-tuning/run` — force a tuning pass now (testing).

## Scheduler (`api/main.py`)
One nightly APScheduler job `catalyst_autotune` (~5:00 AM ET, before the pre-market burst, using the prior day's full evidence) → `tuning.run_autotune()`, gated by `CATALYST_AUTOTUNE_ENABLED`. Added next to the existing catalyst/coverage jobs; minimal edit.

## Guardrails recap (what makes auto-apply safe)
Hard per-knob bounds (clamped on read AND write) · ≤15% step/night · min 10 👎 samples before tightening · coverage-priority so it can't strangle the feed · full change log · one-click revert · master off-switch · explicit env always wins.

## Testing
`tests/test_catalyst_tuning.py`: get_threshold precedence + bound-clamp; run_autotune tightens on 👎 cluster (respecting good-feedback floor + min-samples) ; loosens on excluded-mover signal; bounded-step + clamp; min-samples no-op; revert restores prior; feedback enrichment captures float/dollar_vol. Use tmp DB + tmp overrides path via monkeypatch + importlib.reload (same pattern as existing catalyst tests).

## Rollout
Backend-only; behind `CATALYST_AUTOTUNE_ENABLED`. Built in an isolated worktree off origin/master, shipped via fast-forward `push origin <branch>:master`. Nothing changes until ≥10 👎 samples accumulate (by design).

# W8 — accuracy audit for /chart, /flow, /buzz: BUILT and RAIL-PROVED (2026-09-18)

## What this is, and the bug class it targets

`docs/discord-render/instruments/w8_accuracy_audit.py` — the checklist's "W8
(accuracy audit)" item (`D14-CHECKLIST.md` line 5), previously not started.

`api/services/discord_chart_render.py`'s own `compute_stats()` docstring
records a real incident, 2026-08-31: a `/chart` strip computed its day-change
strip **correctly** off the bars it was handed, and the bars were one session
stale — so the public message read "Day -3.5%" (Friday's close) on a post
captioned Monday, while SMH had actually gained +0.6% that day. Internally
consistent, externally wrong, in one message, in opposite SIGNS. No amount of
re-checking the strip's own arithmetic would ever catch this, because the
arithmetic was right — the only way to catch this class is a SECOND,
independently-sourced number for the same fact, diffed against the first.

W8 is that second number, for all three render surfaces this program touches.

## Coverage, stated honestly — not every surface got the same strength of check

| surface | check | independence |
|---|---|---|
| `/chart` | `check_chart_vs_snapshot`: bars-derived `day_pct` (via the SAME `compute_stats()` the strip renders with, never re-derived) vs. an independently-fetched live snapshot `change_pct` (`api.routers.live_prices.get_live_prices`, a wholly separate Massive call path) | **Genuinely independent** — two different code paths, two different fetches, same fact |
| `/chart` | `check_ohlc_invariants` + `check_bar_ordering`: structural sanity on every bar (no NaN/inf, high/low/open/close relationships, strictly-increasing timestamps) | Not a second source — catches corruption a freshness check alone would miss |
| `/buzz` | `check_buzz_counts`: served `/r/buzz` per-ticker mention counts vs. a raw SQL tally written from scratch against `mentions`, **never calling `buzz_store.board()`** (the function under audit) | **Genuinely independent** — mirrors `tools/buzz_audit_extraction.py`'s own documented lesson ("the day-one audit ran the SAME extractor on both sides and proved ingest fidelity, nothing about extraction quality") |
| `/flow` | `check_flow_internal_consistency`: contract values must sum to the reported net; top-contracts list must be sorted as claimed | ⚠️ **Structural-only, NOT a second source.** The true independent re-derivation is off the Massive OPRA tape via flow-worker/`flow.db`, and this pass did not reach it — reported as `"coverage": "structural-only ..."` in every flow result, never silently upgraded to "audited" |

⛔ **The flow gap is a named gap, not a promise.** No silent caps: the tool's
own output labels every flow result with what it did and did not check, so a
future reader (or the tally itself) cannot mistake "structural check passed"
for "flow numbers are accurate."

## Design choices, and why

- **`checked` / `matched` / `mismatched` / `not_computable`** — the
  `CoverageLine.jsx` four-count idiom, restated for this tool. "The check could
  not run" and "the check ran and disagreed" are different facts to a trader;
  collapsing them (e.g. treating `not_computable` as `matched`) would have
  reported the actual local-dev smoke run below as a false PASS.
- **A `None` cross-check input is NEVER treated as agreement.**
  `check_chart_vs_snapshot(day_pct, None)` returns `None` (no problem) but the
  RUNNER (`run_chart_check`) separately tracks whether both sides were
  actually computable and reports `not_computable`, not `matched`, when one
  side is missing — this is the exact trap the CoverageLine section of
  CLAUDE.md warns about ("a screen that silently loses symbols... looks like a
  quiet market").
- **In-process only**, like `discord_interactions.fetch_bars`'s own adapter —
  no HTTP, no render tokens. `get_live_prices`'s `Query(...)` default and
  `/data/buzz.db`'s Railway-volume-only reachability both only resolve inside
  the real process, matching this repo's own established pattern rather than
  inventing an HTTP-with-token path.
- **Pure functions carry the mutation-proof; I/O runners are thin wrappers.**
  Same shape as `docs/discord-render/instruments/d14_monitor.py`'s
  `self_check()` — the decision logic that must be provably correct is
  separated from the network/db calls that cannot be exercised without a live
  environment.
- **Lives in `docs/discord-render/instruments/`, not repo-root `tools/`** —
  this is a discord-render-hardening-specific instrument, matching
  `d14_monitor.py`/`mutation_harness_flipgate.py`'s own placement; repo-root
  `tools/` is for repo-wide tooling. (Built first at `tools/`, relocated
  before commit once the actual convention was confirmed against `git ls`
  rather than assumed.)

## Mutation-proof, run and verified this pass

`--self-check` runs 23 declared cases across all five pure functions, each
proved in BOTH directions (a planted defect must fire; a clean input must stay
quiet) — the same two-sided proof this repo's rails are held to everywhere.

```
TOTALS w8_accuracy_audit --self-check PASS declared=23 evaluated=23 failed=0
```

**Mutation applied and reverted**, sha-verified both ways
(`fd88e2b5fb0e682c3c10ee55267737135b2caf29cd66d71528948e4f264851d3` before and
after): `check_chart_vs_snapshot` — the SMH-incident detector itself — was
temporarily replaced with a version that always returns `None` (never flags).
Result:

```
FAIL chart-vs-snapshot: the actual SMH incident (opposite signs) flags -> None
FAIL chart-vs-snapshot: same sign but far apart flags -> None
TOTALS w8_accuracy_audit --self-check FAIL declared=23 evaluated=23 failed=2
```

**Exactly the two cases requiring that function to flag went RED, and nothing
else** — the same "exactly the contention-bearing cases, nothing more" shape
R72's own mutation-proof produced. Reverted; re-ran `--self-check`, green
again.

## Pytest coverage

`tests/test_w8_accuracy_audit.py` — 33 cases over the same five pure
functions (a superset of the CLI self-check's 23, adding edge cases: empty
inputs, missing fields, a custom-tolerance parametrization, `signed_value`
preferred over `value` when both are present). All green:

```
33 passed, 1707 warnings in 1.37s
```

(The warnings are `pytest-asyncio` deprecation noise from the shared conftest,
unrelated to this file — not new, not this pass's to fix.)

## Real (degraded) local run — proves the wiring, not a verdict

```
python docs/discord-render/instruments/w8_accuracy_audit.py --symbols NVDA --skip-buzz --skip-flow
TOTALS w8_accuracy_audit checked=1 matched=0 mismatched=0 not_computable=1
  [chart] NVDA     not_computable
```

This is a real end-to-end pass through `fetch_bars` → `compute_stats` →
`get_live_prices`, on a local dev checkout with no `MASSIVE_API_KEY`/
`FMP_API_KEY` configured. It correctly fetched 260 real daily bars (yfinance
fallback), computed a real `day_pct` (-3.36%, `as_of` 2026-09-14 — genuinely
four sessions stale on THIS local box, not a planted number), found the live
snapshot unavailable, and reported `not_computable` rather than a false
`matched` — proving the coverage-arithmetic guard (`bars_have_any_computable`)
does its job on a real, degraded environment rather than only in the
self-check's synthetic inputs. **This is not a production accuracy reading —
running it against production (or via `railway ssh` on the live pod, where
`MASSIVE_API_KEY`, `FMP_API_KEY` and `/data/buzz.db` are all present) is the
next step, not done this pass.**

⚠️ **One real bug found and fixed during this build, worth recording:** the
first draft imported `fetch_bars` from `api.services.discord_interactions`
(wrong — that function lives in `api.routers.discord_interactions`). The
self-check's 23 pure-function cases could not have caught this — it exercises
no imports — and it was only found by actually running the tool end-to-end
against real data. **Recorded as the reason the "real (degraded) run" step
above is not optional**, matching this repo's own repeated lesson (`R72`'s own
doc: "a fix that makes a number fall must say where it went" — here, a fixture
that never imports the real modules cannot say whether the import path is
right).

## Not done this pass, named rather than hidden

- **No live/production run.** Everything above ran against a local dev
  checkout with no vendor API keys. A `railway ssh` run against the real pod
  (where buzz.db and both API keys are live) has not happened.
- **Flow's true independent re-derivation** (off `flow.db`/the OPRA tape) is
  not built — see the coverage table above.
- **Not scheduled/wired into any recurring job.** This is a manually-run
  instrument today, matching most of this programme's other `instruments/*.py`
  files (only `d14_monitor.py` runs unattended, via Task Scheduler).
- **Evidence JSON output path exists but no real evidence file has been
  committed** — the one produced during this build was a degraded local-dev
  smoke artifact (not_computable, not a real accuracy reading) and was
  deleted rather than checked in, to avoid a misleading "evidence" file
  standing in for a real production reading (the same `R-CITE` discipline
  this programme applies everywhere else: a citation must say what it
  actually measured).

# UCT Phase E — The Builder Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can type, click, or *say* a formula, see it read back in plain English, run it across 3,742 symbols, learn which symbols were dropped and why, save it, chart it, and arm an alert on it — **the same object throughout, one hash.**

**Architecture:** A scan is not a new language. `closedTable.json`'s own `_booleans` note establishes that *"a condition is therefore a 0/1 column"*, so a scan is `WHERE <ast> != 0` on the last confirmed bar. Phase E adds **vocabulary** (a `scalars` section), a **bounded evaluator** off the request path, a **criteria builder** that round-trips with the formula field, and the **member-independent record** that makes a published claim honest.

**Spec:** `docs/superpowers/specs/2026-08-08-phase-e-screener-toolkits-design.md` (v2, approved).
**Ground truth:** `.superpowers/sdd/phase-e/ground-truth.md` — ⚠️ **quote it or measure it; never estimate.** Where it says "not measured", say so too.

---

## The acceptance test

> A member opens a chart, enters `rs_rank > 80 and adr_pct > 4 and close > sma(close,50)` — by typing, by clicking, or in English — sees it read back in words, runs it across the universe, is told **41 symbols were dropped and which ones**, saves it, charts it, and arms an alert on it. Same definition object at every step. One `def_hash`.

⚠️ **CORRECTED 2026-08-09.** This example previously read `rsi(close,14) < 40`. **That is not a legal tree** — the closed table's 11 functions are `abs, change, crossOver, crossUnder, ema, highest, lowest, max, min, sma, stdev`, and `rsi` is not among them, so it refuses at `resolve:function`. `rsi14` (the screener's nightly **scalar**) is legal after E1; `rsi(close,14)` (a per-bar **function** with a user-chosen period) is **not granted by E-A7**. See the spec's CORRECTION 1 and the open **E-A9**.

Every clause is a task. **If a clause is not literally true at the end, the phase is not done.**

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec and from measurement.

### Settled adjudications — do NOT re-litigate
| id | ruling |
|---|---|
| **E-A1** | A scan is `<ast> != 0`. **No separate scan language.** Same parser, interpreters, linter, budget, read-back, concierge. |
| **E-A2** | **No reimplementation of the interpreter for scale.** |
| **E-A3** | **No thread pool.** Sequential, off the request path. |
| **E-A4** | **No new columns on `screener_rows`.** Narrow side table keyed by `def_hash`. |
| **E-A5** | The signal ledger is **not** a rule-performance record. E6 builds a member-independent one. |
| **E-A6** | **`INDICATOR_FUNCS` must not grow.** Fifth partition or nothing. |
| **E-A7** | The closed table **gains a `scalars` section** — declared, closed, `source` + `as_of`, both lanes. |
| **E-A8** | **`meta.freshness` is separate from `meta.repaint`.** A stale scalar is not a repainting one. |

### Invariants that must hold at every commit
- `python tools/alert_replay.py --check` → exit 0 and the literal **`FIRE LOG MATCHES`**. ⛔ **Never judged by a total.** `685,193` is a stale doc figure; the real output is **22 blocks / 1,153,245**.
- `python tools/alert_replay.py --diff --mode-a forming --mode-b closed` → **EVERY DIFFERENCE IS DECLARED, 31/31**, 0 undeclared.
- `python tools/ast_conformance.py --check` → **CONFORMANCE LOG MATCHES, 17 asts × 579 bars**; `REL_TOL` stays **`1e-9`**.
- `--coverage` → **31 declared entries, ALL COVERED**. `--escapes` → **CLOSED, 0 of 16, declared == fired**, ⭐ **with its unguarded control still non-zero.**
- `ALERT_EVAL_MODE` — exactly **one** top-level assignment, reading **`"closed"`**, verified by AST. ⛔ Phase E never writes it.
- `len(INDICATOR_FUNCS) == 28`; `all_addresses() == 31` across 16 catalog groups.
- `grep -c broker_sync api/main.py` ≥ **7** after every master merge.
- `registrySizes.js` **imports nothing** — `REGISTRY_SIZES` is a declaration the registry must prove; `idsByLane(listDefinitions())` equals `SHIPPED_DEF_IDS`.

### Measured facts the design rests on
| fact | value |
|---|---|
| universe | **3,742** tickers (`cap_universe.json`); local bars cover 99.0% on daily |
| full-universe pass, serial, bars resident | native RSI **~2.3 s** · median user AST **~5.4 s** · worst corpus AST **~8.1 s** |
| ⛔ threads, 400 syms × worst AST | serial 613 ms · **×1.00** at 4 · **×0.62** at 8 · **×0.55** at 16 |
| anyio pool | **64 slots**; all 7 signature routes are `sync def`; `/confluence-scan` reserves **2 of 64** |
| screener | nightly 03:00 ET, ~4,000 tickers, **60 hand-written columns**, 8 indexed |
| `alert_shadow_fires` | 53 B/row ⇒ **279 GB/yr at 10k alerts**, no prune ⛔ do not build on it |

⭐ **Why threads are forbidden, in one sentence the plan must preserve:** the interpreter is pure-Python plain loops *because* a 1e-9 equality across two languages only holds if the accumulations happen in the same order — **the correctness guarantee is what makes it GIL-bound.**

### Environment traps, all measured on this box
- ⚠️ **`C:\data` exists and is NOT production.** `AUTH_DB_PATH` is **captured at import** by six product modules, so setting it after import does nothing — the *attribute* must move. Prove isolation **against the artifact** (row count, byte size, mtime), never the env var.
- ⚠️ **Exit codes, read without a pipe.** `| tail` has reported EXIT=0 over a real failure. A no-match `-k` exits **5**. A usage error exits **4** with zero tests run and **no `passed` token**. `npx vitest --reporter=basic` fails to start on vitest 4.0.18 **and exits 0**.
- ⚠️ A monolithic backend run is slow here — **chunk it (~14 chunks ≈ 15 min)**. `pytest-timeout==2.4.0` is installed, repo default **300 s**.
- ⚠️ Files are **CRLF**; `BuilderSheet.{jsx,test.jsx}`, `indicatorCatalog.js` and `IndicatorLibraryDialog.module.css` are pre-existing **LF-only** — check with `git -c core.autocrlf=false diff` before assuming you changed endings.
- ⚠️ **`master` moves constantly** — 52 commits in one stretch on 2026-08-08. Fetch → merge → re-verify → push. **NEVER force.**
- ⛔ Explicit-pathspec commits, never `git add -A`; `git add` new files singly.

### Baselines to beat (2026-08-09, merged tree)
`backend` **9,791 passed / 0 failed** (14/14 chunks) · `api/**` **1,304 / 0** · `frontend` **536 files / 6,356 tests, exit 0**. **Attribute every test in your delta.**

---

## Review and test protocol — every task, without exception

1. **Implementer** works from a task brief carrying exact values.
2. **Mutation gauntlet.** CONTROL A unmutated with **abort-on-zero**; every mutation **proven applied** before replacement (⛔ never `str.replace` without `assert old in s`); verdict from the **bare exit code**; artifacts restored and **sha-verified**; a post-run sweep proving no mutation was left on disk. ⛔ A kill by a test other than the targeted one is **SUSPECT, never KILLED**.
3. **Task review** — spec compliance **and** code quality; both verdicts required.
4. **Fix loop**, five rounds maximum, escalating model at round four.

### Gates that are Phase-E specific

| gate | why it can fail |
|---|---|
| cross-lane parity unmoved (`--check` byte-identical, `REL_TOL` 1e-9) | E must not perturb the guarantee it depends on |
| `--escapes` CLOSED **with a non-zero unguarded control** | a `scalar` is a declared name, not an escape hatch |
| 🔴 **picker ⇄ formula round-trip is the IDENTITY**, over a generated corpus | a one-way builder is TC2000's PCF seam re-created — **this is the product claim** |
| 🔴 **pod-degradation budget** — a sweep must not raise p99 on an unrelated endpoint beyond a stated bound, **measured under concurrent load** | the 524 class; "fast alone" ≠ "safe together" |
| 🔴 **coverage is part of the result** — `{evaluated, answered, dropped, dropped_symbols}` | see below |
| NL emits a **tree**, never a sentence — re-assert by parsing `propose`'s own AST, **with a control** | D-A5 must survive the extension |
| entitlement derived from `router.routes`, **count asserted** | a hand-listed path set let two paid endpoints ride uncovered in Phase C |
| 🔴 **a wire-cut test per user-facing surface** | eight features shipped this week built, tested, green and **unreachable** |

### 🔴 The failure this phase must not ship

Almost every existing universe sweep swallows per-symbol failures silently — `bars_prewarm` (`except: pass`, counted into **neither** bucket), `rs_ranking` (dropped with no counter, and it marks itself done **even on failure**), `theme_performance` (a failed fetch becomes a legitimate-looking `None`), `scan_volume` (**a failed reference is indistinguishable from an empty market**).

⛔ **At screener scale that is a screen silently dropping 800 symbols, returning fewer hits, and looking like a quiet market — and a trader would act on it.**

Two jobs in the repo get this right and E copies both: **`screener/snapshot_builder`** (counts *and* logs per-symbol failures, returns `{built, skipped, errors}`) and **`scan_gainers`** (`_build_reference` returns `None` on a transient miss so the job **retries** rather than caching an empty day).

**E's rule: a screen states its own coverage.** *"3,742 evaluated · 3,701 answered · 41 dropped — here they are."*

---

## What each zero will NOT cover

- The pixel-parity harness **mounts no screener**. A total regression of everything in this plan reports **0 changed pixels**, honestly.
- `alert_replay --check` staying green proves E did not disturb the alert lane. It says **nothing** about whether a screen is correct.
- Cross-lane conformance covers the **interpreter**, not the **sweep**. A sweep evaluating the right formula over the wrong symbol set passes every conformance gate.
- Ledger rows prove accrual, **not** rule performance (E-A5).

---

## Sequencing

```
E1 scalars ──> E2 scan object ──> E3 evaluator ──> E4 criteria builder ──> E5 NL
                                        │                                    │
                                        └──────> E6 rule record <────────────┘
                                                      │
                                                      └──> E7 toolkits + sharing
```

**E1 gates everything** — without `scalars` a scan cannot say `market_cap > 1e9`, and the builder is a toy against TC2000.
**E6 gates every public claim and all sharing** — §12 defers publishing *"until the ledger can hold publishers accountable"*, and E6 is what makes it accountable.
**E7 is blocked on an owner answer** (which axes a toolkit gates); its enforcement mechanism is built with the numbers as declared constants in one place.

---

## Tasks

> *Task sections are assembled from the drafts in `.superpowers/sdd/phase-e/` after controller reconciliation against the spec. Do not implement from a draft — implement from this file.*

_(pending assembly)_

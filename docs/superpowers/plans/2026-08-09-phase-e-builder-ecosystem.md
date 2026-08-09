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
| 🔴 **coverage is part of the result** — `{evaluated, answered, dropped, not_computable, dropped_symbols}` ⚠️ **FIVE keys.** Controller resolution 5 grants `not_computable`: "could not compute at the last confirmed bar" and "something broke" are different facts to a member, and folding them is what makes a coverage report untrustworthy | see below |
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

### How this section was assembled, and what won where the drafts disagreed

Two drafts (`.superpowers/sdd/phase-e/plan-draft-e1-e3.md`, `…/plan-draft-e4-e7.md`) were reconciled against the design **including AMENDMENT 1, AMENDMENT 2, CORRECTION 1 and CORRECTION 2** — which win over anything earlier in that file — and against the `CONTROLLER RESOLUTIONS — 2026-08-09` at the tail of draft 1. Precedence, highest first:

1. the design's **corrections and amendments**;
2. the **controller resolutions**;
3. the design body;
4. whichever draft **measured** the disputed fact;
5. the drafts.

**Nine tasks, E-1 … E-9.** E-1…E-7 map 1:1 onto the design's architecture components E1…E7. **E-8 and E-9 are AMENDMENT 2 deliverables that neither draft carried** — the starter library (A2.1) and scan → chart in one click plus the Pine-parity acceptance path (A2.2 / A2.5).

---

### Preamble — every task below inherits this, on top of Global Constraints

The header's *Global Constraints*, *Review and test protocol* and *What each zero will NOT cover* apply to every task and are **not** restated per task. What follows is only what the header does not already carry.

**One writer per artifact, for the whole phase**

- 🔴 **`app/src/components/chart/engine/ast/closedTable.json` has EXACTLY ONE WRITER and it is E-1.** E-2 (`is_boolean_tree`), E-4 (`vocabulary()`) and E-5 (`_is_condition`) all *consume* the `yields` declaration E-1 writes. If these tasks are split across agents, **no task but E-1 touches the manifest**; a consumer that finds the declaration missing **refuses and reports**, and never hand-lists.
- `api/services/screener/scan_store.py` is written by E-2 and read by E-3/E-6/E-7.
- `api/services/screener/scan_evaluator.py` is written by E-3; E-6 adds the receipt call, E-7 adds the `limits` parameter. Neither re-implements it.

**Line endings — measured 2026-08-08, do not normalise**

- The repo default is **CRLF**. `docs/superpowers/plans/*.md` (this file) is **LF**.
- ⛔ **`app/src/components/chart/builder/` is LF-ONLY, every file**: `BuilderSheet.jsx` (622 LF / 0 CRLF), `BuilderSheet.test.jsx` (970/0), `BuilderSheet.edit.test.jsx` (535/0), `FormulaField.jsx` (274/0), `ConciergeBox.jsx` (200/0), `builderInputs.js` (40/0). **New files under `builder/` are written LF.**
- ⛔ **`api/services/definition_concierge.py` is LF-ONLY** (1053/0). `api/services/signature/ledger.py` is **CRLF** (429/429).
- `BuilderSheet.test.jsx:851` asserts the literal `'UNTIL\n// TASK 16 IT DELIBERATELY DID NOT'` — a source-text assertion that dies on a line-ending rewrite. A Python patch script on this repo **reads and writes BYTES** or it converts a whole file invisibly.
- Check with `git -c core.autocrlf=false diff` before assuming you changed endings.

**Discipline**

- **Every gate must be able to FAIL, and each states its positive control.** A zero with no control is a measurement of nothing.
- 🔴 **A wire-cut test per user-facing surface.** It must go red when the join is cut while both components stay correct. The shipped idiom is `BuilderSheet.test.jsx`'s Task-13 block: *"Rendering `ConciergeBox` on its own is what `ConciergeBox.test.jsx` already does twelve times, and all twelve stayed green for the entire time the feature was unreachable."*
- **Derive identifiers. AST or import-graph for structural claims, never a grep.** A grep counts comments and has done so in **both** directions on this branch.
- **Exit codes read bare, never through a pipe.** `| tail` has reported `EXIT=0` over a real failure here. A no-match `-k` exits **5**; a usage error exits **4** with zero tests run and **no `passed` token**, so `passed=None` must be disambiguated with `collected > 0`. ⚠️ `npx vitest --reporter=basic` **fails to start on vitest 4.0.18 and exits 0** — use the default reporter and read the counts.
- `PYTHONDONTWRITEBYTECODE=1` on every pytest run (a same-size mutation otherwise imports the previous `.pyc`). Frontend is `cd app && npx vitest run <paths>`, **never `npm test -- run`**.
- **CRLF makes a multi-line `\n` anchor match ZERO.** A refusal to match is loud; a silent survivor is not.
- ⛔ **Do not restate a number a test asserts.** Cite the constant by name (`EXPECTED_ROUTE_COUNT`, `EXPECTED_SCANS_ROUTES`, `EXPECTED_SCREENER_ROUTES`, `MAX_DEFINITIONS_PER_USER`, `REL_TOL`, `RETENTION_DAYS`) and let the test hold the integer. This spec has rotted twice on restated counts, and `tests/test_scan_screener_auth.py` has already moved from *"24 of 25"* to named constants.
- **Explicit-pathspec commits** — `git commit -m "…" -- <paths>`; a new untracked file needs a single-file `git add` first. Then `git diff --stat HEAD -- <path>` and **read the hunks**. `master` moves constantly (52 commits in one stretch on 2026-08-08) — fetch → merge → re-verify → push. **NEVER force.**

**The commands, run bare**

```bash
cd app && npm run build && npx vitest run          # build first: liveStyles.dist.test.js reads app/dist
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q
python tools/alert_replay.py --check               # the literal FIRE LOG MATCHES, exit 0
python tools/alert_replay.py --diff --mode-a forming --mode-b closed
python tools/ast_conformance.py --check
python tools/ast_conformance.py --escapes          # CLOSED, with a non-zero unguarded control
```

---

### Measured 2026-08-08/09 in this worktree — a dated record, not an assertion

**E-1 Step 1 re-measures all of these and every later task compares against E-1's numbers, never these.** This programme has corrected a prose count eight times.

| fact | measured | how |
|---|---|---|
| `closedTable.json` | **3** sections — `series` 5, `operators` 15, `functions` 11 = **31** names | `json.load` on the file |
| 🔴 `snapshot_db.COLUMNS` | **65**, not the design's 60 | `ast.literal_eval` on the module's own `COLUMNS` Assign node |
| `screener_rows` indexes | **8** (`sector market_cap uct_composite rs_rank above_50sma chg_pct_1d candle_type built_at`) | the `for idx in (…)` tuple in `init_db` |
| escape census | **CLOSED** · 0 escaped of 16 parsed · 1 `parser_refused` (`assignment`) · control 16 of 16 · `declared == fired` for all 16 · 0 lane disagreements · **exit 0** | `python tools/ast_conformance.py --escapes` |
| escape corpus / AST corpus | **17** cases each | `json.load` |
| `REL_TOL` | `1e-9`, `tools/ast_conformance.py:135` | read |
| `compute.fn` on the `ast` lane | **IS the `astHash`** — *"a 71-character `sha256:…` string that has no entry in `NATIVE_COMPUTE` and never will"* | `nativeRegistry.js:1246-1248` |
| 🔴 route gating | `screener.py` gated on all but one (`screener_shared`, a share-token route); `scans.py`, `user_definitions.py` and `signature.py` fully gated | AST census over `@router.*` decorators + each handler's `Depends`. ⛔ **The integers live in `tests/test_scan_screener_auth.py`'s named constants — read them there.** |
| screener nightly | `register_screener_jobs`, `CronTrigger(hour=3, minute=0, timezone=_ET)`, `max_instances=1`, gated `SCREENER_SNAPSHOT_ENABLED` default `"1"` | `api/main.py:957-976` |
| `cap_universe.json` | **3,742** tickers | `json.load` |
| canonical node vocabulary | **4** types, declared in **five** places across four files — `ast_interpret.NODE_TYPES:62`, `parse.js NODE_TYPES:49`, `parse.js CANONICAL_KEYS:369`, `user_definitions._CANONICAL_KEYS:233`, `ast_lint._CANONICAL_TYPES:254` | read each |
| the LF/CRLF split | as listed in the Preamble | `git -c core.autocrlf=false` byte counts |

⚠️ **Two ground-truth rows are stale and the tasks are written against the measurement, not the record.** GT §0.3 says the screener lane is ungated; it was gated in `4e2563bd`. Design §3 and GT §5.2 both say **60** screener columns; the list holds **65**. Neither changes an adjudication; both change a number a task would otherwise assert. ⛔ **Report them; do not edit `ground-truth.md`** — it is a dated recon record and rewriting it destroys the provenance the rest of the phase reads.

⚠️ **The canonical node count is a derived set, not a typed one.** Five declaration sites is what reading found. E-1 derives the set before assuming that is all of them — `lesson_probe_names_must_be_derived_not_typed`, four false alarms in one session.

---

### Contract symbols — derive at execution time, never type from here

E-4…E-9 consume symbols E-1…E-3 create. **Each consuming task carries a step that asserts the symbol exists and fails BY NAME if it moved.** The names below are this plan's decisions, not assumptions — draft 2 guessed `definition_results.py::read` and `definition_sweep.py::sweep`; **draft 1 created the real modules and draft 1 wins.**

| concept | the symbol | written by |
|---|---|---|
| the scalars section key | `ast_table.SCALARS_SECTION == "scalars"` | E-1 |
| the result-kind declaration | `yields` on every `operators` / `functions` / `scalars` entry | E-1 |
| the freshness verdict | `api/services/ast_freshness.freshness_for` / `freshness.js::freshnessFor` | E-1 |
| the boolean-tree test | `api/services/scan_definition.is_boolean_tree` | E-2 |
| the results store | `api/services/screener/scan_store.py` — `record_hits`, `record_coverage`, `hits`, `coverage`, `join_clause`, `prune` | E-2 |
| the evaluator | `api/services/screener/scan_evaluator.py` — `evaluate_one(definition, tf, *, universe=None, as_of=None)`, `run_sweep(definitions, tf="D")` | E-3 |

---

### File structure

**Frontend**

| file | responsibility |
|---|---|
| `app/src/components/chart/engine/ast/freshness.js` **(new, E-1)** | `FRESHNESS_MODES`, `scalarsIn`, `freshnessFor`. The JS half of the second verdict. |
| `app/src/components/chart/builder/criteria.js` **(new, E-4)** | **THE PICKER MODEL.** Pure. `toSource`, `fromAst`, `canonicalPicker`, `vocabulary`, `PickerRefusal`, `REFUSALS`. No React, no registry, no network. ⛔ LF. |
| `app/src/components/chart/builder/CriteriaPicker.jsx` **(new, E-4)** | The rows-and-groups surface. Writes `source` and nothing else. ⛔ LF. |
| `app/src/components/chart/builder/BuilderSheet.jsx` **(modify, E-4)** | One mode toggle, one new mount. ⛔ LF. |
| `app/src/components/chart/builder/BuilderSheet.criteria.test.jsx` **(new, E-4)** | 🔴 **THE WIRE-CUT FILE.** Every case drives the picker *through the sheet*. ⛔ LF. |
| `app/src/components/screener/CoverageLine.jsx` **(new, E-4)** | Renders `{evaluated, answered, dropped, not_computable}`. **E-4 creates it** (E-4 owns the scan surface); **E-7 extends it** with `withheld`. |
| `app/src/components/chart/builder/ConciergeBox.jsx` **(modify, E-5)** | `kind` passthrough; the read-back stays the tree's. ⛔ LF. |
| `app/src/components/chart/engine/ast/conceptVocabulary.json` **(new, E-5)** | 🔴 AMENDMENT 1 — the curated, **versioned** concept vocabulary, as DATA. |
| `app/src/pages/…/StarterLibrary.jsx` **(new, E-8)** | The starter-scan gallery. Path fixed at E-8 Step 1 from the surface that hosts the builder. |

**Backend**

| file | responsibility |
|---|---|
| `api/services/ast_freshness.py` **(new, E-1)** | `FRESHNESS_MODES`, `scalars_in`, `freshness_for`. |
| `api/services/scan_definition.py` **(new, E-2)** | `is_boolean_tree`, `def_hash`, `assert_scannable`, `ScanRefused`. |
| `api/services/screener/scan_store.py` **(new, E-2)** | The narrow side table + the receipt. |
| `api/services/screener/scan_evaluator.py` **(new, E-3)** | The sequential, off-request-path sweep. |
| `api/services/concept_vocabulary.py` **(new, E-5)** | The Python reader over `conceptVocabulary.json`, mirroring `ast_table.py`. One file, both lanes. |
| `api/services/definition_concierge.py` **(modify, E-5)** | `kind='indicator'\|'scan'`; the scan-condition stage; concept resolution; the scalars enum arrives by derivation. ⛔ LF. |
| `api/services/starter_library.py` **(new, E-8)** | Resolves `SETUP_GROUPS` + `lookup_playbook` into ordinary definitions. |
| `api/services/definition_record.py` **(new, E-6)** | The member-independent record: `record_evaluation`, `covers`, `latest_evaluation`, `prune`, `horizon`, `claim_for`. |
| `api/services/signature/ledger.py` **(NOT modified by E-6)** | Named here to say so. ⛔ CRLF. |
| `api/services/entitlements.py` **(new, E-7)** | `TOOLKITS`, `Limits`, `limits_for`, `apply_symbol_cap`, `apply_history_cap`, `check_definition_count`. |

**Docs / fixtures**

| file | responsibility |
|---|---|
| `tests/fixtures/ast/scalars.json` **(new, E-1)** | The scalar coverage floor's fixture — its own artifact, not the bar corpus. |
| `tests/fixtures/criteria/must_refuse.json` **(new, E-4)** | Trees the picker MUST refuse, each with its guard. Non-empty, asserted. |
| `docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md` **(new, E-6)** | The eleven conditions, five marked member behaviour, each with evidence. A rail reads its `**Status:**` line. |
| `docs/decisions/2026-08-08-toolkit-gating-axes.md` **(new, E-7)** | 🟡 **OPEN** — the axes and the numbers, for the owner. |
| `docs/runbooks/definition-record.md` **(new, E-6)** | How to read a claim; what each refusal means; the retention horizon and how to move it. |

---

### Adjudications this plan makes

Numbered `E4-A*` … `E9-A*` so they cannot be confused with the design's settled `E-A1…E-A9`. Each states the measurement it rests on.

**E4-A1 — the picker is a VIEW over the AST. Nothing picker-shaped is ever persisted. ✅**
**Measured:** `defSchema.validateCompute` (`:584`, `:637`) already requires `compute.source` to **parse back to `compute.ast`, compared by hash**; `astHash` (`parse.js:476`) is `sha256` over the canonical tree's stable JSON, so *"key order, whitespace and argument spacing must not reach it"*. A stored picker shape would be a **third** artifact beside `ast` and `source`, and the three would drift with nothing to say so. The picker is reconstructed from the tree on open, every time. **That is what makes the round-trip a correctness requirement rather than a nicety:** if the picker were stored, a lossy reconstruction would be invisible; because it is derived, a lossy reconstruction is the thing the user sees.

**E4-A2 — the picker emits SOURCE TEXT and goes through `parseFormula`. There is no second tree-maker. ✅**
**Measured:** there is **no AST printer in the JS lane** — a search for `formulaFor|printFormula|sourceFor|unparse` under `engine/ast/` and `builder/` returns only an unrelated comment. Python has one (`definition_concierge.formula_for`, fully parenthesised, `:450`) and `test_the_SOURCE_the_concierge_derives_PARSES_BACK_to_the_tree` is its gate. So the picker spells **source**, fully parenthesised, and `parseFormula` makes the tree — the same parser, debounce, budget walk, linter, read-back and Save button. D-A1 untouched.
⚠️ **A consequence worth stating positively:** the picker's spelling and the concierge's spelling of one tree may differ in whitespace, and that is **not** a divergence — `compute.fn` is `astHash` over the canonical tree, so two spellings of one tree are **one `def_hash` and one scan.** No cross-lane byte-identity rail is owed for the spelling, and one would gate a property nothing depends on.

**E4-A3 — `fromAst` is PARTIAL and refuses BY NAME. It never approximates. ✅**
A picker that silently drops a term it cannot show **is** the TC2000 PCF seam one hop earlier: the user sees a picker, edits it, saves, and the formula they saved is not the formula they had. So `fromAst` returns `{ok: false, guard, reason}`, the sheet renders *"this formula is beyond the picker — edit it as a formula"*, and the picker stays **empty rather than half-right**.

**E4-A4 — ONE sheet, ONE write door. The picker is a MODE of `BuilderSheet`, not a second surface. ✅**
**Measured:** `BuilderSheet.jsx`'s save path is `buildDefinition → validateUserDefinitions → saveUserDefinition → installUserDefinitions`, and its own header records why editing reuses it verbatim: *"A second save routine would be a second set of gates to keep in step, which is the shape this phase retires."*

**E4-A5 — the join surface is E-4's, and E-4 takes it. ✅** *(controller resolution 7)*
E-2 ships `join_clause` as a parametrized fragment and no wiring. **E-4 decides** whether a scan is a `filters.FILTERS` entry, a new filter TYPE, or its own endpoint, and registers it so E-7's derived route census covers it. ⛔ Whatever takes the fragment **cannot build SQL from a client string** — `filters.column_for` / `is_valid_op` gate every existing query for exactly that reason, and `def_hash` is the one value here a client could ever supply.

**E5-A1 — the concierge is extended by DATA, not by code. ✅**
**Measured:** `tool_schema()` (`definition_concierge.py:195`) builds its enums by iterating `ast_table.{SERIES,OPERATORS,FUNCTIONS}_SECTION`; `test_a_PLANTED_manifest_entry_reaches_the_schema_BY_NAME_with_no_edit_here` plants `zzPlantedFn`/`zzPlantedSeries`/`zz~` in a synthetic manifest and requires them back; `test_no_declared_FUNCTION_or_SERIES_name_is_a_string_constant_in_this_module` is an AST walk with its own positive control. So `scalars` must reach the enums **with no edit to the concierge**.

**E5-A2 — D-A5's property survives, re-asserted structurally, and its control is strengthened. ✅**
**Measured:** the rail exists (`test_the_concierge_NEVER_produces_the_sentence`, `tests/test_definition_concierge.py:347`) and so does its control (`:363`). E-5 keeps both, extends the subject to the scan path, and adds the second half: the control must report the offender **by name** and the rail must be shown to pass on the clean synthetic **in the same test**.

**E5-A3 — the concept vocabulary is DATA in ONE file, read by both lanes, and a concept EXPANDS AT SAVE TIME. ✅** *(AMENDMENT 1)*
Not prompt text. `conceptVocabulary.json` sits beside `closedTable.json` and `api/services/concept_vocabulary.py` reads it the way `ast_table.py` reads the manifest — for the same reason: two vocabularies is the defect this repo has measured twice. **A resolved concept expands into its tree at save time; the scan stores the TREE and the word is provenance.** An ungroundable concept is **refused by name**, never approximated.

**E6-A1 — one record, two halves. E-6 does not create a second verdict store. ✅**
*"This rule evaluated this symbol over this window **and here is what it said**"* is two facts with two lifetimes: **what it said** is E-2's narrow side table (it exists; E-6 reads it) and **that it looked** is new. `signature_coverage` (`ledger.py:115`) is the shape, generalised into a **sibling table in the same database**, `definition_coverage`.
⛔ **NOT by widening `signature_coverage`.** Its key is `(indicator, version, …)` where `indicator` is a Signature rule address (`dpl`/`gxw`/`fcb`) or an alert-lane canonical address, and `version` is `rules.VERSIONS[...]`. Putting a `def_hash` in that column gives it two meanings and `latest_coverage()` would answer across two namespaces.

**E6-A2 — retention is a HORIZON, and beyond it the claim REFUSES rather than shrinks. ✅**
**Measured:** `alert_shadow_fires` is the counter-example the design forbids building on — **53.0 bytes/row**, no prune at the time of measurement, **279 GB/yr at 10k alerts**. (`alert_shadow_log.py` has since grown `prune_shadow` at `:253` and a throttled `_maybe_prune` at `:275` — a prune-by-age, one `DELETE … WHERE recorded_at < ?`. That shape is the one E-6 copies.)
🔴 **And the part that is not obvious:** a prune-by-age on a *coverage* table silently converts *"proven evaluated"* into *"never evaluated"* — fine — and converts *"here is the hit rate"* into *"here is a smaller hit rate over the surviving window"*, which is a lie of exactly §1.6's shape reached by arithmetic. So the horizon is a **declared fact the claim surface reads**: outside it, `coverage: "unproven"` and `hit_rate: None`. **Never 0, never a shrunken number.**

**E6-A3 — member-independence is STRUCTURAL, not intended. ✅**
The record's key carries no `user_id`, no `alert_id`, no `active`, no snooze state — and a test asserts the **column set read out of `sqlite_master`**, not out of a docstring. Plus an import-graph rail: `claim_for` must be **unable to reach `signature_signals`**, with a positive control that reports a synthetic offender by name.

**E6-A4 — every number accrues AFTER creation. Forward-only, and a hypothetical never shares a surface with a receipt. ✅** *(AMENDMENT 2 A2.3)*
`record_evaluation` refuses a window that begins before the definition's own creation time. An edited scan starts a **new** record because `def_hash` changed and the old record belongs to different maths — D-A3's rev semantics give this for free. ⛔ **No backfilled "what it would have done" number may share a surface with a forward one**, be summed with one, or be returned by `claim_for` at all.

**E7-A1 — entitlement gates breadth where breadth is PRODUCED, never where it is displayed. ✅**
**Measured:** the shipped gate is per-handler `Depends(require_paid)` — declared **six** separate times (`desk.py:53`, `education.py:173`, `scans.py:44`, `screener.py:66`, `signature.py:174`, `user_definitions.py:42`), each with its own 402 sentence, deliberately (`test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one`). It is **binary and per-route**; a toolkit is per-user and per-axis, and the only precedent for that is `alert_user_series.scoped_key(user_id, address)` (`:209`). So the cap is applied **in the sweep and in the store**, and the response reports it. A UI that hides rows is not entitlement: the rows were computed, they cost the pod, and a client can ask for them.

**E7-A2 — the numbers live in ONE table with an `OWNER:` comment, and the mechanism is testable without them. ✅**
Every E-7 test drives **synthetic toolkits built in the test**, so the mechanism is proven while the shipped table still holds one ungated toolkit. That is what lets E-7 ship before §8.4 is answered.

**E7-A3 — "nobody is sold a worse RSI" is a MACHINE GATE. ✅**
Spec §1.4: *gate breadth, never mechanics*. Asserted as: the same definition, the same symbol, the same bars, evaluated under the smallest and the largest toolkit → **bit-identical** values, `repr()` for `repr()`. A gate that cannot fail is no gate, so its control is a planted toolkit that *does* perturb the compute and must be caught by name.

**E8-A1 — a starter scan is an ORDINARY definition, and there is no starter flag anywhere on the definition. ✅** *(AMENDMENT 2 A2.1)*
Same store, same `def_hash`, same read-back, editable on arrival. Provenance (which setup a starter came from) lives on the **catalog** row, never on the definition. ⛔ A starter that is special-cased is a second class of object and re-creates the asymmetry §1.1 forbids — and it is exactly the shape `registry_defs`' `SHIPPED_DEF_IDS` rail already guards against on the native side.

**E9-A1 — scan → chart carries the DEFINITION, not a symbol. ✅** *(AMENDMENT 2 A2.2)*
The claim *"the formula you charted is the scan you ran"* is only believable when a member **sees it**, so the click hands the chart the **same `def_hash`** the scan ran and the chart draws that definition. ⛔ Handing over only the ticker would make the two surfaces agree by coincidence.

---

### Sequencing addendum for E-8 and E-9

The header's diagram is the design's and predates AMENDMENT 2. The two added tasks slot as:

```
E-4 criteria builder ──┬──> E-5 NL + concept vocabulary ──> E-8 starter library
                       └──> E-9 scan → chart (needs E-3's results and E-4's surface)
```

**E-8 depends on E-5** (the same `SETUP_GROUPS` + `lookup_playbook` grounding serves both, and building it twice is the defect). **E-9 depends on E-3 and E-4.** Neither depends on E-6 or E-7, and both may be executed before them; they are numbered last because they were added last, not because they are sequenced last.

---

# Task E-1: `scalars` in the closed table — a fourth section, both lanes, and a second verdict because the first one returns a true zero to a question nobody asked

**Files:**
- Modify: `app/src/components/chart/engine/ast/closedTable.json` *(sole writer for the phase)*
- Modify: `api/services/ast_table.py`, `api/services/ast_interpret.py`, `api/services/ast_lint.py`
- Modify: `app/src/components/chart/engine/ast/interpret.js`, `lint.js`, `sentence.js`, `defSchema.js`, `nativeRegistry.js`
- Create: `api/services/ast_freshness.py`, `app/src/components/chart/engine/ast/freshness.js`
- Create: `tests/test_ast_scalars.py`, `tests/fixtures/ast/scalars.json`
- Create: `app/src/components/chart/engine/ast/freshness.test.js`
- Modify: `tests/test_ast_lint.py`, `tests/test_ast_interpret.py`, `tools/ast_conformance.py` (the scalar coverage floor only)

**Interfaces:**
- Produces:
  ```python
  # api/services/ast_table.py
  SCALARS_SECTION = "scalars"
  def declared_names(manifest=None) -> set            # WIDENS: now unions four sections
  def bar_names(manifest=None) -> set                 # NEW: series|operators|functions — the BAR-corpus floor
  def scalar_source(name, manifest=None) -> Mapping   # {"store","column"}; raises KeyError otherwise
  def scalar_as_of(name, manifest=None) -> Mapping    # {"column","grain"}
  def yields_of(name, manifest=None) -> str           # "bool" | "num" | "passthrough"

  # api/services/ast_interpret.py  — SIGNATURE CHANGE
  def interpret(ast, bars, inputs=None, budget=None, scalars=None) -> list[float | None]

  # api/services/ast_freshness.py
  FRESHNESS_MODES = ("live", "as-of-snapshot", "unknown")
  def scalars_in(tree, opts=None) -> set
  def freshness_for(tree, opts=None) -> dict          # {"mode","scalars","cadences","reasons"}
  ```
  ```js
  // app/src/components/chart/engine/ast/freshness.js
  export const FRESHNESS_MODES = Object.freeze(['live', 'as-of-snapshot', 'unknown'])
  export function scalarsIn(tree, opts)
  export function freshnessFor(tree, opts)            // same shape, same three values, asserted equal to Python
  // interpret.js — SIGNATURE CHANGE
  export function interpret(ast, bars, inputs, budget, scalars)
  ```
- Consumes: `api/services/screener/snapshot_db.COLUMNS` — **read by AST, never typed** (Step 3's totality rail).

**Must not touch:** `api/services/screener/snapshot_builder.py`, `query.py`, `filters.py`; `tools/alert_replay.py`; `api/services/indicator_alert_evaluator.py`; anything under `api/routers/`. E-1 adds vocabulary and a verdict; it wires nothing to a surface and it registers no scalar-bearing definition.

**SOLO. 🔴 E-1 gates every other task in the phase.**

---

⏳ **OWNER — E-A9: does the closed table also gain FUNCTIONS?** *(design CORRECTION 1, still OPEN)*
A user **cannot compose an RSI** from the eleven primitives — Wilder smoothing is a recursion `sma`/`ema`/`change` cannot express. So a member can *use* the shipped `rsi` indicator but cannot *write* one, and cannot write one with their own period inside a scan. The controller's recommendation is **scalars only for E-1, with a declared function set scoped as its own follow-on phase**, because adding functions touches the repaint linter's central guarantee (`maxLookback` must stay a **tree sum**) and deserves its own gate rather than riding inside a vocabulary task. ⛔ **E-1 DOES NOT BUNDLE THEM.** `functions` still holds its eleven when E-1 finishes, and E-4 Step 1 stops if it does not. **The owner decides whether the follow-on phase happens and when; no task in this plan may add a function.**

⏳ **OWNER — string literals, and therefore sector/industry filtering.** *(controller resolution 1 → design §8)*
`closedTable._booleans`: *"a table whose only literal is a number."* So `sector == "Technology"` is **inexpressible**, and the TEXT columns cannot be scalars — this is a grammar fact, not a preference. **Sector/industry filtering stays in the classic screener UI.** Granting string literals would touch the parser, BOTH interpreters, the linter and the read-back: a phase of its own, not a task. Flagged for design §8.

⏳ **OWNER — design §8.5, cadence.** *"Is nightly 03:00 right for definition columns, or do scans need intraday?"* This drives cost, E-7's `refresh cadence` axis, **and the whole freshness contract.** The three-valued badge below is the hedge that does not presume the answer; it is not a substitute for it.

---

- [ ] **Step 1: Re-measure, and record the numbers this task is allowed to move**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b2-engine
python tools/ast_conformance.py --escapes;  echo "EXIT=$?"     # CLOSED / 0 escaped / control non-zero / exit 0
python tools/ast_conformance.py --check;    echo "EXIT=$?"
python tools/alert_replay.py --check;       echo "EXIT=$?"     # FIRE LOG MATCHES
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_lint.py tests/test_ast_interpret.py \
    tests/test_ast_budget.py tests/test_ast_conformance.py -q; echo "EXIT=$?"
cd app && npx vitest run src/components/chart/engine/ast; echo "EXIT=$?"
```

⛔ **Read every exit code bare.** `| tail` reported `EXIT=0` over a real failure on this branch.

Then derive, and write the found sets into this task's report rather than into a doc:

```bash
PYTHONDONTWRITEBYTECODE=1 python - <<'PY'
import ast, io, json
src = io.open('api/services/screener/snapshot_db.py', encoding='utf-8').read()
cols = next(ast.literal_eval(n.value) for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', None) == 'COLUMNS')
print('COLUMNS', len(cols), sorted(cols))    # measured 65 on 2026-08-09
t = json.load(io.open('app/src/components/chart/engine/ast/closedTable.json', encoding='utf-8'))
print({k: len(v) for k, v in t.items() if isinstance(v, dict)})
PY
```

⚠️ **Also derive the column TYPES**, because the granted set is defined by type (controller resolution 1) — read them off `snapshot_db`'s own `CREATE TABLE` text by AST/`PRAGMA table_info` on a fresh temp db, never by eye.

- [ ] **Step 2: Write the failing tests — the three that decide the task, safety first**

`tests/test_ast_scalars.py`:

```python
def test_a_declared_but_MISSING_scalar_is_a_HOLE_not_a_REFUSAL():
    """⛔ THE DISTINCTION THE WHOLE COVERAGE CONTRACT RESTS ON, ONE LEVEL DOWN.

    `market_cap` is DECLARED for every symbol and PRESENT for only some. A symbol
    whose row has NULL there must evaluate to a NaN column — the formula RAN and
    the answer is "not computable" — and must NOT refuse at `resolve:name`, which
    is the answer for a name the table never declared. Those are different facts
    and E-3 reports them in different buckets (`answered` vs `not_computable`).

    ⛔ AND NOT 0. `scan_volume._job` sets `m = {}` on a failed reference, which is
    why "a failed reference is indistinguishable from an empty market" — a NULL
    market cap read as 0 makes `market_cap > 1e9` a confident False.
    """
    ast_tree = {"type": "op", "name": ">", "args": [
        {"type": "series", "name": "market_cap"}, {"type": "num", "value": 1e9}]}
    present = ast_interpret.interpret(ast_tree, BARS, scalars={"market_cap": 2e9})
    missing = ast_interpret.interpret(ast_tree, BARS, scalars={"market_cap": None})
    assert present[-1] == 1.0
    assert missing[-1] is None                       # a hole, on the wire
    with pytest.raises(ast_interpret.TableRefusal, match="unknown name"):
        ast_interpret.interpret(
            {"type": "series", "name": "rugpull_score"}, BARS, scalars={})


def test_the_scalar_section_PARTITIONS_snapshot_db_COLUMNS_exactly():
    """⛔ THE FLOOR IS DERIVED FROM THE SUBJECT, AND BOTH HALVES ARE REQUIRED.

    A declared list and an excluded list that together do not equal COLUMNS is a
    list of what somebody remembered — the DPC shape, where four constants rode
    outside `test_all_constants_match_owner_spec` for the rule's entire life. With
    this identity, a 66th screener column lands RED here until somebody DECIDES
    about it, which is the only thing that keeps the vocabulary honest as the
    screener grows.
    """
    columns = set(_columns_by_ast('api/services/screener/snapshot_db.py'))
    declared = {s['source']['column'] for s in TABLE['scalars'].values()}
    excluded = set(TABLE['_scalars_excluded'])
    assert declared | excluded == columns, (
        f"unpartitioned: {sorted(columns - declared - excluded)}")
    assert not (declared & excluded), sorted(declared & excluded)


def test_every_EXCLUDED_column_is_excluded_for_a_TYPE_reason_or_a_PROVENANCE_reason():
    """⛔ CONTROLLER RESOLUTION 1, MADE MACHINE-CHECKABLE.

    The granted set is 'the NUMERIC AND BOOLEAN subset only', and the reason the
    TEXT columns are out is a GRAMMAR FACT: `closedTable._booleans` — 'a table
    whose only literal is a number' — so `sector == "Technology"` is
    INEXPRESSIBLE. An exclusion list that is merely a list would let somebody
    quietly exclude a numeric column they found inconvenient.

    So every excluded column must be EITHER of a non-numeric storage type OR one
    of the three provenance stamps, and the check reads the TYPES, not the names.
    """
    types = _column_types_by_pragma()          # derived from a fresh temp db
    provenance = {'snapshot_date', 'bars_asof', 'built_at'}
    for col in TABLE['_scalars_excluded']:
        assert types[col] == 'TEXT' or col in provenance, (
            f"{col} is {types[col]} and is not provenance — it is grantable, so "
            "granting it is a decision somebody has to take on the record")


def test_a_scalar_tree_is_non_repainting_AND_as_of_snapshot__both_verdicts_or_neither():
    """⭐⭐ THE HEADLINE OF THIS TASK, AND THE ZERO IS THE POINT.

    `ast_reach` returns (back 0, forward 0) for a scalar leaf, so `mode_from_reach`
    answers `non-repainting` — and that answer is CORRECT and E-1 does not change
    it. A scalar's value at bar `i` does not depend on any bar `j > i`; it is the
    same number at every bar of the column.

    ⛔ WHICH MEANS THE REPAINT GATE CANNOT FAIL ON A SCALAR. `validateAstLane`'s
    GATE 3 passes `market_cap > 1e9` with `non-repainting` and no gate fires at
    all. The zero is a true answer to a question nobody asked, and without a
    second verdict there is NO gate on the honesty of a scalar — which is exactly
    why `meta.freshness` is a GATE and not a label.
    """
    tree = parse_fixture('market_cap_gt_1b')
    assert ast_lint.lint_repaint(tree)['mode'] == 'non-repainting'
    assert ast_freshness.freshness_for(tree)['mode'] == 'as-of-snapshot'
    assert ast_freshness.freshness_for(parse_fixture('sma_of_close'))['mode'] == 'live'
```

- [ ] **Step 3: Run them, then write the manifest section**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_scalars.py -q; echo "EXIT=$?"
```
Expected: FAIL — `KeyError: 'scalars'`. ⚠️ Exit **5** means the path selected nothing and is **not** a red; exit **4** is a usage error. Read the code, not the word.

`closedTable.json` gains a **fourth** section. ⚠️ The design's §3 heading calls it *"a third section"* while its own next sentence counts three sections already; the manifest has three today and this makes four. **The count in the heading is wrong; the decision (E-A7) is not** — and the controller has recorded the correction.

```jsonc
  "_scalars": "A SCALAR IS A DIFFERENT KIND FROM A SERIES AND THE TABLE SAYS SO IN ITS OWN SECTION. `close` is a time series: one number per bar, and the number at bar i is a fact about bar i. `market_cap` is ONE NUMBER PER SYMBOL, dated to a nightly snapshot, and it is the SAME number at every bar of the column -- including at bars that closed before the snapshot was taken. Conflating them is the `chart_settings` vs `charts_workspace_layout` category error: two things with the same shape and different identities.",
  "_scalars_node": "A SCALAR RIDES THE `series` NODE TYPE AND THE CANONICAL VOCABULARY STAYS FOUR. `parse.js` turns every identifier into a `series` node deliberately (so the parser needs no table) and resolution is `interpret`'s job; a `scalar` node type would be a FIFTH type in five declaration sites, and every stored tree's `astHash` is taken over `{type,...}` -- so a fifth type is a decision that can never be undone without a migration of every persisted definition. `ast_lint` already resolves a DECLARED SCALAR (a definition input) to reach (0,0); a table-declared scalar is the same shape with a wider declaration source.",
  "_scalars_as_of": "`as_of` NAMES A COLUMN, NEVER A DATE. Freshness is PER SYMBOL -- one ticker's row can be a month older than another's -- so the declaration points at the row column that carries the value's own date. TWO FAMILIES EXIST AND THEY ARE NOT THE SAME DATE: fundamentals and ratings are dated by `snapshot_date` (when the build ran) and technicals/candles/patterns by `bars_asof` (the newest bar the maths saw). A single as-of would over-claim one family or under-claim the other.",
  "_scalars_excluded_why": "THE GRANTED SET IS THE NUMERIC AND BOOLEAN SUBSET ONLY, AND THE TEXT COLUMNS ARE OUT BY GRAMMAR RATHER THAN BY PREFERENCE. `_booleans` says this table's only literal is a number, so `sector == \"Technology\"` is INEXPRESSIBLE -- granting it would touch the parser, both interpreters, the linter and the read-back. Sector/industry filtering stays in the classic screener UI until that is its own phase.",
  "_yields": "`yields` DECLARES WHAT AN EXPRESSION'S VALUES CAN BE -- `bool` (a 0/1 column), `num`, or `passthrough` (the ternary alone, whose result kind is the join of its branches). It is HERE rather than in a reader because a SCAN is `<ast> != 0` on a 0/1 column (`_booleans`), and deciding whether a tree is boolean from a hand-list of `which operators are comparisons` is the list-that-rots shape -- and it would be that list TWICE, once in Python and once in JS, which is `williams_r` vs `williamsR` exactly. Declared here, `is_boolean_tree`, the picker's comparator set and the concierge's scan gate are all DERIVED. `bool` means a 0/1 COLUMN, not a new node type.",
  "scalars": {
    "market_cap": {
      "source":   { "store": "screener_rows", "column": "market_cap" },
      "as_of":    { "column": "snapshot_date", "grain": "date" },
      "cadence":  "nightly",
      "yields":   "num",
      "sentence": "the market capitalisation"
    },
    "above_50sma": {
      "source":   { "store": "screener_rows", "column": "above_50sma" },
      "as_of":    { "column": "bars_asof", "grain": "date" },
      "cadence":  "nightly",
      "yields":   "bool",
      "sentence": "whether the price is above its 50-day average"
    }
  },
  "_scalars_excluded": {
    "ticker":        "the row's identity, not a value a formula reads",
    "company":       "TEXT; the table's only literal is a number",
    "sector":        "TEXT; see `_scalars_excluded_why`",
    "industry":      "TEXT; see `_scalars_excluded_why`",
    "exchange":      "TEXT; see `_scalars_excluded_why`",
    "ma_stack":      "TEXT; a stack DESCRIPTION, not a number",
    "candle_type":   "TEXT; a label, and comparing it needs a string literal",
    "patterns":      "a comma-joined LIST, not a scalar. Expressing membership needs a `contains` the table does not declare",
    "snapshot_date": "an `as_of` SOURCE. Declaring it as a scalar would let a formula compute on its own freshness stamp",
    "bars_asof":     "the same, for the bar-dated family",
    "built_at":      "an operations timestamp; it dates the WRITE, not the value"
  }
```

🔴 **WHICH columns are granted is SETTLED: the numeric and boolean subset only** *(controller resolution 1)*. The two entries above are the two **shapes** (a `snapshot_date`-dated `num` and a `bars_asof`-dated `bool`) so the rails have something to bite on; the full granted set is **derived** — every column in `COLUMNS` that is not in `_scalars_excluded`, with its family deciding its `as_of`. The task's deliverable is the **partition identity** plus the type rail, which together make a 66th column land red until somebody decides about it.

Also in this step, add `"yields"` to **every** existing `operators` and `functions` entry:
`>`,`<`,`>=`,`<=`,`==`,`!=`,`&&`,`||`,`!` → `"bool"` · `+`,`-`,`*`,`/`,`u-` → `"num"` · `?:` → `"passthrough"` · `crossOver`,`crossUnder` → `"bool"` · the other nine functions → `"num"`.

> ⚠️ **A reconciliation, recorded because two drafts named one field two things.** Draft 1 called this field `domain` with values `01`/`real`/`passthrough`; the design's **CORRECTION 2 fixes the name as `yields`** and the controller resolution confirms E-1 as its single writer with E-2 as a consumer. **One field ships, named `yields`**, carrying draft 1's three-valued vocabulary spelled `bool`/`num`/`passthrough` — the third value exists because `?:` is in the `operators` section and its result kind is genuinely a function of its arguments, which a strict `num|bool` cannot express. ⛔ **Two fields declaring one fact would be the two-vocabularies defect this whole section exists to prevent.**

**E-2, E-4 and E-5 consume `yields` and may not write it.**

- [ ] **Step 4: Both lanes read it — and the ORDER of the three consults is declared, not incidental**

`ast_table.py` gains `SCALARS_SECTION`, and **`declared_names()` widens while a new `bar_names()` does not**:

```python
def bar_names(manifest=None) -> set:
    """The names a BAR-CORPUS case can exercise: series|operators|functions.

    ⛔ SPLIT FROM `declared_names` DELIBERATELY, AND THE SPLIT IS THE WHOLE
    REASON THE CONFORMANCE LOG STAYS BYTE-IDENTICAL. `assert_corpus_covers_the_table`
    demands a corpus case per declared name and ABORTS the recorder otherwise. A
    scalar has no bar behaviour and no value in `replay_bars.json`, so folding it
    into that floor would force ~N new bar-corpus cases, change ~N per-ast digests,
    and re-freeze an oracle for a reason that has nothing to do with bars. Scalars
    get their OWN floor (`tests/fixtures/ast/scalars.json`) against their OWN
    fixture, and the committed digests do not move.
    """
```

`ast_interpret.interpret` gains `scalars=None` and seeds the scope **after** the series and **before** the inputs:

```python
    # ⭐ A DECLARED SCALAR IS ALWAYS IN SCOPE. Present or absent, the name
    # RESOLVES -- an absent value seeds a NaN column, exactly like a bar with a
    # missing field ("a missing field is NOT a price of zero; it is a bar we
    # cannot compute on"). That is what separates "declared but not known for
    # this symbol" (a hole E-3 counts as `not_computable`) from "a name this
    # table never declared" (`resolve:name`, a formula defect).
    #
    # ⛔ AND `inputs` IS SEEDED AFTER, SO THE SHADOW CHECK SEES IT. An input
    # named `market_cap` must RAISE, the same ValueError a `close`-shadowing
    # input already raises -- a definition whose knob silently outranks a table
    # name changes what its formula means with nothing red.
    provided = scalars or {}
    for name in TABLE[SCALARS_SECTION]:
        v = provided.get(name)
        scope[name] = float(v) if (_is_number(v) and math.isfinite(float(v))) else NAN
```

⚠️ `scope[name]` here is a **scalar float, not a column** — `_lift1/2/3` already broadcast a scalar against a column, and `_to_column` already fills a length-`n` column from a bare number. A scalar-only tree (`market_cap > 1e9`) is therefore a flat 0/1 column of `len(bars)`, which is what makes it composable with `close > sma(close, 20)`.

`interpret.js` mirrors it, and `parse.js` **does not change** — identifiers already canonicalise to `series` nodes and the file's own comment says why validation does not belong there (*"Refusing them here would move three census cases out from under the guard that is supposed to catch them"*).

`ast_lint.py`'s `series` branch and `lint.js`'s twin gain the third consult, with the order written down:

```python
            # ⛔ TABLE SERIES, THEN TABLE SCALARS, THEN THE DEFINITION'S OWN
            # INPUTS -- and the order is load-bearing for the same reason the
            # existing two-way order is. `interpret` RAISES on an input that
            # shadows a table name, so the three sets are disjoint by
            # construction; what this must never do is let the ANSWER depend on
            # which map was consulted second.
            if isinstance(name, str) and name in series_names:
                reach_of[id(node)] = (0, 0)
            elif isinstance(name, str) and name in scalar_names:
                # ⭐ THE SAME (0,0) AS A DECLARED INPUT, AND FOR THE SAME REASON:
                # one number for the whole column depends on no bar at all, least
                # of all a later one. THE FRESHNESS QUESTION IS ASKED ELSEWHERE.
                reach_of[id(node)] = (0, 0)
```

`sentence.js::renderName` gains the same third consult in the same order, reading `scalars[name].sentence`, so the read-back says *"the market capitalisation is above 1,000,000,000"* rather than printing the raw column name.

- [ ] **Step 5: The second verdict — `meta.freshness`, machine-derived, refused in BOTH directions**

`api/services/ast_freshness.py` + `freshness.js`, mirrored the way `ast_lint.py` and `lint.js` are, over the SAME manifest, with `tests/test_ast_lint.py`'s cross-lane runner extended to cover both:

```python
FRESHNESS_MODES = ("live", "as-of-snapshot", "unknown")
#: live           -- every leaf reads the bar it draws on. No scalar in the tree.
#: as-of-snapshot -- at least one leaf is a declared scalar. The value is fixed
#:                   between snapshot builds and is IDENTICAL AT EVERY BAR of the
#:                   column, including bars that closed before the build ran.
#: unknown        -- a leaf declares a cadence this reader cannot resolve.
#:                   FAIL-CLOSED = the STALEST claim, mirroring `repaints`.
```

🔴 **Three values and no cadence string in the badge, on purpose.** Design §8.5 is an **open owner question** (see the ⏳ OWNER block above), and a badge that spelled `snapshot:nightly` would bake an unresolved decision into a persisted, user-visible field. The cadence lives per-scalar in the manifest and reaches the user through the read-back sentence, where changing it is not a data migration.

🔴 **And it is a CADENCE claim, not a staleness measurement.** `ast_lint`'s module rule is *"NO EXECUTION, EVER … an empirical 'we ran it and nothing moved' is a statement about one bar window; the claim on the badge is universal."* The badge answers *how fresh this column CAN be*; how fresh a given symbol's row **is** is a per-row runtime fact read off the `as_of` column, and it belongs in E-2's stored row and E-3's result envelope — **not** in the badge.

Then, mirroring `meta.repaint` exactly:

- `defSchema.js` — `export const FRESHNESS_MODES = Object.freeze(['live','as-of-snapshot','unknown'])`, and `meta.freshness` goes through `checkVocabulary` in the same block that already guards `meta.repaint` (line ~690), with the same reason: *"a truth claim about the maths that a user makes decisions on … a future value has to arrive with a schema bump, not by luck."*
- `defSchema.js` — **`plots[].freshness` is REFUSED BY NAME**, the identical clause to `plots[].repaint` (`:1192-1200`), with the identical argument: a badge is the linter's MEASUREMENT, and a field an author fills in by hand is the audited metadata this whole apparatus exists to replace. ⚠️ Phase D Task 15 measured what happens otherwise: a `plots[].repaint` was *"accepted and ignored"* — preserved by the unknown-key policy, read by nothing.
- `nativeRegistry.js::validateAstLane` gains **GATE 5**, refusing in both directions:

```js
  // ⭐⭐ GATE 5 — FRESHNESS, AND IT IS REFUSED IN BOTH DIRECTIONS BECAUSE
  // UNDER-CLAIMING IS AS FALSE AS OVER-CLAIMING. GATE 3 says the same about the
  // repaint badge, one field over. Over-claiming `live` on a nightly market cap
  // tells a user a number is current when it is up to a day old. Under-claiming
  // `as-of-snapshot` on a pure price formula tells them a live signal is stale,
  // and a user who discounts a true signal has been misled just as precisely.
  //
  // ⛔ AND IT IS REQUIRED, NOT OPTIONAL, ON THIS LANE. `astReach` returns 0 for a
  // scalar, so GATE 3 passes `market_cap > 1e9` with `non-repainting` and NOTHING
  // ELSE FIRES. An omitted freshness badge reads as `live` to the library dialog,
  // which is the absent-claim-and-false-claim-land-in-the-same-place argument
  // GATE 4 already makes about `meta.tier`.
  const freshness = freshnessFor(ast, { table: TABLE })
  if (def.meta?.freshness === undefined) {
    errors.push(`meta.freshness is required on the ast lane; the linter measured ${JSON.stringify(freshness.mode)}`)
  } else if (def.meta.freshness !== freshness.mode) {
    errors.push(
      `meta.freshness declares ${JSON.stringify(def.meta.freshness)} but the linter measured ` +
      `${JSON.stringify(freshness.mode)} (${freshness.reasons.join('; ')}). A badge is the MEASUREMENT.`)
  }
```

- `ast_lint.lint_definition` returns the freshness row **beside** the repaint row on the same pass, so one measurement produces both verdicts and no caller can obtain one without the other.

- [ ] **Step 6: The census stays closed, the log stays byte-identical, and the scalar floor is its own**

Two new escape cases in `tests/fixtures/ast/escapes.json`, each with a **disjoint** `refuse` fragment (two gates sharing a phrase let a `raises(match=…)` pass with the safety deleted — Phase C Task 9's M1):

```jsonc
  { "id": "scalar_shadow_input", "guard": "resolve:name",
    "why": "a DEFINITION input named `market_cap` must RAISE at seed time, not silently outrank the table" },
  { "id": "excluded_column",     "guard": "resolve:name",
    "why": "`sector` is TEXT and is in `_scalars_excluded`; naming it must refuse like any undeclared name" }
```

⚠️ **The census totals move and the VERDICT must not.** The gate is the shape, not the number: `VERDICT: CLOSED`, `escaped == 0`, `declared == fired` for **every** refusal, `0` lane disagreements, exit **0**, and the unguarded control still non-zero and equal to `parsed`. ⛔ **Do not restate the totals here** — read them off Step 1's run and off the tool's own output.

`tools/ast_conformance.py`'s coverage floor splits: `--coverage` keeps deriving the bar floor from `bar_names()` (unmoved) and gains a **scalar floor** derived from `TABLE['scalars']` against `tests/fixtures/ast/scalars.json`, which aborts if a declared scalar has no case. The two floors are separate artifacts because they measure different things against different fixtures.

- [ ] **Step 7: Gate**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b2-engine
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_scalars.py tests/test_ast_lint.py \
    tests/test_ast_interpret.py tests/test_ast_budget.py tests/test_ast_conformance.py \
    tests/test_user_definitions.py --timeout=300 -q; echo "EXIT=$?"
python tools/ast_conformance.py --escapes;            echo "EXIT=$?"    # CLOSED, 0 escaped, exit 0
python tools/ast_conformance.py --escapes --unguarded; echo "EXIT=$?"   # the control: NON-ZERO
python tools/ast_conformance.py --check;              echo "EXIT=$?"
python tools/alert_replay.py --check;                 echo "EXIT=$?"    # FIRE LOG MATCHES
cd app && npx vitest run src/components/chart/engine; echo "EXIT=$?"
```

**The measurement:** the four manifest section counts (`series`/`operators`/`functions`/`scalars`) read off the file; the `declared | excluded == COLUMNS` partition with both sides printed **and every exclusion's storage type**; the census pair (guarded zero, unguarded non-zero, both `parsed` totals, the `declared == fired` count); the `yields` declaration present on **every** entry of all three name sections, asserted as a totality rather than sampled; and the freshness verdict for every case in `scalars.json` **in both lanes**, asserted equal.

**The non-measurement assertion**, four of them, each an equality this task must not move:
1. `tests/fixtures/ast/conformance_log.json` — the **existing per-ast digests are byte-identical**, asserted **by value per id** (a file-level sha256 would go red on a legitimately appended scalar section and teach the next agent to re-record).
2. `REL_TOL` is unchanged, read out of `tools/ast_conformance.py` by AST and compared against the value Step 1 recorded.
3. `alert_replay --check` prints the literal `FIRE LOG MATCHES` at exit 0. **No total is quoted.**
4. `INDICATOR_FUNCS` is unchanged and `ADDRESS_PARTITIONS` still holds exactly the partitions it held at Step 1, asserted as a derived **sorted set AND an exact sequence** (a histogram passes a permutation). ⛔ **The integers are in Global Constraints → Invariants and in the alert tests' own constants — do not retype them into this task.**

| id | mutation | must go red because |
|---|---|---|
| **M1** | `interpret` seeds a missing scalar as `0.0` instead of NaN | `scan_volume`'s bug at the leaf — a NULL market cap makes `market_cap > 1e9` a confident False, and a screen that answers is worse than one that drops |
| **M2** | `interpret` skips seeding an absent scalar entirely (name not in scope) | it would refuse at `resolve:name`, turning a missing datum into a formula defect and collapsing E-3's `answered` / `not_computable` split |
| **M3** | delete the input-shadow raise for scalar names | a knob named `market_cap` silently outranks the table and changes what every formula on that definition means |
| **M4** | `_scalars_excluded` drops one entry, `scalars` unchanged | the partition identity is the only thing that makes a 66th screener column land red |
| **M5** | GATE 5 refuses only over-claiming (`!==` becomes a one-way check) | under-claiming is as false as over-claiming — GATE 3's own argument, one field over |
| **M6** | `meta.freshness` becomes optional on the `ast` lane | `astReach` returns 0, so with GATE 5 skippable there is **no** gate on a scalar's honesty at all |
| **M7** | `defSchema` accepts `plots[].freshness` | D Task 15 measured the accepted-and-ignored badge; the same hole, on the new field |
| **M8** | `freshness_for` returns `live` instead of `unknown` for an unreadable cadence | fail-closed is the direction; a false `live` is the brand claim dying quietly |
| **M9** | scalars folded into `bar_names()` (one floor, not two) | the recorder aborts, and "fixing" it re-freezes the committed digests for a reason that has nothing to do with bars |
| **M10** | add a fifth canonical node type `scalar` | five declaration sites and every persisted `astHash`; the mutation must be caught by the **derived** node-type set, not by one typed list |
| **M11** | omit `yields` from one `operators` entry | 🔴 **CORRECTION 2.** E-2, E-4 and E-5 all derive from it; one missing entry sends three consumers to a hand-list, in two languages |
| **M12** | declare `?:` as `bool` instead of `passthrough` | a ternary over two numeric branches is admitted as a scan, and `<ast> != 0` becomes true for every non-zero price on the board |
| **M13** | grant a TEXT column as a scalar | the type rail; `sector == "Technology"` is inexpressible and a scalar over TEXT would seed NaN for every symbol and answer confidently |

- [ ] **Step 8: Control audit + commit**

```bash
grep -rn "31 names\|three sections\|60 columns\|repaint: 'non-repainting'" docs/ api/ app/src \
  --include=*.md --include=*.py --include=*.js | grep -v node_modules
```
Read each hit's **stated reason**, not its assertion. A doc that quotes a test's expectation is a control that rots green. In particular: the design doc's §3 *"a third section"* and GT §5.2's *"60 columns"* are both wrong — **report them, do not edit the ground-truth file.**

```bash
git add api/services/ast_freshness.py app/src/components/chart/engine/ast/freshness.js \
        app/src/components/chart/engine/ast/freshness.test.js \
        tests/test_ast_scalars.py tests/fixtures/ast/scalars.json
git commit -m "feat(ast): the table declares scalars and yields, and freshness is the verdict the repaint zero cannot give" -- \
  app/src/components/chart/engine/ast app/src/components/chart/engine/defSchema.js \
  app/src/components/chart/engine/nativeRegistry.js \
  api/services/ast_table.py api/services/ast_interpret.py api/services/ast_lint.py \
  api/services/ast_freshness.py tools/ast_conformance.py \
  tests/test_ast_scalars.py tests/test_ast_lint.py tests/test_ast_interpret.py tests/fixtures/ast
```

---

# Task E-2: the scan object — no new lane, no new columns, and a store that cannot say "no hits" and "never ran" with the same silence

**Files:**
- Create: `api/services/screener/scan_store.py`
- Create: `api/services/scan_definition.py`
- Create: `tests/test_scan_store.py`, `tests/test_scan_definition.py`
- Modify: `api/services/screener/snapshot_db.py` (the two new tables' schema **only** — `COLUMNS` is untouched)

**Interfaces:**
- Consumes: `user_definitions.get/list_for_user` (the store is unchanged — a scan IS an ordinary `ast` definition); `ast_table.yields_of` (**written by E-1**); `ledger._normalize_bar_time` (called, not re-derived); the bars store's own timeframe key set; `snapshot_db.connect`.
  ⛔ **`ledger.ledger_timeframe` is NOT called here.** It refuses `D` at its door because the ledger speaks the **product** label, and controller resolution 6 puts this table on the **bars-store code**. Calling it would refuse every key this store writes.
- Produces:
  ```python
  # api/services/scan_definition.py
  def is_boolean_tree(ast, table=None) -> bool          # DERIVED from `yields`, never a hand-list
  def def_hash(definition) -> str                       # == definition['compute']['fn'] == astHash; asserted equal
  def assert_scannable(definition) -> dict              # raises ScanRefused(gate, detail); gates are a closed set

  # api/services/screener/scan_store.py
  def init_db() -> None
  def record_hits(def_hash, tf, as_of, tickers) -> int          # hits ONLY
  def record_coverage(def_hash, tf, as_of, *, evaluated, answered, dropped,
                      not_computable, dropped_symbols) -> bool
  def hits(def_hash, tf, as_of) -> list[str]
  def coverage(def_hash, tf, as_of) -> dict | None
  def join_clause(def_hash, tf, as_of) -> tuple[str, list]      # PARAMETRIZED SQL fragment + params
  def prune(before_as_of) -> dict
  ```

**Must not touch:** `snapshot_db.COLUMNS`, `query.py`, `filters.py`, any router, `snapshot_builder.py`. E-2 is **dark**: a store with no writer (E-3 writes it) and no route.

**SOLO.**

---

- [ ] **Step 1: Write the failing tests — the identity, the two tables, and the silence**

```python
def test_the_scan_identity_IS_the_astHash_and_compute_fn_IS_that_hash():
    """⭐ ONE HASH, ONE HANDLE, ONE EVENT. `nativeRegistry.js:1246-1248`: an `ast`
    definition's `compute.fn` IS its `astHash` -- 'a 71-character sha256:… string
    that has no entry in NATIVE_COMPUTE and never will'. So "the handle changed"
    and "the maths changed" are the SAME EVENT, and a results table keyed on it
    cannot serve one formula's answers under another's name.

    ⛔ AND THE KEY IS NOT (user_id, def_id, version). Two users who type the same
    formula have the same maths and share one result set -- which is also what
    makes this table member-INDEPENDENT, the property E-6 is being built to obtain.
    """
    d = a_scan_definition('close > sma(close, 20)')
    assert scan_definition.def_hash(d) == d['compute']['fn']
    assert d['compute']['fn'].startswith('sha256:') and len(d['compute']['fn']) == 71


def test_a_scan_must_be_a_0_1_TREE_and_the_check_is_DERIVED_from_the_manifest():
    """`closedTable.json::_booleans` -- 'a condition is therefore a 0/1 column'.

    ⛔ DERIVED FROM `yields`, NEVER FROM A LIST OF WHICH OPERATORS ARE
    COMPARISONS. A hand-list is the DPC shape: four constants rode outside their
    rail for the rule's entire life because the rail was a list of what somebody
    remembered. With `yields` declared, a twelfth function added to the table is
    classified the day it lands.

    ⚠️ `rsi14` IS a screener column and is legal AFTER E-1 as a SCALAR (design
    CORRECTION 1). `rsi(close, 14)` is a FUNCTION, is not in the table's eleven,
    and is NOT granted by E-A7 -- do not write it into any case here.
    """
    assert scan_definition.is_boolean_tree(tree_of('close > sma(close, 20)'))
    assert scan_definition.is_boolean_tree(tree_of('rsi14 < 30 && volume > 0'))
    assert not scan_definition.is_boolean_tree(tree_of('sma(close, 20)'))
    with pytest.raises(scan_definition.ScanRefused, match=r"\[gate:yields\]"):
        scan_definition.assert_scannable(a_scan_definition('sma(close, 20)'))


def test_no_hits_and_never_ran_are_DIFFERENT_and_the_store_can_tell_them_apart():
    """🔴 THE FAILURE THIS PHASE MUST NOT SHIP, made structural.

    `scan_volume._job` sets `m = {}` on a failed reference build, so 'a failed
    reference is indistinguishable from an empty market'. At screener scale that
    is a screen silently dropping 800 symbols, returning fewer hits, and looking
    like a quiet market -- which a trader would act on.

    Two tables make it impossible: `scan_hits` holds ONLY hits, and `scan_coverage`
    holds the receipt that says the run happened and over what. A quiet market is
    `coverage(...) is not None and hits == []`. A run that never happened is
    `coverage(...) is None`. There is no third reading.
    """
    assert scan_store.coverage(H, 'D', 20260808) is None            # never ran
    scan_store.record_coverage(H, 'D', 20260808, evaluated=3742,
                               answered=3699, dropped=41, not_computable=2,
                               dropped_symbols=[...])
    scan_store.record_hits(H, 'D', 20260808, [])
    assert scan_store.hits(H, 'D', 20260808) == []                  # ran; quiet market
    assert scan_store.coverage(H, 'D', 20260808)['answered'] == 3699


def test_the_coverage_receipt_carries_FIVE_KEYS_and_the_arithmetic_closes():
    """🔴 CONTROLLER RESOLUTION 5 — `not_computable` IS ITS OWN KEY.

    "We could not compute it" (insufficient history at the last confirmed bar) and
    "something broke" are DIFFERENT FACTS to a member, and folding them together
    is what makes a coverage report untrustworthy -- the exact class §6.3 exists to
    prevent. A 41-symbol `dropped` that is really 39 short-history and 2 failures
    should say so.

    ⛔ `dropped_symbols` is the ONE enumeration and it carries BOTH kinds, each
    with its `reason`; the two COUNTS are what split them. Adding a second list
    would be a sixth key nobody granted.
    """
    c = scan_store.coverage(H, 'D', 20260808)
    assert c['evaluated'] == c['answered'] + c['dropped'] + c['not_computable']
    assert set(c) >= {'evaluated', 'answered', 'dropped', 'not_computable', 'dropped_symbols'}
```

- [ ] **Step 2: Run them, then write the two tables — in `screener.db`, beside the rows they certify**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_scan_store.py tests/test_scan_definition.py -q; echo "EXIT=$?"
```

The schema goes in `snapshot_db.py`, in a **second `executescript`** below `screener_rows`, and the reason is measured twice over:

```python
# ⭐ IN `screener.db`, BESIDE `screener_rows`, AND THE JOIN IS WHY. E-A4 says the
# results are 'joined to screener_rows'; a cross-database join needs ATTACH, which
# `connect()` does not do and which `query.run_scan` -- one SQL string against one
# connection -- has no place to put. A separate file would make every scan query a
# two-connection merge in Python over up to 3,742 rows.
#
# ⭐ AND IT IS THE `signature_coverage` PRECEDENT, EXACTLY. `ledger.py` holds its
# coverage table in the same FILE as the signals it certifies, 'deliberately one
# file, so a receipt cannot outlive the signals it certifies'. A scan hit cannot
# outlive the screener row it is joined to, for the same reason.
#
# ⛔ AND `screener_rows` IS UNTOUCHED. 65 hand-written columns and 8 indexes
# (measured 2026-08-09). E-A4 refuses both a per-definition widening (unbounded
# schema, per-user DDL) and an EAV (destroys the indexed SQL that makes it fast).
_SCAN_SCHEMA = """
CREATE TABLE IF NOT EXISTS scan_hits (
  def_hash TEXT    NOT NULL,
  tf       TEXT    NOT NULL,
  as_of    INTEGER NOT NULL,
  ticker   TEXT    NOT NULL,
  PRIMARY KEY (def_hash, tf, as_of, ticker)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_scan_hits_ticker ON scan_hits(ticker, as_of DESC);

CREATE TABLE IF NOT EXISTS scan_coverage (
  def_hash        TEXT    NOT NULL,
  tf              TEXT    NOT NULL,
  as_of           INTEGER NOT NULL,
  evaluated       INTEGER NOT NULL,
  answered        INTEGER NOT NULL,
  dropped         INTEGER NOT NULL,
  not_computable  INTEGER NOT NULL,      -- controller resolution 5: its own bucket
  dropped_json    TEXT    NOT NULL,      -- the ONE enumeration, both kinds, each with a reason
  dropped_listed  INTEGER NOT NULL,
  freshness       TEXT    NOT NULL,
  swept_at        REAL    NOT NULL,
  PRIMARY KEY (def_hash, tf, as_of)
);
"""
```

🔴 **`scan_hits` stores HITS ONLY, and the 0 is not lost — it moves into the receipt.** `registry_defs.event_columns` is right that *"0 is 'computed, did not happen' and is the whole point — an all-`None` column and a quiet tape look identical"* — so the 0 must be **recoverable**, and it is: a ticker in `scan_coverage`'s window and absent from `scan_hits` **is** a computed 0. What is NOT recoverable from a dense table is which rows were never written, which is the failure. And the size argument is measured next door: `alert_shadow_fires` is **53.0 bytes/row with no prune, no TTL and no cap** — 279 GB/yr at 10,000 armed alerts (GT §3.5). A dense 3,742-row-per-scan-per-day table walks straight into it; hits-only collapses it by the hit rate.

⛔ **`prune(before_as_of)` ships in this task, with a measured row size and a projection in its docstring.** GT §3.5's verdict on `alert_shadow_fires` is *"do not build a screener history on this table's current shape"*, and the thing that made that table dangerous was not its width — it was shipping without a prune.

- [ ] **Step 3: `tf` and `as_of` are NORMALISED at the door, by the functions that already own the rule**

```python
def _key(def_hash, tf, as_of):
    """⛔ ONE SPELLING PER TIMEFRAME, AND IT IS THE BARS-STORE CODE (`D`), NOT THE
    PRODUCT LABEL (`1D`) -- controller resolution 6. This side table keys on the
    same concept `bars_sqlite`, `TRAILING_PAD` and the alert lane already key on;
    rendering `1D` at the surface is a DISPLAY concern. Two spellings in storage
    is the two-vocabularies defect this repo has measured twice (`williams_r` vs
    `williamsR`, and the label/derive fixes of 2026-08-08).

    ⛔ THE ACCEPTED SET IS DERIVED from the bars store's own timeframe keys, never
    typed here, and the refusal NAMES THE OTHER SPELLING so a caller holding `1D`
    is told what to send. ⛔ `ledger.ledger_timeframe` is NOT called: the ledger
    speaks product labels and refuses `D` at its door, so calling it would refuse
    every key this store writes.

    ⛔ AND `as_of` IS A NORMALISED YYYYMMDD INT. `screener_rows.bars_asof` is TEXT
    and the bars store speaks ints; a key that accepted both would silently split
    one session across two rows and every count would still look plausible.
    `ledger._normalize_bar_time` exists because 'three upstream encodings' already
    collided once -- so the collapse happens HERE, at the door, not at each call site.
    """
```

- [ ] **Step 4: `is_boolean_tree`, derived**

```python
def is_boolean_tree(ast, table=None) -> bool:
    """Does this tree's ROOT produce values in {0, 1, NaN}?

    Derived from `yields` (written by E-1), iteratively:
      num          -> "bool" iff value in (0, 1), else "num"
      series       -> the declared scalar's `yields`, else "num" (a bar series)
      op / call    -> the declared `yields`; "passthrough" (`?:`) resolves to
                      "bool" iff BOTH branches are "bool"
    ⛔ AN UNDECLARED `yields` IS "num", NOT "bool". Fail-closed: refusing to call a
    tree a scan costs a user an error message; admitting a real-valued tree as a
    scan makes `<ast> != 0` true for every non-zero price on the board.

    ⛔ AND THIS IS THE ONLY PYTHON IMPLEMENTATION. E-5's concierge CALLS it; it
    does not re-derive it. One fact, one implementation per lane.
    """
```

- [ ] **Step 5: the join, as a parametrized fragment and nothing more**

```python
def join_clause(def_hash, tf, as_of):
    """`(sql_fragment, params)` selecting the screener rows this scan hit.

    ⛔ IT IS A FRAGMENT, NOT A WIRING. Whether a scan appears as a `filters.FILTERS`
    entry, as a new filter TYPE, or as its own endpoint is E-4's decision
    (E4-A5, controller resolution 7) and E-2 is dark. What E-2 owes is that
    whatever takes it cannot build SQL from a client string:
    `filters.column_for` / `is_valid_op` gate every existing query for exactly
    that reason, and `def_hash` is the one value here a client could ever supply.
    """
    return ("EXISTS (SELECT 1 FROM scan_hits h WHERE h.ticker = screener_rows.ticker "
            "AND h.def_hash = ? AND h.tf = ? AND h.as_of = ?)", [def_hash, tf, as_of])
```

- [ ] **Step 6: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_scan_store.py tests/test_scan_definition.py \
    tests/test_screener_snapshot_db.py tests/test_screener_query.py tests/test_screener_filters.py \
    tests/test_screener_api.py tests/test_scan_screener_auth.py --timeout=300 -q; echo "EXIT=$?"
python tools/alert_replay.py --check; echo "EXIT=$?"
```

**The measurement:** `len(snapshot_db.COLUMNS)` and the sorted column names; the `screener_rows` index set read from `PRAGMA index_list`; the two new tables' column sets read from `PRAGMA table_info`; a measured **bytes-per-row** for `scan_hits` and `scan_coverage` from a seeded file, with the year projection printed at a stated hit rate; and the `is_boolean_tree` verdict for a tree of each `yields` value including a `?:` over two `bool` branches and a `?:` over two `num` branches.

**The non-measurement assertion:** `snapshot_db.COLUMNS` is **byte-identical to E-1's measurement — as a sorted list of names, not a length** (a length assertion passes a swap), and `PRAGMA index_list(screener_rows)` still reports the same index names. Both derived from `sqlite_master`, never typed. Plus: `alert_replay --check` prints `FIRE LOG MATCHES` at exit 0, and no file under `api/routers/` appears in `git diff --name-only HEAD`.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `record_hits` writes a row for every evaluated ticker with `hit` 0/1 | the `alert_shadow_fires` shape — measured 53 B/row, no prune, 279 GB/yr at 10k; and the receipt already recovers the 0 |
| **M2** | delete `scan_coverage` and infer "ran" from `hits` being non-empty | `scan_volume`'s exact bug: a failed run and a quiet market become byte-identical |
| **M3** | `_key` accepts `"1D"` alongside `"D"` | controller resolution 6 — one session split across two keys, and every count stays plausible |
| **M4** | `as_of` stored as the raw `bars_asof` TEXT | TEXT `"20260808"` and INT `20260808` are different keys and the join silently returns nothing |
| **M5** | `is_boolean_tree` hand-lists the comparison operators | the DPC list-that-rots shape, on the check that decides what a scan IS — and CORRECTION 2 exists to make it unnecessary |
| **M6** | an undeclared `yields` defaults to `"bool"` | `<ast> != 0` becomes true for every non-zero price; the screen returns the whole universe |
| **M7** | key the tables on `(user_id, def_id, version)` | two users' identical formula computed twice, and the store stops being member-independent |
| **M8** | add a `scan_hit` column to `screener_rows` | E-A4, and the 8 indexes |
| **M9** | delete `prune` | GT §3.5's verdict, applied to the table this task just created |
| **M10** | fold `not_computable` into `dropped` in `record_coverage` | controller resolution 5 — "we could not compute it" and "something broke" become one number, and a coverage report that cannot tell them apart is the class §6.3 exists to prevent |
| **M11** | `?:` resolved as `bool` whenever EITHER branch is `bool` | a ternary handing back a price on one arm is admitted as a scan |

- [ ] **Step 7: Control audit + commit**

```bash
grep -rn "screener_rows\|COLUMNS" tests/ api/ docs/ --include=*.py --include=*.md | grep -iE "60|len\("
```
Any control asserting a column **count** is guilty until proven innocent — the live list is 65 and at least two documents say 60. Re-point each at a derived sorted set, or delete it with the reason recorded.

```bash
git add api/services/screener/scan_store.py api/services/scan_definition.py \
        tests/test_scan_store.py tests/test_scan_definition.py
git commit -m "feat(screener): the scan object — one hash, a narrow side table, and a receipt that separates quiet from broken" -- \
  api/services/screener/scan_store.py api/services/screener/snapshot_db.py \
  api/services/scan_definition.py tests/test_scan_store.py tests/test_scan_definition.py
```

---

# Task E-3: the evaluator — sequential because correctness made it GIL-bound, off the request path because "fast alone" is not "safe together", and coverage in the RESULT

**Files:**
- Create: `api/services/screener/scan_evaluator.py`
- Create: `tests/test_scan_evaluator.py`, `tests/test_scan_evaluator_off_request_path.py`
- Modify: `api/main.py` — **one** scheduler registration, appended inside `register_screener_jobs`

**Interfaces:**
- Consumes: `bars_sqlite.get_bars` (local SQLite, no network); `snapshot_db.get_rows` (batch, for E-1's scalars); `ast_interpret.interpret` (with E-1's `scalars=`); `scan_definition.assert_scannable`; `scan_store.record_hits` / `record_coverage`; `ast_freshness.freshness_for`.
- Produces:
  ```python
  RUN_GATES = ("snapshot-stale", "no-definition", "not-scannable", "no-universe")
  DROP_REASONS = ("no-bars", "stale-bars", "no-screener-row", "refused")
  NOT_COMPUTABLE_REASON = "not-computable"          # its own bucket, controller resolution 5

  def evaluate_one(definition, tf, *, universe=None, as_of=None) -> dict
      # -> {def_hash, rev, tf, as_of, freshness, hits: [...],
      #     evaluated, answered, dropped, not_computable,
      #     dropped_symbols: [{sym, reason}], truncated}
  def run_sweep(definitions, tf="D") -> dict
  ```
  ⚠️ **`rev` is read off `definition['compute']['rev']`** and returned, because E-6's receipt is keyed on it. E-3 does not invent it and does not default it.
  ⚠️ **`limits=` is NOT in this signature.** E-7 adds it. E-3 knows nothing about entitlement.

**Must not touch:** anything under `api/routers/`; `api/services/indicator_alert_evaluator.py`; `api/services/alert_user_series.py`; `snapshot_builder.py`.

**SOLO.**

---

⚠️ **The header's gate table says `{evaluated, answered, dropped, dropped_symbols}`. That line predates controller resolution 5 and the ruling wins: the envelope carries FIVE keys.** The four-key line is a residual the owner may want to correct in Global Constraints; do not "fix" the code to match it.

---

- [ ] **Step 1: Write the failing tests — the three that are about honesty, before the one that is about arithmetic**

```python
def test_coverage_is_a_CLOSED_IDENTITY_the_function_asserts_about_itself():
    """🔴 `evaluated == answered + dropped + not_computable`, ASSERTED INSIDE THE
    FUNCTION.

    `escape_census` already does exactly this ('census arithmetic broke: parsed=…
    refused=… escaped=…') and it is why a swallowed case there is impossible
    rather than merely discouraged. Every sweep in the survey that lost symbols
    lost them through a hole in this arithmetic:
      * `bars_prewarm._warm_one`  -- `except: pass`, counted into NEITHER `warmed`
        nor `skipped`, never printed. A symbol failing every cycle is invisible.
      * `rs_ranking`              -- per-ticker `except: pass`, no counter, AND
        `readiness.mark_done("rs_rankings")` fires at `main.py:859` EVEN ON FAILURE.
      * `theme_performance`       -- a failed fetch becomes a legitimate-looking None.
      * `scan_volume._job`        -- `m = {}` on a failed reference: a failed
        reference is indistinguishable from an empty market.
    At 3,742 symbols that is a screen silently dropping 800, returning fewer hits,
    and looking like a quiet market -- which a trader would act on.
    """
    r = scan_evaluator.evaluate_one(SCAN, 'D', universe=UNIVERSE_WITH_41_UNANSWERED)
    assert r['evaluated'] == r['answered'] + r['dropped'] + r['not_computable']
    assert r['dropped'] == 2 and r['not_computable'] == 39
    assert len(r['dropped_symbols']) == 41            # ONE enumeration, both kinds
    reasons = {d['reason'] for d in r['dropped_symbols']}
    assert reasons <= set(scan_evaluator.DROP_REASONS) | {scan_evaluator.NOT_COMPUTABLE_REASON}


def test_the_value_is_read_at_the_LAST_CONFIRMED_BAR_and_a_NaN_there_is_NOT_COMPUTABLE():
    """🔴 A REAL DEFECT CLASS IN A FUNCTION THIS TASK WOULD OTHERWISE REUSE.

    `alert_user_series._last_finite` returns 'the newest computable number in an
    aligned column' -- correct for an alert, which asks 'has it happened yet'.
    WRONG for a screen: on a halted or delisted symbol it walks BACKWARDS until it
    finds a number and answers with a value from forty sessions ago, wearing
    today's `as_of`. That is `lesson_a_derived_reference_needs_a_sanity_bound` at
    universe scale -- a plausible, ranked, wrong answer.

    So the evaluator reads the index of the LAST CONFIRMED BAR specifically, and a
    NaN there lands in `not_computable` -- its OWN bucket, not `dropped`
    (controller resolution 5). It never looks further back.
    """
    r = scan_evaluator.evaluate_one(SCAN, 'D', universe=['STALE'])   # NaN at -1, 1.0 at -20
    assert r['hits'] == [] and r['answered'] == 0
    assert r['not_computable'] == 1 and r['dropped'] == 0
    assert r['dropped_symbols'][0]['reason'] == 'not-computable'


def test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes():
    """🔴 THE 524 CLASS, AND THE GATE IS REACHABILITY, NOT A BOUND.

    `main.py:1220` sets `limiter.total_tokens = 64` and all 7 signature routes are
    `sync def`, so each holds one of 64 shared anyio threads for its full duration.
    A universe screen is ~2-8 s of pure-Python CPU (GT §2.3, LOCAL) and it is
    GIL-bound (GT §2.4), so it degrades EVERY handler on the pod for those seconds
    -- not just its own slot. `/confluence-scan` was a ten-minute request on one
    anyio worker; that is the 2026-07-01 outage.

    E-3's rule is STRONGER than /confluence-scan's four bounds, which bound a
    request. Here a member request NEVER triggers an evaluation at all, so the
    honest instrument is a REACHABILITY census: walk every `router.routes`
    endpoint, build the call graph by AST, and assert `scan_evaluator`'s entry
    points appear in NO handler's transitive closure.

    ⛔ THE COUNT OF HANDLERS WALKED IS ASSERTED. A hand-listed path set let two
    paid Signature endpoints ride uncovered in Phase C, and a census that walked
    zero routes would pass this the same way.
    """
    handlers = _endpoints_from_router_routes()          # derived, never typed
    assert len(handlers) > 100, f"the census walked {len(handlers)} handlers"
    for h in handlers:
        assert 'scan_evaluator' not in _transitive_imports_and_calls(h)
```

- [ ] **Step 2: Run them, then write the module — and the no-threads rule is a structural gate, not a comment**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_scan_evaluator.py -q; echo "EXIT=$?"
```

```python
"""Evaluate one scan definition across the universe. SEQUENTIAL, LOCAL, OFF THE
REQUEST PATH.

⭐ MODELLED ON `screener/snapshot_builder`, NOT ON `rs_ranking`. `snapshot_builder`
reads `bars_sqlite.get_bars(t,"D",400)` -- local, no network -- which is why a
4,000-ticker fully sequential nightly build is affordable, and it is one of only
TWO jobs in the survey that counts AND logs per-symbol failures (`{built, skipped,
errors}`). `rs_ranking`'s 12 workers work only because it is I/O-bound on network
fetches.

⛔⛔ THREADS ARE FORBIDDEN, AND THE REASON IS THE CORRECTNESS GUARANTEE ITSELF.
MEASURED (GT §2.4, LOCAL): 400 symbols x 400 bars, worst-case corpus AST
(`stdev_band`), CPython 3.14.0 with `sys._is_gil_enabled() -> True`:

    serial          613 ms   (1.533 ms/sym)
    ThreadPool( 4)  615 ms   speedup x1.00
    ThreadPool( 8)  981 ms   speedup x0.62
    ThreadPool(16) 1123 ms   speedup x0.55

Zero at 4, actively NEGATIVE at 8 and 16. `ast_interpret`'s own docstring says
why: 'PLAIN LOOPS, NOT NUMPY … numpy changes summation order, and a 1e-9 equality
across two languages only holds if the accumulations happen in the same order.'
THE 1e-9 CROSS-LANE GUARANTEE IS WHAT MAKES THIS GIL-BOUND. The thing that makes a
user's alert fire the same way on the server and on their chart is the same thing
that makes the sweep un-parallelisable, and buying throughput here would be
spending the guarantee. Process-level parallelism is the only real option and the
web pod is deliberately single-process (in-process SSE state) -- an architectural
constraint, not a tuning knob.

⛔ A MEMBER REQUEST NEVER TRIGGERS AN EVALUATION. Not bounded on the request path
-- ABSENT from it. `/confluence-scan`'s four bounds (`_DPC_SCAN_BUDGET_S = 10.0`
wall clock, `_DPC_COLD_LANE_SLOTS = 2` of 64 ~ 3%, `_DPC_COLD_PACE_S = 0.25`,
`_DPC_WARM_PACE_S = 1.0` background warmer) are the template for the BACKGROUND
lane's manners; they are not a licence to run this in a handler.

⭐ COST, MEASURED (GT §2.3, LOCAL, warm 2.5 GB bars.db on NVMe): one median user
AST over 3,742 symbols ~5.4 s serial, worst-case corpus AST ~8.1 s, one native
(RSI) ~2.3 s; `get_bars(D,400)` median 0.84 ms, end-to-end get_bars+rsi median
0.608 ms. ⚠️ Railway's `/data` is a NETWORK-ATTACHED VOLUME and I/O will be worse
there by an UNMEASURED factor. The relative finding (compute is not the
bottleneck; threads do not help) is a property of the code and does transfer.
"""
```

The structural gate for the paragraph above:

```python
def test_the_evaluator_imports_no_concurrency_primitive__BY_AST():
    """⛔ AST, NEVER GREP. This module's own docstring says 'ThreadPoolExecutor'
    four times; a grep counts comments and has done so in BOTH directions on this
    branch. The census reads `ast.Import`/`ast.ImportFrom`/`ast.Call` nodes.

    ⛔ AND IT ASSERTS THE REASON IS STILL WRITTEN DOWN. A ban whose rationale has
    been deleted is a ban the next agent lifts. The docstring must still carry the
    three measured speedups; the test reads them out and checks they are x1.00,
    x0.62 and x0.55 -- if the measurement is re-taken and moves, this goes red and
    somebody has to look.
    """
```

- [ ] **Step 3: The preconditions — refuse loudly, because the alternative is a plausible wrong answer**

```python
def _assert_snapshot_is_current(as_of):
    """🔴 THE SCALARS COME FROM `screener_rows`, SO A STALE SNAPSHOT IS A SCREEN
    ANSWERING ON LAST MONTH'S FUNDAMENTALS UNDER TODAY'S DATE.

    This is checkable and it is live on this box: `C:\\data\\screener.db` holds
    3,589 rows, 3,583 of them stamped `snapshot_date = 2026-07-11` -- a month
    stale (GT §0.4, LOCAL). That is a POSITIVE CONTROL sitting on the developer's
    disk: run the sweep here today and this gate must fire.

    ⛔ AND THE STALENESS IS NOT SELF-HEALING. `api/main.py:1149-1164` -- the block
    that tops up an under-filled `screener.db` on deploy -- sits AFTER `return
    True` at `:1147`, inside `register_pattern_vision_jobs`, and is UNREACHABLE
    DEAD CODE (GT §0.4, AST-verified). A cold or stale `screener.db` waits until
    03:00 ET with no boot top-up. Per controller resolution 8 this is a REAL BUG
    WITH ITS OWN TASK and is NOT E-1..E-3's -- E-3 REFUSES to build on it, and the
    dead block is a FINDING carried in this task's report.
    """
    raise ScanRunRefused("snapshot-stale", ...)


def _bars_are_current(sym, bars, as_of) -> bool:
    """⛔ A SCREEN OVER STALE BARS RETURNS A PLAUSIBLE, RANKED, WRONG ANSWER.

    99.0% of cap_universe has daily bars (GT §5.1, LOCAL: 3,704 / 3,742) -- the
    good news. The bad news, same measurement: only 6 of 3,704 carry the store's
    own newest session. On production that is `bars_prewarm`'s job, and
    `BARS_PREWARM_ENABLED` DEFAULTS TO "0" with per-job failures entirely silent.

    So freshness is a DECLARED, PER-SYMBOL, QUERYABLE FACT, and a symbol whose
    newest bar predates the run's `as_of` is DROPPED with reason `stale-bars` --
    never answered. On this box that will drop most of the universe, and that
    number being large and visible is the honest outcome, not a bug in the gate.
    """
```

- [ ] **Step 4: The loop — one symbol, one reason, no bare `except: pass`**

```python
_DROPPED_LISTED_MAX = 200      # `_DPC_WARM_MAX_QUEUE`'s shape: a bounded list beside a true count

for sym in universe:
    evaluated += 1
    try:
        ...
        value = column[last_confirmed]          # NOT `_last_finite` -- see Step 1
        if value is None:
            # ⛔ ITS OWN BUCKET. "We could not compute it" is not "something
            # broke", and a member reading one number for both cannot tell a
            # short-history universe from a failing one.
            _unanswered(sym, NOT_COMPUTABLE_REASON); not_computable += 1; continue
        answered += 1
        if value != 0:                          # `<ast> != 0`, E-A1
            hits.append(sym)
    except Exception as e:
        # ⛔ COUNTED AND NAMED, NEVER `pass`. `bars_prewarm._warm_one` is the
        # counter-example: `except Exception: pass`, into NEITHER bucket, never
        # printed -- a symbol failing every cycle is invisible.
        _unanswered(sym, "refused", detail=f"{type(e).__name__}: {e}"[:160])
        dropped += 1
        log.warning("[scan] %s %s failed: %s", def_hash[:15], sym, e)

assert evaluated == answered + dropped + not_computable, (
    f"coverage arithmetic broke: evaluated={evaluated} answered={answered} "
    f"dropped={dropped} not_computable={not_computable}")
```

⚠️ **`dropped_symbols` is capped and the cap is reported.** `{dropped: 812, not_computable: 39, dropped_listed: 200, truncated: True}` — an unbounded list inside a stored row is how a receipt becomes the thing that fills the disk. The **counts** are never capped; only the enumeration is.

⛔ **A transient failure of the whole run returns `None`, not an empty result.** `scan_gainers._build_reference` returns `None` on a provider miss *"so the job retries next request instead of caching an empty day"* — and `scan_coverage` is only written when the run **completed**, so a half-run leaves no receipt and reads as `coverage() is None` = never ran. That is E-2's third reading being kept impossible.

- [ ] **Step 5: One scheduler registration, after the snapshot, `max_instances=1`**

Appended inside `register_screener_jobs` (`api/main.py:957-976`), which already registers `CronTrigger(hour=3, minute=0, timezone=_ET)` for `snapshot_builder.run_build` under `SCREENER_SNAPSHOT_ENABLED`.

⛔ **The scan sweep is a SEPARATE job at a later hour, not a call appended to `run_build`.** Two reasons, each measured: `run_build` is capped at `SCREENER_SNAPSHOT_MAX_PER_RUN = 4000` and its duration is **not measured anywhere** (GT §6.4 names it the one number most worth having) — so chaining puts an unmeasured job behind an unmeasured job in one `max_instances=1` slot; and the scan sweep's own precondition is that the snapshot is *current*, which it cannot assert about a build it is inside.

⛔ **The return value is COUNTED, never trusted.** `lesson_scheduler_job_return_value_goes_nowhere`: APScheduler discards it and silence reads as success. The job's success criterion is a **`scan_coverage` row existing for today's `as_of`**, read back — the artifact, not the call.

⏳ **OWNER — the sweep's hour is a consequence of design §8.5.** The job lands at a fixed hour after 03:00 ET; **which** hour, and whether an intraday cadence is wanted at all, is the open cadence question. Ship the constant in one place with an `OWNER:` comment and do not spread it.

- [ ] **Step 6: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_scan_evaluator.py \
    tests/test_scan_evaluator_off_request_path.py tests/test_scan_store.py \
    tests/test_screener_builder.py tests/test_screener_schedule.py \
    tests/test_scan_screener_auth.py --timeout=300 -q; echo "EXIT=$?"
python tools/ast_conformance.py --check;   echo "EXIT=$?"
python tools/ast_conformance.py --escapes; echo "EXIT=$?"
python tools/alert_replay.py --check;      echo "EXIT=$?"
```

**The measurement:** a full sweep of `cap_universe.json` (**3,742**, measured — read it, do not type it) for one median AST against local `bars.db`, reporting `{evaluated, answered, dropped, not_computable}` with the reason histogram, and **wall-clock seconds** compared against GT §2.3's LOCAL ~5.4 s. Plus the route-reachability census's **handler count** and its empty intersection. Plus the concurrency census's found import set (must be empty).

**The non-measurement assertion**, and this task has more to leave alone than any other in the phase:
1. `snapshot_db.COLUMNS` sorted names unchanged; `PRAGMA index_list(screener_rows)` still the same index set.
2. `alert_replay --check` → the literal `FIRE LOG MATCHES`, exit 0. **No total.**
3. `ast_conformance --check` → the per-ast digests byte-identical; `REL_TOL` unchanged.
4. `--escapes` → CLOSED, `declared == fired`, exit 0, control non-zero.
5. `INDICATOR_FUNCS` and `ADDRESS_PARTITIONS` unchanged, as a sorted set **and** an exact sequence. E-3 evaluates definitions; it registers no alert address. ⛔ Integers live in Global Constraints and in the alert tests' constants.
6. The route-gating census is unmoved from Step 1's measurement — asserted **through the named constants `tests/test_scan_screener_auth.py` already holds** (`EXPECTED_SCREENER_ROUTES`, `EXPECTED_SCANS_ROUTES`, …), derived from `router.routes`. ⛔ **Do not retype the integers into this plan** — that file has already been moved off "24 of 25" once.

| id | mutation | must go red because |
|---|---|---|
| **M1** | replace the loop with `ThreadPoolExecutor(max_workers=8)` | the AST concurrency census; and x0.62 means the mutation is also *slower* |
| **M2** | delete the three speedups from the docstring | a ban whose measured reason is gone is a ban the next agent lifts |
| **M3** | swallow a per-symbol exception with `pass` | `evaluated == answered + dropped + not_computable` breaks inside the function |
| **M4** | count a `not-computable` symbol as `answered` with value 0 | a NaN read as "did not hit" is `scan_volume`'s bug: a broken symbol becomes a quiet one |
| **M5** | use `_last_finite(column)` instead of the last-confirmed index | a forty-session-old value wearing today's `as_of` |
| **M6** | drop the `snapshot-stale` precondition | the month-stale local `screener.db` is the live positive control; the sweep would answer on July fundamentals |
| **M7** | drop the `stale-bars` drop and answer anyway | a plausible ranked wrong answer over 3,698 symbols with no newest session |
| **M8** | add a call to `evaluate_one` from any `@router.*` handler | the 524 class; the reachability census must name the handler |
| **M9** | write `scan_coverage` before the loop finishes | a half-run leaves a receipt and becomes indistinguishable from a quiet market |
| **M10** | uncap `dropped_symbols` | an unbounded blob in a stored row; the receipt becomes the disk problem |
| **M11** | chain the sweep inside `run_build` instead of its own job | two unmeasured durations in one `max_instances=1` slot, and the currency precondition becomes unassertable |
| **M12** | add `not_computable` into `dropped` and drop the fifth key | controller resolution 5; and the closed identity still holds, so **only** the key-set assertion sees it |
| **M13** | return `rev` as `0` instead of reading `compute.rev` | E-6's receipt certifies work under the wrong maths, and D-A3's rev semantics stop protecting an edited scan |

- [ ] **Step 7: Control audit + commit**

```bash
grep -rn "ThreadPoolExecutor\|max_workers" api/services/screener api/main.py --include=*.py
grep -rn "mark_done\|readiness" api/main.py --include=*.py
```
The second one is the audit that matters: `rs_ranking`'s warmer calls `readiness.mark_done("rs_rankings")` **even on failure** (`main.py:859`). If E-3's job is ever added to a readiness surface, it must mark done **only on a written `scan_coverage` row** — record that in this task's report as a hand-off, whether or not a readiness entry is added.

```bash
git add api/services/screener/scan_evaluator.py tests/test_scan_evaluator.py \
        tests/test_scan_evaluator_off_request_path.py
git commit -m "feat(screener): the sweep is sequential because the 1e-9 guarantee made it GIL-bound, and it states its own coverage" -- \
  api/services/screener/scan_evaluator.py api/main.py \
  tests/test_scan_evaluator.py tests/test_scan_evaluator_off_request_path.py
```

---

# Task E-4: The criteria builder — two doors onto one object, and the round trip IS the product claim

**Files:**
- Create: `app/src/components/chart/builder/criteria.js`
- Create: `app/src/components/chart/builder/CriteriaPicker.jsx`
- Create: `app/src/components/chart/builder/criteria.test.js`
- Create: `app/src/components/chart/builder/CriteriaPicker.test.jsx`
- Create: `app/src/components/chart/builder/BuilderSheet.criteria.test.jsx`
- Create: `app/src/components/screener/CoverageLine.jsx` + `CoverageLine.test.jsx`
- Create: `tests/fixtures/criteria/must_refuse.json`
- Modify: `app/src/components/chart/builder/BuilderSheet.jsx`
- Modify: whichever screener surface takes E-2's `join_clause` — **the join surface is E-4's decision (E4-A5); the file is named in Step 1's record, not here**

**Interfaces:**
- Consumes: `parseFormula`, `astHash` (`engine/ast/parse.js`) · `TABLE` (the manifest, incl. `scalars` and `yields`) · `evaluateFormula`, `canSaveFormula` (`FormulaField.jsx`) · `BUILDER_INPUT_SCOPE` (`builderInputs.js`) · `scan_store.join_clause` (E-2).
- Produces:
  ```js
  // criteria.js
  export class PickerRefusal extends Error { constructor(guard) { …; this.guard = guard } }
  export const REFUSALS       // Object.freeze({ 'picker:<name>': '<sentence>' })
  export function vocabulary(table)        // {series:Set, scalars:Set, functions:Map, comparators:Set}
  export function toSource(group)          // canonical picker -> fully-parenthesised source. THROWS PickerRefusal.
  export function fromAst(ast, vocab)      // {ok: true, group} | {ok: false, guard, reason}
  export function canonicalPicker(group)   // idempotent normal form; THROWS on a shape it cannot normalise
  export function isCanonical(group)       // boolean, for the invariant test
  ```
- Produces (UI): a `CriteriaPicker` whose only output is `onSourceChange(sourceText)`; a `CoverageLine` that renders `{evaluated, answered, dropped, not_computable}`.

**SOLO.** 🔴 **The competitive deliverable.** ⚠️ **LF-only directory — see the Preamble.**

---

⏳ **OWNER — a crossing row in the picker.** `crossOver` / `crossUnder` are the two things a trader most wants in a picker, and showing them means the picker's row grammar gains a **second shape** (`<term> crosses above <term>`) rather than one. **This task ships the refusal** (`picker:not-a-condition` on a bare `crossOver(a,b)`) so the round-trip property is proven on ONE row shape first, and puts "a crossing row" in the punch list. ⛔ **The owner may instead take the call to include it — in which case the second shape goes into `toSource`/`fromAst` IN THE SAME COMMIT and the whole 400-case corpus is re-run.** Adding it later without re-running the corpus is not an option.

---

- [ ] **Step 1: Re-measure the baseline, record the picker's vocabulary FROM THE MANIFEST, and take the join-surface decision**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b2-engine
python - <<'PY'
import io, json
t = json.load(io.open('app/src/components/chart/engine/ast/closedTable.json', encoding='utf-8'))
for k in sorted(k for k in t if not k.startswith('_') and isinstance(t[k], dict)):
    print(f'{k:12s} {len(t[k]):3d}  {sorted(t[k])}')
    missing = [n for n, s in t[k].items() if isinstance(s, dict) and 'yields' not in s]
    print(f'{"":12s}      yields MISSING on: {missing}')
PY
cd app && npm run build && npx vitest run           # read the two counts bare; no --reporter=basic
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q
```

**Three stop conditions, all derived from that output:**

1. **No `scalars` section ⇒ E-1 has not landed and E-4 does not start.**
2. **Any `operators` or `functions` entry missing `yields` ⇒ E-1 is incomplete and E-4 does not start.** CORRECTION 2 grants the field precisely so this task never hand-lists comparators; a partial declaration is worse than none because it makes the derivation silently narrow.
3. 🔴 **`functions` MUST still hold its eleven** (`abs change crossOver crossUnder ema highest lowest max min sma stdev`). **E-A9 is OPEN AND OUT OF SCOPE** (design CORRECTION 1) — a grown `functions` section means somebody bundled it into a vocabulary task, which is the one thing the correction forbids, and **E-4 stops and reports**. ⚠️ The picker therefore offers `sma(close,20)`, `stdev(close,20)`, `highest(high,20)` and **not** `rsi(close,14)`; `rsi14` reaches it as a **scalar**, which is the whole point of E-1.

**And take the decision E4-A5 assigns to this task.** E-2 shipped `join_clause` as `(sql_fragment, params)` and no wiring. E-4 picks exactly one of:

| option | what it costs |
|---|---|
| a `filters.FILTERS` entry | cheapest; but `FILTERS` entries are column-shaped and a `def_hash` is not a column |
| a new filter **type** in `query.run_scan` | one place, one gate, composes with the existing 8 indexes |
| its own endpoint | clearest boundary; a second query path to keep in step with `filters` |

⛔ Whatever is chosen: **the fragment is parametrized and no SQL is built from a client string** (`filters.column_for` / `is_valid_op` gate every existing query for exactly that reason), and the route is **registered so E-7's derived census covers it**. Record the chosen surface, the file, and the route path in this task's report — **E-7 derives the path from `router.routes` and must not type it.**

- [ ] **Step 2: Write the failing property tests — the three round trips, and the corpus that makes them mean something**

`app/src/components/chart/builder/criteria.test.js`:

```js
// ⭐ THE GATE IS A PROPERTY, NOT A SET OF EXAMPLES. A one-way builder is exactly
// TC2000's PCF seam: you can build in the UI or write the formula, and they
// diverge. The round trip IS the product claim, so it is measured over a
// GENERATED corpus whose coverage of the manifest is itself a gate.
import { describe, it, expect } from 'vitest'
import { parseFormula, astHash, TABLE } from '../engine/ast/parse'
import { toSource, fromAst, canonicalPicker, isCanonical, vocabulary, REFUSALS } from './criteria'
import MUST_REFUSE from '../../../../../tests/fixtures/criteria/must_refuse.json'

const VOCAB = vocabulary(TABLE)

/** A seeded PRNG. ⛔ NOT Math.random: a property test that generates a different
 *  corpus on every run cannot be re-run against a failure, and a flake in a gate
 *  this load-bearing would be triaged as noise. */
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

function genCorpus(seed, n) {
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const series = [...VOCAB.series]
  const scalars = [...VOCAB.scalars]
  const fns = [...VOCAB.functions.keys()]
  const cmps = [...VOCAB.comparators]

  const term = (depth) => {
    const roll = r()
    if (depth <= 0 || roll < 0.35) return { t: 'name', name: pick(series.concat(scalars)) }
    if (roll < 0.55) return { t: 'num', value: Math.floor(r() * 400) }
    const name = pick(fns)
    const spec = VOCAB.functions.get(name)
    return { t: 'call', name, args: spec.args.map((kind) => (
      kind === 'int' ? { t: 'num', value: 2 + Math.floor(r() * 50) } : term(depth - 1))) }
  }
  const row = () => ({ kind: 'row', left: term(2), cmp: pick(cmps), right: term(2) })
  const group = (depth) => {
    const join = r() < 0.5 ? 'and' : 'or'
    const k = 2 + Math.floor(r() * 3)
    const children = []
    for (let i = 0; i < k; i += 1) {
      // A nested group must carry the OTHER join, or canonicalPicker would
      // flatten it and the generated shape would not be canonical.
      children.push(depth > 0 && r() < 0.3
        ? { ...group(depth - 1), join: join === 'and' ? 'or' : 'and' }
        : row())
    }
    return { kind: 'group', join, children }
  }
  return Array.from({ length: n }, () => group(2))
}

const CORPUS = genCorpus(0xE4E4, 400)

describe('the corpus is not vacuous', () => {
  // ⛔ DERIVED FROM THE MANIFEST. Hand-listing what a corpus covers is how DPC's
  // four constants rode unpinned for the rule's entire life.
  it('every declared name the picker offers appears in at least one case', () => {
    const seen = new Set()
    const walkTerm = (t) => {
      if (t.t === 'name') seen.add(t.name)
      if (t.t === 'call') { seen.add(t.name); t.args.forEach(walkTerm) }
    }
    const walk = (n) => {
      if (n.kind === 'group') return n.children.forEach(walk)
      if (n.kind === 'row') { seen.add(n.cmp); [n.left, n.right].forEach(walkTerm) }
    }
    CORPUS.forEach(walk)
    const declared = [...VOCAB.series, ...VOCAB.scalars, ...VOCAB.functions.keys(), ...VOCAB.comparators]
    const missing = declared.filter((n) => !seen.has(n))
    expect(missing, 'raise the corpus size or the generator is not reaching these').toEqual([])
  })

  it('and the corpus contains both joins and at least one nested group', () => {
    const joins = new Set(); let nested = 0
    const walk = (n, d) => {
      if (n.kind !== 'group') return
      joins.add(n.join); if (d > 0) nested += 1
      n.children.forEach((c) => walk(c, d + 1))
    }
    CORPUS.forEach((c) => walk(c, 0))
    expect([...joins].sort()).toEqual(['and', 'or'])
    expect(nested).toBeGreaterThan(0)
  })
})

describe('picker -> AST -> picker is the IDENTITY', () => {
  it.each(CORPUS.map((p, i) => [i, p]))('case %i', (_i, picker) => {
    const src = toSource(picker)
    const parsed = parseFormula(src)
    expect(parsed.ok, `${src} did not parse: ${parsed.error}`).toBe(true)
    const back = fromAst(parsed.ast, VOCAB)
    expect(back.ok, `${src} could not be read back: ${back.reason}`).toBe(true)
    expect(back.group).toEqual(picker)
  })
})

describe('AST -> picker -> AST is the identity ON THE TREE', () => {
  // ⭐ THE HALF THAT CATCHES A LOST PARENTHESIS. `a && b || c` parses as
  // `(a && b) || c`; a picker that flattened mixed joins, or a spelling that
  // dropped the parentheses, produces a DIFFERENT tree that still round-trips
  // through the picker. Only the hash sees it.
  it.each(CORPUS.map((p, i) => [i, p]))('case %i', (_i, picker) => {
    const ast = parseFormula(toSource(picker)).ast
    const back = fromAst(ast, VOCAB)
    const again = parseFormula(toSource(back.group)).ast
    expect(astHash(again)).toBe(astHash(ast))
  })
})

describe('the picker shape is CANONICAL, and non-canonical is reported', () => {
  it('every generated case is already canonical', () => {
    CORPUS.forEach((p) => expect(isCanonical(p)).toBe(true))
  })
  it('a same-join nested group is NOT canonical, and canonicalPicker flattens it', () => {
    // The positive control for the invariant above. Without it, `isCanonical`
    // returning `true` unconditionally passes the whole block.
    const bad = { kind: 'group', join: 'and', children: [
      { kind: 'group', join: 'and', children: [ROW_A, ROW_B] }, ROW_C] }
    expect(isCanonical(bad)).toBe(false)
    expect(canonicalPicker(bad)).toEqual(
      { kind: 'group', join: 'and', children: [ROW_A, ROW_B, ROW_C] })
    expect(isCanonical(canonicalPicker(bad))).toBe(true)
  })
})

describe('fromAst REFUSES what it cannot show, BY NAME, and never approximates', () => {
  it('the must-refuse corpus is non-empty and every case PARSES first', () => {
    // ⛔ A case the PARSER rejects proves nothing about the picker — the escape
    // corpus learned this in Phase D and the same rule applies here.
    expect(MUST_REFUSE.length).toBeGreaterThan(5)
    MUST_REFUSE.forEach((c) => expect(parseFormula(c.source).ok, c.source).toBe(true))
  })

  it.each(MUST_REFUSE.map((c) => [c.source, c.guard]))('%s -> %s', (source, guard) => {
    const res = fromAst(parseFormula(source).ast, VOCAB)
    expect(res.ok).toBe(false)
    expect(res.guard).toBe(guard)
    expect(res.group, 'a refusal must not hand back a partial picker').toBeUndefined()
  })

  it('every refusal sentence is DISJOINT from every other', () => {
    // C Task 9's M1: two gates sharing a phrase let `raises(match=…)` pass with
    // the safety deleted. The same trap exists for a `guard` a test asserts on.
    const words = Object.values(REFUSALS).map((s) => new Set(s.split(/\W+/).filter((w) => w.length > 4)))
    for (let i = 0; i < words.length; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        const shared = [...words[i]].filter((w) => words[j].has(w))
        expect(shared.length, `refusals ${i} and ${j} share ${shared}`).toBeLessThan(3)
      }
    }
  })
})

describe('the comparator set is DERIVED from `yields`, and its absence is a REFUSAL', () => {
  // ⛔ CORRECTION 2. A hand-list here is the second grammar the closed table
  // exists to prevent, and it would be the SAME hand-list E-5 would write in
  // Python — `williams_r` vs `williamsR`, one layer up.
  it('vocabulary() throws rather than falling back when `yields` is absent', () => {
    const stripped = JSON.parse(JSON.stringify(TABLE))
    Object.values(stripped.operators).forEach((s) => { delete s.yields })
    expect(() => vocabulary(stripped)).toThrow(/comparator/i)
  })
})
```

`tests/fixtures/criteria/must_refuse.json` — each case hand-derived, each with its reason. ⚠️ **Every `source` here is a tree the SHIPPED table can parse** — no case names `rsi(` or any function outside the eleven:

```json
[
  {"source": "sma(close, 20)",              "guard": "picker:not-a-condition",
   "why": "a number, not a yes/no — the picker builds conditions"},
  {"source": "close",                        "guard": "picker:not-a-condition",
   "why": "a bare series"},
  {"source": "(close > 1) ? 2 : 3",          "guard": "picker:node",
   "why": "the ternary has no row-and-group shape"},
  {"source": "!(close > open)",              "guard": "picker:node",
   "why": "negation is not a row; v1 shows it as a formula"},
  {"source": "(close > open) + 1",           "guard": "picker:not-a-condition",
   "why": "arithmetic over a condition — the top node is not a comparator"},
  {"source": "close + open > 1",             "guard": "picker:term",
   "why": "an arithmetic TERM; the picker's left side is a name, a number or one call"},
  {"source": "sma(sma(close, 5), 5) > 1",    "guard": "picker:term",
   "why": "a nested call; v1 shows one level"},
  {"source": "crossOver(close, open)",       "guard": "picker:not-a-condition",
   "why": "yields 0/1 but is not a COMPARATOR row — v1 offers it as a formula. See the OWNER block above."}
]
```

- [ ] **Step 3: Run and watch them fail**

```bash
cd app && npx vitest run src/components/chart/builder/criteria.test.js; echo "EXIT=$?"
```

Read the exit code bare. ⛔ Not `--reporter=basic` — it fails to start on vitest 4.0.18 and **exits 0**.

- [ ] **Step 4: Implement `criteria.js`**

```js
// app/src/components/chart/builder/criteria.js
//
// ─── THE PICKER MODEL — A VIEW OVER THE TREE, NEVER A SECOND ARTIFACT ───────
//
// ⛔ NOTHING PICKER-SHAPED IS PERSISTED. `defSchema.validateCompute` already
// requires `compute.source` to parse back to `compute.ast`, compared BY HASH, so
// a stored picker shape would be a THIRD artifact beside those two and the three
// would drift with nothing to say so. The picker is rebuilt from the tree on
// every open — which is exactly what makes a lossy `fromAst` visible instead of
// invisible.
//
// ⛔ THERE IS NO SECOND TREE-MAKER. `toSource` spells SOURCE, fully
// parenthesised, and `parseFormula` makes the tree — the one parser, in the
// browser, D-A1 untouched. The spelling is presentation: `astHash` is over the
// CANONICAL tree, so two spellings of one tree are ONE `def_hash` and ONE scan.
//
// ⛔ `fromAst` IS PARTIAL AND REFUSES BY NAME. A picker that silently drops a
// term it cannot show IS the TC2000 PCF seam one hop earlier.
//
// ⛔ AND THE CANONICAL NODE VOCABULARY IS FOUR TYPES. E-1 settled the scalar
// encoding: a scalar rides the `series` node and `NODE_TYPES` does not grow, so
// there is no `'scalar'` node type to test for here. What distinguishes a scalar
// from a bar series is the VOCABULARY LOOKUP below, not the node tag.

import { TABLE } from '../engine/ast/parse'

export class PickerRefusal extends Error {
  constructor(guard) { super(REFUSALS[guard] || guard); this.guard = guard }
}

export const REFUSALS = Object.freeze({
  'picker:not-a-condition':
    'this formula produces a number rather than a yes-or-no answer, so there is nothing for the picker to show as a condition',
  'picker:node':
    'this formula uses a construction the picker has no row for — keep editing it as text',
  'picker:term':
    'one side of a comparison here is a longer expression than a single value, name or function call',
  'picker:comparator':
    'the comparison in this formula is not one the picker offers',
  'picker:shape':
    'a picker condition must be a group of rows, and this one is neither',
})

/** The names the picker may offer, READ FROM THE MANIFEST.
 *
 *  ⛔ SECTION KEYS AND A `yields` READ — never a typed list. CORRECTION 2 put
 *  `yields` on every operator precisely so this is a derivation; if it is absent
 *  this THROWS rather than falling back to a hand-list, because a hand-list here
 *  is the second grammar the closed table exists to prevent. */
export function vocabulary(table = TABLE) {
  const ops = table.operators || {}
  const comparators = new Set(Object.entries(ops)
    .filter(([name, spec]) => spec.arity === 2 && spec.yields === 'bool'
      && name !== '&&' && name !== '||')
    .map(([name]) => name))
  if (!comparators.size) throw new PickerRefusal('picker:comparator')
  return {
    series: new Set(Object.keys(table.series || {})),
    scalars: new Set(Object.keys(table.scalars || {})),
    functions: new Map(Object.entries(table.functions || {})
      .filter(([, spec]) => spec.yields !== 'bool')
      .map(([name, spec]) => [name, { args: spec.args || [] }])),
    comparators,
    joins: new Set(['&&', '||']),
  }
}

const JOIN_OP = { and: '&&', or: '||' }
const OP_JOIN = { '&&': 'and', '||': 'or' }

function spellNumber(v) {
  // ⛔ NON-NEGATIVE ONLY, and the reason is the parser's: `-5` parses to
  // `op u- [num 5]`, so a `num` node with a negative value is a tree the parser
  // CANNOT produce and a source spelling of it would never round-trip.
  if (!Number.isFinite(v) || v < 0) throw new PickerRefusal('picker:term')
  return String(v)
}

function termSource(t) {
  if (!t || typeof t !== 'object') throw new PickerRefusal('picker:term')
  if (t.t === 'num') return spellNumber(t.value)
  if (t.t === 'name') return t.name
  if (t.t === 'call') return `${t.name}(${t.args.map(termSource).join(', ')})`
  throw new PickerRefusal('picker:term')
}

/** The picker, spelled. FULLY PARENTHESISED and LEFT-ASSOCIATIVE, because jsep
 *  is left-associative and the tree-identity property is measured by hash. */
export function toSource(node) {
  if (!node || typeof node !== 'object') throw new PickerRefusal('picker:shape')
  if (node.kind === 'row') {
    return `(${termSource(node.left)} ${node.cmp} ${termSource(node.right)})`
  }
  if (node.kind === 'group') {
    const parts = (node.children || []).map(toSource)
    if (!parts.length) throw new PickerRefusal('picker:shape')
    const op = JOIN_OP[node.join]
    if (!op) throw new PickerRefusal('picker:shape')
    return parts.reduce((a, b) => `(${a} ${op} ${b})`)
  }
  throw new PickerRefusal('picker:shape')
}

function readTerm(n, vocab) {
  if (n.type === 'num') return { t: 'num', value: n.value }
  if (n.type === 'series') {
    // A table scalar and a bar series are the SAME node type (E-1). The
    // vocabulary is what tells them apart, and the picker offers both.
    if (!vocab.series.has(n.name) && !vocab.scalars.has(n.name)) throw new PickerRefusal('picker:term')
    return { t: 'name', name: n.name }
  }
  if (n.type === 'call' && vocab.functions.has(n.name)) {
    // ONE level. A nested call is a real formula and the formula field shows it.
    const args = n.args.map((a) => {
      if (a.type === 'call' || a.type === 'op') throw new PickerRefusal('picker:term')
      return readTerm(a, vocab)
    })
    return { t: 'call', name: n.name, args }
  }
  throw new PickerRefusal('picker:term')
}

function readCondition(n, vocab) {
  if (n.type === 'op' && OP_JOIN[n.name]) {
    const children = []
    const absorb = (k) => {
      // ⛔ SAME JOIN ONLY. `(a && b) || c` must stay nested: flattening mixed
      // joins changes the meaning and the hash property is what would catch it.
      if (k.type === 'op' && k.name === n.name) { absorb(k.args[0]); absorb(k.args[1]) }
      else children.push(readCondition(k, vocab))
    }
    absorb(n.args[0]); absorb(n.args[1])
    return { kind: 'group', join: OP_JOIN[n.name], children }
  }
  if (n.type === 'op' && vocab.comparators.has(n.name)) {
    return { kind: 'row', left: readTerm(n.args[0], vocab), cmp: n.name, right: readTerm(n.args[1], vocab) }
  }
  if (n.type === 'op' || n.type === 'call' || n.type === 'series' || n.type === 'num') {
    throw new PickerRefusal('picker:not-a-condition')
  }
  throw new PickerRefusal('picker:node')
}

/** The tree, read as a picker — or a REFUSAL that names its door and hands back
 *  NOTHING. Never throws. */
export function fromAst(ast, vocab = vocabulary()) {
  try {
    const group = readCondition(ast, vocab)
    // A single row at the top is still a one-row group, so the UI has exactly
    // one shape to render and `toSource` has exactly one case to spell.
    return { ok: true, group: group.kind === 'group' ? group : { kind: 'group', join: 'and', children: [group] } }
  } catch (err) {
    const guard = err instanceof PickerRefusal ? err.guard : 'picker:node'
    return { ok: false, guard, reason: REFUSALS[guard] }
  }
}

/** The normal form: a group never contains a group of the SAME join.
 *
 *  ⛔ WITHOUT THIS THE IDENTITY PROPERTY IS FALSE, and it is false in the
 *  direction that looks fine. `and[ and[a,b], c ]` spells `((a && b) && c)`,
 *  which reads back as `and[a,b,c]` — a picker the user did not have. The UI
 *  therefore only ever produces canonical shapes, and this is the assertion. */
export function canonicalPicker(node) {
  if (node.kind === 'row') return node
  if (node.kind !== 'group') throw new PickerRefusal('picker:shape')
  const children = []
  for (const raw of node.children || []) {
    const c = canonicalPicker(raw)
    if (c.kind === 'group' && c.join === node.join) children.push(...c.children)
    else children.push(c)
  }
  if (!children.length) throw new PickerRefusal('picker:shape')
  return { kind: 'group', join: node.join, children }
}

export function isCanonical(node) {
  try { return JSON.stringify(canonicalPicker(node)) === JSON.stringify(node) } catch { return false }
}
```

- [ ] **Step 5: Run green, then build the two surfaces**

```bash
cd app && npx vitest run src/components/chart/builder/criteria.test.js; echo "EXIT=$?"
```

`CriteriaPicker.jsx` rides the shipped primitives — **no new chrome** (spec §1.5):

- `UIcon` for every glyph. **No emoji** (`feedback_no_generic_emoji`).
- Breakpoints from `app/src/styles/breakpoints.css` — **only 640 and 1024**.
- `--tap-min: 44px` on every interactive element.
- ⚠️ `useMediaQuery` is **stale at first paint** — CSS `@media` for layout, `useIsTouch()` only for click-triggered rendering.
- It renders `styles` from the existing `BuilderSheet.module.css` rather than a second stylesheet.
- Its only output is `onSourceChange(toSource(canonicalPicker(group)))`. It does **not** parse, lint, budget, read back or save. Those are `FormulaField`'s and the sheet's, unchanged.

`CoverageLine.jsx` renders E-3's envelope and **is created here, not in E-7** — E-4 owns the scan surface, so E-4 owns the sentence that surface reads:

```jsx
{/* ⭐ §6.3 — A SCREEN STATES ITS OWN COVERAGE. "3,742 evaluated · 3,699 answered
    · 2 dropped · 41 not computable — here they are." Four counts, because
    "we could not compute it" and "something broke" are different facts to a
    trader (controller resolution 5). ⛔ Do NOT collapse them to make the line
    shorter: a screen that silently loses symbols returns fewer hits and looks
    like a quiet market. E-7 adds `withheld` BESIDE these, never inside them. */}
```

In `BuilderSheet.jsx`, the mount is small and its comment says what it is:

```jsx
{/* ── THE SECOND DOOR ONTO ONE OBJECT (Phase E, E-4) ───────────────────
    ⛔ A MODE, NOT A SECOND BUILDER. The picker's only output is the SAME
    `source` string the text box holds, so a picked condition goes through
    the same parse, the same budget walk, the same linter, the same
    read-back and the same Save button as a typed one. A second builder
    would be a second grammar — the seam this task exists to close.

    ⛔ AND THE PICKER IS DERIVED FROM THE TREE, NOT STORED. Switching to it
    reads `result.ast`; a formula it cannot show is REPORTED, and the
    picker stays empty rather than half-right. */}
<div className={styles.modeRow} role="tablist" aria-label="How to build this">
  <button type="button" role="tab" aria-selected={mode === 'picker'}
    onClick={() => setBuildMode('picker')}>Conditions</button>
  <button type="button" role="tab" aria-selected={mode === 'formula'}
    onClick={() => setBuildMode('formula')}>Formula</button>
</div>
{buildMode === 'picker' && (
  <CriteriaPicker
    ast={result?.ast || null}
    onSourceChange={setSource}
    onUnrepresentable={(refusal) => setPickerNote(refusal.reason)}
  />
)}
```

- [ ] **Step 6: 🔴 The wire-cut file — every case drives the picker THROUGH the sheet**

`BuilderSheet.criteria.test.jsx`. The idiom is the shipped Task-13 block in `BuilderSheet.test.jsx`, verbatim in shape:

```jsx
// ⛔ EVERY CASE HERE DRIVES THE PICKER **THROUGH THE SHEET**. Rendering
// `CriteriaPicker` on its own is what `CriteriaPicker.test.jsx` already does;
// those cases would stay green for the entire time the picker was unreachable,
// which is precisely how eight features shipped this week built, tested, green
// and mounted nowhere. These fail if the mount is removed while both components
// remain perfectly correct — the only thing that distinguishes a wiring test
// from a component test.

it('picking a condition fills the FORMULA BOX and produces the tree read-back', async () => {
  render(<BuilderSheet open onClose={noop} />)
  await user.click(screen.getByRole('tab', { name: /conditions/i }))
  await pickRow({ left: 'close', cmp: '>', right: 'open' })
  // The text box — the SHIPPED one — must now hold the picked source.
  expect(screen.getByLabelText('Formula')).toHaveValue('(close > open)')
  // …and the read-back is `sentenceFor`'s, not the picker's.
  await act(() => vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1))
  expect(screen.getByTestId('readback')).toHaveTextContent(
    evaluateFormula('(close > open)', BUILDER_INPUT_SCOPE).readback)
})

it('a SCALAR is offered in the picker and survives the round trip through the sheet', async () => {
  // ⭐ E-1's whole point, seen from the surface: `rs_rank > 80` is a condition a
  // member can BUILD, not just type — and against TC2000 that is the difference
  // between a criteria builder and a demo.
  render(<BuilderSheet open onClose={noop} />)
  await user.click(screen.getByRole('tab', { name: /conditions/i }))
  await pickRow({ left: 'rs_rank', cmp: '>', right: '80' })
  expect(screen.getByLabelText('Formula')).toHaveValue('(rs_rank > 80)')
})

it('a formula the picker cannot show is REPORTED, and the picker stays empty', async () => {
  render(<BuilderSheet open onClose={noop} />)
  await typeFormula('sma(close, 20)')
  await user.click(screen.getByRole('tab', { name: /conditions/i }))
  expect(screen.getByTestId('picker-note')).toHaveTextContent(/yes-or-no/i)
  expect(screen.queryAllByTestId('picker-row')).toHaveLength(0)
  // ⛔ AND THE FORMULA IS UNTOUCHED. A picker that cleared the box on a mode
  // switch would destroy the user's work to preserve its own consistency.
  expect(screen.getByLabelText('Formula')).toHaveValue('sma(close, 20)')
})

it('the SAVED document carries no picker shape', async () => {
  const spy = saveSpy()
  await buildAndSaveViaPicker()
  const doc = spy.lastDocument()
  const keys = JSON.stringify(doc)
  expect(keys).not.toMatch(/"kind"\s*:\s*"(row|group)"/)
  expect(doc.compute.source).toBe('(close > open)')
  expect(astHash(parseFormula(doc.compute.source).ast)).toBe(doc.compute.fn)
})
```

And the coverage line's own wire-cut case, in `CoverageLine.test.jsx` plus one case driven through the scan surface E-4 chose in Step 1:

```jsx
it('the coverage line reports NOT COMPUTABLE separately from DROPPED', () => {
  render(<CoverageLine coverage={{ evaluated: 3742, answered: 3699, dropped: 2,
                                   not_computable: 41, dropped_symbols: [] }} />)
  const line = screen.getByTestId('coverage-line')
  expect(line).toHaveTextContent(/3,699 answered/)
  expect(line).toHaveTextContent(/41 .*not comput/i)
  // ⛔ 43 dropped would tell a trader the screen is broken. 2 dropped and 41
  // short of history tells them what is true.
  expect(line).not.toHaveTextContent(/43/)
})
```

- [ ] **Step 7: Gate**

```bash
cd app && npm run build && npx vitest run; echo "EXIT=$?"
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q; echo "EXIT=$?"
python tools/ast_conformance.py --check;   echo "EXIT=$?"
python tools/ast_conformance.py --escapes; echo "EXIT=$?"
python tools/alert_replay.py --check;      echo "EXIT=$?"
python tools/chart_parity.py --base-a $A --base-b $B --repeat 5 \
    --dist-a .parity-dist-a --dist-b .parity-dist-b --expect 0; echo "EXIT=$?"
```

**The measurement:** the corpus size and its **derived** coverage census over every manifest name the picker offers; **three properties, all 400 cases** — picker identity, tree identity by `astHash`, canonicity; the must-refuse corpus size with every case proven to **parse first** and every guard distinct; the `yields`-stripped manifest proven to make `vocabulary()` throw; the live parity cases at `--expect 0` over 5 runs with the distinct set of all values equal to `{0}`.

**The non-measurement assertion:** E-4 owes **no new parity case**, and the reason is stated rather than assumed — the picker produces the same `ast` documents the formula field already produces, so a new case would render a chart Phase D Task 16's `ast_sma_only` case already covers. ⛔ **That is exactly why the wire-cut file exists:** the pixel gate says nothing about whether the picker is reachable, and thousands of green frontend tests said nothing about `ConciergeBox` being mounted nowhere for a day. Plus: `functions` still holds its eleven (E-A9 out of scope), and `git diff HEAD -- app/src/components/chart/engine/ast/closedTable.json` is **empty** — E-1 is the manifest's only writer.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `fromAst` returns a partial picker instead of refusing (drop the unreadable child, keep the rest) | ⭐ **the mutation this task exists for.** A silently lossy reconstruction IS the PCF seam; only the identity property sees it |
| **M2** | `absorb` flattens across joins (drop the `k.name === n.name` test) | `(a && b) \|\| c` becomes `and[a,b,c]`; the picker-identity property survives it and only the **hash** property catches it |
| **M3** | `toSource` emits `a && b` without the wrapping parentheses | precedence changes the tree; the hash property |
| **M4** | delete the corpus coverage census | the corpus can then cover three names and report 400 green cases |
| **M5** | `buildDefinition` gains `meta.picker` | E4-A1 — a third artifact that drifts |
| **M6** | remove `<CriteriaPicker/>` from `BuilderSheet.jsx`, leaving both files correct | 🔴 the wire-cut. `criteria.test.js` and `CriteriaPicker.test.jsx` must both stay GREEN through this mutation and only `BuilderSheet.criteria.test.jsx` may go red — **verify that split, or the wire-cut test is measuring the component again** |
| **M7** | `vocabulary()` falls back to a hand-list when `yields` is absent | CORRECTION 2 — a second grammar, arriving as a convenience |
| **M8** | `CoverageLine` sums `not_computable` into `dropped` | a capped-history universe reads as a failing screen; controller resolution 5 exists to keep those apart on the surface a member actually reads |
| **M9** | the join surface builds SQL from the client's `def_hash` string instead of the parametrized fragment | E4-A5; `filters.column_for`/`is_valid_op` gate every existing query for this reason |

⚠️ **M6's lethality is asserted in two directions and both must be checked.** A wire-cut mutation that also reds the component suites has not proven the thing it claims.

- [ ] **Step 8: Control audit + commit**

```bash
grep -rn "BuilderSheet\|FormulaField\|evaluateFormula" app/src --include=*.jsx --include=*.js | grep -iE "test|spec"
```
Read each hit's stated **reason**, not its assertion. `BuilderSheet.test.jsx` and `BuilderSheet.edit.test.jsx` both assert the sheet's shape and both will see a new tablist; a case that counts buttons or asserts a focus-ring order is guilty until proven innocent. ⚠️ **The focus trap (`FOCUSABLE`, `trapTab`) enumerates focusables from the live panel** — new controls join the ring automatically, and the existing wrap-around cases must be re-run rather than assumed.

⚠️ Re-run `enumerationSites.test.js`, **report the delta, do not edit it.**

```bash
git add app/src/components/chart/builder/criteria.js \
        app/src/components/chart/builder/CriteriaPicker.jsx \
        app/src/components/chart/builder/criteria.test.js \
        app/src/components/chart/builder/CriteriaPicker.test.jsx \
        app/src/components/chart/builder/BuilderSheet.criteria.test.jsx \
        app/src/components/screener/CoverageLine.jsx \
        app/src/components/screener/CoverageLine.test.jsx \
        tests/fixtures/criteria/must_refuse.json
git diff --stat HEAD -- app/src/components/chart/builder    # read the hunks
git commit -m "feat(builder): a criteria picker that is a VIEW over the tree, and the round trip is the gate" -- \
  app/src/components/chart/builder app/src/components/screener \
  tests/fixtures/criteria/must_refuse.json
```

---

# Task E-5: Natural language → scan — the model emits a TREE, it still cannot author the sentence, and the vocabulary it interprets against is the FIRM'S

**Files:**
- Create: `app/src/components/chart/engine/ast/conceptVocabulary.json`
- Create: `api/services/concept_vocabulary.py`
- Create: `tests/test_concept_vocabulary.py`
- Modify: `api/services/definition_concierge.py` (⛔ LF)
- Modify: `tests/test_definition_concierge.py`
- Modify: `app/src/components/chart/builder/ConciergeBox.jsx` (⛔ LF)
- Modify: `app/src/components/chart/builder/ConciergeBox.test.jsx`
- Create: `app/src/components/chart/builder/BuilderSheet.scanConcierge.test.jsx` (the wire-cut file, ⛔ LF)
- Modify: `api/routers/user_definitions.py` (the existing `/propose` route gains fields; **no new route**)

**Interfaces:**
- Consumes: `ast_table.TABLE` (now with `scalars` and `yields`) · `scan_definition.is_boolean_tree` (**E-2's, CALLED not re-derived**) · `check_budget` · `ast_lint.lint_repaint` · `interpret` · `cost_guard.{may_synthesize, estimate_cost, record}` · `user_definitions.{NODE_TYPES, assert_canonical}` · `brain_service.{lookup_playbook, setup_winrate}` · `app/src/constants/setupGroups.js::SETUP_GROUPS`.
- Produces:
  ```python
  # api/services/concept_vocabulary.py  — the reader, mirroring ast_table.py
  VOCAB_VERSION_KEY = "version"
  def load(path=None) -> Mapping
  def concepts(vocab=None) -> Mapping[str, Mapping]
  def resolve(word, *, vocab=None, table=None) -> dict
      # {"ok": True, "source": "<formula text>", "grounding": {...}, "version": "<v>"}
      # | {"ok": False, "gate": "concept:ungrounded"|"concept:ambiguous", "reason": "<sentence>"}
  def grounding_report(vocab=None) -> dict     # every concept, its grounding, and whether it still resolves

  # api/services/definition_concierge.py
  def propose(prompt: str, *, user_id, bars=None, kind: str = "indicator") -> dict
  # kind in ("indicator", "scan").
  #   {ok: True, ast, source, sentence, repaint, freshness, kind, concepts: [...], …}
  #   | {ok: False, reason, gate}
  ```

**SOLO.** 🔴 **AMENDMENT 1 makes this a knowledge layer, not a translator.**

---

⏳ **OWNER — design §8.3: what a claim in front of a member SAYS.** AMENDMENT 1 consequence 4: *"`setup_winrate` is a claim. If a concept is offered with a win rate attached, that number is subject to §1.6 and to E-6's record — it is not decoration."* **E-5 therefore ships NO win-rate number on any surface.** The vocabulary may carry `winrate_source` as *provenance* (which playbook grounds the concept), and the concierge may name the setup; it may not render a percentage. Unblocking that needs §8.3 answered **and** E-6 landed.

⏳ **OWNER — which concepts ship in v1 beyond the derivable seed.** AMENDMENT 1 grounds the vocabulary in three assets, so the seed is derivable: **one concept per `SETUP_GROUPS` entry that `lookup_playbook` resolves**, plus **one per screener concept column E-1 declared as a scalar** (`tight_consolidation`, `nr7`, `inside_bar_run`, `higher_lows_run`, `accdis`, `pullback_depth_pct`, `consecutive_up`/`consecutive_down`, `dist_52w_high_pct`, `vol_ratio`). Anything beyond that seed — a vernacular phrase with no playbook and no column behind it — is the owner's to add, and until they do it is **refused by name**. ⛔ *"Cheap"* is the worked example: it has no defensible definition, and the honest answer is to ask, not to invent a P/E threshold.

---

- [ ] **Step 1: Write the failing tests — the surviving property first, the vocabulary second, the feature third**

```python
def test_a_PLANTED_SCALAR_reaches_the_tool_schema_BY_NAME_with_no_edit_here(concierge):
    """⭐ E-A7 ARRIVES AS DATA. The schema's enums are the table's own key sets
    (`tool_schema`, :195), so the fourth section must reach the model's
    vocabulary WITHOUT a line of this module changing — and the only way to
    prove that is a SYNTHETIC manifest carrying a name no source file contains.

    ⛔ AND THE PROMPT'S ENGLISH HALF COMES FROM THE SAME DERIVATION. A schema
    that enforces a vocabulary the prompt never mentions produces a model that
    guesses and a boundary that refuses — technically correct, uselessly.
    """
    planted = _clone_table()
    planted[ast_table.SCALARS_SECTION] = dict(planted.get(ast_table.SCALARS_SECTION, {}))
    planted[ast_table.SCALARS_SECTION]["zzPlantedScalar"] = {
        "source": {"store": "screener_rows", "column": "zz"},
        "as_of": {"column": "snapshot_date", "grain": "date"},
        "cadence": "nightly", "yields": "num", "sentence": "the planted value"}

    schema = concierge.tool_schema(planted)
    enums = _every_name_enum(schema["input_schema"])
    assert any("zzPlantedScalar" in e for e in enums), (
        "the scalars section did not reach a single enum — the schema is not "
        "reading the manifest's sections, it is reading three of them by name")
    assert "zzPlantedScalar" in concierge.vocabulary_text(planted)

    # The control: the same walk over a manifest WITHOUT the plant must not
    # find it, or the assertion above passes against any string at all.
    assert not any("zzPlantedScalar" in e
                   for e in _every_name_enum(concierge.tool_schema()["input_schema"]))


def test_the_SECTION_LIST_is_read_from_the_manifest_not_typed_here(concierge):
    """⛔ THE ANTI-COPY SCAN, EXTENDED TO SECTIONS. `test_no_declared_FUNCTION_or_
    SERIES_name_is_a_string_constant_in_this_module` already forbids the NAMES.
    A fourth hard-coded `for name, spec in t["scalars"].items()` block would pass
    that rail and still be a hand-list — of SECTIONS rather than of entries.

    So: plant a FIFTH section in a synthetic manifest and require its entries
    back. A module that enumerates four sections by name cannot answer.
    """
    planted = _clone_table()
    planted["zzPlantedSection"] = {"zzFromFifth": {"doc": "planted"}}
    enums = _every_name_enum(concierge.tool_schema(planted)["input_schema"])
    assert any("zzFromFifth" in e for e in enums)


def test_the_concierge_NEVER_produces_the_sentence_ON_EITHER_KIND(concierge):
    """🔴 D-A5, RE-ASSERTED STRUCTURALLY AFTER THE EXTENSION. `propose` now takes
    a `kind`, and the cheapest way to add a scan path is a second return
    statement — with a second `sentence`. So the rail is not "one assignment"
    but "EVERY assignment to `sentence`, on every path, is `sentence_for(ast_obj)`".

    ⭐ AND AMENDMENT 1 MAKES IT MORE LOAD-BEARING, NOT LESS. A member who says
    "trending stocks" is shown "the close is above the 50-day average, and the
    50-day average is above the 200-day" and confirms or corrects it BEFORE
    anything is saved. The AI proposes; the tree is the truth; the sentence is
    derived from the tree.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    sources = _assigns_to(_function(src, "propose"), "sentence")
    assert sources and set(sources) == {"sentence_for(ast_obj)"}, (
        f"`sentence` was assigned from {sources} — the read-back is derived from "
        "the tree on every path, or it is derived on none of them")
    tree = pyast.parse(src)
    for fn in (n for n in pyast.walk(tree) if isinstance(n, pyast.FunctionDef)):
        for s in _assigns_to(fn, "sentence"):
            assert s == "sentence_for(ast_obj)", f"{fn.name} assigns sentence from {s}"


def test_the_structural_rail_REPORTS_A_SYNTHETIC_OFFENDER_BY_NAME(concierge):
    """⚠️ THE CONTROL, AND WITHOUT IT THE RAIL IS VACUOUS. A synthetic module that
    assigns `sentence` from the MODEL RESPONSE must be reported by the offending
    EXPRESSION — not merely "something is wrong" — and the clean twin must come
    back clean IN THE SAME TEST, or the walk could be reporting everything.
    """
    poisoned = (
        "def propose(prompt, *, user_id, bars=None, kind='scan'):\n"
        "    answer = call_model(prompt)\n"
        "    ast_obj = answer['ast']\n"
        "    sentence = answer['summary']\n"
        "    return {'sentence': sentence}\n")
    assert _assigns_to(_function(poisoned, "propose"), "sentence") == ["answer['summary']"]

    clean = (
        "def propose(prompt, *, user_id, bars=None, kind='scan'):\n"
        "    ast_obj = 1\n"
        "    sentence = sentence_for(ast_obj)\n"
        "    return {'sentence': sentence}\n")
    assert _assigns_to(_function(clean, "propose"), "sentence") == ["sentence_for(ast_obj)"]


def test_a_SCAN_proposal_that_yields_a_NUMBER_is_refused(concierge, model):
    """⭐ A SCAN IS `<ast> != 0` ON THE LAST CONFIRMED BAR (E-A1). A tree that
    yields a number is a perfectly good INDICATOR and a wrong answer to "find me
    stocks where…", and handing it back as a scan would silently screen on
    `sma(close,20) != 0` — true for every symbol in the universe.
    """
    with model_emitting([tree_for("sma(close, 20)")]):
        res = concierge.propose("find me stocks in an uptrend", user_id=U, bars=BARS, kind="scan")
    assert res["ok"] is False
    assert res["gate"] == "scan:not-a-condition"
    assert "ast" not in res


def test_the_condition_check_is_E2s_FUNCTION_and_there_is_no_second_PYTHON_copy(concierge):
    """⛔ ONE FACT, ONE IMPLEMENTATION PER LANE. CORRECTION 2 put `yields` on the
    manifest so nobody hand-lists comparators; E-2 then wrote the ONE Python
    derivation (`scan_definition.is_boolean_tree`). A second Python walk here
    would satisfy CORRECTION 2 to the letter and re-create `williams_r` vs
    `williamsR` inside one language.

    AST, not grep: the concierge's scan stage must CALL it.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    calls = {pyast.unparse(n.func) for n in pyast.walk(pyast.parse(src))
             if isinstance(n, pyast.Call)}
    assert any(c.endswith("is_boolean_tree") for c in calls)
    # …and no local re-derivation: no function in this module may read the
    # operators section's `yields` directly.
    assert "yields" not in _string_constants(src)


def test_an_INDICATOR_proposal_is_UNAFFECTED_by_the_scan_stage(concierge, model):
    """The control for the stage above: the same tree, `kind='indicator'`, is
    accepted. A stage that refused both would be a regression wearing a gate's
    clothes."""
    with model_emitting([tree_for("sma(close, 20)")]):
        res = concierge.propose("a twenty bar average", user_id=U, bars=BARS)
    assert res["ok"] is True


def test_the_scan_path_takes_NO_SECOND_VALIDATION_ROUTE(concierge):
    """⛔ ONE PIPELINE. The existing rail
    (`test_the_concierge_reaches_the_guards_THROUGH_THE_SAME_FUNCTIONS_a_typed_
    formula_does`) walks `_validate`'s call graph; it must still be the ONLY
    validator, with the scan stage INSIDE it rather than beside it.
    """
    src = Path(concierge.__file__).read_text(encoding="utf-8")
    validators = [n.name for n in pyast.walk(pyast.parse(src))
                  if isinstance(n, pyast.FunctionDef)
                  and any(c in pyast.unparse(n) for c in ("check_budget", "lint_repaint"))]
    assert validators == ["_validate"], (
        f"{validators} all reach a guard — a second validation path is a second "
        "set of gates to keep in step")
```

`tests/test_concept_vocabulary.py` — **AMENDMENT 1's four consequences, each as a gate:**

```python
def test_EVERY_concept_is_GROUNDED_and_the_grounding_is_CHECKED_not_claimed():
    """🔴 AMENDMENT 1 §A1.3. A generic LLM guesses what "trending" means and
    guesses differently next Tuesday. The moat is that UCT's answer comes from
    the firm's own assets, and a "grounding" nobody verifies is a comment.

    Three admissible groundings, and EVERY concept must have at least one:
      * a `SETUP_GROUPS` name that `brain_service.lookup_playbook` RESOLVES;
      * a screener concept column E-1 declared as a SCALAR;
      * a composition of names already declared in the closed table.
    ⛔ The check RESOLVES each one. A playbook key that no longer exists must go
    RED here rather than ship a concept that expands into nothing.
    """
    for word, spec in concept_vocabulary.concepts().items():
        report = concept_vocabulary.resolve(word)
        assert report["ok"], f"{word}: {report['reason']}"
        g = report["grounding"]
        assert g["kind"] in ("playbook", "scalar", "composition"), (word, g)
        if g["kind"] == "playbook":
            assert brain_service.lookup_playbook(g["setup"]).get("ok") is not False, word


def test_every_concept_EXPANDS_to_a_tree_the_SHIPPED_parser_accepts():
    """⛔ A concept that does not parse is a refusal a member meets at save time,
    which is the worst possible moment to discover it. Every entry's `source` is
    parsed here, and every NAME it reaches must be DECLARED in the closed table —
    derived from the manifest, never from this file.
    """
    declared = ast_table.declared_names()
    for word, spec in concept_vocabulary.concepts().items():
        tree = parse_or_raise(spec["source"])
        assert _names_in(tree) <= declared, (word, sorted(_names_in(tree) - declared))


def test_an_UNGROUNDABLE_concept_is_REFUSED_BY_NAME_and_NEVER_APPROXIMATED():
    """🔴 AMENDMENT 1 consequence 3. "Cheap" has no defensible definition, and the
    honest answer is to ask, not to invent a P/E threshold. §1.6's "unmeasured
    accuracy claims" applies to a vocabulary too.

    ⛔ A WRONG SCAN THAT LOOKS RIGHT IS WORSE THAN A REFUSAL, and the refusal
    NAMES THE WORD — the concierge's existing gate-attribution style — so a member
    can say what they meant instead of being handed somebody's guess.
    """
    out = concept_vocabulary.resolve("cheap")
    assert out["ok"] is False
    assert out["gate"] in ("concept:ungrounded", "concept:ambiguous")
    assert "cheap" in out["reason"]
    assert "source" not in out          # not even a partial expansion


def test_a_concept_EXPANDS_AT_SAVE_TIME_and_the_stored_object_holds_the_TREE():
    """🔴 AMENDMENT 1 consequence 1 — VERSIONING, made structural.

    If "trending" changes definition, saved scans built on it MUST NOT silently
    change meaning. So the resolved concept expands into its TREE at save time;
    the scan stores the tree and the WORD IS PROVENANCE. A stored `{"concept":
    "trending"}` reference would make every saved scan a late binding to a
    vocabulary that moves.
    """
    res = concierge.propose("trending stocks", user_id=U, bars=BARS, kind="scan")
    assert res["ok"] is True
    assert "concept" not in json.dumps(res["ast"])            # no late binding in the tree
    assert res["concepts"] == [{"word": "trending",
                                "version": concept_vocabulary.load()["version"]}]
    # …and the version moving does NOT move an already-saved tree.
    saved = save_via_builder(res)
    with a_vocabulary_where("trending", "close > sma(close, 200)"):
        assert reload(saved)["compute"]["ast"] == res["ast"]
        assert reload(saved)["compute"]["fn"] == res["compute_fn"]


def test_NO_WINRATE_NUMBER_REACHES_ANY_SURFACE_BEFORE_E6():
    """⛔ AMENDMENT 1 consequence 4 + design §8.3 (OPEN). `setup_winrate` is a
    CLAIM. Until E-6 can back it and §8.3 says what it may say, the vocabulary
    carries the PROVENANCE (which playbook grounds the concept) and never a
    percentage. A number on a surface gets screenshotted.
    """
    payload = json.dumps(concierge.propose("trending stocks", user_id=U, bars=BARS, kind="scan"))
    assert not re.search(r"\d+(\.\d+)?\s*%", payload)
    assert "win_rate" not in payload and "winrate" not in payload
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b2-engine
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_concierge.py \
    tests/test_concept_vocabulary.py -q; echo "EXIT=$?"
```

⚠️ **Record which of them are GREEN in the red run and why.** `test_the_structural_rail_REPORTS_A_SYNTHETIC_OFFENDER_BY_NAME` should be green already — that is what proves the control predates the extension, exactly as C Task 9's `…_ACTUALLY_EXISTS` did.

- [ ] **Step 3: Implement the concierge half — three changes and no more**

1. **`tool_schema` iterates the manifest's SECTIONS**, not three named ones:

```python
#: Sections whose entries are NAMES a tree may reference. Read off the manifest,
#: so E-A7's `scalars` — and anything after it — reaches the model's vocabulary
#: and the API boundary's enums with no edit here.
#:
#: ⛔ THE UNDERSCORE PREFIX IS THE MANIFEST'S OWN CONVENTION for a note (`_`,
#: `_shape`, `_canonical`, …), and `tableVersion` is a scalar. Everything else
#: that maps names to specs is a vocabulary section, and treating it as one is
#: what makes a fourth section arrive as DATA.
def _name_sections(table):
    return {k: v for k, v in table.items()
            if not k.startswith("_") and isinstance(v, Mapping)}
```

2. **`_validate` gains ONE stage, inside itself, after the budget and before the lint** — the order is the attribution and it is load-bearing (the function's own docstring says so):

```python
    if kind == "scan" and not scan_definition.is_boolean_tree(tree):
        raise _Refused(
            "scan:not-a-condition",
            "a screen needs a yes-or-no condition and this expression produces a "
            "number — compare it to something, or save it as an indicator")
```

⛔ **`scan_definition.is_boolean_tree` is CALLED, not re-derived.** It reads `yields` off the manifest (CORRECTION 2), it is E-2's single Python implementation, and a local copy here would be the same hand-list arriving one function later.

3. **`propose` takes `kind`, threads it to `_validate`, and returns it.** ⛔ **One `return {ok: True, …}` in the function, one `sentence = sentence_for(ast_obj)`.** If the scan path tempts a second return, that is the mutation the rail exists for.

The frontend half is two lines: `ConciergeBox` takes `kind` and puts it in the request body. ⛔ **It still ignores `body.sentence`** — its header says why, and `ConciergeBox.test.jsx` already plants a different one.

- [ ] **Step 4: Implement the concept vocabulary — DATA, versioned, in ONE file both lanes read**

`app/src/components/chart/engine/ast/conceptVocabulary.json`, **beside `closedTable.json` and for the same reason** (AMENDMENT 1: *"Not prompt text — **data**, like `closedTable.json`… two vocabularies is the defect this repo has measured twice"*). `api/services/concept_vocabulary.py` reads it the way `ast_table.py` reads the manifest.

```jsonc
{
  "version": "2026-08-09.1",
  "_why": "TRADER VERNACULAR MAPPED ONTO CANONICAL TREES BUILT FROM THE CLOSED TABLE. A generic model guesses what `trending` means and guesses differently next Tuesday; this file is the firm's answer, reviewable in a diff. ⛔ IT IS NOT A SECOND GRAMMAR: every `source` here is ordinary formula text that the ONE parser parses and the ONE linter lints. A concept adds no node type, no function and no name -- it is an ABBREVIATION for a tree the table can already express.",
  "_expansion": "A CONCEPT EXPANDS AT SAVE TIME AND THE SCAN STORES THE TREE. The word is PROVENANCE, carried in `concepts[]` beside the definition, never a late binding inside `compute.ast`. If `trending` is redefined next quarter, every scan saved against today's definition keeps today's maths and today's `def_hash` -- which is the only reading under which a saved scan means what its author confirmed.",
  "_refusal": "AN UNGROUNDABLE WORD IS REFUSED BY NAME AND NEVER APPROXIMATED. `cheap` has no defensible definition and inventing a P/E threshold is `unmeasured accuracy claims` (spec §1.6) wearing a helpful face. The refusal says WHICH WORD it could not ground, in the concierge's existing gate-attribution style, so the member can say what they meant.",
  "_winrate": "GROUNDING IS PROVENANCE, NOT A NUMBER. `setup_winrate` is a CLAIM subject to §1.6 and to E-6's record, and design §8.3 -- what a published record may SAY -- is OPEN. So an entry names the playbook that grounds it and NEVER carries a percentage.",
  "concepts": {
    "trending": {
      "source":    "close > sma(close, 50) && sma(close, 50) > sma(close, 200)",
      "grounding": { "kind": "playbook", "setup": "Classic Flag/Pullback" },
      "sentence_hint": "above the 50-day average, with the 50-day above the 200-day"
    },
    "coiled": {
      "source":    "tight_consolidation > 0",
      "grounding": { "kind": "scalar", "column": "tight_consolidation" },
      "sentence_hint": "in a tight consolidation"
    }
  },
  "_refused": {
    "cheap": "no defensible definition. A P/E threshold is somebody's opinion, and the honest answer is to ask which measure the member means.",
    "strong": "ambiguous between relative strength, price momentum and fundamental quality — three different scans."
  }
}
```

`concept_vocabulary.resolve(word)`:

```python
def resolve(word, *, vocab=None, table=None) -> dict:
    """Expand a vernacular word into formula SOURCE, or refuse BY NAME.

    ⛔ THREE OUTCOMES AND NO FOURTH. A grounded concept returns its source and
    its grounding; a word in `_refused` returns `concept:ambiguous` with the
    stated reason; anything else returns `concept:ungrounded`. There is no
    "closest match" and no partial expansion -- AMENDMENT 1 consequence 3: a
    wrong scan that looks right is worse than a refusal.

    ⛔ AND THE GROUNDING IS RESOLVED, NOT TRUSTED. A `playbook` grounding calls
    `brain_service.lookup_playbook`; a `scalar` grounding checks the name is
    declared in the closed table's `scalars` section. A concept whose grounding
    has rotted refuses like any other -- which is what keeps this file honest as
    the KB and the screener both move.
    """
```

The concierge threads it in **before** the model call, so the model is told what the firm's words mean rather than asked to guess:

```python
#: ⭐ THE INTERPRETATION MUST BE VISIBLE (AMENDMENT 1 §A1.2). The concept is
#: expanded into SOURCE, the source becomes a TREE, and `sentence_for` renders
#: the read-back FROM THAT TREE. So a member who says "trending stocks" is shown
#: "the close is above the 50-day average, and the 50-day average is above the
#: 200-day" and confirms or corrects it BEFORE anything is saved.
#:
#: ⛔ THE MODEL NEVER SEES A CONCEPT IT MAY REINTERPRET. Resolution happens here,
#: against the file; what reaches the model is the expanded vocabulary text.
```

- [ ] **Step 5: 🔴 The wire-cut file**

`BuilderSheet.scanConcierge.test.jsx`. The scan concierge is reachable **from the scan surface** — the sheet in criteria mode passes `kind="scan"`, and accepting a proposal fills the same `source` the picker and the text box share.

```jsx
it('the English box on the CONDITIONS tab asks for a SCAN, and the answer lands in the shared source', async () => {
  render(<BuilderSheet open onClose={noop} />)
  await user.click(screen.getByRole('tab', { name: /conditions/i }))
  H.writeResponse = { ok: true, status: 200, json: async () => ({
    ok: true, kind: 'scan', ast: PROPOSED.ast, source: '(close > open)',
    repaint: 'non-repainting', freshness: 'live', sentence: LIE }) }
  await user.type(screen.getByLabelText(/plain English/i), 'stocks closing above the open')
  await user.click(screen.getByRole('button', { name: /draft a formula/i }))
  // The REQUEST carried the kind — a box that always asks for an indicator is a
  // box whose scan stage can never fire.
  expect(JSON.parse(H.lastRequest.body).kind).toBe('scan')
  await user.click(await screen.findByRole('button', { name: /use this formula/i }))
  expect(screen.getByLabelText('Formula')).toHaveValue('(close > open)')
  // …and the sentence shown is the TREE's, not the server's.
  expect(screen.queryByText(LIE)).toBeNull()
})

it('a REFUSED concept reaches the member BY NAME and nothing is drafted', async () => {
  render(<BuilderSheet open onClose={noop} />)
  await user.click(screen.getByRole('tab', { name: /conditions/i }))
  H.writeResponse = { ok: true, status: 200, json: async () => ({
    ok: false, gate: 'concept:ambiguous',
    reason: '"cheap" is ambiguous — tell me which measure you mean' }) }
  await user.type(screen.getByLabelText(/plain English/i), 'find me cheap stocks')
  await user.click(screen.getByRole('button', { name: /draft a formula/i }))
  expect(await screen.findByText(/"cheap" is ambiguous/)).toBeInTheDocument()
  // ⛔ AND NOTHING WAS DRAFTED. An approximation is worse than a refusal.
  expect(screen.getByLabelText('Formula')).toHaveValue('')
})
```

- [ ] **Step 6: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_concierge.py \
    tests/test_concept_vocabulary.py tests/test_user_definitions_auth.py -q; echo "EXIT=$?"
cd app && npx vitest run src/components/chart/builder/; echo "EXIT=$?"
cd .. && python tools/ast_conformance.py --check; echo "EXIT=$?"
python tools/alert_replay.py --check; echo "EXIT=$?"
```

**The measurement:** the planted scalar reaching an enum **by name** with no edit, plus its absence control; the planted **fifth section** reaching an enum; every assignment to `sentence` in the whole module equal to `sentence_for(ast_obj)`; the synthetic offender reported by expression **and** the clean twin reported clean; the scan stage's refusal gate name and the indicator control that must still pass; `_validate` proven the sole validator by AST; **every concept in the vocabulary resolved, parsed, and its names proven declared** — printed as a table of `word → grounding kind → source → names`; and the count of concepts, **derived from `SETUP_GROUPS` and the declared scalars, never typed**.

**The non-measurement assertion:** `MAX_MODEL_CALLS` unchanged (the repair loop is still bounded at one retry); the cost guard still consulted **before** the spend on every pass round the loop; `--check` still **`FIRE LOG MATCHES`, exit 0**. The concierge writes nothing to the store (`test_a_PROPOSAL_is_never_written_to_the_store`), and a scan proposal writes nothing either. `git diff HEAD -- app/src/components/chart/engine/ast/closedTable.json` is **empty** — the concept vocabulary is a *second file*, not an edit to the manifest, and E-1 remains the manifest's only writer.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `sentence` assigned from the model's response on the scan path only | ⭐ D-A5, at the exact seam an extension opens |
| **M2** | the `scalars` enum hand-listed in `_input_schema` | E5-A1 — the planted-manifest rail is the only thing that can see it |
| **M3** | `_name_sections` reverted to named sections | the planted **fifth section** rail; a fourth hard-coded block passes the name scan |
| **M4** | delete `test_the_structural_rail_REPORTS_A_SYNTHETIC_OFFENDER_BY_NAME` | the rail passes against a module with no `propose` at all — this is the mutation that proves the control is load-bearing |
| **M5** | the scan stage moved OUT of `_validate` into `propose` | a second validation path, and the AST rail is what sees it |
| **M6** | the scan stage re-derives the condition check instead of calling `scan_definition.is_boolean_tree` | CORRECTION 2 satisfied to the letter and broken in spirit — two Python implementations of one manifest fact |
| **M7** | `ConciergeBox` reads `body.sentence` | two guesses agreeing; already covered by a shipped case, re-run because the component changed |
| **M8** | an ungroundable word returns the CLOSEST grounded concept instead of refusing | ⭐ **AMENDMENT 1 consequence 3.** A member asked for "cheap" and got somebody's P/E threshold with a confident read-back |
| **M9** | `compute.ast` stores `{"concept": "trending"}` instead of the expanded tree | AMENDMENT 1 consequence 1 — every saved scan becomes a late binding to a vocabulary that moves, and `def_hash` stops meaning the maths |
| **M10** | `resolve` trusts a `playbook` grounding without calling `lookup_playbook` | a concept whose KB key has rotted expands into nothing and ships green |
| **M11** | a `setup_winrate` percentage is added to the proposal payload | §1.6 + design §8.3 is OPEN; a number on a surface gets screenshotted |

⚠️ **M2's lethality is NOT certain and must be verified before it is reported as a kill.** A hand-list that happens to enumerate the same names produces an identical schema for the SHIPPED manifest; only the planted-manifest case can distinguish them, so check that the kill came from `test_a_PLANTED_SCALAR_…` and not from a totality count.

- [ ] **Step 7: Control audit + commit**

```bash
grep -rn "tool_schema\|vocabulary_text\|_input_schema\|propose(" api/ tests/ app/src --include=*.py --include=*.jsx --include=*.js
grep -rn "lookup_playbook\|setup_winrate" api/ app/src --include=*.py --include=*.js --include=*.jsx
```
⚠️ `cost_guard`'s `_HARD_CAP_TRIPPED` / `_SOFT_CAP_LOGGED_FOR_DATE` are **process-local module state** and the web pod is deliberately one uvicorn process. Correct today, first thing to break on scale-out — the same class `CLAUDE.md` lists for the broker sync's `_locks`. **Name it in the report; do not fix it here.**
⚠️ `brain_service` **never raises** — it returns `{"ok": False, "error": "brain not available"}` when the pack is not installed. So a box without the Brain Pack makes every `playbook`-grounded concept refuse, which is correct behaviour and **must be reported as the measured environment**, not patched around.

```bash
git add app/src/components/chart/engine/ast/conceptVocabulary.json \
        api/services/concept_vocabulary.py tests/test_concept_vocabulary.py \
        app/src/components/chart/builder/BuilderSheet.scanConcierge.test.jsx
git commit -m "feat(concierge): English becomes a SCAN, the vocabulary is the firm's, and the sentence is still the tree's" -- \
  api/services/definition_concierge.py api/services/concept_vocabulary.py \
  tests/test_definition_concierge.py tests/test_concept_vocabulary.py \
  api/routers/user_definitions.py app/src/components/chart/builder \
  app/src/components/chart/engine/ast/conceptVocabulary.json
```

---

# Task E-6: The rule record — member-independent, append-only, forward-only, and structurally unable to read the notification ledger

**Files:**
- Create: `api/services/definition_record.py`
- Create: `tests/test_definition_record.py`
- Create: `docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md`
- Create: `docs/runbooks/definition-record.md`
- Modify: `api/services/screener/scan_evaluator.py` (**the receipt call only** — E-3 owns the module)
- ⛔ **NOT modified:** `api/services/signature/ledger.py` (CRLF), `api/services/alert_shadow_log.py`, `api/services/indicator_alert_evaluator.py`

**Interfaces:**
- Consumes: `scan_store.hits` / `scan_store.coverage` (E-2) · `scan_evaluator.evaluate_one` (E-3, for the wire-cut case) · `cap_universe.json` for the projection only.
- Produces:
  ```python
  def record_evaluation(def_hash, rev, tf, sym, first_bar_time, through_bar_time, *, at=None) -> bool
  def covers(def_hash, rev, tf, sym, *, first_bar_time, through_bar_time) -> bool
  def latest_evaluation(def_hash, rev, tf, sym) -> dict | None    # None == NEVER EVALUATED
  def prune(older_than_days=None, *, now=None) -> dict
  def horizon() -> dict            # {'sessions': int|None, 'days': int, 'oldest_proven': int|None}
  def claim_for(def_hash, rev, tf, *, first_bar_time, through_bar_time, syms=None) -> dict
  #   {'coverage': 'proven'|'partial'|'unproven', 'evaluated': int, 'answered': int,
  #    'dropped': int, 'not_computable': int, 'dropped_symbols': [...],
  #    'hits': int|None, 'hit_rate': None|float, 'window': (int, int),
  #    'starts_at': int, 'horizon': {...}}
  ```
  ⚠️ **`rev` is the integer `compute.rev`**, read off the definition by E-3 and returned in its envelope. E-6 carries it in the key for the same reason `signature_coverage` carries `version`: a rev bump means the maths moved, and a receipt that ignored it would certify work never done.

**SOLO.** 🔴 **This gates every public claim and all sharing.**

---

⏳ **OWNER — design §8.3: what a published record CLAIMS.** *"This rule fired 340 times, 61% followed through"* versus *"members were notified 340 times"* — §1.6 forbids selling the second as the first. **E-6 builds the record and a surface that can REFUSE; it ships NO public copy.** The sentence a member reads is the owner's.

⏳ **OWNER — §12 and sharing.** Design §8.2 and AMENDMENT 2 §A2.4: *recognition* is attribution, attribution **is** publishing, and §12 gates publishing *"until the ledger can hold publishers accountable"*. **E-6 is what makes it accountable, so the honest sequence is E-6 → attribution → sharing** — and §12 gets **amended rather than ignored**. ⛔ **No task in this plan ships sharing, attribution metadata, or a public claim surface.** That is a separate task after the amendment.

---

- [ ] **Step 1: Write the decision record FIRST — the eleven conditions, with their evidence**

`docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md`:

```markdown
# Decision: the signal ledger cannot back a rule-performance claim, and E-6 builds the store that can

**Status:** 🟢 **ACCEPTED — the ledger is a NOTIFICATION record. Eleven conditions
produce a right rule and an empty ledger, and five of them are member behaviour.**

**Date:** 2026-08-08 · **Phase:** E · **Measurement:** ground-truth §3.4

## 1. The eleven

| # | condition | evidence | member behaviour? |
|---|---|---|---|
| 1 | `active = 0` | `indicator_alert_service.py:467` — `list_active()` is `WHERE active=1` | 🔴 **yes** |
| 2 | snoozed | `indicator_alert_service.py:686-687` → `record_trigger` False → `if recorded` fails | 🔴 **yes** |
| 3 | level condition, same armed episode | `fire_key` is `ep:<arm_epoch>` (`:2314-2316`) — one receipt per EPISODE, not per bar | 🔴 **yes** |
| 4 | re-delivery of one fire | a released lease retried on a later cycle | no |
| 5 | user-authored (`ast` lane) | `admit_alert_fire:1741` — refused FIRST, in EVERY mode | 🔴 **yes** (nothing a member authors can ever accrue) |
| 6 | `ALERT_EVAL_MODE != "closed"` | `:1750-1756`. Committed default is `"closed"` since `0183a9b1` — **inert unless a Railway env override is in play** | no |
| 7 | `value is None` | `:1788`, `_run_one_cycle:2287` — `ichimoku.chikou` can never fire closed-bar | no |
| 8 | `compute.rev` migration suppression | `_rev.consume_if_suppressed` (`:2282-2284`) — the **entire first cycle** after a migration | 🔴 **yes** (an edit the member made) |
| 9 | bars fetch failure for a `(sym, tf)` group | `:2274-2278` — the whole group skipped, and **no coverage row says so** | no |
| 10 | any per-alert exception | `:2328-2332` | no |
| 11 | bar not closed / bad `bar_index` / non-product `tf` | `:1758`, `:1775`, `:1766` | no |

⛔ **Therefore ledger row count is a LOWER BOUND biased by who armed and who
snoozed.** Publishing it as accuracy is spec §1.6's *"unmeasured accuracy claims"*
trap reached by arithmetic rather than by intent, and it is the more dangerous
route because every number in it is true.

⚠️ And one correction the ground truth makes to the obvious reading: a receipt is
written on a fire that produced a **new fire-log row** — NOT on a fire that
reached anybody. `_dispatch_delivery` is called unconditionally (`:2307`) and
`_delivery_failed` is *"ALWAYS FALSE on the return value"* (`:1875`).

## 2. And it cannot be `alert_shadow_fires` either

Keyed on `alert_id` — still a record of a member's ROW. Default off
(`ALERT_SHADOW_ENABLED=1`, read per call). Measured **53.0 bytes/row**; at 10k
alerts, **279 GB/yr**. Its own docstring says it exists for the per-address DIFF
between lanes.

## 3. What E-6 builds instead

`signature_coverage` (`ledger.py:115`) is the right shape — append-only, one row
per *(rule, version, symbol, timeframe, evaluated window)* — and E-6 generalises
it to any definition as a **sibling table in the same database**, keyed by
`def_hash` + `rev`, with **no member column of any kind**.

## 4. And every number in it accrued AFTER the scan was created

AMENDMENT 2 §A2.3. Competitors answer *"how has this scan done?"* with a
**backtest**, and §1.6 lists backtest inflation as a trap never to step in. The
honest answer is better positioning than the inflated one:

> **"Every number we show you accrued after you asked for it."**

So a record starts at creation and is **empty on day one — say so plainly rather
than hiding the panel**; an *edited* scan starts a new record because `def_hash`
changed and the old record belongs to different maths; and ⛔ **no backfilled
"what it would have done" number may ever share a surface with a forward one.**
```

- [ ] **Step 2: Write the failing tests**

```python
def test_the_record_HAS_NO_MEMBER_COLUMN_and_the_column_set_is_READ_not_typed():
    """🔴 MEMBER-INDEPENDENCE IS STRUCTURAL, NOT INTENDED.

    ⛔ THE COLUMN SET COMES OUT OF `sqlite_master`, NEVER OFF A DOCSTRING.
    Four false alarms in one session came from typed table and field names
    (`lesson_probe_names_must_be_derived_not_typed`).
    """
    rec.record_evaluation(DEF, REV, "D", "AAPL", 20260101, 20260808)
    with sqlite3.connect(rec._DB_PATH) as c:
        cols = {r[1] for r in c.execute(f"PRAGMA table_info({rec.TABLE_NAME})")}
    forbidden = {"user_id", "alert_id", "member_id", "account_id",
                 "active", "snoozed", "snooze_until", "delivered"}
    assert not (cols & forbidden), (
        f"{sorted(cols & forbidden)} makes this a record of a MEMBER'S ROW, which "
        "is the thing the ledger already is and the thing this store exists not "
        "to be")
    # The control: the same probe over a synthetic member-keyed table DOES find
    # them, so a broken PRAGMA read cannot report a clean schema.
    with sqlite3.connect(":memory:") as c:
        c.execute("CREATE TABLE t (id INTEGER, user_id TEXT, sym TEXT)")
        bad = {r[1] for r in c.execute("PRAGMA table_info(t)")}
    assert bad & forbidden == {"user_id"}


def test_claim_for_CANNOT_REACH_the_signal_ledger_and_a_synthetic_offender_IS_NAMED():
    """🔴 THE IMPORT GRAPH, NOT A GREP. A grep counts comments and strings, and
    did so in both directions on this branch.

    `claim_for` answers "what did this rule say". If it could read
    `signature_signals`, the eleven conditions in the decision record would leak
    back in through a join nobody meant to write — and the leak would be INVISIBLE
    because every row it read would be real.
    """
    reached = _call_graph(rec.__file__, "claim_for")
    banned = {"record_signal", "get_signals", "signature_signals",
              "admit_alert_fire", "list_active", "record_trigger"}
    assert not (reached & banned), f"claim_for reaches {sorted(reached & banned)}"

    offender = ("def claim_for(h, rev, tf):\n"
                "    rows = get_signals(sym=None)\n"
                "    return {'hits': len(rows)}\n")
    assert _call_graph_src(offender, "claim_for") & banned == {"get_signals"}


def test_hit_rate_is_NONE_when_coverage_is_UNPROVEN_and_NEVER_ZERO():
    """⛔ RETURN None, NOT 0 (`lesson_a_derived_reference_needs_a_sanity_bound`).

    A `hit_rate` of 0.0 on an unproven window is a NUMBER, and a number gets
    published. `None` cannot be formatted into a marketing sentence by accident.
    """
    out = rec.claim_for(DEF, REV, "D", first_bar_time=20260101, through_bar_time=20260808)
    assert out["coverage"] == "unproven"
    assert out["hit_rate"] is None
    assert out["hits"] is None


def test_a_PRUNE_makes_the_claim_REFUSE_rather_than_SHRINK():
    """🔴 THE RETENTION FAILURE THIS STORE MUST NOT HAVE.

    Pruning a coverage row silently converts "proven over 400 sessions" into
    "proven over 90", and a hit rate recomputed over the survivors is a smaller,
    confident, WRONG number — §1.6's trap reached by arithmetic, exactly like the
    ledger's. So beyond the horizon the answer is `unproven`, and the horizon is a
    FACT THE CLAIM READS rather than a comment in a prune function.
    """
    _seed_window(first=20250101, through=20260808)
    before = rec.claim_for(DEF, REV, "D", first_bar_time=20250101, through_bar_time=20260808)
    assert before["coverage"] == "proven" and before["hit_rate"] is not None

    rec.prune(older_than_days=30)
    after = rec.claim_for(DEF, REV, "D", first_bar_time=20250101, through_bar_time=20260808)
    assert after["coverage"] == "unproven"
    assert after["hit_rate"] is None, (
        "the claim shrank instead of refusing — a smaller number over a pruned "
        "window is the ledger's own defect with a different table under it")
    assert after["horizon"]["oldest_proven"] is not None


def test_a_window_that_STARTS_BEFORE_THE_DEFINITION_EXISTED_is_REFUSED():
    """🔴 AMENDMENT 2 §A2.3 — "Every number we show you accrued after you asked
    for it."

    Every competitor answers "how has this scan done?" with a BACKTEST, and §1.6
    lists backtest inflation as a trap never to step in. Forward-only is not a
    policy in a docstring here: `record_evaluation` REFUSES a window that begins
    before the definition's own creation time, so a backfill cannot be written by
    accident, by a helpful script, or by a future task that means well.
    """
    _create_definition(DEF, created_at=20260601)
    with pytest.raises(ValueError, match="before the definition existed"):
        rec.record_evaluation(DEF, REV, "D", "AAPL", 20250101, 20260808)
    out = rec.claim_for(DEF, REV, "D", first_bar_time=20250101, through_bar_time=20260808)
    assert out["starts_at"] == 20260601
    assert out["coverage"] == "partial"      # the pre-creation stretch is not ours to claim
    assert out["hit_rate"] is None


def test_a_HYPOTHETICAL_can_never_be_SUMMED_WITH_or_RETURNED_BESIDE_a_receipt():
    """⛔ AMENDMENT 2 §A2.3, the half that is easy to lose later. "No backfilled
    'what it would have done' number may ever share a surface with a forward one.
    If a hypothetical is ever shown it is labelled, separated, and never summed
    with real receipts."

    E-6 ships NO hypothetical. The gate is that the payload has nowhere to put
    one: `claim_for`'s key set is asserted as an EXACT set, so a later task
    cannot slide `backtest_hits` in beside `hits` without this going red and
    somebody reading A2.3.
    """
    out = rec.claim_for(DEF, REV, "D", first_bar_time=20260601, through_bar_time=20260808)
    assert set(out) == rec.CLAIM_KEYS
    assert not any("backtest" in k or "hypothetical" in k or "simulated" in k for k in out)


def test_an_INVERTED_window_is_refused():
    """The shipped `record_coverage` refusal, re-derived rather than inherited:
    a containment test is satisfied by an inverted row for ANY probe between the
    two ends — a receipt that covers everything by covering nothing."""
    with pytest.raises(ValueError, match="runs backwards"):
        rec.record_evaluation(DEF, REV, "D", "AAPL", 20260808, 20260101)


def test_every_refusal_in_this_module_says_something_NO_OTHER_refusal_says():
    """C Task 9's M1: two gates sharing a phrase let `pytest.raises(match=…)`
    keep passing after the OTHER one was deleted. Asserted pairwise rather than
    trusted to three careful authors."""


def test_the_SWEEP_writes_a_receipt_and_CUTTING_THAT_CALL_is_visible():
    """🔴 THE WIRE-CUT. `definition_record` can be perfect and `scan_evaluator`
    can be perfect and the receipt can still never be written — which is a screen
    that computes the right answer and can never prove it did.

    So this drives the REAL evaluator and reads the RECORD, and it is the only
    case in this file that does. Both unit suites must stay green when the call
    is removed; only this one may go red.
    """
    scan_evaluator.evaluate_one(SCAN_DEF, "D", universe=["AAPL", "MSFT"], as_of=AS_OF)
    assert rec.covers(DEF, REV, "D", "AAPL",
                      first_bar_time=BARS[0]["t"], through_bar_time=BARS[-1]["t"])


def test_an_UNANSWERED_symbol_gets_NO_receipt_and_that_is_the_whole_point():
    """⭐ §6.3: *a screen states its own coverage*. `dropped_symbols` says which
    ones failed and why; the ABSENCE of a receipt is what makes that survivable —
    a rerun of only the unanswered set closes the gap, and a claim over the window
    refuses until it does.

    ⛔ The measured pattern this breaks: `bars_prewarm` counts a failure into
    NEITHER `warmed` nor `skipped`; `scan_volume` sets `m = {}` so a failed
    reference is indistinguishable from an empty market.

    ⛔ AND `not_computable` IS CARRIED THROUGH, NOT FOLDED (controller resolution
    5): a claim that says "39 of these had too little history and 2 broke" is a
    different fact from "41 dropped", and only the first tells a member whether to
    trust the screen.
    """
    out = scan_evaluator.evaluate_one(SCAN_DEF, "D", universe=["AAPL", "BROKEN", "SHORT"])
    assert [d["sym"] for d in out["dropped_symbols"]] == ["BROKEN", "SHORT"]
    assert out["dropped"] == 1 and out["not_computable"] == 1
    assert rec.latest_evaluation(DEF, REV, "D", "BROKEN") is None
    claim = rec.claim_for(DEF, REV, "D", syms=["AAPL", "BROKEN", "SHORT"],
                          first_bar_time=BARS[0]["t"], through_bar_time=BARS[-1]["t"])
    assert claim["coverage"] == "partial"
    assert claim["not_computable"] == 1
    assert claim["hit_rate"] is None
```

- [ ] **Step 3: Run, fail, implement**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_record.py -q; echo "EXIT=$?"
```

The store follows `ledger.py`'s shape exactly — lazy `_ensure_init`, `_WRITE_LOCK` + `_INIT_LOCK`, WAL, `timeout=10.0`, one `INSERT`, `UNIQUE(...)` making a re-run free, **every refusal a `ValueError`, no UPDATE and no rewrite path.** Its header:

```python
"""The rule record: "this definition evaluated this symbol over this window."

⭐ THE TEMPLATE IS `signature_coverage` (`api/services/signature/ledger.py:115`),
and it is GENERALISED rather than widened. That table's key is
`(indicator, version, …)` where `indicator` is a Signature rule address and
`version` is `rules.VERSIONS[...]`; putting a `def_hash` in that column would give
it two meanings and make `latest_coverage()` answer across two namespaces. Same
database, beside the rows it certifies, for the reason that module already gives:
a receipt in a second file can outlive the writes it certifies.

🔴 WHY IT CANNOT BE THE SIGNAL LEDGER. Eleven conditions produce a right rule and
an empty ledger, and FIVE are member behaviour — `active=0`, snoozed, a level
condition keyed per armed EPISODE, a user-authored `ast` fire refused FIRST in
every mode, and the whole first cycle after a `compute.rev` migration. Ledger row
count is a LOWER BOUND BIASED BY WHO ARMED AND WHO SNOOZED, and publishing it as
accuracy is spec §1.6's trap reached by arithmetic.
`docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md` carries all
eleven with their evidence; `test_claim_for_CANNOT_REACH_the_signal_ledger…`
makes the separation structural rather than intended.

⛔ AND IT IS NOT `alert_shadow_fires`. Keyed on `alert_id`, default off, measured
53.0 bytes/row => 279 GB/yr at 10k alerts. This store states a RETENTION HORIZON
up front, and beyond it the claim REFUSES rather than shrinking — a smaller hit
rate over a pruned window is the ledger's own defect with a different table
underneath.

🔴 AND IT IS FORWARD-ONLY (AMENDMENT 2 §A2.3). `record_evaluation` REFUSES a
window beginning before the definition's own creation time, so "every number we
show you accrued after you asked for it" is enforced by the writer rather than
promised by a docstring. An EDITED scan starts a new record because `def_hash`
changed and the old record belongs to different maths — D-A3's rev semantics give
that for free. No hypothetical is produced here and `CLAIM_KEYS` is an exact set
so none can be added beside a receipt without a test going red.
"""

#: ⚠️ OWNER-SETTABLE, AND THE ONLY PLACE EITHER NUMBER LIVES.
#: See docs/runbooks/definition-record.md for how to move them and what it costs.
RETENTION_DAYS = int(os.environ.get("DEFINITION_RECORD_RETENTION_DAYS", "540"))
PRUNE_EVERY_SEC = 6 * 3600

#: ⛔ AN EXACT SET, AND THAT IS THE POINT. A2.3 forbids a hypothetical sharing a
#: surface with a receipt; the cheapest way that happens is one more key.
CLAIM_KEYS = frozenset({
    "coverage", "evaluated", "answered", "dropped", "not_computable",
    "dropped_symbols", "hits", "hit_rate", "window", "starts_at", "horizon"})
```

- [ ] **Step 4: MEASURE the growth. Do not estimate it.**

⛔ The ground truth's 53.0 B/row is `alert_shadow_fires`' schema, not this one. Measure this one:

```bash
PYTHONDONTWRITEBYTECODE=1 python - <<'PY'
import io, json, os, tempfile, time
os.environ["DEFINITION_RECORD_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "rec.db")
from api.services import definition_record as rec
N = 50_000
t0 = time.time()
for i in range(N):
    rec.record_evaluation("sha256:%064x" % 1, 1, "D", "S%05d" % i, 20260101, 20260808)
size = os.path.getsize(rec._DB_PATH)
uni = len(json.load(io.open("api/data/cap_universe.json", encoding="utf-8")))
per = size / N
print(f"rows={N} bytes={size} per_row={per:.1f} insert_s={time.time()-t0:.1f}")
for defs in (1, 10, 100, 500):
    print(f"{defs:4d} definitions -> {per*uni*252*defs/1e9:.2f} GB/yr "
          f"(universe={uni}, 252 sessions)")
PY
```

Paste the table into the runbook and into the task report. **If the projection at a plausible definition count exceeds the volume, the horizon is wrong and the owner is told a number rather than a worry.**

⚠️ `cap_universe.json` is **3,742 tickers, MEASURED** (ground truth §2). Read it; do not type it.

- [ ] **Step 5: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_record.py \
    tests/test_scan_evaluator.py tests/test_signature_ledger.py \
    tests/test_alert_ledger_admission.py -q; echo "EXIT=$?"
python tools/alert_replay.py --check; echo "EXIT=$?"
python tools/alert_replay.py --diff --mode-a forming --mode-b closed; echo "EXIT=$?"
```

**The measurement:** bytes/row and the GB/yr projection at 1 / 10 / 100 / 500 definitions, over the **read** universe size; the column set out of `sqlite_master` with its synthetic control; the import-graph result for `claim_for` with the synthetic offender named; the three coverage verdicts (`proven` / `partial` / `unproven`) each produced by a **distinct measured cause** (full window · a pre-creation window · a pruned window); the prune-then-refuse pair; and `CLAIM_KEYS` asserted as an exact set.

**The non-measurement assertion:** `api/services/signature/ledger.py` **untouched** — `git diff --stat HEAD -- api/services/signature/` empty, and `signature_signals`' row count unchanged across the whole task. `--check` still **`FIRE LOG MATCHES`, exit 0**; `--diff` still **EVERY DIFFERENCE IS DECLARED**, 0 undeclared. `INDICATOR_FUNCS` and `all_addresses()` unchanged (E-A6) — **read by AST**, and referenced through the constants `tests/test_alert_replay.py` and `tests/test_alert_catalog_refusals.py` already assert **rather than restated here**. And `scan_evaluator`'s coverage envelope is unchanged apart from the receipt call: its five keys are the same five E-3 shipped.

| id | mutation | must go red because |
|---|---|---|
| **M1** | the record's key gains `user_id` | E6-A3 — the whole store becomes the thing it exists not to be |
| **M2** | `hit_rate` returns `0.0` instead of `None` on unproven coverage | a number gets published; `None` cannot |
| **M3** | the prune recomputes the claim over survivors instead of refusing | ⭐ **the mutation this task exists for** — §1.6's trap reached by arithmetic |
| **M4** | `claim_for` joins `signature_signals` for its hit count | the eleven conditions leak back in through real rows |
| **M5** | remove `record_evaluation` from the evaluator | 🔴 the wire-cut. **Verify both unit suites stay green** |
| **M6** | accept an inverted window | a receipt that covers everything by covering nothing |
| **M7** | `RETENTION_DAYS` read from a second place | a horizon with two authorities is not a horizon |
| **M8** | `latest_evaluation` returns `{}` instead of `None` for a never-evaluated symbol | falsy-but-present is how "never looked" becomes "looked and found nothing" |
| **M9** | accept a window starting before the definition's creation time | ⭐ **AMENDMENT 2 §A2.3.** The claim stops being *"it accrued after you asked for it"* and becomes a backtest with a receipt table under it |
| **M10** | add a `backtest_hits` key to the claim payload | A2.3 — a hypothetical sharing a surface with a receipt; `CLAIM_KEYS` is the only thing that sees it |
| **M11** | `claim_for` folds `not_computable` into `dropped` | controller resolution 5, carried through to the claim: a short-history universe reads as a failing rule |

- [ ] **Step 6: Control audit + commit**

```bash
grep -rn "signature_coverage\|record_coverage\|coverage_covers\|latest_coverage" api/ tests/ tools/ --include=*.py
```
Every existing coverage control is about the **Signature** table. Read each one's stated reason and confirm none of them now reads as a claim about *any* definition — a control whose subject just gained a sibling is guilty until proven innocent.

```bash
git add api/services/definition_record.py tests/test_definition_record.py \
        docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md \
        docs/runbooks/definition-record.md
git commit -m "feat(record): a member-independent, forward-only rule record, with a horizon that refuses instead of shrinking" -- \
  api/services/definition_record.py api/services/screener/scan_evaluator.py \
  tests/test_definition_record.py \
  docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md \
  docs/runbooks/definition-record.md
```

---

# Task E-7: Toolkits and entitlement — breadth is gated where it is PRODUCED, and nobody is sold a worse RSI

**Files:**
- Create: `api/services/entitlements.py`
- Create: `tests/test_entitlements.py`
- Create: `docs/decisions/2026-08-08-toolkit-gating-axes.md` (**🟡 OPEN**, for the owner)
- Modify: `api/services/screener/scan_evaluator.py` (the `limits` parameter) and the scan-result route(s) E-4 registered (**derive the path from `router.routes`, never type it**)
- Modify: `api/services/user_definitions.py` (the definition-count cap reads the toolkit)
- Modify: `app/src/components/screener/CoverageLine.jsx` (adds `withheld` **beside** E-4's four counts)
- Modify: `tests/test_scan_screener_auth.py` (extend the derived census; **do not re-litigate `4e2563bd`**)

**Interfaces:**
- Consumes: `is_paid_user`, `get_current_user_with_plan` (`api/middleware/auth_middleware.py`) · `scan_evaluator.evaluate_one` / `run_sweep` (E-3).
- Produces:
  ```python
  @dataclass(frozen=True)
  class Limits:
      toolkit: str
      max_symbols: int | None       # None == the sweep's own universe
      max_history_bars: int | None
      max_definitions: int
      min_refresh_seconds: int | None

  TOOLKITS: Mapping[str, Limits]        # THE ONE PLACE THE NUMBERS LIVE
  def limits_for(user: Mapping) -> Limits
  def apply_symbol_cap(syms, limits) -> tuple[list[str], list[str]]   # (kept, withheld)
  def apply_history_cap(bars, limits) -> list
  def check_definition_count(count, limits) -> None                   # RAISES
  ```

**SOLO.**

---

⏳ **OWNER — design §8.4: the gating axes and their numbers.** *Symbols · history depth · definition count · refresh cadence* — **E-7 builds the enforcement point for each and invents no pricing model.** The shipped table holds ONE toolkit whose caps are the capacity bounds already in the tree, so **nothing changes for anybody until the owner sets numbers.**

⏳ **OWNER — design §8.5: cadence.** *"Is nightly 03:00 right, or do scans need intraday?"* drives the `refresh cadence` axis **and** the freshness contract E-1 hedged. `min_refresh_seconds` ships as `None` (meaning *"the sweep's own cadence, ungated"*) until it is answered.

---

- [ ] **Step 1: Write the OPEN decision record, so the numbers have somewhere to be**

`docs/decisions/2026-08-08-toolkit-gating-axes.md`:

```markdown
# Decision: what a toolkit gates — the axes and their numbers

**Status:** 🟡 **OPEN — design §8.4. The MECHANISM ships; the NUMBERS are the owner's.**

**Date opened:** 2026-08-08 · **Phase:** E · **Applied:** —

## 1. The rule that is not open

Spec §1.4: *"Sell toolkits, not indicators. Gate breadth (symbols, history), never
mechanics."* **Nobody is ever sold a worse RSI.** That is machine-checked:
`test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit`.

## 2. The four axes E-7 builds enforcement points for

| axis | enforcement point | constant | blocked by |
|---|---|---|---|
| symbols | the sweep's universe slice | `max_symbols` | §8.4 |
| history depth | the bars handed to the interpreter | `max_history_bars` | §8.4 |
| definition count | `user_definitions.create` | `max_definitions` | §8.4 |
| refresh cadence | the scheduler's per-toolkit interval | `min_refresh_seconds` | 🔴 **§8.5 — cadence is unanswered; nightly-vs-intraday drives this AND the freshness contract** |

## 3. What ships today

ONE toolkit, `"all"`, whose caps are the capacity bounds already in the tree
(`MAX_DEFINITIONS_PER_USER`), and `None` on the other three — meaning ungated.
**Nothing changes for anybody until a number is set here.**

⛔ Turning a capacity bound into an entitlement bound is a CATEGORY CHANGE:
capacity may be tuned by ops, entitlement is a billing contract. The test that a
DOWNGRADE actually shrinks the answer is what makes it one.
```

- [ ] **Step 2: Write the failing tests**

```python
def test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit():
    """🔴 SPEC §1.4: GATE BREADTH, NEVER MECHANICS. Nobody is sold a worse RSI.

    ⛔ `repr()` FOR `repr()`, NOT `pytest.approx`. A toolkit that quietly halved
    a lookback, downsampled the bars or rounded the output would agree to six
    decimals and be a different indicator.
    """
    small = ent.Limits("small", max_symbols=5, max_history_bars=120,
                       max_definitions=1, min_refresh_seconds=86400)
    large = ent.Limits("large", None, None, 500, None)
    a = evaluate_column("AAPL", BARS, limits=small)
    b = evaluate_column("AAPL", BARS, limits=large)
    assert [repr(x) for x in a] == [repr(x) for x in b]


def test_and_that_gate_CAN_FAIL_which_is_the_only_reason_it_means_anything():
    """⚠️ THE POSITIVE CONTROL. A planted toolkit that DOES perturb the compute
    must be caught by the assertion above — otherwise it is asserting that two
    identical calls are identical."""
    poison = ent.Limits("poison", None, None, 500, None, _test_round_to=2)
    a = evaluate_column("AAPL", BARS, limits=poison)
    b = evaluate_column("AAPL", BARS, limits=ent.TOOLKITS["all"])
    assert [repr(x) for x in a] != [repr(x) for x in b]


def test_a_SYMBOL_CAP_is_applied_in_the_SWEEP_and_reported_as_WITHHELD_not_DROPPED():
    """🔴 §6.3, AND THIS IS THE POINT AT WHICH ENTITLEMENT MEETS IT.

    *"A screen that silently drops 800 symbols returns fewer hits and looks like a
    quiet market — and a trader would act on it."* A toolkit cap does exactly that
    unless it is reported, and it must NOT be reported as `dropped` OR as
    `not_computable`: dropped means "we tried and failed, here they are, re-run
    them"; not-computable means "we ran and the maths had nothing to say";
    withheld means "your plan stops here". Folding any two of those makes a capped
    screen read as a broken one and a broken one read as a capped one.
    """
    out = scan_evaluator.evaluate_one(
        SCAN_DEF, "D", universe=UNIVERSE,
        limits=ent.Limits("small", max_symbols=5, max_history_bars=None,
                          max_definitions=50, min_refresh_seconds=None))
    assert out["evaluated"] == 5
    assert out["withheld"] == len(UNIVERSE) - 5
    assert out["withheld_reason"] == "toolkit:symbols"
    assert out["dropped"] == 0 and out["not_computable"] == 0 and out["dropped_symbols"] == []
    # ⛔ AND THE CLOSED IDENTITY STILL CLOSES OVER WHAT WAS EVALUATED, not over
    # the universe — `withheld` is outside the identity by construction.
    assert out["evaluated"] == out["answered"] + out["dropped"] + out["not_computable"]


def test_a_DOWNGRADE_actually_SHRINKS_the_answer():
    """⛔ GROUND TRUTH §4.3: every limit in the repo today is a CAPACITY bound,
    not an ENTITLEMENT bound, and *"entitlement bounds are a billing contract and
    need a test that a downgrade actually shrinks the answer."*

    A cap that is computed and never applied is the shape of every one of the
    eight features that shipped green and unreachable this week.
    """
    big = scan_evaluator.evaluate_one(SCAN_DEF, "D", universe=UNIVERSE, limits=LARGE)
    small = scan_evaluator.evaluate_one(SCAN_DEF, "D", universe=UNIVERSE, limits=SMALL)
    assert small["evaluated"] < big["evaluated"]
    assert len(small["hits"]) <= len(big["hits"])


def test_the_cap_is_applied_at_PRODUCTION_not_at_DISPLAY():
    """⛔ E7-A1. A UI that hides rows is not entitlement: the rows were computed,
    they cost the pod the GIL for those seconds, and a client can ask for them.
    Asserted on the PAYLOAD, never on the DOM.

    ⚠️ THE PATH IS DERIVED. E-4 chose the scan surface (E4-A5) and registered it;
    this test reads it off `router.routes` rather than typing it, so a surface
    that moved is a red here instead of a 404 nobody notices.
    """
    path = _scan_result_route_path()          # from router.routes, never typed
    body = paid_client.post(path, json=SCAN_BODY).json()
    assert len(body["rows"]) <= SMALL.max_symbols
    assert body["coverage"]["withheld"] > 0


def test_EVERY_definition_results_route_is_covered_by_the_DERIVED_census():
    """⛔ EXTENDED, NOT RE-LITIGATED. `4e2563bd` derived the (method, path) set
    from `router.routes` for BOTH routers, asserted the COUNTS THROUGH NAMED
    CONSTANTS, cross-checked them against an AST walk of the router SOURCE, and
    read each route's CLASS off `route.dependant.dependencies` BY OBJECT
    IDENTITY. That work stands.

    What is added is one class: a route that serves DEFINITION RESULTS must also
    carry the entitlement, and the count of those is asserted too — so a further
    route lands covered rather than riding in.

    ⛔ THE INTEGERS LIVE IN THIS FILE'S CONSTANTS. Do not restate them in the plan.
    """
    assert len(_routes(screener_mod.router)) == EXPECTED_SCREENER_ROUTES
    assert len(_routes(scans_mod.router)) == EXPECTED_SCANS_ROUTES
    assert len(_definition_result_routes()) == EXPECTED_DEFINITION_RESULT_ROUTES
    for route in _definition_result_routes():
        assert ent.limits_dependency in _dependency_calls(route), route.path


def test_the_NUMBERS_live_in_exactly_ONE_place():
    """A constant restated is a constant that rots. AST over the whole `api/`
    tree: no integer literal equal to a shipped cap may appear outside
    `entitlements.TOOLKITS` — with the control that a synthetic module carrying
    one IS reported by file and line."""
```

- [ ] **Step 3: Run, fail, implement**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_entitlements.py -q; echo "EXIT=$?"
```

```python
"""Toolkit entitlement — the first entitlement model this codebase has.

⭐ WHAT IT GATES: BREADTH. Symbols, history depth, definition count, refresh
cadence. Spec §1.4, and the machine gate is
`test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit`.
⛔ WHAT IT NEVER GATES: MECHANICS. Nobody is sold a worse RSI.

⛔ AND IT IS APPLIED WHERE BREADTH IS PRODUCED, NEVER WHERE IT IS DISPLAYED. A UI
that hides rows is not entitlement — the rows were computed, they held the GIL
while a universe sweep ran, and a client can ask for them. The cap slices the
sweep's symbol list and the bars handed to the interpreter, and the response says
so under `withheld`.

⛔ `withheld` IS NEITHER `dropped` NOR `not_computable`. Dropped means "we tried
and failed, here they are, re-run them"; not-computable means "we ran and the
maths had nothing to say at the last confirmed bar"; withheld means "your plan
stops here". Folding any two makes a capped screen read as a broken one and a
broken one read as a capped one, and a trader acts on the difference (§6.3,
controller resolution 5).

⚠️ `meta.tier` IS NOT THIS. It is a BADGE — `nativeRegistry.js:1429-1430` says so
in its own words, the vocabulary is `['free','premium']` (`defSchema.js:289`), and
no consumer anywhere produces a refusal from it. It stays a badge.

⚠️ AND `tier` IS OVERLOADED IN THIS REPO — every `tier` under `api/` is the THEME
taxonomy (`core`/`relevant`/`peripheral`) or a breadth colour tier. A census of
entitlement code keys on `require_paid` / `is_paid_user`, never on the word.
"""

#: 🟡 THE NUMBERS ARE THE OWNER'S — design §8.4 is OPEN and this table is the one
#: place a number may live. `docs/decisions/2026-08-08-toolkit-gating-axes.md`.
#: ⛔ `None` means UNGATED on that axis, not zero. Today exactly one toolkit
#: ships and it changes nothing for anybody, which is what lets the mechanism
#: land before the pricing question is answered.
TOOLKITS: Mapping[str, "Limits"] = MappingProxyType({
    "all": Limits(
        toolkit="all",
        max_symbols=None,          # OWNER: §8.4
        max_history_bars=None,     # OWNER: §8.4
        max_definitions=user_definitions.MAX_DEFINITIONS_PER_USER,  # today's capacity bound
        min_refresh_seconds=None,  # OWNER: §8.5 — cadence is unanswered
    ),
})


def limits_for(user: Mapping) -> Limits:
    """The caller's toolkit.

    ⛔ THE PAID GATE STILL RUNS FIRST AND SEPARATELY. `Depends(require_paid)` is
    per handler and it decides WHETHER; this decides HOW MUCH. Collapsing the two
    would make one 402 mean two things, and `4e2563bd`'s distinct per-router
    sentence exists precisely so "which surface refused me" is answerable.

    ⚠️ PER-USER SCOPING HAS EXACTLY ONE PRECEDENT and this follows it rather than
    inventing a second: `alert_user_series.scoped_key(user_id, address)` keys the
    fourth partition by `<user_id>\\x1f<address>`.
    """
```

- [ ] **Step 4: 🔴 The wire-cut test**

The surface here is the coverage line — the sentence a member reads. Cut the join between the sweep's `withheld` and what the screen renders, and both halves stay correct. ⚠️ **`CoverageLine` was created by E-4 and already renders four counts; E-7 adds a fifth BESIDE them.**

```jsx
it('a WITHHELD count reaches the screen, and it does not read as a dropped symbol', async () => {
  H.scanResponse = { rows: FIVE_ROWS, coverage: {
    evaluated: 5, answered: 5, dropped: 0, not_computable: 0, dropped_symbols: [],
    withheld: 3737, withheld_reason: 'toolkit:symbols' } }
  render(<Screener />)
  const line = await screen.findByTestId('coverage-line')
  expect(line).toHaveTextContent(/3,737 .*not included/i)
  // ⛔ AND IT MUST NOT READ AS A FAILURE. "3,737 dropped" tells a trader the
  // screen is broken; "3,737 outside your toolkit" tells them what is true.
  expect(line).not.toHaveTextContent(/dropped/i)
  expect(line).not.toHaveTextContent(/not comput/i)
})
```

- [ ] **Step 5: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_entitlements.py \
    tests/test_scan_screener_auth.py tests/test_user_definitions_auth.py \
    tests/test_screener_api.py tests/test_scan_evaluator.py -q; echo "EXIT=$?"
cd app && npm run build && npx vitest run; echo "EXIT=$?"
cd .. && python tools/alert_replay.py --check; echo "EXIT=$?"
python tools/ast_conformance.py --check; echo "EXIT=$?"
```

**The measurement:** the bit-identical mechanics comparison, `repr()` for `repr()`, **with its poisoned-toolkit control non-identical**; the downgrade producing a strictly smaller answer on `evaluated`; the derived route census through its **named constants** plus the new definition-results class with its own asserted count; the single-source constants scan with its synthetic control; and the five-count-plus-`withheld` envelope printed for one capped and one uncapped run.

**The non-measurement assertion:** `4e2563bd`'s existing verdicts unchanged — every route that was paid is still paid, `PUBLIC_BY_DESIGN` still has its asserted size, and both 402 sentences are byte-unchanged. `meta.tier` is still a badge: `git diff HEAD -- app/src/components/chart/engine/nativeRegistry.js` touches no tier logic, and `AST_LANE_TIER` is still `'premium'`. ⛔ **And the shipped toolkit changes nothing** — a full sweep under `TOOLKITS["all"]` returns the same row count as one with no limits at all, proven by an equality, so E-7 lands **dark on breadth while live on mechanism**.

| id | mutation | must go red because |
|---|---|---|
| **M1** | a toolkit cap rounds or downsamples a per-symbol value | ⭐ **spec §1.4.** Nobody is sold a worse RSI, and this is the only gate that can see it |
| **M2** | the cap applied in the response serializer instead of the sweep | E7-A1 — the rows were still computed and a client can still ask for them |
| **M3** | `withheld` folded into `dropped` | a capped screen reads as broken; §6.3's trap with a billing cause |
| **M4** | a cap number moved into the sweep module | two authorities over a billing contract |
| **M5** | a new definition-results route added without the entitlement | the derived census; a hand-list let two paid endpoints ride uncovered in Phase C |
| **M6** | `limits_for` computed and never passed to the sweep | 🔴 the wire-cut on the server half — the downgrade test is the only thing that sees it |
| **M7** | `limits_for` collapsed into `require_paid` | one 402 meaning two things |
| **M8** | delete the poisoned-toolkit control | M1's gate becomes an assertion that two identical calls are identical |
| **M9** | `withheld` counted inside `evaluated` | the closed identity still closes and the coverage line silently claims work the sweep never did |

⚠️ **M1's lethality depends on the control existing first.** Verify the control is red-when-poisoned before reporting M1 as a kill.

- [ ] **Step 6: Control audit + commit**

```bash
grep -rn "require_paid\|is_paid_user" api/ tests/ --include=*.py
grep -rn "MAX_DEFINITIONS_PER_USER\|SCREENER_SNAPSHOT_MAX_PER_RUN\|_DPC_SCAN_MAX_SYMS" api/ --include=*.py
```
⚠️ **Do not key any census on the word `tier`** — every hit under `api/` is the theme taxonomy or a breadth colour tier, and the ground truth names this as a grep that will mislead you.

```bash
git add api/services/entitlements.py tests/test_entitlements.py \
        docs/decisions/2026-08-08-toolkit-gating-axes.md
git commit -m "feat(toolkits): the first entitlement model -- breadth is gated at production, mechanics never" -- \
  api/services/entitlements.py tests/test_entitlements.py \
  docs/decisions/2026-08-08-toolkit-gating-axes.md \
  api/services/user_definitions.py api/services/screener/scan_evaluator.py \
  app/src/components/screener tests/test_scan_screener_auth.py
```

---

# Task E-8: The starter library — the firm's setups as ordinary definitions, editable on arrival

> **AMENDMENT 2 §A2.1.** *"A blank formula box loses the wide audience."* TC2000 and TradingView both ship dozens of built-in scans and it is not decoration — **it is the onboarding path.** A member who opens an empty text field and does not know the syntax leaves. **Sequenced after E-5**, because the same `SETUP_GROUPS` + `lookup_playbook` grounding serves both and building it twice is the defect.

**Files:**
- Create: `api/services/starter_library.py`
- Create: `tests/test_starter_library.py`
- Create: `app/src/components/chart/builder/StarterLibrary.jsx` (⛔ LF) + `StarterLibrary.test.jsx` (⛔ LF)
- Create: `app/src/components/chart/builder/BuilderSheet.starters.test.jsx` (the wire-cut file, ⛔ LF)
- Create: `app/src/components/chart/engine/ast/starterScans.json` — the catalog, as DATA
- Modify: `app/src/components/chart/builder/BuilderSheet.jsx` (one mount, ⛔ LF)
- ⛔ **NOT modified:** `api/services/user_definitions.py`. **If this task needs to change the definition store, it has already failed E8-A1.**

**Interfaces:**
- Consumes: `app/src/constants/setupGroups.js::SETUP_GROUPS` · `brain_service.lookup_playbook` · `concept_vocabulary` (E-5) · `parseFormula` / `astHash` · `scan_definition.is_boolean_tree` (E-2) · the shipped save path `buildDefinition → validateUserDefinitions → saveUserDefinition → installUserDefinitions`.
- Produces:
  ```python
  # api/services/starter_library.py
  def catalog(*, table=None, vocab=None) -> list[dict]
      # [{setup, family, source, grounding, sentence}]  — NO def_hash, NO store row
  def grounded_setups() -> set[str]          # the SETUP_GROUPS names a scan can be written for
  def ungrounded_setups() -> dict[str, str]  # name -> the reason it is REFUSED, never approximated
  ```

**SOLO.**

---

⏳ **OWNER — which setups ship with a working starter scan in v1.** The taxonomy is the firm's and every name in it is real; **not every one is expressible as `<ast> != 0` over the closed table plus E-1's scalars.** A discretionary or multi-bar-structural setup with no expressible condition is **refused by name and listed as ungrounded** — AMENDMENT 1's rule applied to the library — and the owner decides whether to author a condition for it, park it, or wait for E-A9. ⛔ **No starter is approximated to fill a slot.** The catalog ships with whatever is grounded and says out loud what is not.

⚠️ **AMENDMENT 2's count does not match the file, and this task DERIVES rather than restates.** A2.1 says *"`setupGroups.js` declares 31 named setups across 4 families"*. **Measured 2026-08-09:** `SETUP_GROUPS` declares **two** groups (`Swing`, `Intraday`) and `SETUPS` is their flat union; the separate Setup-Library catalog `app/src/pages/modelbook/setupCatalog.js` carries a *different* set across *five* families. Two files, two counts, one sentence. ⛔ **Every count in this task is read off `SETUP_GROUPS` at run time** and the number is nowhere in this plan. Reported to the owner as a design correction.

---

- [ ] **Step 1: Measure the taxonomy and the grounding, and record BOTH lists**

```bash
cd /c/Users/Patrick/uct-worktrees/phase-b2-engine
node -e "
const {SETUP_GROUPS, SETUPS} = require('./app/src/constants/setupGroups.js');
console.log('groups', SETUP_GROUPS.length, SETUP_GROUPS.map(g => [g.label, g.setups.length]));
console.log('setups', SETUPS.length);
" 2>/dev/null || python - <<'PY'
import io, re
s = io.open('app/src/constants/setupGroups.js', encoding='utf-8').read()
groups = re.findall(r"label:\s*'([^']+)'", s)
print('groups', len(groups), groups)
print('setups', len(re.findall(r"'([^']+)',", s)))
PY
PYTHONDONTWRITEBYTECODE=1 python - <<'PY'
from api.services import brain_service
# Which taxonomy names does the KB actually ground? Read the answer; do not assume.
PY
```

⚠️ `brain_service` **never raises** — an uninstalled Brain Pack returns `{"ok": False, …}` for every lookup, which makes **every** setup ungrounded. That is a property of the box, not of the catalog: **record which environment the measurement was taken on**, and do not "fix" it by removing the grounding check.

- [ ] **Step 2: Write the failing tests — the one that decides the task first**

```python
def test_a_STARTER_IS_AN_ORDINARY_DEFINITION_and_NOTHING_MARKS_IT_AS_SPECIAL():
    """🔴 AMENDMENT 2 §A2.1: *"Every starter scan must be an ordinary definition —
    same store, same `def_hash`, same read-back, editable on arrival. A starter
    that is special-cased is a second class of object and re-creates the
    asymmetry §1.1 forbids."*

    ⛔ THE ASSERTION IS ON THE SAVED DOCUMENT AND ON THE STORE'S COLUMN SET, both
    DERIVED. A `starter: true` flag, an `is_builtin` column, or a branch in the
    save path all produce a definition that behaves differently from one a member
    typed — and every one of them is invisible in a feature test that only opens
    the library and clicks a card.
    """
    doc = install_starter("Classic Flag/Pullback")
    member = save_typed_definition(source=doc["compute"]["source"])
    # Byte-for-byte the same shape, minus the ids the store assigns.
    assert _shape(doc) == _shape(member)
    assert doc["compute"]["fn"] == member["compute"]["fn"] == astHash_of(doc)
    with sqlite3.connect(user_definitions._DB_PATH) as c:
        cols = {r[1] for r in c.execute(
            f"PRAGMA table_info({user_definitions.TABLE_NAME})")}
    assert not (cols & {"starter", "is_builtin", "is_starter", "source_setup", "curated"})


def test_the_save_path_has_NO_STARTER_BRANCH__BY_AST():
    """⛔ THE OTHER HALF, AND A GREP CANNOT SEE IT. A starter that is special-cased
    in the WRITER produces an identical row and a different history. The census
    walks `user_definitions`' write functions and asserts no parameter, keyword or
    branch names a starter.
    """


def test_the_catalog_is_DERIVED_from_SETUP_GROUPS_and_the_COUNT_IS_NOT_TYPED():
    """⛔ The taxonomy is `SETUP_GROUPS`' and this file does not hold a copy of it.
    Every catalog entry's `setup` must be a member of `SETUPS`, and every grounded
    setup must appear exactly once.

    ⚠️ AND THE COUNT IS READ, NEVER ASSERTED AS A LITERAL. AMENDMENT 2 says 31
    across 4 families; the file says otherwise; a literal here would rot the day
    somebody adds a setup — which is a thing that happens.
    """
    names = _setups_from_setup_groups()          # parsed from the JS, derived
    entries = {e["setup"] for e in starter_library.catalog()}
    assert entries <= names, sorted(entries - names)
    assert entries | set(starter_library.ungrounded_setups()) == names, (
        "every setup is either shipped with a working scan or NAMED as ungrounded "
        "— a taxonomy entry that is silently absent is a starter nobody decided about")


def test_an_UNGROUNDABLE_setup_is_NAMED_and_NEVER_APPROXIMATED():
    """⛔ AMENDMENT 1's refusal rule, applied to the library. A discretionary setup
    with no expressible condition gets a REASON, not a plausible-looking scan.
    A starter that half-means "High Tight Flag" is worse than no starter: the
    member trusts the firm's name on it.
    """
    for setup, reason in starter_library.ungrounded_setups().items():
        assert reason and setup in reason
    assert not (set(starter_library.ungrounded_setups())
                & {e["setup"] for e in starter_library.catalog()})


def test_every_starter_PARSES_LINTS_and_IS_A_CONDITION():
    """⛔ A starter that refuses at save time is a broken front door. Each entry's
    `source` goes through the SHIPPED chain — parse, budget, repaint lint,
    freshness lint, `is_boolean_tree` — in this test, not at first click.
    """
    for e in starter_library.catalog():
        tree = parse_or_raise(e["source"])
        check_budget(tree)
        assert ast_lint.lint_repaint(tree)["mode"] in REPAINT_MODES
        assert ast_freshness.freshness_for(tree)["mode"] in ast_freshness.FRESHNESS_MODES
        assert scan_definition.is_boolean_tree(tree), e["setup"]


def test_installing_a_starter_TWICE_is_ONE_definition_and_editing_it_FORKS_the_hash():
    """⭐ ONE HASH, ONE OBJECT — and the edit story A2.3 depends on. Two members
    installing the same starter share a `def_hash` (and therefore E-3's results
    and E-6's record); a member who EDITS one gets a new `def_hash`, a new record,
    and D-A3's rev semantics — which is exactly why an edited scan's performance
    starts over rather than inheriting somebody else's.
    """
```

- [ ] **Step 3: Run, fail, implement the catalog as DATA**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_starter_library.py -q; echo "EXIT=$?"
```

`app/src/components/chart/engine/ast/starterScans.json` — beside the manifest and the concept vocabulary, for the same reason:

```jsonc
{
  "version": "2026-08-09.1",
  "_why": "THE FIRM'S SETUPS AS ORDINARY DEFINITIONS. TC2000 and TradingView both ship dozens of built-in scans and it is the ONBOARDING PATH, not decoration: a member picks a named setup, gets a WORKING scan, and then EDITS it -- which is how people learn a syntax. ⛔ EVERY ENTRY IS AN ORDINARY DEFINITION: same store, same `def_hash`, same read-back, editable on arrival. A starter that is special-cased is a second class of object and re-creates the asymmetry spec §1.1 forbids.",
  "_taxonomy": "THE NAMES COME FROM `app/src/constants/setupGroups.js` AND ARE NOT COPIED HERE AS A LIST. This file holds a `source` per setup it can express; the SET of setups is read from the taxonomy at test time, and a setup with no entry must appear in `_ungrounded` with a reason. That identity is what makes a new setup land RED until somebody decides about it.",
  "_ungrounded_rule": "A SETUP WITH NO EXPRESSIBLE CONDITION IS NAMED, NOT APPROXIMATED. The member trusts the firm's name on a starter, so a scan that half-means `High Tight Flag` is worse than no scan. ⛔ And `rsi(close,14)` is NOT available to close a gap here -- E-A9 is open and out of scope (design CORRECTION 1); a setup that needs a function the table does not declare is ungrounded until that phase happens.",
  "starters": {
    "Classic Flag/Pullback": {
      "family": "Swing",
      "source": "close > sma(close, 50) && sma(close, 50) > sma(close, 200) && pullback_depth_pct < 12",
      "grounding": { "kind": "playbook", "setup": "Classic Flag/Pullback" }
    },
    "VCP": {
      "family": "Swing",
      "source": "tight_consolidation > 0 && rs_rank > 80 && dist_52w_high_pct > -15",
      "grounding": { "kind": "playbook", "setup": "VCP" }
    }
  },
  "_ungrounded": {
    "Wick Play": "a single-bar discretionary read on where the wick sits relative to the range; `upper_wick_pct` and `lower_wick_pct` are declared, but the setup's judgement is about CONTEXT the table cannot name. Owner call.",
    "Mean Reversion L/S": "an INTRADAY setup, and the sweep is a last-confirmed-DAILY-bar screen. Blocked on design §8.5 (cadence), not on vocabulary."
  }
}
```

`starter_library.catalog()` composes the entry's `source` with its grounding **resolved, not trusted** (the same rule E-5's `resolve` follows), and returns the entry plus the `sentence` **`sentence_for` derives from the tree** — never a hand-written blurb, for D-A5's reason.

⛔ **`catalog()` returns no `def_hash` and writes no row.** Installing is the member's action, through the shipped save path, and the hash is `astHash`'s. A catalog that pre-computed hashes would be a second registry.

- [ ] **Step 4: The surface — a gallery, and the card's primary action is EDIT**

`StarterLibrary.jsx` mounts inside `BuilderSheet` beside the Conditions/Formula tabs. `UIcon` only, canonical breakpoints, 44px targets.

```jsx
{/* ⭐ THE CARD OPENS THE BUILDER WITH THE STARTER'S SOURCE ALREADY IN THE BOX.
    ⛔ NOT "run this scan" — "here is a working scan, now change it". A2.1: a
    member picks "High Tight Flag" and gets a working scan they can then EDIT,
    which is how people learn a syntax. The Conditions tab shows the picker's
    rows for it, which is the second half of the same lesson. */}
```

- [ ] **Step 5: 🔴 The wire-cut file**

`BuilderSheet.starters.test.jsx` — every case drives the library **through the sheet**:

```jsx
it('picking a starter fills the SHARED source, and the picker can show it', async () => {
  render(<BuilderSheet open onClose={noop} />)
  await user.click(screen.getByRole('tab', { name: /library/i }))
  await user.click(await screen.findByRole('button', { name: /Classic Flag\/Pullback/ }))
  expect(screen.getByLabelText('Formula')).toHaveValue(STARTERS['Classic Flag/Pullback'].source)
  await user.click(screen.getByRole('tab', { name: /conditions/i }))
  expect(screen.getAllByTestId('picker-row').length).toBeGreaterThan(1)
})

it('and SAVING it goes through the SAME door a typed formula goes through', async () => {
  const spy = saveSpy()
  await pickStarterAndSave('VCP')
  const doc = spy.lastDocument()
  expect(doc.compute.fn).toBe(astHash(parseFormula(doc.compute.source).ast))
  expect(JSON.stringify(doc)).not.toMatch(/starter|builtin|curated/i)
})
```

- [ ] **Step 6: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_starter_library.py \
    tests/test_user_definitions.py tests/test_concept_vocabulary.py -q; echo "EXIT=$?"
cd app && npm run build && npx vitest run; echo "EXIT=$?"
cd .. && python tools/ast_conformance.py --check; echo "EXIT=$?"
python tools/alert_replay.py --check; echo "EXIT=$?"
```

**The measurement:** the taxonomy read off `SETUP_GROUPS` (groups, names — **printed, not asserted as a literal**); the grounded/ungrounded partition with every ungrounded setup's reason; every starter's parse + budget + repaint verdict + freshness verdict + `is_boolean_tree` verdict, as a table; and the saved-document shape compared byte-for-byte against a typed definition's.

**The non-measurement assertion:** `git diff --stat HEAD -- api/services/user_definitions.py` is **empty** — E8-A1 means this task changes no writer; the store's column set is unchanged, read from `sqlite_master`; `closedTable.json` untouched (E-1 is its only writer); `--check` still `FIRE LOG MATCHES` at exit 0.

| id | mutation | must go red because |
|---|---|---|
| **M1** | add `starter: true` to the saved document | ⭐ **A2.1.** A second class of object, and the asymmetry §1.1 forbids |
| **M2** | add an `is_builtin` column to the definition store | the same, one layer down, where a feature test cannot see it |
| **M3** | a starter saves through a dedicated writer instead of the shipped path | a second set of gates to keep in step — the shape `BuilderSheet`'s own header says this programme retires |
| **M4** | the catalog hand-lists the setup names instead of reading `SETUP_GROUPS` | the taxonomy gains an entry and the library silently does not |
| **M5** | an ungrounded setup gets an approximate scan instead of a reason | AMENDMENT 1's refusal rule; the member trusts the firm's name on it |
| **M6** | the card's blurb is hand-written instead of `sentence_for(tree)` | D-A5 — two descriptions of one tree, and the prose one is the one that drifts |
| **M7** | remove `<StarterLibrary/>` from `BuilderSheet.jsx`, leaving both files correct | 🔴 the wire-cut. **Verify only `BuilderSheet.starters.test.jsx` reds** |
| **M8** | `catalog()` precomputes and returns a `def_hash` | a second registry, and two authorities over one identity |

- [ ] **Step 7: Control audit + commit**

```bash
grep -rn "SETUP_GROUPS\|SETUPS\b" app/src api/ --include=*.js --include=*.jsx --include=*.py
grep -rn "31 named setups\|4 families" docs/ --include=*.md
```
The second grep is the audit that matters: **report the count mismatch to the owner and do not edit the design.**

```bash
git add api/services/starter_library.py tests/test_starter_library.py \
        app/src/components/chart/engine/ast/starterScans.json \
        app/src/components/chart/builder/StarterLibrary.jsx \
        app/src/components/chart/builder/StarterLibrary.test.jsx \
        app/src/components/chart/builder/BuilderSheet.starters.test.jsx
git commit -m "feat(builder): the firm's setups ship as ordinary definitions, editable on arrival" -- \
  api/services/starter_library.py tests/test_starter_library.py \
  app/src/components/chart/engine/ast/starterScans.json \
  app/src/components/chart/builder
```

---

# Task E-9: Scan → chart in one click, and the Pine-parity path proven end to end

> **AMENDMENT 2 §A2.2 and §A2.5.** *"TC2000's strongest habit-forming loop is scan → chart → back. The claim 'the formula you charted is the scan you ran' is only believable when a member SEES it."* A small wiring task with a large trust payoff, and **the natural home for the wire-cut test.** **Sequenced after E-3 and E-4.**

**Files:**
- Modify: the scan-result surface E-4 registered (**derive it from E-4's report and from `git status --porcelain`; do not type it here**)
- Modify: `app/src/components/StockChart.jsx` **only if** it cannot already take a definition it is handed — ⚠️ **check first**: Phase D shipped the `ast` lane into the registry, so the chart most likely needs a prop, not a mechanism
- Create: `app/src/components/screener/ScanResultRow.test.jsx`
- Create: `app/src/components/screener/ScanToChart.wire.test.jsx` (the wire-cut file)
- Create: `tests/test_phase_e_acceptance.py` (the §A2.5 path, end to end)

**Interfaces:**
- Consumes: E-2's `scan_store.hits` · E-3's envelope · the chart's existing definition-installation path (`installUserDefinitions`) · the shipped alert-arm path (D Task 12).
- Produces: no new module. **A click handler and an acceptance test.**

**SOLO.**

---

- [ ] **Step 1: Establish what already works, so this task builds only the gap**

```bash
cd app && npx vitest run src/components/chart --reporter=default; echo "EXIT=$?"
grep -rn "installUserDefinitions\|AST_DEFS\|listDefinitions" app/src/components/chart --include=*.jsx --include=*.js
```

Record: whether a chart can be handed a definition id and draw it **today**. ⚠️ **If it can, this task is a click handler and an acceptance test, and it must not grow into a chart change.** If it cannot, the gap is named in the report before any code is written.

- [ ] **Step 2: Write the failing tests — the wire-cut first, then the acceptance path**

```jsx
// ScanToChart.wire.test.jsx
// ⛔ THE WHOLE POINT OF THIS FILE. `ScanResultRow.test.jsx` renders a row and
// asserts it has a chart button; that case stays green for the entire time the
// button goes nowhere. This one drives the CLICK and asserts the CHART received
// the DEFINITION — and it is the only case that reds when the join is cut.

it('clicking a scan hit charts the SYMBOL with the SAME DEFINITION the scan ran', async () => {
  H.scanResponse = { rows: [{ ticker: 'NVDA' }], def_hash: DEF_HASH,
    coverage: { evaluated: 1, answered: 1, dropped: 0, not_computable: 0, dropped_symbols: [] } }
  render(<ScanSurface />)
  await user.click(await screen.findByRole('button', { name: /chart NVDA/i }))
  const chart = screen.getByTestId('chart-pane')
  expect(chart).toHaveAttribute('data-symbol', 'NVDA')
  // 🔴 E9-A1: THE DEFINITION, NOT JUST THE TICKER. Handing over only the symbol
  // makes the two surfaces agree by coincidence — and the claim "the formula you
  // charted is the scan you ran" is exactly the thing that would then be false.
  expect(chart).toHaveAttribute('data-definition', DEF_HASH)
})

it('and the CONDITION IS VISIBLE on the chart, in the tree read-back words', async () => {
  // ⛔ A2.2: "with the condition visible". A chart that draws the definition but
  // never says WHICH condition returned this symbol leaves the member to trust
  // that the two agree — which is the thing this loop exists to prove.
  await chartAScanHit()
  expect(screen.getByTestId('chart-scan-condition')).toHaveTextContent(
    evaluateFormula(SCAN_SOURCE, BUILDER_INPUT_SCOPE).readback)
})
```

```python
def test_the_PINE_SCREENER_PARITY_PATH__one_definition_at_every_step():
    """🔴 AMENDMENT 2 §A2.5, STATED AS AN ACCEPTANCE CRITERION.

    *"Take any shipped indicator definition, add a comparison, run it as a scan,
    chart a hit, and arm an alert on it — WITHOUT the definition being re-authored
    at any step. If that path requires a second object anywhere, §1.1 has been
    violated."*

    ⛔ THE ASSERTION IS THE HASH, AT EVERY STEP. Four surfaces agreeing about a
    symbol proves nothing; four surfaces holding ONE `def_hash` is the claim.

    ⚠️ THE COMPARISON USES `sma(close, 50)` — a function the table declares.
    `rsi(close, 14)` refuses at `resolve:function` (design CORRECTION 1) and
    `rsi14` is the SCALAR, which is a different and equally legal way to write
    this. Either is fine; a per-bar `rsi()` is not, and E-A9 is out of scope.
    """
    indicator = a_shipped_ast_definition("sma(close, 50)")
    scan = add_comparison(indicator, "close > sma(close, 50)")
    h = scan["compute"]["fn"]
    assert h == astHash_of(scan)

    result = scan_evaluator.evaluate_one(scan, "D", universe=UNIVERSE, as_of=AS_OF)
    assert result["def_hash"] == h
    assert result["hits"], "the acceptance path needs at least one hit to chart"

    charted = chart_payload_for(result["hits"][0], definition=scan)
    assert charted["def_hash"] == h

    armed = arm_alert_on(scan, symbol=result["hits"][0])
    assert armed["def_hash"] == h

    # ⛔ AND NOTHING WAS RE-AUTHORED. One row in the definition store for the
    # whole path — derived from the store, not from a count kept in the test.
    assert _definition_rows_for(h) == 1
```

- [ ] **Step 3: Implement — the click handler, and nothing more**

```jsx
{/* ⭐ SCAN → CHART, AND IT CARRIES THE DEFINITION (E9-A1).
    A2.2: TC2000's strongest habit-forming loop is scan → chart → back, and the
    claim "the formula you charted is the scan you ran" is only believable when a
    member SEES it — the same definition drawn on the chart of a symbol the scan
    returned.
    ⛔ NOT A NEW CHART MODE. The chart already installs `ast` definitions
    (Phase D); this hands it the one the scan ran, by hash. */}
```

- [ ] **Step 4: Gate**

```bash
cd app && npm run build && npx vitest run; echo "EXIT=$?"
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_phase_e_acceptance.py -q; echo "EXIT=$?"
python tools/ast_conformance.py --check;   echo "EXIT=$?"
python tools/ast_conformance.py --escapes; echo "EXIT=$?"
python tools/alert_replay.py --check;      echo "EXIT=$?"
python tools/chart_parity.py --base-a $A --base-b $B --repeat 5 \
    --dist-a .parity-dist-a --dist-b .parity-dist-b --expect 0; echo "EXIT=$?"
```

**The measurement:** the acceptance path's four `def_hash` reads, printed side by side and asserted equal; the definition-store row count for that hash, **derived**; the wire-cut split (which files red under M1, and which must stay green); the parity cases at `--expect 0`.

**The non-measurement assertion:** the alert lane is unmoved — `alert_replay --check` prints `FIRE LOG MATCHES` at exit 0 and `--diff` still declares every difference; `INDICATOR_FUNCS` unchanged; and **this task registers no new definition, no new address and no new store**. If `git diff --name-only HEAD` shows a new module, the task overshot.

| id | mutation | must go red because |
|---|---|---|
| **M1** | the chart button passes only the ticker, not the `def_hash` | ⭐ **E9-A1.** The two surfaces agree by coincidence, and the product claim becomes unverifiable at exactly the moment it is being demonstrated |
| **M2** | remove the button's handler while leaving the button | 🔴 the wire-cut. `ScanResultRow.test.jsx` must stay GREEN and only `ScanToChart.wire.test.jsx` may red |
| **M3** | the condition shown on the chart is the stored `source` text rather than `sentence_for(tree)` | two descriptions of one tree; D-A5's reason, on a new surface |
| **M4** | the acceptance test re-authors the definition between steps (a fresh save before arming) | ⭐ **A2.5.** *"If that path requires a second object anywhere, §1.1 has been violated"* — and the row-count assertion is the only thing that sees it |
| **M5** | the acceptance test's comparison uses `rsi(close, 14)` | design CORRECTION 1 — it refuses at `resolve:function`, and a "fix" that adds the function bundles E-A9 |

- [ ] **Step 5: Control audit + commit**

```bash
grep -rn "def_hash" app/src --include=*.jsx --include=*.js
```
Any surface that has a symbol and *not* a `def_hash` is a place the loop can silently degrade to "chart this ticker". Read each one's reason.

```bash
git add app/src/components/screener/ScanResultRow.test.jsx \
        app/src/components/screener/ScanToChart.wire.test.jsx \
        tests/test_phase_e_acceptance.py
git commit -m "feat(screener): a scan hit charts the definition that found it, and the parity path is proven end to end" -- \
  app/src/components/screener app/src/components/chart \
  tests/test_phase_e_acceptance.py
```

---

## Deliberately NOT in this plan, with the reason

- **Sharing, attribution, publishing a scan.** Design §8.2, §12, and AMENDMENT 2 §A2.4. *Recognition* is attribution and attribution **is** publishing; §12 gates publishing *"until the ledger can hold publishers accountable"*. **E-6 is what makes it accountable, so the sequence is E-6 → attribution → sharing and §12 is AMENDED rather than ignored.** ⏳ **OWNER — the §12 amendment.** A shared scan would carry its author, its `def_hash`, its read-back sentence and its forward record; none of that ships here.
- **Public copy for any claim.** Design §8.3 is open (E-6's ⏳ block). E-6 ships a record and a surface that can refuse; the sentence a member reads is the owner's.
- **Any pricing number.** Design §8.4 and §8.5 are open (E-7's ⏳ blocks). The mechanism ships; the table holds one ungated toolkit.
- **E-A9 — new FUNCTIONS in the closed table.** Design CORRECTION 1: OPEN, and the controller's recommendation is a **follow-on phase of its own**, because adding functions touches the repaint linter's central guarantee. ⛔ **Do not bundle it** — the day the repaint linter is wrong is the day the brand claim is wrong.
- **String literals in the closed table, and therefore sector/industry filtering in a scan.** Controller resolution 1 → design §8. Sector/industry filtering stays in the classic screener UI.
- **A crossing row in the picker** (`crossOver` / `crossUnder`) — a second row shape, and the round trip is proven on one shape first (E-4's ⏳ block).
- **Negation and arithmetic terms in the picker** — same reason; both refuse by name today.
- **Fixing `api/main.py:1149-1164`** — unreachable dead code that leaves a stale `screener.db` waiting until 03:00 with no boot top-up. Controller resolution 8: **a real bug with its own task, tracked separately.** E-3 refuses to depend on it and reports it.
- **Re-litigating `4e2563bd`** — the derived route census is extended, never re-derived.
- **`ALERT_EVAL_MODE`.** Phase E never states it and never writes it. Any gate that touches it *reports* what the AST reads rather than expecting a value.

---

## Self-review

**Spec coverage — which task implements which design section.**

| design | task |
|---|---|
| §3 / **E-A7** — `scalars` in the closed table, `source` + `as_of`, both lanes | **E-1** |
| §3 / **E-A8** — `meta.freshness` separate from `meta.repaint` | **E-1** (Step 5, GATE 5) |
| **CORRECTION 2** — `yields` on the operators section, single-writer, derived by every consumer | **E-1** writes it; **E-2** (`is_boolean_tree`), **E-4** (`vocabulary()`), **E-5** (the scan stage, via E-2) consume it |
| §4 / **E1** vocabulary · §6.2 census stays CLOSED with a live control | **E-1** |
| §4 / **E2** — a scan is `WHERE <ast> != 0`; `compute.fn` **is** `astHash`; **E-A4** narrow side table | **E-2** |
| §6.3 — a screen states its own coverage; the five-key envelope | **E-2** (the receipt) + **E-3** (the producer) + **E-4** (`CoverageLine`, the surface) |
| §4 / **E3** · **E-A2**, **E-A3** — sequential, off the request path, the 524 class | **E-3** |
| §4 / **E4** — the criteria builder, picker ⇄ formula identity | **E-4** |
| §4 / **E5** · **D-A5** survives · **AMENDMENT 1** — the curated, versioned concept vocabulary as DATA | **E-5** |
| §4 / **E6** · **E-A5** — the member-independent rule record · **AMENDMENT 2 §A2.3** forward-only | **E-6** |
| §4 / **E7** · §1.4 — toolkits gate breadth, never mechanics | **E-7** |
| **AMENDMENT 2 §A2.1** — the setup templates as the starter library | **E-8** |
| **AMENDMENT 2 §A2.2** — scan result → chart in one click, condition visible | **E-9** |
| **AMENDMENT 2 §A2.5** — Pine-screener parity as an acceptance criterion | **E-9** (`tests/test_phase_e_acceptance.py`) |
| **E-A1**, **E-A6** — no new language, `INDICATOR_FUNCS` does not grow | every task's non-measurement assertion |
| **CORRECTION 1** / **E-A9** — `rsi` is not a table function; scalars only | **E-1**'s ⏳ block, **E-2**'s test note, **E-4** Step 1's stop condition, **E-8**'s `_ungrounded_rule`, **E-9** M5 |
| §8.2 · §8.3 · §8.4 · §8.5 · §12 | **not implemented** — ⏳ OWNER blocks in E-1, E-5, E-6, E-7 and the "Deliberately NOT" list |

**Placeholder scan.** No step says "TBD", "add appropriate error handling", "write tests for the above" or "similar to Task N". Every code step carries the actual code or the actual command. Every mutation table names *why* the mutation must kill. **Five mutations whose lethality is NOT certain say so and name what to verify first:** **E-4 M6** (must red only the wire-cut file — verify both component suites stay green), **E-5 M2** (a hand-list is indistinguishable from a derivation against the *shipped* manifest; only the planted case separates them, so confirm the kill came from `test_a_PLANTED_SCALAR_…`), **E-6 M5** (the same two-direction check), **E-7 M1** (needs its poisoned-toolkit control proven red first), **E-8 M7** and **E-9 M2** (the same wire-cut split). An unverified mutation reported as a kill is the "survivor may be a semantic no-op" trap.

**Type consistency across the nine tasks.**
- `def_hash` is the string `compute.fn` holds — `sha256:` + 64 hex, from `astHash` — everywhere. E-2 asserts the identity, E-3 returns it, E-4 asserts it on the saved document, E-6 keys on it, E-8 asserts two installs share it, E-9 asserts four surfaces hold one of it, E-7 never sees it.
- `rev` is the integer `compute.rev`. **E-3 reads it off the definition and returns it; E-6 carries it in the key** for the same reason `signature_coverage` carries `version`. No other task invents or defaults it.
- `tf` is the **bars-store code** (`D`) in every store, key and signature (controller resolution 6). The product label is a display concern and appears in no stored row. `_key` refuses the product label **by name**.
- `as_of` is a normalised `YYYYMMDD` **int**, collapsed at E-2's door by `ledger._normalize_bar_time`. `screener_rows.bars_asof` is TEXT and never reaches a key raw.
- The coverage envelope is **`{evaluated, answered, dropped, not_computable, dropped_symbols}`** — five keys (controller resolution 5), with the closed identity `evaluated == answered + dropped + not_computable` asserted inside E-3's function. `dropped_symbols` is the **one** enumeration and carries both kinds, each with a `reason`; the counts are what split them. **E-7 ADDS `withheld` + `withheld_reason` BESIDE the five** and is outside the identity by construction; it reinterprets none of them. E-6's `claim_for` carries `not_computable` through rather than folding it.
- `yields` is one field with three values — `"bool" | "num" | "passthrough"` — on `operators`, `functions` and `scalars`. **E-1 is its only writer.** Draft 1 called it `domain` with `01/real/passthrough`; CORRECTION 2 fixed the name and the vocabulary was merged, because two fields declaring one fact is the defect the field exists to prevent.
- `FRESHNESS_MODES` is `('live', 'as-of-snapshot', 'unknown')` in both lanes, asserted equal, mirroring `REPAINT_MODES` exactly.
- `Limits` is frozen and passed by value; `fromAst` returns a tagged result and `toSource` throws — **different on purpose**, and each task states the reason (one feeds a form that must render, one is a pure function whose caller is a test). Python's `assert_scannable` raises and JS's `fromAst` returns, for the same split D drew between `check_budget` and `checkBudget`.
- Refusal gates are namespaced strings and pairwise disjoint within each module: `picker:*` (E-4), `scan:*` and `concept:*` (E-5), `gate:*` on `ScanRefused` (E-2), `RUN_GATES` (E-3), `toolkit:*` on `withheld_reason` (E-7).

**What each zero does NOT cover.**

| deliverable | the REAL gate | what the pixel gate says |
|---|---|---|
| scalars in the table | `test_ast_scalars.py` — the partition identity, the type rail, both freshness lanes | nothing |
| the freshness verdict | GATE 5, refused in both directions, with M5/M6 | nothing |
| the scan object | `test_scan_store.py` — the two tables and the third-reading impossibility | nothing |
| the sweep's honesty | the closed identity **inside** the function, plus the reachability census | nothing |
| the picker model | `criteria.test.js` — three properties over a derived-coverage corpus | nothing |
| the picker being reachable | `BuilderSheet.criteria.test.jsx` — and only that file may red under M6 | nothing |
| NL → scan | `test_definition_concierge.py` — the planted scalar, the planted fifth section, every `sentence` assignment | nothing |
| the concept vocabulary | `test_concept_vocabulary.py` — grounding resolved, expansion at save time, refusal by name | nothing |
| the rule record | `test_definition_record.py` — the column set from `sqlite_master`, the import graph, prune-then-refuse, the pre-creation refusal | nothing |
| the record being written by the sweep | the one wire-cut case in that file | nothing |
| entitlement mechanics-invariance | the `repr()`-for-`repr()` comparison with its poisoned control | nothing |
| entitlement being applied | the downgrade test + the payload test | nothing |
| the starter library | `test_starter_library.py` — the ordinary-definition equality and the store's column set | nothing |
| scan → chart | `ScanToChart.wire.test.jsx` + the acceptance path's four equal hashes | nothing |

⛔ **The parity harness mounts no picker, opens no concierge, runs no sweep, reads no record and clicks no scan hit. A total regression of every user-visible thing in this phase would report 0 changed pixels on all live cases, and would do so honestly.** The only thing the pixel gate says here is that chrome did not move a chart, and E-4 and E-9 are the only tasks that owe even that.

⛔ **And the three the header already names:** `alert_replay --check` staying green proves E did not disturb the alert lane and says **nothing** about whether a screen is correct; cross-lane conformance covers the **interpreter**, not the **sweep** — a sweep evaluating the right formula over the wrong symbol set passes every conformance gate; ledger rows prove accrual, **not** rule performance (E-A5).





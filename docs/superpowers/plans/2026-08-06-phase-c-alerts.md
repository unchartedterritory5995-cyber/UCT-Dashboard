# UCT Phase C — Alerts & Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the indicator alert lane so it evaluates the **closed bar** and compares **bar to bar**, make every plot and every named event alertable, enforce the `version` / `compute.rev` policy with a real force-migration, add price alerts + a fired log + per-chart sets + templates, genericize the Phase A Signature indicators into the registry, and ship AVWAP / ATR bands / RS line — on a surface that went to production this morning.

**Architecture:** Three movements, in this order and no other. **(1) Build the instrument before touching the thing.** A replay harness over **real historical bars** produces a frozen fire log and a *repaint oracle*: the same bars replayed at K different intra-bar cycle granularities. Today's evaluator produces a **different fire set at different K** — that number is measured first, on the unmodified tree, and it is the thing C exists to drive to zero. **(2) Rebuild the evaluation lane DARK.** The closed-bar core lands behind one constant (`ALERT_EVAL_MODE`, default `'forming'`), runs in **shadow** against live sessions recording what it *would* have fired, and its differences from the live lane are **declared per address with a reason** before one notification changes. The cutover is one commit, owner-gated, priced in fires. **(3) Then the depth** — instance addressing, the fired log, price alerts, per-chart sets, the Signature genericization, three new definitions — all on the corrected lane.

**Tech Stack:** Python 3.12 + FastAPI + APScheduler + SQLite (WAL), React 18 + Vite, lightweight-charts **5.2.0** (pinned), vitest (`cd app && npx vitest run <paths>` — **never** `npm test -- run`), pytest, Playwright + Pillow via `tools/chart_parity.py`.

**Branch:** `feat/phase-c-alerts`, cut from `origin/master` at **`0a2b97d3`** (Phase B shipped to production 2026-08-06 ~09:00 ET). **Do not push.** The market-hours deploy window (`.git/hooks/pre-push`, Mon–Fri 9:15a–4:20p ET) applies to every eventual ship.

**Baseline, to be re-measured and recorded by Task 1 before anything changes:**

```bash
cd app && npx vitest run                    # ~5,493 / 5,494 (one known master-side flake, below)
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py \
    tests/test_indicator_compute.py tests/test_indicator_golden.py -q          # 150, exit 0
PYTHONDONTWRITEBYTECODE=1 python -m pytest \
    tests/test_admin_chart_health.py tests/test_chart_health_alerts.py \
    tests/test_chart_markers.py tests/test_chart_news.py \
    tests/test_chart_parity_harness.py tests/test_charts_layout_service.py -q  # 164, exit 0
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_signature_*.py tests/test_confluence.py -q  # 186, exit 0
```

Every later task compares against the numbers **Task 1 measures**, never against the four above. This programme has corrected a prose count six times (7→16→20→21→22→32 enumeration sites; "84 chart pytest" matching no command; "25 alert addresses" when the dict holds **28**).

⚠️ **`app/src/pages/Calendar.realModal.test.jsx` is red under full-suite load on master's own tree** (passes 6/6 standalone; master's `a1f13e60` was already fighting it). It is inherited, not ours. Record it in Task 1 as a named exclusion so no later task reports it as a regression.

---

## Global Constraints

Copied verbatim. Every task's requirements implicitly include this section.

**Compute and fixtures**

- **No rounding inside compute.** Delivery wrappers round (`compute_*` round, `compute_*_raw` precise); **both live consumers — `indicator_alert_evaluator` and `strategy_templates` — read the rounded form.** `indicator_compute.py`'s docstring says retiring the wrappers is "Phase C's call": **this plan does not retire them.** Changing the rounding under an armed alert shifts every value by up to half a ulp and flips comparisons at a boundary. Two quirks are preserved exactly: `compute_stoch`'s %D is the SMA of the **rounded** %K, and `compute_macd`'s histogram is (**rounded** MACD − raw signal).
- **JS↔Python golden fixtures at rel-tol 1e-9, read by BOTH lanes** — `app/src/components/chart/goldenFixtures.test.js` and `tests/test_indicator_golden.py`, both reading `case.relTol` out of the 19 files in `tests/fixtures/indicators/`. **A fixture only one lane reads proves nothing.** Two fixtures deliberately own no bars (`barsFrom: "app/src/pages/parityBars/intraday5m.json"`) so the compute oracle and the pixel gate are provably one series.
- Mandatory session fixtures (spec §9.1): an extended-hours day crossing UTC midnight, and a DST transition. `compute_vwap` anchors on the **ET calendar day** (`VWAP_SESSION_ANCHOR`, `compute.rev: 2`).

**Renderer and settings** (unchanged from Phase B; C must not regress them)

- **Series are POOLED and REUSED, never destroyed and recreated** (lightweight-charts #2049 is OPEN). Only series *type* is immutable.
- **`merge()` skips `undefined`** — the complete key set is the only reset mechanism. `applyOptions` merges.
- **`autoScale:false` computes nothing** — it stops re-computation; the range materialises the first time something *asks* (`priceScale().applyOptions` asks). This is the mechanism behind B5's 11,913-px ADX regression.
- **`mergeChartSettings` is a hard allow-list (TWO of them)** — the per-key list in `chartDefaults.js` and `mergeSettingsOverride`'s `_OVERRIDE_SECTION_KEYS` — and **`mergeSettingsOverride` passes primitives through untouched** (and skips `undefined` at the TOP LEVEL ONLY; inside its `indicators` branch it spreads, so a nested `undefined` lands).
- **Every parity number names BOTH build identities**, served-vs-disk byte-compared on both bases (`--dist-a` / `--dist-b`).

**Phase-C-specific, non-negotiable**

- 🔴 **NOTHING THE FORMING-BAR EVALUATOR PRODUCES MAY ENTER `signature_signals`.** The constraint has been carried since B1 and is still unmet. It is closed by Task 9 and by nothing earlier.
- 🔴 **The ledger is APPEND-ONLY and already accruing real history** (10 rows as of 2026-08-03: 9 sweep-written + 1 request-path SPY row, all `indicator="fcb"`, `version="fcb-v2"`, `tf="1D"`). Its UNIQUE key is `(indicator, version, sym, tf, bar_time, direction)`. **Those spellings may not be re-keyed** — Task 13 genericizes the Signature *definitions* and must leave the ledger's key vocabulary byte-identical, or history orphans and cannot be reconstructed.
- 🔴 **An alert cannot be un-sent.** Any change to *when* an alert fires ships **dark**, runs in **shadow** against real sessions, and its diff is **declared per address with a reason** before delivery moves. This is the sequencing rule the whole plan is built on.
- `compute.rev` is the MATH; `version` is presentation. **Presentation pins are free; there is NO eternal pinning of `compute.rev`** — all bindings force-migrate with user notification, evaluator `last_value` reset, and the **first post-migration cycle suppressed** (else v_old-prev vs v_new-current fabricates a crossing).

**Process**

- Frontend: `cd app && npx vitest run <paths>`. **NEVER `npm test -- run`.**
- pytest: `PYTHONDONTWRITEBYTECODE=1` on every run (a same-size mutation within one second imports the previous mutation's `.pyc`).
- Python subprocess readers pinned to `encoding='utf-8', errors='replace'`; `sys.stdout.reconfigure(encoding='utf-8')`. The box default is cp1252 and vitest prints box-drawing.
- `-t` filters are **regex** and go through `cmd.exe`; a filter containing `"` splits under the shell and a single-quoted filter selects **nothing**. Pass argv as a **list** with `shell=False`, and pick titles free of `+ ? ( ) [ ] * . | ^ $`.
- ⛔ **`core.autocrlf=true` means `git checkout -- <file>` does NOT restore bytes.** Restore a mutated file from an in-memory byte copy and assert sha256 in both directions. Every "restored byte-for-byte" claim on this repo is about whichever line-ending convention was on disk.
- Never create a git worktree for a build comparison; stage side A in place and restore from a `cp -r` backup. (`rm -rf` on a `node_modules` junction has recursed into the shared tree four times here.)

---

## What replaces "0 changed pixels" — read this before Task 1

**B's gate was pixels. C's output is a NOTIFICATION, and no screenshot catches a wrong alert.** An alert that fires when it shouldn't reaches the user by AlertBell + email (Resend) + Discord through `watchlist_alert_service.deliver_alert_payload`, and it **cannot be un-sent**. So C does not get to relax the gate; it has to name a different measurable and be stricter about it.

Three parts, each independently failable, each with its own killer.

### Part 1 — THE FIRE LOG. An equality, not a count.

A replay harness (`tools/alert_replay.py`, Task 2) walks a **frozen fixture of real historical bars** one bar at a time and records, for every (address × condition × threshold × params) combination the catalog can express, the exact **set of fires**:

```
(alert_key, bar_index, bar_time, value, triggered)
```

The whole set is written to `tests/fixtures/alerts/fire_log_forming.json` **on the unmodified tree, and committed FIRST** — the B5 precedent (5,040 `(value, triggered)` combinations recorded before the change, green before and after, with a control that re-points one indicator at another and demands the replay go red).

The gate is **exact equality on the whole set**, per B5's `expect`: a *smaller* fire set fails too, so this is not a budget. Variance is itself a failure — the replay is deterministic by construction (frozen bars, no clock, no network), so a case that is not single-valued across runs is a defect in the harness, not noise to average.

### Part 2 — THE REPAINT ORACLE. This is the one the pixel gate has no analogue for.

**A fire repaints iff the fire set depends on when you looked.** So replay the same bars at **K different intra-bar cycle granularities** and compare the fire sets.

Concretely: for bar `i` and `K` samples, synthesize the sequence of partial bars the store would have held — `o → h → l → c` on an up bar, `o → l → h → c` on a down bar, sampled at K points — and drive the evaluator through them exactly as a 60-second poll would. This is a *model* of the intra-bar path, and the plan says so out loud; it is the right model because a repaint is by definition a dependence on that path, and OHLC carries the extremes that flip a threshold.

- **Today's evaluator FAILS this by construction** and Task 2's gate is that the failure is **NON-ZERO and measured**. `last_value` comes from the prior 60-second poll, not the prior bar, so a "crossed above 70" fires on a wick that unwinds before the close. If Task 2's K-way disagreement count comes back **0**, the harness is not driving the forming bar and the harness is wrong — that is the vacuity refusal, and it aborts.
- **The closed-bar evaluator must produce a BYTE-IDENTICAL fire set at every K** (Task 5). That equality is the headline number of the phase.
- The named fixture that makes it concrete: **`wick_that_unwinds`** — a bar whose HIGH takes RSI above 70 and whose CLOSE leaves it below. Under `forming`: ≥1 fire. Under `closed`: **exactly 0**. Both directions asserted.

### Part 3 — THE ADMISSION CENSUS. The brand is the ledger; the ledger gets a door with a lock.

The positioning — *"the first indicator platform that shows its receipts"* — depends on `signature_signals` being honest. Today it is honest **by construction and by nobody having wired the alert lane to it**, which is not a control; it is an absence. Task 9 makes it a control:

- a **caller census** over `ledger.record_signal` (`toEqual` on the derived caller set, never `toContain` — the `controlDoorCensus.test.js` shape that found door seven's third site on its first run), and
- a **behavioural refusal**: the alert lane's ledger writer raises unless `EVAL_MODE == 'closed'` **and** the fire it is handed carries closed-bar provenance, and
- the mutation that must turn it red: call it from the alert lane while the mode is `'forming'`.

### What each part costs you if you get it wrong

| you get wrong | what ships | which part catches it |
|---|---|---|
| the crossing still compares cycle to cycle | wick fires, forever, to real inboxes | Part 2 (K-way disagreement ≠ 0) |
| an address silently stops firing | a user's armed alert goes quiet and nothing says so | Part 1 (a smaller set fails) |
| the closed-bar fires are *right* but a forming fire leaks to the ledger | the receipts are poisoned and cannot be un-poisoned | Part 3 |
| a `compute.rev` bump fabricates a crossing | one false fire per armed alert on migration day | Task 7's first-cycle suppression, mutation-gated |

**And a warning inherited from B4/B5, stated where it cannot read as a pass:** the pixel gate is structurally blind to essentially everything C ships. The parity route mounts no alert popover, presses no key, arms nothing, and has no evaluator. **A total regression of every user-visible thing in this plan would still report 0 changed pixels.** Only Tasks 13–14 (new definitions, Signature genericization) put anything on the canvas, and only those tasks owe a pixel number.

---

## Sequencing against a LIVE surface

Phase B is in production as of this morning; there is no freeze to hide behind. The order below is chosen so that **nothing user-visible lands unproven**.

| Task | dark? | what a user could notice |
|---|---|---|
| 1 Baseline · Python scan · ledger | **dark** | nothing — tests and a ledger row |
| 2 Replay harness + frozen fire log | **dark** | nothing — `tools/` and `tests/fixtures/` only, no `api/` change |
| 3 Operand grammar (relational primitive) | **dark** | nothing — `bb` resolves through it and the 5,040 replay proves the numbers did not move |
| 4 Events as columns | **dark** | nothing renders an event yet; registration gets stricter |
| 5 Closed-bar evaluator | **dark** | nothing — `ALERT_EVAL_MODE = 'forming'`, the new core is unreachable in production |
| 6 Shadow mode + declared diff | **dark** | nothing delivered; a second lane writes a shadow log only |
| 7 `compute.rev` force-migration | **dark** | nothing today — no binding is pinned to a superseded rev yet |
| **8 THE CUTOVER** | 🔴 **LIVE** | **armed alerts change when they fire.** One commit, owner-gated, priced in fires by Task 6 |
| 9 The ledger door | 🔴 **LIVE** | alert-lane signals begin accruing receipts |
| 10 Instance addressing | 🔴 **LIVE** | alert rows name the instance ("RSI(7) crossed 70") |
| 11 Fired log · needs-attention · re-arm/snooze · price alerts | 🔴 **LIVE** | new UI |
| 12 Per-chart sets + templates | 🔴 **LIVE** | new UI |
| 13 Signature → registry | 🔴 **LIVE** | the three Signature indicators move lane; **owes a pixel number** |
| 14 AVWAP · ATR bands · RS line | 🔴 **LIVE** | three new definitions; **owes a pixel number** |
| 15 Whole-phase gate | — | — |

**Tasks 1–7 are dark. The cutover is Task 8 and it is the only task in the phase permitted to change when an existing alert fires.**

---

## Parallelism — file ownership

B4/B5 ran ~3× faster by partitioning agents on **file ownership** with explicit own / must-not-touch lists. C's partitions:

**Safe in parallel (file-disjoint):**

- **Task 1 ‖ Task 2.** T1 owns `app/src/components/chart/engine/__tests__/enumerationSites.test.js` + `__tests__/sourceScan.js` + the new decision record. T2 owns `tools/alert_replay.py`, `tests/fixtures/alerts/**`, `tests/test_alert_replay.py`. **T1 must not touch `tools/`; T2 must not touch the ledger test.** T2 reports its ledger delta (it adds none — `tools/` is already a `keep` row for the parity cases and `alert_replay.py` names no indicator ids).
- **Task 3 ‖ Task 4.** T3 owns `api/services/alert_conditions.py` + `api/services/indicator_alert_evaluator.py`. T4 owns `app/src/components/chart/engine/defSchema.js`, `nativeRegistry.js`, `app/src/components/chart/indicators.js`, `api/services/indicator_compute.py`. **Neither may touch the other's list.** The seam is a name only: T4 produces event columns; T3 consumes nothing of T4's until Task 5.
- **Task 11 ‖ Task 12 ‖ Task 13.** T11 owns `api/services/alert_fired_log.py`, `api/routers/indicator_alerts.py`, `app/src/components/chart/IndicatorAlertPopover.jsx`. T12 owns `app/src/components/chart/engine/alertSets.js`, `instanceControls.js`, `chartDefaults.js`. T13 owns `api/services/signature/**`, `api/routers/signature.py`, `app/src/hooks/useSignatureIndicators.js`. **All three touch `nativeRegistry.js` only via T13** — T11 and T12 must not.

**SOLO, and ORDERED:**

- **Tasks 5, 6, 7, 8, 9, 10** all write `api/services/indicator_alert_evaluator.py` and the mode constant. One writer at a time, in number order, no exceptions.
- **Task 14** is solo relative to Task 13: both write `nativeRegistry.js`'s `RAW_DEFS`, and B5 measured that insertion order **is z-order**.
- **`enumerationSites.test.js` has EXACTLY ONE WRITER AT A TIME, for the whole phase.** T1 writes it; T10 writes it (retiring `INDICATOR_FUNCS`); T15 writes it. Every other task that changes the count **reports its delta and does not apply it** — the ruling the B4 controller had to make mid-flight after two waves wrote it concurrently and one edit vanished.

---

## Controls rot at every flip, and the dangerous ones stay GREEN

**~90 controls rotted across five phases.** The ones that go red are safe. The ones that keep passing while their premise dies are the hazard: B3 hit four green-while-false at Task 11 alone; B5 Task 7 found `enumerationSites`' `REFS`/`COMPUTES` tables holding only the four B3 pilots, so **seven of eleven flipped definitions were asserting about nothing** and had been shrinking for three tasks with nothing to say so.

**Every task in this plan carries an explicit control-audit step.** The recipe:

```bash
# JS
grep -rn "<subject>" app/src --include=*.js --include=*.jsx | grep -iE "test|spec"
# Python
grep -rn "<subject>" tests/ api/ --include=*.py
```

Then **read each hit's stated REASON, not its assertion**, and either invert it, move it down a level (B4/B5's remedy: re-point it at a subject that cannot expire, with its own non-vacuity control), or delete it with the reason recorded. **A control whose subject you just changed is guilty until proven innocent.**

Two subjects in this phase are known to be about to lose their premise and are named here so no task discovers them late:

1. **`tests/test_indicator_alert_evaluator.py::test_the_eight_legacy_addresses_evaluate_identically`** — the 5,040-row replay. Its `prev` column is a *supplied* `last_value`. The closed-bar rebuild changes where `prev` comes from. **It must be SPLIT, not weakened** (Task 5, Step 6): the `value` half stays an exact equality forever (value is a pure function of bars/params/address and must never move); the `triggered` half becomes an exact equality on `check_condition(condition, value, prev, threshold)` called *directly* — also forever, because that function stays pure. What changes is only *who supplies `prev`*, and that is what Part 2 measures. Split down a level; never relaxed.
2. **`tests/test_indicator_alert_evaluator.py::test_sar_is_deliberately_not_offered_and_says_why`** — asserts the absence of `sar` **and that `_SAR_IS_NOT_OFFERED`'s prose is still present.** Task 4 offers `sar` and that test must go red. See the adjudication below; it is **replaced by a successor rail**, not deleted.

---

## Adjudications this plan makes

Recorded so they are not re-litigated mid-execution.

### A1 — `sar` becomes alertable, by EVENT and by RELATION, never by a fixed threshold. ✅

`_SAR_IS_NOT_OFFERED` says, verbatim: *"a second relational primitive is a change to the EVALUATION lane, and that is spec §8's, in Phase C."* **C is that change.** Its argument is not that SAR is un-alertable; it is that a *fixed threshold* on SAR names no trading event, which stays true and stays enforced.

So:

- Task 3 builds **one** operand grammar (`const | address | close`), and `_bb_threshold_override` — the module's only relational primitive, bb-only — **retires into it**. One mechanism, not two.
- Task 4 gives `sar` two **named events**: `price_crossed_sar` and `trend_flipped`, emitted as `{0,1,NaN}` columns exactly as spec §3's `events[]` requires. `compute_sar_raw` already returns a second `trend` column of ±1 — the raw material exists and is already pinned by `tests/fixtures/indicators/sar_default.json`, so no fixture is reseeded.
- **`sar` gets NO entry in the fixed-threshold address space.** The refusal survives; only its subject narrows.
- `test_sar_is_deliberately_not_offered_and_says_why` is **retired into `test_sar_has_no_fixed_threshold_address_and_says_why`**, which re-runs the same absence check against the *threshold* address table, keeps `_SAR_IS_NOT_OFFERED`'s prose as the reason (moved beside the new refusal), and adds the two event addresses as the positive control. **B5's "move it down a level" pattern, with its own non-vacuity control.**

### A2 — C builds the Python-side discovery scan. It does NOT take the anchor. ✅

The ledger's whole value is that *"the number moves with the CODE."* A row a scan structurally cannot see is an anchor maintained by hand, and a hand-maintained enumeration invisible to the scan is the exact shape that turned **seven into thirty-two**.

**The scan was prototyped against this tree while writing this plan. It finds exactly three files** (three regex shapes — quoted id, object key, optional-chained read — over `api/**/*.py` with Python comments and docstrings stripped, ≥4 ids):

| file | ids | ledger status |
|---|---|---|
| `api/services/indicator_compute.py` | 13 | **NOT ON THE LEDGER — the one new row** |
| `api/services/indicator_alert_evaluator.py` | 12 | already a row, fate `C` |
| `api/services/voice_client_action_tools.py` | 4 | already a row, fate `C` |

So `SITE_COUNT` **6 → 7**, partition **`{C: 2, keep: 5}`**. ⚠️ **That prediction is not the gate.** Task 1 runs the scan and asserts the *measured* found-set against the ledger; if it finds a fourth file, that is a finding and the number moves. Predicting a count and then asserting the prediction is how this branch shipped `{B4:19}` summing to 32.

The new row's fate is **`keep`**, for a load-bearing reason: `indicator_compute._CASE_COLUMNS` maps a *fixture kind* to *column names* — `williams_r` not `williamsR`, `vwap_series` not `vwap` — an irreducible (kind, columns) pair no definition can declare, exactly like `INDICATOR_CHORDS`' (key, indicator) pair. **And it is the only Python row that survives this phase**, which makes it the only honest floor for the Python scan's non-vacuity bound. Both C-fated Python rows retire in this phase; a floor derived from *them* would collapse to an empty set, and `[].filter(...)` is `[]`, which satisfies the assertion while checking nothing — the exact rot B5 Task 12 had to repair on the JS side.

### A3 — AVWAP's anchor and RS line's benchmark are `enum` inputs. The reserved input types stay reserved. ✅

Spec §2 puts **AVWAP** and **RS line** in C. Spec §3.1 puts `time`, `symbol`, `price`, `session`, `timeframe`, `confirm` in **`RESERVED_INPUT_TYPES`** — deferred, and `defSchema.js` fails closed on them today. Those two statements collide (see Contradictions, below).

Resolution, taken here so Task 14 does not have to invent it:

- **AVWAP anchors on a named `enum`** — `session | week | month | quarter | year | swingHigh | swingLow` — not a free `time`. Click-to-anchor stays what it already is: the **drawing tool** in `ChartDrawingOverlay.jsx`, which is anchored by a click and needs no definition. A `time` input would also need a UI control the settings form has no spec for.
- **RS line's benchmark is an `enum`** of a fixed list (`SPY | QQQ | IWM`), **and RS line is `compute.kind: 'server'`** — because the compute contract (§4) is `compute({bars, inputs, prevState, barstate})` with **one** `bars`, and a second symbol's bars are not reachable from it. Extending the contract is a schema change, not a C feature. Task 13 builds the generic server lane; Task 14 is its first non-Signature tenant, which is also the proof the lane is generic rather than three hardcoded endpoints wearing a new coat.
- **ATR bands** need nothing new: price-target placement, a `band` plot style (already in `PLOT_STYLES`), a `$multiplier` float input.

### A4 — the delivery-rounding wrappers are NOT retired. ✅

`indicator_compute.py`'s docstring hands that decision to C. **C declines it.** The wrappers are the boundary at which user thresholds have always been compared; dropping them shifts every value by up to half a ulp and flips comparisons at boundaries — i.e. it changes *which armed alerts fire*, which is precisely the change this phase spends eight tasks making attributable. It is a one-line change with a 5,040-row oracle already pointed at it; it can be taken in its own commit, in its own phase, with its own owner decision. Doing it inside the closed-bar cutover would make the cutover's fire diff un-attributable.

### A5 — `compute_vwap`'s tzdata raise stays a raise, and becomes VISIBLE. ✅

`_et_zone()` raises rather than falling back to UTC. That is right — a silent UTC fallback is the retired `VWAP_SESSION_ANCHOR` defect, measured at $14.45 at a session open. But the evaluator wraps every compute in `try/except` and logs, so **on a box without tzdata every VWAP alert goes silent** and no surface says so.

Spec §8 already requires the answer: *"orphaned bindings go to a visible needs-attention state — never silently dead."* Task 11 makes a compute that **raises** put the alert into `needs_attention` with the exception's own message, surfaced in the popover and counted in the fired log. The raise is preserved; the silence is not.

---

## File structure

**Backend — the evaluation lane** (decomposed; the current 858-line module grows past 1,500 otherwise)

| file | responsibility |
|---|---|
| `api/services/alert_conditions.py` **(new, T3)** | `check_condition` (moved verbatim) + the operand grammar `resolve_operand` / `series_for_operand`. The only place a comparison is decided. |
| `api/services/alert_series.py` **(new, T5)** | Address → **full aligned series**, and the closed-bar slice. Successor to `INDICATOR_FUNCS`' "last value only" contract. |
| `api/services/alert_fired_log.py` **(new, T11)** | The fired-alert history store, `/data/alert_fired_log.db`. Same family as the signal ledger; append-only. |
| `api/services/indicator_alert_evaluator.py` **(modify, T3/T5/T6/T7/T8/T9/T10)** | The driver: `ALERT_EVAL_MODE`, the cycle, shadow lane, delivery, dedup, ledger admission. Keeps its name — the ledger row anchors in it. |
| `api/services/indicator_alert_service.py` **(modify, T7/T10/T11/T12)** | Storage; new columns for `def_rev`, `instance_id`, `scope`, `snooze_until`, `state`. |
| `api/routers/indicator_alerts.py` **(modify, T10/T11/T12)** | CRUD + catalog + fired log + sets. |
| `api/services/signature/registry_defs.py` **(new, T13)** | The three Signature indicators as schema-v1 definitions on `compute.kind: 'server'`. |

**Frontend**

| file | responsibility |
|---|---|
| `app/src/components/chart/engine/defSchema.js` **(modify, T4)** | `events[]` gains a column contract; `columnKeys` includes event keys. |
| `app/src/components/chart/engine/nativeRegistry.js` **(modify, T4/T13/T14)** | Event columns from computes; the server lane; three new definitions. |
| `app/src/components/chart/indicators.js` **(modify, T4/T14)** | SAR's two event columns; AVWAP; ATR bands. |
| `app/src/components/chart/engine/alertSets.js` **(new, T12)** | Per-chart alert sets + templates over the instance list's `scope`. |
| `app/src/components/chart/IndicatorAlertPopover.jsx` **(modify, T10/T11)** | Instance naming, needs-attention, fired history, snooze. |
| `app/src/hooks/useIndicatorAlerts.js` **(modify, T10/T11)** | New endpoints. |

**Tools / fixtures / docs**

| file | responsibility |
|---|---|
| `tools/alert_replay.py` **(new, T2)** | The replay harness + the repaint oracle. |
| `tools/phase_c_gauntlet.py` **(new, T2)** | The mutation gauntlet, generalized from `tools/flipc_mutation_gauntlet.py`. |
| `tests/fixtures/alerts/replay_bars.json` **(new, T2)** | Real historical bars, frozen. |
| `tests/fixtures/alerts/fire_log_forming.json` **(new, T2)** | The frozen fire log of the CURRENT lane. Committed first. |
| `tests/fixtures/alerts/fire_diff_declared.json` **(new, T6)** | The per-address declared diff. |
| `docs/decisions/2026-08-06-closed-bar-alert-cutover.md` **(new, T1; ACCEPTED at T8)** | The owner record the rail reads. |
| `docs/runbooks/alert-replay-gate.md` **(new, T2)** | How to run the gate; what each refusal means. |

---

# Task 1: Baseline, a discovery scan that can see Python, and the ledger at seven

**Files:**
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`
- Modify: `app/src/components/chart/engine/__tests__/sourceScan.js`
- Create: `docs/decisions/2026-08-06-closed-bar-alert-cutover.md`

**Interfaces:**
- Produces: `stripPyComments(src) -> string` exported from `sourceScan.js`; ledger rows for `api/services/indicator_compute.py`; the decision record whose `**Status:**` header line later tasks' rails read.
- Consumes: nothing.

**Must not touch:** `tools/`, `tests/fixtures/`, any `api/` source (Task 2 owns the first, and no source change belongs in a baseline task).

- [ ] **Step 1: Record the baseline BY COMMAND, into the decision record**

`.superpowers/` is gitignored, so the numbers go in the repo. Create `docs/decisions/2026-08-06-closed-bar-alert-cutover.md` with this header and a `## 10. Baseline, by command` section holding the four commands from the plan header **and the numbers you measure**, not the numbers written above.

```markdown
# Decision: the indicator alert evaluator is rebuilt closed-bar

**Status:** 🟡 **OPEN — the evaluator reads the FORMING bar with cycle-granularity crossings, and its fires may not enter the Signature ledger.**

**Date opened:** 2026-08-06 · **Phase:** C · **Applied:** — · **Record of the measurement:** §3

## 1. The fact

`api/services/indicator_alert_evaluator._evaluate_one` computes the indicator over
every bar the store holds — including the bar currently forming — and takes `prev`
from `alert["last_value"]`, which is whatever the **previous 60-second poll cycle**
wrote. So "crossed above 70" can fire on a wick that unwinds before the bar closes,
and the same bar can be judged five times with five different answers.

Spec §8: *"nothing enters the ledger unless it is closed-bar evaluated."* That
constraint has been carried since B1 and is unmet.
```

Then the `## 10` section. Add `## 11. Known-red on the inherited tree` naming `app/src/pages/Calendar.realModal.test.jsx` (passes standalone, fails under full-suite load, red on master's own tree) so no later task reports it as a regression.

- [ ] **Step 2: Write `stripPyComments`, and its two controls**

In `app/src/components/chart/engine/__tests__/sourceScan.js`, beside the existing `stripComments`:

```js
/** Python's comment shapes, stripped; STRING CONTENTS PRESERVED.
 *
 *  ⛔ STRINGS ARE NOT STRIPPED, ON PURPOSE — the same ruling `stripComments`
 *  carries. A Python enumeration lives in dict LITERALS (`INDICATOR_FUNCS`,
 *  `_CASE_COLUMNS`, `_INDICATOR_ALIASES`) whose keys are strings; a stripper that
 *  also dropped string contents would lose every real site, which is the false
 *  negative that makes a scan worthless.
 *
 *  ⛔ TRIPLE-QUOTED DOCSTRINGS ARE STRIPPED. They are where this repo's Python
 *  writes its prose, and `indicator_alert_evaluator.py`'s module docstring names
 *  eight addresses. Read as code, a docstring is a false positive that a
 *  maintainer can only fix by rewording prose — the exact symptom fix B4 Task 10
 *  had to undo on the JS side.
 *
 *  Newlines are preserved so line numbers survive.
 */
export function stripPyComments(src) {
  let out = ''
  let i = 0
  let mode = 'code'
  let quote = ''
  while (i < src.length) {
    const c = src[i]
    if (mode === 'code') {
      if (c === '#') {
        while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1
        continue
      }
      if (src.startsWith('"""', i) || src.startsWith("'''", i)) {
        quote = src.slice(i, i + 3); mode = 'tri'; i += 3; continue
      }
      if (c === '"' || c === "'") { quote = c; mode = 'str'; out += c; i += 1; continue }
      out += c; i += 1; continue
    }
    if (mode === 'tri') {
      if (src.startsWith(quote, i)) { mode = 'code'; i += 3; continue }
      out += (c === '\n' || c === '\r') ? c : ' '
      i += 1; continue
    }
    // mode === 'str'
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue }
    out += c
    if (c === quote) mode = 'code'
    i += 1
  }
  return out
}
```

- [ ] **Step 3: Write the failing scan test**

Append to `enumerationSites.test.js`. It reuses the **hoisted** `namesIndicators` predicate — the scan and its control must share one predicate, because this branch has already shipped a control that measured a hand-copy against a hand-copy.

```js
  // ⭐ THE PYTHON HALF OF THE DISCOVERY SCAN.
  //
  // The JS scan walks `app/src/**/*.jsx?`. Two of this ledger's six rows are
  // PYTHON, and it can see NEITHER — which is why both have been maintained by
  // hand since B4, and a hand-maintained enumeration invisible to the scan is
  // exactly the shape that turned seven sites into thirty-two.
  it('names every shipped Python module that hand-lists four or more indicators', () => {
    const API_DIR = path.join(ROOT, 'api')
    const walk = (dir, out = []) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__pycache__') continue
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(p, out); continue }
        if (!/\.py$/.test(entry.name)) continue
        out.push(p)
      }
      return out
    }

    const found = []
    for (const p of walk(API_DIR)) {
      const src = stripPyComments(fs.readFileSync(p, 'utf8'))
      if (namesIndicators(src).length >= 4) {
        found.push(path.relative(ROOT, p).split(path.sep).join('/'))
      }
    }

    const known = new Set(LEDGER.map(s => s.file))
    expect(found.filter(f => !known.has(f)),
      'a PYTHON module hand-lists four or more indicators and is not on the ledger. ' +
      'Either it is a new enumeration site (add it, and raise SITE_COUNT), or it reads ' +
      'the registry and the scan is over-matching (say which, in the ledger).',
    ).toEqual([])

    // …and the scan must not go quietly empty. ⛔ THE FLOOR IS DERIVED FROM
    // `keep`, NEVER FROM THE `C` ROWS: both Python `C` rows RETIRE IN THIS PHASE,
    // so a floor built on them collapses to an empty set, and `[].filter(...)` is
    // `[]`, which satisfies the assertion above while checking nothing at all.
    // A control that stops looking is a control that rots, and it rots GREEN.
    const keepPython = [...new Set(LEDGER.filter(s => s.fate === 'keep').map(s => s.file))]
      .filter(f => /^api\/.*\.py$/.test(f)).sort()
    expect(keepPython,
      'the Python scan has no surviving subject to be measured against',
    ).toEqual(['api/services/indicator_compute.py'])
    for (const f of keepPython) {
      expect(found, `the Python scan stopped seeing ${f}`).toContain(f)
    }
  })
```

- [ ] **Step 4: Run it and READ WHAT IT FOUND — the enumeration is the deliverable**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js -t "hand-lists four or more indicators"
```

Expected: **FAIL**, naming `api/services/indicator_compute.py` as unledgered. **Print the whole found-set and write it into the ledger comment.** If it names a fourth file, that is a finding: ledger it with a reason, and the counts below move. Do not edit the assertion to match a prediction.

- [ ] **Step 5: Add the row, move the counts, regenerate the mapping**

```js
  // ⭐ PHASE C — THE ROW THE PYTHON SCAN FOUND ON ITS FIRST RUN.
  // `_CASE_COLUMNS` maps a golden-fixture KIND to its COLUMN NAMES, and the two
  // vocabularies are not the same one: `williams_r` here is `williamsR` in the
  // registry, and `vwap_series` exists precisely so `compute_case` cannot answer
  // for the two vwap fixtures whose `expected` is null. A (kind, columns) pair is
  // irreducible, exactly like `INDICATOR_CHORDS`' (key, indicator) pair — so this
  // is `keep`, not a twin to retire.
  //
  // ⛔ AND IT IS THE PYTHON SCAN'S ONLY HONEST FLOOR. The two `C` rows below both
  // retire in Phase C; this one does not.
  { file: 'api/services/indicator_compute.py',
    region: '_CASE_COLUMNS — the golden-fixture kind→columns dispatch',
    anchor: '_CASE_COLUMNS: Dict[str, Tuple[str, ...]] = {', fate: 'keep' },
```

Then `const SITE_COUNT = 7`, `expect(counts).toEqual({ C: 2, keep: 5 })`, and add the new pair to the sorted `file::region → fate` literal — **regenerated from `LEDGER`, never typed by hand** (the histogram is a histogram: swapping two fates preserves every count and passes there; only the sorted-pair literal refuses a permutation).

- [ ] **Step 6: Gate — the measurement, the non-measurement, and four mutations**

Run:
```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_alert_evaluator.py \
    tests/test_indicator_alert_service.py tests/test_indicator_compute.py tests/test_indicator_golden.py -q
```
Expected: all green; pytest **150** unchanged (this task touches no Python source).

**The measurement:** the Python scan's found-set, printed and recorded (3 files today), and `SITE_COUNT` / partition / sorted-pair mapping all agreeing.
**The non-measurement assertion:** the JS scan's found-set is **byte-identical before and after this task** — this task adds a scan, it does not change what the old one sees. Assert the JS `found` array explicitly.

Mutations (via `tools/phase_c_gauntlet.py` once Task 2 lands it; until then, by hand with the same protocol — preflight `count == 1` + non-empty byte diff, CONTROL A ANSI-stripped abort-on-zero, CONTROL B under the mutation's own `-t`, verdict from the **exit code**):

| id | mutation | must go red because |
|---|---|---|
| **M1** | append a four-id dict (`{"rsi": 1, "macd": 1, "bb": 1, "vwap": 1}`) to `api/services/indicator_alert_service.py` | a **born** Python site is refused |
| **M2** | replace `stripPyComments` with `s => s` | `indicator_alert_evaluator.py`'s docstring names eight addresses — measured: with the identity stripper the found-set is unchanged today (all three files are flagged by code anyway), **so M2 alone is NON-LETHAL.** Pair it: **M2b** prepends a four-id `#` comment to `api/services/indicator_alert_service.py` and asserts the scan stays **green** with the real stripper and goes **red** with the identity one. Report M2 as the designed survivor and M2b as the kill — the B4 Task 12 M13-pair shape. |
| **M3** | `keepPython` floor → `[]` | a control that stops looking rots green |
| **M4** | re-fate `indicator_compute.py` `keep` → `C`, **total preserved** | only the sorted-pair mapping can see a permutation |

- [ ] **Step 7: Control audit**

```bash
grep -rn "SITE_COUNT\|C: 2\|keep: 4" docs/ app/src --include=*.md --include=*.js --include=*.jsx | grep -v node_modules
```
A doc that quotes a test's expectation is a control that rots green (B4 found `docs/runbooks/chart-parity-gate.md` §5.3 doing exactly that). **De-literal, never re-type**: any doc mentioning the partition names the test instead of the number. Check `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §5 in particular — it already says "read the live count in `enumerationSites.test.js`, never here", so it should need no edit; **assert that by reading it, not by assuming it.**

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/__tests__/enumerationSites.test.js \
        app/src/components/chart/engine/__tests__/sourceScan.js \
        docs/decisions/2026-08-06-closed-bar-alert-cutover.md
git commit -m "test(alerts): the discovery scan learns to read Python, and finds a seventh site"
```

---

# Task 2: The replay harness — real bars, a frozen fire log, and a repaint oracle that reads NON-ZERO today

**Files:**
- Create: `tools/alert_replay.py`
- Create: `tools/phase_c_gauntlet.py`
- Create: `tests/fixtures/alerts/replay_bars.json`
- Create: `tests/fixtures/alerts/fire_log_forming.json`
- Create: `tests/test_alert_replay.py`
- Create: `docs/runbooks/alert-replay-gate.md`

**Interfaces:**
- Consumes: `api/services/indicator_alert_evaluator` (**reads it; does not edit it**).
- Produces: `replay(bars, alerts, *, k, evaluate) -> list[Fire]`; `fire_key(fire) -> tuple`; `intrabar_path(bar, k) -> list[dict]`; `load_fixture(name) -> dict`; the frozen `fire_log_forming.json`.

**Must not touch:** anything under `api/` or `app/src/`. This task changes **no shipped source**; assert that with a name-only diff.

- [ ] **Step 1: Freeze real bars**

Three fixtures in `tests/fixtures/alerts/replay_bars.json`, one JSON document:

| key | source | why this one |
|---|---|---|
| `intraday5m` | `barsFrom: "app/src/pages/parityBars/intraday5m.json"` (579 bars) | **the same series `tools/chart_parity.py` renders through `?fixedbars=` and the same series the golden VWAP fixture computes against.** The compute oracle, the pixel gate and the alert replay become provably one series. |
| `spy_daily` | `bars_sqlite.get_bars('SPY', 'D', 400)`, taken once and written down | real daily bars, real gaps, real holidays — a synthetic ramp cannot produce a session gap |
| `nvda_5m_extended` | `bars_sqlite.get_bars('NVDA', '5', 800)` spanning **an extended-hours day crossing UTC midnight** and **a DST transition** | spec §9.1's two mandatory session fixtures. VWAP's session anchor is the reason. |

Write a one-shot recorder `tools/alert_replay.py --freeze-bars` that reads the store and emits the JSON, and give it the same do-not-re-run banner `tests/fixtures/_gen_alert_baseline.py` carries:

```python
#!/usr/bin/env python3
"""Alert replay harness — the instrument Phase C measures itself with.

⛔ `--freeze-bars` AND `--record` ARE ONE-SHOT. Their output is COMMITTED and is
the oracle. Re-running `--record` after a change re-records whatever the code now
does and converts a real regression into a green build — the same trap
`tests/fixtures/indicators/_generate.py` and `tests/fixtures/_gen_alert_baseline.py`
are written under.

    python tools/alert_replay.py --freeze-bars                 # once, ever
    python tools/alert_replay.py --record                      # once, on the UNMODIFIED tree
    python tools/alert_replay.py --check                       # the gate
    python tools/alert_replay.py --repaint --k 1 2 4 8         # the repaint oracle
"""
```

- [ ] **Step 2: Write the intra-bar path model — and say out loud that it is a model**

```python
# ⭐ THE PATH MODEL, AND WHY A MODEL IS THE RIGHT ANSWER.
#
# A repaint is BY DEFINITION a dependence of the fire set on the intra-bar path.
# We have no tick data, so we synthesize the path from OHLC using the standard
# convention: an UP bar walks o -> l -> h -> c, a DOWN bar walks o -> h -> l -> c.
# That carries the two extremes, which are the only points that can flip a
# threshold that the close does not.
#
# ⚠️ IT IS A MODEL, AND ITS LIMIT IS STATED: it cannot reproduce a path that
# touches an extreme TWICE, so it UNDER-counts repaints. That is the safe
# direction — a repaint this model does not see is one the real tape can still
# produce, so `closed`'s zero is a claim about a SUPERSET of the paths this
# harness drives, never a subset.

def intrabar_path(bar: dict, k: int) -> list[dict]:
    """The k partial bars the store would have held while `bar` was forming.

    Every partial carries the running high/low/close as of that sample. The LAST
    partial is the closed bar itself, byte-identical to `bar` — so `k=1` is the
    degenerate "only ever saw the close" case and MUST reproduce the closed-bar
    answer for any evaluator.
    """
    o, h, l, c = bar["o"], bar["h"], bar["l"], bar["c"]
    legs = [o, l, h, c] if c >= o else [o, h, l, c]
    out = []
    for i in range(k):
        # sample the piecewise-linear walk at k evenly spaced points, last == c
        pos = (i + 1) / k * (len(legs) - 1)
        seg = min(int(pos), len(legs) - 2)
        frac = pos - seg
        px = legs[seg] + (legs[seg + 1] - legs[seg]) * frac
        seen = legs[: seg + 1] + [px]
        out.append({
            "t": bar["t"], "o": o,
            "h": max(seen), "l": min(seen), "c": px,
            # volume accrues linearly; MFI and OBV read it
            "v": int(bar["v"] * (i + 1) / k),
        })
    out[-1] = dict(bar)
    return out
```

- [ ] **Step 3: Write the replay + the fire key**

```python
def fire_key(f: dict) -> tuple:
    """The identity of one fire. `value` is IN the key on purpose.

    Two fires of the same alert on the same bar at different values are two
    different facts about the world, and a set keyed without the value would
    report a changed number as no change at all.
    """
    return (f["alert_key"], f["bar_index"], f["bar_time"],
            repr(f["value"]), f["triggered"])


def replay(bars, alerts, *, k, evaluate):
    """Walk `bars` one bar at a time, k intra-bar samples each, collecting fires.

    `evaluate(alert, bars_seen) -> (value, triggered)` is injected — the harness
    never imports the evaluator's private names, so the same harness measures the
    forming lane and the closed lane without a branch.

    `alert["last_value"]` is mutated in place between samples, exactly as
    `record_evaluation` / `record_trigger` do in production. That is the whole
    mechanism under test.
    """
    fires = []
    for i, bar in enumerate(bars):
        for partial in intrabar_path(bar, k):
            seen = bars[:i] + [partial]
            for a in alerts:
                value, triggered = evaluate(a, seen)
                if value is None:
                    continue
                if triggered:
                    fires.append({"alert_key": a["alert_key"], "bar_index": i,
                                  "bar_time": bar["t"], "value": value,
                                  "triggered": True})
                a["last_value"] = value
    return fires
```

- [ ] **Step 4: Record the frozen fire log — on the UNMODIFIED tree, and commit it FIRST**

The alert grid is generated from the **live catalog** (so it covers all 28 addresses, not a hand-copy), crossed with a threshold ladder derived per address from the actual value range of the fixture's series — a fixed ladder like the 5,040 baseline's would miss every price-scale address (VWAP on SPY is ~600; a threshold of 70 is never crossed).

```bash
python tools/alert_replay.py --record
git add tests/fixtures/alerts/ tools/alert_replay.py
git commit -m "test(alerts): freeze the forming-bar fire log before anything changes"
```

The recorder asserts **its own non-vacuity before writing**, the shape `_gen_alert_baseline.py` uses:

```python
    assert fired, "no alert fired — the grid cannot detect a change in firing"
    assert fired < len(grid) * len(bars), "every combination fired — the grid is saturated"
    assert per_address_fires and all(per_address_fires.values()), (
        "an address produced ZERO fires across the whole replay: "
        f"{[a for a, n in per_address_fires.items() if not n]} — widen its "
        "threshold ladder, or the log pins nothing about it"
    )
```

- [ ] **Step 5: THE REPAINT ORACLE — measure it, and refuse a zero**

```python
def repaint_disagreement(bars, alerts, ks, evaluate) -> dict:
    """How much the fire set depends on WHEN WE LOOKED.

    Returns {k: fires} plus the symmetric difference against k=1. An evaluator
    that judges the CLOSED bar returns the same set at every k, so the union of
    those differences is EMPTY. An evaluator that judges the forming bar with
    cycle-granularity crossings does not.
    """
```

```bash
python tools/alert_replay.py --repaint --k 1 2 4 8
```

🔴 **THE VACUITY REFUSAL. If the disagreement count is 0 on today's tree, the harness is not driving the forming bar and the run ABORTS.** A repaint oracle that reports "no repaints" against the evaluator this whole phase exists to fix is a gate that cannot fail — the shape that has been vacuous eighteen distinct ways on this branch. Record the number in `docs/runbooks/alert-replay-gate.md`; **it is the phase's headline "before" number** and Task 5 has to drive it to exactly 0.

- [ ] **Step 6: The named wick fixture**

Add to `replay_bars.json` a fourth, hand-built series `wick_that_unwinds`: a ramp that parks RSI(14) at ~68, then one bar whose **high** takes it above 70 and whose **close** leaves it at ~69, then flat. Assert, in `tests/test_alert_replay.py`:

```python
def test_the_wick_fires_today_and_that_is_the_defect():
    """The whole reason Phase C exists, as a number.

    ⚠️ NOT a test that the code is right — a test that it is WRONG in the exact
    way the record describes. Task 5 inverts it, and the inversion is the proof
    the rebuild did the thing rather than something adjacent.
    """
    fires = replay(WICK_BARS, [rsi_cross_above_70()], k=4, evaluate=forming_evaluate)
    assert fires, "the forming-bar evaluator did NOT fire on the wick — either the " \
                  "fixture no longer crosses 70 intra-bar, or the harness is not " \
                  "driving the forming bar at all"
    assert all(f["bar_index"] == WICK_INDEX for f in fires)

    closed = replay(WICK_BARS, [rsi_cross_above_70()], k=1, evaluate=forming_evaluate)
    assert closed == [], "the close alone does not cross 70 — if it does, the " \
                         "fixture is not a wick and proves nothing"
```

- [ ] **Step 7: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_replay.py -q
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_alert_evaluator.py \
    tests/test_indicator_alert_service.py tests/test_indicator_compute.py tests/test_indicator_golden.py -q
git diff --name-only HEAD | grep -E '^(api|app)/' && echo "SHIPPED SOURCE CHANGED — refuse" || echo "no shipped source touched"
```

**The measurement:** the K-way disagreement count (must be > 0), and the fire log's row count, fire count, and per-address coverage.
**The non-measurement assertion:** the name-only diff touches **no `api/` and no `app/` file** — this task builds an instrument and changes nothing it measures.

Mutations — **the harness must be proven able to measure an intended change** (B5 Task 2's precedent, where the harness's own gate was that it could see one):

| id | mutation | must go red because |
|---|---|---|
| **M1** | in `intrabar_path`, return `[dict(bar)]` regardless of `k` | the path model is the oracle; flattening it makes every k agree and the repaint count go to 0 — caught by the vacuity refusal |
| **M2** | re-point `rsi`'s value fn at `mfi`'s (the B5 control, verbatim) | the fire log is an equality, not a shape check |
| **M3** | drop `value` from `fire_key` | a changed number must not read as no change |
| **M4** | `replay` stops writing back `a["last_value"]` | the cycle-carried `prev` **is** the mechanism; without the write-back the forming lane accidentally looks closed-bar |
| **M5** | delete the per-address non-vacuity assertion, then empty one address's ladder | an address pinning nothing must not pass silently (⚠️ delete-the-guard-then-break-it is the ONLY lethal ordering here — B5 Task 4's M8 was self-contradictory the other way round and measured `rc=0`) |

- [ ] **Step 8: Write `tools/phase_c_gauntlet.py`**

Generalize `tools/flipc_mutation_gauntlet.py`: same CONTROL A (unmutated, ANSI-stripped, **abort on a zero passed count**), same CONTROL B (per-mutation `-t` / `-k` filter, unmutated, **non-zero passed**), same preflight (`count == 1` match + non-empty byte diff **before** anything runs), verdict from the **exit code**, restore in a `finally` with sha256 asserted in both directions.

Carry forward the two hardening notes it already has, and add the two this branch learned after it was written:

```python
# ⚠️ NONZERO IS NECESSARY BUT NOT SUFFICIENT. B5 Task 10's M15 filter selected a
# pure-helper case its binder mutation could not REACH, and CONTROL B reported
# passed=1 throughout. Every mutation therefore declares `must_reach` — the test
# whose failure is the kill — and a kill whose failing test is not that one is
# reported SUSPECT, not KILLED.
#
# ⚠️ ARGV AS A LIST, shell=False. A `-t` containing a double quote SPLIT under
# cmd.exe and selected TEN tests; a single-quoted `-t` selected NOTHING and
# reported passed=None. Both happened, on this branch, in the same phase.
```

- [ ] **Step 9: Commit**

```bash
git add tools/alert_replay.py tools/phase_c_gauntlet.py tests/test_alert_replay.py \
        docs/runbooks/alert-replay-gate.md
git commit -m "test(alerts): the replay harness, and the repaint number it refuses to report as zero"
```

---

# Task 3: The operand grammar — one relational primitive, and `_bb_threshold_override` retires into it

**Files:**
- Create: `api/services/alert_conditions.py`
- Modify: `api/services/indicator_alert_evaluator.py` (imports the moved functions; `_bb_threshold_override` deleted)
- Modify: `tests/test_indicator_alert_evaluator.py`
- Create: `tests/test_alert_conditions.py`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```python
  def check_condition(condition, current, prev, threshold) -> bool          # MOVED VERBATIM
  def resolve_operand(spec, bars, params, address_value) -> Optional[float]
  OPERAND_KINDS = ("const", "address", "close")
  ```

**Must not touch:** `app/src/**`, `api/services/indicator_compute.py` (Task 4 owns those).

**Runs in parallel with Task 4.**

- [ ] **Step 1: Write the failing test**

```python
def test_a_bb_touch_resolves_through_the_generic_operand_now():
    """`_bb_threshold_override` was the module's ONE relational primitive and it
    was bb-only. It is now one CASE of a general grammar, and the proof it is the
    same case is that the 5,040-row baseline replay does not move.
    """
    bars = _load_alert_baseline()["bars"]
    upper = indicator_compute.compute_bb([b["c"] for b in bars], 20, 2.0)[0]
    got = ac.resolve_operand({"kind": "address", "address": "bb.upper"},
                             bars, {"period": 20, "stddev": 2.0}, None)
    assert got == upper[-1]


def test_close_is_an_operand_and_it_is_not_the_same_thing_as_a_constant():
    bars = _load_alert_baseline()["bars"]
    assert ac.resolve_operand({"kind": "close"}, bars, {}, None) == bars[-1]["c"]
    assert ac.resolve_operand({"kind": "const", "value": 70.0}, bars, {}, None) == 70.0


def test_an_unknown_operand_kind_raises_rather_than_returning_none():
    """⛔ RAISES. `None` is the module's "could not compute" answer and
    `_evaluate_one` turns it into a silent no-fire — which is the `vwap` class of
    defect (an alert offered that can never fire) reached from a new direction.
    A malformed operand is a BUG, not a quiet bar.
    """
    with pytest.raises(ValueError, match="unknown operand kind"):
        ac.resolve_operand({"kind": "vibes"}, [], {}, None)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_conditions.py -q
```
Expected: FAIL — `ModuleNotFoundError: api.services.alert_conditions`.

- [ ] **Step 3: Write `alert_conditions.py`**

Move `check_condition` **verbatim** (its 5,040-row oracle is pointed at it; a re-typed copy is a new function wearing an old name), and add:

```python
OPERAND_KINDS = ("const", "address", "close")


def resolve_operand(spec, bars, params, address_value):
    """One operand → one number at the LAST bar of `bars`.

    ⭐ THIS IS THE SECOND RELATIONAL PRIMITIVE `_SAR_IS_NOT_OFFERED` DEFERRED TO
    PHASE C, AND IT IS BUILT ONCE. `_bb_threshold_override` was the first and it
    was bb-only; MACD-vs-its-signal-LINE was refused for the same reason and is
    now expressible as `{"kind": "address", "address": "macd.signal"}`.

    ⚠️ IT READS THE DELIVERY WRAPPERS, like every other consumer of this lane.
    A relation between a rounded left side and an unrounded right side would flip
    at boundaries in a way no user could predict, and the Global Constraint is
    that both live consumers compare against the ROUNDED form.
    """
    kind = (spec or {}).get("kind")
    if kind == "const":
        v = spec.get("value")
        return None if v is None else float(v)
    if kind == "close":
        return float(bars[-1]["c"]) if bars else None
    if kind == "address":
        return address_value(spec["address"], bars, params)
    raise ValueError(f"unknown operand kind {kind!r} — legal kinds are {OPERAND_KINDS}")
```

- [ ] **Step 4: Delete `_bb_threshold_override` and route `bb` through the grammar**

In `indicator_alert_evaluator._evaluate_one`, the special case becomes a declaration:

```python
    # ⭐ `bb`'s DYNAMIC THRESHOLD IS NOW A DECLARED OPERAND, NOT A BRANCH.
    # ⛔ AND `bb` STILL IS NOT `bb.middle`. The legacy `bb` alert reports the CLOSE
    # and looks the BAND up as the threshold — a price-vs-band relation. Collapsing
    # it into the band's own value would silently change what every armed `bb`
    # alert means, and 5,040 recorded rows say so.
    THRESHOLD_OPERAND = {
        ("bb", "touch_upper"): {"kind": "address", "address": "bb.upper"},
        ("bb", "touch_lower"): {"kind": "address", "address": "bb.lower"},
    }
```

- [ ] **Step 5: Run the whole indicator selection**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_conditions.py \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py \
    tests/test_indicator_compute.py tests/test_indicator_golden.py -q
```
Expected: PASS, and `test_the_eight_legacy_addresses_evaluate_identically` **green without being edited** — that is the whole point of this task.

- [ ] **Step 6: Gate**

**The measurement:** the 5,040-row replay is exactly equal, **and** `tools/alert_replay.py --check` reproduces `fire_log_forming.json` set-for-set. Two independent oracles, one of them recorded before this phase existed.
**The non-measurement assertion:** a comment-stripped source scan proves `_bb_threshold_override` occurs **zero** times in `api/`, with the control that the raw source still names it (it lives in a tombstone comment). A raw probe would report the retirement incomplete forever — B5 Task 4 measured exactly that trap on a clean tree.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `THRESHOLD_OPERAND` maps `touch_upper` to `bb.lower` | the operand's *identity* matters, and only a value comparison sees it |
| **M2** | `resolve_operand` returns `None` for an unknown kind instead of raising | a malformed operand becomes a silent never-fire |
| **M3** | `resolve_operand("address")` reads `compute_bb_raw` instead of `compute_bb` | rounded-vs-unrounded flips a boundary; the 5,040 replay is the only thing that can see it |
| **M4** | route `bb` at `bb.middle` | the deliberate non-collapse |
| **M5** | re-type `check_condition` with `>=` for `>` in `cross_above` | the moved function must be the moved function |

- [ ] **Step 7: Control audit**

```bash
grep -rn "_bb_threshold_override\|relational primitive\|bb-only" api/ tests/ docs/ --include=*.py --include=*.md
```
`_SAR_IS_NOT_OFFERED`'s prose says *"this module has exactly one relational primitive (`_bb_threshold_override`), which is bb-only."* **That premise is now false and its test is still green** — the test asserts the prose is present, not that it is true. Do **not** edit it here; Task 4 owns that retirement and edits it in the commit that makes `sar` alertable. **Record the rot in this task's report and hand it to Task 4 by name.** (This is the green-while-false shape; naming it in a hand-off is what B5 Task 7 did after finding four of them at once.)

- [ ] **Step 8: Commit**

```bash
git add api/services/alert_conditions.py api/services/indicator_alert_evaluator.py \
        tests/test_alert_conditions.py tests/test_indicator_alert_evaluator.py
git commit -m "refactor(alerts): one operand grammar; the bb-only threshold override retires into it"
```

---

# Task 4: Events are columns — `{0,1,NaN}` enforced at registration, and SAR gets two

**Files:**
- Modify: `app/src/components/chart/engine/defSchema.js`
- Modify: `app/src/components/chart/engine/nativeRegistry.js`
- Modify: `app/src/components/chart/indicators.js`
- Modify: `api/services/indicator_compute.py`
- Modify: `app/src/components/chart/engine/__tests__/defSchema.test.js` (or the co-located file)
- Create: `app/src/components/chart/engine/__tests__/eventColumns.test.js`
- Modify: `tests/test_indicator_golden.py`, `tests/test_indicator_compute.py`

**Interfaces:**
- Consumes: nothing from Task 3.
- Produces: `columnKeys(def)` now returns plot keys **∪ event keys**; `computeFor(def, bars, inputs)` returns an entry per event key; `EVENT_COLUMN_DOMAIN = Object.freeze([0, 1, NaN])`; on the Python side `compute_sar_events(bars, step, max_step) -> Tuple[List[MaybeNum], List[MaybeNum]]`.

**Must not touch:** `api/services/indicator_alert_*`, `api/services/alert_*` (Task 3 owns those).

**Runs in parallel with Task 3.**

- [ ] **Step 1: Write the failing schema test**

```js
  it('an event whose key names no returned column REFUSES to register', () => {
    // Spec §3.1: "Events are columns. `events[].key` MUST match a returned
    // column valued {0, 1, NaN}." Today `validateEvent` checks the KEY's shape,
    // its uniqueness, and that it does not collide with a plot — and NOTHING
    // checks that a column comes back. `columnKeys` reads `def.plots` only, so
    // an event has been declarable and inert since B1.
    const def = { ...probeDef(), events: [{ key: 'neverComputed', label: 'x' }] }
    const res = registerDefinitions([def])
    expect(res.errors.join('\n')).toMatch(/neverComputed.*returned no column/)
  })

  it('an event column outside {0, 1, NaN} REFUSES to register', () => {
    // 0.5 is not a "maybe". The whole grammar alerts, screens and the D-phase AST
    // all consume this one shape; a float column wearing an event's name would be
    // read as a signal by every one of them.
    const res = registerDefinitions([defWhoseEventColumnIs(0.5)])
    expect(res.errors.join('\n')).toMatch(/must be 0, 1 or NaN.*got 0\.5/)
  })
```

- [ ] **Step 2: Run and watch both fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/eventColumns.test.js
```
Expected: FAIL — both register cleanly today (`errors` is `[]`).

- [ ] **Step 3: Implement**

In `defSchema.js`:

```js
/** The only three values an event column may hold.
 *
 *  ⚠️ `NaN` IS IN THE DOMAIN AND IT IS NOT "NO EVENT". It is the warmup pad —
 *  bars before the event is computable at all, exactly as every plot column is
 *  NaN-padded to `bars.length`. `0` means "computed, did not happen". Collapsing
 *  them would make a 200-bar indicator's first 199 bars read as 199 non-events.
 */
export const EVENT_COLUMN_DOMAIN = Object.freeze([0, 1, NaN])

export function isEventColumnValue(v) {
  return v === 0 || v === 1 || Number.isNaN(v)
}
```

In `nativeRegistry.js` — `columnKeys` is the seam:

```js
/** The column keys a definition's compute must return.
 *
 *  ⭐ EVENTS JOIN PLOTS HERE, WHICH IS THE ONE-LINE CHANGE THAT MAKES `events[]`
 *  REAL. `defSchema.validateEvent` has always guaranteed events and plots share
 *  ONE namespace (a collision is an error), so the union cannot alias.
 *  `hlines` plots are still excluded: they draw price lines and produce no data.
 */
export function columnKeys(def) {
  return [
    ...(def?.plots || []).filter(p => p && p.style !== 'hlines').map(p => p.key),
    ...(def?.events || []).map(e => e.key),
  ]
}
```

and in `registerDefinitions`, after a definition validates, **run its compute once over a canned 200-bar probe series and check every event column's domain**. A schema that only checks the declaration is a schema that lets a bad column ship.

In `indicators.js`, `computeParabolicSAR` gains the two event columns beside its existing outputs (it already rides an `isUptrend` boolean per point that the chart consumer strips):

```js
// ⭐ SAR'S TWO EVENTS. The value has always been there; only the NAME is new.
//   priceCrossedSar — the close moved to the other side of the stop this bar
//   trendFlipped    — the SAR itself jumped sides this bar
// Both are 1 on the bar the thing happened, 0 on every other computable bar, and
// NaN on bar 0 (the trend seed consumes it, so there is no prior to compare to).
```

In `api/services/indicator_compute.py`, the Python mirror:

```python
def compute_sar_events(bars: List[dict], step: float = 0.02,
                       max_step: float = 0.2) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """(price_crossed_sar, trend_flipped) as {0.0, 1.0, None} columns.

    ⚠️ DERIVED FROM `compute_sar_raw`, NOT RE-IMPLEMENTED. The `trend` column is
    already ±1 and already pinned by `tests/fixtures/indicators/sar_default.json`,
    so not one fixture byte is reseeded and neither lane can re-baseline under the
    other. A second SAR loop here would be the twin this whole programme retires.
    """
```

Add `("sar_events", ("priceCrossedSar", "trendFlipped"))` to `_CASE_COLUMNS` and a `sar_events_default.json` fixture generated from the **existing** `sar_default.json` bars.

⚠️ **`_CASE_COLUMNS` is Task 1's brand-new ledger row (fate `keep`).** Adding a kind is exactly what a `keep` row is for; the anchor `'_CASE_COLUMNS: Dict[str, Tuple[str, ...]] = {'` must still match **exactly once** afterwards. Re-run the ledger test; **do not edit it** — one writer at a time, and Task 1 is the writer.

- [ ] **Step 4: Run both lanes**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/eventColumns.test.js \
    src/components/chart/goldenFixtures.test.js src/components/chart/engine/nativeRegistry.test.js
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_golden.py tests/test_indicator_compute.py -q
```
Expected: PASS both lanes, the new fixture read by **both** (a fixture only one lane reads proves nothing).

- [ ] **Step 5: Retire `_SAR_IS_NOT_OFFERED`'s test into its successor**

Task 3 handed this over by name. Replace `test_sar_is_deliberately_not_offered_and_says_why` with:

```python
def test_sar_has_no_fixed_threshold_address_and_says_why():
    """SAR is alertable now — by EVENT and by RELATION, never by a fixed level.

    ⭐ MOVED DOWN A LEVEL, NOT DELETED. The old test asserted `sar` was absent
    from `INDICATOR_FUNCS` AND that `_SAR_IS_NOT_OFFERED`'s prose was still
    present. The absence claim narrowed — SAR now has two event addresses — but
    the REASON did not change one word: a stop level that jumps to the other side
    of price at every flip names no trading event at a fixed number. So the prose
    survives, beside the narrower refusal, and this test still refuses to let the
    threshold entry be added without someone reading it.
    """
    assert "sar" not in THRESHOLD_ADDRESSES
    assert "sar" not in {plot_base(a) for a in THRESHOLD_ADDRESSES}
    assert "jumps" in _SAR_IS_NOT_A_THRESHOLD and "relational" in _SAR_IS_NOT_A_THRESHOLD
    # …and the positive control, so this cannot pass on a tree where SAR is
    # simply un-alertable again:
    assert "sar.trendFlipped" in EVENT_ADDRESSES
    assert "sar.priceCrossedSar" in EVENT_ADDRESSES
```

Also correct the prose's now-false clause — *"this module has exactly one relational primitive (`_bb_threshold_override`), which is bb-only"* — in place, past tense. **A premise that quietly stops being true is what this file is for.**

- [ ] **Step 6: Gate**

**The measurement:** JS and Python both read `sar_events_default.json` at rel-tol 1e-9; the register-time domain check runs over all 14 definitions plus the probe.
**The non-measurement assertion:** `columnKeys` output is asserted **unchanged for all 14 shipped definitions** — none declares `events` today, so widening the function must move nothing. If any definition's column list changes, the union aliased something.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `columnKeys` drops the event spread | events go inert again — the whole task |
| **M2** | domain check accepts any finite number | 0.5 as an event |
| **M3** | domain check accepts NaN **only** (drop `0`/`1`) | an all-NaN column would pass; the check must be a domain, not a null test |
| **M4** | `compute_sar_events` re-implements the SAR loop instead of reading `compute_sar_raw` | the twin refusal — ⚠️ **verify this one is lethal before relying on it**: an exact re-implementation is an *equivalent mutant* on a value comparison, so the killer must be the comment-stripped source probe asserting `compute_sar_raw(` appears in the body, not a number |
| **M5** | flip `priceCrossedSar` and `trendFlipped` in the column tuple | an off-by-one in a column index is invisible to any "the value changed" test — the ordering-invariant shape `test_every_plot_address_resolves_to_the_column_it_names` already uses |

- [ ] **Step 7: Control audit**

```bash
grep -rn "events" app/src/components/chart/engine --include=*.js --include=*.jsx | grep -iE "test|spec" | grep -v pointer-events
grep -rn "sar" tests/ api/ --include=*.py | grep -iE "not offered|deliberately|relational"
```
`defSchema.test.js` currently asserts *"a definition that omitted `events` gets no `events: []` bolted on"* — still true, verify it. `nativeRegistry.js:606-608`-class comments claiming events are unconsumed are now false; rewrite past-tense rather than deleting (B5 Task 4's rule).

- [ ] **Step 8: Commit**

```bash
git add app/src/components/chart/engine/defSchema.js \
        app/src/components/chart/engine/nativeRegistry.js \
        app/src/components/chart/indicators.js api/services/indicator_compute.py \
        app/src/components/chart/engine/__tests__/eventColumns.test.js \
        tests/fixtures/indicators/sar_events_default.json \
        tests/test_indicator_golden.py tests/test_indicator_compute.py \
        tests/test_indicator_alert_evaluator.py
git commit -m "feat(engine): events are columns, and SAR names two of them"
```

---

# Task 5: The closed-bar evaluator, dark behind `ALERT_EVAL_MODE`

**Files:**
- Create: `api/services/alert_series.py`
- Modify: `api/services/indicator_alert_evaluator.py`
- Modify: `tests/test_indicator_alert_evaluator.py`
- Create: `tests/test_alert_closed_bar.py`
- Modify: `tools/alert_replay.py` (a second injected `evaluate`)

**Interfaces:**
- Consumes: `alert_conditions.check_condition` / `resolve_operand` (T3); `EVENT_ADDRESSES` (T4).
- Produces:
  ```python
  ALERT_EVAL_MODE = "forming"        # "forming" | "closed"
  def eval_mode() -> str             # THE ONLY READER of the constant
  def series_for(address, bars, params) -> list[Optional[float]]   # aligned to len(bars)
  def closed_bar_index(bars, tf, now_epoch) -> int                 # -1 when nothing has closed
  def _evaluate_one_closed(alert, bars, *, now_epoch) -> tuple[Optional[float], bool, Optional[int]]
  ```

**SOLO.** Nothing else may write `indicator_alert_evaluator.py` while this is in flight.

- [ ] **Step 1: Write the failing test — the repaint oracle at zero**

```python
def test_the_closed_bar_lane_produces_the_SAME_fire_set_at_EVERY_granularity():
    """The headline number of Phase C.

    A fire repaints iff the fire set depends on when you looked. Task 2 measured
    the forming lane disagreeing across k; this asserts the closed lane does not,
    at all, for any k, on real historical bars.

    ⛔ SET EQUALITY, NOT A COUNT. A DIFFERENT set of the same SIZE is the exact
    shape a bar-index off-by-one produces.
    """
    bars = load_fixture("spy_daily")["bars"]
    alerts = grid_from_catalog()
    sets = {k: {fire_key(f) for f in replay(bars, deepcopy(alerts), k=k,
                                            evaluate=closed_evaluate)}
            for k in (1, 2, 4, 8)}
    base = sets[1]
    for k, s in sets.items():
        assert s == base, (
            f"the fire set at k={k} differs from k=1 by "
            f"{len(s ^ base)} fires — the closed-bar lane is still reading the "
            f"forming bar somewhere"
        )
    assert base, "no fire at any granularity — the grid pins nothing"


def test_the_wick_that_unwinds_does_NOT_fire_closed_bar():
    """Task 2 asserted this bar DOES fire today. This is the inversion."""
    fires = replay(WICK_BARS, [rsi_cross_above_70()], k=4, evaluate=closed_evaluate)
    assert fires == [], (
        "the wick still fires. Its HIGH takes RSI above 70 and its CLOSE does "
        "not, so a closed-bar crossing cannot see it."
    )
```

- [ ] **Step 2: Run and watch it fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_closed_bar.py -q
```
Expected: FAIL — `closed_evaluate` does not exist.

- [ ] **Step 3: Write `alert_series.py`**

The contract change is the point: `INDICATOR_FUNCS`' successor returns **the whole aligned series**, not the last value.

```python
"""Address → the indicator's FULL aligned series.

⭐ THE CONTRACT CHANGE THAT MAKES CLOSED-BAR POSSIBLE. `INDICATOR_FUNCS` returned
`_last_non_none(...)` — one number, the newest computable one — which is why the
only `prev` available was the previous POLL's number. With the whole column in
hand, `prev` is `series[i-1]` and `current` is `series[i]`, and the crossing is a
comparison of two BARS rather than two CYCLES.

⚠️ EVERY ENTRY STILL READS THE DELIVERY WRAPPER (`compute_atr`, not
`compute_atr_raw`). Global Constraint: the two live consumers of this lane have
always compared user thresholds against the rounded form, and the 5,040-row
baseline is a recording of exactly those numbers.

⚠️ ALIGNMENT IS THE WHOLE SAFETY PROPERTY. Every returned list is `len(bars)` with
`None` before the first computable bar — `indicator_compute`'s own alignment rule.
An address whose series is SHORTER than `bars` silently shifts every index, so
`series_for` asserts the length rather than trusting it.
"""
```

- [ ] **Step 4: Write `closed_bar_index` — and be explicit about the boundary**

```python
def closed_bar_index(bars, tf, now_epoch):
    """Index of the newest bar that has CLOSED, or -1.

    ⛔ THIS IS NOT `len(bars) - 2`. Three reasons, each measured:
      1. Outside RTH the store's newest bar is already closed, so blanket
         last-minus-one drops a whole real bar and every alert fires one bar late,
         forever, in exactly the hours a swing trader looks.
      2. `bars_sqlite` daily/weekly/monthly ts are YYYYMMDD ints; intraday ts are
         unix seconds. Comparing a YYYYMMDD to `now_epoch` is a type confusion the
         ledger's own `_normalize_bar_time` exists because of.
      3. A gap (holiday, halt, thin ticker) means the newest bar can be days old
         and unambiguously closed.

    So: a bar is closed iff `now_epoch >= bar_start + tf_seconds`, with the daily
    encoding resolved through the SAME ET session boundary `compute_vwap` uses —
    ⛔ never `_ET_OFFSET`-style module-load constant arithmetic, which is an hour
    wrong for half the year depending on when the process started
    (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md` §7).
    """
```

- [ ] **Step 5: Write `_evaluate_one_closed`, and demote `last_value`**

```python
def _evaluate_one_closed(alert, bars, *, now_epoch):
    """(value, triggered, bar_index) at the newest CLOSED bar.

    ⭐ `prev` COMES FROM THE SERIES, NOT FROM THE ROW. `alert["last_value"]` is
    DEMOTED to delivery-dedup and is not read here at all — spec §8, and the
    reason Task 2's repaint number is what it is.

    ⭐ AND `bar_index` IS RETURNED, WHICH IS WHAT MAKES FIRE-ONCE POSSIBLE. The
    old lane could only ask "did it fire this cycle"; this one can ask "did it
    fire for THIS BAR", which is the same question the signal ledger's UNIQUE key
    asks and the reason a closed-bar fire is ledger-grade at all.
    """
    i = closed_bar_index(bars, alert["tf"], now_epoch)
    if i < 1:
        return None, False, None
    series = series_for(resolve_address(alert.get("indicator")), bars, _parse_params(alert))
    current, prev = series[i], series[i - 1]
    if current is None:
        return None, False, i
    threshold = _threshold_for(alert, bars, i)
    return current, check_condition(alert.get("condition") or "", current, prev, threshold), i
```

- [ ] **Step 6: SPLIT the 5,040-row control — down a level, never weakened**

The baseline's `prev` is a *supplied* `last_value`; this lane no longer takes one from there. **Split it into two halves that are each exact forever:**

```python
def test_the_eight_legacy_addresses_still_compute_identical_VALUES():
    """Half one: `value` is a pure function of (bars, params, address) and must
    NEVER move. 5,040 rows, exact equality, no `approx`.
    """


def test_the_eight_legacy_CONDITIONS_still_decide_identically():
    """Half two: `check_condition(condition, value, prev, threshold)` is pure and
    is called DIRECTLY with the recorded `prev`. Also exact, also forever.

    ⛔ THE SPLIT IS NOT A WEAKENING AND HERE IS THE ARGUMENT. The original test
    was `value` ∘ `prev-supply` ∘ `condition`. Two of those three are unchanged
    and are asserted at full strength. The third — WHO SUPPLIES `prev` — is the
    only thing this phase changes, and it is measured by the repaint oracle, which
    is a STRICTER instrument than a grid of hand-picked `prev` values because it
    derives `prev` from the bars themselves.
    """
```

Add the third test the old file already has, unchanged: `test_the_replay_fails_when_an_address_is_repointed` — the control that both halves can still detect a change.

- [ ] **Step 7: Land it DARK**

```python
# ⛔ THE MODE IS READ THROUGH ONE FUNCTION AND A SOURCE SCAN ENFORCES IT.
# `eval_mode()` is the only reader of `ALERT_EVAL_MODE`; a consumer comparing the
# constant directly is a reader the seam cannot reach, which is a branch no test
# can drive. B5 Task 10 shipped exactly this rule for `PANE_MODE` and it is why
# `flipCGeometry` could exercise a path production never took.
ALERT_EVAL_MODE = "forming"
```

⚠️ **B5 Task 10 also measured the trap on the other side:** the minifier folded `paneMode()` so hard that the panes branch was **absent from the shipped bundle** — "landed dark" was not "the branch is not taken", it was "the branch is not present". Python is not minified, so the branch is genuinely present here; **assert it by importing the module and calling the closed lane directly in a test**, which is the evidence the JS side could not produce.

- [ ] **Step 8: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_closed_bar.py tests/test_alert_conditions.py \
    tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py \
    tests/test_indicator_compute.py tests/test_indicator_golden.py tests/test_alert_replay.py -q
python tools/alert_replay.py --repaint --k 1 2 4 8 --mode closed     # MUST be 0
python tools/alert_replay.py --repaint --k 1 2 4 8 --mode forming    # MUST still be Task 2's number
python tools/alert_replay.py --check                                 # the forming log is UNCHANGED
```

**The measurement:** repaint disagreement **exactly 0** under `closed`, at k ∈ {1,2,4,8}, on all four fixtures — and **still Task 2's non-zero number under `forming`**, because the forming lane has not been touched and a zero there would mean the harness broke rather than the code improved.
**The non-measurement assertion:** `fire_log_forming.json` reproduces set-for-set, and the mode constant is `"forming"` in the committed source (a comment-stripped scan, with the control that the raw source still names `"closed"` in prose).

| id | mutation | must go red because |
|---|---|---|
| **M1** | `prev = alert["last_value"]` instead of `series[i-1]` | **the defect, restored.** Repaint count goes non-zero |
| **M2** | `closed_bar_index` returns `len(bars) - 1` | the forming bar is back; the wick fires |
| **M3** | `closed_bar_index` returns `len(bars) - 2` unconditionally | the blanket rule; an alert fires one bar late outside RTH, and a gapped ticker never fires — ⚠️ needs a fixture with a **holiday gap** to be lethal, so verify against `spy_daily` before relying on it |
| **M4** | `series_for` drops the length assertion, then return a trimmed series | every index shifts silently (⚠️ delete-then-break ordering, as in Task 2 M5) |
| **M5** | `eval_mode()` returns `"closed"` | **the cutover is Task 8's, and only Task 8's.** Any earlier task flipping this must be caught here |
| **M6** | a second reader compares `ALERT_EVAL_MODE` directly | the one-reader rule |

- [ ] **Step 9: Control audit + commit**

```bash
grep -rn "last_value\|forming\|prev" api/ tests/ --include=*.py | grep -iE "cycle|poll|previous evaluation"
```
Every comment describing `last_value` as "the previous evaluation cycle's value used by cross-* conditions" is **half-false the moment the mode flips** and fully false after Task 8. Rewrite each to name the mode it describes. `indicator_alert_service.record_evaluation`'s docstring is the load-bearing one.

```bash
git add api/services/alert_series.py api/services/indicator_alert_evaluator.py \
        tests/test_alert_closed_bar.py tests/test_indicator_alert_evaluator.py tools/alert_replay.py
git commit -m "feat(alerts): the closed-bar lane, dark -- and the repaint number is zero on it"
```

---

# Task 6: Shadow mode, and a declared diff — what changes for an armed alert, per address, with a reason

**Files:**
- Modify: `api/services/indicator_alert_evaluator.py`
- Create: `api/services/alert_shadow_log.py`
- Create: `tests/fixtures/alerts/fire_diff_declared.json`
- Create: `tests/test_alert_shadow.py`
- Modify: `docs/decisions/2026-08-06-closed-bar-alert-cutover.md` (§3 the measurement)

**Interfaces:**
- Consumes: `_evaluate_one_closed` (T5).
- Produces: `shadow_record(alert_id, bar_index, value, triggered) -> None`; `declared_diff() -> dict`; `ALERT_SHADOW_ENABLED` env gate.

**SOLO.**

- [ ] **Step 1: Write the failing test — the declared diff**

This is the direct analogue of B5's geometry/provenance split: **an undeclared difference fails, always; a declared one is recorded with its reason.**

```python
def test_every_difference_between_the_two_lanes_is_DECLARED():
    """The closed-bar rebuild CHANGES which alerts fire. That is the point, and it
    is also the thing that reaches a real inbox, so it is declared per address
    rather than discovered on cutover day.

    ⛔ UNDECLARED IS A FAILURE WHETHER IT IS AN EXTRA FIRE OR A MISSING ONE.
    B5 measured that half a gate is no gate: its `expect` had to be an EQUALITY
    because a regression SMALLER than an allowance passed a `<=`.
    """
    forming = {fire_key(f) for f in replay_all(mode="forming")}
    closed = {fire_key(f) for f in replay_all(mode="closed")}
    declared = load_declared_diff()

    gained = closed - forming
    lost = forming - closed
    undeclared = ([g for g in gained if not declared_covers(declared, g, "gained")]
                  + [l for l in lost if not declared_covers(declared, l, "lost")])
    assert undeclared == [], (
        f"{len(undeclared)} fire(s) changed with no declaration. Each needs an "
        f"entry in fire_diff_declared.json naming the ADDRESS, the DIRECTION and "
        f"the REASON. First: {undeclared[0]}"
    )


def test_a_declared_difference_that_does_not_OCCUR_is_recorded_not_failed():
    """B5's `provenance_unmet` ruling, verbatim in shape: the same fixtures run in
    several configurations, and gating an absent-but-declared difference turns
    every configuration but one red. It is REPORTED, never failed.
    """


def test_the_declaration_cannot_wave_through_a_WHOLE_ADDRESS():
    """⭐ THE MR2b LESSON. B5 found that widening the declarable field set by ONE
    geometry field was invisible to every pre-existing rail — only a case that
    DECLARED that field could separate them. So: a declaration names an address
    AND a direction AND a bounded count; a wildcard, a missing count, or a count
    larger than the recorded one is refused HERE.
    """
```

- [ ] **Step 2: Run and watch it fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_shadow.py -q
```
Expected: FAIL — `fire_diff_declared.json` does not exist and every difference is undeclared.

- [ ] **Step 3: Measure the diff, then declare it — in that order**

```bash
python tools/alert_replay.py --diff --mode-a forming --mode-b closed --out tools/alert_replay_out/diff.json
```

Read it. Group by address. **Write a reason per group, in prose, in `fire_diff_declared.json`.** Expected shapes, each of which must be *recognised* rather than assumed:

| shape | reason |
|---|---|
| a fire on a wick disappears | the crossing is bar-to-bar now — **this is the phase's whole purpose** |
| a fire moves one bar later | the forming lane fired mid-bar; the closed lane fires at that bar's close |
| a fire appears | the forming lane's `prev` was a mid-bar value that had *already* crossed, so the bar-close crossing was swallowed |
| an `above`/`below` fire repeats every cycle → once per bar | `above` is not a crossing and fired on every poll; per-bar evaluation makes it one fire per bar |

⚠️ **That last row is a real behaviour change most likely to surprise a user**, and it belongs in the owner record, not only in the diff file: an `above` alert that used to arrive every 60 seconds while the condition held now arrives once per bar. Price it as a count.

- [ ] **Step 4: Wire the shadow lane**

```python
# ⭐ SHADOW: BOTH LANES RUN, ONE LANE DELIVERS.
#
# The live lane is untouched and keeps delivering. The closed lane evaluates the
# same alerts on the same bars and writes what it WOULD have fired to its own
# store — no delivery, no `record_trigger`, no ledger, no email.
#
# ⛔ THE SHADOW LANE MAY NOT WRITE `indicator_alerts`. It shares the rows it reads
# with the live lane, and a shadow write to `last_value` would change what the
# LIVE lane fires — the observer changing the observed, on production, silently.
# `shadow_record` takes its own connection to its own database and the test
# asserts the `indicator_alerts` table is byte-identical across a shadow cycle.
```

Gate it on `ALERT_SHADOW_ENABLED=1` (default off), and register it as a **second APScheduler job**, not a second branch inside `_run_one_cycle`. Two jobs can be disabled independently; a branch cannot.

- [ ] **Step 5: Gate**

**The measurement:** total fires per lane, the gained/lost counts per address, and every one of them declared. Record all three tables in the decision record §3.
**The non-measurement assertion:** across a full shadow cycle, `SELECT * FROM indicator_alerts` is **unchanged** — dumped before and after and compared as a whole, not sampled.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `declared_covers` returns `True` unconditionally | the gate accepts everything (B5's MR4) |
| **M2** | remove the `lost` half, keep `gained` | a **missing** fire is the failure a user cannot see and cannot report |
| **M3** | declaration count `→ 9999` | an unbounded declaration is a wildcard |
| **M4** | the shadow lane calls `ias.record_evaluation` | the observer changes the observed |
| **M5** | shadow job registered inside `_run_one_cycle` instead of its own job | it cannot then be disabled without disabling delivery |

- [ ] **Step 6: Run the shadow lane against LIVE sessions before Task 8 exists**

```
ALERT_SHADOW_ENABLED=1, deployed, for at least 3 full trading sessions.
```

**This is the sequencing answer, and it is the only part of this plan that costs calendar time.** The frozen fixtures prove the lane is correct on history; the shadow run proves it on the live tape, with real armed alerts, real gaps and a real clock. Compare the shadow log against the live lane's `triggered_at` daily and **fold any new difference shape into `fire_diff_declared.json` before the cutover, not after.**

⚠️ The shadow lane runs on a **live surface with no freeze**, so it ships behind an env flag that is off by default and it writes only to its own store. Its worst failure mode is a wasted cycle.

- [ ] **Step 7: Commit**

```bash
git add api/services/alert_shadow_log.py api/services/indicator_alert_evaluator.py \
        tests/fixtures/alerts/fire_diff_declared.json tests/test_alert_shadow.py \
        docs/decisions/2026-08-06-closed-bar-alert-cutover.md
git commit -m "test(alerts): both lanes run, one delivers -- and every difference is declared"
```

---

# Task 7: `compute.rev` force-migration — notify, reset, and SUPPRESS THE FIRST CYCLE

**Files:**
- Modify: `api/services/indicator_alert_service.py` (schema: `def_rev`, `rev_migrated_at`)
- Modify: `api/services/indicator_alert_evaluator.py`
- Create: `api/services/alert_rev_migration.py`
- Create: `tests/test_alert_rev_migration.py`
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (expose the rev to the alert catalog)

**Interfaces:**
- Consumes: `alert_series.series_for`.
- Produces: `migrate_bindings_to_rev(address, new_rev, *, notify) -> dict`; `suppress_first_cycle(alert) -> bool`.

**SOLO.**

🔑 **Why this lands before the cutover:** `vwap` is already on `compute.rev: 2` and the record for it states plainly that the bump *"has no population to act on today"* — there was no VWAP alert, no backtest rule, no binding. **So this path is untested in anger, and Task 8 is itself a change of the same class** (the evaluation lane's answer moves for every armed alert). The suppression machinery has to exist and be gated before the first real population meets it.

- [ ] **Step 1: Write the failing test — the fabricated crossing**

```python
def test_the_first_cycle_after_a_rev_bump_CANNOT_fire():
    """⭐ THE FABRICATED CROSSING, AS A TEST.

    `prev` was computed by rev 1. `current` is computed by rev 2. Comparing them
    invents a crossing that no bar produced — the user is told VWAP crossed 600
    because the ANCHOR moved, not because price did. Spec §3.1 names the remedy:
    reset `last_value`, and suppress the first post-migration cycle.

    ⚠️ THE MEASUREMENT IS A FIRE, NOT A FLAG. Asserting `rev_migrated_at` is set
    asserts the bookkeeping; asserting NO NOTIFICATION LEFT THE BUILDING asserts
    the thing the user experiences.
    """
    alert = armed("vwap", "cross_above", threshold=_between(rev1_last, rev2_last))
    migrate_bindings_to_rev("vwap", 2, notify=collect)
    with delivery_spy() as sent:
        _run_one_cycle(now_epoch=T0)
    assert sent == [], "a crossing was fabricated by the migration itself"
    with delivery_spy() as sent:
        _run_one_cycle(now_epoch=T0 + 60)
    assert sent, "suppression did not lift — the alert is now permanently deaf"


def test_the_user_is_NOTIFIED_and_the_notification_names_the_indicator():
    """Spec §3.1's contract is *"you will never be silently switched"*, not
    *"old math runs forever"*. A migration with no notification honours neither.
    """
```

- [ ] **Step 2: Run and watch both fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_rev_migration.py -q
```

- [ ] **Step 3: Implement**

```python
def migrate_bindings_to_rev(address, new_rev, *, notify):
    """Force-migrate every alert bound to `address`, and tell its owner.

    ⛔ THERE IS NO ETERNAL PINNING OF `compute.rev` (spec §3.1). A `version` pin is
    free — presentation only. A `rev` pin is a promise to keep running maths we
    have decided is wrong, and `VWAP_SESSION_ANCHOR` is the worked example: the
    old bucketing opened a session $14.45 from the session mean.

    Three effects, in this order, in one transaction:
      1. `def_rev` := new_rev
      2. `last_value` := NULL          — a rev-1 number may never be a rev-2 `prev`
      3. `rev_migrated_at` := now      — read by `suppress_first_cycle`

    ⚠️ (2) ALONE IS NOT ENOUGH, AND THAT IS THE WHOLE REASON (3) EXISTS. With
    `last_value` NULL the cross_* branches return False — but `above`/`below` do
    not read `prev` at all, so an `above` alert fires immediately on the new
    number. Suppression covers the cycle; the reset covers the crossings.
    """
```

```python
def suppress_first_cycle(alert):
    """True while this alert's first post-migration cycle has not yet elapsed.

    ⚠️ ONE CYCLE, NOT ONE MINUTE. Keyed on `last_evaluated_at > rev_migrated_at`,
    so a symbol whose bars arrive late is suppressed for its OWN first cycle
    rather than for a wall-clock window it may sleep through entirely.
    """
```

Notification rides `watchlist_alert_service.deliver_alert_payload` with `source="indicator_alert_migration"` — the same bell + email + Discord pipeline, no new transport. Spec §6 state 10 says a version-migrated notice is *"toast/inbox, never chip state"*, and AlertBell **is** the inbox.

- [ ] **Step 4: Drive it on VWAP rev 1 → 2, for real**

```python
def test_a_stored_alert_pinned_at_vwap_rev_1_migrates_and_the_numbers_MOVE():
    """The path the VWAP record says has no population — given one.

    The two series really differ: on the extended-hours fixture the UTC-day
    anchor opens a session at 93.9178 where the ET anchor reads 108.3633, and 207
    of 579 bars differ by more than $0.01. So this is not a synthetic rev bump; it
    is the real one, with the real gap, driven through the real migration.
    """
```

- [ ] **Step 5: Gate**

**The measurement:** for an alert straddling the rev-1/rev-2 value gap — **zero** deliveries on the migration cycle, **one** on the next qualifying cycle, one migration notification, `last_value` NULL in between.
**The non-measurement assertion:** an alert on an address whose rev did **not** change is untouched — `last_value`, `def_rev` and `last_evaluated_at` all unchanged, asserted field by field. A migration that resets everything is easy and wrong.

| id | mutation | must go red because |
|---|---|---|
| **M1** | delete the suppression, keep the reset | the `above`/`below` fire on the new number — ⚠️ **the crossing half stays green**, which is exactly why the test must include a non-crossing condition |
| **M2** | delete the reset, keep the suppression | one cycle later, `prev` is still the rev-1 number and the crossing is fabricated late |
| **M3** | suppression keyed on wall-clock instead of the alert's own cycle | a thin ticker sleeps through the window |
| **M4** | `notify=None` accepted silently | "never silently switched" |
| **M5** | migrate every alert regardless of address | the blast radius |

- [ ] **Step 6: Control audit + commit**

```bash
grep -rn "compute.rev\|rev: 2\|eternal pinning\|force-migrate" api/ app/src docs/ tests/ | grep -v node_modules
```
`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md` §9f says *"its §5 consequences have no population to act on today"* — **true when written, false now.** Append a dated line; do not rewrite history.

```bash
git add api/services/alert_rev_migration.py api/services/indicator_alert_service.py \
        api/services/indicator_alert_evaluator.py app/src/components/chart/engine/nativeRegistry.js \
        tests/test_alert_rev_migration.py docs/decisions/2026-08-02-vwap-utc-day-bucketing.md
git commit -m "feat(alerts): a compute.rev bump migrates, notifies, resets -- and eats its first cycle"
```

---

# Task 8: THE CUTOVER — `ALERT_EVAL_MODE = 'closed'`

**Files:**
- Modify: `api/services/indicator_alert_evaluator.py` (**one constant**)
- Modify: `docs/decisions/2026-08-06-closed-bar-alert-cutover.md` (Status → ACCEPTED)
- Modify: `tests/test_alert_closed_bar.py` (the rail flips)

**Interfaces:** none new.

**SOLO. This is the only task in the phase permitted to change when an existing alert fires.**

- [ ] **Step 1: Put the number to the owner, before the flip**

Task 6 produced the diff. Task 8 prices it and asks. The record's §5 must carry:

- **total fires per lane** over the frozen fixtures and over the shadow sessions;
- **gained / lost per address**, each with its declared reason;
- the **`above`/`below` cadence change** stated as a count (*"an `above` alert that held for a whole session delivered N times and will now deliver M"*) — the one a user is most likely to notice and least likely to have expected;
- the **worst-case latency per TF**: closed-bar evaluation at a 60-second cycle means a 5m alert can arrive up to 60s after its bar closes. Spec §8 requires this *stated in the UI*; Task 11 puts it there, and this record is where the number is fixed.

⛔ **Do not put a decision to the owner about a cutover whose shadow run has not completed three sessions.** B5's controller had to make this exact ruling when Flip C was priced against a build that rendered a blank chart: *"fix it, re-measure honestly, THEN price it."*

- [ ] **Step 2: Flip the constant**

```python
ALERT_EVAL_MODE = "closed"
```

**One edit, its own commit.** The MACD-head-mask / VWAP-anchor precedent: a behaviour change the owner decided gets a commit that contains the decision and nothing else, so it is revertible in one edit and attributable in one line of `git log`.

- [ ] **Step 3: Flip the rail, both directions**

`enumerationSites.test.js`'s biconditional rail is the shape to copy: *the record's header says OPEN ⟺ the code still reads the old mode.* It must fire **both** ways — flipping the mode without resolving the record, **and** resolving the record without flipping the mode.

```python
def test_the_record_and_the_code_agree_about_which_bar_is_judged():
    """A BICONDITIONAL, anchored on the record's own `**Status:**` HEADER LINE.

    ⛔ NOT a whole-file regex. B4's review measured that: flip the header to
    RESOLVED, append any second `**Status:** … OPEN` line anywhere in the file,
    and a whole-file `test` goes GREEN. The header line is isolated AND COUNTED.
    """
    status = _status_header_line(RECORD)
    assert _status_lines(RECORD) == 1
    resolved = "ACCEPTED" in status
    assert resolved == (eval_mode() == "closed"), (
        "the record and the evaluator disagree about which bar is judged"
    )
```

- [ ] **Step 4: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -k "alert or indicator"
python tools/alert_replay.py --repaint --k 1 2 4 8    # reads the SHIPPED mode now: MUST be 0
python tools/alert_replay.py --check                  # the FORMING log must still reproduce under --mode forming
```

**The measurement:** repaint disagreement **0** at the shipped mode, and the declared diff **exactly** as Task 6 declared — a difference that appears only now is a difference the shadow run should have shown, and it blocks.
**The non-measurement assertion:** the diff of this commit touches **exactly one line of shipped source** (`git show --stat`), and `git diff HEAD~1 -- api/ app/ | grep '^[+-]' | grep -v '^[+-][+-]'` is that one line. B5's cutover was one constant for exactly this reason: on cutover day exactly one commit is in the frame.

| id | mutation | must go red because |
|---|---|---|
| **M1** | flip the mode back with the record ACCEPTED | the biconditional's second direction — **the one a `stillOpen: true` probe could not catch** (B5 Task 1's M7) |
| **M2** | record ACCEPTED, mode `forming` | first direction |
| **M3** | a second `**Status:**` line appended, header RESOLVED | the isolated-and-counted anchor |
| **M4** | `eval_mode()` hardcoded `"closed"`, constant left `"forming"` | a tombstone that reports the flip as done — B5's M8, which a raw probe read as `true` and would have stayed green forever |

- [ ] **Step 5: Commit — two commits, and only two**

```bash
git add api/services/indicator_alert_evaluator.py
git commit -m "feat(alerts): the evaluator judges the CLOSED bar"
git add docs/decisions/2026-08-06-closed-bar-alert-cutover.md tests/test_alert_closed_bar.py
git commit -m "docs(alerts): closed-bar cutover ACCEPTED, with the fire diff it was priced on"
```

---

# Task 9: The ledger door — alert-lane fires become ledger-grade

**Files:**
- Modify: `api/services/indicator_alert_evaluator.py`
- Modify: `api/services/signature/ledger.py` (**one new guard; no schema change**)
- Create: `tests/test_alert_ledger_admission.py`

**Interfaces:**
- Produces: `admit_alert_fire(alert, value, bar_index, bars) -> bool`.

**SOLO.**

🔴 **The constraint carried since B1 is closed here and nowhere earlier.**

- [ ] **Step 1: Write the failing census**

```python
def test_only_the_sanctioned_callers_write_the_signal_ledger():
    """⛔ `toEqual` ON THE DERIVED CALLER SET, NEVER `toContain`.

    `controlDoorCensus.test.js` found door seven's THIRD site on its first run —
    a site no ledger walk and no discovery scan could see, because a reset names
    no indicator. A `toContain` cannot find a caller nobody thought of.
    """
    callers = _grep_callers("ledger.record_signal", root="api")
    assert callers == {
        "api/routers/signature.py",                     # the FCB request path
        "api/services/signature/sweep.py",              # the nightly sweep
        "api/services/indicator_alert_evaluator.py",    # NEW, and gated below
    }


def test_the_alert_lane_CANNOT_write_the_ledger_while_the_mode_is_forming():
    with _mode("forming"):
        with pytest.raises(RuntimeError, match="forming-bar fires are not ledger-grade"):
            admit_alert_fire(any_alert(), 71.2, bar_index=5, bars=BARS)
```

- [ ] **Step 2: Run and watch both fail**

- [ ] **Step 3: Implement the door**

```python
def admit_alert_fire(alert, value, bar_index, bars):
    """Record an alert-lane fire in the Signature ledger — or REFUSE, loudly.

    ⛔ THE REFUSAL IS A RAISE, NOT A RETURN. `record_signal` already returns False
    for exactly one thing — "already recorded" — and its own docstring says a
    dropped write reported as a duplicate is *"the one lie fire-once cannot
    survive"*. A refusal that returned False would be that lie.

    Three conditions, ALL required:
      1. `eval_mode() == "closed"`
      2. `bar_index` is a CLOSED bar of this alert's tf as of now
      3. `bar_index < len(bars) - 1`, or the bar is closed by the clock

    ⚠️ AND THE LEDGER'S KEY VOCABULARY IS NOT NEGOTIABLE. `tf` is the PRODUCT
    label ("1D"), never the bars-store key ("D") — ten rows of real history are
    already keyed that way and the store has no rewrite path.
    """
```

- [ ] **Step 4: Gate**

**The measurement:** with the mode `closed`, an armed alert firing on a closed bar produces exactly one ledger row per `(indicator, version, sym, tf, bar_time, direction)`; re-running the cycle produces **zero** new rows (`record_signal` returns False = already recorded).
**The non-measurement assertion:** the ten pre-existing rows are **byte-identical** after a full cycle — read out, compared field by field. The store is append-only and has no rewrite path; a change here is unreconstructable.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `admit_alert_fire` called with the mode `forming` | the constraint, restored |
| **M2** | refusal returns `False` instead of raising | "already recorded" becomes ambiguous |
| **M3** | census relaxed to `toContain` | an unsanctioned caller |
| **M4** | `tf` written as `"D"` | the key vocabulary — 10 rows orphan |
| **M5** | `indicator` written as the plot address (`"rsi.rsi"`) rather than the sanctioned name | ditto; and it is the subtler one, because it looks *more* correct |

- [ ] **Step 5: Control audit + commit**

```bash
grep -rn "ledger\|record_signal\|not ledger-grade\|closed-bar" api/ tests/ docs/ --include=*.py --include=*.md
```
Every comment saying *"these fires remain NOT ledger-grade"* / *"nothing here may feed the Signature receipts ledger"* is now **conditionally** false. Rewrite each to name the gate rather than assert the absence — an absence stops being a control the moment it stops being true.

```bash
git add api/services/indicator_alert_evaluator.py api/services/signature/ledger.py \
        tests/test_alert_ledger_admission.py
git commit -m "feat(alerts): the ledger door opens, and it has a lock"
```

---

# Task 10: Alerts name the INSTANCE, and `INDICATOR_FUNCS` retires

**Files:**
- Modify: `api/services/alert_series.py`, `api/services/indicator_alert_evaluator.py`, `api/services/indicator_alert_service.py`, `api/routers/indicator_alerts.py`
- Modify: `app/src/components/chart/IndicatorAlertPopover.jsx`, `app/src/hooks/useIndicatorAlerts.js`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (**T1's file — this is its second and last writer**)
- Modify: `tests/test_indicator_alert_evaluator.py`

**Interfaces:**
- Produces: `alert_catalog()` entries carry `instances: [{instanceId, label, inputs}]`; alert rows carry `instance_id`; addresses derive from `nativeRegistry`'s definitions + event keys rather than a hand-written dict.

**SOLO.**

Spec §8: *"instance named in alert rows ('RSI(7) crossed 70' vs 'RSI(14)'); threshold prefilled from current value."* That is the requirement that finally retires the hand-written dict — an address that names a *definition* cannot distinguish two instances of it.

- [ ] **Step 1: Write the failing test**

```python
def test_two_instances_of_one_definition_are_two_different_alerts():
    """RSI(7) and RSI(14) are not the same alert and never were. The old lane
    stored `params_json` on the ALERT, so the alert and the chart could disagree
    about the period with nothing to notice.
    """
    a7 = create(instance_id="rsi-7", indicator="rsi.rsi", condition="cross_above", threshold=70)
    a14 = create(instance_id="rsi-14", indicator="rsi.rsi", condition="cross_above", threshold=70)
    v7, _, _ = _evaluate_one_closed(get(a7), BARS, now_epoch=T)
    v14, _, _ = _evaluate_one_closed(get(a14), BARS, now_epoch=T)
    assert v7 != v14


def test_an_alert_whose_instance_was_DELETED_goes_to_needs_attention_not_silent():
    """Spec §6's deletion guard, from the other side: an orphaned binding is
    visible, never silently dead. `params_json` is retained as the fallback so the
    alert keeps evaluating while it asks to be re-pointed.
    """
```

- [ ] **Step 2: Run, fail, implement**

The address table is **derived**: `listDefinitions()` → for each definition, its data plot keys and its event keys → `<defId>.<key>`. The eight legacy bare spellings are preserved by an explicit alias map, which is small, closed, and asserted complete against the 5,040-row baseline's `indicators` list.

```python
# ⭐ `INDICATOR_FUNCS` RETIRES HERE, AND ITS SUCCESSOR IS A DERIVATION.
#
# ⚠️ THE LEGACY EIGHT ARE NOT DERIVABLE AND MUST NOT BE. `price_vs_ma` has NO
# DEFINITION AT ALL — it is a spread (close − MA) this lane synthesises — and
# `williams_r` here is `williamsR` there. Mapping one vocabulary onto the other
# would be a lookup that lies for two of the eight. So the alias map is written
# down, it is CLOSED, and its completeness is asserted against the recorded
# baseline's own `indicators` list rather than against the live dict.
```

- [ ] **Step 3: Retire the ledger row**

```js
  // ⭐ PHASE C — RETIRED. `INDICATOR_FUNCS` is gone; the address table derives
  // from `listDefinitions()` plus a closed eight-entry legacy alias map.
```
`SITE_COUNT` 7 → 6, partition `{C: 1, keep: 5}`. **Verify the retirement BY IDENTITY** — the anchor `'INDICATOR_FUNCS: dict[str,'` must now match **zero** times, re-run under the same regex that demanded exactly one (the `RETIRED_BY_*` pattern: a control that stops looking is a control that rots).

⚠️ **The Python discovery scan will now find `indicator_alert_evaluator.py` under four ids or not at all.** Whichever it is, it is a *measurement*: re-run the scan and record the found-set. If the file drops off, the row is gone and the count is right; if it stays, say which four ids and why.

- [ ] **Step 4: Gate**

**The measurement:** `tools/alert_replay.py --check` still reproduces the fire log; the derived address set **equals** the retired dict's 28 keys, asserted as a sorted list.

⚠️ **The ledger and the B5 progress note both say "25 addresses in 14 groups". The dict holds 28 in 14 groups** — measured (`len(INDICATOR_FUNCS) == 28`). Assert **28**, and correct the two prose sites in the same commit.

**The non-measurement assertion:** the *dropdown order* is unchanged — insertion order has been the dropdown's order since B4 Task 9 and is pinned. A derivation walks the registry, which is **not** the retired dict's order, so the alias map carries the order explicitly and `test_catalog_order_is_the_dropdown_order_and_it_did_not_change` must pass **without being edited**.

| id | mutation | must go red because |
|---|---|---|
| **M1** | derive `price_vs_ma` from a definition | it has none; the lookup would lie |
| **M2** | drop the alias map, use registry ids directly | `williams_r` → `williamsR` breaks every stored row |
| **M3** | derived order used verbatim | the dropdown moves under every user |
| **M4** | `instance_id` ignored, `params_json` always preferred | RSI(7) and RSI(14) collapse |
| **M5** | orphaned instance evaluates silently | spec §8's needs-attention |

- [ ] **Step 5: Control audit + commit**

Every test naming `INDICATOR_FUNCS` by identity loses its subject. **Move each down a level** rather than deleting: the totality claims become claims about the *derivation* (every definition's data plots and events are addressable; every address resolves to a column), with `price_vs_ma` — the one address with no definition — as the permanent non-vacuity subject that can never expire.

```bash
git commit -m "refactor(alerts): an alert names an INSTANCE, and the hand-written dict retires"
```

---

# Task 11: The fired log, the needs-attention state, re-arm/snooze, and price alerts

**Files:**
- Create: `api/services/alert_fired_log.py`
- Modify: `api/services/indicator_alert_service.py`, `api/services/indicator_alert_evaluator.py`, `api/routers/indicator_alerts.py`
- Modify: `app/src/components/chart/IndicatorAlertPopover.jsx`, `app/src/hooks/useIndicatorAlerts.js`
- Create: `tests/test_alert_fired_log.py`
- Modify: `app/src/components/chart/IndicatorAlertPopover.test.jsx`

**Interfaces:**
- Produces: `record_fire(...) -> bool`; `list_fires(user_id, limit) -> list[dict]`; alert `state ∈ {armed, snoozed, needs_attention, error}`; `GET /api/indicator-alerts/fired`, `POST /api/indicator-alerts/{id}/snooze`.

**Runs in parallel with Task 12 and Task 13.** Owns the popover; T12 must not touch it.

- [ ] **Step 1: Write the failing tests**

```python
def test_a_compute_that_RAISES_puts_the_alert_in_needs_attention_not_silence():
    """⭐ THE tzdata CASE, MADE VISIBLE.

    `compute_vwap` RAISES rather than falling back to UTC when tzdata is missing —
    deliberate, and correct: a silent UTC fallback is the retired
    VWAP_SESSION_ANCHOR defect, measured at $14.45 at a session open. But the
    evaluator wraps every compute in try/except and logs, so on such a box EVERY
    VWAP ALERT GOES SILENT and no surface says so.

    The raise is preserved. The silence is not.
    """
    with _no_tzdata():
        _run_one_cycle()
    a = get(vwap_alert_id)
    assert a["state"] == "needs_attention"
    assert "tz database" in a["state_detail"]


def test_a_fire_is_recorded_once_per_bar_even_if_the_cycle_runs_five_times():
    """Fire-once is keyed on the BAR, which is only expressible now that
    `_evaluate_one_closed` returns `bar_index`.
    """
```

- [ ] **Step 2: Run, fail, implement**

`alert_fired_log.py` is modelled on `signature/ledger.py` — same family, deliberately: append-only, WAL, a UNIQUE key that makes recording idempotent, validation **before** anything touches the database, every refusal a `ValueError`, and `False` meaning **exactly one thing**.

```python
"""Append-only fired-alert history.

Invariants (enforced HERE, not in callers — `signature/ledger.py` precedent):
- INSERT-only; there is no UPDATE path in this module
- UNIQUE(alert_id, bar_time) — a cycle that runs five times over one bar records
  ONE fire. This is expressible only because `_evaluate_one_closed` returns
  `bar_index`; the forming lane could not have had this key.
- False means EXACTLY ONE thing: already recorded. A dropped write reported as a
  duplicate is the one lie a history cannot survive.
"""
```

**Price alerts ride the same lane**, not a second one: a price alert is `{"kind": "close"}` as the left operand — the grammar Task 3 already built. ⚠️ `watchlist_alerts` already exists and delivers price alerts through `check_alerts_against_prices` on the 15-second live-price poll. **Do not duplicate it.** The chart-side price alert is the *indicator* lane's operand, evaluated closed-bar on the alert's own TF, and the popover says which is which — two products with the same name is how a user ends up with two alerts and one notification.

**Latency in the UI:** spec §8 requires per-TF worst-case latency stated. The number is fixed by Task 8's record: cycle interval + TF boundary. Render it beside the TF picker.

- [ ] **Step 3: Gate**

**The measurement:** one fired-log row per (alert, bar) across five cycles over one bar; `needs_attention` set with the raising exception's own message; the snooze window honoured to the cycle.
**The non-measurement assertion:** `deliver_alert_payload` is called **exactly once** per recorded fire — asserted with a spy on the delivery function, not on the log. A history that records twice and delivers once is a reporting bug; a history that records once and delivers twice is the failure that reaches the user.

| id | mutation | must go red because |
|---|---|---|
| **M1** | fired-log UNIQUE key drops `bar_time` | five cycles, five emails |
| **M2** | the `except Exception` swallows without setting `state` | the tzdata silence, restored |
| **M3** | `record_fire` returns `False` on a NOT NULL failure | the dropped-write lie |
| **M4** | snooze compares wall-clock instead of the alert's own cycle | Task 7's M3 shape, same trap |
| **M5** | price alerts routed to `watchlist_alert_service.create_alert` | two products, one name |

- [ ] **Step 4: Control audit + commit**

`useIndicatorAlerts.js`'s header already warns that a comment enumerating indicators is a twin. Verify it still holds. `IndicatorAlertPopover.jsx`'s *"⛔ THERE IS NO FALLBACK LIST"* argument is load-bearing and must survive every edit here — a fallback only shows when the fetch fails, i.e. exactly when nobody is looking.

```bash
git commit -m "feat(alerts): a fired log, a needs-attention state, snooze -- and VWAP stops failing quietly"
```

---

# Task 12: Per-chart alert sets + templates

**Files:**
- Create: `app/src/components/chart/engine/alertSets.js`
- Modify: `app/src/components/chart/engine/instances.js`, `instanceControls.js`, `chartDefaults.js`
- Modify: `api/services/indicator_alert_service.py` (a `scope` column), `api/routers/indicator_alerts.py`
- Create: `app/src/components/chart/engine/__tests__/alertSets.test.js`

**Interfaces:**
- Produces: `scope` on the instance shape and on the alert row; `alertSetFor(chartId, alerts)`; `applyAlertTemplate(template, chartId)`.

**Runs in parallel with Tasks 11 and 13.** Must not touch `IndicatorAlertPopover.jsx` (T11) or `nativeRegistry.js` (T13).

Spec §5: *"`scope` (chartId) present from day one as data; global default at cutover, per-chart + templates flips on in Phase C."* **It is not present** — B5 shipped the instance shape as `{instanceId, defId, defVersion, inputs, placement, hidden}` with no `scope` anywhere. So this is an addition, not a flip.

- [ ] **Step 1: Write the failing test**

```js
  it('a scoped instance is invisible to a chart that is not its scope', () => {
    const cs = withInstances(base, [
      { instanceId: 'rsi-global', defId: 'rsi', inputs: {} },
      { instanceId: 'rsi-chart-2', defId: 'rsi', inputs: { period: 7 }, scope: 'chart-2' },
    ])
    expect(instancesForChart(cs, 'chart-1').map(i => i.instanceId)).toEqual(['rsi-global'])
    expect(instancesForChart(cs, 'chart-2').map(i => i.instanceId))
      .toEqual(['rsi-global', 'rsi-chart-2'])
  })

  it('an instance with NO scope is global, and that is not the same as scope null', () => {
    // ⚠️ `merge()` SKIPS `undefined` and `JSON.stringify` DROPS IT. An absent
    // `scope` and an explicit `scope: undefined` serialize IDENTICALLY, so
    // "unscoped" must be tested through a real JSON round-trip, not an object
    // literal. B5 Task 4 shipped a half-deletion that every output-reading test
    // passed for exactly this reason.
  })
```

- [ ] **Step 2: Run, fail, implement**

Field order in the emitted instance is `instanceId, defId, defVersion?, inputs, placement?, hidden` — **append `scope` last** so a stored blob's key order is unchanged for every instance that has none, and `SHIPPED_STACK_ORDER` sorting is untouched.

`mergeSettingsOverride` merges `indicatorInstances` **by `instanceId`** — verify a scoped instance survives that merge, because the multi-chart grid's `settingsOverride` path is the main consumer.

- [ ] **Step 3: Gate**

**The measurement:** a real stored July-era blob (`flipBStoredBlobs`' 25 strings) round-trips with **zero** scope keys added and **zero** instances lost; a scoped instance survives `mergeSettingsOverride` and a save→load cycle.
**The non-measurement assertion:** ⚠️ **`mergeChartSettings` is on every chart's path.** Run the parity gate: **0 changed pixels, 46 live cases, 5/5, both build identities named.** Adding a key to the instance shape must move nothing on the canvas, and this is the one task in the block where a pixel number is genuinely available.

| id | mutation | must go red because |
|---|---|---|
| **M1** | absent `scope` treated as `'global'` string | an absent key and a string are different; the blob grows for every existing user |
| **M2** | `scope` emitted before `hidden` | key order moves in every stored blob |
| **M3** | `instancesForChart` returns all instances | the whole feature |
| **M4** | `scope` added to `mergeChartSettings`' allow-list at the wrong level | the allow-list is a hard allow-list at BOTH levels |
| **M5** | template application replaces the instance array wholesale | `mergeSettingsOverride` merges by id; wholesale replacement loses concurrent adds (spec §5's R4 concurrency rule) |

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(chart): alert sets are per-chart, and templates apply by instance id"
```

---

# Task 13: The Signature indicators become registry definitions on a generic server lane

**Files:**
- Create: `api/services/signature/registry_defs.py`
- Modify: `api/routers/signature.py`, `api/services/signature/rules.py`
- Create: `app/src/components/chart/engine/serverCompute.js`
- Modify: `app/src/components/chart/engine/nativeRegistry.js`, `defSchema.js`
- Modify: `app/src/hooks/useSignatureIndicators.js`
- Modify: `tests/test_signature_rules.py`, `tests/test_signature_router.py`

**Interfaces:**
- Produces: `compute.kind: 'server'` resolved through `serverCompute.fetchColumns(defId, sym, tf, inputs)`; three definitions (`uct-darkpool-levels`, `uct-gex-walls`, `uct-flow-breakout`).

**Runs in parallel with Tasks 11 and 12. SOLO relative to Task 14** (both write `RAW_DEFS`, and insertion order is z-order).

- [ ] **Step 1: Write the failing tests**

```python
def test_the_ledger_key_vocabulary_is_UNCHANGED_by_genericization():
    """🔴 THE ONE THING THIS TASK MAY NOT DO.

    Ten rows of real history are keyed `(indicator='fcb', version='fcb-v2',
    tf='1D', …)`. `ledger.py` is INSERT-only — there is no rewrite path, so a
    re-key orphans history that cannot be reconstructed. The definition may be
    called `uct-flow-breakout` on the chart; what it WRITES stays 'fcb'/'1D'.
    """
    assert LEDGER_INDICATOR_FOR["uct-flow-breakout"] == "fcb"
    assert LEDGER_TF_FOR["1D"] == "1D"


def test_the_owner_spec_gate_covers_the_DPC_constants_too():
    """`test_all_constants_match_owner_spec` pins 12 constants and DPC's four
    (`DPC_LOOKBACK`, `DPC_PROX_PCT`, `DPC_HOLD_MIN`, `DPC_FLOW_WINDOW`) are
    OUTSIDE it. `VERSIONS` was re-armed for `dpc-v1` at `0daea8b5`; the constants
    were not. Moving DPC's numbers into a definition without widening the gate
    means the next drift is unflagged.
    """
```

- [ ] **Step 2: Run, fail, implement**

The generic server lane is the deliverable, not three definitions wearing a new coat:

```js
/** `compute.kind: 'server'` — columns fetched, not computed.
 *
 *  ⭐ THE LANE IS GENERIC AND TASK 14's RS LINE IS THE PROOF. Three definitions
 *  that each know their own endpoint is not a lane; it is the hardcoding spec §10
 *  said was "acceptable at launch, genericize in C". A lane is generic when a
 *  fourth tenant needs no code in it.
 *
 *  ⚠️ WIRE FORMAT: JSON arrays with `null` ⇄ NaN mapped AT THIS BOUNDARY (spec
 *  §4). Compute never emits point objects; the binder converts NaN to LWC
 *  whitespace. Base64 Float64 buffers are a later optimisation, not v1.
 *
 *  ⚠️ PREMIUM STAYS GATED BY HANDLER IDENTITY. Every signature route declares
 *  `Depends(require_paid)` individually — there is no router-level dependency, and
 *  `test_a_free_user_is_refused_on_every_route` exists because a gate applied to
 *  two of three routes passes any single-route test. A registry definition must
 *  not become a way to reach the data without the handler.
 */
```

⚠️ **`sweep.py` imports `_flow_base_url` and `_fetch_bars` FROM `api.routers.signature`.** Moving or renaming either breaks the nightly job **silently** — the sweep is the only ledger writer that runs unattended. Assert the import in a test before touching the router.

- [ ] **Step 3: Gate**

**The measurement:** the three Signature indicators render **identically** through the registry lane — parity gate, **0 changed pixels**, both build identities named, served==disk on both bases. New parity cases (`signature_dpl_only`, `signature_gex_only`, `signature_fcb_only`) added to `tools/chart_parity_cases.json` **with an `expect` and a `regions` block**, and each fail-proofed before being trusted.

⚠️ **`tools/chart_parity_cases.json` is a `keep` ledger row** and its anchor is `"cases"`. Adding cases is what a `keep` row is for; re-run the ledger test.

**The non-measurement assertion:** the ledger's ten existing rows are byte-identical after a full sweep, and `run_sweep`'s receipt is `{recorded: 0, errors: 0, stale: 0}` on already-recorded data — the idempotency proven on real data on 2026-08-03.

| id | mutation | must go red because |
|---|---|---|
| **M1** | write `indicator="uct-flow-breakout"` to the ledger | history orphans, unreconstructably |
| **M2** | drop `Depends(require_paid)` from one of five routes | the per-handler gate |
| **M3** | server columns emitted as `[{time, value}]` | the wire contract; compute never emits point objects |
| **M4** | `sweep.py`'s import repointed at a moved symbol | the unattended writer, silently |
| **M5** | DPC constants left outside the owner-spec gate | the drift that was already red once |

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(signature): three hardcoded endpoints become three definitions on one server lane"
```

---

# Task 14: AVWAP · ATR bands · RS line

**Files:**
- Modify: `app/src/components/chart/indicators.js`, `app/src/components/chart/engine/nativeRegistry.js`
- Modify: `api/services/indicator_compute.py`
- Create: `tests/fixtures/indicators/avwap_session.json`, `atr_bands_14_2.json`, `rs_line_spy.json`
- Modify: `tests/test_indicator_golden.py`, `app/src/components/chart/goldenFixtures.test.js`
- Modify: `tools/chart_parity_cases.json`

**Interfaces:**
- Produces: definitions `avwap`, `atrBands`, `rsLine`; computes on both lanes at rel-tol 1e-9 (AVWAP, ATR bands) and `compute.kind: 'server'` (RS line, on Task 13's lane).

**SOLO relative to Task 13.**

- [ ] **Step 1: Write the failing golden fixtures — BOTH lanes read each**

Per A3: AVWAP's anchor is an **`enum`** (`session | week | month | quarter | year | swingHigh | swingLow`), never a `time`; RS line's benchmark is an **`enum`** and its compute is **server**.

```python
def test_avwap_resets_on_the_ANCHOR_and_the_anchor_is_an_ET_SESSION():
    """⚠️ SAME TRAP AS `VWAP_SESSION_ANCHOR`, ONE PHASE LATER.

    A UTC-day anchor is correct for regular hours and wipes mid-session on
    extended hours; on Monday evening it never resets Tuesday at all. AVWAP MUST
    resolve its boundary per bar from `America/New_York` — never from a
    module-load `_ET_OFFSET` constant, which is an hour wrong for half the year
    depending on when the page loaded (`StockChart.jsx:517`).

    The fixture is `vwap_extended_hours_utc_midnight.json`'s bars, reused, so the
    two anchors are provably measured against one series.
    """
```

- [ ] **Step 2: Run, fail, implement**

ATR bands = a `band` plot (already in `PLOT_STYLES`) on `placement.target: 'price'`, `$multiplier` float input, upper/middle/lower columns.

- [ ] **Step 3: Gate**

**The measurement:** all three fixtures green in **both** lanes at rel-tol 1e-9; parity gate at **0 changed pixels for the 46 existing cases** (three new definitions must move nothing that already ships), plus three new cases with an `expect` each, each fail-proofed by a **period/step perturbation** — not a colour.

⚠️ **The fail-proof must be measured before it is relied on.** B5 Task 5 found the obvious period probe **vacuous** for ATR — ATR(14) == ATR(21) at the last bar to the last bit, and only the NaN head moves — and B5 Task 8 found `period` on OBV exiting 1 **for the wrong reason** (the instance was dropped and the series vanished). Read *why* each probe killed.

**The non-measurement assertion — and it is the one the parent named:**

🔴 **THE OBV AXIS-WIDTH FINDING, VERIFIED NOT INHERITED.** LWC shares **one** price-axis column across panes, and OBV's wider labels cost **82,498 px** where every other indicator's sub-choices cost 2,540–5,316. So: **measure the axis-label width of every new pane definition before it ships.** RS line reads ~0.9–1.1 (narrower than price) and ATR bands ride the price scale, so the expectation is that neither triggers it — **but the expectation is not the gate.** Add `axisLabelWidthPx` to the pane manifest and assert it unchanged for the existing 46 cases. A definition whose labels widen the shared column re-fits every plot on the chart, and the pixel count will not tell you why.

| id | mutation | must go red because |
|---|---|---|
| **M1** | AVWAP anchors on the UTC day | the retired defect, one phase later |
| **M2** | AVWAP's anchor declared as `type: 'time'` | `RESERVED_INPUT_TYPES` fails closed — verify the refusal message names the type |
| **M3** | ATR bands' `$multiplier` written as a literal | `$<inputKey>` substitution is valid in `color`, `width`, `levels`, `lineStyle`; a multiplier is none of those, so it must be an **input read by the compute**, and this mutation proves which |
| **M4** | RS line implemented as a native reading only `bars` | it needs a second symbol; a native cannot have one, and a silent single-symbol RS line is a line that is always 1.0 |
| **M5** | `axisLabelWidthPx` dropped from the manifest | the OBV finding goes back to being invisible |

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(chart): AVWAP, ATR bands and an RS line on the server lane"
```

---

# Task 15: The whole-phase gate

**Files:**
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (**third and last writer**)
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (§2 roadmap row, §5 ledger prose, §8, §11)
- Modify: `docs/runbooks/alert-replay-gate.md`
- Create: `.superpowers/sdd/2026-08-06-phase-c-alerts/progress.md` entries

- [ ] **Step 1: The ledger, per site, read individually**

`SITE_COUNT` and the partition, with **every row dumped and read one at a time**. The partition is a **histogram**: moving one site between fates fails it, but **swapping two fates preserves every count and passes**. Only the sorted `file::region → fate` literal refuses a permutation, and it must be **regenerated from `LEDGER`**, never edited by hand.

Expected end state `{C: 1, keep: 5}` — `INDICATOR_FUNCS` retired at Task 10, `_INDICATOR_ALIASES` still `C`.

⚠️ **Then decide `_INDICATOR_ALIASES` explicitly.** It is the voice `add_chart_indicator` phrase map: seven natural-language phrases → five ids, including `avwap` and `ma50`/`ma200` **which are not definitions at all**. Task 14 ships an `avwap` definition, so at least one entry becomes derivable. **Either retire the derivable half and re-fate the row `keep` with the irreducible half named, or leave it `C` and say why C did not do it.** A fate describing a condition that has arrived is a control that rots green — B5 Task 13 deleted two `phase` rows for exactly this.

⚠️ Also correct the ledger's own comment claiming the map contains `"parabolic sar" → sar`. **It does not.** A comment describing a literal that is not there is the cheapest kind of rot and it is sitting in the file whose job is to prevent it.

- [ ] **Step 2: The invariants, each MEASURED, not asserted from memory**

Write a throwaway suite, run it green, record the numbers, then delete it — every claim below is also held by a suite that stays.

- repaint disagreement **0** at the shipped mode, k ∈ {1,2,4,8}, all four fixtures
- the forming fire log still reproduces under `--mode forming`
- every declared diff entry occurred, or is recorded as unmet
- `signature_signals`' pre-existing rows byte-identical; alert-lane rows present and fire-once
- both golden lanes green at 1e-9; **no fixture reseeded** (`git diff --stat origin/master -- tests/fixtures/indicators/` shows only ADDED files)
- `mergeChartSettings` still a hard allow-list at both levels; `mergeSettingsOverride` still passes primitives through
- series still POOLED and REUSED (#2049); `merge()` still skips `undefined`
- ⚠️ **`JSON.stringify` DROPS `undefined`** — any fixture asserting an absent key must round-trip through real JSON, or it is vacuous (B5 Task 12 shipped exactly that fixture and caught it)

- [ ] **Step 3: The parity number**

```bash
python tools/chart_parity.py --base-a $A --base-b $B --repeat 5 --dist-a .parity-dist-a --dist-b .parity-dist-b
```
All 46 pre-existing cases at their recorded `expect`, plus the six new ones. **Both build identities named.** `--tolerance` is forbidden; `--expect` is an equality on every run, so **variance is itself a failure**.

⚠️ **State what the zero does NOT cover, where it cannot read as a pass:** the parity route mounts no alert popover, arms nothing, presses no key and runs no evaluator. **A total regression of the entire alert lane would report 0 changed pixels.** The runbook gets a §6-style table naming, per deliverable, which suite is the real gate.

- [ ] **Step 4: Spec reconciliation**

Update §2's roadmap row for C to what shipped; strike the retired ledger prose in §5; record in §11 the four adjudications above (A1 `sar`, A2 the Python scan, A3 the reserved input types, A4 the delivery wrappers) with their basis. **Do not restate any count the ledger test asserts** — a copy of a test's expectation in a doc is a control that rots green, and this spec has been the site of that exact rot twice.

- [ ] **Step 5: Final gauntlet + counts**

```bash
python tools/phase_c_gauntlet.py
cd app && npx vitest run
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q
```
Record the counts. **Read every exit code without a pipe** — `| tail` reported `EXIT=0` over a real failure on this branch, and `rc=$?` after a pipeline assignment read `sed`'s status.

- [ ] **Step 6: Commit**

```bash
git commit -m "docs(alerts): Phase C closes -- the ledger, the invariants, and what the zero does not cover"
```

---

## Self-review

**Spec coverage.** §8's clauses map as: closed-bar rebuild → T5/T8 · `prev` from the computed series → T5 · `last_value` demoted to delivery-dedup → T5/T11 · *"one fixture feeds a forming bar and FAILS if a cross fires"* → T2 Step 6 and T5 Step 1, both directions · every plot auto-alertable → T10 · named events pinned with human labels → T4/T10 · instance named in alert rows → T10 · threshold prefilled from current value → T10 · price alerts → T11 · push/Discord delivery → T11 (existing `deliver_alert_payload`; **no new transport**, closing spec §13's open item) · fired-alert history in the ledger's table family → T11 · re-arm/snooze → T11 · per-TF worst-case latency stated in UI → T8 record + T11 · orphaned bindings visible → T10/T11 · ledger admission → T9. §2's row: version policy → T7 · AVWAP/ATR bands/RS line → T14 · per-chart sets + templates → T12 · Signature genericized → T13. §9's gates: shared golden fixtures both lanes → T4/T14 · lazy Python porting *each landing with its fixture* → T4/T14 · error isolation → T11 · perf → the ≤60 series / ≤8 panes caps are unchanged by C.

**Deliberately NOT in this plan, and why:** `volumeProfile`'s `compute.kind: 'primitive'` lane (`CARVED_OUT_INDICATOR_KEYS` says "C/D") — it is a *rendering* lane for a canvas overlay, it shares no mechanism with anything C builds, and folding it in would put an unrelated pixel risk inside the cutover's frame. It goes to D beside `zones`/`bgband`. Retiring the delivery-rounding wrappers — A4. The `symbol`/`time` input types — A3.

---

## Contradictions found between the spec, the ledgers and the decision records

Each with the call taken and why.

1. **`docs/decisions/` holds FIVE records, not six.** The brief says six. Measured: `git ls-files docs/decisions/` returns five `.md` files (macd-head-mask, vwap-utc-day-bucketing, engine-enabled-settings-migration, engine-enabled-deleted, flip-c-pane-geometry) plus an `assets/` directory of twelve PNGs. **Call:** five, all read. C's own record makes six.

2. **"25 addresses in 14 groups" vs a dict of 28.** The B5 ledger (line 253) and the evaluator's own B5 comment block both say 25. Measured: `len(INDICATOR_FUNCS) == 28`, `len(alert_catalog()) == 14`. The 8 legacy + 6 same-base + 14 new-base = 28. **Call:** 28. Task 10 asserts 28 and corrects both prose sites; a plan that carried 25 forward would have written an assertion that fails on its first run for the wrong reason.

3. **`test_all_constants_match_owner_spec` is described as RED ON MASTER; it is GREEN, and was repaired before C started.** The brief and the memory index both flag it as real drift needing an owner call. Measured: `0daea8b5` ("acknowledge dpc-v1 in the owner-spec gate, re-arming it") is in `origin/master`, HEAD is an ancestor of `origin/master`, and `git diff origin/master -- tests/test_signature_rules.py` is empty. **Call:** not an owner call, not a C blocker. **But the repair is partial and that IS a live gap:** `VERSIONS` was re-armed, and DPC's four constants (`DPC_LOOKBACK`, `DPC_PROX_PCT`, `DPC_HOLD_MIN`, `DPC_FLOW_WINDOW`) are still outside the `expected` dict. Task 13 widens it, because that is the task that moves DPC's numbers.

4. **Spec §2 ships AVWAP and RS line in C; spec §3.1 reserves the `time` and `symbol` input types they appear to need.** `defSchema.js` fails closed on both. **Call (A3):** the anchor and the benchmark are `enum` inputs; RS line is `compute.kind: 'server'` on Task 13's lane. The reserved types stay reserved and the schema needs no v2. The alternative — unreserving two input types inside an alerts phase — would put a schema change with no UI spec and no consumer inside the frame of a cutover.

5. **`_SAR_IS_NOT_OFFERED` refuses `sar` *because* the relational primitive is Phase C's; the ledger then carries that refusal forward as if it were permanent.** **Call (A1):** C builds the primitive, so the deferral expires. The refusal that survives is narrower and truer — no *fixed-threshold* address — and the prose survives beside it. The prose-assertion test is retired into a successor, not deleted.

6. **B4 Task 1 recorded that "the two Cs collide": `paneMargins.PANES` "retires at Flip C" (the B5 cutover) vs fate letter `C` (this phase).** Both are now history — PANES retired at B5 Task 12 — but the collision note survives in the ledger. **Call:** harmless today, and Task 15 removes it while reading the rows individually. Named here so nobody re-derives it as a live ambiguity.

7. **The ledger's `_INDICATOR_ALIASES` comment claims the map contains `"parabolic sar" → sar`. It does not.** The real map is seven phrases → `vwap`, `avwap`, `ma50`, `ma200`, `bb`, `macd`, `rsi`. **Call:** corrected at Task 15, in the file whose entire job is to stop a comment from outliving its subject.

8. **Two carries from the B5 ledger are already closed and would have been planned around needlessly.** The webfont race (`--font-retries` now defaults to **0** because the axis font is self-hosted, fix `a475f5a5`) and the `serve_stale.py` "not yet deployed" note in spec §10. **Call:** both verified closed against the tree; no task budgets for either. The OBV axis-width finding is the one that is genuinely still open, and Task 14 carries it as a manifest field rather than as a memory.

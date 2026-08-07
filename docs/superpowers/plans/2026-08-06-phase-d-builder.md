# UCT Phase D — Builder + AI Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user author their own indicator — by form, by formula, or by asking in English — as a schema-v1 definition on a new `compute.kind: 'ast'` lane, with the repaint badge assigned by a **machine linter** instead of a hand-written default, and with arbitrary user input reaching a compute path for the first time behind a **closed table** that is proven closed.

**Architecture:** Four movements, in this order and no other. **(1) Build the instrument first.** A cross-lane conformance harness and a frozen conformance log over a committed AST corpus, recorded before an interpreter exists, plus a *reachability census* that is the D-phase analogue of C's repaint oracle. **(2) One parser, one table, two interpreters.** `jsep` parses **once, in the browser, at author time**; the **AST is the persisted artifact**; Python never parses, it walks the same tree. The callable vocabulary is declared in ONE manifest that both lanes read, with a totality rail per lane. **(3) The linter, and what it says about what already ships.** The repaint linter runs over the 17 shipped definitions on its first run — that is a measurement, and a disagreement with a shipped badge is a finding for the owner, never a badge edit. **(4) Then the doors** — registration, read-back, persistence, the builder, alert admission, the concierge — with the one irreversible thing (a user-authored formula reaching a path that can send a notification) landing alone and late.

**Tech Stack:** React 19 + Vite 7, vitest 4 (`cd app && npx vitest run <paths>` — **never** `npm test -- run`), lightweight-charts **5.2.0** (pinned exact), **jsep** (new dependency, Task 3), Python 3.12 + FastAPI + APScheduler + SQLite (WAL), pytest, Playwright + Pillow via `tools/chart_parity.py`, Anthropic via `api/services/engine._get_anthropic_client()`.

**Branch:** cut from `origin/master` at the Phase C completion merge. Working dir `C:\Users\Patrick\uct-worktrees\phase-b2-engine`, currently `feat/phase-c-alerts` at `4c825903`. **Do not push** without an explicit owner "ship it" ([[feedback_explicit_ship_gate]]). The market-hours deploy window (`.git/hooks/pre-push`, Mon–Fri 9:15a–4:20p ET) applies to every eventual ship.

**Baseline, to be re-measured and recorded by Task 1 before anything changes.** The numbers below were measured while writing this plan, on `4c825903`. **Task 1 measures them again and every later task compares against Task 1's numbers, never these.** This programme has corrected a prose count seven times (7→16→20→21→22→32 enumeration sites; "25 alert addresses" when the dict held 28; "31 addresses / 14 groups" when the catalog holds 31 across **16**).

```bash
cd app && npx vitest run                                       # measured 5,645 / 1 (Calendar.realModal, see §11 of C's record)
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest \
    tests/test_indicator_compute.py tests/test_indicator_golden.py -q
PYTHONDONTWRITEBYTECODE=1 python -m pytest -k signature -q
python tools/alert_replay.py --check                           # the literal FIRE LOG MATCHES, exit 0
python tools/alert_replay.py --diff --mode-a forming --mode-b closed   # EVERY DIFFERENCE IS DECLARED, 31/31
```

**Measured facts this plan is built on** (each verified against the tree, not quoted):

| fact | measured value |
|---|---|
| `listDefinitions()` | **17** — 16 `NATIVE_DEFS` + 1 `SERVER_DEFS` (`rsLine`) |
| definition ids | `rsi macd bb vwap stoch atr sar ichimoku mfi cci williamsR adx obv donchian avwap atrBands rsLine` |
| `compute.kind` in the shipped registry | `{native: 16, server: 1}` — **zero `ast`, zero `script`** |
| enumeration ledger | **de-literalled 2026-08-06 by Task 1** — the count and the partition are asserted in `enumerationSites.test.js` (*"holds N live sites…"* + *"every B4 region is retired…"*) and were **not** restated here, because Task 1 moved both and this row went stale the same day it was written. `C` bucket empty. |
| alert addresses | **31**, across **16** catalog groups (28 `INDICATOR_FUNCS` in 14 groups + 2 `EVENT_FUNCS` in `sar` + 1 `PRICE_FUNCS` in `close`) |
| frozen fire log | **per-block digests against a stored frozen artifact** — the gate is `--check` printing the literal `FIRE LOG MATCHES` at **exit 0**, and it has never been a total. ⛔ The `685,193` this row used to carry was a sum over an **8-block / 4-fixture** corpus (chart-ux-walls Task 7); the corpus grew across C and D and the figure was stale from the day it was written here. Measured 2026-08-07: **22 blocks over 11 fixtures (ks=[1,4])**, and `685,193` appears nowhere in the output |
| golden fixtures | **22** files in `tests/fixtures/indicators/`, read by **both** lanes at `relTol` 1e-9 |
| parity cases | **50** total — **46 live**, 4 `placeholder` (`volume_profile_only`, `avwap_session_only`, `atr_bands_only`, `rs_line_spy_only`) |
| definition id grammar | `ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/` — **no dots**, because plots are addressed `defId.plotKey` |
| `compute.fn` | **required non-empty string for EVERY kind**, including `ast` (`defSchema.validateCompute`) |
| `compute.budget` | reserved; `defSchema` checks only "null or a plain object" |
| `meta.repaint` | **NOT audited — a shared DEFAULT.** `nativeRegistry.js:112` sets `repaint: 'non-repainting'` in one helper and **no native overrides it**; only `rsLine` declares its own |
| `supportedKinds` | **DOES NOT EXIST.** Two prose mentions (`defSchema.js:103`, spec §3.1), zero identifiers |
| frontend deps | **no `jsep`, no parser library of any kind** — D adds the first |
| user-authored content precedent | `charts_layouts` — own SQLite `/data/charts_layouts.db`, `UNIQUE(scope, user_id, name)`, admin-gated global scope |
| `user_preferences` | `auth.db`, columns `user_id / pref_key / pref_value` (TEXT), **no size limit, no DELETE route** |

---

## Global Constraints

Copied verbatim. Every task's requirements implicitly include this section.

**Inherited from Phase C and NOT D's to touch**

- `ALERT_EVAL_MODE` stays `"forming"` until Phase C Task 8 flips it — **that is not D's to touch.** D reads the mode through `eval_mode()`; D never writes the constant, and a task that does is a failure of this plan, not a decision.
- The frozen fire log is **a set of per-block digests**, not a number. `python tools/alert_replay.py --check` must stay **exit 0**, printing the literal `FIRE LOG MATCHES`, at every commit of this phase. ⛔ **Do not carry a total.** Every restatement of one in this plan was stale on arrival — see the `frozen fire log` row in the table above.
- `python tools/alert_replay.py --diff` must report **EVERY DIFFERENCE IS DECLARED** across **31/31** addresses.
- The Signature ledger door (`admit_alert_fire`) has **1 definition, 0 call sites**. **Task 8 of Phase C wires it, not D.** A user-authored signal does not enter `signature_signals` in this phase under any circumstance (spec §12: marketplace/user publishing is out of scope until the ledger can hold publishers accountable).
- lightweight-charts pinned **exact at 5.2.0**; `merge()` skips `undefined`, so **a complete key set is the only reset mechanism**; only series TYPE is immutable — `priceScaleId` and pane are mutable.
- **Series are POOLED and REUSED, never destroyed and recreated** (lightweight-charts #2049 is OPEN).
- **`autoScale:false` computes nothing** — it stops re-computation; the range materialises the first time something *asks*. This is the mechanism behind B5's 11,913-px ADX regression.
- **No rounding inside compute — ever.** Delivery wrappers round (`compute_*` round, `compute_*_raw` precise); both live consumers of the alert lane read the **rounded** form.
- **Never seed a default shaped like a fetch result**; **never cache a failed fetch as a value.**
- **`mergeChartSettings` is a hard allow-list** — the key set of its `const out = {…}` literal IS the mechanism, and a key absent from it is **destroyed on every read**. `mergeSettingsOverride` (in `instanceShape.js`) passes primitives through untouched.

**D-specific, non-negotiable**

- 🔴 **THE TABLE IS CLOSED AND CLOSED IS PROVEN, NOT ASSERTED.** The interpreter dispatches on a vocabulary declared in ONE manifest read by both lanes. `MemberExpression` is **refused outright** — no property access reaches the interpreter, so `constructor` / `__proto__` / prototype walking are unreachable by construction rather than by blocklist. Identifier lookup goes through `Object.prototype.hasOwnProperty.call(scope, name)` on an `Object.create(null)` scope, never `scope[name]`.
- 🔴 **A LINTER THAT MIS-ASSIGNS `non-repainting` TO A REPAINTING FORMULA IS THE WORST DEFECT THIS PLATFORM CAN SHIP.** The whole brand position is *receipts, aimed at burned-vendor customers* (§10). So the linter's gate is not "it passes on our formulas" — it is a **corpus of formulas that MUST be branded repainting**, each one hand-derived, each one a positive control, and the corpus's own non-vacuity asserted (a corpus where every case is clean measures nothing).
- 🔴 **ONE PARSER.** `jsep` runs in the browser only. The **AST is the persisted artifact**; the source text is kept for editing and read-back and a rail asserts `parse(source)` deep-equals the stored `ast`. A second parser is a second grammar and it drifts silently.
- 🔴 **ONLY ONE TASK MAY LET A USER-AUTHORED FORMULA REACH A PATH THAT CAN SEND A NOTIFICATION.** That is Task 12. B5 let only ONE commit move a pixel; C let only ONE task change when an alert fires; D lets only ONE task admit a user formula to the alert lane.
- 🔴 **THE CONCIERGE MAY NOT WRITE THE READ-BACK.** The sentence a user confirms is generated **deterministically from the AST**, by the same function the builder uses. A model-written summary of a model-written formula is two guesses agreeing.
- **Tier: everything is paid.** Owner ruling 2026-08-06: *"everything is paid, almost nothing is accessible for free."* Every D route declares its own `Depends(require_paid)` **per handler**, and the coverage test is **derived from `router.routes` with the count asserted** — a hand-listed path set let two paid Signature endpoints ride uncovered (C Task 13's finding).
- **`enumerationSites.test.js` has EXACTLY ONE WRITER AT A TIME, for the whole phase.** Task 1 writes it; Task 8 writes it; Task 15 writes it. Every other task that changes the count **reports its delta and does not apply it.**

**Rigor these tasks inherit, EARNED — do not re-derive them**

- **`expect` is an equality on every run.** Variance is itself a failure. `--tolerance` is **forbidden**.
- **Every zero needs a positive control.** A case that *cannot* report a difference must **REFUSE, not return 0** — `rs_line_spy_only` raises `PaneLayoutAlertError` rather than reporting a vacuous zero, and that is the shape.
- **Mutation discipline:** CONTROL A unmutated (**abort on a zero passed count**) + CONTROL B filtered with a **non-zero** passed count; `passed=None` is ambiguous between "the filter selected nothing" and "everything selected failed" — **disambiguate with `collected > 0`**; check **why** each kill happened via `must_reach`; make refusal messages **disjoint** (two gates sharing a phrase made `pytest.raises(match=…)` match with the safety deleted).
- **Verify structure with an AST, never a grep.** A grep counts comments and strings and did both directions this phase — `git grep -c admit_alert_fire` says 3 and all three are prose.
- **Derive identifiers from the system, never type them.** Four false alarms in one session came from typed table/field/route names ([[lesson_probe_names_must_be_derived_not_typed]]).
- **Do not restate in a doc a count that a test asserts.** That copy rots green; this spec has suffered it twice and it happened again in real time during C (four doc sites citing 691,195 after the re-freeze).

**Process**

- Frontend: `cd app && npx vitest run <paths>`. **NEVER `npm test -- run`.**
- pytest: `PYTHONDONTWRITEBYTECODE=1` on **every** run (a same-size mutation within one second imports the previous mutation's `.pyc`).
- `git commit -m "…" -- <explicit paths>` (pathspec form), **never `git add` then a bare `git commit`** — two agents share one git index. And that is **necessary, not sufficient**: pathspec commits the WORKING TREE at that path, so also run `git diff --stat HEAD -- <path>` and **read the hunks** before committing. A new *untracked* file needs a single-file `git add` first — `git commit -- <path>` refuses one.
- Derive every do-not-touch list from `git status --porcelain` immediately before dispatch, **never from this plan** — the ownership list went stale three times in Phase C.

**Environment traps — named here so no implementer rediscovers them**

- **CRLF makes multi-line `\n` anchors match ZERO.** Six Phase C tasks hit it. A refusal to match must be loud, never reported as a survivor.
- **A python patch script on this repo must read and write BYTES**, or it silently converts a whole file CRLF→LF (2,638 lines, once, invisibly — git normalised the commit so the diff still looked right while the working tree no longer matched a checkout).
- **cp1252 kills a harness's own stdout.** `sys.stdout.reconfigure(encoding='utf-8')` first; `…` maps and `⛔` does not. It killed `--help` once. It also killed a `json.load(open(...))` while this plan was being written — **`io.open(..., encoding='utf-8')`, always.**
- **`write_text` truncated `chart_parity_cases.json` to 0 bytes** via lone surrogates. Restore with `git show HEAD:<path>` → `write_bytes` + sha256 — **NOT `git checkout --`**, which does not restore bytes under `core.autocrlf`.
- **`--pool=threads` reports "no tests" with 425 errors**, which reads like a pass.
- **`liveStyles.dist.test.js` reads `app/dist/assets/*.css` and FAILS ON A STALE BUILD.** `npm run build` before trusting a full FE run. It cost one false red.
- **An exit code is lost through a pipe.** `| tail` reported `EXIT=0` over a real failure; `rc=$?` after a pipeline read `sed`'s status. **Read every exit code bare.**
- **Git-Bash `/tmp` ≠ Python `/tmp`.**
- **A source rail that slices by LINE NUMBER is unsafe in a multi-agent tree.** `inspect.getsource` returned the wrong slice mid-run because a co-worker inserted ~180 lines above the target. Re-parse the `FunctionDef` **BY NAME**.
- **`JSON.stringify` DROPS `undefined`** — a fixture asserting an absent key must round-trip through real JSON or it is vacuous.
- **`vitest` prints `Test Files N passed` BEFORE `Tests M passed`** — a control that reads the first number under-reads its own baseline and can bless anything.
- **CPython folds equal module-level constants, so `is` returns True** between two separately-written identical literals. An identity assertion between constants is vacuous; read the AST.

---

## What replaces "0 changed pixels" — read this before Task 1

Phase B's gate was pixels. Phase C's output was a notification and it built a fire log and a repaint oracle. **Phase D's output is a formula the user wrote, and neither instrument covers it.**

**And the pixel gate is structurally blinder here than it was in C.** `tools/chart_parity.py` renders committed cases through `?fixedbars=`; **a user-authored definition exists in no committed base at all**, so it cannot have an A/B `expect` — the three definitions Task 14 of Phase C added are *still* `placeholder` cases for exactly this reason, measured `--same-build` with a perturbation fail-proof rather than against a base that never had them. A total regression of everything in this plan would report **0 changed pixels on all 46 live cases**, and would do so honestly.

So D names four measurables, each independently failable, each with its own killer.

### Part 1 — THE CONFORMANCE LOG. Two lanes, one number, an equality.

`tools/ast_conformance.py` (Task 2) walks a **committed corpus of ASTs** over the **frozen `intraday5m` bars** — the same 579-bar series `tools/chart_parity.py` renders through `?fixedbars=` and the same series the golden VWAP fixture computes against, so the compute oracle, the pixel gate and the AST conformance log are provably one series — and records, for every (ast_id × bar_index):

```
(ast_id, bar_index, repr(js_value), repr(py_value))
```

The gate is **exact equality between the lanes at rel-tol 1e-9**, per fixture, per bar. Recorded as a per-ast sha256 over the exact ordered rows with the values **inside the hashed text**, so a changed number still changes the digest (the 42-MB lesson from C Task 2).

**The corpus's own non-vacuity is a gate, not a hope:** every entry of the closed table must appear in at least one corpus AST, **derived from the manifest**, and an entry with no corpus coverage aborts the recorder. Hand-listing what a corpus covers is how DPC's four constants rode unpinned for the rule's entire life.

### Part 2 — THE REACHABILITY CENSUS. The part with no analogue in B or C.

**Arbitrary user input reaches a compute path for the first time.** The claim "the table is closed" is exactly the shape of claim that has been vacuous twenty distinct ways on this branch, so it is not asserted — it is measured, from three directions that can each fail alone:

1. **A structural census by AST**, over `interpret.js` and `ast_interpret.py`: the set of node types either interpreter dispatches on, and the set of names it can resolve, derived from the interpreter's own source tree — **not a grep**, because a grep counts comments and did so in both directions this phase.
2. **An escape corpus** of ASTs that MUST be refused: `constructor`, `__proto__`, `this`, `a.b`, `f()()`, `[1,2][0]`, `x=1`, a 10,000-node tree, a 1e6 lookback, a name that is a `Object.prototype` member (`toString`, `valueOf`, `hasOwnProperty`). **Every one asserted to raise, with a DISJOINT message**, and the corpus asserted non-empty and each case asserted to *parse* first — a case the parser rejects proves nothing about the interpreter.
3. **The positive control that makes the zero mean something:** the same corpus, run through an interpreter with the guard deleted, must produce a **non-zero** escape count. A census that reports "nothing escapes" against an interpreter with no guard is a gate that cannot fail.

### Part 3 — THE REPAINT LINTER'S POSITIVE CONTROL, AND WHAT IT SAYS ABOUT TODAY.

**A formula repaints iff its output at bar `i` depends on any bar `j > i`.** That is decidable on an AST, which is the whole reason spec §11 defers the machine linter to D: *"No static analysis of hand-written JS; don't build throwaway introspection."*

The linter's gate is a **corpus of formulas that must be branded repainting** — `close[-1]` (a forward reference), `highest(high, 5)` centred, a future-offset series read — each hand-derived, each with the reason written down.

🔴 **And the linter has a real day-one subject already in the shipped registry, measured while writing this plan.** `ichimoku`'s `chikou` column writes **bar `i`'s close to index `i - 26`** — deliberately, in both lanes, documented as a preserved quirk, and pinned by `TRAILING_PAD = {("ichimoku_9_26_52", "chikou"): 26}` in `tests/test_indicator_golden.py`. So the plotted point at a historical index **moves while the newest bar forms**. A linter asking "does column[i] depend on bar[j>i]" answers **yes**. And `ichimoku` wears `repaint: 'non-repainting'` — not from an audit, but from the shared default at `nativeRegistry.js:112` that **no native overrides**.

**That disagreement is a FINDING FOR THE OWNER, not a badge edit** (Task 7, Step 6). `ichimoku` is live in the catalog today; changing a repaint badge on a shipped indicator is a brand decision, and this plan has no authority to take it. What the plan does take is the position that **the linter is not permitted to carve an exemption for a UCT-authored indicator** — an exemption is precisely the hand-audited metadata the machine linter exists to replace.

### Part 4 — THE ADMISSION CENSUS, extended.

C made the Signature ledger's honesty a control instead of an absence. D adds one door and keeps it shut:

- a **caller census** over the alert lane's partition tables — `toEqual` on the derived set, never `toContain` — asserting that a fourth partition (`USER_FUNCS`, Task 12) exists and that **`INDICATOR_FUNCS` did not grow**, because `build_alert_grid` generates the frozen replay grid from `INDICATOR_FUNCS` and **growing it destroys the instrument** (C Task 4 measured this and put events in a separate `EVENT_FUNCS` for exactly that reason);
- a **behavioural refusal** that RAISES: `admit_alert_fire` refuses a fire whose definition's `compute.kind` is `ast`, with a message disjoint from every other refusal in the file;
- and the mutation that must turn it red: admit a user-definition fire while the mode is `'closed'`.

### What each part costs you if you get it wrong

| you get wrong | what ships | which part catches it |
|---|---|---|
| the two interpreters disagree at the 8th decimal | a user's alert fires on the server and not on their chart, forever, and nothing says so | Part 1 (per-ast digest equality) |
| one node type escapes the table | a formula reaches `constructor` from a text box on a live surface | Part 2 (escape corpus + the deleted-guard control) |
| the linter brands a repainting formula clean | the receipts brand is dead, and it is dead for a reason a customer can demonstrate | Part 3 (the must-repaint corpus) |
| a user formula's fire enters `signature_signals` | the receipts are poisoned and cannot be un-poisoned | Part 4 |
| the concierge emits a plausible wrong formula | a user trades on maths nobody wrote | Task 13's read-back-from-AST + the round-trip refusal |

**And a warning stated where it cannot read as a pass:** the parity route mounts no builder, opens no concierge, runs no interpreter and registers no `ast` definition. **A total regression of every user-visible thing in this plan would report 0 changed pixels.** Only Tasks 8 and 11 put anything on the canvas, and only those tasks owe a pixel number — and both owe it as a `placeholder` measured `--same-build` with a fail-proof, because a definition that exists in no base cannot have an A/B expectation. Task 15 writes the §6-style table naming, per deliverable, which suite is the real gate.

---

## Sequencing against a LIVE surface

Phase B and Phase C are both in production. There is no freeze. The order below is chosen so that **nothing user-reachable lands unproven**, and so that the one irreversible admission lands alone and late.

| Task | dark? | what a user could notice |
|---|---|---|
| 1 Baseline · ledger · decision record | **dark** | nothing — tests and a record |
| 2 Conformance harness + frozen log + escape corpus | **dark** | nothing — `tools/` and `tests/fixtures/` only, no shipped source |
| 3 `jsep` pinned · parse · canonicalise · `astHash` | **dark** | nothing — a parser with no interpreter |
| 4 The closed table + the JS interpreter | **dark** | nothing — not wired into `computeFor` |
| 5 The Python interpreter + the 1e-9 cross-lane gate | **dark** | nothing — no address, no catalog entry |
| 6 Budgets become real + the reachability census | **dark** | nothing — a refusal with no caller |
| 7 The repaint linter + its run over the 17 shipped defs | **dark** | nothing — **it MEASURES, it does not re-badge** |
| 8 `compute.kind: 'ast'` registers · `supportedKinds` | **dark** | nothing — no `ast` definition exists to register yet |
| 9 Sentence read-back | **dark** | nothing — a pure function with no UI |
| 10 Persistence · versioning · the edit force-migration | **dark** | nothing — a store with no writer |
| 11 The builder UI | 🔴 **LIVE** | **users can author an indicator and see it draw.** Owes a pixel number |
| **12 ALERT ADMISSION** | 🔴 **LIVE** | **a user-authored formula can send a notification.** One commit, owner-gated |
| 13 The NL→AST concierge | 🔴 **LIVE** | an English box that writes a formula |
| 14 Tiering · per-handler paid gates · cost caps | 🔴 **LIVE** | the paywall |
| 15 Whole-phase gate | — | — |

**Tasks 1–10 are dark. Task 12 is the only task in the phase permitted to let a user formula reach the alert lane.**

---

## Parallelism — file ownership

⚠️ **Derive every list from `git status --porcelain` immediately before dispatch.** Phase C's ownership lists went stale three times, and one agent held 24 files including two nobody had assigned it.

**Safe in parallel (file-disjoint):**

- **Task 1 ‖ Task 2.** T1 owns `app/src/components/chart/engine/__tests__/enumerationSites.test.js` + the decision record. T2 owns `tools/ast_conformance.py`, `tools/phase_d_gauntlet.py`, `tests/fixtures/ast/**`, `tests/test_ast_conformance.py`. **T1 must not touch `tools/`; T2 must not touch the ledger test.**
- **Task 4 ‖ Task 5** only *after* Task 3 lands, and only because the manifest is committed by then: T4 owns `app/src/components/chart/engine/ast/interpret.js`, T5 owns `api/services/ast_interpret.py`. **Neither may touch `ast/closedTable.json` — Task 3 is its only writer.**
- **Task 9 ‖ Task 10.** T9 owns `app/src/components/chart/engine/ast/sentence.js`. T10 owns `api/services/user_definitions.py` + `api/routers/user_definitions.py`.

**SOLO, and ORDERED:**

- **Task 3** is solo: it adds a dependency, and `package.json` / `package-lock.json` are the one pair no two agents may hold.
- **Tasks 6, 7, 8** all read the interpreter and the linter and write `defSchema.js` / `nativeRegistry.js`. One writer at a time, in number order.
- **Tasks 11, 12, 13** are solo and ordered. **12 in particular is solo against everything** — it is the only task that may change what can send a notification.
- **`enumerationSites.test.js`: T1, T8, T15 only.**

---

## Controls rot at every flip, and the dangerous ones stay GREEN

~110 controls have rotted across six phases. The ones that go red are safe. The ones that keep passing while their premise dies are the hazard.

**Every task in this plan carries an explicit control-audit step.** The recipe:

```bash
# JS
grep -rn "<subject>" app/src --include=*.js --include=*.jsx | grep -iE "test|spec"
# Python
grep -rn "<subject>" tests/ api/ --include=*.py
```

Then **read each hit's stated REASON, not its assertion**, and either invert it, move it down a level with its own non-vacuity control, or delete it with the reason recorded. **A control whose subject you just changed is guilty until proven innocent.**

Four subjects in this phase are known to be about to lose their premise and are named here so no task discovers them late:

1. **`defSchema.js:103`'s comment** — *"the registry's `supportedKinds` filter decides what a given client will actually run."* **That filter does not exist.** The comment describes a mechanism that has never been written and it is sitting in the file whose job is to fail closed. Task 8 builds the filter and the comment stops being a lie.
2. **`nativeRegistry.js:106`'s comment** — *"Every native is a `native`-lane, non-repainting, free-tier indicator today."* Task 7 measures whether the second clause is true. It is the single most load-bearing sentence in the registry and nothing checks it.
3. **`nativeRegistry.test.js`'s definition-count assertions.** C Task 10 measured 13 files asserting `defs.length === 16` and then the registry moved to 17 mid-phase. D adds `ast` definitions at Task 8 — every count assertion must be re-pointed at a **lane-partitioned** count (`NATIVE_DEFS.length`, `SERVER_DEFS.length`, `AST_DEFS.length`) or it becomes a control that breaks on every future definition for no reason. §A5's finding stands: *"2 definitions cost 33 assertions across 12 files"*, and a registry-size constant read from ONE place would collapse ~20 of them. **Task 8 collapses them; that is part of its deliverable, not a nicety.**
4. **`api/services/signature/registry_defs.py`'s `SCHEMA_VERSION`** — a second schema-version constant, published on `/api/signature/definitions`. Task 8 must assert it equals `defSchema.SCHEMA_VERSION`, because two schema versions that can disagree are a wire contract with two authorities.

---

## Adjudications this plan makes

Recorded so they are not re-litigated mid-execution. Each states the **measurement** it rests on.

### D-A1 — ONE parser, in the browser. The AST is the persisted artifact. Python never parses. ✅

**Measured:** the frontend has **no parser library of any kind**; `jsep` would be the first. Python has no equivalent that produces the same tree, and a hand-ported grammar is a second grammar that drifts silently — which is the exact failure mode `_CASE_COLUMNS` exists to prevent between two vocabularies that *look* the same (`williams_r` vs `williamsR`).

So:

- `jsep` is pinned **exact** (not `^`), matching the `lightweight-charts: "5.2.0"` precedent, and it runs **only in the browser, only at author time**.
- **`compute.ast` is what is stored, versioned, migrated, shipped over the wire and interpreted.** `compute.source` rides alongside for editing and is **never** the input to anything that computes.
- A rail in the JS lane asserts `canonicalise(parse(def.compute.source))` deep-equals `def.compute.ast` for every stored definition. **The two can never disagree without something going red.**
- Python's interpreter is a **tree walker with no parser**. The reachability census (Part 2) is therefore over a tree walker, not a grammar, which is a strictly smaller thing to prove closed.

**The alternative considered and rejected:** run user ASTs server-side only and let the chart fetch columns through the existing `compute.kind: 'server'` lane (`serverCompute.js`, `/api/signature/columns`). Rejected because the builder's entire value is **live preview** — one network round-trip per keystroke — and because it would make a user's own indicator unavailable offline while every UCT native draws. It also fails spec §1: *"Never ship asymmetric capability across surfaces."*

### D-A2 — the 1e-9 contract is on the TABLE, not on each user formula. ✅

The brief's hard question: how is the golden-fixture equality preserved for user-authored formulas that have no committed fixture?

**Answer: the closed table is the unit of the contract.** A user AST is only a composition of table entries, so agreement on **every entry of the table** plus agreement on **every combining rule** (evaluation order, NaN propagation, warmup length, integer division, comparison of NaN) is what makes an arbitrary composition agree. That is provable coverage, and its totality rail is derived **from the manifest**, not hand-listed — the `test_all_constants_match_owner_spec` shape that this repo earned the hard way (DPC's four constants rode unpinned for the rule's entire life because the rail was a LIST, not a rail).

Two consequences, both gates:

- **Task 2's corpus must cover every manifest entry**, and the recorder **aborts** if any entry has zero coverage.
- **Task 12 adds a runtime admission check**, once, at ARM time — not per keystroke: before a user definition may be armed, the server computes its column and the client computes its column on the *actual* bars and they must agree at 1e-9. This converts "no committed fixture" into "no admission without a measured agreement." It costs one comparison per definition per user, ever.

**And `tests/fixtures/indicators/` gains three files, not one per user.** `test_every_fixture_file_is_covered_by_a_test` globs the directory and demands the stem set equal the explicit `CASES` lists, so a per-user fixture is structurally impossible. The three are the table's own conformance cases (Task 5).

### D-A3 — user definitions live in their OWN store, append-only, and an edit is a `compute.rev` bump. ✅

**Measured:** `user_preferences` is `auth.db` with columns `user_id / pref_key / pref_value` (TEXT), **no size limit and no DELETE route**; `mergeChartSettings` is a hard allow-list that **destroys** an unknown top-level key on every read; `charts_layouts` is the shipped precedent for user-authored content and lives in its **own** SQLite file with `UNIQUE(scope, user_id, name)` and an admin gate on global scope.

So:

- **A new table `user_definitions` in its own `/data/user_definitions.db`**, modelled on `charts_layouts`. Three reasons, each measured: (a) the instance list references a definition by `defId`, so a definition must resolve independently of any one chart blob; (b) the alert evaluator needs it server-side and `user_preferences` is not a lane it reads; (c) `mergeChartSettings` would destroy it.
- **Append-only per `(user_id, def_id)`.** Every save writes a new row with an incrementing `version`; instances and alerts pin `defId@version`. That is spec §3.1's rule already — presentation pins are free.
- **`rev` and `version` are DERIVED, not declared.** `version` increments on every save; **`rev` increments iff `astHash` changed**. That removes an entire class of "the user forgot to bump" and is machine-checkable in one assertion.
- **A `rev` bump CALLS Phase C's existing `migrate_bindings_to_rev(address, new_rev, notify=…)` + `suppress_first_cycle(alert)`** — synchronously, at save time, scoped to that user's own bindings. **The machinery is not rebuilt; it is called.** The gate is that C's `test_the_first_cycle_after_a_rev_bump_CANNOT_fire` gains a **second subject** (a user definition) rather than a second implementation. C's record notes that path *"has no population to act on today"*; D gives it one, which is also the first real test of it.

### D-A4 — user definitions ARE alertable in D, through a FOURTH partition, behind an admission gate. The ledger door stays shut. ✅

**Measured:** the alert lane holds **31 addresses across 16 catalog groups** in three partitions — `INDICATOR_FUNCS` (28), `EVENT_FUNCS` (2), `PRICE_FUNCS` (1). `enumerationSites.test.js` asserts 28 / 14 on the derived table as a sorted set **and** an exact sequence. `tools/alert_replay.py`'s `build_alert_grid` generates the frozen grid from `INDICATOR_FUNCS`, and C Task 4 put SAR's events in a separate `EVENT_FUNCS` **specifically because growing that dict would have destroyed the instrument.**

So:

- **Alertable in D.** Deferring it fails spec §1 — a definition that draws but cannot alert is exactly the asymmetric capability the principle forbids, and it is TrendSpider's named failure.
- **Through a fourth partition, `USER_FUNCS`, which `build_alert_grid` does NOT read.** The frozen fire log's **per-block digests**, the 31/31 `--diff`, and the 28/14 assertions therefore stay **byte-identical**, and that invariance is itself Task 12's gate.
- **Behind an admission gate with three conditions, all measured, none assumed:** (i) the repaint linter assigned `non-repainting`, or assigned `preview-repaints` **and** the user explicitly acknowledged; (ii) the arm-time cross-lane 1e-9 check passed **on the actual bars**; (iii) the budget caps hold at the version being armed.
- 🔴 **`admit_alert_fire` refuses an `ast`-lane fire, and the refusal RAISES.** Spec §12 puts user publishing out of scope *"until the ledger can hold publishers accountable"*, and the receipts brand is UCT's own signals. User alerts **deliver**; they do not accrue receipts. One refusal, one positive control, one mutation.

### D-A5 — the concierge emits ASTs only, and never writes the sentence the user confirms. ✅

**Measured:** the codebase already has every piece — a shared client with a 60s default (`engine._get_anthropic_client()`), a structured-JSON call with balanced-brace recovery and a temperature-retry (`catalyst/synthesize.py::_extract_first_json_object`, `_parse_json_response`, `_call_anthropic`), a cost guard with soft/hard caps and an **unknown-model-costs-the-most** rule (`catalyst/cost_guard.py::estimate_cost / may_synthesize / record`), and a never-raises refusal facade (`brain_service._UNAVAILABLE`, `{ok: False, reason: …}` vs `{ok: False, error: …}` kept deliberately distinct). And `grade_ticker` is the worked example of **decisiveness that is structural, not prompted**.

So:

- **The tool schema IS the closed table.** Function names and arities are enumerated in the tool definition generated **from the manifest**, so an out-of-table call is a schema violation at the API boundary, not a runtime surprise.
- **The pipeline is generate → parse → lint → compute → read back**, and the model sees the linter's verdict **before the user does**. `repaints` earns **one** bounded repair attempt with the linter's reason attached; a second `repaints` is a **REFUSAL**: `{ok: False, reason: "<plain English>"}` — never an exception, never a plausible substitute, and never a definition with a `repaints` badge quietly attached.
- **The read-back is deterministic and comes from Task 9**, the same function the builder uses. What a user confirms is what will run.
- Cost-guarded through the exact `cost_guard` surface, with a **per-user daily cap** on top of the global one.

---

## File structure

**Frontend — the AST lane** (a new directory; `nativeRegistry.js` is already 71 KB and `defSchema.js` 66 KB, and neither should grow a parser)

| file | responsibility |
|---|---|
| `app/src/components/chart/engine/ast/closedTable.json` **(new, T3)** | **THE MANIFEST.** The only declaration of what is callable. Read by BOTH lanes. Task 3 is its only writer for the whole phase. |
| `app/src/components/chart/engine/ast/parse.js` **(new, T3)** | `jsep` configuration, `parseFormula`, `canonicalise`, `astHash`. The only module that imports `jsep`. |
| `app/src/components/chart/engine/ast/interpret.js` **(new, T4)** | The JS tree walker. Pure. No registry import, no network, no clock. |
| `app/src/components/chart/engine/ast/budget.js` **(new, T6)** | `checkBudget(ast, budget)` and the runtime op counter. |
| `app/src/components/chart/engine/ast/lint.js` **(new, T7)** | The machine repaint linter. `lintRepaint(ast) -> {mode, reasons}`. |
| `app/src/components/chart/engine/ast/sentence.js` **(new, T9)** | `sentenceFor(def) -> string`. Deterministic read-back. |
| `app/src/components/chart/engine/defSchema.js` **(modify, T8)** | the `ast` branch of `validateCompute`; `compute.budget` stops being reserved. |
| `app/src/components/chart/engine/nativeRegistry.js` **(modify, T8)** | `AST_DEFS`, `computeFor`'s third lane, `supportedKinds`, `REGISTRY_SIZES`. |
| `app/src/components/chart/builder/**` **(new, T11)** | The no-code builder surface. |
| `app/src/components/chart/builder/ConciergeBox.jsx` **(new, T13)** | The English box. |

**Backend**

| file | responsibility |
|---|---|
| `api/services/ast_table.py` **(new, T5)** | The Python half. Binds implementations to names **read from the manifest**, with a totality rail. |
| `api/services/ast_interpret.py` **(new, T5)** | The Python tree walker. Mirrors `interpret.js` node-for-node. |
| `api/services/ast_budget.py` **(new, T6)** | The Python op counter and the refusal. |
| `api/services/user_definitions.py` **(new, T10)** | The store: `/data/user_definitions.db`, append-only, `astHash`-derived `rev`. |
| `api/routers/user_definitions.py` **(new, T10)** | CRUD. Every handler declares its own `Depends(require_paid)`. |
| `api/services/definition_concierge.py` **(new, T13)** | NL→AST. Cost-guarded, bounded repair, refusal. |
| `api/services/alert_user_series.py` **(new, T12)** | `USER_FUNCS` — the fourth partition. **`build_alert_grid` must not read it.** |
| `api/services/indicator_alert_evaluator.py` **(modify, T12 ONLY)** | The fourth partition registered; the ledger-door refusal for `ast`. |

**Tools / fixtures / docs**

| file | responsibility |
|---|---|
| `tools/ast_conformance.py` **(new, T2)** | The cross-lane harness, the frozen log, the escape census. |
| `tools/phase_d_gauntlet.py` **(new, T2)** | The mutation gauntlet, generalized from `tools/phase_c_gauntlet.py`. |
| `tests/fixtures/ast/corpus.json` **(new, T2)** | The committed AST corpus. Every manifest entry covered. |
| `tests/fixtures/ast/conformance_log.json` **(new, T5)** | Per-ast digests. Frozen. |
| `tests/fixtures/ast/escapes.json` **(new, T2)** | The must-refuse corpus. |
| `tests/fixtures/ast/must_repaint.json` **(new, T7)** | The must-be-branded-repainting corpus. |
| `docs/decisions/2026-08-06-machine-repaint-linter.md` **(new, T1; ACCEPTED or REFUSED at T7)** | The owner record the rails read. |
| `docs/runbooks/ast-conformance-gate.md` **(new, T2)** | How to run each gate; what each refusal means. |

---

# Task 1: Baseline, the ledger at nine, and the record the linter's rail will read

**Files:**
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`
- Create: `docs/decisions/2026-08-06-machine-repaint-linter.md`

**Interfaces:**
- Produces: the decision record whose `**Status:**` header line Task 7's biconditional rail reads; a re-measured baseline recorded **by command**.
- Consumes: nothing.

**Must not touch:** `tools/`, `tests/fixtures/`, any `api/` or `app/src` non-test source. No source change belongs in a baseline task.

- [ ] **Step 1: Record the baseline BY COMMAND, into the record**

`.superpowers/` is gitignored, so the numbers go in the repo. Create `docs/decisions/2026-08-06-machine-repaint-linter.md`:

```markdown
# Decision: the repaint badge is assigned by a machine linter, and the linter is not allowed to make an exception for us

**Status:** 🟡 **OPEN — every shipped native wears `non-repainting` from a shared DEFAULT that no native overrides, and one of them writes a forming bar's value to a historical index.**

**Date opened:** 2026-08-06 · **Phase:** D · **Applied:** — · **Record of the measurement:** §3

## 1. The fact

`app/src/components/chart/engine/nativeRegistry.js:112` sets
`meta: { tier: 'free', repaint: 'non-repainting', ...meta }` in one shared helper.
No native definition overrides it; only `rsLine` declares its own. So the badge
spec §3 calls *"Phase A/B: audited metadata (UCT-authored only)"* is, measured, a
DEFAULT — not an audit.

And `api/services/indicator_compute.py`'s `compute_ichimoku_raw` writes bar `i`'s
close to index `i - kijun_period` — deliberately, mirrored in
`app/src/components/chart/indicators.js::computeIchimoku`, documented as a
preserved quirk, and pinned by `TRAILING_PAD = {("ichimoku_9_26_52", "chikou"): 26}`
in `tests/test_indicator_golden.py`. The plotted point at a historical index
therefore moves while the newest bar forms.

Spec §4: *"Bar-close outputs must be reproducible from history alone; anything
that can't be is labeled `repaints`."*

## 2. What this record decides

Whether `ichimoku`'s badge changes, and whether the linter may ever carve an
exemption for a UCT-authored indicator. **Task 7 MEASURES; it does not re-badge.**
```

Then `## 10. Baseline, by command` holding the five commands from the plan header **and the numbers you measure**, not the numbers written above. Then `## 11. Known-red on the inherited tree` — run `app/src/pages/calendar/Calendar.realModal.test.jsx` **both standalone and in the full suite** and record which way it is red today. C recorded the opposite of the truth on two consecutive days; the rule is to run it both ways before calling anything a regression.

- [ ] **Step 2: Write the failing ledger test — the ninth site**

The engine's `ast/` directory does not exist yet, but three files it will create are enumerations in the ledger's sense. Rather than predict, **run the scan and read what it finds**. Append to `enumerationSites.test.js`:

```js
  // ⭐ PHASE D — the scan runs BEFORE the row is written, and the row is written
  // from what it FOUND. Predicting a count and then asserting the prediction is
  // how this branch shipped `{B4:19}` summing to 32.
  it('the closed-table manifest is on the ledger the moment it exists', () => {
    const MANIFEST = path.join(ROOT, 'app/src/components/chart/engine/ast/closedTable.json')
    if (!fs.existsSync(MANIFEST)) return   // Task 3 creates it; this rail arms itself then
    const known = new Set(LEDGER.map(s => s.file))
    expect(known.has('app/src/components/chart/engine/ast/closedTable.json'),
      'the closed table is the single declaration of what a user formula may call. ' +
      'It is an enumeration by definition and it must be on the ledger.',
    ).toBe(true)
  })
```

⚠️ **A rail that `return`s when its subject is absent is a rail that passes vacuously until Task 3.** So pair it, in the same commit, with a rail that cannot:

```js
  it('the ledger names the file that will hold the closed table, and says why', () => {
    const row = LEDGER.find(s => /ast\/closedTable\.json$/.test(s.file))
    expect(row, 'the closed-table row is missing from the ledger').toBeTruthy()
    expect(row.fate).toBe('keep')
  })
```

- [ ] **Step 3: Run it and watch the second one fail**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js -t "closed table"
```
Expected: the first passes vacuously (the file does not exist), the second **FAILS** — no such row.

- [ ] **Step 4: Add the row and move the counts**

```js
  // ⭐ PHASE D — THE CLOSED TABLE. Fate `keep`, and the reason is the same one
  // `_CASE_COLUMNS` carries: a (name, arity, semantics) triple is irreducible.
  // No definition can declare the vocabulary that definitions are written in.
  //
  // ⛔ AND IT IS THE ONE FILE IN THIS PHASE THAT MUST HAVE EXACTLY ONE WRITER.
  // Two lanes read it; a hand-copy in either is a second grammar.
  { file: 'app/src/components/chart/engine/ast/closedTable.json',
    region: 'the closed table — every name a user formula may call',
    anchor: '"functions"', fate: 'keep' },
```

Then `const SITE_COUNT = 9`, `expect(counts).toEqual({ keep: 9 })`, and add the new pair to the sorted `file::region → fate` literal — **regenerated from `LEDGER`, never typed by hand.** The histogram is a histogram: swapping two fates preserves every count and passes there; only the sorted-pair literal refuses a permutation.

⚠️ The anchor `"functions"` will not match until Task 3 writes the file. **That is correct and it is the point** — the ledger goes red the moment Task 3 lands with a differently-shaped manifest, which is what an anchor is for. Record in this task's report that the anchor is **armed but unmatched**, and that Task 3 owes the first match.

- [ ] **Step 5: Gate — the measurement, the non-measurement, and four mutations**

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py -q
python tools/alert_replay.py --check
```
Expected: ledger green; pytest unchanged (this task touches no Python source); `--check` **FIRE LOG MATCHES**.

**The measurement:** `SITE_COUNT`, the partition, the regenerated sorted-pair mapping, and the JS + Python discovery scans' found-sets **printed and recorded**.
**The non-measurement assertion:** both discovery scans' found-sets are **byte-identical before and after this task** — this task adds a row, it does not change what either scan sees. Assert both `found` arrays explicitly.

| id | mutation | must go red because |
|---|---|---|
| **M1** | delete the `fate: 'keep'` row | a manifest off the ledger is the shape that turned seven sites into thirty-two |
| **M2** | re-fate the new row `keep` → `D`, total preserved | only the sorted-pair mapping can see a permutation |
| **M3** | `SITE_COUNT` 9 → 8 with the row kept | the count and the table must agree in both directions |
| **M4** | change the record's `**Status:**` header from OPEN to ACCEPTED | Task 7's rail reads that header; a record resolved with no measurement behind it is the `engine-enabled` trap, which fired **four** times |

- [ ] **Step 6: Control audit**

```bash
grep -rn "SITE_COUNT\|keep: 8\|non-repainting" docs/ app/src --include=*.md --include=*.js --include=*.jsx | grep -v node_modules
```
A doc that quotes a test's expectation is a control that rots green. **De-literal, never re-type.** Check `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §5 in particular — it already says *"read the live count in `enumerationSites.test.js`, never here"*, so it should need no edit; **assert that by reading it, not by assuming it.**

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/2026-08-06-machine-repaint-linter.md
git commit -m "test(engine): the ledger arms a row for the closed table, and the record says the badge is a default" -- \
  app/src/components/chart/engine/__tests__/enumerationSites.test.js \
  docs/decisions/2026-08-06-machine-repaint-linter.md
```

---

# Task 2: The instrument — a cross-lane harness, an AST corpus that covers the table, and an escape census that reads NON-ZERO with the guard removed

**Files:**
- Create: `tools/ast_conformance.py`
- Create: `tools/phase_d_gauntlet.py`
- Create: `tests/fixtures/ast/corpus.json`
- Create: `tests/fixtures/ast/escapes.json`
- Create: `tests/test_ast_conformance.py`
- Create: `docs/runbooks/ast-conformance-gate.md`

**Interfaces:**
- Consumes: `tests/fixtures/alerts/replay_bars.json` (**reads it; does not edit it**) — its frozen `intraday5m` block is the 579-bar series `tools/chart_parity.py` renders through `?fixedbars=` and the series the golden VWAP fixtures compute against.
- Produces: `load_corpus() -> dict`; `ast_digest(ast_id, rows) -> str`; `run_js(cases, bars) -> dict`; `run_py(cases, bars) -> dict`; `escape_census(*, unguarded) -> dict`. The frozen `conformance_log.json` is written by **Task 5**, not here — there is no second lane yet.

**Must not touch:** anything under `api/` or `app/src/`. This task changes **no shipped source**; assert that with a name-only diff.

- [ ] **Step 1: Write the corpus, and make its coverage a gate**

`tests/fixtures/ast/corpus.json`, one case per row, each with the reason it exists. **Write it by hand** — a corpus generated from the thing it measures is not an oracle.

```jsonc
{
  "bars": "tests/fixtures/alerts/replay_bars.json#intraday5m",
  "cases": [
    { "id": "sma_of_close",     "source": "sma(close, 20)",
      "why": "the simplest reduction; covers `sma` and the `close` series identifier" },
    { "id": "nan_propagates",   "source": "sma(close, 20) - sma(close, 200)",
      "why": "the 200-warmup half is NaN for 199 bars and the SUBTRACTION must stay NaN, never 0" },
    { "id": "float_division",   "source": "highest(high, 5) / 2",
      "why": "JS `/` and Python `/` are both float. `//` is in NEITHER table and this pins that it cannot arrive by accident" },
    { "id": "compare_with_nan", "source": "close > sma(close, 200)",
      "why": "a comparison against NaN is false in both languages — the one place they agree by luck, so it is pinned rather than assumed" },
    { "id": "ternary",          "source": "close > open ? high : low",
      "why": "the only branching form in the table" },
    { "id": "deep_nest",        "source": "sma(ema(close, 9) - ema(close, 21), 5)",
      "why": "composition depth: the lanes must agree on evaluation ORDER, not only on each node" },
    { "id": "cross",            "source": "crossOver(ema(close, 9), ema(close, 21))",
      "why": "the {0,1,NaN} event shape spec §3.1 requires, produced by a formula rather than a native" }
  ]
}
```

⚠️ **Every entry of the manifest must appear in at least one case, and that is asserted, not hoped.** The manifest does not exist until Task 3, so this task writes the coverage rail **armed and skipped** — exactly as Task 1 armed the ledger anchor — and Task 3 owes its first pass. Say so in the runbook.

```python
def assert_corpus_covers_the_table(manifest, corpus):
    """⛔ THE FLOOR IS DERIVED FROM THE MANIFEST, NEVER HAND-LISTED.

    DPC's four constants rode outside `test_all_constants_match_owner_spec` for
    the rule's entire life because that rail was a LIST of what somebody
    remembered: `DPC_LOOKBACK 10 -> 999` left the file `5 passed rc=0`. A coverage
    claim derived from its own subject cannot rot that way.
    """
    declared = set(manifest["functions"]) | set(manifest["operators"]) | set(manifest["series"])
    used = set()
    for case in corpus["cases"]:
        used |= names_in(case["ast"])
    missing = sorted(declared - used)
    assert not missing, (
        f"{len(missing)} table entries have NO corpus coverage: {missing}. The "
        "conformance log pins nothing about them, so the two lanes may already "
        "disagree on them and every gate would stay green."
    )
```

- [ ] **Step 2: Write the escape corpus**

`tests/fixtures/ast/escapes.json` — every case MUST be refused, each with its reason and **a DISJOINT expected message fragment**. Two gates sharing a refusal phrase let `pytest.raises(match=…)` match with the safety deleted (C Task 9's M1, the 19th vacuous gate on this branch).

```jsonc
{ "cases": [
  { "id": "member_access",     "source": "close.constructor",  "refuse": "property access is not in the table" },
  { "id": "proto_walk",        "source": "close.__proto__",    "refuse": "property access is not in the table" },
  { "id": "this_expr",         "source": "this",               "refuse": "`this` names nothing this table can resolve" },
  { "id": "call_of_a_call",    "source": "sma(close, 20)(1)",  "refuse": "only a bare table name may be called" },
  { "id": "array_literal",     "source": "[1, 2][0]",          "refuse": "array literals have no meaning in a column formula" },
  { "id": "assignment",        "source": "x = 1",              "refuse": "a formula produces a column; it does not bind a name" },
  { "id": "prototype_name",    "source": "toString",           "refuse": "unknown name" },
  { "id": "own_property_name", "source": "hasOwnProperty",     "refuse": "unknown name" },
  { "id": "unknown_function",  "source": "rugpull(close, 3)",  "refuse": "unknown function" },
  { "id": "arity_wrong",       "source": "sma(close)",         "refuse": "expects 2 arguments" },
  { "id": "too_many_nodes",    "sourceFrom": "gen:nest(4000)", "refuse": "exceeds the node budget" },
  { "id": "lookback_too_deep", "source": "sma(close, 100000)", "refuse": "exceeds the lookback budget" }
]}
```

⚠️ **Each case must PARSE before it proves anything about the interpreter.** A case the parser rejects says nothing about what the tree walker would have done, and `member_access` is precisely where that distinction bites — jsep parses `a.b` happily. So the census asserts, per case, **parsed OK** *then* **refused at interpret**. A case that fails to parse is reported `PARSER_REFUSED` and **does not count toward the escape total**.

- [ ] **Step 3: Write the harness**

```python
#!/usr/bin/env python3
"""AST conformance — the instrument Phase D measures itself with.

⛔ `--record` IS ONE-SHOT. Its output is COMMITTED and it is the oracle. Re-running
it after a change re-records whatever the code now does and converts a real
regression into a green build — the same trap `tests/fixtures/indicators/_generate.py`,
`tests/fixtures/_gen_alert_baseline.py` and `tools/alert_replay.py` are all written
under.

    python tools/ast_conformance.py --record                 # once, when BOTH lanes exist (Task 5)
    python tools/ast_conformance.py --check                  # the gate
    python tools/ast_conformance.py --escapes                # the reachability census
    python tools/ast_conformance.py --escapes --unguarded    # THE POSITIVE CONTROL

⚠️ stdout is reconfigured to UTF-8 before anything prints. The box default is
cp1252 and it killed a sibling harness's own `--help`.
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
```

The JS lane is driven through **one** subprocess per run — not one per case; seven cases would be seven node boots for no reason:

```python
def run_js(cases, bars):
    """Evaluate every case in ONE node process and read JSON off stdout.

    ⚠️ ARGV AS A LIST, shell=False, and the payload goes in on STDIN — never in a
    `-e` string. A `-t` containing a double quote SPLIT under cmd.exe and selected
    TEN tests on this branch; a single-quoted one selected NOTHING and reported
    `passed=None`. Every case in this corpus is a formula, so every case is exactly
    the input that trap eats.

    ⚠️ The reader is pinned `encoding='utf-8', errors='replace'`.
    """
```

The digest is a per-case sha256 over the exact ordered rows, **with the values inside the hashed text**:

```python
def ast_digest(ast_id, rows) -> str:
    """⚠️ THE VALUE IS INSIDE THE HASHED TEXT, ON PURPOSE.

    C Task 2 wrote a 42 MB raw log and replaced it with per-alert digests for size —
    and the note it wrote is the load-bearing one: a digest that hashed only
    (bar_index, triggered) would report a CHANGED NUMBER as no change at all.
    """
```

- [ ] **Step 4: THE ESCAPE CENSUS — and refuse a zero that has no control**

```python
def escape_census(*, unguarded: bool) -> dict:
    """How many escape-corpus cases reach an evaluation they should not.

    Returns {"parsed": n, "refused": n, "escaped": [ids], "parser_refused": [ids]}.

    🔴 THE VACUITY REFUSAL, AND IT POINTS THE OTHER WAY FROM PHASE C'S.
    C's repaint oracle had to read NON-ZERO on the unmodified tree. This one has to
    read ZERO on the guarded interpreter — so a zero here proves NOTHING on its own,
    and the run ABORTS unless the SAME corpus through the UNGUARDED interpreter
    reads non-zero. A census reporting "nothing escapes" against an interpreter with
    no guard is a gate that cannot fail, and that shape has been vacuous twenty
    distinct ways on this branch.

    ⚠️ AND `parsed` IS PART OF THE VERDICT. A case that never parsed was never
    offered to the interpreter, so counting it as "refused" would let a parser change
    silently empty this census while every number stayed the same.
    """
```

```bash
python tools/ast_conformance.py --escapes --unguarded   # MUST be non-zero
python tools/ast_conformance.py --escapes               # MUST be zero — and only means something after the line above
```

Record **both** numbers in `docs/runbooks/ast-conformance-gate.md`. They are the phase's headline pair, and Task 6 owes the zero.

- [ ] **Step 5: Write `tools/phase_d_gauntlet.py`**

Generalize `tools/phase_c_gauntlet.py` — same CONTROL A (unmutated, ANSI-stripped, **abort on a zero passed count**), same CONTROL B (per-mutation filter, unmutated, **non-zero passed**), same preflight (`count == 1` match + a non-empty byte diff **before** anything runs), verdict from the **exit code**, restore in a `finally` with sha256 asserted in both directions, and the same five-field mutation dict including `must_reach`. Carry forward every hardening note it has and add the four this branch learned after it was written:

```python
# ⚠️ `passed=None` IS AMBIGUOUS between "the filter selected nothing" (abort) and
# "everything selected failed" (a GOOD kill). Disambiguate with `collected > 0`.
#
# ⚠️ NONZERO IS NECESSARY BUT NOT SUFFICIENT. Every mutation declares `must_reach`;
# a kill whose failing test is not that one is reported SUSPECT, never KILLED.
#
# ⚠️ CONTROL A MUST READ THE RIGHT NUMBER. vitest prints `Test Files N passed`
# BEFORE `Tests M passed`; a control reading the first under-reads its own baseline
# and can bless anything (measured: read 1 where the truth was 35).
#
# ⚠️ CRLF MAKES A MULTI-LINE `\n` ANCHOR MATCH ZERO. Six Phase C tasks hit it. A
# zero-match anchor REFUSES LOUDLY; it is never reported as a survivor.
```

- [ ] **Step 6: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_conformance.py -q
python tools/alert_replay.py --check
git diff --name-only HEAD | grep -E '^(api|app)/' && echo "SHIPPED SOURCE CHANGED — refuse" || echo "no shipped source touched"
```

**The measurement:** the escape count guarded vs unguarded (a zero and a non-zero, in that dependency), the corpus size, and the number of manifest entries the coverage rail is **armed but not yet checking**.
**The non-measurement assertion:** the name-only diff touches **no `api/` and no `app/` file** — this task builds an instrument and changes nothing it measures — and `--check` still prints **`FIRE LOG MATCHES`, exit 0**.

| id | mutation | must go red because |
|---|---|---|
| **M1** | count a `PARSER_REFUSED` case as `refused` | a parser change would silently empty the census with every number unmoved |
| **M2** | delete the `--unguarded` control | a zero with no positive control is the vacuity this file exists to refuse |
| **M3** | make two escape cases share a `refuse` fragment | C Task 9 measured `raises(match=…)` matching with the safety deleted |
| **M4** | `assert_corpus_covers_the_table` hand-lists `declared` | a rail built on a list is a list, and that is how DPC drifted |
| **M5** | `ast_digest` hashes `(ast_id, bar_index)` only | a changed number must not read as no change |

- [ ] **Step 7: Commit**

```bash
git add tools/ast_conformance.py tools/phase_d_gauntlet.py tests/fixtures/ast \
        tests/test_ast_conformance.py docs/runbooks/ast-conformance-gate.md
git commit -m "test(ast): the conformance harness, and an escape census that refuses a zero without its control" -- \
  tools/ast_conformance.py tools/phase_d_gauntlet.py tests/fixtures/ast \
  tests/test_ast_conformance.py docs/runbooks/ast-conformance-gate.md
```

---

# Task 3: `jsep` pinned exact, one parser, and the AST as the persisted artifact

**Files:**
- Modify: `app/package.json`, `app/package-lock.json`
- Create: `app/src/components/chart/engine/ast/closedTable.json`
- Create: `app/src/components/chart/engine/ast/parse.js`
- Create: `app/src/components/chart/engine/ast/parse.test.js`

**Interfaces:**
- Produces:
  ```js
  export function parseFormula(source)   // -> {ok:true, ast} | {ok:false, error}
  export function canonicalise(node)     // -> a stable, key-sorted, jsep-INDEPENDENT tree
  export function astHash(ast)           // -> 'sha256:<64 hex>' over canonical JSON
  export const TABLE                     // the imported manifest, frozen
  export const NODE_TYPES = Object.freeze(['num', 'series', 'op', 'call'])
  ```
- Consumes: nothing.

**SOLO.** This task adds a dependency; `package.json` / `package-lock.json` are the one pair no two agents may hold.

- [ ] **Step 1: Write the failing tests**

```js
  it('the AST is jsep-INDEPENDENT after canonicalisation', () => {
    // ⭐ THIS IS THE WHOLE REASON `canonicalise` EXISTS. `compute.ast` is the
    // PERSISTED artifact — it goes into a database, over a wire, and into a Python
    // tree walker that has never heard of jsep. A stored tree carrying jsep's own
    // node shapes would make a jsep upgrade a data migration.
    const { ast } = parseFormula('sma(close, 20)')
    const seen = new Set()
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      for (const k of Object.keys(n)) seen.add(k)
      for (const v of Object.values(n)) Array.isArray(v) ? v.forEach(walk) : walk(v)
    })(ast)
    expect([...seen].sort()).toEqual(['args', 'name', 'type', 'value'])
  })

  it('canonicalisation is STABLE — two parses of the same source hash identically', () => {
    // The hash decides whether an edit bumps `compute.rev` (D-A3), and a rev bump
    // force-migrates every binding, resets `last_value` and suppresses a cycle. An
    // unstable hash would migrate a user's alerts on a save that changed nothing.
    expect(astHash(parseFormula('sma( close ,20 )').ast))
      .toBe(astHash(parseFormula('sma(close, 20)').ast))
  })

  it('a hash is NOT stable across a semantic change', () => {
    // The control. Without it the assertion above is satisfied by `() => "x"`.
    expect(astHash(parseFormula('sma(close, 20)').ast))
      .not.toBe(astHash(parseFormula('sma(close, 21)').ast))
  })

  it('parseFormula RETURNS a failure; it does not throw', () => {
    // ⛔ A throw from a parser reaches the builder as a blank screen. Spec §6's
    // instance-state inventory has ten states and none of them is "the page died";
    // state 4 is a red dot on the chip with the message in the tooltip. And a parse
    // failure is the NORMAL case here, not the exceptional one — the whole surface
    // is a text box a user is mid-way through typing into.
    const res = parseFormula('sma(close,')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/unexpected|expected/i)
  })

  it('jsep is pinned EXACT, like lightweight-charts', () => {
    // `lightweight-charts: "5.2.0"` is pinned exact and B1 recorded why: one
    // renderer under all baselines. The argument is STRONGER here — this parser's
    // output is PERSISTED, so a minor bump is a data migration.
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
    expect(pkg.dependencies.jsep).toMatch(/^\d+\.\d+\.\d+$/)
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd app && npx vitest run src/components/chart/engine/ast/parse.test.js
```
Expected: FAIL — `Cannot find module './parse.js'`.

- [ ] **Step 3: Add the dependency, pinned exact**

```bash
cd app && npm install --save-exact jsep
```

- [ ] **Step 4: Write the manifest — and Task 1's armed anchor owes its first match**

`app/src/components/chart/engine/ast/closedTable.json`. **Data, not code**, so both lanes read one file rather than two hand-copies:

```jsonc
{
  "tableVersion": 1,
  "series": {
    "open":   { "field": "o", "doc": "the bar's open" },
    "high":   { "field": "h", "doc": "the bar's high" },
    "low":    { "field": "l", "doc": "the bar's low" },
    "close":  { "field": "c", "doc": "the bar's close" },
    "volume": { "field": "v", "doc": "the bar's volume" }
  },
  "operators": {
    "+":  {"arity": 2}, "-":  {"arity": 2}, "*": {"arity": 2}, "/": {"arity": 2},
    ">":  {"arity": 2}, "<":  {"arity": 2}, ">=": {"arity": 2}, "<=": {"arity": 2},
    "==": {"arity": 2}, "!=": {"arity": 2},
    "&&": {"arity": 2}, "||": {"arity": 2},
    "u-": {"arity": 1}, "!":  {"arity": 1},
    "?:": {"arity": 3}
  },
  "functions": {
    "sma":        {"args": ["series","int"],    "lookback": "arg1", "sentence": "the {1}-bar average of {0}"},
    "ema":        {"args": ["series","int"],    "lookback": "arg1", "sentence": "the {1}-bar exponential average of {0}"},
    "highest":    {"args": ["series","int"],    "lookback": "arg1", "sentence": "the highest {0} of the last {1} bars"},
    "lowest":     {"args": ["series","int"],    "lookback": "arg1", "sentence": "the lowest {0} of the last {1} bars"},
    "stdev":      {"args": ["series","int"],    "lookback": "arg1", "sentence": "the {1}-bar standard deviation of {0}"},
    "change":     {"args": ["series"],          "lookback": 1,      "sentence": "the bar-over-bar change in {0}"},
    "abs":        {"args": ["series"],          "lookback": 0,      "sentence": "the absolute value of {0}"},
    "min":        {"args": ["series","series"], "lookback": 0,      "sentence": "the smaller of {0} and {1}"},
    "max":        {"args": ["series","series"], "lookback": 0,      "sentence": "the larger of {0} and {1}"},
    "crossOver":  {"args": ["series","series"], "lookback": 1,      "sentence": "{0} crossing above {1}"},
    "crossUnder": {"args": ["series","series"], "lookback": 1,      "sentence": "{0} crossing below {1}"}
  }
}
```

⚠️ **`ref` / `offset` / any backward-index form is DELIBERATELY ABSENT from v1, and that is a decision.** A general `close[n]` turns the repaint linter from a lookback sum into a dataflow analysis, and it makes a *forward* reference expressible in the first place. **The linter must be simple enough to be obviously right on the day it decides the brand's central claim.** Every function above declares its lookback as a constant or a named argument, so `maxLookback(ast)` is a tree sum — which Task 7 depends on. Record this in the runbook as the reason `offset` is a v2 question, and record who it would have to be re-opened by.

⚠️ **`sentence` lives in the manifest** so Task 9's read-back and Task 13's tool schema are derived from the same declaration the interpreter dispatches on. A read-back with its own phrase table is a second vocabulary, and this repo has already measured what two vocabularies cost (`williams_r` vs `williamsR`).

Re-run the ledger — **do not edit it**, Task 1 is its writer until Task 8:

```bash
cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js
```
The `"functions"` anchor must now match **exactly once**. Zero or two matches is this task's finding and **the manifest shape moves, not the ledger**.

- [ ] **Step 5: Write `parse.js`**

```js
import jsep from 'jsep'
import TABLE from './closedTable.json'

// ⛔ EVERY jsep FEATURE THIS TABLE DOES NOT USE IS REMOVED AT CONFIGURE TIME.
// Not blocked at interpret time — REMOVED, so it cannot parse. A blocklist is a
// list of what somebody remembered; removing the operator is the absence itself.
// jsep ships `**`, `%`, `&`, `|`, `^`, `>>>` and a comma operator by default, and
// none of the seven has a meaning in a column formula.
jsep.removeAllBinaryOps()
for (const [op, spec] of Object.entries(TABLE.operators)) {
  if (spec.arity === 2) jsep.addBinaryOp(op, PRECEDENCE[op])
}
jsep.removeAllUnaryOps()
jsep.addUnaryOp('-'); jsep.addUnaryOp('!')
jsep.removeAllLiterals()
jsep.addLiteral('true', true); jsep.addLiteral('false', false)

/** Parse. NEVER throws — returns a tagged result. */
export function parseFormula(source) { /* … */ }

/** jsep's tree → the persisted tree. Four node shapes, and no others.
 *
 *  ⭐ THE PERSISTED SHAPE IS THE CONTRACT WITH PYTHON, AND IT IS DELIBERATELY
 *  SMALLER THAN jsep's: `num`, `series`, `op`, `call`, with keys
 *  `{type, name, value, args}` and nothing else. Python's walker therefore has
 *  four cases — a surface small enough to prove closed (Task 6).
 *
 *  ⛔ MemberExpression, ArrayExpression, Compound, ThisExpression and
 *  AssignmentExpression are REFUSED HERE BY NAME, each with its own message.
 *  DISJOINT messages, deliberately: two gates sharing a phrase let a
 *  `raises(match=…)` pass with the safety deleted, and that has happened here.
 */
export function canonicalise(node) { /* … */ }

/** sha256 over canonical JSON with SORTED keys.
 *
 *  ⚠️ `JSON.stringify` DROPS `undefined`. Canonical form has NO optional keys, for
 *  exactly that reason — B5 shipped a fixture asserting an absent key and it was
 *  vacuous until it was round-tripped through real JSON.
 */
export function astHash(ast) { /* … */ }
```

- [ ] **Step 6: Gate**

```bash
cd app && npx vitest run src/components/chart/engine/ast/parse.test.js \
    src/components/chart/engine/__tests__/enumerationSites.test.js
cd .. && python tools/ast_conformance.py --escapes --unguarded
python tools/alert_replay.py --check
```

**The measurement:** the canonical node-type set (**exactly four**, asserted by walking a parsed tree, not by reading the constant), the manifest's three entry counts, and the ledger anchor matching exactly once.
**The non-measurement assertion:** `listDefinitions()` returns the same **17 ids by name** (a length assertion passes a swap) and `nativeRegistry.js`'s sha256 is unchanged from HEAD — this task adds a parser and wires it to nothing.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `canonicalise` passes `MemberExpression` through as `{type:'member'}` | `member_access` and `proto_walk` in the escape corpus |
| **M2** | `astHash` uses raw `JSON.stringify` (no key sort) | key order is not semantics; an unstable hash migrates alerts on a no-op save |
| **M3** | drop `jsep.removeAllBinaryOps()` | seven operators become parseable and reach a walker with no case for them |
| **M4** | `parseFormula` throws instead of returning `{ok:false}` | a text box that kills the page |
| **M5** | `^jsep` instead of an exact pin | a parser that can move under a persisted AST |

- [ ] **Step 7: Control audit + commit**

```bash
grep -rn "supportedKinds\|COMPUTE_KINDS\|'ast'" app/src docs/ --include=*.js --include=*.jsx --include=*.md | grep -v node_modules
```
`defSchema.js:103`'s comment — *"the registry's `supportedKinds` filter decides what a given client will actually run"* — describes a filter that **does not exist**. Do **not** touch it here: **Task 8 owns that retirement and edits it in the commit that makes the filter real.** Record the rot in this task's report and hand it to Task 8 **by name**. (This is the green-while-false shape; naming it in a hand-off is what B5 Task 7 did after finding four at once.)

```bash
git add app/src/components/chart/engine/ast
git commit -m "feat(ast): one parser, four node types, and a hash that decides a rev bump" -- \
  app/package.json app/package-lock.json app/src/components/chart/engine/ast
```

---

# Task 4: The JS interpreter — pure, unwired, and unable to see a property

**Files:**
- Create: `app/src/components/chart/engine/ast/interpret.js`
- Create: `app/src/components/chart/engine/ast/interpret.test.js`

**Interfaces:**
- Consumes: `TABLE`, `canonicalise`, `NODE_TYPES` (T3).
- Produces:
  ```js
  export function interpret(ast, bars, inputs)  // -> Float64Array, length === bars.length, NaN-padded
  export function maxLookback(ast)              // -> int
  export function nodeCount(ast)                // -> int
  export const FN                               // name -> implementation; key set === TABLE.functions
  ```

**Runs in parallel with Task 5.** T4 owns `interpret.js`; T5 owns `ast_interpret.py`. **Neither may touch `closedTable.json` — Task 3 is its only writer.**

- [ ] **Step 1: Write the failing tests — the two about safety, first**

```js
  it('an identifier resolves ONLY through hasOwnProperty on a null-prototype scope', () => {
    // ⛔ THE ONE-LINE DIFFERENCE BETWEEN A CLOSED TABLE AND AN OPEN ONE.
    // `scope[name]` finds `toString`, `constructor`, `valueOf` and every other
    // Object.prototype member — and each of them is a FUNCTION, so a bare
    // `scope[name]` turns a word a user typed into a callable.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const r = parseFormula(name)
      expect(r.ok, `${name} did not even parse — this test would prove nothing`).toBe(true)
      expect(() => interpret(r.ast, BARS, {})).toThrow(/unknown name/)
    }
  })

  it('every escape-corpus case parses and is then REFUSED, with a disjoint message', () => {
    const seen = new Set()
    let refused = 0
    for (const c of ESCAPES.cases) {
      const p = parseFormula(sourceOf(c))
      if (!p.ok) { expect(c.parserRefuses, `${c.id} was refused by the PARSER`).toBe(true); continue }
      let msg = ''
      try { interpret(p.ast, BARS, {}) } catch (e) { msg = e.message }
      expect(msg, `${c.id} was NOT refused`).toContain(c.refuse)
      expect(seen.has(c.refuse), `two cases share the fragment "${c.refuse}"`).toBe(false)
      seen.add(c.refuse); refused += 1
    }
    // ⛔ THE NON-VACUITY FLOOR. Without it, a corpus every case of which the PARSER
    // happened to reject would satisfy every line above while measuring nothing
    // about the interpreter at all.
    expect(refused, 'the interpreter refused NOTHING — the census is empty').toBeGreaterThan(8)
  })
```

Then the numeric ones:

```js
  it('the column is bars.length and NaN-padded — the same contract as every native', () => {
    // `computeFor` returns one Float64Array per key, aligned to bar count and
    // NaN-padded (spec §4); the binder converts NaN to LWC whitespace. A column
    // that is SHORTER silently shifts every index — the exact defect
    // `alert_series.series_for` asserts its way out of.
    const col = interpret(parseFormula('sma(close, 20)').ast, BARS, {})
    expect(col.length).toBe(BARS.length)
    expect([...col.slice(0, 19)].every(Number.isNaN)).toBe(true)
    expect(Number.isNaN(col[19])).toBe(false)
  })

  it('NaN PROPAGATES through arithmetic and is FALSE through a comparison', () => {
    // The two rules the Python lane must match exactly. Pinned here first because
    // they are the only places the two languages differ if either lane is written
    // casually — and a fabricated 0 during a 199-bar warmup is a number a user
    // could arm an alert on.
    const sub = interpret(parseFormula('sma(close, 20) - sma(close, 200)').ast, BARS, {})
    expect(Number.isNaN(sub[100])).toBe(true)     // NOT 0
    const cmp = interpret(parseFormula('close > sma(close, 200)').ast, BARS, {})
    expect(cmp[100]).toBe(0)                      // a NaN comparison is false, not NaN
  })

  it('`crossOver` returns 0, 1 or NaN and NOTHING ELSE', () => {
    // Spec §3.1: events are columns valued {0,1,NaN}, and alerts, the screener and
    // this interpreter all consume that one shape. `nativeRegistry`'s
    // `validateEventColumns` already refuses 0.5 at registration for a native; a
    // formula must not be the way in.
    const col = interpret(parseFormula('crossOver(close, sma(close, 20))').ast, BARS, {})
    for (const v of col) expect(v === 0 || v === 1 || Number.isNaN(v)).toBe(true)
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd app && npx vitest run src/components/chart/engine/ast/interpret.test.js
```

- [ ] **Step 3: Implement**

```js
/** Evaluate a canonical AST over bars → one Float64Array.
 *
 *  ⭐ COLUMNAR, NOT PER-BAR. Every function in the table is a whole-series
 *  reduction, so the walker evaluates each node ONCE into a column and combines
 *  columns. That is both faster and the only shape in which `maxLookback` is a
 *  TREE SUM rather than a dataflow analysis — which is what lets Task 7's linter
 *  be simple enough to be obviously right.
 *
 *  ⛔ NO CLOCK, NO NETWORK, NO REGISTRY IMPORT, NO `Math.random`. This function is
 *  pure. The conformance log is an equality against a lane in another language, so
 *  anything non-deterministic makes the two disagree for a reason neither is wrong
 *  about — and that failure would look exactly like a real divergence.
 */
export function interpret(ast, bars, inputs) {
  const scope = Object.create(null)            // ⛔ null prototype, deliberately
  for (const [name, spec] of Object.entries(TABLE.series)) {
    scope[name] = bars.map(b => b[spec.field])
  }
  for (const [k, v] of Object.entries(inputs || {})) scope[k] = v

  const lookup = (name) => {
    // ⛔ hasOwnProperty.call, NEVER `scope[name]`. `scope` already has a null
    // prototype so `scope.toString` is undefined — and this is the SECOND lock,
    // because a future refactor seeding `scope` from `{}` would silently re-open
    // it and nothing else in this file would notice.
    if (!Object.prototype.hasOwnProperty.call(scope, name)) {
      throw new Error(
        `unknown name ${JSON.stringify(name)} — this table declares ` +
        `${Object.keys(scope).join(', ')}`)
    }
    return scope[name]
  }

  const evalNode = (n) => {
    switch (n.type) {
      case 'num':    return n.value
      case 'series': return lookup(n.name)
      case 'op':     return applyOp(n.name, n.args.map(evalNode))
      case 'call':   return applyFn(n.name, n.args.map(evalNode))
      default:
        // ⛔ NOT a fallthrough to something plausible. `canonicalise` produces four
        // types; a fifth here means the two modules disagree about the wire shape,
        // and a walker that guessed would be running a tree nobody authored.
        throw new Error(
          `unknown node type ${JSON.stringify(n.type)} — legal types are ${NODE_TYPES.join(', ')}`)
    }
  }
  return toColumn(evalNode(ast), bars.length)
}
```

`applyFn` dispatches from `FN`, whose key set is asserted equal to the manifest's:

```js
  it('every declared function has an implementation, and every implementation is declared', () => {
    // ⛔ BOTH DIRECTIONS. A declared-but-unimplemented name is a formula the builder
    // offers and the chart cannot draw; an implemented-but-undeclared name is a
    // callable OUTSIDE the closed table, which is the one thing this phase exists
    // to make impossible.
    expect(Object.keys(FN).sort()).toEqual(Object.keys(TABLE.functions).sort())
  })
```

- [ ] **Step 4: Gate**

```bash
cd app && npx vitest run src/components/chart/engine/ast/
cd .. && python tools/ast_conformance.py --escapes --unguarded   # still non-zero
python tools/ast_conformance.py --escapes                        # the JS half is now zero
python tools/alert_replay.py --check
```

**The measurement:** the escape census's JS half at **0** with its unguarded control still non-zero; the totality rail green in both directions; the corpus's per-case JS digests printed.
**The non-measurement assertion:** `listDefinitions()` returns the same 17 ids **by name**; `computeFor` is untouched (sha256 of `nativeRegistry.js` unchanged from HEAD).

| id | mutation | must go red because |
|---|---|---|
| **M1** | `scope[name]` instead of `hasOwnProperty.call` | ⚠️ **VERIFY LETHALITY FIRST.** With `Object.create(null)` still in place this is an **equivalent mutant** on a value comparison. Pair it: **M1b** also seeds `scope` from `{}`. Report M1 as the designed survivor and M1b as the kill, and the kill must come from the escape corpus — the B4 M13-pair shape |
| **M2** | the `default` case returns `NaN` instead of throwing | a tree nobody authored draws a blank line instead of refusing |
| **M3** | the totality rail asserts one direction only | an implemented-but-undeclared callable |
| **M4** | subtraction treats NaN as 0 | 199 fabricated warmup values, every one alertable |
| **M5** | `toColumn` returns the raw length instead of `bars.length` | every index shifts silently |
| **M6** | `crossOver` returns `true`/`false` instead of `1`/`0` | `{0,1,NaN}` is the one shape alerts, the screener and D's AST all consume |

- [ ] **Step 5: Control audit + commit**

```bash
grep -rn "columnKeys\|computeFor\|every definition" app/src --include=*.js --include=*.jsx | grep -iE "test|spec"
```
`nativeRegistry.test.js`'s column-set assertions are about the **native** lane and must stay about it. Any test that says *"every definition"* is about to become false at Task 8; **re-point it at its lane now**, in a commit that changes nothing it asserts, rather than at Task 8 where the change and the re-point would be indistinguishable. Report the list you re-pointed.

```bash
git add app/src/components/chart/engine/ast/interpret.js \
        app/src/components/chart/engine/ast/interpret.test.js
git commit -m "feat(ast): the JS interpreter, and the one line that makes the table closed" -- \
  app/src/components/chart/engine/ast/interpret.js \
  app/src/components/chart/engine/ast/interpret.test.js
```

---

# Task 5: The Python interpreter, and the 1e-9 equality that makes a user formula alertable at all

**Files:**
- Create: `api/services/ast_table.py`
- Create: `api/services/ast_interpret.py`
- Create: `tests/test_ast_interpret.py`
- Create: `tests/fixtures/ast/conformance_log.json`
- Create: `tests/fixtures/indicators/ast_sma_20.json`, `ast_nan_propagation.json`, `ast_crossover.json`
- Modify: `tests/test_indicator_golden.py`, `app/src/components/chart/goldenFixtures.test.js`
- Modify: `tools/ast_conformance.py` (the Python half of `--record` / `--check`)

**Interfaces:**
- Consumes: `closedTable.json` (**reads it; does not edit it**), `tests/fixtures/ast/corpus.json`.
- Produces:
  ```python
  TABLE: dict                                   # the manifest, read from disk, frozen
  FN: dict[str, Callable]                       # key set == TABLE["functions"]
  def interpret(ast: dict, bars: list[dict], inputs: dict) -> list[MaybeNum]
  def max_lookback(ast: dict) -> int
  def node_count(ast: dict) -> int
  ```

**Runs in parallel with Task 4.** T5 owns `ast_interpret.py` + `ast_table.py`; T4 owns `interpret.js`. **Neither may touch `closedTable.json`.**

- [ ] **Step 1: Write the failing test — the manifest is READ, not copied**

```python
def test_the_python_lane_reads_the_SAME_manifest_file_the_js_lane_imports():
    """⛔ ONE DECLARATION, TWO READERS. A hand-copied table in this module would be
    a second grammar, and the two would drift the first time somebody added a
    function to one — silently, because every existing test would stay green.

    This repo has already paid for two vocabularies that looked like one:
    `_CASE_COLUMNS` exists precisely because `williams_r` here is `williamsR`
    there.

    ⚠️ The path is resolved from THIS FILE, with an existence assert that NAMES the
    file — the `goldenFixtures.test.js` shape, which throws loudly rather than
    silently finding nothing.
    """
    assert ast_table.MANIFEST_PATH.name == "closedTable.json"
    assert ast_table.MANIFEST_PATH.exists(), (
        f"the closed table is missing at {ast_table.MANIFEST_PATH}. It is committed "
        "under app/, and this lane READS it rather than owning a copy."
    )


def test_every_declared_name_has_a_python_implementation_and_vice_versa():
    """⛔ BOTH DIRECTIONS, and DERIVED from the manifest.

    One direction alone is how DPC's four constants rode unpinned for the rule's
    entire life: a rail that only checks what somebody remembered to list is a
    LIST, not a rail.
    """
    assert sorted(ast_interpret.FN) == sorted(ast_table.TABLE["functions"])


def test_a_name_outside_the_table_RAISES_and_says_what_is_legal():
    with pytest.raises(ValueError, match="unknown name"):
        ast_interpret.interpret({"type": "series", "name": "__import__", "args": [], "value": None},
                                BARS, {})
```

- [ ] **Step 2: Run and watch them fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_interpret.py -q
```
Expected: FAIL — `ModuleNotFoundError: api.services.ast_table`.

- [ ] **Step 3: Write `ast_table.py` and `ast_interpret.py`**

```python
"""The Python half of the closed table.

⭐ THIS MODULE OWNS NO VOCABULARY. It reads `closedTable.json` — the same bytes the
browser imports — and binds an implementation to each declared name. The totality
rail then asserts the binding is exhaustive in BOTH directions, so a name added to
the manifest lands RED here until somebody writes it.

⚠️ NO PARSER LIVES HERE, EVER (D-A1). The AST is the persisted artifact; this lane
walks a tree it did not build. A parser here would be a second grammar, and the
drift would be silent.

⚠️ PLAIN LOOPS, NOT NUMPY. `indicator_compute.py` carries the same rule and states
why: numpy changes summation order, and 1e-9 across two languages only holds if the
accumulations happen in the same order with the same associativity.
"""
```

```python
def interpret(ast, bars, inputs):
    """Evaluate a canonical AST over bars → one aligned column of len(bars).

    ⛔ FOUR NODE TYPES, AND AN UNKNOWN ONE RAISES. `canonicalise` produces
    num/series/op/call; a fifth arriving here means the two lanes disagree about
    the wire shape, and a walker that guessed would be running a tree nobody
    authored.

    ⛔ NAME RESOLUTION IS AN EXPLICIT MEMBERSHIP TEST ON A PLAIN DICT — never
    `getattr`, never `eval`, never `globals()`. The JS lane's equivalent is
    `hasOwnProperty.call` on a null-prototype object and the two are the same
    decision written twice; the escape corpus drives both.

    ⚠️ NaN IS `None` ON THIS LANE, matching `indicator_compute`'s alignment rule:
    every returned list is len(bars) with `None` before the first computable bar.
    The conformance harness maps `None` ⇄ NaN at ITS boundary, exactly as the
    server wire format does (spec §4).
    """
```

⚠️ **The two lanes' NaN conventions differ and that is the single most likely place they will silently disagree.** JS carries `NaN` inside a `Float64Array`; Python carries `None` inside a list. The harness maps them at one boundary and **the mapping is asserted in both directions with a case that has NaN in the middle of a column, not only at the head** — a head-only case is satisfied by a lane that truncates.

- [ ] **Step 4: Three golden fixtures, read by BOTH lanes**

`tests/fixtures/indicators/` gains **exactly three** files. **Not one per user** — `test_every_fixture_file_is_covered_by_a_test` globs the directory and demands the stem set equal the explicit `CASES` lists, so a per-user fixture is structurally impossible, and that is the right shape (D-A2).

| fixture | kind | why this one |
|---|---|---|
| `ast_sma_20.json` | `ast` | the simplest reduction, on `barsFrom: "app/src/pages/parityBars/intraday5m.json"` so the compute oracle and the pixel gate are one series |
| `ast_nan_propagation.json` | `ast` | NaN in the MIDDLE of a column, not only the head — the case a truncating lane passes |
| `ast_crossover.json` | `ast` | the `{0,1,NaN}` event shape produced by a FORMULA rather than a native |

Each needs: a `CASES` entry in `tests/test_indicator_golden.py`, a case in `goldenFixtures.test.js`, and a `_CASE_COLUMNS` entry keyed by kind. ⚠️ **`_CASE_COLUMNS` is a `keep` ledger row and its anchor is `'_CASE_COLUMNS: Dict[str, Tuple[str, ...]] = {'`** — adding a kind is exactly what a `keep` row is for; re-run the ledger test and **do not edit it**.

- [ ] **Step 5: Record the conformance log — ONE-SHOT, and commit it FIRST**

```bash
python tools/ast_conformance.py --record
git add tests/fixtures/ast/conformance_log.json
git commit -m "test(ast): freeze the cross-lane conformance log" -- tests/fixtures/ast/conformance_log.json
```

The recorder asserts its own non-vacuity **before writing**, the shape `_gen_alert_baseline.py` uses:

```python
    assert finite_rows, "no case produced a finite value — the log pins nothing"
    assert finite_rows < total_rows, (
        "every row is finite — no case exercises a warmup pad, so the NaN "
        "convention (the two lanes' most likely silent disagreement) is untested"
    )
    assert per_case_finite and all(per_case_finite.values()), (
        "a case produced ZERO finite values across the whole series: "
        f"{[c for c, n in per_case_finite.items() if not n]} — its digest is a "
        "digest of nothing"
    )
    assert_corpus_covers_the_table(TABLE, corpus)   # armed at Task 2, first PASS here
```

- [ ] **Step 6: THE MEASUREMENT — two lanes, one number**

```bash
python tools/ast_conformance.py --check
```

🔴 **The gate is exact equality per case, per bar, at rel-tol 1e-9 — and its positive control is a measured perturbation, not an argument.** C Task 14's precedent, verbatim in shape: perturb **one** number in each fixture by **1e-6 (1,000× the tolerance)** and assert **BOTH** lanes go red. A tolerance nobody has ever seen fail is a tolerance nobody knows the value of.

- [ ] **Step 7: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_interpret.py tests/test_ast_conformance.py \
    tests/test_indicator_golden.py tests/test_indicator_compute.py -q
cd app && npx vitest run src/components/chart/goldenFixtures.test.js src/components/chart/engine/ast/
cd .. && python tools/ast_conformance.py --escapes --unguarded
python tools/ast_conformance.py --escapes      # BOTH halves now zero
python tools/alert_replay.py --check
```

**The measurement:** per-case cross-lane digests **identical**, the 1e-6 perturbation reddening both lanes (three times, one per fixture), the escape census zero on both halves with its unguarded control non-zero, and the corpus-coverage rail passing for the first time.
**The non-measurement assertion:** `git diff --stat origin/master -- tests/fixtures/indicators/` shows **only ADDED files** — **no fixture reseeded**. And `--check` on the alert replay is still **`FIRE LOG MATCHES`, exit 0, digest for digest**.

| id | mutation | must go red because |
|---|---|---|
| **M1** | perturb one number in each new fixture by 1e-6 | the 1e-9 claim is measured, not asserted — **three separate kills, one per fixture** |
| **M2** | `ast_table` hand-copies the manifest instead of reading it | two vocabularies that look like one |
| **M3** | Python `interpret` uses `getattr` for name resolution | the escape corpus reaches an attribute |
| **M4** | Python treats `None` as `0.0` in arithmetic | the warmup pad becomes fabricated values on ONE lane, and only the mid-column NaN fixture can see it |
| **M5** | the recorder's per-case non-vacuity assertion deleted, then one case blinded | ⚠️ **delete-the-guard-then-break-it is the ONLY lethal ordering** — B5 Task 4's M8 was self-contradictory the other way and measured `rc=0` |

- [ ] **Step 8: Control audit + commit**

```bash
grep -rn "rel-tol\|relTol\|1e-9\|CASES" tests/ app/src --include=*.py --include=*.js | grep -iE "exception|except|carve|skip"
```
Spec §9.1 says *"THERE IS NO EXCEPTION TO THE REL-TOL RULE"* and records that the one that existed (`MACD_HEAD_MASK`) was measured in pixels, signed off and then removed. **A new lane is exactly where a request for an exception arrives.** Verify none was added here and say so.

```bash
git add api/services/ast_table.py api/services/ast_interpret.py tests/test_ast_interpret.py \
        tests/fixtures/indicators/ast_sma_20.json tests/fixtures/indicators/ast_nan_propagation.json \
        tests/fixtures/indicators/ast_crossover.json
git commit -m "feat(ast): the Python lane walks the same tree, and the two agree at 1e-9" -- \
  api/services/ast_table.py api/services/ast_interpret.py tests/test_ast_interpret.py \
  tests/fixtures/indicators tests/test_indicator_golden.py \
  app/src/components/chart/goldenFixtures.test.js tools/ast_conformance.py
```

---

# Task 6: `compute.budget` stops being reserved — and the reachability census reads zero for the first time

**Files:**
- Create: `app/src/components/chart/engine/ast/budget.js`
- Create: `api/services/ast_budget.py`
- Create: `app/src/components/chart/engine/ast/budget.test.js`
- Create: `tests/test_ast_budget.py`

**Interfaces:**
- Consumes: `maxLookback` / `nodeCount` (T4), `max_lookback` / `node_count` (T5).
- Produces:
  ```js
  export const DEFAULT_BUDGET = Object.freeze({ maxNodes: 128, maxLookback: 500, maxSeriesRefs: 8 })
  export function checkBudget(ast, budget)   // -> {ok:true} | {ok:false, error}
  ```
  ```python
  DEFAULT_BUDGET: dict
  def check_budget(ast: dict, budget: dict) -> None   # RAISES BudgetExceeded
  ```

**SOLO relative to Tasks 7 and 8** — all three read the interpreter and write toward `defSchema.js`.

- [ ] **Step 1: Write the failing tests**

```js
  it('a budget is checked at REGISTRATION and again at COMPUTE, and both are lethal', () => {
    // ⛔ BOTH, AND THE REASON IS NOT BELT-AND-BRACES.
    // Registration-only: a definition registered under one budget and run under a
    //   later, smaller one computes forever at the old cost.
    // Compute-only: the refusal arrives as a chart that draws sometimes — spec §6
    //   state 4, when it should have been an error the author saw while typing.
    // The registration check is the UX; the compute check is the SAFETY, and the
    // safety one is the one a mutation must not be able to delete quietly.
    const fat = nestedAst(4000)
    expect(checkBudget(fat, DEFAULT_BUDGET).ok).toBe(false)
    expect(() => interpret(fat, BARS, {})).toThrow(/exceeds the node budget/)
  })

  it('the lookback budget is a TREE SUM, not the largest single argument', () => {
    // `sma(sma(close, 300), 300)` looks back 600 bars, not 300. A budget that read
    // the largest argument would admit a formula that needs more history than the
    // chart holds — and a column that is NaN for its whole visible range is a line
    // the user cannot see and cannot debug.
    expect(maxLookback(parseFormula('sma(sma(close, 300), 300)').ast)).toBe(600)
  })

  it('a budget declared on a definition OVERRIDES the default, downward ONLY', () => {
    // ⛔ DOWNWARD ONLY. `compute.budget` arrives from a stored definition, which is
    // USER DATA. A stored budget that could RAISE the cap is a stored value that
    // turns off its own limit — the same class as an `active=0` that also blinds a
    // soak, refused for the same reason.
    expect(effectiveBudget({ maxNodes: 9999 }).maxNodes).toBe(DEFAULT_BUDGET.maxNodes)
    expect(effectiveBudget({ maxNodes: 8 }).maxNodes).toBe(8)
  })
```

- [ ] **Step 2: Run, fail, implement**

```bash
cd app && npx vitest run src/components/chart/engine/ast/budget.test.js
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_budget.py -q
```

Numbers, with the reason each is that number:

```js
/** ⭐ THE CAPS, AND WHY EACH IS WHERE IT IS.
 *
 *  maxNodes 128     — the largest hand-written native in this registry is
 *                     `ichimoku` at 5 columns; a 128-node single column is far past
 *                     anything a human composes and far short of anything that
 *                     blocks a frame at the 5,000-bar cap.
 *  maxLookback 500  — the chart holds 5,000 bars on every timeframe, and a 500-bar
 *                     warmup already leaves 90% of a full window drawable. Above
 *                     that the user sees a mostly-empty pane and reads it as broken.
 *  maxSeriesRefs 8  — spec §5's perf budget is ≤60 series and ≤8 panes per chart;
 *                     eight base-series reads inside ONE definition is already the
 *                     whole pane budget's worth of data in a single column.
 *
 *  ⚠️ EACH IS DERIVED FROM A NUMBER THAT ALREADY EXISTS IN THIS SYSTEM, on purpose.
 *  A cap chosen by taste is a cap nobody can re-derive when it needs to move.
 */
```

- [ ] **Step 3: THE REACHABILITY CENSUS — the structural half, by AST, never a grep**

```python
def reachability_census() -> dict:
    """What the two interpreters can dispatch on and resolve — read from their OWN
    SOURCE TREES.

    ⛔ AN AST, NEVER A GREP. `git grep -c admit_alert_fire` said 2, then 3, and every
    one was PROSE IN A COMMENT — it nearly became a false ship-blocker on this
    branch. A grep counts comments and strings and it has done both directions here.

    Python half: `ast.parse` the module, find `interpret` BY NAME (never by line
    number — `inspect.getsource` returned the wrong slice mid-run when a co-worker
    inserted 180 lines above the target), and collect every string compared against
    `node["type"]` plus every dict subscripted for a name.

    JS half: the same question answered by the ESCAPE CORPUS rather than by parsing
    JS, because this repo has no JS parser it trusts for that and adding one to
    answer a test would be a second grammar. The corpus is the instrument; the
    unguarded control is what makes its zero mean something.
    """
```

```bash
python tools/ast_conformance.py --escapes --unguarded    # non-zero, still
python tools/ast_conformance.py --escapes                # 🎯 ZERO — the phase's headline
```

- [ ] **Step 4: Gate**

**The measurement:** the escape census at **0 / 0** with the unguarded control non-zero; the reachability census's dispatch set equal to `NODE_TYPES` exactly; the three budget caps each refusing at the boundary and admitting one below it.
**The non-measurement assertion:** `listDefinitions()` unchanged by name; `--check` **`FIRE LOG MATCHES`, exit 0**; `defSchema.js` **not yet modified** (Task 8 owns it) — assert by sha256 against HEAD.

| id | mutation | must go red because |
|---|---|---|
| **M1** | delete the compute-time budget check, keep the registration one | a definition registered under an old budget computes forever at the old cost |
| **M2** | `maxLookback` returns the largest argument instead of the tree sum | `sma(sma(close,300),300)` admits at 300 and needs 600 |
| **M3** | `effectiveBudget` takes the max of stored and default | user data that turns off its own limit |
| **M4** | the census uses `grep` instead of `ast.parse` | it counted a comment on this branch and nearly blocked a ship |
| **M5** | the reachability census asserts `⊆ NODE_TYPES` instead of `==` | a dispatch case that stopped being reachable is a case nothing drives, and it rots green |

- [ ] **Step 5: Control audit + commit**

```bash
grep -rn "budget" app/src/components/chart/engine docs/ --include=*.js --include=*.md | grep -v node_modules
```
`defSchema.js:488-491`'s comment says *"`budget` is reserved… the caps themselves have no meaning yet."* **That is now false and its test is still green** — the check asserts a shape, not a meaning. Do **not** edit it here; **Task 8 owns it** and edits it in the commit that gives `compute.budget` a consumer. Hand it forward by name.

```bash
git add app/src/components/chart/engine/ast/budget.js app/src/components/chart/engine/ast/budget.test.js \
        api/services/ast_budget.py tests/test_ast_budget.py
git commit -m "feat(ast): the budget is enforced twice, and nothing escapes the table" -- \
  app/src/components/chart/engine/ast api/services/ast_budget.py tests/test_ast_budget.py
```

---

# Task 7: The machine repaint linter — and what it says about an indicator that is live today

**Files:**
- Create: `app/src/components/chart/engine/ast/lint.js`
- Create: `app/src/components/chart/engine/ast/lint.test.js`
- Create: `tests/fixtures/ast/must_repaint.json`
- Create: `api/services/ast_lint.py`
- Create: `tests/test_ast_lint.py`
- Modify: `docs/decisions/2026-08-06-machine-repaint-linter.md` (§3, the measurement)

**Interfaces:**
- Consumes: `TABLE` (T3), `maxLookback` (T4).
- Produces:
  ```js
  export function lintRepaint(ast, opts)  // -> {mode: 'non-repainting'|'preview-repaints'|'repaints', reasons: string[]}
  ```
  ```python
  def lint_repaint(ast: dict, opts: dict) -> dict   # the same verdict, same vocabulary
  ```

**SOLO.** 🔴 **This task MEASURES. It does not re-badge anything.**

- [ ] **Step 1: Write the must-repaint corpus FIRST — the linter's positive control**

`tests/fixtures/ast/must_repaint.json`. **A corpus in which every case is clean measures nothing**, so the clean cases and the dirty cases are both required and the ratio is asserted.

```jsonc
{ "cases": [
  { "id": "forward_ref",       "source": "gen:forwardRef(close, 1)",
    "expect": "repaints",
    "why": "the output at bar i reads bar i+1. Spec §4: bar-close outputs must be reproducible from history alone" },
  { "id": "trailing_write",    "source": "gen:trailingWrite(close, 26)",
    "expect": "preview-repaints",
    "why": "ichimoku's chikou, expressed as a formula: bar i's close lands at index i-26, so a historical point MOVES while the newest bar forms" },
  { "id": "plain_sma",         "source": "sma(close, 20)",
    "expect": "non-repainting",
    "why": "the clean control. Without it a linter that returns `repaints` unconditionally passes every dirty case" },
  { "id": "cross_of_emas",     "source": "crossOver(ema(close, 9), ema(close, 21))",
    "expect": "non-repainting",
    "why": "a crossing reads bar i and bar i-1 only. If this reads dirty, the linter is calling every event repainting and the builder ships nothing" }
]}
```

⚠️ **`forwardRef` and `trailingWrite` are NOT expressible in the v1 table** — that is deliberate (Task 3 left `offset` out precisely so a forward reference cannot be written). So the corpus generates those two ASTs **directly, as trees**, bypassing the parser, and the test states that out loud:

```js
  it('the two dirty cases are UNREACHABLE from the v1 grammar, and that is the point', () => {
    // ⭐ THE LINTER IS BEING TESTED AGAINST TREES A USER CANNOT WRITE TODAY, ON
    // PURPOSE. v1's table has no offset form, so nothing a user types can repaint —
    // and a linter validated only against inputs that cannot fail is a linter
    // nobody has measured. When `offset` is proposed for v2, THIS is the file that
    // already knows the answer.
    for (const id of ['forward_ref', 'trailing_write']) {
      expect(parseFormula(sourceOf(id)).ok, `${id} PARSED — v1 grew an offset form and nobody said so`).toBe(false)
    }
  })
```

- [ ] **Step 2: Write the failing test and watch it fail**

```bash
cd app && npx vitest run src/components/chart/engine/ast/lint.test.js
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_lint.py -q
```

- [ ] **Step 3: Implement — and keep it small enough to be obviously right**

```js
/** Assign a repaint mode to an AST.
 *
 *  ⭐ THE RULE, IN ONE SENTENCE: a formula repaints iff its output at bar `i`
 *  depends on any bar `j > i`. That is decidable on this table because every
 *  function declares its lookback as a constant or a named argument, so the
 *  dependency window of a node is a tree sum and nothing needs a dataflow
 *  analysis. Spec §11 defers this to D for exactly that reason: *"No static
 *  analysis of hand-written JS; don't build throwaway introspection."*
 *
 *  Three verdicts, spec §3's vocabulary, no fourth:
 *    non-repainting   — every dependency offset is <= 0
 *    preview-repaints — a dependency offset > 0 exists, but every value is FINAL
 *                       once the bar it depends on has closed
 *    repaints         — anything else
 *
 *  ⛔ THERE IS NO EXEMPTION LIST, AND THERE MAY NOT BE ONE. An exemption is
 *  precisely the hand-audited metadata this linter exists to replace, and the
 *  brand position is receipts. If this linter disagrees with a shipped badge, the
 *  linter is the measurement and the badge is the claim — the disagreement goes to
 *  the OWNER (see the record), never into this file.
 *
 *  ⛔ AND IT IS FAIL-CLOSED. An AST shape this function does not recognise returns
 *  `repaints` with the reason `"unanalysable"`, never `non-repainting`. The
 *  asymmetry is the whole design: a false `repaints` costs a user one confused
 *  moment; a false `non-repainting` costs the brand its central claim, and it costs
 *  it in a way a competitor can demonstrate.
 */
export function lintRepaint(ast, opts) { /* … */ }
```

- [ ] **Step 4: Run it over the 17 shipped definitions — this is the measurement**

The natives are hand-written JS, not ASTs, so the linter cannot read them directly. **It reads their declared lookback contract instead**, and where a definition's compute has a *trailing* pad the linter is handed that fact from the one place it is already pinned:

```python
def test_the_linter_agrees_with_every_shipped_badge_or_names_the_ones_it_does_not():
    """🔴 A MEASUREMENT, NOT AN ASSERTION. This test PRINTS the full verdict table
    and fails ONLY on a definition whose disagreement is not recorded in the
    decision record — so a new disagreement cannot arrive silently, and a recorded
    one cannot be quietly resolved either.

    ⚠️ `TRAILING_PAD` in tests/test_indicator_golden.py is the ONE place a trailing
    dependency is already pinned, and it holds exactly one entry:
    ("ichimoku_9_26_52", "chikou"): 26. It is READ here, never re-typed — a
    hand-copied 26 is a second declaration of the same fact and it would rot the
    first time the pad moved.
    """
    disagreements = []
    for d in shipped_definitions():
        verdict = lint_repaint_for_native(d)
        if verdict["mode"] != d["meta"]["repaint"]:
            disagreements.append((d["id"], d["meta"]["repaint"], verdict["mode"], verdict["reasons"]))
    print(format_table(disagreements))
    assert {x[0] for x in disagreements} == recorded_disagreements_from(RECORD), (
        "the linter's verdict table changed and the decision record did not. "
        f"Measured: {sorted(x[0] for x in disagreements)}"
    )
```

🔴 **The expected first result, measured while writing this plan and to be re-measured here, is that `ichimoku` disagrees.** `compute_ichimoku_raw` writes bar `i`'s close to index `i - kijun_period`; `computeIchimoku` does the same; both are documented as a preserved quirk; the pad is pinned at 26. So the plotted point at a historical index moves while the newest bar forms, and `ichimoku` wears `non-repainting` from a shared default no native overrides.

**Do not re-badge it.** Write the measurement into the record's §3 and set the header to:

```markdown
**Status:** 🔴 **MEASURED — the linter disagrees with `ichimoku`'s shipped badge. AWAITING AN OWNER DECISION.**
```

⚠️ **And `ichimoku` is already the subject of a second open owner question**: C measured that `ichimoku.chikou` *"can never fire closed-bar"* — its 26-bar trailing pad makes the confirmed bar's value `None` — so a user's Chikou alert stops permanently at the Phase C cutover. **Both questions are about the same column and they should go to the owner together**, in one message, with both measurements in hand. Say so in the record.

- [ ] **Step 5: Gate**

```bash
cd app && npx vitest run src/components/chart/engine/ast/
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_ast_lint.py tests/test_indicator_golden.py -q
python tools/alert_replay.py --check
```

**The measurement:** the must-repaint corpus at 4/4 with its clean/dirty ratio asserted non-degenerate; the shipped-definition verdict table **printed in full**; the recorded disagreement set.
**The non-measurement assertion:** **no `meta.repaint` value moved.** `git diff HEAD -- app/src/components/chart/engine/nativeRegistry.js` is **empty** — this task measures a badge and changes none.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `lintRepaint` returns `non-repainting` for an unrecognised shape | the fail-closed asymmetry IS the design |
| **M2** | delete the two clean cases from the corpus | a linter returning `repaints` unconditionally would pass every remaining case |
| **M3** | add an id-based exemption for `ichimoku` | the hand-audited metadata this linter replaces |
| **M4** | the shipped-definition test hand-copies `26` instead of reading `TRAILING_PAD` | a second declaration of one fact, which rots the day the pad moves |
| **M5** | `maxLookback` treated as a bound on FORWARD dependency too | ⚠️ verify lethality — with no offset form in v1 this may be an equivalent mutant; if it is, report it as the designed survivor and say which corpus case would kill it once `offset` exists |

- [ ] **Step 6: Control audit + commit**

```bash
grep -rn "non-repainting\|repaint" app/src api/ docs/ --include=*.js --include=*.py --include=*.md | grep -v node_modules
```
`nativeRegistry.js:106`'s comment — *"Every native is a `native`-lane, non-repainting, free-tier indicator today"* — has **two** clauses this phase falsifies: the repaint one (measured here) and the tier one (the owner's *"everything is paid"* ruling, Task 14). **Rewrite it past-tense in the commit that falsifies each half**, never delete it (B5 Task 4's rule). This task owns the first half only.

```bash
git add app/src/components/chart/engine/ast/lint.js app/src/components/chart/engine/ast/lint.test.js \
        api/services/ast_lint.py tests/test_ast_lint.py tests/fixtures/ast/must_repaint.json
git commit -m "feat(ast): the machine repaint linter, and the badge it disagrees with" -- \
  app/src/components/chart/engine/ast api/services/ast_lint.py tests/test_ast_lint.py \
  tests/fixtures/ast/must_repaint.json docs/decisions/2026-08-06-machine-repaint-linter.md
```

---

# Task 8: `compute.kind: 'ast'` registers, `supportedKinds` stops being a comment, and 33 assertions collapse to one

**Files:**
- Modify: `app/src/components/chart/engine/defSchema.js`
- Modify: `app/src/components/chart/engine/nativeRegistry.js`
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (**second writer**)
- Modify: `app/src/components/chart/engine/defSchema.test.js`, `nativeRegistry.test.js`
- Modify: `api/services/signature/registry_defs.py` (the `SCHEMA_VERSION` cross-assert only)
- Create: `app/src/components/chart/engine/registrySizes.js`

**Interfaces:**
- Consumes: `parseFormula` / `astHash` (T3), `interpret` (T4), `checkBudget` (T6), `lintRepaint` (T7).
- Produces:
  ```js
  export const SUPPORTED_KINDS = Object.freeze(['native', 'server', 'ast'])   // NOT 'script'
  export function registerUserDefinitions(rawDefs)   // -> {defs, errors}
  export const REGISTRY_SIZES                        // {native, server, ast, total} — ONE place
  ```

**SOLO.** Second and last writer of `enumerationSites.test.js` before Task 15.

- [ ] **Step 1: Write the failing tests**

```js
  it('`supportedKinds` EXISTS, and `script` is not in it', () => {
    // ⛔ defSchema.js:103 has claimed since B1 that "the registry's `supportedKinds`
    // filter decides what a given client will actually run." MEASURED 2026-08-06:
    // that filter has NO identifier anywhere in app/src or api/. A comment
    // describing a mechanism nobody wrote, sitting in the file whose job is to fail
    // closed. This task makes it true.
    //
    // `script` stays a DECLARED kind (it parses, per spec §3) and an UNSUPPORTED
    // one (nothing runs it). Those are different statements and the schema must be
    // able to make both.
    expect(SUPPORTED_KINDS).toEqual(['native', 'server', 'ast'])
    expect(COMPUTE_KINDS).toContain('script')
  })

  it('a definition of an UNSUPPORTED kind is listed but refuses to RENDER', () => {
    // Spec §3.1: catalog fetch filters by client `supportedKinds`; and §5: premium
    // entries stay LISTED for merchandising even when locked. So "cannot run" and
    // "must not appear" are different, and conflating them would hide the whole
    // server lane from a client that simply has an older bundle.
    const res = registerUserDefinitions([{ ...probeDef(), compute: { kind: 'script', fn: 'x', rev: 1 } }])
    expect(res.defs.map(d => d.id)).toEqual([])
    expect(res.errors.join('\n')).toMatch(/kind "script" is declared but this client cannot run it/)
  })

  it('an `ast` definition MUST carry both `compute.ast` and `compute.source`, and they must AGREE', () => {
    // ⭐ D-A1's rail. The AST is what runs; the source is what the user edits. A
    // stored pair that disagree is a definition whose read-back describes maths
    // nobody is computing — the exact failure the concierge is designed against,
    // arriving from the other direction.
    const def = astDef('sma(close, 20)')
    def.compute.source = 'sma(close, 200)'          // edited, AST not re-parsed
    const res = registerUserDefinitions([def])
    expect(res.errors.join('\n')).toMatch(/compute\.source does not parse to compute\.ast/)
  })

  it('the registry publishes ONE size table and every count assertion reads it', () => {
    // 🔴 §A5 MEASURED THIS AND IT IS THE REASON THIS FILE EXISTS: "2 definitions
    // cost 33 assertions across 12 files." C Task 10 then watched 28 tests fail
    // across 13 files, all asserting `defs.length === 16`, because the registry
    // moved to 17 mid-phase. D adds a THIRD lane, so a per-file literal would break
    // every one of them again for no reason.
    expect(REGISTRY_SIZES.total).toBe(REGISTRY_SIZES.native + REGISTRY_SIZES.server + REGISTRY_SIZES.ast)
    expect(listDefinitions().length).toBe(REGISTRY_SIZES.total)
  })
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd app && npx vitest run src/components/chart/engine/defSchema.test.js src/components/chart/engine/nativeRegistry.test.js
```

- [ ] **Step 3: Implement**

In `defSchema.js`, the `ast` branch of `validateCompute` — and **`compute.fn` is still required for every kind** (measured; it is a non-empty-string check with no kind branch), so an `ast` definition's `fn` is its **`astHash`**, which makes the handle and the maths the same fact:

```js
  // ⭐ AN `ast` DEFINITION'S `compute.fn` IS ITS `astHash`, and that is not a
  // formality. `fn` is the compute HANDLE; for a native it names a function in
  // `NATIVE_COMPUTE`, for a server def it names an endpoint's definition id. For an
  // AST there is no third thing to name — the tree IS the implementation — so
  // naming it by its own hash makes "the handle changed" and "the maths changed"
  // one event rather than two that can disagree.
```

In `nativeRegistry.js`, `computeFor` gains its third lane, **before** the `NATIVE_COMPUTE` lookup, exactly as C Task 13 placed the server lane:

```js
  if (def?.compute?.kind === 'ast') {
    return astColumnsFor(def, Array.isArray(bars) ? bars : [], resolveInputs(def, inputs))
  }
```

⚠️ **And the throw for an unknown native `compute.fn` must be pinned as still intact** — C Task 13 shipped that assertion when it added the server lane, and a third lane is exactly where a `return {}` fallback gets added by accident.

`registrySizes.js` is the one place a count lives, and every count assertion in the 13 files reads it. **Collapse them in this task**; that is the deliverable, not a nicety.

- [ ] **Step 4: Cross-assert the two schema versions**

```python
def test_the_server_lane_publishes_the_SAME_schema_version_the_client_validates():
    """⚠️ TWO SCHEMA-VERSION CONSTANTS EXIST and they can disagree.

    `defSchema.SCHEMA_VERSION` is what the client validates against;
    `api/services/signature/registry_defs.SCHEMA_VERSION` is what
    `/api/signature/definitions` PUBLISHES. Two authorities over one wire contract
    is how a client silently refuses every definition after a bump nobody
    propagated. Read the JS constant from source rather than re-typing it.
    """
```

- [ ] **Step 5: The ledger — second writer**

Adding a lane adds no enumeration by itself, but **verify that by running the scans, not by assuming it.** If `registrySizes.js` or the `ast` branch trips either discovery scan, that is a finding: ledger it with a reason and move `SITE_COUNT`. Report the delta either way; a task that changes the registry and reports "no ledger delta" without running the scan is asserting from memory.

- [ ] **Step 6: Gate**

```bash
cd app && npm run build && npx vitest run          # ⚠️ build FIRST: liveStyles.dist.test.js reads app/dist and fails on a stale build
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest -k signature -q
python tools/alert_replay.py --check
python tools/ast_conformance.py --check
```

**The measurement:** `REGISTRY_SIZES` printed; the number of count assertions collapsed (**name the files**); `SUPPORTED_KINDS`; the ledger's found-sets.
**The non-measurement assertion:** `listDefinitions()` still returns **exactly the 17 shipped ids, by name** — this task builds a lane and registers **no** `ast` definition. `REGISTRY_SIZES.ast === 0`. And the pixel gate is **not** owed here, because nothing new draws.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `SUPPORTED_KINDS` includes `'script'` | the reserved AI-plumbing lane is not a lane a client runs |
| **M2** | the `source`↔`ast` agreement check dropped | a read-back describing maths nobody computes |
| **M3** | `computeFor`'s `ast` branch placed AFTER the `NATIVE_COMPUTE` lookup | the unknown-`fn` throw fires first and an `ast` def can never draw — ⚠️ verify the kill is the *ordering* test, not a value |
| **M4** | `REGISTRY_SIZES.total` hardcoded to 17 | a table that does not derive is a literal, and this is the literal 33 assertions just stopped being |
| **M5** | the two `SCHEMA_VERSION`s allowed to differ | two authorities over one wire contract |

- [ ] **Step 7: Control audit + commit**

```bash
grep -rn "supportedKinds\|budget is reserved\|defs.length ===" app/src docs/ --include=*.js --include=*.jsx --include=*.md | grep -v node_modules
```
Three comments handed forward by earlier tasks come due **here, in this commit**: `defSchema.js:103` (`supportedKinds` now exists), `defSchema.js:488` (`budget` now has a consumer), and every surviving `defs.length === N` literal. Rewrite each past-tense; delete none.

```bash
git commit -m "feat(engine): the ast lane registers, supportedKinds stops being a comment, and one size table replaces thirty-three" -- \
  app/src/components/chart/engine/defSchema.js app/src/components/chart/engine/nativeRegistry.js \
  app/src/components/chart/engine/registrySizes.js \
  app/src/components/chart/engine/defSchema.test.js app/src/components/chart/engine/nativeRegistry.test.js \
  app/src/components/chart/engine/__tests__/enumerationSites.test.js
```

---

# Task 9: The sentence read-back — deterministic, from the AST, and never written by a model

**Files:**
- Create: `app/src/components/chart/engine/ast/sentence.js`
- Create: `app/src/components/chart/engine/ast/sentence.test.js`

**Interfaces:**
- Consumes: `TABLE` (T3) — specifically its `sentence` templates.
- Produces: `export function sentenceFor(ast, inputs) // -> string`

**Runs in parallel with Task 10.** T9 owns `sentence.js`; T10 owns the store and its router.

- [ ] **Step 1: Write the failing tests**

```js
  it('the sentence is generated from the AST, and its phrases come from the MANIFEST', () => {
    // ⭐ THE READ-BACK IS THE ONE THING BETWEEN A USER AND MATHS THEY DID NOT WRITE,
    // and it must therefore be derived from what RUNS. A phrase table of its own
    // would be a second vocabulary describing the first — and this repo has already
    // measured what two vocabularies cost.
    expect(sentenceFor(parseFormula('sma(close, 20)').ast, {}))
      .toBe('the 20-bar average of close')
  })

  it('every function in the table has a sentence template — derived, both directions', () => {
    // ⛔ A function with no template renders as its own source, which reads like a
    // sentence and is not one. Derived from the manifest so a new function lands RED
    // here until somebody writes English for it.
    const missing = Object.entries(TABLE.functions).filter(([, s]) => !s.sentence).map(([k]) => k)
    expect(missing, 'these functions have no read-back and would render as raw source').toEqual([])
  })

  it('a sentence ROUND-TRIPS to the same maths — the inversion rail', () => {
    // ⭐ THE ONLY GATE THAT CAN CATCH A SENTENCE THAT IS MERELY PLAUSIBLE.
    // For every corpus case, the sentence is rendered, then a hand-written parser
    // for the SENTENCE GRAMMAR reads it back to an AST, and the two hash equal.
    //
    // ⚠️ AND ITS NON-VACUITY IS ASSERTED SEPARATELY: swapping two arguments in the
    // template must BREAK the round trip. A round-trip test whose reader is derived
    // from the same template it is checking agrees with itself no matter what the
    // template says — which is the "helper REIMPLEMENTS the logic instead of calling
    // it" trap [[lesson_mutation_harness_needs_a_control]] names.
    for (const c of CORPUS.cases) {
      expect(astHash(sentenceToAst(sentenceFor(c.ast, {})))).toBe(astHash(c.ast))
    }
  })

  it('a sentence NEVER silently omits a term', () => {
    // A read-back that drops a clause is worse than no read-back: the user confirms
    // a simpler formula than the one that runs. Every leaf of the AST must appear.
    const s = sentenceFor(parseFormula('sma(close, 20) - sma(close, 50)').ast, {})
    expect(s).toContain('20'); expect(s).toContain('50')
  })
```

- [ ] **Step 2: Run, fail, implement**

```bash
cd app && npx vitest run src/components/chart/engine/ast/sentence.test.js
```

```js
/** An AST → one English sentence, deterministically.
 *
 *  ⛔ THIS FUNCTION IS THE ONLY PRODUCER OF THE TEXT A USER CONFIRMS, and Task 13's
 *  concierge is FORBIDDEN from writing that text. A model-written summary of a
 *  model-written formula is two guesses agreeing, and the user has no way to tell
 *  the pair apart from a correct one.
 *
 *  ⚠️ NO CLOCK, NO LOCALE, NO Intl. The sentence is compared against a committed
 *  string in a test and rendered into a stored definition; a locale-sensitive number
 *  format would make it machine-dependent, and this box has already produced one
 *  cp1252 and one CRLF class of that failure.
 */
export function sentenceFor(ast, inputs) { /* … */ }
```

- [ ] **Step 3: Gate**

**The measurement:** the round trip green for every corpus case, and the template-coverage rail derived from the manifest.
**The non-measurement assertion:** `sentence.js` imports **nothing** from `nativeRegistry.js`, the network, or a date — a pure function of (ast, inputs), asserted by an import scan over the module's own AST.

| id | mutation | must go red because |
|---|---|---|
| **M1** | swap `{0}` and `{1}` in one template | the round trip — ⚠️ **and this is the mutation that proves the round trip is not self-agreeing**; if it survives, `sentenceToAst` is derived from the template and the rail is vacuous |
| **M2** | drop a nested term when depth > 2 | a user confirms a simpler formula than the one that runs |
| **M3** | the template-coverage rail hand-lists the functions | a rail built on a list is a list |

- [ ] **Step 4: Commit**

```bash
git add app/src/components/chart/engine/ast/sentence.js app/src/components/chart/engine/ast/sentence.test.js
git commit -m "feat(ast): the read-back is generated from the tree, never written by a model" -- \
  app/src/components/chart/engine/ast/sentence.js app/src/components/chart/engine/ast/sentence.test.js
```

---

# Task 10: Persistence — its own store, append-only, and an edit that CALLS Phase C's force-migration

**Files:**
- Create: `api/services/user_definitions.py`
- Create: `api/routers/user_definitions.py`
- Create: `tests/test_user_definitions.py`
- Modify: `api/main.py` (router mount + one-line schema init)

**Interfaces:**
- Consumes: `alert_rev_migration.migrate_bindings_to_rev` (Phase C, T7) — **calls it; does not reimplement it**.
- Produces:
  ```python
  def save(user_id, def_id, definition) -> dict     # {version, rev, rev_bumped, migrated}
  def get(user_id, def_id, version=None) -> dict | None
  def list_for_user(user_id) -> list[dict]
  def soft_delete(user_id, def_id) -> bool
  MAX_DEFINITION_BYTES = 64 * 1024
  MAX_DEFINITIONS_PER_USER = 50
  ```

**Runs in parallel with Task 9.**

- [ ] **Step 1: Write the failing tests**

```python
def test_a_definition_does_NOT_live_in_chart_settings_and_here_is_the_proof():
    """⛔ MEASURED, NOT ASSUMED. `mergeChartSettings` is a hard allow-list — the key
    set of its own return literal — and a key absent from it is DESTROYED ON EVERY
    READ. `engineEnabled` was deleted that way ON PURPOSE, at seven sites, precisely
    because the mechanism works.

    So a user definition stored under a new `chart_settings` key would survive
    exactly until the next read, and nothing would say so.
    """
    blob = merge_chart_settings({"userDefinitions": [{"id": "u_abc"}]})
    assert "userDefinitions" not in blob


def test_every_save_appends_a_version_and_NOTHING_is_updated_in_place():
    """Spec §3.1: alerts, screens and the ledger pin `defId@version` freely. A pin
    is only free if the row it points at cannot change under it.
    """
    v1 = save(U, "u_abc", defn("sma(close, 20)"))
    v2 = save(U, "u_abc", defn("sma(close, 20)", label="renamed"))
    assert (v1["version"], v2["version"]) == (1, 2)
    assert get(U, "u_abc", version=1)["meta"]["name"] != get(U, "u_abc", version=2)["meta"]["name"]


def test_rev_bumps_IFF_the_ast_hash_moved_and_the_bump_FORCE_MIGRATES():
    """⭐ D-A3, AND THE MECHANISM IS CALLED, NOT REBUILT.

    `version` increments on every save; `rev` increments IFF `astHash` changed. That
    removes an entire class of "the user forgot to bump" and is one assertion.

    And a rev bump runs Phase C's `migrate_bindings_to_rev` — the SAME function, with
    the same `last_value` reset, the same notification and the same first-cycle
    suppression. C's record notes that path *"has no population to act on today"*; a
    user editing their own formula is its first real population, and it arrives with
    no deploy to hang it on.
    """
    save(U, "u_abc", defn("sma(close, 20)"))
    renamed = save(U, "u_abc", defn("sma(close, 20)", label="renamed"))
    assert renamed["rev_bumped"] is False and renamed["migrated"] == 0

    with migration_spy() as calls:
        edited = save(U, "u_abc", defn("sma(close, 21)"))
    assert edited["rev_bumped"] is True
    assert calls, "a maths change did NOT force-migrate — the user's armed alerts " \
                  "would compare a rev-1 prev against a rev-2 current, which " \
                  "fabricates a crossing no bar produced"


def test_the_store_REFUSES_an_oversized_or_too_numerous_definition():
    """⚠️ `user_preferences` HAS NO SIZE LIMIT AND NO DELETE ROUTE — measured. This
    store is not that store, and the caps are named rather than inherited.
    """
    with pytest.raises(ValueError, match="definition exceeds"):
        save(U, "u_big", defn("sma(close, 20)", pad=MAX_DEFINITION_BYTES + 1))
```

- [ ] **Step 2: Run and watch them fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_user_definitions.py -q
```

- [ ] **Step 3: Implement the store**

Modelled on `api/services/charts_layout_service.py` — the shipped precedent for user-authored content — with its `_connect()` / `_init_db()` / `_WRITE_LOCK` shape:

```sql
CREATE TABLE IF NOT EXISTS user_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  def_id       TEXT    NOT NULL,   -- 'u_<12 hex>'; ID_RE-legal, dot-free
  version      INTEGER NOT NULL,   -- presentation; increments on EVERY save
  rev          INTEGER NOT NULL,   -- maths; increments IFF ast_hash moved
  ast_hash     TEXT    NOT NULL,
  definition   TEXT    NOT NULL,   -- the whole schema-v1 definition, JSON
  repaint      TEXT    NOT NULL,   -- the LINTER's verdict, stored at save time
  deleted_at   INTEGER,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, def_id, version)
);
CREATE INDEX IF NOT EXISTS idx_user_definitions_owner ON user_definitions(user_id, def_id, version DESC);
```

```python
# ⭐ THE ID NAMESPACE IS `u_<12 hex>` AND THE SHAPE IS FORCED, NOT CHOSEN.
# `defSchema.ID_RE` is /^[A-Za-z0-9][A-Za-z0-9_-]*$/ — NO DOTS, because plots are
# addressed `defId.plotKey` and a dot in an id makes that address ambiguous. And no
# shipped definition id starts with `u_` (measured: rsi macd bb vwap stoch atr sar
# ichimoku mfi cci williamsR adx obv donchian avwap atrBands rsLine), so the
# namespaces cannot collide.
#
# ⛔ THE PREFIX IS ASSERTED AGAINST THE LIVE REGISTRY, NEVER AGAINST THAT LIST.
# A typed list of ids is exactly the probe-name class that produced four false
# alarms in one session ([[lesson_probe_names_must_be_derived_not_typed]]).
```

```python
# ⛔ `repaint` IS STORED, NOT RECOMPUTED AT READ TIME.
# The badge a user was SHOWN when they saved, and the badge an alert was admitted
# under, must be the same fact — otherwise a linter improvement silently re-badges
# a definition somebody already armed, and the receipts claim becomes a moving
# target. A linter change therefore requires an explicit re-lint pass with its own
# notification, which is a Phase-E problem and is named here so it is not
# discovered there.
```

- [ ] **Step 4: The router — every handler declares its own gate**

```python
# ⛔ `require_paid` IS DECLARED PER HANDLER, NOT ON THE ROUTER.
# `api/routers/signature.py:174` defines its own and every route repeats it, and
# `test_a_free_user_is_refused_on_every_route` exists because a gate applied to two
# of three routes passes any single-route test. C Task 13 then MEASURED the failure:
# the shipped test hand-listed THREE paths while the router had FIVE, so two
# paid-gated endpoints rode with no coverage at all.
#
# ⛔ SO THE COVERAGE TEST IS DERIVED FROM `router.routes` WITH THE COUNT ASSERTED.
```

```python
def test_every_route_on_this_router_is_paid_gated_and_the_COUNT_is_asserted():
    routes = [r for r in user_definitions.router.routes if getattr(r, "methods", None)]
    assert len(routes) == EXPECTED_ROUTE_COUNT, (
        "a route was added or removed. Update the count DELIBERATELY — this "
        "assertion exists so a sixth route cannot ride in uncovered."
    )
    for r in routes:
        assert any(d.dependency is require_paid for d in r.dependant.dependencies), r.path
```

- [ ] **Step 5: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_user_definitions.py tests/test_alert_rev_migration.py -q
python tools/alert_replay.py --check
python tools/alert_replay.py --diff --mode-a forming --mode-b closed
```

**The measurement:** the append-only invariant (N saves → N rows, zero UPDATEs, proven by a trigger-free read of `sqlite_master` and a row count), the rev-bump biconditional in **both** directions, and the route count.
**The non-measurement assertion:** `--check` **`FIRE LOG MATCHES`, exit 0** and `--diff` **EVERY DIFFERENCE IS DECLARED, 31/31** — this task adds a store and **no address**. And `ALERT_EVAL_MODE` is still `"forming"`, verified **by AST**, not by grep (a grep said the ledger door was wired and it was three comments).

| id | mutation | must go red because |
|---|---|---|
| **M1** | `save` UPDATEs the newest row instead of appending | a `defId@version` pin that can change under its holder |
| **M2** | `rev` increments on every save | every rename force-migrates and eats a cycle; the user's alerts go quiet for a label change |
| **M3** | `rev` never increments | a maths change under an armed alert, which is the fabricated crossing C Task 7 exists to prevent |
| **M4** | drop `Depends(require_paid)` from ONE route | the per-handler gate — and the count assertion is what makes a *new* route land covered |
| **M5** | `repaint` recomputed at read time | a linter improvement silently re-badges a definition somebody already armed |

- [ ] **Step 6: Commit**

```bash
git add api/services/user_definitions.py api/routers/user_definitions.py tests/test_user_definitions.py
git commit -m "feat(builder): user definitions get their own append-only store, and an edit calls the force-migration" -- \
  api/services/user_definitions.py api/routers/user_definitions.py tests/test_user_definitions.py api/main.py
```

---

# Task 11: The builder — the first task a user can see, and the first that owes a pixel number

**Files:**
- Create: `app/src/components/chart/builder/BuilderSheet.jsx`
- Create: `app/src/components/chart/builder/FormulaField.jsx`
- Create: `app/src/components/chart/builder/BuilderSheet.module.css`
- Create: `app/src/hooks/useUserDefinitions.js`
- Modify: `app/src/components/chart/ChartToolbar.jsx` (one entry point)
- Modify: `tools/chart_parity_cases.json`
- Create: `app/src/components/chart/builder/BuilderSheet.test.jsx`

**Interfaces:**
- Consumes: `parseFormula`, `sentenceFor`, `lintRepaint`, `checkBudget`, `registerUserDefinitions`, `useUserDefinitions`.
- Produces: a stored definition, and an instance of it on the chart.

**SOLO.** 🔴 **First LIVE task.**

- [ ] **Step 1: Write the failing tests**

```jsx
  it('an invalid formula shows an ERROR CHIP and never a blank chart', () => {
    // Spec §6's ten instance states. State 4 is a red dot on the chip with the
    // message in the tooltip plus Retry and copy-diagnostic; NONE of the ten is
    // "the page died". And a parse failure is the NORMAL case here — the surface is
    // a text box a user is halfway through typing into.
    render(<BuilderSheet {...props} />)
    typeFormula('sma(close,')
    expect(screen.getByRole('alert')).toHaveTextContent(/unexpected|expected/i)
    expect(screen.queryByTestId('builder-crash')).toBeNull()
  })

  it('the READ-BACK is shown before Save, and Save is disabled until it is', () => {
    // The read-back is the contract with the user: what they confirm is what runs.
    typeFormula('sma(close, 20)')
    expect(screen.getByTestId('readback')).toHaveTextContent('the 20-bar average of close')
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('a `repaints` verdict BLOCKS save; `preview-repaints` requires an ACKNOWLEDGEMENT', () => {
    // ⛔ THE BADGE IS NOT DECORATION AND IT IS NOT THE USER'S TO SET. Spec §1.3:
    // repaint badges are machine-or-audit-assigned, NEVER self-disclosed. So the
    // linter's verdict is a gate on this form, not a label on it.
    typeFormula(REPAINTING_FORMULA)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('the builder does NOT write into chart_settings', () => {
    // The allow-list would destroy it on the next read (Task 10 measured this), and
    // a feature that silently forgets is worse than one that refuses.
    const spy = prefSpy()
    save()
    expect(spy.keysWritten).not.toContain('chart_settings')
  })
```

- [ ] **Step 2: Run, fail, implement**

Ride the shipped primitives, do not invent chrome (spec §1.5: *"Don't innovate on chrome"*):

- `Sheet variant="auto"` from `app/src/components/mobile/Sheet.jsx` — centered modal on desktop, fullscreen on phone.
- `UIcon` for every glyph. **No emoji** (`feedback_no_generic_emoji`).
- Breakpoints from `app/src/styles/breakpoints.css` — **only 640 and 1024**, never a new literal.
- `--tap-min: 44px` on every interactive element on touch.
- ⚠️ **`useMediaQuery` is STALE AT FIRST PAINT** — use CSS `@media` for layout and reserve `useIsTouch()` for click-triggered conditional rendering.
- Debounce the live preview at **250ms**, matching spec §6's settings-form rule, and **never** recompute on every keystroke.

- [ ] **Step 3: The pixel number — and what it can and cannot be**

⚠️ **A user-authored definition exists in NO committed base, so it CANNOT have an A/B `expect`.** That is not a weakness in the case; it is the honest shape, and it is exactly why C Task 14's three new definitions are **still `placeholder` cases** today (measured: 50 cases, 46 live, 4 placeholder). So:

```bash
# 1) the 46 live cases must not move. A builder is chrome; chrome must not move a chart.
python tools/chart_parity.py --base-a $A --base-b $B --repeat 5 \
    --dist-a .parity-dist-a --dist-b .parity-dist-b --expect 0

# 2) the new case, measured --same-build, with a LIVE fail-proof
python tools/chart_parity.py --same-build --repeat 5 --include-placeholders --cases ast_sma_only
python tools/chart_parity.py --same-build --repeat 5 --include-placeholders --cases ast_sma_only \
    --perturb-b-instances '{"period": 50}'      # MUST be non-zero
```

🔴 **The fail-proof is the gate, not the zero.** C Task 15's precedent: `avwap_session_only` read 0 px 5/5 and its perturbation moved **1,741 px**; `atr_bands_only` moved **8,353 px**. And `rs_line_spy_only` **REFUSED to report** — it raises `PaneLayoutAlertError: the chart has 2 panes, expected at least 3` rather than returning 0, identically with and without the perturbation. **A case that cannot report a difference must refuse, not return 0.** If the new case reads 0 both ways, it has measured nothing and must be reported as refusing, never as passing.

⚠️ Two preconditions C Task 13 recorded and this case inherits: **the parity route is paid-gated, so a 402 looks exactly like a quiet answer**, and an unstubbed fetch reports a **vacuous 0 px**. Assert the response body, not the pixel count, before trusting either.

⚠️ `--tolerance` is **forbidden**. `--expect` is an equality on **every** run, so variance is itself a failure. **Both build identities named**, served-vs-disk byte-compared on both bases.

⚠️ **`axisLabelWidthPx` is in the diffed manifest** (chart-level and per pane, from `IPriceScaleApi.width()`) and it must be **unchanged for the 46**. LWC shares one price-axis column across panes and OBV's wider labels cost **82,498 px** where every other indicator's sub-choices cost 2,540–5,316. A user formula returning values in the millions is exactly that shape, and the pixel count will not tell you why.

- [ ] **Step 4: Gate**

```bash
cd app && npm run build && npx vitest run    # build first — liveStyles.dist.test.js reads app/dist
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_user_definitions.py -q
python tools/alert_replay.py --check
python tools/ast_conformance.py --check
```

**The measurement:** 46 live cases at `--expect 0` over 5 runs with **the distinct set of all 230 values equal to `{0}`**; the new case's own number **and** its perturbation number; both build identities.
**The non-measurement assertion:** `--check` **`FIRE LOG MATCHES`, exit 0**, `--diff` **31/31** — a user can now DRAW their own indicator and **cannot alert on it**. That gap is Task 12's and it is deliberate.

| id | mutation | must go red because |
|---|---|---|
| **M1** | Save enabled on a `repaints` verdict | the badge is a gate, not a label (spec §1.3) |
| **M2** | the read-back rendered from `compute.source` instead of `sentenceFor(ast)` | the user confirms text, not maths |
| **M3** | the preview recomputes per keystroke | 250ms debounce is spec §6, and an interpreter on every keystroke is a frame budget nobody measured |
| **M4** | the builder writes `chart_settings.userDefinitions` | the allow-list destroys it on the next read and the feature silently forgets |

- [ ] **Step 5: Control audit + commit**

```bash
grep -rn "IND_OPTS\|ChartToolbar\|hardcoded" app/src/components/chart --include=*.jsx | grep -iE "test|spec"
```
⚠️ **`ChartToolbar` is mounted by exactly ONE module, `StockChart.jsx`, and takes no chart identity** — C Task 12 measured this when `instance_id`'s "one prop" hand-back turned out to be two props threaded through `StockChart.jsx`. Budget for that, or scope the builder to the workspace mount sites only and say which. Spec §5's mount-site scoping already permits it: full management UX on Charts workspace + TickerPopup, read-only rendering elsewhere.

⚠️ **Re-run `enumerationSites.test.js` and report the delta. Do NOT edit it** — Task 15 is the third and last writer.

```bash
git add app/src/components/chart/builder app/src/hooks/useUserDefinitions.js
git commit -m "feat(builder): a user can author an indicator, and the linter decides its badge" -- \
  app/src/components/chart/builder app/src/hooks/useUserDefinitions.js \
  app/src/components/chart/ChartToolbar.jsx tools/chart_parity_cases.json
```

---

# Task 12: ALERT ADMISSION — a fourth partition, an arm-time equality, and a ledger door that stays shut

**Files:**
- Create: `api/services/alert_user_series.py`
- Modify: `api/services/indicator_alert_evaluator.py`
- Modify: `api/services/indicator_alert_service.py` (one column: `def_source`)
- Create: `tests/test_alert_user_admission.py`
- Modify: `tests/test_alert_ledger_admission.py`

**Interfaces:**
- Consumes: `ast_interpret.interpret`, `ast_lint.lint_repaint`, `ast_budget.check_budget`, `user_definitions.get`.
- Produces:
  ```python
  USER_FUNCS: AddressFuncs          # the FOURTH partition
  def admit_user_definition(user_id, def_id, version, *, bars) -> dict   # RAISES on refusal
  ```

🔴 **SOLO AGAINST EVERYTHING. This is the only task in the phase permitted to let a user-authored formula reach a path that can send a notification.** B5 let only ONE commit move a pixel; C let only ONE task change when an alert fires; D lets only this one admit a user formula.

- [ ] **Step 1: Write the failing tests — the invariance first, the feature second**

```python
def test_the_frozen_INSTRUMENTS_are_byte_identical_after_the_fourth_partition():
    """🔴 THE GATE THAT MATTERS MOST, AND IT IS AN INVARIANCE, NOT A FEATURE.

    `tools/alert_replay.py::build_alert_grid` generates the frozen replay grid from
    `INDICATOR_FUNCS`. C Task 4 put SAR's events in a SEPARATE `EVENT_FUNCS` for
    exactly this reason — *growing that dict would have DESTROYED THE INSTRUMENT* —
    and C Task 10 then added `close` in a THIRD partition on the same argument.

    So `USER_FUNCS` is a FOURTH partition that `build_alert_grid` does not read, and
    the proof is that all three frozen numbers do not move.
    """
    assert len(ev.INDICATOR_FUNCS) == BASELINE_INDICATOR_FUNCS      # from Task 1's baseline
    assert replay_check() == "FIRE LOG MATCHES"                     # digest for digest; never a total
    assert replay_diff() == "EVERY DIFFERENCE IS DECLARED"          # 31/31


def test_a_user_definition_cannot_be_armed_until_BOTH_LANES_AGREE_on_the_actual_bars():
    """⭐ D-A2's runtime half, and the reason it is at ARM time and not per keystroke.

    A user formula has no committed golden fixture, and one cannot be added per user
    — `test_every_fixture_file_is_covered_by_a_test` globs the directory and demands
    the stem set equal the explicit CASES lists. So the 1e-9 contract is carried by
    the TABLE (Task 5) and confirmed ONCE, on this user's real bars, before this
    definition may ever produce a notification.

    ⚠️ THE MEASUREMENT IS A REFUSAL, NOT A FLAG. Asserting that `admitted_at` is
    null asserts the bookkeeping; asserting that NO NOTIFICATION LEFT THE BUILDING
    asserts the thing the user experiences.
    """
    with lane_disagreement(at_bar=200, by=1e-6):
        with pytest.raises(AdmissionRefused, match="the two lanes disagree at bar 200"):
            admit_user_definition(U, "u_abc", 1, bars=BARS)


def test_a_repainting_definition_cannot_be_armed_AT_ALL():
    with pytest.raises(AdmissionRefused, match="a repainting formula cannot arm an alert"):
        admit_user_definition(U, "u_repaints", 1, bars=BARS)


def test_a_user_definition_fire_is_REFUSED_at_the_ledger_door_and_the_refusal_RAISES():
    """🔴 SPEC §12: user publishing is out of scope *until the ledger can hold
    publishers accountable*. The receipts brand is UCT's own signals, and a
    user-authored signal in `signature_signals` cannot be un-published.

    ⛔ IT RAISES; it does not return False. C Task 9 measured why: a boolean refusal
    is a value a caller can ignore, and fire-once cannot survive one lie.

    ⛔ AND THE MESSAGE IS DISJOINT FROM EVERY OTHER REFUSAL IN THIS FILE. C Task 9's
    M1 found TWO gates sharing the phrase "forming-bar fires are not ledger-grade",
    so `pytest.raises(match=…)` STILL MATCHED WITH THE MODE LOCK DELETED — the test
    would have passed on a tree with the safety removed. Nineteenth vacuous gate on
    this branch, and only the mutation found it.
    """
    fire = a_real_closed_bar_fire_from_a_user_definition()
    assert fire is not None, "the refused fire must EXIST before it is refused"
    with pytest.raises(LedgerAdmissionRefused, match="user-authored definitions do not accrue receipts"):
        admit_alert_fire(fire)
    assert ledger_row_count() == 0
```

⚠️ **`test_a_user_definition_fire_is_REFUSED…` must be GREEN in the Step-2 red run** for the right reason — C Task 9's `test_the_forming_bar_fire_this_file_refuses_ACTUALLY_EXISTS` was green in its own red run and that is what proved the fire predated the door. Record which tests were green in the red run and why.

- [ ] **Step 2: Run and watch them fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_user_admission.py -q
```

- [ ] **Step 3: Implement**

```python
"""USER_FUNCS — the fourth address partition.

⭐ FOURTH, NOT WIDER. `INDICATOR_FUNCS` (28) is the frozen grid's generator;
`EVENT_FUNCS` (2) and `PRICE_FUNCS` (1) were each split off rather than folded in,
each time for the same measured reason. A user address is `u_<hex>.<plotKey>` and
`build_alert_grid` never sees it — which is why the frozen digests and the 31/31 hold
through this task, and why that invariance is this task's headline gate.

⛔ AND AN ADDRESS HERE IS PER-USER. Every other partition is global: `rsi` means the
same thing for everybody. `u_abc.out` means something only to one account, so
`resolve_address` must never be able to reach a user address without a user id, and
that is asserted in both directions.
"""
```

```python
def admit_user_definition(user_id, def_id, version, *, bars):
    """Three conditions, all MEASURED, none assumed. RAISES on any refusal.

      1. the stored linter verdict is `non-repainting`, or `preview-repaints` WITH a
         recorded acknowledgement — the badge is a gate, not a label (spec §1.3)
      2. the JS and Python lanes agree at 1e-9 on THESE bars — D-A2
      3. the budget holds at the version being armed — a definition admitted under
         an older, larger budget is a definition running at the old cost forever

    ⚠️ EACH REFUSAL MESSAGE IS DISJOINT BY CONSTRUCTION, and a test asserts the
    pairwise disjointness rather than trusting three authors to have been careful.
    """
```

- [ ] **Step 4: Prove QUIET through the REAL cycle**

C Task 11's shape, verbatim: spy at the transport, not at the evaluator, and drive `_run_one_cycle` for real.

```python
def test_a_user_alert_delivers_ONCE_and_never_reaches_the_ledger():
    """The whole task, as two numbers measured through the real cycle.

    ⚠️ SPY AT `deliver_alert_payload`, DOWNSTREAM OF THE GATE — C Task 11 measured
    12 cycles above threshold producing 12 evaluator calls and exactly 1 member
    notification, and it could only measure that because the spy sat below the
    thing under test.
    """
    ...
    assert asked == 12 and told == 1
    assert ledger_row_count() == 0
```

- [ ] **Step 5: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_alert_user_admission.py \
    tests/test_alert_ledger_admission.py tests/test_alert_fired_log.py \
    tests/test_indicator_alert_evaluator.py tests/test_alert_closed_bar.py \
    tests/test_alert_shadow.py tests/test_alert_replay.py -q
python tools/alert_replay.py --check
python tools/alert_replay.py --diff --mode-a forming --mode-b closed
python tools/ast_conformance.py --check
```

**The measurement:** `len(INDICATOR_FUNCS)` **unchanged**; `--check` **`FIRE LOG MATCHES`, exit 0, digest for digest**; `--diff` **EVERY DIFFERENCE IS DECLARED, 31/31**; the delivered-once count through the real cycle; the ledger row count at **0** with the refused fire proven to **exist** first.
**The non-measurement assertion:** `ALERT_EVAL_MODE` unchanged, **read by AST** — one top-level assignment, and this task did not write it. `admit_alert_fire`'s call-site count unchanged, **read by AST** — a grep says 3 and all three are prose.

| id | mutation | must go red because |
|---|---|---|
| **M1** | register `USER_FUNCS`' entries into `INDICATOR_FUNCS` | the frozen grid changes shape and the instrument is destroyed — this is the mutation the whole task is built around |
| **M2** | `admit_alert_fire` returns `False` for a user definition instead of raising | a boolean refusal is a value a caller can ignore; fire-once cannot survive one lie |
| **M3** | two admission refusals share a message fragment | C Task 9's M1 — `raises(match=…)` matched with the safety deleted |
| **M4** | drop the arm-time cross-lane check | a user's alert fires on the server and not on their chart, forever, with nothing to say so |
| **M5** | `resolve_address` reaches a user address without a user id | one account's formula answering for another |
| **M6** | admit a `preview-repaints` definition without the acknowledgement | the badge stops being a gate |

- [ ] **Step 6: Control audit + commit**

```bash
grep -rn "INDICATOR_FUNCS\|build_alert_grid\|partition" api/ tools/ tests/ --include=*.py
```
The anti-fork rail C Task 6 repaired — *it survived because it iterated the same dict the bug was in* — must now iterate **four** tables. Verify it does, and that its non-vacuity floor is derived rather than listed.

⚠️ **Re-run `enumerationSites.test.js`, report the delta, do NOT edit it.**

```bash
git add api/services/alert_user_series.py tests/test_alert_user_admission.py
git commit -m "feat(alerts): user formulas can alert, through a fourth partition, and the ledger door stays shut" -- \
  api/services/alert_user_series.py api/services/indicator_alert_evaluator.py \
  api/services/indicator_alert_service.py tests/test_alert_user_admission.py \
  tests/test_alert_ledger_admission.py
```

---

# Task 13: The NL→AST concierge — it emits trees, it never writes the sentence, and it knows how to refuse

**Files:**
- Create: `api/services/definition_concierge.py`
- Create: `tests/test_definition_concierge.py`
- Create: `app/src/components/chart/builder/ConciergeBox.jsx`
- Create: `app/src/components/chart/builder/ConciergeBox.test.jsx`
- Modify: `api/routers/user_definitions.py` (one route, its own `Depends(require_paid)`)

**Interfaces:**
- Consumes: `engine._get_anthropic_client()`, `catalyst.cost_guard.{estimate_cost, may_synthesize, record}`, `ast_table.TABLE`, `ast_lint.lint_repaint`, `ast_interpret.interpret`.
- Produces:
  ```python
  def propose(prompt: str, *, user_id: int, bars: list[dict]) -> dict
  # {ok: True, ast, source, sentence, repaint, tokens} | {ok: False, reason}
  ```

**SOLO.**

- [ ] **Step 1: Write the failing tests**

```python
def test_the_TOOL_SCHEMA_is_generated_from_the_manifest_and_lists_every_arity():
    """⭐ THE CLOSED TABLE IS THE TOOL SCHEMA, so an out-of-table call is a SCHEMA
    VIOLATION at the API boundary rather than a runtime surprise.

    This is `grade_ticker`'s ruling applied to a grammar: *decisiveness is
    STRUCTURAL, not prompted*. A prompt that ASKS a model to stay inside a
    vocabulary is a request; a schema that enumerates the vocabulary is a
    constraint.

    ⚠️ DERIVED, both directions. A hand-written schema is a third copy of the table
    and it would drift the first time a function was added — silently, because every
    existing test would stay green.
    """
    schema = concierge.tool_schema()
    assert set(schema["functions"]) == set(ast_table.TABLE["functions"])
    for name, spec in ast_table.TABLE["functions"].items():
        assert schema["functions"][name]["arity"] == len(spec["args"])


def test_a_proposal_that_LINTS_repainting_gets_ONE_repair_and_then_a_REFUSAL():
    """⭐ THE PIPELINE IS generate -> parse -> lint -> compute -> read back, and the
    MODEL sees the linter's verdict BEFORE THE USER DOES.

    An LLM that emits a formula the linter then brands `repaints` is a bad
    experience. One that ships it with the badge attached is worse, because the badge
    reads as a disclosure and the brand's whole claim is that badges are
    machine-assigned rather than self-disclosed (spec §1.3).

    ⛔ AND THE SECOND FAILURE IS A REFUSAL, NOT A THIRD ATTEMPT. An unbounded repair
    loop is an unbounded bill and an unbounded wait, and `cost_guard` is a cap on
    spend, not on patience.
    """
    with model_emitting([REPAINTING_AST, REPAINTING_AST]) as calls:
        res = concierge.propose("show me tomorrow's close", user_id=U, bars=BARS)
    assert len(calls) == 2, "the repair attempt did not happen, or happened twice"
    assert res["ok"] is False
    assert "repaint" in res["reason"].lower()
    assert "ast" not in res, "a refusal must not hand back a formula anyway"


def test_a_proposal_that_does_not_PARSE_is_refused_and_never_stored():
    """⛔ THE MODEL'S OUTPUT IS UNTRUSTED INPUT, exactly like the text box. It goes
    through the SAME `parseFormula` / `check_budget` / `lint_repaint` path a typed
    formula does — there is no privileged lane for a machine-written formula, and a
    second path would be a second set of guards to keep in step.
    """


def test_the_concierge_NEVER_produces_the_sentence():
    """⛔ THE READ-BACK COMES FROM `sentenceFor(ast)` AND FROM NOWHERE ELSE.

    A model-written summary of a model-written formula is two guesses agreeing, and
    a user has no way to tell that pair apart from a correct one. So this is asserted
    STRUCTURALLY: the module's own AST is walked and it must contain no call that
    could return prose from the model response into the `sentence` field.
    """
    tree = ast.parse(pathlib.Path(concierge.__file__).read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "propose")
    assigns = [n for n in ast.walk(fn) if isinstance(n, ast.Assign)]
    sentence_sources = [src_of(a) for a in assigns if targets(a) == ["sentence"]]
    assert sentence_sources == ["sentence_for(ast_obj)"], (
        f"`sentence` was assigned from {sentence_sources} — the read-back must be "
        "derived from the tree, never from the model's prose"
    )


def test_the_cost_guard_is_CONSULTED_before_the_call_and_RECORDED_after():
    """⚠️ THE EXISTING SURFACE, CALLED — not a new one.
    `cost_guard.may_synthesize(date)` / `estimate_cost(model, in, out)` /
    `record(...)`. Its unknown-model rule is load-bearing: an unrecognised model is
    priced at the PRICIEST known rate, never $0, because a $0 estimate makes every
    cap unenforceable.

    Plus a PER-USER daily cap on top of the global one — the global cap protects the
    bill; the per-user cap protects one account from spending everyone else's.
    """
```

- [ ] **Step 2: Run and watch them fail**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_concierge.py -q
```

- [ ] **Step 3: Implement — reuse the shipped idioms, do not re-derive them**

```python
"""NL -> AST. The AI door.

⭐ WHAT IT MAY EMIT: a tree over the closed table, and nothing else. The tool schema
is GENERATED from `closedTable.json`, so an out-of-table call is refused at the API
boundary.

⛔ WHAT IT MAY NOT EMIT: prose describing an indicator, a `meta.repaint` value, a
`compute.budget`, a `tier`, an id, or the read-back sentence. Every one of those is
assigned by something deterministic, and a model that could set any of them could
set it wrong in a way that reads as authoritative.

⛔ HOW IT REFUSES: `{ok: False, reason: "<plain English>"}` — the `brain_service`
shape, which never raises and keeps `reason` (a legitimate "I can't answer that")
DISTINCT from `error` (a caught exception). A refusal hands back NO formula: an
`ast` beside `ok: False` is a formula a caller will eventually use.

⚠️ JSON EXTRACTION reuses `catalyst.synthesize`'s balanced-brace scanner rather than
a fresh one — a model wrapping its object in fences or appending prose is the normal
case and that scanner is the one this repo has already hardened. Same for the
temperature-retry: newer models reject `temperature` and the shipped call pops it
and retries once.
"""
```

- [ ] **Step 4: Gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_concierge.py -q
cd app && npx vitest run src/components/chart/builder/
cd .. && python tools/alert_replay.py --check
```

**The measurement:** the tool schema derived from the manifest in both directions; the repair loop bounded at exactly **one** retry, measured by call count; the refusal shape; the cost path consulted before and recorded after, with a per-user cap.
**The non-measurement assertion:** the concierge reaches the interpreter, the linter and the budget through **the same functions a typed formula does** — asserted by an import/AST scan showing no second validation path. And `--check` is still **`FIRE LOG MATCHES`, exit 0**.

| id | mutation | must go red because |
|---|---|---|
| **M1** | `sentence` assigned from the model response | ⭐ **the mutation this task exists for** — two guesses agreeing, and the structural AST test is the only thing that can see it |
| **M2** | the repair loop runs until clean | an unbounded bill and an unbounded wait |
| **M3** | a refusal returns `{ok: False, ast: …}` | a formula beside a refusal is a formula somebody uses |
| **M4** | the tool schema hand-lists the functions | a third copy of the table, drifting silently |
| **M5** | `may_synthesize` consulted **after** the call | a cap checked after the spend is not a cap |
| **M6** | the concierge's output skips `check_budget` | a privileged lane for machine-written formulas |

- [ ] **Step 5: Control audit + commit**

```bash
grep -rn "cost_guard\|may_synthesize\|_extract_first_json_object" api/ tests/ --include=*.py
```
`cost_guard`'s `_HARD_CAP_TRIPPED` and `_SOFT_CAP_LOGGED_FOR_DATE` are **process-local module state**, and the web pod is deliberately ONE uvicorn process. That is correct today and is the first thing to break on scale-out — the same class `CLAUDE.md` already lists for the broker sync's `_locks`. **Name it in the report; do not fix it here.**

```bash
git add api/services/definition_concierge.py tests/test_definition_concierge.py \
        app/src/components/chart/builder/ConciergeBox.jsx app/src/components/chart/builder/ConciergeBox.test.jsx
git commit -m "feat(builder): the concierge emits trees, and the sentence is still the tree's" -- \
  api/services/definition_concierge.py tests/test_definition_concierge.py \
  app/src/components/chart/builder api/routers/user_definitions.py
```

---

# Task 14: Tiering — everything is paid, and the gate is derived from the routes

**Files:**
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (`meta.tier` on the ast lane)
- Modify: `api/routers/user_definitions.py`
- Create: `tests/test_user_definitions_auth.py`
- Modify: `app/src/components/AuthGuard.jsx` / `FREE_PAGES` **only if measured to need it**

**Interfaces:**
- Consumes: `is_paid_user`, `get_current_user_with_plan` from `api/middleware/auth_middleware.py`.
- Produces: nothing new — a gate, and its coverage proof.

**SOLO.**

- [ ] **Step 1: Write the failing tests**

```python
def test_a_free_user_is_refused_on_EVERY_route_of_this_router():
    """🔴 THE MEASURED FAILURE THIS COPIES ITS SHAPE FROM.
    C Task 13 dropped `Depends(require_paid)` from `/confluence` and THE SHIPPED
    TEST WAS GREEN: it hand-listed THREE paths while the router had FIVE, so
    `/confluence` and `/confluence-scan` were never checked at all.

    So the path set is DERIVED from `router.routes` and the COUNT is asserted, which
    is what makes a SIXTH route land covered instead of riding in.
    """
    routes = [r for r in ud.router.routes if getattr(r, "methods", None)]
    assert len(routes) == EXPECTED_ROUTE_COUNT
    for r in routes:
        for method in sorted(r.methods - {"HEAD", "OPTIONS"}):
            resp = free_client.request(method, r.path.replace("{def_id}", "u_abc"))
            assert resp.status_code == 402, f"{method} {r.path} answered a free user"


def test_the_owner_ruling_is_carried_as_a_TIER_and_the_ast_lane_is_premium():
    """✅ OWNER RULING 2026-08-06: *"everything is paid, almost nothing is accessible
    for free."*

    It is already applied once and CONFIRMED: C Task 13 set `rsLine.meta.tier` to
    `premium` because its lane declares `Depends(require_paid)`, and the owner
    confirmed it rather than waiving it. The ast lane declares the same dependency,
    so it carries the same tier by the same argument.

    ⚠️ AND `nativeRegistry.js:112`'s SHARED DEFAULT IS `tier: 'free'`. Sixteen natives
    inherit it. Whether THAT is still the owner's intent is a separate question with
    a paywall blast radius, and it is NOT this task's to take — it is named in the
    findings and goes to the owner with the repaint question.
    """
```

- [ ] **Step 2: Run, fail, implement**

Define `require_paid` **locally, following `api/routers/signature.py:174`** — that is the shipped pattern (it is defined three times, per-router, each with its own 402 message) and inventing a shared one here would change two other routers' behaviour as a side effect of a Phase D task.

- [ ] **Step 3: Gate**

**The measurement:** the route count, and a 402 on **every** (method, path) pair for a free user, derived.
**The non-measurement assertion:** no existing route's gate changed — `git diff HEAD -- api/routers/` touches only `user_definitions.py`.

| id | mutation | must go red because |
|---|---|---|
| **M1** | drop `Depends(require_paid)` from one route | the per-handler gate; and only the derived path set can see it |
| **M2** | `EXPECTED_ROUTE_COUNT` bumped without a new assertion | a count that moves silently is not a count |
| **M3** | the ast lane's `meta.tier` set `free` | the owner ruling, confirmed once already |

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(builder): everything is paid, and the gate is derived from the routes" -- \
  api/routers/user_definitions.py tests/test_user_definitions_auth.py \
  app/src/components/chart/engine/nativeRegistry.js
```

---

# Task 15: The whole-phase gate

**Files:**
- Modify: `app/src/components/chart/engine/__tests__/enumerationSites.test.js` (**third and last writer**)
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (§2 D row, §3 schema comments, §3.1, §7, §11)
- Modify: `docs/runbooks/ast-conformance-gate.md`
- Modify: `docs/decisions/2026-08-06-machine-repaint-linter.md`
- Create: `.superpowers/sdd/2026-08-06-phase-d-builder/progress.md` entries

- [ ] **Step 1: The ledger, per site, read individually**

`SITE_COUNT` and the partition, with **every row dumped and read one at a time**. The partition is a **histogram**: moving one site between fates fails it, but **swapping two fates preserves every count and passes**. Only the sorted `file::region → fate` literal refuses a permutation, and it must be **regenerated from `LEDGER`**, never hand-edited.

Expected end state `{keep: 9}` — the closed table added at Task 1, no `D` fate created because **no D row is scheduled to retire**. ⚠️ **If that is what you find, say so as a measurement.** A phase that creates a fate letter it never spends is a phase that leaves a control to rot; C emptied its `C` bucket and D should never open a `D` one.

⚠️ Then decide the `_INDICATOR_ALIASES` row again, **explicitly**. C Task 15 re-fated it `keep` on a measurement (its only resolver is `_INDICATOR_ALIASES.get(raw, raw.replace(" ", ""))`, and deleting the map changes **nine of eleven** answers). D changes nothing about that resolver, so the fate should stand — **verify it by re-running the measurement, not by citing the record.**

- [ ] **Step 2: The invariants, each MEASURED, not asserted from memory**

Write a throwaway suite, run it green, record the numbers, then delete it — every claim below is also held by a suite that stays.

- **the escape census is 0 / 0, and its unguarded control is non-zero** — the phase's headline pair
- the cross-lane conformance log reproduces per-case, digest for digest
- the must-repaint corpus is 4/4 with a non-degenerate clean/dirty ratio
- **`--check` printing the literal `FIRE LOG MATCHES` at exit 0** — ⛔ **not a total; there has never been one to assert** — and `--diff` **EVERY DIFFERENCE IS DECLARED, 31/31**
- **`ALERT_EVAL_MODE` — read by AST, one top-level assignment.** ⚠️ **Whatever it says, D did not write it.** If Phase C Task 8 has flipped it to `"closed"` by now, that is C's, and this gate reports the value rather than expecting one
- **`admit_alert_fire` — read by AST.** A grep says 3 and all three are prose
- `len(INDICATOR_FUNCS)` unchanged from Task 1's baseline; `USER_FUNCS` is a separate table `build_alert_grid` does not read
- both golden lanes green at 1e-9; **no fixture reseeded** (`git diff --stat origin/master -- tests/fixtures/indicators/` shows only ADDED files)
- `mergeChartSettings` still a hard allow-list at both levels; `mergeSettingsOverride` still passes primitives through
- series still POOLED and REUSED (#2049); `merge()` still skips `undefined`; lightweight-charts still pinned exact at 5.2.0; **jsep pinned exact**
- ⚠️ **`JSON.stringify` DROPS `undefined`** — any fixture asserting an absent key must round-trip through real JSON, or it is vacuous

- [ ] **Step 3: The parity number**

```bash
python tools/chart_parity.py --base-a $A --base-b $B --repeat 5 \
    --dist-a .parity-dist-a --dist-b .parity-dist-b --expect 0
python tools/chart_parity.py --same-build --repeat 5 --include-placeholders --cases ast_sma_only
```

All 46 pre-existing cases at their recorded `expect`, **both build identities named**, served-vs-disk byte-compared on both bases. `--tolerance` is **forbidden**; `--expect` is an equality on every run, so **variance is itself a failure** — report the **distinct set of all 230 values**, not the mean.

- [ ] **Step 4: The §6 table — what each zero does NOT cover**

C Task 15 wrote one and it is the model. **The parity route mounts no builder, opens no concierge, runs no interpreter and registers no `ast` definition. A total regression of every user-visible thing in this plan would report 0 changed pixels.** So the runbook gets, per deliverable, the suite that is the real gate:

| deliverable | the REAL gate | what the pixel gate says about it |
|---|---|---|
| the parser | `parse.test.js` + the escape corpus | nothing |
| the two interpreters | `ast_conformance.py --check`, per-case digests at 1e-9 | nothing |
| the closed table | `--escapes` = 0 **with `--escapes --unguarded` non-zero** | nothing |
| budgets | `budget.test.js` + `test_ast_budget.py`, refusal at the boundary | nothing |
| the repaint linter | `must_repaint.json` 4/4 + the shipped-definition verdict table | nothing |
| the `ast` lane registering | `defSchema.test.js`, `nativeRegistry.test.js`, `REGISTRY_SIZES` | nothing |
| the read-back | the sentence round-trip **and its argument-swap control** | nothing |
| persistence + rev migration | `test_user_definitions.py` + `test_alert_rev_migration.py` | nothing |
| the builder UI | `BuilderSheet.test.jsx` + `ast_sma_only` `--same-build` **with its fail-proof** | 46 live cases must not move — the only thing it does say |
| alert admission | `--check` `FIRE LOG MATCHES` at exit 0 + `--diff` 31/31 + `len(INDICATOR_FUNCS)` unchanged | nothing |
| the concierge | `test_definition_concierge.py`, the structural `sentence` assertion | nothing |
| tiering | the derived per-route 402 sweep with the count asserted | nothing |

- [ ] **Step 5: Spec reconciliation**

Update **§2's D row** to what shipped. Give `compute.budget` its real meaning in **§3**. Strike **§3.1**'s `supportedKinds` sentence's implication that the filter exists (it did not until Task 8) and say what it filters now. Record in **§11** the five adjudications above (D-A1 one parser, D-A2 the table as the 1e-9 unit, D-A3 the store, D-A4 the fourth partition, D-A5 the concierge's limits) with the measurement each rests on.

⚠️ **Do not restate any count the ledger test asserts.** A copy of a test's expectation in a doc is a control that rots green, and this spec has been the site of that exact rot **twice** — and it happened again in real time during Phase C, when four doc sites still cited 691,195 after the fire log was re-frozen at 685,193 while every gate stayed green. 🔴 **AND THEN THIS PLAN COMMITTED THE SIN IT NAMES, SEVENTEEN LINES BELOW ITS OWN WARNING.** It carried `685,193` in **17 places**; Task 14 measured `--check` printing **22 blocks summing to 1,153,245** and the controller confirmed the shape live. The figure was a sum over an **8-block / 4-fixture** corpus that had already grown — stale on the day it was typed here, and green in every gate throughout, because **the gate was never the total**. Task 15 struck all 17 and replaced them with the exit-code form. ⛔ Nobody may "fix" code to make a total match.

⚠️ **Two questions leave this phase OPEN, deliberately, and §11 must say so** rather than resolve them: the `ichimoku` badge (Task 7's measurement) and whether the §7 visual-budget linter is in D's scope at all. Both are owner calls and neither is a task's to take.

- [ ] **Step 6: Final gauntlet + counts**

```bash
python tools/phase_d_gauntlet.py
cd app && npm run build && npx vitest run
cd .. && PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q
```
Record the counts. **Read every exit code without a pipe** — `| tail` reported `EXIT=0` over a real failure on this branch, and `rc=$?` after a pipeline assignment read `sed`'s status.

- [ ] **Step 7: Commit**

```bash
git commit -m "docs(builder): Phase D closes -- the table, the linter, and what the zero does not cover" -- \
  app/src/components/chart/engine/__tests__/enumerationSites.test.js \
  docs/superpowers/specs/2026-07-31-indicator-platform-design.md \
  docs/runbooks/ast-conformance-gate.md docs/decisions/2026-08-06-machine-repaint-linter.md
```

---

## Self-review

**Spec coverage.** §2's D row maps as: **jsep AST** → T3 · **closed-table interpreter** → T4 (JS) + T5 (Python) + T6 (the proof it is closed) · **sentence read-back** → T9 · **machine repaint linter** → T7 · **NL→AST concierge** → T13. §3's schema: `compute.kind: 'ast'` → T8 · `compute.budget` un-reserved → T6/T8 · `meta.repaint` machine-assigned → T7 · `version` vs `compute.rev` for user edits → T10 · `$<inputKey>` substitution unchanged (an AST reads inputs through `scope`, not through `$refs`, and T4 asserts the two do not alias). §3.1's unknown-field policy: `supportedKinds` → T8. §4's compute contract: columnar Float64Arrays, NaN-padded to bar count, no rounding inside compute → T4/T5. §5's registry and instance model: `AST_DEFS` + `REGISTRY_SIZES` → T8; instances unchanged. §6's UX contract: error chips, 250ms debounce, `Sheet variant="auto"`, 44px targets → T11. §7's `zones` and the **visual-budget linter** → **NOT in this plan; see Contradiction 6.** §8's alerts: user definitions alertable → T12; ledger door shut for them → T12. §9's gates: shared golden fixtures read by both lanes → T5; error isolation → T11; perf → T6's budget caps derived from §5's existing numbers.

**Deliberately NOT in this plan, and why:**
- **`volumeProfile`'s `compute.kind: 'primitive'` lane.** §11 assigns it to "C/D"; C explicitly declined it and handed it to D; §2's D row does not list it. It is a *rendering* lane for a canvas overlay and shares no mechanism with anything D builds — folding it in would put an unrelated pixel risk inside the frame of the phase that first lets user input reach a compute path. **It is named in Contradiction 7 and needs an owner call, not a task.**
- **`compute.kind: 'script'`.** §0 kills the scripting tier as a product and keeps the sandbox as AI plumbing. D's concierge emits **ASTs**, not scripts, so the `script` lane needs no runtime — and T8 makes that explicit by declaring it a *supported-kinds* exclusion rather than removing it from `COMPUTE_KINDS`.
- **An `offset` / `ref` form in the table.** T3's manifest omits it on purpose so the repaint linter is a tree sum rather than a dataflow analysis, and T7's corpus already holds the two cases that answer the v2 question when it is asked.
- **Re-badging `ichimoku`.** T7 measures; the owner decides.
- **Publishing / sharing a user definition.** §12 puts marketplace and user publishing out of scope until the ledger can hold publishers accountable.

**Placeholder scan.** No step says "TBD", "add appropriate error handling", "write tests for the above" or "similar to Task N". Every code step carries the actual code or the actual command. Every mutation table names *why* the mutation must kill, and the three mutations whose lethality is **not** certain (T4 M1, T7 M5, T8 M3) say so explicitly and name what to verify first — because an unverified mutation reported as a kill is the "survivor may be a semantic no-op" trap.

**Type consistency.** `parseFormula` → `{ok, ast|error}` in T3 and consumed with that shape in T4, T11, T13. `canonicalise`/`astHash` named identically in T3, T8, T9, T10. `interpret(ast, bars, inputs)` in T4 and `interpret(ast, bars, inputs)` in T5 — same order, same names, deliberately. `lintRepaint(ast, opts)` / `lint_repaint(ast, opts)` return the same three-value vocabulary from §3's `REPAINT_MODES`. `checkBudget(ast, budget) -> {ok, error}` (JS, returns) vs `check_budget(ast, budget) -> None` (Python, raises) — **different on purpose**, and each task states the reason: the JS side feeds a form that must render an error, the Python side feeds an admission that must not be ignorable. `USER_FUNCS` matches the existing `AddressFuncs` type used by `INDICATOR_FUNCS` / `EVENT_FUNCS` / `PRICE_FUNCS`. `REGISTRY_SIZES` keys (`native`, `server`, `ast`, `total`) match `SUPPORTED_KINDS` exactly.

---

## Contradictions found between the spec, the code and the ledgers

Each with the call taken and the measurement it rests on.

1. **§3 says `meta.repaint` is "Phase A/B: audited metadata (UCT-authored only)". It is not audited — it is a DEFAULT.** Measured: `nativeRegistry.js:112` sets `repaint: 'non-repainting'` inside one shared helper, and **no native definition overrides it**; a `grep -o "repaint: '[a-z-]*'"` over the file returns exactly **two** hits — that default and `rsLine`'s own. **Call:** the spec's sentence describes a process that did not happen. Task 1 records it; Task 7 measures the consequence; Task 15 corrects §3 to say the badge was a default and became machine-assigned at D.

2. **And the default is contradicted by shipped code.** `compute_ichimoku_raw` writes bar `i`'s close to index `i - kijun_period` (mirrored in `computeIchimoku`, documented in both as a preserved quirk, pinned by `TRAILING_PAD = {("ichimoku_9_26_52", "chikou"): 26}`). So the plotted point at a historical index moves while the newest bar forms, and §4's own rule — *"Bar-close outputs must be reproducible from history alone"* — does not hold for that column at the moment it is drawn. **Call:** Task 7 measures it and writes it into the record. **The badge is NOT changed by this plan.** `ichimoku` is live in the catalog and a repaint badge is a brand claim. ⚠️ **And it should go to the owner together with C's open `ichimoku.chikou` question** — that alert can never fire closed-bar and stops permanently at the Phase C cutover. Two open owner questions, one column, one message.

3. **§3.1 says "Catalog fetch filters by client `supportedKinds`". That filter DOES NOT EXIST.** Measured: two prose mentions in the entire repo — `defSchema.js:103` and the spec line itself — and **zero identifiers** in `app/src` or `api/`. **Call:** Task 8 builds it, because D is the first phase in which a client can meet a kind it cannot run. `defSchema.js:103`'s comment is a description of a mechanism nobody wrote, sitting in the file whose job is to fail closed, and it is retired in the commit that makes it true.

4. **§3's `"budget": null // reserved` is no longer reserved and `defSchema` only checks its shape.** Measured: `validateCompute` accepts null-or-plain-object and the comment says *"the caps themselves have no meaning yet."* **Call:** Task 6 gives it meaning with caps derived from numbers already in the system (§5's ≤8 panes, the 5,000-bar cap), and Task 8 rewrites the comment in the commit that gives it a consumer.

5. **§2's D row does not say what C changed for D.** C's own row had to be rewritten at the end of that phase for exactly this reason. D inherits five things the row is silent about: the fourth-partition precedent and *why* it exists, the `compute.rev` force-migration machinery, a 31-address catalog across 16 groups, the frozen fire log's per-block digests, and the rule that `build_alert_grid` reads `INDICATOR_FUNCS` and must not be grown. **Call:** Task 15 rewrites the row.

6. 🔴 **§2 and §7 disagree about D's scope.** §2's D row lists four deliverables. §7's "Institutional rules" paragraph says they are *"machine-checkable, become the visual linter in D"* — a **second linter** (≤2 hues + 1 neutral per indicator, ≤4 per chart, OKLCH L 0.55–0.70, steady fills ≤16%, glow decays) that the roadmap row does not mention and no task here implements. **Call: NOT in this plan, and flagged as an owner call.** It is a genuinely separable deliverable with its own corpus and its own gate, it shares no mechanism with the AST work, and folding an unscoped second linter into the phase that first admits user input would put two unrelated risks inside one frame. **This is the one scope question I could not resolve without the owner.**

7. **`volumeProfile`'s `primitive` lane is assigned to a phase by a parenthetical and to no task by anything.** §11's row says it gets one *"when one exists (C/D, alongside `zones`/`bgband`)"*; C's self-review explicitly declined it and handed it to D; §2's D row does not list it. Measured: `nativeRegistry.CARVED_OUT_INDICATOR_KEYS` still holds exactly `volumeProfile`. **Call:** not in this plan (see the scoping note above), and §11's row is corrected at Task 15 to name a phase or name nobody — a fate whose condition keeps arriving without anyone acting is a control that rots green, which is exactly why C had to re-adjudicate `_INDICATOR_ALIASES`.

8. **The brief's "31 addresses / 14 catalog groups" mixes two numbers.** Measured: `len(INDICATOR_FUNCS) == 28` in **14** groups; plus `EVENT_FUNCS` (2, in the `sar` group) and `PRICE_FUNCS` (1, in the `close` group) gives **31 addresses across 16 groups**, and `alert_catalog()` returns 16. **Call:** the plan carries **31 / 16**, and Task 1 re-measures. A plan carrying 14 would have written an assertion that fails on its first run for the wrong reason — the same trap the "25 addresses" figure set for Phase C.

9. **`api/services/signature/registry_defs.SCHEMA_VERSION` is a second schema-version constant published on the wire.** Two authorities over one contract. **Call:** Task 8 cross-asserts them; neither is deleted, because the server module legitimately needs its own symbol.

10. **Phase C's §2 row may be stale by the time D executes.** It says `ALERT_EVAL_MODE` is still `"forming"` and Task 8 flips it — true when written, and the owner **authorised** that flip on 2026-08-06 ~18:00 ET gated on three shadow sessions (the soak is live and collecting: 31 armed, 4,560 rows in `alert_shadow_fires`). **Call:** **D never states the mode and never writes it.** Task 15's gate *reports* what the AST reads rather than expecting a value, which is the only form of that check that survives C Task 8 landing at any time during this phase.

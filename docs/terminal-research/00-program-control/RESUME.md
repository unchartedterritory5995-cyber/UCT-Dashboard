# RESUME — cold-start entry point (Document B §3A)

**Last verified against git: docs branch `terminal-research` @ this commit; production tree `origin/master` @ `68cf6924f` (2026-09-12). Rail PASS.**

---

# ⛔⛔ COLD START — WHERE THINGS ACTUALLY ARE, 2026-09-12 (SATURDAY)

**This block supersedes everything below it. Read it, then `LEDGER.md`.**

## S7 `price-level` — CP3, DARK, **ARMED**, running from Monday's open

| | |
|---|---|
| state | **Checkpoints 1–3 merged to master.** Dark: no delivery, no flip, no legacy change. |
| cohort | **ADMIN-ROLE ACCOUNTS ONLY**, via a read-only projection of `watchlist_alerts`. CP4 (all members) needs its own approval line **after** five sessions of admin data. |
| armed | `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1` on `web`, **2026-09-12 14:58:47 UTC**. Boot line verified: `[startup] S7 price-level DARK comparison ENABLED (every minute, weekdays 09:00-16:59 ET, admin cohort, no delivery)`. |
| verdict gate | **five full trading sessions**, per predicate. `verdict_ready` is its own field — *"not enough data yet"* is never rendered as *"they agree"*. |
| read it | `railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py"` |
| Monday liveness | same tool, `--ticking`. Exit 0 = ticking, 1 = stalled/never started. |

⛔⛔ **THE COLUMN THAT MATTERS IS `legacy_only`. `new_only` WILL BE ~0 AND THAT IS NOT A FINDING.**

- **`legacy_only`** — legacy fires on a LEVEL TEST (`>=`/`<=`), the new rule needs a TRANSITION. An
  alert armed while price is already through its level fires immediately on the legacy path and
  **never** on the dark one. **Those are the members who lose an alert at the flip.** This is the
  number the flip decision rests on.
- **`new_only`** — **STRUCTURALLY INVISIBLE, not absent.** Legacy is one-shot (`_trigger_alert` sets
  `is_active = 0`) and the projection reads only active rows, so the moment legacy fires the row
  leaves the comparison. The report sees the FIRST divergence per predicate and **cannot see a
  second crossing at all.** ⛔ Do not size CP4 or the flip against a `new_only` of zero — it is a
  thing this instrument cannot observe. Rail:
  `test_KNOWN_LIMIT_the_one_shot_divergence_is_invisible_to_a_projection`.
- **`not_comparable`** — span time we deliberately refuse to score (an anchor rewrite resets the
  clock). Never folded into a denominator; folding it in would make *moving a trendline* look like
  agreement.

⚠️ **A report run before Monday says `NO DATA`, and that is correct.** The cron is `mon-fri
09:00–16:59 ET`, so there is no heartbeat row and no span over the weekend. `NO DATA` is the
non-vacuity control doing its job, not a failed arming.

### ⛔ WHY `price_level.py` IS NOT "BEHAVIOUR-CHANGING" YET — and the test that will say when it is

The CP3 ruling said the module becomes BEHAVIOUR-CHANGING under the flow-worker rail from CP3 on.
**Measured after the wiring landed, it is still `reachable=False`** — `api/services/alerts.py`
imports `receipts` and `document_arrival` **by name**, not the package, and `register()` is wired in
`api/main.py`, which is the **WEB** entry and is not in flow-worker's closure at all. The earlier
claim was a generalisation from one reachable sibling, published in the ledger **and** restated in
the marker file, where the second copy read as corroboration of the first.

⭐ So the reclassification is **deferred and conditional**, and it is a **rail, not a sentence**:

```
tests/test_flow_worker_watch_coverage.py::test_price_level_is_STILL_OUTSIDE_flow_workers_closure
```

It fails **by name** the day anything in flow-worker's closure imports `price_level`, and prints the
reclassification instruction in its failure message. It will fire on one of two foreseeable events:
**the flip** (an evaluator on a worker tick), or anything under `api/services/alerts.py`'s closure
naming `price_level`. ⛔ Until it fires, classifying a `price_level` change as ADDITIVE is correct,
and classifying it as BEHAVIOUR-CHANGING "because the ruling said so" is classifying by habit.

### ⚰️ THE ONE DEFECT THIS CHECKPOINT SHIPPED, kept because the shape repeats

CP3 merged (`ea0326717`) with `register()` wired, the projection and harness built, **18 tests
green — and nothing calling the evaluator.** Monday would have produced zero rows, and next weekend
an empty store reads exactly like five sessions of agreement. Cause: CP1/CP2's correct *"registration
only, no scheduler entry"* invariant was carried into CP3 **by habit**, written into the `api/main.py`
comment, and then **enforced by a test** — while approval line 2 says the harness *"runs against the
projected predicates"*. ⭐ Registration is not activation; but putting the **dark** evaluator on a
tick is not the **flip** either. Fixed in CP3b (`baea70d76`). The rail that catches it now asserts
the **wire**, not the parts — every other test called the evaluator itself, which is why eighteen of
them said nothing.

## ⭐ NEXT-SESSION QUEUE — in this order

| # | item | note |
|---|---|---|
| 1 | **G1** | Classify under the flow-worker rail, merge, **marker bump only if it strands** — measure with `reachable_paths()`, never a hand BFS. Held over from 2026-09-12 by owner instruction. |
| 2 | **D1 G3 / G5 sizing** | G3 = the adapter is JSON-only (blocks `ticker_logos` PNG + `fundamentals_bulk` 30–70 MB CSV). G5 = no retry/backoff/request-ceiling. **Sizing only** — not a build authorization. |
| 3 | **S7 trigger-type plan, updated with what CP1–CP3 taught** | see the three mandatory items below |
| 4 | **F-I1-2 gate line** | ⏸️ **STILL PARKED.** Do not re-raise; it is owner-bound. |

### ⛔ WHAT CP1–CP3 ADDS TO THE S7 TRIGGER-TYPE PLAN — mandatory for every future type

1. **BOTH SHAPES IN THE SCHEMA AT REGISTRATION.** `price-level` pinned `price` *and* `trendline` in
   CP1, before any evaluator existed. A trendline is a first-class shape with **no past** — its level
   is a function of `now`, so nothing may write a stale-level cleanup against it.
2. **FORWARD-ONLY COMPARISON, NO REPLAY, EVER.** Both rules evaluated live on the same tick from the
   moment the dark predicate arms. An anchor rewrite **resets the clock** and the pre-move span is
   discarded into `not_comparable` — never counted as agreement. Four outcomes, never a pass rate.
   And every comparison ships with the report that reads it **and a non-vacuity control**, because an
   empty store renders identically to perfect agreement.
3. ⛔⛔ **WIRING IS NOT ACTIVATION — A MANDATORY CHECKPOINT ITEM.** Every trigger type's checklist
   must carry, as its own line: *"name the thing that CALLS this evaluator, and the rail that asserts
   the call site exists."* Registration, an evaluator, and green tests are all compatible with a
   feature that never runs. The rail must assert the **wire**, not the parts — a suite whose every
   test invokes the evaluator directly is structurally blind to the one question that matters.

## Also open

- **Browser checks — owed by the owner**, batched: bell icon · Ask-AI provenance (slice 2 is live) ·
  S3 admin `/status`.
- **G1** as queued above.

---

# ⛔⛔ FIRST THING A COLD START MUST KNOW

**This is a BUILD program.** It has 50+ commits in production. **[`LEDGER.md`](LEDGER.md) is the
authority on what shipped** — not this file, not the specs, not the architecture documents.

## ⚰️ HISTORICAL — the five PRs below were MERGED on 2026-09-11/12

⛔ **Kept for the merge-order reasoning, not as a to-do.** Every row shipped; the current
state is the block at the top of this file and `LEDGER.md`. A cold start that acts on
this table will re-merge merged work.

### (as originally written) FIVE PULL REQUESTS ARE PENDING THE OWNER'S MERGE

| # | branch | SHA | what | tier |
|---|---|---|---|---|
| 1 | `feat/s7-filing-watch-parity` | `c46be401f` | filing-watch parity rail — **precondition for every S7 trigger type** | WEB-ONLY |
| 2 | `feat/i1-rails` | `be3474241` | GATE-I1 slice 1 — F-I1-1, F-I1-4, adversarial cases | WEB-ONLY |
| 3 | **`fix/alert-bell-filing-icon`** | `76f6e2e77` | ⛔ **MEMBER-VISIBLE** — filing-watch bell icon. Own PR by ruling 2b | WEB-ONLY |
| 4 | `feat/s3-admin-routes` | `3ebe013a5` | S3 admin `/status` + `/reconcile`; also greens `test_test_discovery_coverage` | WEB-ONLY |
| 5 | `feat/d1-adoption-sweep` | `638e12f48` | census quarantine cleanup + adapter-gap log | WEB-ONLY |

**All five are WEB-ONLY** — verified against flow-worker's committed watch list (the 21 `api/<name>.py`
files in `api/flow_worker_main.py`'s header). None touches a watched file, so none needs a
weekend/after-hours window. Only dependency: **4 before 5**, so the discovery-coverage red clears
before anyone reads the census red.

⛔ **THE NEXT SESSION'S FIRST ACTION:** when the owner says "merged" — re-run the protection rail
against `origin/master`, flip every Section-4 ledger row from **PENDING-MERGE** to **MERGED** with
its merge SHA, and confirm rail PASS. Nothing else starts before that.

## Authorized and waiting on those merges

**GATE-I1 SLICE 2** — `AskAiTab.jsx` composes `<Cited>`/`<Provenance>` instead of its local
CSS-module citation list. Approved 2026-09-11 at `22a0367fe`; branch `feat/i1-askai-provenance`,
**off `origin/master` AFTER the five merge, never before** (it depends on `feat/i1-rails`).
⛔ MEMBER-VISIBLE. Conditions in the gate packet, including: remove the `RECORDED_BOUNDARY_DEBT`
entry in the same PR and **confirm F-I1-1 goes green because the violation is gone, not because the
entry moved.**

## Next authorization the owner still owes

**S7 price-level** needs an **absorption ruling** before it can be scheduled — which legacy table it
absorbs, under the standing default (legacy stays live, new type runs **dark**, and the flip plus the
legacy switch-off happen in the **same PR**). Draft ruling text is in the next-session queue in
`PROGRAM_STATUS.md`.

## D1 adoption follow-ups — open, unscheduled

The sweep migrated **zero** call sites, because every remaining one is blocked. The blockers, from
`docs/d1-implementation-log.md` on `feat/d1-adoption-sweep`:

| gap | what is missing |
|---|---|
| **G1** | typed functions don't expose a per-call `timeout` to callers — **blocks all 34 reaches on its own** |
| **G2** | no typed function for 9 live endpoints; `/stable/profile` alone is reached by 8 modules |
| **G3** | adapter is JSON-only — can't serve `ticker_logos`' PNG or `fundamentals_bulk`'s 30–70 MB CSVs |
| **G4** | `get_news_stock` is single-ticker; `engine.py` sends a multi-symbol CSV |
| **G5** | no retry/backoff/request-ceiling; `fmp_news.py` has all three plus 429 sleep-retry |

Also open: **11 Massive sites** outside `massive.py`, untouched this wave. ⚠️ And the FMP census rail
is **red on master for a pre-existing reason** — `api/services/news/adapters/fmp_news.py:37`,
unquarantined, fixable only via G5.

---

Read in this order: this file -> `PROGRAM_STATUS.md` -> `GOVERNING_PRINCIPLES.md` -> `CRITICAL_PATH.md` -> `OWNER_DECISIONS.md` -> `AGENT_REGISTRY.md` §5 -> the charter in `charter/` if any requirement is in doubt.

⛔ **`SESSION_HANDOFF.md` is now a HISTORICAL artifact** (the 2026-09-02 11:57 recovery checkpoint). It is preserved as a record, not as a state description, and its §5 and §16 are superseded here. Do not act from it.

## Where we are

* **Program day:** 1 **CLOSED**. **Phase 2 CLOSED** (product/IA/data architecture + F-09, adversarially validated). **Phase 3 CLOSED** (technical validation + PRD/spec for the four LOCKED systems).
* **Stage: BUILD PROGRAM** (owner ruling 3, 2026-09-11 — declared, not discovered: it had been one since 2026-09-02). Specification complete for four systems; **all four are implemented in whole or in part on `origin/master`, plus two application slices** (see "Implementation status" below). The program is **idle**, awaiting the owner's read on the S3 gate and on what shipped undocumented.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master from here. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).

## What exists (verified against git, not asserted)

**Research — Day 1 closed.** Wave 1 (17/17 internal + licensing), Wave 1b (28/28 external benchmark), the internal synthesis group (system map, capability ledger, tech-debt register, provider ledger F-03b, licensing register F-04, both cost models), `executive-questions.md` (all 40), `hypothesis-register.md` (35), and `DAY_1_EXECUTIVE_SYNTHESIS.md` (90 KB, accepted after an independent fact-check pass that found and corrected two genuine drifts). Closed at `7652adabf`; readiness review at `714c05779`.

**Phase 2 — architecture, closed at `92e9c0a8e`.** `product-architecture.md` (32-system decomposition: 12 platform S-systems, 5 data-platform D-systems, 14 applications, 1 intelligence layer), `information-architecture.md`, `data-architecture.md`, `capability-infrastructure-matrix.md`, `provider-master-ledger.md` (F-09), `ARCHITECTURAL_DECISION_REGISTER.md`, and `13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` (the CONDITIONAL GO that authorized Phase 3).

**Phase 3 — PRD/spec pairs, closed at `e9e7a71f7`.** Four complete pairs, no truncation, for the four systems the decision register had LOCKED:

| system | PRD | spec | document status |
|---|---|---|---|
| **S3** Entity Master | `05-product-strategy/prds/entity-master-prd.md` | `07-technical-architecture/specs/entity-master-spec.md` | draft — awaiting review |
| **D1** Provider Abstraction | `prds/provider-abstraction-prd.md` | `specs/provider-abstraction-spec.md` | draft — awaiting review |
| **S8** Provenance & Freshness | `prds/provenance-freshness-prd.md` | `specs/provenance-freshness-spec.md` | **IMPLEMENTED** — awaiting owner sign-off |
| **S7** Alerts & Monitoring | `prds/alerts-monitoring-prd.md` | `specs/alerts-monitoring-spec.md` | draft — awaiting review |

**After Phase 3 close** (the eight docs commits the old control files never recorded): the Entity Master pre-implementation gate packet (`12-decisions/gates/entity-master-pre-implementation-gate.md`, 564 lines, `c46048ae6`, final and awaiting explicit owner approval); RG-33 filed and then corrected (`a9837d71d`, `633691038` — `cap_universe.json` is the stale file, **not** `delisted_tickers_bulk.json`); and the S8/S11 implementation records (`8935b5092`, `99e7de3b5`, `f23530a8d`, `92296aa62`, `a31cacea1`).

## Implementation status

⛔ **Implementation HAS occurred, and it is on `origin/master`.** Any statement that this program has touched no application code — including `SESSION_HANDOFF.md` §16 — is false as of 2026-09-02 evening. The code landed on separate implementation branches (never from this worktree) and is now an ancestor of `origin/master`:

⛔⛔ **THE AUTHORITY IS [`LEDGER.md`](LEDGER.md) — READ IT, NOT THIS SUMMARY.** 50 commits / 207 files / 22,049 insertions on branch `feat/entity-master`, merged as **`ed6b1f041`** on 2026-09-05, covering **S3, D1, S8, S11, S1+S2, S7 Alerts, A3–A8 and I1** — every one assigned, zero unassigned. Plus **19 further commits from four OTHER workstreams building on paths this program created**, including the convergence program's filing watch, which lives **inside** this program's `alert_taxonomy` package.

⚠️ An earlier revision of this file said "17 commits" and "no Checkpoint 6 exists." Both were undercounts from filtered queries; Checkpoint 6 is `5ecdae012`. **A filtered absence is not an absence** — use the ledger query, never a path or subject filter.

**Smaller first cut, kept only as the record of what the re-scoped rail surfaced on its first run — seventeen commits, 2026-09-02 17:51 → 09-03 15:07:**

| system | commits | what shipped |
|---|---|---|
| **S3** Entity Master | `3c762d25e` `8424b8be5` `195e8e24c` `114052d2d` `f1b75e270` `baaf28906` `53b99ad5a` | `api/services/entity_master/` created from nothing — canonical schema, read primitives, write path, seed script **(a real seed run was executed)**, provider mapping, reconciliation, adversarial validation at scale. 2,395 insertions, 1,174 of them tests |
| **D1** Provider Abstraction | `9d0b5eb26` | provenance/freshness hardening — entitlement distinction, stale detection, AI-consumable contract. ⚠️ **Not the one-ACL-per-vendor boundary** the PRD specifies; that is still unbuilt |
| **S8** Provenance & Freshness | `7adf80bd4` `834b45df4` `8d04bf75f` `03d399a52` `48bba9614` | `app/src/components/provenance/` (Provenance, FreshnessBadge, CoverageLine, Cited, freshnessContract, availabilityContract, sessionStale + tests), `api/routers/provenance_quote.py`, `provenance_bar.py`, `api/services/bar_provenance.py`, `ProvenanceDemo.jsx` at `/provenance-demo` |
| **S11** Session & Market Clock | `e14a5836b` `1cf0bf028` | `app/src/lib/marketClock/{marketClock,nyseCalendar}.js`; `useMarketOpen.js` re-sourced; `sessionModel.js` `nextOpenHint()` skips holidays |
| **A3/A4** vertical slice | `408f04935` | `/research/:sym`'s Estimates + Financials mounted onto S3+D1+S8+S11. Does **not** touch Terminal-Current |
| **A5** Events & Calendar | `1214dc246` | ⛔ **modified TERMINAL-CURRENT** — `api/routers/calendar.py` (163 lines), `app/src/pages/Calendar.jsx`, `calendar/CalendarHeader.jsx`, `earningsModalRow.js` + tests, plus `tests/test_calendar_a5_modernization.py` (281 lines, new) |

**S11 has no PRD/spec document** — deliberately. Its `product-architecture.md` system block was judged sufficient for a system that size; that judgement is recorded in `provenance-freshness-prd.md` §12.4 and is not a gap to be silently filled.

⛔⛔ **CORRECTION, 2026-09-11 — S3 was BUILT BY THIS PROGRAM, not adopted.** An earlier reading of
this file said `api/services/entity_master/` was "pre-existing UCT infrastructure the program
adopted." **That is false.** The path **did not exist at the start SHA** (`git ls-tree 9c3df14b9 --
api/services/entity_master` returns nothing); it was created by `3c762d25e` on 2026-09-02 17:51:55
and built out across Checkpoints 1–8 (no Checkpoint 6 exists — open question), 2,395 insertions
including 1,174 lines of tests. The misreading came from `provenance-freshness-spec.md` §8a calling
Entity Master "already shipped" — written at ~23:00 that night, it meant *shipped five hours ago by
us*, and was read as *predates us*. ⭐ **"Already shipped" names a state, never an author. Ask git
who wrote it.**

⚠️ **The full implementation ledger is in `PROGRAM_STATUS.md`** and includes two things no program
document recorded until this reconciliation: the **A3/A4 vertical slice** (`408f04935`) and the
**A5 Events & Calendar modernization** (`1214dc246`) — the latter having modified **Terminal-Current
itself**. Read that section before planning any build work.

## What is blocked

Nothing is blocked on research, and the two items that were waiting on the owner are **closed**:

- ✅ **S8 completion status — SIGNED OFF 2026-09-11**, with S10 and the vendor-side entitlement taxonomy (SPEC-S8 §17a) formally DEFERRED, neither blocking.
- ✅ **Entity Master gate packet — APPROVED 2026-09-11** (conditional on the spec re-verification, which came back clean: 34/36 paths VERIFIED, 0 MOVED, 0 CHANGED).
- ✅ **The 50-commit merge `ed6b1f041` — AUTHORIZED.** Owner's work in a separate session; a **recording failure only**, now recorded in [`LEDGER.md`](LEDGER.md). ⛔ **Closed. Do not re-raise it.**

## ⛔ OWNER-BOUND OPEN ITEMS — standing, do not re-raise per report

**The owner will supply these unprompted. Never assume a value, never let silence decide one, and
do not list them again as a question in a session report.**

| item | what it gates |
|---|---|
| **OI-03(a)** Massive plan tier (Individual vs Business) | 38 licensing-register rows |
| **OI-03(b)** FMP Data Display & Licensing Agreement — exists? | 19 rows. ⛔ **57 rows stay FLAGGED between (a) and (b)** |
| **OI-06** one observed or narrated desk morning | DEC-01 workspace model + DEC-02 command-grammar default. ⛔ **The S1/S2 gate exception stays OPEN until this lands**; its findings then get diffed against the shipped palette and drive a rework list — they are not discarded |
| **OI-08 / OI-18** Bloomberg / Gödel access | validation tier only; nothing depends on either |
| **OI-21** four read-only telemetry queries + `charts_workspace_layout` distribution | sharpens S6's build order; blocks nothing |
| **D-003 / DEC-09** decisiveness for two audiences | ✅ **RULED: decisive for everyone, implemented as a configuration value.** ⛔ Does not apply to I1, which is the Explain role and never renders a verdict |

## Where to pick up

1. **Do not re-dispatch the Wave-2 recovery list.** It is closed. Of the eight items `SESSION_HANDOFF.md` §5 classified as needing re-dispatch (that file says "seven" in §1 and §5's prose while its own table lists eight), **seven are DONE and accepted** — F-06 deliverable 2, B-POD-BBG, C7-02, C5-02, B-POD-GDL, C2-01, C7-03 — all QC'd file-by-file in `AGENT_REGISTRY.md`.
2. ✅ **C2-02 (Events intelligence) is DONE** — re-dispatched and accepted 2026-09-11 (`82d084b43`), 47,658 bytes, QC'd by reading the file. **RG-28 closes with it.** There is no outstanding research task.
3. ⛔ **THE REST OF DAY-1 RESEARCH IS PARKED — owner ruling 5, 2026-09-11. Do not dispatch it as a wave.** Pull an individual pod **on demand, only when a specific system's spec needs it**, and say in the dispatch which spec and which question. The full parked list, recorded so nothing is lost:

   | contract | tasks |
   |---|---|
   | `contracts/C-WAVE2.md` | **C1-01, C1-02** · **C2-03** (alerts & notifications — the one most likely to be pulled, for S7 Alerts) · **C3-01, C3-02** · **C4-02, C4-03** (C4-03 global search / entity resolution — likely for S2, which is itself parked on OI-06) · **C6-03** · **C8-01, C8-02**. *(C2-01, C2-02, C5-02, C6-01, C6-02, C7-02, C7-03 are already accepted.)* |
   | `contracts/B-WAVE2.md` | the per-product **`B-<P>-02` workflow reconstructors** and **`B-<P>-03` verifiers**, one pair per benchmark product (11 products → 22 tasks) |
   | `contracts/G-LIGHT-D2.md` | **G-01-D2** Product Skeptic light red-team pass (Fable; destination `12-decisions/red-team/day2-benchmark-product.md`) |
   | not yet contracted | **F-05** cross-product capability matrix · **F-07** JTBD / workflow library — both need their inputs first |

   ⭐ **Why parked and not cancelled:** Day 1 closed, and Phase 2 and Phase 3 both completed without any of it. The evidence base was sufficient to lock four decisions and specify four systems, so the marginal research value is now lower than the cost of running 20–30 agents. That judgement is reversible — the contracts are on disk and each is independently dispatchable.
4. **QC every return by reading the actual file** — bytes, section headers, tail, truncation-marker scan — never an agent's self-report. This is how F-08 and C6-02 were correctly recovered after their agents reported failure, and how B-POD-BBG's premature failure call was caught and corrected (`68d0f4990`).
5. ⛔ **When scanning a file for a literal marker, strip prose first.** A truncation-marker scan of `provenance-freshness-spec.md` on 2026-09-11 returned two hits, both false: the field name `truncated` inside a documented data shape, and a line-range note. An instrument that matches prose reports a property of itself.
6. Run the protection rail (`protection-rail.md`) at every checkpoint and update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## How this drifted (read before trusting any control file)

Between 2026-09-02 17:14 and 2026-09-03 07:04, eight docs commits landed on this branch — the Entity Master gate packet, two RG-33 commits, four S8 records and the S11 record — and **not one of them touched a control file.** In the same window, application code for S8 and S11 shipped to `origin/master` from separate branches, which this worktree's history cannot see at all. `RESUME.md` and `SESSION_HANDOFF.md` were last written at 11:57 that morning and went on describing "Day 1b, Wave 2 partially complete, seven tasks needing re-dispatch" for nine days, while every one of those tasks but C2-02 had in fact been completed and accepted hours later.

A cold-start session reading `RESUME.md` first, exactly as instructed, would therefore have re-dispatched seven finished research tasks and believed no code had shipped.

⛔ **So: check git before trusting these files.** This document carries a "Last verified against git" line at the top; if the branch has moved past that SHA, reconcile before acting. Two specific blind spots, both real here: a docs commit that records implementation is not the implementation (the code lives on other branches, and only `origin/master` can confirm it), and an **untracked** file is invisible to every `git log` — C2-02's stub survived nine days precisely because nothing ever committed it.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.

⚠️ **Two ID collisions in this program's own vocabulary — both live, both load-bearing:**
1. **A bare `Dn` means the SYSTEM. A decision is always `DEC-nn`.** Renamed 2026-09-11 by owner ruling: the decision register's ids are now `DEC-01`–`DEC-15`, and so are the Readiness Review §7 items that seeded them. `PHASE_2_INTEGRATION_SYNTHESIS.md` §10 locks "D3 Entity Master, D4 Provider Abstraction, D6 Provenance, D7 Alerts" in the OLD spelling — read those as **DEC-03 / DEC-04 / DEC-06 / DEC-07**; the systems they lock are **S3, D1, S8, S7**. The token was carrying up to five meanings (decision · data-platform system · capability-ledger row · benchmark-universe row · Readiness-Review item), two of them inside one table row in `information-architecture.md`. **In-prose references were deliberately NOT mass-renamed** — a rule-based pass mislabelled ~10% against hand-checking. Each document's decision references are corrected when that document is re-verified. Mapping and rationale: the register's rename note.
2. ⛔ **`S7` NAMES TWO UNRELATED THINGS — and this program's writing rule for it (owner ruling, 2026-09-11).**
   - In **this** program, S7 is the **Alerts & Monitoring** platform system. **Always write it "S7 Alerts", never a bare "S7."**
   - In the (now closed) UCT Terminal **convergence** program, "S7" is the **filing-watch** feature — live to members since 2026-09-11 12:07:29 ET, durable alert row `alert_fires`. **Always call that one "filing watch", never "S7."**
   - The two are unrelated and neither is a rename of the other. ✅ Checked 2026-09-11: `alerts-monitoring-spec.md` names `alert_fires` 12 times and `user_alerts` **zero** times, so S7 Alerts is already consistent with the convergence program's 2026-09-08 owner ruling that the durable alert is `alert_fires`, never a `user_alerts` row. That consistency is luck plus good grounding, not a designed handshake — re-check it when S7 Alerts is authorized.

⚠️ **The codebase has moved since these documents were written.** Terminal-Next must not assume a pre-convergence codebase — see `PROGRAM_STATUS.md`'s reconciliation section for the one confirmed overlap (Seam 7's 2026-09-07 edit to S11's `nyseCalendar.js`).

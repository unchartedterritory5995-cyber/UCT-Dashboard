---
id: ADR-INDEX
title: Architecture Decision Records — index, promotion rule, and the diff since 2026-09-02
role: gate item 31 (Document C row 31; Document B §49 gate item 15)
status: draft
date: 2026-09-26
---

# Architecture Decision Records — index

⛔⛔ **READ THIS FIRST, BECAUSE THE SET HAS A NARROW JOB.**
`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` (Phase 2, **ACCEPTED 2026-09-02**) is the
**living tracker** and remains the sole authority for `DEC-01` … `DEC-15`. **Nothing in this
directory restates a register row.** These files are the *record* of decisions that have **locked**
and that the register does not hold — which, after nearly a month of rulings, is almost all of
them.

---

## 1. The promotion rule (ADR-0001), applied

`00-program-control/MASTER_CHECKLIST.md:37` states it, and the register repeats it from its own
side (`ARCHITECTURAL_DECISION_REGISTER.md:11-13`): **individual formal ADRs are written "when a
decision genuinely locks."**

Applied here as three tests. A decision earns an ADR when:

1. it has been **ruled**, not proposed; **and**
2. its reversal condition is either **absent** (an owner ruling) or a **named future observation**
   rather than an input the programme is still waiting on; **and**
3. the register does **not** already hold it.

⚠️ Five records sit on that boundary and **say so in their `promotion:` field rather than
forcing it**: ADR-0016, ADR-0017 and ADR-0019 (commitments taken under a lock their own document
calls PROVISIONAL), ADR-0025 (six of ten positions are "keep doing what we do"), and ADR-0043 (a
fix decided and **not shipped**).

⭐⭐ **And the one convention this set adds, which the register does not have: a superseded
decision keeps its own record.** The register overwrites its own history in place — DEC-08's
reversal and DEC-14's replaced expiry condition survive only as `⚰️` strike blocks, and
the reversals in the decision cards are not in the register at all. **A superseded decision,
recorded with what superseded it and why, is the single most useful thing an ADR set carries: it
stops the next engineer re-proposing a thing that was already tried and rejected.**

---

## 2. Derived counts — every command printed (ADR-0002)

Run from `docs/terminal-research/12-decisions/adr/`:

```
ls ADR-[0-9][0-9][0-9][0-9]-*.md | wc -l                                     -> 52
grep -h '^status: ' ADR-[0-9][0-9][0-9][0-9]-*.md | sort | uniq -c | sort -rn
      -> 43 accepted
      -> 6 superseded
      -> 2 withdrawn
      -> 1 accepted-by-practice-unwritten
grep -lE '^status: (superseded|withdrawn)' ADR-*.md | wc -l                  -> 8
grep -h '^superseded_by: ' ADR-*.md | grep -vc 'none'                        -> 8
grep -h '^supersedes: ' ADR-*.md | grep -vc '^supersedes: none'              -> 25
grep -h '^supersedes: ' ADR-*.md | grep -c 'ADR-0'                           -> 8
#  ... and therefore the remainder                                           -> 17
```

**52 ADRs. 8 of them are reversals** (6 superseded + 2 withdrawn), and **25 records supersede
something** — of which **8 supersede another ADR** (the chains in §4) and **17 retire a claim or a
framing that was never itself an ADR**: a ledger banner, a misread seed fact, a published
contradiction, a two-state taxonomy, two OPEN escalations, a runbook heuristic, a non-goal's
provenance, an "UNREAD" that was really UNREADABLE, and the reading of deploy frequency as a pure
cost.

⭐ **That second number is the more interesting one.** A reversal chain between two ADRs is visible
to anyone reading the set. A decision that quietly retires a *sentence* inside an accepted document
is not — and 17 of those happened in one month.

And from `docs/terminal-research/`:

```
grep -cE '^\| DEC-[0-9]+ \|' 12-decisions/ARCHITECTURAL_DECISION_REGISTER.md          -> 15
grep -cE '^\| DEC-[0-9]+ \|.*\*\*Locked\*\*' 12-decisions/ARCHITECTURAL_DECISION_REGISTER.md -> 6
grep -hc '^## CARD ' 12-decisions/DECISION_CARDS_2026-09-{18,25,26}.md         -> 7, 8, 23
grep -rn "^#\{1,3\} .*does NOT decide" --include=*.md . | wc -l              -> 19
grep -rn "does NOT decide" --include=*.md 00-program-control | wc -l           -> 0
```

⛔ **No count in this set is typed.** Where a number is quoted from another document
(2,344 · 3,742 / 3,721 / 3,640 · +7.9 MB/min · 14.9 ms · 26 minutes ·
31.1 MB · 118 nodes / 109 edges) it is cited to the artifact that measured it and **not
re-derived here**.

---

## 3. ⭐⭐ THE DIFF — what the register holds, and what locked after 2026-09-02

### 3a. Stays in the register. No ADR written. Point at it.

| row | register status | why no ADR |
|---|---|---|
| **DEC-03** Symbol/Entity master | **Locked** | locked *before* 2026-09-02 and unchanged since; the register is complete on it (`:83-90`) |
| **DEC-04** Provider Abstraction Layer | **Locked** | same (`:92-96`) |
| **DEC-06** AI provenance component | **Locked** | same, including the caught two-owner defect (`:106-112`) |
| **DEC-07** Alert-type taxonomy | **Locked** | same (`:114-117`) |
| **DEC-10** Packs vs. tools | **Locked** | same; ADR-0020 is adjacent and does not restate it (`:151-160`) |
| **DEC-13** Regime-classifier authority | **Locked** | same, including RG-32 as a normal-operations item (`:179-195`) |
| **DEC-01** Workspace model | Recommended, reversible | **not locked** — gated on OI-06 + the `charts_workspace_layout` query + RG-27. Its three *commitments* locked independently and are ADR-0016/0017/0018/0019 |
| **DEC-02** Command-grammar default | Recommended, reversible | **not locked** — the register already records item 19's sharpening ("one substrate, two front ends"); only the default is open |
| **DEC-05** Member-facing licensing posture | Owner-bound | **not locked** as a posture. ⚠️ But ADR-0015 records an owner clearance dated 2026-09-26 that materially changes this row's context — **the row is worth a re-read; this set does not edit it** |
| **DEC-08** Corp-actions / portfolio-risk | ⚰️ was "defer", **CONFIRMED NEEDED 2026-09-20** | **the register already records the reversal**, verbatim and dated (`:119-137`). ADR-0048 records only how it interacts with A14's other gate |
| **DEC-09** Decisiveness for two audiences | Owner-bound | **not locked**; no default declared, and the research says it is not resolvable by more research |
| **DEC-11** Canonical model migration scope | Recommended, reversible | **not locked** |
| **DEC-12** Canonical earnings-date authority | Recommended, reversible | **not locked** — the register calls it *"an assumption, not a decision"* |
| **DEC-14** D1 build-out exception | Recommended, reversible, self-expiring | **the register already records BOTH generations of its expiry condition**, including the owner's D2-B replacement of 2026-09-12 and the census rail by test name (`:197-252`). It is the one place the register does reversal history properly |
| **DEC-15** Entity Master interim reconciliation job | Recommended, reversible, self-expiring | **not locked** |

⭐ **Also stays in the register and is NOT an ADR here:** the `Dn` → `DEC-nn` id rename
(owner ruling 2026-09-11), which the register carries in full with its collision table
(`:22-61`). Read `Dn` as a **system** unless it is spelled `DEC-nn`.

### 3b. Locked after 2026-09-02, in no register — this is the set's substance

| what locked | when | ADR |
|---|---|---|
| **ONE paid tier** (owner) | 2026-09-26 | ADR-0009, superseding ADR-0008 |
| **$200/month or $2,000/year**; the $7/week is the Whop product (owner) | 2026-09-26 | ADR-0010 |
| **Two products, two populations**; the Whop Discord is out of boundary (owner) | 2026-09-26 | ADR-0011 |
| **The aggregation thesis** — coverage is the binding constraint (owner) | 2026-09-26 | ADR-0012 |
| **The execution ceiling** — a break-out is STRUCTURAL, not a coverage failure | 2026-09-26 | ADR-0013 |
| **Costs and usage de-scoped** (owner) | 2026-09-26 | ADR-0014 |
| **Licensing cleared for the estate, OPEN per new source** (owner); ESC-08/ESC-10 closed, ESC-03 an owner-accepted risk | 2026-09-26 | ADR-0015 |
| Item 20's three workspace commitments | 2026-09-25 | ADR-0016, 0017, 0018, 0019 |
| Item 22's AI constraints — inherit and rail, panel-scoped, population ceiling per lane | 2026-09-26 | ADR-0020, 0021 |
| Item 23's entitlement mechanism, the read-route rail, and the refusal to close R-17 | 2026-09-26 | ADR-0022, 0023, 0024 |
| Item 24's ten realtime positions; the edge settled; the browser TTL removed and EXECUTED | 2026-09-26 | ADR-0025, 0026, 0027, 0028, 0029 |
| Item 25's tiering rule for per-process counters | 2026-09-26 | ADR-0030 |
| The bars serving gate, re-cut | 2026-09-26 | ADR-0031, 0032 |
| The bar-recut doctrine and its anti-waiver clause | 2026-09-26 | ADR-0033 |
| The S7 flip bars, re-cut twice each | 2026-09-25/26 | ADR-0034–0038 |
| The MVP definition of done | 2026-09-26 | ADR-0039, 0040 |
| The displacement target, measured and relocated | 2026-09-26 | ADR-0041, 0042 |
| A verified production defect and its fix decision | 2026-09-26 | ADR-0043 |
| The watchdog left unarmed, and its procedure found unsatisfiable | 2026-09-26 | ADR-0044 |
| Item 29's typed edges and one rejected edge | 2026-09-26 | ADR-0045, 0046 |
| Capacity out of scope; A14 out of programme | 2026-09-25/26 | ADR-0047, 0048 |
| **Backtesting is IN CHARTER** — §13 governs order flow, and a backtest already ships mounted | 2026-09-26 | ADR-0049, which **bounds** ADR-0013 |
| **The unit of account** — jobs carry the verdict, features carry the evidence | 2026-09-26 | ADR-0050 |
| **NG-03 kept, provenance relabelled DERIVED** (not owner-ruled) | 2026-09-26 | ADR-0051 |
| **BRK-09 downgraded to INFERRED** — re-read first, build second | 2026-09-26 | ADR-0052 |
| **Item 34's de-scoping upgraded from a reading to a DECISION** | 2026-09-26 | recorded in ADR-0014 |

---

## 4. ⛔ The reversals, as chains — read both ends or neither

| chain | what it teaches |
|---|---|
| **ADR-0008 → ADR-0009** (two paid tiers → one) | a default over an **unread** answer is not a default, it is an overwrite. The answer was in the programme's own charter, dated 25 days earlier |
| **ADR-0026 → ADR-0027** (the edge does not cache → it does) | **an unauthenticated probe of a gated route measures the gate**; and the withdrawn fix pointed at a change that could have re-opened the product's largest historical data leak |
| **ADR-0031 → ADR-0032** (warm ratio → latency) | a gate a healthy system fails gets waived — and ⛔ **the instrument was never changed with the definition**, so the superseded gate is what a reader measuring today still gets |
| **ADR-0034 → ADR-0035 → ADR-0036** (the S7 flip bar, three generations) | a bar that a correct fix makes impossible to pass; and the measurement that cannot complete |
| **ADR-0037 → ADR-0038** (scan membership) | the same unreachable-bar defect, **one day after the first was re-cut** |
| **ADR-0040 → ADR-0039** (five consecutive days → K of N eligible) | *"introduces no new number"* is a fine reason for a display constant and a bad one for a statistical parameter |
| **ADR-0041 → ADR-0042** (the displacement target) | ⭐⭐ **the programme's cleanest worked example of a CORRECT measurement leading to a WRONG conclusion.** The grep was right; the inference from it was not |
| **ADR-0018** (isolation was an unmet precondition → it already ships) | **an accepted input is a claim about its own date.** Second correction of the same shape in one hour, in one document |
| **ADR-0005** (the ledger always understates → its error has no reliable sign) | a claim about a sample of four, restated as a property of the ledger. Five understated, **one overstated**, two exact |
| **ADR-0028**'s internal correction | the ruling's diagnosis of **WHERE** was wrong — a zone-wide setting, not a cache rule — and it was caught only because the thing was **read before it was changed** |

---

## 5. Live contradictions this set reports and does NOT resolve (ADR-0006)

* `cap_universe`: **3,742** · **3,721** · **3,640**
* `posts_total`: **88** · **92** · a third value
* the breadth collector's hour: **15:15 CT** · **16:15 ET** · *"the 4:15 collector"* —
  ⛔ and it gates a **member-visible** state change
* item 27's evidence ceiling still carries the **superseded** "always understates" framing
* `rth-scheduling.md:3` says "Nine" tasks above its own eight-row table
* A14 reads dormant in the cards and wanted in the register (ADR-0048)
* ⚰️ **`MASTER_CHECKLIST.md:37` — this deliverable's own row — says the register holds "13
  decisions, 4 already LOCKED". Derived from the register: 15 decisions, 6 locked** (DEC-03, 04, 06,
  07, 10, 13). The row predates DEC-14/DEC-15 and two later locks, and still uses the bare-`Dn` form
  ADR-0001 retired. **Read the register's summary table (`:265-283`), never the row.** Reported in
  ADR-0001; not corrected, because the checklist is a control artifact
* ⛔ **Two undeclared conventions serve one purpose** (ADR-0007): items 19 and 21 carry a
  PROVISIONAL register where the six newest documents carry a "does NOT decide" section. A reader
  auditing for either shape finds the other half non-compliant, and neither is

Citations for each are in ADR-0005 and ADR-0006.

## 6. Flags named in this set — every state UNREAD (ADR-0003)

`WATCHDOG_ENABLED` · `COMPASS_MENTOR_MODE` · `TERMINAL_NEXT_MONITOR_ENABLED` ·
`D2_DUAL_COMPUTE_WARM_READER_ENABLED` · `BRAIN_TOOLS_ENABLED` ·
`AI_SEARCH_CLAUDE_SYNTH` · `SCAN_SWEEP_ENABLED` · `DESK_PUBLIC_SHOWS` ·
`OFFLINE_DEFAULT_ON`. ⛔ This programme has no Railway access and must not attempt one; a code
default is not a production state.

## 7. ⛔ Deliberately NOT promoted — these are open questions (gate item 33), not decisions

A decision that was never taken is not an ADR. Each of the following is **ruled-as-blocked**,
**defaultable**, or **unanswered**, and belongs to `00-program-control/OPEN_QUESTIONS.md` /
`11-risks-and-open-questions/`:

* **CARD 9** — the `08d68edb` predicate probe: blocked by a **tool permission**, twice
  refused. *"A user saying 'you decide' does not unblock a classifier."* Not a decision.
* **CARD 13** — the final hybrid lock: needs a **desk-observed morning**, which is an
  *observation*, not a decision. (Its determination *"build against hybrid anyway"* is recorded
  inside ADR-0016.)
* **the desk-navigation telemetry substitute**, and **Protocols C and H** — blocked on a
  permission and on a browser extension respectively.
* **OBS-1 … OBS-9** — nine **defaultable** rulings, each *"vetoable in one word"*. A
  ruling a one-word veto reverses has not locked. Pointer: ADR-0030.
* **DP-1, DP-2, DP-3, DP-4, DP-5, DP-7, DP-8** — item 23's owner/ARCH decision points. Only
  **DP-6** locked (ADR-0023).
* **D4** (the conflation rate, and the unmeasured 10 Hz constant), **Q1** (the target panel
  count), **Q7** (whether Terminal-Next runs in its own process). Pointer: ADR-0025, ADR-0029.
* **OI-02** (who adjudicates the MVP verdict), **OI-03(a)/(b)**, **OI-06**'s remaining half,
  **OI-10** (the cost ceiling), **OI-12**, **CP-02 / OI-04**, **CP-09**.
* **The audience question ADR-0011 creates and does not close**: whether the ~750 figure and the
  paid-Substack-audience reasoning in the licensing register describe the Whop audience, UCT
  Intelligence's, or a union.
* **Item 13's headline re-verdict** — flagged by ADR-0041 as *"the highest-value correction
  outstanding"*, still not done.
* **Four architecture requirements with no backlog item** — `ARCH05-R5`,
  `ARCH05-ALLOWLIST`, `ARCH06-CHOKEPOINT`, `ARCH06-DATACLASSES`. Pointer: ADR-0046.
* **Checkpoint rulings with their own build records** under `12-decisions/gates/` — D5 CP2
  (not built: a table with no consumer), D5 CP6 (closed on the current plan: no vendor signal, two
  live 404s), CP7's adjustment sentence, A12's 2026-10-12 gate and its expedited amendment, A10
  CP2's mount (which the owner released from its partner precondition and which shipped, was rolled
  back under H15, was exonerated by a controlled comparison, and re-landed live). These are
  **decisions**, and they are recorded where they were taken; promoting them here would put a
  second authority on a gate packet.

---

## 8. Status vocabulary used in this set

| `status:` | meaning |
|---|---|
| `accepted` | ruled, in force |
| `superseded` | replaced by a later decision; `superseded_by` names it. **Kept deliberately** |
| `withdrawn` | retracted by its own author rather than replaced; the measurement inside may still stand |
| `accepted-by-practice-unwritten` | taken consistently and repeatedly, and **mandated nowhere**. Exactly one record: ADR-0007 |

## 9. The records

| id | title | status |
|---|---|---|
| [ADR-0001](ADR-0001-adr-promotion-rule.md) | A decision that has LOCKED earns an ADR; the register stays the tracker | accepted |
| [ADR-0002](ADR-0002-counts-are-derived-never-typed.md) | Every count is derived, and the command that produced it is printed | accepted |
| [ADR-0003](ADR-0003-never-assert-a-flag-state.md) | A flag state is never asserted from a code default or a past decision | accepted |
| [ADR-0004](ADR-0004-capability-status-has-three-states.md) | Capability status has THREE states, not two | accepted |
| [ADR-0005](ADR-0005-ledger-cell-error-has-no-sign.md) | A ledger cell is a dated measurement whose error has no reliable sign | accepted |
| [ADR-0006](ADR-0006-contradictions-are-reported-not-resolved.md) | A contradiction between documents of equal standing is REPORTED, never resolved by the reporter | accepted |
| [ADR-0007](ADR-0007-every-deliverable-publishes-its-scope-boundary.md) | Every gate-item deliverable publishes its own scope boundary | ⭐ **UNWRITTEN** |
| [ADR-0008](ADR-0008-two-paid-tiers-defaulted.md) | Two paid tiers and no free tier | ⛔ **SUPERSEDED** → ADR-0009 |
| [ADR-0009](ADR-0009-one-paid-tier.md) | ONE paid tier. No free tier. No second paid tier. | accepted |
| [ADR-0010](ADR-0010-price-200-month-2000-year.md) | UCT Intelligence is $200/month or $2,000/year; the $7/week is a different product | accepted |
| [ADR-0011](ADR-0011-two-products-two-populations.md) | Two products, two populations — the Whop Discord is outside this programme's boundary | accepted |
| [ADR-0012](ADR-0012-aggregation-thesis-coverage-is-binding.md) | The product thesis is AGGREGATION toward full substitution, so COVERAGE is the binding constraint | accepted |
| [ADR-0013](ADR-0013-no-execution-is-the-substitution-ceiling.md) | Full substitution is bounded at execution — a workflow ending in "place the trade" is a STRUCTURAL break-out | accepted |
| [ADR-0014](ADR-0014-costs-and-usage-de-scoped.md) | Costs and usage are DE-SCOPED; licensing and permission remain fully in force | accepted |
| [ADR-0015](ADR-0015-licensing-cleared-for-the-estate-open-per-new-source.md) | Licensing is CLEARED for the current estate and OPEN for each new data source | accepted |
| [ADR-0016](ADR-0016-promotion-between-layers-is-generic.md) | Promotion between the fixed and composable layers is GENERIC, never a bespoke widget per function | accepted |
| [ADR-0017](ADR-0017-one-versioned-workspace-document.md) | The workspace is ONE versioned document in its own store; `user_preferences` is the scalar-settings store | accepted |
| [ADR-0018](ADR-0018-panel-isolation-is-a-standing-invariant.md) | Per-panel error isolation, the close control outside it, and a mount cap are a STANDING INVARIANT — and they already ship | accepted |
| [ADR-0019](ADR-0019-no-layout-library-migration.md) | No layout-library migration: react-grid-layout stays | accepted |
| [ADR-0020](ADR-0020-ai-is-inherited-not-added.md) | Terminal-Next does not add an AI layer: it generalises and rails the contract that already shipped | accepted |
| [ADR-0021](ADR-0021-population-ceiling-per-lane.md) | A population ceiling per lane is sized before any new member-facing AI surface ships; and a model is never downgraded for cost | accepted |
| [ADR-0022](ADR-0022-one-entitlement-object.md) | One entitlement object, authored once, consulted at three points — never at the renderer | accepted |
| [ADR-0023](ADR-0023-the-rail-not-the-fixes.md) | Widen the auth-surface auditor to READ routes — the rail, not the four fixes — and the rail ships first | accepted |
| [ADR-0024](ADR-0024-r17-is-not-reported-closed.md) | R-17 is NOT reported closed on a source read: a finding established by probe is retired only by probe | accepted |
| [ADR-0025](ADR-0025-realtime-positions-d1-d10.md) | The ten realtime positions (C7-01's D1–D10): keep the pooled client, add no broker, build no board-level aggregation yet | accepted |
| [ADR-0026](ADR-0026-edge-does-not-cache-withdrawn.md) | The origin sends no `Cache-Control`, so Cloudflare defaults to BYPASS; the fix is a response header | ⛔ **WITHDRAWN** → ADR-0027 |
| [ADR-0027](ADR-0027-an-unauthenticated-probe-measures-the-gate.md) | The edge DOES cache the flow payload — and an unauthenticated probe of a gated route measures the gate | accepted |
| [ADR-0028](ADR-0028-remove-the-four-hour-browser-ttl.md) | Remove the four-hour BROWSER TTL on the flow tape; keep the edge cache | accepted |
| [ADR-0029](ADR-0029-fix-the-leak-before-the-topology.md) | Fix the leak before choosing a process topology, and never by deploying less | accepted |
| [ADR-0030](ADR-0030-cumulative-vs-distributional.md) | Cumulative versus distributional decides where a counter's state may live | accepted |
| [ADR-0031](ADR-0031-warm-ratio-gate.md) | The bars serving gate is ≥ 99 % `mem`/`sqlite` warm ratio | ⛔ **SUPERSEDED** → ADR-0032 |
| [ADR-0032](ADR-0032-gate-on-latency-not-tier.md) | `stale-swr` counts as SERVED; gate on latency, report the tier mix beside it, keep one RTH tier alarm | accepted |
| [ADR-0033](ADR-0033-a-bar-a-healthy-system-fails-gets-waived.md) | A bar a healthy system fails gets waived: re-cut it — and a re-cut must QUOTE THE READING THAT FAILED | accepted |
| [ADR-0034](ADR-0034-s7-flip-bar-v1.md) | S7 price-level CP4/FLIP bar v1: `legacy_only == 0` and `agreed ≥ 20` over ≥ 5 sessions | ⛔ **SUPERSEDED** → ADR-0035 |
| [ADR-0035](ADR-0035-s7-flip-bar-v2.md) | S7 price-level flip bar v2: `agreed ≥ 5` across ≥ 3 predicates on levels set by REAL members | ⛔ **SUPERSEDED** → ADR-0036 |
| [ADR-0036](ADR-0036-s7-flip-clause-v3.md) | S7 flip clause v3: `new_only == 0` is the safety clause; an excluded predicate must be DISPOSITIONED | accepted |
| [ADR-0037](ADR-0037-scan-membership-bar-v1.md) | S7 scan-membership FLIP bar v1: `legacy_only == 0` over ≥ 5 sessions on ≥ 3 definitions held by ≥ 2 real members | ⛔ **SUPERSEDED** → ADR-0038 |
| [ADR-0038](ADR-0038-scan-membership-bar-v2.md) | S7 scan-membership bar v2: one fire on a definition the smoke account does not own | accepted |
| [ADR-0039](ADR-0039-mvp-definition-of-done.md) | The MVP definition of done: K of N eligible occasions, recorder ≠ adjudicator, and pre-registration blocks | accepted |
| [ADR-0040](ADR-0040-five-consecutive-trading-days.md) | The MVP span is a run of at least five consecutive trading days (SM-11) | ⛔ **SUPERSEDED** → ADR-0039 |
| [ADR-0041](ADR-0041-absorb-outright-rests-on-a-void-state.md) | Item 13's absorb-outright verdict rests on a product state that no longer holds, so the MVP's build half is void | ⛔ **WITHDRAWN** → ADR-0042 |
| [ADR-0042](ADR-0042-displacement-target-relocates.md) | The absorb-outright verdict STANDS; the displacement target relocates from the deleted embed to hand-use of finviz.com | accepted |
| [ADR-0043](ADR-0043-re-time-the-job-never-the-shared-rule.md) | A guard is fixed by re-timing the job, never by moving a shared rule — and it ships with a rail that has been watched to fire | accepted |
| [ADR-0044](ADR-0044-watchdog-stays-unarmed.md) | The event-loop killer stays unarmed, the arming condition is named — and the arming PROCEDURE is unsatisfiable as written | accepted |
| [ADR-0045](ADR-0045-graph-edges-are-typed.md) | Dependency-graph edges are TYPED, because they have different unblocking actions | accepted |
| [ADR-0046](ADR-0046-one-edge-deliberately-rejected.md) | `FB-D2-01 ← FB-D1-01` is deliberately NOT an edge | accepted |
| [ADR-0047](ADR-0047-no-absolute-capacity-number.md) | An absolute production capacity number is OUT OF SCOPE; the local sandbox answers only relative questions | accepted |
| [ADR-0048](ADR-0048-a14-is-out-of-this-programme.md) | A14 Portfolio & Risk is out of this programme — a scope statement, not a deferral | accepted |
| [ADR-0049](ADR-0049-backtesting-is-in-charter.md) | "No execution" does NOT reach historical backtesting — backtesting is IN CHARTER, and it already ships | accepted |
| [ADR-0050](ADR-0050-jobs-carry-the-verdict.md) | The unit of account: JOBS carry the verdict, FEATURES carry the evidence | accepted |
| [ADR-0051](ADR-0051-ng-03-kept-provenance-relabelled.md) | NG-03 (no broker write path) is KEPT — and relabelled DERIVED, not owner-ruled | accepted |
| [ADR-0052](ADR-0052-brk-09-transcripts-downgraded.md) | BRK-09 (transcripts) is DOWNGRADED to INFERRED and must not drive priority — re-read first, build second | accepted |

---

## GAPS — what this set could not reach

* **No production read of any kind.** Every flag state is UNREAD (§6); R-17 is not reported
  closed (ADR-0024); no monitor is reported running (ADR-0030).
* **The register was read, not edited.** Where a register row's context has moved — DEC-05
  most clearly — this set says so and stops.
* **Six of the eight architecture inputs were read in their decision-bearing sections, not in
  full** (items 19, 21, 22, 23, 24, 25, 29 range from 658 to 1,715 lines). A decision stated only
  in a section not read here would be missing from this set, and the likeliest place for one is
  `07-technical-architecture/data-architecture.md` §§6–27, whose 24 recommendations
  are summarised at `:1644-1672` and whose owner-bound index is at `:1674`.
* **`12-decisions/red-team/` and the ~80 build records under `12-decisions/gates/` were listed,
  not read.** A red-team verdict that overturned a decision recorded here would not have been
  seen.
* **No ADR is written for gate item 26 (coexistence), which is NOT STARTED**, so no coexistence
  decision appears in this set.
* ⚠️ **`DECISION_CARDS_2026-09-26.md` GREW WHILE THIS SET WAS BEING WRITTEN.** Another agent
  appended **CARDs 28, 29 and 30** (50 lines, `:782-830`) after this set's first pass. They were
  read and promoted (ADR-0049…0052) and three earlier records were amended (ADR-0013, ADR-0014,
  ADR-0043). ⛔ **Every line citation into that file was re-checked against the appended version
  and all CARD headings 9–27 are unmoved** — but the file is under concurrent edit by another agent
  in this worktree, so **a citation into it is a claim about the moment it was read.** That is this
  set's own ADR-0018 lesson applied to itself.

## NOT INSPECTED

* Production, the Railway dashboard, the Cloudflare dashboard, `auth.db`, and any pod.
* `C:\data` — the owner's live data. Nothing in this deliverable read or wrote it.
* Application source at `origin/master`, except where an accepted document's own `file:line`
  citation is quoted verbatim. This is a docs branch older than master; **every code claim in this
  set is inherited from a cited artifact, with that artifact's date attached, and must be re-grepped
  before it is acted on** (ADR-0041's own lesson).

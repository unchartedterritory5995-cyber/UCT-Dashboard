---
id: COMPLETION-AUDIT
title: Completion audit — every system and every registered follow-up in exactly one state
role: the day's control file. Updated at every merge.
status: measurement. Every state cites a SHA, a gate, or a measured absence.
date: 2026-09-12
measured_against: origin/master @ f3109e1af · docs @ 8cbd6ec56
---

# Completion audit

⛔ **THE DEFINITION OF COMPLETE, verbatim from the owner:** every system and every registered
follow-up is in **exactly one** of three states — **DONE**, **BLOCKED** on a named external input
with the exact command or ruling that closes it, or **DELIBERATELY EXCLUDED** with the reason.
*Nothing "in progress," nothing "parked," nothing "TBD."*

⚠️ **THIS FILE DOES NOT YET MEET THAT DEFINITION, AND SAYING SO IS ITS FIRST JOB.** The counts
below are the measurement as it stands, not the target. Every row that is not yet in one of the
three states is marked **`⛔ NOT-YET-CLASSIFIED`** with what it would take.

---

## 0. COUNTS

### Systems (32 named on the roster)

| state | count | meaning |
|---|---|---|
| **DONE** | **11** | shipped and nothing outstanding against its own PRD/spec definition |
| **BLOCKED-DATA** | **4** | waiting on a measurement; the command that produces it is named |
| **BLOCKED-OWNER** | **4** | waiting on a ruling; the OI id is named |
| **BLOCKED-SPEC-READ** | **6** | a spec or gate exists, unsigned, awaiting the owner's reading |
| **BLOCKED-DEPENDENCY** | **6** | waiting on another system, named |
| **EXCLUDED** | **1** | E1, outside the named roster |
| **⛔ NOT-YET-CLASSIFIED** | **0** | — |

### Registered follow-ups

| family | distinct ids | source of truth |
|---|---|---|
| **F-*** (findings) | **24** | harvested from the doc tree by `tools/harvest_followups.py` |
| **OI-*** (owner inputs) | **21** | `OWNER_INPUTS_REQUESTED.md`, OI-01…OI-21 |
| **DEC-*** (decisions) | **16** | two registers: DEC-01…DEC-09 (readiness), DEC-10…DEC-15 (architectural) |
| **H\*** (rules) | **6 rules** + 25 hypotheses | ⚠️ **TWO DIFFERENT REGISTERS SHARE THE PREFIX** — see §3.4 |
| **G\*** (D1 gaps) | **14** | ⚠️ also two registers (D1 gaps G1–G5; capability-ledger G7–G12) |
| **TD-*** (tech debt) | see §3.6 | `01-existing-system/tech-debt-register.md` |

⛔ **THE H AND G PREFIXES ARE AMBIGUOUS AND THAT IS A REAL DEFECT IN THIS PROGRAMME'S OWN
BOOKKEEPING**, found by this audit: `H14` is a hazard RULE (a live-hazard is a hard stop) while
`H14` in `hypothesis-register.md` is a HYPOTHESIS, and `G1` is a D1 provider gap while `G12` is a
capability-ledger gap. Any instruction naming "H1" or "G5" is ambiguous until the register is
named. **Recorded as a follow-up in §3.4; not silently disambiguated here.**

### Gate packets — 18 on disk

| | count | which |
|---|---|---|
| **SIGNED** | **17** of 21 | D2, D5, H14, I1, S10, S12, S4, all seven S7 types, **+ D3, D4, S5 signed 2026-09-12** |
| **UNSIGNED** | **3** | entity-master (S3, already BUILT) + **S1, S9**. ✅ **S2 CP1 signed 2026-09-13** (`7ae6d9ca2`); its CP2+ stay OI-06-blocked |
| **NO PACKET AT ALL** | **1** | **S6** only — S1/S2/S9 packets written 2026-09-13, EMPTY approval blocks, each naming the owner input it waits on |

⭐ **UPDATED AFTER THE PRE-SIGNED BATCH (`f3235f4f7`).** D3/D4/S5 CP1 and five S7 CP3 lines were
signed on the owner's instruction. ⛔ **THAT MOVES THEM OUT OF BLOCKED-SPEC-READ AND INTO A STATE
THE DEFINITION OF COMPLETE DOES NOT ALLOW: authorized-and-unbuilt.** Named here rather than
smoothed over — see §6.

⚠️ **"UNSIGNED" and "NO PACKET" are different blockers.** An unsigned packet is BLOCKED-SPEC-READ
(the owner reads and signs). A missing packet is work this programme owes before the owner can
read anything.

---

## 1. THE 32 SYSTEMS

Every row: current state (cited), what DONE means per its own PRD/spec (cited), the gap, and the
blocker class.

### 1.1 Platform (S-series)

| system | current | DONE means (cited) | gap | blocker |
|---|---|---|---|---|
| **S1** Terminal Shell | PROVISIONAL-SHIPPED, narrow slice | product-architecture §5-A.1 — a shell that hosts surface kinds from a manifest | the manifest decision is gated on OI-06's findings being diffed against what shipped | **BLOCKED-OWNER** — OI-06 |
| **S2** Command / Search | PROVISIONAL-SHIPPED | §5-A.2 — a keyboard registry with one binding table | same OI-06 diff | **BLOCKED-OWNER** — OI-06 |
| **S3** Entity Master | **SHIPPED** CP1–8 `ed6b1f041` | entity-master-spec §all | ⚠️ its gate packet is **UNSIGNED** despite the system being built — a bookkeeping gap, not a build gap | **DONE** (packet noted in §2) |
| **S4** Context Bus | **CP1 MERGED** `76c62c494` | context-bus-spec §3.1 — one bus, both contexts as thin adapters, every consumer unchanged | CP1 is the divergence DETECTOR only; the bus adoption itself is CP2+ | **BLOCKED-SPEC-READ** — CP2 line unsigned |
| **S5** Persistence & User State | spec + gate written, **UNSIGNED** | persistence-user-state-spec — a typed store for list/preference documents | no CP1 authorized | **BLOCKED-SPEC-READ** |
| **S6** Personalization | PRD + spec written, **NO GATE** | personalization-spec | no packet exists | **BLOCKED-SPEC-READ** (packet owed first) |
| **S7** Alerts | **8 of 8 types registered**; 4 live, 4 dark CP1–CP2 | alerts-monitoring-spec §5 — every type registered, comparable, and flipped | four types need CP3 (projection) then a flip | **BLOCKED-DEPENDENCY** — own CP3s |
| **S8** Provenance & Freshness | SHIPPED | provenance-freshness-spec | full `<Cited>` still D2-gated | **BLOCKED-DEPENDENCY** — D2 |
| **S9** Entitlements | not built, **NO GATE** | — | owner-bound | **BLOCKED-OWNER** — OI-03(a)(b), OI-12 |
| **S10** Presentation Primitives | **SHIPPED** `3c539d011` · CP2 `6576f044e` | presentation spec | F-S10-1 residue (§3.1) | **DONE** with one open finding |
| **S11** Session / Clock | SHIPPED | — | none | **DONE** |
| **S12** Rollout | 1st `56df6803f` · 2nd `78ba40fe8` | rollout spec — role checks become cohort tags | cohort 6, projected 6 (union with admins) | **DONE** |

### 1.2 Data platform (D-series)

| system | current | DONE means (cited) | gap | blocker |
|---|---|---|---|---|
| **D1** Provider Abstraction | SHIPPED, census GREEN | provider-abstraction-spec | G5 quarantine entry cleared | **DONE** |
| **D2** Canonical Data Model | CP1 `b9783d509` · CP2 `ffa8102c7` · CP3 store `0b8cf4c41`+`40bf07c99` | canonical-data-model-spec §§1–6 | **CP3 gate needs Monday's samples**; §9.5 indicator axis unsigned | **BLOCKED-DATA** + **BLOCKED-SPEC-READ** |
| **D3** Realtime Streaming | spec + gate written, **UNSIGNED** | realtime-streaming-spec | no CP1 authorized | **BLOCKED-SPEC-READ** |
| **D4** Caching & Serving | spec + gate written, **UNSIGNED** | caching-and-serving-spec | no CP1 authorized | **BLOCKED-SPEC-READ** |
| **D5** Reference & Corp-Actions | **CP1 MERGED** `9458ea641` | reference-corp-actions-spec | CP2–CP7 unsigned | **BLOCKED-SPEC-READ** |
| **D8** Portfolio/risk deferral | deferred in its own block | — | owner-bound | **EXCLUDED-by-deferral** → counted under BLOCKED-OWNER |

### 1.3 Application (A-series) + intelligence

| system | current | gap | blocker |
|---|---|---|---|
| **A1** Markets | live surface | no quote field is addressable | **BLOCKED-DEPENDENCY** — D2 |
| **A2** Charts & Analytics | live surface | S1 + S2 both gated on OI-06 | **BLOCKED-OWNER** — OI-06 |
| **A3/A4** · **A5** · **A6/A7** · **A8** | SHIPPED | none | **DONE** (4 rows) |
| **A9** Screening | live surface | ✅ `scan-membership-change` CP3 merged `df937146c` — but it fires **dark, flag OFF**. A9 needs CP4 + the FLIP, both owner-bound | **BLOCKED-OWNER** — arm the dark flag, read it, sign CP4 + FLIP |
| **A10** Options & Flow | live, partner-owned | D3 + D4 as systems | **BLOCKED-DEPENDENCY** |
| **A11** Breadth & Regime | live surface | ✅ `regime-change` CP3 merged `506eeee6d`, ARMED 2026-09-13 — but it compares **dark**. Still needs the one-regime ruling, D2 coverage, and this type's CP4 + FLIP | **BLOCKED-OWNER** — the flip, the one-regime ruling — + **BLOCKED-DEPENDENCY** (D2) |
| **A12** Watchlists | half-live | S5 + S6 | **BLOCKED-DEPENDENCY** |
| **A13** Journal | live (528 files) | ✅ `position-risk` CP3 merged `6a67a4b5d`, ARMED 2026-09-13 — but it compares **dark**. Still needs D2, S5, and this type's CP4 + FLIP | **BLOCKED-OWNER** — the flip — + **BLOCKED-DEPENDENCY** (D2, S5) |
| **A14** Portfolio & Risk | no member door | D8 + S9 | **BLOCKED-OWNER** — OI-03, OI-12 |
| **E1** | outside the named roster | — | **EXCLUDED** |
| **I1** Intelligence Layer | SHIPPED, 3 slices, `1c426c199` | F-I1-2 parked by owner | **DONE** with one parked finding |

---

## 2. GATE PACKETS — authorized vs built

| packet | signed | checkpoints AUTHORIZED | BUILT | gap |
|---|---|---|---|---|
| D2 | ✅ | CP1, CP2 (NARROWED) | CP1, CP2, **CP3 store built ahead of its line** | ⚠️ CP3 has no approval line; the store is log-only and fires nothing |
| D5 | ✅ | CP1 | CP1 | CP2–CP7 unsigned |
| H14 | ✅ | the whole scope | all, + AMD fixture | none |
| I1 | ✅ | 3 slices | 3 | none |
| S10 | ✅ | CP1, CP2 | both | F-S10-1 residue |
| S12 | ✅ | migration 1, 2 | both | none |
| S4 | ✅ | CP1 | CP1 | CP2 unsigned |
| S7 `price-level` | ✅ | CP1–CP3, CP3b | all | dark read pending |
| S7 `event-proximity` | ✅ | CP1, CP2 | both | dark read pending |
| S7 `catalyst-match` | ✅ | CP1, CP2 | both | CP3 unsigned |
| S7 `position-risk` | ✅ | CP1–CP2 | both | CP3 unsigned |
| S7 `scan-membership-change` | ✅ | CP1–CP2 | both | CP3 unsigned |
| S7 `regime-change` | ✅ | CP1–CP2 | both | CP3 unsigned |
| S7 `indicator-condition` | ✅ | CP1–CP2 | both | CP3 unsigned **and** blocked on D2 §9.5 |
| D3 | ❌ | — | — | unsigned |
| D4 | ❌ | — | — | unsigned |
| S5 | ❌ | — | — | unsigned |
| entity-master (S3) | ❌ | — | S3 is BUILT | ⚠️ **built without a signed packet** — recorded, not re-litigated |

⛔ **TWO BOOKKEEPING ANOMALIES THIS AUDIT FOUND, NEITHER OF THEM A BUILD PROBLEM:** S3 shipped
CP1–8 against an unsigned packet, and D2's CP3 sample store was built against a gate line that does
not exist yet (on the owner's explicit ruling to restructure it, which is a different thing from an
approval line). Both are named here so the next reader does not discover them as gaps.

---

## 3. EVERY REGISTERED FOLLOW-UP

### 3.1 F-* findings — 24 distinct, harvested

| id | origin | status | what closes it |
|---|---|---|---|
| **F-D2-1** | D2 CP2 — fundamentals has no declaration to ratify | **OPEN** | write the fundamentals declaration if it is writable; else EXCLUDE with the reason |
| **F-D2-2** | D2 CP1 | OPEN | — needs re-read |
| **F-D2-3** | D2 CP1 | OPEN | — needs re-read |
| **F-I1-1 … F-I1-6** | I1 slices | I1-2 **PARKED by owner** (browser checks); 1,3,4,5,6 recorded | F-I1-2: owner's browser run |
| **F-S10-1** | a price has two right renderings | **CLOSED** by S10 CP2 `6576f044e` — ⚠️ residue to confirm | confirm no third rendering site remains |
| **F-S10-2** | `<Cited>` ET label | **CLOSED** `e909279e1` | — |
| **F-S7-1 … F-S7-5** | S7 wave 1 | F-S7-5 **CLOSED** `5ff6fc04a`; others recorded | — |
| **F-S7-CM-1** | catalyst-match | OPEN | CP3 |
| **F-S7-EP-1** | event-proximity | OPEN | the dark read |
| **F-S7-IC-1** | indicator-condition — the empty intersection | **OPEN, SPEC WRITTEN** | D2 §9.5 signature |
| **F-S7-PR-1** | position-risk | OPEN | CP3 |
| **F-S7-RC-1** | the dedup key is written and never read | **CONFIRMED, OPEN** | a fix PR or an EXCLUDE ruling |
| **F-S7-RC-3** | path B has no suppression | **CONFIRMED, OPEN** | same |
| **F-S7-RC-4** | the third emitter | **CLOSED — EXCLUDED PERMANENTLY** by owner ruling, GATE §10 | — |
| **F-S7-SMC-1** | scan-membership-change | OPEN | CP3 |

⚠️ **F-S7-RC-2 IS REGISTERED IN CODE AND NOT IN THE DOC TREE.** The harvester found RC-1, RC-3 and
RC-4 but no RC-2; the finding (path B's substring label match) lives in
`api/services/alert_taxonomy/regime_change.py`. **A finding that exists only in code is invisible
to every doc-side audit, including this one** — it was found by noticing the gap in the sequence.

### 3.2 OI-* — 21 owner inputs

All 21 are in `OWNER_INPUTS_REQUESTED.md` with a stated default. §6's `OWNER_INPUTS.md` turns the
ones that block a system into a fill-in form. **None is closable by this programme.**

Blocking a system today: **OI-03(a)(b)** → S9, A14 · **OI-06** → S1, S2, A2 · **OI-12** → S9, A14.
The other 18 are recorded with defaults and block nothing.

### 3.3 DEC-* — 16 across TWO registers

DEC-01…DEC-09 in `READINESS_REVIEW_DAY1.md`; DEC-10…DEC-15 in
`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md`; DEC-001 (three digits) in the I1 PRD is a
**third numbering** and is almost certainly a typo for DEC-01. **Recorded, not corrected** — a
silent renumber in an audit is exactly the drift this file exists to catch.

### 3.4 ✅ F-AUDIT-1 — CLOSED. The hypothesis register is now `HY-nn`.

⭐⭐ **AND IT WAS THREE REGISTERS, NOT TWO.** The audit reported `H` as a two-way
collision. Doing the rename found a third meaning:

| `H5` means | where | renamed? |
|---|---|---|
| a hazard **RULE** (`H4` roll back first, `H14` a live hazard is a hard stop) | `charter/C-master-directive.md`, commit messages, code comments across the estate | **no** — largest blast radius, keeps its ids |
| a **HYPOTHESIS** | `13-executive-synthesis/` | ✅ **renamed to `HY-nn`** — 327 ids across two files |
| a **capability-ledger ROW id** (`D3, D6–D8, G6, H5, H9, K3, L8, N4` — a grid coordinate) | `capability-ledger.md`, cited in `executive-questions.md` | **no** — a different namespace entirely; renaming it would have been the real damage |

⛔ **A BLIND RENAME WOULD HAVE CORRUPTED THE THIRD ONE.** The row ids look
identical to the hypothesis ids and sit in the same sentence as other letters. The
rename was scoped to the two files that own the hypothesis register, and the eight
residual `H`s in `executive-questions.md` were **left alone deliberately** after
being read.

**G is still open**: `G1`–`G5` are D1 provider gaps, `G7`–`G12` are
capability-ledger gaps, `G20`/`G53` are something else again. Not renamed this
pass — recorded so it is not mistaken for done.

### 3.4-STANDING ✅ THE §4-NAMING RULE — ADOPTED 2026-09-13, AND APPLIED RETROACTIVELY

> **Every approval line names a §4 checkpoint ID, or it re-numbers §4 in the same commit so that
> it does. A scope that matches no §4 row is UNSIGNABLE — stop and say so rather than build
> against it.** (Owner ruling, 2026-09-13, after the second occurrence.)

**The retroactive audit is `tools/audit_scope_vs_checkpoints.py` and it has run: 29 signed lines
across 18 packets, 6 lines in 4 packets name no checkpoint.**

| packet | lines | what the line names instead |
|---|---|---|
| `intelligence-layer` (I1) | slice 1, slice 2 | `F-I1-1`/`F-I1-4`, then a component adoption. **This packet numbers FOLLOW-UPS, not checkpoints** — there is no roster to name. |
| `s12-rollout` | line 1, line 2 | "first migration", "second migration". ⚠️ **The derived audit scored line 1 OK by matching a FOREIGN id** — the `CP4` in S12's text is *S7's* CP4, not an S12 checkpoint. |
| `h14-placeholder-stop-unification` | line 1 | one detector, five call sites. A one-scope hazard-rule gate, delivered whole. |
| `s10-presentation-primitives` | line 1 | the primitives. It **IS** CP1 — the CP2 heading says *"the CP1 block above stands as granted"* — but the scope text never says so. |

⭐ **None of the six is a D4/S5-shaped divergence.** In every case the packet simply has no
checkpoint roster (or, for S10, has one the earlier line predates). The two dangerous cases — a
scope describing work its packet's §4 does not contain — remain exactly the two already recorded.
**Each of the six is closed by NUMBERING the packet, not by re-signing it**, and all six describe
work that is already delivered, so none of them blocks the queue.

### ⛔⛔ 3.4d F-CAT-1 (new, 2026-09-13) — THE CATALYST ENGINE IS BILLING AND WRITING NOTHING

> **Found while dry-running catalyst-match CP3. It is NOT this programme's to fix, and it is
> reported rather than left to be rediscovered.**

Measured in the pod, read-only, `/data/catalysts.db`:

| market_date | rows | ranked | LLM calls | spend |
|---|---|---|---|---|
| 2026-09-13 | 0 | 0 | 0 | $0 |
| 2026-09-12 | **0** | **0** | 2 | $0.01 |
| 2026-09-11 | **0** | **0** | 40 | $1.54 |
| 2026-09-10 | **0** | **0** | 35 | $1.28 |
| 2026-09-09 | **0** | **0** | 53 | $1.83 |
| 2026-09-08 | 125 | 20 | 59 | $2.02 |

⛔ **$4.66 across 130 LLM calls on 09-09…09-12, and ZERO rows persisted.** `CATALYST_ENGINE_ENABLED=1`
in the pod, `ANTHROPIC_API_KEY` set, and the cost log proves synthesis ran on those dates — so the
engine is scheduled, reached, and billing. Something between synthesis and `upsert_catalyst` stopped
persisting after 2026-09-08.

⭐ **MEMBER-VISIBLE:** `get_for_date(today, ranked_only=True)` returns **0 rows**, so the Dashboard's
"🎯 STOCK CATALYSTS" tile has had nothing to show for four trading days.

⚠️ **AND IT BLOCKS A DARK RUN THAT IS NOW ARMED.** `catalyst-match` CP3 compares against the ranked
set; with no rows there is **nothing to compare**, and the sweep will record `displayed=0` every day.
⛔ **That must never be read as agreement** — it is the absence of an input, which is exactly the
`UNREADABLE is not zero` distinction this programme keeps paying for.

**What closes it:** somebody who owns the catalyst engine reads the 09-08 → 09-09 boundary. **Not
touched here** — a fix outside a signed scope is how scopes stop meaning anything, and this is a
different subsystem from Terminal-Next.

### 3.4c F-AUDIT-2 (new) — the derived §4 audit was retired under the two-correction rule

⛔ **Three attempts to DERIVE "what does this packet define" each reported a property of the
instrument as a finding**, so the rail is now a DECLARATION plus a staleness check, per the
standing rule from the D4 CP1 ruling:

1. **v1 knew only the TABLE shape** and reported 21 mismatches, nearly all "NO §4 TABLE" — the
   tool's claim, not the packets'.
2. **v2 added HEADINGS** and still reported 17: the S7 packets define CP1 in a heading and
   **CP2–CP4 in bold paragraphs beneath it**, and `price-level` spells its headings
   *"4. Checkpoint 1"*, which contains no `CP1` token at all.
3. ⭐⭐ **And the third one is not a regex bug.** Every scope also NAMES the checkpoint it is
   REFUSING — *"⛔ CP3 NEEDS A NEW LINE"*, *"So does CP4 and the flip"*. A matcher counting
   mentions reads an explicit EXCLUSION as an authorisation and flags the packet for it.
   **"Named" and "authorised" are different facts and no pattern over one sentence separates
   them** — which is precisely why the verdicts are declared by reading.

**What stays automated is what a machine is good at:** the packet still exists · each packet
carries exactly as many signed lines as declared (**a line signed tomorrow is UNDECLARED and must
be read, never assumed**) · every id the declaration claims still appears in its packet, so a
re-numbering that drops one shows up. `--self-check` carries a control proving the drift check
can fail.

### 3.4a F-D4-1 (new) — the derived cache detector, preserved not lost

The D4 CP1 AST detector failed five times and its sixth fix was O(n²). Replaced by
a declared manifest (`f2a2a68a6`). **The working copy is at
`scratchpad/d4cp1/test_d4_per_set_cache_keys.py`.** The five defects are listed in
§6 Unit 2. ⛔ Not blocking anything; it would only ever be an *addition* to the
manifest rail, never a replacement for it.

### 3.4b F-S7-RC-2 (registered here from code, 2026-09-13)

⛔ **THIS FINDING EXISTED ONLY IN CODE AND WAS INVISIBLE TO EVERY DOC-SIDE AUDIT.**
It was found by noticing a gap in a sequence — the harvester returned RC-1, RC-3
and RC-4 and no RC-2.

**The finding:** `voice_proactive_service.py`'s regime path derives the previous
label by **substring match over the lowercased text of the member's last session
summary**, so `"choppy"` yields `chop`; its five labels are a **second, hand-typed
copy** of the vocabulary, and first-match-in-tuple-order wins. Reproduced, not
fixed, and railed against both source sites by AST in
`api/services/alert_taxonomy/regime_change.py`.

**Status:** OPEN. **What closes it:** the same ruling as F-S7-RC-1 and RC-3 —
owner form item **B5**. All three die at the S7 flip if the flip happens.

### 3.5 The `.gitignore` force-add hazard

**RECORDED, NOT OURS TO FIX** (owner instruction). Left in the LEDGER where it stands.

### 3.6 tech-debt-register — the rows that are ours

⛔ **NOT YET SEPARATED.** The register mixes estate-wide debt with Terminal-Next debt and this
audit has not split it. **What closes it:** one pass tagging each TD row `ours` / `estate`.

---

## 4. FLAG LEDGER

`docs/feature_flags.json`, audited by `tools/flag_ledger_audit.py` — **0 discrepancies**.

| flag | state | permanent? |
|---|---|---|
| `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` | armed, in-process `1` | **NO** — retires at the flip |
| `ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED` | armed, in-process `1` | **NO** — retires at the flip |
| `D2_SAMPLE_PERSIST_ENABLED` | armed, in-process `1` | **YES** — a kill switch, keeps its life |
| `SMOKE_LOGIN_LINK_ENABLED` | armed on web | **NO** — explicit removal instruction recorded |
| `HUB_PREVIEW_ENABLED` | armed | **YES** — kill switch |
| `NOTEBOOK_OFFLINE_DEFAULT_ON` | armed | **YES** — kill switch |

⚠️ **A DARK FLAG WITH NO RETIREMENT DATE BECOMES PERMANENT BY DEFAULT.** The two S7 dark flags are
the ones to watch: each retires only when its type flips, and nothing today forces that.

---

## 5. WHAT THIS AUDIT CHANGES ABOUT THE PLAN

### ⚰️ THE A9 RE-SORT, RUN 2026-09-13 AFTER `scan-membership-change` CP3 MERGED — **A9 DOES NOT UNBLOCK, AND THE CLAIM BELOW WAS TOO OPTIMISTIC**

> **A9 CP1 is NOT BUILDABLE. A9 moves from BLOCKED-DEPENDENCY to BLOCKED-OWNER, and that is
> real movement — but it is not an unblock.**

`RESUME.md` states A9's condition precisely: *"CP1–CP2 fires nothing; **A9 needs fires**."* CP3
now merged (`df937146c`), and what it delivers is a **dark projection**: `alert_fires` + receipts
written for a comparison, behind `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED`, which reads
**`None` in the running process** (verified in-pod), for the `rollout:s7-dark` cohort only, with
no delivery import anywhere in the three modules.

⭐ **So the fires exist and no member can receive one.** A9's capability — a member being told a
name entered or left their screen — is delivered by **CP4 plus the FLIP**, each of which needs its
own approval line and neither of which is build work. The audit's "one CP3 unblocks a whole
application" was measuring the wrong boundary.

⛔ **AND A9 HAS NO GATE PACKET AT ALL**, so "build A9 CP1 if BUILDABLE" has a second, independent
answer: there is nothing to cite. Writing one now would design against a flip decision the owner
has not made.

**What closes A9, exactly:** the owner arms `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED=1`, reads
the dark comparison, then signs `scan-membership-change` **CP4** and the **FLIP** line. A9's packet
follows the flip, not the other way round.

⚠️ **The same correction applies to A11 and A13 below** — `regime-change` CP3 and `position-risk`
CP3 move each of them from a build dependency to the same owner-bound flip, and neither is an
unblock either. Recorded here rather than discovered again next weekend.

---

⭐ **The largest single unblock is not a system, it is one CP3.** A9 waits on exactly one thing —
`scan-membership-change` CP3 — while A11 and A13 each wait on three. Ranked by unblock-per-unit:

1. `scan-membership-change` CP3 → **A9** (sole blocker)
2. D2 §9.5 → `indicator-condition` CP3 → part of nothing else yet
3. `regime-change` CP3 + the one-regime ruling + D2 coverage → **A11** (three)
4. `position-risk` CP3 + D2 + S5 → **A13** (three)

⛔ **AND THE HONEST COUNT OF WHAT A CP3 COSTS:** price-level's CP3 was projection + admin cohort +
forward-only comparison + a flag-gated sweep + a caller-rail, and it merged across several commits
with an in-pod verification. Four more of those is not an afternoon.


---

## 6. ⛒ THE BUILD QUEUE — AUTHORIZED-AND-UNBUILT, in dependency order

⛔ **THIS SECTION IS THE RESUME POINT. A session that runs out stops between units and the next
one starts HERE, not from memory.** One unit in flight at a time; never two on shared lines.

**ORDER, dependency-driven, owner-set 2026-09-13:**

| # | unit | authorized | state | SHA |
|---|---|---|---|---|
| 1 | **D3 CP1** — ratification rail, no runtime | `00ebb5e80` | ✅ **DONE** | **`302f99e8e`** |
| 2 | **D4 CP1** — declared manifest + existence rail | `40caca541` | ✅ **DONE** | **`f2a2a68a6`** |
| 2b | **D4 CP2** — adopter 1, per-ticker keying | `40caca541` | ✅ **DONE** | **`388cad07c`** |
| 2c | **D4 CP3** — adopter 2, theme/groups, IN CLOSURE | `40caca541` | ✅ **DONE** — BEHAVIOUR-CHANGING, marker bump #8 | **`dc5752b16`** |
| 3 | **S5 CP2** — the additions-only rail | **`9c7c634da`** signed 2026-09-13 | ✅ **DONE** | **`26120fada`** |
| — | ~~S5 CP1~~ (as line 1 described it: the extraction) | `37e1823a6` | ⏸️ **DEFERRED — F-S5-1.** Second adopter + Wave Q1 live 30 days (**2026-10-12**). Not in any §4 row. | — |
| 4 | **position-risk CP3** | `ec2b197f8` | ✅ **DONE** | **`6a67a4b5d`** |
| 5 | **scan-membership-change CP3** | `d0415f251` | ✅ **DONE** | **`df937146c`** |
| — | A-series re-sort + A9 CP1 | — | ✅ **RE-SORTED. A9 CP1 is NOT BUILDABLE** — see below | — |
| 6 | **catalyst-match CP3** | `3ee80dc13` | ✅ **DONE** | **`4fa45489f`** |
| 7 | **regime-change CP3** | `9f0575340` | ✅ **DONE** | **`506eeee6d`** |
| 8 | **S6 CP1** — ⚠️ reconcile first: no packet exists. Write from the S6 PRD/spec, sign, build. **If the PRD/spec do not support a CP1 scope, say so and mark SPEC-BLOCKED.** | — | ⬜ | — |
| — | `indicator-condition` CP3 | `148af5293` | ⬜ queued after D2 §9.5 CP1 | — |
| 9 | **D2 §9.5 CP1** — the indicator axis | ⚠️ SIGNED by the owner 2026-09-13 | ⬜ **next after regime-change; must not slip a third session** | — |
| 10 | **S2 CP1** — chord table + collision rail | **`7ae6d9ca2`** signed 2026-09-13 | ⬜ last in the queue | — |

**Every S7 CP3 carries the identical SCOPE:** read-only projection of the legacy rows · admin
cohort via the S12 tag · forward-only comparison with anchor/reschedule-style reset where the type
has a moving input · flag-gated sweep **OFF by default** with the caller-rail · no delivery import ·
no legacy change · dry-run in-pod against Friday's data before merge · projected N reported.
⛔ **DO NOT ARM ANY FLAG.**

**Deploy rule — and ⛔ READ THE CLOCK BEFORE APPLYING IT.**

> **Today is SUNDAY 2026-09-13. The weekend window is OPEN until Monday 2026-09-14 09:00 ET.**
> There is no RTH and no OPRA tape, so **a marker bump is free** and nothing needs to hold.

**From Monday 09:00 ET onward:** docs/tests/tools/`app/**` and unwatched `api/**` merge any time.
Anything in flow-worker's closure that would strand waits for **16:05 ET or later** — no marker
bump during RTH. If a unit would strand during RTH: finish on the branch, verify, hold the merge,
and record the reason here.

⚰️ **THE 16:05 RULE IS THE AFTER-RTH RULE FOR A WEEKDAY, AND THIS FILE ONCE APPLIED IT ON A
SUNDAY** — it recorded that D4 CP3 must hold "because the weekend window closed at Monday 09:00"
while it *was* Sunday, which would have held a finished, verified unit for three hours to protect
a tape that was not running.

⛔ **The rule, generalised from the git-date convention: READ THE CLOCK, DO NOT INFER THE DAY.**
A commit's date in `America/Chicago` is already the authority for *when a commit happened*; the
same discipline governs *which window you are in*. Both failures look identical from the inside —
a confident sentence about time, derived from nothing.

### Unit 3 — S5 · **CP2 ✅ `26120fada`** · the extraction DEFERRED as F-S5-1

**Ruled 2026-09-13:** build the packet's **CP2**, sign it by its §4 ID, and defer the extraction.
Line 2 is signed at fingerprint **`9c7c634da`** naming §4's CP2 row verbatim; line 1 is left
exactly as granted rather than rewritten, because **an approval is a record of what was approved,
not a draft.**

**What shipped:** one test file, `app/src/hooks/usePreferences.additionsOnly.test.js`. No product
file changed — flow-worker's closure is 154 Python modules with **zero** under `app/` and zero
`.js`/`.jsx`, so the unit is INERT by construction, not by argument.

⭐ **DERIVE THE DISCOVERY, DECLARE THE CLASSIFICATION.** *"Which keys are written through
`setPref`?"* is an AST question and is derived. *"Is this value a structured document?"* is a
**data-flow** question — the exact class that burned five attempts and an O(n²) sixth in D4 CP1 —
so all 26 keys are classified once by reading: **18 structured, 8 scalar.** The same split that
rescued D4 CP1 and the §4 audit, applied a third time on purpose.

**Measured, not quoted:** 69 literal-key `setPref` sites across 26 keys, plus 26 opaque-key sites
across 15 files. ⚠️ The packet says "70 sites"; the tree moved by one since it was written, and the
measurement is the authority.

⛔ **THE BLIND SPOT IS BASELINED RATHER THAN IGNORED.** 26 call sites pass a VARIABLE as the key,
so the rail cannot read which preference they write. `BASELINE_OPAQUE` pins a **count per file**, so
the way around the rail — write your new key through a variable — is itself a tripwire.

**IN-POD READ** (`railway ssh --service web`, read-only on `/data/auth.db`): **48 distinct
`pref_key` values, 184 rows, 21 members.** The rail sees 26. The other 23 split three ways, and
only the middle one is a gap: **4 superseded** v1/v2 keys nothing writes any more
(`calendar_view`, `calendar_view_v2`, `calendar_filters`, `calendar_event_types`); **10 written
through opaque sites** (`charts_layout_dock`, `breadth_views_config`, `breadth_drill_board`,
`breadth_charts_state`, `aisearch_settings`, `watchlist_templates`, `tracings_doc`, `journal_tab`,
`chart_templates`, `joystick_hub`) — **about a fifth of the live surface, which is what justifies
pinning those counts**; and **9 written by other modules or server-side**. ⭐ **`setPref` is not
the only door to this table**, and the rail says so rather than implying it guards the room.

**MUTATIONS — three, each restored by EDIT:**

| mutation | result |
|---|---|
| `'alert_sound'` → `'alert_sound_v2'` in `Settings.jsx` | **RED in both directions** — the new key is named with its file, and the baseline-stale check fires too |
| `setPref('theme', v)` → `setPref(THEME_KEY, v)` | **RED** — the opaque tripwire names the file |
| blind the derivation (`includes('setPrefZZZ')`) | **RED on the three controls — and the HEADLINE ASSERTION STAYED GREEN** |

⭐⭐ **THE THIRD MUTATION IS THE ONE WORTH KEEPING.** "No new key was added" passes trivially over
an empty derivation. A rail whose main assertion is satisfied by its own blindness is the failure
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` names, and **only the non-vacuity control
separated the two states.** It was not a hypothetical: it was observed, in the act, before merge.

**39 tests green** across the three `usePreferences` suites, with a totals line.

---

### ⚰️ THE HISTORY THIS UNIT CLOSES — the second scope/packet divergence

⛔ **THE SIGNED SCOPE AND THE PACKET'S OWN CP1 DESCRIBED DIFFERENT WORK.**

| | says CP1 is |
|---|---|
| **the signed line** (`37e1823a6`) | *"EXTRACT THE NOTEBOOK OFFLINE PATTERN as a reusable module, with the Notebook as its first and UNCHANGED consumer… snapshot-identity on the Notebook's behaviour"* |
| **the packet's §4** | *"**Documentation only.** The three-class rule and the twelve N-rulings written into the decision register… **No code of any kind.**"* |

And the packet's §1 states the whole ask as **"No member-visible change. No change to the Notebook
layer. No new store."** The signed scope's extraction is not CP1, CP2, CP3, CP4 or CP5 — it is not
in the packet at all.

⚠️ **AND THE RISK IS NOT SYMMETRICAL WITH D4's.** The pattern has **ZERO adopters outside the
Notebook** — 22 import lines across 14 files, every one under `app/src/pages/journal-2-0/`. So
"extract it as a reusable module with Notebook as its first consumer" is a **refactor of 14 files
in the most recently destabilised subsystem in the estate**: Wave Q1 went live 2026-09-12, and its
predecessor was rolled back **25 minutes after activation** on 09-09. A snapshot-identity claim
over that surface is a large promise.

⭐ **THE PACKET'S REASONING FOR PREFERRING DOCUMENTATION IS EXPLICIT AND GOOD:** extraction has no
second consumer to justify it, and a module shaped by exactly one caller is not reusable — it is
that caller's internals with a new import path. CP4 (Tracings adopts) is where a second consumer
appears, and that is where the shape gets tested.

**THE WAYS FORWARD — three were offered:**
- **A)** Build the packet's CP1 (documentation) and re-number, as D4 was re-numbered.
- **B)** Build the packet's **CP2** — the additions-only rail, derived from call sites with a
  non-vacuity control and today's sites baselined. Real code, strands nothing, and it is the
  only S5 checkpoint that protects something today.
- **C)** Build the signed extraction anyway, accepting a 14-file refactor of Wave Q1's surface.

✅ **THE OWNER RULED B, 2026-09-13, and it is built (`26120fada`).** The extraction is **C
deferred, not refused** — F-S5-1, conditional on a second adopter AND Wave Q1 live 30 days
(**2026-10-12**). ⭐ Both halves of that condition answer different objections: a second adopter is
a *design* condition (a module shaped by one caller is that caller's internals with a new import
path), 30 days live is a *risk* condition about a specific surface that has not yet held. The date
is recorded rather than the duration, because "30 days live" read six weeks from now is an
invitation to re-derive the start.

---

## ⛔⛔ THE PATTERN, NAMED AFTER THE SECOND OCCURRENCE

**Two of the pre-signed scopes have now described work their packet does not contain** (D4 CP1,
S5 CP1), and in both cases the divergence hid something: D4's spanned the flow-worker closure
boundary, S5's spans a live, recently-rolled-back subsystem.

⭐ **The scopes were written from the SYSTEM's name and the recommendation text, not from the
packet's §4 checkpoint table.** That table is the thing an approval line is supposed to name — it
is why §4 exists, and every packet says so in its own approval block.

**Proposed rule, for the owner:** *an approval line names a checkpoint ID from the packet's §4
table, or it re-numbers the table explicitly in the same commit.* D4 was re-numbered that way and
the result was buildable within the hour.

---

### ⚰️ WINDOW CORRECTION — the weekend window had NOT closed

§6 recorded that D4 CP3 must hold for 16:05 ET "because the weekend window closed at Monday
09:00". **It was SUNDAY.** The window was open, there was no RTH and no OPRA tape, so the bump
cost nothing and CP3 merged immediately.

⭐ **16:05 ET is the AFTER-RTH rule for a WEEKDAY.** Applying it to a Sunday would have held a
finished, verified unit for three hours to protect a tape that was not running. The rule's purpose
is to avoid gapping the tape; on a day with no tape there is nothing to avoid.

⚠️ Recorded rather than quietly fixed, because a wrong deploy-window note is the kind of thing the
next session inherits as fact.

---

### Unit 2 — D4 · CP1 ✅ `f2a2a68a6` · CP2 ✅ `388cad07c` · CP3 ⏸ holds

**CP1 — the declared manifest.** 12 rows across the six SPEC §3.4 modules, TEXT anchors (not line
numbers — `watchlist_performance`'s cache line moved 47→48 between writing and first run). 26
tests, 2 mutations RED. Tests only, no closure.

⭐ **One row earns its place by NOT being a cache key:** `live_prices`' per-entity
`cache.get(_px_key(tk))`. It is what makes the set key above it legitimate — §2.4 permits a set
key as a fast path over a per-entity tier and forbids it as the only cache. Delete that line and
`live_prices` silently becomes the anti-pattern; the rail fails by name.

⛔ **The rail states what it CANNOT do** — a new per-set key is invisible to it — and a test
asserts the statement stays. That is precisely the claim the derived detector could not make.

**CP2 — adopter 1.** Per-entity tier under the kept fast path; completeness moved inside the loop
so a failed ticker carries its own 30s TTL and its peers keep 300s. Snapshot-identity asserted.
10 tests, 2 mutations RED. **In-pod verified:** `_ticker_key` present, `wl_returns::NVDA::2026-09-13`,
TTLs 300/30, fast path kept, completeness inside the loop, `hit_rate()` → `None`.

⛔ **MY OWN TEST FOUND A REAL DEFECT:** damaging the counter dict raised `KeyError` straight out
of `get_batch_returns` — a broken counter WAS a gate on serving, which the scope forbids in as
many words.

⛔ **AND A MUTATION STAYED GREEN, WHICH WAS A GAP IN MY TESTS.** Flipping the per-ticker
`complete=ok` to `complete=True` passed everything, because the retry test invalidates by hand
rather than relying on the TTL. With `complete=True` a failed ticker's all-None row sits at the
full 300s — the original defect wearing per-ticker keys. Closed with a spy test; the mutation now
fails by name.

**CP3 — ✅ `dc5752b16`, BEHAVIOUR-CHANGING, marker bump #8.** flow-worker rebuilt on the bump
(prior pushes correctly SKIPPED). 12 tests, 2 mutations RED.

⭐ The two sites are the same defect in different clothes: `theme_performance` joins every sym into
one `TTLCache` key; `groups` does it in a **bespoke module dict outside `TTLCache` entirely**, with
a hand-checked TTL and hand-rolled eviction at >256 entries. Both keep their set key as a fast
path and gain a per-entity tier.

⛔ **One behaviour preserved deliberately and mutation-proved:** `groups` caches only symbols the
provider actually ANSWERED for. Caching a row for a silently-omitted symbol would pin the gap for
the whole TTL; caching nothing means the next call retries it.

⚠️ The test fixture had to clear BOTH tiers — clearing only the set-key dict left per-symbol rows
behind and one test's `AAA` satisfied the next test's request, failing on pollution rather than on
the product. Two tiers means two things to clear, which is a small proof the second tier is real.

---

### Unit 1 — D3 CP1 · ✅ DONE · `302f99e8e`

ADDITIVE, 0 files in flow-worker's closure, no bump. 9 tests, `PYTEST_EXIT=0`, 3 mutations RED.
**In-pod verified** (read-only): `realtime_stream._WS_URL` = `wss://ws.finnhub.io`,
`bar_stream._WS_URL` = `wss://socket.massive.com/stocks`, `subscribe_symbols` carries `owner`,
`add_trade_listener` present, `start_stream` consults `vendor_socket_guard` and `_run_websocket`
does not.

⭐ **The scope's last clause did the work: three documented claims were false and the DOCUMENT was
corrected.** `CLAUDE.md` named the wrong vendor, wrong URL and wrong API key for
`realtime_stream.py` (Finnhub, not Massive/Polygon) and gave the push feed's disengage as 300 s
against a constant of 150000 ms.

⚰️ **And the rail collided with the ⚰️ idiom.** Its first version forbade the word "Massive" on any
`realtime_stream.py` line — which forbids the tombstone recording the correction. It now reads only
the CLAIM, before the ⚰️ marker.

---

## 7. ⛔⛔ WHAT IS NOT DONE, AND THE STATE IT IS IN (superseded by §6's queue)

**The definition of complete allows three states. Eight items are in a fourth —
AUTHORIZED-AND-UNBUILT — and that is this drive's outstanding work, not a discovered
blocker.**

| item | authorized | built | what it needs |
|---|---|---|---|
| D3 CP1 | `00ebb5e80` | ✅ `302f99e8e` | — |
| D4 CP1 | `40caca541` (re-signed 2026-09-13; `37bfe4251` was the superseded single line) | ❌ attempted | see §6 Unit 2 |
| S5 CP1 | `37e1823a6` | ❌ | the Notebook-pattern extraction |
| S6 CP1 | ❌ **no packet** | ❌ | a gate packet FIRST |
| D2 §9.5 CP1 | ❌ unsigned (B4 in the form) | ❌ | the owner's reading |
| S7 `scan-membership-change` CP3 | `d0415f251` | ❌ | the projection |
| S7 `regime-change` CP3 | `9f0575340` | ❌ | the projection |
| S7 `position-risk` CP3 | `ec2b197f8` | ❌ | the projection |
| S7 `catalyst-match` CP3 | `3ee80dc13` | ❌ | the projection |
| S7 `indicator-condition` CP3 | `148af5293`, VOID until §9.5 | ❌ | §9.5 first |

⭐ **AND THE HONEST SIZE OF IT.** `price-level` CP3 — the template all four S7 CP3s copy — was a
projection, an admin cohort, a forward-only comparison, a flag-gated sweep and a caller-rail, and
it landed across several commits with an in-pod verification. **Four more of those, plus three
CP1s and a spec that changes what the address book is, is not one session's work at this rigor.**
Recording that is more useful than a partial build that reads as progress.

⛔ **NOTHING WAS BUILT PARTIALLY TO CLOSE THE GAP.** No half-projection, no unflagged sweep, no
CP1 without its gate. The eight rows above are each one clean unit of work with a signed scope.

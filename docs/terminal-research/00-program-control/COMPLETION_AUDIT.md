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
| **SIGNED** | **17** | D2, D5, H14, I1, S10, S12, S4, all seven S7 types, **+ D3, D4, S5 signed 2026-09-12** |
| **UNSIGNED** | **1** | entity-master (S3) — and S3 is already BUILT |
| **NO PACKET AT ALL** | **4** | **S6**, **S1**, **S2**, **S9** — named on the roster, no gate written |

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
| **A9** Screening | live surface | needs `scan-membership-change` **CP3** | **BLOCKED-DEPENDENCY** |
| **A10** Options & Flow | live, partner-owned | D3 + D4 as systems | **BLOCKED-DEPENDENCY** |
| **A11** Breadth & Regime | live surface | one-regime ruling + `regime-change` CP3 + D2 coverage | **BLOCKED-OWNER** + **BLOCKED-DEPENDENCY** |
| **A12** Watchlists | half-live | S5 + S6 | **BLOCKED-DEPENDENCY** |
| **A13** Journal | live (528 files) | D2 + S5 + `position-risk` CP3 | **BLOCKED-DEPENDENCY** |
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
| 2 | **D4 CP1** — the derived per-set-key rail | `40caca541` | ⬜ **ATTEMPTED, NOT MERGED** — the detector is not trustworthy yet; see below | — |
| 3 | **S5 CP1** — extract Notebook's pattern, Notebook unchanged | `37e1823a6` | ⬜ | — |
| 4 | **position-risk CP3** | `ec2b197f8` | ⬜ | — |
| 5 | **scan-membership-change CP3** → then **re-sort A-series, build A9 CP1 if BUILDABLE** | `d0415f251` | ⬜ | — |
| 6 | **catalyst-match CP3** | `3ee80dc13` | ⬜ | — |
| 7 | **regime-change CP3** | `9f0575340` | ⬜ | — |
| 8 | **S6 CP1** — ⚠️ reconcile first: no packet exists. Write from the S6 PRD/spec, sign, build. **If the PRD/spec do not support a CP1 scope, say so and mark SPEC-BLOCKED.** | — | ⬜ | — |
| — | `indicator-condition` CP3 | `148af5293` | ⛔ **BLOCKED-DEPENDENCY** on D2 §9.5 (B4, owner's form) | — |

**Every S7 CP3 carries the identical SCOPE:** read-only projection of the legacy rows · admin
cohort via the S12 tag · forward-only comparison with anchor/reschedule-style reset where the type
has a moving input · flag-gated sweep **OFF by default** with the caller-rail · no delivery import ·
no legacy change · dry-run in-pod against Friday's data before merge · projected N reported.
⛔ **DO NOT ARM ANY FLAG.**

**Deploy rule from Monday 09:00 ET:** docs/tests/tools/`app/**` and unwatched `api/**` merge any
time. Anything in flow-worker's closure that would strand waits for **16:05 ET or later** — no
marker bump during RTH. If a unit would strand during RTH: finish on the branch, verify, hold the
merge, and record the reason here.

### Unit 2 — D4 CP1 · ⛔ ATTEMPTED, NOT MERGED. Nothing is on master.

✅ **THE SCOPE CONFLICT IS RESOLVED.** The owner re-numbered the packet 2026-09-13 and signed
three lines at fingerprint **`40caca541`**: CP1 the derived rail (no product code), CP2 adopter 1
`watchlist_performance.py` with the `wl_perf` key fix, CP3 adopter 2 `theme_performance`+`groups`
with its classification **pre-declared BEHAVIOUR-CHANGING**. `cache.py` is in no checkpoint.

⛔ **THE RAIL WAS BUILT AND IS NOT TRUSTWORTHY, SO IT WAS NOT MERGED.** The working copy is kept
at `scratchpad/d4cp1/` and the repo tree is clean — **nothing partial is on master.**

**Five defects in my own detector, each caught by the rail's own controls, in order:**

| # | defect | caught by |
|---|---|---|
| 1 | `ROOT.rglob("api/**/*.py")` matches nothing — `rglob` already recurses | the non-vacuity control (scan returned **0** across six known modules) |
| 2 | read only the ARGUMENT expression; every real site assigns the key to a local first and passes a bare Name | still 0 |
| 3 | `_KEYED = {"get","set",…}` matched `dict.get`, `session.get` — six unrelated modules reported as undeclared cache sites | the declaration list becoming absurd |
| 4 | one assignment hop was not enough — `live_prices` builds the key TWO hops back, so **the one site the spec holds up as CORRECT was the one the detector could not see** | its own declared-site test |
| 5 | the assignment map was MODULE-WIDE, so a `key` built from a join in one function matched a `key` in another | two false positives in `api/main.py`, `massive.py` |

⛔ **The fix for #5 (resolve each call against its innermost enclosing scope) is O(n²) as written
and hangs the suite.** That is where it stands.

⭐ **WHY THIS IS RECORDED RATHER THAN PUSHED THROUGH.** A rail whose population is wrong does not
fail safe — it produces a DECLARATION LIST, and a false positive declared as a real cache site is
a lie that outlives the session. Declaring `api/main.py` and `massive.py` to make it green would
have been the fastest path and the worst outcome.

**WHAT THE NEXT SESSION SHOULD DO:** replace the innermost-scope walk with a single pass that
carries a parent stack (`ast.iter_child_nodes` with an explicit scope stack), so ownership is
O(n). The rest of the rail — the six DECLARED rows, the four verdict classes, the anti-pattern
rows naming their checkpoint, the CP1-touched-no-product-code assertion — is written and was
passing 11 of 12.

⚠️ **CP2 AND CP3 ARE NOT STARTED.** CP2 is outside flow-worker's closure and free to merge any
time; CP3 is inside it, pre-declared BEHAVIOUR-CHANGING, and needs the weekend window with a
marker bump — **the window closed at Monday 09:00 ET**, so CP3 now holds for 16:05 ET or later.

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

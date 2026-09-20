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

⚰️ **RECOMPUTED 2026-09-20 — the first real derivation, not a hand-guess.** Walked all 32 rows in
§1 directly, one at a time, and tallied from THEIR OWN blocker column, exactly as the prior version
of this section asked the next pass to do. Method, so it can be checked: DONE = the row's own
blocker column names no outstanding block (a drafted-but-unsigned proposal for an ADDITIONAL,
non-required checkpoint does not itself block the system — same precedent this file already
applied to D5's CP2); every other bucket = the row's own blocker column, verbatim. A row can carry
two tags (D2 no longer does, having lost its SPEC-READ half to §4-CP3's fix earlier this pass; A11
and A13 still do, OWNER+DEPENDENCY) — counted once in the 32, once per tag in the breakdown below.

| state | count | which |
|---|---|---|
| **DONE** | **22** | S1, S2, S3, S4, S5, S6, S9, S10, S11, S12, D1, D3, D4, D5, A2, A3, A4, A5, A6, A7, A8, I1 |
| **RULED-HOLD** | **1** | S7 — not in the original six buckets; a real decision was made (HOLD, DECISION_CARDS_2026-09-18.md CARD 6), distinct from still-awaiting-a-ruling |
| **BLOCKED-DATA** | **1** | D2 (top-level CP3 dual-compute flip needs real member traffic — 0 rows as of 2026-09-19) |
| **BLOCKED-OWNER** | **3** | A9, A11 (also DEPENDENCY), A13 (also DEPENDENCY) — each needs its type's dark-comparison read + CP4 + the flip |
| **BLOCKED-SPEC-READ** | **1** | A12 — CP1 proposal drafted 2026-09-20, unsigned; moved here FROM BLOCKED-DEPENDENCY now that S5/S6 no longer block it |
| **BLOCKED-DEPENDENCY** | **6** | S8 (D2), A1 (D2), A10 (D3 CP4 + D4 CP5, both proposed not signed), A11 (D2, also OWNER), A13 (D2+S5, also OWNER), A14 (DEC-08 only) |
| **EXCLUDED** | **0 within the 32** | E1 is outside the named roster (see below); DEC-08 is tracked alongside the 32 but is a decision, not a system |
| **⛔ NOT-YET-CLASSIFIED** | **0** | every one of the 32 lands in exactly one row above (plus a second tag for D2's — no, A11/A13's — dual rows) |

**Unique-system arithmetic, so the 32 is checkable, not asserted:** 22 DONE + 1 RULED-HOLD (S7)
+ 1 BLOCKED-DATA (D2) + 1 BLOCKED-OWNER-only (A9) + 1 BLOCKED-SPEC-READ (A12) + 4 single-tag
BLOCKED-DEPENDENCY (S8, A1, A10, A14) + 2 dual-tagged OWNER+DEPENDENCY (A11, A13, each counted
once here) = 22+1+1+1+1+4+2 = **32**. The breakdown table's BLOCKED-OWNER (3 = A9 + the 2
dual-tagged) and BLOCKED-DEPENDENCY (6 = the 4 single-tag + the same 2 dual-tagged) rows therefore
sum to 9 tag-occurrences across only 7 unique systems (A9, S8, A1, A10, A14 once each; A11 and A13
twice each), which is why the table's own rows don't independently sum to 32 — expected, not an
error.

**What moved to produce this count** (superseding the itemized log below, which is kept as history):
D2 lost its SPEC-READ tag today (§4-CP3 fixed, a false alarm); A12 moved DEPENDENCY→SPEC-READ (S5/S6
unblocked it, then a CP1 was actually drafted); S1/D3/D4 stayed DONE (their new CP3/CP4/CP5
proposals are additional, non-blocking checkpoints, same shape as D5's CP2) rather than moving to
SPEC-READ, on the precedent this file already set for D5.

⚰️ **Superseded by the recomputation above; kept as the historical log of individual corrections
that fed into it:**

- **S1, S2** → DONE-with-an-open-CP, 2026-09-19 (OI-06 found already answered; §1.1)
- **S6** → DONE, 2026-09-18 (CP1–CP4 shipped; DECISION_CARDS_2026-09-18.md)
- **S4** → DONE-with-an-open-CP, 2026-09-19 (CP2 fingerprint `f6df6dca1`, CP3 fingerprint `f4b06a886`, browser-verified)
- **S5** → DONE-with-an-open-CP, 2026-09-19 (CP2 `9c7c634da`, CP3 `41ffcc91c`, CP4 `ea7178473`)
- **S9** → ✅ **CLOSED, 2026-09-20.** CP1 DONE 2026-09-19; **CP2 SIGNED 2026-09-20** (fingerprint `f808508f7`). OI-03(a)(b), OI-12 and OI-09 ANSWERED (Massive CONFIRMED Business/Enterprise, FMP DDLA confirmed, paid-only model confirmed, UCT confirmed staying downstream). **Every one of the 8 rows the Massive-tier answer left Unknown is now resolved**: ESC-05 (5 rows) and ESC-14 (N-19) ANSWERED 2026-09-19 from written Massive confirmation; T-31 MEASURED 2026-09-19, FIXED same day, DEPLOYED TO PRODUCTION 2026-09-20 (`408b9a33f` on master, Railway `web` SUCCESS); **T-20 (ESC-21 + OI-03(d)) ANSWERED 2026-09-20** — Massive and FMP responded in writing that a paid-Substack audience is an Edge User. **No owner fact remains outstanding anywhere in this system** — see the S9 row, §1.1
- **A2** → DONE, 2026-09-19 (inherits S1/S2's unblock; OI-06 answered)
- **D2** → lost its SPEC-READ tag 2026-09-20 (§4-CP3 false alarm corrected — already shipped)
- **A12** → BLOCKED-DEPENDENCY → BLOCKED-SPEC-READ, 2026-09-20 (S5/S6 unblocked it 2026-09-19; a CP1 proposal was drafted 2026-09-20)

⭐ **THE MOVEMENT ON 2026-09-13 IS FROM DEPENDENCY TO OWNER, AND IT IS REAL PROGRESS THAT LOOKS
LIKE NONE.** A9, A11 and A13 each had a build dependency; each of those CP3s is now merged and
armed, so all three moved to **BLOCKED-OWNER on the same decision — the flip.** S6 moved
BLOCKED-SPEC-READ → BLOCKED-OWNER when its packet was written and CP1 built. ⛔ None of the four is
an UNBLOCK: every one of them now waits on a ruling instead of on code, which is exactly what "the
definition of complete" asks a row to say.

### Registered follow-ups

| family | distinct ids | source of truth |
|---|---|---|
| **F-*** (findings) | **48** | ⚰️ **RESOLVED 2026-09-20 — `tools/harvest_followups.py` now takes `--scope terminal-next\|all`** (default `terminal-next`). The 128-vs-34 gap flagged here was a real namespace collision, not this roster growing: a second, unrelated remediation programme owns `12-decisions/gates/packet-*`, bare `d-cp*`/`e-cp*`/`k-cp*`/`t-cp*`/`t2-cp*` build records, plus its own un-numbered top-level paths (`POST_MERGE_QUEUE.md`, `SIGNING_SESSION.md`, `findings/`, `prompts/`, `reports/`, `resolutions/`) — none of it part of the 32-system TERMINAL-NEXT tree (`00-program-control` … `13-executive-synthesis`). `--scope terminal-next` excludes exactly those paths (self-check control: an id registered only in the other programme's own files — not spelled out literally here on purpose, since the tool does not strip prose and naming it would make this very sentence a false positive for it — must be absent under the default scope and present under `--scope all`; see the tool's own `--self-check` source for which id); `verification/` was checked and is NOT excluded — it holds only genuine TERMINAL-NEXT artifacts. Also checked this pass: `00-program-control/{AGENT_REGISTRY,DECISION_LOG,CRITICAL_PATH,EVIDENCE_INDEX,MASTER_CHECKLIST,OPEN_QUESTIONS,READINESS_REVIEW_DAY1,RESEARCH_GAPS,RISK_REGISTER,SESSION_HANDOFF}.md` and `contracts/`/`charter/` — all genuinely TERMINAL-NEXT's own (Document A/B/C charter artifacts), zero `F-*` ids in any of them, nothing to exclude. Re-derived count: **48**, up from the 2026-09-13 harvest's 34 by real growth (F-S7-RC-4, F-S7-IC-2, F-CLOCK-1, F-FLAG-1, F-L2-1, F-GATE-1, F-D4-1, F-AUDIT-1/2, F-B-1, F-OI21-1 and others registered since). §3.1 should be re-run with the new default and mirrored here going forward. |
| **OI-*** (owner inputs) | **25** | ⚰️ was *"21"* — the harvester's OI pattern had a separate regex bug (unrelated to F-*'s namespace collision): `[a-z()]*` glued trailing prose punctuation onto ids (`"(see OI-06)"` harvested as `OI-06)`), inflating a raw re-harvest to 49. Fixed 2026-09-20 (`tools/harvest_followups.py`, self-check CONTROL 5) to match only a bare id or a real single-letter parenthetical sub-reference. Real count: **25** = OI-01…OI-21 (21) + four legitimate sub-references OI-03(a)/(b)/(c)/(d). |
| **DEC-*** (decisions) | **16** | two registers: DEC-01…DEC-09 (readiness), DEC-10…DEC-15 (architectural) |
| **H\*** (rules) | **6 rules** + 25 hypotheses | ⚠️ **TWO DIFFERENT REGISTERS SHARE THE PREFIX** — see §3.4 |
| **G\*** (D1 gaps) | **14** | ⚠️ also two registers (D1 gaps G1–G5; capability-ledger G7–G12) |
| **TD-*** (tech debt) | see §3.6 | `01-existing-system/tech-debt-register.md` |

⛔ **THE H AND G PREFIXES ARE AMBIGUOUS AND THAT IS A REAL DEFECT IN THIS PROGRAMME'S OWN
BOOKKEEPING**, found by this audit: `H14` is a hazard RULE (a live-hazard is a hard stop) while
`H14` in `hypothesis-register.md` is a HYPOTHESIS, and `G1` is a D1 provider gap while `G12` is a
capability-ledger gap. Any instruction naming "H1" or "G5" is ambiguous until the register is
named. **Recorded as a follow-up in §3.4; not silently disambiguated here.**

### Gate packets — 21 in the roster, re-verified 2026-09-20 against each packet's own status line

⚰️ **This sub-table said "17 of 21 SIGNED / 3 UNSIGNED (entity-master, S1, S9) / 1 NO PACKET
(S6)."** Read fresh against every packet's own frontmatter status line (not this table's prior
claim about it): **every one of the 21 roster packets has at least its CP1 signed** — including
S1 (CP1 `0a267d174`, now also CP2 `e86c92b6f`), S9 (CP1 signed+built 2026-09-19, CP2 `f808508f7`),
and S6 (CP1 `b3073c67c` — this table said S6 had "NO PACKET AT ALL"; it has one, on disk, signed).
"UNSIGNED" and "NO PACKET" both drop to **zero** within the 21.

| | count | which |
|---|---|---|
| **SIGNED (≥CP1)** | **21 of 21** | D2, D3, D4, D5, H14, I1, S1, S2, S4, S5, S6, S9, S10, S12, all seven S7 types |
| **UNSIGNED** | **0** | — |
| **NO PACKET AT ALL** | **0** | — |

⚠️ **"Signed" here means at least CP1 is authorized — it does NOT mean every checkpoint in a
packet is signed or built.** D4/D5's CP1-only fingerprints, S2/S6's multi-CP packets, and every
S7 type's still-open CP4+flip are the further, per-checkpoint detail — see §1.1/§1.2/§2, not this
table.

⚰️ **entity-master (S3)'s gate packet is now APPROVED, not unsigned** — this said the packet
status was *"final — presented to owner, awaiting explicit approval," verified 2026-09-20, still
true.* That verification was accurate about the frontmatter FIELD, not about whether approval had
actually happened: the packet's own body had recorded a 2026-09-11 owner approval in prose for
nine days without the frontmatter field ever being updated to match. Owner confirmed 2026-09-20
that the 2026-09-11 approval is real; `entity-master-pre-implementation-gate.md`'s frontmatter is
corrected to match. S3 is still deliberately NOT counted in the 21-packet roster below (it predates
that convention and uses its own "Final Gate" format, not the sign_gate.py CP structure) — tracked
here for visibility only.

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
| **S1** Terminal Shell | ✅ **CP1 BUILT AND MERGED** `b7e7541a0` (2026-09-14); ⚰️ was *"CP2 buildable"* — **CP2 SIGNED (owner, 2026-09-19, `e86c92b6f`) AND MERGED to master** (`8baca199b`, confirmed an ancestor of `origin/master`; `app/src/surfaces/pageTitle.js` + `usePageTitle()` in `Layout.jsx`) | product-architecture §5-A.1 — a shell that hosts surface kinds from a manifest | ⚰️ was *"BLOCKED-OWNER — OI-06"*. OI-06 was answered 2026-09-14 (telemetry-derived-defaults.md); CP1 turned out not to need it, CP2 did and is now built. **CP3+** ("surface kinds become real") was gated on OI-06 answered + the A2 registry decision (gate packet §3) — OI-06 is answered and A2 is now DONE too (line 131), so CP3 may already be proposable; not yet checked in detail or proposed. ⚰️ Checked 2026-09-20: a scoped proposal now exists — `12-decisions/gates/s1-cp3-panel-registry-scoped-proposal.md` (`registerPanel`/TD-02 error boundary/staggered-mount cap as MUST, `promote`/`popout` naming as SHOULD, the entity page + DEC-01's final lock explicitly DEFERRED) — ready for the owner's signature; its own APPROVAL block is blank. | **DONE** for CP1 and CP2; CP3 scoped proposal drafted 2026-09-20, awaiting owner signature |
| **S2** Command / Search | ✅ **CP1-CP6 ALL SIGNED, BUILT, AND MERGED** — CP1 `feb7ba1f8` / CP2 `095f27f97` / CP3 `ad0abe637` / CP4 `f8175989d` / CP5 `66ee4e6b4` / CP6 `1e765b577`, confirmed live on `origin/master` (`ChartPane.jsx`/`Watchlists.jsx` import `chordById`/`matchesChord` from `chords.js`) | §5-A.2 — a keyboard registry with one binding table, now closing all 5 original Shift+F surfaces | ⚰️ was *"BLOCKED-OWNER — OI-06"*, same correction as S1. ⚰️ was *"`chords.js` has exactly ONE real chord (`SHIFT_F`) — CP3 (one more surface adopts) is the next open checkpoint"* — CP3-CP6 are now all signed and merged, closing every original surface. Separately, **F-S2-1** (the Ctrl/Cmd+Shift+F collision found while building CP1, §3.4f below) is fully closed: signed `72cda4cda`, fix merged+deployed `0fb91d427`. | **DONE** — CP1-CP6 all signed/built/merged; F-S2-1 closed |
| **S3** Entity Master | **SHIPPED** CP1–8 `ed6b1f041` | entity-master-spec §all | ⚰️ was *"its gate packet is UNSIGNED"* — packet APPROVED 2026-09-11, frontmatter corrected 2026-09-20 to match (§0 above) | **DONE**, packet APPROVED |
| **S4** Context Bus | ✅ **CP1–CP3 SIGNED AND BUILT** (`f6df6dca1` CP2, `f4b06a886` CP3) | context-bus-spec §3.1 — one bus, both contexts as thin adapters, every consumer unchanged | CP3 (`HubContext.symbol` now derives from `useAppFocus`) was browser-verified per §7's own requirement — a real `MutationObserver` render-cost measurement across a full nav cycle, given the 2026-09-10 render-freeze precedent on this exact module. CP4 (TickerHubContext), CP5 (setVoicePageHint), CP6 (snapshot baseline), CP7 (timeframe authority) are each their own line. | **DONE** for CP1–CP3; CP4+ buildable |
| **S5** Persistence & User State | ✅ **CP2–CP4 SIGNED AND BUILT** (`9c7c634da` CP2, `41ffcc91c` CP3, `ea7178473` CP4) | persistence-user-state-spec — a typed store for list/preference documents | CP1's Notebook-pattern extraction stays deferred (F-S5-1, its own named condition — a second adopter existing AND 30 days live, 2026-10-12). S5-C was ruled: Tracings moves off `user_preferences` to its own store rather than growing that endpoint's other 70 call sites a compare-and-set. CP3 built the backend (dedicated table, CAS), CP4 wired `useTracingsSync.js` to it, dark behind `TRACINGS_STORE_ENABLED=false`. CP5 (default-ON, member-visible) needs a browser-certification matrix at Wave Q1's own tier before its own line. | **DONE** for CP2–CP4; CP5 needs a browser-cert pass first |
| **S6** Personalization | ✅ **CP2'/CP3/CP4 BUILT AND MERGED** 2026-09-18 (`47e2ad559`/`a35762d0d`/`359190d4d`) | personalization-spec | **RESOLVED, not blocked.** ⚰️ This said *"CP2–CP5 need four owner rulings the spec says it cannot make."* Cards 1/2 (SET-vs-WEIGHTED-SET, derive-vs-mirror) were DEFAULTABLE — the spec names its own default, applied without a fresh ruling (CP2'/CP3 built on it). Card 4 (paid-gating) was RULED PAID under explicit owner delegation 2026-09-18, matching the already-paid-gated sibling `/api/calendar/my-sets` (CP4 built on it). Card 3 (`personal_edge`) was RULED **NO** — interest and edge stay separate concepts (DECISION_CARDS_2026-09-18.md CARD 3) — CP5 (the only checkpoint that card would have unblocked) is therefore CLOSED with no code, not open. | **DONE** — CP1–CP4 shipped; CP5 closed by ruling, nothing left to build |
| **S7** Alerts | **8 of 8 types registered**; **every CP3 merged and ARMED** as of 2026-09-13; dark-comparison READ completed 2026-09-18 (production-verified via `railway ssh` + independent yfinance cross-check) | alerts-monitoring-spec §5 — every type registered, comparable, and flipped | ⚰️ This said *"the dark READ, then the flip"* as if the flip followed automatically. The read is done and RULED: **HOLD**, under explicit owner delegation 2026-09-18 (DECISION_CARDS_2026-09-18.md CARD 6) — not because the new evaluator disagrees with legacy (it doesn't; the one apparent disagreement, RMIX, is the two rules' designed semantics working as specified), but because the persistence-semantics question (one-shot vs. re-fires) is genuinely unmade product scope, the n=10 sample is thin and partly synthetic, and there is zero trendline/anchor-rewrite coverage — real member-facing risk this delegation does not resolve unilaterally. | **RULED-HOLD** — a real decision, not a block; `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` stays in dark-comparison mode |
| **S8** Provenance & Freshness | SHIPPED | provenance-freshness-spec | full `<Cited>` still D2-gated | **BLOCKED-DEPENDENCY** — D2 |
| **S9** Entitlements | ✅ **CP1 SIGNED AND BUILT** (2026-09-19) — the entitlement axis enumerated from source as inert data, plus two mechanical fixes (Login.jsx trial-routing bug, FREE_PAGES triplication) | — | ⚰️⚰️ **OI-03(a)/(b), OI-12 and OI-09 all ANSWERED BY THE OWNER 2026-09-19** (not the blanket "we have all licensing and approval" statement itself, which was asked back precisely and answered per-question). **(a) Massive tier: CONFIRMED Business/Enterprise, already held** — this corrects, same day, an earlier and more tentative owner statement ("beta phase, commercial upgrade planned but not yet in place"); a direct check afterward found Business was already in force. **(b)** FMP DDLA confirmed to exist (15 of 19 FMP-gated licensing-register rows move R→LA). **(c) paid-only model** confirmed matching current code exactly. **OI-09/OI-E02-09: UCT CONFIRMED staying downstream** — not a vendor of record; N-26's attestation machinery is deliberately not built. **✅ CP2 SIGNED 2026-09-20** (fingerprint `f808508f7`, gate packet §8): reading the 30 unlocked rows individually rather than as a count found 19 already LIVE (zero member-visible effect — Business tier retroactively authorizes what members already see) and 11 unbuilt TERMINAL-NEXT candidates (also zero effect today; only unblocked for a future, separate proposal) — CP2 is a documentation-only checkpoint, no code/flag/schema change. ⚰️ **Every one of the 8 rows that stayed U on four distinct facts is now RESOLVED**: **ESC-05** (T-23, T-24, T-25, N-07, N-08 — does Massive's own agreement name OPRA display and pay the $1,500/mo floor) — ANSWERED 2026-09-19, written Massive confirmation, favourably. **ESC-14** (N-19 — alert display vs. non-display use) — ANSWERED, same confirmation, favourably. **T-31** (the same-day dark-pool lane's ≥15-min lag) — MEASURED 2026-09-19 (not enforced), FIXED same day, **DEPLOYED TO PRODUCTION 2026-09-20** (`408b9a33f` on master, Railway `web` SUCCESS, `/api/health` uptime reset confirmed). **T-20** (ESC-21 + OI-03(d) — paid-Substack Edge User + signed addenda) — **ANSWERED 2026-09-20**, Massive and FMP in writing. | ✅ **DONE** — CP1 and CP2 both signed, every owner fact in this system answered |
| **S10** Presentation Primitives | **SHIPPED** `3c539d011` · CP2 `6576f044e` | presentation spec | ⚰️ was *"F-S10-1 residue (§3.1)"* — **residue confirmed absent, 2026-09-20** (§3.1: exactly 2 `formatPrice` sites, both forwarding to `presentationPrimitives.js`) | **DONE** — no open finding |
| **S11** Session / Clock | SHIPPED | — | none | **DONE** |
| **S12** Rollout | 1st `56df6803f` · 2nd `78ba40fe8` | rollout spec — role checks become cohort tags | ⚰️ was *"cohort 6, projected 6"* — in-pod verified per `2026-09-13-roster-after-two-build-days.md`: cohort 6, **projected 12**, unchanged | **DONE** |

### 1.2 Data platform (D-series)

| system | current | DONE means (cited) | gap | blocker |
|---|---|---|---|---|
| **D1** Provider Abstraction | SHIPPED, census GREEN | provider-abstraction-spec | G5 quarantine entry cleared | **DONE** |
| **D2** Canonical Data Model | CP1 `b9783d509` · CP2 `ffa8102c7` (narrowed) · top-level CP3 (dual-compute flip) mechanism built `0b8cf4c41`+`40bf07c99`, still needs its own approval line · **§4-CP4 (indicator axis, PRD §9.5) SIGNED AND MERGED** `404b808c5` / fingerprint `3257cc319` · **§4-CP3 (retire timeframe-map duplicates) SIGNED AND MERGED** `bcde1f9e8` on `origin/master`, fingerprint `8c5f83ca0` | canonical-data-model-spec §§1–6 | ⚰️ was *"§4-CP3's signed-but-unmerged code"* — FALSE ALARM, corrected 2026-09-20: it was already on `origin/master` as `bcde1f9e8` (docs-worktree-vs-master check, same root cause as the S2/event-proximity false alarms elsewhere in this file). The one genuinely open item is the **top-level CP3 dual-compute flip**, which needs real member traffic (0 rows collected as of 2026-09-19). | **BLOCKED-DATA** (top-level CP3 needs traffic) — §4-CP3 fully closed |
| **D3** Realtime Streaming | ✅ **CP1/CP2/CP3 BUILT AND MERGED** `302f99e8e`/`af9fe21a6`/`21405e045` | realtime-streaming-spec | ⚰️ was *"UNSIGNED, no CP1 authorized"* — CP1 was owner-signed 2026-09-12. CP4 (the first real consumer, S7's price-level sweep) is the next open checkpoint and is a real architectural bet (§4 marks it the first non-inert one) — not proposed this session. ⭐ **A scoped proposal for CP4 now exists, ready for the owner's signature:** `12-decisions/gates/d3-cp4-price-level-consumer-scoped-proposal.md` (2026-09-20) — closes the `STREAM_BARS_ENABLED` evidence gap live (`=1`), re-verifies the flow-worker non-strand on the current tree, and sizes the `add_interest` cap; its own APPROVAL block is still blank. | **DONE** for CP1–CP3; CP4 has a scoped proposal awaiting the owner's signature |
| **D4** Caching & Serving | ✅ **CP1-CP3 SIGNED AND BUILT** `40caca541` (`f2a2a68a6`/`388cad07c`/`dc5752b16`) · **CP4′ SIGNED AND BUILT** `23a8da7a9` (`3c070bee7`, confirmed on `origin/master`) | caching-and-serving-spec | ⚰️ was *"spec + gate written, UNSIGNED"* — CP1–CP3 were signed and built 2026-09-12/13 (this doc's own §2 build log already had this), and CP4′ (the corrected earnings_table cache-key assertion from F-D4-1) was signed 2026-09-18 and built the same window. ⚰️ was *"The one real remaining item: CP5 (`ticker_logos.py`'s resolution-decision cache) has no approval line at all — it is unscoped, not merely unsigned-with-a-line-written."* **CP5 now has a scoped, ready-to-review proposal** — `gates/d4-cp5-ticker-logos-cache-scoped-proposal.md` (2026-09-20), which also files **F-D4-2**: SPEC-D4/GATE-D4's own CP5 naming described a different mechanism (an addressed-tier `cache.py` entry) than the disk-only fix now proposed (the `.miss`-file provider-skip set that stops the daily 03:25 ET miss-retry from re-walking providers that already answered cleanly) — see the new file's §6. **Still zero approval lines signed on CP5.** | **DONE** for CP1–CP4′; CP5 has a scoped proposal awaiting the owner's signature |
| **D5** Reference & Corp-Actions | **CP1, CP3, CP4, CP5, CP6, CP7 MERGED** — `9458ea641`/`3bf13974a`/`da2930cec`/`c7ac0b7bc`/`76fb85247`/`e38d47b55` | reference-corp-actions-spec | ⚰️ was *"CP2–CP7 unsigned."* CP3–CP5 and CP7 shipped 2026-09-18 (the adjustment-basis endpoint, member-visible). CP6 (renamed-only) shipped the same day on a re-investigation that found a real, previously-missed vendor source (`/vX/reference/tickers/{ticker}/events`) for confirmed ticker changes — verified live against production; still no vendor source exists for merger/relation_added, so that half of CP6 stays unbuilt by design. **CP2 (the inert `corp_actions.db` ledger, spec §4.1) remains unsigned/unbuilt** — its own §4 row already classifies it as read by nothing, so nothing else in D5 is waiting on it. | **DONE** for every checkpoint anyone is waiting on; CP2 is the one genuinely open proposal, un-authorized, not blocking |
| **DEC-08** Portfolio/risk deferral | ⚰️ was labeled "D8" — renamed to **DEC-08** 2026-09-11 (`2b1633c81`). ⚰️ was *"Deferred, gated on OI-06"* — OI-06's actual answer was about desk-tool benchmarks, not this question, so it never triggered the unblock condition. **The gating question was put to the owner directly 2026-09-20: "does the desk need a corp-actions/portfolio-risk calendar on a daily basis?" Answer: "Yes, we need it daily."** See `ARCHITECTURAL_DECISION_REGISTER.md` DEC-08 for the full record. This does not mean the calendar is built or scoped — F-09's provider gap (no data source for a genuine corporate-actions event calendar beyond splits/dividends) is unchanged and still real. | — | needs a scoping pass; F-09's provider gap (no data source) is the next real blocker | **CONFIRMED NEEDED, NOT YET SCOPED** — owner-answered 2026-09-20, no longer deferred; A14 inherits the unblock but still needs its own scoping pass |

### 1.3 Application (A-series) + intelligence

| system | current | gap | blocker |
|---|---|---|---|
| **A1** Markets | live surface | no quote field is addressable | **BLOCKED-DEPENDENCY** — D2 |
| **A2** Charts & Analytics | live surface | ⚰️ was *"S1 + S2 both gated on OI-06"* — OI-06 was answered by the owner directly 2026-09-19 (`DECISION_CARDS_2026-09-18.md` §7d), and S1/S2 themselves are DONE-with-an-open-CP (their remaining CPs are code-buildable, not owner-blocked). A2 inherits no independent blocker of its own beyond that. | **DONE** — unblocked with S1/S2; no open ruling of its own |
| **A3/A4** · **A5** · **A6/A7** · **A8** | SHIPPED | none | **DONE** (4 rows) |
| **A9** Screening | live surface | ✅ `scan-membership-change` CP3 merged `df937146c` — it fires dark; ⚰️ was *"flag OFF"* — **armed 2026-09-13, in-process `1`** (§4 Flag Ledger). A9 needs the dark comparison read + CP4 + the FLIP, both owner-bound | **BLOCKED-OWNER** — read the dark comparison, sign CP4 + FLIP |
| **A10** Options & Flow | live, partner-owned | ⚰️ was *"D3 + D4 as systems"* — both systems are now DONE for every checkpoint anyone is waiting on (§1.2). The gap narrows to **D3's CP4** (S7's price-level consumer) **+ D4's CP5** (ticker_logos) — both now have scoped proposals awaiting the owner's signature (§1.2) | **BLOCKED-DEPENDENCY** — narrower than a whole-system wait |
| **A11** Breadth & Regime | live surface | ✅ `regime-change` CP3 merged `506eeee6d`, ARMED 2026-09-13 — but it compares **dark**. Still needs the one-regime ruling, D2 coverage, and this type's CP4 + FLIP | **BLOCKED-OWNER** — the flip, the one-regime ruling — + **BLOCKED-DEPENDENCY** (D2) |
| **A12** Watchlists | half-live | ⚰️ was *"S5 + S6"* as a dependency block — both are now DONE (§1.1: S5 CP2–CP4 signed+built; S6 CP2'/CP3/CP4 built, CP5 closed by ruling). A12 inherits no dependency block anymore; matching the A2/A14 correction style, what remains is that A12 **needs its own new checkpoint** proposed against the now-unblocked systems. ✅ **A scoped CP1 proposal now exists and is ready for the owner's signature**: `docs/terminal-research/12-decisions/gates/a12-watchlists-cp1-scoped-proposal.md` — a no-product-code consistency rail between `member_interest.py`'s watchlist/flagged buckets and `watchlist_service.py`'s own membership definition, plus pinning the two named gaps (column-preset persistence, no S5-shaped saved object yet). Approval block is UNFILLED; no A12 PRD/spec exists and this proposal does not substitute for one | **BLOCKED-SPEC-READ** — CP1 proposal awaiting owner signature (moved from BLOCKED-DEPENDENCY, §0) |
| **A13** Journal | live (528 files) | ✅ `position-risk` CP3 merged `6a67a4b5d`, ARMED 2026-09-13 — but it compares **dark**. Still needs D2, S5, and this type's CP4 + FLIP | **BLOCKED-OWNER** — the flip — + **BLOCKED-DEPENDENCY** (D2, S5) |
| **A14** Portfolio & Risk | no member door | DEC-08 (⚰️ was labeled "D8" — renamed 2026-09-11, `2b1633c81`; see DEC-08 row) + S9 | ⚰️ **OI-03, OI-12 ANSWERED; S9 CP2 SIGNED 2026-09-20 (see S9 row).** ⚰️ was *"BLOCKED-DEPENDENCY on DEC-08 only"* awaiting DEC-08's own gate — **DEC-08 CONFIRMED NEEDED 2026-09-20** (owner, direct answer). A14 is unblocked from the deferral, but still needs its own scoping pass, and inherits F-09's real provider gap (no corporate-actions data source beyond splits/dividends) — not a clean unblock, a different, real blocker |
| **E1** | outside the named roster | — | **EXCLUDED** |
| **I1** Intelligence Layer | SHIPPED, 3 slices, `1c426c199` | ⚰️ was *"F-I1-2 parked by owner (browser checks)"* — **F-I1-2 shipped 2026-09-14** (`17d7e2ef5`, confirmed on `origin/master`: derived refusal reasons, 13 test cases in `tests/test_ticker_explain_refusal_names_the_gap.py`; the owner-facing before/after artifact is `verification/2026-09-14/F-I1-2-refusal-before-after.md`, substituting for a live browser session). ⚰️ was *"its own SLICE 3 approval block is separately flagged MALFORMED"* — corrected 2026-09-20 on the owner's explicit direction: `SCOPE APPROVED:` is now filled in, transcribed from commit `17d7e2ef5`'s own message (the commit the block's fingerprint pins), not invented (`intelligence-layer-pre-implementation-gate.md`) | **DONE** — code shipped, approval block corrected |

---

## 2. GATE PACKETS — authorized vs built

| packet | signed | checkpoints AUTHORIZED | BUILT | gap |
|---|---|---|---|---|
| D2 | ✅ | CP1, CP2 (NARROWED) | CP1, CP2, **CP3 store built ahead of its line** | ⚠️ CP3 has no approval line; the store is log-only and fires nothing |
| D5 | ✅ | CP1, CP3, CP4, CP5, CP6 (renamed-only half), CP7 | CP1, CP3, CP4, CP5, CP6 (renamed-only half), CP7 | ⚰️ was *"CP2–CP7 unsigned"* — CP3/4/5/7 shipped 2026-09-18, CP6 shipped the same day (renamed-only; no vendor source exists for merger/relation_added, so that half stays unbuilt by design). **CP2 (the inert `corp_actions.db` ledger) is the one genuinely open, unauthorized checkpoint** — read by nothing, so nothing else in D5 is waiting on it |
| H14 | ✅ | the whole scope | all, + AMD fixture | none |
| I1 | ✅ | 3 slices | 3 | none |
| S10 | ✅ | CP1, CP2 | both | ⚰️ was *"F-S10-1 residue"* — confirmed absent 2026-09-20, see §3.1 |
| S12 | ✅ | migration 1, 2 | both | none |
| S4 | ✅ | CP1 | CP1 | CP2 unsigned |
| S7 `price-level` | ✅ | CP1–CP3, CP3b | all | dark read pending |
| S7 `event-proximity` | ✅ | CP1–CP3 | all | ⚰️ was *"CP1, CP2 declared/built, dark read pending"* — **CP3 (the dark-projection sweep) is also merged**, `c97e2a501` per `LEDGER.md`, and `ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED` reads armed in-process (§3.1). The dark comparison read itself is still pending — a live `railway ssh` query against `event_proximity_comparison_spans` was attempted 2026-09-20 to pull real agreed/new-only/legacy-only numbers and was blocked by this session's own tooling permissions; the owner or a session with that access can run it |
| S7 `catalyst-match` | ✅ | CP1–CP3 | all | dark read pending |
| S7 `position-risk` | ✅ | CP1–CP3 | all | dark read pending |
| S7 `scan-membership-change` | ✅ | CP1–CP3 | all | dark read pending |
| S7 `regime-change` | ✅ | CP1–CP3 | all | dark read pending |
| S7 `indicator-condition` | ✅ | CP1–CP3 | all | dark read pending for the ONE comparable predicate; the other 30 are EXCLUDED (F-S7-IC-1, resolved 2026-09-20 — see §3) and will never become comparable via the dark read regardless of when it happens |
| D3 | ✅ | CP1, CP2, CP3 | CP1, CP2, CP3 | ⚰️ was *"❌ unsigned"* — CP1/CP2/CP3 all signed and built (CP3 fingerprint `f028e4390`, 2026-09-19). ⚰️ was *"CP4 ... not yet proposed"* — a scoped proposal now exists, `gates/d3-cp4-price-level-consumer-scoped-proposal.md` (2026-09-20), unsigned |
| D4 | ✅ | CP1, CP2, CP3, CP4′ | CP1, CP2, CP3, CP4′ | ⚰️ was *"❌ unsigned"* — CP1–CP3 signed+built under one fingerprint `40caca541`; CP4′ signed+built separately `23a8da7a9`. ⚰️ was *"CP5 (ticker_logos) has no approval line at all"* — a scoped proposal now exists, `gates/d4-cp5-ticker-logos-cache-scoped-proposal.md` (2026-09-20, files F-D4-2), unsigned |
| S5 | ✅ | CP2, CP3, CP4 | CP2, CP3, CP4 | ⚰️ was *"❌ unsigned"* — CP2/CP3/CP4 signed and built (`9c7c634da`/`41ffcc91c`/`ea7178473`, see §1.1). CP1 (Notebook-pattern extraction) stays deferred per F-S5-1; CP5 (default-ON) needs a browser-certification pass first |
| entity-master (S3) | ✅ | approved 2026-09-11 | S3 is BUILT | ⚰️ was *"built without a signed packet"* — packet frontmatter corrected 2026-09-20 to reflect the approval it had already recorded in prose |

⛔ **TWO BOOKKEEPING ANOMALIES THIS AUDIT FOUND, NEITHER OF THEM A BUILD PROBLEM:** S3 shipped
CP1–8 against an unsigned packet, and D2's CP3 sample store was built against a gate line that does
not exist yet (on the owner's explicit ruling to restructure it, which is a different thing from an
approval line). Both are named here so the next reader does not discover them as gaps.

---

## 3. EVERY REGISTERED FOLLOW-UP

### 3.1 F-* findings — ⚰️ ~~24~~ **34 distinct**, harvested 2026-09-13

⚰️ **THE COUNT WAS 24 AND THE HARVESTER FINDS 34.** `tools/harvest_followups.py` over the doc tree
returns 34 distinct `F-*` ids. The 24 was correct when written and drifted as findings were added
without touching this heading — a hand-typed count beside the list it describes, in the register
whose job is to be the count. **Do not re-type it: run the harvester.**

| id | origin | status | what closes it |
|---|---|---|---|
| **F-D2-1** | D2 CP2 — fundamentals has no declaration to ratify | **OPEN** | write the fundamentals declaration if it is writable; else EXCLUDE with the reason |
| **F-D2-2** | D2 CP1 | ⚰️ was OPEN — needs re-read | **CLOSED** — PRD-D2 §9.5 is signed and merged, as **GATE-D2 CP4** (fingerprint `3257cc319`, built `404b808c5`) rather than the "§9.5 CP1" name the blocking line used; `s7-indicator-condition-pre-implementation-gate.md` §~19 already resolves the naming mismatch and confirms it is the same artifact |
| **F-D2-3** | D2 CP1 | OPEN | — needs re-read |
| **F-I1-1 … F-I1-6** | I1 slices | ⚰️ was *"I1-2 PARKED by owner (browser checks)"* — **F-I1-2 shipped `17d7e2ef5`, 2026-09-14** (confirmed on `origin/master`); 1,3,4,5,6 recorded | F-I1-2: **CLOSED** — the SLICE 3 approval block's blank scope text was corrected 2026-09-20, transcribed from commit `17d7e2ef5`'s own message under the owner's direction |
| **F-S10-1** | a price has two right renderings | **CLOSED** by S10 CP2 `6576f044e` — **residue confirmed absent**, 2026-09-20 | `git grep -n "formatPrice" origin/master -- app/src` shows exactly **2** `formatPrice` function DEFINITIONS — `components/chart/drawingLabels.js:75` and `components/provenance/presentationFormat.js:88` — and both are one-line forwards (`return formatPriceTick(...)` / `return formatPriceDisclosure(...)`) to `lib/presentation/presentationPrimitives.js`'s canonical implementations. Every other grep hit is either a call site importing one of the two forwards, or a test (`priceIsTwoPrimitives.test.js` etc.) proving byte-identity with the pre-S10 bodies. No third, independent rendering site exists. |
| **F-S10-2** | `<Cited>` ET label | **CLOSED** `e909279e1` | — |
| **F-S7-1 … F-S7-5** | S7 wave 1 | F-S7-5 **CLOSED** `5ff6fc04a`; others recorded | — |
| **F-S7-CM-1** | catalyst-match | ⚰️ ~~OPEN~~ → **CLOSED** — its closer merged | CP3 `4fa45489f` |
| **F-S7-EP-1** | event-proximity | OPEN | the dark read |
| **F-S7-IC-1** | indicator-condition — the empty intersection | ⚰️ ~~OPEN, MEASURED AND RAILED~~ → **CLOSED 2026-09-20.** Its stated closer (D2 §9.5 signature) HAPPENED — signed as GATE-D2 CP4 `3257cc319`, merged `404b808c5`. The 31×142 intersection stays EMPTY by design: owner EXCLUDED the thirty non-comparable predicates permanently (OWNER_INPUTS.md D3) rather than authoring a book form for them — the legacy indicator lane keeps its own vocabulary. CP3 continues to report them NOT COMPARABLE, which is now the accepted, closed state, not a pending gap. | resolved: EXCLUDE |
| **F-S7-PR-1** | position-risk | ⚰️ ~~OPEN~~ → **CLOSED** — its closer merged | CP3 `6a67a4b5d` |
| **F-S7-RC-1** | the dedup key is written and never read | ⚰️ was *"CONFIRMED, OPEN"* — **EXCLUDED 2026-09-20** per OWNER_INPUTS.md B5's own conditional (flip undated, RC-1 costs nothing today — path A's ledger already suppresses same-cycle floods) | resolved: EXCLUDE |
| **F-S7-RC-3** | path B has no suppression | ⚰️ was *"CONFIRMED, OPEN"* — **FIXED 2026-09-20**, `feat/s7-price-level` `87b5735f4`: `_regime_shift_already_told()` reads the most recent `regime_shift` insight's own headline and suppresses a repeat for an unchanged summary; 42-test regime-change suite + 238 total across every `voice_proactive_service` caller, 0 failures | resolved: fix shipped |
| **F-S7-RC-4** | the third emitter | **CLOSED — EXCLUDED PERMANENTLY** by owner ruling, GATE §10 | — |
| **F-S7-SMC-1** | scan-membership-change | ⚰️ ~~OPEN~~ → **CLOSED** — its closer merged | CP3 `df937146c` |

✅ **F-S7-RC-2 IS NOW IN THE DOC TREE — re-swept 2026-09-13, ZERO code-only follow-ups.**
The sweep compared every `F-*/HY-*/OI-*/DEC-*/RG-*` id in `api/`, `tools/`, `tests/`, `scripts/`
(28 ids) against the doc tree (139 ids): **the difference is empty**, with a control confirming the
sweep can see a match. ⚰️ The original warning, kept because the lesson is the point: The harvester found RC-1, RC-3 and
RC-4 but no RC-2; the finding (path B's substring label match) lives in
`api/services/alert_taxonomy/regime_change.py`. **A finding that exists only in code is invisible
to every doc-side audit, including this one** — it was found by noticing the gap in the sequence.

### 3.1b ⛔ FINDINGS OPENED BY THE COMPLETION VERIFICATION — 2026-09-13

⚰️ ~~Registered with evidence, **not fixed**: that pass was read-only by instruction.~~

✅ **ALL THREE CLOSED 2026-09-13** on the owner's instruction, in the pass that followed. F-S7-PL-3 by a derivation + control (`9b1d6c537`); F-GATE-1 by re-pinning ONE line from git history (`4f522011c`) plus the convention written into the gate rule; F-FLAG-1 as an **advisory only** — no flag changed, no audit behaviour changed, the scope written into the tool's docstring and the follow-up named to the flow workstream.

| id | finding | evidence | closes when |
|---|---|---|---|
| **F-GATE-1** ✅ **CLOSED** | **Two approval-fingerprint conventions coexist, and one packet's two lines share a single pin.** 27 of 33 lines are `git hash-object` content fingerprints; **6 are commit SHAs** (`s7-event-proximity` ×2, `s7-price-level` ×2, `intelligence-layer` ×2). A commit SHA does pin the bytes via `git show`, so nothing is unpinned — **but `s7-event-proximity`'s two lines both read `76529e75b`, a commit that contained only the FIRST block.** Line 2's pin names a state in which line 2 did not exist. | `git cat-file -t` on all 33; re-derivation at `a31f02374` and `09785ac95` reproduces neither line | the owner rules one convention, and event-proximity line 2 is re-pinned under it. ⛔ Needs a new signature — out of scope for a verification pass. |
| **F-S7-PL-3** ✅ **CLOSED** | **`tools/s7_price_level_report.py --self-check` FAILS (exit 1): `expected six declared sweeps, found 7`.** A hand-typed count inside the instrument's own self-test, made stale by adding the seventh sweep. ⚠️ `--ticking` itself is CORRECT (verified in-pod, exit 0, all seven reported) — it is the self-test that is wrong, which is worse than it sounds: **a failing self-check is how you learn the instrument is broken.** | `python tools/s7_price_level_report.py --self-check` → `SELF-CHECK FAIL: expected six declared sweeps, found 7` | the count is DERIVED from `SWEEPS`, as `terminal_next_gate_check.py` was corrected to do in `aed75ddaf` |
| **F-FLAG-1** ✅ **CLOSED — advisory recorded** | **`tools/flag_ledger_audit.py` is blind to value-level divergence on a multi-service flag.** It reports 0/0/0/0 while five flags declared `armed` with `web` in `where` read `'0'` in the web process: `MASSIVE_WS_ENABLED`, `FLOW_BACKUP_ENABLED`, `FLOW_GAP_AUTOFILL_ENABLED` (all three deliberately `0` on web per the P5 flow-worker cutover), `DESK_SESSION_DISCORD_RECAP_ENABLED`, `J2_SHARE_LINKS_ENABLED`. The audit asks *"does some service set it?"*, never *"is it ON where the ledger says it is?"* | in-pod read of all 96 `armed@web` flags; 5 divergences, audit still 0/0/0/0 | the audit compares per-service VALUES, or `where` distinguishes "present" from "on". ⚠️ **Not Terminal-Next's flags** — advisory to their owners. |

### 3.2 OI-* — 21 owner inputs

All 21 are in `OWNER_INPUTS_REQUESTED.md` with a stated default. §6's `OWNER_INPUTS.md` turns the
ones that block a system into a fill-in form. **None is closable by this programme.**

⚰️ Was "Blocking a system today: OI-03(a)(b) → S9, A14 · OI-06 → S1, S2, A2 · OI-12 → S9, A14."
**OI-03(a)(b) and OI-12 are now ANSWERED (2026-09-19, see the S9 row above)** — they no longer
block S9 or A14; both wait on S9 CP2's own proposal instead, a BLOCKED-DEPENDENCY, not
BLOCKED-OWNER. Blocking a system today: **OI-06** → S1, S2, A2. The other 20 are recorded with
defaults and block nothing.

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

### ✅ 3.4f F-S2-1 (new, 2026-09-13) — Ctrl/Cmd+Shift+F FLAGS A TICKER ON THREE SURFACES — CLOSED

⚰️ **This section's heading was ⛔ (open) with a "what closes it" ask below.** F-S2-1 is
**CLOSED**: signed (fingerprint `72cda4cda`, its own gate packet
`s2-accelerator-chord-pre-implementation-gate.md`) and the guard-change fix is merged and
deployed (`0fb91d427`, confirmed an ancestor of `origin/master` via `git merge-base
--is-ancestor`). The three loose surfaces (`TickerPopup.jsx`, `ThemeTrackerPage.jsx`,
`Watchlists.jsx`) now carry the tightened `!repeat && !ctrl && !alt && !meta` guard shape from
`ChartPane.jsx`, and `LOOSE_MODIFIER_BASELINE` in `chordCollision.test.js` is empty. The
narrative below is kept as the historical record of what was found and why CP1 didn't fix it.

> **Found by building S2 CP1's collision rail. The 2026-08-28 fixture is not history — it is still
> shipped, in its MODIFIER form.** *(as of the original 2026-09-13 finding — now fixed, see above)*

Five surfaces claim `Shift+F` (flag the ticker) and they do not agree on which modifiers they
answer, measured on `feb7ba1f8`:

| surface | guard | answers Ctrl/Cmd+Shift+F? |
|---|---|---|
| `components/chart/pane/ChartPane.jsx` | `!repeat && !ctrl && !alt && !meta` | **no** ✅ |
| `pages/charts/grid/GridChartCell.jsx` | `!repeat && !ctrl && !alt && !meta` | **no** ✅ |
| `components/TickerPopup.jsx` | `!repeat` | ⛔ **yes** |
| `pages/ThemeTrackerPage.jsx` | `!repeat` | ⛔ **yes** |
| `pages/Watchlists.jsx` | `!repeat && selectedSym` — a STATE guard, not a modifier one | ⛔ **yes** |

⭐ **So a member reaching for the platform accelerator chord gets a silent write to their flag list
on three screens and nothing on two.** That is HY-35's recorded class — *"one chord flagged a ticker
in two widgets at once"* — in the form the 2026-08-28 ownership fix did not cover.

⛔ **CP1 DELIBERATELY DID NOT FIX IT.** The signed scope says *"NO change to the shipped palette's
behaviour"*, and tightening three guards is a behaviour change. The three are **baselined by name**
in `app/src/pages/command/chordCollision.test.js`, the suite is green today, and a **sixth** loose
surface fails by name. The baseline is checked in both directions, so a site that gets fixed must
leave the list deliberately rather than letting the record outlive the defect.

**What closes it:** one approval line naming the guard change on the three surfaces —
`ChartPane.jsx` is the shape to copy — after which `LOOSE_MODIFIER_BASELINE` empties and F-S2-1
closes. ⚠️ It is a behaviour change a member can feel (a chord that used to flag stops flagging), so
it wants a line of its own rather than riding along.

### ✅ 3.4e F-D2-2 (new, 2026-09-13) — §6 ASSERTED A SIGNATURE THAT DOES NOT EXIST — CLOSED

⚰️ **CLOSED.** The §9.5 addendum this section says is missing a signature is now signed and
merged — as **GATE-D2 CP4** (fingerprint `3257cc319`, built `404b808c5`), the §4-naming rule's
renumbering of what this section calls "§9.5 CP1." `indicator-condition`'s own gate packet
resolves the naming mismatch explicitly and both CP3 (indicator-condition, built `d31b78b75`) and
D2 CP4 are live. The narrative below is kept as the historical record of what was found.

> **§6 row 9 read *"⚠️ SIGNED by the owner 2026-09-13"* for D2 §9.5 CP1. No artifact supports it,
> and the build stopped rather than proceeding on the claim.**

Measured, three ways, before anything was built:

| what was checked | what it says |
|---|---|
| PRD-D2 §9.5's approval block | `APPROVED BY:      (empty — owner has not signed this addendum)` — **verbatim** |
| the D2 gate packet's signed blocks | exactly **2** (CP1–CP2, CP2–CP3). Neither names §9.5 |
| the D2 gate packet's §4 table | **CP1 / CP2 / CP3 only** — the canonical address book. There is no §9.5 row to name |

The claim entered §6 in `db8830bd4`. ⭐ **This is the defect the §4-naming rule exists to catch,
arriving from the other direction:** the rule guards against a scope that names no checkpoint, and
here the control file named a *signature* that no packet carries. A build against it would have been
an unauthorized change to the canonical address book — the one artifact whose *"whole safety
property is that nothing computes"* (PRD §9.5).

⛔ **AND IT CASCADES.** `indicator-condition` CP3's own approval line says: *"this line is void
unless D2 §9.5 CP1 has merged first. If it has not, indicator-condition CP3 is NOT authorized and
the blocker is that dependency."* So §6 rows 9 and 10 are **both** unbuildable, and neither is a
build-queue item.

**What closes §9.5 — and one of the three is not D2's to give:**

1. The owner signs the §9.5 addendum, which is a **product decision about the boundary of D2**: the
   book today maps a name to a *stored place*, and §5.4 asks it to describe *computations* — the
   first time it would describe work rather than location.
2. The thirty legacy addresses declared with per-timeframe cadence, plus the `close` ↔ `ohlcv.c`
   rename recorded **as a rename** (the one real rename among 31 addresses, 30 being genuine
   absences — a figure a first probe got wrong by comparing `close` to `c`).
3. ⛔ **A FLOW-WORKER CLOSURE DECISION D2 DOES NOT OWN.** `bars_fetch.py` / `bars_sqlite.py` are
   inside flow-worker's import closure and outside its watch list. **Either those paths join the
   watch list, or every declaring commit rides a marker bump** — and GATE-D2 §CP2.4 already refused
   to work around exactly this.

⚠️ Until 1 and 3, `indicator-condition` CP3 would ship *"a projection over predicates that all
refuse — not a smaller CP3, a CP3 with nothing in it"* (PRD §9.5, verbatim).

### ✅ 3.4d F-CAT-1 (new, 2026-09-13) — THE CATALYST ENGINE IS BILLING AND WRITING NOTHING — FIXED

⚰️ **FIXED.** ⚰️ This said *"It is NOT this programme's to fix"* — the owner ruled otherwise the
same day (*"production outage takes priority over the queue... fixed because it's live"*,
`LEDGER.md`'s cross-program section) and it WAS fixed, on this programme's branch: merged
**`f49da5ed6`** to `origin/master` 2026-09-13 (confirmed a direct ancestor). Root cause:
`engine.py` had eight consecutive unguarded enrichment calls between the billed LLM call and the
first `store.upsert_catalyst()`, so one exception skipped persistence entirely while still
billing. `catalyst_runs` is now a durable run receipt so a recurrence would not take four days to
find again. **Separately, F-CAT-2** (hunter calls billing on a near-empty/hallucinated prompt) is
also **CLOSED**, fixed 2026-09-18 (`7899ae8d5`, confirmed merged to `origin/master`). The narrative
below is kept as the historical record of what was found.

> **Found while dry-running catalyst-match CP3.**

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

**What closed it:** ⚰️ was *"somebody who owns the catalyst engine reads the 09-08 → 09-09 boundary. Not touched here..."* — the owner ruled it should be touched here (production outage priority), and it was: `f49da5ed6`, merged 2026-09-13, see the section heading above.

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

**Status:** OPEN — unaffected by F-S7-RC-3's fix below, which added a repeat-fire
dedup on top of this exact substring-match mechanism without changing it.
**What closes it:** owner form item **B5**'s same reasoning as F-S7-RC-1 (EXCLUDE,
below) — it dies at the S7 flip if the flip happens, and the flip has no date.

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
| `ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED` | **armed 2026-09-13**, in-process `1` | **NO** — retires at the flip |
| `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED` | **armed 2026-09-13**, in-process `1` | **NO** — retires at the flip |
| `ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED` | **armed 2026-09-13**, in-process `1` | **NO** — retires at the flip |
| `ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED` | **armed 2026-09-13**, in-process `1` | **NO** — retires at the flip |
| `D2_SAMPLE_PERSIST_ENABLED` | armed, in-process `1` | **YES** — a kill switch, keeps its life |
| `SMOKE_LOGIN_LINK_ENABLED` | armed on web | **NO** — explicit removal instruction recorded |
| `HUB_PREVIEW_ENABLED` | armed | **YES** — kill switch |
| `NOTEBOOK_OFFLINE_DEFAULT_ON` | armed | **YES** — kill switch |

⚠️ **A DARK FLAG WITH NO RETIREMENT DATE BECOMES PERMANENT BY DEFAULT.** There are now **SIX** S7
dark flags, not two, and each retires only when its type flips — nothing today forces that. ⛔ Six
armed comparisons is six standing invitations to leave a "temporary" flag in place for a year;
`flag_ledger_audit.py` reports **0 discrepancies**, which proves the ledger is honest about their
state and says nothing about whether they should still be on.

---

## 5. WHAT THIS AUDIT CHANGES ABOUT THE PLAN

### ⚰️ THE A9 RE-SORT, RUN 2026-09-13 AFTER `scan-membership-change` CP3 MERGED — **A9 DOES NOT UNBLOCK, AND THE CLAIM BELOW WAS TOO OPTIMISTIC**

> **A9 CP1 is NOT BUILDABLE. A9 moves from BLOCKED-DEPENDENCY to BLOCKED-OWNER, and that is
> real movement — but it is not an unblock.**

`RESUME.md` states A9's condition precisely: *"CP1–CP2 fires nothing; **A9 needs fires**."* CP3
now merged (`df937146c`), and what it delivers is a **dark projection**: `alert_fires` + receipts
written for a comparison, behind `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED`. ⚰️ This said the
flag *"reads `None` in the running process"* — it is **armed** (§4 Flag Ledger above: "armed
2026-09-13, in-process `1`"), for the `rollout:s7-dark` cohort only, with no delivery import
anywhere in the three modules.

⭐ **So the fires exist and no member can receive one.** A9's capability — a member being told a
name entered or left their screen — is delivered by **CP4 plus the FLIP**, each of which needs its
own approval line and neither of which is build work. The audit's "one CP3 unblocks a whole
application" was measuring the wrong boundary.

⛔ **AND A9 HAS NO GATE PACKET AT ALL**, so "build A9 CP1 if BUILDABLE" has a second, independent
answer: there is nothing to cite. Writing one now would design against a flip decision the owner
has not made.

**What closes A9, exactly:** ⚰️ was *"the owner arms `ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED=1`, reads the dark comparison..."* — the flag is already armed. The owner (or a delegated session) reads
the dark comparison, then signs `scan-membership-change` **CP4** and the **FLIP** line. A9's packet
follows the flip, not the other way round. **This is the real remaining work — not yet done.**

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

# ✅ **THE QUEUE IS EMPTY — 2026-09-13.** Every numbered row below is DONE with its SHA.

**AUTHORIZED-AND-UNBUILT = 0.** Nothing in this programme is both signed and unbuilt. The three
rows that are not DONE are not buildable and each says why:

| row | state | why it is not buildable |
|---|---|---|
| ~~S5 CP1~~ (the extraction) | ⏸️ **DEFERRED — F-S5-1** | needs a second adopter and Wave Q1 live 30 days (**2026-10-12**). It matches no §4 row, so it is UNSIGNABLE as written. |
| A9 CP1 | ⛔ **NOT BUILDABLE** | see below — and A9/A11/A13 are **BLOCKED-OWNER** on the flips after the dark reads. |
| ~~S6 CP2–CP5~~ | ✅ **RESOLVED 2026-09-18** | ⚰️ was *"SPEC-BLOCKED — four owner rulings."* CP2'/CP3/CP4 built (§1.1 S6 row); CP5 closed by a NO ruling, not built. See DECISION_CARDS_2026-09-18.md CARDS 1–4. |

⛔ **THE FOURTH STATE IS STILL AT ZERO.** Nothing is `⛔ NOT-YET-CLASSIFIED`.

⭐ **WHAT THE PROGRAMME IS WAITING ON IS NOW A MEASUREMENT, NOT A BUILD.** Seven dark sweeps are
armed and ticking; the next decision is next weekend's read, and the deciding column is
**`legacy_only`** — the count of fires the legacy lane made that the new lane did not. Agreement
is cheap when both sides are quiet; `legacy_only` is the only column that can say the new lane
would have dropped a member's alert.


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
| 8 | **S6 CP1** — the source-vocabulary rail | **`b3073c67c`** signed 2026-09-13 | ✅ **DONE** | **`12b6c3946`** |
| — | S6 **CP2'/CP3/CP4** | `47e2ad559`/`a35762d0d`/`359190d4d` | ✅ **DONE 2026-09-18.** ⚰️ was *"SPEC-BLOCKED, packet written, unsigned"* — signed + merged, DECISION_CARDS_2026-09-18.md CARDS 1/2 (defaultable) + CARD 4 (ruled paid). CP5 closed by CARD 3's NO ruling, no code. | `s6-cp2-prime-build-record.md`/`s6-cp3-build-record.md`/`s6-cp4-build-record.md` |
| 11 | **`indicator-condition` CP3** | **`4e8d3af5d`** signed 2026-09-13 (line 3, the dependency-discharge line) | ✅ **DONE.** Dependency discharged — PRD-D2 §9.5 is GATE-D2 CP4 (`3257cc319`, `404b808c5`). Classified **ADDITIVE**: measured, all CP3 modules ABSENT from flow-worker's 154-module closure, so the packet's *"CP3 strands the substrate regardless"* prediction is **recorded as wrong** rather than dropped. ⛔⛔ **THIRTY OF THIRTY-ONE PREDICATES ARE NOT COMPARABLE** (F-S7-IC-1) — said per predicate, never as agreement, with the `close` ↔ `ohlcv.c` rename as the non-vacuity control. SPEC-S7 §5.2 amended to the code (8 keys) in `6e5564501`. | **`d31b78b75`** |
| 9 | **D2 §9.5 CP1** — the indicator axis | **`3257cc319`** signed 2026-09-13 as **GATE-D2 CP4** | ✅ **DONE.** §4 was RE-NUMBERED in the signing commit to add CP4, per the standing rule: §9.5's scope matched none of CP1/CP2/CP3, all three written for the stored-column form. Classified **ADDITIVE** — `indicator_axis` is absent from flow-worker's 154-module closure. Flag `CANONICAL_INDICATOR_AXIS_ENABLED` **dark**. | **`404b808c5`** |
| 10 | **S2 CP1** — chord table + collision rail | **`7ae6d9ca2`** signed 2026-09-13 | ✅ **DONE** | **`feb7ba1f8`** |

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

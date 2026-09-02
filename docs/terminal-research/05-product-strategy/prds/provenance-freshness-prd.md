---
id: PRD-S8
title: Provenance & Freshness (S8) — Product Requirements Document
role: Phase 3 deliverable — specification of a LOCKED system (ARCHITECTURAL_DECISION_REGISTER D6), not implementation
phase: 3
group: product-strategy
category: prd
scope: The one shared rendering + data-contract system that carries source, as-of, calculation version, and coverage on every number, every AI-generated sentence, and every list TERMINAL-NEXT renders. Specifies S8 (product-architecture.md) precisely enough to build; does not re-litigate D6 (LOCKED) or redesign D2's provenance data model (specified in data-architecture.md §11, restated here only where S8 consumes it).
status: draft — Phase 3 deliverable, awaiting review
date: 2026-09-02
sources: product-architecture.md (S8 system block; §1.3 property 2; §5-B.4; §7 I1; §8 boundary matrix; §9 six-questions table; ARCH-DECISION-REGISTER D6) · information-architecture.md (P3 primitive; §2 property 3; §5 panel contract `freshness` field; §7.4 collision policy; §12 curated-first receipt) · data-architecture.md (§11 provenance model; §12 freshness metadata; §13 confidence/data-quality metadata; §14 licensing/entitlement metadata; §23 AI data access; §24 frontend access patterns) · capability-ledger.md (F-03a, rows G2, H5, K2, D12, A10, TD-02, TD-08, TD-18 cited by row id) · capability-infrastructure-matrix.md (S8 row, §3 Platform-Core tier; D2 row, §4 Data-Platform tier) · ARCHITECTURAL_DECISION_REGISTER.md (D6) · GOVERNING_PRINCIPLES.md (§9, §13) · DAY_1_EXECUTIVE_SYNTHESIS.md (§1.12, §1.14, §4.3, §12.3) · PHASE_2_INTEGRATION_SYNTHESIS.md (adversarial-validation fix 5)
confidence: 🟡 overall — 🟢 wherever this file restates a cited artifact's own established finding; 🟡 wherever it composes multiple artifacts into a buildable requirement; 🔴 on nothing owner-bound (S8 carries no PROVISIONAL marker of its own — the two OWNER-BOUND items that touch it, D9 posture and D5 licensing tier, are designed so S8's contract is unchanged by either answer, per product-architecture.md §7.5 and the reversibility ledger)
---

# Provenance & Freshness (S8) — Product Requirements Document

## 0. What this document is

This is the buildable specification for **S8 — Provenance & Freshness**, one of four systems the Architectural Decision Register marks **LOCKED** — meaning the *what* and *why* need no further owner input, only implementation planning (Phase 4). S8's decision (**D6**, LOCKED) is settled: one shared rendering component for provenance, freshness, and coverage, replacing today's scattered per-surface mechanisms. This document does not re-argue D6. It specifies precisely what "one shared component" means: its data contract, its rendered states, its ownership boundary against D2 (the provenance data model) and I1 (the intelligence layer), and the acceptance criteria an implementation team can build and test against.

**What this is not.** Not the provenance data model itself — the typed Entity/Activity/inputs/as-of/calc-version record is D2's (Canonical Data Model & Metric Address Book), specified in `data-architecture.md` §11; S8 *renders* what D2 stores, it does not define D2's schema. Not a redesign of D6 — D6 already decided "shared, not per-surface," and the evidence for that decision (the second-authority defect class, the six-plus scattered AI doors) is inherited, not re-derived here. Not an implementation plan — no schema DDL, no component file layout, no sprint sequencing; those are Phase 4.

---

## 1. Traceability chain — why this system exists, made explicit

The program's anti-drift rule requires every deliverable to trace to the north star, not to architecture for its own sake. S8's chain:

**Original user/product need.** A trader acting on a number — a price, a breadth percentage, an earnings estimate, an AI-generated read on why a stock is moving — needs to know two things before acting on it: *where did this come from* and *how current is it*. Absent that, every number is equally trustworthy-looking whether it is a live tick or a five-day-stale fallback, and every AI sentence is equally authoritative whether it is grounded in a tool-sourced fact or a model's own recollection. This is not a hypothetical need — UCT's own history shows the failure mode concretely: a fetch that silently renders `.catch(() => null)` as "No recent news" for a ticker that in fact had none checked (the incident behind `TD-18`); a "48 commands" count and a "24 skills" count each drifting between two pages of the same vendor's own site, catalogued across eleven competitor dossiers as the *same* recurring defect class (`DAY_1_EXECUTIVE_SYNTHESIS.md` §4.3: "derive the number through the artifact that owns it, or print none"); and inside UCT itself, TD-19's "second authority over one value" recurring in nine-plus places.

**Target UCT Terminal workflow.** Every one of the seven interaction-loop states in `product-architecture.md` §2.1 depends on this — most explicitly **READ** ("every panel re-targets... S8 Provenance/Freshness: every number carries as-of and source") and **DECIDE** ("reads the verdict... S9 Entitlements: what this member may see"). Concretely: a member loads a security, sees its quote, its breadth context, and asks the AI layer "why is this moving" — every element of that answer must be traceably sourced and dated, or the terminal is indistinguishable from a dashboard that happens to look confident.

**Product capability.** "Terminal-grade" property 2 in `product-architecture.md` §1.3: *"Provenance on every number and every sentence."* Property 3 in `information-architecture.md` §2: *"Every number carries its receipt... no number renders without passing through P3."* This is not a nice-to-have panel feature; it is named as one of the five (`information-architecture.md`) or nine (`product-architecture.md`) properties that collectively define whether TERMINAL-NEXT is terminal-grade at all.

**Existing UCT capability (cited by row id, not paraphrased).** UCT already has the *mechanism*, three times over, never generalized:
- `G2` — the screener's `CoverageLine` four-count receipt (evaluated · answered · dropped · not-computable, with `withheld` beside), which "refuses to present a receipt whose arithmetic does not close" and states explicitly, above the counts, when a gap in what UCT holds is being mistaken for a quiet market (`capability-ledger.md` row G2, citing `CLAUDE.md` Phase E section).
- `H5` — the COT positioning rail's grounding gate: a narrative may cite only what is in a deterministic `cotFacts.js` object; a number appearing in generated prose that is not in the facts object stores nothing (`capability-ledger.md` row H5).
- `K2` — AI Search's "grounded on" citation chips over an intent-gated context pack with declared grounding gaps (`capability-ledger.md` row K2).
- `D12` — `provider_coverage_monitor.py`, which measures per-field fill-rate against a declared floor across roughly 30 data classes today, self-heals a stale cache entry, and alerts only on newly-flagged tickers so a persistent anomaly stays visible without re-spamming (`capability-ledger.md` row D12).
- `A10` — the one working instance of a genuine provenance *data* model, `bar_provenance.py`/`bar_quarantine.py`, scoped to bars only and living in `auth.db` rather than beside `bars.db` (`capability-ledger.md` row A10).
- Two named absences: `TD-08` — five unrelated freshness/coverage implementations (`SyncFreshnessChip`, `staleWindowLabel`, `CoverageNote`, `ChartMarketClock`, `CoverageLine`) with no shared component, and 118 files each defining their own number formatter. `TD-18` — 186 files call `fetch(` directly and six named files still swallow a fetch failure into a silent `.catch(() => null)`, rendering absence-of-data as fact.

**Gap.** Every mechanism above is real and works, in isolation, for exactly one surface. None is shared; none reaches a *computed* value's row — a number the desk's own engine derives (a breadth percentage, an exposure score) has no addressable identity for a citation mechanism to point at at all (`data-architecture.md` §11.3, restating `DAY_1_EXECUTIVE_SYNTHESIS.md` §1.12). The Readiness Review names this precisely: "real mechanisms exist scattered across screener/COT/AI-Search, no shared component" (`READINESS_REVIEW_DAY1.md` §4). This is a structural gap, not a missing feature — closing it is what converts "every AI answer is cited" from a discipline three engineers each remembered to apply, into a guarantee the render path enforces.

**Proposed system.** S8 — one rendering component set (`<Provenance>`, `<FreshnessBadge>`, `<CoverageLine>`, `<Cited row=…>`) that every application, and every I1 (Intelligence Layer) answer, routes through. S8 owns rendering and the receipt contract; it consumes — never redefines — the provenance data D2 stores (`product-architecture.md` S8 block: "not the provenance *data model* [D2] and not any evaluator").

**Data/provider requirements → UX/interaction requirements → technical requirements.** Specified in full below (§6–§13).

---

## 2. Who this is for, and what problem it solves

**Primary users.** Every member and desk user of TERMINAL-NEXT, indirectly — S8 has no UI a person navigates *to*; it is infrastructure every other surface's UI is made of. The direct "user" is every other system in the platform (S8's actual consumers are S1–S12, D1–D5, I1, and A1–A14 per the boundary matrix, `product-architecture.md` §8) and, through them, three concrete member-facing moments:
1. A trader reading a number on any panel, who needs to know its source and currency without leaving the panel.
2. A trader reading an AI-generated sentence (a verdict, an explanation, a summary), who needs the same guarantee extended to prose, not just figures.
3. A trader looking at a *set* of results (a scan, a screen, a week of calendar rows), who needs to know how many were evaluated, how many answered, how many were dropped, and how many the system genuinely cannot compute — as four distinct facts, not one collapsed count.

**Secondary "user."** The implementation team building every other TERMINAL-NEXT system, who needs one component to import rather than inventing a sixth freshness widget or a fourth `fmt*` helper.

**The problem, stated concretely.** Today, "no data" means at least three different things across the estate and a member (or an engineer six months later) cannot tell which: *empty because nothing exists*, *empty because this member is not entitled to see it*, and *empty because the feed is down* all currently render as the same blank panel or the same silently-omitted line (`product-architecture.md` S8 block: "Must NOT own... a 'no data' state that conflates empty, not entitled, and down — TD-18"). Separately, "grounded" currently means whatever the nearest engineer built: a hard citation gate for COT, a soft "grounded on" chip for AI Search, a hard-closing four-count receipt for the screener, and nothing at all for a number rendered directly from a `useSWR` hook on any of the other roughly 30 data classes in the estate. S8 exists to make "every number has a receipt, and every set of results has an honest count" a property of the render path, not a property of whichever engineer happened to build a given panel.

---

## 3. System boundaries — restated from product-architecture.md, not redesigned

Per this task's contract, S8's boundary is restated, not redesigned, from `product-architecture.md`'s system block and the D6 correction PHASE_2_INTEGRATION_SYNTHESIS.md documents.

**Responsibility (verbatim from the system block).** "One rendering component for provenance, freshness and coverage on every number, every sentence and every list: source, as-of, calculation version, the four-count receipt (evaluated · answered · dropped · not computable, with `withheld` beside), session-state stamps, the honest blank."

**Answers.** Question (d) — UI exposure — *of* the normalization D2 performs (question b). S8 never itself normalizes data; it exposes what D2 already normalized.

**Inputs.**
- Provenance rows from D2 — a value's Entity/Activity/inputs record, per `data-architecture.md` §11's W3C PROV-shaped model (§7 below expands this).
- Freshness class from D4 (Caching & Serving) — real-time / delayed-15 / end-of-day / historical, per `data-architecture.md` §12.1.
- Coverage counts from application evaluators — e.g., the screener's `scan_coverage` computation (`G2`), generalized so any application with a partial result set (a fundamentals sweep, a calendar week, an options-chain-across-a-universe query) computes and exposes its own four counts from the *same* provenance fields, "not a bespoke count invented per surface" (`data-architecture.md` §13.2).
- Session state from S11 (Session & Market Clock) — for the LIVE / delayed / stale vocabulary's session-awareness.

**Outputs.** The rendered receipt (a badge, a chip, an inline citation marker); a linkable citation marker for any addressed value (D2's address book makes a value clickable — the "click a number, see the row" gesture, `data-architecture.md` §11.3/§24.2).

**Dependencies.** D2, D4, S10 (Presentation Primitives — S8's components are rendered *through* S10's primitives, not a parallel rendering stack), S11.

**Ownership boundary.** Rendering and the receipt contract. Explicitly **not**: the provenance data model itself (D2 owns the schema, the typed record, the address); any evaluator's coverage logic (an application computes its own evaluated/answered/dropped/not-computable counts; S8 renders them uniformly).

**Primitives exposed (the actual component contract).**
- `<Provenance value=…>` — wraps a rendered number or fact; renders source + as-of + calc-version on demand (hover/click), never inline by default for a dense grid.
- `<FreshnessBadge>` — the `LIVE / delayed N min / as-of HH:MM ET / stale` vocabulary (`information-architecture.md` §5 panel contract row), session-aware via S11.
- `<CoverageLine>` — the generalized four-count receipt, with `withheld` rendered beside (never folded into) the four counts.
- `<Cited row=…>` — the click-the-number-see-the-row gesture for any addressed (D2) computed metric.

**Must NOT own (the explicit scope-creep tripwires, verbatim).**
- The calculation of any value (that is every application's job; S8 never computes, only displays what was computed).
- A "no data" state that conflates empty, not entitled, and down (`TD-18`).
- A provenance mode-switch with no rendering change (named as an anti-pattern independently at two competitors — Quartr's optional wider-web mode and LSEG's older opt-in Bing fallback, `DAY_1_EXECUTIVE_SYNTHESIS.md` §4.3 — where a toggle changes what the system will cite without changing what the member sees, which defeats the point of a citation mechanism).
- A hand-typed count beside the artifact it describes (`DAY_1_EXECUTIVE_SYNTHESIS.md` §4.3's "derive the number through the artifact that owns it, or print none" — S8's counts must always be derived from the same evaluator that produced the result set, never retyped by a second author).

**Build condition.** Consolidate — generalize `CoverageLine` / the COT grounding gate / AI-Search's citation chips into one component (`READINESS_REVIEW_DAY1.md` §7 D6); this is also the freshness half of `TD-08`.

**Relationship to I1 (Intelligence Layer) — the defect this program caught and fixed.** Phase 2's adversarial validation found S8 and I1 both claiming ownership of "the one provenance renderer" in the first draft of `product-architecture.md` — exactly the second-authority defect S8 exists to prevent, caught in the architecture describing S8 itself (`ARCHITECTURAL_DECISION_REGISTER.md` D6; `PHASE_2_INTEGRATION_SYNTHESIS.md` fix 5). The corrected boundary, binding for this PRD: **I1 owns no rendering component.** Every AI answer routes through S8's renderer. I1's own primitives (`<VerdictCard posture=…>`, `<Answer provenance=…>`) are I1-authored *compositions* that render *through* S8's `<Provenance>`/`<FreshnessBadge>`/`<Cited row=…>` primitives — they are not competing renderers (`product-architecture.md` §7, I1 system block). Concretely: when I1 renders `grade_ticker`'s GO/HOLD/SKIP verdict, the verdict card is I1's layout, but every cited number inside it (the entry price, the regime read, the win-rate) renders through S8's `<Cited row=…>`, exactly as a chart panel's price would.

**Relationship to D2 (Canonical Data Model & Metric Address Book).** D2 is on the critical path and is explicitly **not yet built**; S8's contract is designed so it does not need to wait for D2's full canonical-schema migration to start. S8 consumes whatever provenance record exists for a given value today — even the narrow, bars-only `bar_provenance.py` shape — and D2's later generalization of that shape (`data-architecture.md` §11.3) changes what S8 has to render *from*, never what S8 renders *as*. This is why S8's own build condition is "consolidate" (a rendering-layer task) while D2's is "new" (a data-modelling task on the critical path) — see §12 (Dependencies) for the sequencing this implies.

**Boundary-matrix edges (from `product-architecture.md` §8, restated for reference).** S8 may call: S10 (●, renders through it), S11 (●, session state), D2 (●, reads provenance), D4 (●, reads freshness). S8 may be called by: S1, S2 (both ✗ — the shell and command surface never call S8 directly, they render applications which call S8), every Application (● — mandatory, per the platform contract), I1 (● — mandatory, per the corrected boundary above), S7 Alerts (● — every fire is a receipt, `product-architecture.md` §5-B.6). S8 may never call: S1, S2, S3, S4, S5, S6, S7, S9, S12, D1, D3, D5, or any Application (✗ across the row) — S8 is a leaf in the dependency graph by design; it renders what is handed to it and originates no data fetch, no context resolution, and no entitlement decision of its own.

---

## 4. Primary workflows

Each workflow below is a concrete path through S8, named against the platform systems and application rows that actually produce the inputs — not an invented scenario.

**W1 — A number on a panel.** A member loads NVDA; the entity page (`information-architecture.md` §4.2/§4.5) mounts a fundamentals panel (`A3`). The panel fetches through D4/D1, which stamps a provenance row (source: FMP, activity: the nightly `stable/*` sync job, as-of: the sync's own timestamp) and a freshness class (end-of-day). A3 never renders the P/E ratio bare; it renders it wrapped in `<Provenance value={pe}>`, which on hover/click shows "FMP · as of 2026-09-01 22:14 ET · fundamentals sync run #4471." No new data fetch happens for this — S8 renders fields D1/D4 already attached at ingest.

**W2 — A computed number with no natural row.** The breadth dashboard (`A11`) shows `pct_above_50sma`. Today this number has no addressable identity at all — it is computed in a function and rendered directly (`data-architecture.md` §11 anti-pattern: "a document synthesised to hold a number"). Once D2 registers it (`registerMetric('pct_above_50sma', inputs, calcVersion)`), S8's `<Cited row=…>` can point at `uct://breadth/pct_above_50sma@<as-of>` the same way it points at a vendor-sourced quote. This is the workflow the Day 1 synthesis names as the reorganizing fact: "the desk's proprietary numbers are the ones its AI cannot cite" (`DAY_1_EXECUTIVE_SYNTHESIS.md` §1, "The reorganising fact") — W2 is the mechanism that closes it, one metric at a time, as D2 registers each.

**W3 — An AI-generated sentence.** A member asks I1 "why is NVDA moving today." I1 composes an answer from tool-sourced facts (the catalyst engine's thesis, the day's move-vs-sector residual) and renders it through `<Answer provenance=…>`, which is itself built on S8's `<Cited row=…>` per number cited in the sentence. If the honest answer is "nothing specific — a beta move with the sector" (the deterministic negative `information-architecture.md` §12 names as a first-class output, following Benzinga's WIIM precedent and UCT's own catalyst engine), that sentence still renders through S8, carrying the as-of of the residual computation — an honest negative is not an absence of provenance, it is a receipt that says "computed, and the answer is nothing specific."

**W4 — A partial result set.** A member runs a scan (`G2`/`G9` — screening). The scan evaluator returns evaluated=3,742, answered=1,127, dropped=0, not-computable=2,615 (because `rs_rank` is NULL across the universe on this data snapshot — the real, measured example already in the codebase, `capability-ledger.md` row G2). S8's `<CoverageLine>` renders all four counts, never collapses them, and — because `not_computable` is nonzero while `answered` could otherwise misread as "a quiet market" — renders the explicit sentence above the counts: this is a gap in what UCT holds, not a quiet market. This exact scenario is why `CoverageLine`'s refusal-to-collapse rule exists and why S8 inherits it verbatim rather than reinventing a "simpler" version.

**W5 — A delayed or restricted field.** A member without desk-tier entitlement views a quote that (pending D5/OI-03 resolution) may only be Massive Individual-tier, hence delayed rather than real-time. S8's `<FreshnessBadge>` renders `delayed 15 min` per the licensing register's required disclosure shape (`data-architecture.md` §12.1) — this is not a cosmetic label; UTP/CTA rules require the disclosure text to be prominent and repeated, and a Financial Status Indicator on every intraday quote display *including delayed ones* (§9 below expands this). S8 is the render path that must carry these strings the day TERMINAL-NEXT ships any delayed-price surface to a member — it is a new build, not a toggle, because UCT ships none of these strings anywhere in the app today (`data-architecture.md` §12.1).

**W6 — A calendar/coexistence value.** TERMINAL-NEXT's calendar surfaces read TERMINAL-CURRENT's `/api/calendar` contract (`A5`, `product-architecture.md` §4.2's "OUTSIDE EVERY BOUNDARY" list). Its own established convention — "TBD is a data value, not an error" — is a freshness/provenance state S8 must render *as* a valid state, not silently blank or error-styled, preserving the coexistence contract this program is bound not to alter (`capability-infrastructure-matrix.md` A5 row, citing C7-02 claim 4).

---

## 5. User stories / use cases

- **As a trader**, when I hover any number on any panel, I see where it came from and how current it is, without navigating away from what I'm looking at — so a stale fallback price never looks identical to a live tick.
- **As a trader**, when I read an AI-generated verdict or explanation, every factual claim in it is individually traceable to a tool call or a stored value — so I can verify the parts I want to verify without trusting the whole paragraph on faith.
- **As a trader**, when I run a scan or a screen that returns fewer names than I expected, I can tell whether that's because the market is genuinely quiet or because UCT's own data coverage has a gap — these are different facts and I act on them differently.
- **As a trader**, when a field is delayed rather than real-time, I am told so, prominently, at the point I'm looking at it, not buried in a settings page or a footnote.
- **As a trader**, when I see "TBD" on a calendar entry, I know it means "not yet scheduled by the source," not "something is broken" or "this panel failed to load."
- **As an implementation engineer building a new TERMINAL-NEXT application**, I import S8's components rather than deciding, on my own, how "grounded" or "stale" should look for my panel — so my panel is consistent with every other panel on day one, not eventually reconciled by a future consolidation pass.
- **As an implementation engineer building a new AI-accessible tool for I1**, my tool's provenance shape is declared in its registry entry (`registerTool(name, schema, provenanceShape, entitlementAxis)`, per I1's own primitive contract), and S8 renders whatever that shape resolves to — I never write a citation renderer myself.
- **As a compliance-conscious reviewer**, I can verify that no data-display route in TERMINAL-NEXT can silently omit a required delayed-data disclosure, because the disclosure is a structural output of S8 keyed to the freshness class D4 attaches — not a string a given panel author remembers to add.

---

## 6. Interaction behavior

**S8 has no navigable surface of its own** — no page, no route, no menu entry. Its interaction surface is entirely embedded: every rendered number, sentence, or list in every other application carries S8's output inline or on-demand.

**Default rendering density.** Citations are **always on** as data (the provenance record is always attached and always queryable), but **rendering is a density choice, not a data choice** — per `product-architecture.md` §5-B.4: "Citations always on, rendering optional... a per-answer toggle busts the cached prefix" (I1's own generative-answer caching depends on this: what gets *shown* can vary per view density without invalidating the underlying grounded answer). Concretely:
- **Dense grids** (a scan results table, a watchlist) render freshness as a compact badge per row or per column-header, and provenance on-demand (hover/click), never as inline text per cell — density is a token-driven control (`information-architecture.md` §2 property 8; the panel contract's `density` field, §5).
- **Prose surfaces** (an I1 answer, a COT narrative, a catalyst thesis) render inline citation markers per cited figure by default, since the entire value of the surface is its groundedness.
- **The four-count receipt** renders wherever a result set can be partial, always visible (not collapsed behind a toggle) — this is `CoverageLine`'s existing, inherited behavior, not a new interaction pattern.

**The click-through gesture.** `<Cited row=…>` is the "click a number, see the row" mechanic — clicking any addressed value opens its provenance (source, as-of, calc version, and, where the value is derived, its inputs recursively). This closes the reader-side half of the gap `DAY_1_EXECUTIVE_SYNTHESIS.md` §1.12 names: UCT's grounding is strong on the producer side (facts-first narration, hard gates) and had nothing on the reader side (a wire format the member can actually click through).

**Honest states, rendered distinctly, never conflated (the core interaction requirement).** S8 must render each of the following as visually and textually distinct states — this is the direct fix for `TD-18`'s conflation:
1. **Present and fresh** — the default state, receipt available on demand.
2. **Present and stale** — a `FreshnessBadge` reading `stale` (per S11's session-aware threshold), not silently rendered as if current.
3. **Empty because genuinely nothing exists** — e.g., a company with no analyst coverage. Rendered as a typed "no data" state.
4. **Empty because this member is not entitled** — rendered as `withheld`, distinct from both 3 and 5, per S9's refusal shape (`product-architecture.md` S9 block: "a refusal shape (`withheld`, never `dropped`/`not_computable`)").
5. **Empty because the feed is down** — rendered as a degraded/down state, distinct from 3 and 4, so a member (or an on-call engineer) can immediately tell "nothing to show" from "something is broken."
6. **Scheduled but not yet determined** — the calendar's `TBD`, rendered as a valid, non-error, non-blank state (W6 above).
7. **Computed, and the honest answer is "nothing specific"** — the deterministic negative (W3 above), rendered as a receipt, not as an absence.

**No silent mode-switch.** If a surface's citation behavior changes (e.g., a denser view suppresses inline markers), the underlying groundedness never changes with it — this is the named anti-pattern S8 must not reproduce (§3 above, "a provenance mode-switch with no rendering change").

---

## 7. Required data

S8 is a consumer, not an originator, of every field below — this section states what S8 requires to be *available* on a value before that value can render through S8's components; the schema itself is D2's to own (`data-architecture.md` §11).

**7.1 The provenance record (per value), minimum fields S8 requires (from `data-architecture.md` §11.3, generalizing `bar_provenance.py`'s shape):**
- **source-activity reference** — which adapter, job, or run produced this value (the "which vendor" question, made queryable rather than a bolted-on string).
- **source-entity reference** — which upstream vendor payload the value was derived from.
- **timestamp** — when the value was fetched or computed, distinct from the value's own as-of date; this is also the freshness field's seam.
- **tie-break record** — where more than one vendor could have answered the same field, which one won and why (e.g., FMP's `_earn_row_preferred` logic, made a queryable decision rather than buried in one function's control flow).

**7.2 The freshness class (per price-shaped value), per `data-architecture.md` §12.1 (R-A4-2):** one of **real-time · delayed-15 · end-of-day · historical**. This is not cosmetic — it determines what the renderer is *permitted* to draw (§9 below).

**7.3 The confidence/evidence-class field, per `data-architecture.md` §13.3:** the same mechanism as the provider ledger's KP/CR/OC/CA evidence ladder, generalized — "a confidence/evidence-class field on the provenance record... not a data-quality system built separately from a licensing-evidence system that happen to look alike." S8 renders this where relevant (e.g., a value sourced from a provider integration with weak evidence of being genuinely live renders differently from one with strong evidence).

**7.4 The four-count receipt inputs, per application evaluator:** `evaluated`, `answered`, `dropped`, `not_computable`, plus `withheld` (kept beside, never folded in). Every application whose result set can be partial computes these from its own evaluation pass; S8 requires only that they arrive as four (or five, with `withheld`) separate counts, "computed from the same provenance fields §11 defines — not a bespoke count invented per surface" (`data-architecture.md` §13.2).

**7.5 Session state, from S11:** the pre/RTH/post/closed/half-day boundary and minutes-since, injected as a first-class fact — never as a cache salt (`data-architecture.md` §12.3, citing `DAY_1_EXECUTIVE_SYNTHESIS.md` §12.3). This is what makes a `FreshnessBadge`'s `stale` threshold session-aware rather than a flat wall-clock timeout.

**7.6 No new provider data.** Per `capability-infrastructure-matrix.md`'s S8 row: "None external... No provider gap. Pure consolidation, explicitly flagged as 'cheap to decide now.'" S8 requires no new vendor integration; it requires every existing vendor-integrating system (D1 adapters, application evaluators) to *attach* the fields above at the point of ingest, which is D1/D2's build responsibility, not S8's.

---

## 8. Intelligence / AI behavior

S8 is the mandatory render path for every I1 (Intelligence Layer) answer — this is the corrected boundary from §3 above, restated here in AI-behavior terms because it is load-bearing for the north star's "every AI answer is cited" guarantee.

- **I1 composes; S8 renders.** I1's `<VerdictCard posture=…>` and `<Answer provenance=…>` are I1-authored layouts built *on top of* S8's `<Provenance>`, `<FreshnessBadge>`, and `<Cited row=…>` primitives — never a second, parallel citation renderer (`product-architecture.md` §7 I1 block, post-correction).
- **Prompt eligibility is computed from the same provenance field S8 renders from.** Per `data-architecture.md` §23.1, a restricted field that is never *displayed* but *is* sent to a model is still an exposure under Anthropic's own input-warranty terms — so the same provenance record that tells S8 whether a value may be *shown* also tells I1's prompt assembler whether a value may be *sent*. This is one mechanism serving two gates (display eligibility and prompt eligibility), not two separately-maintained rule sets — the direct payoff of doing §11/D2's provenance model once, correctly.
- **The facts-module-plus-grounding-gate shape is the pattern every I1 narrative lane must follow, and S8 is where its output surfaces.** COT's `cotFacts.js`/`cot_narrative.py` grounding gate (`H5`) and `flow_explain.py` are UCT's own proven instances: a narrative may cite only what is in a deterministic facts object, and a number appearing in generated prose that is not in that object stores nothing (`data-architecture.md` §23.2, naming this "the cleanest AI surface in the product"). Every new I1 narrative lane inherits this shape; S8 is where the resulting citation renders once the gate has passed.
- **The honest negative is a first-class S8 output, not an I1 special case.** "Nothing specific — a beta move with the sector" renders through S8 exactly as a positive, cited claim does (§4 W3, §6 state 7) — S8 draws no distinction between "here is what moved it" and "here is why nothing specific moved it," because both are equally grounded, equally as-of-stamped claims.
- **What I1 must not do through S8.** Render a number it did not receive from a registered tool (`data-architecture.md` §23's "do not synthesise a document to hold a number" anti-pattern); append a hedge to a kept fabrication rather than refusing to render the claim at all (`product-architecture.md` §7 I1 block, "Must NOT own... a hedge appended to a kept fabrication"); offer a per-answer citation-visibility toggle that changes what was actually grounded rather than only what is shown (§3, §6 above).
- **The two-audience posture (D9, PROVISIONAL / OWNER-BOUND) does not change S8's contract.** Whether I1's verdict renderer defaults to decisive-for-all or graduated-for-strangers is a `posture` input I1 resolves from S9; "both render the same cited rows; neither adds a hedge to a fabrication" (`product-architecture.md` §7.5). S8 renders the same receipt regardless of which posture I1 selected — this is precisely why S8 could be specified as LOCKED while D9 remains open.

---

## 9. Loading / error / empty / degraded states, provenance, and freshness expectations

This section is S8's actual center of gravity — restated with acceptance-testable specificity from §6's interaction states.

**9.1 The four-count receipt is the canonical honest-result-set idiom; it is never collapsed.** Evaluated · answered · dropped · not-computable render as four separate counts always, with `withheld` kept beside (never folded into any of the four), because "we could not compute it" and "something broke" are different facts to a trader (`data-architecture.md` §13.2, inheriting `G2`'s exact rule). A `<CoverageLine>` implementation that collapses these to a single "N results" number, or that omits `not_computable` when it is zero (rather than explicitly showing zero), does not satisfy S8's contract.

**9.2 A receipt whose arithmetic does not close is refused, not rendered.** `G2`'s existing rule — mirroring `scan_evaluator._assert_coverage_closes`, which refuses to write a receipt whose four counts don't sum to the evaluated total — is inherited verbatim. S8 must never render a partial or internally-inconsistent receipt; an evaluator that cannot produce a closing count is a bug in the evaluator, surfaced as a degraded state, not papered over by S8.

**9.3 The three-way "no data" split is structural, not stylistic.** Per `TD-18`'s explicit naming: *empty* (nothing exists), *not entitled* (`withheld`, from S9), and *down* (the feed failed) render as three distinct, typed states — never a shared blank panel, never a shared generic "no data" string. This is the single highest-priority fix S8 exists to make structural: today these three facts are indistinguishable at the render layer in at least six named files (`RsBadge.jsx`, `SetupSection.jsx`, `StatementPanels.jsx`, `QuoteStrip.jsx`, `KeywordAlerts.jsx`, `AiSearchInsightsPanel.jsx` — `TD-18`), and S8's acceptance test (§14) is that this becomes structurally impossible for any *new* TERMINAL-NEXT surface, because the one throwing fetcher every application uses (`product-architecture.md` §3.2 platform contract, item 4) resolves to one of these three typed states before S8 ever sees it.

**9.4 The delayed-data disclosure is a mandatory rendering obligation, not a design nicety, the day any delayed-price surface ships to a member.** Per `data-architecture.md` §12.1, citing the licensing register's R-A4-2: a delayed display requires — prominently placed, and repeated at least every 90 seconds in a ticker per UTP, "conspicuously displayed on all screens" per CTA — the disclosure notice ("Data Delayed 15 minutes" / "Del-15"), a Financial Status Indicator on every intraday single-security quote or trade display *including delayed ones*, and a Consolidated Volume Message where consolidated volume sits beside non-UTP data. **UCT ships none of these strings anywhere in the product today.** S8 is the render path where these strings live once TERMINAL-NEXT ships any delayed-price design to a member — this is a new build (not a toggle on an existing string), and it is a rendering *requirement* on S8 the day D5 (member-facing licensing posture) resolves toward any delayed-data product shape, independent of which way D5 resolves.

**9.5 The "delayed price, live volume" shape is a specific, named freshness composite S8 must be able to render.** Per `data-architecture.md` §12.2: a canonical quote can carry a 15-min-delayed last price beside real-time volume, live percent-of-ADV, and prior close — because multi-security real-time volume alongside delayed last-sale data is free under UTP's Derived Data policy, zeroing the Tape C exchange fee entirely. S8's `<FreshnessBadge>` must support **per-field freshness within one composite value** (a price badge reading `delayed 15 min` beside a volume badge on the same row reading `live`), not only one freshness class per rendered row.

**9.6 Session-aware staleness, never a flat wall-clock timeout.** A `stale` classification is computed against S11's session state (minutes since the relevant session boundary), not a fixed number of minutes regardless of whether the market is open — this is what §7.5 requires S11 to supply as a grounded fact rather than a cache salt.

**9.7 Loading state.** While a value's provenance/freshness fields have not yet arrived (a fresh fetch in flight), S8 renders a distinct loading affordance on the badge/receipt itself — never a value with no freshness indicator at all, and never a stale-looking blank that could be mistaken for state 9.3's "empty."

**9.8 Degraded state — S8 itself, not just its inputs.** If D2 or D4 cannot supply provenance/freshness fields for a value at all (a genuinely new data class mid-migration, before D2 has registered it), S8 must render the value plainly with an explicit "provenance unavailable" affordance rather than fabricating a receipt or silently omitting the wrapper — this is the honest-blank principle applied to S8's own degraded operation, not only to the data it renders.

---

## 10. Entitlement / licensing considerations

**10.1 S8 renders the entitlement decision; it never makes one.** Per the boundary matrix (`product-architecture.md` §8), S8 has no calling edge to S9 as a caller — S9 (Entitlements & Licensing Gate) makes the `withheld` determination server-side, and S8 only renders the resulting typed state (§9.3). This separation is deliberate: S8 must never become a second authority on "may this member see this," which the entitlement model explicitly forbids (`product-architecture.md` S9 block: "a parallel authorisation path is a second authority over what may this member see").

**10.2 Licensing class is a computed field on the provenance record S8 reads, never a fact S8 (or any surface author) has to remember.** Per `data-architecture.md` §14.2 (R-A4-1, "provenance is a field, not a memory"): licensing eligibility for display is a lookup against the licensing register's class table keyed by (vendor, data-class, audience), computed at the point of use from the same provenance record §7.1 defines. This converts "did anyone check the licensing here" from a code-review question into a structural guarantee — and it is why S8's design does not need to know the licensing register's rules directly; it only needs to render whatever eligibility D2/S9 already resolved.

**10.3 The delayed-data disclosure obligation (§9.4) is itself a licensing/entitlement requirement, not a UX preference.** The UTP/CTA disclosure strings exist because exchange data-redistribution agreements require them; S8's rendering contract for delayed data is the mechanism that keeps TERMINAL-NEXT's eventual member-facing delayed-price surface (§9.5) in compliance with an obligation that attaches the moment such a surface ships, regardless of which vendor tier (Individual vs. Business) D5/OI-03(a) ultimately resolves to.

**10.4 S8 is agnostic to D5's outcome, by design.** Whether Massive's tier resolves Restricted or Likely-Allowed (`D5`, PROVISIONAL / OWNER-BOUND, gated on OI-03(a)/(b)), S8's contract is unchanged: it renders whatever freshness class and licensing eligibility the resolved answer attaches to each value. This is the reversibility property the Architectural Decision Register names for S9's entitlement rows ("changing 57 rows changes no application code," `product-architecture.md` §10) — S8 inherits the same property one layer up, in the render path.

**10.5 Publication chokepoint.** Any AI output or generated artifact leaving the controlled product (a brief, a scan-of-the-day, a newsletter) must ground on public-domain / EOD / multi-security-derived facts and pass the one audience gate before external distribution (`data-architecture.md` §23.5, R-A5-5) — S8's receipt is what makes that grounding externally verifiable (a published artifact's citations trace to the same provenance fields an internal member would see), not merely internally asserted.

---

## 11. Performance expectations

**11.1 S8 must add no new data-fetch cost.** S8 renders fields already attached to a value at ingest (by D1/D2) or computed by an evaluator already running (by an application); it must never trigger a fresh vendor call, a fresh evaluation pass, or any request on its own initiative merely to populate a badge. A `<Provenance>` wrapper around a value that has no provenance record yet renders state 9.8 (degraded), not a blocking fetch.

**11.2 Receipt rendering is O(1) relative to result-set size for the four-count case.** `<CoverageLine>` renders four (or five) pre-computed integers; it must never itself iterate a result set to derive them — that is the evaluator's job, done once, upstream.

**11.3 Density-driven rendering must not defeat memoization.** Per §6, citation *visibility* is a density/view choice that must not require re-computing or re-fetching the underlying grounded answer — this directly protects I1's prompt-caching economics (`product-architecture.md` §5-B.4: "a per-answer citations toggle busts the cached prefix" is the failure mode to avoid). A view-density change toggles what S8 *shows*, never what was computed.

**11.4 No capacity/streaming budget of its own.** S8 is a rendering primitive with no realtime transport, no polling loop, and no independent cache — freshness data arrives on the same cadence as the value it describes (D3/D4's existing polling/streaming cadence), and S8 adds no additional network round-trip per render.

---

## 12. Dependencies

**12.1 Hard dependency: D2 (Canonical Data Model & Metric Address Book).** S8's fullest form — addressable computed metrics, the click-through-to-inputs gesture for every derived number — requires D2's registry to exist. D2 is explicitly on the critical path and explicitly **not yet built** (`data-architecture.md` §4: "Absent... explicitly on the critical path"). S8's narrower form — rendering the provenance already attached at existing ingest points (D1 adapters, the existing narrow `bar_provenance.py` shape) — requires no waiting on D2's full build. **Sequencing implication for Phase 4:** S8's component contract (the four primitives, the state taxonomy in §6/§9) can be specified and built against today's narrow provenance shape immediately; its full payoff (every computed metric addressable, §4 W2) arrives incrementally as D2 registers each metric class, not as a single cutover.

**12.2 Hard dependency: D4 (Caching & Serving).** Freshness class and staleness computation depend on D4's serving-policy fields (§7.2). D4 is tagged "extend" (already exists, under-adopted at 5 consumers today, `data-architecture.md`/`capability-infrastructure-matrix.md` D4 row) — this is a lower-risk dependency than D2's.

**12.3 Hard dependency: S10 (Presentation Primitives).** S8's components render *through* S10's primitives (formatters, density tokens) rather than maintaining a parallel formatting stack — S10 is tagged "consolidate" and is itself a Phase-4-buildable, non-owner-blocked system.

**12.4 Hard dependency: S11 (Session & Market Clock).** Session-aware freshness (§9.6) requires S11's versioned calendar dataset. S11 is tagged "new, small" — the cheapest genuinely-new system in the capability-infrastructure matrix, zero licensing exposure (`capability-infrastructure-matrix.md` S11 row).

**12.5 Soft dependency: S9 (Entitlements & Licensing Gate).** S8 renders the `withheld` state S9 determines; S9's mechanism already exists (`entitlements.py`), though its tier *numbers* are owner-bound (D5) — S8 does not wait on the numbers, only on S9 continuing to supply a `withheld` signal distinct from `dropped`/`not_computable`, which it already does today (`product-architecture.md` S9 block).

**12.6 Every application (A1–A14) and I1 depend on S8**, not the reverse — per the platform contract (`product-architecture.md` §3.2, item 3: "Renders every number through the Presentation primitives (S10) and every freshness/coverage state through the Provenance component (S8)"). This is a one-way dependency by design (§3's boundary-matrix restatement): no application or I1 is a prerequisite for S8 to exist; S8 is a prerequisite for every application's platform-contract compliance.

**12.7 No new provider/vendor dependency.** Per `capability-infrastructure-matrix.md`'s S8 row, restated at §7.6: this is pure consolidation engineering with no data-availability gap behind it.

---

## 13. Explicit non-goals

- **S8 is not the provenance data model.** The typed Entity/Activity/inputs/as-of/calc-version schema, the metric address book, and the per-ticker history join are D2's responsibility, specified in `data-architecture.md` §11 and `product-architecture.md`'s D2 system block — not redesigned or restated as a schema here.
- **S8 does not compute anything.** No breadth percentage, no exposure score, no coverage count, no confidence score originates in S8. It is a leaf renderer by contract (§3's boundary-matrix restatement).
- **S8 does not make entitlement decisions.** The `withheld` determination is S9's; S8 only renders it (§10.1).
- **S8 does not decide the D9 posture (decisive-for-all vs. graduated).** That is I1's `posture` input, resolved from S9; S8's receipt is identical either way (§8, last bullet).
- **S8 does not decide D5's licensing tier outcome.** S8's contract is unchanged by either resolution (§10.4).
- **S8 is not a data-quality monitoring system built separately from the licensing-evidence system.** Per `data-architecture.md` §13.3, confidence/evidence-class is one field, one mechanism, shared with the provider ledger's KP/CR/OC/CA vocabulary — S8 must not grow a second, parallel "how sure are we" system.
- **S8 does not migrate or retrofit the ~55 legacy SQLite files.** That migration-scope question belongs to D2/D11 (`ARCHITECTURAL_DECISION_REGISTER.md` D11); S8 renders whatever provenance shape exists for a value, generalized-or-legacy, without itself performing any migration.
- **S8 is not a citation mechanism for a computed value that has no addressable identity yet.** Where D2 has not yet registered a metric, S8 renders the honest "provenance unavailable" degraded state (§9.8) rather than fabricating one — this is a deliberate non-goal (S8 must never synthesize a citation), not a temporary gap to be silently patched.
- **Multi-asset breadth, order execution, and every other GOVERNING_PRINCIPLES §13 out-of-scope item** are out of scope for S8 exactly as they are for the whole program; S8's freshness-class vocabulary (§7.2) is defined for the in-scope asset classes (US equities, options, indices/ETFs, COT futures positioning) and is not designed against FX/fixed-income/crypto data shapes that do not exist in the provider estate.

---

## 14. Acceptance criteria

Each criterion is written to be testable by an implementation team without further product interpretation.

1. **No number renders in any new TERMINAL-NEXT surface without passing through `<Provenance>`.** A static/AST rail (in the shape of the existing `singleWriterIndex.test.js` or `test_yf_guard_census.py` railing pattern already used elsewhere in the estate) can enumerate every rendered numeric value in TERMINAL-NEXT application code and assert each is wrapped.
2. **No AI-generated sentence renders without every cited figure passing through `<Cited row=…>`.** Verified against I1's grounding-audit harness (the existing `--grounding-audit` mechanism, extended to Compass per `product-architecture.md` §7 build condition) — every number in generated prose traces to a tool-sourced fact, or the sentence is the deterministic honest-negative shape (§4 W3).
3. **A `<CoverageLine>` never renders with counts that don't sum to the evaluated total.** Mirrors `scan_evaluator._assert_coverage_closes`; a mismatched receipt is a hard refusal, not a rendered artifact (§9.2).
4. **The three "no data" states (empty / not-entitled / down) are visually and textually distinguishable in every new surface**, verified by a rail that mounts each of the three conditions against a test panel and asserts three different rendered outputs (directly closing `TD-18`).
5. **Every delayed-class value, the first day any delayed-price surface ships to a member, renders the required UTP/CTA disclosure strings** — verified against the specific requirements named in §9.4 (prominence, 90-second repetition in a ticker context, the Financial Status Indicator on every intraday display including delayed ones).
6. **A `<FreshnessBadge>`'s `stale` threshold is session-aware**, not a flat wall-clock timeout — verified by testing the same elapsed time against both an RTH session and an overnight/weekend session and confirming different classifications where S11's session model requires it.
7. **View-density changes never trigger a re-fetch or re-computation of the underlying grounded value** — verified by asserting no new network call fires when a citation-visibility toggle changes rendered density alone (§11.3).
8. **A value with no provenance record yet (pre-D2-registration) renders the explicit "provenance unavailable" degraded state, never a fabricated receipt and never a silently bare value** (§9.8).
9. **S8 introduces zero new vendor/provider integrations** — verified against the provider-master-ledger (F-09); no new row is added to the provider roster to satisfy this PRD.
10. **The boundary matrix holds**: S8 never calls S1, S2, S3, S4, S5, S6, S7, S9, S12, D1, D3, D5, or any Application; every call *into* S8 originates from an Application, I1, or S7 (§3's restated boundary-matrix edges) — verified by an import/call-graph rail once implementation begins.
11. **I1 owns no competing rendering component.** A code-level check (import graph or AST) confirms every I1-authored composition (`<VerdictCard>`, `<Answer>`) imports and renders through S8's primitives rather than defining its own citation-rendering logic — the direct regression test for the specific defect Phase 2's adversarial validation caught and fixed (`ARCHITECTURAL_DECISION_REGISTER.md` D6; `PHASE_2_INTEGRATION_SYNTHESIS.md` fix 5).

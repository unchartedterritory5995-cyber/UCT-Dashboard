---
id: ARCH-DECISION-REGISTER
title: Architectural Decision Register
role: living register — updated at every checkpoint (Phase 2 close, 2026-09-02)
status: current
---

# Architectural Decision Register

Seeded from the Readiness Review's Part 7 (nine decisions, D1–D9) and updated with what Phase 2's
four architecture documents actually designed, locked, or left open. Formal ADRs (Document C row
31, `12-decisions/adr/ADR-*.md`) get written when a decision genuinely LOCKS — most of the items
below are not there yet. This register is the tracker; ADRs are the record of what shipped.

Status key: **LOCKED** — the architecture already commits to this, reversal is a real cost.
**RECOMMENDED, REVERSIBLE** — the architecture picked a working default, but it's cheap to change.
**PROVISIONAL / OWNER-BOUND** — genuinely cannot lock without owner input; the architecture is
designed so the choice stays a configuration value, not a rebuild.

---

## ⛔ ID RENAME, 2026-09-11 — decisions are `DEC-nn`, never a bare `Dn`

**Every decision in this register was renamed from `Dn` to `DEC-nn` (owner ruling, 2026-09-11).
The reason: a bare `Dn` named as many as five different things across this program's documents,
and two of them sat in the same table row.**

| this register's id | was | the thing a bare `Dn` ALSO means elsewhere |
|---|---|---|
| DEC-01 … DEC-15 | D1 … D15 | — |
| **DEC-03** | D3 | **system D3 Realtime Streaming** · capability-ledger row D3 (Estimates/consensus) · benchmark-universe row D3 (Finviz) |
| **DEC-04** | D4 | **system D4 Caching & Serving** · capability-ledger row D4 (Earnings history) · benchmark-universe row D4 (Market Chameleon) |
| **DEC-06** | D6 | capability-ledger row D6 (Call recaps/transcripts) |
| **DEC-07** | D7 | capability-ledger row D7 (SEC filings) |
| DEC-01 / DEC-02 / DEC-05 | D1 / D2 / D5 | **systems D1 Provider Abstraction · D2 Canonical Data Model · D5 Reference & Corporate-Actions Data** |

⭐ **THE STANDING RULE, from here on: a bare `Dn` in any program artifact means the SYSTEM.
A decision is always written `DEC-nn`.** Read `Dn` as a system unless it is spelled `DEC-nn`.

⚠️ **The owner's ruling named four ids (D3/D4/D6/D7). All fifteen were renamed instead**, because
renaming four would have left `D1`, `D2` and `D5` — the three most heavily referenced system ids in
the program — still colliding, and would have produced mixed lists like `(DEC-03, DEC-04, D5,
DEC-06, DEC-07, D9, D13)` that are harder to read than either endpoint. Reversible in one commit.

⛔ **Two headings below deliberately still contain a bare `Dn`, and it is correct:** DEC-11's
"Canonical Data Model (D2)" and DEC-14's "Applications ✗ D1 build-out exception" both name
**systems**. Do not "fix" them.

⚠️ **In-prose references elsewhere have NOT been mass-renamed, on purpose.** 1,284 un-hyphenated
`Dn` tokens exist across 34 program files, and the same token is a decision, a system, a
capability-ledger row, a benchmark-universe row, or a Readiness-Review item depending on the
sentence — `information-architecture.md` line 435 carries a capability-ledger `D6` and a decision
`D7` in one table row. A rule-based pass over them produced a ~10% false-positive rate against
hand-checking, which is worse than the collision it would fix. **Decision references are corrected
per-document, at the moment that document is re-verified** (S3's were done at its re-verification;
D1's and S7's happen when each is authorized). Until then, resolve any bare `Dn` through the table
above.

⚠️ Unrelated `D-` series that this rename does NOT touch and must not be confused with `DEC-nn`:
**`D-01`…`D-14`** are Wave-1 research task ids (`contracts/D-01.md` …), and **`D-001`…`D-003`** are
owner decisions in `OWNER_DECISIONS.md`.

## DEC-01 — Workspace model (fixed / modular / hybrid)

**Status: RECOMMENDED, REVERSIBLE, sharpened by Phase 2.** The Readiness Review recommended
"hybrid"; information-architecture.md's §4 sharpened this to **three surface kinds** — fixed
page, board, and the entity page (the load-bearing new surface consolidating eleven per-ticker
doors, per Q7 of the executive questions) — and product-architecture.md's S1 now names all three
after a Phase 2 validation fix (it originally named only two, a defect the adversarial pass caught
and this register's own correction closed). *Final lock gated on:* OI-06 (observed desk morning)
and the `charts_workspace_layout` telemetry query (OI-21). *Reversible because:* the Workspace
Document (S5) is library-agnostic — a dock-library swap doesn't change S1's contract.

## DEC-02 — Command-grammar default (noun-first vs. verb-first)

**Status: RECOMMENDED, REVERSIBLE, sharpened by Phase 2.** information-architecture.md §8
designed one substrate ("Grammar C") with both a noun-first command line and a Ctrl-K-style
palette as front ends over it — the default front end per audience is not picked. *Working
hypothesis, not locked:* desk = context-first, member = palette-first. *Final lock gated on:*
OI-06. *Reversible because:* both front ends already exist over one grammar; changing the default
is a configuration flip, not a rebuild.

## DEC-03 — Symbol/Entity master design

**Status: LOCKED.** Phase 2 fully designed this (data-architecture.md §5, product-architecture.md
S3): one internal permanent entity id, FIGI as the external mapping (its *permanence property*,
not necessarily its exact code — data-architecture.md is explicit about this distinction),
tickers as a dated alias list, delist/rename marked not erased. No counter-evidence found in
Phase 2 or its validation pass. *Open technical question, not a design question:* whether
Massive/FMP responses already carry a `figi` field (a live API read, not a research question).

## DEC-04 — Provider Abstraction Layer pattern

**Status: LOCKED.** data-architecture.md fully designs the anti-corruption-layer pattern per
vendor, using `finnhub_client.py` as the reference and the six-independent-FMP-helpers debt as the
first consolidation target. No counter-evidence found.

## DEC-05 — Member-facing data-licensing posture

**Status: PROVISIONAL / OWNER-BOUND, unchanged.** Every Phase 2 document designs the licensing-
eligibility mechanism (entitlement rows per data class per audience, S9) so the architecture does
not change regardless of how this resolves — but the actual posture is not decided and cannot be
by evidence alone. *Gated on:* OI-03(a)/(b). See `OWNER_DECISIONS.md` D-002.

## DEC-06 — AI provenance component: shared vs. per-surface

**Status: LOCKED, and a real defect was caught and fixed here.** data-architecture.md and
product-architecture.md's S8 (Provenance & Freshness) fully design this as one shared rendering
component. Phase 2's own adversarial validation caught S8 and I1 (Intelligence Layer) both
claiming ownership of "the one provenance renderer" in product-architecture.md's first draft —
exactly the second-authority defect this program repeatedly flags elsewhere. Corrected: I1 now
explicitly routes every answer through S8's renderer rather than building a competing one.

## DEC-07 — Alert-type taxonomy: unified vs. fragmented

**Status: LOCKED.** product-architecture.md's S7 (Alerts & Monitoring) designs one trigger
taxonomy over the existing shared delivery seam. No counter-evidence found.

## DEC-08 — Corporate-actions and portfolio-risk scope: build now or defer

**Status: RECOMMENDED, REVERSIBLE — defer confirmed.** product-architecture.md's D5 (data
system) designs adjustment-as-policy now (small, needed regardless); A14 (Portfolio & Risk) has
its boundary fixed but its build explicitly deferred; a genuine corporate-actions event calendar
(beyond splits/dividends) has no provider today (F-09 confirmed this a class-G gap) and is not
scoped into Phase 2. *Gated on:* OI-06 revealing the desk needs one of these daily; otherwise
treat as an MVP/roadmap scoping call (H-01), not an architecture question.

## DEC-09 — Decisiveness for two audiences

**Status: PROVISIONAL / OWNER-BOUND, mechanism now designed.** See `OWNER_DECISIONS.md` D-003
(promoted to a formal escalation this checkpoint). The Intelligence Layer's verdict renderer
accepts a `posture` input from S9 so either answer — one shape for everyone, or decisive-for-desk/
balanced-for-strangers — is a configuration value. No default declared; not resolvable by more
research per the Day 1 synthesis's own §13.4 finding.

---

## New items Phase 2 surfaced (not in the original nine)

## DEC-10 — Packs vs. tools for AI context delivery

**Status: LOCKED (an engineering call, not owner-bound).** product-architecture.md's I1 system
explicitly takes a position: intent-gated context reaches the model as registered **tools** (via
I1's `registerTool` contract), not as pre-assembled "packs." Packs are named as a rejected
alternative — "a second authority over what data the model sees" — and the existing
`AI_SEARCH_AGENT_AUTOROUTE` default-off flag (TD-50) is flagged as needing to resolve explicitly
in this direction rather than sitting on a flag indefinitely. *What would change it:* nothing
found in the research argues for packs; this is recorded as a decision so a future implementer
doesn't re-litigate it without new evidence.

## DEC-11 — Canonical Data Model (D2) migration scope: new classes only, or retrofit the ~55 legacy SQLite files

**Status: RECOMMENDED, REVERSIBLE.** data-architecture.md recommends scoping the canonical schema
to new TERMINAL-NEXT data classes only, not a retrofit of every existing SQLite file — a full
migration is named as a possible future step, not a Phase 2 commitment. *What would change it:* a
specific legacy surface proving unmaintainable without the canonical model; no such case has
surfaced yet.

## DEC-12 — Canonical earnings-date authority (OQ-14)

**Status: RECOMMENDED, REVERSIBLE — an assumption, not a decision, but worth registering.** The
architecture assumes `/api/calendar` is the canonical earnings-date authority and designs the
Discord bot's `get_catalyst_calendar_context` to conform through one adapter, closing the
duplicate-authority gap the Readiness Review's Part 2 audit found unflagged in the Day 1 synthesis.
*What would change it:* if the bot's data is ever found more current/accurate than the calendar's,
which no research pass has found.

## DEC-13 — Regime-classifier authority

**Status: LOCKED (resolved 2026-09-02, Phase 3).** `voice_regime_classifier.get_current_regime()`
(the dashboard's own 5-way breadth/VIX/MA/distribution-days/exposure heuristic) is the single live
authority — grep-verified wiring into `grade_ticker`'s verdict gate, the Awareness Engine's R4
regime-flip alert rule, and `brain_service`'s regime fallback. The engine's `market_regimes` table
has exactly one dashboard reader (`/api/risk-summary`) and that route has zero frontend callers —
confirmed dead code, not a competing authority. No reconciliation work is needed; `/api/risk-summary`
is a candidate for formal retirement (a normal-operations item, not a Terminal-Next task).

**A genuine, related finding surfaced during this investigation, tracked separately as RG-32
(reported, not program-owned):** a third "regime" surface, `journal_two/regime.py`, buckets the
UCT Exposure Rating score alone under the same word and is what Compass text chat shows ambiently
— while its own `get_regime` tool call returns the real 5-way classifier's answer. A member can see
two different regime words in one Compass conversation today. This does not affect S7's design
(the alerts-monitoring spec correctly used the D13 finding, not the journal_two surface) but is
worth the owner's attention as a normal-operations fix.

## DEC-14 — Applications ✗ D1 build-out exception

**Status: RECOMMENDED, REVERSIBLE, self-expiring (Phase 3).** The boundary matrix's unconditional
"no application calls a vendor" rule cannot hold before D2 (Canonical Data Model) and D1 (Provider
Abstraction Layer) both exist — found by Phase 3's own adversarial validation when the Provider
Abstraction Layer's technical spec needed to design real call sites today. Resolution: new
application call sites may call a named D1 adapter module directly (never construct a raw vendor
URL) during this window; every such call site is tracked and re-pointed at D2 once it ships. The
exception is named in both `product-architecture.md`'s boundary matrix and reversibility ledger,
and in `provider-abstraction-spec.md` §7.2, so it reads as a tracked decision, not a local
rationalization.

### ⛔⛔ THE EXPIRY CONDITION — REPLACED 2026-09-12 BY OWNER RULING (D2-B)

⚰️ **This read:** *"What would change it: nothing — it self-expires the day D2 ships."*

⛔ **"THE DAY D2 SHIPS" IS NOT A CHECKABLE CONDITION, IN EITHER DIRECTION.** D2 is not a thing that
ships on a day — it is a manifest that gains entries. Under that wording the exception either
expires while most call sites have no address to point at (breaking them), or never expires because
"D2 shipped" is arguable forever. ⭐ **Both failure modes are the same defect: a condition nobody
can evaluate.**

**The replacement, verbatim and binding:**

> **DEC-14 expires for a CALL SITE, not for the programme, on the day all three hold for it:**
>
> 1. **the value it fetches has a D2 address** — the metric is declared in the address book and
>    resolves; and
> 2. **the address returns the same value the direct call returns**, proved FORWARD-ONLY against
>    live traffic for a stated window, never by replay; and
> 3. **the call site reads through the address**, and the census reports it as migrated rather than
>    quarantined.
>
> **The programme-level exception expires when the census reports zero call sites for which clause 1
> is false.** Not when a document says D2 shipped.

**The census rail, cited by test name so this condition has an instrument rather than an intention:**
`tests/test_fmp_guard_census.py::test_real_repo_has_zero_unquarantined_violations`, over
`tools/fmp_guard_census.py`. Measured 2026-09-12: **0 unquarantined literals, 0 unquarantined
`_fmp_get`-shaped definitions, 11 quarantine entries**, GREEN.

⛔ **AND THE CONDITION MUST DISTINGUISH *NOT YET ADDRESSED* FROM *DELIBERATELY OUTSIDE*, OR IT CAN
NEVER REACH ZERO.** One of those eleven quarantine entries —
`api/services/news/adapters/fmp_news.py` — carries the G5 ruling of 2026-09-12 saying it must
**never** migrate: its retry-and-budget contract is the opposite of the adapter's and both are right
for their own callers. A condition that counted it as outstanding would be unsatisfiable, and an
unsatisfiable condition is the same as no condition at all.

⛔ **CLAUSE 2 IS NOT A REPLAY.** The S7 programme has now refused replay three times for three
different reasons — a trendline has no past, a calendar date moves, an LLM-graded row cannot be
re-synthesised. A provider's answer for a past instant is not recoverable either, so "does the
address return what the direct call returned" is answered by running both on the same tick.
F-S7-3's four outcomes, never a pass rate.

*What would change it:* the three clauses above, per call site, measured by the census.

## DEC-15 — Entity Master interim reconciliation job

**Status: RECOMMENDED, REVERSIBLE, self-expiring (Phase 3).** Without an ongoing feed, the Entity
Master (S3) goes stale the day after its one-time seed — before D5 (Reference & Corporate-Actions
Data) exists to supply that feed. Resolution: S3's technical spec may build a narrow interim
reconciliation job detecting new listings and delistings only — **never renames**, which needs D5's
real corporate-action feed to do responsibly — explicitly authorized by the entity-master PRD §9.5.1
with a named sunset condition (retire the day D5 ships). *What would change it:* nothing — it
self-expires the day D5 ships.

---

## Summary table

| ID | Decision | Status | Gated on |
|---|---|---|---|
| DEC-01 | Workspace model | Recommended, reversible | OI-06, OI-21 |
| DEC-02 | Command-grammar default | Recommended, reversible | OI-06 |
| DEC-03 | Symbol/Entity master | **Locked** | — |
| DEC-04 | Provider Abstraction Layer | **Locked** | — |
| DEC-05 | Member-facing licensing posture | Owner-bound | OI-03(a)/(b) |
| DEC-06 | AI provenance component | **Locked** | — |
| DEC-07 | Alert-type taxonomy | **Locked** | — |
| DEC-08 | Corporate-actions/portfolio-risk timing | Recommended, defer | OI-06 |
| DEC-09 | Decisiveness for two audiences | Owner-bound | new escalation D-003 |
| DEC-10 | Packs vs. tools | **Locked** | — |
| DEC-11 | Canonical model migration scope | Recommended, reversible | future evidence |
| DEC-12 | Canonical earnings-date authority | Recommended, reversible | future evidence |
| DEC-13 | Regime-classifier authority | **Locked** | — |
| DEC-14 | Applications ✗ D1 build-out exception (Phase 3) | Recommended, reversible, self-expiring | reverts automatically when D2 ships |
| DEC-15 | Entity Master interim reconciliation job (Phase 3) | Recommended, reversible, self-expiring | reverts automatically when D5 ships |

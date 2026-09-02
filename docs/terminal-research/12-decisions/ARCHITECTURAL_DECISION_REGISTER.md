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

## D1 — Workspace model (fixed / modular / hybrid)

**Status: RECOMMENDED, REVERSIBLE, sharpened by Phase 2.** The Readiness Review recommended
"hybrid"; information-architecture.md's §4 sharpened this to **three surface kinds** — fixed
page, board, and the entity page (the load-bearing new surface consolidating eleven per-ticker
doors, per Q7 of the executive questions) — and product-architecture.md's S1 now names all three
after a Phase 2 validation fix (it originally named only two, a defect the adversarial pass caught
and this register's own correction closed). *Final lock gated on:* OI-06 (observed desk morning)
and the `charts_workspace_layout` telemetry query (OI-21). *Reversible because:* the Workspace
Document (S5) is library-agnostic — a dock-library swap doesn't change S1's contract.

## D2 — Command-grammar default (noun-first vs. verb-first)

**Status: RECOMMENDED, REVERSIBLE, sharpened by Phase 2.** information-architecture.md §8
designed one substrate ("Grammar C") with both a noun-first command line and a Ctrl-K-style
palette as front ends over it — the default front end per audience is not picked. *Working
hypothesis, not locked:* desk = context-first, member = palette-first. *Final lock gated on:*
OI-06. *Reversible because:* both front ends already exist over one grammar; changing the default
is a configuration flip, not a rebuild.

## D3 — Symbol/Entity master design

**Status: LOCKED.** Phase 2 fully designed this (data-architecture.md §5, product-architecture.md
S3): one internal permanent entity id, FIGI as the external mapping (its *permanence property*,
not necessarily its exact code — data-architecture.md is explicit about this distinction),
tickers as a dated alias list, delist/rename marked not erased. No counter-evidence found in
Phase 2 or its validation pass. *Open technical question, not a design question:* whether
Massive/FMP responses already carry a `figi` field (a live API read, not a research question).

## D4 — Provider Abstraction Layer pattern

**Status: LOCKED.** data-architecture.md fully designs the anti-corruption-layer pattern per
vendor, using `finnhub_client.py` as the reference and the six-independent-FMP-helpers debt as the
first consolidation target. No counter-evidence found.

## D5 — Member-facing data-licensing posture

**Status: PROVISIONAL / OWNER-BOUND, unchanged.** Every Phase 2 document designs the licensing-
eligibility mechanism (entitlement rows per data class per audience, S9) so the architecture does
not change regardless of how this resolves — but the actual posture is not decided and cannot be
by evidence alone. *Gated on:* OI-03(a)/(b). See `OWNER_DECISIONS.md` D-002.

## D6 — AI provenance component: shared vs. per-surface

**Status: LOCKED, and a real defect was caught and fixed here.** data-architecture.md and
product-architecture.md's S8 (Provenance & Freshness) fully design this as one shared rendering
component. Phase 2's own adversarial validation caught S8 and I1 (Intelligence Layer) both
claiming ownership of "the one provenance renderer" in product-architecture.md's first draft —
exactly the second-authority defect this program repeatedly flags elsewhere. Corrected: I1 now
explicitly routes every answer through S8's renderer rather than building a competing one.

## D7 — Alert-type taxonomy: unified vs. fragmented

**Status: LOCKED.** product-architecture.md's S7 (Alerts & Monitoring) designs one trigger
taxonomy over the existing shared delivery seam. No counter-evidence found.

## D8 — Corporate-actions and portfolio-risk scope: build now or defer

**Status: RECOMMENDED, REVERSIBLE — defer confirmed.** product-architecture.md's D5 (data
system) designs adjustment-as-policy now (small, needed regardless); A14 (Portfolio & Risk) has
its boundary fixed but its build explicitly deferred; a genuine corporate-actions event calendar
(beyond splits/dividends) has no provider today (F-09 confirmed this a class-G gap) and is not
scoped into Phase 2. *Gated on:* OI-06 revealing the desk needs one of these daily; otherwise
treat as an MVP/roadmap scoping call (H-01), not an architecture question.

## D9 — Decisiveness for two audiences

**Status: PROVISIONAL / OWNER-BOUND, mechanism now designed.** See `OWNER_DECISIONS.md` D-003
(promoted to a formal escalation this checkpoint). The Intelligence Layer's verdict renderer
accepts a `posture` input from S9 so either answer — one shape for everyone, or decisive-for-desk/
balanced-for-strangers — is a configuration value. No default declared; not resolvable by more
research per the Day 1 synthesis's own §13.4 finding.

---

## New items Phase 2 surfaced (not in the original nine)

## D10 — Packs vs. tools for AI context delivery

**Status: LOCKED (an engineering call, not owner-bound).** product-architecture.md's I1 system
explicitly takes a position: intent-gated context reaches the model as registered **tools** (via
I1's `registerTool` contract), not as pre-assembled "packs." Packs are named as a rejected
alternative — "a second authority over what data the model sees" — and the existing
`AI_SEARCH_AGENT_AUTOROUTE` default-off flag (TD-50) is flagged as needing to resolve explicitly
in this direction rather than sitting on a flag indefinitely. *What would change it:* nothing
found in the research argues for packs; this is recorded as a decision so a future implementer
doesn't re-litigate it without new evidence.

## D11 — Canonical Data Model (D2) migration scope: new classes only, or retrofit the ~55 legacy SQLite files

**Status: RECOMMENDED, REVERSIBLE.** data-architecture.md recommends scoping the canonical schema
to new TERMINAL-NEXT data classes only, not a retrofit of every existing SQLite file — a full
migration is named as a possible future step, not a Phase 2 commitment. *What would change it:* a
specific legacy surface proving unmaintainable without the canonical model; no such case has
surfaced yet.

## D12 — Canonical earnings-date authority (OQ-14)

**Status: RECOMMENDED, REVERSIBLE — an assumption, not a decision, but worth registering.** The
architecture assumes `/api/calendar` is the canonical earnings-date authority and designs the
Discord bot's `get_catalyst_calendar_context` to conform through one adapter, closing the
duplicate-authority gap the Readiness Review's Part 2 audit found unflagged in the Day 1 synthesis.
*What would change it:* if the bot's data is ever found more current/accurate than the calendar's,
which no research pass has found.

## D13 — Regime-classifier authority

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

## D14 — Applications ✗ D1 build-out exception

**Status: RECOMMENDED, REVERSIBLE, self-expiring (Phase 3).** The boundary matrix's unconditional
"no application calls a vendor" rule cannot hold before D2 (Canonical Data Model) and D1 (Provider
Abstraction Layer) both exist — found by Phase 3's own adversarial validation when the Provider
Abstraction Layer's technical spec needed to design real call sites today. Resolution: new
application call sites may call a named D1 adapter module directly (never construct a raw vendor
URL) during this window; every such call site is tracked and re-pointed at D2 once it ships. The
exception is named in both `product-architecture.md`'s boundary matrix and reversibility ledger,
and in `provider-abstraction-spec.md` §7.2, so it reads as a tracked decision, not a local
rationalization. *What would change it:* nothing — it self-expires the day D2 ships.

## D15 — Entity Master interim reconciliation job

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
| D1 | Workspace model | Recommended, reversible | OI-06, OI-21 |
| D2 | Command-grammar default | Recommended, reversible | OI-06 |
| D3 | Symbol/Entity master | **Locked** | — |
| D4 | Provider Abstraction Layer | **Locked** | — |
| D5 | Member-facing licensing posture | Owner-bound | OI-03(a)/(b) |
| D6 | AI provenance component | **Locked** | — |
| D7 | Alert-type taxonomy | **Locked** | — |
| D8 | Corporate-actions/portfolio-risk timing | Recommended, defer | OI-06 |
| D9 | Decisiveness for two audiences | Owner-bound | new escalation D-003 |
| D10 | Packs vs. tools | **Locked** | — |
| D11 | Canonical model migration scope | Recommended, reversible | future evidence |
| D12 | Canonical earnings-date authority | Recommended, reversible | future evidence |
| D13 | Regime-classifier authority | **Locked** | — |
| D14 | Applications ✗ D1 build-out exception (Phase 3) | Recommended, reversible, self-expiring | reverts automatically when D2 ships |
| D15 | Entity Master interim reconciliation job (Phase 3) | Recommended, reversible, self-expiring | reverts automatically when D5 ships |

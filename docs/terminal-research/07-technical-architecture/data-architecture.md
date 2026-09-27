---
id: ARCH-04-DRAFT
title: Provider / Data Architecture — Workstream 3, F-09-integrated pass
role: Data/provider architecture author (Phase 2, Workstream 3) — first pass plus F-09 integration (WS3-DATA-ARCH-INTEGRATE)
wave: phase-2
group: ARCH
category: technical-architecture
scope: Provider abstraction layer, canonical data contracts, symbol/entity master, time and corporate-actions model, historical/real-time split, caching and provenance, licensing/entitlement metadata, provider routing and redundancy, cost and observability, and how the frontend/BFF/intelligence layers consume all of the above. Ties D3 (symbol/entity master) and D4 (provider abstraction, ACL pattern) from the Day-1 Readiness Review's Architectural Decision Register into one buildable design.
confidence: 🟡 overall — 🟢 where a claim restates a cited artifact's own 🟢 finding; 🟡 wherever this file composes two artifacts into a design recommendation, or restates F-09's own 🟡 capability-matrix confidence; 🔴 on every place explicitly marked PROVISIONAL / OWNER INPUT REQUIRED, and on the small residue of open technical questions F-09 itself did not close (§26)
evidence_ceiling: "Written first on F-03b (the 48-row provider ledger) per the Readiness Review's explicit finding that F-03b is sufficient to start (READINESS_REVIEW_DAY1.md Part 3, Part 9 item 3), then integrated with F-09 (the Provider Master Ledger, capability × A-G status taxonomy, DL-022, 02-data-providers/provider-master-ledger.md) — a RESTRUCTURING of the same accepted F-03b roster into a 48-provider × 17-asset-class matrix, not a from-zero rediscovery (F-09 frontmatter). F-09's own evidence ceiling is inherited unchanged: no vendor contract, order form, invoice or console was seen by any leaf in the program; the Massive plan tier and the FMP Data Display and Licensing Agreement remain UNKNOWN and together decide roughly two-thirds of the licensing column (F-04 ESC-01/ESC-02, restated by F-09 §7); zero rows anywhere reach CONTRACT-ACTIVE. This file also inherits every evidence ceiling of its other sources: the licensing register's own ceiling (licensing-register.md frontmatter) and the two domain-research files' ceilings (several primary sources 403/404'd; see their own GAPS sections). A handful of specific technical questions F-09's per-capability read did not close (FMP's XBRL-tag granularity, whether Massive/Polygon's reference endpoints carry FIGI) remain open and are named as such in §26, not silently assumed."
sources: 00-program-control/READINESS_REVIEW_DAY1.md · 13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md (F-06) · 00-program-control/GOVERNING_PRINCIPLES.md · 00-program-control/DECISION_LOG.md · 00-program-control/RESEARCH_GAPS.md · 01-existing-system/capability-ledger.md (F-03a) · 02-data-providers/provider-ledger.md (F-03b) · 02-data-providers/provider-master-ledger.md (F-09, canonical gate-4 artifact, supersedes F-03b per its own pointer note — cited directly throughout this integrated pass) · 02-data-providers/railway-flag-state.md (ORCH-RAILWAY-01) · 07-technical-architecture/domain-data-platform.md (C7-03) · 07-technical-architecture/domain-symbol-master-time.md (C7-02) · 07-technical-architecture/domain-streaming-caching.md (cited for §11-12 only, not re-derived) · 09-security-licensing-cost/licensing-register.md (F-04) · 09-security-licensing-cost/data-use-classification.md (E-02, cited via the licensing register's own citations) · 09-security-licensing-cost/cost-model-data.md · repository CLAUDE.md (read as a CLAIMS document per the corpus's own convention, never as verified fact)
uct_relevance: high
status: draft — F-09 integrated; no leftover TBD markers
date: 2026-09-02
---

# Provider / Data Architecture — Workstream 3 (first pass)

## 0. What this document is, and what it is not

This is `07-technical-architecture/data-architecture.md`, written per the Readiness Review's Phase 2
recommendation (`READINESS_REVIEW_DAY1.md` Part 9, workstream 3): "start drafting the pattern on
F-03b now; fold in F-09's granularity once it lands." F-03b — the 48-row provider ledger — is
explicitly named as sufficient to start architecture work (Part 3's BLOCKING-vs-ARCHITECTURE-BOUND
determination: "F-03b already sufficient to start"), and this document was first drafted on that
basis. **F-09 (the Provider Master Ledger, DL-022, `provider-master-ledger.md`) has since landed and
is integrated throughout this pass.** F-09 restructures the same 48-provider roster into a
per-capability (17 asset-class) matrix with the owner's A–G usage-status taxonomy (§16A of this
document's own restatement in §26) and — the piece this document draws on most — separates
*technical access* from *contractual right* at the per-capability level (§14.7). Every place this
draft's provider claims are sharpened by that finer grain now cites F-09 directly rather than
carrying a forward-looking marker; the small residue of specific technical questions F-09's own read
did not close (an inherited gap in F-09 itself, not a gap this integration pass introduced) is named
plainly, in place, as an **OPEN QUESTION — not resolved by F-09**, and collected once more in §26.

This document is architecture, not implementation. It names boundaries, contracts, and decision
rules; it does not write code. Per the program's standing principles (`GOVERNING_PRINCIPLES.md`
§9, §10), it separates observation from recommendation throughout, and per this task's explicit
instruction it separates six questions that the rest of the corpus tends to blur: **data
availability**, **data normalization**, **backend capability**, **UI exposure**, **workflow
quality**, and **intelligence-orchestration**. A provider having a data class does not mean UCT
normalizes it; UCT normalizing it does not mean a backend endpoint serves it; a backend endpoint
existing does not mean a UI renders it; a UI rendering it does not mean the workflow is good; none
of the above means the AI layer may cite it. Each section below states which of the six questions
it is answering.

**Where this draft is silent on a decision the owner must make**, it is marked
`PROVISIONAL / OWNER INPUT REQUIRED` and designed so the decision stays reversible, per this
task's contract. The items so marked are listed again in §29 as a single index.

---

## 1. Grounding: what UCT's data estate actually is today

*(Answers: data availability, data normalization — as measured, not designed.)*

Three artifacts converge on the same headline, independently: the provider estate is real,
concentrated, and under-abstracted.

**1.1 The estate is real and large, not a green field.** 48 provider rows across six code
locations and five Railway services (`provider-ledger.md` §0). Twenty are core; UCT already pays
for a Massive-centred stack (bars, quotes, movers, snapshots, chains, OPRA tape, dark pool, flat
files) plus an FMP-centred fundamentals/estimates/calendar spine, with a long tail of legacy,
duplicate and dormant keys (`provider-ledger.md` §0). This is consistent with the Readiness
Review's headline finding that the program is "predominantly a 'unify, extend, and give a
workspace-native UI to an already-large estate' problem" (`READINESS_REVIEW_DAY1.md` Part 4), not a
build-from-scratch one. Every recommendation below designs around this estate; none of it proposes
a new vendor before F-03b's own retirement/consolidation queue (§4 of the provider ledger) is
addressed, per the owner's standing directive that the existing arsenal be exhausted first
(`GOVERNING_PRINCIPLES.md` §14A, DL-022).

**1.2 Concentration is real, and the licensing question rides on top of it, not beside it.**
Massive rows 1–3 alone carry 20 of 29 derived data products and every price-shaped class
(`provider-ledger.md` §1B "INTERPRETATION"). This is architecturally convenient (one vendor
boundary to abstract well pays for most of the estate) and licensing-critical at the same time:
the Massive plan tier (Individual vs. Business) is the single fact that reclassifies 38 of the
118 rows in the licensing register (`licensing-register.md` §1C — "the single cheapest,
highest-yield fact in the program," ESC-01). **PROVISIONAL / OWNER INPUT REQUIRED — OI-03(a):**
the Massive plan tier is unconfirmed; this document assumes Massive Individual (no Edge Users
grant, no `store` right, Derived Works barred) as its default design constraint throughout, per
the licensing register's own default (`licensing-register.md` §4.1 A2), and names where the
Business-tier answer would change the design.

**1.3 There is no provider abstraction layer today, with one working exception.** Six independent
FMP helper functions share no budget, no timeout policy, and no error taxonomy
(`routers/fundamentals.py:111`, `catalyst/analyst_actions.py:96`, `earnings_estimates.py:344`,
`transcript_indexer.py:25`, `insider.py:89`, `research/financial_history.py:38` — all named
`_fmp_get` independently; `provider-ledger.md` row 4, 1B row 4). Massive is worse: "20+ modules
build `api.massive.com` URLs themselves" outside the one intended client class (`_MassiveRestClient`
at `massive.py:76`; `provider-ledger.md` row 1). The one working counter-example is Finnhub's
client — "the best-shaped guard in the repo": a single chokepoint (`finnhub_client.py:233 fh_get`)
with a token bucket, a reactive cooldown, and a 24h-cached-forbidden state for endpoints that
started 403ing (`provider-ledger.md` 1B row 6; `domain-data-platform.md` §3 "RELEVANCE TO UCT").
This is the internal precedent to generalize (§5 below), not a pattern to import from outside.

**1.4 There is no symbol/entity master.** The backend has a ticker-search and a ticker-meta cache,
not an identity registry; `cap_universe` is a membership *gate*, not an identity table
(`domain-symbol-master-time.md` §1.1, citing `backend-archaeology.md` §3.2, §7). Dual-class
symbology is handled at exactly one function for exactly one vendor
(`massive.to_polygon_symbol()`, `BRK-B`→`BRK.B`), and that one function's normalization "leaks to
41 call sites / 15 modules" because nothing enforces that every caller goes through it
(`domain-symbol-master-time.md` §1.2; `provider-ledger.md` 1B row 1). This is the Readiness
Review's D3 decision, restated with evidence: "no symbol master exists today — the clearest
infrastructure gap the research found" (`READINESS_REVIEW_DAY1.md` Part 5, Part 7 D3).

**1.5 There is no canonical data model.** ≈55 distinct SQLite files, ~200 `sqlite3.connect` call
sites, no ORM, no migration framework, 286 distinct `CREATE TABLE` names, "no single place that
knows what the data model is" (`database-and-infrastructure.md` §1.1, cited in
`domain-data-platform.md` §4). The one partial counter-example is `bars.db`'s
writer-service/R2-bus/newer-wins-merge design — a real, working instance of one-schema-many-readers,
scoped to bars only (`domain-data-platform.md` §4; `capability-ledger.md` row A3, A13).

**1.6 Provenance exists narrowly, for one data class, in the wrong database.** `bar_provenance.py`
and `bar_quarantine.py` are dedicated, purpose-built provenance modules — but for bars only, and
both tables live in `auth.db` rather than beside `bars.db`
(`domain-data-platform.md` §7; `capability-ledger.md` row A10). Fundamentals, options and news
disagreements are resolved as narrative prose in per-provider tie-break functions
(`_earn_row_preferred`) rather than as a queryable provenance record (`domain-data-platform.md`
§6, §7).

**1.7 Licensing is one binary, written 38 times, resting on two owner facts.** 118 rows; 81
Restricted, 18 Unknown, 8 Unsuitable, 7 Likely Allowed, 3 Allowed (`licensing-register.md` §1C).
Two owner facts — the Massive tier (OI-03a) and whether an FMP Data Display and Licensing
Agreement exists (OI-03b) — move 57 of those 118 rows; with both favorable, Restricted falls from
81 to 27, and 13 of the 27 survivors are fixable by engineering alone, with no vendor conversation
(`licensing-register.md` §1C, §1D). **PROVISIONAL / OWNER INPUT REQUIRED — OI-03(b):** this
document assumes no FMP DDLA exists, per the register's default (`licensing-register.md` §4.1 A3).

**1.8 Evidence about "is this provider actually used" tops out well below certainty — and F-09
confirms the ceiling unchanged.** The provider ledger's own ladder — KEY-PRESENT → CODE-REFERENCED →
OBSERVED-CALLED → CONTRACT-ACTIVE — finds that on the dashboard side, only FMP (🟢) and Finnhub (🟡)
reach OBSERVED-CALLED; zero rows anywhere are CONTRACT-ACTIVE (`provider-ledger.md` §0). F-09's
restructuring pass inherits this ladder unchanged and adds no new CONTRACT-ACTIVE rows
(`provider-master-ledger.md` frontmatter). Any architecture claim of "provider X serves class Y in
production today" in this document inherits that ceiling and is flagged where it matters.

F-09 did close a handful of the estate's own remaining "which repos were never opened" gaps, and two
of its findings matter to this architecture's AI-orchestration and publication-chokepoint design
(§23.5, §29): a **second, independent consumer of the owner's Anthropic subscription seat**
(`uct-recaps/daily_recap.py`, the Live Recap ×3/day task, alongside the already-known
`desk_insights_polish.py`) — widening ESC-17 from one script to at least two PC-side tasks routing
member-adjacent output through the seat rather than the API key
(`provider-master-ledger.md` §1.1 item 2); and a **second consumer of the dashboard's own YouTube
OAuth credential** inside `uct-clips` (same `YT_OAUTH_*` key names, a distinct call site), plus
confirmation that Buffer's social-scheduling integration is driven from `uct-clips`, not the
dashboard — closing D-14's own open question on that point
(`provider-master-ledger.md` §1.1 item 1). Neither finding changes this document's architectural
recommendations; both sharpen §23.5 and §29's framing of ESC-17 and are carried there.

---

## 2. Architecture principles applied to this domain

Per the program-supplied principles, restated as they bind this specific design:

- **Not a Bloomberg clone, not multi-asset breadth.** UCT's data estate is equities- and
  options-flow-centric with zero FX/commodities/rates/fixed-income provider coverage today
  (`provider-ledger.md` §2 "NO PROVIDER" rows; `GOVERNING_PRINCIPLES.md` §13 default). This
  document designs a provider/canonical-model layer *for that scope*, not a multi-asset one. If
  the scope ever widens, the abstraction boundary (§5) is exactly the seam that absorbs a new
  asset class without a rewrite — that is the point of the pattern, not a reason to build for it
  now.
- **Reuse what is sound.** The `finnhub_client.py` shape (§1.3), the `bars.db` writer/bus/merge
  shape (§1.5), the `bars-api` service-decoupling template (`capability-ledger.md` row A13), the
  `CoverageLine` four-count receipt idiom (`CLAUDE.md` Phase E section; `capability-ledger.md`),
  and the `provider_coverage_monitor` per-field floor pattern (`capability-ledger.md` row D12) are
  all real, working, and load-bearing precedents this document generalizes rather than replaces.
- **Do not preserve for its own sake.** The six independent FMP helpers and the 20+-module direct
  Massive URL construction are not preserved because they exist; they are named as the concrete
  debt case study the ACL pattern (§5) retires.
- **Six separated questions, restated per §0:** every section below states which of (availability
  / normalization / backend capability / UI exposure / workflow quality / AI-orchestration) it
  answers, so a reader cannot mistake "Massive has this data class" for "TERMINAL-NEXT serves it
  to a member."
- **Reversibility.** Every owner-bound item below is designed so the *architecture* does not
  foreclose either answer — e.g., the adapter boundary in §5 is where a Massive-tier upgrade gets
  absorbed with no call-site changes; the freshness-class field in §14 is what lets a delayed
  design and a real-time design share one canonical schema.
- **Optimize for implementation and maintainability, not document elegance.** Every pattern
  recommended below is scoped to something UCT's own codebase already proves works at least once
  (finnhub_client.py, bars.db, bars-api, CoverageLine, provider_coverage_monitor) — this document
  is explicitly generalizing proven internal shapes, not importing untested external ones, except
  where §6.3/§7/§9 name a standards-body pattern (FIGI, XBRL, W3C PROV) that has no internal
  analogue at all.

---

## 3. Provider Abstraction Layer (the Anti-Corruption Layer pattern — D4)

*(Answers: backend capability. This is the architectural core of D4 from the Readiness Review's
Architectural Decision Register: "adopt the ACL pattern; use the FMP-helper consolidation as the
first proof case" — `READINESS_REVIEW_DAY1.md` Part 7 D4.)*

**3.1 The pattern.** An Anti-Corruption Layer (ACL) — Eric Evans' *Domain-Driven Design* term,
documented as a standard pattern in the Azure Architecture Center — is a translation boundary
between an external system UCT does not control and UCT's internal model: "Isolate the different
subsystems by placing an anti-corruption layer between them... you can keep one system unchanged
without compromising the design and technological approach of the other" (`domain-data-platform.md`
§3, citing Microsoft Learn, fetched 2026-09-02, tier: official documentation). The pattern's own
documentation is explicit about what it is *not*: "avoid placing business rules or orchestration in
the layer" — it translates, it does not decide.

**3.2 Every vendor in scope gets exactly one adapter module.** Retries, timeouts, error taxonomy,
rate-limit handling, and symbol/field translation for that vendor live in one place; nothing
outside that module constructs a vendor URL or parses a vendor response shape directly
(`domain-data-platform.md` §3 RECOMMENDATION). This retires the six-FMP-helper shape (§1.3) and
the 20+-module direct-Massive-URL shape in the same motion, using the FMP consolidation as the
first proof case per D4's own recommendation.

**3.3 The reference implementation to copy is internal, not external.** `finnhub_client.py`'s
shape — one chokepoint (`fh_get`), a token bucket, a reactive cooldown on 429, and a 24h
cached-forbidden state for an endpoint that started 403ing — is the template
(`provider-ledger.md` 1B row 6). `alphavantage_client.py`'s daily token bucket (25 req/day,
ET-midnight reset, never sleeps) is the second internal precedent for a hard daily cap
(`provider-ledger.md` 1B row 7). Neither of the estate's two busiest vendors (Massive, FMP) has
this shape today; both are the priority adapters to build.

**3.4 What the adapter contract owns, concretely, per vendor:**
- **Transport**: base URL, auth header/param, connection pool, timeout policy (connect/read),
  retry/backoff.
- **Rate limiting**: a token bucket or equivalent, sized to the vendor's documented limit —
  Massive's client today has *no* token bucket at all (`provider-ledger.md` 1B row 1, "shared
  `httpx.Client`... no token bucket") — this is a named gap, not a design choice to preserve.
- **Error taxonomy**: typed exceptions per failure class (auth, rate-limited, transient,
  not-found), not a bare exception or a silent `None` — SnapTrade's client already does this
  (`SnapNotConfigured`/`SnapAuthError`/`SnapUserSecretInvalid`/`SnapRateLimited`/`SnapTransient`,
  `capability-ledger.md`/`CLAUDE.md` broker section) and is a third internal precedent worth
  citing alongside Finnhub's.
- **Symbol translation**: the vendor's dialect (`BRK-B` vs `BRK.B` vs whatever a second vendor
  uses) converted at the adapter boundary into the canonical form (§7), never left to leak past
  it — corroborated externally: Nasdaq's own trader documentation names four *internally
  inconsistent* suffix conventions for the same concepts, so "pick the right convention" is not
  achievable even for one exchange; the industry-scale fix is accepting every scheme at the input
  layer and resolving to one canonical entity, which is what Bloomberg's grammar does for CUSIP,
  ISIN and BBGID interchangeably (`domain-symbol-master-time.md` §2.3, citing Nasdaq Trader
  documentation and the Bloomberg dossier).
- **Response shaping**: raw vendor JSON converted into the canonical schema for that data class
  (§6) at the adapter boundary — this is where the Canonical Data Model pattern (§6.1) and the ACL
  pattern meet; the adapter is the *in-and-out* translator the canonical model requires.
- **Licensing-eligibility annotation**: every value the adapter returns carries its vendor of
  origin and data class as a *field*, not left to be remembered by whoever calls it — this is the
  licensing register's own architectural rule, R-A4-1 ("Provenance is a field, not a memory" —
  `licensing-register.md` §4.2), and it is placed here, at the adapter boundary, because that is
  the one place in the whole request path that always knows which vendor answered. §13 and §16
  below build directly on this field.

**3.5 What the adapter contract does *not* own:** business logic, caching policy (that is a layer
above the adapter — §12), and orchestration across vendors (that is a fallback-routing concern —
§17). The pattern's own documentation names this cost explicitly and this document repeats it as a
design constraint: an ACL "adds latency to calls... and adds an extra service that you must manage
and maintain" (`domain-data-platform.md` §3) — the adapter should be a thin, fast translation layer,
not a second application.

**3.6 Sequencing.** Per D4 and per the provider ledger's own retirement queue
(`provider-ledger.md` §4), the adapter build order should follow where the debt is worst and the
payoff is highest: FMP (six uncoordinated helpers, 28 modules, ~45 endpoints) first, Massive (20+
modules, the spine of the whole estate) second, then the smaller vendors as they are touched for
other reasons. This is a sequencing recommendation, not a mandate — an engineering-priority call,
not a licensing-bound one.

---

## 4. Canonical Data Contracts

*(Answers: data normalization. This is the second half of D4 and the direct implementation of the
Readiness Review's C7-03 finding.)*

**4.1 Why one canonical schema per data class, not N pairwise adapters.** The Enterprise
Integration Patterns catalog (Hohpe & Woolf, the standard reference for this pattern class) names
the Canonical Data Model specifically because pairwise translation is combinatorial: 2 systems need
2 translators, 6 systems need 30, a canonical model needs 12 — one adapter per system, in and out
(`domain-data-platform.md` §4, citing enterpriseintegrationpatterns.com, fetched 2026-09-02). UCT's
provider count (48 rows) is well past the point where this formalizes on its own logic alone,
independent of any other argument. Building an adapter per vendor (§3) without a shared internal
schema just moves the N×N problem one layer down — N adapters, each secretly assuming a slightly
different internal shape.

**4.2 The canonical schema is defined per data class, before a second vendor is wired to that
class — not after.** The order matters: today, N adapters (where they exist informally at all)
already each assume a different shape, because no schema was defined first
(`domain-data-platform.md` §4 RECOMMENDATION). The data classes needing a canonical schema, derived
from the provider ledger's own coverage matrix (`provider-ledger.md` §2) and the capability
ledger's sections A/D/E/F:

| Data class | Canonical schema priority | Why (evidence) |
|---|---|---|
| Quote (live/last/snapshot) | First — the busiest, most-consumed class | 4 consumer capability rows (A1, A6, A7 in `capability-ledger.md`); the freshness-class field (§14) is load-bearing here specifically |
| Bar (OHLCV, all timeframes) | First — `bars.db`/R2 already proves the transport half | The canonical *schema* half (field names, adjustment policy, provenance) is the missing half — §9 |
| Fundamental line item | Second — XBRL gives a naming reference for free | §4.3 below |
| Estimate / analyst action | Second — shares the fundamentals adapter | Currently assembled from FMP + Finnhub (degraded) + UW (`provider-ledger.md` §2 "Estimates" row) |
| Corporate action (split/dividend/other) | Second — feeds the adjustment-policy pipeline directly | §9 |
| News item | Third — six-provider fallback chain today, cheapest to normalize last | `provider-ledger.md` §2 "News" row: AV → RSS → Massive → FMP → Finviz → Google News |
| Options chain / Greeks / print | Third — two implementations already coexist (Massive native, Schwab) | `provider-ledger.md` §2 "Options chain" row |
| Calendar event (earnings/econ/IPO/dividend) | Already has the deepest internal precedent | `calendarTime.js` session-anchoring (§8), `_current_week_monday`, the one-placement-per-symbol-per-week reconciler invariant (`domain-symbol-master-time.md` §1.4, §1.6) — a canonical *schema* would formalize what is already a working *behavior* |

**4.3 Fundamentals should borrow a naming convention that already exists, for free.** Every
fundamentals vendor UCT touches (FMP, Finnhub's `/stock/metric`, yfinance's `.info`) is, underneath,
re-deriving field names from the same SEC-mandated XBRL tags every US public filer already
produces since 2018 (Inline XBRL, Release No. 33-10514 — `domain-data-platform.md` §6, citing
sec.gov and xbrl.org, both fetched 2026-09-02, tier: official/regulatory). This directly explains a
bug class UCT has already been bitten by: FMP's `historical-chart` timestamps are ET local text
that must be parsed as such (a bug UCT fixed once, `CLAUDE.md` "Bars Correctness Layer"), and FMP's
`stable/earnings` sometimes returns two rows for one report period, resolved today by a hand-written
`_earn_row_preferred` tie-break with no typed field for "as-reported vs. estimate"
(`domain-data-platform.md` §6, citing `CLAUDE.md`'s Model Book section). A canonical fundamentals
schema borrowing XBRL's concept names (or a documented mapping to them) converts "FMP calls it X,
Finnhub calls it Y" into a translation-at-the-adapter-boundary problem instead of a proliferation of
per-field special cases through the application. **OPEN QUESTION — not resolved by F-09:** whether
FMP's own API exposes XBRL-tag-level granularity (it is SEC-filing-derived) remains not determined.
F-09's capability matrix classifies FMP's fundamentals/financial-statements/estimates/earnings rows
each as usage-class **A** (currently used, the busiest lane in the product by module count) and
confirms F-04 has fully researched FMP's licensing shape (Restricted without a DDLA, Likely Allowed
with one — `provider-master-ledger.md` §3.2, explicitly noting "F is NOT the right class for FMP's
licensing... FMP is not one of them" among the licensing-unresearched providers), but its
per-capability read stops at *which* fields FMP serves, not *what internal tag scheme* those fields
use — F-09 restructured F-03b's own coverage tables rather than re-reading FMP's live API schema
this pass (`provider-master-ledger.md` §2.1 confidence note, §7 "this pass's own new gap"). This
question stays open for a future capability-level API read, not this architecture's to answer.

**4.4 Provenance and freshness are structural parts of every canonical schema, not add-ons.** §13
and §14 define these fields once, here, so every canonical data-class schema inherits them rather
than each schema inventing its own "source" string. This is the direct answer to
`domain-data-platform.md` §7's finding that a bare "source" text field cannot answer the four
questions an audit actually needs (what produced the value, from what, when, under whose
responsibility).

**4.5 Scope decision — introduce by fiat across the ~55 existing files, or scope to new
TERMINAL-NEXT data classes only?** This is explicitly named as an open, non-licensing,
engineering/product scope decision in the source material (`domain-data-platform.md` §4 OPEN
QUESTION) and this document does not resolve it — a large-scale migration across 55 files with no
migration framework (§1.5) is a materially different risk profile than scoping the canonical model
to data TERMINAL-NEXT introduces net-new. **PROVISIONAL / OWNER INPUT REQUIRED (engineering
scope call, not owner-input in the OI sense, but genuinely undecided):** this document recommends
starting with **new data classes only** — every new TERMINAL-NEXT surface writes and reads the
canonical shape from day one — and migrating an existing SQLite file to the canonical schema only
when it is touched for an unrelated reason (the `bars.db` precedent: it was not migrated by fiat,
it grew into the pattern). This keeps the decision reversible: nothing about a "new classes only"
start forecloses a later fiat migration, but a fiat migration started now cannot be un-started if it
turns out to be the wrong call.

---

## 5. Symbol / Security / Entity Master (D3)

*(Answers: data normalization, and — because nearly every other capability depends on a stable
identity underneath the ticker string — indirectly every other question in §0. This is the
Readiness Review's D3, restated as a buildable design: "adopt an internal permanent entity ID with
FIGI as the external mapping, tickers as a dated alias list" — `READINESS_REVIEW_DAY1.md` Part 7
D3, "the clearest, best-evidenced recommendation in this register.")*

**5.1 The design, in one sentence.** A symbol master is a **bitemporal store**, not a lookup table:
one internal, permanent entity identifier; a dated history of ticker strings that pointed at it;
and every downstream table (bars, watchlists, alerts, journal entries, Compass tools) foreign-keyed
to the entity id, never to the ticker string (`domain-symbol-master-time.md` §0 claim 1, §2.1
RECOMMENDATION).

**5.2 Why FIGI's *property*, not necessarily FIGI's *code*.** The Financial Instrument Global
Identifier is free, MIT-licensed, and its defining property is stated in its own documentation:
"Once a FIGI is assigned, it never changes throughout the trade lifecycle" — and a retired
instrument's FIGI stays resolvable rather than disappearing (`domain-symbol-master-time.md` §2.1,
citing openfigi.com, fetched 2026-09-02, tier: official standards body/Bloomberg as Registration
Authority). This is free identifier design UCT does not need to invent from scratch, and it is the
structural fix for exactly the failure mode UCT's own archaeology names: "a ticker-keyed store
cannot represent 'this is the same company, a different string, as of a date'"
(`domain-symbol-master-time.md` §2.1 INTERPRETATION). The transferable idea is the permanent-key /
mutable-alias split, not necessarily adopting FIGI codes as user-facing identifiers — traders think
in tickers, and UCT has no current vendor relationship that hands it FIGI values for free. **OPEN
QUESTION — not resolved by F-09:** whether Massive/Polygon's reference-data endpoints expose FIGI or
another permanent identifier per instrument is still not checked (`domain-symbol-master-time.md`
§2.1 OPEN QUESTION, §2.3 OPEN QUESTION). F-09's capability matrix does carry a dedicated
"search/reference/symbol" column exactly where this fact would live — Massive is marked **Y**
(tickers/conditions) in that column, and the column-level read names "five owners of overlapping
symbol-reference data with no single internal symbol type" as the standing finding
(`provider-master-ledger.md` §2.1 row 1, column-level read) — but F-09 restructured F-03b's own
coverage cells rather than re-reading Massive's reference-endpoint response schema this pass, so
whether FIGI specifically (versus some other permanent id, or none) rides on that endpoint remains
open for a targeted API read, not something F-09's per-capability grain closes on its own.

**5.3 CUSIP is a licensing decision, not just a schema decision — a direct instance of the
licensing-vs-abstraction inseparability §16 argues generally.** CUSIP Global Services' own terms
prohibit "maintain[ing] a master file or database of CUSIP descriptions or numbers... for yourself
or any third-party recipient" (`domain-data-platform.md` §2, §9, citing cusip.com, fetched
2026-09-02, tier: official/CGS-ABA). Building the kind of cross-vendor symbol-mapping table §4–§5
recommend could itself be the licensed act, if CUSIP is the chosen internal join key rather than a
free identifier (FIGI, LEI, or a UCT-internal opaque id). **The internal entity id's primary key
must be chosen with the same rigor the licensing register already applies to Massive/FMP/Finviz —
free/open vs. licensed-with-redistribution-limits — not assumed safe because "it's just a symbol
table, not a price."** (`domain-data-platform.md` §9 RECOMMENDATION.)

**5.4 Share-class and notation handling: canonical form + alias table, not a rewrite function per
vendor pair.** UCT's own `to_polygon_symbol()` is the correct *tactic* at the wrong *altitude* — one
function for one vendor, when the industry problem is genuinely a many-scheme one. Nasdaq's own
documentation shows four internally-inconsistent suffix conventions for the same concepts within
its own product family (`domain-symbol-master-time.md` §2.3, citing nasdaqtrader.com, fetched
2026-09-02). The fix at industry scale, evidenced by Bloomberg's own grammar (accepts ticker,
CUSIP, ISIN, or BBGID interchangeably in the same input slot, resolves internally to one canonical
security), is: accept multiple input schemes at the boundary, resolve to one canonical entity
internally, and store every vendor's notation as a dated alias — not a special-case rewrite
function per vendor pair (`domain-symbol-master-time.md` §2.3 RECOMMENDATION). This composes
directly with the ACL adapter's symbol-translation responsibility (§3.4): the adapter converts
inbound vendor notation to the canonical form on the way in; the alias table is what makes that
conversion a data lookup instead of a hand-encoded rewrite rule.

**5.5 Delisted and renamed entities: mark, don't erase; redirect, don't orphan.** Two external,
independently-observed product-level precedents converge with UCT's own internal design intent:
Fiscal.ai's 2026-06-24 changelog documents "a ticker-mapping refactor to reduce company
duplication," "merged/delisted company pages retained," and "a middleware redirect when a company's
URL changes" (`domain-symbol-master-time.md` §5.2, citing the Fiscal.ai dossier); Gödel Terminal's
`TREND` command renders delisted tickers struck-through rather than removed from a ranking
(`domain-symbol-master-time.md` §5.3, citing `godel/02-verification.md` line 98, VERIFIED tier — the
synthesized `godel/dossier.md`'s own TREND description does not carry this detail forward, a minor
completeness gap in that file, not a defect in this claim). Both are cheap, minimal-viable
conventions directly applicable to Model Book's per-year rosters, a theme's historical holdings, and
UCT20's composition history — where "stocks that rotated out still contribute their return during
holding period" is already the intended behavior (`CLAUDE.md` UCT20 NAV section) but there is no
symbol master underneath it yet to anchor the identity across a rename.

**5.6 What UCT has today to build on.** `cap_universe.json` (3,742 tickers, a static membership
file, `capability-ledger.md` row A8), `ticker_meta_cache` (a disk cache, 24h TTL, `capability-ledger.md`
row A9), and the ticker-search autocomplete endpoint are all real, working, and reusable — but all
three are keyed on the mutable ticker string today, exactly the gap this section closes
(`domain-symbol-master-time.md` §1.1). Building the entity master does not mean replacing these; it
means adding the permanent-key layer underneath them and re-pointing their foreign keys.

**5.7 What is out of scope for this section.** Whether ISIN carries CUSIP-shaped redistribution
restrictions was not independently researched (`domain-symbol-master-time.md` §2.2 OPEN QUESTION,
GAPS) — a symbol master built on any vendor identifier other than a UCT-internal opaque id or FIGI
should verify that vendor's specific permanence and licensing claims rather than inheriting FIGI's
reputation by association (`domain-symbol-master-time.md` §2.2 RECOMMENDATION).

---

## 6. Time Handling

*(Answers: data normalization, backend capability.)*

**6.1 Keep the session-anchored earnings-timing model; it is already the industry-standard shape.**
`calendarTime.js` (35 lines, the entire timezone model of TERMINAL-CURRENT) resolves "before/after"
to a session bucket (BMO 06:00–09:59 ET, AMC 16:00–20:59 ET), never a clock time, because "no clock
times exist from any provider" (`domain-symbol-master-time.md` §1.3, quoting the file's own header
comment). This is independently corroborated by Market Chameleon, a product whose paid analytics
depend on getting "which day" right and which anchors its own earnings-move measurement the same
way ("the Day of Earnings Trading is the business day immediately following the earnings release...
if AMC, the next business day" — `domain-symbol-master-time.md` §5.1, citing the Market Chameleon
dossier). **This is a "keep doing this" finding, not a recommendation to change anything** —
documented here so a future "more precise timestamps" refactor is a deliberate trade-off
discussion, not a silent regression (`domain-symbol-master-time.md` §5.1 RECOMMENDATION).

**6.2 The market clock is a versioned dataset with its own vendor problem — not a derivation from a
timezone library.** NYSE's own hours page shows that even one exchange family does not share a
single session shape (core equities vs. NYSE Arca vs. bonds each run different windows), and
publishes holiday/early-close schedules three years in advance as a maintained, versioned artifact
(`domain-symbol-master-time.md` §4.1, citing nyse.com, fetched 2026-09-02). The open-source
`pandas_market_calendars` library states its own maintenance model explicitly: "Calendars and their
rules are shipped as package code... does not request market hours from a server at runtime," and
treats a holiday, an early close, and an intraday trading break as three structurally distinct
concepts, not one boolean (`domain-symbol-master-time.md` §4.2, citing the project's own GitHub
README, fetched 2026-09-02). `calendarTime.js` is correctly scoped to its one job (earnings BMO/AMC
bucketing) — it is **not**, and should not be mistaken for, a general market-open/closed indicator.
If TERMINAL-NEXT needs a true "is the market open right now" signal for trading, alerts, or a
session-status widget, the recommended pattern is: adopt or mirror a versioned, holiday-accurate
calendar dataset (evaluate `pandas_market_calendars` or a JS equivalent) rather than hand-extending
`calendarTime.js`'s constants (`domain-symbol-master-time.md` §4.2 RECOMMENDATION). **OPEN
QUESTION, outside F-09's scope:** whether such a library covers UCT's specific exchange mix (it is
not checked against NYSE Arca's or the bond market's distinct sessions — `domain-symbol-master-time.md`
§4.2 OPEN QUESTION) is a targeted follow-up, not a blocker to the recommendation. This is a
calendar-library fact, not a provider capability, so F-09's provider-ledger restructuring (§26) has
no bearing on it one way or the other — noted here so the F-09 integration does not read as having
silently dropped it.

**6.3 TBD is a data value, not an error — no change needed, document the convention.** UCT's
calendar already routes ~10% of past Finnhub rows with no `hour` field into an honest "Time TBD"
bucket rather than fabricating a time or dropping the row (`domain-symbol-master-time.md` §0 claim
4). This is the weakest-externally-corroborated of the four time-handling claims in the source
material — Market Chameleon's evidence confirms the *session-anchoring* half but no external source
specifically addresses representing a *genuinely unknown* time as a first-class value
(`domain-symbol-master-time.md` §6, GAPS) — so this convention rests more on UCT's own internal
design than on external precedent, and is flagged as such rather than inflated. The recommendation
is unchanged: any TERMINAL-NEXT events surface must be able to represent "unknown time" as a
distinct value, because a surface that cannot will either fabricate a time (wrong) or drop the row
(reads to a member as a quiet day — the exact failure mode the capability ledger already documents
for `CoverageLine`, §15.2 below).

**6.4 The week-anchor pattern is a transferable idiom worth generalizing, not a one-off fix.**
`_current_week_monday()` is implemented twice, deliberately (backend `calendar.py`, frontend
`weekAnchor.js`), with a test that executes both and compares them on every day of the week
(`domain-symbol-master-time.md` §1.4). More importantly, the underlying pattern — **a calendar can
have more than one legitimate "now," and the fix is to name each intent, not to pick one** — is
already load-bearing across two different surfaces with two genuinely different week intents
(`currentWeekMonday` for the calendar page; `lastSessionDay` for the `/charts` `CalendarWidget`),
seven days apart on a Saturday, with an AST rail that fails on any locally-declared derivation. Any
canonical calendar/event schema (§4.2) should carry this same discipline: name the intent, derive
it once, never let a second implementation drift.

---

## 7. Corporate Actions

*(Answers: data normalization, and — because the licensing register treats price adjustment as
policy-shaped — a piece of licensing/entitlement metadata as well, §16.)*

**7.1 The sharpest finding in this domain: UCT's own primary vendor's adjustment surface is
narrower than the problem.** Massive's own current API documentation for its aggregates/bars
endpoint exposes a single boolean, `adjusted`, and states explicitly: "Whether or not the results
are adjusted for **splits**. By default, results are adjusted." The documentation **does not
mention dividend adjustment anywhere on this endpoint**, and makes no reference to ticker-change or
other corporate-action handling on the aggregates API at all (`domain-symbol-master-time.md` §3.1,
citing massive.com's own docs, fetched 2026-09-02 — the exact vendor and endpoint UCT's own
`CLAUDE.md` names for bars). UCT's bars layer today treats a split as a "stale intraday" *symptom*
detected by `_is_intraday_stale()` (>5 days old) and routes to a different vendor (yfinance,
"because it is split-adjusted") rather than applying an explicit adjustment policy
(`domain-symbol-master-time.md` §1.7, §3.1). **The consequence: any current UCT chart that "looks"
dividend-adjusted is either not actually adjusted for dividends, or is silently relying on a
fallback path whose own dividend-adjustment behavior was never independently verified**
(`domain-symbol-master-time.md` §3.1 GAPS — yfinance's own adjustment-parameter documentation could
not be reached by two fetch attempts, JS-rendered page). This is not a claim that the chart is
wrong; it is a named, unresolved gap between what is *verified* and what a member ticket about "why
did the chart jump" would need answered.

**7.2 Adjustment must be stored as a policy, not baked silently into stored bars.** This is the
program's own D3-adjacent finding, restated and now externally corroborated twice. TradingView's
2026-08-24 Portfolios redesign replaced an automatic price-anomaly-based split *detector* (which
misfired on unusual ratios like "15:14 or 101:100" and applied silently with "no way to see what
changed or undo it") with an explicit, auditable flow: a confirmed split from structured
corporate-action data surfaces as a suggested transaction the user must accept, and all splits live
in a dedicated tab (`domain-symbol-master-time.md` §3.2, citing TradingView's own product blog,
fetched 2026-09-02). UCT's `bars_split_repair` (a one-shot heal module reacting to a detected
anomaly) is closer to TradingView's *old* behavior than its new one. Bloomberg's fundamentals
screen (`FA`) is the second corroborating pattern: standardized, adjusted, and as-reported figures
ship as separate, named, parallel views with the toggle a first-class parameter
(`FA_ADJUSTED=Y`), never a hidden default — and `GUID` ships raw guidance *beside* Bloomberg's own
labelled, derived adjusted series (`domain-symbol-master-time.md` §3.3, citing the Bloomberg
dossier). The pattern both examples converge on: **never let a downstream consumer be unsure which
number they are looking at.**

**7.3 Recommended design: a three-state pipeline, mirroring a pattern UCT already ships for a
different fact.** *Detected* (something looks anomalous) → *confirmed* (a structured source states
a corporate action with ratio/date) → *applied* (the adjustment is live in what renders). UCT's
current pipeline collapses all three into "vendor swap happens automatically." The transferable
idea is not "ask the user before every adjustment" (UCT is not TradingView — its trades are placed
by an internal desk, and member-facing charts are read-only) but **"make *confirmed* a distinct,
auditable, admin-visible state before *applied*"** — mirroring the `calendar_date_integrity` module
UCT already ships for date-drift detection ("Date moved Jul 28 → Aug 4"), which is a corporate-
action-adjacent temporal ledger already built on exactly this admin-visible-state idea
(`domain-symbol-master-time.md` §1.5, §3.2 RECOMMENDATION). This would be that same architecture
applied to price adjustment instead of report dates.

**7.4 Every adjusted value carries a visible adjustment-policy label in its metadata.** Cheaper than
building a full corporate-actions engine, and it converts the current *invisible* ambiguity (§7.1)
into a *visible* one immediately: `"split-adjusted, 2026-09-02"` or `"as reported"` in the canonical
bar/quote schema's metadata (§4), the same way Bloomberg's `GUID` labels itself as Bloomberg's own
derived series rather than the company's number (`domain-symbol-master-time.md` §3.3
RECOMMENDATION). This is also the executive synthesis's own §12.4 architecture implication,
independently reached: "Adjustment stored as a policy and labelled at the point of display... with
a three-state pipeline: detected → confirmed → applied" (`DAY_1_EXECUTIVE_SYNTHESIS.md` §12.4).

**7.5 Scope: corporate actions beyond splits/dividends are genuinely new infrastructure, and are
explicitly deferred, not designed here.** The Readiness Review's D8 names corporate-actions and
portfolio-risk scope as "defer — treat as MVP/roadmap-scoping decisions (H-01), not now"
(`READINESS_REVIEW_DAY1.md` Part 7 D8). There is **no provider anywhere in the current stack** for
an M&A / spin-off / rights-issue / buyback / ticker-change event calendar
(`provider-ledger.md` §2 "Corporate actions" row — the delisted-tickers file is a static JSON, not a
feed). **F-09 confirms this is a genuine class-G gap** (missing from the stack entirely, not merely
underused) and gives it the full ten-question "before we buy anything" treatment: splits+dividends
exist via Massive/FMP and nothing else does; the static `delisted_tickers*.json` is not a feed;
`BARS_SPLIT_REPAIR_ENABLED` (off on web) and `bars_reconciliation` detect adjustment *drift*, not
the underlying corporate-action *events* themselves; and — the specific, actionable finding —
**Massive's own `/v3/reference/tickers` and adjacent reference endpoints could plausibly serve
symbol-change events but have never been enumerated** for that purpose
(`provider-master-ledger.md` §5, "M&A/spin-off/rights/buyback/ticker-change event calendar" row).
F-09's own build-vs-buy hypothesis for this gap is **EXTEND, not buy**: "enumerate Massive's
`/v3/reference/tickers` and adjacent reference endpoints before assuming a new vendor is needed;
this sits inside the already-paid-for Massive relationship"
(`provider-master-ledger.md` §6 item 8) — consistent with, and now the concrete first step for, this
document's own principle of exhausting the existing Massive relationship before any new vendor
(§1.1, §15.2). This document names the gap and the licensing shape of the two classes UCT *does*
have (splits/dividends via Massive's reference endpoints, `R / LA including external publication —
the only Massive row whose external column is LA`, `licensing-register.md` §4.7, corroborated by
F-09's own per-capability rights table at `provider-master-ledger.md` §2.2 "Massive REST | corporate
actions") but does not design the broader event-calendar feature, consistent with D8's deferral. The
Massive reference-endpoint enumeration named above is a cheap, no-new-vendor scoping task a future
wave can pick up without waiting on D8 to formally unblock.

---

## 8. Historical vs. Real-Time Data

*(Answers: backend capability. Cross-references `domain-streaming-caching.md`, which owns the
transport/fan-out decisions in depth — this section states the data-architecture boundary that
feeds that layer, not the streaming mechanics themselves.)*

**8.1 UCT already has a working template for decoupling a data service from the monolith:
`bars-api`.** A fifth Railway service, one day old at the time of this research, serving
`/api/bars` and `/api/bars-history` from an R2-synced `bars.db` with no warmers or scheduler of its
own — "the template for any new tier" (`capability-ledger.md` row A13). This directly answers one
of the two questions this section must resolve for any new TERMINAL-NEXT data-serving surface:
**does it live in the web monolith, or in its own process?** `domain-streaming-caching.md`'s own
decision matrix (D9) names the same template and the same deciding factor: "the deciding factor is
not code — it is whether terminal deploys may be coupled to monolith deploys given the ~3-minute
cold window" (`domain-streaming-caching.md` §12 row D9). This document defers the final call to
ARCH-07 (the streaming/caching architecture proposal, which owns D9 directly) but names `bars-api`
as the concrete, already-proven pattern to reuse rather than invent a new decoupling shape.

**8.2 Historical data: the sealed-URL immutability idiom is the cheapest cache win in the estate,
and it is a data-architecture decision (what makes a resource immutable), not just a caching one.**
`/api/bars-history/{ticker}?d=<sealed-boundary>` returns `Cache-Control: public, max-age=31536000,
immutable` when the client's `?d=` matches a sealed (finished) trading day; a new day produces a new
URL, so "the cache self-refreshes with NO purge" (`capability-ledger.md` row A4;
`domain-streaming-caching.md` §6, calling it "the best idea in this codebase's perf work"). The
general principle this document adopts for every finished-and-frozen data class going forward: **a
resource that is finished (a closed session's bars, a completed earnings quarter, yesterday's
tape) should be named in a way that makes its URL immutable**, converting a mutable resource into
one the CDN edge can cache forever with zero invalidation logic. This composes with the canonical
schema (§4) and the freshness-class field (§14): "historical" is one of the four freshness classes,
and its defining architectural property is that its URL can be sealed.

**8.3 Real-time data: two feeds exist today, one is a retirement candidate, and the split is a
licensing decision as much as a technical one.** UCT's tick stream is Finnhub WebSocket (not
Massive, contrary to `CLAUDE.md`'s claim — `DAY_1_EXECUTIVE_SYNTHESIS.md` §1.2, "the single most
important real-time path" the claims document got wrong), while Massive WS already feeds developing
bars and the full OPRA options tape (`provider-ledger.md` rows 1–2, 6). Finnhub sits on "strictly
for personal use... even internally... or derived results" terms — the single most-restricted
provider in the whole estate, on its single most load-bearing, always-on surface
(`provider-ledger.md` 1B row 6). The provider ledger, the licensing register, and the cost model
all independently converge on the same recommendation: retire the Finnhub tick stream onto Massive
WS/snapshot, which UCT already pays for and already under-uses for this exact purpose
(`provider-ledger.md` §4 row 5; `licensing-register.md` §4.1 A7; §17.1 below). **This is an
architecture recommendation this document adopts as a design constraint going forward: no new
TERMINAL-NEXT surface should add a second consumer of the Finnhub tick lane; new real-time equity
consumption should target Massive.**

**F-09's per-capability read of Finnhub sharpens "retire" from a single provider-level verdict into
a differentiated sequence, because Finnhub's other capabilities do not all carry the tick stream's
severity.** F-09 classifies Finnhub as usage-class **A** overall ("a live but retirement-flagged
leg") but its own capability matrix shows the tick stream is only one of eight columns Finnhub fills
(`provider-master-ledger.md` §2.1 row 6): quotes (Y, WS+REST), streaming (Y, ticks — the retirement
target above), fundamentals (**P**, `/metric` only), estimates (**P**, recommendation/price-target
endpoints already 403ing), earnings (**Y**, calendar+EPS history), transcripts (**P**, 403),
ownership/insiders (**Y**, insider transactions — not 403ing), and calendars (**Y**, earnings+IPO).
Two implications for the retirement sequence: first, the tick stream is the one capability actually
"strictly for personal use" on its most load-bearing, always-on surface — the highest-severity leg
and the one this document's design constraint above targets first; second, Finnhub's insider-
transactions and earnings/IPO-calendar capabilities are still live (not yet 403ing) and already named
as secondary legs in the earnings-calendar consolidation (§15.2's four-provider EarningsWhispers/
Finnhub/FMP/Finviz assembly) — retiring those does not carry the same urgency as the tick stream and
can follow the FMP/EDGAR consolidation path §15.2 already recommends on its own schedule, rather than
being bundled into the tick-stream retirement as one action.

**8.4 The developing-bar single-writer invariant is a correctness pattern worth generalizing beyond
charts.** `StockChart.jsx`'s six-writer-site AST-derived rail (any code path that calls `.update()`
on the live candle series must consult `barsPushActiveRef` or be structurally disjoint from push) is
the concrete, working answer to "what happens when two feeds can both write the same value"
(`capability-ledger.md` row A5, `CLAUDE.md` "Bars Push Feed" section). Any canonical schema for a
live-updating value (§4) that can be written from more than one source (a REST poll and a push feed,
say) needs an equivalent single-writer discipline — named here as a pattern requirement on any new
live data class, not re-derived per surface.

**8.5 Options tape: historical-only is a materially different licensing shape from real-time or
delayed, and the architecture should treat "which tape tier" as a first-class configuration, not an
assumption.** OPRA's own fee schedule: historical-only is exempt from the redistribution fee and the
per-member fee entirely; delayed or real-time both owe a $1,500/mo floor, with real-time adding
$1.25/member/mo (`licensing-register.md` §4.7 "Real-time OPRA print" row, §2.3). Massive's OPRA
WebSocket **does not replay — every feed gap is permanent until the T+1 flat file**
(`provider-ledger.md` 1B row 2; `CLAUDE.md` "Live Options Flow" section). Any options-tape-serving
architecture should therefore separate "what UCT stores internally" (which today already has this
correctly as a two-tier live-WS-plus-T+1-flat-file gap-fill design, `provider-ledger.md` row 3) from
"what tier is exposed to which audience" (desk vs. member), because the second is a per-tier
licensing decision this document does not make (§16.4 names it as one of the four licensing
primitives the architecture is designed around, not resolved). **F-09's column-level read
independently names options as "the most duplicative column in the matrix"** — five providers
answer some part of the options-chain/Greeks/OI/print class today: Massive's native chain+Greeks+IV
(primary), Schwab's chains (GEX/dealer positioning, partner-owned, a re-source candidate per §16.1's
partner-file caveat), yfinance+Black-Scholes (legacy, voice-only — the Unsuitable leg), Polygon-direct
(duplicate, one backfill call, §16.1's class-D finding), and Unusual Whales (per-contract history,
dormant/partner-file-only, also class D per §16.1) (`provider-master-ledger.md` §2.1 column-level
read, "Options" row). This is consistent with, not new information beyond, §16.1's own class-D
findings above — it is the same two duplicative legs (Polygon-direct, UW) counted from the options
column's point of view rather than the provider's, and confirms the tape-tier design above should be
built on Massive's native chain as primary with no ambiguity about which of the five legs is the one
worth investing adapter effort (§3.6) in first.

---

## 9. Polling vs. Streaming

*(Answers: backend capability. This is `domain-streaming-caching.md`'s primary subject; this
section states only the data-architecture-relevant summary and the interface this document's
canonical schema (§4) and provenance/freshness fields (§13–14) must support, deferring the transport
mechanics to that sibling contract's decision matrix, which feeds ARCH-07.)*

**9.1 Both exist today, deliberately, for different reasons — and the pattern is sound.** REST
polling (live quotes, movers, snapshots — `capability-ledger.md` rows A1, A6, A7) covers the
whole-universe, low-frequency case; SSE push (price ticks, developing bars — rows A2, A5) covers the
high-frequency, per-symbol case. `domain-streaming-caching.md`'s own decision matrix recommends
**keeping** the pooled-SSE, client-side-multiplexing shape (its row D1, D2) as the architecturally
sound choice against UCT's actual constraints (single event loop, multi-worker-unsafe in-process
state, a measured `STREAM_MAX_SUBSCRIBERS=300` ceiling per stream family) — this document adopts
that recommendation rather than re-deriving it.

**9.2 What this document adds, specific to the data layer:** the canonical schema (§4) must be
transport-agnostic — the same quote/bar shape flows through a REST response or an SSE payload
without a second definition, because today's shape is already implicitly this way (both paths
ultimately populate the same chart series) but nothing enforces it as a contract. The provenance
and freshness fields (§13–14) apply identically whether the value arrived by poll or by push; a
pushed value is not exempt from carrying its vendor-of-origin and as-of timestamp just because it
arrived on a different transport.

**9.3 The edge-caching gap is a data-architecture finding worth restating here because it changes
what "the data is fresh" means to a client.** JSON is not cached by Cloudflare's edge by default —
`cf-cache-status: DYNAMIC` on a JSON route is the documented default, not a misconfiguration
(`domain-streaming-caching.md` §6, citing Cloudflare's own documentation, fetched 2026-09-02); a
Cache Rule to change this has reportedly sat unapplied since 2026-07-25 per that domain pod's
reading of D-05 (`domain-streaming-caching.md` §6 — this document does not independently verify
that date and defers to `domain-streaming-caching.md`'s own confidence marks on the point). This
matters for §14 (freshness metadata) because a client cannot infer server-side cache state from
response headers alone if the edge is silently bypassing cache on every request; the freshness-class
field in the canonical schema should therefore be computed and shipped by the origin, not inferred
by the client from cache headers.

**9.4 Deferred to ARCH-07 explicitly, not silently.** Fan-out substrate (in-process vs. Redis vs.
NATS), conflation policy, board-level aggregation vs. per-panel fetch, and the multi-instance
trigger are all `domain-streaming-caching.md`'s decision matrix rows (D3–D5, D8) and are explicitly
out of this document's scope — this document's job is the *data* underneath those transports, not
the transport decisions themselves. Where this document's recommendations (the canonical schema,
provenance fields, freshness fields) constrain those decisions, it says so; where it has no
opinion, it defers.

---

## 10. Caching Layers

*(Answers: backend capability, and — via the licensing register's retention rules — licensing
metadata.)*

**10.1 The existing multi-layer bars cache is the reference shape to generalize, not a bars-only
special case.** Memory TTLCache (5–15 min, per-timeframe: `1m:5s ... D:300s`) → SQLite/disk
(2–72h by timeframe) → vendor REST, with a `ServeStale` last-good wrapper measured to turn a
4.51s/7.97s TTL-expiry request into 0.12s for subsequent callers (`domain-streaming-caching.md` §6
RELEVANCE TO UCT; `capability-ledger.md` row A3). This three-tier shape — memory / disk / vendor,
each with its own TTL tuned to how fast that data class actually changes — is the pattern any new
canonical data class (§4) should adopt, sized per class rather than reusing bars' specific numbers.

**10.2 The browser-side cache tier is real and needs the same discipline as the server tiers.**
IndexedDB with a `CACHE_LOGIC_VERSION` invalidation lever (`capability-ledger.md` row A11) is the
one mechanism UCT has today for invalidating vendor data already delivered to a member's device —
and it is the *only* lever, which the licensing register names as a structural gap: "the browser
tier is reachable only by invalidation — no delete-on-demand exists on members' devices"
(`licensing-register.md` §4.6). This is directly load-bearing for entitlement revocation (R-A6-6,
§16.3): losing entitlement must invalidate the member's browser-held vendor data through this same
primitive, and today nothing wires entitlement changes to a `CACHE_LOGIC_VERSION` bump.

**10.3 A retention window is a chosen, licensed horizon, not an accident — every store needs one,
declared.** `flow.db` grows unbounded (`FLOW_PRUNE_ENABLED` is written, wired, and set on no
service); `darkpool_records` is never pruned by design; `catalysts.db` retains indefinitely;
`bars.db` has no found prune at all (`licensing-register.md` §4.2 R-A4-6, listing every store by
name). This is the licensing register's own architectural rule, restated here as a caching-layer
requirement because a cache without a bounded retention window is not a cache, it is an unbounded
store wearing a cache's TTL cosmetically. Every canonical data class's storage tier (§4, §21) should
declare its retention horizon at design time, arm the corresponding prune job to it, and treat "no
retention horizon was chosen" as a defect the way `licensing-register.md` §4.9 item 10 treats an
undeclared count: "a retention window nobody chose is a retention window nobody can defend."

**10.4 Sealed-URL immutability (§8.2) is the caching-layer implementation of the historical
freshness class.** Restated here because it is as much a caching decision as a data-architecture
one: naming a resource so its URL becomes immutable is the cheapest possible cache — no
invalidation logic is needed because the resource, by construction, cannot change.

**10.5 Deferred to `domain-streaming-caching.md` / ARCH-07:** the specific Cache-Control header
mechanics (`s-maxage` vs. `stale-while-revalidate` — that sibling document names a real defect where
the two headers cannot coexist per Cloudflare's own documentation, `domain-streaming-caching.md` §6
finding 2), browser tab throttling and freezing behavior, and per-subscription conflation policy.
This document's caching-layer scope is what gets cached and for how long, keyed to data-class
freshness (§14); the mechanics of edge/browser cache-control headers belong to ARCH-07.

---

## 11. Provenance

*(Answers: data normalization, and directly enables licensing/entitlement metadata, §16, and AI
data access, §25.)*

**11.1 The formal model: two standards, complementary, both worth adopting the shape of.** W3C
PROV defines three reusable concepts — **Entity** (the thing whose provenance is tracked),
**Activity** (the process that produced or transformed it), **Agent** (who or what was responsible)
— specifically so provenance can be exchanged across systems rather than locked in a proprietary
format (`domain-data-platform.md` §7, citing w3.org, fetched 2026-09-02, tier: official W3C
Recommendation). OpenLineage, the modern operational instantiation for data pipelines specifically,
uses **Dataset / Job / Run** with an explicit **facets** extensibility mechanism for user-defined
metadata without forking the core spec (`domain-data-platform.md` §7, citing openlineage.io, fetched
2026-09-02, tier: official Linux Foundation project documentation).

**11.2 The pattern both standards converge on, restated plainly: provenance is not "which vendor"
as a bolted-on string.** It is a typed record of *what produced the value* (an
activity/job/run), *from what* (an entity/dataset), *when*, and *under whose responsibility* (an
agent), kept separable from the value itself so it can be queried, audited, and propagated through
derivations. A single "source" text field answers "which vendor" but not the four questions a
reconciliation dispute or a licensing audit actually needs answered (`domain-data-platform.md` §7
INTERPRETATION).

**11.3 UCT has exactly one working, narrow instance of this today; the architecture generalizes
it.** `bar_provenance.py` and `bar_quarantine.py`, both dedicated modules, both scoped to bars only,
both — notably — stored in `auth.db` rather than beside `bars.db`
(`domain-data-platform.md` §7 RELEVANCE TO UCT; `capability-ledger.md` row A10). The recommended
design: **generalize `bar_provenance.py`'s shape to every canonical data class (§4)**, carrying at
minimum:
- **source-activity reference** — which adapter, job, or run produced this value (PROV's
  Activity / OpenLineage's Run);
- **source-entity reference** — which upstream vendor payload it was derived from (PROV's
  Entity / OpenLineage's Dataset);
- **timestamp** — when the value was fetched/computed, distinct from the value's own as-of date
  (this is also the seam for §14's freshness field);
- **tie-break record, where more than one vendor can answer the same field** — not a silent
  overwrite. FMP's `_earn_row_preferred` (§4.3) is exactly the kind of decision this makes queryable
  instead of buried in one function's control flow.

**11.4 The provider ledger's own evidence-class vocabulary is itself a second, independently-
invented instance of the same underlying need, worth formalizing into the same schema rather than
left as prose.** The KP/CR/OC/CA ladder plus the `code-only`/`config-recorded`/`dated-probe`/
`live-read` evidence-class scheme (`provider-ledger.md` preamble) answers "what evidence exists
that a provider is actually in use" — a parallel provenance question (typed claims about where a
*fact about the system* came from and how sure anyone is), solved independently, without reference
to PROV or OpenLineage, and currently living only as a markdown convention rather than a queryable
field (`domain-data-platform.md` §7 INTERPRETATION, RECOMMENDATION). §22 (observability) picks this
up as a platform primitive.

**11.5 This is the direct implementation of R-A4-1.** "Provenance is a field, not a memory" — every
value in the canonical model carries vendor-of-origin and data-class, so display eligibility, prompt
eligibility, publication eligibility, and cache-deletion scope are *computed* from the row rather
than remembered by whoever shipped the surface (`licensing-register.md` §4.2 R-A4-1). This section
is the concrete design for that rule; §16 and §25 are its two most consequential consumers.

---

## 12. Freshness Metadata

*(Answers: data normalization, and directly feeds licensing/entitlement (§16) since freshness class
is what a delayed-data design's compliance rests on.)*

**12.1 Freshness class is a first-class field on every price-shaped value, not an implicit property
of which endpoint answered.** Four classes, per the licensing register's own architectural rule
(R-A4-2): **real-time · delayed-15 · end-of-day · historical**
(`licensing-register.md` §4.2). This is not a cosmetic label — it determines what the renderer is
*permitted* to draw: a delayed display requires the notice ("Data Delayed 15 minutes" / "Del-15")
prominently placed and repeated (UTP: at or near the top of every display and interspersed at least
every 90 seconds in a ticker; CTA: "conspicuously displayed on all screens"), plus a Financial
Status Indicator on every intraday single-security quote or trade display **including delayed ones**,
plus a Consolidated Volume Message where consolidated volume sits beside non-UTP data
(`licensing-register.md` §4.5 "UTP / CTA delayed data" row). **UCT ships none of these strings
anywhere in `app/` or `api/` today** (`licensing-register.md` §4.2 R-A4-2) — this is not a
regression, because UCT does not currently sell a delayed-price product to non-desk members; it is
named here because the day TERMINAL-NEXT ships a delayed-price design to members (§16.4's "delayed
price + real-time volume" primitive), these strings are a **new build**, not a toggle on an existing
one, and the freshness-class field is the schema hook the renderer keys off of to decide when to
show them.

**12.2 "Delayed price, live volume" is a designed product shape, not a filter on the real-time
feed.** The canonical quote object must be able to carry a 15-min-delayed last price beside
**real-time volume**, live percent of ADV, prior close, and — on the bar side — a delayed developing
bar beside a live volume bar. This is the "load-bearing lever" the licensing register names because
it zeroes the Tape C per-member exchange fee entirely (multi-security *and* real-time volume
alongside delayed last-sale data are both free under UTP's own Derived Data policy) and removes the
subscriber-agreement/entitlement-reporting burden that a real-time single-symbol quote carries
(`licensing-register.md` §4.2 R-A4-3, citing UTP Derived Data §3). **This does not touch the vendor
tier question (OI-03a)** — it is a shape to design and build *after* the tier answer, never instead
of it, because it zeroes the *exchange* fee, not the *Massive Individual-vs-Business* licensing
question (§1.2, §16.4).

**12.3 Freshness metadata is where the intelligence layer's grounding requirement and the market
clock (§6.2) meet.** Session state (ET wall clock; pre/RTH/post/closed/half-day; minutes since the
session boundary; per-value as-of) must be injected as a first-class grounded fact for any AI
surface that reasons about a value's currency — never used only as a cache salt
(`DAY_1_EXECUTIVE_SYNTHESIS.md` §12.3, citing the grounding-architectures domain pod). §25 below
carries this forward into the AI-access design.

---

## 13. Confidence / Data-Quality Metadata

*(Answers: data normalization, observability — the two are inseparable here.)*

**13.1 UCT already has the platform-primitive shape; it covers 13 fields today against roughly 30
data classes in the coverage matrix.** `provider_coverage_monitor.py` measures per-field fill-rate
against a floor, self-heals a stale cache entry, and alerts only on newly-flagged tickers so a
persistent upstream anomaly stays visible without re-spamming (`capability-ledger.md` row D12). The
Readiness Review's own architecture implication names this directly: "pair every row that has a
provider with the `provider_coverage_monitor` field-spec + floor pattern... so a dead leg cannot
read as a quiet market" (`provider-ledger.md` §2 "RECOMMENDATION"). This document adopts that as the
design rule: **every canonical data class (§4) gets a coverage-monitor entry with a declared floor**
as part of onboarding that class, not as an afterthought once a defect is already user-visible.

**13.2 `CoverageLine`'s four-count receipt is the honest-blank idiom to generalize past the
screener.** Evaluated · answered · dropped · not computable, kept as four separate counts rather
than collapsed, because "we could not compute it" and "something broke" are different facts to a
trader; when `answered === 0` with anything not-computable, the component says explicitly "that is a
gap in what we hold, not a quiet market" (`CLAUDE.md` Phase E section). This is currently a
screener-only component; the Readiness Review already names generalizing it as an architecture
implication for TERMINAL-NEXT's provenance layer ("generalize `CoverageLine`/COT-gate/AI-Search-
citations into one rendering component" — `READINESS_REVIEW_DAY1.md` Part 5, D6). This document
extends that: any canonical data class whose coverage can be partial (fundamentals across a
screener sweep, calendar rows across a week, options chains across a universe) should expose its own
four-count receipt, computed from the same provenance fields §11 defines — not a bespoke count
invented per surface.

**13.3 Data-quality confidence and licensing evidence-class are structurally the same kind of field
and should share one vocabulary, not two.** §11.4 already names this: the provider ledger's KP/CR/
OC/CA evidence ladder and a hypothetical "how confident are we in this fundamentals row" field are
both typed claims about how sure anyone is about a fact, attached to the fact itself. This document
recommends they be **the same mechanism** — a confidence/evidence-class field on the provenance
record (§11.3), not a data-quality system built separately from a licensing-evidence system that
happen to look alike.

---

## 14. Licensing / Entitlement Metadata

*(Answers: licensing/entitlement — this is the section that ties directly into the licensing
register's own evidence-tier vocabulary, per this task's explicit instruction.)*

**14.1 The licensing register's vocabulary is the vocabulary this architecture uses; it is not
re-invented here.** Class: **A** (Allowed — no vendor licence anywhere in the path, public domain
or UCT's own content) / **LA** (Likely Allowed, verify contract) / **R** (Restricted — a public
clause on its face collides with the behavior; not itself a finding of breach) / **U** (Unknown —
clause unreachable or tier unresolved) / **X** (Unsuitable — prohibited with no purchasable remedy;
only Yahoo/yfinance, TheFly-direct, and model training on X/Reddit content reach it today)
(`licensing-register.md` "Legend"). The provider ledger's separate evidence-strength ladder — **KP**
(KEY-PRESENT) → **CR** (CODE-REFERENCED) → **OC** (OBSERVED-CALLED) → **CA** (CONTRACT-ACTIVE, no row
anywhere reaches this today) — answers a related but distinct question: not "is this use licensed"
but "is there evidence this integration is actually running" (`provider-ledger.md` preamble). Both
vocabularies are carried into the canonical schema (§4) and the provenance record (§11) as fields,
never restated or re-derived by this or any downstream document.

**14.2 Every canonical value carries its licensing class as a computed field, derived from
provenance, not remembered.** This is R-A4-1 again, stated for this section specifically: because
the provenance record (§11) already carries vendor-of-origin and data-class, licensing eligibility
for display, for a prompt, or for external publication is a **lookup against the licensing register's
class table keyed by (vendor, data-class, audience)** — computed at the point of use — rather than a
fact a developer has to remember when building a new surface. This is the single most important
architectural payoff of doing §11 (provenance) and §4 (canonical schema) properly: it converts "did
anyone check the licensing here" from a code-review question into a structural guarantee.

**14.3 Freshness class (§12) and licensing class are linked, not independent.** UTP's own Derived
Data policy is what makes "multi-security derived" data free at the exchange-fee layer *and* what
makes a *delayed* display's exchange fee zero — but neither of those exchange-fee facts changes
whether the underlying vendor's Massive-tier licence (Individual vs. Business) permits the display at
all (§1.2). A canonical value's licensing-eligibility computation therefore consults **both** its
freshness class and its "derived-data bucket" (§24.1) — a delayed, multi-security-derived value can
be exchange-fee-free while still being vendor-licence-Restricted on an Individual Massive tier.

**14.4 Audience is an entitlement attribute on every published artifact, and there is one
publication chokepoint.** `desk · member · community · paid newsletter · public`, carried on every
surface and every published artifact; anything leaving the controlled product (Discord, Substack,
YouTube, `/r/*`, an unauthenticated route, a marketing page) passes **one** gate that reads the
vendor-of-origin field and asks "whose data is in this, and may it go out?"
(`licensing-register.md` §4.4 R-A6-2). UCT already has the fail-closed idiom this gate should be
built on — a blank `DESK_PUBLIC_SHOWS` or `DESK_TSDR_ANNOUNCE_SHOWS` makes nothing public, never a
leak by default — but that idiom was built for the *paywall* question, not the *vendor licensing*
question, and R-A6-2's recommendation is to reuse the mechanism and add the second reason to consult
it, not to build a second gate.

**14.5 No data endpoint answers without server-side authentication — Tier S, per R-A6-1.** This is
listed here rather than only in §27 (API/BFF responsibilities) because it is the entitlement
architecture's foundational requirement, confirmed live in production today as R-17: unauthenticated
`GET`s to `/api/live-prices`, `/api/snapshot/{sym}`, and `/api/movers` return 200 with live vendor
data, and `/api/gex/data` reaches its handler (422 for a missing parameter, not 401)
(`DAY_1_EXECUTIVE_SYNTHESIS.md` §1.3, §14 risk #1; `licensing-register.md` §3B, §4.4 R-A6-1). This is
a **production finding, reported to the owner for a normal remediation session — it is not changed
by this research program** and this document does not propose fixing it; it names it as the
architectural requirement (server-side auth on every data route, checked by a route-table rail that
fails by name on any `/api/*` data route missing an explicit auth dependency, because the defect
class already recurred once after being fixed once — `licensing-register.md` §4.4 R-A6-1) that any
new TERMINAL-NEXT data endpoint must satisfy from its first commit.

**14.6 Per-member cost is an entitlement-architecture concern, visible at design time, not
discovered at the invoice.** Any surface reaching a real-time single-symbol quote, a real-time OPRA
print, or an option chain adds a per-user licensing cost line ($1/member/mo per CTA Tape A and B,
$1.25/member/mo OPRA — public list prices, `licensing-register.md` §4.4 R-A6-4), and any cost that
scales with member count escalates to the owner regardless of amount
(`GOVERNING_PRINCIPLES.md` §11; `licensing-register.md` §4.4 R-A6-4). §21 (cost-awareness) carries
this into the cost-model branches.

**14.7 F-09 makes the access-vs-rights split (§14.2's `R-A4-1` rule) concrete at the per-capability
level, and every row of its split confirms the same architectural point: an evidence-ladder status
of OBSERVED-CALLED is never itself a licensing answer.** Per contract, F-09's Deliverable 4
restates — for every provider whose capabilities diverge — that "a working key or an observed call
is evidence of ACCESS only, never of REDISTRIBUTION/STORAGE/DERIVATION/AI-PROCESSING rights"
(`provider-master-ledger.md` §4). The canonical provenance record (§11.3) and the licensing-eligibility
lookup (§14.2) are exactly the mechanism this rule needs; F-09's own table is the concrete worked
set of examples that mechanism must get right on day one:

| Provider / capability | F-09's access evidence | What that access evidence does **not** establish |
|---|---|---|
| Massive REST/WS/flat files | OC — a working key returns live quotes | Whether the Individual-tier grant (this document's default assumption, §1.2) permits customer-facing display, Derived Works, or storage at all — only the Business tier's `store` grant reaches that (`provider-master-ledger.md` §4, citing F-04 T-01/T-09/T-11/ESC-01) |
| FMP Premium | OC — the key fills 95%+ of its tracked fields | Whether a Data Display and Licensing Agreement exists; §2.2.2 forbids display on multi-individual applications absent one — "a working key is the clearest case in the whole register of access without a settled right" (`provider-master-ledger.md` §4, F-04 T-33/ESC-02) |
| Finnhub | OC — the key works and returns data on this plan | Nothing about redistribution; the personal-plan clause reaches "derived results" and "even internally" — "the most-restricted provider in the stack sits on the least-visible always-on surface" (§8.3's tick stream) (`provider-master-ledger.md` §4, F-04 T-51/ESC-08) |
| yfinance | OC — the scraper works and has for years | Nothing, permanently — "there is no licence to buy at any price... the one case in the register where access exists and no right exists, ever, are simultaneously and permanently true" (`provider-master-ledger.md` §4, F-04 T-71–T-76) |
| Finviz Elite | OC — the export succeeds nightly | Nothing — no terms document exists at all, and `robots.txt` disallows the exact paths used, so "even the reachability itself is contested, not merely the licence" (`provider-master-ledger.md` §4, F-04 T-47/ESC-07) |
| Schwab (partner) | CR — the integration is mounted and reached | Whether the accepted developer tier contemplates display to non-account-holders; one process-wide OAuth token fanning one account holder's entitlement out to the membership is "access without an evidenced right by construction" (`provider-master-ledger.md` §4, F-04 T-77/ESC-10) |
| Bullflow, Polygon-direct, UW | KP-only — a key is present on Railway | Nothing about current billing status; "the clearest cases in the ledger where KEY-PRESENT is evidence of history, not of either access or right" (`provider-master-ledger.md` §4, F-04 OI-04/ESC-22) |

F-09's own closing line on this deliverable is the architectural requirement this document adopts
verbatim: "every OC cell answers 'does the integration work' — never 'may UCT do X with what it
returns.'" (`provider-master-ledger.md` §4). Concretely, this means the licensing-eligibility lookup
(§14.2) must be keyed on (vendor, data-class, audience) and **never** short-circuited by an
evidence-ladder status check alone — a status of OC is a necessary precondition for a capability to
even reach the lookup, not a substitute for it.

---

## 15. Fallback / Provider-Routing Strategy

*(Answers: backend capability, and — because the current fallback chains are ordered by
availability, not licence — a licensing concern too.)*

**15.1 UCT's current fallback chains are ordered by cost and availability, not by licensing
status — this is the pattern the architecture must change for any member-facing path.** News:
AlphaVantage → 7 RSS feeds → Massive `/v2/reference/news` → FMP `stable/news/*` → Finviz →
Google News RSS, "each consulted only when the previous fails or is throttled"
(`provider-ledger.md` §8.4, §2 "News" row). Fundamentals: FMP → Finnhub → yfinance (24 modules).
Transcripts: FMP → AlphaVantage (lazy, 25/day) → earningscall.biz (keyless, dormant) → Finnhub
(403 for months). Each of these chains mixes a Likely-Allowed vendor (FMP, conditional on a DDLA),
a Restricted vendor (Finnhub, AlphaVantage), and — for bars and fundamentals specifically — an
Unsuitable vendor with no purchasable remedy (yfinance) in the same fallback list
(`licensing-register.md` §4.8 item 9 "not all fallbacks are legal fallbacks"; §4.2 R-A4-5). **F-09's
per-capability column-level read independently confirms both chains at finer grain**: News is "the
single most redundant class in the product," a six-deep fallback (AV→RSS→Massive→FMP→Finviz→Google);
Transcripts assemble as FMP (primary) → AV (verbatim, lazy) → earningscall.biz (dormant, keyless) →
Finnhub (403), with **measured coverage of null (n=0) this cycle** per F-09's own read of
ORCH-RAILWAY-01 (`provider-master-ledger.md` §2.1 column-level read, "News" and "Transcripts" rows) —
a chain with five fallback legs that currently delivers zero rows is exactly the shape §15.3's
"cheap correctness fallback vs. member-facing licensed chain" distinction exists to catch.

**15.2 The architectural rule going forward: one licensed vendor per data class in any
member-facing adapter — this is R-A4-5, restated as a design constraint this document adopts.** No
Finnhub, AlphaVantage, or yfinance in a member-facing adapter path. Massive for prices, bars, index
snapshots, reference data (splits/dividends — moving `breadth_dividends.py` and
`dividends_calendar.py` off yfinance is a named, cheap first move), and news; FMP (once a DDLA
exists) or **SEC EDGAR** for fundamentals, ownership (Form 4/13F, both public domain and currently
underused — `provider-ledger.md` §5.4), and filings; the licensed vendor plus EDGAR's 8-K feed for
earnings dates (today **four providers assemble one field** — EarningsWhispers, Finnhub, FMP,
Finviz — the consolidation target named independently by both the provider ledger and the licensing
register, `provider-ledger.md` §8.4, `licensing-register.md` §4.2 R-A4-5); CFTC direct for COT
(`licensing-register.md` §4.2 R-A4-5). Futures quotes have **no licensed provider anywhere in the
stack** — a genuine no-provider gap, not a fallback UCT can currently paper over
(`provider-ledger.md` §2 "Futures / COT" row). **F-09 sharpens this into the single most
consequential class-G finding in its entire ledger**, and this document adopts F-09's own framing
rather than the weaker "no provider" phrasing above: NQ/ES/RTY/BTC are served today by yfinance, and
futures is "the only class-G gap where the incumbent solution is not merely underused but actively
the worst-licensed row in the entire register" — Massive's equities API does not carry futures at
all, so there is no existing-vendor extension available the way there is for the event-calendar gap
(§7.5) (`provider-master-ledger.md` §5 "Licensed futures quotes" row, §6 item 9). F-09's own
build-vs-buy hypothesis is **BUILD/INTEGRATE (candidate)**, specifically because "keep using
yfinance" is not actually an available option once futures data reaches any member surface, under
§15.3's cheap-fallback-vs-member-facing distinction below (`provider-master-ledger.md` §6 item 9,
citing F-04 T-72, X-class). This document treats a small futures-data vendor scan as warranted on
the same terms as §16.2's short-interest exception: a case where the current single source is also
the licensing floor, not merely a convenience to retire.

**15.3 The distinction that matters architecturally: a "cheap correctness fallback" (desk-only,
internal tooling, admin diagnostics) is a different design from a "member-facing licensed-vendor
chain."** yfinance's dividend-adjusted breadth collection, for instance, is Unsuitable at the
member-facing licensing layer but is currently the *authoritative EOD breadth row* feeding a
member-facing Exposure Rating (`provider-ledger.md` §2 "Breadth" row: "the input to the Exposure
Rating rests on an Unsuitable source"). This document does not resolve that specific instance (it is
named in the provider ledger's own retirement queue, `provider-ledger.md` §4 row 7, as a build
decision pending owner awareness, not a contractual one) but states the general rule the retirement
should follow: **a fallback used only for desk-internal diagnostics or admin tooling may tolerate a
wider vendor set than a fallback whose output reaches a member**, and the adapter boundary (§3) is
where this distinction is enforced — a member-facing adapter simply does not construct a client for
an Unsuitable vendor, full stop, rather than relying on every call site remembering not to use it.

**15.4 Retirement candidates are already named and sequenced; this architecture does not
re-derive them, it designs the seam they retire into.** Seven retirement/consolidation candidates
(Bullflow, Polygon-direct, Unusual Whales, Finnhub, AlphaVantage, yfinance, ForexFactory) plus the
six FMP helpers (`provider-ledger.md` §4). Retiring each one is a matter of pointing its call sites
at the adapter for its replacement vendor (§3) — the ACL boundary is precisely what makes a
provider retirement a one-file change instead of a call-site sweep, per D4's own framing
(`READINESS_REVIEW_DAY1.md` Part 7 D4).

---

## 16. Provider Redundancy

*(Answers: backend capability, and touches workflow quality where redundancy is correctness-motivated.)*

**16.1 Today's overlap is accidental, not designed — Massive, FMP, Finviz, Finnhub, and yfinance
all answer overlapping data classes with no stated reconciliation policy for most of them.** The
provider ledger names this explicitly per row (`provider-ledger.md` 1B "Overlap with" column, e.g.
row 1: "yfinance (bars, indices), FMP (intraday fallback), Finnhub WS (ticks), Schwab (chains —
`polygon_options.py` already serves chains natively)"). Overlap that exists because nobody has
retired the losing leg is a maintenance and licensing liability, not redundancy — it is the exact
shape §15.1 names as a fallback chain ordered by convenience rather than licence.

**F-09 formalizes this as its own usage-class D ("duplicative/overlapping") and names three
specific instances this document folds into the retirement queue (§15.4) rather than treating as new
findings requiring new design:**
- **Polygon.io direct** — a straight duplicate of Massive: "same vendor family, same protocol, one
  backfill call site" (`provider-master-ledger.md` §3.1 class-D row). This is the same retirement
  candidate §15.4 already names; F-09 adds no new work here, only a formal classification confirming
  the call is correct.
- **Unusual Whales** — duplicate/overlap on *two separate axes simultaneously*, not one: its
  analyst-screener capability overlaps FMP's (ranked behind FMP in the wire already, so the losing
  leg is already known), and its per-contract options-flow history overlaps Massive's options data
  (`provider-master-ledger.md` §3.1 class-D row, §3.2 "worked examples" — UW is class **D** on one
  capability and class **E**/dormant on its live-flow half simultaneously, "a provider can occupy two
  classes across its own two capabilities"). This sharpens §15.4's UW retirement-candidate line from
  a single overlap into two independently-resolvable ones — the analyst-screener leg retires onto
  FMP, the options-history leg onto Massive, and they need not retire together.
- **The six independent FMP `_fmp_get` helper implementations** (§1.3, §3.6) are, per F-09's own
  framing, "not a second vendor, but six duplicate client implementations of one vendor relationship
  with no shared budget" (`provider-master-ledger.md` §3.1 class-D row) — this is the same debt case
  study §3.2's ACL-pattern section already names as the D4 proof case; F-09's classification confirms
  it belongs in the same "designed redundancy vs. accidental overlap" bucket as the two provider-level
  cases above, not a separate problem.

None of these three findings changes this document's recommended treatment (§3's ACL adapter
retires the FMP-helper duplication; §15.4's retirement queue already targets Polygon-direct and UW)
— F-09's contribution is confirming, at the capability level, that all three are genuinely
*accidental* duplication in the sense §16.2 below distinguishes from *deliberate* redundancy, so a
future consolidation pass can retire them without a second look.

**16.2 The target: redundancy only where it is deliberately chosen for a specific reason — licensing
risk reduction, or correctness verification — never as an accident of history.** Two concrete,
worth-keeping cases already exist in the estate and this document recommends preserving both
explicitly, by name, so a future consolidation pass does not sweep them away by mistake:
- **Short-interest coverage** is genuinely single-sourced (Finviz Elite export, nightly, sparse, no
  history, and Finviz publishes no terms document at all — `provider-ledger.md` §2 "Short interest"
  row). A second, licensed source here (a FINRA bi-monthly public feed is named as unintegrated and
  unverified, `provider-ledger.md` §5.5) would be **the rare case where adding a vendor reduces
  licensing risk rather than adding it** — worth naming explicitly because it is the exception to
  §15.2's "one vendor per class" rule, not a violation of it. **F-09 confirms this is the one
  class-G gap in its entire ledger where a new vendor plausibly reduces risk rather than adding it**,
  and runs the full ten-question checklist on it: the current column is derivable-by-retention-alone
  for *history* (the nightly Finviz value is simply never retained today), but the *current value*
  itself stays single-sourced against a provider with no terms document at all regardless of
  retention (`provider-master-ledger.md` §5 "Short-interest history" row). F-09's own build-vs-buy
  hypothesis is **INTEGRATE (candidate)** — "worth a dedicated vendor scan (FINRA's public
  bi-monthly release as a free floor, a licensed SI-history vendor as the paid option)"
  (`provider-master-ledger.md` §6 item 7) — and F-09's own open question flags this as the one item
  from its pass most worth a future wave's dedicated attention, ranking it alongside the futures gap
  (§15.2) as the two class-G items where "buy" is a *risk-reducing* move rather than a *scope*
  expansion (`provider-master-ledger.md` open_questions).
- **The bars reconciliation worker** (`bars_reconciliation.py`, 30-minute cycles, diffing SQLite
  against Massive canonical and surgically deleting diverged rows) is redundancy-for-correctness: it
  does not add a second *vendor*, it adds a second *read* of the same vendor to catch write-path
  drift (`CLAUDE.md` "Bars Correctness Layer" section). This is the pattern worth generalizing to any
  canonical data class with a write path prone to drift (§4), not a bars-specific artifact.

**16.3 What this document does not recommend: redundancy as an outage hedge for its own sake.**
Nothing in the source material identifies a documented outage that a second real-time-quote vendor
would have prevented, and adding one would directly multiply the licensing surface (§1.7, §14) for
a benefit this draft has no evidence for. If the streaming/caching domain pod's capacity work
(`domain-streaming-caching.md` §13 item 9, "is there a second Massive **connection**") identifies a
connection-level redundancy need within the *same* licensed vendor, that is a transport decision for
ARCH-07, not a provider-redundancy decision for this document.

---

## 17. Failure Handling

*(Answers: backend capability.)*

**17.1 Three internal patterns are already proven and should be the templates for every adapter
(§3), not re-invented per vendor.**
- **Cached-forbidden state.** When Finnhub's `/stock/upgrade-downgrade` and
  `/stock/transcripts/list` started 403ing "for months," `finnhub_client.py` began caching the
  forbidden state for 24 hours rather than retrying every call
  (`provider-ledger.md` 1B row 6). This is the reference pattern for "a vendor endpoint is
  degraded, not down": stop hammering it, remember the failure for a bounded window, retry on
  schedule rather than on every request.
- **Circuit breaker with silent, logged defaults.** `yf_util.bounded_call` implements "one pool, one
  deadline, one circuit breaker"; a tripped `YFRateLimitError` returns defaults *without* a network
  call and *without* logging by design, with the module's own convention stated as "IMPORT THE
  MODULE, NEVER THE FUNCTION" (`provider-ledger.md` 1B row 12). This is the reference pattern for a
  vendor with a hard rate ceiling: fail fast to a known-safe default rather than blocking a request
  thread.
- **The honest-blank receipt (`CoverageLine`, §13.2).** When a data class cannot be computed for
  part of a request, the failure is reported as a distinct count from "zero results" — never
  silently rendered as "no matches" (`CLAUDE.md` Phase E section). This is the reference pattern for
  partial-failure UI: a coverage gap must never be indistinguishable from a quiet market.

**17.2 The adapter boundary (§3) is where failure handling is enforced structurally, not by
convention.** Each vendor adapter owns its own typed error taxonomy (§3.4); the canonical schema
(§4) and provenance record (§11) carry enough information that a caller can distinguish "this
value is stale because the vendor is degraded" from "this value does not exist" from "this value
was never fetched" — three distinct facts the current ad hoc per-surface error handling frequently
collapses into one.

**17.3 A named gap: Massive's adapter today has no circuit breaker and no token bucket at all**
(`provider-ledger.md` 1B row 1) — the busiest vendor in the estate is the one with the least
failure-handling discipline. This is the highest-priority target for the adapter build sequence
named in §3.6.

---

## 18. Rate-Limit Handling

*(Answers: backend capability.)*

**18.1 Two internal reference implementations exist; every new adapter (§3) should be built on one
of them, not a bespoke throttle.** Finnhub's token bucket + reactive cooldown + WS-yields-to-REST
priority reserve (`finnhub_client.py:44-56`); AlphaVantage's hard daily bucket (25 req/day,
ET-midnight reset, "never sleeps" — `provider-ledger.md` 1B row 7). Both are proven, both are named
explicitly in the provider ledger as the shapes to copy.

**18.2 The gap this section names for the adapter build sequence (§3.6): Massive and FMP, the two
busiest vendors, have neither.** Massive's client is "shared `httpx.Client`, connect 3s / read 25s,
`max_connections=60`... **no token bucket**" (`provider-ledger.md` 1B row 1). FMP's six independent
helpers each have "its own timeout and error policy; a burst in one consumer is invisible to the
others" — there is no shared budget across the six at all (`provider-ledger.md` 1B row 4). This is
the concrete, measurable form of the ACL pattern's payoff (§3): building the Massive and FMP
adapters is, among other things, *building their first rate limiter*.

**18.3 A rate-limit design decision this document flags as PROVISIONAL / OWNER-ADJACENT, not
resolved:** Massive's public plan pages describe per-minute call limits that vary by tier (Basic
limited, paid tiers "unlimited" per `cost-model-data.md` §2.1's re-read), and the *actual* current
plan's limit is unknown pending OI-03(a). A token bucket sized for Massive's adapter should be
configurable, not hard-coded to a guessed limit, so that whichever tier answer lands, the adapter's
rate-limit ceiling is a configuration change, not a code change — this is the same reversibility
principle from §2 applied at the rate-limiter level specifically.

---

## 19. Cost-Awareness

*(Answers: backend capability, and directly cross-references the cost model's own branches so this
document does not re-derive numbers a sibling artifact already owns.)*

**19.1 The cost model's own branch structure is the frame this architecture designs against, not
re-derived here.** Four branches, because the licensing branch — not the member count — is the
first-order cost driver (`cost-model-data.md` §1): **S0** (status quo, individual-tier Massive+FMP,
shown for reference only — not available at scale per Massive's own "customer-facing display, or
200+ users, you'll need a Business plan"); **A-lite** (Massive Stocks Business, delayed price +
live volume + live breadth, no options to members); **A-full** (A-lite + options served
delayed/historically); **B** (A-full + real-time quotes and real-time options tape to members, with
per-member exchange fees passed through). The fixed block across every scaled branch is **$3.5k–
7k/mo** and dominates below roughly 1,000 members; the per-member variable cost is **~$0.55/member/mo**
on a delayed-price design and **~$3.10/member/mo** with real-time pass-through
(`cost-model-data.md` §1, "What the table says in one sentence").

**19.2 This document's role relative to the cost model: name where an architecture decision moves a
cost-model line, without re-modeling.** Three direct links:
- §12.2's "delayed price + real-time volume" design shape is the mechanism that keeps A-lite/A-full
  in the *per-member ~$0.55/mo* range rather than branch B's *~$3.10/mo* — this document's
  freshness-class field (§12.1) is the schema hook the product decision rides on.
- §8.5's options-tape tier choice (historical-only vs. delayed vs. real-time) is a direct line-item
  swing: the OPRA fixed floor ($1,500/mo) applies at delayed and real-time; only historical-only is
  exempt (`cost-model-data.md` §2.3).
- §5.7 and §7.5's scope deferrals (ISIN licensing, corporate-actions beyond splits/dividends) carry
  no cost-model line today because nothing is built yet; naming them here is what keeps a future
  build from silently entering an unbudgeted cost branch.

**19.3 The escalation rule is a design constraint on this architecture's provider-adapter build
order, not only a commercial one.** Any new recurring spend above $250/month, any contract or
subscription signup regardless of amount, and any cost that scales with member count regardless of
amount all escalate to the owner before commitment (`GOVERNING_PRINCIPLES.md` §11). Building an
adapter for a vendor UCT does not yet pay for (as opposed to consolidating adapters for vendors
already paid for) is therefore never a pure engineering decision — §3.6's adapter build sequence
(FMP, then Massive, then smaller vendors) was chosen specifically because it consolidates existing
paid relationships first and adds no new spend.

---

## 20. Observability

*(Answers: observability, and directly generalizes §11.4/§13's provenance-and-evidence-class
insight into a platform requirement.)*

**20.1 `provider_coverage_monitor` and its admin endpoints are the platform primitive; every new
canonical data class inherits an entry, not a bespoke dashboard.** `GET
/api/admin/provider-coverage` (no-auth, read-only) already exposes per-field fill rates against
declared floors for 13 fields; the pattern generalizes directly per §13.1
(`capability-ledger.md` row D12). The provider ledger names seven additional admin endpoints that,
read once, would raise roughly 25 provider rows from CODE-REFERENCED to OBSERVED-CALLED evidence
— `GET /api/admin/bars-stream-status`, `/api/admin/twitter-stats`, `/api/admin/catalyst-stats`,
`/api/ai-search/admin/stats`, `/api/voice/cost`, `/api/logos/status`, `/api/cot/status`, `/api/desk/
sessions-status`, `/api/admin/fundamentals-health`, `/api/admin/reconciliation-status`
(`provider-ledger.md` §7.2). This document recommends every new provider adapter (§3) ship with an
equivalent status endpoint from day one, as a standing convention, so the OC-evidence ceiling this
program itself hit (`provider-ledger.md` §0, "zero rows are CONTRACT-ACTIVE... only FMP and Finnhub
reach OBSERVED-CALLED") does not recur for TERMINAL-NEXT's new integrations.

**20.2 The evidence ladder itself (KP/CR/OC/CA) is worth shipping as a live, queryable field, not a
one-time research artifact.** §11.4 already names this: today it is a markdown convention this
research program invented to describe the estate; there is no reason it could not be a field the
system computes and exposes about itself continuously — "is this integration armed (a Railway flag),
called (a log line in the last N days), and under what plan" — which would make a future audit of
this shape a `GET`, not a multi-day research program.

**20.3 A drop counter nobody reads is not observability.** `domain-streaming-caching.md`'s own
finding applies directly to the data layer: `bars_dropped_total`, `fh_budget_denied_total` and the
bars-stream-status endpoint exist, and "nothing records them being read on a schedule"
(`domain-streaming-caching.md` §13 item 10, citing NATS's own documentation that a quiet drop is
"worse than a crash"). This document adopts the same standard for every adapter's own counters
(§3, §18): a rate-limit-denial counter or a fallback-triggered counter that nobody dashboards is
equivalent to not having it.

---

## 21. Storage Responsibilities

*(Answers: backend capability, data normalization.)*

**21.1 The ~55-SQLite-file estate is a real constraint this architecture designs within, not
around.** No Postgres, no ORM, no migration framework, ~200 `sqlite3.connect` call sites, 286
distinct `CREATE TABLE` names (`database-and-infrastructure.md` §1.1, cited in
`domain-data-platform.md` §4). This is the concrete symptom of §1.5/§4's canonical-model gap. This
document's storage recommendation is scoped, per §4.5: new canonical-schema data classes get a
deliberately-designed store (which may still be SQLite — the constraint is a schema discipline, not
necessarily a database-engine migration); existing files are migrated only when touched for another
reason.

**21.2 `bars.db`'s writer-service / R2-bus / newer-wins-merge pattern is the one proven design for
"more than one process needs to read the same large, frequently-updated dataset" — the direct
precedent for `bars-api`, and the template for any future multi-service data tier.** One writer
(the `worker` service), R2 as the transport bus, and a **newer-wins merge** on every reader (`INSERT
OR IGNORE ... WHERE local has none OR snap.ts > local MAX(ts)`) — with the explicit, locked
invariant "**NEVER re-enable replace-style pull**" after a 2026-05-07 regression that a
replace-style pull caused (`CLAUDE.md` "Bars Freshness" section; `database-and-infrastructure.md`
§1.2, cited in `domain-data-platform.md` §4). Any TERMINAL-NEXT data class that needs to be read by
more than one service (a scenario the estate already has for bars, via `bars-api`) should adopt this
exact shape — one writer, an object-storage bus, newer-wins merge — rather than inventing a new
multi-writer or polling-based sync.

**21.3 Retention is a licensing decision at the storage layer, restated from §10.3 because it is
also a storage-architecture requirement, not only a caching one.** Every store's retention horizon
is declared at design time and its prune job armed to it (`licensing-register.md` §4.2 R-A4-6).

**21.4 A delete primitive exists for every tier, including the browser — this is a storage-layer
architectural requirement, not an afterthought bolted onto a compliance ask.** Vendor exit (a
contract lapses, a vendor terminates, a member churns) is a multi-store engineering project by
construction: the architecture ships an invalidate/delete path per store, plus the client-side
cache-invalidation primitive (§10.2), recorded in a vendor-exit runbook that lists every store by
vendor (`licensing-register.md` §4.2 R-A4-7). This document names it as a required capability of any
new canonical-schema store, not an optional one, because Massive's own "delete all Market Data in
your possession" and FMP's "delete... including data cached" clauses are both live obligations
today regardless of which tier answer lands (`licensing-register.md` §4.6).

**21.5 Processing-location inventory is a storage-adjacent architectural requirement worth naming
explicitly.** FMP's terms require notifying FMP "of the IP and domain aliases of any location where
data is stored or processed" — and nothing in the estate suggests that notice has ever been sent
(`licensing-register.md` §4.2 R-A4-9). Any canonical store's schema documentation should record
*which service* (web, worker, flow-worker, bars-api, the owner's PC, R2, the Brain Pack) holds a
given vendor's data, as a design-time artifact, not a fact somebody would have to reconstruct later.

---

## 22. Derived / Normalized Data

*(Answers: data normalization, licensing/entitlement — this is where UCT's actual competitive
differentiation and its cheapest licensing lane are the same architectural surface.)*

**22.1 The single-security vs. multi-security distinction is the most consequential licensing fact
in the whole data architecture, and the canonical schema (§4) must carry it as a field.** Under
UTP's own Derived Data policy and Cboe's exchange rules, a **single-security price derivation**
(implied move in dollars, an entry/stop/target level, a per-name live percentage change) is
fee-liable in the same way the underlying quote is; a **multi-security derived** product (breadth,
RS rank, sector flow, theme returns) is fee-**free**, independent of the Massive tier question
(`licensing-register.md` §4.2 R-A4-4, §4.7 "Everything derived" row — "the best-margin lane"). A
third bucket, **display of the underlying** (a chart — OHLC values are readable off it, so it fails
the "reverse-engineering" prong by construction) and a fourth, **composite** (§22.2), round out the
four buckets every derived data product's canonical record should be tagged with.

**22.2 UCT's composites — UCT20 NAV, the 0–150 Exposure Rating, published entry/stop/target — are
explicitly a different, unresolved licensing bucket, not automatically covered by the multi-security
free lane.** Massive's own P1 §6.1(j) names "index, indicative value, net asset value... investment
strategy" as a distinct, licensed category, and this stays **Restricted at either Massive tier**
until a specific, written question is answered (`licensing-register.md` §4.1 A12, §4.7 "Real-time
OPRA print" adjacent row, ESC-04 in the escalation ledger). **PROVISIONAL / OWNER INPUT
REQUIRED:** this is not resolvable by architecture — it is a specific written question to Massive
(`licensing-register.md` §2 ESC-04). This document's design implication: the canonical schema's
"composite" bucket exists precisely so this category can be tagged and gated separately from the
free multi-security-derived bucket, rather than the two being conflated because both are
"derived from Massive data."

**22.3 This is the architectural surface where the executive synthesis's own "reorganising fact"
lands.** "The desk's proprietary numbers are the ones its AI cannot cite" and "the market's
untended capability is 'why is it moving,' which UCT already half-answers" are read together in
`DAY_1_EXECUTIVE_SYNTHESIS.md` §1 as the pairing that "every architecture implication in §12
follows from" — this document's §22.1's multi-security-derived-free lane is exactly the technical
mechanism that makes UCT's differentiated derived products (breadth, RS, sector flow, the catalyst
engine's theses) cheap to build and license, while §22.2's composite bucket is exactly the one place
that differentiation runs into a real, unresolved licensing question. Architecturally, this means
**the multi-security-derived lane should be built out aggressively (it is free and it is UCT's
actual moat, per the executive synthesis's own reading of D-13); the composite lane should be built
conservatively until ESC-04 answers**, and the canonical schema's tagging (§22.1) is what makes that
distinction enforceable rather than a matter of remembering which is which per feature.

---

## 23. How the Intelligence Layer Accesses Data

*(Answers: AI-orchestration — explicitly separated from backend capability and UI exposure per
§0's six-question discipline: a data class being served by a backend endpoint does not mean an AI
surface may cite it.)*

**23.1 Prompt eligibility is computed from the same provenance field the renderer uses — this is
the direct payoff of §11's design, applied to the AI layer specifically.** "Map data classes to
prompts as well as pixels": a restricted field that is never displayed but *is* sent to a model is
still an exposure under Anthropic's own §L.1 warranty, which makes UCT warrant it holds the rights
to submit every Input to the Services — meaning every input-side restriction from every other
vendor's terms (FMP's display ban, Finnhub's "derived results" ban, TheFly's text-mining ban, X's
content rules, AlphaVantage's commercial-use definition) re-attaches at the prompt boundary,
regardless of how permissive Anthropic's own terms are (`licensing-register.md` §3C; §4.3 R-A5-1).
The prompt assembler must consult the provenance field (§11.3) and refuse ineligible inputs — this
is a structural gate, not a per-lane discipline someone has to remember.

**23.2 The facts-module-plus-grounding-gate shape is already UCT's own proven pattern; the
architecture generalizes it rather than inventing a citation mechanism from outside.** COT's
`cotFacts.js`/`cot_narrative.py` and `flow_explain.py` both ground a narrative lane on a
deterministic facts object that is the **only** thing the model may cite, with a gate that stores
nothing when a number in the generated prose is not present in the facts object
(`licensing-register.md` §4.3 R-A5-2). This is named as "the cleanest AI surface in the product"
(`licensing-register.md` §3C row X-14c) precisely because its inputs are public-domain (CFTC, SEC
EDGAR) — it is the template, and the recommendation is that every narrative lane over vendor data
be built the same way: ground on **EOD and multi-security-derived** facts (§22.1's free bucket),
never a live single-symbol quote, until the licensing question for that specific input resolves
(`licensing-register.md` §4.3 R-A5-2).

**23.3 The 154-tool shared registry is the existing chokepoint for AI data access — the
architecture should route every new AI-accessible data capability through it, not build a parallel
path.** "One engine, three doors": voice, Compass chat, and the AI-Search agent lane all read from
one tool registry (`api/services/voice_tools.py::_REGISTRY`), with per-lane allowlists rather than
three separate implementations (`capability-ledger.md` row K1). This is directly the shape §25's
prompt-eligibility gate (§23.1) should sit inside: a tool's registry entry is where its provenance
class, its licensing eligibility, and its per-lane allowlist all attach, so a new tool is
automatically eligible or ineligible for a given lane by construction, rather than needing three
separate permission checks written by three separate teams.

**23.4 Copyrighted vendor prose is excluded from prompts until its licence says otherwise — a
standing rule, not a lane-by-lane judgment call.** Transcript bodies (FMP/AV/Finnhub), tweet
bodies, TheFly-origin text, and FRED restricted series stay out of any prompt pending the specific
owner-facing escalations that would clear them (ESC-11, ESC-12, ESC-20, ESC-15 in
`licensing-register.md` §2); social text enters a prompt as ids and counts only
(`licensing-register.md` §4.3 R-A5-3). The summaries UCT already generates from this text inherit
the input's own deletion duties (§21.4) — a generated summary of a restricted transcript is not a
new, unrestricted artifact.

**23.5 No AI output leaves the controlled product without passing the publication chokepoint
(§14.4), and never through the owner's subscription seat.** External distribution of any model
output over vendor data (briefs, a "scan of the day," a newsletter, Discord) grounds on
public-domain / EOD / multi-security-derived facts and passes the one audience gate
(`licensing-register.md` §4.3 R-A5-5). Every AI lane uses the API key, never the Pro/Max
subscription seat, for any member-facing or publicly-consumed artifact — models are never
downgraded for cost; the cost lever is caching and batching, taught to the budget guard
(`GOVERNING_PRINCIPLES.md` §12; `licensing-register.md` §4.3 R-A5-6). **This is already a written
product rule inside the codebase** (`discord_close_note.py:17-25`) that one lane (`uct-recaps`'s
`desk_insights_polish.py`, running on the owner's PC subscription against publicly-consumed
YouTube artifacts) currently violates — named as ESC-17, **PROVISIONAL / OWNER INPUT REQUIRED**
whether to treat it as a doctrine fix now or a compliance fix already due
(`licensing-register.md` §2 ESC-17). **F-09 widens this from one script to at least two**: a second,
independent PC-side task (`uct-recaps`'s `daily_recap.py`, the Live Recap ×3/day job) also shells to
`claude -p` for member-adjacent output rather than using the API key, pulling `PUSH_SECRET`/
`YT_OAUTH_*`/Discord webhook secrets from Railway at runtime — both scripts' own in-file comments
assert the subscription seat, not the API key, is used, and both explicitly disclaim touching the
Anthropic API (`provider-master-ledger.md` §1.1 item 2). This does not change which way ESC-17
should resolve — that is still the owner's call — but it changes the blast radius of either answer:
whatever ESC-17 decides now governs two independent, already-running lanes rather than one, so the
decision is more consequential to make promptly, not more resolvable by this document.

---

## 24. Frontend Access Patterns

*(Answers: UI exposure — explicitly kept separate from backend capability per §0: a canonical
schema existing does not mean the frontend consumes it uniformly yet.)*

**24.1 Today's frontend already has a working, layered access pattern; the canonical schema
changes what flows through it, not the layering itself.** SWR (client-side revalidating fetch) plus
browser IndexedDB (§10.2) for bars specifically; `ChartPane`/`WidgetHost` as the mount boundary
every chart-consuming surface goes through, rather than each surface talking to the backend
directly (`capability-ledger.md` row B2, "17 importers... mount this, not B1 [StockChart
directly]"). This is a real, working precedent for "one shell, many consumers" that the canonical
data model (§4) should extend past charts: a data-access hook per canonical class (a `useQuote`,
`useBar`, `useFundamental` shape, however named) that every widget consumes, rather than each
widget's own SWR call constructing its own request shape against a bespoke endpoint response.

**24.2 What the canonical schema (§4) and provenance field (§11) change for the frontend, concretely:
fewer bespoke response shapes to parse, and a freshness/provenance badge becomes a generic
component instead of a per-surface one-off.** Today, "which vendor answered this" and "how fresh is
this" are answered differently (or not at all) by every surface that happens to need them. Once
every canonical value carries provenance and freshness as fields (§11, §12), a single, shared
freshness/provenance UI primitive (a small badge or tooltip) can render consistently everywhere,
generalizing the honest-blank idiom (§13.2, §17.1) into a visual convention rather than a
per-component decision.

**24.3 This document defers the specific command-surface, workspace, and widget-registry questions
to the Information Architecture workstream, per the program's own six-question separation.** Whether
a data-class-scoped access hook is exposed through a command palette, a widget menu, or a
notebook-embed shape is a UI-exposure and workflow-quality question this document does not answer —
it is the direct subject of the parallel Information Architecture workstream (per
`READINESS_REVIEW_DAY1.md` Part 9 workstream 2), and this document's job is only to make sure that
whatever surface consumes a data class gets a consistent, provenance-and-freshness-carrying value
regardless of which UI it renders into.

---

## 25. API / BFF Responsibilities

*(Answers: backend capability — the layer between the canonical adapters (§3–4) and every consumer:
frontend widgets (§24), the AI tool registry (§23.3), and any external out-of-repo consumer.)*

**25.1 The current router layer already plays a partial BFF role; the adapter boundary (§3) is what
it is currently missing underneath it, not a reason to add a second aggregation layer on top.**
`api/routers/*` (1,187 routes across the estate, `DAY_1_EXECUTIVE_SYNTHESIS.md` §1.7) already sits
between the frontend and the vendors — the gap this document closes is not "add a BFF," it is "give
the BFF layer a real adapter (§3) and canonical schema (§4) underneath it," so router handlers stop
constructing vendor URLs and parsing vendor response shapes directly (§1.3's named debt).

**25.2 Server-side auth on every data route is a Tier-S API responsibility, restated from §14.5
because it is the API layer's own most consequential requirement.** No new TERMINAL-NEXT data route
answers without a session; the SPA's `FREE_PAGES` route guard is a client-side navigation
convenience and does not protect the API (`licensing-register.md` §3B "What the addendum means for
the two scenarios"). A route-table check that fails **by name** on any `/api/*` data route without
an explicit auth dependency — not a manual review — is the recommended enforcement mechanism,
because the "unauthenticated by omission" defect class has already recurred once after being fixed
once (the GEX/dealer-positioning routes, `licensing-register.md` §4.4 R-A6-1).

**25.3 Whether a board-level aggregation endpoint (reducing N per-panel round trips to one) is
worth building is explicitly `domain-streaming-caching.md`'s decision D5, not this document's to
resolve — but this document names the data-layer precondition it depends on.** Aggregation only pays
off if a board's panels share expensive constituents; UCT has already measured a composite-latency
cliff (calendar enrichment cold 17.9s / batch 24.8s) that required a 240-second warmer to hide,
which is a cautionary data point against assuming aggregation is free
(`domain-streaming-caching.md` §12 row D5). This document's contribution: the canonical schema (§4)
and per-class caching tiers (§10) are what make a future aggregation endpoint's constituent fetches
cheap regardless of how D5 is decided — the aggregation decision changes round-trip count, not
whether the underlying data is well-cached.

**25.4 Out-of-repo consumers are a real, named constraint on API contract stability, not a
hypothetical.** `/r/*` render endpoints serve the morning-wire's own Playwright, the Sunday Scan's
server-side PNG generation, and the chart-renderer service — three consumers outside this repository
that a route-shape change would silently break (`capability-ledger.md` row E16, B9). Any canonical
schema change to a data class an out-of-repo consumer depends on needs the same "honour or 301,
never retire silently" discipline the calendar deep-link already follows
(`capability-ledger.md` row E4).

---

## 26. F-09 integration — the A–G taxonomy, class-G gaps, and what remains genuinely open

*(This section replaces the prior draft's "awaiting F-09" placeholder now that
`provider-master-ledger.md` (F-09) has landed and is cited throughout §1, §3, §7, §14–16 above. It
does three things: names the taxonomy this document now assumes a reader recognizes; carries forward
every genuine class-G — missing-from-the-stack — gap F-09 found that is not already fully addressed
in an earlier section; and lists, once, the small residue of specific technical questions F-09's own
per-capability read did not close, so none of them is silently assumed resolved.)*

**26.1 The A–G usage-status taxonomy, adopted.** F-09 restructures the same 48-provider roster this
document already draws on into a capability matrix (48 providers × 17 asset classes from
`GOVERNING_PRINCIPLES.md` §14A) and classifies each provider-capability pair by **usage status**:
**A** currently used (~20 providers, the largest class in a mature product) · **B** configured but
underutilized (6 — e.g. Massive's splits/dividends endpoint exists and is called for other classes,
but `breadth_dividends.py`/`dividends_calendar.py` still route to yfinance, §16.1) · **C** available
through a current provider, not yet consumed (5 — e.g. SEC EDGAR's Form 4/13F, already public-domain
and unused for ownership, §15.2) · **D** duplicative/overlapping (3 — §16.1 above) · **E**
legacy/dormant (12) · **F** licensing unknown, not researched by any leaf (11) · **G** missing from
the stack entirely (9 capabilities, not providers — `provider-master-ledger.md` §3.1). This is a
distinct axis from F-04's own licensing-class vocabulary (§14.1) that this document already uses —
F-09 is explicit that both taxonomies use the letter "A" for unrelated things by coincidence
(`provider-master-ledger.md` frontmatter "Two taxonomies... do not conflate them") and this document
keeps them separate throughout.

**26.2 The nine class-G gaps, and this document's disposition of each — most are already resolved
in an earlier section; three genuinely new ones are named here for the first time.** Per F-09 §3.1
and §5–6:

| Class-G capability | Where this document addresses it | Disposition |
|---|---|---|
| Licensed futures quotes (NQ/ES/RTY/BTC) | §15.2 | BUILD/INTEGRATE candidate — the incumbent (yfinance) is both sole source and worst-licensed; not deferrable the way the other multi-asset gaps below are |
| M&A/spin-off/rights/buyback/ticker-change event calendar | §7.5 | EXTEND — enumerate Massive's `/v3/reference/tickers` family before assuming a new vendor |
| Short-interest history | §16.2 | INTEGRATE candidate — the one gap where a new vendor reduces licensing risk |
| Consensus-revision timeline | new, this section | BUILD (internal) — retain the existing nightly `screener_analyst_pass` snapshot into a time series; zero new vendor, a storage/retention decision only (`provider-master-ledger.md` §6 item 5, citing `licensing-register.md` R-A4-6) |
| Analyst-level (per-broker) estimates | new, this section | DEFER — consensus already covers the median workflow; a per-broker feed is an institutional-grade category the Bloomberg-tier competitive benchmark should inform before any integrate decision (`provider-master-ledger.md` §6 item 6) |
| Whisper numbers (distinct from EW's schedule+rank) | new, this section | REUSE/EXTEND — Massive's implied-move-from-options-chain proxy already computed in production is a reasonable substitute; extend its surfacing rather than buying a whisper-number feed (`provider-master-ledger.md` §6 item 4) |
| Level 2 / order book | §2 (architecture principles, "not a Bloomberg clone") | DEFER — owner default excludes execution/OMS from V1 (`GOVERNING_PRINCIPLES.md` §13); F-09 independently reaches the same conclusion (`provider-master-ledger.md` §6 item 1) |
| Corporate credit / bond quotes / CDS | §2 | DEFER — owner default excludes fixed income from V1; F-09 concurs (`provider-master-ledger.md` §6 item 2) |
| FX / crypto bars + depth | §2 | DEFER — owner default excludes both from V1; F-09 concurs (`provider-master-ledger.md` §6 item 3) |

The three "new, this section" rows are genuinely new coverage this integration pass adds — the prior
draft named none of them. All three are explicitly **hypothesis-not-decision** per F-09's own
Build-vs-Buy framework (`provider-master-ledger.md` §6) and none requires an owner decision to begin:
the consensus-revision timeline is a pure storage/retention change against an already-paid-for FMP
relationship; the whisper-number and analyst-level-estimate gaps are correctly left alone (extend an
existing proxy; defer pending competitive benchmarking) rather than triggering new vendor spend.

**26.3 What remains genuinely open — not resolved by F-09, and not silently assumed.** Three
specific technical questions, already flagged inline where they arise (§4.3, §5.2, §6.2), are
collected here once for visibility:
1. **§4.3 — whether FMP's API exposes XBRL-tag-level granularity per endpoint.** F-09 classifies
   FMP's fundamentals/statements/estimates/earnings capabilities (all class A, fully licensing-
   researched by F-04) but did not re-read FMP's live schema to answer this specific naming
   question — F-09 restructured F-03b's own coverage tables this pass rather than re-verifying every
   endpoint against source code (`provider-master-ledger.md` §2.1 confidence note).
2. **§5.2 — whether Massive/Polygon's reference-data (tickers) endpoint exposes FIGI or another
   permanent identifier.** F-09's capability matrix confirms Massive serves the
   search/reference/symbol class (marked **Y**) but did not check which permanent-identifier scheme,
   if any, rides on that endpoint (`provider-master-ledger.md` §2.1 row 1).
3. **§22.1 — the precise multi-security-derived vs. single-security-derived boundary for specific
   Massive endpoints not yet named row-by-row.** F-09's capability matrix records *whether* Massive
   serves a class (quotes, options, reference data, etc.) but does not carry a single-vs-multi-symbol
   payload-shape column — that licensing-relevant distinction (§22.1) sits inside F-04's clause-level
   register, not F-09's usage-status restructuring, and remains an item for a future capability-level
   API read rather than something either ledger closes on its own.

**26.4 One item deliberately out of scope for this section.** §9.3's edge-caching finding is sourced
to `domain-streaming-caching.md`'s own reading of D-05 and is not a provider-capability fact — F-09
has no bearing on it, noted here only so its absence from §26.3 does not read as an oversight.

---

## 27. NOT INSPECTED, and what this document explicitly defers

- **No application code was read by this pass.** Every claim in this document traces to a cited
  artifact's own citation (path:line where the artifact gives one); nothing here was independently
  verified against the running codebase or a live vendor API. This mirrors the evidence-handling
  convention of every source artifact this document draws on.
- **No web research was performed by this pass.** The standards-body citations (FIGI, W3C PROV,
  OpenLineage, the Anti-Corruption Layer / Canonical Data Model patterns, XBRL, NYSE/exchange
  documentation) are all reused, with attribution, from `domain-data-platform.md` and
  `domain-symbol-master-time.md`'s own fetches — not re-fetched by this pass.
- **The transport, fan-out, conflation, and multi-instance decisions** (streaming architecture
  proper) are deliberately deferred to `domain-streaming-caching.md` and ARCH-07 throughout; this
  document states only the data-layer interface those decisions must honor (canonical schema
  transport-agnosticism, provenance/freshness fields surviving any transport).
- **The Information Architecture / command-surface / workspace questions** are deliberately
  deferred to the parallel IA workstream (`READINESS_REVIEW_DAY1.md` Part 9 workstream 2) per §24.3.
- **F-09's Provider Master Ledger is now integrated throughout this document** (§1, §3, §7, §14–16,
  §26); its own inherited evidence ceiling (no vendor contract, order form, invoice or console seen
  by any leaf; the Massive tier and FMP DDLA remain the two owner facts that move roughly two-thirds
  of the licensing column) is unchanged from F-04's and is restated in this document's own frontmatter
  rather than re-derived. F-09's own NOT INSPECTED list — executed agreements of any kind; vendor
  account dashboards/invoices/plan pages; any vendor API; production services and the production
  `/data` volume; the local backend on port 8077; `C:\data`; partner-owned files beyond
  existence/mounting; several named vendor legal pages that 403/404'd; the test suites; `git`; a
  second machine for the Discord bot, if one exists — is inherited by this document unchanged
  wherever it draws on F-09 (`provider-master-ledger.md` §7 "NOT INSPECTED"). The small residue of
  specific technical questions F-09's own per-capability read did not close is listed once, in place,
  in §26.3 — not silently assumed resolved.
- **No owner input was solicited or assumed answered by this pass.** Every item in §29 below is
  genuinely open in the source corpus, not resolved here under a plausible guess.

---

## 28. Summary table — this document's core recommendations at a glance

| Area | Recommendation | Depends on owner input? |
|---|---|---|
| Provider abstraction (§3) | One ACL adapter per vendor; `finnhub_client.py` is the template; FMP first, Massive second | No — proceed now |
| Canonical schema (§4) | One schema per data class, new classes first, existing files migrate opportunistically | No — proceed now |
| Symbol/entity master (§5) | Internal permanent entity id + dated ticker-alias history; FIGI's *property*, not necessarily its code, as the design reference | No — proceed now; identifier choice should weigh licensing (§5.3) |
| Time / market clock (§6) | Keep session-anchored earnings model; adopt a versioned calendar dataset if a true open/closed indicator is ever needed | No |
| Corporate actions (§7) | Adjustment as a labelled policy; three-state pipeline (detected/confirmed/applied); M&A-class events explicitly deferred (D8) | No |
| Historical/real-time split (§8) | `bars-api` is the decoupling template; sealed-URL immutability for finished series; retire Finnhub tick stream onto Massive | No |
| Polling/streaming (§9) | Keep pooled SSE; canonical schema is transport-agnostic; defer mechanics to ARCH-07 | No |
| Caching (§10) | Generalize the 3-layer bars cache per data class; every store declares a retention horizon | No |
| Provenance (§11) | Generalize `bar_provenance.py`'s shape (PROV/OpenLineage-style fields) to every canonical class | No |
| Freshness (§12) | Freshness class as a first-class field; "delayed price + real-time volume" as a designed product shape | No (the *shape* proceeds; *shipping* a delayed design to members is a product call downstream) |
| Confidence/quality (§13) | Generalize `provider_coverage_monitor` and `CoverageLine` per canonical class | No |
| Licensing metadata (§14) | Licensing class computed from provenance, not remembered; server-side auth Tier S; audience-gated publication chokepoint | Partially — the *mechanism* proceeds now; the *default class* assumed (Individual/no-DDLA) is OI-03(a)/(b)-bound |
| Fallback/routing (§15) | One licensed vendor per data class in any member path; retire the seven named candidates | No |
| Redundancy (§16) | Redundancy only where licensing-risk-reducing or correctness-verifying; not as an outage hedge | No |
| Failure handling (§17) | Generalize the cached-forbidden, circuit-breaker, and honest-blank patterns | No |
| Rate limiting (§18) | Generalize the token-bucket pattern; Massive and FMP adapters need one built, configurable to the tier answer | No (mechanism); tier value is OI-03(a) |
| Cost (§19) | Architecture decisions link explicitly to the four cost-model branches; no new spend without escalation | Yes — the branch choice (S0/A-lite/A-full/B) is a product/commercial decision |
| Observability (§20) | Every adapter ships a status endpoint; the evidence ladder becomes a live field | No |
| Storage (§21) | `bars.db`'s writer/bus/merge pattern is the multi-service template; delete primitives are required, not optional | No |
| Derived data (§22) | Multi-security-derived is the free, differentiated lane to build aggressively; composites need ESC-04 before a new publication surface | Yes — ESC-04 (composite licensing) |
| AI data access (§23) | Prompt eligibility computed from provenance; facts-module + grounding-gate is the standard shape; API key only, never the seat | Partially — ESC-17 (the seat lane) |
| Frontend access (§24) | Extend `ChartPane`'s "one shell, many consumers" shape past charts | No |
| API/BFF (§25) | Router layer keeps its shape; Tier-S auth is mandatory; aggregation is ARCH-07's call | No |

---

## 29. Index of PROVISIONAL / OWNER INPUT REQUIRED items in this document

Per this task's contract, every owner-bound item touching this document is listed here, once, so
none is silently decided. None of them blocks the architectural recommendations above — each is
designed to remain reversible regardless of how it resolves (§2).

- **OI-03(a) — the Massive plan tier.** Assumed Individual throughout this draft
  (`licensing-register.md` §4.1 A2). Moves 38 licensing rows; does not change the adapter, schema,
  or symbol-master designs, only the licensing-class values computed from provenance (§14.2) and
  the rate-limiter's configured ceiling (§18.3).
- **OI-03(b) — the FMP Data Display and Licensing Agreement.** Assumed absent throughout this draft
  (`licensing-register.md` §4.1 A3). Moves 19 licensing rows.
- **ESC-03/ESC-04 — whether the Massive Business grant reaches Derived Works, and whether UCT's
  composites (UCT20 NAV, Exposure Rating, entry/stop/target) are licensed "derivative works" under
  §6.1(j).** §22.2. This is a specific written question to Massive that architecture alone cannot
  answer.
- **ESC-06/OI-17 — whether the unauthenticated data endpoints are deliberate or unintended.**
  §14.5, §25.2. This draft assumes unintended and designs Tier-S auth as a requirement either way,
  per the licensing register's own reading that "either answer keeps the rule for Terminal-Next"
  (`licensing-register.md` §4.1 A5).
- **ESC-17 — whether the owner's Anthropic subscription seat lane is a doctrine fix or a compliance
  fix already due.** §23.5. F-09 widened this from one confirmed consumer (`desk_insights_polish.py`)
  to two (`daily_recap.py` also confirmed, `provider-master-ledger.md` §1.1 item 2) — the decision
  itself is unchanged, but it now governs two independently-running lanes.
- **D5 (product-strategy) — member-facing data-licensing posture, gated on OI-03(a)/(b).** This
  document designs the *mechanism* (provenance-computed licensing eligibility, §14.2) so that
  whichever way D5 resolves, the architecture does not need to change — only the class values the
  mechanism computes.
- **The commercial/cost branch (S0/A-lite/A-full/B, `cost-model-data.md` §1).** §19.3. A product and
  commercial decision this document names the architectural consequences of but does not make.
- **OI-06 (the observed desk morning) and D9 (decisiveness for two audiences).** Neither is
  load-bearing for this specific document's recommendations — both are named in the Readiness
  Review as bounding the *workspace* and *command-grammar* decisions (a different workstream), not
  the data/provider architecture. Named here only to confirm this document does not silently rest
  any recommendation on either.
- **OI-08 (Bloomberg access) and OI-18 (Gödel trial).** Not load-bearing here; every benchmark
  citation this document makes traces to a dossier's own already-fetched, evidence-tiered finding,
  never to a claim that would need a live seat to verify (per the Readiness Review's own Category D
  classification of these two items, `READINESS_REVIEW_DAY1.md` Part 3).
- **The telemetry queries (`page_views`, `calendar_seen`, `calendar_alerts_fired`, `ai_search_log`,
  and a `charts_workspace_layout` distribution query).** Not load-bearing for this document; named
  in the source material as bounding commercial and IA decisions, not the provider/data layer.

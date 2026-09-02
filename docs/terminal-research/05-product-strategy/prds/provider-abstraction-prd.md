---
id: PRD-D1-PROVIDER-ABSTRACTION
title: Provider Abstraction Layer — Product Requirements Document
role: Phase 3 deliverable — PRD/functional specification for a LOCKED data-platform system (specification, not implementation)
phase: 3
group: product-strategy
category: prd
scope: >
  data-platform D1 from product-architecture.md's 32-system decomposition ("Provider Abstraction —
  one ACL per vendor"). NOT decision-register item D1 (the workspace-model decision) — that is a
  naming collision in the source documents (product-architecture.md §4.2 vs.
  ARCHITECTURAL_DECISION_REGISTER.md). This document always writes "data-platform D1" or "the
  Provider Abstraction Layer"; it never writes bare "D1" without one of those qualifiers.
confidence: >
  🟡 overall — 🟢 wherever a requirement restates a cited row/section from an accepted Phase 1/2
  artifact verbatim; 🟡 wherever this document composes two or more source artifacts into one
  requirement; 🔴 on every item carrying a PROVISIONAL / OWNER INPUT REQUIRED marker (all inherited
  from Phase 2, none newly introduced here).
evidence_ceiling: >
  This document read no application source and fetched nothing external. Every technical claim is
  cited to data-architecture.md, product-architecture.md, capability-infrastructure-matrix.md,
  capability-ledger.md (row ids), the Architectural Decision Register, or GOVERNING_PRINCIPLES.md.
  It inherits, unchanged, every evidence ceiling those documents already carry: no vendor contract,
  order form, or console was seen by any leaf in the program; the Massive plan tier (OI-03a) and the
  FMP Data Display and Licensing Agreement (OI-03b) remain unconfirmed; provider "liveness" tops out
  at OBSERVED-CALLED for two vendors (FMP, Finnhub) and CODE-REFERENCED for the rest — zero rows
  anywhere are CONTRACT-ACTIVE; no production telemetry exists for any adapter's real-world traffic
  shape. Where this document sets a default (e.g., "assume Massive Individual tier"), it is the same
  default data-architecture.md §1.2/§29 already commits to, not a new one.
sources: >
  12-decisions/ARCHITECTURAL_DECISION_REGISTER.md (D4) · 07-technical-architecture/data-architecture.md
  (§1, §2, §3, §4, §11–§23, §26, §28, §29) · 05-product-strategy/product-architecture.md (§3, §4.2, D1
  system block in §5-D, boundary matrix §8, reversibility ledger §10) · 05-product-strategy/
  capability-infrastructure-matrix.md (D1 row, §6) · 01-existing-system/capability-ledger.md (rows
  O6, P3, D2, D12, A1, A3, A10, A12, A13) · 00-program-control/GOVERNING_PRINCIPLES.md (§13, §14A, §9,
  §6, §11, §12) · 13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md (§8, §9)
status: draft — Phase 3 deliverable, awaiting review
date: 2026-09-02
provisional_markers: >
  OI-03(a) Massive plan tier · OI-03(b) FMP Data Display and Licensing Agreement · D5 (product-
  strategy) member-facing data-licensing posture · ESC-03/ESC-04 Massive Derived Works reach ·
  ESC-06/OI-17 unauthenticated-endpoint intent · ESC-17 Anthropic subscription-seat lane. None of
  these block this PRD or the system it specifies — every mechanism below is designed to be correct
  under either answer (see §13 "Provisional items and how this PRD stays correct under either
  answer").
---

# Provider Abstraction Layer — Product Requirements Document

**North Star anchor.** This PRD exists because "the strongest ideas... combined with... our existing
provider and API estate" (the North Star, verbatim) cannot happen while that estate has no
abstraction boundary. Every one of the fourteen application systems in product-architecture.md's
decomposition (A1–A14) reads vendor data through this layer or a layer built on top of it (D2, D4).
A differentiated terminal experience that is unreliable, silently mis-licensed, or unable to survive
a single vendor's outage is not differentiated — it is fragile in a new UI. This system is
infrastructure *for* the Terminal, not infrastructure for its own sake: it is named in the
Architectural Decision Register as **D4 — LOCKED**, and the Readiness Review calls it, alongside the
Entity Master, "the two clearest infrastructure gaps the research found" (`READINESS_REVIEW_DAY1.md`
Part 5). Nothing in this document proposes a new vendor, a new asset class, or work beyond
consolidating an estate UCT already pays for.

---

## 1. Required traceability chain

Per this task's contract, stated explicitly and concretely — not implied.

**ORIGINAL USER/PRODUCT NEED.** A desk trader or member loading a security expects every number on
screen to be *right*, to say where it came from, and to keep working when one vendor has a bad day —
without the product ever mistaking "a vendor is quietly broken" for "the market is quiet." This is
not one workflow; it is a precondition every workflow in the North Star's capability list (market
data, fundamentals, news, options, screening...) silently depends on.

**TARGET UCT TERMINAL WORKFLOW.** Every LOAD → READ step of the primary interaction loop
(product-architecture.md §2.1, states 2–3): a member loads a security or a board, and every panel
that re-targets — quote, chart, fundamentals, estimates, news, flow, ownership — pulls its value
through exactly one path per vendor, with a known freshness class, a known licensing eligibility, and
a distinguishable "stale / does-not-exist / never-fetched" state. This is also the precondition for
DECIDE (state 4): `grade_ticker`'s verdict and any AI-authored sentence about a desk number can only
be as trustworthy as the data it was assembled from.

**PRODUCT CAPABILITY.** "Provider abstraction where required for reliability" — named explicitly in
the North Star's own capability list, and "data provenance/freshness" immediately beside it in the
same list.

**EXISTING UCT CAPABILITY (cited, not paraphrased).** UCT already has one proven, working instance of
this pattern and several partial ones — this system generalizes what exists, it does not invent a new
idiom:
- **Stripe integration (`api/services/stripe_service.py`)** — capability-ledger row **P3**: *"the one
  true provider abstraction"*, one chokepoint, everything else in the codebase leaves Stripe alone.
- **`finnhub_client.py` and `alphavantage_client.py`** — capability-ledger row **O6** ("Latency
  infrastructure"): a token bucket + reactive cooldown (Finnhub) and a hard daily bucket (AlphaVantage,
  25 req/day, ET-midnight reset), cited as *"the most valuable code in `api/`."*
- **Six independent, uncoordinated `_fmp_get` implementations** — capability-ledger row **D2**
  (Fundamentals/statements): `routers/fundamentals.py:111`, `catalyst/analyst_actions.py:96`,
  `earnings_estimates.py:344`, `transcript_indexer.py:25`, `insider.py:89`,
  `research/financial_history.py:38` — no shared budget, no shared timeout policy, no shared error
  taxonomy (tech-debt TD-29).
- **20+ modules constructing `api.massive.com` URLs directly**, outside the one intended client class
  (`_MassiveRestClient` at `massive.py:76`) — capability-ledger rows **A1, A3, A12, A13** all name this
  same underlying client; the busiest vendor in the estate has *no token bucket at all*.
- **`provider_coverage_monitor`** — capability-ledger row **D12**: a per-field fill-rate floor + self-
  heal + alert-on-change pattern, "a platform requirement for any new provider lane," already running
  in production (13 fields measured against ~20 data classes).

**GAP.** Two vendors carry roughly 20 of 29 derived data products between them (Massive rows 1–3;
FMP's spine) and neither has the shape Stripe, Finnhub, or AlphaVantage already prove works
(`data-architecture.md` §1.2, §1.3). The FMP debt is six duplicate client implementations sharing
nothing; the Massive debt is 20+ modules each free to construct a URL, translate a symbol, or absorb
a failure differently, with no rate limiter anywhere in the path. A dead or degraded vendor today
reads to a caller as an empty result — indistinguishable from "no news today" — because no shared
error taxonomy exists to say otherwise (TD-29, the "never raises" anti-pattern). No canonical record
carries its own vendor-of-origin as a field, so licensing eligibility is something a developer has to
*remember* per surface rather than something the system can compute (`licensing-register.md` R-A4-1).

**PROPOSED SYSTEM.** **Data-platform D1 — Provider Abstraction Layer**: exactly one adapter module per
vendor, owning transport, rate limiting, a typed error taxonomy, symbol translation, response shaping
into the canonical model, and licensing-eligibility annotation as a field on every value returned —
the Anti-Corruption Layer pattern, LOCKED as decision D4, using the FMP-helper consolidation as the
first proof case (`ARCHITECTURAL_DECISION_REGISTER.md` D4; `data-architecture.md` §3).

**DATA/PROVIDER REQUIREMENTS.** §5 below.

**UX/INTERACTION REQUIREMENTS.** §6 below — this system has no member-facing UI of its own; its
"interaction" is an engineering contract, and §6 states exactly what it is and what downstream
UI/UX behavior it structurally enables (and does not itself render).

**TECHNICAL REQUIREMENTS.** §8–§12 below.

---

## 2. What this system is, restated from the locked architecture (not redesigned)

This PRD does not re-litigate decision D4 or redesign product-architecture.md's D1 system block. It
specifies it precisely enough to build. Restated verbatim in substance from
`product-architecture.md` §5-D:

- **Responsibility.** Exactly one adapter module per vendor, owning retries, timeouts, budget, error
  taxonomy, symbol/field translation into the canonical model, and a coverage floor; fallback order
  expressed as data, not control flow.
- **Answers two of the architecture's six questions, and only two:** (a) data availability, made
  honest; (b) normalization at the vendor boundary. It does **not** answer (c) backend capability for
  *derived* computation, (d) UI exposure, (e) workflow quality, or (f) intelligence orchestration —
  those belong to D2 (Canonical Data Model), D4 (Caching & Serving), S8 (Provenance rendering), S9
  (Entitlements), and I1 (Intelligence Layer) respectively.
- **Inputs.** Vendor responses; the Entity Master (S3) for symbol mapping; the Canonical Data Model
  (D2) for the target schema each adapter shapes into.
- **Outputs.** Canonical records, each carrying a provenance row; budget and coverage telemetry.
- **Ownership boundary.** The vendor boundary — and never business rules or orchestration in the
  layer (the ACL pattern's own documented constraint, `data-architecture.md` §3.1, citing the Azure
  Architecture Center).
- **Must NOT own** (verbatim, product-architecture.md §5-D D1): a fallback chain expressed in control
  flow rather than data; a "never raises" wrapper that makes a dead provider read as a quiet market
  (TD-29); any second Polygon-family vendor (a standing rule, provider-ledger §4 #2); the retirement
  *decisions* themselves (F-09's A–G taxonomy under DL-022 is outside this system — this system
  builds the seam retirements execute through, it does not decide what retires).
- **Boundary-matrix edges** (product-architecture.md §8): D1 may call S3 (●) and D2 (●); nothing else.
  Applications may **never** call D1 directly — the matrix marks Applications✗D1 explicitly, with the
  stated reason: *"no application calls a vendor... it asks D2/D4, which asks D1."* D3 (Streaming) and
  D4 (Caching) and D5 (Reference data) each call D1 (●) for their own vendor sockets. This is the
  single most load-bearing boundary rule in this PRD: **an application importing a vendor SDK or
  constructing a vendor URL is a defect**, not a style preference.

---

## 3. Who this system is for

D1 has no member-facing or desk-facing user in the ordinary product sense — it is Platform-Core
infrastructure (data-platform tier, per product-architecture.md §4.2), consumed exclusively by other
systems and by the engineers who build them:

- **Every application system (A1–A14) and E1**, indirectly, through D2/D4 — none may call it directly
  (§2 boundary rule).
- **D2 (Canonical Data Model)**, directly — D1's output is D2's input; D2 is where the canonical
  schema and the per-ticker history join live.
- **D3 (Realtime Streaming), D4 (Caching & Serving), D5 (Reference & Corporate-Actions Data)** —
  each routes its own vendor sockets through D1's adapters.
- **S9 (Entitlements & Licensing Gate)** — computes publish/display/prompt eligibility by reading the
  provenance field D1 stamps on every value (§7 below).
- **I1 (Intelligence Layer)** — checks the same provenance field for prompt eligibility before any
  value reaches a model (`data-architecture.md` §23.1).
- **Engineers building or retiring a vendor integration** — the direct, hands-on user of this
  system's contract; every workflow in §4 is written from this person's point of view, because D1's
  entire purpose is to be the thing an engineer reaches for instead of writing a seventh `_fmp_get`.
- **Staff/admin, indirectly** — through the coverage and observability surfaces this system is
  required to ship (§11).

---

## 4. Problem being solved

Stated as five concrete, evidenced failure modes this system exists to close — not as an abstract
architecture goal:

1. **A dead vendor reads as a quiet market.** No shared error taxonomy today means a failed or
   throttled call frequently returns an empty result indistinguishable from "nothing happened" —
   named explicitly as the anti-pattern this system's "must not own" list forbids (`TD-29`;
   `product-architecture.md` §5-D D1).
2. **The busiest vendor in the estate has no rate limiter.** Massive's shared `httpx.Client` has *no
   token bucket at all* (`provider-ledger.md` 1B row 1, cited in `data-architecture.md` §17.3, §18.2)
   — the vendor carrying 20 of 29 derived data products is the one with the least failure-handling
   discipline in the whole stack.
3. **One vendor relationship, six uncoordinated client implementations.** The six independent
   `_fmp_get` helpers each have "its own timeout and error policy; a burst in one consumer is
   invisible to the others" (`data-architecture.md` §18.2; capability-ledger row D2, TD-29) — FMP is a
   single paid relationship with no single point that knows its aggregate call volume.
4. **A symbol-translation fix applied once leaks everywhere else.** `to_polygon_symbol()`'s
   `BRK-B`→`BRK.B` rewrite "leaks to 41 call sites / 15 modules" because nothing enforces that every
   caller goes through it (`data-architecture.md` §5-B.3 in product-architecture.md; provider-ledger
   1B row 1) — the same translation problem will recur for every new vendor added without an adapter
   boundary.
5. **Licensing eligibility is a fact a developer has to remember, not a fact the system can compute.**
   No canonical value carries its vendor-of-origin as a queryable field today; the licensing register's
   own architectural rule (R-A4-1, "provenance is a field, not a memory") names this as the structural
   fix a licensing audit currently cannot get without re-reading source per surface
   (`data-architecture.md` §3.4, §14.2).

None of these five is hypothetical: each is cited to a specific file, row, or named debt item in the
accepted Phase 1/2 corpus, not invented for this PRD.

---

## 5. Data / provider requirements

**5.1 In scope: the existing 48-provider estate, not a new vendor.** Per `GOVERNING_PRINCIPLES.md`
§14A/DL-022, this system's entire data requirement is served by providers UCT already has a working
relationship with — the mandate is to abstract them, not to add to them. F-09's A–G usage-status
taxonomy classifies ~20 providers class A (currently used, the class this system's adapters wrap
first), 6 class B (configured, underutilized — an adapter should surface these, not add a vendor for
them), 5 class C (available through a current provider, unconsumed — same rule), 3 class D
(duplicative — this system's adapter boundary is precisely what makes retiring the losing leg a
one-file change, `data-architecture.md` §16.1), 12 class E (legacy/dormant, retirement candidates),
11 class F (licensing unresearched — the adapter must not assume these are eligible until F-04
resolves them), and 9 class G (missing entirely — **out of scope for this system by construction**; a
class-G gap is a new-vendor decision belonging to F-09/DL-022's own process, never something this
system's build should quietly solve by wrapping a vendor nobody chose).

**5.2 Adapter build sequence — a recommendation this PRD adopts, not a new decision.**
Per `data-architecture.md` §3.6 and the provider ledger's own retirement queue, build in this order:

| Order | Vendor | Why first/second (evidence) | What retires into it in the same motion |
|---|---|---|---|
| 1 | **FMP** | Six uncoordinated `_fmp_get` helpers across 28 modules, ~45 endpoints, no shared budget (§4 item 3) — worst debt-to-effort ratio, and the LOCKED decision's own named proof case (`ARCHITECTURAL_DECISION_REGISTER.md` D4) | The six helpers collapse into one module; nothing else in the codebase constructs an FMP URL afterward |
| 2 | **Massive** | 20+ modules, no token bucket, the spine of the whole estate (§4 item 2) — highest blast radius, so it follows a proven-in-repo pattern from adapter #1 rather than being the first attempt | `_MassiveRestClient` (`massive.py:76`) becomes the sole caller; Polygon-direct (F-09 class D, a straight duplicate) retires onto this adapter as its second, immediate consolidation |
| 3+ | **Smaller vendors, as touched** | Finnhub (already close to the target shape — `finnhub_client.py` is the internal reference implementation, not a rebuild target), AlphaVantage (same — already the second internal precedent), SnapTrade (already typed-error-shaped — the third internal precedent), then the remaining retirement queue (Bullflow, Unusual Whales, ForexFactory, yfinance where a member-facing path is involved) | Each retirement becomes a routing-table change inside its adapter, not a call-site sweep |

This is a sequencing recommendation per D4's own framing, not a mandate (`data-architecture.md` §3.6)
— an engineering-priority call, reversible if a different vendor's debt proves more urgent once
building begins.

**5.3 What every adapter must serve, concretely, per vendor (`data-architecture.md` §3.4):**
transport (base URL, auth, connection pool, connect/read timeout, retry/backoff); rate limiting (a
configurable token bucket — never hard-coded to a guessed limit, per §18.3, because the Massive tier
answer, OI-03a, is still open); a typed error taxonomy (minimum four classes: auth, rate-limited,
transient, not-found — the SnapTrade client's five-exception shape is the internal precedent to
match, capability-ledger CLAUDE.md broker section); symbol translation into the canonical form at the
boundary only; response shaping into the canonical schema (D2) at the boundary only; and a
licensing-eligibility annotation on every returned value as a field (§7).

**5.4 What this system explicitly does not need new data for.** Every capability named in the North
Star's list that reads as "we don't have a provider for X" — per-broker analyst estimates, licensed
futures quotes, an M&A/spin-off event calendar, short-interest history — is a class-G finding that
belongs to F-09's own disposition (`capability-infrastructure-matrix.md` §6; `data-architecture.md`
§26.2), not a requirement on this system. This system's job is finished the day every class-A/B/C/D
capability is served through exactly one adapter per vendor; a class-G gap closing is a *different*
program decision that, if and when it happens, simply gets one more adapter added to this same
pattern.

---

## 6. Interaction / UX requirements

**6.1 This system has no member-facing or desk-facing UI, by design — stated explicitly so no
implementer invents one.** Per the six-question discipline (product-architecture.md §0), D1 answers
only (a) and (b); it does not answer (d) UI exposure. The Provenance & Freshness renderer (S8) and
the Entitlements gate (S9) are the systems that turn D1's fields into anything a person sees. This
PRD's "interaction requirements" are therefore the **engineering contract** other systems and
engineers interact with, plus the **specific downstream UI/UX behaviors this contract structurally
enables** — restated here so an implementer of A3, A9, or any other application knows exactly what to
expect from D1 and what remains someone else's job.

**6.2 The consumption contract (the primitives every consuming system calls), verbatim from the
locked architecture:**
- `adapter(vendor).fetch(dataClass, entity, params) → canonical + provenance` — the one call shape
  every consuming system (D2, D3, D4, D5) uses; no vendor-specific method names leak past the adapter.
- `budget(vendor)` — current rate-limit/cost-budget state for that vendor, readable by the caching
  layer (D4) and by observability (§11) without re-implementing the adapter's internal accounting.
- `coverage(vendor, field)` — per-field fill-rate state, the same shape `provider_coverage_monitor`
  already proves (capability-ledger row D12), generalized per vendor and per data class.

**6.3 What D1 structurally enables downstream (owned by other systems, not built here — named so
implementers of those systems know the field exists to consume):**
- **The honest-blank receipt (`CoverageLine`'s four-count idiom, generalized as S8's job).** D1's
  typed error taxonomy (§9.2) is what makes "evaluated · answered · dropped · not computable" a fact
  S8 can render rather than infer — without D1's distinguishable failure states, S8 cannot tell "the
  vendor is down" from "there is genuinely nothing here" (`data-architecture.md` §17.2).
- **The freshness badge and delayed-data notice (owned by S8/S10, per product-architecture.md).** D1
  stamps the freshness-class field (§7.2); rendering the "Data Delayed 15 minutes" notice where that
  class requires it is S10/S8's job, triggered by a field D1 supplies.
- **Publication/prompt eligibility (owned by S9/I1).** D1's provenance field is the input; the
  eligibility *decision* and its enforcement belong to S9 (display/export) and I1 (prompt assembly)
  respectively (§7).
- **Symbol resolution consistency (owned by S3, consumed here).** D1's adapters read S3 for the
  canonical entity id when they translate a vendor's dialect; D1 does not resolve identity itself
  (§2's Ownership boundary).

**6.4 The one interaction rule that binds every other system's implementer.** Per the boundary matrix
(§2), an application system that needs vendor data calls D2 or D4 — never D1 directly, and never a
vendor SDK or a raw HTTP call to a vendor's domain. This is enforced structurally (§12.1), not by
convention.

---

## 7. Provenance & freshness expectations

**7.1 Every canonical record D1 returns carries a provenance record, not a "source" string.**
Following W3C PROV / OpenLineage's Entity/Activity/Agent shape, generalized from UCT's own
`bar_provenance.py` (currently the only working instance, scoped to bars, `data-architecture.md`
§11.3): a source-activity reference (which adapter/job/run produced this value), a source-entity
reference (which upstream vendor payload it came from), a timestamp distinct from the value's own
as-of date, and — where more than one vendor can answer the same field — an explicit, queryable
tie-break record (generalizing FMP's `_earn_row_preferred`, currently a silent per-function decision,
§4.3 in `data-architecture.md`).

**7.2 Every price-shaped value carries a freshness class as a field, not an implicit property of
which endpoint answered.** Four classes: **real-time · delayed-15 · end-of-day · historical**
(`licensing-register.md` R-A4-2, `data-architecture.md` §12.1). This field is what a delayed-data
renderer keys off of to decide when the UTP/CTA-required delayed-data notice must show — a
requirement this system's field makes possible, not one it renders itself (§6.3).

**7.3 The evidence-strength ladder is a live field this system exposes, not a one-time research
artifact.** KP (KEY-PRESENT) → CR (CODE-REFERENCED) → OC (OBSERVED-CALLED) → CA (CONTRACT-ACTIVE) —
currently a markdown convention this research program invented to describe the estate
(`provider-ledger.md` preamble); this system is required to make it a queryable field per adapter so
"is this integration armed, called, and under what plan" becomes a `GET`, not a future research
program (`data-architecture.md` §20.2). Confidence/data-quality and licensing evidence-class share
one vocabulary on the provenance record, per §13.3's explicit recommendation — they are not two
systems that happen to look alike.

**7.4 Retention and restatement are named, not assumed.** Where a value can later be restated
(e.g., a corrected fundamentals line), the provenance record's timestamp and tie-break fields are
what let a consumer distinguish "the value changed" from "the vendor disagreed with itself" — this is
carried explicitly with a noted evidence ceiling in `data-architecture.md` §7.5/§21, and this PRD does
not resolve the point-in-time-retention question further than that document already does.

---

## 8. Entitlement / licensing considerations

**8.1 Licensing eligibility is computed, not remembered — this is D1's single most consequential
architectural payoff.** Because every value carries its provenance field (§7.1), display eligibility,
prompt eligibility, export eligibility, and cache-deletion scope are all a **lookup against the
licensing register's class table keyed by (vendor, data-class, audience)**, evaluated at the point of
use, rather than a fact a developer has to remember when building a new surface
(`data-architecture.md` §14.2, R-A4-1). This converts "did anyone check the licensing here" from a
code-review question into a structural guarantee.

**8.2 The licensing-class vocabulary this system's fields must support** (unchanged from
`licensing-register.md`, not re-invented here): **A** (Allowed) / **LA** (Likely Allowed, verify
contract) / **R** (Restricted) / **U** (Unknown) / **X** (Unsuitable, no purchasable remedy — reached
today only by yfinance, TheFly-direct, and model training on X/Reddit content). A member-facing
adapter simply does not construct a client for an X-class vendor, full stop — enforced at the adapter
boundary, not left to every call site to remember (`data-architecture.md` §15.3).

**8.3 F-09's access-vs-rights split is the concrete rule this system's provenance field must never
blur.** An evidence-ladder status of OBSERVED-CALLED (a working key returns data) is *never* itself a
licensing answer — "does the integration work" and "may UCT do X with what it returns" are separate
questions the provenance-plus-licensing-lookup mechanism must keep separate for every vendor
(`data-architecture.md` §14.7, citing `provider-master-ledger.md` §4's worked table for Massive, FMP,
Finnhub, yfinance, Finviz Elite, and Schwab specifically).

**8.4 Default assumptions this PRD inherits, explicitly, pending owner input — PROVISIONAL / OWNER
INPUT REQUIRED.** This document does not resolve OI-03(a) (Massive plan tier) or OI-03(b) (FMP DDLA
existence); it designs the mechanism so that whichever way each resolves, no adapter code changes —
only the licensing-class *values* the lookup returns change (`data-architecture.md` §14.1's
Reversibility principle, §29). Until answered: Massive is assumed **Individual tier** (no Edge Users
grant, no `store` right, Derived Works barred) and FMP is assumed to have **no DDLA**
(`licensing-register.md` §4.1 A2/A3). Every member-facing data class this system serves stays
Restricted-pending-contract under decision D5, which is explicitly not this document's or this
system's to resolve.

**8.5 Server-side authentication on every route this system's output eventually reaches a member
through is Tier S, not this system's own gate to build — but its adapters must never assume it
exists.** Per `data-architecture.md` §14.5/R-A6-1, three unauthenticated production routes already
return live vendor data (`OQ-15`, a production finding reported for normal remediation, not fixed by
this research program). This system's requirement is narrower and unconditional: an adapter's
canonical output must be gated by whatever route serves it, and this system does not itself decide
whether that gate exists — that is S9's and the route layer's responsibility.

**8.6 Per-member cost is visible at this system's design time.** Any adapter reaching a real-time
single-symbol quote, a real-time OPRA print, or an option chain has a per-user licensing cost line
attached ($1/member/mo per CTA Tape A/B, $1.25/member/mo OPRA — public list prices,
`licensing-register.md` R-A6-4); any cost that scales with member count escalates to the owner
regardless of amount, per standing policy (`GOVERNING_PRINCIPLES.md` §11). This system does not make
that commercial decision; it must make the cost visible to whoever does.

---

## 9. Loading / error / empty / degraded states

Restated as concrete, buildable state definitions per vendor adapter — generalizing three patterns
already proven in the codebase (`data-architecture.md` §17.1), not inventing new ones:

**9.1 Loading.** Every adapter call has a bounded connect/read timeout (per-vendor, configured, never
"whatever the default HTTP client does"). No adapter call may block a request thread past its
configured budget.

**9.2 Error — four distinct, typed states, never a bare exception and never a silent `None`:**
- **Auth failure** — the vendor rejected the credential; distinct from rate-limiting.
- **Rate-limited** — the vendor's own limit was hit; the adapter's token bucket (§5.3) should make
  this rare, but the state must exist for when it happens anyway.
- **Transient** — a network-level or 5xx failure, retryable per the adapter's backoff policy.
- **Not-found / not-available** — the vendor answered but has nothing for this request; distinct from
  every failure state above, and distinct from "not yet fetched."

**9.3 Cached-forbidden state (degraded, bounded).** When a vendor endpoint starts permanently 403ing
(as Finnhub's `/stock/upgrade-downgrade` and `/stock/transcripts/list` did "for months"), the adapter
caches the forbidden state for a bounded window (24h is the proven precedent) rather than retrying
every call — the reference pattern for "a vendor endpoint is degraded, not down"
(`data-architecture.md` §17.1, `finnhub_client.py`).

**9.4 Circuit breaker (degraded, safe default).** When a vendor has a hard rate ceiling, a tripped
circuit returns a known-safe default *without* a network call, logged (never silently), rather than
blocking a request thread (`yf_util.bounded_call`'s "one pool, one deadline, one circuit breaker"
shape, `data-architecture.md` §17.1). A default returned this way must be distinguishable, in the
canonical record's provenance/error fields, from a genuine vendor answer — a circuit-breaker default
rendered as a real value is exactly the "quiet market" failure mode this system exists to prevent.

**9.5 Empty (genuine).** A vendor answering with genuinely no data for this request is a distinct,
positive state — never conflated with any of §9.2's failure states, and never conflated with §9.4's
circuit-breaker default. This is the structural precondition for `CoverageLine`'s four-count receipt
(§6.3) to be honest rather than guessed.

**9.6 What this system must never do (the anti-pattern named explicitly in the locked architecture).**
A "never raises" wrapper that swallows every failure into an empty result is forbidden
(product-architecture.md §5-D D1 "Must NOT own"; TD-29) — every one of §9.2–§9.4's states must reach
the caller as a distinguishable fact, not as the same blank result a genuine empty answer would
produce.

---

## 10. Performance expectations

**10.1 Rate limiting.** Every adapter for a vendor UCT calls more than incidentally gets a
configurable token bucket, sized to that vendor's documented (or, where unconfirmed, conservatively
assumed) limit — Finnhub's token-bucket-plus-reactive-cooldown and AlphaVantage's hard daily bucket
are the two internal reference shapes (`data-architecture.md` §18.1). Massive and FMP, having none
today, are the two adapters where building the rate limiter *is* the adapter build (§18.2). The
bucket's ceiling must be a configuration value, not a hard-coded number, because Massive's actual
per-minute limit depends on the still-unconfirmed plan tier (OI-03a, §18.3) — the same reversibility
principle applied at the rate-limiter level specifically.

**10.2 Cost.** No adapter build in this system introduces new recurring spend; the build sequence
(§5.2) was chosen specifically because it consolidates existing paid relationships (FMP, Massive)
first, adding none (`data-architecture.md` §19.3). Any future adapter for a class-G capability (out of
scope for this system, §5.4) that *would* introduce spend is subject to the standing escalation rule
regardless of amount (`GOVERNING_PRINCIPLES.md` §11) — a decision this system's build does not make
and does not need to make.

**10.3 Observability.** Every new adapter ships a status endpoint from its first commit, generalizing
`GET /api/admin/provider-coverage`'s pattern (no-auth, read-only, per-field fill rate against a
declared floor — capability-ledger row D12) — this is a standing convention this system establishes,
not an optional nicety, because the provider ledger's own evidence-ceiling finding (zero rows anywhere
CONTRACT-ACTIVE; only two vendors reach OBSERVED-CALLED) is exactly the gap a status endpoint per
adapter closes going forward (`data-architecture.md` §20.1). A rate-limit-denial counter or a
fallback-triggered counter that nobody reads on a schedule is equivalent to not having it
(`data-architecture.md` §20.3) — each adapter's counters must be wired to the same observability
surface, not left as an unread metric.

---

## 11. Dependencies

- **S3 — Entity Master (LOCKED, D3).** D1 reads S3 for symbol/entity resolution at the adapter
  boundary; D1 does not resolve identity itself. S3's own build is a separate LOCKED system this
  document does not specify.
- **D2 — Canonical Data Model & Metric Address Book.** D1's adapters shape vendor responses into D2's
  schema; the canonical schema per data class (§4 of `data-architecture.md`) must exist, at least in
  skeletal form for the data class an adapter targets, before that adapter's response-shaping step can
  be finished. This is the one genuine build-order dependency: an adapter's transport/rate-
  limit/error-taxonomy work can proceed in parallel with D2, but its final response-shaping step
  cannot land until the target canonical schema for that data class is defined.
- **`provider_coverage_monitor`** (capability-ledger row D12, existing, already in production) — the
  pattern §10.3's status-endpoint requirement generalizes; not rebuilt, extended.
- **S9 — Entitlements & Licensing Gate** and **I1 — Intelligence Layer** — both are downstream
  consumers of D1's provenance field (§8.1, §6.3); neither is built by this system, and this system's
  fields must be correct and complete before either can do its own job correctly.
- **D4 — Caching & Serving** — sits above D1 (per the boundary matrix, §2); D1 does not own caching
  policy, but D4's serve-stale/warmer pattern reads D1's adapters for its underlying fetches.
- **F-09 / DL-022's retirement process** — this system builds the seam a retirement executes through;
  it does not decide what retires. Any specific vendor retirement decision remains F-09's, not this
  PRD's.

---

## 12. Explicit non-goals

Stated per this task's contract, to keep the anti-drift rule enforceable against this specific
system:

1. **No new vendor, account, subscription, or contract.** Per `GOVERNING_PRINCIPLES.md` §14A/DL-022,
   this system's entire job is abstracting the existing 48-provider estate. A class-G capability gap
   (§5.4) is out of scope by construction — closing one is a separate, later decision, made through
   F-09's process, not an outcome of building this system.
2. **No business logic, orchestration, or caching policy inside an adapter.** The ACL pattern's own
   documented constraint (`data-architecture.md` §3.1, §3.5): an adapter translates, it does not decide,
   and it is not a second application.
3. **No fallback chain expressed as control flow.** Fallback order is data D4/D2 consult, never a
   hard-coded `try/except` chain inside an adapter (§2's "Must NOT own").
4. **No retirement decisions made by this system.** This system builds the seam; F-09/DL-022 decides
   what retires and when (§2, §11).
5. **No UI, no rendering, no member-facing surface of any kind** (§6.1) — S8, S9, S10 own every
   downstream rendering decision this system's fields make possible.
6. **No resolution of OI-03(a)/(b) or D5.** This system's mechanism is designed to be correct under
   either answer; it does not decide the Massive tier, the FMP DDLA question, or the member-facing
   licensing posture (§8.4).
7. **No multi-asset expansion.** This system is scoped to the equities/options/indices-ETFs/COT-
   futures-positioning estate UCT already has (`data-architecture.md` §2's first principle,
   `GOVERNING_PRINCIPLES.md` §13). If the asset-class scope ever widens, this system's adapter
   boundary is exactly the seam that absorbs it later — that is the architectural payoff of building
   it correctly now, not a reason to build for a wider scope today.
8. **No second Polygon-family vendor.** A standing rule inherited from the provider ledger's own
   retirement queue (`product-architecture.md` §5-D D1 "Must NOT own"); Polygon-direct retires onto
   the Massive adapter, it does not get a parallel adapter of its own.

---

## 13. Provisional items and how this PRD stays correct under either answer

Per this task's contract and per `data-architecture.md` §29, every owner-bound item touching this
system is listed once, so none is silently decided:

| Item | Where it touches this system | Why this system's design does not need to wait |
|---|---|---|
| **OI-03(a)** — Massive plan tier | The rate-limiter's configured ceiling (§10.1); the licensing-class *values* the lookup returns (§8.4) | The adapter's rate-limit ceiling is a configuration value, not a code change; the adapter itself is unaffected either way |
| **OI-03(b)** — FMP DDLA existence | Same as above, for FMP's licensing-class values | Same reasoning — the adapter's response-shaping and error-taxonomy work is identical either way |
| **D5** (product-strategy) — member-facing licensing posture | Which fields a member-facing surface may ultimately display | This system supplies the provenance field the lookup consults; it does not decide the posture, and no adapter code changes when D5 resolves |
| **ESC-03/ESC-04** — whether Massive's Business grant reaches Derived Works | Whether UCT's own composites (UCT20 NAV, Exposure Rating) may ever be licensed for external publication | Out of this system's scope entirely — a specific written question to Massive (`data-architecture.md` §22.2), not an adapter design question |
| **ESC-06/OI-17** — whether the unauthenticated production endpoints are deliberate | Whether an existing route needs an auth fix before this system's adapters route through it | This system assumes Tier-S auth as a requirement either way (§8.5); it does not fix the existing routes and does not need to |
| **ESC-17** — the Anthropic subscription-seat lane | Whether AI lanes consuming D1-sourced data via I1 use the API key or the owner's seat | Orthogonal to this system's build; named here only so no implementer of an adapter mistakenly assumes it is this system's decision to make |

None of the above is inferred from silence, and none blocks beginning this system's build.

---

## 14. Acceptance criteria

Testable, per this task's contract's requirement for buildable specification:

1. **No direct FMP client outside the adapter.** Zero `_fmp_get`-shaped helper functions exist outside
   the single FMP adapter module; an AST rail in the shape of `test_yf_guard_census.py`, extended to
   cover FMP, fails by name on any new direct call. (Closes §4 item 3.)
2. **No direct Massive URL construction outside the adapter.** Zero modules construct
   `api.massive.com` URLs directly outside the single Massive adapter module; the same AST-rail shape
   covers this vendor too. (Closes §4 item 2.)
3. **Every adapter has a configurable rate limiter.** Both the FMP and Massive adapters ship with a
   token bucket whose ceiling is read from configuration, not hard-coded (§10.1); a unit test confirms
   changing the configured value changes enforced throughput with no code change.
4. **Every adapter has a typed error taxonomy of at least four classes** (auth, rate-limited,
   transient, not-found — §9.2), each independently testable via a mock vendor response.
5. **Every canonical record carries a provenance field and a freshness-class field.** No canonical
   record is returned from any adapter without both (§7.1, §7.2); a schema-level test asserts this for
   every data class an adapter serves.
6. **Licensing eligibility is a lookup, never a hard-coded per-surface check.** A test confirms that
   changing a single row in the licensing register's class table (vendor, data-class, audience) changes
   the eligibility result everywhere that value is consulted, with zero application code changes
   (§8.1).
7. **Every adapter ships a status endpoint from its first commit**, generalizing
   `GET /api/admin/provider-coverage`'s shape (§10.3); a smoke test confirms the endpoint responds
   before the adapter is considered complete.
8. **The FMP adapter's first release measurably consolidates the six existing helpers with zero
   coverage regression** — fill rates measured by `provider_coverage_monitor` (capability-ledger row
   D12) for every field the six helpers previously served must not drop below their pre-migration
   floor.
9. **The Massive adapter's first release replaces the 20+-module direct-URL pattern with zero
   application call-site changes required** beyond the one-time migration to the adapter's call shape
   — verified by the boundary-matrix rule (§2) becoming enforceable: no application module imports a
   vendor SDK or constructs a vendor URL after migration.
10. **A vendor retirement executed after this system exists is a single-adapter change.** The first
    retirement performed under the new pattern (recommended candidate: Polygon-direct onto the Massive
    adapter, a straight duplicate per F-09 class D) is verified to require zero application-layer
    changes — only the adapter's own routing/config.
11. **No new vendor spend is introduced.** A review of the build's own dependencies confirms no new
    account, subscription, or contract was created to satisfy this system's requirements (§10.2,
    §12 item 1).
12. **Cached-forbidden and circuit-breaker states are distinguishable from genuine empty results in
    every adapter's output**, verified by a test that simulates each of §9.3/§9.4/§9.5 against a mock
    vendor and asserts the three produce different, inspectable results.

---

## 15. NOT INSPECTED

This document read no application source code and fetched nothing beyond the accepted Phase 1/2
artifacts named in its `sources` field. It inherits, unchanged, the NOT INSPECTED lists of
`product-architecture.md` §"NOT INSPECTED", `data-architecture.md` §27, and
`capability-infrastructure-matrix.md` §"NOT INSPECTED" — most notably: every vendor contract, order
form, plan page, or account console named across those documents; the production `/data` volume;
Railway logs beyond the one orchestrator-only variable-name census; any test-suite execution; and any
live API call to any vendor. No new fact was manufactured to fill any gap those documents already
name as open — every PROVISIONAL marker in §13 is carried forward, not resolved.

---

## SOURCES (internal, read 2026-09-02, all under `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`)

`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` (D4, and the D1-collision note this PRD's frontmatter
already resolves) · `07-technical-architecture/data-architecture.md` (§0–§4, §11–§23, §26, §28, §29 in
full) · `05-product-strategy/product-architecture.md` (§0, §3, §4.2, the D1 system block in §5-D, §8
boundary matrix, §10 reversibility ledger) · `05-product-strategy/capability-infrastructure-matrix.md`
(D1 row, §6 cross-cutting reading) · `01-existing-system/capability-ledger.md` (rows O6, P3, D2, D12,
A1, A3, A10, A12, A13) · `00-program-control/GOVERNING_PRINCIPLES.md` (§6, §9, §11, §12, §13, §14A) ·
`00-program-control/READINESS_REVIEW_DAY1.md` (Part 5, Part 7 D4) ·
`13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` (§8, §9).

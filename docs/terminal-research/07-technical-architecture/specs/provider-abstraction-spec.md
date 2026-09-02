---
id: SPEC-D1-PROVIDER-ABSTRACTION
title: Provider Abstraction Layer — Technical Specification
role: Phase 3 deliverable — technical specification for the LOCKED data-platform D1 system, following directly from the Phase 3 PRD (specification, not implementation)
phase: 3
group: technical-architecture
category: spec
scope: >
  data-platform D1 from product-architecture.md's 32-system decomposition ("Provider Abstraction —
  one ACL per vendor"). Written directly against `05-product-strategy/prds/provider-abstraction-prd.md`
  (accepted as-is; not re-litigated) and grounded in a direct read of the real UCT codebase at
  `C:\Users\Patrick\uct-worktrees\terminal-research` (`api/`, `app/src/`) — every reuse/modify/new
  determination below cites an exact file and, where load-bearing, a line number this pass verified
  by reading the file, not by trusting a prior document's paraphrase. This document always writes
  "data-platform D1" or "the Provider Abstraction Layer"; it never writes bare "D1" — the source
  corpus has a THREE-WAY collision on that string: decision-register D1 (workspace model),
  product-architecture.md's data-platform D1 (this system), and capability-ledger.md's row D1 (the
  research modal). All three are cited below and each is written out in full every time.
confidence: >
  🟢 on every claim this pass re-verified against a real file (cited path:line); 🟡 wherever this
  document composes the PRD's requirement with a codebase fact into a new design decision (the
  interim-vs-target contract in §4 is the central instance); 🔴 on every item carrying a PROVISIONAL
  / OWNER INPUT REQUIRED marker (all inherited from the PRD/architecture corpus, plus one new
  🔴 item this pass surfaces itself — the FMP/Massive per-minute rate ceiling, §9.4/§10.4).
evidence_ceiling: >
  This document read no vendor contract, order form, or console, and made no live vendor API call —
  same ceiling as every upstream document. It DID read the actual application source this program's
  architecture and PRD passes explicitly did not (both PRDs/architecture docs state "no application
  code was read by this pass"), so where a codebase fact cited here sharpens, corrects, or narrows a
  claim made upstream (the "six independent FMP helpers" count, §7.2; Massive's silent status-collapse
  anti-pattern instance, §9.5), that correction is this document's own finding, sourced to the exact
  line read, and flagged as such rather than silently overriding the PRD.
sources: >
  05-product-strategy/prds/provider-abstraction-prd.md (accepted, not re-derived) ·
  12-decisions/ARCHITECTURAL_DECISION_REGISTER.md (D4) · 07-technical-architecture/data-architecture.md
  (§1, §3–5, §9–20, §26, §28–29) · 05-product-strategy/product-architecture.md (§4.2, D1 system block
  in §5-D, §8 boundary matrix, §10 reversibility ledger) · 05-product-strategy/
  capability-infrastructure-matrix.md (D1, S3 rows) · 01-existing-system/capability-ledger.md (rows
  O6, P3, D2, D12, A1, A3, A10, A12, A13) · 00-program-control/GOVERNING_PRINCIPLES.md (§13, §14A) ·
  the real codebase — `api/services/{stripe_service,finnhub_client,alphavantage_client,massive,
  provider_coverage_monitor,bar_provenance,bar_quarantine,cache,cache_snapshot,serve_stale,
  cache_policy,source_circuit_breaker,yf_util}.py`, `api/services/journal_two/broker/
  {snaptrade_client,rate_limit}.py`, `api/routers/{fundamentals,insider,provider_coverage}.py`,
  `api/services/{catalyst/analyst_actions,earnings_estimates,transcript_indexer,insider,
  research/financial_history}.py`, `tests/test_yf_guard_census.py`, `tools/yf_guard_census.py`.
status: draft — Phase 3 deliverable, awaiting review
date: 2026-09-02
provisional_markers: >
  OI-03(a) Massive plan tier · OI-03(b) FMP Data Display and Licensing Agreement — both carried
  unchanged from the PRD, affecting only the licensing-class *values* this spec's stamped field
  carries, never the adapter code. NEW this pass: the FMP and Massive per-minute rate ceilings are
  themselves unconfirmed by any live API/plan-page read (§9.4, §10.4) — designed, per data-architecture
  §18.3's own principle, to be a configuration value regardless, so this does not block the build.
---

# Provider Abstraction Layer — Technical Specification

**North Star anchor, restated for this document specifically.** This spec exists to make data-platform
D1 buildable, not to re-argue why it should be built — that case is made in full in the PRD (accepted)
and in decision D4 (LOCKED, `ARCHITECTURAL_DECISION_REGISTER.md`). Every design choice below is scoped
to closing the PRD's twelve acceptance criteria (§24) against the codebase as it actually reads today,
not the architecture as it was described from research alone. Where this document's own reading of the
code sharpens or narrows a PRD claim, that is called out explicitly (§7.2, §9.5) rather than silently
folded in — per the program's own evidence standard, a correction is a finding, not a paraphrase.

---

## 1. What this document is, and how it relates to its two parents

This is the **technical specification** for data-platform D1. It sits directly beneath
`prds/provider-abstraction-prd.md` (the *what* and *why*, Phase 3, accepted) and directly beneath
`data-architecture.md` (the *pattern*, Phase 2, accepted) in the program's own document hierarchy
(`GOVERNING_PRINCIPLES.md` §2). It does not re-litigate either: the PRD's twelve acceptance criteria
(§14 there, reproduced and mapped to concrete deliverables in §24 here) are the contract; this document
says exactly how to meet them against the real files in this repository.

**What is new here that the PRD and architecture did not (and should not have) resolved.** Both upstream
documents explicitly read no application source (their own frontmatter says so). This document did, and
that reading surfaces one genuine design problem neither upstream document names: **data-platform D1's
target primitive — `adapter(vendor).fetch(dataClass, entity, params) → canonical + provenance`
(product-architecture.md §5-D) — takes a `dataClass` argument implying D2's canonical schema exists, and
an `entity` argument implying S3's entity master exists. Neither does yet** (D3 Entity Master is LOCKED
but unbuilt; D2 Canonical Data Model is "new, on the critical path," `product-architecture.md` §5-D D2).
The PRD names this as "the one genuine build-order dependency" for the adapter's *response-shaping step*
only (PRD §11) but does not design what the adapter's interface looks like in the meantime. §4 below is
this document's answer: an **interim contract** the two first adapters ship against now, and a **target
contract** they upgrade to with no caller-visible break once S3/D2 land. This is the single most
consequential technical decision in this document.

---

## 2. Grounding — what is actually in this codebase today, re-verified

Per this task's explicit instruction, every claim below was checked against the real file, not carried
forward from the PRD's paraphrase.

### 2.1 The ACL precedent named in decision D4 — read in full

`api/services/stripe_service.py` (290 lines) is the file decision D4 and the PRD both name as "the only
true provider abstraction in the repo." Read in full: it is a genuine single-chokepoint isolation
(nothing else in the codebase imports `stripe`), but its *shape* is narrower than what data-platform D1
needs — it has no rate limiter, no typed error taxonomy (it wraps Stripe's own exceptions ad hoc via
`_safe_get`), and no provenance/freshness concept, because Stripe is a write-path payments API, not a
read-path market-data vendor. **What data-platform D1 should actually copy from `stripe_service.py` is
the isolation discipline** ("nothing else touches this vendor"), not its internals. The rate-limiter,
typed-exception, and cached-forbidden-state shapes data-platform D1 needs live in a different file:

`api/services/finnhub_client.py` (260 lines, read in full) is the real template for those three things:
a non-blocking proactive token bucket (`_fh_take_token`, lines 126–150 — refills continuously off a
monotonic clock, **never sleeps**, sheds a call immediately when the bucket is dry), a reactive
20-second shared cooldown engaged on any 429 (`fh_note_429`, lines 175–184), and a 24-hour
cached-forbidden-endpoint cache keyed through the existing `cache` module (`fh_get`, line 239:
`cache.get(f"fh_forbidden_{path}")`). **One load-bearing correction to the PRD's framing**: `fh_get`
(lines 212–260) is itself an instance of the "never raises" anti-pattern data-platform D1 is required
not to own (§9.2 below) — on every failure class (missing key, 429, 403, timeout, non-2xx, malformed
body) it returns bare `None`, indistinguishable from "the vendor had nothing." The *rate-limiting and
cached-forbidden-state mechanics* are the precedent to generalize; the *return-None-on-everything*
error signalling is the specific anti-pattern the new adapters must NOT copy from it. This is not a
defect in `finnhub_client.py` for what it does today (every one of its callers already treats `None` as
"try the next fallback," which is a coherent design for a *tertiary* vendor) — it is a shape that
data-platform D1's two primary adapters (FMP, Massive) must not inherit, because for a *primary* vendor
a caller needs to know *why* it got nothing.

`api/services/alphavantage_client.py` (283 lines, read in full) is the second precedent, for a
fundamentally different rate shape: a **daily**, not per-minute, bucket (`_AV_DAILY_LIMIT = 25`,
ET-midnight reset via `_AV_RESET_TZ`), and a same-anti-pattern `av_get` that also degrades to `None`.
Its distinctive, worth-copying idea: AlphaVantage returns **HTTP 200 even when throttled** (a `"Note"`
or `"Information"` key instead of the real payload), and `is_av_throttle_response` is the one place
that classifies this — the general lesson (a vendor's rate-limit signal is not always its HTTP status
code) applies directly to FMP, which has its own version of this problem (§9.5 below).

`api/services/journal_two/broker/snaptrade_client.py` (read in full, lines 1–100 shown here) is the
**third** and most directly reusable precedent — the only one of the three that already does typed
exceptions correctly: `SnapError` (base, carries `status`/`code`/`body`) → `SnapNotConfigured`,
`SnapAuthError` (→ `SnapUserSecretInvalid` subclass), `SnapRateLimited` (carries `retry_after`),
`SnapTransient`. This is the exact five-class shape (four top-level: not-configured, auth,
rate-limited, transient — plus one specialized subclass) the PRD's acceptance criterion 4 asks every
new adapter to match "at least." §6.5 below designs data-platform D1's shared exception base directly
on this shape, generalized across vendors (a gap `SnapError` itself does not need to close, since
SnapTrade has exactly one).

`api/services/journal_two/broker/rate_limit.py`'s `AsyncRateLimiter` is a **fourth** rate-limiting
precedent that exists in the codebase but is the **wrong shape to copy for FMP/Massive**, and this
document says so explicitly because a future implementer will find it via search and reasonably assume
it is the shared answer. It is a *blocking* async token bucket — `acquire()` sleeps until tokens are
available. That is correct for SnapTrade, whose calls run inside a background broker-sync job
(`asyncio.to_thread`), off the request path. FMP and Massive adapters serve **live request-path** calls
(a member loading a chart, fundamentals panel, or the movers strip) on the single shared uvicorn event
loop / anyio threadpool — the exact single-process envelope the 2026-07-01 524-outage incident (cited
throughout `CLAUDE.md`'s "Performance & Scale" section and `finnhub_client.py`'s own docstring) blew up
by letting *anything* block a request-path worker thread waiting on an external budget. **Data-platform
D1's two primary adapters must use the non-blocking shed pattern (`finnhub_client.py`'s shape), never
`AsyncRateLimiter`'s blocking one** — this is a deliberate, reasoned divergence from an available
in-repo precedent, not an oversight.

### 2.2 The FMP debt, re-counted call site by call site

The PRD and `data-architecture.md` both cite "six independent FMP helper functions... no shared
budget" at `routers/fundamentals.py:111`, `catalyst/analyst_actions.py:96`, `earnings_estimates.py:344`,
`transcript_indexer.py:25`, `insider.py:89`, `research/financial_history.py:38`. This pass read all six
in full. **The count of six modules is correct; the count of six *independent implementations* is not**
— two of the six already delegate to a third:

| # | File:line | Function | Independent, or delegates? |
|---|---|---|---|
| 1 | `api/routers/fundamentals.py:111` | `_fmp_get` | **Independent** — its own `requests.get`, own timeout param, own try/except |
| 2 | `api/services/catalyst/analyst_actions.py:96` | `_fmp_get` | **Independent** — same shape, own docstring explicitly notes it "matches the idiom already in `analyst_grades.py` / `engine.py::_fmp_get`" (two *more* undiscovered independent copies outside the PRD's named six — see §2.3) |
| 3 | `api/services/earnings_estimates.py:344` | `_fmp_get` | **Independent** — the one every delegator below points at |
| 4 | `api/services/transcript_indexer.py:25` | `_fmp_get` | **Delegates**: `from api.services.earnings_estimates import _fmp_get as g; return g(...)` |
| 5 | `api/services/insider.py:89` | `_fmp_get_insider` (different name; single hardcoded endpoint, not a general `path` parameter) | **Independent**, and structurally distinct — not a `(path, params)` shape at all |
| 6 | `api/services/research/financial_history.py:38` | `_fmp` (wrapper, imports `earnings_estimates._fmp_get` locally inside the function) | **Delegates** |

So the actual consolidation surface is **four distinct client bodies** (1, 2, 3, 5), of which every one
is a near-identical `requests.get(...) → raise_for_status() → .json()`, wrapped in a bare
`except Exception: log; return None`, with **no two of the four sharing a timeout default**
(`fundamentals.py` takes `timeout` with no default; `analyst_actions.py` defaults to `_FMP_TIMEOUT`;
`earnings_estimates.py` defaults to 10; `transcript_indexer.py` defaults to 25) — this confirms the
PRD's substantive claim ("no shared budget, no shared timeout policy") precisely, while correcting its
implied scope: the FMP adapter build replaces **four** client bodies and **six** call sites, not six
client bodies. This matters for the migration-effort estimate in §11.

### 2.3 Two more independent FMP clients the PRD's named six did not include

`catalyst/analyst_actions.py:96`'s own docstring names two more modules with "the idiom" —
`api/services/analyst_grades.py` and `api/services/engine.py::_fmp_get`. This pass confirms both exist
and both define their own `_fmp_get`-shaped function, independent of the four named above. **The FMP
consolidation surface is therefore at minimum six independent implementations across eight call sites**,
not the PRD's four-endpoint framing ("28 modules, ~45 endpoints" from the PRD's build-sequence table is
a broader, coarser count that already likely includes these — this correction sharpens the specific
`_fmp_get`-shaped-helper count, not the wider module count). §11's migration inventory carries this
corrected list.

### 2.4 The Massive debt, re-verified

`api/services/massive.py` (1,346 lines; lines 1–140 read in full, remainder scanned for the patterns
named below) confirms `_MassiveRestClient` at line 76 exactly as the PRD cites, backed by a shared
module-level `httpx.Client` (line 61) with `timeout=httpx.Timeout(connect=3.0, read=25.0, write=5.0,
pool=10.0)` and `limits=httpx.Limits(max_keepalive_connections=30, max_connections=60)` — matching the
PRD's cited numbers exactly. **A grep for `token` or `bucket` anywhere in `massive.py` returns zero
hits outside a comment describing a *different* module's rate-limit breaker** — the "no token bucket at
all" claim is confirmed by absence, not by a document's assertion.

A second, independent grep confirms the "20+ modules build `api.massive.com` URLs themselves" claim
precisely: `grep -rl "api.massive.com" api/` returns **exactly 20 files** —
`api/backfill_rest.py`, `api/darkpool_massive_ingest.py`, `api/flow_rest_backfill.py`,
`api/massive_oi_snapshots.py`, `api/massive_processor.py`, `api/massive_ws_worker.py`,
`api/oi_massive_snapshots.py`, `api/oi_morning.py`, `api/oi_snapshot_router.py`,
`api/routers/live_prices.py`, `api/services/audit.py`, `api/services/breadth_dividends.py`,
`api/services/etf_holdings.py`, `api/services/massive.py` itself, `api/services/polygon_extras.py`,
`api/services/polygon_news.py`, `api/services/polygon_options.py`, `api/services/trade_conditions.py`,
`api/services/watchlist_prebuilt_refresh.py`, `api/ticker_types.py`. **Two of these
(`api/massive_ws_worker.py`, `api/massive_processor.py`) are partner-owned files**
(`GOVERNING_PRINCIPLES.md` §5) — outside every boundary per product-architecture.md §3.4 rule 4 and
this document's own DO NOT clause; the Massive adapter build touches the other 18, never these two.

**A concrete, in-the-wild instance of the exact TD-29 "never raises" anti-pattern this system exists to
retire**, found while reading `massive.py`: `get_single_ticker_snapshot` (lines ~113–140) checks
`if data.get("status") not in ("OK", "DELAYED"): return {}` — Massive's own response DOES carry a
typed status field (unlike FMP, which has no such field — §9.5), and the current code silently
collapses every non-OK status (not-found, error, anything else) into an empty dict, indistinguishable
from "no data." This is the single clearest concrete example in the codebase of the failure mode §4
item 1 of the PRD's problem statement describes in the abstract. The Massive adapter's typed
not-found/error classification (§10.5) is a direct, mechanical fix to this exact function's shape,
generalized across every Massive endpoint that carries a `status` field.

### 2.5 What does not exist yet, confirmed by absence

`find api -type d -iname "*adapter*" -o -type d -iname "*provider*"` returns only
`api/services/journal_two/note_connectors/providers` (a different subsystem — connector OAuth for
Journal 2.0 note sync, unrelated to market-data vendors). **There is no existing `adapters/` or
`providers/` directory for market-data vendors** — every new module this spec proposes is a genuinely
new file, not a refactor of an existing package.

---

## 3. What this document is not

Not a re-architecture of decision D4 (LOCKED) or the PRD's twelve acceptance criteria (accepted as the
contract). Not implementation — no application file is edited, created, or modified by this document
or its author; every code shape below is a specification an implementer builds from, written to the
level of detail Phase 3's own contract requires (module layout, function signatures in prose, exact
call-site inventories), never as literal source to copy-paste. Not a design for D2 (Canonical Data
Model), S3 (Entity Master), S9 (Entitlements), or I1 (Intelligence Layer) — each is named only where
data-platform D1's own contract touches its boundary, per the boundary matrix
(`product-architecture.md` §8).

---

## 4. The interim-vs-target contract — resolving the D2/S3 dependency

This is the central technical decision this document adds beyond the PRD.

**4.1 The target contract (unchanged from the architecture, ships once S3 and D2 exist).**
`adapter(vendor).fetch(dataClass, entity, params) → canonical + provenance` — one call shape, `entity`
is S3's permanent internal id, `canonical` is D2's schema for that data class.

**4.2 The interim contract (what this spec's two adapters ship against now).** Every adapter exposes,
from its first commit, a set of **typed, per-data-class fetch functions** — not a single generic
`fetch(dataClass, entity, params)` dispatcher, because `dataClass` as an enum belongs to D2 and does not
exist yet. Instead: `fmp_client.get_key_metrics_ttm(ticker: str) -> ProviderResult`,
`fmp_client.get_earnings(ticker: str, limit: int) -> ProviderResult`,
`massive_client.get_movers(direction: str) -> ProviderResult`, and so on — one function per endpoint the
adapter currently serves, named after what it returns, not after a URL path. `ticker: str` (the current,
universal calling convention across the whole codebase) stands in for S3's `entity` argument; every
adapter function accepts it in exactly the position `entity` will occupy in the target contract, so the
upgrade is a type-narrowing at the call site (`str` → `EntityId`), never a call-shape change.
`ProviderResult` (§6.1) stands in for `canonical + provenance` — a raw-but-tagged envelope today,
upgraded to D2's typed canonical shape once that data class's schema lands (data-architecture.md §4.2's
own sequencing: schema before a second vendor, not before the first).

**4.3 Why this is genuinely reversible, not a workaround that gets thrown away.** Every application
call site that consolidates onto `fmp_client.get_key_metrics_ttm(ticker)` today calls the exact same
function signature the day D2's fundamentals schema lands — only the *return type*'s internal shape
changes (raw dict → typed canonical record), and only inside the adapter's own response-shaping step.
No caller-visible break, no second migration. This is the direct, concrete form of the PRD's own claim
(§11) that "an adapter's transport/rate-limit/error-taxonomy work can proceed in parallel with D2" —
this section is what makes that claim buildable rather than aspirational.

**4.4 What this means for the `adapter(vendor)` primitive itself.** `budget(vendor)` and
`coverage(vendor, field)` (product-architecture.md §5-D's other two primitives) do not depend on D2 or
S3 at all — they are process-local state and per-field fill-rate respectively, and ship in full, to
target shape, from day one (§12, §18).

---

## 5. Reuse / Modify / New — component inventory

### 5.1 Reuse as-is (no change required)

- `api/services/cache.py` — the adapters' cached-forbidden-endpoint state and response caching ride the
  existing `cache.get`/`cache.set` TTLCache, exactly as `finnhub_client.py` already does. No new cache
  layer.
- `api/services/provider_coverage_monitor.py` (873 lines) — the platform-primitive pattern (per-field
  fill-rate + floor + self-heal + alert-on-change) is **extended** with new field specs (§18), not
  replaced. The module itself, its SQLite store (`provider_coverage.db`), and its scheduler wiring are
  untouched.
- `api/routers/provider_coverage.py` — the existing `GET /api/admin/provider-coverage` (no-auth,
  read-only) endpoint is the template §18 generalizes; the route itself is unchanged.
- `httpx.Client` module-level instance in `massive.py` (line 61) — the Massive adapter reuses this exact
  shared client (connection pool, timeouts) rather than constructing a second one; a second `httpx`
  client for the same vendor would fragment the connection pool the existing config already tunes.

### 5.2 Reuse the pattern, generalize the shape

- `finnhub_client.py`'s non-blocking token bucket + reactive cooldown (§2.1) — the *mechanics*
  (monotonic-clock refill, shed-not-sleep, a shared cooldown flag) are copied into both new adapters;
  the *return-None-on-every-failure* signalling is explicitly NOT copied (§6.5 replaces it with typed
  exceptions).
- `finnhub_client.py`'s 24-hour cached-forbidden-endpoint idiom (`cache.get/set(f"{vendor}_forbidden_
  {path}")`) — copied verbatim as a mechanism into both new adapters.
- `snaptrade_client.py`'s typed exception family shape (base + status/code/body, four-plus subclasses)
  — generalized into a new shared base (§6.5) both adapters' own exception families inherit from.
- `alphavantage_client.py`'s "the vendor's 200-with-a-throttle-body is not the same as a real 200"
  detection idiom — the general lesson (never trust HTTP status alone to mean "the vendor answered
  honestly") is applied to FMP's own analogous case (§9.5).

### 5.3 Modify (existing files whose call sites are repointed at the new adapter)

FMP (§11 has the full inventory; summarized here): `api/routers/fundamentals.py`,
`api/services/catalyst/analyst_actions.py`, `api/services/earnings_estimates.py`,
`api/services/transcript_indexer.py`, `api/services/insider.py`,
`api/services/research/financial_history.py`, `api/services/analyst_grades.py`, `api/services/engine.py`
— each loses its local `_fmp_get`/`_fmp_get_insider` definition and imports the new `fmp_client` module
instead; every call site that constructed a `stable/*` path string is repointed at the corresponding
typed function.

Massive (§11 has the full inventory): the 18 non-partner-owned modules from §2.4's grep, each repointed
from constructing an `api.massive.com` URL directly to calling `massive._MassiveRestClient` (already
the intended chokepoint — the class does not move, it gains the rate limiter, typed errors, and status
handling this spec adds, §10).

### 5.4 New components

| Component | Location | Purpose |
|---|---|---|
| `fmp_client.py` | `api/services/fmp_client.py` | The FMP adapter — new module, §9 |
| `provider_errors.py` | `api/services/provider_errors.py` | Shared typed-exception base + shared `ProviderResult`/provenance envelope, §6 |
| `provider_licensing_class.py` | `api/services/provider_licensing_class.py` | Small static (vendor, data-class) → licensing-class lookup table D1 stamps from, §20 |
| `tools/fmp_guard_census.py` | `tools/fmp_guard_census.py` | AST census, modeled on `tools/yf_guard_census.py`, §21.1 |
| `tools/massive_guard_census.py` | `tools/massive_guard_census.py` | Same shape, for `api.massive.com` URL construction, §21.1 |
| `tests/test_fmp_guard_census.py` | `tests/` | The rail consuming the FMP census |
| `tests/test_massive_guard_census.py` | `tests/` | The rail consuming the Massive census |
| `api/routers/provider_status.py` (or extend `provider_coverage.py`) | `api/routers/` | Per-adapter status endpoints, §18 |

**Modified, not new:** `api/services/massive.py` (`_MassiveRestClient` gains the rate limiter, typed
errors, and status-field handling — the class itself is not replaced or moved).

---

## 6. Data contracts

### 6.1 `ProviderResult` — the interim canonical-record envelope

Every typed adapter function returns a `ProviderResult` (a small dataclass or `TypedDict` — an
implementation detail Phase 3 leaves to the implementer, not load-bearing here), carrying:

- `value: Any` — the raw-but-field-renamed payload (interim shape; becomes D2's typed canonical shape
  once that data class's schema exists, §4).
- `provenance: ProvenanceRecord` (§6.2) — required on every result, success or typed-empty; never
  optional (PRD acceptance criterion 5).
- `freshness: FreshnessClass` (§6.3) — one of the four classes; required wherever the value is
  price-shaped, `None` otherwise.
- `licensing_class: str` — the stamped (vendor, data-class) lookup value from §20's static table;
  required on every result.

A function that cannot produce a value raises a typed exception (§6.5) instead of returning a
`ProviderResult` with a null `value` — "genuinely empty" (the vendor answered, there is nothing) is
still a **successful** `ProviderResult` with `value=[]` or `value=None` and a provenance record saying
so; it is never conflated with a raised exception (PRD §9.5, §9.6).

### 6.2 `ProvenanceRecord`

Generalizing `bar_provenance.py`'s shape (§2.1's precedent, but note: `bar_provenance.py` itself is
narrower than what this record needs — it carries only `source`/`validated_at`/`verified_at`, no
activity/entity/tie-break distinction). Per data-architecture.md §11.3, every `ProvenanceRecord`
carries:

- `vendor: str` — which adapter produced this (`"fmp"`, `"massive"`).
- `source_activity: str` — which specific fetch function / endpoint produced it (e.g.
  `"fmp_client.get_key_metrics_ttm"`), the seam the evidence ladder (§18.2) reads.
- `fetched_at: float` (epoch) — when the adapter received this value; distinct from any as-of date the
  value itself carries.
- `tie_break: str | None` — populated only where more than one adapter response could answer the same
  field and one was chosen (generalizing `earnings_estimates._earn_row_preferred`'s currently-silent
  per-function decision, PRD §7.1); `None` when only one candidate existed.

### 6.3 `FreshnessClass`

Four values, per `licensing-register.md` R-A4-2 (cited via data-architecture.md §12.1) and the PRD
§7.2: `real_time`, `delayed_15`, `end_of_day`, `historical`. Stamped by the adapter at the point it
knows which one applies (a live quote endpoint stamps `real_time` or `delayed_15` depending on the
licensing-class lookup's tier answer, §20; a bars/history endpoint stamps `historical`; an EOD
snapshot stamps `end_of_day`). **The adapter stamps the class; it does not decide what a renderer may
do with it** — that is S8/S10's job (PRD §6.3), out of this system's scope.

### 6.4 Circuit-breaker / cached-forbidden distinguishability (PRD acceptance criterion 12)

Both new adapters return a **distinct, dedicated `ProviderResult` subtype or a `degraded: DegradedReason`
field** — never a bare empty result — for the three §9.2–§9.4-shaped states from the PRD: a genuine
empty answer (`degraded=None`), a cached-forbidden endpoint (`degraded="cached_forbidden"`, with the
original 403's timestamp), and a circuit-breaker default (`degraded="circuit_open"`). A test asserting
these three produce different, inspectable results (the PRD's own acceptance criterion 12) is
straightforward against this field — it does not exist as three different exception types, because
none of the three is a *failure* the caller must handle specially; all three are legitimate, distinct
answers a caller may render differently (an honest-blank vs. a "vendor degraded, showing last-known"
banner), which is exactly `CoverageLine`'s four-count discipline (PRD §6.3, data-architecture §13.2)
applied at the single-value level instead of the result-set level.

### 6.5 The typed error taxonomy — `provider_errors.py`

New, small, shared module. A `ProviderError(Exception)` base (mirrors `SnapError`'s shape exactly:
`vendor: str`, `status: int | None`, `code: str | None`, `body: Any`), and **per-vendor subclass
families** built on it — not a single shared set of leaf classes, because each vendor's specific
mapping from HTTP reality to these categories differs (§9.5, §10.5 spell out each vendor's mapping) and
a caller catching `FMPRateLimited` should never accidentally catch a Massive rate-limit too. The four
required leaf categories, per vendor (PRD acceptance criterion 4, minimum four; SnapTrade's five-class
shape is the template):

- `<Vendor>NotConfigured` — the vendor's API key env var is unset (a distinct, common, non-transient
  case worth its own class, per `SnapNotConfigured`'s precedent).
- `<Vendor>AuthError` — the vendor rejected the credential (401/403 where NOT the cached-forbidden-
  endpoint case, §6.4 — see §9.5/§10.5 for how each vendor's adapter tells these apart).
- `<Vendor>RateLimited` — the vendor's own limit was hit (429, or vendor-specific 200-with-throttle-body
  per §2.1's AlphaVantage precedent, applied to FMP in §9.5).
- `<Vendor>Transient` — network-level or 5xx, retryable per the adapter's own backoff policy.
- `<Vendor>NotFound` — the vendor answered but has nothing for this request (distinct from a
  degraded/empty `ProviderResult`, §6.4 — see §9.5/§10.5 for the concrete, per-vendor detection rule,
  because neither vendor signals this with a clean HTTP 404).

A caller that wants vendor-agnostic handling (observability, a future S9 lookup) catches
`ProviderError` and reads `.vendor`; a caller that wants vendor-specific handling (a fallback-routing
decision, out of this system's scope per PRD §12 item 3) catches the specific leaf class.

---

## 7. API boundary — the adapter primitive, interim shape

### 7.1 Public interface (per adapter module)

- Typed fetch functions, one per currently-served endpoint (§4.2) — the majority of the surface.
- `budget(vendor: str) -> BudgetState` — `{tokens_remaining, ceiling, denied_total, cooldown_until}`,
  read by observability (§18) and, later, D4's caching layer (PRD §6.2) without re-implementing the
  adapter's internal accounting. Ships in full, target shape, from day one (§4.4).
- `coverage(vendor: str, field: str) -> CoverageState` — delegates to `provider_coverage_monitor.py`'s
  existing per-field state (§5.1); the adapter does not duplicate this bookkeeping, it registers its
  fields with the existing monitor (§18.1).

### 7.2 Who may call it

Per the boundary matrix (`product-architecture.md` §8: "Applications ✗ D1... no application calls a
vendor... it asks D2/D4, which asks D1"), **applications do not call `fmp_client`/`massive_client`
directly today either — but nothing that resolves that (D2, D4) exists yet.** This spec's honest
answer, consistent with the interim-contract design (§4): during this phase, application call sites
that today construct an FMP/Massive URL are repointed **directly at the new adapter module**
(`fmp_client.get_key_metrics_ttm(ticker)`), which is a boundary violation under the *target*
architecture but not under any architecture that exists to violate yet — D2/D4 are the intermediary
the target boundary names, and until they are built, "call the adapter directly" is strictly better
than "construct the URL yourself" (it is the entire point of consolidation) without yet being the final
shape. **The AST rail (§21.1) enforces the narrower, buildable rule available today: nothing outside
`fmp_client.py`/`massive.py` constructs a vendor URL or defines a second `_fmp_get`-shaped helper** —
it does not yet enforce "only D2/D4 call the adapter," because there is no D2/D4 to enforce it against.
This is named explicitly, not silently narrowed, per this task's own evidence standard. **This exception
is now a tracked architectural decision, not a local rationalization** — `product-architecture.md` §3's
boundary matrix and §10's reversibility ledger both carry an explicit "Applications ✗ D1 build-out
exception" row (added during Phase 3 validation) with the same reversion condition stated here: the
relaxation reverts to the strict rule automatically the day D2 ships.

### 7.3 Status/coverage endpoint

Every adapter ships `GET /api/admin/{vendor}-adapter-status` (no-auth, read-only, mirroring
`GET /api/admin/provider-coverage`'s existing shape exactly — §5.1) from its first commit
(PRD acceptance criterion 7): current `budget()` state, the evidence-ladder field (§18.2), and a link
to the shared `provider_coverage.db` rows this vendor's fields registered.

---

## 8. Entity / security identifiers — the interim contract

S3 (Entity Master) does not exist. Every adapter function's identity parameter is `ticker: str`, exactly
matching the calling convention every existing FMP/Massive call site already uses — **this is not a
regression against today's codebase; it is today's codebase**, carried forward unchanged into the
adapter boundary. Symbol translation at the adapter boundary (`to_polygon_symbol()`'s `BRK-B`→`BRK.B`
rewrite, currently leaking to 41 call sites / 15 modules per the provider ledger, confirmed still
present at `massive.py`'s `to_polygon_symbol` function, read in §2.4) is **relocated into the Massive
adapter's own request path** (§10.6) so every one of those 41 call sites stops needing to know the
rewrite exists — this is the concrete, buildable version of PRD §5.3's symbol-translation requirement,
achievable entirely without S3. The day S3 lands, the `ticker: str` parameter narrows to S3's
`EntityId` type at every call site in one mechanical pass (S3 resolves `ticker → entity_id` once,
upstream of the adapter call) — the adapter's own internals do not change.

---

## 9. Provider adapter #1 — FMP (build first)

### 9.1 New module: `api/services/fmp_client.py`

Modeled directly on `finnhub_client.py`'s module shape (module-level functions + module-level state
guarded by `threading.Lock`s, not a class — matching three of the four in-repo REST-client precedents,
§2.1) rather than `massive.py`'s class shape, because FMP has no existing chokepoint class to extend
(unlike Massive's `_MassiveRestClient`) — a brand-new module is free to pick the shape the majority
precedent already uses.

### 9.2 Transport

Base URL `https://financialmodelingprep.com` (confirmed identical across all four independent existing
implementations, §2.2). A single module-level `requests.Session()` (or `httpx.Client` — either is
consistent with the codebase's mixed usage; `requests` is what all four existing FMP call sites already
use, so `requests.Session()` minimizes the diff) replacing four independent `requests.get(...)` calls
that today share no connection pool at all. Connect/read timeout: **the highest of the four existing
values observed (25s, from `transcript_indexer.py`'s delegated default) as the ceiling, with each typed
function able to pass a tighter per-endpoint timeout** where the existing code already differentiated
(the four implementations' defaults ranged 10s–25s with no stated reason for the spread — this spec
treats that spread as an artifact of independent authorship, not a deliberate per-endpoint policy, and
lets the migration correct it endpoint-by-endpoint against real observed latency rather than guessing).

### 9.3 Consolidation inventory (the six-modules-eight-call-sites-four-bodies structure from §2.2–§2.3)

| Existing file | What moves | New call |
|---|---|---|
| `api/routers/fundamentals.py:111` `_fmp_get` | deleted; its ~6 call sites repointed | `fmp_client.<typed fn>` per endpoint |
| `api/services/catalyst/analyst_actions.py:96` `_fmp_get` | deleted | `fmp_client.get_analyst_grades(ticker)` |
| `api/services/earnings_estimates.py:344` `_fmp_get` | deleted (its delegators below repoint to `fmp_client` instead) | `fmp_client.<typed fn>` per endpoint |
| `api/services/transcript_indexer.py:25` `_fmp_get` (delegates) | deleted; repointed directly at `fmp_client`, no longer via `earnings_estimates` | `fmp_client.get_transcripts_latest_page(page)` |
| `api/services/insider.py:89` `_fmp_get_insider` | deleted; folded into the general `path`-parameterized shape | `fmp_client.get_insider_trading(ticker)` |
| `api/services/research/financial_history.py:38` `_fmp` (delegates) | deleted; repointed directly | `fmp_client.get_income_statement/balance_sheet/cash_flow(ticker, period, limit)` |
| `api/services/analyst_grades.py` (this pass's own finding, §2.3) | its own `_fmp_get` deleted | `fmp_client.get_analyst_grades(ticker)` (shared with #2 above — first genuine dedup this consolidation achieves) |
| `api/services/engine.py::_fmp_get` (this pass's own finding, §2.3) | deleted | repointed per its specific call site |

**This table is itself the PRD's acceptance criterion 1 made concrete**: "zero `_fmp_get`-shaped helper
functions exist outside the single FMP adapter module" is a literal, checkable statement against this
exact list.

### 9.4 Rate limiting

A non-blocking proactive token bucket, `finnhub_client.py`-shaped, with a **configurable ceiling**
(`FMP_RATE_LIMIT_PER_MIN` env var, new). **🔴 Open item, not resolved by this spec or any document
this program has produced**: FMP's actual per-minute call ceiling on UCT's Ultimate plan is not stated
anywhere in the accepted corpus this document is grounded in — the PRD names Massive's rate ceiling as
tier-gated and open (OI-03a) but does not separately flag FMP's. This spec flags it explicitly as its
own open item, distinct from OI-03a, because leaving it unflagged would silently imply the number is
known. Per data-architecture.md §18.3's own principle (applied there to Massive, generalized here to
FMP), the fix is the same regardless: **the bucket's ceiling is a configuration value with a
conservative default** (this spec recommends starting at a level well under any publicly-documented FMP
plan's typical per-minute cap — the specific starting number is an implementation-time judgment call,
not a decision this document makes, because making one without evidence would be exactly the "guessed
limit" data-architecture §18.3 forbids), changeable with no code change once the real ceiling is
confirmed (a live plan-page read, out of this document's evidence ceiling).

### 9.5 Error taxonomy specifics for FMP — the not-found problem

FMP's `stable/*` endpoints, per every existing implementation read in §2.2, **carry no status field
analogous to Massive's `"status": "OK"/"DELAYED"`** (§2.4's finding). A request for a ticker FMP has no
data for typically returns **HTTP 200 with an empty JSON array or an empty object**, not a 404 — the
same class of problem AlphaVantage's throttle-detection precedent (§2.1) exists to solve, but for
"not-found" rather than "throttled." **Consequence for the adapter design: `FMPNotFound` cannot be
raised generically inside a shared low-level `_fmp_get`-equivalent** — each typed fetch function must
carry its own, endpoint-specific "is this response the vendor's honest way of saying nothing exists"
predicate (e.g. `get_key_metrics_ttm` treats `[]` as not-found; `get_income_statement` treats a response
missing the expected keys as not-found), because FMP does not standardize this shape across endpoints.
This is a genuinely new piece of per-endpoint logic the adapter must own that the four existing
independent implementations never had to write (they all just returned whatever FMP sent, `[]` and all,
straight to their caller) — named here explicitly so the migration estimate in §22 accounts for it.
`FMPAuthError` maps from HTTP 401/403 (an FMP-plan-forbidden endpoint, mirroring Finnhub's 403 case);
`FMPRateLimited` maps from HTTP 429 **and** from FMP's own documented rate-limit response body shape
(a live-API-confirmed detail this document's evidence ceiling does not reach — flagged, not assumed);
`FMPTransient` from 5xx/network/timeout.

### 9.6 Response shaping (interim)

Each typed fetch function renames FMP's field names to a stable internal name **at the point of return**
(e.g. FMP's `symbol`/`date`/`epsActual` → the adapter's own consistent naming), without yet mapping onto
D2's canonical schema (§4.2) — this is the "raw-but-tagged" interim shape, and it is where the XBRL-
naming question (data-architecture §4.3, an explicitly open technical question this document does not
resolve) will eventually attach once D2's fundamentals schema exists.

---

## 10. Provider adapter #2 — Massive (build second)

### 10.1 Extend, do not replace, `_MassiveRestClient`

Unlike FMP, Massive already has the intended chokepoint class (`_MassiveRestClient` at `massive.py:76`
— confirmed, §2.4). The adapter build **extends this class in place** — adds the rate limiter, the
typed error taxonomy, and the status-field handling fix (§10.5) as new methods/attributes on the
existing class — rather than creating a parallel class, per the PRD's own framing ("`_MassiveRestClient`
becomes the sole caller," PRD §5.2 table). `to_polygon_symbol()` (already a module-level function in
the same file, confirmed §2.4) is called from inside every method that needs it, rather than by each of
the 18 external call sites individually (§8).

### 10.2 Consolidation inventory (18 non-partner-owned modules)

The 18 modules from §2.4's grep, minus the two partner-owned files, each repointed from a direct
`api.massive.com` URL construction to a `_MassiveRestClient` method call. Given the count (18, versus
FMP's 8 call sites), and per the PRD's own sequencing rationale ("follows a proven-in-repo pattern from
adapter #1... highest blast radius"), this spec recommends a **narrower first slice** within the Massive
build rather than a single 18-module cutover: begin with the modules already calling
`_MassiveRestClient` for *some* endpoints while constructing URLs directly for *others*
(`api/routers/live_prices.py` and `api/services/etf_holdings.py` are the two most likely candidates,
per the class names visible in `massive.py`'s existing method list — `get_top_movers`,
`get_single_ticker_snapshot` — confirming these two data classes already have a home on the class), then
proceed module-by-module through the remainder. This is a sequencing recommendation within the PRD's
own adapter-#2 slot, not a new decision.

### 10.3 Transport

Reuse the existing module-level `_http` client (`massive.py` line 61, §2.4) — do not construct a second
`httpx.Client` for Massive. This is a **reuse**, not a new component (§5.1).

### 10.4 Rate limiting

Same non-blocking shed pattern as §9.4. **🔴 Same open-item flag as FMP, doubly so for Massive**: the
PRD explicitly names Massive's actual per-minute limit as **tier-gated and unconfirmed (OI-03a)** — this
spec adds nothing new to that specific finding, only restates it as the direct input to
`MASSIVE_RATE_LIMIT_PER_MIN`'s configured value. The adapter ships with the ceiling as a config value
from day one regardless of when OI-03a resolves (PRD acceptance criterion 3; data-architecture §18.3).

### 10.5 Error taxonomy specifics for Massive — the status-field fix

Unlike FMP, Massive's responses **do** carry a status field (`"status"`, confirmed §2.4). `MassiveError`
family classification: `MassiveNotFound` — `status` is a value the Massive/Polygon API documents as
"not found" for that endpoint (the exact value varies by endpoint family — confirmed only for the
snapshot endpoint's `"OK"`/`"DELAYED"` pair by this pass's read; a full enumeration across every Massive
endpoint the adapter serves is implementation-time work, not resolvable from the three functions this
pass read); `MassiveAuthError` — 401/403 on the HTTP layer (an invalid/revoked `MASSIVE_API_KEY`);
`MassiveRateLimited` — 429; `MassiveTransient` — 5xx/network/timeout, **including the existing
`PoolTimeout` failure mode already named in `massive.py`'s own comments** (line ~66: "the previous
30-connection limit was getting exhausted... causing `_fetch_intraday_massive` to silently fail with
PoolTimeout (caught by blanket except → return [])" — this is a second, independently-confirmed
in-the-wild instance of the exact anti-pattern §2.4 already found once, now classified correctly as
`MassiveTransient` instead of silently returning an empty list).

### 10.6 Symbol translation

`to_polygon_symbol()` is called internally by every `_MassiveRestClient` method that accepts a ticker,
at the top of the method body, before constructing any request — this is the mechanical fix that
retires the 41-call-site leak (§8) without moving the function itself (it stays exactly where it is,
`massive.py`, because relocating a working, correctly-scoped function purely for tidiness is exactly
what the anti-monolith/anti-preservation-for-its-own-sake principle (`data-architecture.md` §2) argues
against).

### 10.7 Response shaping (interim)

Same interim-tagging discipline as §9.6 — each `_MassiveRestClient` method's return shape gets a stable
internal field naming, deferred full-canonical-schema mapping to D2.

---

## 11. Smaller vendors — not rebuilt in this phase, referenced only

Per the PRD's own sequencing (§5.2, adopted unchanged): Finnhub (`finnhub_client.py`), AlphaVantage
(`alphavantage_client.py`), and SnapTrade (`snaptrade_client.py`) are **already the internal reference
implementations**, not rebuild targets. This document's only recommendation touching them: once
`provider_errors.py`'s shared `ProviderError` base exists (§6.5), a **follow-up, out of this phase's
scope**, would be retrofitting Finnhub's and AlphaVantage's `None`-returning functions to raise typed
exceptions from the same shared base — named here so a future implementer does not treat the shared
base as FMP/Massive-only by accident, but explicitly not scheduled or required by this spec's
acceptance criteria (PRD §12 item 1's non-goals: no scope expansion beyond what the PRD names).

---

## 12. State management

All adapter state introduced by this spec is **in-process, module-level, `threading.Lock`-guarded** —
exactly `finnhub_client.py`'s and `alphavantage_client.py`'s existing shape, and exactly the same
single-process caveat both of those modules already document explicitly (the web pod is one uvicorn
process; a durable, cross-process budget store would be required only if the web pod is ever
multi-instanced, which is out of scope, `CLAUDE.md` "Performance & Scale" section, cited via both
existing clients' own docstrings). Per-adapter state: token bucket (tokens remaining, last-refill
timestamp), reactive cooldown (until-timestamp), cumulative denied-call counter (process-lifetime,
monotonic — mirrors `fh_budget_denied_total()`'s exact semantics and its own documented caveat: compare
two snapshots, never read as an absolute "current" count).

---

## 13. Persistence

**No new adapter-owned persistent store.** The cached-forbidden-endpoint state persists through the
existing `cache` module's TTLCache (in-memory, resets on redeploy — same behavior `finnhub_client.py`
already has and already accepts as sufficient, since a 24h forbidden-endpoint memory surviving a
redeploy is a nice-to-have, not a correctness requirement). Coverage/fill-rate history persists through
the existing `provider_coverage.db` (§5.1) — no new database file. This is a deliberate reuse decision,
not an oversight: introducing a new persistent store for adapter budget/coverage state would violate
data-architecture §21.1's own scoping rule (new stores are for new canonical-schema data classes; this
system's own bookkeeping is not one).

---

## 14. Caching

**Data-platform D1 does not own caching policy** (PRD §12 item 2; product-architecture.md §5-D:
"Must NOT own... a fallback chain... caching policy"). This spec's adapters sit **underneath** the
existing per-caller caching that already exists today (e.g. `fundamentals.py`'s own TTL cache around
its fundamentals calls, `bars_disk_cache`'s multi-layer cache around bars) — the adapter's job is to be
the thing a cache-miss calls, not to replace the cache. This is unchanged by this spec: every existing
cache wrapper around a now-consolidated FMP/Massive call site keeps working exactly as before, simply
now calling `fmp_client.get_key_metrics_ttm(ticker)` instead of its own local `_fmp_get(...)` inside the
same cache-miss branch. D4 (Caching & Serving) is the future system that generalizes this per data
class — out of this document's scope, named only so no implementer accidentally builds a competing
cache inside the adapter.

---

## 15. Realtime / polling behavior

Out of scope — D3 (Realtime Streaming) owns this, and per the boundary matrix
(`product-architecture.md` §8), D3 "calls D1 (●) for its own vendor sockets." The one item this spec
notes for D3's future benefit: Massive's WS reconnect logic (mirroring `finnhub_client.py`'s
`fh_ws_reconnect_allowed()` priority-reserve pattern, cited in data-architecture §8.3/§18.1 as a
worthwhile future addition) is **not** built by this spec — the Massive adapter's rate limiter (§10.4)
covers REST only. A future D3 spec adding Massive WS reconnect throttling should consult
`massive_client`'s token bucket the same way `realtime_stream.py` already consults
`finnhub_client.fh_ws_reconnect_allowed()` today — named as a forward-compatible seam, not built here.

---

## 16. Background jobs

**No new background job.** The one existing background job this spec touches is
`provider_coverage_monitor.py`'s daemon-thread cycle (§5.1, §18.1) — extended with new field specs for
FMP/Massive coverage, not given a second job. The cached-forbidden-endpoint TTL refresh is passive
(re-probed naturally on the next cache-miss after 24h, exactly `finnhub_client.py`'s existing behavior)
— no scheduler entry needed.

---

## 17. AI / orchestration

**Out of scope entirely** — I1 (Intelligence Layer) reads applications only through registered tools
(`product-architecture.md` §5-D I1's contract); data-platform D1 has no AI-facing surface. The one
forward link: every `ProvenanceRecord` (§6.2) and `licensing_class` field (§20) this spec's adapters
stamp is exactly the input I1's prompt-eligibility gate will consume (data-architecture §23.1) once I1
exists — named so an implementer does not add anything AI-specific to the adapter itself.

---

## 18. Observability

### 18.1 Extending `provider_coverage_monitor.py`

New field specs registered for FMP (per-endpoint fill rate across the four consolidated client bodies'
former call sites — e.g. `key_metrics_ttm`, `earnings_estimate`, `insider_trading`) and Massive
(`movers`, `single_ticker_snapshot`, and whichever additional endpoints the §10.2 migration slice
reaches first), each with a hand-tuned floor per the monitor's existing per-field-floor convention
(§2.1's citation of the module's own docstring on how floors are chosen). This raises the coverage
monitor's tracked-field count above its current 13 (§5.1) — an extension, not a rewrite.

### 18.2 The evidence ladder as a live field (PRD §7.3)

Each adapter's status endpoint (§7.3) exposes the KP/CR/OC/CA evidence-ladder state as a computed
field, not a markdown convention: **KP** (key present in env) is a one-line env check; **CR**
(code-referenced) is true once the adapter module exists and is imported anywhere; **OC**
(observed-called) is derived from whether `budget()`'s denied/served counters have moved off zero since
process start; **CA** (contract-active) is explicitly **not derivable from any signal this system has
access to** — per data-architecture §26.1's own finding that zero rows anywhere reach CONTRACT-ACTIVE
today, and per this document's own evidence ceiling, `CA` stays a manually-set, admin-only flag with no
automated promotion path, named here so no implementer accidentally builds a false-confidence auto-
promotion to `CA`.

### 18.3 Rate-limit-denial counters are wired to the status endpoint, not left unread

Per data-architecture §20.3's own finding ("a drop counter nobody reads is not observability"), each
adapter's `denied_total` (§12) is surfaced on `GET /api/admin/{vendor}-adapter-status` (§7.3) from day
one — not merely incremented in memory with no reader.

---

## 19. Error handling

The design is §6.5 in full; this section states the migration discipline. Every one of the four (FMP)
/ three (Massive, since `_MassiveRestClient` already exists) client bodies being retired today returns
bare `None` on every failure class (§2.2, §2.4). **The migration is not "keep returning `None`, just
from one place instead of four"** — that would satisfy PRD acceptance criterion 1 (no direct client
outside the adapter) while leaving criterion 4 (typed error taxonomy) and criterion 12
(distinguishable degraded states) unmet, and would in fact make TD-29 *worse* by concentrating the
"never raises" anti-pattern's blast radius into the one place every caller now depends on. Every
existing call site that currently does `if result is None: <fallback logic>` is repointed to
`try: ... except ProviderNotFound: <the "genuinely nothing" branch> except ProviderError as e:
<the "something is wrong, log e.vendor/e.status" branch>` — a mechanical, per-call-site change this
spec's migration inventory (§22) accounts for as real effort, not a free byproduct of consolidation.

---

## 20. Permission / entitlement handling

S9 (Entitlements & Licensing Gate) does not exist. Per the PRD's own framing (§8.1: "computed... at the
point of use... a lookup"), data-platform D1's job is narrower and buildable now: **stamp** the
`licensing_class` field (§6.1) from a small, static, versioned lookup table —
`provider_licensing_class.py` (new, §5.4) — keyed on `(vendor, data_class)` (no audience dimension yet;
S9 adds that later, consuming this same field). The table's initial values are drawn directly from the
licensing register's own already-researched classes, cited via `data-architecture.md` §14.1/§14.7's
worked table: FMP fundamentals/statements `R` (no DDLA) — per OI-03(b)'s default; Massive quotes `R`
(Individual tier) — per OI-03(a)'s default; Massive corporate-actions/reference `LA` even at Individual
tier (the one row data-architecture §7.5/§16.1 names as already-favorable regardless of tier). **This
is explicitly not S9** — no audience dimension, no route-level enforcement, no per-request evaluation;
it is the field D1 is required to stamp so that when S9 is eventually built, it has something to
consult rather than nothing (PRD §8.1's "structural guarantee" claim depends on this field existing
before S9 does, not after). Changing OI-03(a)/(b)'s resolved values later is a one-line change to this
table's data, touching zero adapter code — the exact reversibility data-architecture §29 requires.

---

## 21. Testing strategy

### 21.1 The AST rail — `test_yf_guard_census.py`'s shape, generalized

`tests/test_yf_guard_census.py` (311 lines, read in full) is the exact template PRD acceptance criteria
1 and 2 ask for. Its own stated reasoning — "a count would pass on a swap... an AST, never a grep... the
census's own correctness is covered here by a POSITIVE CONTROL (a planted bypass must be reported by
name) and its inverse" — is adopted verbatim as the design for two new modules:

- `tools/fmp_guard_census.py` + `tests/test_fmp_guard_census.py` — an AST walk over `api/**` finding
  every `requests.get`/`httpx.get` call whose URL argument contains `"financialmodelingprep.com"`
  outside `api/services/fmp_client.py`, plus every module-level function definition matching the
  `_fmp_get`/`_fmp_get_*` naming shape outside that file. Empty `QUARANTINE` dict at ship time (per the
  existing file's own convention: "keep it empty if you possibly can").
- `tools/massive_guard_census.py` + `tests/test_massive_guard_census.py` — same shape, for
  `"api.massive.com"` string literals outside `api/services/massive.py`, with an explicit,
  by-name **exemption** for the two partner-owned files (`massive_ws_worker.py`,
  `massive_processor.py`) — not a silent skip, a named entry in the census's own exemption list citing
  `GOVERNING_PRINCIPLES.md` §5, so the exemption itself is visible to the next reader rather than
  looking like an oversight.

Both new census tools require their own positive-control test (a planted bypass must be reported by
name) before either rail is trusted, per the existing file's own stated discipline against
"`0 findings` could just mean the census stopped working."

### 21.2 Typed-error unit tests (mock vendor response)

Per PRD acceptance criterion 4: each of the four leaf exception classes per vendor is independently
testable by mocking `requests.get`/the shared `httpx.Client` to return the specific response shape that
should trigger it — a 401 body for `AuthError`, a 429 for `RateLimited`, a connection-timeout exception
for `Transient`, and (per §9.5's finding) an empty-array response for `FMPNotFound` specifically (not a
404 status, since FMP does not send one) versus a `"status": "NOT_FOUND"`-shaped body for
`MassiveNotFound`.

### 21.3 Rate-limiter configuration test

Per PRD acceptance criterion 3: a unit test that sets `FMP_RATE_LIMIT_PER_MIN`/
`MASSIVE_RATE_LIMIT_PER_MIN` to a small test value, drives the bucket past it with a fake monotonic
clock (mirroring `AsyncRateLimiter`'s own injectable-clock testability pattern, §2.1, even though the
production shape is non-blocking not blocking), and asserts the Nth call is shed — then reconfigures
the env var and asserts the same test now sheds at a different N, with no code change.

### 21.4 Coverage-floor regression (PRD acceptance criterion 8)

A test that runs `provider_coverage_monitor`'s sampling cycle against the newly-registered FMP fields
(§18.1) before and after the FMP call-site migration, asserting no field's fill rate drops below its
pre-migration floor — the literal mechanism the PRD's acceptance criterion 8 names.

### 21.5 Migration implication for the existing per-caller FMP/Massive tests

`tests/` today contains at least 31 files whose names carry `fmp`/`massive`/`finnhub` (a direct
directory listing this pass ran, not an estimate) — e.g. `test_analyst_actions_fmp.py`,
`test_earnings_estimates_fmp_grades.py`, `test_insider_fmp.py`, `test_massive_market_snapshot.py`,
`test_provider_coverage_monitor.py`. Each of these currently mocks the specific module-local
`_fmp_get`/URL-construction it is testing. **Every one of them needs its mock target repointed** to
`fmp_client.<typed fn>` or the extended `_MassiveRestClient` method during the migration — this is real,
countable migration effort (§22), not a side effect the consolidation gets for free, and it is the
concrete reason §22 recommends a per-module migration order rather than a single flag-day cutover.

---

## 22. Migration implications

**Sequencing** (unchanged from the PRD's own recommendation, §5.2): FMP first (smaller surface, worse
debt-to-effort ratio, the LOCKED decision's own named proof case), Massive second. Within each vendor,
migrate one existing call site at a time, in the order: (1) repoint the call site at the new adapter
function, (2) delete the now-unused local helper once its last caller is migrated, (3) repoint that
call site's existing test (§21.5) at the new mock target, (4) re-run the AST census (§21.1) to confirm
the count of remaining direct constructions decreased by exactly one. **No flag-day cutover** — the AST
census's own `QUARANTINE` mechanism (§21.1, adopted from `test_yf_guard_census.py`'s own convention)
lets the rail exist and be green throughout a multi-PR migration, with a shrinking, named, non-growing
exemption list rather than an all-or-nothing gate that blocks every intermediate commit. This directly
avoids the "file disjointness ≠ dependency disjointness" failure class the program's own memory records
from the notebook-migration wave (a broken intermediate commit from assuming per-file changes are
independent) — the migration inventories in §9.3/§10.2 are the dependency graph that ordering follows.

**Rollback.** Each migrated call site's change is independently revertable (repoint the import back to
the deleted local helper, temporarily un-delete it) until the local helper is actually deleted in a
later commit — the design deliberately keeps "delete the old helper" as its own, later commit per call
site, not bundled with the repoint, so a single bad repoint never requires reverting the whole
migration.

---

## 23. Performance considerations

**No added latency claim, and the adapter is explicitly required to add none material** — per the ACL
pattern's own documented cost (data-architecture §3.1, §3.5, citing the Azure Architecture Center: an
ACL "adds latency... and adds an extra service you must manage"), this spec keeps both adapters as
in-process function calls, not a second network hop or a separate service — "adapter" here means a
Python module, not a sidecar. The measurable performance changes this spec introduces are all
improvements: (1) a shared connection pool per vendor (currently four independent `requests.get` calls
for FMP each pay their own TCP/TLS handshake cost per call; one `requests.Session()` reuses connections,
§9.2); (2) a token bucket that sheds excess calls **before** the network round trip, versus today's
behavior of firing the request and discovering the 429 after paying the round-trip latency; (3) the
cached-forbidden-endpoint idiom (§5.2), which stops a permanently-403ing endpoint from being retried on
every single call at all — Finnhub's own precedent already proves this is a real, measured win (the
original incident report this pattern was built for). No regression risk to existing warm-cache paths:
every existing cache wrapper around a migrated call site (§14) is untouched.

---

## 24. Acceptance criteria — technical translation of the PRD's twelve

| # | PRD criterion (§14) | This spec's concrete deliverable |
|---|---|---|
| 1 | No direct FMP client outside the adapter | §21.1's `fmp_guard_census.py` + rail; §9.3's exact eight-call-site inventory |
| 2 | No direct Massive URL construction outside the adapter | §21.1's `massive_guard_census.py` + rail; §10.2's exact 18-module inventory |
| 3 | Configurable rate limiter, both adapters | §9.4/§10.4's `FMP_RATE_LIMIT_PER_MIN`/`MASSIVE_RATE_LIMIT_PER_MIN`; §21.3's test |
| 4 | ≥4-class typed error taxonomy, independently testable | §6.5's `provider_errors.py` design; §21.2's tests |
| 5 | Provenance + freshness field on every canonical record | §6.1's `ProviderResult`; §6.2/§6.3 |
| 6 | Licensing eligibility as a lookup, not a hard-coded check | §20's `provider_licensing_class.py` |
| 7 | Status endpoint from first commit | §7.3 |
| 8 | FMP consolidation, zero coverage regression | §21.4's regression test against `provider_coverage_monitor.py` |
| 9 | Massive consolidation, zero application call-site changes beyond the one-time migration | §10.1's extend-in-place design (the class doesn't move) |
| 10 | A vendor retirement post-build is a single-adapter change | Out of this spec's own build, but §10.1's "extend, don't replace" design is exactly what makes a future Polygon-direct retirement a routing-table change inside `massive.py`, not a call-site sweep |
| 11 | No new vendor spend | Confirmed — every component in §5.4 is new code, zero new accounts/subscriptions |
| 12 | Cached-forbidden / circuit-breaker / genuine-empty distinguishable | §6.4's `degraded` field design |

---

## 25. Owner input flags (carried forward, none newly resolved)

- **OI-03(a)** — Massive plan tier. Affects §10.4's rate-ceiling default and §20's licensing-class
  table values only; the adapter code is unaffected either way.
- **OI-03(b)** — FMP DDLA existence. Affects §20's licensing-class table values only.
- **NEW, this document — the FMP and Massive per-minute rate ceilings themselves** (distinct from
  OI-03(a)'s *tier* question): neither number is stated anywhere in the accepted corpus this document
  is grounded in. §9.4/§10.4 design the config-value mechanism so this does not block the build; the
  actual starting numbers are an implementation-time judgment call flagged, not made, here.
- **D5** (product-strategy) — member-facing data-licensing posture. Unaffected by this spec's mechanism
  design, per the same reasoning as the PRD.

---

## 26. Open questions

1. **Massive's status-field values for "not found," per endpoint family** (§10.5) — this pass confirmed
   only the snapshot endpoint's `"OK"`/`"DELAYED"` pair by reading `get_single_ticker_snapshot`; the
   full enumeration across every Massive endpoint the adapter will eventually serve is implementation-
   time work.
2. **FMP's exact rate-limit response body shape** (§9.5) — whether FMP signals throttling via a
   response body pattern analogous to AlphaVantage's `"Note"`/`"Information"` keys, beyond a bare 429,
   is a live-API-read question this document's evidence ceiling does not reach.
3. **The starting numeric values for `FMP_RATE_LIMIT_PER_MIN`/`MASSIVE_RATE_LIMIT_PER_MIN`** (§25) —
   deliberately not set by this document.
4. Every open question the PRD already carries forward from `data-architecture.md` (§26.3 there):
   whether FMP exposes XBRL-tag-level granularity; whether Massive/FMP responses carry a `figi` field;
   the precise multi-security-derived vs. single-security-derived payload-shape boundary for specific
   Massive endpoints not yet named row-by-row. None are this document's to resolve, and none block the
   build this spec describes.

---

## 27. NOT INSPECTED

No vendor contract, order form, plan page, or account console (unchanged from every upstream document).
No live vendor API call was made — every FMP/Massive response-shape claim in this document is derived
from reading how the existing code already parses that vendor's responses, not from an independent probe.
The full body of `massive.py` beyond the ~140 lines read in full plus the targeted greps in §2.4/§10 was
not read line-by-line — the file is 1,346 lines; this document's claims about it are scoped to what was
actually read or grepped, named as such throughout (§2.4, §10.5's explicit "confirmed only... by this
pass's read"). `provider_coverage_monitor.py`'s full 873 lines were read only in the first ~80 lines
shown in §2.1/§5.1's citation — its per-field floor-tuning mechanics beyond what that excerpt shows were
not independently re-derived. No test in `tests/` was executed. No git command was run. No application
file was edited, created, or modified by this document or its author, per the DO NOT clause.

## SOURCES (internal, read 2026-09-02, all under `C:\Users\Patrick\uct-worktrees\terminal-research\`)

`docs/terminal-research/05-product-strategy/prds/provider-abstraction-prd.md` (in full) ·
`docs/terminal-research/12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` (D4, and the three-way D1
collision note) · `docs/terminal-research/07-technical-architecture/data-architecture.md` (§0–§4,
§9–§20, §26, §28–29, read in full across two passes) · `docs/terminal-research/05-product-strategy/
product-architecture.md` (§0, §4.2, D1 system block in §5-D, §8 boundary matrix, §10 reversibility
ledger, read in full) · `docs/terminal-research/05-product-strategy/capability-infrastructure-matrix.md`
(D1, S3 rows) · `docs/terminal-research/01-existing-system/capability-ledger.md` (rows O6, P3, D2, D12,
A1, A3, A10, A12, A13) · `docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md` (in full) ·
`docs/terminal-research/00-program-control/READINESS_REVIEW_DAY1.md` (Part 5, Part 7 D4) ·
`docs/terminal-research/13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` (in full).
Codebase (read directly by this pass, paths relative to repo root): `api/services/stripe_service.py`
(in full) · `api/services/finnhub_client.py` (in full) · `api/services/alphavantage_client.py` (lines
1–90) · `api/services/massive.py` (lines 1–140 in full; remainder grepped for `token`/`bucket`/
`"status"`) · `api/services/provider_coverage_monitor.py` (lines 1–80) · `api/services/bar_provenance.py`
(in full, 77 lines) · `api/services/journal_two/broker/snaptrade_client.py` (lines 1–100) ·
`api/services/journal_two/broker/rate_limit.py` (lines 1–60) · `api/routers/fundamentals.py` (lines
95–140) · `api/services/catalyst/analyst_actions.py` (lines 85–125) · `api/services/earnings_estimates.py`
(lines 335–375) · `api/services/transcript_indexer.py` (lines 15–50) · `api/services/insider.py` (lines
80–115) · `api/services/research/financial_history.py` (lines 1–50) · `tests/test_yf_guard_census.py`
(in full, 311 lines) · `api/limiter.py` (in full) · directory listings of `api/`, `app/src/`, `tests/`,
`tools/`, `api/services/`, `api/routers/`.

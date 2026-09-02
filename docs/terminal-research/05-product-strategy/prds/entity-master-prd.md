---
id: PRD-S3-ENTITY-MASTER
title: Security / Symbol / Entity Master — Product Requirements Document
role: Phase 3 deliverable — PRD for a LOCKED system (product-architecture.md S3; ARCHITECTURAL_DECISION_REGISTER.md D3)
phase: 3
group: product-strategy
category: prd
scope: >
  Specification, not implementation, of S3 — the Security/Symbol/Entity Master. Covers who/what
  it is for, the problem it solves, primary workflows, interaction behavior, system boundaries
  (restated from product-architecture.md, not redesigned), required data, provenance/freshness,
  entitlement/licensing, performance, dependencies, non-goals and acceptance criteria. Does not
  specify S1 (Shell), S4 (Context Bus), D2 (Canonical Data Model), or any application system —
  each is named only where S3 is its direct dependency.
confidence: 🟡 overall — 🟢 wherever this document restates a system contract already LOCKED in
  product-architecture.md or a fact directly re-verified against application source this pass; 🟡
  wherever it composes two or more accepted artifacts into one requirement; 🔴 on every item
  carrying OI-03/OI-05/OI-06 or another owner-input marker inherited from the architecture.
evidence_ceiling: >
  Inherits every ceiling of product-architecture.md, data-architecture.md and
  information-architecture.md unchanged (no observed desk morning — OI-06; no vendor contract
  seen — OI-03; no production telemetry). Adds one new, code-verified fact this pass narrows
  rather than widens a ceiling: Massive's `/v3/reference/tickers` response already carries
  `composite_figi` and `share_class_figi` (confirmed live in `api/services/polygon_extras.py`
  lines 91-92, consumed today by `api/services/voice_tool_impls.py`), which resolves
  data-architecture.md §5.2's OPEN QUESTION ("whether Massive/Polygon's reference-data endpoints
  expose FIGI ... is still not checked") in the affirmative for Massive specifically. This PRD
  does not silently correct that upstream document — see §12.
sources: product-architecture.md (S3 system block §5, boundary matrix §8, reversibility ledger
  §10) · information-architecture.md (§3.2-3.3 address space and entity page, §10 Context
  Channel, §12.1/12.3/12.5 workflow chains) · data-architecture.md (§4 canonical contracts, §5
  Symbol/Security/Entity Master, §26 F-09 integration) · capability-infrastructure-matrix.md (S3
  row, §7 provisional markers) · capability-ledger.md (rows A8, A9, C3) · provider-master-ledger.md
  (§2.1 row 1 "search/reference/symbol data", §2.2, §6 item 8) · ARCHITECTURAL_DECISION_REGISTER.md
  (D3, LOCKED) · GOVERNING_PRINCIPLES.md (§1, §5, §9, §13) · application source read this pass:
  `api/services/massive.py` (`to_polygon_symbol`), `api/routers/ticker_search.py`,
  `api/services/cap_universe.py`, `api/services/ticker_search_index.py`,
  `api/services/delisted_registry.py`, `api/services/polygon_extras.py`
status: draft — Phase 3 deliverable, awaiting review
date: 2026-09-02
provisional_markers: OI-03(a)/(b) (whether the entity master's licensing register rows resolve
  Restricted or Likely Allowed for any member-facing display of vendor-sourced reference fields);
  OI-05 (asset-class scope — the master ships type-tagged so widening is an alias-table change,
  never a rewrite); OI-06 (bears on nothing in this PRD directly — S3 has no workspace or
  command-grammar dependency, see §7)
---

# Security / Symbol / Entity Master — Product Requirements Document

## 0. How to read this document

This PRD specifies **S3 — Entity Master**, one of the four systems the Architectural Decision
Register marks **LOCKED**: "one internal permanent entity id, FIGI as the external mapping (its
permanence property, not necessarily its exact code), tickers as a dated alias list, delist/rename
marked never erased. No counter-evidence found in Phase 2 or its validation pass"
(`ARCHITECTURAL_DECISION_REGISTER.md` D3). Locked means this document specifies precisely; it does
not re-argue the decision, and it does not redesign the system boundary product-architecture.md
already drew (§5 below restates it verbatim from that source, per this phase's own instruction).

**Vocabulary** (`GOVERNING_PRINCIPLES.md` §1, binding). TERMINAL-CURRENT = the existing `/calendar`
surface, display-named "UCT Terminal" since 2026-09-01, plumbing unchanged. TERMINAL-NEXT = the
product this program designs, including S3. UT is the parent brand; UCT Intelligence is the
product. This document is specification only — no application code is touched or proposed to be
touched by this document (per its own contract's DO NOT clause); every "shall"/"must" below
describes what an implementation team builds later, in a later phase, after this PRD and its
paired technical specification are both accepted.

**Bloomberg and Gödel, used correctly.** Where this document cites a Bloomberg or Gödel mechanic
(struck-through delisted tickers, `BBGID`-style permanent identifiers) it is evidence that a
workflow is real and solvable, never a requirement UCT must clone (`GOVERNING_PRINCIPLES.md` §9:
"Bloomberg does X" never implies "UCT builds X"). No behavior in this PRD is justified solely by
"Bloomberg has it."

---

## 1. The required traceability chain

*(Per this phase's contract: explicit, concrete, not implied.)*

**ORIGINAL USER/PRODUCT NEED.** A member or desk trader acts on "a security" across a dozen
surfaces in one session — loads it on a chart, reads its fundamentals, sets an alert, journals a
trade, asks the AI layer about it, sees it on a watchlist, sees it renamed or delisted a year
later — and needs every one of those actions to refer to the *same durable thing*, even though the
ticker string that names it can change (a rename, a delisting, a relisting under a reused symbol,
a share-class rewrite that differs by vendor). Today it cannot: "a ticker-keyed store cannot
represent 'this is the same company, a different string, as of a date'"
(`domain-symbol-master-time.md` §2.1, cited by `data-architecture.md` §5.2).

**TARGET UCT TERMINAL WORKFLOW.** Every workflow chain in `information-architecture.md` §12 that
crosses more than one panel depends on this: LOAD (a bare symbol resolving to one entity that the
Context Channel then carries — IA §10.4, "a channel that remembers 'SQ' without an id will one day
load Block when the member meant Square"); the "Watchlist → security → research" chain (IA §12.1,
step 3: "timeframe/range not linked today" and step 4's entity-page rail); the "News/catalyst →
company → chart → fundamentals" chain (IA §12.2); the "Desk's prior view — the fifth perspective"
workflow (IA §12.5; product-architecture.md §1.1 sharpening 3: "the per-ticker history join... is
the data-modelling job" this system's identity half unblocks); and every historical roster that
must survive a rename or delisting without breaking (Model Book's per-year stock rosters, Theme
Tracker's historical holdings, UCT20's composition history — "stocks that rotated out still
contribute their return during holding period," already the intended behavior per `CLAUDE.md`'s
UCT20 NAV section, "but there is no symbol master underneath it yet to anchor the identity across a
rename," `data-architecture.md` §5.5).

**PRODUCT CAPABILITY.** S3 Entity Master: "Permanent internal identity for every instrument the
terminal can load; dated ticker aliases; share-class and successor/predecessor relations;
per-vendor symbol mappings; delisting marks; FIGI as the external mapping" (`product-architecture.md`
§5 S3 block, restated verbatim in §5 below).

**EXISTING UCT CAPABILITY** (cited by row id, not paraphrased from memory):
- `capability-ledger.md` row **A8** — "Ticker search / autocomplete `/api/ticker-search` + names
  prewarmer... `cap_universe.json` (3,742) + ticker_meta chain... **ticker-only; no entity search
  for screens/notes/layouts**."
- `capability-ledger.md` row **A9** — "Ticker meta + company logos `/api/ticker-meta/{sym}`,
  `/api/ticker-logo/{sym}`... logo.dev → Parqet → Clearbit → FMP profile → Finnhub profile2."
- `capability-ledger.md` row **C3** — "Link groups A/B/C/D + app focus (`useAppFocus` = charts
  Group A)... **hard ceiling of four symbol-only groups**" — the clearest evidence that context
  propagation today carries a mutable ticker string, not a permanent identity.
- `provider-master-ledger.md` §2.1 row 1 ("search/reference/symbol data") — "Massive tickers/
  conditions, FMP screener/constituents, Finviz screener universe, yfinance index symbols, SEC
  EDGAR CIK map, the logo chain — no gap, **five owners of overlapping symbol-reference data with
  no single internal symbol type**."

**GAP** (verified against application source this pass, not inferred):
1. No internal permanent entity id exists anywhere. Every downstream store — bars, watchlists,
   alerts, journal entries — is foreign-keyed to the ticker string.
2. `api/services/massive.py::to_polygon_symbol()` is a real, working, single-purpose rewrite
   (`BRK-B` → `BRK.B` at exactly the Massive REST boundary) — "the correct *tactic* at the wrong
   *altitude*... the industry problem is genuinely a many-scheme one" (`data-architecture.md`
   §5.4). It is not an entity master; it is one hand-written special case for one vendor pair.
3. `api/services/delisted_registry.py` **already implements a partial, single-purpose version of
   "mark, don't erase"** — read in full this pass. It keys a delisted entity by a distinct ticker
   string when the bare symbol has been reused by a live instrument (its own header example:
   `"BSC-OLD"` because `BSC` is now a live ETN), carries a `provider_symbol` distinct from that key,
   and clamps `[first_date, last_date]` so two eras of one reused symbol never combine into one
   chart. This is real, working evidence the mark-don't-erase pattern is sound *and* that it is
   currently solved once, locally, for one consumer (the chart's bars path) rather than once for
   the whole terminal. Its own header states the design intent directly: "Kept deliberately OUT of
   `cap_universe.json` / the live warmers... Discovery is via ticker-search merge + this registry
   only" — i.e., it is deliberately scoped, not an accident to be judged, and S3 subsumes its
   *purpose* without needing to discard its *data* (§13.2).
4. `api/services/ticker_search_index.py` already builds a name-and-type-bearing index from
   Massive's `/v3/reference/tickers` feed (read in full this pass) — a real, working precedent for
   consuming exactly the endpoint §9.1 specifies, but the index is still keyed by ticker string, not
   by a permanent id, and it is a *search* index (rebuilt from scratch daily), not an identity
   store (nothing about it is bitemporal or durable across a rename).
5. `api/services/polygon_extras.py` (read in full this pass, lines 82-108) shows Massive's
   `/v3/reference/tickers/{sym}` response **already carries `composite_figi` and
   `share_class_figi`** — fields the existing code discards for every caller except one voice tool
   (`voice_tool_impls.py`). This is new evidence this pass surfaces (§12) that materially narrows
   `data-architecture.md` §5.2's OPEN QUESTION; it does not by itself answer whether every entity
   the master must cover carries a FIGI (ETFs, indices, and futures-positioning symbols may not),
   which is why §9.1 still specifies OpenFIGI as a fallback resolver.

**PROPOSED SYSTEM.** S3 Entity Master, exactly as scoped by `product-architecture.md` §5 (verbatim
restated in §5 below) and designed by `data-architecture.md` §5.

**DATA/PROVIDER REQUIREMENTS.** §9.

**UX/INTERACTION REQUIREMENTS.** §7-§8 (S3 is a platform primitive with almost no UI of its own —
see §7.1 on why — but its resolution behavior is directly observable in the address bar, the
search box and every delisted/renamed name a member encounters).

**TECHNICAL REQUIREMENTS.** §6, §9-§11.

---

## 2. Who this system is for

**Direct consumers are systems, not people.** No member or desk trader ever "opens" the Entity
Master — it has no page, no panel, no button (§7.1). It is consumed by every other TERMINAL-NEXT
system that needs to know "which instrument is this, really" (§8's caller list, restated verbatim
from `product-architecture.md` §8's boundary matrix): the Context Bus (S4) publishing a loaded
security; the Command/Search system (S2) resolving a typed token; Persistence (S5) foreign-keying a
saved object; Alerts (S7) scoping a trigger to an instrument; the Provider Abstraction layer (D1)
translating a vendor's symbol; the Canonical Data Model (D2) keying every stored value; the
Reference/Corporate-Actions system (D5) applying a rename or delisting event; and every application
(A1-A14) that renders, links, or stores a security reference.

**Indirect beneficiary: every member and desk trader**, every time they load a security, click a
ticker, search by name, see a struck-through delisted holding in a historical roster, or read an
AI answer that cites a specific instrument. The desk is the primary audience for the *speed and
correctness* this buys (D-001, desk-first — `GOVERNING_PRINCIPLES.md` §13); members are the primary
audience for the *trust* it buys (a rename never silently corrupts a saved watchlist or a year-old
journal entry).

**Not for:** any human-facing configuration. There is no admin screen for editing entity records in
this PRD's scope — records are populated by the D1 adapter (vendor feeds) and D5 (corporate-action
events), never hand-typed (§6.5, "Must NOT own" — "a place for licensed identifiers whose terms
attach at the identifier... without a licensing-register row").

---

## 3. The problem being solved

Three concrete, evidenced failure classes, each already observed in the estate:

1. **A rename or relisting silently reassigns identity.** `data-architecture.md` §5.5 names the
   symptom directly: Model Book's `sector`/`industry` columns exist specifically because a reused
   ticker (`SQ` = Square → Block; `WTW` = Weight Watchers → Willis Towers Watson) makes the *live*
   `/api/ticker-meta/{sym}` lookup (row A9) return the *wrong* company for a historical entry, so
   the product works around it with hand-curated watermark fields per stock, per year — a
   symptom-level fix repeated per surface rather than solved once. `delisted_registry.py` (read
   this pass) independently confirms the same failure mode for Bear Stearns (`BSC` is now a live
   ETN) and solves it once, locally, for the bars path only.
2. **Cross-module context propagation carries a string, not an identity.** `capability-ledger.md`
   row C3 ("hard ceiling of four symbol-only groups") is the seed the Context Bus (S4) generalizes,
   and `information-architecture.md` §10.4 states the failure mode precisely: "a channel that
   remembers 'SQ' without an id will one day load Block when the member meant Square." Every system
   that reads S4's payload inherits this risk until S3 exists.
3. **Every vendor boundary invents its own rewrite rule instead of sharing one alias table.**
   `to_polygon_symbol()` is the evidenced case: "leaking to 41 call sites / 15 modules"
   (`provider-master-ledger.md` §2.2 row 1, cited by `product-architecture.md` §5-B.3). Nasdaq's own
   documentation independently shows "four internally-inconsistent suffix conventions for the same
   concepts within its own product family" (`data-architecture.md` §5.4, citing nasdaqtrader.com,
   fetched 2026-09-02) — this is not a UCT-specific mess to eventually clean up; it is the shape of
   the underlying problem, and a one-function-per-vendor-pair pattern cannot converge as the vendor
   count grows (48 rows in `provider-master-ledger.md` today).

**What this system is not solving.** It is not a data-quality project on prices, fundamentals, or
any priced series (§6.5). It is not a new search UI (§9's changes to A8 are additive, not a
redesign of `SymbolSearch.jsx`). It is not a licensing decision about which vendor fields may
display to a member — that is D5/S9's question, gated on OI-03(a)/(b), and untouched here except
where S3's own identifier choice carries a licensing implication of its own (§11).

---

## 4. Primary workflows and use cases

Each use case names the actor, the trigger, the S3 behavior, and the acceptance test. Every one is
traceable to a named workflow chain in `information-architecture.md` §12 or a named failure class
in §3 above — none is invented for this document.

### UC-1 — A member types a bare symbol that has been renamed since they last used it

**Actor:** member. **Trigger:** types `SQ` at the command line, or in the search box, months after
Square Inc. renamed to Block Inc. and the ticker `SQ` was reassigned or retired.
**S3 behavior:** `resolve("SQ", asOf=today)` returns the entity that currently answers to `SQ` today
(if any) — never silently returns the old Square entity for a bare, undated lookup. A member who
wants "the Square I used to own" reaches it through their own saved history (a watchlist row, a
journal entry), which was foreign-keyed to the *entity id* at save time (§6.4) and therefore still
resolves correctly regardless of what `SQ` means today.
**Acceptance test:** given a synthetic rename fixture (entity E1 aliased to `SQ` from date D1 to D2,
then to `XYZ` from D2 onward; entity E2 aliased to `SQ` from D2 onward, a *different*, later-reused
ticker), `resolve("SQ", asOf=D2+1)` returns E2, and `aliases(E1)` still lists `SQ` as valid for
`[D1, D2)` and `XYZ` as valid from `D2` onward. See `data-architecture.md` §5.5 and the Fiscal.ai /
Gödel `TREND` precedents cited there for the shape (evidence, not requirement, per §0 above).

### UC-2 — A saved watchlist row survives a rename without corruption

**Actor:** member (indirect — this is invisible when correct). **Trigger:** a member has `NVDA` on
a watchlist; the underlying company is later acquired and its ticker retired.
**S3 behavior:** the watchlist row is stored keyed by entity id (per the platform contract every
application must honor — `product-architecture.md` §3.2 rule 2: "keys every stored row by entity id
(S3), never by ticker string, and stores the ticker as a display alias with a date"). The row
continues to resolve to the correct entity and displays its most-recent-valid alias with a
delisted/renamed marker, never a blank row and never silently pointing at whatever instrument now
holds the old ticker.
**Acceptance test:** a watchlist row created before a synthetic delisting event still resolves to
the same entity id after the event; the rendered alias reflects the delisting; no other watchlist
row is affected.

### UC-3 — A vendor boundary needs a symbol in its own notation

**Actor:** the Provider Abstraction layer (D1), on behalf of any application needing bars, a quote,
or a fundamentals row. **Trigger:** an adapter needs to call Massive for entity E's daily bars, and
E's canonical ticker today is `BRK-B`.
**S3 behavior:** `vendorSymbol(entity, "massive") → "BRK.B"` — the same translation
`to_polygon_symbol()` performs today, but resolved once, centrally, from a stored per-vendor
mapping rather than a hand-written string-replace function re-run at every one of the 41 call
sites. New vendors register their own notation without touching the 41 existing call sites.
**Acceptance test:** given a synthetic dual-class fixture, `vendorSymbol(E, "massive")` returns the
dot-notation form and `vendorSymbol(E, "fmp")` returns the hyphen form, both derived from the same
underlying entity and the same stored alias, with no vendor-specific code outside D1's adapter and
S3's mapping table.

### UC-4 — A historical roster must render a delisted or renamed constituent correctly

**Actor:** the system (Model Book, Theme Tracker, UCT20 NAV composition history — all named in
`data-architecture.md` §5.5 as consumers with the exact need but no master underneath them yet).
**Trigger:** rendering a multi-year roster that includes an entity that no longer trades under its
original ticker, or at all.
**S3 behavior:** the roster's stored reference resolves to the entity; `aliases(entity)` supplies
the ticker that was valid *as of the roster's own date*, and the entity's current state (active /
delisted / renamed, with the date) is available for a "mark, don't erase" rendering treatment —
this PRD specifies the data S3 must expose for that rendering (a boolean-plus-date lifecycle state
and a successor pointer where one exists); it does not specify the rendering itself, which belongs
to the consuming application (Model Book, Theme Tracker) per the boundary in §5.
**Acceptance test:** a synthetic historical roster entry pointing at a since-delisted entity
resolves without error, with `aliases(entity, asOf=<roster date>)` returning the period-correct
ticker and the entity's current lifecycle state distinguishable from "still active."

### UC-5 — The AI layer cites a specific instrument, not an ambiguous string

**Actor:** I1 Intelligence Layer, via a registered tool. **Trigger:** a member asks the AI layer a
question that resolves to a specific security (`information-architecture.md` §12.5, "Ask about the
loaded entity").
**S3 behavior:** the tool call resolves the member's typed or context-carried token to a permanent
entity id before any downstream tool (`grade_ticker`, `flow_explain`, the Desk lens) is invoked, so
that every citation in the rendered answer traces to one, unambiguous instrument — the identity half
of the "a computed number with no addressable row cannot be cited by any mechanism" problem D2
solves for values (`product-architecture.md` §1.1 sharpening 1). S3 does not itself render anything
in the AI answer; it is the identity resolver I1's tool contract calls before D2's address book is
consulted.
**Acceptance test:** given the `RS`/`EMA`/`MA`/`GAP`/`PEG` real-ticker collision class already named
in the estate's own memory (`lesson_a_symbol_universe_does_not_settle_a_ticker_match`, cited by
`product-architecture.md` §5-B.2), a query containing one of these tokens in a context where it is
clearly the ticker (e.g., cashtag form `$RS`) resolves to the entity, and in an ambiguous bare form
is handled by S2's precedence policy (`information-architecture.md` §7.4), not invented by S3.

### UC-6 — A new listing or corporate action arrives from D5

**Actor:** D5 Reference & Corporate-Actions Data, applying a detected split, dividend, delisting,
rename, or new listing event (`product-architecture.md` §5-D D5 block: "Events applied to S3
(identity changes)"). **Trigger:** D1's adapter surfaces a new or changed record from a vendor
reference feed.
**S3 behavior:** S3 accepts a typed identity-change event from D5 (new entity, alias added, alias
retired, delisted, renamed, successor/predecessor linked) and applies it as a new bitemporal row —
never an in-place mutation of history (§6.2). S3 never fetches a vendor feed itself; it never
initiates the event; it only accepts and stores it (§6.5, "Must NOT own... a place for licensed
identifiers... without a licensing-register row" and the general platform rule that S3 has no
outbound vendor calls of its own — those belong to D1).
**Acceptance test:** replaying a sequence of synthetic D5 events (list → rename → delist) against a
fresh entity produces the exact alias history and lifecycle state the sequence implies, and
replaying the same sequence twice is idempotent (no duplicate alias rows, no corrupted history).

---

## 5. System boundary — restated from product-architecture.md, not redesigned

*(Per this phase's instruction: restate, do not redesign. Everything in this section is quoted or
directly paraphrased from `product-architecture.md` §5 S3 and §8's boundary matrix; nothing here is
this PRD inventing a new boundary.)*

### 5.1 Responsibility

"Permanent internal identity for every instrument the terminal can load; dated ticker aliases;
share-class and successor/predecessor relations; per-vendor symbol mappings; delisting marks; FIGI
as the external mapping." Answers question **(b) normalization — the identity half** of the
architecture's six-question discipline (`product-architecture.md` §0).

### 5.2 Inputs and outputs

- **Inputs.** Vendor reference feeds through D1 (Massive `/v3/reference/tickers` — "able to serve
  symbol changes," `provider-ledger.md` §5.3 Q2), an OpenFIGI mapping (§9.2), the existing
  universe gate (`cap_universe`) *as a membership input only, never an identity source*.
- **Outputs.** `resolve(alias, asOf) → entity`; `aliases(entity) → dated list`;
  `vendorSymbol(entity, vendor)`; relation queries (share-class, successor/predecessor). A
  bitemporal `asOf` parameter on every query.

### 5.3 Dependencies (who S3 calls)

D1 (Provider Abstraction — for vendor-sourced facts), D5 (Reference & Corporate-Actions Data — "a
corporate action that changes identity is a D5 event applied to S3"), S11 (Session & Market Clock —
for `asOf` semantics where a query needs "as of right now").

### 5.4 Callers (who calls S3) — restated from the boundary matrix

Per `product-architecture.md` §8's boundary matrix (S3 column, read down every row): **S2** Command/
Search (●, resolves a typed token), **S4** Context Bus (●, payloads are entity ids), **S5**
Persistence (●, entity-keyed rows), **S7** Alerts (●, scope is an entity resolved by S3), **D1**
Provider Abstraction (●, symbol mapping for vendor calls), **D2** Canonical Data Model (●, every
stored row keyed by entity), **D5** Reference Data (●, applies identity-change events),
**Applications** (●, per the platform contract every application must honor). S3 is **never** called
by S1 (Shell), S6 (Personalization), S8 (Provenance), S9 (Entitlements), S10 (Presentation), S12
(Rollout), D3 (Streaming), D4 (Caching), or I1 (Intelligence) directly — I1 reaches entity
resolution only through a registered tool that itself calls S2/S3, never a private path
(`product-architecture.md` §3.4 rule 2, §7 "Must NOT own... a private prompt path into an
application").

### 5.5 Ownership boundary and "Must NOT own" — restated verbatim

**Ownership boundary:** "Identity only."

**Must NOT own:**
- Prices, fundamentals, or membership rules — "the $300M scanner floor and $500M leadership floor
  are application constants" (`synthesis §7.2`), not S3's business.
- The market clock (S11 owns time; S3 only *consumes* `asOf` semantics from it).
- The universe file — `cap_universe` "remains a gate owned by A9's universe logic and is retired as
  an *identity* authority." S3 does not replace `cap_universe.json`; it sits underneath it as an
  identity layer the gate can reference but never the reverse.
- A place for licensed identifiers whose terms attach at the identifier (CUSIP is the named
  example — `product-architecture.md` §5, §11) without a licensing-register row. This is not
  optional polish; it is a binding constraint on §9's identifier choice.

### 5.6 Build condition (per the Architectural Decision Register and product-architecture.md)

**New.** "The clearest infrastructure gap the research found" (`READINESS_REVIEW_DAY1.md` §5); "design
work can and should start immediately; the schema locks before implementation" (§7 D3). No
counter-evidence found by any artifact through Phase 2's close. This PRD is the schema-locking
specification step that recommendation calls for.

---

## 6. Data model requirements

*(This section specifies WHAT the model must represent and the invariants it must hold — not a
literal DDL, per this phase being specification, not a technical spec. The technical specification
that follows this PRD owns the concrete schema, storage engine and migration mechanics.)*

### 6.1 The bitemporal shape

A symbol master is "a bitemporal store, not a lookup table" (`data-architecture.md` §5.1). Every
fact S3 holds about an entity is valid over a date range, and the store never overwrites a fact — it
appends a new valid-from row and closes the prior one's valid-to. Concretely, S3 must be able to
answer, for any query time `t`:

- **What entity does alias X resolve to as of t?** (a dated alias resolution — the core `resolve`
  primitive)
- **What aliases has entity E ever had, and over what date ranges?** (the `aliases` primitive)
- **What did entity E's canonical facts look like as of t?** (identity type, active/delisted state,
  successor/predecessor)

### 6.2 Required entities and relations

| Concept | Requirement |
|---|---|
| **Entity** | A permanent internal identifier, assigned once, never reused, never reassigned. Carries a type tag (equity, ETF, index, future-positioning symbol — per `information-architecture.md` §5-B.1's channel-payload kinds and OI-05's scope) and a lifecycle state (active / delisted / renamed-successor-exists) with the date of the last state change. |
| **Alias** | A dated (ticker string, valid-from, valid-to-or-null) row per entity. Multiple aliases per entity over time (renames); at most one alias may be valid (non-null valid-to, or open-ended) for a given ticker string at any single point in time across ALL entities — this is the invariant that makes `resolve` well-defined (§6.3). |
| **Vendor symbol mapping** | A (entity, vendor, vendor-native-symbol) row, dated where a vendor's own notation for the entity has changed independently of the canonical alias (rare, but the share-class dot/hyphen case is exactly this: one entity, one canonical alias `BRK-B`, two simultaneously-valid vendor notations). |
| **Relation** | Typed links between entities: `successor-of` / `predecessor-of` (a rename or a post-bankruptcy relisting under a new entity, not just a new alias, where the underlying legal entity itself changed — data-architecture.md §5.5's Fiscal.ai precedent: "a middleware redirect when a company's URL changes"), `share-class-of` (siblings, e.g. `GOOG`/`GOOGL`, or `BRK-A`/`BRK-B` if modeled as two entities rather than one — this PRD does not resolve which share-class modeling choice is correct; it requires the relation type exist so either choice is representable, and defers the concrete choice to the technical specification, which should test it against a real dual-class fixture before locking). |
| **FIGI mapping** | Where known: the entity's `composite_figi` and, where applicable, `share_class_figi` (§9.1). Stored as an *external mapping*, never as the entity's own primary key (§9.2 explains why). |

### 6.3 Invariants the store must enforce

1. **No alias collision at a point in time.** Two entities may never both hold the same ticker
   string as a currently-valid alias simultaneously. `delisted_registry.py`'s own comment states the
   corollary this system generalizes: "a live ticker is never redirected/mislabeled" by a delisted
   entity's registration.
2. **Aliases never delete; they close.** Retiring an alias sets its `valid_to`; it is never removed
   from the row. This is the mechanism behind "mark, don't erase" (§4 UC-1, UC-4).
3. **Entity ids never change and are never reused**, even for a fully delisted, decades-cold
   entity. A reused ticker string always resolves to a *new* entity with a `predecessor-of`/
   `successor-of` relation to the old one only when the underlying legal entity is genuinely
   continuous (a rename), never when it is merely the same *string* reassigned to an unrelated
   company (§6.2's `delisted_registry.py`-style distinct-key pattern is the right shape for the
   latter case, and this system's alias model subsumes it: the old entity's alias for that string
   simply closes, and a new entity opens a new alias for the same string starting from the reuse
   date).
4. **Every write is additive.** No update-in-place on a historical fact. This is required for the
   append-only guarantee UC-6's replay/idempotency test depends on.

### 6.4 What every consumer's foreign key must be

Per the platform contract (`product-architecture.md` §3.2 rule 2, restated as a binding requirement
here because it is the mechanism that makes §4's use cases work): every new TERMINAL-NEXT store that
references a security stores the **entity id**, never the ticker string, as its foreign key. The
ticker is rendered as a *display alias resolved at read time* (`resolve` in reverse: given an entity
and an `asOf`, return the alias valid then), never persisted as the join key. This is a requirement
on every *consuming* system's schema, not on S3 itself, but it is stated here because S3's data
model is worthless if consumers do not honor it (§13 covers rollout sequencing so this does not
require a fiat migration of the ~55 existing SQLite files on day one).

### 6.5 What the store explicitly does not model

Per §5.5's "Must NOT own": no price, no fundamentals field, no market-cap number, no sector/
industry classification (those belong to A3/A7's canonical schemas via D2, keyed *by* the entity
id S3 assigns, not stored *in* S3). No membership-rule logic ($300M floor, $500M floor — those are
A9's business over data S3 identifies). No calendar/session logic.

---

## 7. UX / interaction requirements

### 7.1 Why S3 has almost no UI of its own

S3 is a platform primitive (`product-architecture.md` §3.1's test: "if two applications each built
their own [identity resolution], would the product publish two answers to one question? ... it is a
platform primitive"). It has no page, no panel, no settings screen in this PRD's scope. Its entire
member-facing surface is *indirect*: every place a ticker is typed, clicked, searched, or rendered
in a historical context is where S3's correctness (or failure) becomes visible. This section
specifies that indirect surface, not a new UI.

### 7.2 Search and autocomplete (extends A8, `capability-ledger.md`)

The existing `/api/ticker-search` endpoint (`api/routers/ticker_search.py`, read this pass) already
composes several sources at query time: `ticker_search_index` (Massive-fed, name-and-type-bearing),
`breadth_symbols` (UCT pseudo-tickers), and `delisted_registry` (dead companies, already excluded
from live/streaming paths by design). This is materially closer to "entity search" than
`capability-ledger.md` row A8's own gap note ("ticker-only; no entity search for screens/notes/
layouts") suggests as of this pass — the *ticker* side of entity search already merges live and
delisted results with a working precedence rule (`delisted_registry.search`'s own comment: "a live
ticker sharing a symbol wins"). What is still missing, and what S3 must supply:

- **A stable identity behind each result row**, so that selecting a search result publishes an
  entity id to the Context Bus (S4), not a ticker string — the row already carries enough
  information (`ticker`, `type`, `delisted` flag) to be extended with an `entity_id` field once S3
  exists, without a redesign of the search index's ranking or merge logic.
- **A collision-safe rename lookup.** Today a rename produces two independent rows in the merged
  result (the live reassigned ticker from `ticker_search_index`, the old company under a distinct
  key from `delisted_registry`, per its own `_provider_alias` mechanism) — correct behavior that
  currently depends on each source independently avoiding collision. S3 becomes the single
  authority that guarantees this property structurally (§6.3 invariant 1) rather than as an
  emergent property of two independently-maintained registries agreeing by construction.
- **Extending the search to non-ticker entity kinds** (saved objects, content) remains
  `information-architecture.md` §7.2's job (S2's federating search), not S3's — S3 supplies entity
  resolution as one *input* to that broader search, not the search itself.

### 7.3 The address bar / entity page (extends `information-architecture.md` §3.2-3.3)

Per IA §3.2's address scheme: "The symbol is an *alias* of a permanent entity id (D3); the URL
carries the alias for humans and resolves through the master." S3's interaction contract with the
address system is exactly the `resolve`/`aliases` primitive pair: a URL like `/t/NVDA` resolves
`NVDA` to an entity via S3, and the canonical alias rendered back to the member (in the entity
page's banner, per IA §10.3's "entity page banner... the entity, its as-of, its lifecycle state")
comes from `aliases(entity, asOf=now)`. This PRD does not specify the entity page itself (S1's/the
applications' job); it specifies that the entity page's identity data comes from these two S3 calls
and nowhere else.

### 7.4 Rendering "mark, don't erase" — a data requirement, not a rendering spec

S3 must expose enough state for a consuming application to render a delisted or renamed entity
distinctly (struck-through, labeled "delisted as of DATE," redirected to a successor) — the
lifecycle state and date from §6.2, plus any successor relation. **How** that renders (Gödel's
`TREND` strikethrough, a badge, a banner) is each consuming application's decision, per the
boundary in §5; this PRD requires only that the data needed to make that decision exists and is
queryable.

---

## 8. Interaction behavior — the primitive surface, precisely

Per `product-architecture.md` §5's "Primitives exposed," specified here to interface-signature
precision (types, not implementation):

| Primitive | Signature (illustrative) | Behavior |
|---|---|---|
| `resolve` | `resolve(alias: string, asOf: datetime \| "now") → Entity \| Ambiguous \| NotFound` | Given a ticker string and a point in time, return the one entity whose alias table has that string valid at that time. Per §6.3 invariant 1, this is never ambiguous *within* S3 itself for a well-formed store — an `Ambiguous` result signals a data-integrity defect (two entities claiming the same alias at the same time), not a normal outcome, and must be distinguishable from `NotFound` (the string never resolved to anything, ever) so callers (S2 in particular) can render the right message per `information-architecture.md` §7.4's "'No match' and 'cannot resolve' are different results." |
| `aliases` | `aliases(entity: EntityId, asOf?: datetime) → AliasRecord[]` | Given an entity id, return its full dated alias history, or (with `asOf`) the single alias valid at that time. |
| `vendorSymbol` | `vendorSymbol(entity: EntityId, vendor: VendorId, asOf?: datetime) → string \| null` | Given an entity and a vendor id (from D1's adapter registry), return that vendor's native notation. `null` when the vendor has never carried this entity (a valid, expected outcome — not an error). |
| Relation queries | `relatedTo(entity: EntityId, kind: "successor" \| "predecessor" \| "share-class") → Entity[]` | Given an entity, return related entities of the requested kind. Empty array is a valid, common outcome (most entities have no relations). |

**Every primitive carries `asOf` semantics.** A caller that omits `asOf` gets "as of right now"
(consuming S11's clock per §5.3's dependency), never an undefined or provider-dependent "current"
notion.

**Error and ambiguity handling is a first-class contract, not an afterthought.** Per
`product-architecture.md` §3.2 rule 4 (the platform-wide rule that "402 reads 'not entitled,' 5xx
reads 'down,' and empty reads 'empty'" applied to S3's specific outcome space):

| Outcome | Meaning | Caller-visible contract |
|---|---|---|
| `NotFound` | The alias has never, at any point in S3's history, resolved to any entity | Distinct from `Ambiguous`; a caller renders "unknown symbol," never a blank result |
| `Ambiguous` | A data-integrity defect — two entities both claim validity for the same alias at the same time | This is a **defect signal**, not a normal outcome; it must be logged/alertable so the defect is fixed at the data layer, never silently arbitrated by picking one at the query layer (arbitrarily choosing one hides the defect from whoever should fix it) |
| A resolved `Entity` with a `delisted`/`renamed-successor-exists` lifecycle state | The alias resolved, but the entity is not currently tradeable | The caller renders this per §7.4 — S3 never hides a non-active entity behind a "not found" |
| `vendorSymbol(...) → null` | This vendor has never carried this entity | Valid outcome, not an error — a caller must not treat `null` as a failure requiring retry |

---

## 9. Required data

### 9.1 The primary source: Massive `/v3/reference/tickers`

Already integrated (D1's Massive adapter surface today, consumed via `api/services/massive.py` and
`api/services/polygon_extras.py`, and separately via `api/services/ticker_search_index.py`'s daily
rebuild). Per §1's GAP finding, **this response already carries `composite_figi` and
`share_class_figi`** — verified this pass in `api/services/polygon_extras.py` lines 91-92, currently
read but not persisted or used as an identity anchor by any consumer except one voice tool. S3's
build must:
- Persist `composite_figi`/`share_class_figi` where present, as the FIGI mapping (§6.2), not as the
  entity's primary key (§9.2).
- Not assume every entity type carries a FIGI — Massive's reference feed is equities/ETF-scoped;
  index and futures-positioning symbols (in scope per OI-05's current default — see §11) may need a
  different or absent FIGI mapping, which the entity's type tag and a nullable FIGI field both
  already accommodate (§6.2).
- Treat `active`/`delisted_utc` fields (already read by `api/services/massive.py`'s
  `get_ticker_types`-style calls per its own docstring, "result dicts: {ticker, type, list_date,
  delisted_utc, name, cik, composite_figi, ...}") as one input to the lifecycle-state determination,
  not the sole authority — D5's corporate-action events are the authoritative trigger for a state
  change (§4 UC-6), and a vendor's own `active` flag is corroborating evidence, not the write path.

### 9.2 OpenFIGI as the fallback identifier resolver

Per `data-architecture.md` §5.2-5.3: FIGI is free, MIT-licensed, and its defining permanence
property ("once a FIGI is assigned, it never changes throughout the trade lifecycle") is exactly
the property S3 needs — but "UCT has no current vendor relationship that hands it FIGI values for
free" *except* Massive's reference endpoint, which this pass shows already does for the entities it
covers (§9.1). Where Massive does not carry a FIGI for an entity S3 must still identify (an index, a
delisted pre-2003 name imported via CSV per `delisted_registry.py`'s own documented second data
source), OpenFIGI's free public mapping service is the fallback. **This PRD does not require FIGI
codes to be user-facing** — "the transferable idea is the permanent-key / mutable-alias split, not
necessarily adopting FIGI codes as user-facing identifiers" (`data-architecture.md` §5.2) — FIGI is
stored purely as an external corroborating mapping and a licensing-safe join key candidate (§11),
never displayed to a member in place of the ticker.

### 9.3 The internal entity id itself

Per §5.5 and §11: the entity id's own generation scheme (UUID, an internal auto-increment sequence,
or a FIGI-derived opaque key) is a technical-specification decision, not a product decision — this
PRD requires only that it be (a) UCT-internal or a licensing-safe free identifier (never CUSIP,
§5.5, §11), (b) never reused, (c) never exposed to a member as the primary way of referring to a
security (the ticker alias is; §7.3).

### 9.4 Existing seeds to build on, not replace

Per §1's GAP finding (verified this pass): `cap_universe.json` (row A8's membership list, stays a
gate per §5.5 — S3 does not replace it, it sits underneath it), `ticker_meta_cache` (row A9's name/
logo cache, remains the source for display metadata *other than* identity — company name, sector,
logo — which S3 does not own per §6.5), `ticker_search_index.py`'s Massive-fed index (the search
surface S3's identity layer plugs into, per §7.2), and `delisted_registry.py`'s seed data
(`api/data/delisted_tickers.json`, `delisted_tickers_bulk.json`, and its runtime overlay file) —
this is real, curated delisted-entity data already collected from Massive's `active=false` census
plus manually-imported pre-2003 names, and it is the natural seed corpus for S3's initial delisted-
entity population rather than a from-scratch import (§13.2).

### 9.5 D5's role — the ongoing feed, not a one-time seed

Per `product-architecture.md` §5-D D5: corporate-action events (splits, dividends, delistings,
renames) are D5's business, applied to S3 as identity-change events (§4 UC-6). S3's *permanent*
design does not itself poll a vendor for rename/delist events on an ongoing basis — that
responsibility, and its own provider requirements (Massive `/v3/reference/{splits,dividends,tickers}`,
"the ONE Massive row whose external-publication column is already LA" per `product-architecture.md`
§5-D), belong to D5.

**9.5.1 Interim stopgap, explicitly authorized (added during Phase 3 validation).** D5 is not yet
specified or built. Without *some* ongoing feed, S3 goes stale the day after its one-time seed run —
a real, member-visible defect (a delisted name stops rendering "delisted," a renamed one resolves to
the wrong entity), not a theoretical one. S3's technical spec is authorized to build a narrow,
explicitly-temporary reconciliation job (delist/new-entity detection only — **rename detection stays
out of scope, exactly as §9.5 already excludes it**, since rename detection needs D5's real
corporate-action feed to do responsibly) as a bridging measure, on these conditions: (a) it is named
and documented as an interim D5 substitute wherever it appears, never as S3's permanent design: (b)
it is retired the day D5 ships and re-pointed at D5's real feed; (c) it does not expand S3's own
scope beyond identity-state bookkeeping. This is the same time-boxed-exception pattern the Provider
Abstraction Layer spec uses for its own D2 dependency (`product-architecture.md` §10's reversibility
ledger) — apply it consistently, not as a one-off.

---

## 10. Intelligence / AI behavior

S3 has no AI behavior of its own — it is a deterministic lookup and storage system, not a
model-backed one. Its relationship to the Intelligence Layer (I1) is exactly the identity-resolution
step in UC-5 (§4): I1's tools resolve a member's typed or context-carried token to an entity id via
S2/S3 *before* invoking any domain tool, so that every citation in a rendered AI answer traces to
one unambiguous instrument. This is a **precondition** I1's tool contract must honor
(`product-architecture.md` §7 I1 block: "reads applications only through registered tools... never a
private prompt path"), not a capability S3 itself computes. No LLM call, prompt, or generative
behavior is part of this system.

---

## 11. Entitlement / licensing considerations

Per §5.5's binding constraint and `data-architecture.md` §5.3, the entity id's own identifier choice
is itself a licensing decision, not merely a schema one:

- **CUSIP is excluded by design.** CUSIP Global Services' terms "prohibit maintain[ing] a master
  file or database of CUSIP descriptions or numbers... for yourself or any third-party recipient"
  (`data-architecture.md` §5.3, citing cusip.com). Building the cross-vendor symbol-mapping table
  this PRD specifies (§6.2) could itself be the licensed act if CUSIP were the chosen internal join
  key. It is not an option for S3's primary key or its vendor-mapping table under any circumstance
  this PRD's scope covers.
- **FIGI is the recommended external mapping** precisely because it is free and MIT-licensed
  (§9.2), and Massive's reference endpoint already surfaces it for the entities it covers at no
  additional licensing cost beyond the existing Massive relationship (§9.1) — this is new,
  code-verified evidence this pass adds that narrows the licensing question favorably (no new
  vendor contract is implied by adopting FIGI as the external mapping, for the subset of entities
  Massive already covers).
- **ISIN's licensing posture is explicitly unresearched** (`data-architecture.md` §5.7,
  `domain-symbol-master-time.md` §2.2 OPEN QUESTION) — this PRD does not use ISIN anywhere in S3's
  design and flags that any future consideration of ISIN as an identifier "should verify that
  vendor's specific permanence and licensing claims rather than inheriting FIGI's reputation by
  association."
- **S3 itself carries no member-facing display-licensing risk**, because it stores and serves
  identity metadata (an id, dated aliases, a FIGI mapping), never priced or display-restricted
  content. The licensing register's OI-03(a)/(b)-gated rows (`capability-infrastructure-matrix.md`
  §7) govern whether Massive's *other* reference fields (name, sector, market cap — read via the
  same `/v3/reference/tickers` response S3 partially consumes) may display to a non-desk member;
  that gate is S9's (Entitlements) business over D2-addressed fields, not S3's. **S3's own outputs
  (an entity id, an alias string, a lifecycle state) carry no separate licensing gate** — they are
  UCT-internal identifiers and dated tickers, not vendor-proprietary content.
- **PROVISIONAL / OWNER INPUT REQUIRED: OI-05.** The asset-class scope (whether futures-positioning
  symbols, indices, and any instrument type beyond US equities/ETFs need entity coverage) is
  owner-input-bound per the standing register. S3's type-tagged entity model (§6.2) means widening
  scope later is an alias-table addition, never a schema rewrite (`product-architecture.md` §1.3:
  "this file designs the Entity Master so widening later is an alias-table change").

---

## 12. Data provenance and freshness expectations

Every S3-served fact (a resolved entity, an alias, a vendor mapping) carries a provenance trail
consistent with the platform-wide contract S8 (Provenance & Freshness) renders: which vendor feed
(via D1) or which D5 event supplied the fact, and when. This PRD does not specify S8's rendering
component — it specifies that S3's stored facts carry enough structure (a source, a timestamp, an
event lineage) for S8 to render a receipt over them, per the general platform rule that "no local
'no data'" and every value traces to a source (`product-architecture.md` §3.2 rules 3-4).

**A note on this PRD's own provenance discipline, made explicit per this program's evidence
standard.** §1's GAP finding #4 (Massive's reference response already carries `composite_figi`/
`share_class_figi`) is a fact this PRD verified directly against application source this pass — it
is not restated from `data-architecture.md`, which recorded the same question as an unresolved OPEN
QUESTION. This PRD does not silently correct that upstream document (doing so from inside a PRD
would itself be the "second-authority-over-one-value" defect this program repeatedly flags,
`product-architecture.md` §3.1); it surfaces the finding here, cited to the exact file and lines
verified, and flags it as an owner/orchestrator-visible finding worth folding into
`data-architecture.md`'s own next revision (see the structured summary's `owner_input_flags`).

---

## 13. Loading, error, empty, degraded states — and migration/rollout sequencing

### 13.1 Runtime states

| State | Trigger | Required behavior |
|---|---|---|
| **Cold start / empty store** | S3 has no data yet (first deploy) | `resolve` returns `NotFound` for everything rather than raising; consumers (S2 in particular) must degrade to the pre-S3 ticker-string behavior during this window, never crash — this is the same "empty because new" vs "empty because unreadable" distinction `information-architecture.md` §15 rule 4 requires generally, applied to S3's own bootstrap |
| **Partial population** (some entities seeded, ongoing backfill) | Normal operating state during rollout (§13.2) | `resolve` for a not-yet-seeded ticker falls back to the pre-existing ticker-string path (§13.2's coexistence rule), never a hard failure |
| **D1 adapter unreachable** (Massive reference endpoint down) | Vendor outage | S3 continues serving from its already-stored data (it is a store, not a live pass-through); it does not block on a live vendor call for `resolve`/`aliases`/`vendorSymbol` under normal operation — those are reads against S3's own store, populated asynchronously by D1/D5, never a synchronous vendor call on the read path. A stale-but-available store is the correct degraded behavior, not an error |
| **Ambiguous result** (data-integrity defect, §8) | Two entities both claim the same alias validity window | Logged as a defect, alertable to the observability system (S12); never silently arbitrated |
| **Alias collision on write** (D5 event would create the invariant-6.3-1 violation) | A D5 event's alias assignment would overlap an existing valid alias for a different entity | Rejected at the write boundary with a named reason, not silently accepted and left to become a future `Ambiguous` read; this is the write-side enforcement of §6.3 invariant 1 |

### 13.2 Migration and rollout — scoped to new classes first, per D2's own decision

Per `data-architecture.md` §4.5 (D2's own migration-scope decision, which this PRD adopts for S3 by
the same reasoning): S3 does **not** require a fiat migration of the ~55 existing SQLite files or
every existing ticker-string foreign key on day one. The build sequence:

1. **Seed** S3 from the existing, real data already in the estate (§9.4): `cap_universe.json` for
   active membership, `ticker_search_index.py`'s Massive-fed data for names/types/FIGI where
   present, `delisted_registry.py`'s seed + bulk + overlay files for the initial delisted-entity
   population. This is a data-migration task, not a vendor-integration task — every source is
   already in the repository.
2. **New TERMINAL-NEXT stores** (the Workspace Document, S5's saved objects, any new
   TERMINAL-NEXT-native table) foreign-key to entity ids from their first commit (§6.4), per the
   platform contract.
3. **Existing stores migrate opportunistically**, exactly as `data-architecture.md` §4.5 recommends
   for D2: "migrating an existing SQLite file to the canonical schema only when it is touched for an
   unrelated reason (the `bars.db` precedent: it was not migrated by fiat, it grew into the
   pattern)." This PRD does not require or schedule a big-bang migration of watchlists, alerts, or
   journal entries to entity-id foreign keys; it requires that the *capability* to do so exists and
   that every *new* consumer uses it from day one.
4. **`to_polygon_symbol()` and `delisted_registry.py`'s `_provider_alias` mechanism are retired
   incrementally**, not deleted on S3's arrival — per §5.5's "functioning infrastructure is not
   replaced for tidiness" (`product-architecture.md` §11 "Kept" principle, applied here by
   extension): they continue to serve their current call sites correctly until each is migrated to
   call `vendorSymbol`/`resolve` instead, at which point the special-case code is deleted, not
   before.

### 13.3 What "degraded" never means for S3

S3 never silently returns a *wrong* entity to avoid returning `NotFound` or `Ambiguous`. Guessing is
explicitly worse than an honest refusal here, because a wrong resolution corrupts every downstream
system that trusts it (watchlists, journal entries, alerts) — this is the same discipline
`information-architecture.md` §7.4 states for the command line ("'No match' and 'cannot resolve' are
different results... never an empty page") applied at the identity layer where the cost of being
silently wrong is highest.

---

## 14. Performance expectations

| Operation | Target | Basis |
|---|---|---|
| `resolve(alias, asOf)` on the hot path (search autocomplete, command-line resolution, Context Bus publish) | Sub-10ms typical, comfortably inside the existing 150ms client debounce on `/api/ticker-search` (`capability-ledger.md` row A8) and `ticker_search_index.py`'s own stated "sub-10ms" substring scan over ~15K rows | It is a store lookup, not a computation or a vendor call (§13.1); it must not become the slow step in a chain that today already resolves this fast for the ticker-string case |
| `aliases(entity)` for a full history | Fast enough to render an entity page banner and a historical roster row without a visible stall — no numeric target set by this PRD in the absence of production telemetry (per this program's evidence standard, no invented number); the technical specification should set one against a measured row-count distribution |
| Bulk seed / backfill (§13.2 step 1) | An offline/background job, not a request-path operation; no latency requirement, only a completeness and idempotency requirement (re-running the seed must not duplicate or corrupt existing rows) |
| D5 event application (§4 UC-6) | Applied asynchronously, off any member-facing request path — a rename or delisting event is not time-critical at millisecond granularity |

**No capacity-envelope number is asserted here** that the architecture itself does not already
carry — per `product-architecture.md` §12 risk 4, "every fan-out and panel-count number is an
assumption until D-05 measures," and this PRD does not invent a new one for S3 specifically. S3's
read path is a lookup against an in-memory-or-locally-cached store, not a fan-out concern of the
same shape as D3's streaming envelope.

---

## 15. Dependencies

| Dependency | Direction | What S3 needs from it | What it needs from S3 |
|---|---|---|---|
| **D1 — Provider Abstraction** | S3 depends on D1 | Vendor-sourced reference facts (Massive `/v3/reference/tickers`, including `composite_figi`/`share_class_figi`), symbol-translation requests routed *to* S3's `vendorSymbol` rather than reimplemented per-adapter | `vendorSymbol` resolution so a new adapter never writes its own rewrite rule |
| **D5 — Reference & Corporate-Actions Data** | S3 depends on D5 | Typed identity-change events (§4 UC-6) as the authoritative trigger for alias/lifecycle changes | S3 as the identity layer D5's events apply to |
| **S11 — Session & Market Clock** | S3 depends on S11 | `asOf` = "now" semantics for undated queries | — |
| **S2 — Command, Search & Navigation** | S2 depends on S3 | — | `resolve` for typed-token resolution |
| **S4 — Context Bus** | S4 depends on S3 | — | Entity ids as the typed `entity` payload kind (`information-architecture.md` §10.1) |
| **S5 — Persistence & User State** | S5 depends on S3 (indirectly, via every application) | — | Entity ids as the foreign key every new saved object uses (§6.4) |
| **S7 — Alerts & Monitoring** | S7 depends on S3 | — | `resolve` for scoping a trigger to an entity |
| **D2 — Canonical Data Model** | D2 depends on S3 | — | Every stored value keyed by entity id (`product-architecture.md` §5-D D2: "every row keyed by entity") |
| **I1 — Intelligence Layer** | I1 depends on S3 (via S2, never directly — §5.4) | — | Unambiguous entity resolution before any citation-bearing tool call (§10) |
| **Applications (A1-A14)** | Applications depend on S3 | — | Entity resolution for any new stored reference (§6.4); `resolve`/`aliases` for rendering |

---

## 16. Explicit non-goals

Restated and consolidated from §5.5's "Must NOT own" plus this program's own anti-drift discipline:

1. **Not a data-quality or pricing system.** S3 holds no price, no fundamentals value, no computed
   metric. Those are D2's business, keyed *by* S3's identity, never stored *in* S3.
2. **Not the universe/membership gate.** `cap_universe.json` and its $300M/$500M floors stay owned
   by the applications that use them; S3 does not decide who is "in the universe," only who "is
   this instrument."
3. **Not the market clock.** S11 owns time; S3 consumes it.
4. **Not a licensed-identifier host.** CUSIP is excluded by design (§11); this is not revisited by a
   future technical specification without a new licensing-register row.
5. **Not a new search UI.** §7.2's changes to A8 are additive to the existing search index and
   ranking logic, not a redesign.
6. **Not a migration mandate on the ~55 existing SQLite files.** §13.2 explicitly scopes rollout to
   new consumers first, per the same reasoning `data-architecture.md` §4.5 applies to D2.
7. **Not an admin UI for hand-editing entity records.** Records are populated by D1 (vendor feeds)
   and D5 (corporate-action events) only (§2, "Not for").
8. **Not a multi-asset-class expansion by default.** OI-05 (asset-class scope) remains
   owner-input-bound (§11); this PRD ships the type-tagged model that makes widening reversible,
   not a decision to widen.
9. **Not an AI or LLM-backed system.** No generative behavior anywhere in S3 (§10).
10. **Not a redesign of Terminal-Current's `/api/calendar` contract or any partner-owned file.**
    S3's entity model is consumed by A5's coexistence layer and never by editing
    `/api/calendar` or any GOVERNING_PRINCIPLES §5 partner-owned file directly.

---

## 17. Acceptance criteria

Each criterion is testable against a synthetic fixture (no production data required, per
`GOVERNING_PRINCIPLES.md` §4's protection rail — this PRD proposes no test that touches `C:\data` or
any production volume).

1. **AC-1 (rename).** Given a synthetic rename fixture (entity E1: alias `SQ` valid `[D1, D2)`,
   alias `XYZ` valid `[D2, ∞)`), `resolve("SQ", asOf=D1+1)` returns E1 and `resolve("XYZ", asOf=D1+1)`
   returns `NotFound`; after D2, `resolve("XYZ", asOf=D2+1)` returns E1 and `resolve("SQ", asOf=D2+1)`
   returns `NotFound` or a different entity if the ticker was reused (per UC-1's acceptance test).
2. **AC-2 (delisting, mark-don't-erase).** Given a synthetic delisting fixture, `resolve` continues
   to return the entity for the alias valid at any historical `asOf` before the delisting date;
   `aliases(entity)` never drops the historical alias row; the entity's lifecycle state reflects
   `delisted` with the correct date.
3. **AC-3 (no alias collision).** A write that would create two entities with an overlapping-valid
   alias for the same ticker string is rejected at write time (§13.1), never silently accepted.
4. **AC-4 (vendor symbol translation, functional parity with `to_polygon_symbol`).** Given the
   `BRK-B`/`BRK.B` dual-class fixture, `vendorSymbol(entity, "massive")` returns `"BRK.B"` and the
   entity's canonical alias remains `"BRK-B"`, matching `to_polygon_symbol()`'s current documented
   behavior (verified against `api/services/massive.py` this pass) with no vendor-specific code
   outside the D1 adapter and S3's stored mapping.
5. **AC-5 (idempotent D5 event replay).** Replaying an identical sequence of identity-change events
   against S3 twice produces byte-identical resulting state (no duplicate alias rows, no drifted
   lifecycle state) — the idempotency requirement UC-6 states.
6. **AC-6 (ambiguity is surfaced, never arbitrated).** A deliberately-constructed data-integrity
   defect (two entities both claiming a currently-valid alias — reachable only by bypassing the
   write-time guard in AC-3, e.g. in a test fixture that seeds directly) causes `resolve` to return
   `Ambiguous`, distinguishable in type from both a successful resolution and `NotFound`, and is
   observable by S12 (per §13.1).
7. **AC-7 (cold-start safety).** With an empty S3 store, `resolve` for any alias returns `NotFound`
   without raising, and a caller (simulated S2) can fall back to pre-existing ticker-string behavior
   without a crash (§13.1).
8. **AC-8 (asOf correctness across the full primitive surface).** For every primitive in §8's table,
   an explicit historical `asOf` and an implicit "now" produce results consistent with the
   bitemporal fixture's known-correct state at those two points in time.
9. **AC-9 (no licensing-restricted identifier).** A static review of the technical specification
   that follows this PRD confirms the chosen internal entity-id scheme is not CUSIP-derived and
   carries no CUSIP-license-triggering behavior (§11) — this is a review-time, not a runtime,
   acceptance criterion.
10. **AC-10 (existing consumers unaffected during rollout).** Per §13.2, `to_polygon_symbol()`,
    `delisted_registry.py`, `ticker_search_index.py`, and `cap_universe.py` continue to function
    exactly as today for any call site not yet migrated to S3's primitives — a partial rollout must
    never regress an existing, working behavior (this is the "protection rail" discipline applied to
    S3's own build, not a new requirement invented for this PRD).

---

## 18. Open questions

Carried forward, not resolved by this PRD (per this phase's instruction that PROVISIONAL items stay
open and named, never silently decided):

- **OI-05 (asset-class scope).** Whether futures-positioning symbols, indices, and any instrument
  type beyond US equities/ETFs need entity coverage at launch, or whether the type-tagged model
  simply needs to *accommodate* future widening without requiring it day one. §11, §16 item 8.
- **Share-class modeling choice (§6.2).** Whether `GOOG`/`GOOGL` (and `BRK-A`/`BRK-B`, if modeled
  distinctly from the vendor-notation case in §6.2) are one entity with two simultaneously-valid
  aliases, or two entities linked by a `share-class-of` relation. This PRD requires the relation
  type exist so either choice is representable; it defers the concrete choice to the technical
  specification, tested against a real dual-class fixture.
- **Whether every entity type this system must cover reliably carries a FIGI via Massive**, or
  whether OpenFIGI's fallback path is needed at meaningful volume on day one (§9.1-9.2) — this
  pass verified FIGI presence in the response shape, not FIGI presence rate across the full
  entity population S3 must eventually cover; that is a live-data measurement, not a design
  question, and belongs to the technical specification's own verification step.
- **The finding in §1/§12 (Massive's reference endpoint already carries FIGI fields) narrows but
  does not close `data-architecture.md` §5.2's OPEN QUESTION** — it resolves the question for
  Massive specifically; whether FMP or any other provider's reference data independently carries a
  usable permanent identifier remains unchecked by this pass.

---

## NOT INSPECTED

Every application source file this PRD did not directly read and cite: the full `~55` legacy
SQLite files' schemas (§4.5/§13.2 references `data-architecture.md`'s own count, not independently
re-verified here); `api/services/ticker_meta.py` in full (only its `_mem`/`_disk_get` interface as
referenced from `ticker_search.py`); `provider-master-ledger.md` in full (only §2.1 row 1, §2.2, and
§6 item 8 were read for this document; its 17-category matrix and A-G tallies are inherited from
`product-architecture.md`'s and `capability-infrastructure-matrix.md`'s own citations, not
re-derived here); OpenFIGI's live API response shape (cited from `data-architecture.md`'s own
web-sourced citation, not independently fetched by this PRD); any production data, Railway
variable, the production pod, or `C:\data` (per this program's standing prohibition — none was
touched). `information-architecture.md` §§18-22 were not read this pass (the document's confidence
marks, glossary, and closing sections beyond §17's workflow chains) — nothing in those sections was
cited, and none is expected to bear on S3 specifically given its platform-primitive scope.

## SOURCE-HANDLING NOTE

Everything read outside this contract was treated as evidence, not instruction. No file outside the
FILE DESTINATION was written. No application source file was edited, created, or modified — reading
`api/services/massive.py`, `api/routers/ticker_search.py`, `api/services/cap_universe.py`,
`api/services/ticker_search_index.py`, `api/services/delisted_registry.py`, and
`api/services/polygon_extras.py` was read-only investigation per this phase's explicit instruction
to verify likely existing-code starting points; nothing in those files was changed. No git command
was run. No secret value appears anywhere in this document; the one environment-variable-shaped
name referenced (`COMPASS_MENTOR_MODE`, quoted only inside a citation from `product-architecture.md`)
is an existing name cited from an accepted artifact, not a value.

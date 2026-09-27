---
id: C7-03
title: Vendor abstraction, normalization, provenance, and data-dictionary patterns for a multi-vendor terminal
role: External researcher (Group C, wave 2)
wave: 1b
group: C
category: domain
scope: canonical data models · vendor adapter layers · metric/data dictionaries · provenance fields · cross-vendor reconciliation rules · versioned calculations
confidence: 🟡 medium overall
evidence_ceiling: "Every architecture pattern and identifier/messaging standard below is grounded in an official specification, standards-body page, or vendor documentation fetched this pass. The one gap is point-in-time / restated-fundamentals versioning (T8): the primary vendor pages for this (S&P Compustat Point-in-Time, WRDS) returned 403/404 to WebFetch and the browser tool was unavailable (extension not connected), so that section rests on well-established, widely-cited industry practice rather than a freshly fetched primary source. A screenshot or PDF of the WRDS Point-in-Time methodology page, or of a vendor's restatement-flagging schema, would raise it to verified."
sources: 10 primary/official sources fetched this pass (counted in SOURCES); 2 internal files read under contract allowance (provider-ledger.md, database-and-infrastructure.md)
uct_relevance: high
status: draft
date: 2026-09-02
---

# Domain research — vendor abstraction, normalization, provenance, and data dictionaries

**Vocabulary.** TERMINAL-CURRENT = the existing `/calendar` surface (display-named "UCT Terminal"). TERMINAL-NEXT = the product this program designs. Benchmarks below are sources of learning, not specifications — "standard X does Y" never implies "TERMINAL-NEXT must adopt Y."

**Note on source handling.** WebSearch was unavailable this pass (shared-session cap exhausted per the program preamble) and the browser extension for in-tab search was not connected. Every external claim below comes from a direct `WebFetch` of a named URL (mostly successful; failures are logged in GAPS) rather than from a search-results page. No fetched page contained text directed at the fetching agent (no prompt-injection observed).

---

## 1. The problem this domain covers, stated plainly

A financial terminal that pulls prices, fundamentals, options data, news and corporate actions from more than one vendor faces four separable problems that the finance-data industry has spent three decades building standards and patterns around:

1. **Identification** — the same instrument, company, or counterparty has a different symbol/code at every vendor. Something has to be the join key.
2. **Shape** — the same fact (an EPS estimate, a trade, a settlement instruction) arrives in a different schema from every vendor. Something has to be the one internal shape.
3. **Trust** — every value needs to answer "where did this come from, when, and how was it derived" before a person or a downstream calculation can rely on it.
4. **Time** — a "fact" like a reported quarterly revenue number is not fixed; it gets restated, and a calculation run today must be able to say honestly what was known *as of* a given date, not what is known now.

These four map directly onto the contract's four nouns: canonical data models / adapter layers (problem 2), metric dictionaries (problem 1 + 2 combined — a shared vocabulary), provenance fields (problem 3), and versioned calculations (problem 4). Reconciliation rules across vendors are the operational glue needed whenever more than one vendor answers problems 1–4 differently for the same fact.

---

## 2. TOPIC — Vendor-neutral instrument identification is a standards problem, not an engineering one

**OBSERVATION.** The industry's answer to "every vendor has a different symbol for the same instrument" is not a translation table you build once — it is a body of competing identifier standards with different governance, cost, and licensing shapes, and a terminal's choice among them is itself an architecture decision with legal consequences.

- **FIGI (Financial Instrument Global Identifier)**: a 12-character, semantically meaningless, randomly generated ID "covering hundreds of millions of active and inactive instruments," issued under the Object Management Group (OMG) as a formal open standard, with Bloomberg as the appointed Registration Authority. OpenFIGI's own framing is that firms use it to "tie together disparate and fragmented symbologies, eliminate redundant mapping processes, streamline the trade workflow and reduce operational risk" — i.e., it exists specifically to be the vendor-neutral join key across a multi-vendor stack. It is free, MIT-licensed for reuse, and explicitly positioned as "the first and only open data standard for the unique identification of financial instruments" [S1].
- **CUSIP**, by contrast, is a *closed*, licensed identifier: CUSIP Global Services (CGS), operated by FactSet on behalf of the American Bankers Association, states plainly that a licensee may not "maintain a master file or database of CUSIP descriptions or numbers for yourself or any third-party recipient," nor "publish or distribute in any medium the CUSIP database or any information contained therein or summaries or subsets thereof to any person or entity" [S2]. A terminal that stores CUSIPs as an internal join key — even without displaying them — is taking on a redistribution-shaped licensing obligation, not just a data-modeling one.
- **LEI (Legal Entity Identifier)**: the counterparty/entity-level analogue to FIGI. A 20-character code under ISO 17442, administered by GLEIF (a Swiss non-profit) under G20/Financial Stability Board oversight, explicitly built to answer "who is who" and "who owns whom" across jurisdictions and vendors, and — unlike CUSIP — "available free of charge to all users" through open APIs and bulk files [S3].

**EVIDENCE.** [S1] openfigi.com/about, fetched 2026-09-02, tier: official standards-body/vendor page, class: verified. [S2] cusip.com/identifiers.html, fetched 2026-09-02, tier: official (CUSIP Global Services), class: verified — direct quotation of the redistribution clause. [S3] gleif.org "Introducing the LEI", fetched 2026-09-02, tier: official (GLEIF/ROC), class: verified.

**INTERPRETATION.** The instrument-identifier layer of a multi-vendor terminal is not a free design choice between "use whatever the primary vendor gives us" and "build our own." Free, open, vendor-neutral identifiers (FIGI, LEI) exist specifically for this join-key role and cost nothing; the licensed alternative (CUSIP/ISIN family) carries redistribution and storage restrictions that attach the moment the identifier — not the underlying market data — is persisted and shared.

**RELEVANCE TO UCT.** This is not hypothetical for TERMINAL-NEXT — it is a live gap today. The internal provider ledger (F-03b) documents that Massive's own symbol-normalization boundary (`BRK-B`→`BRK.B`) is supposed to happen at exactly one function (`massive.py:40`) but "leaks to 41 call sites / 15 modules" because nothing enforces that every caller goes through the boundary [provider-ledger.md row 1, 1B row 1]. That is precisely the failure mode a vendor-neutral identifier layer (or, short of that, a single enforced normalization chokepoint) exists to prevent. TERMINAL-NEXT's symbol-master design (a sibling contract, C7-02) is the place this gets solved; this file's contribution is naming FIGI/LEI as the standards that already exist for it, free, so "build our own opaque internal ID" is not the only alternative to "leak vendor symbol quirks everywhere."

**CONFIDENCE.** 🟢 — three independent official sources, each read directly.

**RECOMMENDATION (hypothesis).** TERMINAL-NEXT's internal symbol-master table should carry a FIGI (or an internally-generated FIGI-shaped opaque key) as its primary key, with every vendor symbol (Massive, FMP, Finviz, Schwab, yfinance) stored as a *mapped alias* rather than letting any one vendor's symbol form act as the join key — the current implicit design, per the ledger, is "Massive's symbol form, leaking."

**OPEN QUESTION.** Does UCT's Massive/FMP/Finviz vendor mix already include FIGI in any response payload (several are Polygon-descended and typically expose a `figi` field), such that this is a zero-cost mapping exercise rather than a new lookup dependency? Not determined by this pass — would need a live API response read, out of this contract's scope.

---

## 3. TOPIC — The Anti-Corruption Layer: the named pattern for "one adapter per vendor, isolated from the core"

**OBSERVATION.** The software-architecture literature has a specific, named pattern for exactly the shape a multi-vendor data platform needs: an **Anti-Corruption Layer (ACL)**, first described by Eric Evans in *Domain-Driven Design* and documented as a standard pattern in Microsoft's Azure Architecture Center. Its own framing: "Isolate the different subsystems by placing an anti-corruption layer between them. This layer translates communication between the two systems... you can keep one system unchanged without compromising the design and technological approach of the other." It exists precisely because "these legacy systems [or external systems] often have quality problems like convoluted data schemas or obsolete APIs... [and] similar problems can arise with any external system that your development team doesn't control" [S4].

The documentation is explicit that this is a *translation* boundary, not a business-logic boundary: "Avoid placing business rules or orchestration in the layer" when the systems are semantically similar, and it names a concrete cost — "the anti-corruption layer adds latency to calls... and adds an extra service that you must manage and maintain" — plus an explicit lifecycle question: "consider whether the anti-corruption layer... is permanent or whether you plan to retire it after you migrate."

**EVIDENCE.** [S4] learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer, fetched 2026-09-02, tier: official documentation (Microsoft Learn / Azure Architecture Center), class: verified.

**INTERPRETATION.** The pattern's own name is a value judgment worth taking seriously: an application that lets an external vendor's data shapes, quirks, and error semantics leak past a single translation boundary is described in the standard literature as *corrupted* by that vendor, not merely coupled to it. The pattern also explicitly generalizes beyond legacy-system migration to "any external system that your development team doesn't control" — which is every one of the ~48 providers in UCT's own ledger.

**RELEVANCE TO UCT.** The provider ledger gives a direct, measured instance of the absence of this pattern: FMP is reached through **"six independent helpers"** (`routers/fundamentals.py:111 _fmp_get`, `catalyst/analyst_actions.py:96 _fmp_get`, `earnings_estimates.py:344 _fmp_get`, `transcript_indexer.py:25 _fmp_get`, `insider.py:89 _fmp_get_insider`, `research/financial_history.py:38 _fmp`) each with "its own timeout and error policy; a burst in one consumer is invisible to the others" [provider-ledger.md row 4, 1B row 4]. Massive is worse — "20+ modules build `api.massive.com` URLs themselves" outside the one intended client class [provider-ledger.md row 1]. In ACL terms: UCT has zero anti-corruption layers for its two most-used vendors today; it has one partial one (`_MassiveRestClient`, `finnhub_client.py`'s `fh_get`) that most of the calling code routes around. The one exception the ledger names as well-shaped is Finnhub's client — "the best-shaped guard in the repo": a single chokepoint (`finnhub_client.py:233 fh_get`) with a token bucket, reactive cooldown, and a 24h-cached-forbidden state for endpoints that started 403ing [provider-ledger.md 1B row 6]. That module is the internal precedent to generalize, not a pattern to import from outside.

**CONFIDENCE.** 🟢 — primary pattern documentation, cross-checked against the internal ledger's own concrete counter-example.

**RECOMMENDATION (hypothesis).** Every vendor in TERMINAL-NEXT's roster gets exactly one adapter module (an ACL) that owns retries, timeouts, error taxonomy, and symbol/field translation; nothing outside that module constructs a vendor URL or parses a vendor response shape directly. `finnhub_client.py`'s shape (token bucket + reactive cooldown + cached-forbidden state) is the internal reference implementation to copy, not a new pattern to invent.

**OPEN QUESTION.** Is the six-helper FMP shape and the 20+-module Massive shape a historical accident (grew organically, one call site at a time) or a deliberate choice to avoid a single point of failure? Not determined by this research — an owner/engineering question, not a domain-research one.

---

## 4. TOPIC — The Canonical Data Model pattern: why N vendors need ONE internal schema, not N adapters translating pairwise

**OBSERVATION.** The Enterprise Integration Patterns catalog (Gregor Hohpe & Bobby Woolf — the standard reference for this class of pattern, cited across the systems-integration literature) names the **Canonical Data Model**: "design a Canonical Data Model that is independent from any specific application. Require each application to produce and consume messages in this common format." The documented reason is combinatorial, not stylistic — its own worked example: with 2 applications, direct pairwise translation needs 2 translators; with 6 applications it needs 30; a canonical model needs only 12 (one adapter per system, in and out) — "the solution quickly pays off as the number of applications increases" [S5].

**EVIDENCE.** [S5] enterpriseintegrationpatterns.com/patterns/messaging/CanonicalDataModel.html, fetched 2026-09-02, tier: official pattern-catalog site (the canonical reference for the Hohpe/Woolf integration-patterns vocabulary used industry-wide), class: verified.

**INTERPRETATION.** This is the formal justification for *why* an adapter-per-vendor design (§3) is not sufficient on its own — the adapters must all translate into and out of one shared internal schema, or the platform has just moved the N×N translation problem one layer down (N adapters, each secretly assuming a slightly different internal shape). The pattern's combinatorics apply directly to a terminal's provider count: UCT's ledger already names 48 provider rows; a platform anywhere near that count without one canonical schema is well past the point where pairwise translation "pays off" to formalize.

**RELEVANCE TO UCT.** The database-and-infrastructure survey (D-04) gives the structural symptom of the *absence* of a canonical model: "**≈55 distinct SQLite database files**... There is no Postgres, no MySQL, no ORM, and no migration framework anywhere in the stack... one SQLite file per feature, opened directly with `sqlite3.connect` at ~200 call sites. There is no connection pool, no schema registry, and no single place that knows what the data model is" [database-and-infrastructure.md §1.1]. That is the canonical-data-model gap made concrete: 286 distinct `CREATE TABLE` names across the codebase, no shared vocabulary enforcing that "close price" or "EPS estimate" means the same typed thing in two different files. The one partial counter-example the survey names is `bars.db`, which the survey itself flags as "the *pattern to copy* if TERMINAL-NEXT needs a large, read-mostly dataset served from more than one pod: one writer service, R2 as the bus, newer-wins merge on the readers" [database-and-infrastructure.md §1.2] — a real, working instance of one-schema-many-consumers, but scoped to bars only, not fundamentals, options, or provenance.

**CONFIDENCE.** 🟢 pattern documentation; 🟢 the internal counter-evidence (D-04's own file/table counts are code-derived, not estimated).

**RECOMMENDATION (hypothesis).** TERMINAL-NEXT's data platform should define one canonical schema per data class (quote, bar, fundamental line-item, estimate, corporate action, news item) before any second vendor is wired to a class — not after, when N adapters already assume N different shapes. `bars.db`'s writer/bus/merge design is the internal precedent for the transport half of this; nothing in the current stack is a precedent for the schema half.

**OPEN QUESTION.** Would a canonical schema be introduced by fiat across the ~55 existing SQLite files (a large, risky migration) or scoped only to NEW TERMINAL-NEXT data classes, leaving the legacy dashboard's per-feature files alone? This is a scope decision for the owner/engineering team, not resolvable by domain research.

---

## 5. TOPIC — Industry-standard message/data-interchange formats are prior art for "the one internal shape"

**OBSERVATION.** Two long-running standards effectively *are* canonical data models at industry scale, and either can be read as prior art for field-naming and structure even where a terminal doesn't adopt the wire format itself.

- **FIX Protocol**: an "open, technology-neutral specification" governed by the independent non-profit FIX Trading Community, that "enable[s] seamless, reliable communication across the full trade lifecycle from pre-trade and execution to clearing, settlement and reporting," functioning as "a common language enabling interoperability across vendors and counterparties... without requiring custom point-to-point integrations" [S6]. FIX's tag/field vocabulary (e.g., a stable, numbered field for "last price," "order quantity," "settlement date") is exactly the kind of metric dictionary the contract asks about, just scoped to order/trade messages rather than reference/fundamental data.
- **ISO 20022** is the analogous standard for payments/settlement messaging, maintained by ISO and built around a formal "business data dictionary" of shared business elements that different systems map into — this is well-established industry practice, but this pass could not reach a live iso20022.org page (two fetch attempts timed out; a Bing fallback surfaced only the general ISO.org site, not the standard's own registry pages), so this specific claim is carried at reported/practitioner-knowledge confidence rather than freshly verified.

**EVIDENCE.** [S6] fixtrading.org/standards, fetched 2026-09-02, tier: official (FIX Trading Community), class: verified. ISO 20022: NOT independently verified this pass (see GAPS) — reported from established industry knowledge, confidence downgraded accordingly.

**INTERPRETATION.** Neither standard is a candidate for TERMINAL-NEXT to adopt wholesale (FIX is trade/order-lifecycle-shaped, ISO 20022 is payments-shaped; a terminal's data platform is reference/market-data-shaped, which neither directly covers). Their relevance is narrower and more honest: both demonstrate, at an industry scale far larger than one firm's terminal, that a *stable, numbered/named field vocabulary shared across every producer and consumer* is the mechanism that makes "vendor A's price" and "vendor B's price" comparable without per-pair translation — which is exactly the Canonical Data Model claim in §4, evidenced at a much larger scale.

**RELEVANCE TO UCT.** Low direct applicability (UCT is not a FIX counterparty or a payments processor) but useful as a naming-convention reference when TERMINAL-NEXT's canonical schema (§4) is actually specified: FIX's discipline of one stable field per concept, independent of any vendor's field name, is worth copying even without the protocol.

**CONFIDENCE.** 🟢 FIX (primary source read directly); 🟡 ISO 20022 (not independently verified this pass — see GAPS).

**RECOMMENDATION (hypothesis).** Treat FIX's field-dictionary discipline (one stable name/id per business concept, versioned, vendor-independent) as a naming-convention reference for TERMINAL-NEXT's canonical schema — not as a protocol to implement.

**OPEN QUESTION.** None beyond the ISO 20022 verification gap already logged.

---

## 6. TOPIC — Standardized taxonomies already exist for the one data class TERMINAL-NEXT most needs a dictionary for: fundamentals

**OBSERVATION.** Fundamentals/statement data is not an area where a terminal has to invent its own metric dictionary from scratch — the SEC has *mandated* a machine-readable, taxonomy-based tagging standard (XBRL) for every US public-company filer since 2018, and that mandated structure is exactly a canonical data dictionary for financial-statement line items.

- **XBRL** is described by its governing body, XBRL International (a non-profit consortium, "operating in the public interest"), as "the global standard that powers digital reporting," used in 65 countries, "freely licensed, open standard available to all." Its core mechanism is **taxonomies**: standards-setters "create... dictionaries" that assign a stable tag/concept to each reportable line item, so that "business data can be exchanged easily and accurately" across tools that never agreed on a schema with each other directly [S7].
- **The SEC mandate** (Inline XBRL, Release No. 33-10514, adopted 2018-06-28) requires operating companies to tag cover pages and financial statements in Forms 10-Q, 10-K and registration statements, investment funds to tag risk/return summaries, and self-regulatory organizations/broker-dealers/swap entities to tag specific annual-report forms — in a single filed document that is simultaneously human-readable (HTML) and machine-readable (the XBRL tags), not a separate exhibit [S8].
- **FIBO** (Financial Industry Business Ontology) is the broader semantic layer above XBRL's statement-line-item scope: a machine-readable ontology, hosted by the EDM Council and standardized through OMG, that gives "meaning to any data... that describe the business of finance," explicitly built to "enable cross-system federation and aggregation of data" and normalize entity/instrument/data structures for "cross-vendor interoperability" [S9].

**EVIDENCE.** [S7] xbrl.org/the-standard/what/what-is-xbrl, fetched 2026-09-02, tier: official (XBRL International), class: verified. [S8] sec.gov/data-research/structured-data/inline-xbrl, fetched 2026-09-02, tier: official (U.S. SEC), class: verified — includes the mandate release number and phase-in scope. [S9] spec.edmcouncil.org/fibo, fetched 2026-09-02, tier: official (EDM Council / OMG), class: verified.

**INTERPRETATION.** Every fundamentals vendor UCT touches (FMP, Finnhub's `/stock/metric`, yfinance's `.info`) is, underneath, re-deriving its own field names from the *same* SEC-mandated XBRL tags every filer already produces. That means a canonical "fundamentals" schema for TERMINAL-NEXT does not need to be invented from a blank page — the XBRL US-GAAP taxonomy (and, for non-financial-statement concepts, FIBO) is a public, standards-body-governed dictionary that already answers "what is the one true name and definition for this line item," independent of any vendor's own field-naming choice.

**RELEVANCE TO UCT.** The internal survey shows UCT already reconciles cross-vendor disagreement on exactly this class of data with ad hoc, per-field rules rather than a shared dictionary: FMP's `stable/earnings` sometimes returns two rows for one report (a consensus row and an alternate figure), resolved by a hand-written `_earn_row_preferred` function [provider-ledger.md 1B row 4, from CLAUDE.md's ModelBook section]; FMP's `historical-chart` timestamps are "ET local text" that must be parsed as such, not UTC, a bug class UCT has already been bitten by once (`_fetch_intraday_fmp`, CLAUDE.md's Bars Correctness Layer section). These are exactly the class of disagreement a shared canonical dictionary (with an explicit, typed field for "as-reported vs. estimate," "fiscal period end," "timezone-qualified timestamp") is built to make structural rather than per-bug-fixed.

**CONFIDENCE.** 🟢 — three independent official/regulatory sources, cross-checked against UCT's own documented fundamentals bugs.

**RECOMMENDATION (hypothesis).** TERMINAL-NEXT's fundamentals canonical schema should borrow XBRL's concept names (or a documented mapping to them) for statement line items rather than adopting any one vendor's field names as the internal standard — this converts "FMP calls it X, Finnhub calls it Y" into a translation-at-the-boundary problem (§3's ACL) instead of a proliferation of per-field special cases through the application.

**OPEN QUESTION.** Does FMP's own API expose XBRL-tag-level granularity (it is SEC-filing-derived), such that mapping to XBRL concepts is a matter of reading FMP's existing response fields rather than a new lookup? Not determined by this pass.

---

## 7. TOPIC — Provenance is a formal, typed data model in its own right — not a comment or a log line

**OBSERVATION.** The contract asks specifically about "provenance fields." Two standards answer this directly, at two different layers:

- **W3C PROV** is a W3C Recommendation defining "a common language" for "information about entities, activities, and people involved in producing a piece of data or thing, which can be used to form assessments about its quality, reliability or trustworthiness." Its model has three core, reusable concepts — **Entities** (the thing whose provenance is tracked), **Activities** (the process that produced or transformed it), **Agents** (who or what was responsible) — designed explicitly so provenance can be exchanged across systems instead of "lock[ed] in proprietary formats" [S10].
- **OpenLineage**, a Linux Foundation AI & Data Foundation project, is the modern operational instantiation of the same idea for data *pipelines* specifically: "an extensible specification that systems can use to interoperate with lineage metadata," built around **Datasets** (inputs/outputs), **Jobs** (the processing step), and **Runs** (one execution of a job), with an explicit extensibility mechanism — **facets** — defined as "user-defined metadata [that] enables entity enrichment" without forking the core spec [S11]. Its stated motivation is that, before a shared spec, "each data platform had to build custom metadata collection integrations independently, duplicating work."

**EVIDENCE.** [S10] w3.org/TR/prov-overview, fetched 2026-09-02, tier: official (W3C Recommendation), class: verified. [S11] openlineage.io/docs, fetched 2026-09-02, tier: official (LF AI & Data Foundation project documentation), class: verified.

**INTERPRETATION.** The pattern both standards converge on is the same: provenance is not "which vendor" as a single string column bolted onto a value — it is a typed record of *what produced the value* (an activity/job/run), *from what* (an entity/dataset), *when*, and *under whose responsibility* (an agent), kept separable from the value itself so it can be queried, audited, and propagated through downstream derivations. A single "source" text field (the shape most ad hoc systems reach for first) answers "which vendor" but not "which specific fetch, when, against what upstream state, healed how" — the four questions a reconciliation dispute or an audit actually needs answered.

**RELEVANCE TO UCT.** UCT already has two purpose-built tables that are, structurally, a narrow instance of exactly this pattern: `bar_provenance` and `quarantined_bars`, both owned by dedicated modules (`api/services/bar_provenance.py`, `api/services/bar_quarantine.py`) and both — notably — stored in `auth.db` rather than beside `bars.db` [database-and-infrastructure.md §1.2, "Tables other modules add to the SAME file"]. That is real, working provenance infrastructure for exactly one data class (bars); it has no counterpart for fundamentals, options, or news, where the provider ledger instead records disagreements as narrative prose in per-provider rows (e.g., FMP's `_earn_row_preferred` tie-break, §6 above) rather than as a queryable provenance record. The ledger's own evidence-class scheme (KP/CR/OC/CA plus `code-only`/`config-recorded`/`dated-probe`/`live-read` — [provider-ledger.md preamble]) is itself a hand-built, ad hoc provenance vocabulary for *what evidence exists that a provider is actually in use* — a second, parallel instance of the same underlying need (typed claims about where a fact came from and how sure anyone is) solved independently and without reference to either standard above.

**CONFIDENCE.** 🟢 — both are primary, currently-maintained standards documentation, read directly.

**RECOMMENDATION (hypothesis).** TERMINAL-NEXT's provenance model for every data class (not just bars) should carry, per stored value: a source-activity reference (which adapter/job/run produced it — PROV's Activity / OpenLineage's Run), a source-entity reference (which upstream vendor payload it was derived from — PROV's Entity / OpenLineage's Dataset), a timestamp, and — where more than one vendor can answer the same field — an explicit tie-break record, not a silent overwrite. `bar_provenance.py` is the internal shape to generalize; the ledger's own KP/CR/OC/CA evidence ladder is a second internal precedent worth formalizing into the same schema rather than left as prose in a markdown table.

**OPEN QUESTION.** None — this section's evidence is solid; the open question is one of scope (which data classes get provenance tracking first), an engineering-priority call outside this research's remit.

---

## 8. TOPIC — Point-in-time / restatement-aware versioning of calculated values (evidence-ceiling section)

**OBSERVATION.** The contract asks about "versioned calculations." The best-known instance of this problem in finance data is the **look-ahead bias** class: a reported financial-statement figure (e.g., quarterly EPS) is frequently *restated* after its original filing, and a naive "latest known value" join silently lets a backtest or a live calculation use information that was not actually available on the date being evaluated. The industry's standard mitigation is **point-in-time data**: storing each reported value together with the date it was *known* (not just the date it applies to), so a query can be constrained to "as of date D, what was believed to be true" rather than "what is believed to be true now." S&P Capital IQ's Compustat Point-in-Time dataset (accessed academically via WRDS) is the best-known commercial instance of this pattern, widely cited in the academic asset-pricing literature that studies look-ahead bias.

**EVIDENCE.** This pass could not independently verify a primary source for this claim: the WRDS Compustat Point-in-Time methodology page returned 404, and the S&P Global Market Intelligence product page returned 403, to `WebFetch`; the browser-search fallback specified in the program preamble was unavailable this pass (the Chrome extension was not connected — see GAPS). This section is therefore carried at **reported** evidence class: it reflects well-established, widely-cited practitioner/academic practice in quantitative finance, not a freshly fetched primary document.

**INTERPRETATION.** Even without a fresh primary citation, the underlying mechanism (store the "as-known-on" timestamp alongside the "applies-to" period, never overwrite a prior value in place, and expose an explicit "as of" query parameter) is a direct extension of the provenance model in §7 (a value's Activity/Run timestamp answers "when was this known") plus explicit versioning (never overwrite; append a new row with a new as-known-on date on restatement).

**RELEVANCE TO UCT.** This is a real, present gap for TERMINAL-NEXT if it does anything with fundamentals beyond display — the internal record shows UCT's fundamentals pipeline already has to hand-guard against a *related but distinct* bug (duplicate/conflicting rows for one report period from a single vendor, `_earn_row_preferred`, §6) but nothing in the surveyed code touches the *restatement-over-time* problem: whether a later-corrected FMP or Finnhub figure silently replaces an earlier one in cache, with no record that the earlier value was ever believed true. Any TERMINAL-NEXT feature that back-tests a strategy, computes a historical win-rate against "what the numbers said at the time" (the Compass coaching layer's `setup_winrate`/`find_historical_analogs` tools, per CLAUDE.md's Compass Brain Bridge section, are exactly this shape), or shows "what changed since the last time you looked" needs this distinction to be trustworthy.

**CONFIDENCE.** 🔴 — reported/practitioner-knowledge only, not independently verified this pass. This is the section's named evidence ceiling.

**RECOMMENDATION (hypothesis).** Before TERMINAL-NEXT builds any feature that computes a historical statistic over fundamentals or scores a past setup against "what was known then," confirm explicitly whether the underlying store versions restatements or silently overwrites — this determines whether such features are trustworthy by construction or need a point-in-time layer added first.

**OPEN QUESTION.** What would raise this section's confidence: a successful fetch of the WRDS Compustat Point-in-Time methodology page (currently 404 to WebFetch — may require a different URL or a logged-in session), or a direct read of one vendor's (FMP's) own restatement-handling documentation, which this pass did not attempt separately from the general product pages already covered in the provider ledger.

---

## 9. TOPIC — Licensing is inseparable from the abstraction boundary, not a separate later concern

**OBSERVATION.** §2's CUSIP evidence generalizes into a structural point worth stating on its own: a canonical/vendor-neutral layer is not merely a technical convenience — for at least one widely-used identifier family, the *licensing terms attach at the identifier itself*, independent of what data is displayed around it. CUSIP's terms prohibit maintaining "a master file or database of CUSIP descriptions or numbers... for yourself or any third-party recipient" [S2, §2 above] — meaning the mere act of building the kind of cross-vendor symbol-mapping table that §2–§4 recommend could itself be the licensed act, if CUSIPs (rather than a free identifier like FIGI) are the join key chosen.

**EVIDENCE.** [S2] as cited in §2, re-read for this point.

**INTERPRETATION.** This is a direct instance of a pattern the internal provider ledger already documents at scale for market data itself: "**Personal-tier terms on paid-product surfaces**: Massive (if Individual), FMP (no DDLA), Finnhub, AlphaVantage, Schwab and Reddit all publish a cheap tier that is personal/non-commercial and all sell the compliant one" [provider-ledger.md §1B "INTERPRETATION"]. The identifier layer is not exempt from this — it is one more thing that can be "personal-tier" (CUSIP) or genuinely free-to-redistribute (FIGI, LEI), and the choice has to be made with the same rigor UCT's own ledger already applies to market-data vendors, not treated as a purely technical decision because "it's just a symbol table."

**RELEVANCE TO UCT.** Directly actionable: when TERMINAL-NEXT's symbol master (C7-02) or canonical schema (§4 above) is designed, the identifier chosen as the internal join key should be checked against this same licensing lens the ledger already uses for Massive/FMP/Finviz — free/open (FIGI, LEI, ticker+exchange-MIC composites) vs. licensed-with-redistribution-limits (CUSIP, ISIN's underlying ANNA-DSB terms, which this pass did not separately research) — rather than assumed safe because it "is just an ID, not a price."

**CONFIDENCE.** 🟢 on the CUSIP evidence itself; 🟡 on the generalization to ISIN (not independently researched this pass — noted in GAPS).

**RECOMMENDATION (hypothesis).** Treat the internal symbol master's choice of primary key as a licensing decision, not only a schema decision, and route it through whatever process the program already uses for provider licensing calls (the E-pod's classification scheme, per the provider ledger's own citations) rather than deciding it inside a purely technical design doc.

**OPEN QUESTION.** Whether ISIN (the other globally dominant instrument identifier, allocated by National Numbering Agencies under ANNA/ANNA-DSB) carries CUSIP-shaped redistribution restrictions or a more open posture was not researched this pass and would need its own targeted look before a final identifier choice.

---

## GAPS

- **ISO 20022** (§5): two direct `WebFetch` attempts to `iso20022.org` timed out; a Bing-search fallback did not surface the standard's own registry pages. Channel used: WebFetch on known URL (failed ×2), WebFetch on Bing (returned no on-target result). Not resolved this pass.
- **Point-in-time / restated-fundamentals versioning** (§8): WRDS Compustat Point-in-Time page 404'd; S&P Global Market Intelligence product page 403'd. Channel used: WebFetch on two known URLs (both failed); the browser-search fallback specified in the preamble (§ "Search budget", step 2) could not be used because `mcp__claude-in-chrome__tabs_create_mcp` reported the Chrome extension not connected — no tab was ever opened, so no tab needed closing.
- **ISIN / ANNA-DSB licensing posture** (§9): not researched this pass; flagged as an open question rather than a gap in a completed section, since §9's core claim (about CUSIP) stands independent of it.
- **WebSearch**: not attempted, per the preamble's guidance that the shared session cap was already exhausted by earlier roles in this wave.
- No FDC3 (desktop interop) or exchange-specific market-data-agreement research was attempted — out of this contract's scope (vendor abstraction/normalization/provenance/dictionary, not UI interop or exchange fee schedules, which are covered by other contracts in this wave per the provider ledger's own E-pod citations).

## SOURCES

1. OpenFIGI — "About" — https://www.openfigi.com/about — tier: official (OMG standards body / Bloomberg as Registration Authority) — fetched 2026-09-02 — class: verified.
2. CUSIP Global Services — "Identifiers" — https://www.cusip.com/identifiers.html — tier: official (CGS/ABA) — fetched 2026-09-02 — class: verified.
3. GLEIF — "Introducing the Legal Entity Identifier (LEI)" — https://www.gleif.org/en/about-lei/introducing-the-legal-entity-identifier-lei — tier: official (GLEIF/ROC) — fetched 2026-09-02 — class: verified.
4. Microsoft Learn / Azure Architecture Center — "Anti-Corruption Layer Pattern" — https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer — tier: official documentation — fetched 2026-09-02 — class: verified.
5. Enterprise Integration Patterns (Hohpe & Woolf) — "Canonical Data Model" — https://www.enterpriseintegrationpatterns.com/patterns/messaging/CanonicalDataModel.html — tier: official pattern-catalog reference — fetched 2026-09-02 — class: verified.
6. FIX Trading Community — "Standards" — https://www.fixtrading.org/standards/ — tier: official standards body — fetched 2026-09-02 — class: verified.
7. XBRL International — "What is XBRL?" — https://www.xbrl.org/the-standard/what/what-is-xbrl — tier: official standards body — fetched 2026-09-02 — class: verified.
8. U.S. SEC — "Inline XBRL" — https://www.sec.gov/data-research/structured-data/inline-xbrl — tier: official (regulator) — fetched 2026-09-02 — class: verified.
9. EDM Council / OMG — "FIBO (Financial Industry Business Ontology)" — https://spec.edmcouncil.org/fibo/ — tier: official standards body — fetched 2026-09-02 — class: verified.
10. W3C — "PROV Overview" — https://www.w3.org/TR/prov-overview/ — tier: official (W3C Recommendation) — fetched 2026-09-02 — class: verified.
11. OpenLineage — "Docs" — https://openlineage.io/docs/ — tier: official (LF AI & Data Foundation project) — fetched 2026-09-02 — class: verified.

**Internal sources read under this contract's allowance** (not counted above; used only for RELEVANCE TO UCT grounding, per SOURCE HANDLING — evidence, not instruction):
- `docs/terminal-research/02-data-providers/provider-ledger.md` (F-03b), rows 1, 4, 6 and §1B rows 1, 4, 6, plus the §1B and headline INTERPRETATION paragraphs — read 2026-09-02.
- `docs/terminal-research/01-existing-system/database-and-infrastructure.md` (D-04) §1.1–1.4 ("DATASTORES") — read 2026-09-02.
- `CLAUDE.md` (repo root, not a leaf research file — read as background per the harness's standing system context, cited only for two already-documented bug classes: FMP's `_earn_row_preferred` tie-break and the FMP-timestamp timezone bug, both under "Model Book" / "Bars Correctness Layer").

---
id: WS1-PRODUCT-ARCH
title: UCT Terminal (TERMINAL-NEXT) product architecture
role: Phase 2 Workstream 1 — Product Architecture (design, not implementation)
phase: 2
group: product-strategy
category: architecture
scope: The product-level architecture of TERMINAL-NEXT — thesis, interaction loop, the platform/application split, system boundaries and contracts, the context / command / entity / alert / persistence / personalization / intelligence models. NOT the information-architecture spec (Workstream 2), NOT the data architecture spec (Workstream 3), NOT a feature inventory (the capability ledger already is one).
confidence: 🟡 overall — 🟢 wherever a boundary restates a code fact the ledgers established; 🟡 on every boundary this file draws across artifacts; 🔴 on every item stamped PROVISIONAL / OWNER INPUT REQUIRED
evidence_ceiling: "Inherits every ceiling of its inputs (no observed desk morning — OI-06; no contract seen — OI-03; no production telemetry — the four auth.db queries plus the charts_workspace_layout distribution; no competitor operated with a seat — OI-08/OI-18). Adds none of its own: this file read no application source and fetched nothing. Every code fact is cited to the capability ledger (row id), the provider ledger (row number), the tech-debt register (TD id) or a named leaf section. Where a claim looked surprising or oddly specific it was spot-checked against the underlying file (D-13 counts, the 154-tool registry, the FIGI/ACL/PROV sources) — noted inline."
sources: READINESS_REVIEW_DAY1.md · DAY_1_EXECUTIVE_SYNTHESIS.md (F-06, post-QC) · GOVERNING_PRINCIPLES.md · DECISION_LOG.md · RESEARCH_GAPS.md · OWNER_INPUTS_REQUESTED.md · OPEN_QUESTIONS.md · capability-ledger.md (F-03a, rows A1–P11) · provider-ledger.md (F-03b, rows 1–48, §2–§4, §7) · tech-debt-register.md (TD-01–TD-63) · domain-data-platform.md (C7-03) · domain-symbol-master-time.md (C7-02 §0, §1.1, §1.7, §6) · workspace-systems-survey.md (C5-01 §0, §7, §10) · command-grammars.md (C4-01 §10–§11) · personalization-patterns.md (C5-02 §9) · grounding-architectures.md (C6-02 §4, §5, §9) · domain-news-intelligence.md (C2-01 §10) · state-persistence-and-workspaces.md (D-11 §7) · existing-ai-systems.md (D-12 §3e, §8)
status: draft — Phase 2 deliverable, awaiting review
date: 2026-09-02
provisional_markers: D1 workspace final lock · D2 command-grammar default · D5 member-facing licensing posture (OI-03a/b) · D8 corporate-actions and portfolio-risk build timing · D9 decisiveness for two audiences · OI-05 asset-class scope · OI-12 commercial model · OI-17 open-endpoint intent · OQ-14 canonical earnings-date authority · the four telemetry queries plus the charts_workspace_layout distribution (sequencing of personalization and the curated-vs-feed posture)
---

# UCT Terminal (TERMINAL-NEXT) — product architecture

**Vocabulary (GOVERNING_PRINCIPLES §1, mandatory).** TERMINAL-CURRENT = the existing `/calendar` surface, display-named "UCT Terminal" since 2026-09-01, plumbing unchanged. TERMINAL-NEXT = the product this document architects. UT is the parent brand; UCT Intelligence is the product. Neither surface is renamed, re-plumbed or touched by this document; it is design only, per the Phase 2 authorization and the Phase Zero protection rail (GOVERNING_PRINCIPLES §4, §10).

**What this is.** A product architecture: the thesis, the loop, the split between what the terminal *is* and what *runs inside it*, and a bounded set of systems with explicit contracts and explicit prohibitions. It answers "what are the parts, what does each own, and what may it never own." It does not answer "which grid library" (C5-03), "which schema" (Workstream 3), or "which pixel" (Workstream 2).

**What this is not.** Not a feature inventory — the 178-row capability ledger (F-03a §R) already is one and this file cites it by row rather than restating it. Not a Bloomberg map — Bloomberg and Gödel features are treated throughout as *evidence that a workflow is useful*, never as requirements (GOVERNING_PRINCIPLES §9: "Bloomberg does X" never implies "UCT builds X"). Not a decision on any owner-bound item — those are marked **PROVISIONAL / OWNER INPUT REQUIRED** and the surrounding design is shaped so the choice stays reversible.

**The six-question discipline (architecture principle 7).** Every system block below says which of six different questions it answers: **(a)** data availability (does a provider carry it?), **(b)** data normalization (is it one internal shape with an identity and a provenance?), **(c)** backend capability (does a service compute or serve it?), **(d)** UI exposure (can a member reach it?), **(e)** workflow quality (is reaching it fast and coherent?), **(f)** intelligence orchestration (does the AI layer read, cite or act on it?). The Readiness Review's headline — two-thirds of a terminal's capabilities are "already substantially supported" (§4) — is true for (a) and (c) and materially false for (b), (d) and (e), which is exactly why this architecture is mostly about platform primitives rather than applications.

---

## PART A — THE PRODUCT

## 1. Core product thesis

### 1.1 Sharpened from the Readiness Review §6

The Readiness Review states the job as giving the existing capability estate "a spine": a persistent, addressable loaded security every panel reads, plus one grammar for reaching any function (§6, "The job"). That is correct and this file keeps it. It is sharpened in three ways the evidence supports and the Review only implies.

**Sharpening 1 — the spine is a data model before it is a UI.** The Review names the symbol master as "the clearest new backend build" (§5, §7 D3). Read with C7-02 §0 claim 1 (a symbol master is *bitemporal*, not a lookup table) and C6-02 §4 (a computed number with no addressable row cannot be cited by any mechanism), the spine has *two* halves and both are data-modelling jobs: a permanent entity identity underneath the ticker string, and an address for every number the desk computes. Without the first, "context propagates" propagates a string that silently mis-joins history on a rename (C7-02 §1.1). Without the second, "the receipt attached" is attached to prose, not to the figure (C6-02 §4 anti-pattern: "do not synthesise a document to hold a number"). The product thesis therefore rests on the data platform, and the UI is downstream. This reorders the build, which is why Part C puts the data tier ahead of the shell.

**Sharpening 2 — "decisive with the receipt" is one verdict *shape*, not one verdict *per surface*.** The Review's moat item (1) is `grade_ticker`'s structural GO/HOLD/SKIP (§6; capability ledger K4). The synthesis records that UCT already has six-plus AI doors, a fast lane, an agent lane, Compass, the wire brain, `ask_the_brain` and `grade_ticker` as separate lanes (§11 Temptation 3), each with its own grounding gate (C6-02 §9: "gates are per-surface, not a shared component"). The thesis is not "UCT is decisive"; it is "there is exactly one way a verdict is *rendered*, and every lane must go through it." That is what makes decisiveness a property of the product rather than of whichever engineer built the surface last. It is also what makes the two-audience question (D9) answerable later without a rebuild: one renderer, two posture settings, rather than two renderers.

**Sharpening 3 — the loop closes on the member's own record, and the record is the differentiator.** The Review pairs P-α and P-β and calls them "probably one thesis" (§6, citing synthesis §11). D-13's uniqueness ranking puts the *per-ticker history join* first and records that no such join exists (synthesis §7.4: "what did we say about this name, what did the setup do, what did the book do, what did the flow do"). Every benchmark dossier concedes it cannot have this (synthesis §7.1: AlphaSense and Koyfin each name it "the fifth perspective"). So the loop is not load → read → act; it is load → read → act → **record** → the record changes what "read" says next time. This file therefore promotes the Journal / track-record substrate from "an existing tab" to a first-class application (A13) and names the history join as the data-platform deliverable it is (D2).

### 1.2 The thesis in one sentence

> **TERMINAL-NEXT is the workstation in which every UCT capability reads one persistent, addressable context, says what the data means through one provenance-carrying verdict shape, and remembers what the desk and the member each said last time — built by giving the existing estate a platform spine, not by building a bigger estate.**

Falsifiers (carried from synthesis §11 P-α/P-β, restated so they bind this file): a telemetry read showing members route around the decisive surfaces; an observed desk morning showing the desk reads the tape and ignores the verdict; the per-ticker join proving too sparse to render (synthesis P-β: "fewer than a few hundred names with all four histories"); or the owner ruling the desk's history not member-safe (OI-15 for the #tsdr corpus specifically). None of these can be tested from the repository; two need OI-06 and one needs the telemetry queries. **They are left open, not assumed.**

### 1.3 What "terminal-grade" means here (and what it does not)

Terminal-grade means five properties, each with an internal seed and a named benchmark witness:

1. **One context, read everywhere without re-entry.** Seed: `useAppFocus` — "charts Group A IS the app focus," one authority, railed (D-11 §7.1). Ceiling: symbol-only, four groups, hydrated once per mount (TD-05). Witness: Bloomberg's loaded security across addresses (synthesis §4.1); Koyfin's dispatching rail (§10.5).
2. **Provenance on every number and every sentence.** Seed: `CoverageLine`'s four-count receipt (G2), the COT grounding gate (H5), `flow_explain`'s facts-first narration (F7), the "grounded on" chips (K2). Gap: none is shared, none reaches a computed value's row (C6-02 §9). Witness: LSEG per-cell citation, FactSet source-linking invariant (synthesis §4.2 point 1).
3. **Saved things become names, and names are addresses.** Seed: `user_definitions` share links (G3), `charts_layouts` named boards (C4), the `?earnings=SYM` deep link (E4). Gap: no user-minted verbs, no published address space (C4-01 P7, P12, P13). Witness: Bloomberg NI codes, Koyfin shortcuts, Gödel's one-page command index (synthesis §4.2 point 3, §5).
4. **Keyboard-fast.** Seed: the chart's frozen binding table with physical `code`s (TD-07 "the right model, the wrong scope"). Gap: no registry, no palette, 87 raw keydown listeners (TD-07). Witness: Gödel's backtick-to-command-line, Esc double-tap, Cmd-Z window undo (synthesis §5).
5. **Panels are independent, and the document survives.** Seed: RGL board, pop-out portal sharing one SSE pool (C1, C5). Gap: no per-widget error boundary (TD-02), unversioned non-atomic layout (TD-03). Witness: six of seven workspace failure modes are persistence failures (C5-01 §7).

Terminal-grade does **not** mean exhaustive. It does not mean ten asset classes (GOVERNING_PRINCIPLES §13: no FX, fixed income or crypto in V1; provider ledger §2: no FX/crypto bars, no fixed income, no Level 2 — **PROVISIONAL / OWNER INPUT REQUIRED: OI-05** confirms the asset-class scope; this file designs the Entity Master so widening later is an alias-table change, §5.3). It does not mean a twelve-lane navigation model, a firehose feed, or twelve assistants (Review §6 "Where UCT should be dramatically simpler"). It does not mean order entry (§13: no execution or OMS).

### 1.4 The moat, restated as architecture

The Review's three moat items (§6) map onto three systems in Part C, and the mapping is the argument for their build priority:

| Moat item (Review §6) | Evidence | Which system carries it | Why it is architecture and not a feature |
|---|---|---|---|
| A shipped structural verdict (`grade_ticker`) | K4; CLAUDE.md Brain Bridge section (CLAIM, gated `BRAIN_TOOLS_ENABLED`, verdict enforcement admin-only until the report card clears) | I1 Intelligence Layer's verdict engine, rendered through S8's one provenance renderer | Decisiveness that is per-surface lapses; decisiveness that is a rendering contract does not (§1.1 sharpening 2) |
| An honestly-gated first-party track record (KB 9,605 rows at 57.7% first-party; `setup_triggers` 243 rows; lift ledger 25 measured / 3 published, six gates) | D-13 — spot-checked this pass against `proprietary-asset-inventory-raw.md` lines 96–99, 152, 306: the counts are in the file; capability ledger G6, N3, K6 | A13 Journal & Track Record + D2 Metric Address Book (the per-ticker join) | The join does not exist (synthesis §7.4); it is a data-model deliverable, and every AI citation of a desk number is blocked on it (C6-02 §4) |
| Options-flow / GEX depth Bloomberg and Gödel lack | F1–F8; synthesis §5 ("Gödel is strong exactly where UCT is weak and absent exactly where UCT is strong") | A10 Options & Flow | Already strong; the architecture's job is to keep it behind a stable contract and out of the partner-owned files (GOVERNING_PRINCIPLES §5) |

The one strategic gap the Review names and does not resolve — UCT has no analogue to Bloomberg's chat network effect (§6) — is **left as a product-vision question**, not designed here. The Community system (M1, The Floor) is out of this architecture's scope on purpose: it is a different product surface with its own store (`community.db`, no backup rail — TD-28) and folding it in would be Temptation 2 in a social costume.

---

## 2. The primary user interaction loop

### 2.1 The loop

The Review's loop (§6) is: load a security or open a board → context propagates → the AI surfaces a provenance-sourced decisive read → the member acts → the outcome feeds back. This file restates it as seven states so that each state names the platform system it depends on. The point of the restatement is that **every state is served by a platform primitive, not by an application** — an application only ever supplies content into a state.

| # | State | What the user does | Platform systems that serve it | Application content that fills it |
|---|---|---|---|---|
| 1 | **ORIENT** | Opens the terminal; sees the session state (pre / RTH / post / closed), the regime, what is moving, what is scheduled today | S1 Shell (a fixed market-wide layer), S11 Market Clock, S7 Alerts (the queue) | A11 Breadth/Regime, A1 Markets, A5 Events, A8 Catalysts |
| 2 | **LOAD** | Types or clicks one security (or one list, or one board) | S2 Command/Search resolves the noun; S3 Entity Master resolves identity; S4 Context Bus publishes it | — (no application owns the load) |
| 3 | **READ** | Every panel re-targets without re-entry; the number strip, chart, events, flow, fundamentals refresh | S4 Context Bus, S8 Provenance/Freshness (every number carries as-of and source), S10 Presentation | A1–A11 as panels |
| 4 | **DECIDE** | Asks "what does this mean" — reads the verdict, or asks the assistant | I1 Intelligence Layer (verdict engine, provenance renderer), S9 Entitlements (what this member may see) | A13 supplies the member's own prior view; A11 supplies regime; A9 supplies the setup grade |
| 5 | **ACT** | Journals, sets an alert, sizes, saves a screen, promotes a panel | S7 Alerts (trigger taxonomy), S5 Persistence (saved objects), S1 Shell (promotion) | A13 Journal, A12 Watchlists, A9 Screening |
| 6 | **RECORD** | The action is written to the member's own record, addressable by entity and time | S5 Persistence, S3 Entity Master (keyed by entity id, not ticker string), D2 Metric Address Book | A13 |
| 7 | **LEARN** | Next LOAD of the same name shows what the desk said, what the member said, what happened | D2 (the per-ticker join), I1 (P-β: "the fifth perspective"), S6 Personalization | A13, A8 (what the wire said), A10 (what flow did) |

**The test the loop must pass** (C4-01 §11 "How to choose"): the desk's *tenth* action of a session and the member's *first* action of a session must both be fast. The tenth action is LOAD → READ on a new name with the same lenses (a re-target, not a rebuild); the first is ORIENT → LOAD with no vocabulary. This is why the loop's states 2–3 are platform-owned: an application-owned "load" would make the tenth action cost what the first did.

### 2.2 Desk variant and member variant

D-001 (desk-first) is a sequencing decision, not a licensing one (synthesis §9.3). The loop is identical for both audiences; what differs is (i) the posture of state 4 (**PROVISIONAL / OWNER INPUT REQUIRED: D9** — decisive-by-default for everyone vs graduated for non-desk members; designed in §7.5 so it is one setting on one renderer) and (ii) the *content* allowed into states 3 and 4 (**PROVISIONAL / OWNER INPUT REQUIRED: D5 / OI-03(a)(b)** — which vendor fields may display to a member; designed in §5.9 so it is an entitlement row, not a fork in an application).

What the observed morning (OI-06) would change: whether state 2 defaults noun-first or verb-first (§13), whether state 1 is a fixed page or a board (§5.1), and whether the desk's tenth action is a re-target or something the loop does not model (synthesis §10.2: neither number exists today). **Nothing in the loop is locked against OI-06.**

---

## 3. Terminal-wide systems versus individual applications

This is the governing distinction of the document and the mechanism that prevents a monolith.

### 3.1 The definition and the test

A **terminal-wide system (platform primitive)** is something every application needs in the same shape and none may implement for itself. The test: *if two applications each built their own, would the product publish two answers to one question?* If yes, it is a platform primitive. The estate's most expensive defect class is exactly this — "second authority over one value," live in nine-plus places (TD-20; synthesis §6.6) — and it is the reason the platform tier is larger here than in the Readiness Review.

An **individual application (module)** is a specific capability's own logic: what it computes, from which data class, rendered how. The test: *could this be removed and the terminal still be a terminal?* If yes, it is an application. Charts, calendar, screener, flow, breadth each pass this test; the shell, the context bus, the entity master, the provenance renderer each fail it.

### 3.2 The platform contract every application must honor

An application in TERMINAL-NEXT is admitted only if it:

1. **Reads context from the Context Bus (S4)** and never holds its own copy of the loaded security. The `ChartsSymContext` shim (explicit Provider → Group A → null; D-11 §7.2) is the existing precedent and the anti-pattern to retire: an application that accepts a symbol as a prop *and* reads a group is two authorities.
2. **Keys every stored row by entity id (S3)**, never by ticker string, and stores the ticker as a display alias with a date (C7-02 §6 claim 1; synthesis §12.4).
3. **Renders every number through the Presentation primitives (S10)** and every freshness/coverage state through the Provenance component (S8). No local `fmt*` (118 files define their own today — TD-08); no local "no data" (`.catch(() => null)` renders failure as fact — TD-18).
4. **Fetches through one throwing fetcher** (TD-18: `jsonFetcher.js` has 14 consumers against 186 direct `fetch` sites) so that 402 reads "not entitled," 5xx reads "down," and empty reads "empty."
5. **Registers its commands and keys in the Command registry (S2)** with a scope; it never adds a raw `keydown` listener (87 exist — TD-07).
6. **Declares its entitlement axis in S9** (which plan, which cadence, which data class) and never gates itself with a local `isPaid` mirror (`PAID_PLANS` is already copied twice — TD-20).
7. **Persists through S5's typed stores** with a schema version from the first commit (TD-03, TD-13) — never a new key in `user_preferences` (TD-04: no cap, no delete, returned whole on every `/me`).
8. **Emits alerts only through S7's trigger taxonomy** and never builds a sixth alert subsystem (Review §7 D7).
9. **Exposes its data to the Intelligence Layer only as registered tools with declared provenance** (K1's registry + per-door allowlist; D-12 §8 #3) — never a private prompt path.
10. **Is mountable as a panel and as a page** (C5-01 §0: "a workspace that can only contain things somebody remembered to build a widget for" is the anti-pattern; the `embedded`-prop pattern with 20-prop signatures is marked *avoid* in C9).

### 3.3 The application contract every platform system must honor

A platform system is admitted only if it **owns no domain logic**. It may not know what a "setup" is, what a "regime" is, what an "implied move" is, or which vendor serves earnings dates. It knows identities, contexts, addresses, receipts, entitlement rows, saved documents, trigger types and delivery channels. The moment a platform system needs to know that `pct_above_50sma` is a breadth metric, that knowledge belongs in an application's registration of the metric with D2, not in the platform. This is the anti-corruption rule from C7-03 §3 ("avoid placing business rules or orchestration in the layer") applied inward.

### 3.4 The anti-monolith rules

1. **There is no "Terminal" service and no "Terminal" component.** The shell (S1) is a host with a registry; it renders nothing that is not an application's panel or a platform chrome element. Backend-side, there is no `terminal.py`; there are the existing routers plus new platform services, each with one responsibility.
2. **No system may be the sole path for a second system's core function.** Example: the Context Bus carries context; it does not resolve identity (S3 does) and does not persist (S5 does). The Intelligence Layer reads tools; it does not own any data class.
3. **Every cross-system call is an edge in the boundary matrix (§14).** An edge not in the matrix is a boundary violation to be reviewed, not a convenience.
4. **Partner-owned files are outside every boundary** (GOVERNING_PRINCIPLES §5: `OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`). A10 wraps them behind a contract; nothing here describes their internals or proposes editing them.
5. **TERMINAL-CURRENT's contract is outside every boundary too**, in the other direction: `/api/calendar` has nine reader classes, five of them server-side bare `.get()` chains (E1; TD-37). A5 consumes it; nothing in this architecture changes it (§6.5).

---

## 4. The system map — revised decomposition

### 4.1 Changes against the Readiness Review §5, and why

The Review derives its systems "by responsibility rather than by existing file boundaries" and lists them by build condition. Read literally, its §5 names twenty-four (twenty-three plus People/Company Intelligence under "evaluate, don't assume") against a heading that says twenty-three — a derived-count point worth noting once and not repeating. This file keeps the responsibility-first method and changes the decomposition where the evidence supports it:

| Change | Review §5 had | This file has | Why (evidence) |
|---|---|---|---|
| **Split** | Security/Symbol/Entity Context (one system) and Cross-Module Context Propagation (a second) | **S3 Entity Master** (the data: permanent id, dated aliases, share classes) and **S4 Context Bus** (the runtime: typed channels carrying an entity, a timeframe, a range, a list) | They answer different questions — (b) normalization vs (e) workflow — and have different seeds (`cap_universe`/`ticker_meta` vs `WorkspaceContext`/`useAppFocus`; C7-02 §1.1, D-11 §7.1). The Review's own text already treats propagation as "generalize the 4-colour-group link mechanism into a typed channel payload" — a runtime job — and identity as "no symbol master exists" — a data job |
| **Split** | Realtime Streaming/Caching | **D3 Realtime Streaming** and **D4 Caching & Serving** | Streaming is a fan-out problem bounded at ~300 concurrent browsers per stream family (A2, TD-12); caching is a serving problem with its own idioms (`serve_stale`, `cache_snapshot`, warmers — O6, "the most valuable code in `api/`"). One name invited one owner; they need two |
| **Split** | Fundamentals/Estimates | **A3 Fundamentals & Financial Statements** and **A4 Estimates & Analyst Actions** | Different provider legs (D2 vs D3 in the ledger), different licensing rows (statements R/LA; TheFly-origin analyst rows R/U — provider ledger §2), different refresh (nightly warm vs 02:00 analyst pass), and one is a NO-PROVIDER gap (per-broker estimates, revision timeline — ledger §2) while the other is not |
| **Add** | (nothing — "a screener DataGrid seed" mentioned in passing) | **S10 Presentation Primitives** (DataGrid, format module, freshness badge, form controls) | TD-06, TD-08, TD-09 are three of the eighteen "Blocks Terminal" items and none maps to a Review system. "A terminal is a table product" (TD-06) |
| **Add** | (inside Entity/Symbol) | **S11 Session & Market Clock** | C7-02 §0 claim 3: the clock is "a first-class dataset with its own vendor problem"; `calendarTime.js` is 35 lines and not a market calendar (synthesis §8.6); no AI lane injects session state (C6-02 §5, §9). Nothing else owns "is the market open" |
| **Add** | (inside Persistence / Licensing) | **S12 Rollout, Cohort & Observability** | P6 is the ledger's one *absent* capability (per-user cohort targeting); TD-11 (no kill switch short of maintenance mode), TD-16 (observability by `print()` and Discord), TD-19 (flag-ledger drift). A terminal that ships dark to a cohort needs this to exist before its first panel |
| **Add** | (inside Provenance / Provider Abstraction) | **D2 Canonical Data Model & Metric Address Book** | C7-03 §4 (one canonical schema per data class before a second vendor) and C6-02 §4 (a metric needs an id, value, as-of, inputs, calc version). The synthesis puts "the computed-metric address book" on the critical path as an item "not on it at Day 0" (§19). It is the per-ticker history join's home (§1.1 sharpening 3) |
| **Add** | (no system) | **A11 Breadth, Regime & Positioning** | H1–H8 are UCT's proprietary rails (Exposure Rating, breadth monitor, COT positioning, regime) and occupy benchmark workflows D and G that no research vendor serves (synthesis §4.2 point 6, §10.1). The Review invokes them as "UCT's existing regime/breadth data" without giving them a system; two regime classifiers already exist (H6, "a candidate second authority") — that is a boundary problem needing an owner |
| **Add** | (no system) | **A13 Journal & Track Record** | The feedback half of the loop (§2.1 states 6–7); J1–J10 is 267 modules and 47 tables; the per-ticker join is D-13's top-ranked asset (synthesis §7.4). The Review's loop ends "feeds back into personalization and the member's own coaching history" and then names no system for it |
| **Merge** | Transcripts (one), Filings (unnamed, inside Fundamentals) | **A6 Transcripts & Filings** | Same shape: documents about a company, one is FMP-of-record (D6) and one is EDGAR (D7), both feed FTS5 stores, both are the cleanest AI-grounding corner (synthesis §9.5 on Koyfin's transcript choice) and the sharpest AI licensing row (provider ledger §5.1 Q7) |
| **Fold** | Corporate Actions (new build, small) | **D5 Reference & Corporate-Actions Data** carries splits/dividends/delistings and the *adjustment policy*; the M&A/spin-off/buyback **event calendar** stays deferred | D8 says defer the build; C7-02 §1.7 says adjustment-as-policy is "the largest gap … with the quietest failure mode" and cannot wait. Splitting the policy (needed now, a data-platform concern) from the event calendar (deferred, an application) keeps D8 reversible |
| **Rename / narrow** | Personalization ("extend three specific moves") | **S6 Personalization** narrowed to preference resolution over platform primitives | C5-02 §9: none of the seven moves needs new persistence; "the gap in every case is a product decision to expose a knob or a document." A personalization *subsystem* would be a monolith seed |
| **Rename / narrow** | Terminal Shell/Workspace ("rebuild only the persistence layer") | **S1 Terminal Shell & Workspace** owns hosting, promotion, panel lifecycle, error isolation; **S5** owns the document | C5-01 §7: "the hard part of a workspace is not the grid, it is the document." Putting the document in the shell is how `charts_workspace_layout` became eight loosely coupled keys (C7) |
| **Fold** | Valuation (named in the Phase 2 contract, not in the Review) | A lens inside A3/A4 through D2's address book, **not a system** | No dossier established a valuation workflow as load-bearing for a momentum/options desk (synthesis §10.1: the defensible ground is D, G and the decision half of E). FMP `ratios-ttm`/`key-metrics-ttm` already serve the inputs (D2 row). A valuation *system* would restate fundamentals and estimates numbers — a second authority by construction |
| **Keep at Review posture** | People/Company Intelligence — evaluate | **E1** — evaluate; not designed | No dossier established it as load-bearing (Review §5). Bloomberg's `MGMT` exists (synthesis §4.1b) — evidence of a workflow, not a requirement |
| **Keep at Review posture** | Portfolio/Risk — defer (D8) | **A14** — deferred; boundary with A13 defined now | The portable idea is `PORT`'s Past/Present/Future *presentation* over existing regime/breadth data (synthesis §4.1b), not a new asset class; `portfolio_heat.py` already exists (K4) and must have one home |
| **Keep** | Market Data, Charts, Ownership, Watchlists, Screening, Options, Events/Calendar, News, Alerts, Provenance, Persistence, Command/Search, Licensing, Provider Abstraction, AI | S1, S2, S5, S7, S8, S9, D1, A1, A2, A5, A7, A8, A9, A10, A12, I1 | Boundaries sharpened in Part C; no evidence found for a different cut |

### 4.2 The map

Five tiers. Arrows are the only permitted dependency direction (downward and sideways within a tier; never upward from platform to application; the Intelligence Layer reads applications only through registered tools).

```
EDGE / CHROME ──────────────────────────────────────────────────────────────
  S1 Terminal Shell & Workspace     S2 Command, Search & Navigation
  S10 Presentation Primitives       S12 Rollout, Cohort & Observability

APPLICATIONS (panels and pages; each mountable as either) ──────────────────
  A1 Markets            A2 Charts & Analytics      A3 Fundamentals & Statements
  A4 Estimates          A5 Events & Calendar       A6 Transcripts & Filings
  A7 Ownership          A8 News & Catalyst Intel   A9 Screening & Discovery
  A10 Options & Flow    A11 Breadth, Regime & Pos. A12 Watchlists & Lists
  A13 Journal & Track Record          A14 Portfolio & Risk (deferred, D8)
  E1 People/Company Intelligence (evaluate only)

INTELLIGENCE ───────────────────────────────────────────────────────────────
  I1 Intelligence Layer: tool registry contract · verdict engine · ONE provenance renderer
     (reads applications ONLY through registered tools; owns no data class)

PLATFORM CORE (terminal-wide primitives) ───────────────────────────────────
  S3 Entity Master      S4 Context Bus             S5 Persistence & User State
  S6 Personalization    S7 Alerts & Monitoring     S8 Provenance & Freshness
  S9 Entitlements & Licensing Gate                 S11 Session & Market Clock

DATA PLATFORM ──────────────────────────────────────────────────────────────
  D1 Provider Abstraction (one ACL per vendor)     D2 Canonical Data Model & Metric Address Book
  D3 Realtime Streaming                            D4 Caching & Serving
  D5 Reference & Corporate-Actions Data (adjustment as policy)

OUTSIDE EVERY BOUNDARY (consumed through contracts, never modified here) ───
  Partner-owned files (GOVERNING_PRINCIPLES §5) · `/api/calendar` + its nine readers (E1, TD-37)
  · the PC producers (wire, breadth collector, scanner, Brain Pack — O11) · Community (M1)
```

Build-condition tags (Review §5 vocabulary, re-applied): **extend** S1, S5, S7, S8, D3, D4, A1–A3, A5–A12; **consolidate** S2, S6, S9, S10, A4, I1; **new** S3, S4 (typed), S11, S12, D1, D2, D5; **defer** A14 and the corporate-actions event calendar; **evaluate** E1. Every "new" item has a named in-repo seed (Part C) except S3 and D1, which the Review already calls "the two clearest infrastructure gaps."

---

## PART B — THE PRODUCT MODELS

Each model is product-level. Implementation detail (schema, library, pixel) is deferred to Workstreams 2 and 3 and is named as such.

## 5-B.1 The context model (security / entity / lens)

**What "context" is.** A typed record, not a string: `{entity, lens, time}`. The **entity** is a permanent internal id (S3) with a display alias (the ticker as of today) and a type (equity, ETF, index, future-positioning symbol, list, board). The **lens** is the function being applied (chart, events, flow, fundamentals). The **time** is `{timeframe, range or anchor, session-state}` (S11). A panel subscribes to a **channel**, and a channel carries context of one declared kind (entity · entity-set · list-ref · timeframe · range · event) — the FDC3 *vocabulary* adopted without its container (synthesis §12.1; C5-01 §10 "Linking model to aim at"). [Corrected during Phase 2 validation to match the six-kind list information-architecture.md's workflow chains actually depend on — `event` (report_date/BMO-AMC, catalyst_at, fired_at) is load-bearing for §12's calendar/alert/news chains, not optional; the two documents previously disagreed on this and have been reconciled to one canonical list.]

**Why typed, and why now.** The four colour groups carry a symbol only (TD-05); `GridChartCell` already bypasses `ChartWidget` because of the cap; `useAppFocus`'s own header says date anchors and trade refs "still travel by explicit link" (D-11 §7.1). The `'N:${groupId}'` escape proves the code path tolerates a non-letter key (TD-05) — the generalization has a seed.

**The rule that keeps this from becoming a god-object.** The Context Bus (S4) carries and replays context; it does not resolve it (S3), persist it (S5 — the channel assignments are part of the workspace document), or interpret it (applications). "Which pane am I typing into" is a shell/IA question (C4-01 Grammar C's named failure mode) and is Workstream 2's, not this bus's.

**Per-pane, never session-global.** C4-01 P4: global forecloses comparison; per-function destroys the saving. The existing "Group A is the app focus" (D-11 §7.1) is kept as *the default channel*, not as a global.

## 5-B.2 The global command / search model

**One input surface, several input kinds, one categorised result list** (C4-01 P1). The box accepts a symbol, a function, a saved-object name, a question. The *system* decides which. The result list is typed (symbol / command / saved object / AI) so a mismatch fails loudly rather than rendering an empty surface (P3). Every resolved command is a URL (P12) — the existing `?earnings=SYM&esection=` deep link (E4) and `formulaShareLink.js` (G3) are the seeds; the address space is published on one page (P13).

**Backend: nothing new.** The 154-tool registry with per-door allowlists (K1; spot-checked this pass against `existing-ai-systems.md` line 218: "154 tools (AST count of `voice_tool(...)`)") and `/api/ticker-search` (A8) are the resolvers. The Review is right that the missing piece is "a frontend command-palette surface" (§5), with one correction from TD-07: the missing piece is a *keyboard registry* first (frozen declarations, physical `code`, one matcher, a duplicate-`(code, modifier, scope)` rail — the chart's binding table generalised) and the palette second. A palette on 87 raw listeners inherits the Shift+F collision class.

**Precedence and collision policy are published, not implied.** `RS`, `EMA`, `MA`, `GAP`, `PEG` are real tickers (C4-01 §11 Grammar A cons; project memory `lesson_a_symbol_universe_does_not_settle_a_ticker_match`); the existing three-tier resolver in `_extract_tickers` (D-12 §3e: cashtag always; bare uppercase needs universe + not-stop-listed; bare lowercase needs a cue) is the precedence seed and should become the *one* resolver the box, the AI door and the alert grammar share (P5: "browsing must be a view over the same addresses"; TD-20 otherwise recurs as a fourth ticker resolver). The interpreted parse is echoed above the input before Enter.

**The default grammar — PROVISIONAL / OWNER INPUT REQUIRED: D2 / OI-06.** C4-01 §11 names the fork (noun-first Grammar A vs palette-first Grammar B) and the test (the desk's tenth action vs the member's first). This architecture takes the *only* position the evidence licenses: the command system is built so that **Grammar C** ("context bar + scoped verbs" — a bare symbol re-targets the pane, a bare verb runs against the loaded security, user-minted verbs compose, one AI sigil) is the substrate, because it "fits UCT's existing colour-group substrate almost exactly" (C4-01 §11) and because "the two audiences may honestly want different defaults on the same grammar, which C supports and A does not." Whether the *default* on an empty box is noun-first or palette-first is a per-audience setting decided after OI-06, and the design keeps both reachable from day one (backtick focuses the line; Ctrl-K opens the palette). What would change this: the observed morning showing the desk wants three doors for one thing on purpose (synthesis P-γ falsifier).

**The AI door emits deterministic text (P11).** `/ask` produces a screen configuration or a filter the member could have typed, staged beside the hand-set state, never over it (TradingView N1; synthesis §12.3). This keeps the command model and the AI model from becoming two authorities over "what did the member ask for."

## 5-B.3 The security / entity context model (identity)

**One internal permanent entity id, FIGI as the external mapping, tickers as a dated alias list** (Review §7 D3: "the clearest, best-evidenced recommendation in this register"; C7-02 §6 claim 1; C7-03 §2). Share classes are aliases of related entities, not "two unrelated strings" (C7-02 §1.1). A delisted identity is marked, never erased (C7-02 §5.3; Gödel's `TREND` renders delisted tickers struck-through rather than removing them — `godel/02-verification.md` line 98, VERIFIED tier; not carried into the synthesized `godel/dossier.md`'s own TREND description, a minor completeness gap in that file worth a future fix, not a defect in this claim). A renamed entity keeps its record and gets a redirect (Fiscal.ai, C7-02 §5.2).

**The identifier choice is a licensing decision** (C7-03 §9: CUSIP's terms prohibit maintaining a master file; FIGI is MIT-licensed and free; ISIN's posture not yet researched). It routes through the licensing register (F-04), not through a technical design doc alone.

**What the entity master is not.** It is not the universe gate (`cap_universe` is "a gate, not an identity registry" — C7-02 §1.1; the gate's own live failure mode let sub-$300M names into `calendar_alerts` and the ICS feed). It is not the ticker-meta cache (A9). It is not the market clock (S11). It holds no prices, no fundamentals, no membership rules — only identity, aliases with validity dates, relationships (share class, successor/predecessor), and per-vendor symbol mappings so that `to_polygon_symbol()`'s `BRK-B`→`BRK.B` rewrite (leaking to 41 call sites / 15 modules — provider ledger 1B row 1) becomes an adapter-side lookup (D1).

**Open question carried, not answered:** whether Massive/FMP responses already carry a `figi` field (C7-03 §2 open question) — a live API read, Workstream 3.

## 5-B.4 The intelligence / AI layer's product role

**One assistant, several doors, one renderer.** The AI layer is a *context layer on existing surfaces with one global door*, not a panel and not twelve assistants (OQ-05 is answered here provisionally; FactSet N7 is the anti-pattern; Fiscal.ai's retreat from a chat identity is the counter-evidence — synthesis §11 Temptation 3). Its three product roles:

1. **Read** — the structural verdict (`grade_ticker`, `grade_watchlist`, `portfolio_heat` — K4). Decisiveness is computed, not prompted; the model narrates and cannot hedge or fabricate a number (CLAUDE.md Brain Bridge; C6-02 P4 "exemplary"). The renderer shows the verdict, its hard flags, and the tool-sourced inputs as cited rows.
2. **Explain** — facts-first narration of a deterministic figure (`flow_explain`, `cot_narrative`'s grounding gate — F7, H5). The honest negative ("nothing specific — a beta move with the sector") is a first-class output (synthesis §10.4; Benzinga's WIIM slot allowed to be blank).
3. **Do** — configuration-as-answer: a scan, a screen, an alert, a board, emitted as the deterministic text the member could have typed, staged for confirmation (K2's proposal chips: "must not mutate member state off a regex"; C6-02 P6).

**The three contracts that make this a system rather than a sprawl:**
- **The tool registry is the only door into application data** (K1: 154 tools, per-lane allowlists; D-12 §8 #3's gap — allowlists must become a function of the entitlement, S9, not per-lane constants).
- **One provenance renderer** every lane must use (Review §7 D6: "low controversy, high leverage"; synthesis §12.3). Citations always on, rendering optional (C6-02 §8 — a per-answer toggle busts the cached prefix). Desk numbers get a linkable marker, not a prose instruction (D-12 §8 #5: "the single biggest trust gap").
- **Population caps and a scheduled-vs-member reserve on every lane** before any member-facing lane ships (R-18; E-06; TD-42: `_SCHED_BUDGET_FRAC` exists on one lane; `COMPASS_COST_CAP_DAILY=0`). One price module, one pinning test (TD-21).

**What the AI layer must not own:** any data class; any number it did not receive from a tool (the "do not synthesise a document to hold a number" anti-pattern, C6-02 §4); the entitlement decision (it inherits the session's — synthesis §12.5); the session clock (S11 injects it as a grounded fact, "never as a cache salt" — C6-02 §5); the member's record (A13 owns it; the AI reads it as the fifth perspective).

**PROVISIONAL / OWNER INPUT REQUIRED: D9.** Whether the renderer's verdict posture is decisive-for-all or graduated for non-desk members. The design (§7.5) makes it one posture flag on one renderer with the same receipt in both modes — "never a hedge appended to a kept fabrication" (synthesis §16.1). Reversible either way.

## 5-B.5 The personalization model

Personalization is **preference resolution over platform primitives**, not a subsystem. C5-02 §9's seven moves, sequenced by cost, define its whole V1 scope: (1) publish existing ceilings (`GRID_MAX_CELLS=16`; panels per board) — documentation; (7) publish the cross-device rule (prefs and layouts travel; drawings and columns do not — D-11 §4.1) — documentation; (4) make autosave *visible* (TradingView's toggle; UCT's is a silent 500 ms debounce) — one control; (3) the scan-save fork (list / query / alert from one save) and (5) split favourites from recents — additive UI over existing data; (2) ongoing persona re-ranking and (6) a Viewer/Editor role layer — genuinely new, **deferred until the `charts_workspace_layout` distribution query answers whether members customise at all** (**PROVISIONAL / OWNER INPUT REQUIRED: the telemetry queries**; C5-01 §6 could find no external evidence on this question; H1/H5 are Unknown).

The three already-evidenced moves the Review names (§6) sit inside these: publish density ceilings (1), name non-autosaving objects (4), extend the firm-editable pattern from scans (`starter_library.py`, editable-on-arrival — G3) to boards (Bloomberg Sample Views by asset class — C5-01 §10 "First-run"). Firm-published boards are `charts_layouts` rows with `scope=global` today (C4) — the mechanism exists.

**What personalization must not own:** the workspace document (S5), the entitlement (S9), the alert queue (S7). It reads them and supplies defaults.

## 5-B.6 The alert / monitoring model

**One trigger taxonomy, one delivery seam, one queue.** Five-plus alert subsystems exist (price/line/trendline — I3; indicator — B6; calendar pre-report — E7; catalyst watchlist-match — K8; awareness stop/regime/earnings — K7; transcript keyword — D6) sharing one delivery function, `deliver_alert_payload` (I3), and no shared trigger model (Review §7 D7). The model:

- **Trigger types are a fixed, published taxonomy** (C2-01 §10 "have, unconsolidated"): price-level · indicator-condition · scan-membership-change · document-arrival (filings off the already-wired EDGAR client — "the data exists, the pipe exists, only the trigger is missing," C2-01 §6/§10) · event-proximity (earnings, econ) · regime-change · position-risk (stop proximity, heat) · catalyst-match. Each is registered by the application that computes it; the taxonomy is owned by S7.
- **Scope is expressed in the same grammar as search** (Unusual Whales' `$ticker` / `@sector` / `#watchlist` prefixes — synthesis §2 verified facts; C4-01 P9): an alert's scope is an entity, a list-ref or a scan-ref resolved by S3/S5, never a free string.
- **Every fire is a receipt** (S8): what fired, on which value, as-of when, from which source — the `catalyst_alerts_fired` PK `(user_id, ticker, market_date)` dedup idiom (K8 locked invariant) generalised.
- **The queue is one**: the awareness engine's `add_insight` already owns dedup, an 8/day cap and a 6h per-symbol cooldown (K7) and is the seed; its known limitation — the shared cap can starve `daily_focus` — is the reason the cap must be per-type with a reserve, not global.
- **Delivery is a channel registry** (in-app bell, email, Discord, browser, sound — I3), keyed by purpose, replacing seventeen-plus webhook NAMES (M4; provider ledger §4 #18). Discord is "the sole alerting channel and the first thing to go quiet" (TD-43); the monitoring half of S7 must distinguish "checked and clean" from "could not check" in the channel, with a second channel for the case the first is down.
- **Server-side alerting has a licensing shape** (provider ledger §3.4: CTA/OPRA non-display fees) — S9 gates which trigger types may run on which data class for which audience.

**What S7 must not own:** the *computation* of any condition (applications compute; S7 evaluates registered predicates on registered values), the entitlement to receive (S9), or the market-clock rule for when to evaluate (S11).

## 5-B.7 Cross-module context propagation

The runtime flow, end to end, so that Workstream 2 has a fixed contract to lay pixels on:

1. A noun is entered (S2) or clicked in a panel (application → S2, never application → S4 directly, so that "browsing is a view over the same addresses" — P5).
2. S2 resolves it through S3 (entity), S5 (saved object) or the registry (command); ambiguity is shown, not guessed.
3. S4 publishes `{entity, time}` on the pane's channel with `DisplayMetadata` (channel colour/name) and **replays on join** (C5-01 §10: a panel added later receives the current context).
4. Each subscribed panel re-targets. Panels that cannot (a locked Journal trade chart — D-06's read-only surfaces) declare `linkable: false` in their registration (C2's `paramsSchema` + `menus` flags are the seed for per-panel declarations).
5. S8 stamps the panel's data with as-of and source; S10 renders it.
6. The channel assignments and the last context are part of the workspace document (S5), so a reload restores the same loaded security (the existing `charts_workspace_groups` pref, generalised — C3).
7. Pop-out windows share the channel (the `window.open` portal keeps one SSE pool browser-wide — C5; the property C5-01 §10 names as "most at risk in a migration," RG-27).

**Propagation across surfaces that are not panels** (the calendar page, a research modal) uses the same channel model; the current "hydrated once per mount" limit (D-11 §7.1) is retired by making the bus live rather than by adding a second focus store.

## 5-B.8 Persistence / user-state responsibilities

Who owns what, stated as a table because the current answer is "eight loosely coupled keys plus localStorage" (C7) and the debt register's advice is unambiguous: "never `user_preferences`" for anything document-shaped (TD-04, TD-11).

| State class | Owner | Store shape | Seed | Rule |
|---|---|---|---|---|
| Workspace document (arrangement, panel instances, channel assignments, per-instance settings) | **S5** | one versioned document per board, own store, schema version from first commit, tombstoned deletes, atomic write, prior version kept | `chartDefaults.js` `settingsVersion` fold + `instanceShape.js` tombstones + `charts_layout_service.py` row shape (D-11 §7.6) | "Empty because new" ≠ "empty because unreadable" (R-13); hydration gate on every save path (C5-01 §7 failure 3); stable instance ids, not `Date.now()` |
| Named saved objects (boards, screens, scans, formulas, lists, alerts) | **S5** | append-only versions, tombstone delete, caps, share links, `scope ∈ user | global` | `user_definitions.py` ("the strongest persistence design in the repo" — G3, D-11 §3), `charts_layouts.db` (C4) | User-minted names are the command verbs (P7); a published collision policy from day one |
| Scalar preferences (theme, density, default grammar, autosave visibility) | **S6** via S5 | namespaced key→value with version-in-key | `usePreferences.setPrefMerged` write chain (B4) | Read-fallback shim on any rename, with a test (the calendar's shim has none — TD-37) |
| Device-local state (drawings, column widths) | **S5**, declared | localStorage, *labelled* as device-local | `uct-chart-drawings`, `uct.watchlist.cols` (B3, I1) | The device-local vs account-following rule is decided per key and published (C5-02 §9 move 7) |
| Transient state (a search box, a modal's history ownership) | the surface | React state | `quickQ` "intentionally not persisted" (D-11 §7.5) | Not persisted, on purpose, and said so |
| Member record (trades, notes, verdicts, reviews) | **A13** | `j2_*` (47 tables) — *own file in the future*, keyed by entity id | J1–J10 | Not this architecture's to migrate; the boundary is that no other system writes it |
| Entity master, metric address book, provenance rows | **S3 / D2 / S8** | own stores with `bars_sqlite._migrations`-shaped migrations (TD-13) | `bar_provenance.py` shape (C7-03 §7) | Never `auth.db` (~110 tables, one write lock, no migration framework — TD-13) |
| Cohort membership, flag state | **S12** | server-side, admin-written, read by a gate | `user_tags` (written, read by no gate — P6) + `has_tag` / `require_beta` (D-10 §5.3) | Never member-writable (TD-11) |

**Two rules that apply to every row:** (1) every store ships with a retention rule and is visible to `disk_watchdog` (TD-33); (2) every store a member writes has a backup rail that is ON and *verified* — five member-content stores have none today (TD-28).

---

## PART C — THE SYSTEM CATALOGUE

Each block: responsibility · answers which of the six questions · inputs · outputs · dependencies · ownership boundary · primitives exposed · **must NOT own** · build condition and seed · evidence. Prohibitions are specific on purpose: they are the scope-creep tripwires.

## 5. Platform systems

### S1 — Terminal Shell & Workspace

- **Responsibility.** Host panels and pages across **three surface kinds** — fixed market-wide pages, composable boards, and the entity page (the load-bearing new surface information-architecture.md §3.3/§4.2/§4.5 identifies, consolidating Q7's eleven per-ticker doors into one addressable page) — with promotion in both directions ("open this page as a panel" / "open this panel as a page" / "open this lens on the entity page"); isolate panel failures; manage pop-outs; expose the chrome (context bar, command line, alert bell, session indicator). [Corrected during Phase 2 validation: this line previously named only two surface kinds, contradicting information-architecture.md's three-surface-kind model; S1 is the entity page's host, while its individual lenses remain owned by their respective application systems (A2/A3/A6/etc.) per §5-B.4's registration pattern.]
- **Answers:** (d) UI exposure, (e) workflow quality.
- **Inputs.** Panel registrations (from applications, through a registry), the workspace document (S5), context (S4), entitlement (S9 — which panels this member may mount).
- **Outputs.** Mounted panels with a stable instance id; promotion/demotion events; pop-out windows sharing the opener's React tree.
- **Dependencies.** S4, S5, S9, S10, S12.
- **Ownership boundary.** Owns hosting and layout *behaviour*; does not own the layout *document* (S5) or any panel's content.
- **Primitives exposed.** `registerPanel(manifest)` (the `WIDGET_REGISTRY` shape — C2: metadata-only, deep-frozen, `paramsSchema`, durability regime, per-shell `menus` flags; "adopt as the panel manifest; add `menus.terminal`"); `promote(route → panel)`; `popout(panel)`; a per-panel error boundary keyed on instance id.
- **Must NOT own.** The document schema or its migrations (S5). Context resolution (S3/S4). A hand-curated widget list that grows slower than the product (C5-01 §0 anti-pattern: 18 entries today). Any domain rendering. The mobile shell decision — desktop-first, phone = monitoring is the owner default (RG-10, TD-48) and the responsive rule is Workstream 2's.
- **Build condition.** **Extend** the RGL board (C1, C5, C6) — the bespoke slot tabs, float and pop-out already exist; add the error boundary (TD-02, "cheapest fix in the estate"); port `useStaggeredMount` and a published panel cap (B10; synthesis §12.1). **PROVISIONAL / OWNER INPUT REQUIRED: D1** — the hybrid model is the evidenced lean (Review §7 D1; C5-01 §0 reframes fixed/modular/hybrid as "can a page become a panel, and who owns the schema"); final lock waits on OI-06 and the `charts_workspace_layout` query; the dock-library question (RG-27, an afternoon spike) is decision-relevant only if D1 moves. Nothing in S1's contract changes under either outcome — that is the reversibility.
- **Evidence.** C1–C9; C5-01 §0, §7, §10; D-11 §7.2; TD-02, TD-03, TD-05; synthesis §12.1.

### S2 — Command, Search & Navigation

- **Responsibility.** The one input surface; the keyboard registry; noun/verb/saved-object/question resolution into typed results; the published address space; command history that is recallable and editable; deep-link generation.
- **Answers:** (e) workflow quality, (d) exposure.
- **Inputs.** Entity resolution (S3), saved-object index (S5), the tool/function registry (K1 — read as the function catalogue), entitlement (S9 — which verbs exist for this member), a scope (which pane).
- **Outputs.** A resolved, typed command; a URL for it; a context publish (through S4); an AI hand-off (to I1) when the sigil says so.
- **Dependencies.** S3, S4, S5, S9, I1 (for the `/ask` door only).
- **Ownership boundary.** Owns *resolution and dispatch*; does not execute any function (applications do), does not decide what the loaded security is (S4 does), does not rank AI answers.
- **Primitives exposed.** `registerCommand(verb, scope, handler, urlShape)`; `registerKey(code, modifier, scope)` with a duplicate rail; `resolve(text, scope) → typed candidates`; `toUrl(command)`; history.
- **Must NOT own.** A second ticker resolver (D-12 §3e's `_extract_tickers` is the seed and becomes the one shared resolver). A third hotkey system (TD-07: two exist plus 87 raw listeners; do not add). The grammar *default* (PROVISIONAL, §5-B.2). Any menu whose leaves are routes rather than commands (P5).
- **Build condition.** **Consolidate**: keyboard registry from the chart's binding-table model (TD-07), palette on top, backend as-is (154 tools, `/api/ticker-search`).
- **Evidence.** A8, K1; C4-01 P1–P15, §11; TD-07, TD-20; D-12 §3e.

### S3 — Entity Master

- **Responsibility.** Permanent internal identity for every instrument the terminal can load; dated ticker aliases; share-class and successor/predecessor relations; per-vendor symbol mappings; delisting marks; FIGI as the external mapping.
- **Answers:** (b) normalization — the identity half.
- **Inputs.** Vendor reference feeds through D1 (Massive `/v3/reference/tickers` — provider ledger §5.3 Q2 names it as able to serve symbol changes), OpenFIGI mapping, the existing universe gate as a *membership* input only.
- **Outputs.** `resolve(alias, asOf) → entity`; `aliases(entity) → dated list`; `vendorSymbol(entity, vendor)`; relation queries.
- **Dependencies.** D1, D5 (a corporate action that changes identity is a D5 event applied to S3).
- **Ownership boundary.** Identity only.
- **Primitives exposed.** The three functions above; a bitemporal `asOf` on every query (C7-02 §0 claim 1).
- **Must NOT own.** Prices, fundamentals, membership rules (the $300M scanner floor and $500M leadership floor are application constants — synthesis §7.2), the market clock, the universe file (`cap_universe` remains a gate owned by A9's universe logic and is retired as an *identity* authority). Not a place for licensed identifiers whose terms attach at the identifier (CUSIP — C7-03 §9) without a licensing-register row.
- **Build condition.** **New** — "the clearest infrastructure gap the research found" (Review §5); "design work can and should start immediately; the schema locks before implementation" (§7 D3). No counter-evidence found by any artifact.
- **Evidence.** C7-02 §1.1, §2.1, §5.2, §5.3, §6; C7-03 §2, §9; provider ledger 1B row 1 (the 41-site leak); synthesis §8.5, §12.4.

### S4 — Context Bus

- **Responsibility.** Carry typed context on named channels between panels, surfaces and windows; replay on join; keep the default channel as the app focus.
- **Answers:** (e) workflow quality.
- **Inputs.** A publish from S2 or from a panel (through S2); the workspace document's channel assignments (S5).
- **Outputs.** Subscriptions; the current context per channel; a change event.
- **Dependencies.** S3 (payloads are entity ids), S11 (the `time` part carries session state), S5 (assignments persist).
- **Ownership boundary.** Runtime propagation only.
- **Primitives exposed.** `channel(id).publish(context)`, `.subscribe(kind, handler)`, `.current()`; `DisplayMetadata`; the payload kinds entity · entity-set · list-ref · timeframe · range · event (see §5-B.1; reconciled with information-architecture.md's Context Channel definition during Phase 2 validation).
- **Must NOT own.** Identity resolution (S3), persistence (S5), any panel's interpretation of context, the pane-focus UI. Must not become a general event bus: the crosshair and AI-search ad-hoc buses (C3: "crosshair/aiSearch are ad-hoc buses") are *not* folded in — a crosshair position is transient panel-to-panel state, not context, and the bus carrying it would be the monolith seed.
- **Build condition.** **New (typed)** on the existing seed — `WorkspaceContext`/`ChartsSymContext` colour groups + `useAppFocus` ("the strongest existing asset for a terminal" — D-11 §7.2); start with exactly one list-consuming widget (synthesis §12.1).
- **Evidence.** C3, C5; D-11 §7.1–7.2; TD-05; C5-01 §3, §9, §10; RG-06, RG-27.

### S5 — Persistence & User State

- **Responsibility.** Typed stores for the workspace document, saved objects and scalar preferences; schema versioning and migration; atomic writes; conflict detection; caps; delete; the device-local/account-following rule; backup verification.
- **Answers:** (c) backend capability for state.
- **Inputs.** Writes from S1 (document), applications (saved objects, through S5's typed API), S6 (preferences).
- **Outputs.** Versioned documents; a saved-object index S2 can resolve names against; prior versions.
- **Dependencies.** S3 (entity-keyed rows), S12 (flags may gate a migration).
- **Ownership boundary.** The *document* and the *stores*; not the behaviour that produces the document (S1) and not the meaning of any saved object (applications).
- **Primitives exposed.** `store(kind).get/put/delete/list/versions`; `migrate(kind, fromVersion)`; a write queue for concurrent writers (`setPrefMerged` + `_writeChains` — B4); cross-device sync with a highwatermark (`useTracingsSync.js` — B3).
- **Must NOT own.** `user_preferences` as a document store (TD-04), `auth.db` as a home for new tables (TD-13), a per-user server cache ("do not add one" — D-11 §7.3), the member's trade record (A13), or any store without a retention rule (TD-33).
- **Build condition.** **Rebuild the persistence layer, keep every idiom** — "every ingredient exists and none is applied to the layout" (C5-01 §7; D-11 §7.6 seed map). The strongest single change in the estate (D-11 §7 recommendation 1).
- **Evidence.** B3, B4, C4, C7, G3; D-11 §2, §3, §6, §7; TD-03, TD-04, TD-13, TD-28, TD-33, TD-38; R-13.

### S6 — Personalization

- **Responsibility.** Resolve defaults and preferences over platform primitives: density ceiling, autosave visibility, default grammar, first-run boards by what the member trades, favourites/recents split.
- **Answers:** (e) workflow quality.
- **Inputs.** S5 (preferences), S9 (tier — some knobs are metered: saved-object counts, cadence — synthesis §4.2 point 4), A13 (what the member trades, for first-run templates).
- **Outputs.** Resolved defaults consumed by S1, S2, S10.
- **Dependencies.** S5, S9.
- **Ownership boundary.** Defaults and knobs only.
- **Must NOT own.** Any store (S5), any entitlement (S9), an ML re-ranking layer before customisation is measured (C5-02 §9 moves 2 and 6 deferred — PROVISIONAL on the telemetry queries), the workspace document.
- **Build condition.** **Consolidate**: three documentation-only moves first (C5-02 §9), then two additive UI moves; firm-published boards on `charts_layouts` `scope=global` (C4).
- **Evidence.** C5-02 §9; Review §6; C4, G3; RG-11.

### S7 — Alerts & Monitoring

- **Responsibility.** The trigger taxonomy; predicate evaluation on registered values; one queue with per-type caps and reserves; the delivery-channel registry; fire receipts; the monitoring half — "checked and clean" vs "could not check," names not counts, a second channel.
- **Answers:** (c) backend capability, (d) exposure (the bell).
- **Inputs.** Registered predicates from applications; values from D2/D3/D4; scope from S3/S5; entitlement from S9; the clock from S11.
- **Outputs.** Fires with receipts; queue state; channel deliveries; monitor verdicts.
- **Dependencies.** S3, S5, S8, S9, S11, D2, D3.
- **Ownership boundary.** Evaluation, queueing, delivery; never computation of the condition's inputs.
- **Primitives exposed.** `registerTriggerType`, `registerPredicate(type, entityScope, params)`, `deliver(channel, payload)`, `receipt(fireId)`; `deliver_alert_payload` is the existing seam (I3).
- **Must NOT own.** The computation of breadth, patterns, catalysts or stop proximity (applications); the choice of which data class an audience may be alerted on (S9); a sixth subsystem; a global cap that starves scheduled insights (K7 limitation).
- **Build condition.** **Consolidate** around one taxonomy (Review §7 D7: "nothing found argues against it"); document-arrival first (C2-01 §10 "needs engineering only").
- **Evidence.** B6, D6, E7, I3, K7, K8, M4; C2-01 §6, §7, §10; TD-43; provider ledger §3.4.

### S8 — Provenance & Freshness

- **Responsibility.** One rendering component for provenance, freshness and coverage on every number, every sentence and every list: source, as-of, calculation version, the four-count receipt (evaluated · answered · dropped · not computable, with `withheld` beside), session-state stamps, the honest blank.
- **Answers:** (d) exposure of (b).
- **Inputs.** Provenance rows from D2 (a value's Entity/Activity/inputs — C7-03 §7), freshness from D4, coverage from application evaluators (G2's `scan_coverage`), session state from S11.
- **Outputs.** The rendered receipt; a linkable citation marker for any addressed value.
- **Dependencies.** D2, D4, S10, S11.
- **Ownership boundary.** Rendering and the receipt contract; not the provenance *data model* (D2) and not any evaluator.
- **Primitives exposed.** `<Provenance value=…>`, `<FreshnessBadge>`, `<CoverageLine>` (generalised from G2 — "should be a platform primitive"), `<Cited row=…>` (the click-the-number gesture, C6-02 §4).
- **Must NOT own.** The calculation of any value; a "no data" state that conflates empty, not entitled, and down (TD-18); a provenance mode-switch with no rendering change (synthesis §4.3 anti-pattern); a hand-typed count beside the artifact it describes (synthesis §4.3: "derive the number through the artifact that owns it, or print none").
- **Build condition.** **Consolidate** — generalise `CoverageLine` / the COT gate / AI-Search citation chips into one component (Review §7 D6); the freshness half of TD-08.
- **Evidence.** G2, H5, K2, D12; C6-02 §4, §9; C7-03 §7; TD-08, TD-18; synthesis §12.3.

### S9 — Entitlements & Licensing Gate

- **Responsibility.** The one authority over "what may this member see, do, save, receive, and export" — plan, cadence, data class, audience, saved-object quota — and the single publication chokepoint that asks "whose data is in this, and may it go out?" (provider ledger §3.3 last row).
- **Answers:** (d) exposure as a gate, and the licensing overlay on (a).
- **Inputs.** The session (P1), the subscription (P2/P3), the licensing register rows (F-04), the cohort (S12), the data class of the request (D2 tags).
- **Outputs.** An entitlement object every surface *and every agent* reuses (synthesis §12.5: "a parallel authorisation path is a second authority over what may this member see"); a refusal shape (`withheld`, never `dropped`/`not_computable` — P5).
- **Dependencies.** S12, D2.
- **Ownership boundary.** Decisions, not enforcement points — every data route enforces server-side (R-17 → ARCH-06: Tier S); S9 is what the route consults.
- **Primitives exposed.** `entitlement(session) → {plan, toolkit, limits, dataClasses, cadence}`; `limits_dependency` beside `require_paid` (G12/P5 — "the natural home for Terminal-Next tiering"); `mayPublish(payload, audience)`.
- **Must NOT own.** A client-side mirror as an authority (`isPaid` — TD-20); the tier *numbers* (owner-bound: **PROVISIONAL / OWNER INPUT REQUIRED: D5 / OI-03(a)(b), OI-12** — the mechanism ships with one toolkit `"all"` exactly as today, and every member-facing data class stays Restricted-pending-contract, D-002); the open-endpoint question's *intent* (**PROVISIONAL: OI-17**; ARCH-06 assumes auth on every data route TERMINAL-NEXT uses, no production change here); the metering knobs themselves (S6 reads them).
- **Build condition.** **Consolidate** — the mechanism exists (`entitlements.py`, four axes, one toolkit, reads a `toolkit` column the schema lacks — P5, TD-11); the numbers are owner input, not engineering.
- **Evidence.** G12, P1–P8; TD-11, TD-20, TD-26; synthesis §9, §12.5; provider ledger §3.3, §7 Q-9/Q-10; R-14, R-17.

### S10 — Presentation Primitives

- **Responsibility.** The DataGrid; the one number/percent/date/time formatter; the freshness badge's visual; form controls; density tokens; the table density/tap-floor rule.
- **Answers:** (d) exposure.
- **Inputs.** Values with provenance (S8), density preference (S6), the theme catalog (N12).
- **Outputs.** Rendered cells, grids, controls.
- **Dependencies.** S6, S8, N12 (tokens).
- **Ownership boundary.** Rendering primitives only.
- **Must NOT own.** Domain semantics (which column is "RS rank"); data fetching; a second `fmt*` family; a hand-typed route list for its own audit (`mobile_audit.py` — N6).
- **Build condition.** **Consolidate**: `VirtualResults` + `columnDefs` + `ColumnDesc` + `liveSort` are "~80% of a `<DataGrid>`" (TD-06); one `format` module (TD-08: 118 files define their own); `Sheet` + `useFocusTrap` mandatory for overlays (TD-09); the tabular font already loaded (`'Instrument Sans Tab'` — TD-08).
- **Evidence.** G1, N11, N12; TD-06, TD-08, TD-09, TD-48; D-06 §3, §7, §8.

### S11 — Session & Market Clock

- **Responsibility.** Exchange sessions, half-days, holidays, the pre/RTH/post/closed boundary, minutes since the boundary, per-pack as-of — as a versioned dataset, not constants; injected into every AI answer as a grounded fact and into every panel as a state.
- **Answers:** (b) normalization of time; (f) a grounded fact for intelligence.
- **Inputs.** A versioned calendar (published years ahead — C7-02 §4.1; shipped-as-code, C7-02 §4.2), the wall clock in ET.
- **Outputs.** `sessionState(now)`, `nextBoundary`, `isHalfDay`, `asOfLabel`.
- **Dependencies.** None on applications; D1 only if the calendar is vendor-sourced.
- **Ownership boundary.** Time and session only.
- **Must NOT own.** Earnings BMO/AMC bucketing (`calendarTime.js` is correctly scoped to that one job and stays with A5 — C7-02 §6 claim 3); the week anchor (`weekAnchor.js` carries two intents, railed — E2); polling cadence decisions (D4/D3 read S11, S11 does not decide).
- **Build condition.** **New**, small; the synthesis names NYSE's 2026 early closes (3 July, 27 November, 24 December) as the shape of the dataset (§12.3).
- **Evidence.** C7-02 §0 claim 3, §1.3, §4, §6; C6-02 §5, §9 ("NOT DETERMINED, probably absent"); D-12 §3d open question; synthesis §8.6, §12.3.

### S12 — Rollout, Cohort & Observability

- **Responsibility.** Server-side per-user cohort targeting; a master `TERMINAL_NEXT_ENABLED` plus a beta allowlist that the flag ledger can see; a runtime kill switch that is not maintenance mode; client-side error capture; artifact-first status endpoints; a deploy-swap survival criterion.
- **Answers:** (c) backend capability for shipping.
- **Inputs.** Admin writes (`user_tags` — P6), the flag ledger (O4), Railway flag state (ORCH reads).
- **Outputs.** `has_tag` / `require_beta` gates; one `_access_payload` field for the client (D-10 §5.3); error events; status verdicts.
- **Dependencies.** S9 (cohort feeds entitlement), O2/O3 (existing health family).
- **Ownership boundary.** How the product ships and is watched; never what it does.
- **Must NOT own.** Feature logic; a second copy of the cohort check (the Compass beta list is already implemented twice — TD-11); `user_preferences` as a cohort store (member-writable — TD-11); a streak counter that resets on redeploy as a health proxy (L4's session audit lesson: read the artifact).
- **Build condition.** **New**, on the smallest reliable addition D-10 §5.3 names; `shellFlag.js`'s four safety properties are the rollout template (TD-35 — copy the properties, not the duplicate shell).
- **Evidence.** P6, O2–O4, O8; TD-11, TD-14–TD-16, TD-19, TD-47; RG-03, RG-04; synthesis §12.5.

## 5-D. Data-platform systems

### D1 — Provider Abstraction (one ACL per vendor)

- **Responsibility.** Exactly one adapter module per vendor owning retries, timeouts, budget, error taxonomy, symbol/field translation into the canonical model, and a coverage floor; fallback order expressed as data.
- **Answers:** (a) availability, made honest; (b) normalization at the boundary.
- **Inputs.** Vendor responses; S3 for symbol mapping; D2 for the target schema.
- **Outputs.** Canonical records with a provenance row; budget and coverage telemetry.
- **Dependencies.** S3, D2, D12-style coverage monitor (the existing `provider_coverage_monitor`, "a platform requirement for any new provider lane" — D12).
- **Ownership boundary.** The vendor boundary; never business rules (C7-03 §3: "avoid placing business rules or orchestration in the layer").
- **Primitives exposed.** `adapter(vendor).fetch(dataClass, entity, params) → canonical + provenance`; `budget(vendor)`; `coverage(vendor, field)`.
- **Must NOT own.** A fallback chain in control flow (bars, transcripts, logos — provider ledger §4 "consolidation targets"); a "never raises" wrapper that makes a dead provider read as a quiet market (TD-29); any second Polygon-family vendor (provider ledger §4 #2 standing rule); the retirement *decisions* (F-09 with the owner's A–G taxonomy, DL-022 — **outside this file**).
- **Build condition.** **New** on a proven in-repo pattern: `stripe_service.py` is "the only true provider abstraction in the repo" (provider ledger row 25); `finnhub_client.py`'s token bucket + reactive cooldown + cached-forbidden state is "the internal reference implementation to copy" (C7-03 §3); the six-FMP-helper consolidation is the first proof case (Review §7 D4; provider ledger §4 #4: consolidate *before* any swap). Enforced by an AST rail of the `test_yf_guard_census.py` shape.
- **Evidence.** provider ledger rows 1, 4, 6, 25, §1B, §3.1, §4; C7-03 §3, §4; TD-29; Review §7 D4; synthesis §12.6.

### D2 — Canonical Data Model & Metric Address Book

- **Responsibility.** One canonical schema per data class (quote, bar, statement line, estimate, corporate action, news item, event, transcript, ownership row) with XBRL-borrowed names for statement items (C7-03 §6); a typed provenance record per stored value (Entity / Activity / inputs / as-of / calc version — W3C PROV shape, C7-03 §7); an **address** for every computed metric (`uct://breadth/pct_above_50sma@<as-of>` — C6-02 §4); point-in-time retention where a value can be restated (C7-03 §8, 🔴 evidence ceiling noted there); and the **per-ticker history join** (wire said · setup did · book did · flow did · member said) as the first query it must answer (synthesis §7.4).
- **Answers:** (b) normalization — the shape half; the data-modelling half of (f).
- **Inputs.** Canonical records from D1; computed metrics registered by applications (A11 registers `pct_above_50sma`; A10 registers flow aggregates; A13 registers member outcomes).
- **Outputs.** Addressed, cited-able values; the join; the metric dictionary S8 and I1 read.
- **Dependencies.** S3 (every row keyed by entity), S11 (as-of semantics), D5 (adjustment policy labels).
- **Ownership boundary.** Shape, address, provenance, dictionary; **never the calculation** — applications compute and register; D2 stores, addresses and versions.
- **Primitives exposed.** `registerMetric(id, inputs, calcVersion)`; `address(value) → uri`; `resolve(uri) → row`; `history(entity, kinds[], range)` (the join).
- **Must NOT own.** Any calculation; any vendor call (D1); a "document synthesised to hold a number" (C6-02 §4 anti-pattern); a migration of the ~55 legacy SQLite files by fiat (C7-03 §4 open question — scope to NEW TERMINAL-NEXT classes first; the legacy files are consumed through D1-shaped readers until each class is migrated).
- **Build condition.** **New**; on the critical path (synthesis §19: "not on it at Day 0"); the cheap first test is C6-02 §4's — "pick the ten figures a desk answer most often states and ask whether each has a stable id + as-of + inputs today." `bar_provenance.py` is the internal shape to generalise (C7-03 §7); `bars.db`'s one-writer/R2-bus/newer-wins is the transport precedent (C7-03 §4).
- **Evidence.** C7-03 §4, §6, §7, §8; C6-02 §4, §9; D-13 (synthesis §7.4); A10, B8 (the append-only signal ledger — "this signal fired N times" substrate); synthesis §12.3, §19, §20 item 9.

### D3 — Realtime Streaming

- **Responsibility.** Push transport: developing bars, ticks, flow, chat; one pool per browser; the single-writer invariant on the client; subscriber caps published.
- **Answers:** (c) backend capability for live data.
- **Inputs.** Vendor sockets through D1 (Massive WS for bars — A5; Finnhub WS for ticks — A2, a retirement candidate onto Massive per provider ledger §4 #5; OPRA on flow-worker — F1, partner-owned consumer).
- **Outputs.** SSE streams; `bars_emitted_total`/`last_emit_age_s`-style status (A5's admin route).
- **Dependencies.** D1, D4 (a stream hands back to a poll when silent — A5's `delivering` hysteresis), S9 (who may subscribe to what), S11.
- **Ownership boundary.** Transport and fan-out.
- **Must NOT own.** Per-panel streams (16 cells = 1 SSE — B10 locked invariant); a second mux; the OPRA consumer's internals (partner-owned); the decision to multi-worker the web pod (in-process hubs forbid it — A2, TD-12); a hand-typed gzip-exemption list (TD-30 — derive from route metadata).
- **Build condition.** **Extend**; the binding constraint is ~300 concurrent browsers per stream family (A2) and the envelope is unmeasured (CP-06, TD-31) — every fan-out number in this file is a labelled assumption until D-05 runs. Cadence-as-a-tier is the commercial lever that bounds fan-out where the pod cannot (synthesis §12.2).
- **Evidence.** A2, A5, F1, F8; TD-12, TD-30, TD-31, TD-32; D-05 via synthesis §12.2; RG-25, RG-26.

### D4 — Caching & Serving

- **Responsibility.** Serve-stale-good-only single-flight; snapshot restore at boot and save at drain; warmers; TTL policy by completeness; circuit breakers; the freshness stamp S8 renders.
- **Answers:** (c).
- **Inputs.** D1 records; S11 (market-hours-aware TTLs).
- **Outputs.** Served values with freshness; warm-state telemetry.
- **Dependencies.** D1, S11.
- **Ownership boundary.** Serving policy.
- **Must NOT own.** A per-user server cache (D-11 §7.3 "by design — do not add one"); per-surface TTL literals (D-12 §8 #6: no policy module today); a cache salt as a stand-in for session state (C6-02 §5).
- **Build condition.** **Extend** — `cache.py`, `cache_snapshot.py`, `serve_stale.py` (5 consumers, under-adopted), `cache_policy`, `source_circuit_breaker` are "the most valuable code in `api/`" (O6). Pair every data class with a coverage floor (provider ledger §2 recommendation).
- **Evidence.** O6, A3, A11, E11 (the serve-stale + warmer pair as "the structural fix"); TD-15, TD-17; D-11 §5.

### D5 — Reference & Corporate-Actions Data

- **Responsibility.** Splits, dividends, delistings, symbol changes as canonical events; **adjustment stored as a labelled policy** with a detected → confirmed → applied pipeline and a label at the point of display ("split-adjusted, 2026-09-02" / "as reported"); the raw-and-adjusted parallel views.
- **Answers:** (a)/(b) for the reference class.
- **Inputs.** Massive `/v3/reference/{splits,dividends,tickers}` through D1 (the only Massive row whose external-publication column is LA — provider ledger §2 "Corporate actions"), FMP `stable/splits`; yfinance dividends retired (X at every class).
- **Outputs.** Events applied to S3 (identity changes) and to D2 (adjustment labels on series).
- **Dependencies.** D1, S3, D2.
- **Ownership boundary.** Reference events and the adjustment *policy*; not the bars store and not an events calendar.
- **Must NOT own.** The M&A / spin-off / rights / buyback **event calendar** (NO PROVIDER — provider ledger §3.2; **PROVISIONAL / OWNER INPUT REQUIRED: D8** — deferred to roadmap, reversible because D5's event shape is the same shape the calendar would consume); the "stale intraday → swap vendor" fallback as an adjustment mechanism (C7-02 §1.7 — the symptom this system replaces); the breadth collector's dividend-adjusted history (its own project — provider ledger §4 #7).
- **Build condition.** **New, small** — C7-02 §6 claim 2: TradingView's explicit-confirm and Bloomberg's labelled raw-plus-adjusted are "cheaper-than-a-full-corporate-actions-engine responses"; adoptable "well before a genuine corporate-actions feed." Emerging risk 11 in the synthesis (silent adjustment-scope change on the fallback path) is closed by the label.
- **Evidence.** C7-02 §1.7, §3.1–3.3, §6; provider ledger §2 row "Corporate actions", §5.3; synthesis §12.4, §14 item 11; A10 (`BARS_SPLIT_REPAIR_ENABLED=0` on web).

## 6. Applications

Shorter blocks; each application inherits the platform contract of §3.2 and is described only where its boundary is non-obvious. Build condition is the Review's unless changed.

### A1 — Markets
Quotes, snapshots, movers, index/ETF/futures strips, ticker meta and logos. **Owns** the quote panel and the movers surface; **must not own** the tick transport (D3), the entity (S3), or an unauthenticated read path (A1, A6, A7 are open today — OQ-15; **PROVISIONAL: OI-17**). Futures quotes come from yfinance (X) — no licensed futures quotes exist (provider ledger §2) and the strip must render the honest blank rather than an Unsuitable source under TERMINAL-NEXT's entitlement. **Extend.** Evidence: A1, A6–A9; provider ledger §2.

### A2 — Charts & Analytics
The price chart, drawings, indicator/formula platform, multi-chart grid, compare. **Owns** everything inside `ChartPane`; **must not** be refactored inside TERMINAL-NEXT scope — "mount `ChartPane`, never `StockChart`; treat the file as a black box with a contract" (TD-01; B1 verdict "rebuild-behind-contract"; the six-writer single-writer invariant is AST-railed). The formula platform (B5) is "the strategic platform asset" and its user-minted definitions (G3) are S2 verbs. **Extend behind a hard contract**; the ledger's own verdict is binding here (Review §5). Evidence: B1–B12; TD-01, TD-49 (drop `recharts`).

### A3 — Fundamentals & Financial Statements
Statements, ratios, key metrics, snapshot, compare, the valuation lens. **Owns** statement presentation and the derived-ratio registrations in D2; **must not own** estimates (A4), a second FMP client (D1), or per-card fetches (the 60-request storm rule — D2). EDGAR-derived fundamentals are the free, unrestricted substitute the estate underuses (provider ledger §2, §3.1) — A6 supplies the filings, A3 consumes. Restatement handling (point-in-time) is D2's, and any historical statistic over fundamentals must confirm whether the store versions restatements before it is trusted (C7-03 §8). **Extend.** Evidence: D2, D11, D12; C7-03 §6, §8.

### A4 — Estimates & Analyst Actions
Consensus, price targets, grades, ratings percentiles, the revision timeline (derivable by retaining `screener_analyst_pass` snapshots — "a storage decision, not a vendor," provider ledger §5.2). **Must not own** per-broker estimates (NO PROVIDER; a proposal routes through the ten-question checklist), the TheFly-origin redistribution question (licensing), or the earnings-date field (A5). The Finnhub 403 legs are a degraded leg to retire, not to wrap (D3; provider ledger §4 #5). **Extend.** Evidence: D3; provider ledger §2, §5.2.

### A5 — Events & Calendar (TERMINAL-CURRENT coexistence)
Earnings, economic, IPO, dividend events; the week; the research modal; alerts on events. This *is* TERMINAL-CURRENT. **Coexistence rules, binding:** consume `GET /api/calendar` as app infrastructure ("retiring the surface ≠ retiring the contract" — E1); never rename `calendar_*` preference keys, the widget type key `calendar`, or notebook embed params (TD-37; D-08 §8; GOVERNING_PRINCIPLES §13 "no renaming of persisted preference or widget keys"); honour or 301 the `?earnings=SYM&esection=` deep link, never retire it (E4); new keys are `tnext_*` and a new widget type id. `weekAnchor.js` and `importance.js` are the carry-forward assets (E2); `calendarTime.js` stays here (S11 does not absorb BMO/AMC bucketing). **Must not own** a second earnings-date authority — **PROVISIONAL / OWNER INPUT REQUIRED: OQ-14** (the Discord bot's `get_catalyst_calendar_context` is an unreconciled second authority; which is canonical is a data-architecture ruling this file does not make; the design assumes `/api/calendar`'s reconciled week is canonical and the bot conforms, reversible by one adapter). The four-provider earnings-date field consolidates inside D1, not here. "TBD is a data value, not an error" (C7-02 §0 claim 4) is a contract every consumer honours. **Extend carefully, coexistence-scoped.** Evidence: E1–E17; D-09 via synthesis §6.4; TD-37; OQ-13, OQ-14.

### A6 — Transcripts & Filings
Call transcripts (FMP of record, AV lazy, earningscall dormant), recaps, keyword search/alerts, SEC filings and full-text search. **Owns** the document corpus and its FTS5 stores; registers document-arrival as an S7 trigger type. **Must not own** the AI summarisation *rights* question ("the sharpest AI row" — provider ledger §5.1 Q7; storage R/U) — S9 gates; nor a fourth transcript provider before the ten-question checklist. Coverage measured n=0 in the one observed cycle (RG-15) — the S8 receipt must say so rather than render an empty panel. **Extend.** Evidence: D5–D7; provider ledger §2, §5.1; RG-15.

### A7 — Ownership
Institutional, insider, clusters, short interest. **Must not own** a second short-interest source without the licensing register (Finviz is a U-class single source with no history — provider ledger §5.5; history is "derivable by retaining the nightly column," a storage decision through D2). Form 4 / 13F on EDGAR are public domain and unused for this (provider ledger §5.4) — A6 supplies, A7 consumes. **Extend.** Evidence: D8; provider ledger §5.4, §5.5.

### A8 — News & Catalyst Intelligence
The catalyst engine, the tape, news feeds, buzz, the "why is it moving" surface. **Owns** the three taxonomies that must unify (catalyst tags, themes, cashtags — synthesis §8.4) and the primary-vs-mentioned ticker bit (C2-01 §10 "needs engineering only"). **Must not own** a browsable general feed until the posture is decided (**PROVISIONAL / OWNER INPUT REQUIRED: P-δ, the telemetry queries** — synthesis §13.8 finds no written decision either way; the architecture supports curated-first with an escape hatch at *any* granularity by making "why isn't X here" a S8 receipt rather than a tile feature); nor a retraction model it cannot source (C2-01 §10 "needs engineering"); nor tweet bodies retained past the window (RG-21). The honest negative for "why is it moving" is a first-class output (synthesis §10.4). **Extend.** Evidence: K8, M3, M5, M6; C2-01 §10, §11; synthesis §1.13, §8.4, §10.4, §13.8.

### A9 — Screening & Discovery
Screener, scans, definitions, starter library, concierge, candle library, lift ledger, the universe gate. **Owns** `CoverageLine`'s *evaluator* (S8 owns the renderer), the DataGrid's *first consumer* (S10 owns the grid), and the universe membership rule. **Must not own** a hit rate without its base rate (G6: "lift, never a hit rate"; synthesis §13.10 rule) or a second copy of the setup vocabulary (four populations, 15 shared names — TD-36; `setup_templates` is the authority, derived elsewhere). **Extend**; `VirtualResults`+`columnDefs` are extracted into S10 first or "make a sixth" (TD-06). Evidence: G1–G12; TD-06, TD-36.

### A10 — Options & Flow
Live tape, options-flow page, scoreboard, dark pool, GEX/dealer positioning, implied move, chain+Greeks. **Owns** the differentiator. **Boundary rules:** the consumer, the page and the Schwab router are partner-owned and are wrapped, never described or edited (F1, F2, F6; GOVERNING_PRINCIPLES §5); the two chain implementations collapse to Massive native (F10, provider ledger §4 #16); GEX's Schwab sourcing is an *owner sourcing question routed via the partner*, never a change request against a partner file (provider ledger §4 #9); the public scoreboard's exposure is OQ-16 (**PROVISIONAL**). Flow gaps are permanent until T+1 (F8, TD-32) and the S8 receipt says so. **Extend.** Evidence: F1–F10; provider ledger §2, §4; OQ-15, OQ-16.

### A11 — Breadth, Regime & Positioning
Breadth monitor, live row and drills, Exposure Rating, COT positioning rail and narratives, sector/RS, theme tracker, regime. **Owns** UCT's proprietary rails — benchmark workflows D and G that no research vendor serves (synthesis §10.1) — and their metric registrations in D2 (`pct_above_50sma` is the worked example throughout C6-02 §4). **Must resolve one boundary before anything else:** two regime classifiers exist (engine `market_regimes` vs the dashboard classifier — H6, "a candidate second authority"); TERMINAL-NEXT names ONE regime authority and every consumer (the verdict engine's gate, the awareness flip rule, the screener bar) derives from it. **Must not own** intraday derivation of the Exposure Rating ("not derivable intraday by construction" — H4) or a live row after the collector supersedes it (H2). Licensing note carried, not resolved: the EOD breadth row's authoritative input is yfinance (X) — H30 unsupported; a re-source is its own project (provider ledger §4 #7). **Extend.** Evidence: H1–H9; synthesis §7.2, §10.1; TD-20.

### A12 — Watchlists & Lists
Lists, flagged, tags, notes, column presets, digests. **Owns** list semantics; lists are S5 saved objects and S2 nouns (`#watchlist` scope). **Must not own** its own DnD (two implementations exist — I1), its own column store (device-local today, declared by S5), or a second alert path (I3's delivery seam moves to S7). The 20-prop `embedded` shape is *avoid* (C9). **Extend** ("best keyboard model, worst reuse story" — I1). Evidence: I1–I6; C9.

### A13 — Journal & Track Record
Journal 2.0 (accounts, positions, trades, notes, notebook, broker mirror, Compass coaching record), the firm's track record (UCT 20, the Book, lift ledger, setup triggers), the per-ticker history join's consumer. **Owns** the member's record and the firm's record; supplies the fifth perspective (P-β). **Boundary rules:** "all coaching writes go to J2 only" (CLAUDE.md, carried as a locked invariant); "mirror the broker exactly" (J4); the record is keyed by entity id going forward (S3) with ticker as alias; Journal 1.0's tables outlive their renderer and are a product decision, not a migration target (J5). **Must not own** the verdict engine (I1 reads the record, computes elsewhere), the portfolio-risk *analytics* beyond position tracking (A14, deferred — but `portfolio_heat.py` is one implementation and must not be duplicated when A14 arrives), or any store outside its own file. The #tsdr corpus is desk-only until OI-15 answers (**PROVISIONAL**). **Extend as-is; add the join through D2.** Evidence: J1–J10, N3, G6, K4, K6; synthesis §7.1, §7.3, §7.4; D-13; OI-15.

### A14 — Portfolio & Risk (deferred — D8)
Aggregate risk, scenario, factor attribution presented as Past/Present/Future over existing regime/breadth data (synthesis §4.1b). **Not built now** (**PROVISIONAL / OWNER INPUT REQUIRED: D8**; "no dossier or internal-system finding establishes it as near-term desk-blocking" — Review §7). Boundary fixed now so deferral is reversible: position state is A13's; heat/exposure metrics are D2-registered by whichever application computes them today (K4's `portfolio_heat`); A14, when built, is a presentation and scenario layer over those addresses and owns no position store. What would change the timing: OI-06 showing the desk needs it daily.

### E1 — People / Company Intelligence (evaluate only)
Not designed. The Review's posture stands: a Bloomberg/institutional-research pattern (`MGMT`, synthesis §4.1b), not confirmed table-stakes for a desk-first, options-heavy product. If it is ever built, it is an application over A3/A6/A7 data with S3 entity relations (LEI is the free entity identifier — C7-03 §2) and no new vendor before the ten-question checklist.

## 7. The Intelligence Layer (I1) — the system block

- **Responsibility.** The tool-registry contract; the verdict engine; lane routing; caps and reserves; the evaluation harnesses (report cards, `--grounding-audit`). Every answer routes through **S8's** provenance renderer — I1 does not own or build a competing rendering component. [Corrected during Phase 2 validation: this line and the Primitives-exposed line below previously listed "the one provenance renderer" as I1's own responsibility, duplicating S8's explicit ownership of it — exactly the second-authority defect this program repeatedly flags elsewhere.]
- **Answers:** (f) intelligence orchestration — and nothing else.
- **Inputs.** Registered tools (K1); context from S4 (one page-context contract replacing `setVoicePageHint` and the ask box's symbol scope — D-12 §8 #1); session state from S11; entitlement from S9; the member's record via A13's tools; addressed metrics from D2.
- **Outputs.** Rendered verdicts and answers with citations; configuration proposals (staged); insights into S7's queue.
- **Dependencies.** S4, S8, S9, S11, S12, D2, A13; every application only through its registered tools.
- **Ownership boundary.** Orchestration, rendering, evaluation.
- **Primitives exposed.** `registerTool(name, schema, provenanceShape, entitlementAxis)`; `<VerdictCard posture=…>` and `<Answer provenance=…>` (I1-authored compositions that render *through* S8's `<Provenance>`/`<FreshnessBadge>`/`<Cited row=…>` primitives, not competing renderers); `stage(configuration)`.
- **Must NOT own.** Any data class; a private prompt path into an application; a per-lane price table (TD-21); a per-lane allowlist that is not a function of S9 (D-12 §8 #3); a hedge appended to a kept fabrication (synthesis §16.1); the packs-vs-tools fork left to a default-off flag (TD-50 — resolve it explicitly; this file's position is *tools*, because packs are a second authority over "what data does the model see"); the member's seat (member traffic never on the owner's Max seat — GOVERNING_PRINCIPLES §12).
- **Build condition.** **Consolidate** — "the actual moat: give it a provenance component and a stable tool contract, don't build a new AI system next to it" (Review §6). Ship a grounding-audit equivalent for Compass before any answer-quality exam (K12, TD-50). Verdict enforcement stays admin-only until the report card clears (K4: baseline 12/50, Rungs 3–5 at 0 — CLAIM from CLAUDE.md, carried as the deploy gate).
- **7.5 The two-audience posture (PROVISIONAL / OWNER INPUT REQUIRED: D9).** One renderer, one `posture` input resolved by S9 from the audience: `decisive` (the verdict leads; the receipt follows) or `balanced` (the same receipt leads; the verdict is present, not headlined). Both render the same cited rows; neither adds a hedge to a fabrication. The report-card exam gains the refusal class C6-02 §6 asks for. Owner decides the default per audience; nothing else in I1 changes.
- **Evidence.** K1–K12; D-12 §3e, §8; C6-02 §4, §6, §9; TD-21, TD-41, TD-42, TD-50; R-18; Review §6, §7 D6/D9; synthesis §11 Temptation 3, §12.3, §12.5, §16.

---

## PART D — CROSS-CUTTING

## 8. Boundary matrix — who may call whom

Rows call columns. `●` permitted (a contract edge); `○` permitted only through a registered primitive (tool, panel manifest, trigger type); `✗` forbidden. Anything not `●`/`○` is a boundary violation to review.

| caller ↓ / callee → | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | D1 | D2 | D3 | D4 | D5 | Apps | I1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **S1 Shell** | — | ● | ✗ | ● | ● | ● | ✗ | ✗ | ● | ● | ● | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ○ manifest | ✗ |
| **S2 Command** | ● | — | ● | ● | ● | ● | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ○ registered cmd | ○ `/ask` |
| **S3 Entity** | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ● | ✗ | ✗ | ✗ | ● | ✗ | ✗ |
| **S4 Bus** | ✗ | ✗ | ● | — | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **S5 Persist** | ✗ | ✗ | ● | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **S6 Personal.** | ✗ | ✗ | ✗ | ✗ | ● | — | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ○ A13 read | ✗ |
| **S7 Alerts** | ✗ | ✗ | ● | ✗ | ● | ✗ | — | ● | ● | ✗ | ● | ✗ | ✗ | ● | ● | ● | ✗ | ○ predicates | ✗ |
| **S8 Provenance** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✗ | ● | ● | ✗ | ✗ | ● | ✗ | ● | ✗ | ✗ | ✗ |
| **S9 Entitle.** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✗ | ✗ | ● | ✗ | ● tags | ✗ | ✗ | ✗ | ✗ | ✗ |
| **S10 Present.** | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ● | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **S11 Clock** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✗ | ○ calendar feed | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **S12 Rollout** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **D1 Provider** | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ● | ✗ | ✗ | ✗ | ✗ | ✗ |
| **D2 Canonical** | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ✗ | — | ✗ | ✗ | ● | ✗ | ✗ |
| **D3 Streaming** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ● | ✗ | ● | ✗ | — | ● | ✗ | ✗ | ✗ |
| **D4 Caching** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ✗ | ● | ✗ | ✗ | — | ✗ | ✗ | ✗ |
| **D5 Reference** | ✗ | ✗ | ● | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ● | ● | ✗ | ✗ | — | ✗ | ✗ |
| **Applications** | ○ manifest | ○ register | ● | ● | ● typed | ● | ○ register | ● | ● | ● | ● | ● | ✗ | ● | ● | ● | ● | ✗ (peer apps: through D2 or S4 only) | ○ tools |
| **I1 Intelligence** | ✗ | ✗ | ✗ | ● | ✗ | ✗ | ○ insight | ● | ● | ✗ | ● | ● | ✗ | ● | ✗ | ✗ | ✗ | ○ tools only | — |

Three edges deserve a sentence. **Applications ✗ Applications**: an application never imports another (the `embedded`-prop pattern and the eleven `StockChart` importers are the debt this prevents); shared data goes through D2, shared context through S4. **Applications ✗ D1**: no application calls a vendor (66 modules build vendor URLs today — TD-29); it asks D2/D4, which asks D1. **Time-boxed build-out exception (added during Phase 3 validation, see §10's new reversibility-ledger row):** relaxed to Applications ○ D1(adapter-module-only) until D2 (Canonical Data Model) exists — new application call sites may call a D1 adapter module (e.g. `fmp_client.py`) directly during this window, never a raw vendor URL, and every such call site is a tracked debt item to re-point at D2 once it ships. **I1 ○ Apps (tools only)**: the AI reads an application only through a registered tool with a declared provenance shape — the one door that keeps six lanes from becoming twelve.

## 9. The six questions, per system

| System | (a) availability | (b) normalization | (c) backend | (d) exposure | (e) workflow | (f) intelligence |
|---|---|---|---|---|---|---|
| S1 Shell | | | | ● | ● | |
| S2 Command | | | | ● | ● | |
| S3 Entity | | ● | | | | |
| S4 Bus | | | | | ● | |
| S5 Persist | | | ● | | | |
| S6 Personal. | | | | | ● | |
| S7 Alerts | | | ● | ● | | |
| S8 Provenance | | | | ● | | (renders f) |
| S9 Entitle. | (overlay) | | | ● | | |
| S10 Present. | | | | ● | | |
| S11 Clock | | ● | | | | ● |
| S12 Rollout | | | ● | | | |
| D1 Provider | ● | ● (boundary) | | | | |
| D2 Canonical | | ● | | | | ● (data half) |
| D3 Streaming | | | ● | | | |
| D4 Caching | | | ● | | | |
| D5 Reference | ● | ● | | | | |
| Applications | | | ● | ● | | (via tools) |
| I1 Intelligence | | | | | | ● |

The table is the check against conflation. A proposal that says "we have breadth" is answering (a)/(c); whether a member can *reach* it in one keystroke with a receipt is (d)/(e) and lives in S1/S2/S8, not in A11.

## 10. Reversibility ledger — every owner-bound item and how the design stays open

| Item | Where it touches this architecture | How the design keeps it reversible | Default in force meanwhile |
|---|---|---|---|
| **OI-03(a)/(b) → D5** member-facing data licensing | S9 entitlement rows; which A1/A10/A3 fields display to members | Entitlement is a row per data class per audience, consulted by every route; changing 57 rows (synthesis §1.4) changes no application code | Restricted-pending-contract (D-002); desk scope only; one toolkit `"all"` |
| **OI-06 → D1** workspace final lock | S1 | S1's contract (manifest, promotion, error isolation, pop-out) is the same under fixed, hybrid or modular; the document is S5's either way | Hybrid (the evidenced lean); RG-27 spike only if D1 moves |
| **OI-06 → D2** command-grammar default | S2 | Grammar C substrate; the empty-box default is a per-audience S6 preference | Both entry points reachable; no default declared |
| **D9** decisiveness for two audiences | I1 §7.5 | One renderer, one `posture` input from S9 | Undeclared; verdict enforcement admin-only regardless (K4 deploy gate) |
| **D8** corporate-actions calendar; portfolio/risk | D5 (policy now, calendar later); A14 (boundary now, build later) | The deferred parts consume shapes already defined | Deferred |
| **Four telemetry queries + `charts_workspace_layout` distribution** | S6 moves 2/6; A8's feed posture (P-δ); H1/H5 | Documentation-only moves ship first; the feed decision is a S8-receipt generalisation either way | Curated-first assumed; nothing built that a "browsable" answer would delete |
| **OI-05** asset classes | S3 scope | Identity is type-tagged; widening is aliases, not a rewrite | US equities, options, indices/ETFs, COT futures positioning |
| **OI-12** commercial model | S9 | Tier numbers are S9 rows | Wire free, everything else paid; TERMINAL-NEXT paid-tier |
| **OI-17 / OQ-13 / OQ-15 / OQ-16** open-endpoint intent | S9, A1, A5, A10 | ARCH-06 assumes auth on every route TERMINAL-NEXT uses; production untouched | Treat as unintended; no program change |
| **OQ-14** canonical earnings-date authority | A5 | One adapter conforms the bot; no application depends on the choice | `/api/calendar` canonical |
| **OI-15** #tsdr corpus consent | A13, I1 | Desk-only tool allowlist row | Internal-only |
| **Applications ✗ D1 build-out exception** (added Phase 3, `provider-abstraction-spec.md` §7.2) | §3's boundary matrix, D1 (Provider Abstraction) | New call sites use a named D1 adapter module only, never a raw vendor URL; each is logged so it can be re-pointed at D2 the day D2 ships — the boundary relaxes to a tracked debt list, not an open door | Relaxed (adapter-module-only) until D2 exists; reverts to the strict rule automatically once D2 ships |
| **OI-08 / OI-18** Bloomberg seat, Gödel trial | Validation only | No design rests solely on either (Review §3 D) | Ceilings recorded |

None of these is inferred from silence. Each stays open until the owner answers.

## 11. What this architecture changes, and what it deliberately keeps

**Changed (evidence-driven, per principle 5):** the symbol string as a key → an entity id (S3); eight preference keys → one versioned document in its own store (S5); four colour letters → typed channels (S4); five alert subsystems → one taxonomy (S7); six-plus AI doors and per-surface gates → one renderer and one tool contract (I1); six FMP helpers and 66 URL-building modules → one ACL per vendor (D1); adjustment-as-a-symptom → adjustment-as-a-policy (D5); "no data" that means three things → one receipt (S8); 118 formatters → one (S10).

**Kept (per principle 6 — functioning infrastructure is not replaced for tidiness):** the RGL board and its bespoke tabs/float/pop-out (C1, C5, C6); `ChartPane` and everything behind it (B1–B12); the 154-tool registry (K1); `deliver_alert_payload` (I3); `serve_stale`/`cache_snapshot`/warmers (O6); the `bars.db` one-writer/R2-bus/newer-wins transport (A3, A12, A13); `entitlements.py`'s mechanism (P5); `user_definitions.py`'s invariants (G3); `charts_layout_service` (C4); `useAppFocus` as the default channel (D-11 §7.1); the calendar contract and every key under it (E1–E17); the partner-owned flow stack (F1, F2, F6); `CoverageLine`'s four counts (G2); the COT analytics in JS with a Node bundle for Python (H5 — "do NOT replace Chart.js here"); the coverage monitor (D12).

**Not reproduced (Review §5 list, endorsed):** multi-asset breadth; "inputs, not a verdict"; twelve assistants; unfalsifiable hit rates; a cloned Bloomberg grammar as the onboarding bet; any surface that publishes two counts of itself; a no-mobile-story posture (phone = monitoring, per the owner default — RG-10).

## 12. Risks specific to this architecture (not the program's register — those are carried, not restated)

1. **Over-decomposition read as scope.** Thirty-two named systems can read as thirty-two builds. They are not: twelve are "extend," seven "consolidate," seven "new" (five of them small), two deferred, one evaluate. The build graph is Workstream 3's and the roadmap's; this file's count is a boundary count.
2. **D2 becomes the monolith.** The address book touches everything. Its prohibition — *never the calculation* — is the tripwire; the boundary matrix forbids D2 calling any application.
3. **The platform tier ships before any application benefits from it.** Mitigation is the loop (§2): the first slice must exercise LOAD → READ → DECIDE on real panels, which forces S2/S3/S4/S8 to exist thinly rather than fully — a sequencing note for the first-slice deliverable, not a design change here.
4. **The single-process envelope.** Every fan-out and panel-count number is an assumption until D-05 measures (CP-06, RG-26). This file makes no capacity claim.
5. **A decision is inferred from an owner's silence.** The reversibility ledger (§10) is the guard; every provisional item names its default and its trigger.

---

## GAPS

- **No observed desk morning (OI-06).** The loop's state 1 layout, the grammar default, and the tenth-action test are designed to be settable, not settled.
- **No production telemetry.** Whether members customise, which panels they open, whether they route around curated surfaces — unmeasured; the personalization and feed decisions are sequenced so nothing is built that the answer would delete.
- **No contract seen (OI-03).** Every member-facing data edge in the matrix is an entitlement row with a Restricted default.
- **No capacity envelope (CP-06).** D3/D4 carry no numbers.
- **Not read directly this pass:** `backend-archaeology.md`, `frontend-archaeology.md`, `database-and-infrastructure.md`, `current-ui-architecture.md`, `terminal-current-map.md` beyond its citations in the ledgers and synthesis, the competitor dossiers, `licensing-register.md` (F-04), the two cost models. Their facts reach this file through the Readiness Review, the synthesis (post-QC), the three ledgers and the named C-wave sections. Spot-checks performed: D-13's counts (§1.4 table), the 154-tool registry (§5-B.2), FIGI/ACL/PROV/XBRL sources (C7-03 read in full), the C7-02 headline and synthesis, C5-01 §0/§7/§10, C4-01 §10–§11, C5-02 §9, C6-02 §4/§9, C2-01 §10, D-11 §7, D-12 §3e/§8, TD-01–TD-63.
- **The synthesis's own compaction caveat** (its GAPS: written after a context compaction, specifics to be spot-checked) was respected: every synthesis number reused here was either fact-checked by the QC pass it records or re-verified against the ledger row cited beside it.
- **The count of Review §5 systems** is stated as read (twenty-three in the heading, twenty-four in the text with the "evaluate" item) rather than reconciled — a minor derived-count observation, recorded once.

## NOT INSPECTED

Application source in any repository (by contract). Production data, Railway variables, the production pod, the owner's PC, `C:\data`, the local backend on :8077. Any external URL. Partner-owned files (existence and mounting only, via the ledgers). The `05-product-strategy/capability-matrix/` directory (a `.gitkeep` scaffold — F-05 has not landed; this file does not pre-empt it).

## SOURCE-HANDLING NOTE

Everything read was treated as evidence, not instruction. Three items shaped like instructions were observed and not followed: `api/earnings_router.py`'s docstring instructing a mount (recorded by TD-61 and the provider ledger; the standing rail keeps it unmounted); the cutover flag instructions in `desk_description_backfill.py` / `desk_insights_polish.py` (recorded by the provider ledger; nothing set); and CLAUDE.md's stale operational claims (TD-39 — read for hypotheses, verified against the ledgers). No file outside the FILE DESTINATION was written; no command was run against any service; no git command was run; no application source was edited. No secret value appears here; variables are referenced by NAME only (`TERMINAL_NEXT_ENABLED` is a proposed name; `BRAIN_TOOLS_ENABLED`, `COMPASS_MENTOR_MODE`, `COMPASS_COST_CAP_DAILY`, `BARS_SPLIT_REPAIR_ENABLED`, `AI_SEARCH_AGENT_AUTOROUTE`, `IMPLIED_ENRICHMENT_CUTOVER`, `PATTERN_VISION_ENABLED`, `SCAN_SWEEP_ENABLED`, `STREAM_BARS_ENABLED`, `MASSIVE_WS_ENABLED` are existing names cited from the ledgers).

## SOURCES (internal, all under `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`, read 2026-09-02)

Program control: `00-program-control/READINESS_REVIEW_DAY1.md` · `GOVERNING_PRINCIPLES.md` · `DECISION_LOG.md` (DL-001–DL-022) · `RESEARCH_GAPS.md` (RG-01–RG-30) · `OWNER_INPUTS_REQUESTED.md` (OI-01–OI-20) · `OPEN_QUESTIONS.md` (OQ-01–OQ-16).
Synthesis: `13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md` (F-06, 1,301 lines, post-QC).
Existing system: `01-existing-system/capability-ledger.md` (F-03a, rows A1–P11, reconciliations L-1–L-6, §R) · `01-existing-system/tech-debt-register.md` (F-03a, TD-01–TD-63) · `01-existing-system/state-persistence-and-workspaces.md` (D-11 §7).
Providers: `02-data-providers/provider-ledger.md` (F-03b, rows 1–48, §1B, §2, §3, §4, §5, §6, §7).
Domain: `07-technical-architecture/domain-data-platform.md` (C7-03, in full) · `07-technical-architecture/domain-symbol-master-time.md` (C7-02 §0, §1.1, §1.7, §6) · `06-ux-and-information-architecture/workspace-systems-survey.md` (C5-01 §0, §7, §10) · `06-ux-and-information-architecture/command-grammars.md` (C4-01 §10, §11) · `06-ux-and-information-architecture/personalization-patterns.md` (C5-02 §9) · `08-ai/grounding-architectures.md` (C6-02 §4, §5, §9) · `08-ai/existing-ai-systems.md` (D-12 §3e, §8) · `05-product-strategy/domain-news-intelligence.md` (C2-01 §10).
Spot-check: `05-product-strategy/proprietary-asset-inventory-raw.md` (D-13, lines 96–99, 152, 306 — counts only).
Background (claims document, not a source of fact): repository `CLAUDE.md` — used only where the capability ledger or tech-debt register cites the same section, and marked CLAIM.

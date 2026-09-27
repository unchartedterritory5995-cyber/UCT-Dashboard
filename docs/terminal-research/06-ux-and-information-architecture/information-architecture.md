---
id: WS2-IA-ARCH
title: Information architecture — how TERMINAL-NEXT behaves as one integrated professional environment
role: Phase 2 Workstream 2 (Information Architecture / Terminal UX Architecture) — architecture, not implementation
wave: phase-2
group: ARCH
category: architecture
scope: The interaction system of TERMINAL-NEXT — information hierarchy, workspace model, panel contract, navigation, global search, command invocation, keyboard model, entity context and its persistence, cross-module linking, the named workflow chains, personalization, recents/history, saved layouts, responsive behaviour, progressive disclosure — plus explicit answers to the four owner questions and the bearing on decisions D1 and D2
confidence: 🟡 overall — 🟢 where a recommendation restates a code-derived fact from the capability ledger or a Bloomberg/Gödel mechanic the dossiers grade 🟢; 🟡 wherever this file draws a design conclusion across artifacts; 🔴 on every item stamped PROVISIONAL / OWNER INPUT REQUIRED (OI-06 above all)
evidence_ceiling: "This file inherits every ceiling of its inputs and adds none. Three dominate. (1) THE DESK WAS NEVER OBSERVED — OI-06 is unanswered, so every claim about the desk's tenth action versus a member's first is a design hypothesis, not a measurement; D2 and the final D1 lock are gated on it. (2) NO BENCHMARK WAS OPERATED — Bloomberg (OI-08) and Gödel (OI-18) mechanics are documentation-derived; nothing here rests on a pixel. (3) NO TELEMETRY — `charts_workspace_layout`, `page_views`, `calendar_seen`, `calendar_alerts_fired`, `ai_search_log` are unqueried, so whether members compose boards at all is unknown. What would raise this file: one narrated desk morning, one `charts_workspace_layout` distribution query, and the RG-27 popout spike."
sources: 14 internal accepted artifacts read in full or in the cited sections (listed under SOURCES); 0 external fetches (this role fetches nothing)
uct_relevance: high
status: draft — PROVISIONAL pending OI-06 (workspace final lock, command-grammar default) and the `charts_workspace_layout` query
date: 2026-09-02
---

# Information architecture — TERMINAL-NEXT as one instrument

## 0. How to read this document

**Vocabulary.** TERMINAL-CURRENT is the existing `/calendar` surface (display-named "UCT Terminal" since 2026-09-01; route, keys, `/api/calendar/*` unchanged — GOVERNING_PRINCIPLES §1). TERMINAL-NEXT is the product this program designs. UT is the parent brand; UCT Intelligence is the product. Bare "UCT Terminal" is never used here.

**What this is.** An architecture of *interaction*: the small number of primitives every surface shares, the rules that make them compose, and the workflow chains they must carry. It is written to be implemented, maintained and performant, not to be elegant. Where a primitive already exists in the estate it is named by capability-ledger row (`A8`, `C3`, `K1` …) and reused; where the research reveals a materially better boundary the change is named and its reversibility stated. Nothing here is an instruction to change application code — Phase 2 forbids it.

**What this is not.** Not a feature list, not a Bloomberg or Gödel clone, not a PRD. Bloomberg and Gödel appear throughout as *evidence of workflows that work*, never as templates: "Bloomberg does X" never implies "UCT builds X" (GOVERNING_PRINCIPLES §9).

**The six questions, kept apart.** Every recommendation below is tagged with which of six different questions it answers, because conflating them is how a terminal ships a panel over data it does not have: **[DA]** data availability · **[DN]** data normalization · **[BC]** backend capability · **[UI]** UI exposure · **[WQ]** workflow quality · **[IO]** intelligence orchestration. §20 collects the tags in one table.

**Derived counts only.** The capability ledger's own summary (§R) *measures* 178 capability rows (`grep -c '^| [A-P][0-9]'`); the "211 rows" figure circulating in program control is not derived in the ledger, so this file cites rows by ID and never restates a count. The same rule applies to every number below: each is quoted from the artifact that measured it and cited there.

**Evidence marks.** 🟢 an accepted artifact establishes it from primary evidence; 🟡 a conclusion this file draws across artifacts, or an input with a named ceiling; 🔴 owner-bound or unobserved. **PROVISIONAL / OWNER INPUT REQUIRED** marks a design choice this file deliberately leaves open and designs around; §22 lists every one.

---

## 1. The interaction thesis

Every competitive dossier this program produced, and the Readiness Review's own product thesis (READINESS_REVIEW_DAY1 §6), converge on the same mechanic for what makes a terminal feel like one instrument instead of a bundle: **a persistent, addressable context that every panel reads without re-entry, plus one grammar for reaching any function** (Bloomberg dossier §A "three convergences"; C4-01 P4/P5; C5-01 §3). Today's UCT is the inverse — eleven per-ticker doors, four per-ticker histories that never join, no loaded security that persists across panels, no symbol master (executive-questions Q7; D-13 §11; C7-02 §1.1).

TERMINAL-NEXT's information architecture therefore rests on **five shared primitives**, each already partly present in the estate, none of which is a feature a member sees directly:

| # | Primitive | What it is | Estate seed (ledger row) | Build condition |
|---|---|---|---|---|
| P1 | **Context Channel** | A typed, named, persisted context object (entity · entity-set · list-ref · timeframe · range · event) that panels join; the successor to the four colour groups | `C3` link groups A/B/C/D + `useAppFocus`; `E17`'s "publishes the clicked symbol to its colour group" | extend (generalise the key; keep the mechanism) |
| P2 | **Address** | Every surface, panel, saved object and computed number has one canonical typeable string that is also a URL; menus, the command line and links are three front ends over one address space | `E4` deep link `?earnings=SYM&esection=`; `lib/chartDeepLink.js`; `G3` `defId@version` pins | new (the address scheme), reusing existing deep links |
| P3 | **Provenance + Freshness** | One rendering component every number and every generated sentence passes through: as-of, source, coverage receipt, click-through to inputs | `G2` `CoverageLine`; `E3` Wire three-state trust line; `H5` `cotFacts.js` grounding gate; `K2` "grounded on" chips (D-06 §8 lists five partial freshness implementations) | consolidate (D6 in the decision register) |
| P4 | **Workspace Document** | One versioned, tombstoned, hydration-gated document per board in its own store, replacing the eight-key preference bundle | `B4` `chart_settings` versioning; `C4` `charts_layouts.db`; `C7` `scheduleSave`; `G3` `user_definitions.py` invariants (D-11 §7.6 seed map) | rebuild the persistence layer only (D1) |
| P5 | **Panel Contract** | What a panel must implement to live on a board: identity, channel subscription, error boundary, freshness badge, keyboard ownership, actions, pop-out | `C2` widget registry (18 ids, `paramsSchema`, `menus.*`); `C1`/`WidgetHost`; `C5` `PopoutWindow` | extend (add the boundary and the contract fields) |

Everything else in this document — the hierarchy, the workspace model, search, commands, keyboard, linking, the chains, personalization — is these five primitives applied. That is the difference between "a cohesive interaction system" and "a collection of dashboard cards": cards share a grid; a system shares a context, an address space, a provenance rule, a document and a contract.

**The primary loop the architecture must make fast** (READINESS_REVIEW_DAY1 §6, adopted): load an entity or open a board → context propagates across every panel without re-entry → the intelligence layer surfaces a provenance-sourced, decisive read → the member acts (journal, alert, size) → the outcome feeds personalization and the member's own history. Sections 10–12 are this loop stated as mechanism.

**Confidence.** 🟡 as a synthesis; each primitive's seed is 🟢 (read from source by D-06/D-11 and carried by the ledger).

---

## 2. What makes it terminal-grade — the nine properties

"Terminal-grade" here means *decisive and fast*, not *exhaustive* (READINESS_REVIEW_DAY1 §6). Concretely, TERMINAL-NEXT is terminal-grade when all nine hold; each is testable, and each names the benchmark evidence that makes it a property rather than a preference.

1. **Context persists and is labelled.** The loaded entity is a first-class, visible field per panel or channel, with its own recents — never a colour dot alone (Bloomberg dossier §C.3 🟢; C4-01 anti-pattern 11). Test: change the entity in one panel; every joined panel follows; nothing that was not joined moves.
2. **One address space, three front ends.** Typing, clicking a menu, and following a link all resolve to the same address; a menu leaf *is* a command (C4-01 P5; Bloomberg §C.4 🟢). Test: every menu item has a typeable form and a URL; the three never disagree (a second-authority defect if they do — Q20, TD-19).
3. **Every number carries its receipt.** As-of stamp, source, coverage counts and a click-through to inputs, via one component (Bloomberg M7 🟡; FactSet's source-linking invariant; UCT's own `CoverageLine`). Test: no number renders without passing through P3.
4. **Panels are independent.** One panel throwing never takes the board (TD-02, absent today); each panel states its own clock (TD-08). Test: mount a throwing panel; siblings survive; the failing panel can be closed.
5. **Keyboard-complete on dense surfaces.** Every list row has a keyboard address; the command line is one dead key away from anywhere (Bloomberg `Number <GO>` 🟢; Gödel backtick 🟢). Test: a scan-to-decision chain completes with no pointer.
6. **Saved things become names and URLs.** A board, a screen, a watchlist, an alert definition, an AI answer — each has a short, typeable, shareable identity (Bloomberg convergence 1 🟢; UW's URL-encoded screens; Gödel's `{AAPL EQ G}` embed). Test: paste any saved thing into Discord and it opens where it was.
7. **Recovery is a feature.** Undo a closed panel, restore a prior version of a curated list, and distinguish "empty because new" from "empty because unreadable" (Gödel ⌘Z 🟢; Bloomberg `MNRS` 🟢; R-13 the UCT defect). Test: corrupt a stored board; the member sees an error and a prior version, not a blank board.
8. **Density is a control and every ceiling is published** (C5-02 §3; LSEG's "2,500 RICs"; UCT's own `GRID_MAX_CELLS=16` unstated to members). Test: a member never discovers a cap by hitting it.
9. **Nothing moves silently.** A shipped gesture, key or address is never rebound without a preference to restore it (Bloomberg `PDFU` 🟢; UCT's own Shift+F collision, TD-07). Test: every rebind ships with a revert.

Bloomberg's practitioners praise one kind of speed only — the human speed of a frozen grammar (Bloomberg dossier §K interpretation) — and that is the only kind TERMINAL-NEXT needs: the desk is discretionary swing/options, not a two-second-reaction desk (Bloomberg N10). The Nielsen anchor from C4-01 GAPS 1 sets the budget: ~100 ms per keystroke for the suggestion list, ~1 s for a commit before progress feedback [HCI reference, not a terminal measurement].

---

## 3. Information hierarchy

The hierarchy is organised by *what kind of question a surface answers*, not by existing file boundaries. It has five levels; the middle one is the workhorse and is the level UCT does not have today.

### 3.1 The five levels

| Level | Kind | Question it answers | Shape | Existing surfaces (ledger) | Status |
|---|---|---|---|---|---|
| **L0** | **Session frame** | What time is it in the market, what regime are we in, what is armed | A persistent strip, not a page: ET wall clock; `pre / RTH / post / closed / half-day`; the regime and exposure read with their as-of; alert inbox count; the command line | `N6` `sessionModel.js` + `ChartMarketClock` (already one authority for the clock); `H4` Exposure Rating (wire is the one authority); `H6` regime (two classifiers — a second authority to resolve); `I3` `AlertBell` | extend; resolve H6 to one authority [DN] |
| **L1** | **Market-wide pages** | What is the market doing; what matters today; what is moving; what is coming | Fixed layout authored by the desk; the member changes filters/columns/scope, never arrangement | Morning Wire `N1`; Dashboard cockpit `N6`; Breadth `H1–H3`; Catalysts `K8`; Live options tape `F1`; Dark pool `F5`; Screener `G1`; Events/calendar week `E1–E2` (TERMINAL-CURRENT); Flow scoreboard `F3`; COT `H5` | keep fixed; give each an address and a "promote to panel" operation (§4) |
| **L2** | **The entity page** | Everything about *this* security — the roll-up that points onward | One fixed-shape surface per loaded entity with a navigable rail of lenses; the same page whether reached from a list, a chart, an alert or a search | `D1` research modal / `/research/:sym` (12 panels in 5 tabs: Setup · Company · The Print · Coverage · Ask AI); `TickerPopup`; the eleven doors of Q7 | **the load-bearing new surface** — consolidate the eleven doors into one page with one address (§3.3) |
| **L3** | **Personal objects** | What I watch, what I built, what I am in, what I want to be told | Named, addressable, versioned objects the member owns: watchlists, boards, screens/definitions, alerts, notes, positions | `I1` watchlists; `C4` named layouts; `G3` user definitions; `I3`/`B6`/`E7` alerts (three configuration surfaces, one delivery seam); `J2` notebook; `J1` positions | keep the stores; unify the *object model* (§13) and the alert trigger taxonomy (D7) |
| **L4** | **Intelligence overlay** | What does the desk's method say, and what did the desk say before | Not a level of pages — a layer that renders *into* L1–L3 through P3: `grade_ticker`'s verdict beside the entity, the catalyst thesis beside the mover, the desk's prior view beside the name, the AI answer as a panel | `K1` 154-tool registry (one engine, three doors); `K2` AI Search; `K4` Compass/`grade_ticker`; `K7` awareness; `K8` catalysts; `L8` Desk mentions; the four histories of D-13 §11 (no join) | route through P3; build the per-ticker history join [DN] before any new lane [IO] |

Two consequences follow from the levels. First, **L2 is where UCT's scatter lives and where Bloomberg's evidence is strongest**: `DES` is "a roll-up that points onward, never the citation", identical in shape for an equity and a bond, with an explicit page rail (Bloomberg dossier §E.3 step 1; B-BBG-09 §3, §8 — `CACS` is a page *inside* `DES`, not a monitor). UCT already has the lineage (`EarningsResearchModal` → `/research/:sym`, `IdentityBanner`'s lifecycle state machine) but scoped to earnings night (D-06 §8 "SecurityHeader — reusable (rename)"). Second, **L4 never gets its own door**: the estate already has six-plus AI doors (synthesis §11 Temptation 3) and the fix is routing, not a seventh (D6).

### 3.2 The address space

Every node in the hierarchy has one canonical address. The scheme is deliberately small; the *syntax* is frozen and the *vocabulary* grows (C4-01 P2).

| Node | Address shape (illustrative, not final grammar) | URL form | Notes |
|---|---|---|---|
| Market page | `WIRE` · `BREADTH` · `CATALYSTS` · `FLOW` · `DARKPOOL` · `SCREENER` · `EVENTS` | `/t/wire`, `/t/breadth`, … | Verbs with no entity; the existing routes keep answering (coexistence, §21) |
| Entity page | `NVDA` (bare symbol loads the entity page in the active channel) | `/t/NVDA` | The symbol is an *alias* of a permanent entity id (D3); the URL carries the alias for humans and resolves through the master |
| Entity lens | `NVDA CHART` · `NVDA NEWS` · `NVDA FUND` · `NVDA EST` · `NVDA FILINGS` · `NVDA OWN` · `NVDA OPT` · `NVDA DESK` · `NVDA READ` | `/t/NVDA/chart` … `/t/NVDA/read` | One word per lens; the rail on the entity page *is* this list, so browsing teaches the fast path (P5) |
| Lens modifier | `NVDA CHART W` · `NVDA/QQQ CHART D` | `/t/NVDA/chart?tf=W` | An expression in the noun slot is allowed *only* where every consumer accepts a synthetic series, and that set is enumerated (C4-01 anti-pattern 10; thinkorswim composite symbols 🟡) |
| Market function with argument | `EARN TODAY` · `EARN NVDA` | `/t/events?d=today` | Type mismatch errors by name, never an empty surface (C4-01 P3) |
| Saved object | `#earnings-board` (board) · `@my-pullbacks` (screen) · `%swing` (watchlist) · `!nvda-190` (alert) | `/t/b/earnings-board` … | Sigil per object kind, reusing the family the member already has installed from Slack/GitHub/Discord (C4-01 P9); user-minted names (P7) with a published collision policy (§7.4) |
| Computed number | `uct://breadth/pct_above_50sma@2026-09-02T15:15ET` | same | The metric address book (synthesis §12.3; C7-03) — required before any citation renderer can cite a computed figure |
| AI answer | `/ask is SMH extended?` → a pinned answer address `/t/a/<id>` | same | The AI door is sigil-marked because its output type differs (C4-01 Grammar C); the *answer* becomes an address so it can be pinned as a panel, shared, and re-run |

The sigil table above is a design proposal with one hard rule: **the sigils are for saved and typed objects; a bare token is always tried as a symbol first in the desk default** — the precedence order is published (§7.4) and echoed above the input before commit. Whether the desk or the member default flips that order is **PROVISIONAL / OWNER INPUT REQUIRED (OI-06)** — see §8 and §19.

### 3.3 Consolidating the eleven doors into one entity page

**Observation.** Per-ticker information lives in at least eleven doors today: `TickerPopup`, the research modal on `/calendar` and `/calendar/mystocks`, `/research/:sym`, the `/charts` widgets, the catalysts tile, `/live-massive`, `/dark-pool`, GEX/dealer positioning, the Desk mentions timeline (door NOT DETERMINED, L-6), AI Search, Compass, and the journal position pages (executive-questions Q7 🟢, measured from ledger rows D1, E2, E4, E17, F1, F5, F6, K2, K4, L8).

**Architecture.** One entity page with a navigable rail of lenses; each lens is a panel that also lives on boards (promotion, §4.3). The rail order is authored by the desk once and inherits the research modal's already-shipped grouping (Setup · Company · The Print · Coverage · Ask AI), extended with the lenses the eleven doors carry that the modal does not: the live options tape filtered to the entity (`F1`, partner-owned consumer — read via the existing SSE, never edited), dark-pool prints for the entity (`F5`), GEX/dealer positioning (`F6`; sourcing question in the provider ledger §4 #9), and **the Desk lens** — what this firm said about the name and whether it was right (D-13 §11 four histories; `L8` mentions; `N3` `setup_triggers`). The Desk lens is L4 rendered into L2 and is the one lens no benchmark has (synthesis §7.4; candidate thesis P-β).

**What this consolidates and what it leaves alone.** `TickerPopup` becomes the *preview* of the entity page (hover/click → the same address with a compact renderer), not a twelfth door. The research modal's own route contract (`?earnings=SYM&esection=`, honoured on exactly two paths — `E4`, D-09 §1.7) is **honoured or 301'd, never retired**: `esection` maps to a lens name. Partner-owned surfaces (`OptionsFlow.jsx`, `live_massive_router.py`) are *linked into*, never *absorbed* (GOVERNING_PRINCIPLES §5). This is a [UI] and [WQ] change on data UCT already fetches; the one [DN] prerequisite is the entity id underneath the ticker (§10.4), because a page addressed by a string that can be reassigned will one day show the wrong company (C7-02 §1.1; Model Book's SQ/WTW watermark overrides are the symptom already in the estate).

**Confidence.** 🟢 on the scatter (measured); 🟡 on the consolidation shape (a design conclusion); 🔴 on which lenses the desk opens first in a session (OI-06).

---

## 4. Workspace model (bearing on D1)

### 4.1 The reframing the evidence forces

The fixed / modular / hybrid question the program inherited is the wrong question. C5-01 §0 and §7 establish, from the seven layout libraries and the seven products surveyed, that (a) six of seven observed workspace failure modes are persistence failures, not layout failures; (b) no library versions the document — that is the application's job in every case; (c) the products that work best are a **two-layer architecture with named, symmetric traffic between the layers** (Bloomberg's fixed panels + Launchpad with `LLP` promoting a function into a component and function-shortcuts demoting a click into a chosen panel — B-BBG-02 via C5-01 §0 🟢, mechanism ©2012/©2015). The right questions are therefore *can a page become a panel and back* and *who owns the document schema*.

UCT is already on the content side of that split: Dashboard, Breadth, Movers, Catalysts and Live Flow are fixed pages answering market-wide questions; `/charts` is the composable board for portfolio-specific ones (C5-01 §0 RELEVANCE). What is missing is the crossing in both directions and a versioned document.

### 4.2 The model: three surface kinds, two crossings, one document

| Surface kind | Who composes | Examples | Persistence |
|---|---|---|---|
| **Fixed page** (L1) | The desk | Wire, Breadth, Catalysts, Flow, Events week | Filters/columns/scope are personal objects (L3); arrangement is the desk's |
| **Entity page** (L2) | The desk authors the rail; the member picks the lens | `NVDA` → rail | The rail order and the last lens are per-member state; content is never composed by the member |
| **Board** (L3) | The member, from panels | An earnings-day board; a swing-scan board; a flow-monitoring board | One Workspace Document per board (P4) |

Two crossings, both generic rather than per-widget (C5-01 §0 RECOMMENDATION — "a widget system earns its keep when promotion is generic"):

- **Promote:** any fixed page, any entity lens, and any AI answer can be opened *as a panel* on a board (`NVDA CHART` → panel; `BREADTH` → panel; `/ask …` → pinned answer panel). The registry already models per-shell availability with `menus.{workspace,tab,mobile,journal}` flags (D-06 §1.1); the crossing is a `menus.terminal` flag plus a `promote` verb, not a new registry (D-06 §1.1 RECOMMENDATION). Test one operation — "open this page as a panel" — against the existing routes before authoring more registry entries (C5-01 §0).
- **Demote:** a click on a board panel can open the fixed page or entity page in a chosen target (the active channel's entity page by default), the way Bloomberg's per-row function shortcuts do. Demotion is what keeps a board from becoming a second copy of every page.

Both crossings run through P1: a promoted panel joins the board's channel; a demoted click carries the channel's context to the page. Neither copies state.

### 4.3 What the board is and is not

- **Bounded, not unbounded.** The board stays viewport-locked and free-placement on react-grid-layout with the bespoke slot tabs, floating panel and pop-out the estate already built on top of it (`C1`, `C5`, `C6`; C5-01 §8.3 — "UCT has already built, on top of RGL, most of what a dock library would provide natively"). Adopting a dock library is not required for any property in §2 and puts one property at risk: the `window.open` portal pop-out that keeps one SSE pool browser-wide (`C5`; C5-01 §2(a), §8 OPEN QUESTION; RG-27). The RGL v1→v2 upgrade is smaller than a dock migration and does not re-author the saved corpus (C5-01 §8.3, §10 "Model change cost"). **Anti-pattern:** workspace maximalism — a dock library, an FDC3 container, a View→Page hierarchy — before `charts_workspace_layout` has been queried once (synthesis §11 fourth temptation).
- **Capped and queued.** Port `useStaggeredMount` (≤3 mounting) and a `GRID_MAX_CELLS`-style cap to the board before any relaxation of the viewport lock, and publish the cap (C5-01 §2 RECOMMENDATION; C5-02 §3). Benzinga's four-tool cap is the blunt end of the same instinct; the number for UCT is a measured property of the pod, not a copied constant [BC].
- **Independent panels.** One error boundary in the panel body, keyed on the instance id, plus a rail that mounts a throwing panel and asserts siblings survive (TD-02 — "cheapest fix in the estate").
- **Two tab systems become one.** Slot tabs and chart-profile tabs share no code today (`C6`; D-06 §8); the panel contract has one tab model.
- **The Custom-Function-Window idea, kept as a density lever, not a hierarchy.** Tabs inside a slot exist "to reduce the number of components on the screen" (Bloomberg via C5-01 §2(b)); UCT already has them. A View→Page two-level hierarchy is *not* adopted for a two-to-five-person desk — flat named boards with addresses (`#earnings-board`) and a small persona-segmented starter set (§17) are enough, and the choice is reversible (a "page" is a named group of boards; nothing in the document schema forbids adding it later).

### 4.4 The Workspace Document

The single strongest change in the estate, and every ingredient is already in-repo (D-11 §7.6 seed map; C5-01 §7 RECOMMENDATION):

- **Shape + version:** `chartDefaults.js::mergeChartSettings` + `instanceShape.js` — a `schemaVersion`, read-time fold, tombstones, union-by-id. Stamp a version before anything else touches the layout (TD-03).
- **Autosave discipline:** `ChartsWorkspace.jsx:963 scheduleSave` — 500 ms debounce, hydration gate, flush-on-unmount; the hydration gate is a day-one requirement on any library that emits a change event on mount (C5-01 §7 failure 3).
- **Concurrent writers:** `usePreferences.setPrefMerged` + `_writeChains`.
- **Store:** its own SQLite file on the `charts_layout_service.py` / `user_definitions.py` shape (WAL, caps, delete route, append-only versions with tombstones) — **never `user_preferences`**, which has no size limit and no delete route and was rejected in-repo for exactly this use (TD-04; `user_definitions.py`'s own header).
- **Atomic apply:** one document replaces the eight-key `applyTemplate` bundle (`charts_workspace_layout`, `watchlist_settings`, `theme_tracker_settings`, `fundamentals_settings`, `breadth_widget_settings`, `chart_settings`, `charts_vol_pane_pct`, `charts_active_template`, plus `localStorage['uct.watchlist.cols']` — D-11 §2.3 🟢). Panel-type settings become fields of the document, not siblings of it.
- **Stable instance ids** that survive save/reapply, not `Date.now()` (D-11 §7.6 #4).
- **Prior version kept**, so "empty because unreadable" is recoverable and never autosaved over (R-13; C5-01 §5).
- **Geometry keyed by `(user × viewport class)`; content keyed by user** — Bloomberg's content-follows-login / geometry-follows-machine split (C5-01 §5(b) 🟡 inferred), which is also why the phone needed a separate renderer at all (D-11 §2.5).

### 4.5 Bearing on D1 — stated plainly

The evidence **sharpens** the Readiness Review's hybrid recommendation in three ways and does not reverse it: (1) "hybrid" means *three* surface kinds, and the entity page — neither market-wide nor member-composed — is the load-bearing one; (2) the decision that matters is the document schema and its store, not grid-versus-dock, and that decision can be taken now because it is reversible at the document boundary (a dock library would read the same document); (3) the modular layer stays bounded and bespoke on RGL unless the RG-27 spike shows a dock library preserves the portal's one-SSE-pool property *and* the `charts_workspace_layout` query shows members compose boards heavily enough to want native docking. **Final lock: PROVISIONAL / OWNER INPUT REQUIRED (OI-06 + the `charts_workspace_layout` distribution query + RG-27).** What would change it: a desk morning showing the desk lives in a free-floating multi-window arrangement (Gödel's 30-chart-windows model) rather than a bounded board.

**Confidence.** 🟢 on the failure-mode evidence and the seed map; 🟡 on the three-kind shape; 🔴 on the lock.

---

## 5. The panel contract

A panel is any unit that can live on a board or in the entity rail. The contract is the registry entry (`C2`, `app/src/widgets/registry.js`, 18 ids: `chart, watchlist, themes, scanner, fundamentals, breadth, aisearch, news, notebook, profile, alerts, calendar, optionsflow, periodsort, nhnl, nhnlPulse, volumescan, scatter` — D-06 §1.1 🟢) extended with the fields the terminal properties require. Adopt the registry "essentially unchanged as the panel manifest" (D-06 §1.1); add fields, do not fork.

| Contract field | Exists | Required for | Notes |
|---|---|---|---|
| `id`, `labels`, `defaults`, `placement`, `menus`, `paramsSchema`, `plainText`, `reconstructable`, `liveCapable` | ✅ | manifest, embeds, mobile | `paramsSchema` with durability regimes is the embed model the notebook already relies on (`J2`) |
| `menus.terminal` | ➕ | promotion | one flag, per D-06 recommendation |
| `context.subscribes[]` — typed context kinds the panel consumes (`entity`, `entity-set`, `list-ref`, `timeframe`, `range`, `event`) | ➕ | P1 | consumers are type-filtered, so a chart never fires on a list payload (FDC3 `addContextListener` semantics — C5-01 §9(a)); this is how Bloomberg's "only a News Panel consumes a Monitor Group" falls out of types rather than a hardcoded rule |
| `context.publishes[]` | ➕ | P1 | a watchlist publishes `entity` on row select and `list-ref` on list select; a chart publishes `entity`, `timeframe`, `range` |
| `errorBoundary` (mandatory, host-provided) | ❌ (TD-02) | property 4 | in `WidgetBody`, keyed on instance id; header stays outside the failing subtree so the panel can be closed |
| `freshness` — the panel's clock and coverage, rendered by P3 | partial (five implementations, D-06 §8) | property 3 | `LIVE / delayed N min / as-of HH:MM ET / stale` vocabulary; `CoverageLine`'s four counts where a result set can be short |
| `keyboard.scope` + `keyboard.ownsWhenActive` | partial (`activeChartRef`, `widgetKeyboardOwnership.test.js`) | property 5 | one registry (§9); the ownership ref pattern the chart already uses, generalised |
| `actions[]` — the panel's context-menu and header actions | partial (`I4` `TickerActions` is ticker-shaped) | §11 | a panel/row action model beside the ticker one (D-06 §8 "ContextMenu") |
| `address()` — the panel's canonical address given its params | partial (`plainText`) | P2 | every panel is a URL; `plainText(params)` is most of it |
| `popout` | ✅ (`C5`) | multi-monitor | keep the portal; persist "was popped" in the document (today popped state is in-memory only) |
| `density` — reads one board-level token | ❌ | property 8 | D-06 §7 OPEN QUESTION answered: yes, density is a token (`--row-h`, `--pad-y`) so one control moves every panel; per-surface exceptions are declared, not discovered |

**Partner-owned panels.** `optionsflow` is a registry id whose consumer is partner-owned (`F2`, `OptionsFlow.jsx`). The contract binds the *host*: the boundary, freshness and keyboard fields wrap the panel from outside via `className` hooks and host-side wrappers, never by editing the file (CLAUDE.md OptionsFlow-mobile rebase-safe technique is the precedent).

**Confidence.** 🟢 on what exists; 🟡 on the field list.

---

## 6. Navigation and the address scheme

### 6.1 Three doors, one address

Every navigable thing is reachable by (a) typing its address at the command line, (b) picking it from the shell navigation or the entity rail, (c) following a link rendered anywhere a ticker, number or saved name appears. All three resolve to the same address and produce the same URL. This is Bloomberg's "menus are a view over the grammar" (dossier §C.4 🟢) and C4-01 P5, and its failure mode is the estate's most expensive defect class: two vocabularies that drift (Q20; TD-19; C4-01 anti-pattern 1). The rail that keeps them honest is the existing `navGroups.js` pattern — one authority, two consumers, a test that fails on a route in no bucket (D-06 §2 🟢: "the one nav artifact worth carrying") — extended so that the address table is the authority for the nav, the rail and the command list.

### 6.2 The shell

The current `Layout.jsx` is a 109-line nav-and-theme host (D-06 §8) with an inner `.main` scroll model every scroll listener must respect (capture phase). TERMINAL-NEXT's shell adds exactly what the properties need and nothing else:

- **L0 strip:** clock/session state, regime + exposure read (with as-of), alert inbox, and the command line — always present, never a page.
- **Navigation:** the fixed pages (L1) as today's sidebar/`MoreSheet` taxonomy, derived from the address table; the entity rail appears when an entity is loaded.
- **Channel indicator:** which channel the command line will hit, labelled, with the loaded entity and its recents (§10.3) — the answer to "which pane am I typing into" (C4-01 Grammar C's own stated failure mode).
- **Whether TERMINAL-NEXT is a route inside `Layout` or its own shell** is RG-07 and belongs to the coexistence design, not this file; every reuse estimate turns on it, and the address scheme above is shell-agnostic by construction (`/t/...` is illustrative; the existing routes keep resolving either way).

### 6.3 Back, history and "where was I"

Three different questions get three affordances (C4-01 P8; Bloomberg §C.6 🟢 with one 🟡): **back one screen** (browser history — the URL *is* the address, so this is free); **what did I type** (an editable command history, reverse-chronological, re-runnable — only possible because navigation is text); **what do I always use** (favourites and recents, split by object kind, §14). `<MENU>`-style zoom-out — the entity page's rail is one level, so "up" is "the entity page", then "the shell" — is a two-step ladder, not a tree walk.

### 6.4 Deep links and coexistence

`?earnings=SYM&esection=` is honoured or 301'd, never retired (D-09 §1.7 🟢; the ladder's rules are each a fixed production bug). `/charts`'s `lib/chartDeepLink.js` and `E4`'s `useEarningsModalRoute.js` are the two deep-link seeds (D-11 §7.6). Every TERMINAL-NEXT address is a GET (TradingView's `/chart/?symbol=NASDAQ:NVDA`; UW's URL-encoded screener with its human name — C4-01 P12), so a command pasted into Discord, the wire's `rundown_html`, or a notebook opens where it was. Gödel's `{AAPL EQ G}` embed is the same idea as an inline pill (Gödel dossier M1 🟢); scoped first to surfaces UCT fully controls (notebook, boards), with Discord/wire resolution a gated second phase (Gödel M1 risk note).

**Confidence.** 🟢 mechanics; 🟡 the shell shape (RG-07 open).

---

## 7. Global search

### 7.1 One box, several input kinds, one categorised result list

Bloomberg refused to split the box: mnemonic, keyword, partial identifier and English question all go in and the *system* disambiguates with a categorised list; typing is already the search, commit runs it (Bloomberg §C.2 🟢; C4-01 P1). TERMINAL-NEXT's box accepts: a symbol or symbol expression; a lens or function word; a saved-object name; free text (a page name, a note title, a Desk session, an article); and the AI sigil. The result list is categorised by *what kind of thing* each hit is — the UW palette returns data (watchlists, contract volume bars), not only routes, and a palette that returns only page names "is a sitemap with a hotkey" (C4-01 anti-pattern 3).

### 7.2 Entity kinds the search indexes

| Kind | Backend today | Gap |
|---|---|---|
| Symbols | `A8` `/api/ticker-search` over `cap_universe.json` (3,742), ranked exact → prefix → substring, names via `ticker_meta` | ticker-only; becomes an *entity* search over the master (D3) so a renamed or delisted name resolves ("mark delisted, do not erase" — Gödel `TREND` renders delisted tickers struck-through, `godel/02-verification.md` line 98 (VERIFIED), C7-02 §5.3) [DN] |
| Lenses / functions / pages | the address table (§3.2) | new, small [UI] |
| Saved objects | `I1` watchlists, `C4` named layouts, `G3` definitions, `I3`/`B6` alerts, `J2` notes | no cross-object search exists (D-06 §8: "No entity search (screens, notes, layouts, articles)") [BC] |
| Content | `L5` education FTS5, `L7` desk articles FTS5, `D6` transcript FTS5 | exists per store; needs one federating call [BC] |
| AI | `K2` AI Search | the sigil routes here; the box never guesses that a query was a question |

### 7.3 Ranking, published

The ranking is the product when a box accepts several kinds (C4-01 §4 LSEG lesson), so it is published in the UI (`?` mode, §17) and never personalised silently. Order, adopted from Raycast's documented model with Koyfin's liquidity tiebreak (C4-01 §3, §8 🟢):

1. exact user alias (a saved object's user-minted name);
2. exact built-in verb / lens / page;
3. exact symbol (liquidity breaks ties between listings — Koyfin's published rule);
4. symbol prefix;
5. title fuzzy over saved objects and content;
6. **frecency** as the final tiebreaker only, with a visible **Reset ranking** (Raycast) so the learning is never invisible-until-wrong.

### 7.4 The collision policy — published on day one

`RS`, `EMA`, `MA`, `GAP` and `PEG` are real listed tickers; a bare `RS NVDA` is ambiguous by construction and this program's memory records the class (C4-01 §11 Grammar A cons). Neither Koyfin nor anyone else documents what happens when a user alias shadows a built-in code (C4-01 P7, OPEN QUESTION). The policy:

- **The interpreted parse is echoed above the input before Enter** ("interpreted as: entity NVDA · lens CHART · tf W"), so a collision is visible at the moment it matters (C4-01 Grammar C).
- **Precedence is the published order in §7.3**; a user cannot mint a name that collides with a built-in verb (refused at creation with the reason), and a symbol that collides with a lens word is reached with the explicit sigil (`$RS`) — the same escape UW uses.
- **"No match" and "cannot resolve" are different results** (C4-01 P3; UCT's `CoverageLine` discipline): a bare token that is neither a symbol nor a verb returns a typed message, never an empty page.

**Confidence.** 🟢 on the mechanics borrowed; 🟡 on the order (a hypothesis until measured against the desk).

---

## 8. Command invocation (bearing on D2)

### 8.1 The fork, restated against the substrate

C4-01 §11 names the sharpest fork in the survey: Grammar A (noun-first, `NVDA NEWS`, composes, optimises the tenth action on one name) versus Grammar B (verb-first palette, `>news NVDA`, zero syntax, optimises the first action of a session). It also specifies a third, Grammar C — a persistent labelled context per pane, a bare symbol retargets the pane, bare verbs run against the loaded entity, non-entity functions are recognised as such, user-minted verbs compose or carry their own entities, and one AI sigil — and calls it "the only one that fits the substrate UCT already has" because the colour group *is* the per-pane loaded security and already persists.

### 8.2 The architectural reading: C is the substrate; A and B are its two front ends

Read against P1 (the channel) and P2 (the address), Grammar C is not a third option beside A and B; it is the *engine* underneath both. Every address in §3.2 is a C-shaped sentence (`<context> <lens> <modifier>`, or `<function> <args>`, or `<sigil><name>`). A noun-first front end (A) shows the context field first and treats a bare symbol as the loaded entity; a palette front end (B) opens on `Ctrl-K`, fuzzy-matches everything, shows the `?` mode, and treats the *current* context as an implicit scope adjustable GitHub-style (Tab narrows, Backspace widens — C4-01 §8). Both emit the same address; both are recallable and editable as text; both are URLs. What the fork actually decides is therefore **which front end is the default and which precedence order applies to a bare token** — a *preference* over one grammar, not a choice between two grammars.

This is the sharpening this file offers on D2: **build the one grammar whose two front ends differ by a preference, and gate only the default on OI-06.** The design is reversible by construction — flipping the default flips a setting, not an architecture — which is what GOVERNING_PRINCIPLES §11 asks of any owner-bound comparison.

### 8.3 What is fixed regardless of the default

- **Commit and escape.** Enter commits; Esc clears; a single unmodified dead key (backtick, Gödel 🟢) focuses the command line from anywhere — the browser-legal form of LSEG's OS-level `Ctrl+Shift+Space` (C4-01 §4). `Ctrl-K` opens the palette front end. Both are one registry entry each (§9).
- **The AI door emits the deterministic text; it never replaces it.** `/ask build me a scan for tight flags above the 20-day` returns the scan *definition text* the member could have typed, staged beside the hand-set state and never over it (UW's AI filter builder; TradingView N1; C4-01 P11; synthesis §12.3). UCT's Concierge (`G4`) already does this for scans; the rule generalises to boards and alerts.
- **Every command is a URL; every URL is a command** (P2; C4-01 P12).
- **The address space is published on one page** — the whole vocabulary, the sigils, the precedence, the shortcuts — the highest learnability-per-hour artifact found in the survey and a near-free by-product of having a grammar (Gödel `/docs`; C4-01 P13 🟢).
- **`?` documents the grammar from inside the box** (VS Code, C4-01 P10); argument shape is shown in the menu as you type (Slack).
- **Nothing is rebound silently** (property 9).
- **A grammar and a menu can never disagree** — the nav, the rail and the command list are derived from one address table (§6.1).

### 8.4 What stays open

**PROVISIONAL / OWNER INPUT REQUIRED (OI-06):** the default front end and the bare-token precedence for the desk, and separately for members. The decision is made against the desk's *tenth* action of a session (where the context-first front end wins) and a new member's *first* (where the palette wins), and the two audiences may honestly want different defaults on the same grammar — which C supports and A does not (C4-01 §11 "How to choose"). This file records the working hypothesis the architecture is built to survive either way: **desk default = context-first (noun-first behaviour), member default = palette-first**, both over one grammar, neither locked. What would change it: the observed morning showing the desk reaches for a launcher-style palette rather than typing at a loaded name, or showing the desk works mouse-first (Bloomberg dossier §J OPEN QUESTION — keyboard-vs-mouse split is unmeasured everywhere in the corpus).

**Confidence.** 🟢 on the grammar mechanics (C4-01's P-series are documentation-derived and consistent across products); 🟡 on "C is the substrate"; 🔴 on the default.

---

## 9. Keyboard-first — where the evidence says it pays, and where it does not

### 9.1 Where keyboard-first is worth building

| Surface / act | Why the evidence says yes | Mechanism |
|---|---|---|
| **Symbol entry on a chart** | Already shipped and independently converges with TradingView's type-to-search (`ChartWidget` click-to-focus + type-to-search + refocus after pick — CLAUDE.md, C4-01 §5 🟢) | keep; route every ticker change through `handleSymbolChange` (existing invariant) |
| **Dense list surfaces** — screener rows, watchlist rows, catalyst rows, scan results | Bloomberg's `Number <GO>` gives every list row a keyboard address; Watchlists already has the best keyboard model in the estate (arrow-key navigation across all expanded lists, `scrollIntoView`) and the worst reuse story (`I1`; D-06 §3) | one DataGrid (TD-06 seed: `VirtualResults` + `columnDefs` + `ColumnDesc` + `liveSort`) with row addressing (`↑/↓`, `Enter` loads the row's entity into the channel, `F` flags, `A` alerts, `L` adds to list) — Bloomberg M18 🟡 |
| **Lens and timeframe switching on a loaded entity** | The tenth action on one name is where noun-first grammars pay (C4-01 §0) | bare verbs at the command line (`CHART`, `NEWS`, `W`, `5`); the chart's existing TF chords keep working (`keyboardShortcuts.js` physical `code`s) |
| **Command-line focus and window management** | Gödel's small window layer is the one worth copying wholesale: backtick focus; Esc double-tap to close (two presses for a destructive act); Tab/Shift+Tab cycle panels; ⌘Z/Ctrl+Z undo a closed panel (synthesis §5 🟢) | four registry entries plus the undo stack over the Workspace Document (§14.3) |
| **Act-at-this-price on the chart** | TradingView's modifier+cursor `+` button creates an alert/line at the cursor's price — the only mechanism in the survey that *removes a dialog* rather than adding a launcher (C4-01 §5 🟢) | an alert draft pre-filled from the cursor; the chart already owns the price→pixel mapping (`ChartCalloutOverlay`) [UI] |
| **The scan → chart → decide chain** (§12.6) | The desk's stated loop; every step above is on it | the chain completes with no pointer — that is the acceptance test for property 5 |

### 9.2 Where keyboard-first is *not* the default

- **Touch tier (≤1024px) and the phone.** The touch tier is ≤1024, not ≤640 (CLAUDE.md; `N11` tap-floor rail); a 44px target and a 21px tape row cannot coexist. The phone gets the command line as a sheet and the channel indicator, not chords (§16).
- **Chart drawing and annotation.** Pointer-first by nature; the touch quick-action bar exists (`B3`); chords stay optional accelerators.
- **The notebook and journaling.** Long-form text; the existing `g>x` chords in Journal 2.0 remain that surface's (declared twice today — TD-07's rail dedups them).
- **A new member's first session.** The evidence supports "a grammar makes an expert fast", not "a grammar makes a newcomer stay" (C4-01 anti-pattern 12; Bloomberg R21 "discoverable ≠ learnable"). Members get the palette front end, the `?` mode, starter boards and today's-tape teaching (§17) before any chord is required.

### 9.3 One registry, not a third system

Two hotkey systems exist (`react-hotkeys-hook` in five Journal files with nine `g>x` chords declared twice; the chart's hand-rolled `keyboardShortcuts.js` with physical `code`s, frozen declarations, a cycle resolver and an ownership ref) plus 87 raw `keydown` listeners; the only `CommandPalette` is private to `Settings.jsx:2416` (TD-07 🟢; D-06 §5). The chart's table is the right *model* and the wrong *scope*: build one registry with a duplicate-`(code, modifier, scope)` rail, put the palette on it, migrate the journal chords into it, and never add a third (TD-07 RECOMMENDATION). Scope is the panel contract's `keyboard.scope`; ownership is the `activeRef` pattern `widgetKeyboardOwnership.test.js` already rails. Alt chords stay unmatched so browser shortcuts survive (existing rule). Every binding is published on the one-page address/shortcut document (§8.3) — TradingView publishes a seven-category shortcut page; Benzinga's absence of any is the anti-pattern (C4-01 §5, §7).

**Confidence.** 🟢 on what exists and on the borrowed mechanics; 🟡 on which surfaces the desk uses keyboard-first in practice (unmeasured — OI-06).

---

## 10. Security / entity context — the Context Channel

### 10.1 The model

Generalise the link key from a colour letter to a channel record (C5-01 §3 RECOMMENDATION; synthesis §12.1), adopting FDC3's *vocabulary and shapes*, never its container (C5-01 §9 warning — UCT is one application; the desk's multi-monitor need is already met by the portal at zero backend cost):

```
Channel {
  id,                                  // stable; not a colour letter
  displayMetadata: { name, color, glyph },   // colour is data, so "four" is a convention not a ceiling
  context: {                           // the CURRENT context, retained; replayed on join
    entity?:     { id, alias, asOf },  // permanent entity id + the ticker alias shown
    entitySet?:  [...],
    listRef?:    { kind: 'watchlist'|'screen'|'positions'|'uct20', id },
    timeframe?, range?, event?         // typed, independently settable
  },
  history: [...]                       // per-channel recents (entities), bounded
}
```

Consumers subscribe by type (`context.subscribes[]` in the panel contract), so a chart ignores a `listRef` and a news panel accepts one — Bloomberg's "only a News Panel can consume a Monitor Group" restriction (C5-01 §3(a), one 2013 secondary source 🟡) falls out of type filtering rather than a hardcoded rule, which C5-01 §9(a) calls "a cleaner answer". Joining a channel replays its current context (FDC3 `DesktopAgent` semantics 🟢; the channel-scoped listener asymmetry in the spec is a 🟡 to re-read before implementing against — C5-01 §9 EVIDENCE). The `'N:${groupId}'` escape already proves the code path tolerates a non-letter key (`C3`; TD-05).

**Scope of the unit.** FDC3's unit is the application window; UCT's is the *panel*, which is finer and strictly more expressive — a place the estate is ahead, recorded as such (C5-01 §9(d)).

**Start with exactly one list-consuming panel** (news/buzz is the natural first) before generalising (C5-01 §3 RECOMMENDATION); the four-group ceiling already bites (`GridChartCell` bypasses `ChartWidget` because of it — TD-05), so removing the ceiling is the first measurable win.

### 10.2 What a channel is *not*

- Not session-global (global forecloses comparison — C4-01 P4) and not per-function (destroys the saving). Per-channel, with panels choosing which channel they join, and one board holding several.
- Not implicitly auto-linked. Bloomberg's per-component opt-in, in each component's own vocabulary, is verbose on purpose — "nothing is linked that the owner did not walk over and link" (C5-01 §3(c)). A promoted panel joins the board's *active* channel by default and shows which; the member can move it.
- Not a second ad-hoc bus per context type. `crosshairBus` and `aiSearchBus` are already named members of the same context object (D-06 §1.3); the typed payload absorbs them rather than adding a third.

### 10.3 Switching and labelling — the answer to "which pane am I typing into"

Grammar C's own stated failure mode is that "the whole thing collapses if 'which pane am I typing into' is not answered visually"; UCT's widget headers deliberately hide their label and carry only a colour dot (C4-01 §11 C cons). The architecture answers it in three places that never disagree:

1. **The channel indicator in the L0 strip** — the active channel's name, colour, loaded entity alias and a recents dropdown; the command line hits this channel unless the command names another (`@B NVDA`, or the palette's scope breadcrumb).
2. **The panel header** — the channel glyph *and* the loaded entity alias (a label, restored from `sr-only` to visible on the terminal shell; the density cost is one line and the alternative is the burden C4-01 anti-pattern 11 describes).
3. **The entity page banner** — the entity, its as-of, its lifecycle state (`IdentityBanner`'s `PRE → IMMINENT → PRINTED → CALL_LIVE → POST` is the earnings-night instance; a general banner needs a configurable state machine — D-06 §8).

A bare symbol typed anywhere retargets the active channel; a ticker clicked anywhere publishes to the channel of the panel it was clicked in (or, for a fixed page, to the active channel). Switching is therefore one act (type or click), and *what moved* is visible in the indicator and every joined header.

### 10.4 Persistence and identity

- **Per board:** each channel's current context and bounded history are fields of the Workspace Document (P4), so a board reopens with its entities loaded and its recents intact — the content half of "what survives a session" (Bloomberg §G 🟢 geometry / 🟡 content; TERMINAL-NEXT should restore both, and say so).
- **Per session:** the active channel and the command history are session state, restored on reload; nothing is lost on a deploy cut because the document is server-side (the 3-minute cold window is a platform property, not a state-loss path — `O12`).
- **The entity underneath the alias.** Every `context.entity` carries a permanent internal id with the ticker as a dated alias (D3; C7-02 §2.1, §6; synthesis §12.4 🟢 on the absence of a master today). This is a [DN] prerequisite for the entity page, the channel history, the per-ticker history join and every alert: a channel that remembers "SQ" without an id will one day load Block when the member meant Square. Adjustment is a labelled policy at the point of display ("split-adjusted, 2026-09-02 / as reported"), never a fallback trigger (C7-02 §3.2–3.3).
- **Precedence.** When a panel is joined to a channel whose entity changes *and* the board's list-ref changes in the same act, the entity wins for entity-consuming panels and the list wins for list-consuming panels — a typed consumer never receives both, so the Bloomberg Security-vs-Monitor precedence question (C5-01 §3 OPEN QUESTION) does not arise at the consumer. At the *channel*, the last write wins and is echoed in the indicator; no silent merge.

**Confidence.** 🟢 on FDC3's shapes and UCT's existing group mechanism; 🟡 on the typed payload set (RG-27's second half — which FDC3 context types fit — is a 15-minute follow-up); 🔴 on the master (D3 is designed, not built).

---

## 11. Cross-module linking

### 11.1 Rules

1. **Every rendered ticker is a link into the channel and an action target.** Not a hover preview (the retired Finviz hover), not a modal by default: click → publishes the entity to the panel's channel (and, on a fixed page, to the active channel); right-click / long-press → `TickerActions` (`I4`: flag, tag, add to list, set alert) plus the new "open entity page here / in a panel". This is the one gesture that already reaches "every ticker surface across the dashboard" (`I4`); the terminal adds the publish.
2. **A link never dead-ends.** If no panel on the board consumes what was clicked, the click opens the entity page in the active channel — Benzinga's Default Link "creates the receiver if none exists" (C4-01 §7 🟢), applied as a rule rather than by spawning tools.
3. **Every number is a door.** A computed number rendered through P3 carries its `uct://` address and a click-through to its inputs (Bloomberg's Data Transparency, verified in Excel and independently restated for `PORT` — Bloomberg dossier Q7 🟡; M7). Where a number has no addressable row it renders with a *named* reason, not silently (synthesis §12.3 — "a computed number with no addressable row cannot be cited by any mechanism").
4. **Every cross-surface jump carries its time.** UW's "click a minute on Market Tide → land on that minute in the flow feed" is the most terminal-like gesture observed in the set (synthesis §10.5); the channel's `range`/`event` payload is how a breadth drill, a catalyst's `catalyst_at`, a flow print or a chart click carries a timestamp into the next panel, not just a symbol.
5. **One direction of authority.** A panel that *publishes* an entity does not also re-read it from a second place; the channel is the one authority per board (P-γ; Q20).

### 11.2 The linkable payloads and who consumes them

| Payload | Publishers (examples) | Consumers (examples) |
|---|---|---|
| `entity` | watchlist row, screener row, catalyst row, mover, chart symbol field, alert, calendar chip, AI answer citation, notebook pill | chart, fundamentals, estimates, news, options tape (filtered), dark pool (filtered), Desk lens, `grade_ticker` read, journal "log a trade" |
| `listRef` | a watchlist header, a saved screen, "my positions", UCT 20 | news/buzz, calendar week (My Stocks), `grade_watchlist`, portfolio heat, a scan run scoped to the list |
| `timeframe` | chart TF bar, command line | every chart in the channel (TradingView's "same symbol, different timeframes" mode is a per-panel *opt-out* of the timeframe payload, not a second channel — C5-01 §3(d)) |
| `range` / `event` | breadth drill (a date), catalyst `catalyst_at`, flow print, earnings `PRINTED` state, replay | chart (scroll-to), flow tape (seek-to), news (window), the Desk lens (what was said around then) |

Alerts are both a publisher (an alert fires with `entity` + `event`) and a consumer (an alert definition is created from a channel's context — the act-at-price gesture in §9.1). The three alert configuration surfaces (`I3` price/line/trendline, `B6` indicator, `E7` pre-report, plus `K7` awareness and `K8` catalyst-match) already share one delivery seam (`deliver_alert_payload`); the linking rule needs the one *trigger* taxonomy D7 recommends so that "alert on this" means one thing everywhere [BC].

**Confidence.** 🟢 on the existing gesture coverage; 🟡 on the payload table.

---

## 12. The workflow chains

Each chain is stated as the steps, the address each step lands on, the panels/data it reads, the ledger rows that already carry it, and the gap. Chains are the acceptance tests for the primitives: a primitive that does not shorten a chain is not earning its place. Steps that never re-enter the entity are what make a chain fast (Bloomberg dossier §E.0 — "fast because steps 2–12 never re-enter the ticker").

### 12.1 Watchlist → security → research

| # | Step | Address / gesture | Reads | Rows | Gap |
|---|---|---|---|---|---|
| 1 | Open a watchlist (as a panel or the L3 page) | `%swing` | `watchlists`, performance columns, tags | `I1`, `I2` | columns are device-local (`uct.watchlist.cols`) — moves into the document (§4.4) |
| 2 | Arrow to a row; Enter | row keyboard address | — | `I1` (arrow nav exists) | generalise to the DataGrid (TD-06) |
| 3 | The channel loads the entity; joined panels follow | channel publish | chart (`B2`), fundamentals (`D2`), news (`M6`), calendar day (`E17`) | `C3` → P1 | timeframe/range not linked today (TD-05) |
| 4 | Read the entity page's rail without leaving | `NVDA` → rail: Setup · Company · The Print · Coverage · Desk · Options · Ask AI | `D1`–`D11`, `F1`/`F5`/`F6` filtered, `L8`, `K2` | `D1` (12 panels/5 tabs exist) | the Desk lens (D-13 §11 join) is new [DN]; options/dark-pool lenses are links into partner surfaces [UI] |
| 5 | The decisive read, with its receipt | `NVDA READ` | `grade_ticker` → `{verdict, regime, setup, grade, entry, stop, size_pct, basis, hard_flags, sources}` | `K4` (admin-gated behind `COMPASS_MENTOR_MODE`) | render through P3; D9 decides one verdict shape or two — **PROVISIONAL / OWNER INPUT REQUIRED (D9)** |
| 6 | Act | `!` alert at price; `L` log a trade; `N` note | `I3`, `J1`, `J2` | exist | the act-at-price gesture (§9.1); "log a trade" pre-filled from the channel (Compass 🧭-per-row coupling is a known deferred design — CLAUDE.md catalysts "deferred") |
| 7 | Next row | `↓` | the channel's history records the visited entity | `C3` recents (new) | per-channel recents are new (§14) |

The chain is fast because step 3 is the only place the entity is named. Today the same chain re-enters the ticker at steps 4 (a different door), 5 (Compass chat) and 6 (the journal modal).

### 12.2 News / catalyst → company → chart → fundamentals

| # | Step | Address / gesture | Reads | Rows | Gap |
|---|---|---|---|---|---|
| 1 | A name surfaces on the catalyst table, the tape, the movers or the buzz board | `CATALYSTS` / `WIRE` / `BUZZ` | 8-source composite, `catalyst_at`, thesis with ⓘ citations | `K8`, `M3`, `M5`, `A6` | the "why isn't X here" widget and ⓘ citations generalise into P3 (candidate thesis P-δ); which sources fired is invisible to the member today (Gödel M2 — "explain the filter") |
| 2 | Click the row → the channel loads the entity; the *time* travels with it | publish `entity` + `event(catalyst_at)` | — | `C3` → P1 | `event` payload is new |
| 3 | The chart scrolls to the event; the news lens opens on the window | `NVDA CHART` (range from event) · `NVDA NEWS` | bars (`A3`), news chain (`M6`), tweets (`M5`) | exist | three unconnected news taxonomies (catalyst tags, themes, cashtags) and no `primary` vs `mentioned` bit (synthesis §8.4; C2-01) [DN] — the news lens must not present every cashtag as "about" the entity |
| 4 | "Why is it moving" — the honest answer | `NVDA WHY` (a lens over the catalyst engine) | catalyst thesis, sector/beta residual, the breadth rail | `K8`, `H7`, `H2` | the deterministic version (move vs sector/beta, residual named) plus the *allowed-to-be-blank* negative ("nothing specific — a beta move with the sector") is the single largest unclaimed capability in the benchmark set (synthesis §1.13, §10.4) [IO]; Bloomberg's `MOV` contribution decomposition is the market-side analogue (Bloomberg M11) |
| 5 | Fundamentals and estimates without re-entry | `NVDA FUND` · `NVDA EST` | FMP-primary chain, `# ests` and named analyst beside consensus | `D2`, `D3` | attribution beside consensus is a near-free provenance upgrade (Bloomberg M8 🟢) [UI]; six FMP helpers with no shared budget (TD-29) is a [BC] risk on the chain's latency, not on its shape |
| 6 | Pin or move on | `#` pin the answer/lens to a board; `↓` next row | — | P4 | pinned answers as panels are new |

### 12.3 Calendar / event → company / security (the TERMINAL-CURRENT coexistence chain)

| # | Step | Address / gesture | Reads | Rows | Gap |
|---|---|---|---|---|---|
| 1 | The week, scoped to My Stocks or the market | `EVENTS` · `EVENTS %mine` | the reconciled week contract (`/api/calendar`, one placement per symbol per week), My Sets, enrichment (expected move, 4Q beats) | `E1`, `E2`, `E6`, `E11` | `E1` is app infrastructure with nine reader classes, five of them bare `.get()` chains (TD-37) — **coexistence before green-field**: the terminal *reads* the contract, never re-implements it [BC] |
| 2 | A chip → the entity, with the event | publish `entity` + `event(report_date, BMO/AMC)` | `E13` date-drift chips, `E12` day metrics | `E17` already publishes the clicked symbol to its colour group | the `event` payload carries the session (BMO/AMC) so the lifecycle banner state is correct |
| 3 | The entity page opens on The Print (or Setup, pre-print) | `NVDA` with `esection` honoured | the 12 panels; expected move with typed refusals; transcript, recap, keyword alerts | `D1`, `D9`, `D5`, `D6`, `E4` | `?earnings=SYM&esection=` honoured or 301'd (D-09 §1.7); `IMPLIED_ENRICHMENT_CUTOVER` state NOT DETERMINED (D9 row) — the refusal layer must be confirmed live before the lens renders a move |
| 4 | Step through the day's other reporters without leaving | `→` / `←` | the day's roster | `D1` step-through exists | keep; it is the calendar-native version of the tenth-action loop |
| 5 | Arm | pre-report alert; keyword alert on the transcript; `!` at the expected-move boundary | `E7`, `D6`, `I3` | exist (`CALENDAR_ALERTS_ENABLED=1` CONFIRMED) | one trigger taxonomy (D7) so "alert on this event" is one object, suspendable not only deletable (Bloomberg `NLRT` — M4) |
| 6 | After the print: the reaction, the call, the AI recap anchored to spans | `NVDA CALL` | live reactions per DayGroup, recap, transcript FTS5 | `D5`, `D6`, `E3` (the Wire) | recap bullets have no per-bullet span anchor today (Bloomberg M9 — the single strongest transferable AI idea across two leaves 🟢) [IO] |
| 7 | Economic prints inside the regime read, not a fifth tab | L0 strip: "next FOMC in N days · CPI beat/miss this morning" | `E10` econ calendar (ForexFactory `nextweek` 404; FMP other weeks) | `E10` degraded | B-BBG-09 §1 hypothesis — embed the next print and the last surprise in the session frame the way `BTMM` does, rather than build a macro page [UI] |

**Coexistence rule for this chain:** TERMINAL-CURRENT's four views, the deep link, the persisted preference keys (`calendar_view_v3`, `calendar_filters_v2`, `calendar_mystocks_sources`) and the widget type key `calendar` inside every saved board are contracts (D-09; D-08 §3.4). The terminal's `EVENTS` address is a *new door onto the same contract*; nothing is renamed without a read-fallback shim, and the 32-item change list in D-09 is the checklist.

### 12.4 Alert → investigation

| # | Step | Address / gesture | Reads | Rows | Gap |
|---|---|---|---|---|---|
| 1 | The alert arrives in one inbox, on every channel it was routed to | `ALERTS` (L0 count) | `AlertBell`, email, Discord, browser notification, sound | `I3`, `E7`, `K7`, `K8` share `deliver_alert_payload` | one inbox exists in-app; one *routing rule* set once for every alert type (Bloomberg `MRUL` — Q6 🟢) is new but cheap on the shared seam [BC] |
| 2 | The alert *is* an address | click → `NVDA` with `event(fired_at, rule)` | the alert's rule, the value that fired, the as-of | `B6` fired log; `I3` `triggered_at` | every alert carries its receipt through P3 (which rule, which number, which source) |
| 3 | Land on the right lens with the time | chart scrolled to the fire; the tape at that minute; the news window | `A3`, `F1`, `M6` | exist | the `event` payload (§11.2) |
| 4 | Contrast: what else fired, what the desk said | `NVDA DESK`; the awareness feed | `K7` (tile unmounted since the cockpit retirement), `L8`, `N3` | partial | the awareness feed re-mounts as an L0/L4 surface, not a dashboard tile |
| 5 | Decide and re-arm | `NVDA READ`; suspend / edit / re-arm the alert; log the outcome | `K4`, `I3`, `J1` | exist | suspend-not-delete (M4); "this would have fired N times last week" at authoring time (Bloomberg M10 🟢 — the Advanced Editor's stories-per-hour) is the tuning receipt an alert taxonomy should carry |

### 12.5 Research / intelligence workflows

The AI layer is one more consumer of the same channel, address and provenance primitives — never a second authority (Bloomberg dossier §I interpretation 🟡; synthesis §12.3).

| Workflow | Address | What happens | Rows | Gap |
|---|---|---|---|---|
| **Ask about the loaded entity** | `/ask …` with the channel as scope | AI Search's intent-gated packs with declared grounding gaps; "grounded on" chips; the answer becomes an address and can be pinned | `K2` (paid; `AI_SEARCH_CLAUDE_SYNTH=1`) | desk data is cited in prose only, no `[desk:x]` markers (`K2` debt); computed metrics need addresses (C7-03) before a chip can point at them [DN] |
| **The decisive read** | `NVDA READ` | `grade_ticker` composes regime → quote → patterns → playbook → sizing into one typed verdict; the persona cannot hedge | `K4` | admin-only until the report card clears Rungs 3–5 (CLAUDE.md, CLAIM); one shape or two is D9 — **PROVISIONAL / OWNER INPUT REQUIRED (D9)** |
| **Grade my list / can I add** | `%swing READ` · `HEAT` | `grade_watchlist` funnel with mandatory list-level synthesis; `portfolio_heat` as a state read with no GO-path | `K4` | list-ref payload (§10) is the input; the heat read is a *read*, rendered as such, never a verdict (B-BBG-09 §7 draws the same line for `PORT`) |
| **The desk's prior view — the fifth perspective** | `NVDA DESK` | what the wire said (`leadership_snapshots`, `wire_universe` drop reasons), what the setup did (`setup_triggers`), what the book did, what the Desk said on video (`ticker_moments`) | `N1`, `N3`, `L8`, D-13 §11 | **no join exists** — the first data-model deliverable (candidate thesis P-β); a data-modelling job, not a UI job [DN] |
| **English → a scan / a board / an alert** | `/ask build …` | the Concierge emits the definition text, staged beside hand-set state | `G4` (Concierge exists for scans) | generalise the *emit-the-text* rule to boards and alerts (C4-01 P11) [IO] |
| **Standing research** | `@my-briefing` | deep research, standing briefings, weekly deep | `K3` (the only lane with a scheduled-vs-member reserve) | the reserve idiom extends to every lane before any member-facing lane ships (R-18; ARCH-05) |
| **Session-aware answers** | implicit | session state injected as a first-class grounded fact (ET clock, `pre/RTH/post/closed/half-day`, minutes since the boundary) | L0 strip already derives it (`sessionModel.js`) | no AI lane injects session state today (C6-02 §5 via synthesis §12.3) [IO] |

### 12.6 Scan → chart → decide (the desk's own loop, for completeness)

`@my-pullbacks` (a saved definition; coverage receipt evaluated · answered · dropped · not-computable, `withheld` beside — `G2`) → arrow the results as a DataGrid → Enter loads the entity into the channel → `CHART D` / `W` → `READ` → `!` at price / `L` log → `↓`. Every step is on the keyboard path (§9.1); the only new primitives are the DataGrid row addressing and the channel. The three-way save fork at the point of saving a result set — a frozen list, a re-runnable definition, or a standing alert (thinkorswim, C5-02 §5 🟢) — is the personalization move this chain needs (§13.2).

**Confidence.** 🟢 on the rows each chain already carries; 🟡 on the step ordering (no chain was observed end-to-end — the same ceiling every Bloomberg workflow carries, §E); 🔴 on which chain the desk runs first each morning (OI-06).

---

## 13. Personalization and the saved-object model

### 13.1 The three already-evidenced moves (READINESS_REVIEW_DAY1 §6), plus the object model

The review names three moves that extend rather than invent: **publish density ceilings**, **name the objects that do not autosave**, and **extend the firm-editable pattern from scans to boards**. This file adds the object model those moves need, drawn from C5-02.

### 13.2 Saved objects separated by lifetime

TradingView separates three objects with three lifetimes (layout · indicator template · column preset); Koyfin five; UCT conflates "the way I read a table" across a global per-type pref, a per-instance `opts.settings` and a localStorage key (C5-01 §1 🟢). The terminal's object model names each lifetime and puts each in one place:

| Object | Lifetime | Store | Addressable as | Notes |
|---|---|---|---|---|
| **Board** (arrangement + channels + per-panel settings) | member; versioned | Workspace Document store | `#name` | absorbs the eight keys |
| **Analysis stack** (indicators/overlays/drawing defaults) | member; portable across boards | `chart_settings` seed (`B4`) | `@stack-name` | the missing "portable analysis stack" (C5-01 §1) |
| **Table view** (columns, density, sort) | member; portable across panels of one type | the document's panel settings, *not* localStorage | part of the board, or `@view-name` | ends the three-way split |
| **List** (watchlist / tag auto-list / positions) | member; snapshot **or** subscription — asked once at creation (Bloomberg copy-vs-link, M12 🟢) | `auth.db watchlists` (`I1`) | `%name` | tag auto-lists already track by construction |
| **Definition** (screen/scan/formula) | member; append-only versions, tombstones, `defId@version` pins | `user_definitions.db` (`G3` — the strongest persistence design in the repo) | `@name` | firm setups arrive as ordinary editable definitions (`starter_library.py`) |
| **Alert** | member; suspendable, not only deletable | one trigger taxonomy over the shared delivery seam (D7) | `!name` | fire history is the alert's provenance |
| **Note** | member; frozen embed params | `j2_notes` (`J2`) | `~title` | renaming a widget type or param orphans member content (D-08 §3.5) — the registry's `paramsSchema` freeze is the rule |
| **AI answer** | member; pinned | AI Search member store (`K2`) | `/t/a/<id>` | an answer is an object the moment it is pinned |

**The save fork.** When a member saves a result set (a scan, a screener view, a catalyst table filtered), the product asks what it should become — a frozen list, a re-runnable definition, or a standing alert — rather than silently deciding (thinkorswim's three-way fork; AlphaSense's Saved Search → Follow; C5-02 §5 RECOMMENDATION). Naming the lifetime at the moment of saving is the discipline; a guessed default is "wrong half the time and the wrongness is silent" (Bloomberg M12).

### 13.3 Firm-authored, member-editable — extended from scans to boards

Starter boards ship as ordinary editable artefacts segmented by what the member trades (swing-equity, options-flow, macro/breadth, earnings-day), the way `starter_library.py` ships the firm's scans (C5-01 §4; Bloomberg M17 🟢 — "the sample must be the real thing, taken apart"). The picker ranks panels by real usage and previews before commit — tested separately from ranking so the result is attributable (C5-01 §4 RECOMMENDATION). Whether declared/observed member role should *re-rank* the picker on an ongoing basis (LSEG's persona re-ranking, C5-02 §4) is deferred until the `charts_workspace_layout` query says whether members compose at all (C5-02 §9 sequencing).

### 13.4 Density, ceilings and autosave — the documentation-only moves first

- Density is one board-level token (§5) with a visible control; the ceilings that already exist in code (`GRID_MAX_CELLS=16`, the panel cap, `STREAM_MAX_SUBSCRIBERS=300`'s per-browser share) are published where the member can see them (C5-02 §3 — LSEG's "2,500 RICs" idiom).
- Autosave is a visible state, not a silent 500 ms debounce (TradingView's autosave toggle, C5-01 §1; C5-02 §9 #4); the one object that does not autosave, if any, says so in its own UI (Koyfin's stated exception).
- What follows the login and what stays on the machine is stated in one place (LSEG's Desktop-and-Web comparison, C5-02 §8): today prefs and named layouts sync while drawings (`B3`, device-local by accident of order — D-11 §4.1) and watchlist columns do not; the terminal moves both into account-following stores and *says which*.

### 13.5 Metering and roles — deferred, named

Saved-object counts are the price axis at three vendors (UW, TradingView, Koyfin — C5-01 §6 signal 1–2) and `entitlements.py` (`P5`, `G12`) is the one place a tier number should live; no number is set here (D5, OI-12 — **PROVISIONAL / OWNER INPUT REQUIRED**). A Viewer/Editor role layer over the same stores (Koyfin Teams) is additive on the existing owner-id columns and waits for a multi-seat need (C5-02 §7).

**Confidence.** 🟢 on the stores and the benchmark mechanics; 🟡 on the object model as a whole.

---

## 14. Recents, history and undo

### 14.1 Three questions, three affordances

"Where was I" is three questions (C4-01 P8; Bloomberg §C.6): back one screen (browser history — free because every address is a URL); what did I type (an editable, re-runnable command history; `↑` recalls the previous command as Spotlight does previous searches); what do I always use (favourites and recents).

### 14.2 Recents split by object kind, not one feed

Bloomberg's toolbar carries **two** recents drop-downs — securities and functions — mirroring the what/how split (C4-01 P8 🟢; C5-02 §6). TERMINAL-NEXT keeps three lists, never interleaved: **entities** (per channel, bounded, in the document), **verbs/lenses/pages**, and **saved objects** (boards, screens, lists). The Flagged list stays what it is — a member-trusted symbol list — and is not repurposed as recents (C5-02 §6 RECOMMENDATION: add beside, do not replace). Retention window and cap have no public precedent (C5-02 §6 OPEN QUESTION); they are a measured decision after dogfood, defaulting to a small fixed number per list.

### 14.3 Undo

- **Undo a closed panel** — Gödel's ⌘Z, the one product in the survey that treats the workspace as an editable document with an undo stack (synthesis §5 🟢). Implemented over the Workspace Document's version history, not as a separate stack.
- **Restore a prior version of a curated object** — Bloomberg's `MNRS` ten-deep restore, built for the one object users destroy most (their lists) (C5-01 §5(c) 🟢). Ship version history first on the smallest surface with the clearest loss — watchlists — then boards (C5-01 §5 RECOMMENDATION; Bloomberg M13). `user_definitions.db` already does this for definitions (append-only, tombstones).
- **Never restore geometry without content, or content without saying so** — Bloomberg's "cannot restore a tab after you close it" beside a fully restored window layout is a stated weakness (dossier §J.2); the document restores both or names what it could not.

**Confidence.** 🟢 on the mechanics borrowed; 🟡 on the list caps.

---

## 15. Saved layouts and views — persistence rules

A compact restatement of §4.4 as rules, because this is where every workspace product in the survey actually differs (C5-01 §5(d)):

1. One versioned document per board, in its own store, atomic on apply, with a kept prior version. Never `user_preferences`.
2. Boards are named and addressable (`#earnings-board`; `BLP AGAIN "NAME"`'s idea — C5-01 §5(a)); a board for 07:00, 09:30 and 15:45 is three names, not one compromise board (C5-01 §5 RELEVANCE).
3. Content follows the login; geometry is keyed by viewport class; the rule is published to members.
4. "Empty because new" and "empty because unreadable" render differently, and the second is never autosaved over (R-13; property 7).
5. Hydration gate on every save path; the change event a library fires on mount never persists a default over a real board (C5-01 §7 failure 3).
6. Breakpoint remapping never rewrites the only saved layout (the 24-columns-at-every-breakpoint rule's reason — C5-01 §7 failure 4).
7. Rails exercise the *member* path (`fix/charts-layouts-uuid` lesson; TD-38 — `user_id INTEGER` holding UUID strings), and any key-rename shim ships with a test (D-11 §7.6 #6; the calendar's has none).
8. Popped-out state and per-channel context are fields of the document, so a reopened board is the board that was left.

**Confidence.** 🟢 — every rule names an incident or a rail already in the estate.

---

## 16. Responsive behaviour

The evidence is relevant in one direction only: the member base is measurably touch-heavy (READINESS_REVIEW_DAY1 §5 last bullet; CLAUDE.md's touch-tier rail), and Benzinga's split-brand mobile app is the named anti-pattern (C5-02 §8 — the workflow does not travel because the two apps are not the same software).

- **Desktop-first; the phone is for monitoring, context and action, not composition.** RG-10 records the owner default (desktop-first; phone = monitoring only). The board renderer stays a *different renderer of the same document* (`MobileWorkspace` — `C8`; C5-02 §8 places UCT in the "one product, partial parity, gap documented" posture), not a second product. `menus.mobile` already declares exactly five panel types phone-usable (D-06 line 795 🟢); the terminal publishes that list to members (LSEG's comparison-document idiom).
- **The touch tier is ≤1024, not ≤640.** Tablet is under-covered (209 stylesheets handle ≤640 versus 131 ≤1024 — `N11`); a floor restored only at ≤640 leaves tablet broken (program memory, recorded in the ledger). Every terminal surface is verified at 390/820/1200 in a browser — the one thing no unit test can see (CLAUDE.md mobile audit; D-06 §7 EVIDENCE CEILING).
- **What travels to the phone:** the L0 strip (clock, regime, inbox), the channel and its entity (so a phone opens on the same name the desk left), the entity page's rail (compact), alerts and their receipts, the command line as a sheet (the `MoreSheet` single-directory rule — one menu, every trigger opens *that*; the `MobileTabBar` was removed 2026-09-01 for duplicating it), `TickerActions` via long-press (`I4`). What does not: board composition, chords, drawing beyond the quick bar.
- **State parity is stated, not discovered.** Whether `MobileWorkspace` carries every saved-object type a desktop board can is unmeasured (C5-02 §8 OPEN QUESTION); the document model makes the answer a field list, and the field list is published.

**Confidence.** 🟢 on the tier facts and the anti-pattern; 🟡 on the phone scope (RG-10 is an owner default, not a decision).

---

## 17. Progressive disclosure of complexity

Bloomberg's own lesson is that discoverable is not learnable — everything is reachable from the box and knowing what to type is the cost, paid with an eight-hour course (Bloomberg R21 🟢). TERMINAL-NEXT pays it differently, in layers a member can stop at:

1. **Day one: a bare symbol works.** Type or click a name; the entity page opens; the rail shows the lenses by name. No vocabulary required (C4-01 Grammar C "learnable in layers").
2. **A starter board, not a blank canvas**, segmented by what the member trades, live and editable — the teaching artefact *is* the sample taken apart (Bloomberg Sample Views 🟢; C5-01 §4). `/charts` starts empty today (`DEFAULT_LAYOUT = { widgets: [], cols: 24 }` — D-11 §2.2).
3. **Curated first, everything one gesture away** (candidate thesis P-δ; Bloomberg's `TOP` with "All Stories" one click away; Benzinga's WIIM slot allowed to be blank). Every curated surface carries a `CoverageLine`-style receipt and a "why isn't X here" door.
4. **Verbs accrete.** The rail names teach the lens words; the `?` mode lists the modes from inside the box; argument shape appears as you type (C4-01 P10). The one-page address/shortcut document exists from the first release (P13).
5. **Teach with today's tape, not a tour.** One sentence in the Wire, the Desk session or the evening update naming the surface that shows what moved this morning — Bloomberg's `FFM`, the cheapest onboarding idea in the corpus, riding content UCT already ships daily (Bloomberg M15 🟡; C4-01 P14).
6. **User verbs last.** A member who repeats something names it (`fcsp`-style — C4-01 P7) and only then pays the naming cost; the collision policy is already published.
7. **A persona map, not a generated menu.** "If you are a swing trader at this desk, here are the twelve places you live" — Bloomberg's per-persona one-pager is editorial, ~10% of the surface (Bloomberg M14 🟡); the address table makes it a filter, not a second document.
8. **Beta and status at the point of use.** A `<StatusPill>` consuming the feature-flag ledger (`O4`) tells a member a lens is beta *on the lens*, never in a footer (Gödel M5 🟢); and beta is a state that expires, never a permission (Gödel N1).
9. **Density is a control; ceilings are published; a cap always has a meter** (Bloomberg M5 — "a cap without a meter is a mystery outage"; UCT's own LLM daily caps and provider quotas are the live instances).

**Confidence.** 🟢 on the borrowed mechanics; 🟡 on the layering as a whole.

---

## 18. The four explicit answers

### 18.1 What makes UCT Terminal feel "terminal-grade"?

The nine properties of §2, and one sentence: **the loaded entity persists and is labelled, every function is one address reachable three ways, every number carries its receipt, panels cannot take each other down, dense surfaces are keyboard-complete, saved things become names and URLs, recovery is designed, density and ceilings are visible, and nothing moves silently.** Not one of these is a Bloomberg feature; each is a property the dossiers found under Bloomberg's, Gödel's, Koyfin's, UW's and TradingView's *different* features, and several are already UCT's own (`CoverageLine`, the Wire's trust line, the portal pop-out, the COT grounding gate). "Terminal-grade" for a two-to-five-person discretionary options-and-equities desk means *decisive and fast*, and the speed that matters is the human speed of a frozen grammar, not feed latency (Bloomberg dossier §K; N10).

### 18.2 What should be dramatically EASIER than Bloomberg?

| Bloomberg | TERMINAL-NEXT | Evidence |
|---|---|---|
| ~30,000 functions, a four-letter namespace that collides invisibly (`EA`, `OWN`/`HDS`), fifteen doors to one topic | A vocabulary sized to two asset classes and one desk; one door per capability; one page holding the whole address space | dossier N5, N6, R10–R11; C4-01 P13 |
| An 8-hour course, per-persona cheat sheets, a 24/7 desk, "discoverable ≠ learnable" | A bare symbol works on day one; `?` inside the box; a starter board that is the lesson; today's-tape teaching | R21; C5-01 §4; C4-01 P10, P14 |
| Sigils and keys that exist only on Bloomberg | `$ @ # / ?` the member already has from Slack/GitHub/Discord; backtick from anywhere | C4-01 P9; Gödel §C |
| The loaded security inferred per panel from a toolbar field; linking opt-in in each component's own vocabulary | One channel indicator that says exactly what the next keystroke will hit; typed payloads so a chart cannot receive a list | C4-01 anti-pattern 11; C5-01 §9 |
| "There is no such formula" — the analyst assembles the read on every seat, every time | The read is computed, decisive and receipted at the loaded entity; the inputs are one click deeper, not the destination | dossier §E.3, closing section; `K4` |
| "Why is it moving" answered by adjacency (`MOST` → `CN`) | Pre-answered with a cited thesis and an honest negative | dossier §E.1; synthesis §1.13, §10.4 |
| Multi-monitor via per-computer resolution and a desktop install | A `window.open` portal at zero backend cost, already shipped | C5-01 §2(a); `C5` |
| Download caps with no gauge, discovered by a broken cell | Every cap has a visible meter | M5 |
| Undo only for monitors; "cannot restore a tab after you close it" | Undo a closed panel; prior versions of lists and boards | Gödel ⌘Z; `MNRS`; §14.3 |
| Export friction as lock-in | The member's data leaves freely, stated as a differentiator | dossier N3, §L RECOMMENDATION |
| A no-mobile-story posture for the workflow | The same document on the phone, with what travels published | §16 |

### 18.3 What should AI make possible that a legacy terminal cannot do naturally?

Bloomberg's AI layer is a renderer over its classified corpus and the loaded security — attribution is its headline, and ASKB "complements existing workflows" because the incumbent cannot ask its users to change how they work (dossier §I interpretation 🟡). A small desk can do five things a legacy terminal cannot do *naturally*:

1. **Decide, with the receipt attached.** `grade_ticker`'s structural GO/HOLD/SKIP — decisiveness enforced by hard gates, every number tool-sourced — rendered at the loaded entity through the same provenance component as every other number (candidate thesis P-α; `K4`). Bloomberg cannot sell a position without becoming an advice business; a coached membership is the audience that makes it possible (D9 decides for whom — **PROVISIONAL / OWNER INPUT REQUIRED (D9)**).
2. **Answer "why is it moving" — including "nothing specific."** The catalyst engine's composed thesis with `catalyst_at`, the deterministic move-vs-sector residual, and the `CoverageLine` blank make the honest negative a first-class answer; ten of twelve benchmark products ship nothing here (synthesis §1.13).
3. **Put the desk's own prior view beside every name.** The per-ticker history join (what the wire said, what the setup did, what the book did, what the Desk said on video — D-13 §11) is a fifth perspective no vendor can license (synthesis §7.1, §7.4; P-β). It is a data-model job before it is a UI job, and it is the one lens in §3.3 with no benchmark analogue.
4. **Turn English into a deterministic artefact the member owns.** The Concierge emits the scan text; the same rule emits a board or an alert definition — inspectable, diffable, shareable, re-runnable (C4-01 P11; UW's builder). The natural-language query is never the artefact (TradingView N1).
5. **Close the loop into the member's own record.** Compass's pre-trade verdict, post-mortem, interventions and `personal_edge` (the member's per-setup expectancy, soft-gated, never dropped) feed the read back from the member's outcomes — a coaching loop with no counterpart in a terminal that stops at the screen (`K4`; READINESS_REVIEW_DAY1 §6 primary loop).

And two things AI must not do, because the estate already shows the failure: **add a seventh door** (six-plus AI doors today — synthesis §11 Temptation 3; D6 routes them through one component), and **render without provenance** (citations always on, rendering optional — synthesis §12.3; a per-answer citations toggle busts the cached prefix).

### 18.4 Where we REJECT a Bloomberg or Gödel paradigm — named

| # | Paradigm rejected | Why, specifically |
|---|---|---|
| R1 | **Bloomberg's four-slot yellow-key sentence and its mnemonic vocabulary** (`IBM US <EQUITY> GP <GO>`) | The type annotation exists because one grammar spans ten asset classes; UCT's estate is US equities and options with indices/ETFs as context (GOVERNING_PRINCIPLES §13) — a sector slot would be a slot with one value. The vocabulary would import muscle memory nobody on this desk has (Gödel dossier P1 — members come from TradingView, thinkorswim and Discord). What is kept: one frozen syntax, a persistent labelled context, an expression allowed in the noun slot. |
| R2 | **Gödel's bet that rewriting Bloomberg aliases (`GIP`→`G`, `OPT`→`OMON`) captures switching muscle memory** | No evidence this is the right onboarding bet for UCT's member base (READINESS_REVIEW_DAY1 §5); it spends the learning budget on a vocabulary the member does not have. |
| R3 | **Bloomberg's N-doors-per-topic address space** (fifteen doors to earnings; a seven-surface charting curriculum) | Affordable at Bloomberg's price and training budget, not at a small desk's; and it is exactly the second-authority class UCT has paid for repeatedly (N5; P-γ: one door per capability). |
| R4 | **Bloomberg's "inputs, not a verdict" screen posture** | "No such formula" is Bloomberg's own admission; `grade_ticker` is the opposite, already-shipped bet (READINESS_REVIEW_DAY1 §5). |
| R5 | **Gödel's free-floating window manager as the primary surface** (30 chart windows per screen; Bloomberg Launchpad's unbounded component count) | Window-juggling is the cost Benzinga's four-tool cap exists to avoid; UCT's board stays bounded, viewport-locked, capped and mount-queued (§4.3), with the portal for a second monitor. Reversible: nothing in the document forbids floating panels — `FloatingWidgetPanel` exists — but they are not the default composition model. |
| R6 | **Bloomberg's View → Page two-level workspace hierarchy** | Flat named, addressable boards suffice for two to five people; a page is a named group of boards if ever needed (§4.3). |
| R7 | **Instant Bloomberg as "the center of the experience"** (N4) | Cloning the network without the network reproduces the form of the moat with none of its substance; UCT's community lives on Discord and The Floor (`M1`), and the terminal *links into* them rather than housing a chat widget only the desk is on. |
| R8 | **Bloomberg's twelve-lane, ten-asset-class breadth as an architecture target** (B-BBG-09 throughout) | Zero FX/commodities/rates/fixed-income providers in the ledger; an owner default excludes them from V1; chasing them is Temptation 2 in a multi-asset costume (synthesis §4.1b). What is kept from that leaf: `PORT`'s Past/Present/Future *shape* over UCT's own regime/breadth history, and `CACS`-style corporate actions as a lens on the entity page, not a calendar. |
| R9 | **Difficulty as a retention asset** (N1; an eight-hour course for an "entirely discoverable" product) | UCT is not the incumbent and has no counterparty lock to absorb churn. |
| R10 | **Deliberate export/egress friction** (N3) | The member's data is theirs; the desk lives half in Excel/Python. |
| R11 | **Gödel's blank chart on a missing entitlement** (Gödel N2) and **Bloomberg's `EQS` not distinguishing "screened out" from "field unavailable"** (N13) | Renders failure as fact — the defect class `CoverageLine` exists to prevent; a typed error, never an empty surface (C4-01 P3). |
| R12 | **Beta as a permanent, permission-granting label** (Gödel N1) | A status pill at the point of use, consumed from the flag ledger, with an expiry. |
| R13 | **A cap with no meter** (Bloomberg `#N/A Limit`) | Every cap renders its remaining budget (M5). |
| R14 | **An FDC3 desktop container** (HERE/OpenFin, io.Connect) | An enterprise container for banks running dozens of vendor apps; UCT is one application. Adopt the vocabulary only (C5-01 §9 warning). |
| R15 | **LSEG's OS-level global hotkey** (`Ctrl+Shift+Space`) | Not possible in a browser; backtick is the browser-legal form (C4-01 §4). |
| R16 | **TradingView's "the natural-language query is the artefact"** (N1) | Serves a churning audience; the artefact a member owns must be inspectable text (C4-01 P11). |
| R17 | **Bloomberg's silently changed key semantics** (`<MENU>` — R6, requiring `PDFU`) | Property 9: nothing rebinds without a revert preference; UCT already paid this with Shift+F (TD-07). |
| R18 | **Benzinga's browser-cache workspace persistence** and **its PDF of search terms** | Already avoided (server-side prefs) and rejected (recipes live in-product — C4-01 anti-pattern 2). |

---

## 19. Bearing on the decision register — D1 and D2, explicitly

**D1 (workspace model).** Sharpened, not reversed. The recommendation "hybrid" becomes: *three surface kinds (fixed page · entity page · board), two generic crossings (promote · demote), one versioned Workspace Document in its own store, a bounded bespoke board on react-grid-layout.* The document decision can be taken now because it is reversible at the document boundary; the library decision waits for RG-27 and the `charts_workspace_layout` query. **Final lock: PROVISIONAL / OWNER INPUT REQUIRED (OI-06; the layout distribution query; RG-27).**

**D2 (command-grammar default).** Sharpened from "a choice between two grammars" to "a preference over one grammar." Grammar C (context bar + scoped verbs) is the substrate; noun-first and palette-first are its two front ends, emitting the same addresses; the default per audience, and the bare-token precedence, are what OI-06 decides. Working hypothesis carried, not locked: desk = context-first, member = palette-first. **PROVISIONAL / OWNER INPUT REQUIRED (OI-06).**

**Also touched:** D3 (entity master) is a hard prerequisite of §3.3, §10.4 and every chain — this file concurs with the register's "clearest, best-evidenced recommendation" and adds that the *channel* is its first consumer. D6 (one provenance component) is P3 and is load-bearing for properties 3 and 7. D7 (one alert taxonomy) is the [BC] gap under §11.2 and §12.4. D9 (decisiveness for two audiences) is the only owner call that changes the *shape* of a rendered thing in this document (§12.1 step 5; §18.3 #1) and is left open.

---

## 20. The six questions, separated — where each recommendation's gap actually lives

| Recommendation | [DA] data available | [DN] normalization | [BC] backend capability | [UI] UI exposure | [WQ] workflow quality | [IO] intelligence orchestration |
|---|---|---|---|---|---|---|
| Context Channel (P1) | ✅ | entity id under the alias (D3) | small — a typed record where a letter is | the indicator, the headers | the chains stop re-entering the ticker | — |
| Address scheme (P2) | ✅ | — | one address table; a JSON 404 before the SPA catch-all (TD-10) | nav/rail/command derived from one table | shareable, recallable | AI answers become addresses |
| Provenance + Freshness (P3) | ✅ for sourced numbers | computed metrics need addresses (C7-03) | one component; five implementations consolidate | every number, every sentence | trust | the render path every lane must use |
| Workspace Document (P4) | ✅ | version, tombstones | own store; delete route; caps | visible autosave; version history | boards for 07:00/09:30/15:45 | — |
| Panel Contract (P5) | ✅ | — | error boundary; mount queue; cap | freshness badge; density token | independence | — |
| Entity page (§3.3) | ✅ (eleven doors' data) | entity id; news `primary/mentioned` bit | one federated fetch per lens | one page, one rail | the workhorse chain | the Desk and Read lenses |
| Global search (§7) | ✅ | entity search over the master | cross-object federation | one box, categorised results | — | the `/ask` sigil |
| Command grammar (§8) | — | — | the registry (TD-07) | two front ends | tenth vs first action | emit-the-text rule |
| DataGrid + row addressing (§9) | ✅ | — | one grid (TD-06) | keyboard addresses | scan→decide with no pointer | — |
| "Why is it moving" (§12.2) | ✅ (catalyst engine, breadth) | sector/beta residual | deterministic decomposition | a lens; an honest blank | the news chain | the negative answer |
| Per-ticker history join (§12.5) | ✅ (four histories exist) | **the join does not exist** | one query | the Desk lens | the fifth perspective | grounding for the read |
| Alert taxonomy (§11.2, §12.4) | ✅ | one trigger model (D7) | one routing rule on the shared seam | one inbox, one receipt | alert→investigation | "would have fired N times" |
| Econ prints in the session frame (§12.3 #7) | degraded (ForexFactory 404) | FMP UTC → ET | — | the L0 strip | regime read | — |
| Options lens on the entity page (§3.3) | ✅ (Massive chains native; Schwab for GEX) | two implementations of one class (`F10`) | re-source question (provider ledger §4 #9) | a link into a partner surface | — | — |

The table is the discipline the brief asked for: no row is allowed to say "build a panel" where the gap is [DN] or [BC]. Three rows are load-bearing and not [UI] at all: the entity id, the per-ticker join, and the metric address book.

---

## 21. Reversibility and sequencing (architecture-level, not a plan)

Ordered so that each step is a prerequisite of the next and each is reversible at a named boundary; the plan itself belongs to Phase 2's later deliverables (H).

1. **Decide and stamp the Workspace Document schema** (P4) — reversible at the document boundary; every ingredient in-repo. Do this before anything touches the layout (TD-03).
2. **Design the entity master** (D3) — schema before implementation; the channel is its first consumer.
3. **Generalise the channel key** (P1) on one board with one list-consuming panel; keep the four-letter groups reading through a shim for existing saved boards.
4. **Ship the panel contract's boundary and freshness fields** (P5) — the cheapest fixes in the estate (TD-02, TD-08).
5. **Publish the address table** and derive nav, rail and command list from it (P2); keep every existing route answering.
6. **Build the one keyboard registry and the command line** with both front ends behind a preference; the default stays unset until OI-06 (§8.4).
7. **Consolidate the eleven doors into the entity page** lens by lens, honouring the deep link (§3.3, §6.4).
8. **Route every AI surface through P3** (D6) before any new lane.
9. **Measure** — one `charts_workspace_layout` query, the four telemetry queries, RG-27 — and only then lock D1's library question and D2's default.

Everything above proceeds under the rollout ladder the estate already supports for rungs 1, 2 and 4 (admin sees it; percentage; everyone) — the missing rung, "selected members opt in," needs `has_tag` + `require_beta("terminal-next")` + a `TERMINAL_NEXT_ENABLED` master switch (P6, TD-11 — names only), which the coexistence design owns.

---

## 22. PROVISIONAL / OWNER INPUT REQUIRED — the register

Every place this file declined to decide, with what it is gated on and how the design stays reversible.

| # | Item | Gated on | Where in this file | How the design keeps it reversible |
|---|---|---|---|---|
| PR-1 | Workspace model **final lock** (bounded RGL board vs. dock library; hybrid confirmed) | OI-06 (desk morning); `charts_workspace_layout` distribution query; RG-27 popout spike | §4.5, §19 | the Workspace Document is library-agnostic; a dock library would read the same document |
| PR-2 | **Command-grammar default front end** and bare-token precedence, per audience (desk vs member) | OI-06 | §3.2, §8.4, §19 | one grammar, two front ends, the default is a preference |
| PR-3 | **Verdict shape — one or two** (decisive for the desk; balanced-with-the-same-receipt for a stranger) | D9 (owner product call; the GOVERNING_PRINCIPLES revision the synthesis recommends) | §12.1 step 5, §12.5, §18.3 #1 | P3 renders either shape; the verdict object is the same |
| PR-4 | **Member-facing display of vendor data on any lens** (which lenses a non-desk member sees raw) | OI-03(a)/(b) → D5 | §3.3, §13.5 | lenses are entitlement-gated per row through `entitlements.py`; the desk-scoped design is complete without the answer |
| PR-5 | **Tier numbers** for metered saved objects | OI-12; D5 | §13.5 | `entitlements.py` is the one home; no number set |
| PR-6 | **Phone scope** (monitoring-only vs. more) | RG-10 owner default; OI-06 | §16 | the same document, a different renderer; parity is a published field list |
| PR-7 | **Which lens the desk opens first**, and the rail order | OI-06 | §3.3, §12 | the rail order is desk-authored data, not code |
| PR-8 | **Options/GEX sourcing** for the entity page's options lens | provider ledger §4 #9 (Schwab re-source — an owner sourcing question routed via the partner) | §3.3, §20 | the lens links into the partner surface until re-sourced |
| PR-9 | **Bloomberg/Gödel pixel-level claims** relied on for the labelled-context and window-management mechanics | OI-08, OI-18 (validation tier only — never blocking) | §2, §9, §14 | each is corroborated by ≥3 vendors in the survey; none is load-bearing alone |
| PR-10 | **Recents caps and retention windows** | dogfood measurement | §14.2 | small fixed defaults, changeable without schema change |

None of these is inferred from the owner's silence; each stays open until answered.

---

## 23. Open questions this file raises (beyond the owner-bound register)

1. Does the typed-channel payload set (`entity · entitySet · listRef · timeframe · range · event`) map onto FDC3's standard Context Data types, so the payloads can be spec-shaped rather than bespoke? A 15-minute follow-up (C5-01 §9 OPEN QUESTION; RG-27's second half).
2. When a panel is joined to a channel and the board's list-ref and entity change in one act, is "typed consumers never receive both" sufficient, or does any panel legitimately consume both (a news panel scoped to a list *and* an entity)? Decide with the first list-consuming panel.
3. Should the entity page be a route, a modal, or both (the research modal is both today, with the modal routed on exactly two paths)? The address is the same either way; the shell question (RG-07) decides the renderer.
4. What is the practical ceiling on named boards before a member stops maintaining them? No public precedent (C5-01 §5 OPEN QUESTION); dogfood measures it.
5. Is a `RANGE`/`event` payload enough to carry a flow-tape seek, or does the partner-owned tape need an explicit seek API? Route via the partner, never edit.
6. Does the desk want three doors for one thing on purpose (a keyboard path, a click path and a voice path with different payloads)? That would falsify P-γ (synthesis §11) and is answerable only by observation.

---

## GAPS

- **This role fetched nothing and observed nothing.** Every benchmark mechanic is carried from the dossiers and the C-wave pods at the confidence they assign; every UCT fact is carried from the ledgers and the D-wave archaeology (code read by them, not by this role). Where an input is 🔴, this file is 🔴 there too.
- **OI-06 dominates.** The desk's morning, its tenth action, its keyboard-vs-mouse split and its first lens are unobserved; §8.4, §9, §12 and the D1/D2 bearings are hypotheses shaped to survive either answer.
- **No telemetry.** Whether members compose boards, which panels they open, which alerts fire, which AI answers are read — none is measured; §13.3 and §17 defer every adoption-dependent choice.
- **The workflow library (F-07) and personas do not exist yet** (`04-workflows/` is empty); the chains in §12 are reconstructed from the ledger rows and the Bloomberg workflow reconstructions, not from a UCT persona artifact.
- **Partner-owned surfaces** (`OptionsFlow.jsx`, `live_massive_router.py`, `massive_ws_worker.py`, `schwab_router.py`) are linked into, never described beyond the ledger's existence rows.
- **The Bloomberg and Gödel mechanics are documentation-derived**, Bloomberg's Launchpad from ©2012/©2015 guides; the 2026 screens are unverified (dossier §O, §P).
- **Counts carried, not re-derived.** Every number is quoted from the artifact that measured it; the capability-ledger row count is stated as the ledger's own 178, and the brief's 211 is noted as underived.

## NOT INSPECTED

- Application source in any repository (by contract); production data, Railway variables, the production pod, the owner's PC; any external URL.
- `04-workflows/*` (empty); `05-product-strategy/capability-matrix/` (empty); `03-competitive-research/desk-tools/*`; the eleven non-Bloomberg/Gödel leaf dossiers (read only as cited by C4-01, C5-01, C5-02 and the synthesis).
- `01-existing-system/{frontend-archaeology,backend-archaeology,database-and-infrastructure,terminal-current-map,system-map,ecosystem-cartography,flags-and-entitlements,testing-reliability-observability}.md` beyond the cited lines; `07-technical-architecture/{current-ui-architecture,domain-symbol-master-time}.md` beyond the cited sections (§1.1, §2, §5, §7–8; §2.1); `01-existing-system/state-persistence-and-workspaces.md` beyond §2.3 and §7.6; `tech-debt-register.md` beyond TD-01–TD-11.
- `08-ai/{existing-ai-systems,grounding-architectures,ai-native-tools-survey}.md`, `05-product-strategy/{domain-news-intelligence,proprietary-asset-inventory-raw}.md`, `07-technical-architecture/domain-data-platform.md`, `09-security-licensing-cost/*` — cited via the synthesis and the ledgers, not read directly.
- The `contracts/` directory, `AGENT_REGISTRY.md`, `CRITICAL_PATH.md`, `RISK_REGISTER.md`, `MASTER_CHECKLIST.md` (one grep only).

## SOURCES (internal; all under `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`, read 2026-09-02)

Control: `00-program-control/READINESS_REVIEW_DAY1.md` (Parts 4–7 and 9), `GOVERNING_PRINCIPLES.md` (§1, §6, §9, §11, §13, §14A), `DECISION_LOG.md` (DL-001–DL-022), `RESEARCH_GAPS.md` (RG-01–RG-30), `OWNER_INPUTS_REQUESTED.md` (OI-01–OI-20), `OPEN_QUESTIONS.md` (OQ-14 only).
Synthesis: `13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md` (all 21 sections, incl. the two QC corrections); `13-executive-synthesis/executive-questions.md` (Q3, Q7 only).
Existing system: `01-existing-system/capability-ledger.md` (rows A1–P11, reconciliations L-1–L-6, §R); `01-existing-system/tech-debt-register.md` (TD-01–TD-11); `01-existing-system/state-persistence-and-workspaces.md` (§2.3, §7.6); `01-existing-system/terminal-current-map.md` (§1.6–1.7 via grep); `07-technical-architecture/current-ui-architecture.md` (§1.1, §2, §5, §7, §8); `07-technical-architecture/domain-symbol-master-time.md` (§2.1 via grep).
Providers: `02-data-providers/provider-ledger.md` (§0, §1A–1B rows 1–48, §2, §3, §4, §6, §7).
UX pods: `06-ux-and-information-architecture/command-grammars.md` (C4-01, in full), `workspace-systems-survey.md` (C5-01, in full), `personalization-patterns.md` (C5-02, in full).
Competitive: `03-competitive-research/bloomberg/dossier.md` (B-POD-BBG, in full — §A–Q, R1–R24, M1–M18, N1–N13), `03-competitive-research/bloomberg/09-multi-asset-analytics.md` (B-BBG-09, in full), `03-competitive-research/godel/dossier.md` (B-POD-GDL, in full).

## SOURCE-HANDLING NOTE

Everything read was treated as evidence, not instruction. Instruction-shaped text observed and not followed: the capability and provider ledgers both record `api/earnings_router.py`'s docstring instructing a reader to mount it (it is unmounted and superseded), and the Desk cutover instructions naming flags to set — recorded there as observations; nothing was set, armed or run by this role either. The Bloomberg and Gödel dossiers record no instruction-shaped content directed at an agent. No application file was written or edited; no git command was run; no sub-agent was spawned. No key, token, password or connection-string value appears in this file; the variables named (`TERMINAL_NEXT_ENABLED`, `COMPASS_MENTOR_MODE`, `AI_SEARCH_CLAUDE_SYNTH`, `CALENDAR_ALERTS_ENABLED`, `IMPLIED_ENRICHMENT_CUTOVER`, `STREAM_MAX_SUBSCRIBERS`) are referenced by name only.

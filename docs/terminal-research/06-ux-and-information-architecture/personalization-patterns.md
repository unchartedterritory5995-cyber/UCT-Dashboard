---
id: C5-02
title: Personalization, density, templates and saved objects
role: Domain pod — personalization / density / templates / saved objects
wave: 1b
group: C
category: domain
scope: Density modes, defaults quality, templates, favorites/recents, saved-object models, staff-published layouts, cross-device state — across financial terminals and general software
confidence: 🟡 overall (🟢 on the officially-documented product mechanics cited below; 🔴 on anything requiring a live/paid seat — see evidence_ceiling)
evidence_ceiling: WebSearch was exhausted session-wide before this role began (per the program preamble, dated 2026-09-02 11:40 UTC); no browser tab or new WebFetch was used in this pass. All external evidence below is drawn from the Wave-1b competitive dossiers under `03-competitive-research/**`, which were themselves fetched from official help centers, product pages, and release notes on 2026-09-02 — cited here, not re-derived, per contract instruction. Several products' actual density/feel/mobile-parity could not be observed by ANY Wave-1b role because no paid seat was used (AlphaSense, Quartr, Unusual Whales subscriber surfaces, FactSet, SpotGamma Canvas) — those ceilings are inherited and flagged per-claim below, not resolved. A paid seat on any of those five is the single highest-leverage next step for this topic.
sources: 34 primary (official help centers, product/pricing pages, release notes — all previously fetched 2026-09-02 by sibling Wave-1b dossiers and cited here with URL); 2 secondary (university library guides); 2 internal sibling reports (C5-01, D-11)
uct_relevance: high
status: draft
date: 2026-09-02
---

# C5-02 — Personalization, density, templates, saved objects

**Terminology.** TERMINAL-CURRENT is the existing `/calendar` surface (display-named "UCT
Terminal"). TERMINAL-NEXT is the program's target. "Product X does Y" never implies "UCT should do
Y"; every RECOMMENDATION is a hypothesis.

**Scope boundary with C5-01.** `workspace-systems-survey.md` (C5-01) owns the *workspace* — the
grid, docking, linking, layout persistence quality, and the blank-canvas problem as a **layout**
question. This report owns the *objects and the knobs*: what a product lets a user save, how those
objects relate to each other and to who may edit them, how information density is controlled, what
ships as a default, and what follows the user between machines. Where the two topics overlap
(templates, staff-published layouts, the blank canvas), C5-01's evidence is cited by reference
(`per C5-01 §N`), not re-derived — its treatment is layout-first; this one is object-first.

## 1. Provisional pattern set (dossier-derived, pre-external)

1. **Density is a control, not a decision.** Koyfin ships a "Compact Table" (v3.90) and a
   ticker-only compact mode on the right rail; Bloomberg exposes a zoom slider plus `View → Zoom →
   Custom zoom` by percentage, and a Custom Function Window whose *stated* purpose is "to reduce
   the number of components on the screen"; TradingView makes the plan ladder the density control
   (1 chart / 2 indicators → 16 charts / 50 indicators).
2. **Composition caps as a density lever.** Benzinga Pro hard-caps a workspace at 4 tools.
3. **Defaults: first-run is a populated board, not a canvas.** Bloomberg's Sample Views by asset
   class; Koyfin's "start blank or load a customized template". Anti-pattern witnesses: Benzinga
   ships a course rather than a layout; Koyfin's onboarding opens with "adjust browser zoom".
4. **Saved objects separated by lifetime.** TradingView: layout (arrangement) / indicator template
   (analysis stack) / column preset (way of reading a table) — three objects, independently saved.
   Koyfin: dashboard / watchlist view / financial-analysis template / custom formula — five
   independently shortcut-able types, with one object (the *view*) reused on watchlist, dashboard
   widget and screener result.
5. **Snapshot vs subscription, asked once.** Bloomberg's monitor import forces the choice: "Copy
   from source — fixed list of tickers and will not update" vs "Link to source — will reflect any
   changes". A guessed default is silently wrong half the time.
6. **Shared instance vs copy, also asked.** Bloomberg's "Show on Selected Pages" (one monitor on
   many pages, edits propagate) vs "Duplicate to Page" (a copy, edits local).
7. **Favourites and recents are toolbar-resident and *split by object type*.** Bloomberg's toolbar
   carries favourites plus **two** recents drop-downs — recently loaded *securities* and recently
   used *function mnemonics* — mirroring the what/how split rather than one interleaved list.
8. **Version history on the user's own curation.** `MNRS <GO>` restores up to ten previous versions
   of a Launchpad monitor. Products do not ship undo for things that never break.
9. **Content follows the login; geometry follows the machine.** Bloomberg's Startup Defaults assign
   "a specific resolution for your Launchpad views… for each of your computers".
10. **Saved-object counts as the price axis.** Unusual Whales meters alerts / watchlists /
    dashboards / saved filters per feed and almost nothing else; TradingView meters saved layouts
    (1/5/10) and charts per layout; Koyfin meters custom calculations (1/10/unlimited).
11. **The list is the durable object; the board is a view onto it** (Bloomberg's `W` worksheet
    prominence, 2023–2025).

## 2. Anti-patterns (dossier-derived)

- **Two persistence contracts in one product.** Koyfin: watchlist columns "automatically save";
  financial-analysis templates emphatically do not, and say so. A user cannot hold one mental model
  of when their work is safe.
- **A partial copy presented as a copy.** Koyfin's "import an existing view" silently drops
  formulas and custom columns.
- **Working layout in browser cache** with manual save-to-server as the cross-device path
  (Benzinga Pro) — the vendor documents the failure mode and ships it as the default.
- **Empty-because-unreadable indistinguishable from empty-because-new** (UCT internal, D-11 §7.2).

---

## 3. Density as a designed control, not an accident of screen size

**OBSERVATION.** Every product in this set that ships density as a *control* documents it as a
control — a named toggle, a stated ceiling, or a plan-tier axis — rather than leaving density to
emerge from whatever the user happens to add. Two products (Quartr, AlphaSense) sit at the opposite
pole: low or unmeasurable density by construction, because their unit of content is a document or a
call, not a row.

**EVIDENCE.**
- **Koyfin's right sidebar ships two explicit density modes** — *"Tickers and Company Names, or a
  more compact view of only Tickers"* — plus a separate v3.90 release, *"Compact Table"*, applied to
  the main watchlist grid. [`https://www.koyfin.com/help/right-sidebar/`, T1, verified;
  `https://www.koyfin.com/help/release-notes/`, T2, verified]
- **LSEG Workspace publishes a density *ceiling* as a number**: 2,500 streaming RICs on desktop,
  1,000 per browser tab — and frames maximum tile density ("Tiles") as *"the traditional trading"*
  mode, i.e. opt-in, not default. [LSEG *Workspace Technical Specifications*,
  `https://www.lseg.com/en/data-analytics/products/workspace/workspace-technical-specifications`,
  T1, verified; LSEG *Workspace for sales and traders*,
  `https://www.lseg.com/en/data-analytics/products/workspace/sales-traders`, T3, verified]
- **TradingView's plan ladder *is* the density control**: 1 chart / 2 indicators on the free tier up
  to 16 charts / 50 indicators on the top tier — the same product, the same UI, with density gated
  by what you pay rather than by a settings toggle. [TradingView *Multi-chart mode* folder,
  `https://www.tradingview.com/support/folders/43000578567-how-to-work-in-the-multi-chart-mode/`,
  T1, verified]
- **thinkorswim's Flexible Grid** is described in its own Learning Center as *"an alternative to the
  default Charts Grid interface… [giving] more control over cells['] layout"* — i.e. a second,
  denser/freer workspace mode that coexists with the tabbed default rather than replacing it.
  [`toslc.thinkorswim.com/center/howToTos/thinkManual/Charts/Flexible-Grid`, T1 — reachable only as
  a Google SERP snippet; the page 404'd on direct fetch, so this line is downgraded to secondary per
  the desk-tools dossier's own tier note]
- **Benzinga Pro's 4-tool workspace cap** is a density *ceiling* rather than a mode — there is no
  denser setting to opt into. [Benzinga Help Center, *What is a Widget?*,
  `https://help.benzinga.com/en/articles/1769521-what-is-a-widget`, T1, verified]
- **Unusual Whales' flow feed is dense by construction and legible by grouping, not by a density
  toggle**: roughly 60 filter controls in one scrollable rail, organized under plain semantic
  headings (TIME RANGE, SIDE, CHAIN ACTIVITY, OPTION TYPE, EQUITY TYPE, GREEKS, FLAG TYPE, EXTRA,
  OTHERS). There is no lower-density mode documented for this surface.
  [`https://unusualwhales.com/option-flow-alerts/rules`, T1, verified]
- **The low-density counter-cases.** Quartr's whole product is "a document reader, a calendar, a
  chat and a list" with "no grid, no multi-pane workspace, no numeric table of any size" — density
  is not a control because the unit of content (an earnings call, a transcript) does not compress.
  [Quartr dossier §J, inferred from the product's own data model — 🔴, no seat was used]. AlphaSense's
  documented shell (left icon toolbar, two search bars, result list, document viewer) implies a
  two-pane document-reader density "far lower than a trading terminal's" — but this is inference
  from the shell's description, not a measurement; AlphaSense's own dossier rates this 🔴 and
  explicitly, twice, calls its own density claim unmeasured without a seat. [AlphaSense dossier §J,
  `https://help.alpha-sense.com/hc/en-us/articles/41245560097171-A-Guide-to-the-Four-Perspectives-in-AlphaSense`,
  T1, shell described; density inferred, not observed]

**INTERPRETATION.** Two different design postures, both defensible, and a product should pick one
on purpose rather than by accident. **Posture A (Koyfin, LSEG, TradingView, Benzinga): density is a
first-class, named setting** — a toggle, a published ceiling, or a plan axis — and the vendor writes
down what it means and where its limit is. **Posture B (Quartr): density is not a control because
the content unit itself resists compression**, and the product does not pretend otherwise by adding
a "compact mode" that would just shrink an unreadable card. AlphaSense sits ambiguously between the
two — it likely has density controls (result-list row height, split-pane ratios) but none surfaced
in any reachable public document, which is itself informative: **a product with a genuine density
control usually says so in its help center**, because density is exactly the kind of setting a
support ticket gets filed about. Its absence from AlphaSense's public docs is weak evidence the
control either doesn't exist or isn't considered a support surface.

**RELEVANCE TO UCT.** UCT's `/charts` workspace has one density lever today — the widget grid itself
(more/fewer/smaller/larger panels) — and no per-widget content-density setting analogous to Koyfin's
ticker-only compact mode or LSEG's published streaming-symbol ceiling. The Breadth monitor's
8-tier heat-map and the Screener's `CoverageLine` (per CLAUDE.md) are dense-by-necessity surfaces
in Posture-B's sense: their unit is a metric row or a coverage count, not freely compressible. The
transferable idea from Posture A is narrower and cheaper than "add a density setting everywhere":
**publish the ceiling that already exists** (the multi-chart grid's `GRID_MAX_CELLS=16` per C5-01
§2 is exactly LSEG's "2,500 RICs" idiom, just unstated to the user) rather than letting a user
discover it by hitting it.

**CONFIDENCE.** 🟢 on Koyfin, LSEG, TradingView, Benzinga, Unusual Whales (each read from an
official document with a direct quote or a published number). 🟡 on thinkorswim's Flexible Grid
(SERP-snippet only). 🔴 on Quartr's and AlphaSense's density, both explicitly unmeasured in their
own dossiers without a paid seat — this ceiling is inherited, not resolved, by this report.

**RECOMMENDATION (hypothesis).** *Publish existing ceilings before adding new density controls.*
UCT already has hard caps in code (`GRID_MAX_CELLS=16`, Benzinga's 4-tool analog nowhere in UCT
today) that are invisible to the member until hit. Stating them — the way LSEG states "2,500 RICs" —
converts a silent failure mode into an understood rule, mirroring C5-01 §4's "publish the cap"
recommendation for SpotGamma's Canvas component-instance limits. **Anti-pattern:** adding a
density toggle to a surface whose content doesn't compress (Posture B) — a "compact mode" for a
document reader or a coverage-line receipt would just make it harder to read, not denser in any
useful sense.

**OPEN QUESTION.** Does UCT's Breadth 8-tier heat-map or the Screener's coverage receipt have a
documented "why this dense" rationale anywhere a member can find it, the way TradingView's plan
page states the chart/indicator ceiling? Not checked this pass.

---

## 4. Defaults quality and the blank-canvas problem — the institutional-templating counter-case

**OBSERVATION.** C5-01 §4 already covers Bloomberg's Sample Views and Koyfin's start-blank-or-
template choice in depth (per C5-01, not re-derived here). This section adds one pattern C5-01 did
not surface: **a third answer to the blank canvas that is neither "ship a demo" nor "ship a
template" — ship a firm-authored default that the user does not choose to load at all.**

**EVIDENCE.**
- **FactSet's customization model is institutional templating, not personal workspace-building.**
  FactSet's own marketing states the model directly: *"we will configure our tools around your
  existing workflow… deeply configurable tools"* (aimed at the firm, not the individual) and,
  for wealth management specifically, *"Deploy firm-approved model portfolios across advisors from
  research to delivery"* over *"a customizable digital portal."*
  [`https://www.factset.com/solutions/investment-research`, T3, claimed;
  `https://www.factset.com/marketplace/catalog/product/factset-ai-for-wealth`, T3, claimed]
  Pitch Creator ships a **Template Assistant** and a tool literally named **Reslide** (re-skinning a
  deck into the firm's template) as named, first-class artifacts in the banking workflow — templates
  are not an onboarding nicety here, they are a product category.
  [`https://www.factset.com/marketplace/catalog/product/pitch-creator`, T3, verified]
- **LSEG declares the user's persona at onboarding and then uses it to re-rank the UI, not merely to
  pick a landing page.** LSEG's own service description states the platform keeps collecting
  *"source/internal product hits, user job functions, locations, and asset classes… for the purposes
  of tailoring the discoverability of applications and menus."* [LSEG *Workspace Service Overview*,
  T1, verified] This is a materially different default-quality mechanism from either Bloomberg's
  Sample Views (a static starting board) or Koyfin's template picker (a one-time choice) — it is a
  **standing, ongoing re-ranking** driven by declared role.
- **The counter-signal, restated from C5-01: Benzinga Pro ships neither a starter board nor a
  template library.** Onboarding is *"a free interactive course rather than a shipped layout"* [per
  C5-01 §4, B-BZ §G] — the weakest default-quality posture in the set.

**INTERPRETATION.** Three distinct answers to "what does a new user see," in ascending order of how
much decision-making the vendor is willing to make on the user's behalf: **(1) teach, don't hand a
board** (Benzinga — weakest); **(2) hand a good starting board the user then edits** (Bloomberg
Sample Views, Koyfin templates — C5-01's finding); **(3) configure the product FOR a role and keep
re-configuring it as the role's signals accumulate** (LSEG's persona re-ranking, FactSet's firm-push
model). FactSet's model in particular inverts who authors the default: it is not "the vendor's best
guess at a generic new user," it is "the firm's own house view, pushed to every seat under it" —
which only works because FactSet sells into firms with a research desk willing to author that house
view, a condition UCT already satisfies for itself (the firm IS the authoring desk).

**RELEVANCE TO UCT.** UCT already has the FactSet-shaped precedent in miniature: `starter_library.py`
ships the firm's screener setups as ordinary, editable definitions rather than a special read-only
class (per C5-01 §4, D-11 §3) — this is UCT's own version of "the firm configures once, the member
inherits it editable." The LSEG persona-re-ranking pattern is the more novel idea for TERMINAL-NEXT:
UCT already collects a comparable signal set at a coarser grain (free/paid tier, `user_tags`,
watchlist and Journal-2.0 activity) that currently drives almost nothing about which widgets or
setups a member sees first.

**CONFIDENCE.** 🟢 on FactSet's institutional-templating framing and the Pitch Creator artifacts
(direct quotes from official product pages). 🟢 on LSEG's persona-collection statement (official
service description, tier 1). 🔴 on whether FactSet's "firm configures once" model extends to a
*personal* layer at all — the FactSet dossier explicitly could not determine this behind FactSet's
login wall.

**RECOMMENDATION (hypothesis).** *Treat "firm-authored, member-editable" as a spectrum UCT is
already partway along* (starter scans today) *rather than a binary "add templates" decision* — the
open question is whether TERMINAL-NEXT extends the same posture to workspace boards (per C5-01 §4's
own recommendation) and whether declared/observed member role (swing-equity vs options-flow vs
macro-breadth) should re-rank the widget picker the way LSEG re-ranks its menus, rather than only
seeding a first board. **Anti-pattern:** a persona quiz whose answer is never used again — LSEG's
mechanism is notable specifically because it is *ongoing*, not a one-time onboarding branch.

**OPEN QUESTION.** LSEG's persona system collects signal continuously — does it re-rank silently, or
does the user see and control what it learned? No source states this, and it is the difference
between "helpful" and "the UI keeps moving on me."

---

## 5. Templates and the saved-query lifecycle — how many forms does one saved thing take?

**OBSERVATION.** Beyond C5-01's three-object TradingView finding (layout / indicator template /
column preset, per C5-01 §1) and this report's own §1.4 (Koyfin's five object types), a third
pattern appears specifically around **saved queries and scans**: several products let one act of
"save this search" fan out into two or three differently-shaped saved objects, each with its own
lifetime and its own downstream behavior.

**EVIDENCE.**
- **thinkorswim's Stock Hacker scan results save as three different objects from one action**: a
  **watchlist** (a snapshot of who matched, right now), a **reusable named scan query** (the
  filter logic itself, re-runnable later against a different universe/date), or a **change-triggered
  alert** (immediate / hourly / daily / weekly cadence) — three different lifetimes chosen at the
  point of saving, not three separate features a user has to discover. [thinkorswim Learning Center,
  *Scan / Stock Hacker*,
  `toslc.thinkorswim.com/center/howToTos/thinkManual/Scan/Stock-Hacker`, T1, verified]
- **AlphaSense's Saved Search has an explicit upgrade path into an alert**, named in-product as
  "Follow → Saved Search conversion": a search starts as a one-off result set, becomes a named Saved
  Search (with frequency and delivery-time fields), and can separately be "Followed" for
  push/email notification. [AlphaSense Help Center, *Save Searches and Create Email Alerts in
  AlphaSense*,
  `https://help.alpha-sense.com/hc/en-us/articles/41815267178899-Save-Searches-and-Create-Email-Alerts-in-AlphaSense`,
  T1, verified]
- **FactSet's Pitch Creator names its own template objects rather than treating "template" as a
  generic word**: Template Assistant (build from scratch), Reslide (re-skin an existing deck into
  the house template) — two different actions for two different starting points, both landing on
  the same output shape. [`https://www.factset.com/marketplace/catalog/product/pitch-creator`, T3,
  verified]
- **Koyfin's Financial Analysis templates carry a save discipline the product states explicitly**:
  *"Once you've created or changed your template, make sure you save it since it isn't saved
  automatically"* — the one saved-object type in Koyfin's whole catalogue that opts out of
  autosave, and the help article says so in those words rather than leaving it as a surprise.
  [`https://www.koyfin.com/help/financial-analysis-templates/`, T1, verified]

**INTERPRETATION.** The common thread is **naming the lifetime at the moment of saving, not
after**. thinkorswim's three-way fork (watchlist / query / alert) and AlphaSense's search→alert
upgrade both make the user choose durability and behavior explicitly rather than defaulting to one
shape and hoping it fits every later use. Koyfin's opposite move — a template that is the ONE
exception to autosave, stated plainly — is the same discipline applied in reverse: rather than
silently making every object behave the same way, the product tells the user which object is
different and why.

**RELEVANCE TO UCT.** UCT's own screener (`api/services/screener/scan_evaluator.py` per CLAUDE.md)
already has the raw material for thinkorswim's three-way fork — a scan definition, its result rows,
and alert-worthiness are three different things UCT computes today but does not yet let a member
explicitly fork into three independently-lived saved objects from one save action. The Koyfin
discipline — naming the one object that doesn't autosave — is the more directly transferable idea:
UCT's `charts_workspace_layout` autosaves silently (D-11 §2.3, per C5-01 §5), and no UCT surface
currently tells a member "this one doesn't save itself" the way Koyfin's help article does.

**CONFIDENCE.** 🟢 on all four vendor facts (each a direct quote or verified mechanism from an
official help article or product page).

**RECOMMENDATION (hypothesis).** *At the point a member saves a screener result, ask what they
actually want it to become* (a frozen list / a re-runnable definition / a standing alert) *rather
than always producing one default shape* — this is a smaller, testable version of thinkorswim's
pattern that UCT's existing scan-definition engine could support without new infrastructure.
**Anti-pattern:** silently deciding for the user which of "list" or "query" they meant, the way a
naive "save my screen" button would.

**OPEN QUESTION.** Does a member who forks a scan into a watchlist and later re-opens the original
scan definition see any link between the two objects on thinkorswim, or do they drift apart
immediately? Not documented in the reachable Learning Center pages.

---

## 6. Favorites, recents, and the always-present dispatch rail

**OBSERVATION.** Section 1's pattern 7 (Bloomberg's toolbar favourites plus two separate recents
drop-downs) is the sharpest single instance of "favorites split by object type" in this survey.
External evidence adds one more pattern in the same family: a persistent side rail that is not
merely a list of favorites, but a **launcher** — clicking an item there re-targets whatever the main
pane is currently showing.

**EVIDENCE.**
- **Koyfin's right sidebar is explicitly a dispatcher, not just a display.** The help center states
  members can *"click on the securities in the right sidebar to load them into Koyfin functions like
  Snapshot (S), Estimates (EST) or Charting (G)"* — the sidebar holds watchlists, movers and news,
  and clicking any row in it retargets the currently-open function rather than opening a new
  panel. [`https://www.koyfin.com/help/right-sidebar/`, T1, verified — see also C5-01 §1 workflow
  path, cited there as [S9]]
- **LSEG's Tile Manager ships a named, savable favorites-like collection — "My Tile set"** —
  alongside group / auto-group / auto-arrange operations over the live tile population, rather than
  a flat favorites list. [LSEG *Workspace for sales and traders*,
  `https://www.lseg.com/en/data-analytics/products/workspace/sales-traders`, T3, verified — per
  C5-01 §2 for the Tile Manager mechanism generally]
- **Koyfin exposes keyboard shortcuts on saved objects as the recents/favorites substitute** — no
  dedicated "recents" list is documented, but named objects (watchlists, dashboards, screens) each
  get an assignable hotkey, so a power user reaches a specific 40-metric fundamentals dashboard in
  four keystrokes rather than by navigating a favorites menu. [`https://www.koyfin.com/help/hotkeys-and-custom-shortcuts/`,
  T1, verified — per C5-01 §5a]

**INTERPRETATION.** Two designs answer "how do I get back to the thing I use often" without
converging on the same UI: **a favorites/recents list you browse** (Bloomberg's toolbar, split by
object type) versus **a keyboard shortcut you type** (Koyfin, no visible recents list at all). Both
beat the third, unstated option — no fast path back, only navigation — which none of the products
surveyed here ship. Koyfin's dispatching sidebar is a third mechanism again: it is always visible
(not summoned), and its payload (a symbol) retargets the *current* view rather than opening
something new — closer to UCT's colour-group linking (per C5-01 §3) than to a favorites list, but
serving the same "get back to what I care about fast" need from the density-of-presence angle
rather than the search-and-recall angle.

**RELEVANCE TO UCT.** UCT has no favorites/recents affordance analogous to Bloomberg's toolbar split
today — the Flagged watchlist (per CLAUDE.md "Watchlists Page") is the nearest equivalent but is a
single undifferentiated list rather than split by object type (symbols vs functions/pages vs
setups). UCT's colour-group + `WorkspaceContext` linking (per C5-01 §3, §7.2) already gives
TERMINAL-NEXT something structurally similar to Koyfin's dispatching sidebar, but scoped to symbols
only and capped at four groups.

**CONFIDENCE.** 🟢 on Koyfin's dispatching sidebar and hotkey mechanism (official help center, direct
quotes). 🟢 on LSEG's Tile Manager / My Tile set (official product page).

**RECOMMENDATION (hypothesis).** *A recents/favorites affordance split by object type* (recently
viewed symbols vs recently used widgets/pages vs recently applied setups) *may serve UCT better than
one undifferentiated flagged list*, mirroring Bloomberg's what/how split. Test it as an addition to
the existing Flagged list rather than a replacement — Flagged already carries member trust as a
symbol list. **Anti-pattern:** one interleaved recents feed mixing symbols and page names, which
forces a user to scan two different kinds of items to find either.

**OPEN QUESTION.** Neither Bloomberg's guide nor Koyfin's help center states a recency window or
cap for these lists (how many recent items, how long they persist) — a design detail with no
public precedent found in this pass.

---

## 7. Saved-object ownership models — user, firm-published, and team-shared

**OBSERVATION.** Three distinct answers to "who may create and who may edit a saved object" appear
across this set, beyond the user-vs-staff split C5-01 and this report's §4 already cover for
*layouts specifically*. This section is about the ownership model applied to *any* saved object —
watchlists, tags, formulas, searches.

**EVIDENCE.**
- **Koyfin Teams: named roles on shared assets.** *"Teams"* lets an organization share Koyfin assets
  under **Viewer** and **Editor** roles with **admin** control over who holds which — a full
  permission model, not just a public/private toggle. [`https://www.koyfin.com/help/teams/`, T1,
  verified]
- **AlphaSense: multiple distinct object types, each independently shareable.** Watchlists
  (shareable), Tags + a Tag Manager, Bookmarks, and Highlight Tags for annotation are four separate
  saved-object types rather than one generic "save" verb — and *organisational agents* extend the
  same sharing model to AI workflows, not just documents. [AlphaSense capability table, per its own
  dossier §D — `https://www.alpha-sense.com/`, T3, verified for the object list; sharing mechanics
  not independently re-verified this pass]
- **FactSet: firm-push with no stated personal layer.** As covered in §4, FactSet's customization
  model reads as *institution-first* — the firm authors, advisors inherit — with no public evidence
  of an individually-owned, individually-editable object class analogous to Koyfin's "Editor" role
  or UCT's `user_definitions.py` (per D-11 §3). This is the dossier's own explicit gap: *"Does
  FactSet persist layouts per user across the web and desktop surfaces, or are they separate
  worlds?"* remains unanswered behind the login wall.
- **Unusual Whales: metering, not roles.** Saved-object *counts* are the pricing axis (per §1.10 of
  this report), but no sharing/role model between users is documented anywhere in the reachable
  product surface — every saved object appears single-owner.

**INTERPRETATION.** Three shapes, ranked by how much a UCT persona would recognize each: **(a)
single-owner, metered** (Unusual Whales) — the simplest model, and the one UCT's own
`user_definitions.py` (append-only, capped, per-user) most resembles today; **(b) role-based team
sharing** (Koyfin Teams: Viewer/Editor/admin) — the model a multi-seat firm needs and UCT does not
yet have anywhere (UCT's "shared" objects — public watchlists, `definition_shares`, per D-11 §3 —
are share-a-copy or share-a-link, not a standing Viewer/Editor relationship); **(c) firm-push with
no visible personal layer** (FactSet, as documented) — the model UCT's Model Book and starter-scan
library already occupy for *specific* object classes (staff-published, member-read, per D-11 §3),
but which FactSet appears to apply to *most* of the product rather than to one curated library.

**RELEVANCE TO UCT.** UCT's saved-object ownership today (per D-11 §3) is cleanly split into three
classes — user-owned, staff-published/global, and system — with **no team/role layer at all**: a
UCT desk of two (the owner + Ravi, per CLAUDE.md's partner-collaboration note) or a future multi-seat
enterprise tier would have no Koyfin-Teams-shaped answer to "let this other person edit my saved
scan, not just view a copy of it." That gap is invisible today because UCT has no multi-seat
customer yet, but it is the shape a "firm/desk" tier would need.

**CONFIDENCE.** 🟢 on Koyfin Teams' role model (official help center). 🟡 on AlphaSense's sharing
mechanics beyond the object-type list (the dossier explicitly notes the running UI, including
sharing flows, "could not be observed" without a seat). 🔴 on whether FactSet has any personal
layer at all — explicitly unresolved by the FactSet dossier.

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT ever ships a multi-seat/desk tier, Koyfin's
Viewer/Editor/admin shape over the SAME saved-object stores UCT already has* (`user_definitions.py`,
`charts_layout_service.py`) *is a smaller change than it looks* — both already have an owner-id
column; a role table joining a second user to an existing object id is additive. **Anti-pattern:**
building sharing as "duplicate to another account," which is what UCT's current
`definition_shares`/public-watchlist model already does and which loses the "same object, both can
edit" property Koyfin Teams provides.

**OPEN QUESTION.** Whether UCT actually needs Koyfin's Viewer/Editor distinction (read-only sharing
is arguably enough for a solo-operator desk) is unresolved — this report can name the pattern, not
size the need. Per C5-01 §6, that sizing question ("do users customize enough to need sharing at
all") is itself UCT's own to measure, not importable from a competitor's user base.

---

## 8. Cross-device and cross-surface state

**OBSERVATION.** C5-01 §5 already covers Bloomberg's content-follows-login/geometry-follows-machine
split and the persistence-quality comparison table in depth (per C5-01, not re-derived). This
section adds mobile-specific evidence C5-01 did not gather: what happens to a saved object, and to
the *product itself*, when the surface changes from desktop to phone.

**EVIDENCE.**
- **Koyfin ships a genuine mobile app with iOS home-screen widgets**, i.e. the same objects (My
  Watchlists, My Views, My Dashboards) are reachable, in a native mobile shell, outside the browser
  entirely. [`https://www.koyfin.com/help/mobile-app-feautres/`, T1, verified]
- **TradingView's account-level sync is explicit and spans three surfaces**: web, mobile, and
  desktop — and the vendor states autosave as a **visible, user-facing toggle**, not a silent
  background behavior. [per C5-01 §1, §5, B-TV §G]
- **Benzinga Pro splits into two different products by surface, and says so.** *"Benzinga Pro is
  best used through your mobile web browser. It will detect you are on mobile, and arrange the
  dashboard accordingly"* — but a **separate, thinner Benzinga App** (news, watchlists,
  notifications, social sharing) exists alongside it, meaning the terminal and the mobile feed are
  not the same product under one brand. [Benzinga Help Center, *Is There a Benzinga Pro App?*,
  `https://help.benzinga.com/en/articles/2221758-is-there-a-benzinga-pro-app`, T1, verified]
- **Benzinga's cross-device story for the terminal itself is the browser-cache anti-pattern already
  named in §2**: workspaces persist to browser cache by default, with a documented manual
  save-to-server step as the only path to another machine. [`https://help.benzinga.com/en/articles/2463416`,
  T1, verified — per C5-01 §5d, tabulated as the clearest cross-device anti-pattern in that survey]
- **LSEG publishes a formal Desktop-and-Web Comparison document**, i.e. the vendor states plainly
  that the two surfaces do not have identical capability, rather than letting a user discover the
  gap. [LSEG *Desktop and Web Comparison*, doc 100.02, T1 — per C5-01's LSEG evidence table, not
  independently re-opened this pass]

**INTERPRETATION.** Three postures toward "what happens on a different device," in order of how
much continuity the vendor guarantees: **(1) one product, full parity, explicit sync state**
(TradingView — autosave toggle visible, three surfaces, one account); **(2) one product, partial
parity, gap documented rather than hidden** (LSEG — a formal comparison doc; Koyfin — a genuine but
presumably feature-reduced mobile app); **(3) two products under one brand, split by surface**
(Benzinga — the terminal is responsive web with browser-cache persistence, the mobile *app* is a
different, thinner thing entirely). Posture 3 is a specific anti-pattern worth naming precisely
because it looks like a reasonable engineering shortcut (build a lighter mobile app instead of a
full responsive terminal) but it means a member's *saved objects* — watchlists, in Benzinga's case —
are the only thing that travels; the *workflow* does not, because the two apps are not the same
software.

**RELEVANCE TO UCT.** UCT already sits in Posture 2 territory with a documented internal gap (per
D-11 §4.1, §7.2): prefs and named layouts travel across devices, but chart drawings and
`uct.watchlist.cols` are localStorage-only and do not. UCT's mobile answer (`MobileWorkspace`, a
*different renderer*, per D-11 §2.5 / CLAUDE.md "Charts Hub V2") is closer to Koyfin's genuine
mobile app than to Benzinga's split-brand anti-pattern — it is the same product, same account, same
data, rendered differently — but UCT has not published anything like LSEG's Desktop-and-Web
Comparison document naming what, if anything, is unavailable on the phone branch.

**CONFIDENCE.** 🟢 on Koyfin's mobile app and widgets, and on Benzinga's split-brand mobile story and
browser-cache default (both direct quotes from official help articles). 🟡 on LSEG's Desktop/Web
comparison document's actual contents (cited by C5-01 from its title and tier, not independently
re-opened and quoted this pass — its specific gaps are NOT DETERMINED here).

**RECOMMENDATION (hypothesis).** *State explicitly, in one place a member can find, what does and
does not follow across devices* — the LSEG idiom, applied to UCT's own already-documented split
(prefs and named layouts sync; drawings and watchlist columns do not, per D-11 §4.1). This costs a
support-doc paragraph, not an engineering change, and is strictly cheaper than either fixing the
localStorage-only keys or leaving members to discover the gap by losing work. **Anti-pattern:**
Benzinga's split-brand mobile app — UCT's single-renderer-per-surface model (per C5-01 §2's table)
is the stronger existing choice and should not be abandoned for a "lighter native app" without
naming what continuity would be lost.

**OPEN QUESTION.** Does UCT's `MobileWorkspace` renderer actually carry every saved-object type a
desktop board can, or does it silently drop some (the way Koyfin's mobile app is presumably
feature-reduced from the web product)? Not measured this pass — the D-11 gap analysis does not
enumerate `MobileWorkspace`'s feature parity against `ChartsWorkspace.jsx`.

---

## 9. Synthesis against UCT's own state model

**OBSERVATION.** Read against D-11's full internal audit (§1–§7, summarized above under "Read this
first") and C5-01's seed map (§7.6), the external evidence in §3–§8 converges on a small number of
transferable moves that are cheaper than they look because UCT already has the underlying
infrastructure, just not pointed at the personalization surface.

**INTERPRETATION.**
1. **Density**: UCT has hard caps (`GRID_MAX_CELLS=16`) but no published-ceiling idiom (LSEG's
   "2,500 RICs," §3) and no per-widget compact mode (Koyfin's ticker-only rail, §3). The cheaper of
   the two is publishing what already exists as a limit.
2. **Defaults**: UCT already runs FactSet's institutional-templating pattern for scans
   (`starter_library.py`, editable-on-arrival, §4) but not for workspace boards, and has no
   LSEG-shaped ongoing persona re-ranking anywhere — the closest UCT gets is the static
   free/paid/admin gate.
3. **Saved-query lifetimes**: UCT's screener has the raw material for thinkorswim's three-way fork
   (list / query / alert, §5) but forces one shape per save action today.
4. **Autosave discipline**: Koyfin's one stated exception ("doesn't autosave — say so," §5) is the
   inverse of UCT's `charts_workspace_layout`, which autosaves silently by default (per D-11 §2.3) —
   TradingView's *visible* autosave toggle (per C5-01 §1) is the more directly transferable idiom for
   UCT than Koyfin's exception-naming, because UCT's problem is a silent debounce, not an unstated
   exception.
5. **Favorites/recents**: UCT has none, split-by-type or otherwise (§6) — Flagged is the nearest
   analog and is a single undifferentiated list.
6. **Sharing/roles**: UCT has no Viewer/Editor role layer over any saved-object store (§7) — every
   "share" today is a copy or a public-read flag, per D-11 §3.
7. **Cross-device**: UCT's actual behavior (prefs/layouts sync, drawings/columns don't, per D-11
   §4.1) is already close to LSEG's "state the gap" posture in substance but has never stated it to
   a member (§8).

**RELEVANCE TO UCT.** None of these seven require new persistence infrastructure — D-11 §7.6's seed
map (`chartDefaults.js`-shaped versioning, `user_definitions.py`-shaped stores,
`usePreferences.setPrefMerged` for concurrent writers, `useTracingsSync.js` for cross-device) is the
same infrastructure every external pattern above would be built on. The gap in every case is a
**product decision to expose a knob or a document**, not a missing capability.

**CONFIDENCE.** 🟡 — this section is interpretation over two internal reports (D-11, C5-01) plus the
external evidence in §3–§8 above; it makes no new factual claims.

**RECOMMENDATION (hypothesis).** Sequence the seven moves above by cost: (1) publish existing
ceilings, (7) publish the cross-device sync rule, and (4) make autosave visible are documentation-
only changes touching zero persistence code; (3) the scan-save fork and (5) split favorites/recents
are additive UI over existing data; (2) ongoing persona re-ranking and (6) a Viewer/Editor role
layer are the two genuinely new pieces of infrastructure, and should wait for C5-01 §6's own
recommendation — measure UCT's actual customization behavior — before being built for a hypothetical
need.

**OPEN QUESTION.** Same as C5-01 §6's: none of this program's competitive research can say whether
UCT's own members would use any of these seven moves if shipped. Only UCT's own `user_preferences`
and `charts_workspace_layout` tables can answer that, and per C5-01, nobody has queried them yet.

---

## GAPS

- **No new external fetches this pass.** Per the preamble's search-budget note (WebSearch
  exhausted session-wide, dated 2026-09-02 11:40 UTC) and the contract's own instruction to treat
  the Wave-1b dossiers as evidence rather than re-derive them, this report drew exclusively on
  `03-competitive-research/**` dossiers already fetched by sibling roles on 2026-09-02, plus the two
  internal reports named in the contract (C5-01, D-11). No browser tab was opened and no new
  WebFetch call was made. If a future pass has budget, the highest-value new fetches would be:
  (a) Bloomberg's current (2026) Launchpad documentation, since B-BBG-02's evidence is dated
  2012/2015 with only marketing-tier confirmation that the model persists into 2026; (b) any
  practitioner account of Koyfin Teams' actual role-permission granularity, which is documented only
  at the help-center-summary level here.
- **Five products' actual density/personalization feel remain unmeasured behind a paywall**,
  inherited from their own Wave-1b dossiers, not resolved here: AlphaSense, Quartr, Unusual Whales'
  subscriber-only surfaces (Super Flow specifically), FactSet, and SpotGamma's Canvas. A paid seat
  on any one would move the relevant claims above from 🔴/🟡 to 🟢.
- **No UCT production data was read** (per the contract's DO NOT and D-11's own stated ceiling) —
  every RELEVANCE TO UCT claim above is a claim about UCT's *code*, not about UCT's *members'
  actual behavior*. §9's own recommendation names this as the standing open question for the whole
  topic.
- **Godel, desk-tools/market-chameleon.md, and desk-tools/tradingview-desk-use.md were scanned by
  grep for personalization keywords and returned nothing load-bearing for this topic** (Godel is an
  AI-native grounding tool with no workspace/density surface documented; market-chameleon's dossier
  is thin and options-chain-focused) — not read in full, and not cited above as a result.
- **Bloomberg's own 02-monitors-workspaces.md file was read in full by C5-01, not re-read here** —
  this report cites C5-01's extraction of it rather than re-opening the primary source, per the
  contract's "cite them as evidence, do not re-derive" instruction; any Bloomberg claim not
  independently re-quoted above with its own URL should be read as "per C5-01," sourced there to the
  2012/2015 Launchpad guides.

## SOURCES

**Primary — official documentation, help centers, product/pricing pages, release notes (all
originally fetched 2026-09-02 by the named Wave-1b dossier; re-cited here with URL, not re-fetched
this pass).**

1. Koyfin, *Right Sidebar* — https://www.koyfin.com/help/right-sidebar/ — T1, verified
2. Koyfin, *Release Notes* (v3.90 "Compact Table") — https://www.koyfin.com/help/release-notes/ — T2, verified
3. Koyfin, *Hotkeys and Custom Shortcuts* — https://www.koyfin.com/help/hotkeys-and-custom-shortcuts/ — T1, verified
4. Koyfin, *Financial Analysis Templates* — https://www.koyfin.com/help/financial-analysis-templates/ — T1, verified
5. Koyfin, *Teams* — https://www.koyfin.com/help/teams/ — T1, verified
6. Koyfin, *Mobile App Features* — https://www.koyfin.com/help/mobile-app-feautres/ — T1, verified
7. LSEG, *Workspace Technical Specifications* — https://www.lseg.com/en/data-analytics/products/workspace/workspace-technical-specifications — T1, verified
8. LSEG, *Workspace for sales and traders* — https://www.lseg.com/en/data-analytics/products/workspace/sales-traders — T3, verified
9. LSEG, *Workspace Service Overview* (persona/discoverability tailoring) — service-description.pdf, per lseg-workspace/dossier.md [S22] — T1, verified
10. LSEG, *Desktop and Web Comparison* — desktop-web-comparison.pdf, per lseg-workspace/dossier.md [S17] — T1, cited via C5-01/sibling dossier, not independently re-opened this pass
11. TradingView, *Multi-chart mode* folder — https://www.tradingview.com/support/folders/43000578567-how-to-work-in-the-multi-chart-mode/ — T1, verified
12. Benzinga Help Center, *What is a Widget?* — https://help.benzinga.com/en/articles/1769521-what-is-a-widget — T1, verified
13. Benzinga Help Center, *Is There a Benzinga Pro App?* — https://help.benzinga.com/en/articles/2221758-is-there-a-benzinga-pro-app — T1, verified
14. Benzinga Help Center, *Why Aren't My Workspaces Saving?* — https://help.benzinga.com/en/articles/2463416 — T1, verified
15. Unusual Whales, *Flow Alert rule catalogue* — https://unusualwhales.com/option-flow-alerts/rules — T1, verified
16. thinkorswim Learning Center, *Scan / Stock Hacker* — toslc.thinkorswim.com/center/howToTos/thinkManual/Scan/Stock-Hacker — T1, verified
17. thinkorswim Learning Center, *Flexible Grid* (SERP snippet; direct fetch 404'd) — toslc.thinkorswim.com/center/howToTos/thinkManual/Charts/Flexible-Grid — T1 nominal, downgraded to secondary per desk-tools/thinkorswim.md's own tier note
18. AlphaSense, *A Guide to the Four Perspectives in AlphaSense* — https://help.alpha-sense.com/hc/en-us/articles/41245560097171-A-Guide-to-the-Four-Perspectives-in-AlphaSense — T1, verified
19. AlphaSense, *Save Searches and Create Email Alerts in AlphaSense* — https://help.alpha-sense.com/hc/en-us/articles/41815267178899-Save-Searches-and-Create-Email-Alerts-in-AlphaSense — T1, verified
20. AlphaSense home (capability table: watchlists, tags, bookmarks, highlight tags) — https://www.alpha-sense.com/ — T3, verified for object list
21. FactSet, *Investment Research solutions* — https://www.factset.com/solutions/investment-research — T3, claimed
22. FactSet, *FactSet AI for Wealth* — https://www.factset.com/marketplace/catalog/product/factset-ai-for-wealth — T3, claimed
23. FactSet, *Pitch Creator* — https://www.factset.com/marketplace/catalog/product/pitch-creator — T3, verified

**Internal sibling reports (cited by reference, not re-derived, per contract).**

24. C5-01, *Workspace systems survey* — `06-ux-and-information-architecture/workspace-systems-survey.md` — read in full 2026-09-02, cited throughout §3–§9 as "per C5-01 §N"
25. D-11, *State, persistence, and the existing workspace/widget system* — `01-existing-system/state-persistence-and-workspaces.md` — read in full 2026-09-02, cited throughout as "per D-11 §N"

**Secondary (used for corroboration/context only, not as a standalone factual basis for any claim above).**

26. Quartr dossier §J (density inference, no seat) — `03-competitive-research/quartr/dossier.md`
27. Benzinga Pro dossier §J (density assessed from shape only, 🔴) — `03-competitive-research/benzinga-pro/dossier.md`

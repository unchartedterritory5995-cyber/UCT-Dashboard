---
id: C5-01
title: Workspace systems survey — product patterns, layout libraries, and the linked-context primitive
role: Workspace systems survey (domain pod)
wave: 1b
group: C
category: domain
scope: Workspace/board/dock systems across financial terminals (Bloomberg Launchpad, TradingView, thinkorswim, Koyfin, LSEG Workspace, Benzinga Pro, Unusual Whales) and the JS layout-library / desktop-interop landscape (react-grid-layout, dockview, golden-layout, FlexLayout, rc-dock, react-mosaic, Lumino, FDC3, HERE/OpenFin, interop.io/Glue42)
confidence: 🟡 overall
evidence_ceiling: Two hard ceilings. (1) NO adoption or telemetry evidence on whether users customize workspaces was reachable from any public source — §6 is built entirely on indirect commercial signals, and a Bing query for published product-analytics on dashboard customization returned nothing relevant. Only UCT's own `user_preferences` table can close it. (2) Product-pattern evidence (§0–§7) is second-hand through sibling Wave-1/1b reports rather than re-fetched; those carry their own ceilings, chiefly that Bloomberg Launchpad's mechanism is documented only in © 2012 / © 2015 guides. Library facts (§8–§9) ARE first-hand from vendor repos, docs and the npm registry, but release DATES came through a summarising extractor that produced at least one internally inconsistent relative date, so dates are 🟡 and versions are 🟢.
sources: 28 primary (vendor repos, official docs, npm registry, FINOS/FDC3 spec pages); 1 secondary (a negative-result search); 9 internal sibling reports
uct_relevance: high
status: draft
date: 2026-09-02
---

# C5-01 — Workspace systems survey

**Terminology.** TERMINAL-CURRENT is the existing `/calendar` surface (display-named "UCT
Terminal"). TERMINAL-NEXT is the program's target. "Product X does Y" never implies "UCT should
do Y" — every RECOMMENDATION below is phrased as a hypothesis. This report supplies evidence for
the C5-03 comparison; it does not make the decision.

**All URLs fetched 2026-09-02.** Tier labels: **T1** official documentation/help · **T2**
official manuals · **T3** official product pages · **T5** official training content · **T9**
credible professional tutorials (university library guides) · **T15/16** practitioner/community.
Vendor source repositories, official docs sites and the npm registry are treated as T1.

---

## 0. Headline

**OBSERVATION.** Two findings dominate this survey, one about products and one about code.

**Products:** workspace design is not a spectrum from "simple page" to "dock manager". In the
products that work best it is a **two-layer architecture with named, symmetric traffic between
the layers**. Bloomberg is the best-evidenced instance: four fixed panels *plus* a free-floating
Launchpad, where `LLP` promotes any function into the workspace as a live component, and
per-row "function shortcuts" demote a workspace click into a fixed panel the user chose in
advance [B-BBG-02 §1, §8, from Bloomberg's own *Getting Started on Bloomberg Launchpad* user
guide © 2012/© 2015]. The consequence: **because promotion is generic, Bloomberg never had to
build a widget per function** — the component set is a by-product of the function set. UCT's
`/charts` has the opposite posture, an 18-entry hand-curated `WIDGET_REGISTRY` [D-06 §1.1] that
grows slower than the product does.

**Code:** across seven layout libraries, **six of the seven failure modes a workspace actually
suffers are persistence failures, not layout failures** (§7). Every library in §8 has a working
grid or dock. They differ on whether the saved thing survives a bad parse, a concurrent write, a
resize, a template apply and a device change — and every one of them hands you an opaque JSON
blob with **no schema version field** and leaves versioning entirely to the application.

**INTERPRETATION.** The taxonomy the contract asks for ("fixed page / hybrid / modular") is
therefore better stated as two questions, neither of which is about the grid: *can a fixed page
become a panel, and can a panel hand off to a fixed page?* and *who owns the document schema?*

**RELEVANCE TO UCT.** UCT is already on the right side of the *content* split — Dashboard,
Breadth, Movers, Catalysts and Live Flow are fixed pages answering market-wide questions;
`/charts` is the composable workspace for portfolio-specific questions [B-BBG-02 §8]. What is
missing is the graduation path in either direction, and a versioned workspace document.

**CONFIDENCE.** 🟢 that both Bloomberg layers exist and that `LLP` + function shortcuts cross
between them. 🟡 that the 2026 Bloomberg UI still works this way. 🟢 on the library
schema-version finding (checked against each library's own persistence documentation).

**RECOMMENDATION (hypothesis).** *A widget system earns its keep when promotion is generic
rather than per-widget.* Test one operation — "open this page as a panel" — against UCT's
existing routes before authoring more registry entries. **Anti-pattern:** a workspace that can
only contain things somebody remembered to build a widget for.

**OPEN QUESTION.** When `LLP` promotes a function, is the resulting component fully interactive
or a reduced rendering? No source compares the two — and that difference separates "a real
promotion primitive" from "a screenshot with a ticker field".

---

# PART I — PRODUCT PATTERNS

## 1. The taxonomy: fixed page / hybrid / modular, with exemplars

**OBSERVATION.** Three regimes. The boundary that matters is *who composes the layout*.

| Regime | Definition | Exemplars | What it optimises | What it costs |
|---|---|---|---|---|
| **Fixed page** | Layout is authored by the vendor; the user changes filters and columns, never arrangement | Bloomberg `WEI` / `IMAP` / `MOST` / `MOV` / `BTMM` [T5 Bloomberg 2024-10-10; T9 Scranton]; Benzinga Pro **Movers** (hard-capped 100 rows); Unusual Whales flow / dark-pool / screener feeds; UCT Dashboard, Breadth, Catalysts, TERMINAL-CURRENT | Zero-decision access to a question with one canonical answer | Nothing personal fits |
| **Hybrid** | Vendor-authored page with user-owned *saved objects* layered on it — views, column presets, saved filters, templates | TradingView screener (13 named column presets over a fixed shell); Koyfin **Watchlist Views** (columns + summary rows + grouping, synced to dashboards); LSEG **Screener + Data Item Library** columns; Unusual Whales **saved filters** with session restore; Benzinga Pro scanner (drag-reorder columns, selectable refresh) | Personalisation without layout work; objects travel across pages | The page's *shape* is still the vendor's |
| **Modular** | The user composes the arrangement from components | Bloomberg **Launchpad** (Views → Pages → components); TradingView **chart layouts** (1/2/4/8/16 charts by plan); thinkorswim **Flexible Grid**; Koyfin **Dashboards (`MYD`)**; Benzinga Pro **workspaces** (hard cap **4 tools**); Unusual Whales **custom dashboards** + Super Flow; LSEG **Tiles / Tile Manager / HERE Dock**; UCT `/charts` | Fits any workflow; unbounded | Blank canvas; drift; the vendor cannot improve a board the user owns |

Two exemplars are the *edges* of the modular regime and worth naming:

- **Benzinga Pro caps a workspace at four tools** [B-BZ §G, Benzinga help center]. A modular
  product deliberately refusing to become a dock manager. Stated effect: a legible board. Cost:
  window-juggling.
- **Bloomberg's Launchpad is two levels deep** — a **View** contains **Pages**, and a Page holds
  components [B-BBG-02 §2]. The unit of switching is a whole desk. Every other product here is
  one level: a flat list of boards.

**INTERPRETATION.** The hybrid regime is under-represented in how this program has framed the
problem, and it is where most of the leverage sits. TradingView states it most cleanly: three
objects with **three different lifetimes** — the *layout* (a saved workspace), the *indicator
template* (a saved analysis stack, portable across layouts), and the *column preset* (a saved
way of reading a table) [B-TV §G]. Most platforms conflate at least two. The separation is what
lets a user carry one analysis stack across many workspaces without cloning boards.

**RELEVANCE TO UCT.** UCT has the layout (`charts_workspace_layout`) and a *seed* for the look
(`chart_settings`) [D-11 §2.1, D-06 §1.4], plus named grid templates that store tickers and
timeframes. It has **no portable analysis stack**, and its "way I read a table" state is split
three ways: global per-widget-**type** prefs (`watchlist_settings`, `theme_tracker_settings`,
`fundamentals_settings`, `breadth_widget_settings`), **per-instance** `widget.opts.settings`, and
a **localStorage** key (`uct.watchlist.cols`) that does not travel between devices [D-11 §1.3,
§2.3]. That three-way split is the seam a workspace schema has to close.

**CONFIDENCE.** 🟢 on the exemplar placements (each read from the sibling dossier that fetched
the vendor's own help center). 🔴 on **FactSet**, which has no §G in the corpus reached — its
workspace model is **NOT DETERMINED** by this survey.

**RECOMMENDATION (hypothesis).** *Naming the three objects separately — arrangement, analysis
stack, table-reading — may reduce template proliferation more than adding templates would.*
Corollary, testable alone: TradingView exposes **autosave as a user-visible toggle** [B-TV §G];
UCT's is a silent 500 ms debounce [D-11 §2.3], so a member has no mental model of when their
work is safe.

**OPEN QUESTION.** Where does TERMINAL-NEXT sit? The evidence says "hybrid pages plus a modular
board, with a crossing between them" is the shape that survives; it does not say which existing
UCT surface should move.

---

## 2. Docking, tabs, and window models

**OBSERVATION.** Six distinct window models ship across this set; only two products offer true
docking.

| Product | Model | Tabs | Docking | Free-float | Multi-monitor |
|---|---|---|---|---|---|
| Bloomberg Launchpad | Free-floating components over four fixed panels; **docking by dragging until a thick yellow line appears**, after which the docked set moves as one unit and clicking a component's top undocks it [T9 Wharton 2013] | ✅ **Custom Function Window** folds N functions into one window as bottom tabs, explicitly "to reduce the number of components on the screen" [T2] | ✅ | ✅ | Per-computer **resolution assignment** for views; `Show on Selected Pages` (shared instance) vs `Duplicate to Page` (independent copy) [T2]. How a View spans physical displays: **NOT DETERMINED** |
| TradingView | Fixed N-pane multi-chart layout (1/2/4/8/16 by plan) | ✅ chart tabs | ❌ | ❌ (web) | **Claimed**: desktop app has "native multi-monitor support… without any of the limitations browsers traditionally face", symbol syncing between tabs, and **synchronized workspace crosshairs across all displays** [B-TV §G — marketing claim, unverified] |
| thinkorswim | **Flexible Grid** — "an alternative to the default Charts Grid interface… provides all regular Charts features while giving you more control over cells' layout"; a freeform multi-pane chart/gadget workspace distinct from the tabbed Charts grid | ✅ (tabbed Charts grid is the default) | ⚠️ implied | ⚠️ | Not documented in the corpus reached |
| Koyfin | Dashboard (`MYD`) — resizable, drag-arrangeable widgets | — | ❌ | ❌ | **NOT DETERMINED** |
| Benzinga Pro | Workspace, **max 4 tools** | — | ❌ | ❌ | **No native support.** The only pop-out is chat; multiple browser windows are the implied answer — and with layouts in **browser cache**, a fragile one [B-BZ §G] |
| Unusual Whales | Custom dashboards + **Super Flow** multi-window dashboard with presets and keyboard shortcuts; **Periscope** multi-chart view (2026-02-27) | ⚠️ | ❌ | ✅ (Super Flow) | **Not observed.** No desktop app in the sitemap [B-UW §G] |
| LSEG Workspace | **Tiles** — floating windows each with its own search bar, managed by a **Tile Manager** with group / auto-group / auto-arrange / "My Tile set" saved collections; **HERE Dock** on the HERE Core desktop (formerly OpenFin) is a *second* window manager for the same product [S16/S17] | — | ✅ (HERE Dock) | ✅ | **NOT DETERMINED.** System requirements specify "PCIe card with minimum 256MB memory **per port**" — a per-port graphics requirement that implies multi-monitor is an assumed deployment, but no document states a count |
| **UCT `/charts`** | react-grid-layout, 24 cols × 20 rows, **viewport-locked** (never scrolls), free placement (`compactType: null`), drop-and-repack | ✅ **two parallel tab systems** — slot-level (`widgetTabs.js`) and chart-profile-level (`chartTabs.js`), sharing no code | ⚠️ **merged/seamless mode** turns shared edges into draggable seams — closer to docking than to a grid | ✅ `FloatingWidgetPanel` | ✅ **`PopoutWindow` — a React portal into `window.open`**, so state stays in the opener's JS context and every popped window shares the ONE browser-wide SSE pool [D-06 §1.5] |

**INTERPRETATION.** Three findings, in descending order of usefulness.

**(a) UCT's pop-out is the strongest multi-monitor story in this table, and it already ships.**
Every competitor either has no multi-monitor answer (Koyfin, Benzinga, Unusual Whales), an
undocumented one (LSEG, thinkorswim), or one that costs a second app instance (TradingView
desktop). UCT's portal gets multi-monitor **without multiplying server streams** — ten popped
widgets across three monitors cost the backend what one tab costs [D-06 §1.5; a design statement
in `PopoutWindow.jsx`, not a measurement]. Documented cost: a popped window dies with its opener.
⭐ This property is **architecture-dependent, not feature-dependent** — see §8's open question,
because adopting a dock library's built-in popout may forfeit it.

**(b) Tabs-inside-a-panel is a density lever, and Bloomberg says so out loud.** The Custom
Function Window exists "to reduce the number of components on the screen" [T2] — screen real
estate is the scarce resource and the user gets a knob for it, rather than the product assuming
more tiles is more value. UCT has this (`widgetTabs.js`) but has it **twice**, in two systems
that share no code [D-06 §8].

**(c) `Show on Selected Pages` vs `Duplicate to Page` is a *shared instance vs independent copy*
choice made explicit at the moment of duplication** [T2]. It is the same distinction as
Copy-from-source vs Link-to-source (§4), applied to panels instead of lists. No other product in
this set makes it explicit; UCT's `/charts` has no notion of the same panel appearing twice.

**RELEVANCE TO UCT.** The gap that appears the moment the viewport-lock is relaxed: the widget
board has **no widget-count cap and no mount queue** [D-06 §1.8]. The multi-chart grid has both
(`GRID_MAX_CELLS = 16`, `useStaggeredMount` limit 3) because it was built after the 2026-05-24
fetch-herd incident. The widget board is bounded only implicitly, by geometry.

**CONFIDENCE.** 🟢 on the model column for Bloomberg, TradingView, Benzinga, LSEG and UCT.
🟡 on thinkorswim's Flexible Grid — a Google SERP snippet of a page that 404s on direct fetch is
the whole of the evidence. 🔴 on multi-monitor for Koyfin, thinkorswim and Unusual Whales:
absence of documentation is not documentation of absence.

**RECOMMENDATION (hypothesis).** *Make the pop-out the default multi-monitor story and do not
build a second app instance* — the portal is why stream cost stays flat. Separately: *if the
viewport-lock is relaxed, port `useStaggeredMount` to the widget board in the same change.*

**OPEN QUESTION.** Popup blockers. `PopoutWindow` takes an `onBlocked` callback so the failure
path exists, but what a first-run user sees is unverified — and for a paid terminal, "click
pop-out, nothing happens" is a product-defining moment.

---

## 3. Linking: colour groups, letters, channels, and what a group may carry

**OBSERVATION.** Every serious workspace ships a linked-context primitive. They differ on three
axes: **how a group is identified**, **how many exist**, and — the axis that actually matters —
**what a group's payload may be**.

| Product | Identifier | Count | Payload | Opt-in model |
|---|---|---|---|---|
| Bloomberg Launchpad | **A number + a letter badge** at the top of each member; the guide's worked example renders as "Group-1, #A", and Wharton independently reports "Letter identifiers (A, B, C) appear at component tops" | Open-ended ("Group 1 may contain linked charts, Group 2 may be linked news components") | **Two group KINDS with different reach**: a **Security Group** carries one security to any component type; a **Monitor Group** carries a whole watch list and (per one 2013 secondary source) **only a News Panel can consume it** | **Per-component opt-in in each component's own vocabulary** — the News Panel joins via *Settings → Add to Security Group*, the Monitor via *Link To → Component Groups*. No global "link everything" switch |
| Koyfin | **7 colour groups**, assigned from the widget header's upper left; new widgets default to blue | 7 | ⭐ **Polymorphic, and the GROUP carries the choice**: each group has one of three *selection methods* — **Single Security**, **Multiple Securities**, or **My Watchlists** — and changing the method in one widget changes it across the group. Table + the three graph widgets support single and multiple; Scatter Plot and News support all three [S13, verified] | Per-widget assignment |
| TradingView | Colour-tagged chart-layout sync | — | Symbol; plus **date-range sync**, **same symbol at different timeframes**, and syncing *selected* charts rather than all [B-TV §G] | Per-chart |
| Benzinga Pro | Colour-banded groups | — | Symbol | Per-tool |
| Unusual Whales | — | — | Universe **presets** in the filter (Top 50/100 by option volume, SPY, QQQ, DIA, IWM, Magnificent 7, SMH, XBI, XLE, XLF, KRE, XRT, GDX, ARKK, FXI) act as a shared-universe primitive without being a link group | — |
| **FDC3 (the standard)** | **`DisplayMetadata { name, color, glyph }` on the channel object** — colour is *data*, not a hardcoded letter | **8 by convention**, not by ceiling: Channel 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 blue, 7 magenta, 8 purple | **A typed context object**, not a bare symbol — Context Data is one of the five parts of the standard | `joinUserChannel()`; **"An app can only be joined to one channel at a time."** Channel-scoped `broadcast()` works *without* joining |
| **UCT `/charts`** | **4 colour groups A/B/C/D**, plus `'N'` = explicitly not linked (which gets a private key `N:${groupId}` from the per-tab id, so two "not linked" tabs in one slot stay independent) | **4 — a hard ceiling** | **Symbol only.** No timeframe group, no date/replay group per colour (replay is board-wide), no filter/universe context. Crosshair is a separate ad-hoc bus | Per-widget colour dot |

⛔ **A correction this survey must carry forward.** The contract's framing ("linking (color
groups, channels)") and any downstream sentence reading *"Bloomberg links widgets by colour
group"* is **unsupported by the sources reached**. B-BBG-02 §5 states it plainly: no source
documents colour-coded component groups in Launchpad; the identifier is a number plus a letter.
Colour appears in Launchpad in two unrelated places — red as a transient *editing* state while a
component is being added to a group, and "color-coding securities" as a per-row monitor feature.
The colour-dot idiom is real in this category (Koyfin's seven, Benzinga's bands, FDC3's eight,
UCT's four) but on the evidence available it is **not Bloomberg's**.

**INTERPRETATION.** Four things are doing work.

**(a) The payload is the design; the count is not.** Koyfin's seven groups matter far less than
Koyfin's *three selection methods*. A group that can carry "this watchlist" rather than "this
symbol" turns a board from a symbol viewer into a universe monitor. Bloomberg reached the same
place from the other direction with the Monitor Group — and **restricted which components may
consume it**. That restriction reads as considered rather than incomplete: "here is a list" is a
different message from "here is a security", and most components have no meaning for the first.
A news panel does. A chart does not.

**(b) FDC3 generalises exactly this and is the only formal statement of it.** In FDC3 a channel
carries a *typed context object*, so polymorphism is structural rather than a per-vendor special
case; and the channel's *appearance* is `DisplayMetadata` on the channel — `name` ("A
user-readable name for this channel, e.g: `\"Red\"`"), `color` ("The color that should be
associated within this channel when displaying this channel in a UI, e.g: `#FF0000`. May be any
color value supported by CSS"), `glyph` ("A URL of an image that can be used to display this
channel"). **Eight channels is a convention in the spec, not a limit in the model.**

**(c) Bloomberg's per-component opt-in, in each component's own vocabulary, is verbose on
purpose.** Nothing is linked that the owner did not walk over and link — which is why a Launchpad
view does not surprise its owner. The anti-pattern is implicit auto-linking.

**(d) Symbol-only linking is table stakes; time-linking and filter-linking are the common next
asks and are absent almost everywhere.** TradingView is the only product here with a documented
date-range sync and a documented "same symbol, different timeframes" mode.

**RELEVANCE TO UCT.** UCT's four colour groups already implement the Security Group idea, and
`WorkspaceContext.setGroupSym` is "change one, change all". The four-group ceiling **already
bites**: `GridChartCell` is composed on `StockChart` directly rather than on `ChartWidget`
*specifically because* colour groups cap at four independent symbols [D-06 §1.3]. And there is
no Monitor-Group analogue — no way to publish *a list* to a subscribing widget.

**CONFIDENCE.** 🟢 on Bloomberg's group mechanism, the two kinds and the per-component opt-in
(primary guide for the flow, Wharton independently for the kinds). 🟢 on Koyfin's three selection
methods (Koyfin's own help center). 🟢 on the FDC3 channel model, colour list and one-channel
rule (fetched from the FDC3 2.2 spec pages directly). 🟡 on Bloomberg's "News Panel only"
restriction — a single 2013 secondary source; Bloomberg's own guide does not state it. 🟢 on the
*absence* of colour groups in the Bloomberg sources reached; 🟡 on the stronger claim that
Bloomberg has never had them.

**RECOMMENDATION (hypothesis).** *Generalise the link key from a colour letter to a channel
record* — shaped like `{id, displayMetadata: {name, color}, context}` where `context` is a typed
payload (symbol · symbol-set · list-reference · timeframe · range), and make the payload kind
explicit per channel the way Koyfin does. The `'N'` escape already proves UCT's code path
tolerates a non-letter key. Ship it with **exactly one list-consuming widget to start** (News/Buzz
is the natural first, matching Bloomberg's News-Panel-only precedent — and that precedent suggests
the restriction is a feature, not a stage). **Anti-patterns:** implicit auto-linking; and a second
ad-hoc bus per new context type — UCT already has `crosshairBus` and `aiSearchBus` as named
members of the same context object [D-06 §1.3], which is the shape FDC3's single typed channel
exists to avoid.

**OPEN QUESTION.** Precedence. When a component belongs to a Security Group *and* its view has a
Monitor Group, which wins on a conflicting update? Neither Bloomberg source addresses it — and
precedence is exactly where a linking model either holds or produces the "my chart jumped"
complaint.

---

## 4. Templates, sharing, and the blank-canvas problem

**OBSERVATION.** The blank canvas is the largest failure mode of any workspace product, and only
Bloomberg and Koyfin document an answer.

**EVIDENCE.**
- **Bloomberg.** A first-time Launchpad user is not shown an empty canvas: `BLP <GO>` with no
  views raises a **"Sample Views" window with three options**, and Sample Views are organised
  **by asset class**, reachable permanently from the View Manager. Bloomberg's own framing:
  "Sample views have been created for your consideration. Many of these displays will be a good
  starting point for you to add components and customize as needed." [T2, verified]
- **Bloomberg sharing.** Views and Pages are shareable to other Bloomberg users; the earliest
  documented form is **as message attachments**, and the View Manager is "the central location
  from which to access your views sample views and **shared pages**". 2020s marketing adds
  Instant Bloomberg chat sharing [T3, claimed].
- **Bloomberg component discovery.** The Component Browser opens on **the 25 most popular
  components**, ranked with **stars showing popularity among users *and* Bloomberg specialists**,
  with a **live preview** of the highlighted component [T2, verified].
- **Bloomberg extension point.** *Bloomberg Pro Tips: Run BQuant Desktop Applications in your
  Launchpad*, 2025-08-19 [T5, official]: firm-authored analyst applications become Launchpad
  components. The workspace is an extension point, not just a layout. [claimed — article summary
  only; mechanism is in the video]
- **Koyfin.** Dashboards "start blank or load a customized template with widgets selected"
  [S12, verified]. Financial Analysis templates carry an explicit warning: *"Once you've created
  or changed your template, make sure you **save** it since it isn't saved automatically"* [S19].
- **TradingView.** Six built-in **indicator templates** ship (Bill Williams' 3 Lines, Displaced
  EMA, MA Exp Ribbon, Oscillators, Swing Trading, Volume Based); users save their own from
  whatever is on the chart. Layout sharing: "Copy link", recipient can view, only the owner can
  edit. Saved-layout counts are a **plan quota** — 1 / 5 / 10 by tier [B-TV §G].
- **Benzinga Pro.** *"No evidence of shareable workspace templates, a starter-layout library, or
  a published default board. Onboarding is a free interactive course rather than a shipped
  layout."* [B-BZ §G]
- **Unusual Whales.** Saved objects are metered by tier; no starter library observed [B-UW §G].

**INTERPRETATION.** Bloomberg's answer to the blank canvas is not a tutorial or a tour — it is
**pre-built, opinionated, editable desks segmented by what you trade.** And the sample view is
not a read-only demo; it is a live view you immediately customise, so the sample doubles as the
teaching artefact: you learn the model by taking one apart. That is the same posture UCT already
took for screens — the firm's setups ship as **ordinary editable definitions**
(`starter_library.py`, `starterScans.json`), not a special read-only class [D-11 §3].

The Component Browser answers a different problem — *there are too many things to choose from* —
with three mechanisms UCT has none of: popularity ranking sourced from two populations,
preview-before-commit, and tabs-in-one-window as a density lever. The failure without them is
silent: members keep using the three widgets they found first.

**RELEVANCE TO UCT.** `/charts` starts empty [D-11 §2.2: `DEFAULT_LAYOUT = { widgets: [], cols:
24 }`], and the widget menu is a flat, unranked, unpreviewed list derived from `WIDGET_REGISTRY`
[D-06 §1.1]. UCT already records what a popularity ranking would need. The affected persona is
the newer member who never discovers the Flow or Breadth widgets — not the desk operator, who has
a board and therefore cannot see this problem.

**CONFIDENCE.** 🟢 on Bloomberg's Sample Views, asset-class segmentation, shareable pages/views,
the 25-component browser, the star ranking and the preview (primary, two guide editions).
🟡 on the current sharing mechanism (message attachments is the 2012 documentation; the Instant
Bloomberg framing is 2020s marketing). 🟡 on BQuant-in-Launchpad.

**RECOMMENDATION (hypothesis).** *Ship starter boards the way UCT already ships starter scans —
as ordinary editable artefacts, segmented by what the member trades* (swing-equity, options-flow,
macro/breadth, earnings-day). Instrument whether members who start from one hold **more** widgets
a week later than members who start blank. **Anti-pattern:** a read-only "demo" board or a guided
tour; the sample must be the real thing, taken apart. Second hypothesis, testable independently:
*rank the widget picker by real usage and preview before commit* — and test ranking and preview
**separately**, because shipping both at once makes the result unattributable.

**OPEN QUESTION.** Are Bloomberg's Sample Views curated centrally or **harvested from real users'
views**? If harvested, the starter set is a far cheaper artefact than it looks. Second: are the
popularity stars telemetry or curation? "Popularity among users **and** Bloomberg specialists"
reads like a blend, and the blend ratio is the whole design — pure telemetry entrenches whatever
is already popular.

---

## 5. Persistence, addressability, geometry, and undo

**OBSERVATION.** Four sub-patterns; two are near-unique to Bloomberg and both are directly
transferable.

**(a) A saved workspace is addressable from the command line.** `BLP AGAIN "VIEW NAME" <GO>`
loads a specific named view; `BLP EMPTY|BLANK|NEW <GO>` loads a blank one; `BLP AGAIN|RELOAD
<GO>` refreshes [T2, verified]. **This collapses the cost of having many saved layouts** — that
cost is normally *finding* the right one, and Bloomberg deleted it rather than optimising the
picker. Koyfin reaches the same place differently: its objects have **keyboard shortcuts**, so a
power user gets to a bespoke 40-metric fundamentals page in four keystrokes [B-KOY §G].

**(b) Content persists against the login; geometry is a property of the machine.** Bloomberg's
Startup Defaults let a user *"assign a specific resolution for your Launchpad views to open for
each of your computers — on a work terminal and/or on a home PC"* [T2, verified]. That setting
only makes sense if view *content* is stored centrally against the user while its *geometry* is
machine-local. Bloomberg separated **what is on the desk** from **how big the desk is**.
(B-BBG-02 is explicit that server-side view storage is *inferred* from this feature plus
Bloomberg Anywhere's login-anywhere model, not stated by any source.)

**(c) Ten-deep undo on the user's curated object.** `MNRS <GO>` restores a previous version of a
Launchpad monitor, keeping **up to ten previous versions**, with Bloomberg's own guide naming the
two triggering cases: *"If you delete a monitor accidentally or make a change to a monitor that
you would like to undo"* [T2, verified].

**(d) Persistence quality varies wildly and is the clearest differentiator in this survey.**

| Product | Where the working layout lives | Cross-device | Version history |
|---|---|---|---|
| Bloomberg | Login-scoped (inferred); geometry per machine | ✅ | ✅ 10 deep, monitors only |
| TradingView | Account-level, syncs web/mobile/desktop; **autosave is a visible toggle** | ✅ | ⚠️ not documented |
| Koyfin | Named objects; Financial Analysis templates **do not autosave** and say so | ✅ | ❌ |
| **Benzinga Pro** | 🔴 **browser cache**, with **manual** save-to-server as the cross-device path | ❌ by default | ❌ |
| Unusual Whales | Saved filters with session restore ("Filters from previous session have been reloaded!") | ✅ | ❌ |
| LSEG | Named layouts; "My Tile set" saved collections | ✅ | ❌ |
| io.Connect (Glue42) | Workspace Layouts as **JSON blueprints** containing "the name of the Workspace, the structure of its children… the names of each app present in the Workspace, context, and other settings"; saved via a UI Save button, restorable to "recreate arrangements and resume context" | ⚠️ per-user vs org-wide **NOT STATED** | ❌ |
| **UCT `/charts`** | Server-side preference, **debounced 500 ms + hydration gate + flush on unmount**; named layouts in `charts_layouts.db` | ✅ for prefs; ❌ for `uct.watchlist.cols` and all chart drawings, which are localStorage-only | ❌ **none, on any user-authored artefact** |

**INTERPRETATION.** Three readings.

**`MNRS` is evidence about failure, not just a feature.** Products do not ship ten-deep version
history for things that never go wrong. Bloomberg built it for exactly one object — the monitor —
and named the triggers as *user error on a curated list*. That is the closest thing this survey
has to an answer for "what breaks in workspace products", and it says: **users destroy their own
lists often enough to productise the recovery.**

**Benzinga Pro's browser-cache persistence is this survey's clearest anti-pattern, and UCT has
already avoided it** — `charts_workspace_layout` is a server-side preference with a debounced
save [B-BZ §G, D-11 §2.3]. Record it as a *validated existing choice*, not a gap.

**But UCT's persistence has a defect Bloomberg's does not.** 🔴 `parseLayout` returns `null` on a
malformed blob and its single consumer falls back to `DEFAULT_LAYOUT` — **an empty board,
indistinguishable from a new user** — which the autosave then overwrites within 500 ms of the
first grid event. No backup, no prior-version copy, no undo for layout [D-11 §2.2]. `MNRS` is
Bloomberg's answer to that exact scenario.

**RELEVANCE TO UCT.** Two concrete gaps. **(a) No geometry/machine separation**: a phone, a
laptop and the desk's 27" monitor share one persisted layout, and the phone branch sidesteps it
by being a *different renderer* (`MobileWorkspace`) rather than a different geometry for the same
board [D-06 §1.2, D-11 §2.5]. **(b) No addressable board** — there is no "load my earnings board"
verb typed where the member already types. The desk persona is the operator who wants a different
board at 07:00, 09:30 and 15:45 and today either rebuilds one or keeps a compromise board that is
wrong at all three times.

**CONFIDENCE.** 🟢 on `BLP AGAIN`, `PDFB`, `MNRS` and the ten-version depth. 🟡 on "views are
stored server-side against the login" — inferred, not stated. 🟢 on the UCT-side and io.Connect
persistence facts. 🟡 that UCT's empty-board fallback has ever fired in production — no support
ticket or log line was read.

**RECOMMENDATION (hypothesis).** *Version-history the user's own curation before adding more
places to curate*, and test it on the **smallest** surface with the clearest loss first
(watchlists), the way Bloomberg scoped `MNRS` to monitors alone. Second: *distinguish "empty
because new" from "empty because unreadable"* — the current fallback conflates them and then
destroys the evidence. Third: *test whether layout geometry should be keyed by (user × viewport
class)* rather than by user alone; the single-blob model is why the phone needed a separate
renderer at all.

**OPEN QUESTION.** What is the practical ceiling on saved boards before a user stops maintaining
them? Bloomberg documents no limit and no source reports a real user's count. Without that number
"let users save boards" is an unbounded feature — and a flat list of eleven boards is the shape
that goes stale, which is plausibly why Bloomberg's hierarchy is View → Page rather than a list.

---

## 6. Do users actually customize? — the weakest-evidenced question in this survey

**OBSERVATION.** 🔴 **No vendor telemetry, product-analytics write-up, or adoption study was
reachable for any product in this set.** A targeted search for published measurements of
dashboard-customization rates returned nothing relevant (Bing, 2026-09-02 — top ten results were
Google Dashboard, Power BI, Tableau and Wikipedia definition pages; **negative result recorded as
evidence about reachability, not about behaviour**). What exists is a set of *indirect* signals.

**EVIDENCE — indirect, ranked by strength.**

1. **Metering proves willingness to pay for saved configuration.** Unusual Whales' three retail
   tiers differ in *almost nothing except how many saved objects you may own*: custom alerts
   25 → unlimited, watchlists 5 → unlimited, custom dashboards 5 → unlimited, saveable filters
   per feed 10 → unlimited. Everything else in the three feature lists is byte-identical (the one
   real exception is SPX MM Exposure refresh, 10-min → 1-min) [B-UW §G, three pricing feature
   lists compared line by line, verified]. **UW does not sell data tiers to retail; it sells how
   much of your own configuration you may keep.** A company does not build its price ladder on an
   axis users ignore.
2. **Plan quotas on layouts, at a much larger company.** TradingView gates saved chart layouts at
   1 / 5 / 10 by tier and charts-per-layout at 1/2/4/8/16 [B-TV §G]. Koyfin gates custom
   calculations at 1 / 10 / unlimited [S18]. Three independent vendors converged on metering
   saved configuration.
3. **Bloomberg built a popularity ranking for components**, sourced from users and specialists
   [T2]. A ranking implies a distribution — component choice is a real decision users make
   differently from each other.
4. **Bloomberg built ten-deep undo for monitors** [T2]. Users edit curated lists enough to
   destroy them.
5. **Bloomberg's first-run is Sample Views, not a blank canvas** [T2] — a vendor betting that
   unassisted composition does *not* happen.

**COUNTER-SIGNAL.** Signal 5 cuts both ways, and Benzinga Pro's four-tool cap plus its absence of
any starter-layout library [B-BZ §G] suggests at least one vendor concluded deep customisation is
not where its users are. Bloomberg's own material notes Launchpad opens minimised by default and
that a new user is prompted to open Launchpad and may click "No" [T9 Scranton] — the workspace is
opt-in even at Bloomberg.

**INTERPRETATION.** The honest summary: **the evidence says users customize enough that vendors
meter it and build undo for it, and simultaneously that vendors do not trust users to start from
blank.** Both can be true, and together they point at one design: *ship an opinionated starting
arrangement, then let it be edited freely and count the edits.* What no source supports is the
strong form of either claim — "most users never customize" and "customization is the product" are
both unevidenced here.

**RELEVANCE TO UCT.** ⚠️ **UCT can answer this about its own members and no competitor can answer
it for them.** `charts_workspace_layout` is a server-side per-user row; the distribution of widget
counts, distinct types used, and whether a row differs from `DEFAULT_LAYOUT` at all is a single
query against a copy of `auth.db`. That measurement is worth more to this program than any
further external research on this question.

**CONFIDENCE.** 🔴 on "do users customize" as a measured fact — **no direct evidence reached**.
🟢 on each indirect signal individually (vendor pricing pages and official guides).
**EVIDENCE CEILING:** vendor telemetry is not published by anyone in this set, and a public-web
search for third-party measurement returned nothing. The routes that would raise it: (a) UCT's own
preference table — **the owner can supply this**; (b) a practitioner interview; (c) a conference
talk by a terminal team on workspace adoption.

**RECOMMENDATION (hypothesis).** *Measure UCT's own workspace adoption before designing for a
hypothetical user.* Specifically: what fraction of members have a `charts_workspace_layout` row at
all; among those, the distribution of widget count and distinct types; and how many rows are
byte-identical to a shipped template. **Anti-pattern:** importing a customization posture from a
competitor whose user base is not the desk's.

**OPEN QUESTION.** Does customization *retain*? Unusual Whales' own dossier states the
anti-hypothesis: a Basic user can extract full value with ten well-chosen filters and never
upgrade. The same logic says a member with a good board may never need anything else — either
excellent retention or a capped ARPU, and nothing here distinguishes them.

---

## 7. Failure modes

**OBSERVATION.** Seven failure classes, each with at least one product-level or code-level
witness. **Six of the seven are persistence failures, not layout failures.**

**1. Silent state loss.** 🔴 The sharpest instance is internal. UCT's `parseLayout` catches a
parse failure, returns `null`, and the board renders `DEFAULT_LAYOUT` — an **empty workspace**,
with no error, no toast, and no distinction from a genuinely new user. Because the board then
autosaves, the empty state overwrites the corrupt-but-possibly-recoverable original within 500 ms
of the first grid event [D-11 §2.2]. Bloomberg's `MNRS` (§5c) is the productised response to the
same class. Benzinga Pro's browser-cache layouts [B-BZ §G] are a second instance: clear the
cache, lose the desk.

**2. Layout drift — the write that is not atomic.** A "layout" in `/charts` is conceptually one
thing and physically **eight**: `applyTemplate` writes `charts_workspace_layout`,
`watchlist_settings`, `theme_tracker_settings`, `fundamentals_settings`,
`breadth_widget_settings`, conditionally `chart_settings` and `charts_vol_pane_pct`, plus
`charts_active_template` — **and a localStorage key** (`uct.watchlist.cols`), in sequence, with no
transaction. A failure partway through leaves a board whose *arrangement* is the new template and
whose *look* is the old one, with nothing detecting it [D-11 §2.3]. The in-code comment records
the bug that forced watchlist columns into the bundle: *"added columns vanished after switching
layouts and back."*

**3. A hydration race that destroys the board.** react-grid-layout fires `onLayoutChange` on first
mount, which would persist the pre-hydration DEFAULT (empty) over the user's real board. UCT's
`hydratedRef` gate exists solely to prevent this, is checked on every save path, and is
**reproduced identically** in `useMultiChartState.js`, where the comment names it "the V1
hydration-clobber race" [D-11 §2.2]. Any TERMINAL-NEXT board needs this gate on day one, and it
is a property of *every* library in §8 that emits a change event on mount.

**4. Breakpoint remapping that overwrites the only saved layout.** `/charts` uses **24 columns at
every breakpoint on purpose**. The in-file comment records why: a narrowing ladder made RGL
re-map x/w to the narrower grid, fire `onLayoutChange` with the squeezed coordinates, and the
single persisted layout got overwritten **irreversibly** [D-06 §1.2, D-11 §2.1]. This is the
generic form of the bug: *any* layout library that reflows on resize will try to persist the
reflow.

**5. Cognitive load and discoverability decay.** Bloomberg's three mechanisms (§4 — popularity
ranking, preview-before-commit, tabs as a density lever) are all answers to this, and the Custom
Function Window's stated purpose is literally *"to reduce the number of components on the
screen"* [T2]. Benzinga's four-tool cap is the blunt version. The failure is silent: a member
keeps using the three widgets they found first, and nothing reports it.

**6. 🔴 One panel takes down the board.** There is **no per-widget error boundary** on `/charts` —
`grep ErrorBoundary` returns nothing in `ChartsWorkspace.jsx` or `WidgetHost.jsx`, and the nearest
boundary is the app-level `RouteErrorBoundary` [D-06 §1.7]. A terminal's core promise is that
panels are independent; without a boundary that promise is false at the render layer. Sub-case
worth naming: **a widget that throws on every mount currently cannot be closed**, because its
header is inside the subtree that fails.

**7. Unversioned schema.** `charts_workspace_layout` carries no version field; its two migrations
are **shape-sniffed** (`cols !== 24`; `maxBottom <= FIXED_ROWS/2`). The height heuristic will
misfire on any *legitimate* future layout whose widgets all sit in the top half of the board
[D-11 §2.2, D-06 §9.4]. ⭐ **This is not a UCT-specific defect — it is the category default.**
Every library in §8 that documents persistence (dockview, FlexLayout, rc-dock, golden-layout,
react-mosaic, Lumino) hands the application an opaque serialized object and **none of them
documents a schema-version field or a migration story**; react-mosaic is the only one that ships
an automatic conversion, and only for its own v6→v7 tree change. Versioning is the application's
job in every case.

**INTERPRETATION.** **The hard part of a workspace is not the grid, it is the document.** Every
product and every library in this survey has a working grid or dock. They differ on whether the
saved thing survives a bad parse, a concurrent write, a resize, a template apply and a device
change.

**RELEVANCE TO UCT.** D-11 §6 records that this repo has already shipped persisted-schema changes
**four different ways**, all live: read-fallback shim with a renamed key (Calendar); version in
the key in both stores (Breadth); versioned document + highwatermark LWW sync (`tracings_doc`);
and read-time versioned migration with tombstones (`chart_settings`). Everything a versioned
workspace document needs exists in-repo — **and none of it is applied to the layout.**

**CONFIDENCE.** 🟢 on failures 1–4, 6, 7 (read from UCT source by D-06/D-11, with in-code comments
naming the incident each guard exists for; and on the library half, checked against each library's
own persistence documentation). 🟡 on failure 5 as a *measured* problem — inferred from three
vendors independently building mitigations, not from a study. 🔴 on practitioner testimony about
what breaks in Launchpad specifically: B-BBG-02 §9 could not reach it (Wall Street Oasis is
paywalled and its public surface is AI-generated content containing a verified factual error).

**RECOMMENDATION (hypothesis).** *Design the workspace document first and the grid second.* The
in-repo seeds, in the order a build needs them: `chartDefaults.js::mergeChartSettings` +
`instanceShape.js` (version, read-time fold, tombstones, union-by-id) for the shape;
`usePreferences.setPrefMerged` + `_writeChains` for concurrent writers;
`ChartsWorkspace.jsx::scheduleSave` for the debounce + hydration gate + unmount flush;
`charts_layout_service.py` / `user_definitions.py` for the server store; `useTracingsSync.js` for
cross-device [D-11 §7.6]. **Anti-pattern:** shipping a new board on `user_preferences` — the repo
already wrote down why (*"`user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE"*, in
`user_definitions.py`'s own header) and acted on it for formulas only.

**OPEN QUESTION.** Has any member actually reported a workspace that came back empty? A single
support-ticket search would move failure class 1 from "a code path that exists" to a confirmed
incident class, or retire it.

---

# PART II — LIBRARIES AND INTEROP STANDARDS

## 8. Layout and docking libraries

**OBSERVATION.** Seven libraries, three distinct layout *models*, and one pattern that holds
across all of them: **the library owns the geometry, the application owns the schema.**

### 8.1 Comparison table

| Library | License | Latest version | Model | Persistence API | Popout / float | Tabs | Accessibility | Runtime deps | Maintenance signal |
|---|---|---|---|---|---|---|---|---|---|
| **react-grid-layout** | MIT | **2.2.4** (v1 line also live at **1.5.4**) | **Free-placement grid**: absolute `x/y/w/h` in column units, responsive breakpoints | Plain array of `{i,x,y,w,h}` + `minW/maxW/minH/maxH/static/isDraggable/isResizable/isBounded/resizeHandles`. **No serializer** — you own the JSON | ❌ neither | ❌ | ❌ **No accessibility statement in the README** | 6 (`clsx`, `prop-types`, `fast-equals`, `react-draggable`, `react-resizable`, `resize-observer-polyfill`) | 22.4k ★, 19 open issues; **v2.0.0 was a complete TypeScript + hooks rewrite requiring React 18+** |
| **dockview** | **MIT, except `dockview-enterprise` which is "proprietary and governed by a commercial licence agreement"** | **8.2.0** | **Dock**: groups, splitviews, tabs, floating groups, popout windows | "Serialization / deserialization with full layout management"; docs carry a dedicated **State** section | ✅ **both** — floating groups AND popout windows, incl. "floating & popout windows as nested (multi-group) layouts" | ✅ first-class | ⭐ **Dedicated Accessibility and Keyboard Navigation doc sections**; release notes cite "WAI-ARIA roles and states", keyboard navigation, "spatial keyboard group focus", an announcer, and an "i18n message catalog for accessibility strings" | **Zero** (core); peers React 16.8–19, Vue ≥3.4, Angular ≥21.0.6 | 3.4k ★, 3,442 commits; packages `dockview`, `dockview-react`, `dockview-vue`, `dockview-angular`, `dockview-enterprise`; "540k+ monthly downloads" |
| **FlexLayout** (`flexlayout-react`) | MIT (Caplin) | **0.10.8** | **Dock**: rows → tabsets → tabs, plus **borders** on all four edges | ⭐ `Model.fromJson(jsonObject)` / `model.toJson()`; JSON has four top-level elements: **`global`, `layout`, `borders`, `subLayouts`** | ✅ floating panels and popout into separate browser windows | ✅ first-class, plus tab **pinning**, Chrome-style coloured **pill grouping**, overflow menus, maximize/minimize | ⭐ **The strongest documented story**: ARIA roles (`tabs`, `tablist`, `tabpanel`, `separator`), keyboard navigation with configurable shortcuts, visible focus styling, WAI-ARIA menu patterns | **Zero** ("FlexLayout's only dependency is React"); peers React ^18 \|\| ^19 | 1.3k ★, 751 commits, corporate maintainer |
| **golden-layout** | MIT | **2.6.0** | **Dock**: rows/columns/stacks, native popup windows | `LayoutConfig` / `ResolvedLayoutConfig`; "Load and save layouts" | ✅ native popup windows | ✅ | ❌ none documented | — | 6.7k ★, **96 open issues**; ⚠️ **its own docs say "the NPM modules have not been updated in a long time, so building from source is currently recommended"** |
| **rc-dock** | **Apache-2.0** | ⚠️ **4.0.0-alpha.2 — a pre-release is the current published version** | **Dock**: panels, tabs, float, maximize | `saveLayout()` → `SavedLayout`; `loadLayout(savedLayout)`; controlled (`layout`) or uncontrolled (`defaultLayout`) | ✅ floating panels can open as separate browser windows | ✅ | ❌ none documented | 6 (`lodash`, `classnames`, `rc-new-window`, `@rc-component/{menu,tabs,dropdown}`) | 811 ★ |
| **react-mosaic** (`react-mosaic-component`) | **Apache-2.0** | **7.0.0** | ⭐ **Tree**: n-ary since v7 — *"A single split can hold any number of children, not just two"*; legacy v6 **binary** trees auto-converted | The tree IS the state (`MosaicNode`); controlled or uncontrolled | ❌ not mentioned | ✅ *"Tab containers are a node type, not a bolted-on convention"* | ❌ none documented | **11**, incl. the whole `react-dnd` stack (`react-dnd`, `dnd-core`, three backends, `rdndmb-html5-to-touch`), `lodash-es`, `immutability-helper`, `uuid` | 4.8k ★, 264 commits; React 16–19 |
| **Lumino** (ex-**PhosphorJS**) | BSD (Jupyter) | — | **Dock**: `DockPanel` + a full widget/layout toolkit | `DockPanel` save/restore layout | ✅ (JupyterLab uses it) | ✅ | ❌ none documented on the repo page | Framework-agnostic — **not React**; examples are Vue, Vue3, Web Components, plain JS | 762 ★, **4,028 commits**; the layout engine behind JupyterLab; *"Lumino was formerly known as PhosphorJS"* |

### 8.2 What the table says

**(a) Three models, not seven libraries.** *Free-placement grid* (react-grid-layout) —
overlappable, absolute coordinates, no containment hierarchy. *Dock* (dockview, FlexLayout,
golden-layout, rc-dock, Lumino) — a containment tree of rows/columns/stacks with tabs as the
leaf container. *Tree* (react-mosaic) — the same tree idea exposed as the public state object
rather than hidden behind an API. **The model decides the schema**, and therefore decides how
expensive a later change is. A grid's state is a flat array; a dock's state is a nested tree.
Migrating a saved grid into a dock is not a schema bump, it is a re-authoring.

**(b) Only two libraries document accessibility at all, and they are the two a terminal should
short-list on that basis.** FlexLayout enumerates ARIA roles, keyboard navigation with
configurable shortcuts and WAI-ARIA menu patterns; dockview ships dedicated Accessibility and
Keyboard Navigation documentation sections and its release notes cite WAI-ARIA roles/states,
spatial keyboard group focus, an announcer, and an i18n catalog for a11y strings. The other five
document none. ⭐ For UCT this is load-bearing beyond compliance: D-06 §7 records that the app has
`--focus-ring` and 61 stylesheets using `focus-visible` but that its **one measured contrast
datum** was 20/20 text nodes at contrast 1.00 in the light theme while 13,629 tests were green —
i.e. this codebase has already learned that a11y claims from source reading are worthless.

**(c) Dependency weight varies by an order of magnitude.** dockview and FlexLayout ship **zero**
runtime dependencies; react-mosaic ships **eleven**, including an entire drag-and-drop framework
and three of its backends. For a product whose bundle already carries **four charting libraries**
[D-06 §4] and where an eager static import of indicator maths cost 42 kB raw / 13.9 kB gzip on
the entry chunk [D-11 §6.4], eleven transitive dependencies for a layout manager is a real cost.

**(d) Two maintenance flags.** golden-layout's **own documentation** says "the NPM modules have
not been updated in a long time, so building from source is currently recommended" — a maintainer
telling you the published artefact is not the product. And rc-dock's currently published version
is `4.0.0-alpha.2`, a **pre-release**. Neither is disqualifying, both are facts a decision needs.

**(e) None of the seven documents a schema version field or a migration story.** react-mosaic is
the sole partial exception, and only for its own internal v6→v7 binary→n-ary change ("zero-config
migration from v6"). **Versioning the saved workspace is the application's job in every case** —
which is exactly failure class 7 in §7, and it means adopting a dock library does *not* buy UCT
out of the problem D-11 identifies.

### 8.3 What this means for UCT specifically

UCT is on **react-grid-layout ^1.5.3** [D-06 §10, `app/package.json`]; the current line is
**2.2.4**. The v2 breaking changes that touch UCT directly, from the library's own release notes:
**React 18+ required**; **the `width` prop became mandatory** (previously auto-measured); **`onDragStart`
now fires after 3 px of movement rather than on mousedown**; callback parameters became immutable;
the UMD bundle was removed. UCT already computes width from a `ResizeObserver` [D-06 §1.2], so the
mandatory-width change is nearly free — but the drag-start semantics change lands on a board that
has replaced RGL's own resize with custom `onPointerDown` handles, uses `allowOverlap`, and
re-tiles through its own `repackAroundMoved` on drop.

⭐ **The more important framing is that UCT has already built, on top of RGL, most of what a dock
library would provide natively** — slot tabs (`widgetTabs.js`), floating panels
(`FloatingWidgetPanel`), popout windows (`PopoutWindow`) and seam-dragging in merged mode
[D-06 §1.5]. So the build-vs-adopt question is not "grid or dock"; it is **"keep a bespoke dock
built on a grid, or replace it with a library that has these natively and re-derive the
properties the bespoke stack has."** The single property most at risk is §2(a): UCT's popout is a
**React portal into `window.open`**, which is why every popped window shares one SSE pool. A dock
library's built-in popout is a feature; whether it preserves the opener's React tree — and
therefore the shared stream pool — is not established by any source I reached.

**INTERPRETATION.** For a small desk the decision is unlikely to be won on features. Every
library here can draw the board. It is won on (i) whether tabs/dock/popout must be native or can
stay bespoke, (ii) accessibility posture, (iii) dependency weight, and (iv) how much of UCT's
existing `charts_workspace_layout` corpus has to be re-authored versus migrated.

**RELEVANCE TO UCT.** C5-03 owns the decision. This section supplies the axes and the facts; §10
lays them out against UCT's constraints without choosing.

**CONFIDENCE.** 🟢 on licenses, versions, dependency lists, peer ranges and persistence API names
(read from vendor repos, official docs and the npm registry directly). 🟢 on the accessibility
*documentation* differential (I read what each project documents; I did not test any library).
🟡 on **release dates** — they came through a summarising extractor which produced at least one
internally inconsistent relative date ("approximately 3 months ago" for a 2024-09-26 release when
the date of this report is 2026-09-02), so absolute dates are reported where given and
**maintenance recency should be re-checked before a decision**. 🔴 on runtime performance with
many panels: **NOT MEASURED for any library.** react-grid-layout is the only one that publishes
guidance at all — "The grid compares children by reference. Memoize them for better performance",
plus fast compactors for 200+ item layouts claiming a 45× speedup — and that is a vendor claim,
not a benchmark I ran.

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT keeps a viewport-locked, free-placement board,
staying on react-grid-layout and upgrading v1 → v2 is a smaller change than adopting a dock
library, because the bespoke tab/float/popout stack does not have to be rebuilt.* Converse
hypothesis, to be tested against the same requirements: *if tabs, docking and popout must become
native and accessible, dockview and FlexLayout are the only two candidates whose accessibility is
documented, and FlexLayout's `Model.toJson()/fromJson()` is the closest thing in this set to a
document-shaped state model.* **Anti-pattern:** choosing a library on star count — the two with
the best documented accessibility are the third and fifth most-starred in this table.

**OPEN QUESTION (load-bearing for C5-03).** Does dockview's or FlexLayout's popout window
preserve the opener's React tree — i.e. would UCT keep its one-SSE-pool-per-browser property, or
would each popped window become an independent React root with its own streams? **NOT DETERMINED.**
This is answerable in an afternoon with a spike and is worth more than any further reading.

---

## 9. FDC3 as a linked-context primitive, and the desktop containers

**OBSERVATION.** FDC3 is the only formal, vendor-neutral specification of the thing UCT calls a
colour group — and its channel model is strictly richer than UCT's on three axes.

**EVIDENCE.**
- **Governance and status.** FDC3 is "an open standard for interoperability between applications
  on the financial desktop", "hosted within, and governed by the policies of, the Fintech Open
  Source Foundation (FINOS)". Versions 1.0, 1.1, 1.2, 2.0, 2.1 and the current **2.2**; 2.3 and a
  3.0 with web support and identity sharing are referenced as upcoming. The standard has **five
  parts**: API, **Intents**, **Context Data**, **App Directory**, and **Agent Bridging**.
  [T1, fdc3.finos.org — verified]
- **Named adopters.** FINOS's own page names **BlackRock, NatWest, Symphony, RBC, Microsoft and
  Morgan Stanley** as integration contributors, references **JP Morgan Chase**, and states that
  **LSEG** "migrated their Workspace apps to FDC3 from their internal messaging framework".
  [T3, finos.org/fdc3 — verified. Note the corroboration: the LSEG dossier independently records
  HERE Dock (formerly OpenFin) as Workspace's window manager.]
- **Three channel kinds.** **User Channels** (called "system channels" until FDC3 2.0)
  "facilitate the creation of user-controlled context links between applications (often via the
  selection of a color channel)" and "are created and named by the desktop agent", reached via
  `getUserChannels()` / `joinUserChannel()`. **App Channels** are developer-created, named, "not
  discoverable", obtained via `getOrCreateChannel()`. **Private Channels** support "private
  communication between two parties" with auto-generated identities, retrievable only through
  raised intents. [T1, verified]
- **Eight default user channels, colour-coded with numeric glyphs 1–8:** red, orange, yellow,
  green, cyan, blue, magenta, purple. [T1, verified]
- **The colour is data.** `DisplayMetadata` carries `name` ("A user-readable name for this
  channel, e.g: `\"Red\"`"), `color` ("The color that should be associated within this channel
  when displaying this channel in a UI, e.g: `#FF0000`. May be any color value supported by CSS,
  e.g. name, hex, rgba, etc."), and `glyph` ("A URL of an image that can be used to display this
  channel"). The spec frames it as: "A desktop agent (typically for _system_ channels) may want
  to provide additional information about how a channel can be represented in a UI. A common use
  case is for color linking." [T1, verified]
- **Membership is exclusive.** `joinUserChannel()` is an "OPTIONAL function that joins the app to
  the specified User channel", and **"An app can only be joined to one channel at a time."**
  `getCurrentChannel()` returns the joined channel or null; `leaveCurrentChannel()` exits.
  [T1, verified]
- **Context replay on join — with a documented asymmetry.** At `DesktopAgent` scope: "When an app
  joins a User channel, or adds a context listener when already joined to a channel, it will
  automatically receive the current context for that channel", and "If the channel already
  contains context that matches the type of the context listener, then it will be called
  immediately." But `Channel.addContextListener()` states the opposite for channel-scoped
  listeners: "If, when this function is called, the channel already contains context that would
  be passed to the listener it is NOT called or passed this context automatically."
  `Channel.getCurrentContext()` is the explicit read. [T1, both reference pages — verified;
  ⚠️ read through a summarising extractor, so the exact boundary between the two behaviours
  should be re-read before it is implemented against.]
- **Broadcast scoping.** `broadcast()` at `DesktopAgent` scope "will push the context to whatever
  User Channel the app is joined to"; if not joined, the call has no effect. `Channel.broadcast()`
  "can be used without first joining the channel, allowing applications to broadcast on both App
  Channels and User Channels that they aren't a member of." [T1, verified]

**The containers that implement it.**
- **HERE (formerly OpenFin).** `developers.openfin.co/of-docs/docs/overview` **301-redirects to
  `resources.here.io/docs/core/`** — the redirect is itself the evidence of the rename, and the
  LSEG dossier independently records "HERE Core desktop (formerly OpenFin)". HERE Core is
  described as "a web-technology operating environment"; a **Snap SDK** lets users "snap together
  all kinds of windows"; the Platform API supports "capturing and restoring snapshots of the
  state"; and "**The FDC3 API enables applications that comply with the FDC3 standard to
  seamlessly work in the HERE Core environment.**" Named products in the docs reached: HERE Core,
  HERE Enterprise Browser, HERE Core UI Components. [T1, verified — no licensing information was
  present in the reached pages]
- **interop.io (Glue42 / Finsemble lineage).** Products **io.Connect**, **io.Manager**,
  **io.Insights**, **io.Bridge**; Glue42 and Finsemble both appear as developer resources under
  one roof; FDC3 support is explicit including an "FDC3 Developer Sandbox"; the commercial model
  visible on the homepage is a "Free 30-day trial" with no published pricing. [T3, verified]
- **io.Connect Workspaces** are the most explicitly documented workspace object model in this
  survey: a **Frame** is "a web app that comes with io.Connect Desktop" that "can hold multiple
  Workspaces **as tabs**"; a **Workspace** contains "one or more app instances arranged in
  columns, rows or groups of tabbed windows"; a **Group** is a tabbed window container. Workspace
  Layouts are saved as **JSON blueprints** containing "the name of the Workspace, the structure of
  its children… the names of each app present in the Workspace, **context**, and other settings",
  saved from a UI Save button and restored to "recreate arrangements and **resume context**".
  Admin **lock settings** can restrict operations. [T1, verified]

**INTERPRETATION.** Four transferable ideas, and one warning.

**(a) The channel carries a typed context, not a bare symbol.** This is the formal version of
Koyfin's three selection methods and Bloomberg's Security-vs-Monitor group kinds. FDC3 gets
polymorphism *by construction* because the payload is a context object with a type, so a consumer
subscribes to the types it understands (`addContextListener` is type-filtered) and simply does not
fire for the rest. **That is a cleaner answer to Bloomberg's "only a News Panel can consume a
Monitor Group" than a hardcoded restriction is** — the same restriction falls out of type
filtering.

**(b) The channel *retains* a current context, and joining replays it.** UCT gets this
incidentally (a widget reads `groupSyms[color]` on mount), but has no name for it and no notion of
context type. Named, it becomes the answer to "what does a panel show the instant it is dropped
onto a board".

**(c) The colour is `DisplayMetadata`, not a hardcoded letter — so eight is a convention, not a
ceiling.** UCT's four is a ceiling, and it already bites (§3).

**(d) Membership is one channel per app, and the broadcast/subscribe scopes are separate.** FDC3's
unit is the *application window*; UCT's is the *widget*, which is finer-grained and strictly more
expressive. Worth recording as a place UCT's model is ahead, not behind.

**⚠️ THE WARNING, and it is the important part for a small desk.** There are two entirely
different things called "adopting FDC3":
1. **Adopting the FDC3 *vocabulary and shapes*** — channel ids, `DisplayMetadata {name, color,
   glyph}`, typed context objects, `broadcast` / `addContextListener` / `getCurrentContext`,
   join-replays-current-context. This costs **nothing but naming discipline**, is entirely
   internal, and buys a design that is already reviewed by a standards body and a migration path
   if UCT ever needs real interop.
2. **Adopting an FDC3 *desktop agent*** — HERE Core or io.Connect. That is an enterprise desktop
   container with a sales motion (30-day trial, no published pricing), aimed at banks running
   dozens of third-party vendor apps side by side. **UCT is one application.** The desk's
   multi-monitor need is already met by a `window.open` portal at zero backend cost (§2a). Nothing
   in this evidence supports a container for a small desk.

**RELEVANCE TO UCT.** Path 1 is the transferable one: it gives §3's recommendation a specified
shape to copy rather than invent, and it is compatible with every library in §8 because it is a
data model, not a runtime.

**CONFIDENCE.** 🟢 on the FDC3 channel model, the eight colours, `DisplayMetadata`, the
one-channel rule and the broadcast scopes (fetched from the FDC3 2.2 spec and reference pages
directly). 🟢 on the named adopters (FINOS's own page). 🟢 on io.Connect's Workspace object model
(interop.io's own documentation). 🟡 on the exact context-replay boundary between DesktopAgent-
and Channel-scoped listeners — the two reference pages describe it differently and I read both
through an extractor. 🟡 on the OpenFin→HERE rename: the 301 redirect plus the LSEG dossier's
independent statement are strong, but no HERE page I reached states the rename outright.
🔴 on container pricing for HERE and io.Connect — **not published**, and the preamble forbids the
sign-up flows that would reveal it.

**RECOMMENDATION (hypothesis).** *Adopt FDC3's channel vocabulary and payload shape without
adopting an FDC3 container.* Concretely: name UCT's groups as channels with `DisplayMetadata`,
give the payload a `type`, make consumers type-filtered, and specify replay-on-join. **Test it on
one channel and one list-consuming widget before generalising.** **Anti-pattern:** evaluating a
desktop container for a one-application product — that is the wrong problem, and its cost is a
vendor relationship, not a dependency.

**OPEN QUESTION.** FDC3's Context Data part defines standard context types (the standard's third
part). **Which standard context types exist and would any of them fit UCT's payloads** (a symbol,
a symbol set, a watchlist reference, a timeframe, a date range)? I verified that Context Data is
one of the five parts but did not fetch the context-type catalogue — that is a 15-minute follow-up
and it decides whether UCT's channel payloads can be spec-shaped or must be bespoke.

---

## 10. Evidence assembled for the C5-03 comparison (no decision made here)

The axes on which the choice actually turns, and what this survey established on each.

| Axis | What the evidence says | Where |
|---|---|---|
| **Does a dock library buy schema safety?** | **No.** None of the seven documents a version field or a migration story. Versioning is the application's job in every case. UCT's own repo already ships four working versioning idioms, none applied to the layout | §7.7, §8.2(e), D-11 §6 |
| **Does a dock library buy tabs/float/popout UCT lacks?** | **Mostly no** — UCT already has all three, bespoke, on top of react-grid-layout. The question is whether to keep the bespoke stack or re-derive its properties on a library | §2, §8.3, D-06 §1.5 |
| **The property most at risk in a migration** | UCT's popout is a **React portal into `window.open`** ⇒ one SSE pool browser-wide. Whether dockview/FlexLayout popouts preserve the opener's React tree is **NOT DETERMINED** | §2(a), §8.3 OPEN QUESTION |
| **Accessibility** | Only **dockview** and **FlexLayout** document it. The other five document none. UCT has already been burned by source-read a11y claims (20/20 nodes at contrast 1.00 while 13,629 tests were green) | §8.2(b), D-06 §7 |
| **Dependency weight** | dockview and FlexLayout: **zero** runtime deps. react-mosaic: **eleven**, incl. a whole DnD framework. UCT already ships four charting libraries | §8.1, D-06 §4 |
| **Maintenance flags** | golden-layout's own docs: "the NPM modules have not been updated in a long time". rc-dock's published version is a **pre-release** (`4.0.0-alpha.2`) | §8.1 |
| **License** | MIT: react-grid-layout, dockview (core), FlexLayout, golden-layout. Apache-2.0: rc-dock, react-mosaic. BSD: Lumino. ⚠️ dockview's `dockview-enterprise` is proprietary/commercial | §8.1 |
| **Model change cost** | Grid state is a flat array; dock state is a nested tree. Migrating UCT's existing `charts_workspace_layout` corpus grid→dock is a **re-authoring**, not a schema bump | §8.2(a) |
| **Upgrade-in-place cost** | RGL v1.5.3 → v2.x: React 18+, mandatory `width` (UCT already measures it), `onDragStart` after 3 px, immutable callback params, no UMD | §8.3 |
| **Linking model to aim at** | FDC3's channel — typed context, `DisplayMetadata` colour, replay-on-join, type-filtered consumers. Adoptable as **vocabulary only**, no container | §3, §9 |
| **Board-count / density levers observed** | Benzinga 4-tool cap; Bloomberg tabs-in-one-window; Bloomberg View→Page hierarchy; UCT's implicit 20-row geometric bound | §1, §2(b) |
| **First-run** | Bloomberg Sample Views by asset class, editable, doubling as the teaching artefact; UCT starts empty | §4, D-11 §2.2 |
| **Do users customize?** | 🔴 **Unmeasured externally, and unmeasurable from public sources.** Answerable only from UCT's own `user_preferences` | §6 |

---

## GAPS (budget not reached / evidence unreachable)

1. **🔴 No customization-adoption telemetry from any vendor, and no third-party study.** §6 rests
   entirely on indirect commercial signals. A Bing query returned no relevant published
   measurement. **The only route that closes this is UCT's own preference table — and the owner
   can supply it.**
2. **🔴 No performance measurement of any library with many panels.** Only react-grid-layout
   publishes guidance at all, and that is a vendor claim. A spike mounting N panels of UCT's real
   widgets in each candidate is the route, and it is the same spike that answers §8's popout
   question.
3. **🔴 FactSet's workspace/customization model is NOT DETERMINED** — no §G exists in the corpus
   reached and the contract's budget did not extend to re-researching the product.
4. **🟡 Library release DATES are extractor-derived** and at least one relative date was
   internally inconsistent. Versions, licenses, dependency lists and API names are 🟢 (all from
   the npm registry and vendor repos); recency should be re-checked before a decision.
5. **Bloomberg's current (2026) Launchpad UI is unverified** — mechanism comes from © 2012 and
   © 2015 guides; Bloomberg's 2023–2025 coverage is video-only. Inherited ceiling from B-BBG-02.
6. **thinkorswim Flexible Grid** rests on a Google SERP snippet of a page that 404s on direct
   fetch. Treat every Flexible Grid statement as 🟡.
7. **Multi-monitor NOT DETERMINED for Koyfin, thinkorswim, Unusual Whales and LSEG.**
8. **FDC3 Context Data type catalogue not fetched** (§9 OPEN QUESTION) — a short follow-up that
   decides whether UCT's channel payloads can be spec-shaped.
9. **dockview's Accessibility / Keyboard Navigation / State doc pages could not be fetched
   directly** — every URL guess 404'd and the docs index did not expose the sidebar hrefs to the
   fetcher. Their *existence* is verified (named in the sidebar of a page that did load) and
   their *content* is inferred from release notes. A browser session would close it.
10. **Container pricing for HERE and interop.io is not published**, and the preamble forbids the
    trial sign-ups that would reveal it.
11. **Search channel used:** WebFetch on known URLs throughout, plus **one** Bing fallback query
    (§6, negative result). `WebSearch` was not attempted — the preamble records the session cap as
    exhausted. No browser tab was opened. Queries not run for want of a search channel: practitioner
    accounts of workspace abandonment; any "how many boards does a real user keep" datum.
12. **Not attempted, owned by sibling roles:** command grammars (C4-01), streaming/caching
    (C7-01), alerting inside monitors, screening mechanics, chat/sharing network effects.

---

## SOURCES

### Primary — libraries (all fetched 2026-09-02, T1)

1. react-grid-layout repository — https://github.com/react-grid-layout/react-grid-layout (MIT, 22.4k ★, 19 open issues, v2 TypeScript rewrite, layout-item keys, the "compares children by reference" performance note, no accessibility statement)
2. react-grid-layout releases — https://github.com/react-grid-layout/react-grid-layout/releases (v2.2.4, v2.2.3, v2.2.2, v2.2.1, v2.0.0 breaking changes, 1.5.4 / 1.5.3)
3. react-grid-layout on the npm registry — https://registry.npmjs.org/react-grid-layout/latest (version 2.2.4, MIT, six dependencies, peers react/react-dom ≥16.3.0)
4. dockview product site — https://dockview.dev/ (feature list, framework packages, "Zero dependencies", 3.3k ★, 540k+ monthly downloads)
5. dockview repository — https://github.com/mathuo/dockview (dual licence quote, 3.4k ★, 3,442 commits, peer ranges, package list)
6. dockview releases — https://github.com/mathuo/dockview/releases (v8.2.0 … v7.0.3; a11y additions in v7.0.2; serialization fixes; "layout hot paths")
7. dockview on the npm registry — https://registry.npmjs.org/dockview/latest (8.2.0, MIT, depends only on `dockview-core`)
8. dockview docs — https://dockview.dev/docs/core/panels/register (panel registration; the sidebar naming State, Theming, Events, **Accessibility** and **Keyboard Navigation**)
9. dockview docs index — https://dockview.dev/docs/ (sidebar hrefs not exposed to the fetcher — recorded as GAP 9)
10. FlexLayout repository — https://github.com/caplin/FlexLayout (MIT, Caplin, 1.3k ★, 751 commits, `Model.fromJson`/`model.toJson`, the four-element JSON, ARIA/keyboard specifics)
11. flexlayout-react on the npm registry — https://registry.npmjs.org/flexlayout-react/latest (0.10.8, MIT, no runtime deps, peers React ^18 || ^19)
12. golden-layout repository — https://github.com/golden-layout/golden-layout (MIT, 6.7k ★, 96 open issues, feature list incl. native popup windows and virtual components)
13. golden-layout documentation — https://golden-layout.github.io/golden-layout/ (the virtual-components rationale quote; the v2 TypeScript port note; ⚠️ "the NPM modules have not been updated in a long time, so building from source is currently recommended")
14. golden-layout releases — https://github.com/golden-layout/golden-layout/releases (v2.6.0 2024-09-26; v2.5.0; v2.4.0; v2.3.0; v2.2.1)
15. golden-layout on the npm registry — https://registry.npmjs.org/golden-layout/latest (2.6.0, MIT)
16. rc-dock repository — https://github.com/ticlo/rc-dock (Apache-2.0, 811 ★, `saveLayout()` / `loadLayout()`, float-as-browser-window, controlled/uncontrolled)
17. rc-dock on the npm registry — https://registry.npmjs.org/rc-dock/latest (**4.0.0-alpha.2**, Apache-2.0, six dependencies, peers React ≥17)
18. react-mosaic repository — https://github.com/nomcopter/react-mosaic (Apache-2.0, 4.8k ★, React 16–19, the n-ary tree quote, the tab-container quote, v6→v7 auto-conversion)
19. react-mosaic-component on the npm registry — https://registry.npmjs.org/react-mosaic-component/latest (7.0.0, Apache-2.0, eleven dependencies, peers react 16–19)
20. Lumino repository — https://github.com/jupyterlab/lumino (BSD, 762 ★, 4,028 commits, "Lumino was formerly known as PhosphorJS", package roster, framework-agnostic)

### Primary — interop standards and containers (all fetched 2026-09-02, T1/T3)

21. FDC3 API specification — https://fdc3.finos.org/docs/api/spec (FINOS governance, v2.2, User/App/Private channels, the eight colour-coded user channels, join-replays-current-context)
22. FDC3 `Channel` reference — https://fdc3.finos.org/docs/api/ref/Channel (type values, `id`, `displayMetadata`, `broadcast` without joining, `getCurrentContext`, the channel-scoped `addContextListener` non-replay note)
23. FDC3 `DesktopAgent` reference — https://fdc3.finos.org/docs/api/ref/DesktopAgent (`getUserChannels`, `joinUserChannel` — **"An app can only be joined to one channel at a time"**, `getOrCreateChannel`, `getCurrentChannel`, `leaveCurrentChannel`, broadcast scoping)
24. FDC3 `DisplayMetadata` reference — https://fdc3.finos.org/docs/api/ref/Metadata (`name`, `color`, `glyph` definitions verbatim; the "common use case is for color linking" framing)
25. FDC3 introduction — https://fdc3.finos.org/docs/fdc3-intro (FINOS hosting/governance quote, version history, the five parts of the standard)
26. FINOS FDC3 project page — https://www.finos.org/fdc3 (named adopters: BlackRock, NatWest, Symphony, RBC, Microsoft, Morgan Stanley, JP Morgan Chase; LSEG's migration of Workspace apps to FDC3)
27. HERE Core documentation — https://resources.here.io/docs/core/ (reached via a **301 from `developers.openfin.co/of-docs/docs/overview`**; Snap SDK, Platform API snapshots, the FDC3 support quote, product names)
28. interop.io — https://interop.io/ (io.Connect / io.Manager / io.Insights / io.Bridge; Glue42 and Finsemble as developer resources; FDC3 support and Developer Sandbox; 30-day trial) — T3
29. io.Connect Workspaces documentation — https://docs.interop.io/desktop/capabilities/windows/workspaces/overview/index.html (Frame / Workspace / Group definitions, JSON blueprint contents, save-and-restore-with-context, admin lock settings)

### Secondary

30. Bing search, `"dashboard" customization adoption "percent of users" telemetry product analytics widgets` — https://www.bing.com/search?q=... — **negative result**, recorded as evidence about reachability (§6, GAP 1), not about behaviour.

### Internal sibling reports (read 2026-09-02, under `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`)

31. `07-technical-architecture/current-ui-architecture.md` (D-06)
32. `01-existing-system/state-persistence-and-workspaces.md` (D-11)
33. `03-competitive-research/bloomberg/02-monitors-workspaces.md` (B-BBG-02) — itself sourced on Bloomberg's *Getting Started on Bloomberg Launchpad* user guides © 2012 (IIM Ahmedabad) and © 2015, an undated earlier edition (U. Delaware), Bloomberg Pro Tips / Terminal Essentials pages 2023-05-08 / 2024-10-10 / 2024-10-12 / 2025-08-19, and university library guides (NYIT, Wharton/Lippincott ×3, Holowczak, Cranfield, Scranton)
34. `03-competitive-research/koyfin/dossier.md` §G
35. `03-competitive-research/tradingview/dossier.md` §G
36. `03-competitive-research/benzinga-pro/dossier.md` §G
37. `03-competitive-research/unusual-whales/dossier.md` §G
38. `03-competitive-research/lseg-workspace/dossier.md` §C.3, §G
39. `03-competitive-research/desk-tools/thinkorswim.md` §1–2

**Prompt-injection / instruction-shaped content observed:** none. No fetched page contained text
addressed to an AI agent or attempting to redirect this task. Two source-integrity findings are
worth recording. **(a) Inherited:** B-BBG-02 §9 records that the top-ranked public practitioner
pages for Bloomberg Launchpad are AI-generated and contain a verified factual error (`W` glossed
as "World Markets" when `W` is Bloomberg's Security Worksheet) — any Bloomberg claim sourced from
a forum page needs its human authorship checked, not just its domain. **(b) Observed here:** the
summarising extractor that reads fetched pages produced a **relative** date ("approximately 3
months ago") that is wrong against this report's date, from an absolute date on the page that was
right. Absolute dates from a page are usable; relative ones computed downstream are not.

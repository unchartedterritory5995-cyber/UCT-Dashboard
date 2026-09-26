---
id: B-BBG-02
title: Bloomberg Terminal — monitors and workspaces (Launchpad)
role: Bloomberg workflow slice — monitors, workspaces, Launchpad
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — Launchpad (BLP), monitor components, component groups, views/pages, worksheets (W), market-monitor pages (WEI/MOST/MOV/IMAP)
confidence: 🟡 overall
evidence_ceiling: No terminal access. The mechanism is documented in depth only by Bloomberg user guides dated 2012 and 2015; Bloomberg's 2023–2025 material on the same features is video-only (transcripts not retrieved), so the CURRENT UI is unverified. Practitioner accounts of Launchpad specifically are paywalled (Wall Street Oasis) and the top-ranked public substitute is an AI-generated post containing a factual error. Raising the ceiling requires a terminal session, a screenshot set, or one practitioner interview — none of which the owner can supply.
sources: 9 primary; 14 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-02 — Monitors and workspaces (Launchpad)

All URLs fetched **2026-09-02**. Tier labels follow the programme evidence ladder:
**T1** official documentation/help · **T2** official manuals & function guides · **T3** official
product pages · **T5** official training content · **T9** credible professional tutorials
(university library guides count here) · **T13** trade press · **T15/16** practitioner &
community commentary.

**Vintage warning, stated once and load-bearing for everything below.** The only sources that
document Launchpad's *mechanism* at the depth this contract asks for are Bloomberg's own
"Getting Started on Bloomberg Launchpad" user guides, © **2012** and © **2015**. Bloomberg's
current-era treatments of the same features (2023, 2024, 2025) are **video episodes with
near-empty article text** — the mnemonics survive in the page metadata, the mechanism does not.
So: mechanism = 2012/2015 **verified from primary documentation**; existence-and-naming in
2024/2025 = **verified**; the 2026 UI = **unverified**. Every confidence rating below carries
that ceiling whether or not it repeats it.

---

## 1. The two-layer model: a fixed four-panel terminal with a free-floating workspace on top

**OBSERVATION.** Bloomberg does not choose between "a page" and "a workspace" — it ships both,
in two physically separate layers, and gives the user explicit machinery to move work between
them. The terminal proper is **four fixed windows** rotated with a dedicated hardware key.
Launchpad is a *separate*, free-floating set of windows that lives on the desktop outside those
four panels and is summoned by its own command.

**EVIDENCE.**
- New York Institute of Technology, *Bloomberg Terminal — The Keys* libguide, last updated
  **2026-08-03** (T9): the Terminal has "four professional service windows"; "Press **&lt;PANEL&gt;**
  to rotate between the windows"; blue keys are the panel-navigation key class. Same page lists
  `BLP <GO>` as "Bloomberg LaunchPad – The Ultimate, customizable desktop display".
  https://libguides.nyit.edu/c.php?g=1054896&p=7662441 — *verified*.
- Bloomberg, *Getting Started on Bloomberg Launchpad* USER GUIDE, © 2012 (T2, official
  Bloomberg publication, hosted by IIM Ahmedabad library):
  "Launchpad… allows you to combine multiple functions and monitors on pages and in views, thus
  helping you organize and consolidate your desktop to fit your personal workflow."
  https://library.iima.ac.in/public/download/bloomberg/launchpad.pdf — *verified*.
- Same guide, **Adding Function Shortcuts**: a right-click on a monitor row opens *Edit Function
  Shortcuts*, where you bind a function + a "Tail" + a security count to a row (their worked
  example: `GPC`, tail `W`, 1 security = a weekly price-candle graph), then **"Select the Panel
  in which you want to launch your functions"**. A *Field*-level variant binds a function to a
  *column* (their example: bind `HP` to the Last Price column, "Enable Single Click").
  *verified*.
- Same guide, **`LLP`**: "Once you access the function on the Bloomberg panel, on the command
  line at the top of the function window enter LLP. The Launchpad component equivalent of the
  window appears." The older edition gives worked examples: `BARC LN <Equity> DES <GO> LLP <GO>`
  and `WEI <GO> LLP <GO>` (Bloomberg, *Bloomberg Launchpad Getting Started*, undated earlier
  edition, T2, hosted by U. Delaware Lerner College)
  https://my.lerner.udel.edu/wp-content/uploads/BB-Getting-Started-in-Launchpad.pdf — *verified*.
- Wharton / Lippincott Library, *Bloomberg Launchpad Part One: Basics*, 2013-03-11 (T9):
  Launchpad "is a tool used to personalize your Bloomberg desktop"; it layers over rather than
  replaces the standard panels.
  https://lippincottlibrary.wordpress.com/2013/03/11/bloomberg-launchpad-part-one/ — *reported*.

**INTERPRETATION.** The traffic between the layers is **two-way and named**, and that is the
whole design. `LLP` promotes a fixed page *into* the workspace as a live component. Function
shortcuts demote a workspace click *into* a fixed panel — you click a row in your monitor and a
full-fidelity function opens in Panel 2, which you chose in advance. Neither layer is a
degraded copy of the other: the panel gets the full function, the workspace gets a persistent,
linkable, resizable tile. The user never has to argue with the product about which mode they
are in, because the boundary is crossable in one keystroke in both directions.

Note the second-order consequence: because promotion is generic (`LLP` works on "almost any
function"), Bloomberg **did not have to build a widget for each function**. The widget set is a
by-product of the function set. That is a very different engineering posture from maintaining a
hand-curated widget registry.

**RELEVANCE TO UCT.** TERMINAL-CURRENT (`/calendar`) is a page. `/charts` is a workspace with a
widget registry. The desk's daily loop crosses that boundary constantly — a name shows up in a
widget and the trader wants the full research surface (earnings modal, screener row, journal
entry). UCT currently has no *named, symmetric* crossing: a widget cannot be promoted from a
full page, and a widget click cannot be pre-bound to open a chosen destination. The persona is
the desk operator running a multi-widget board who keeps having to re-find context after a
click.

**CONFIDENCE.** 🟢 that both layers exist and that `LLP` + function shortcuts cross between
them (Bloomberg's own guide, worked examples, corroborated by a 2026-dated libguide for the
panel layer). 🟡 that the crossing works the same way in the 2026 UI. Ceiling: no terminal
access; the current-era Bloomberg sources are video-only.

**RECOMMENDATION (hypothesis).** *A widget system earns its keep when promotion is generic
rather than per-widget.* Test the hypothesis that one operation — "open this page as a widget"
— applied to UCT's existing routes would produce more usable board tiles than continuing to
hand-author entries in `WIDGET_REGISTRY`. Test the converse separately: a per-widget "clicking
a row here opens X there" binding, where X is a durable destination the user picked once.
**Anti-pattern to avoid:** a workspace that can only ever contain things somebody remembered to
build a widget for. That is a registry that grows slower than the product.

**OPEN QUESTION.** When `LLP` promotes a function, does the resulting component retain full
interactivity, or is it a reduced/read-mostly rendering? The guides show the promotion but never
compare the two renderings side by side. This is exactly the difference between "a real
promotion primitive" and "a screenshot with a ticker field".

---

## 2. Views and Pages are the persistence unit — and a workspace is addressable by command

**OBSERVATION.** Launchpad's saved artefact is a **View**. A View contains one or more **Pages**;
a Page holds components. Views are named, saved, renamed, re-opened from a **View Manager**, and
— the striking part — **a named view can be loaded from the command line like any other
function**.

**EVIDENCE.** Bloomberg *Getting Started on Bloomberg Launchpad* (© 2012, IIMA host; identical
text in the © 2015 revision hosted at financetapmi.wordpress.com), sections **COMMON BLP
COMMANDS**, **SETTING UP LAUNCHPAD VIEWS**, **MANAGING VIEWS** (T2) — *verified*:
- `BLP <GO>` opens Launchpad. `BLP EMPTY <GO>` / `BLP BLANK <GO>` / `BLP NEW <GO>` load a blank
  view. **`BLP AGAIN "VIEW NAME" <GO>`** loads a specific named view. `BLP AGAIN <GO>` /
  `BLP RELOAD <GO>` refresh the current view.
- "The View Manager is the central location from which to access your views sample views and
  shared pages." Views menu → New / Rename / Save; "Launchpad maintains the most recent views
  you have used on a list that is easily accessible from the toolbar."
- The toolbar's Options chevron exposes exactly five menus: **Views · Pages · Settings · Tools ·
  Help** — "Tools… allows you to access manager functions that centralize the views, pages and
  monitor options."
- Second copy (© 2015): https://financetapmi.wordpress.com/wp-content/uploads/2018/10/launchpad-basics.pdf
  — *verified*, byte-for-byte the same instructions with a 2015 copyright line, which is itself
  the evidence that the model did not move between 2012 and 2015.
- Holowczak, *Bloomberg Essentials Online Training Program (BESS)* tutorial, 2013-12-30 (T9):
  Launchpad is "a graphical user interface that can be customized to create multiple screens or
  'Views'"; "A view can consist of multiple pages that can be created, customized and saved."
  https://holowczak.com/bloomberg-essentials-line-training-program/9/ — *reported*.

**INTERPRETATION.** Two things are doing work here and only one of them is obvious.

The obvious one: a two-level hierarchy (View → Page) means a trader keeps *several whole
desks* — a morning desk, an earnings desk, a macro desk — not one desk they keep rearranging.
The unit of switching is the entire arrangement.

The non-obvious one: **`BLP AGAIN "VIEW NAME"` makes a workspace a first-class command-line
citizen.** A saved arrangement is not something you hunt for in a menu; it is something you
*type*, in the same box where you type everything else, with the same muscle memory. That
collapses the usual cost of having many saved layouts — the cost is normally *finding* the
right one, and Bloomberg deleted that cost rather than optimising the picker.

**RELEVANCE TO UCT.** `/charts` persists exactly one working arrangement in
`charts_workspace_layout`, plus named grids in `/api/charts/layouts`. There is no addressable
"load my earnings board" verb. The desk persona here is the operator who wants a different board
at 07:00, 09:30 and 15:45 and currently either rebuilds one or keeps a compromise board that is
wrong at all three times.

**CONFIDENCE.** 🟢 on the mechanism as documented (primary, two independent editions, plus an
independent tutorial). 🟡 that the exact command strings still work in 2026 — the mnemonics are
unusually stable in this product, but I did not verify them against a live terminal.

**RECOMMENDATION (hypothesis).** *Named workspaces are worth little until they are addressable
from wherever the user already types.* If UCT ships saved boards, test them behind the existing
command/search surface (the AI-search box or a `/` command) before building a board picker UI.
Also test the **View → Page** split rather than a flat list of boards: the flat list is the
shape that goes stale, because a user with eleven boards stops trusting any of them.

**OPEN QUESTION.** What is the practical ceiling on saved Views before a user stops maintaining
them? Bloomberg documents no limit, and no source I reached reports a real user's count. Without
that number, "let users save boards" is an unbounded feature.

---

## 3. Components: a browser with popularity ranking, plus tabbed multi-function windows

**OBSERVATION.** Components are found through a dedicated **Launchpad Component Browser**, which
opens on **the 25 most popular components**, ranked with **stars showing popularity among users
and Bloomberg specialists**, with a **live preview** of the highlighted component. Documented
component types include Monitor, Chart, News/Research Panel, Chart Grid, and a **Custom Function
Window** that folds several functions into one window as bottom **tabs**.

**EVIDENCE.** Bloomberg user guide (© 2012 / © 2015), sections **OPENING LAUNCH COMPONENTS**,
**CHART GRID**, **ADDING A CUSTOM FUNCTION** (T2) — *verified*:
- "The Browse window displays the 25 most popular components in Launchpad. Stars next to each
  component show popularity among users and Bloomberg specialists."
- "Highlight a component and a sample screen—a description of the component appears in the
  Preview section of the screen."
- Custom Function Window: "To reduce the number of components on the screen, you can combine
  multiple functions into one Launchpad window" — Tools → *Custom Function Window Manager* →
  Create New → Add Tab per function, each tab gets a Tail and an editable Tab Name, reorderable
  with Up/Down.
- Chart Grid: "a series of equally distributed charts", sourced from "a current monitor or
  portfolio", with a **Grid Size** control.
- Earlier edition (T2, UDel host): a **Component Finder** reached from a red "Find" button;
  "As BLOOMBERG LAUNCHPAD is continually enhanced, the list of available components will grow
  extensively." — *verified*.
- Bloomberg, *Bloomberg Pro Tips: Run BQuant Desktop Applications in your Launchpad*,
  **2025-08-19** (T5, official): the episode "shows how Bloomberg Terminal users can access
  interactive applications created by analysts at their firms directly in Launchpad."
  https://professional.content.cirrus.bloomberg.com/professional2023/?p=124867 — *claimed*
  (article text only; the mechanism is inside the video, which I did not transcribe).

**INTERPRETATION.** Three separate answers to "there are too many things to choose from", and
UCT has none of them:

1. **Popularity is a first-class ranking signal in the picker**, sourced from two populations
   (users *and* Bloomberg's own specialists) rather than one. A new user's default board is
   effectively crowd-authored.
2. **Preview before commit.** You see the component rendered before it lands on your board. The
   cost of exploring the catalogue is near zero, which is the only reason a large catalogue is
   an asset rather than a tax.
3. **Tabs inside one window** as an explicit density lever, whose stated purpose is "to reduce
   the number of components on the screen". Bloomberg treats screen real estate as the scarce
   resource and gives the user a knob for it — rather than assuming more tiles is more value.

The 2025 BQuant line matters strategically: firm-authored apps become Launchpad components.
The workspace is an **extension point**, not just a layout.

**RELEVANCE TO UCT.** The `/charts` widget menu is a flat, unranked, unpreviewed list derived
from `WIDGET_REGISTRY`. As the widget count grows this gets monotonically worse, and the failure
is silent: members keep using the three widgets they found first. The affected persona is the
newer member who never discovers the Flow or Breadth widgets at all.

**CONFIDENCE.** 🟢 for the browser, stars, preview and custom-function tabs (primary, two
editions). 🟡 for BQuant-in-Launchpad — the claim is official and dated 2025-08-19, but I have
only the page's own summary sentence.

**RECOMMENDATION (hypothesis).** *A widget picker that ranks by real usage and previews before
commit converts a growing catalogue from a liability into an asset.* UCT already records what it
needs for the ranking half (page views / widget layouts). Test the ranking and the preview
**separately** — the preview may carry most of the effect, and shipping both at once makes the
result unattributable. Second, smaller hypothesis worth testing on the phone shell: **a tabbed
multi-function tile** is a density lever the current grid does not have.

**OPEN QUESTION.** Are the star ratings computed from telemetry or curated? "Popularity among
users **and** Bloomberg specialists" reads like a blend, and the blend ratio is the whole design
— a pure-telemetry ranking entrenches whatever is already popular.

---

## 4. The Monitor is the anchor component — a spreadsheet with a keyboard, not a widget

**OBSERVATION.** The Monitor is where Launchpad's mass sits. It is a list of securities with
user-chosen columns, and its documented capacity is far beyond what a "watchlist widget"
implies: **up to 30 columns drawn from more than 280,000 data items, and up to 2,000 securities
per monitor**. Securities arrive five ways: typed, index constituents, imported from a source,
dragged from Excel, or dragged in from another component.

**EVIDENCE.** Bloomberg user guide (© 2012 / © 2015), sections **ENTERING SECURITIES INTO A
MONITOR** and **EDITING MONITOR COLUMN DATA** (T2) — *verified*:
- "A Monitor component can be further customized by selecting up to 30 columns of data from more
  than 280,000 data items. Each Launchpad monitor can accommodate up to 2,000 securities."
- Import offers a decisive either/or: **"Copy from source—Fixed list of tickers and will not
  update"** vs **"Link to source—Will reflect any changes in an index or security."**
- "In Excel, highlight the column containing your list of tickers and drag the list into your
  blank Monitor component."
- Right-click an index ticker → **Add Members** to expand constituents.
- Columns: View → Manage Columns, keyword-searched from the field dictionary, `Add Selected`,
  `Rename Columns`; or double-click a column header and use autocomplete's "Top Matches".
- **Historical contrast, same publisher.** The earlier edition (T2, UDel host) documents **"up
  to 14 columns of data from over the 6500 data items"**, an "Override Title" per column, and
  drag-to-reorder columns. — *verified*.
- Wharton / Lippincott, *Part II — Creating a Monitor or Watch List*, 2013-04-08 (T9): monitor
  populated from typed tickers, **from `EQS <GO>` screen results**, or by adding an index and
  selecting "add members"; monitor features include sorting by sector, summary statistics,
  **multiple panes for larger watch lists**, news alerts and custom triggers, and a **"News
  Heat" bar graph showing current news activity by security**.
  https://lippincottlibrary.wordpress.com/2013/04/08/part-ii-creating-a-monitor/ — *reported*.
- Earlier edition (T2, UDel host): monitor features include "color-coding securities and setting
  price alerts". — *verified*.

**INTERPRETATION.** Two design commitments, both against the grain of how UCT's watchlists work.

**First: the column set is user-authored from the firm's whole field dictionary, not from a
curated shortlist.** 30 of 280,000. The monitor is not "a watchlist with some columns" — it is a
*query surface* the user builds. Note the direction of travel between editions: 14 columns / 6,500
items → 30 columns / 280,000 items. Bloomberg widened the user's reach into the data dictionary
by ~43× while barely doubling the columns on screen. They bet on **selection power**, not
display volume.

**Second — and this is the sharpest transferable idea in this report — Copy-from-source vs
Link-to-source is presented as an explicit user choice at import time.** A list that is a frozen
snapshot and a list that tracks its origin are *different objects with different failure modes*,
and Bloomberg makes the user say which one they want rather than guessing. A guessed default is
wrong half the time and the wrongness is silent: your "S&P 500 board" quietly stops matching the
index, or your carefully pruned earnings list quietly re-inflates.

"News Heat" deserves a note of its own: a per-row bar of *current news activity*, i.e. a density
signal that is not a price. It answers "what is being talked about right now" without the user
reading anything.

**RELEVANCE TO UCT.** UCT's watchlists (`watchlist_items`, `watchlist_performance`) offer a
fixed column vocabulary and a gear toggle for performance periods. Nothing in the system
distinguishes a frozen list from a tracking list — the closest analogue is the tag auto-lists,
which track by construction with no snapshot option, and UCT20/theme holdings, which are pushed
and therefore always tracking. The persona is the member who builds a list off a screener run
and expects it to *stay* what it was, or the opposite.

**CONFIDENCE.** 🟢 on capacity, column mechanism and the copy/link choice (primary, and the
two editions corroborate each other on structure while differing on limits exactly as a
version history should). 🟡 on News Heat and alert triggers — single secondary source, 2013.

**RECOMMENDATION (hypothesis).** *Ask the user, once, whether a list is a snapshot or a
subscription.* Test adding that single choice at UCT's list-creation points (screener → list,
scan → list, index/theme → list) and measure whether "my list changed / my list didn't change"
support contacts fall. This is a one-field change with an outsized correctness payoff, and it is
the kind of ambiguity that produces *silent* wrongness — the worst kind. Second hypothesis:
**a non-price density column** (UCT already computes tweet counts, catalyst scores and buzz)
would earn a column slot on the watchlist more than another return period would.

**OPEN QUESTION.** What happens to a Link-to-source monitor when the source changes *while the
user has hand-edited rows*? The guides describe the two modes but not their collision, and that
collision is where this feature would actually break.

---

## 5. Linking: the Group Manager — and the groups are **letters and numbers, not colours**

**OBSERVATION.** Components are linked into **component groups**. Changing the security in one
member changes it in all the others. A group is identified by **a number and a letter badge
shown at the top of each member** — the guide's worked example renders as **"Group-1, #A"**.
Crucially there are **two group kinds with different reach**: a **Security Group** takes any
component type; a **Monitor Group** links a watch list and, per one secondary source, **only** a
News Panel.

**EVIDENCE.**
- Bloomberg user guide (© 2012 / © 2015), section **LINKING COMPONENTS** (T2) — *verified*.
  The documented sequence is asymmetric and worth reproducing because it is the mechanism:
  1. Click the **Grouping icon** on a component → the **Group Manager** opens; "The components
     will automatically be added as a new group."
  2. "Once a component is added to a new group, the component will be **highlighted in red**.
     Click on Update to finalize. In the example shown, the Group is now denoted as
     **Group-1, #A**."
  3. From the **News Panel**: **Settings → Add to Security Group** → pick Group-1 → Update.
  4. From the **Monitor**: **Link To → Component Groups** → select Group-1 → Update.
  5. "When you click on different securities on the monitor, your chart and news panels will
     change accordingly."
- Bloomberg user guide, front matter, **GROUP COMPONENTS** (T2): "Launchpad allows you to create
  a group of components that you can maintain for a security or group of securities… when you
  change a security in one component, the other components in the group are updated with the new
  security." — *verified*.
- Wharton / Lippincott, *Part III — Adding Components and Pages and Organizing the Group View*,
  2013-09-02 (T9): grouping is reached via **a paperclip icon** on a component showing
  single-security data; you choose **"Security Group" (single item)** or **"Monitor Group"
  (Watch List; News Panel only)**; **"Letter identifiers (A, B, C) appear at component tops."**
  The same post documents **docking**: move components together "until a thick yellow line
  appears between them", after which a docking icon moves the docked set as one unit and
  clicking an individual component's top undocks it.
  https://lippincottlibrary.wordpress.com/2013/09/02/bloomberg-launchpad-part-iii/ — *reported*.
- Earlier edition (T2, UDel host): Group Manager reached from a red **Tools** button; "Click on
  'Save' to store those links as 'Group 1'"; "You can create multiple Groups which contain
  different linked components, for example, Group 1 may contain linked charts, Group 2 may be
  linked news components." And the intent, stated plainly: "The full power of BLOOMBERG
  LAUNCHPAD is realized when the individual components within your View are linked together…
  either through manual entry or simply drag/drop a security from a monitor into any component."
  — *verified*.

**INTERPRETATION — including a correction to this contract's own premise.** The contract asks
about "'group' colors". **No source I reached documents colour-coded component groups in
Launchpad.** The identifier is a number plus a letter (`Group-1, #A`; A/B/C badges). Colour
appears in Launchpad in two *unrelated* places: red as a transient *editing* state on a
component being added to a group, and "color-coding securities" as a per-row monitor feature.
The A/B/C-plus-colour-dot idiom is a real pattern in this product category — it is what UCT's
own `/charts` uses (groups A/B/C/D with a colour dot on each widget header) — but on the
evidence I have it is **not Bloomberg's**. Worth flagging to synthesis: if a downstream document
says "Bloomberg links widgets by colour group", that claim needs its own source, and I could not
find one.

The genuinely instructive part is elsewhere, in two places:

**(a) Two group kinds with deliberately different reach.** A Security Group carries one security
across any component. A Monitor Group carries a *whole list* — and (per Wharton) only a News
Panel can consume it. That is a considered restriction, not an omission: "here is a list" is a
different message from "here is a security", and most components have no meaning for the first.
A news panel does. A chart does not.

**(b) Joining a group is a per-component *opt-in with its own local verb*.** There is no global
"link everything" switch. The News Panel opts in via *Settings → Add to Security Group*; the
Monitor opts in via *Link To → Component Groups*. Each component decides, in its own menu, in
its own vocabulary. Verbose — and it is exactly why a Launchpad view does not surprise its owner:
nothing is linked that the owner did not walk over and link.

**RELEVANCE TO UCT.** `/charts` colour groups A–D already implement the Security Group idea, and
`WorkspaceContext.setGroupSym` is the equivalent of "change one, change all". Two gaps stand out
against Bloomberg. First, **UCT has no Monitor-Group analogue** — no way to publish *a list* to a
subscribing widget, only a single symbol. A Watchlist widget and a News/Flow/Buzz widget that
followed the *list* rather than the *selected symbol* is the missing shape. Second, the four
fixed colour groups are a hard ceiling where Bloomberg's group set is open-ended.

**CONFIDENCE.** 🟢 on the group mechanism, the two group kinds and the per-component opt-in
(primary guide for the flow; Wharton independently for the kinds). 🟡 on the "News Panel only"
restriction for Monitor Groups — a single secondary source from 2013, and Bloomberg's own guide
does not state the restriction. 🟢 on the **absence** of colour-coded groups in the sources
reached, 🟡 on the stronger claim that Bloomberg has never had them.

**RECOMMENDATION (hypothesis).** *Publish lists, not just symbols, on the workspace bus.* Test a
`groupList` channel beside `groupSyms` in `WorkspaceContext`, with exactly one consumer to start
(the Buzz/News tile is the natural first, matching Bloomberg's News-Panel-only precedent — and
the precedent suggests the restriction is a feature, not a stage). **Anti-pattern to avoid:**
implicit auto-linking. Bloomberg's opt-in is per-component and locally worded precisely so a
board never rearranges itself under its owner.

**OPEN QUESTION.** When a component belongs to a Security Group *and* its view has a Monitor
Group, which wins on a conflicting update? Neither source addresses precedence, and precedence
is where a linking model either holds or produces the "my chart jumped" complaint.

---

## 6. Persistence: per-login views, per-computer geometry, and an explicit undo for monitors

**OBSERVATION.** Views persist against the **login**, not the machine — but **screen geometry is
assigned per machine**, and Bloomberg exposes that as a first-class setting. Separately,
Bloomberg ships an explicit **undo/restore for monitors**: `MNRS <GO>`, keeping **up to ten
previous versions**.

**EVIDENCE.** Bloomberg user guide (© 2012 / © 2015), sections **SETTING UP LAUNCHPAD VIEWS**
and **RESTORING A MONITOR** (T2) — *verified*:
- "You can choose to have Launchpad open automatically when you log on to the Bloomberg
  Professional service. You can choose which of your saved views opens when you start Launchpad.
  By default, the most recently opened view is used when you start Launchpad and that view is
  minimized."
- The Startup Defaults window offers four things, one of which is the interesting one:
  **"Assign a specific resolution for your Launchpad views to open for each of your
  computers—on a work terminal and/or on a home PC."** (The others: pick the startup view; add a
  view to your **BBDP/BIO** personal directory page; start Launchpad automatically at logon.)
- **`PDFB <GO>`** — "the Launchpad Defaults page to set up how your Launchpad view behaves."
- **`MNRS <GO>`** — "to restore a previous version of a Launchpad monitor. Note: If you delete a
  monitor accidentally or make a change to a monitor that you would like to undo, **up to ten
  previous versions are available for restoration**."
- Bloomberg user guide, **SCREEN ADJUSTMENT** (T2) — the shared-instance/copy distinction, stated
  as a titled section, *"Difference Between Show on Selected Pages and Duplicate to Page"*:
  - **Show on Selected Pages**: "Puts the same monitor on different pages; when you make a change
    in one monitor, the other monitors will reflect that change."
  - **Duplicate to Page**: "A copy of the same monitor is made, and all changes will be reflected
    in the duplicate monitor only."
  Also: a zoom slider and `View → Zoom → Custom zoom` by percentage. — *verified*.
- University of Scranton, *Bloomberg Training Manual* (T9, undated): the login walkthrough notes
  "You may see a pop-up that says to open your Launchpad. You can click 'No' before you get
  started and always come back and create a new Launchpad."
  https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf — *reported*.
  This corroborates the "opens at logon" default from a completely independent angle.
- Bloomberg FAQ material, via search result text (T1, not directly fetched — bloomberg.com
  returns 403 to this fetcher): a Bloomberg Anywhere subscriber with their registered B-Unit can
  access the service "on any internet enabled desktop". — *claimed*, and see the caveat below.

**INTERPRETATION.** The per-computer resolution setting is the tell, and it is worth dwelling on
because it is a subtle and correct piece of design. It only makes sense if **the view content is
stored centrally against the user** while **the view's geometry is a property of the display it
lands on**. Bloomberg separated *what is on the desk* from *how big the desk is*, and made only
the second machine-local. A trader's work follows them from the trading floor to the home PC;
their 3-monitor layout does not follow them onto a laptop and get mangled.

I want to be precise about the limit of this inference: no source I reached *states* "views are
stored server-side". I am inferring it from the per-computer resolution feature plus
Bloomberg Anywhere's login-anywhere model. It is a strong inference. It is not verified.

`MNRS` is the second thing worth stealing, and it is also *evidence about failure*. Bloomberg
built version history — ten deep — for one object: the monitor. Products do not ship undo for
things that never go wrong. The presence of `MNRS` is the closest thing I have to an answer for
"what breaks", and it says: **users destroy their own lists, often enough that Bloomberg
productised the recovery** (see §9, where this is all I have).

**RELEVANCE TO UCT.** UCT persists `charts_workspace_layout`, `multichart_state`, `chart_settings`
and `calendar_view_v3` per user, server-side — the login-scoped half is already right. Two gaps.
**(a) No geometry/machine separation**: a phone, a laptop and the desk's 27" monitor share one
persisted layout, and the phone branch (`MobileWorkspace`) sidesteps this by being a different
renderer rather than a different geometry for the same board. **(b) No version history on any
user-authored artefact** — not watchlists, not saved screens, not workspace layouts, not
notebook notes. A member who nukes a curated watchlist has no recourse. Given that UCT already
learned this lesson painfully in the notebook migration (a member's first-ever upload was
broken), `MNRS` is a directly applicable pattern.

**CONFIDENCE.** 🟢 on the documented settings, `PDFB`, `MNRS` and the ten-version depth
(primary, two editions, plus independent corroboration of the logon default). 🟡 on
"views are stored server-side against the login" — inferred, not stated. 🟡 on the
Bloomberg Anywhere access claim — I have it only as search-result text, since bloomberg.com
403s this fetcher.

**RECOMMENDATION (hypothesis).** *Version-history the user's own curation before adding more
places to curate.* Test a ten-deep restore on UCT watchlists first (smallest surface, clearest
loss, and the table already has the shape for it). Separately, test whether **layout geometry
should be keyed by (user × viewport class)** rather than by user alone — the current single-blob
model is why the phone needed an entirely separate renderer.

**OPEN QUESTION.** Is a Launchpad View actually stored on Bloomberg's servers, or synced from a
per-machine cache at login? The distinction decides whether "my desk follows me" survives a
machine the user has never logged into before — the exact case a small desk cares about.

---

## 7. Templates and sharing: Sample Views by asset class, and a view as a message attachment

**OBSERVATION.** A new Launchpad user is not shown an empty canvas. The first-run experience is a
**"Sample Views" window with three options**, and **Sample Views are organised by asset class**
and reachable permanently from the View Manager. Views and Pages are also **shareable to other
Bloomberg users** — in the earliest documented form, **as message attachments**.

**EVIDENCE.** Bloomberg user guide (© 2012 / © 2015) (T2) — *verified*:
- "When starting Launchpad using BLP &lt;GO&gt; and there are no views set up, the 'Sample Views'
  window appears with 3 options to choose from." One is "Open a blank view", which yields "Page 1
  loaded as the only page in View 1".
- View Manager carries a **Sample Views radio button**: "Highlight the view from the **asset
  class** you want from the list of views and click Open." With Bloomberg's own framing:
  "Sample views have been created for your consideration. Many of these displays will be a good
  starting point for you to add components and customize as needed."
- "The View Manager is the central location from which to access your views sample views and
  **shared pages**."
- Front matter, **COMMUNICATE IDEAS**: "You can communicate and exchange information with clients
  and colleagues by **sending and sharing pages or entire views**."
- Earlier edition (T2, UDel host): "Users have the ability to create multiple Views and **send
  them as message attachments** across the BLOOMBERG PROFESSIONAL service Message system." Also a
  Tools → **Sample Views** browser where you "Enter your criteria to generate a list of sample
  views to choose from." — *verified*.
- Bloomberg vendor copy (T3, Bloomberg-authored, hosted by The Wealth Mosaic): Launchpad has
  "built-in communication and collaboration tools" and lets you "Share any screen or data set
  with others through the Instant Bloomberg chat."
  https://www.thewealthmosaic.com/vendors/bloomberg/bloomberg-launchpad/ — *claimed* (marketing).

**INTERPRETATION.** The blank-canvas problem is the single largest failure mode of any
workspace product, and Bloomberg's answer is not a tutorial or an onboarding tour — it is
**pre-built, opinionated, editable desks segmented by what you trade.** An FX trader's starting
desk is not an equity analyst's. And the sample view is not a read-only demo; it is a live view
you immediately customise, which means the sample doubles as the *teaching artefact* — you learn
the model by taking one apart.

Sharing is the network effect UCT genuinely cannot copy wholesale (that is B-BBG-08's territory).
But note the *shape*: the unit of sharing is the **arrangement**, not the data. "Here is my
earnings desk" is a different kind of message from "here is a chart", and it is a message a
trading room's senior member would plausibly want to send to juniors.

**RELEVANCE TO UCT.** `/charts` starts empty. UCT already has the raw material for asset-class
sample views — starter scans exist as ordinary editable definitions (`starter_library.py`,
`starterScans.json`), which is *precisely* the Bloomberg posture ("the firm's setups ship as
ordinary definitions, editable on arrival") applied to screens rather than boards. Extending the
same posture to workspaces is a short conceptual step. The persona is the new member on
`/charts` for the first time; the desk's own operator has a board and does not have this problem,
which is exactly why it stays invisible.

**CONFIDENCE.** 🟢 on first-run Sample Views, asset-class segmentation and shareable
pages/views (primary, two editions). 🟡 on the current sharing mechanism — "message attachments"
is documented in the older edition; the Instant-Bloomberg framing is 2020s marketing copy, and
I did not verify the present-day flow.

**RECOMMENDATION (hypothesis).** *Ship starter boards the way UCT already ships starter scans —
as ordinary, editable artefacts, segmented by what the member trades.* Test 3–5 starter boards
(swing-equity, options-flow, macro/breadth, earnings-day) as the `/charts` first-run experience,
and instrument whether members who start from one end up with **more** widgets a week later than
members who start blank. **Anti-pattern to avoid:** a read-only "demo" board or a guided tour —
the sample must be the real thing, taken apart.

**OPEN QUESTION.** How many Sample Views does Bloomberg ship, and are they curated centrally or
harvested from real users' views? If harvested, the starter set is a much cheaper artefact than
it looks, and the same trick would work for UCT.

---

## 8. Where Bloomberg gives a **page** instead of a workspace: the market-monitor mnemonics

**OBSERVATION.** For the "what is the market doing right now" question, Bloomberg does **not**
hand the user a workspace to assemble. It ships **fixed, purpose-built pages** with short
mnemonics — and then lets those same pages be pulled into the workspace via `LLP` if the user
wants them permanently on the board.

**EVIDENCE.**
- Bloomberg, *Bloomberg Terminal Essentials: Best equities functions*, **2024-10-10** (T5,
  official): the "market overview" pair is **`WEI` — World Equity Indices** and **`IMAP` —
  Intraday Market Map**; idea generation is **`EQS`** (Equity Screening), **`WATC`** (Watchlist
  Analytics), **`RV`** (Relative Valuation).
  https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-best-equities-functions
  — *verified* (Bloomberg's own categorisation; per-function prose sits in the video).
- University of Scranton, *Bloomberg Training Manual* (T9) — *reported*, and unusually specific:
  - "**MOST**&lt;GO&gt; The MOST function shows the largest volume movers, change up, change down,
    52 week highs/low. From this screen you can easily change to other indices and filter by
    sector."; "The most efficient function for this is MOST. You can also click to view the news
    of the day and distinguish why the stock is up/down."
  - "**LVI**&lt;GO&gt; - Largest volume movers"; "**MOV**&lt;GO&gt;- Largest movers up/down."
  - "**WEI** &lt;GO&gt; World Equity Index show all global markets, broken down by the Americas,
    Europe and Asia." Clicking one index gives industry weight breakdowns.
  - "**BTMM**&lt;GO&gt; Treasury and Money Markets displays all major rates, securities, and
    economic releases for a selected country."
- NYIT libguide (T9, 2026-08-03): lists WEI, WE and **MOST** as monitoring shortcuts — *verified*
  as current-dated naming.
- `MOV` is security/index-scoped — the documented form is `SPX <INDEX> MOV <GO>` (T9, multiple
  library guides) — *reported*.

**INTERPRETATION.** This is the cleanest answer to the contract's closing question, *where does
Bloomberg force a workspace and where does it give a page?*

**Bloomberg gives a page whenever the question has a single canonical answer and the layout is
not a matter of taste.** "Which stocks are most active" has one right layout; nobody needs to
compose it. **Bloomberg forces a workspace whenever the answer is a *combination* whose
composition is personal** — this monitor beside that chart beside that news filter, all linked.
And it refuses to make you choose, because `LLP` turns any page into a component. The page is the
default; the workspace is what you graduate to; and the graduation is one command.

There is also a workload argument that a small desk should notice: the canonical pages carry the
*market-wide* questions (movers, indices, heat maps), which are identical for every user, while
the workspace carries the *portfolio-specific* questions, which are identical for none. Bloomberg
put the shared questions where they can be built once, and only the unshared ones where the user
must do work.

**RELEVANCE TO UCT.** UCT is already mostly on the right side of this line: Dashboard, Breadth,
Movers, Catalysts and Live Flow are fixed pages answering market-wide questions; `/charts` is the
composable workspace. The gap is the **graduation path** — there is no `LLP`. A member who lives
on the Breadth Monitor cannot put it on their board, and a member who wants the Catalysts table
beside their chart cannot have it. That is a promotion primitive, and §1's recommendation is the
same recommendation seen from the other end.

**CONFIDENCE.** 🟢 that WEI/IMAP/EQS/WATC/RV are current Bloomberg-named equity functions
(Bloomberg's own 2024 page). 🟡 on the detailed MOST/MOV/LVI/BTMM descriptions — a single
undated university manual, corroborated only in outline by NYIT and search snippets. 🔴 on
`MON`: **the contract's speculative `MON` mnemonic is unconfirmed.** No source I reached
documents `MON` as a custom-monitor function. Launchpad monitors are created via the Monitor
Manager (Tools menu, or "Monitor" typed in the toolbar keyword field) and restored via `MNRS`.
Treat `MON` as unverified rather than as a fact inherited from the contract.

**RECOMMENDATION (hypothesis).** *Keep market-wide answers as pages and make them promotable;
do not rebuild them as widgets.* Test "add this page to my board" on two or three existing UCT
pages before adding any new widget types — the promotion is likely cheaper than the widgets and
covers more ground.

**OPEN QUESTION.** Does `IMAP` link into component groups (i.e. can clicking a tile in the
Intraday Market Map drive a linked chart)? If a *visualisation* can be a group publisher and not
just a subscriber, that is a materially richer linking model than "the watchlist drives
everything", and it would change what UCT's Breadth heatmap could be.

---

## 9. What breaks — the weakest part of this report, stated plainly

**OBSERVATION.** I could not source direct practitioner testimony about Launchpad failures. What
I have is one strong *indirect* signal from Bloomberg's own product surface, one genuine
practitioner exchange about the Terminal generally, and a documented dead end.

**EVIDENCE.**
- **Indirect, primary, and the strongest thing I have:** `MNRS <GO>` exists and keeps **ten**
  previous versions of a monitor, with Bloomberg's own guide naming the two triggering cases —
  "If you **delete a monitor accidentally** or **make a change to a monitor that you would like
  to undo**" (T2) — *verified*. Ten deep is not a token undo; it is a response to a recurring
  loss.
- **Practitioner, on the Terminal generally, not Launchpad** (T15). Hacker News thread,
  2019-12-20/21, replying to a claim that "The terminal is extremely slow most of the time and
  constantly crashes": a self-described 10-year front-end-and-API user answers "it is the most
  stable piece of software I've ever seen… Not once, not one single time has it crashed in those
  10+ years for us", and a second commenter, a user since 2005, adds "I don't ever remember it
  crashing." https://news.ycombinator.com/item?id=21844740 — *reported*. Two long-tenured users
  contradicting one complaint is not a stability measurement, but it is a real signal that
  "Bloomberg is creaky legacy software" is an outsider's view more than a user's.
- **Documented dead end** (worth recording so nobody repeats it). Two Wall Street Oasis threads
  index highly for this exact question — *What do you all have on your Bloomberg Launchpads?* and
  *Bloomberg Launchpad Layouts for Equity*. Opened in a browser: the human replies are gated
  behind an email signup (not performed), the visible body of the first is Lorem-ipsum filler
  from a "WSO Monkey Bot", and the visible body of the second is an **AI-generated** answer that
  is **factually wrong** — it glosses `W` as "World Markets" when `W` is Bloomberg's **Security
  Worksheet** (see §10). — *observation about source quality, not evidence about Bloomberg*.

**INTERPRETATION.** The honest summary is: **I do not know what users say breaks about
Launchpad.** The one thing the product itself testifies to is that **monitors get destroyed by
their owners** often enough to warrant ten-deep version history — which is a statement about
*user error on curated lists*, not about software defects.

The WSO finding is worth carrying forward as a research note for sibling roles: for this product,
the public practitioner layer has been colonised by AI-generated content that is confidently
wrong about mnemonics. Any Bloomberg claim sourced from a forum page needs the human authorship
checked, not just the domain.

**RELEVANCE TO UCT.** The transferable item is not a defect list; it is `MNRS`'s existence.
UCT has no undo on any user-curated artefact.

**CONFIDENCE.** 🔴 on "what practitioners say breaks about Launchpad" — not reached. 🟢 on
`MNRS` and its stated triggers. 🟡 on the general-stability picture (two self-reported
long-tenured users, 2019).

**RECOMMENDATION (hypothesis).** Treat this question as **open, not answered**, in synthesis.
If the owner wants it closed, the named routes are: a practitioner interview; a Bloomberg
Terminal session; or a Bloomberg University / `BU`-hosted training video transcript.

**OPEN QUESTION.** Does Launchpad's view file corrupt or reset in practice — and if so, is that
what `PDFB` and the recent-views list are really for? The presence of *three* separate recovery
affordances (default-view setting, recent-views list, `MNRS`) around one feature is suggestive.

---

## 10. The modern watchlist container is `W` (Security Worksheet), not the Launchpad monitor

**OBSERVATION.** Bloomberg's **current** (2023–2025) public material foregrounds a *different*
list object from the Launchpad monitor: **`W <GO>` — the Security Worksheet**. It is shareable,
Excel-exportable, and — the detail a data-budgeted product should notice — **it costs nothing
against the user's download quota until export**.

**EVIDENCE.**
- Bloomberg, *Bloomberg Pro Tips: Assess many securities from one screen*, **2023-05-08** (T5,
  official): `W` lets users "create and share custom worksheets that monitor the real-time
  movements of multiple financial instruments."
  https://professional.content.cirrus.bloomberg.com/professional2023/insights/markets/bloomberg-pro-tips-assess-many-securities-from-one-screen
  — *verified*.
- Bloomberg, *Bloomberg Terminal Essentials: IB, Worksheets & Launchpad*, **2024-10-12** (T5,
  official): pairs **Worksheets (`W`)** and **Launchpad (`LLP`)** as the two workflow-optimising
  features, alongside IB chat.
  https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-ib-worksheets-launchpad
  — *verified* (existence and pairing; the mechanism is in the video).
- Cranfield University Library, *Introducing… W — Bloomberg's Security Worksheet function*,
  **2025-02-27** (T9): `W <GO>` → "+ Create new worksheet" → default columns Last Price, Net,
  %1D; enter securities by double-clicking the orange Ticker box, or paste a list, or drag from
  Excel; expand an index into constituents; add columns by clicking headers and searching;
  right-click a column header → "Edit Column parameters" for historical data; optional news and
  event icons; saved worksheets live in a central library. The stated headline benefit: **"No
  impact on the download limit until you actively choose to export the worksheet to Excel."**
  Securities can be sent to a worksheet from other functions, e.g. `EQS`.
  https://blogs.cranfield.ac.uk/library/bloomberg-w/ — *reported*.
- `PRTU <GO>` is the portfolio-creation counterpart ("displays a list of any portfolios you've
  previously created"), with `PORT` for analysis and `WATC` for Watchlist Analytics (T9, multiple
  university guides; T5 for `WATC`) — *reported* / *verified* respectively.

**INTERPRETATION.** Bloomberg now runs **three overlapping list containers** — the Launchpad
monitor (lives on a board, links to components), the Worksheet `W` (lives standalone, shares,
exports), and the portfolio `PRTU` (feeds analytics). The public 2023–2025 material leads with
`W`. I want to be careful here: **I did not find evidence that `W` replaces the Launchpad
monitor**, and the 2024 essentials piece presents Worksheets and Launchpad as *complements*, in
the same episode. The most defensible reading is that `W` is the **portable** list and the
monitor is the **embedded** list, and Bloomberg has been promoting the portable one — plausibly
because it is the one that travels into Excel, into chat, and into other functions.

The quota framing is genuinely interesting and has no UCT analogue: `W` is architected so that
*looking* is free and *extracting* is metered. A list you can build, sort and watch without
spending anything, which only bills when it leaves the platform.

**RELEVANCE TO UCT.** UCT's watchlist system is nearer to `W` (standalone, shareable to
community, CSV import/export) than to the Launchpad monitor, and it is *also* embeddable as a
`/charts` widget — so UCT already merges the two containers. The lesson is the direction
Bloomberg pushes: **the list is the durable object and the board is the view onto it**, not the
other way round. UCT's model agrees, which is worth recording as a validated existing choice
rather than a gap.

**CONFIDENCE.** 🟢 on `W`'s existence, framing and current prominence (Bloomberg's own 2023 and
2024 pages). 🟡 on the mechanism detail (one 2025 university source). 🔴 on the relationship
between `W` and the Launchpad monitor — I am inferring complementarity and could not verify
whether Bloomberg is migrating one to the other.

**RECOMMENDATION (hypothesis).** *The list, not the board, is the durable object* — a principle
UCT already follows; the hypothesis worth testing is the corollary: **any UCT surface that
produces a set of symbols should be able to hand that set to a list in one action** (Bloomberg's
`EQS → worksheet` path). Scanner candidates, catalyst rows, breadth drill lists, buzz results and
UCT20 all produce symbol sets today, and only some of them can become a watchlist.

**OPEN QUESTION.** Is a Launchpad monitor backed by the same stored object as a `W` worksheet, or
are they genuinely separate stores? If separate, Bloomberg carries the same split-brain risk UCT
does — and how they live with it would be worth knowing.

---

## GAPS (budget not reached / evidence unreachable)

1. **The current (2026) Launchpad UI is unverified.** All mechanism detail comes from Bloomberg
   guides © 2012 and © 2015. Bloomberg's 2023–2025 coverage of the same features is video-only
   with near-empty article text. **Route to close:** transcribe the three named Bloomberg Pro
   Tips / Terminal Essentials videos (2023-05-08, 2024-10-12, 2025-08-19), or a terminal session.
2. **"What users say breaks about Launchpad" — not reached** (§9). WSO is paywalled; its public
   surface is AI-generated and contains a verified factual error. **Route to close:** a
   practitioner interview, or Reddit/forum sources I could not query (web-search budget for the
   session was exhausted at 200 calls before I could run the two targeted queries).
3. **`MON` unconfirmed** (§8). The contract's speculative mnemonic could not be verified in any
   source; recorded as unverified rather than repeated as fact.
4. **Multi-monitor behaviour is only half-answered.** I have the per-computer *resolution*
   setting and `Show on Selected Pages` vs `Duplicate to Page` (both primary), but nothing on how
   a View spans two or three physical displays, whether pages map to monitors, or whether the
   Launchpad toolbar is per-display. **Route to close:** a screenshot set or a terminal session.
5. **Server-side view storage is inferred, not verified** (§6). The per-computer resolution
   feature and Bloomberg Anywhere's login-anywhere model imply it; no source states it.
6. **Bloomberg.com returns HTTP 403 to this fetcher** for `www.bloomberg.com/professional/*`,
   `/help/*` and `/faq/*`. Two mirrors worked and are used above
   (`professional.bloomberg.com`, `professional.content.cirrus.bloomberg.com`), but the official
   **Help Center and FAQ** — the tier-1 sources for "how does persistence actually work" — were
   not reachable. **Route to close:** a browser session against the help centre.
7. **The Penn Libraries Bloomberg guide's Launchpad page now 404s** while the guide itself
   (updated 2026-08-04) lists eight pages, none about Launchpad. A single data point, offered as
   a weak signal only: some university guides may have retired Launchpad coverage. Not
   load-bearing; do not build an argument on it.
8. **Not attempted, out of scope:** the alerting layer inside monitors (B-BBG-03 owns alerts),
   `EQS` screening mechanics (B-BBG-06), `IB`/chat sharing network effects (B-BBG-07).

---

## SOURCES

**Primary — Bloomberg-authored**

1. **T2** Bloomberg, *Getting Started on Bloomberg Launchpad* — USER GUIDE, © 2012 Bloomberg
   Finance L.P. (doc id 48020717 0412). Hosted by IIM Ahmedabad library. Full text extracted
   locally from the PDF. https://library.iima.ac.in/public/download/bloomberg/launchpad.pdf —
   fetched 2026-09-02. *The single most load-bearing source in this report.*
2. **T2** Bloomberg, *Getting Started on Bloomberg Launchpad* — USER GUIDE, © 2015 Bloomberg L.P.
   (doc id S599875713 DIG 0615). Hosted by financetapmi.wordpress.com. Text-identical revision of
   [1]; used to date the model's stability.
   https://financetapmi.wordpress.com/wp-content/uploads/2018/10/launchpad-basics.pdf —
   fetched 2026-09-02.
3. **T2** Bloomberg, *Bloomberg Launchpad — Getting Started* (earlier, undated edition; 14
   columns / 6,500 data items; red Launch/Find/Tools buttons). Hosted by U. Delaware Lerner
   College. https://my.lerner.udel.edu/wp-content/uploads/BB-Getting-Started-in-Launchpad.pdf —
   fetched 2026-09-02.
4. **T3** Bloomberg, *Bloomberg Terminal* product page.
   https://professional.bloomberg.com/products/bloomberg-terminal/ — fetched 2026-09-02.
   *Claimed:* "Bloomberg Launchpad delivers dynamic multi-asset class security monitors, powerful
   alerting tools, sophisticated charting and news that moves markets."
5. **T5** Bloomberg, *Bloomberg Terminal Essentials: IB, Worksheets & Launchpad*, 2024-10-12.
   https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-ib-worksheets-launchpad
   — fetched 2026-09-02. Article text is minimal; mnemonics `LLP` and `W` verified.
6. **T5** Bloomberg, *Bloomberg Terminal Essentials: Best equities functions*, 2024-10-10.
   https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-best-equities-functions
   — fetched 2026-09-02. WEI, IMAP, EQS, WATC, RV, FA, EE, ANR, BI.
7. **T5** Bloomberg, *Bloomberg Pro Tips: Assess many securities from one screen*, 2023-05-08.
   https://professional.content.cirrus.bloomberg.com/professional2023/insights/markets/bloomberg-pro-tips-assess-many-securities-from-one-screen
   — fetched 2026-09-02. The `W` quote.
8. **T5** Bloomberg, *Bloomberg Pro Tips: Run BQuant Desktop Applications in your Launchpad*,
   2025-08-19. https://professional.content.cirrus.bloomberg.com/professional2023/?p=124867 —
   fetched 2026-09-02. Firm-authored apps as Launchpad components.
9. **T3** Bloomberg vendor copy for Launchpad, hosted by The Wealth Mosaic (undated).
   https://www.thewealthmosaic.com/vendors/bloomberg/bloomberg-launchpad/ — fetched 2026-09-02.
   Marketing claims only.

**Secondary**

10. **T9** New York Institute of Technology, *Bloomberg Terminal — The Keys*, updated 2026-08-03.
    https://libguides.nyit.edu/c.php?g=1054896&p=7662441 — fetched 2026-09-02. Four panels,
    `<PANEL>` key, key colour classes, `BLP`.
11. **T9** Wharton / Lippincott Library (Datapoints), *Bloomberg Launchpad Part One: Basics*,
    2013-03-11. https://lippincottlibrary.wordpress.com/2013/03/11/bloomberg-launchpad-part-one/
12. **T9** Wharton / Lippincott Library, *Part II — Creating a Monitor or Watch List*,
    2013-04-08. https://lippincottlibrary.wordpress.com/2013/04/08/part-ii-creating-a-monitor/
13. **T9** Wharton / Lippincott Library, *Part III — Adding Components and Pages and Organizing
    the Group View*, 2013-09-02.
    https://lippincottlibrary.wordpress.com/2013/09/02/bloomberg-launchpad-part-iii/ —
    paperclip/Group Manager, Security vs Monitor Group, A/B/C badges, docking.
14. **T9** Holowczak.com, *The Bloomberg Essentials Online Training Program (BESS)*, p.9,
    2013-12-30. https://holowczak.com/bloomberg-essentials-line-training-program/9/
15. **T9** Cranfield University Library blog, *Introducing… W — Bloomberg's Security Worksheet
    function*, 2025-02-27. https://blogs.cranfield.ac.uk/library/bloomberg-w/
16. **T9** University of Scranton (Kania School of Management), *Bloomberg Training Manual*,
    undated PDF; text extracted locally.
    https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf —
    MOST, LVI, MOV, WEI, BTMM, and the Launchpad logon pop-up.
17. **T9** Cornell University Library, *How to: Bloomberg — Getting Started*, updated 2025-11-21.
    https://guides.library.cornell.edu/bloomberg_intro — command-driven navigation; `BHL` named
    as the current help/learning function.
18. **T9** Penn Libraries, *Bloomberg Help Guide*, updated 2026-08-04.
    https://guides.library.upenn.edu/bloomberg — eight pages, no Launchpad page; the indexed
    `/bloomberg/launchpad` URL now 404s.
19. **T9** Johns Hopkins University Libraries, *Bloomberg — broad markets*, updated 2026-05-20.
    https://guides.library.jhu.edu/bloomberg/broad-markets — WEI, EEI.
20. **T13** Global Custodian, *Bloomberg Introduces New Desktop 'Launchpad'*, 2002-06-17.
    https://www.globalcustodian.com/bloomberg-introduces-new-desktop-39launchpad39/ — first
    release summer 2002; **up to 25 window components**; component grouping present at launch;
    Richard Barnett (Project Manager) quoted: "It's the next logical and innovative step in
    marrying Bloomberg's functionality with the service and flexibility of the desktop."
21. **T15** Hacker News thread on *The Bloomberg Terminal, Explained*, 2019-12-20/21.
    https://news.ycombinator.com/item?id=21844740 — read via browser (the URL returns HTTP 429 to
    the fetcher). Two long-tenured users on Terminal stability.
22. **T16, NOT USED AS EVIDENCE** Wall Street Oasis, *What do you all have on your Bloomberg
    Launchpads?* and *Bloomberg Launchpad Layouts for Equity*. Opened in a browser 2026-09-02:
    human replies gated behind email signup (not performed); visible content is bot/AI-generated,
    and the second contains a verified factual error (`W` glossed as "World Markets"). Recorded
    as a source-quality finding, not as evidence about Bloomberg.
    https://www.wallstreetoasis.com/forum/investment-banking/what-do-you-all-have-on-your-bloomberg-launchpads ·
    https://www.wallstreetoasis.com/forum/hedge-fund/bloomberg-launchpad-layouts-for-equity
23. **T16, transcription** readkong.com rendering of Bloomberg's *Getting Started on Bloomberg
    Launchpad* — used only to locate sources [1]/[2]; every claim it carried was re-verified
    against the primary PDFs.
    https://www.readkong.com/page/getting-started-on-bloomberg-launchpad-start-your-day-8978557

**Prompt-injection / instruction-like content observed in sources:** none. No fetched page
contained text addressed to an AI agent or attempting to redirect this task. The only
source-integrity issue found is the AI-generated, factually wrong WSO content documented in §9
and [22].

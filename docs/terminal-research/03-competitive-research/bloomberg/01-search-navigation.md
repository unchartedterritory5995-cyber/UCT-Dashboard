---
id: B-BBG-01
title: Bloomberg Terminal — search and navigation
role: Bloomberg search and navigation (workflow slice 1 of 8)
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — how a user begins a session, finds anything, and moves between securities and functions
confidence: 🟡 (mechanics 🟢 · lived learning curve 🔴)
evidence_ceiling: "Mechanics are verified from two Bloomberg-authored documents. Practitioner/community tier is UNREACHABLE from this agent: reddit.com is blocked at the user-agent level, wallstreetoasis.com and g2.com return 403, oreilly.com returns 403. No Terminal subscription, no screenshots, no session recordings. Every 'what it feels like to learn' claim below is 🔴 or 🟡."
sources: "7 primary (Bloomberg-authored); 12 secondary (university library guides, encyclopaedia, practitioner commentary)"
uct_relevance: high
status: draft
date: 2026-09-02
---

# Bloomberg Terminal — search and navigation

**Reading note for synthesis.** This file covers ONE slice: how a user starts a session and finds
anything. Monitors/Launchpad (B-BBG-02), news/alerts (03), earnings (04), fundamentals (05),
screening/charting (06), collaboration/API (07) and the "why they stay" synthesis (08) are other
agents' files. Where a fact here touches those, it is included only because navigation depends on it.

**Benchmark discipline.** "Bloomberg does Y" never means "UCT should build Y". Recommendations below
are phrased as hypotheses for the Terminal-Next program to test, not requirements.

**Two Bloomberg-authored documents carry most of this file** and they broadly agree, which is the
single most useful fact about their reliability:

- **[S1] "Getting started on the Bloomberg Terminal."** — Bloomberg Professional Services offering,
  28pp, education edition. Undated in the file; describes the **classic four-panel** display.
- **[S2] "STOP <GO> — Cancel as a Function, Help Page"** — an export of Bloomberg's own in-Terminal
  Help Page, document date **07/18/2022**, boilerplate **© 2019 Bloomberg**. Describes the **Tabbed
  Windows** display (up to 16) and treats four-panel as the "classic" fallback.

Where they differ, **[S2] is the newer model** and [S1] the older one. Both are quoted verbatim below.
Neither is 2026-current; see GAPS.

---

## 1. Beginning a session: authentication is biometric, and the workspace is restored, not rebuilt

**OBSERVATION.** A session does not begin at a dashboard. It begins at an *identity* check tied to a
person, not a device — and it ends by restoring the exact desk the user left.

Login sequence per [S1]: open the app, **click a panel**, press the green `<Enter/GO>` key, and the
login screen appears with **yellow highlighted Login Name and Password fields**. Press `<GO>`. Then
"up to four Bloomberg panels or windows appear on your computer desktop with default **'wake-up'
screens**."

Layered on that is the **B-Unit**, Bloomberg's personal authentication device. Bloomberg's own
product page frames the physical device as "a secondary accessory option to the B-Unit Mobile App",
with the mobile app free of charge and preferred for Bloomberg Anywhere. Enrolment pairs a
**fingerprint** to the account, and pairing happens via **Screen-Sync**: the user holds the device's
light sensor "about an inch or 2.5cm — from the flashing box on your computer screen, so the
flashing light and the light sensor are aligned but not touching." The device then prompts "Place
Finger to Enroll." Bloomberg's official Terminal-Essentials tutorial page (13 Oct 2024) lists
"**B-Unit and Logging in**" as its first chapter (0:56) — i.e. Bloomberg itself treats *how you log
in* as lesson one, ahead of "Loading A Security" (2:40) and "Menus and Mnemonics" (3:39).

The restore behaviour is explicit in [S2]: "The Terminal remembers the number of open windows, their
locations, and zoom sizes and displays the same layout the next time you log on." And the correct way
to end a session is a **command, not a window close**: "To close all windows and log off, enter `OFF
<GO>`."

**EVIDENCE.**
- [S1] pp.3–5 — official Bloomberg documentation (Tier: official manuals) — **verified**.
  https://data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf
  — fetched 2026-09-02.
- [S2] p.17, p.23 — official Bloomberg Help Page export (Tier: official documentation) — **verified**.
  https://metalib.ie.edu/ayuda/Varios/Bloomberg_help_support.pdf — fetched 2026-09-02.
- B-Unit product page — official Bloomberg product page (Tier: official product pages) — **verified**
  for the quoted strings. https://professional.bloomberg.com/products/bloomberg-terminal/access/b-unit/
  — fetched 2026-09-02.
- "Bloomberg Terminal Essentials: Getting started", 13 Oct 2024 — official Bloomberg insights page;
  chapter titles/timestamps are **verified** page text. The video content itself is **not** claimed
  here (I did not view or transcribe it). — fetched 2026-09-02.

**INTERPRETATION.** Three things are load-bearing and worth separating. (a) The account is a *person*,
verified biometrically, and portable to any terminal — the identity travels, the hardware does not.
(b) The workspace is **durable state the system owns**, restored automatically; the user never rebuilds
their desk. (c) Logging off is a *typed command in the same box everything else is typed into* — even
session teardown does not leave the command line. Note the asymmetry [S2] flags: window layout survives
logout, but "**You cannot restore a tab after you close it**." Persistence is generous at the session
boundary and unforgiving at the tab boundary.

**RELEVANCE TO UCT.** Two UCT personas: the internal desk (2–3 people, same machines daily) and members
(browser, mixed devices). The dashboard already persists a great deal — `charts_workspace_layout`,
`multichart_state`, `calendar_view_v3`, per-widget `opts.settings` — so the *mechanism* exists. The
Bloomberg observation is not "persist things"; it is **what gets restored and when**: window count,
positions, and zoom, automatically, with no "restore session?" prompt. The nearest UCT question is
whether a member returning to `/charts` the next morning lands on the desk they left, including
scroll/zoom state, without being asked.

**CONFIDENCE.** 🟢 for the documented mechanics (two independent Bloomberg documents plus an official
product page). 🔴 for anything about how this *feels* day to day, or whether B-Unit friction annoys
users — no practitioner evidence reachable. Ceiling: a subscriber walkthrough or a screen recording
would raise it; the owner does not appear to have Terminal access.

**RECOMMENDATION (hypothesis).** Workspace restoration is the transferable half; biometric hardware is
not. Hypothesis worth testing on the UCT desk: *a returning user should never be asked to reconstruct
state, and "log off" should be reachable from the same input surface as everything else.* The
anti-pattern to avoid is Bloomberg's own tab asymmetry — a close action that is silently
unrecoverable while its sibling (the window) is fully restored teaches users to fear the close button.

**OPEN QUESTION.** Does Bloomberg restore *content* (the function running in each tab) or only
*geometry* (count, position, zoom)? [S2] enumerates only geometry. If content is not restored, the
"wake-up screens" in [S1] suggest a default-page model rather than a true session resume — a
materially different design, and one closer to what a browser app can cheaply do.

---

## 2. The command line is the whole product surface — Bloomberg says so twice, in those words

**OBSERVATION.** Bloomberg makes an unusually strong and *repeated* design claim: there is exactly one
place to type, and everything in the system is reachable from it.

> "This Autocomplete feature makes the Bloomberg Terminal **entirely discoverable from the command
> line**." — [S1] p.7

> "The Bloomberg Terminal® is **entirely discoverable from the command line**, which appears across the
> top of every screen." — [S2] p.6

The same box accepts **four different kinds of input** and disambiguates by presenting a list:

1. **A function mnemonic** — `WEI <GO>` runs World Equity Indices. [S2] p.13.
2. **A keyword for a function you cannot name** — "if you want a function for analyzing mergers and
   acquisitions, start typing `MERG`… a list of suggested matches appears." Refinable: "you could
   enter `MERGER ACQ`." [S2] pp.6–7.
3. **A keyword or partial identifier for a security** — "if you're looking for a Disney bond with a 7%
   coupon, start typing `DIS 7`… You can further refine the list… by pressing the relevant yellow
   market sector key. For example, you could enter `DIS 7 <Corp>`." [S2] pp.7–8.
4. **A natural-language question** — "Type your query into the command line, then press `<GO>`. For
   example, enter `IBM Q3 2013 REVENUE`." Results land on the **Search Bloomberg (SEARCH)** screen.
   [S2] pp.8–9. [S2] p.20 lists Bloomberg's own example queries verbatim: *"What green bonds were
   issued last year?"*, *"Apple cash per share"*, *"How do I create market alerts?"*, *"Top news on
   bitcoin in Japanese"*, *"Tweets from Elon Musk on space"*, *"3 month implied volatility of FB"*.

Critically, **typing without committing is itself a search**, and committing is the same keystroke as
running: "When you enter a mnemonic in the command line **without hitting `<GO>`**, the matching
function is automatically highlighted on a list of potential functions, securities, and searches. To
run the function, you can click it from the list, or just hit `<GO>` to complete the command." [S2]
p.13, restated at p.8.

There is a **second, heavier search** for when autocomplete is not enough: the `<SEARCH>` key runs
**Help Search (HL)**, which "allows you to search by keyword across all categories of information,
including functions, securities, companies and people" and "groups results by category and
relevance." [S1] p.10. [S2] p.20 describes the same escalation into `SEARCH`.

**EVIDENCE.** [S1] pp.6–10; [S2] pp.6–9, 12–13, 20 — official Bloomberg documentation — **verified**
(direct quotes above). Corroborated at the tutorial tier by Imperial College London ("As you type, the
auto-complete feature suggests functions, securities, and commands"), Yale ("Begin typing a term in the
command line… a list of suggested functions & securities will be displayed"), and John Cabot
University (`SEARCH <GO>`: "Allow to search using natural language"). All fetched 2026-09-02.

**INTERPRETATION.** The design idea worth extracting is **not** "have a command palette". It is that
Bloomberg refused to split the input surface. A ticker, a function name, a half-remembered keyword,
and an English sentence all go in the same box, and the *system* decides which of the four the user
meant, showing its work as a categorised list. The user never has to answer "is this a search or a
command?" — a question every multi-surface app forces on people and which has no good answer when you
half-know what you want. The escalation ladder is: type → autocomplete list → `<GO>` for full SEARCH →
`<SEARCH>` key for HL's categorised sweep. Each rung costs one more keystroke and buys more recall.

Note the second-order property: because *typing is searching*, the expert path and the novice path are
**the same path**. An expert types `WEI<GO>` in four keystrokes; a novice types `MERG` and reads. There
is no "beginner mode" to graduate out of, and no expert shortcut the novice cannot see. That is a
structural answer to the discoverability/speed tradeoff most tools solve with two separate UIs.

**RELEVANCE TO UCT.** UCT already has an AI search layer (`/ai-search`), a predictive ticker
autocomplete (`GET /api/ticker-search`, ranked exact → prefix → substring, with `SymbolSearch.jsx`
consuming it), a voice assistant with page-navigation tools, and route/nav taxonomies in
`navGroups.js`. Those are **four separate doors to "find the thing"**, and the ticker search is
symbol-only — it cannot return a page, a widget, or a saved view. Bloomberg's evidence bears directly
on whether TERMINAL-NEXT should keep them separate. It also bears on `MoreSheet`, which the repo
already treats as "the SINGLE comprehensive directory" — the same instinct, applied to nav rather than
to search.

**CONFIDENCE.** 🟢. Two Bloomberg documents state the discoverability claim in near-identical words,
with worked examples, and three university guides describe the observed behaviour independently.

**RECOMMENDATION (hypothesis).** Test the hypothesis that **one input surface that accepts a ticker, a
page name, a saved view, and a question — and disambiguates with a categorised list — beats four
specialised entry points**, for the desk first. The measurable claim is keystroke count and
misdirection rate, not preference. The anti-pattern Bloomberg avoids and UCT should watch for: making
the fast path invisible to the person who most needs to discover it.

**OPEN QUESTION.** How does Bloomberg rank a list containing a function, a security, and a search
suggestion at once? [S2] shows the mixed list but never states the ranking rule. If ranking is
personalised (recency, role, desk), that is a materially different — and much harder — system than a
static relevance sort, and the two are indistinguishable from the documentation.

---

## 3. The grammar: `TICKER <MARKET SECTOR> FUNCTION <GO>`

**OBSERVATION.** Terminal navigation is a small, strict, learnable **grammar**, not a menu tree with
shortcuts bolted on. Cornell states the canonical form: `TICKER <MARKET> FUNCTION CODE <GO>`.

Each slot is separately documented in Bloomberg's own material:

- **Ticker** — may carry a venue/exchange code. Wikipedia's sourced example `{VOD LN Equity GO}`
  decomposes as ticker `VOD`, venue `LN`, sector `Equity`. Bloomberg's own examples show the same
  shape: `F US <EQUITY> <GO>`, `IBM US <EQUITY> <GO>` ([S1] pp.7, 11, 15).
- **Market sector** — a **yellow key**, not typed text. [S1] p.2: the yellow keys "enable you to:
  Load securities. Example — `IBM US <EQUITY> <GO>` · Access market sector menus. Example — `<CORP>
  <GO>`." One key does double duty: it *types* the sector into a security expression and it *opens*
  that sector's menu when pressed alone.
- **Function** — a mnemonic. "Every function has its own mnemonic, which is a short name used to
  identify and access the function. Mnemonics are designed to make the Bloomberg Terminal® fast and
  provide the most direct way to access a function." [S2] p.13.
- **`<GO>`** — the commit. Green. [S1] p.2: "The `<GO>` or Enter key executes the command typed in the
  command line."

Identifiers other than tickers slot into the same grammar unchanged: `931142DD2 <CORP> <GO>` loads
Wal-Mart by CUSIP ([S1] p.7), and the guide names CUSIP, ISIN and BBGID as accepted.

The grammar composes across asset classes with no new rules ([S1] p.16):

| Command | Loads |
|---|---|
| `SPX <INDEX> <GO>` | S&P 500 index |
| `USURTOT <INDEX> <GO>` | Index tracking the U.S. unemployment rate |
| `EUR <CURNCY> <GO>` | Euro spot |
| `F 12 07/16/31 <CORP> <GO>` | Ford Motor Credit bond, 7.45% coupon, matures 16 Jul 2031 |
| `CL1 <CMDTY> <GO>` | Front-month NYMEX sweet crude futures |

And crucially, **the whole navigation collapses into one line**: `IBM US <EQUITY> GP <GO>` loads the
security *and* runs the price graph in a single command ([S1] p.6).

Bloomberg is explicit that the grammar has a **typed** dimension and will refuse mismatches: "In some
cases, a function that works for one type of security does not work for a different type of security.
For example, the Yield Analysis (`YA`) function allows you to value a bond. If you load an index and
try to run the `YA` function, **an error message appears** because the analysis and security type are
incompatible." [S1] p.16.

**EVIDENCE.** [S1] pp.2, 6–7, 11, 15–16 and [S2] p.13 — official Bloomberg documentation —
**verified**. Cornell University Library guide for the canonical form (Tier: university library guide)
— **verified** quote: `"TICKER <MARKET> FUNCTION CODE <GO>"`. Wikipedia for the venue-code
decomposition and curly-brace notation (Tier: general web, claim carries a citation in the source) —
**reported**. All fetched 2026-09-02.

**INTERPRETATION.** This is the highest-leverage finding in the file. Bloomberg's navigation is cheap
to learn **not because there are few functions** (there are thousands) but because there is **one
sentence shape**. Learning the system means learning four slots; after that, every new function is one
new word in a language you already speak. Two consequences follow:

1. **Vocabulary scales, syntax does not.** Adding the 3,000th function costs the user nothing
   structurally. Compare a navigation model where each new feature is a new tab, a new route, a new
   interaction idiom — there, the 30th feature costs more than the 3rd.
2. **The type system is visible and enforced.** `YA` on an index errors rather than silently rendering
   something wrong. The sector key is not decoration; it is a type annotation the user supplies, which
   is why one key both filters autocomplete and opens a menu.

**RELEVANCE TO UCT.** UCT's surfaces are addressed by **route + query params + persisted prefs**, and
the repo's own history shows the cost: `/calendar` is display-named "UCT Terminal" while the route,
the door key, the widget type key, `/api/calendar/*`, the icon key and three persisted-pref keys all
stay `calendar` — because renaming would wipe saved views. That is a naming layer sitting *on top of*
an addressing scheme, rather than an addressing scheme users can type. A Bloomberg-style grammar would
make `NVDA charts D` a first-class address. The `Number <GO>` idiom (§7) and the composed one-line
command are the two concrete mechanics; the `charts_workspace_layout` → `widgets[].opts.settings`
structure is the nearest existing thing UCT would be addressing *into*.

**CONFIDENCE.** 🟢 for the grammar and its slots (Bloomberg's own worked examples across five asset
classes). 🟡 for the venue-code detail (`VOD LN`), which is Wikipedia-sourced and not restated in
either Bloomberg document I read.

**RECOMMENDATION (hypothesis).** Worth testing: *TERMINAL-NEXT gets ONE typed address grammar —
`<symbol> <surface> <modifier>` — and every surface is reachable by it.* Two guardrails from the
evidence: (a) the type mismatch must **error loudly**, never render an empty or wrong surface — this
is the same failure class as the repo's `CoverageLine` insight, that "we could not compute it" and
"nothing matched" are different facts to a trader; (b) do not ship a grammar and a parallel menu that
can disagree — Bloomberg's menus are a *view over* the same addresses (§4), not a second authority.

**OPEN QUESTION.** How much of the mnemonic vocabulary is *semantically* memorable versus arbitrary?
`DES`/`ERN`/`DVD`/`CN` read as abbreviations; `WEI`/`GIP`/`RELS`/`EQRV` do not, without training.
Bloomberg calls a mnemonic "a short, memorable name" ([S1] p.6) — a **claimed** property, and I found
no evidence testing it. This matters: if memorability is mostly *frequency of use* rather than
etymology, then a small vocabulary drilled daily beats a large well-named one, which is a very
different design instruction for a 100-role program.

---

## 4. The loaded security: context that persists until explicitly changed, scoped per panel

**OBSERVATION.** "Loaded security" is a named, first-class, **per-panel** state — and Bloomberg's
documentation returns to it three separate times to make one point: you set it once.

> "Once you have loaded a security on a panel, it appears in the **loaded security field** on the
> panel's toolbar. You can run a series of functions to analyze the loaded security."
> — [S1] p.7
>
> "The loaded security **remains the active security on the panel until you load a different
> security**." — [S1] p.7
>
> "Once you load a security, you can run **any number of functions** to analyze that security
> **without having to reenter the security**." — [S1] p.15

Loading is not passive. Loading a security **is itself an act of function discovery**: "The security
appears as the loaded security in the active panel's toolbar **and a categorized menu of
security-specific analysis functions appears**." ([S1] p.7, repeated p.8.) [S2] p.10 makes it one of
the three canonical routes into the menu system: "**Loading a Security:** To access the menu of
functions for analyzing a specific security, simply load the security."

Bloomberg divides all functions on exactly this axis ([S1] p.6, [S2] p.12):

- **Non-security functions** — "provide information or analysis on an entire market sector and do not
  require a loaded security." Example: `WEI`.
- **Security-specific functions** — "analyze a loaded security." Example: `GP` — "you must specify a
  security before graphing its price."

The toolbar exposes the context and its history: "The left side of the grey toolbar includes the menu
button and **drop-down lists of recently loaded securities and function mnemonics**, with the current
loaded security and currently function mnemonic visible." ([S2] p.18; [S1] p.5 describes the same for
the classic panel toolbar.)

Scope is the subtle part. The context is bound to **the panel**, not the session — [S1] says "on a
panel" and "the active panel's toolbar" consistently. Four panels can hold four different loaded
securities simultaneously; that is precisely what makes four panels useful for comparison rather than
merely for more screen area.

**EVIDENCE.** [S1] pp.5–8, 15; [S2] pp.10, 12, 14–15, 18 — official Bloomberg documentation —
**verified**. Imperial College London corroborates independently at the tutorial tier: "The loaded
security remains active on the panel until you load a different one" and the toolbar's "drop-down list
of recently loaded securities". Fetched 2026-09-02.

**INTERPRETATION.** Bloomberg separated **two things most tools fuse**: *what am I looking at* (the
security) and *how am I looking at it* (the function). Because they are separate, either can change
without disturbing the other, and the expensive one — identifying the instrument — is paid once. The
economic argument is plain: an analyst runs 10–20 functions against one name in a sitting; re-entering
the name each time is 10–20 wasted acts.

The per-panel scoping is the sophisticated part and easy to miss. A **session-global** loaded security
would make comparison impossible (every panel would follow). A **per-function** security would destroy
the "set once" benefit. Per-panel is the only choice that gives you both, and it makes the panel — not
the window, not the session — the unit of analytical context. Note this is a *manual* linkage model:
panels are independent by default and the user chooses which one to change. Bloomberg's *automatic*
linkage lives in Launchpad's component groups (B-BBG-02's scope), where changing a ticker in one
component propagates to linked components — a deliberately different, opt-in mechanism layered on top.

**RELEVANCE TO UCT.** UCT has already built the *same idea* and given it a different name: `/charts`
**colour groups A/B/C/D**, where "A widget assigned color A reads/writes `groupSyms.A`; multiple
widgets on the same color stay in lockstep", exposed via `WorkspaceContext.setGroupSym`. That is
per-group loaded-security context, and the `ChartsSymContext` shim (explicit Provider →
WorkspaceContext Group A → null) is the resolution order. Bloomberg's model is the same shape with two
differences worth examining: (a) Bloomberg's default is **independent-until-linked**, UCT's is
**grouped-by-assignment**; (b) Bloomberg surfaces the loaded security **as a labelled field in the
toolbar with a recents drop-down**, whereas UCT's widget header deliberately hides its label
(`WidgetHeader` "Label is visually hidden (sr-only) — color dot + body content identify the widget").
The colour dot carries the whole affordance. Whether that is sufficient at four groups is an open
design question the Bloomberg evidence sharpens but does not settle.

**CONFIDENCE.** 🟢 for the concept, its per-panel scope, and the recents drop-down — Bloomberg states
each at least twice, and Imperial corroborates. 🟡 for exactly what happens when a security-specific
function is run with *no* security loaded: [S1] says you "must" load one first, but neither document
shows the failure mode.

**RECOMMENDATION (hypothesis).** The transferable claim is **"identify the instrument once per
context, then change only the lens"**, plus **make the context visible and its history one click
away**. Hypothesis for the desk: a persistent, *labelled* current-symbol field with a recently-loaded
drop-down reduces mis-targeted actions versus a colour dot alone. The anti-pattern: a global current
symbol — it forecloses side-by-side comparison, which is most of why a multi-pane workstation exists.

**OPEN QUESTION.** When a user loads a security in panel 2, does any state in panel 1 change — a
recents list, a "last touched" marker, an alert scope? [S1] and [S2] both describe panels as
"independent workspaces" but neither says whether *recents* is per-panel or session-wide. If recents
is shared, the panels are less independent than advertised, and that shared list is a quiet
cross-panel channel worth understanding before copying the model.

---

## 5. Menus: a hierarchy that is a *view over* the command grammar, not a second authority

**OBSERVATION.** Bloomberg's menu system exists for one job — browsing what you cannot name — and it
is carefully built to be the same system, not a parallel one.

> "All Bloomberg functions are organized by menus that are classified by market sector or product
> type. Each menu is part of a hierarchy, going from the individual functions up to the Bloomberg Home
> menu." — [S1] p.11

Sample paths, verbatim from [S1] p.11:

- `Main Menu > Equities > Analyze FORD MOTOR CO Equity > Company Analysis > Financial Analysis > FA`
- `Main Menu > News & Research > TOP`

Note what those paths end in: **a mnemonic**. The menu's leaf *is* the thing you would have typed. The
menu teaches the grammar rather than substituting for it.

**Exactly three doors into menus** ([S1] p.11, [S2] p.10):

1. **Yellow key** — `<EQUITY> <GO>` browses the Equities menu; `<Curncy> <GO>` opens the top-level
   Currency Markets menu, from which you "drill down into the Price Discovery category… then select a
   function, such as `WCR` World Currency Rates."
2. **Loading a security** — the categorised menu appears automatically (§4).
3. **Menu button / `<MENU>` key** — "From any function, click the Menu button on the toolbar or press
   the `<MENU>` key to access a menu of related functions. Once you access the menu, click or press
   the `<MENU>` key again to **move up to the next menu in the hierarchy**." [S1] p.11.

Supporting mechanics:

- **Breadcrumbs.** "These show your path in the overall menu hierarchy and enable you to navigate
  backward and forward." [S1] p.12.
- **`<CANCEL>` X** closes the menu, upper right. [S1] p.12.
- **Function shortcuts.** "On menus, functions with shortcuts are identified by a shortcut icon (white
  arrow). To display a list of all shortcuts for a function, click the corresponding shortcut icon…
  For some functions, you can enter a shortcut command to directly access a specific view or version
  of the function." [S2] p.11. So a menu entry can expand into *addresses for sub-views* — the
  grammar reaching one level below the function.
- **Suggested Functions** — a distinct panel region in the Tabbed-Windows layout: "Shows you
  intelligent function recommendations **based on the asset class of your loaded security and your
  current workflow**, with brief hints to let you know why the functions could be valuable to you. For
  any suggested function, you can click to see a fuller description for more information or launch a
  tour or Help Page for a deeper dive, **without interrupting your current workflow**." [S2] p.18.

**EVIDENCE.** [S1] pp.11–12; [S2] pp.9–11, 18 — official Bloomberg documentation — **verified**
(direct quotes). Michigan Ross characterises the whole system as "a menu driven system consisting of
hundreds of analysis functions identified by unique mnemonics" (Tier: university library guide) —
**reported**. Fetched 2026-09-02.

**INTERPRETATION.** Three design decisions stand out.

First, **the menu and the command line are one system with two front ends.** The menu's leaves are
mnemonics; the mnemonics are what the command line takes. A user who browses is being trained, every
time, in the faster path. This is the opposite of the common pattern where a GUI and a CLI drift into
two vocabularies that disagree — the exact "second authority over one value" failure the UCT repo has
paid for repeatedly.

Second, **`<MENU>` is a "zoom out" key, not a "back" key.** Pressing it repeatedly walks *up the
hierarchy* toward Home — a spatial operation over the function tree — while `<End/Back>` walks
*backward through your history* (§7). Those are genuinely different operations and Bloomberg gave each
a physical key. Most applications collapse both into one back button and lose the ability to ask "what
else is near this?"

Third, **Suggested Functions is contextual discovery with a preview that does not cost you your
place.** It is keyed to *both* the loaded security's asset class *and* the current workflow, it
explains **why** each suggestion is relevant, and it offers description / tour / Help Page inline. The
"without interrupting your current workflow" clause is the load-bearing part: discovery that costs you
your context is discovery most users decline.

**RELEVANCE TO UCT.** UCT's `MoreSheet` is already positioned as "the SINGLE comprehensive directory
(sectioned Core/Markets/Trading/Help/Account…)" and the repo enforces one-menu discipline ("one menu
(`MoreSheet`), and every trigger opens THAT — don't reintroduce a second nav surface"). That is the
same instinct as Bloomberg's single hierarchy. Where the evidence adds something: (a) UCT's menu leaves
are **routes**, not typeable addresses, so browsing does not teach a faster path — there is no faster
path to teach; (b) UCT has no "zoom out to related surfaces" operation distinct from browser-back; (c)
the widget-add flow on `/charts` reads from `WIDGET_REGISTRY` (metadata + menu membership) which is
structurally the right place to hang a "suggested widgets for this symbol's asset class" surface, if
the program ever wants one.

**CONFIDENCE.** 🟢 for the three menu doors, breadcrumbs, and the `<MENU>`-walks-up semantics.
🟡 for Suggested Functions: it is described precisely in [S2] but I have **no** evidence of how good
the recommendations are, how they are generated, or whether users engage with them. A described
feature is not a working one.

**RECOMMENDATION (hypothesis).** Two separable hypotheses. (1) **Menu leaves should be the same
addresses the fast path uses**, so browsing is training — cheap to test the moment a grammar exists.
(2) **Contextual suggestions must be previewable in place**; a suggestion that requires navigating
away to evaluate is a suggestion most users skip. Anti-pattern flagged by [S2] itself: Bloomberg had
to add a preference (`PDFU`) to *revert* `<Menu>` and `<End/Back>` to their old behaviour (§7) — even
Bloomberg could not change a navigation key's meaning without offering the old one back.

**OPEN QUESTION.** Are Suggested Functions rule-based (asset-class lookup tables) or learned (from
this user's or the population's sequences)? [S2]'s phrase "your current workflow" implies sequence
awareness, but the document never says. The two have wildly different build costs and wildly different
failure modes, and the documentation cannot distinguish them.

---

## 6. Help is a physical key, and its second press is a human being

**OBSERVATION.** Bloomberg spent a dedicated key on help, and overloaded it with a second press that
escalates from *documentation* to *a person*.

> "From any function, you can press the `<Help>` (F1) key **once** to see a user guide for the
> function, or **twice** to start a live chat with the Bloomberg Help Desk." — [S2] p.4
>
> "Click on the Help button **once** to access a help page; click on it **twice** to access the Help
> Desk." — [S1] p.2

**Help Pages** are per-function and substantial: "online user guides designed to help you find fast
answers, discover new business solutions, and get more from the Bloomberg Terminal®. A function's Help
Page provides information specific to that function. This includes an explanation of the **business
solution the function provides** along with how-to instructions, definitions, **calculations**, and
links to related documents and videos." [S2] p.19. They are exportable: a **Generate PDF** button
offers "Generate PDF of Full Help Page" or "Select Sections to Generate PDF." [S2] pp.19–20.

**The Help Desk** is "available 24 hours a day, seven days a week." [S2] p.21.

Escalation does not stop there. `<ESC/CANCEL>` doubles as a **contact page**: "Exit the current
function and return to a home page that displays important contact information, so you can easily
reach your Bloomberg representative, the Help Desk, or the Tech Support Team." ([S2] p.16; [S1] p.21
lists the same links plus "Contact Us (a list of all local Global Customer Support numbers)" and "Your
Account Manager and Product Representative (simply click on the rep's name)".)

Two more help-adjacent addresses: `TRAI <GO>` to "request personalized training with an Analytics
Specialist", and `BNEW <GO>` "to learn about new functionality and enhancements relevant to your market
focus." [S2] p.19.

**EVIDENCE.** [S1] pp.2, 14, 16, 21; [S2] pp.4, 16, 18–21 — official Bloomberg documentation —
**verified**. Corroborated at the tutorial tier by UIUC, Seton Hall, Yale, Cornell and UCD, all of
which independently describe the once/twice behaviour. Fetched 2026-09-02.

**INTERPRETATION.** The design claim is that **help is not a destination, it is a modifier on wherever
you already are**. `<HELP>` pressed inside `EQS` gives you `EQS`'s guide; [S1] p.14 makes this explicit
as the recommended way to learn a complex function: "To access a complete guide to using EQS, press the
green `<HELP>` key once from within the EQS function."

Three details matter more than the key itself. (a) Help Pages document **calculations**, not just
controls — for a financial tool, "what does this number mean and how was it derived" *is* the help
question, and Bloomberg answers it in the same place as "where do I click". (b) The **double-press
escalation to a human on the same key** means the user never has to find a support channel; the
gesture that asks the machine, pressed again, asks a person. (c) Help output is **exportable to PDF**,
which is how a workflow gets shared with a colleague who does not have the screen open.

**RELEVANCE TO UCT.** UCT has a `FeedbackWidget` "?" button (bottom-left, auto-hiding on scroll),
`/support` tickets with chat, and an AI search layer. What it does not appear to have is
**per-surface, context-aware help that documents the calculation**. The dashboard is full of derived
numbers where that would bite: the UCT Exposure Rating's 0–150 scale and its bonus tiers, the
7-criteria candle score, `up_vol_ratio` (memory records it is up÷DOWN — exactly the kind of definition
a help page owns), COT Index zones, `portfolio_heat`'s risk-heat vs notional distinction and its
placeholder-stop exclusion. Each is a place where "what is this number" is the real question. The
double-press-to-human idea maps cleanly onto UCT's existing Discord + support ticket rails.

**CONFIDENCE.** 🟢 for the mechanics — this is the single most-corroborated item in the file (both
Bloomberg documents plus five independent university guides). 🔴 for quality and usage: I have no
evidence on Help Desk response times, satisfaction, or how often users actually press twice.

**RECOMMENDATION (hypothesis).** Hypothesis worth testing on the desk: **context-sensitive help that
documents the calculation, reachable by one consistent gesture from any surface, with a second gesture
that reaches a human.** For UCT the derived-metric definitions are the highest-value content and they
already exist in scattered form (CLAUDE.md, memory files, docstrings) — the gap is a surface, not the
content. Anti-pattern: a global help page listing every feature. Bloomberg's help is *per function*
precisely because a global page cannot answer "what is this number on this screen".

**OPEN QUESTION.** How does Bloomberg keep thousands of per-function Help Pages current as functions
change? Nothing in either document addresses authorship or staleness. This is the question that decides
whether the pattern is affordable for a small desk: per-surface help that drifts is worse than none —
the same failure the UCT repo has repeatedly recorded as documented-but-unreachable features teaching
the wrong idiom.

---

## 7. Keyboard: colour is a type system, and every clickable thing has a keyboard address

**OBSERVATION.** The Bloomberg keyboard encodes **what a key does** in its colour, and the scheme is
consistent enough that Michigan Ross states it as a rule: **"Red keys = stop functions · Green keys =
action commands · Yellow keys = market sectors."** [S1] p.2 introduces the same triple: "The **red stop
keys, green action keys and yellow market sector keys** help you access information quickly and easily."

Assembled inventory (Bloomberg documents first; university guides where Bloomberg's own key-table
images did not survive text extraction):

| Key | Colour | Documented behaviour | Source |
|---|---|---|---|
| `<GO>` / Enter | green | "Execute a typed command. For example, to access the Top News function, type `TOP`, then press `<GO>`." | [S2] p.16 |
| `<MENU>` | green | "Open a menu of related functions, then navigate **up** through the menu hierarchy to the Home menu." | [S2] p.16 |
| `<End/Back>` | green | "Navigate back to the previous screen, so you can **retrace your function history**." | [S2] p.16 |
| `<HELP>` (F1) | green | Once → Help Page; twice → Help Desk chat | [S1] p.2, [S2] p.16 |
| `<SEARCH>` | green | "Enables keyword search of the entire Bloomberg database" → runs `HL` | [S1] pp.2, 10 |
| `<PRINT>` | green | Print current page; prefix a number for multiple screens | Seton Hall |
| `<ESC/CANCEL>` | red | "Exit the current function and return to a home page that displays important contact information" | [S1] p.2, [S2] p.16 |
| Logoff / Pause-Break | red | Log out of the account | Cornell, UCD |
| `<GOVT>` F2 · `<CORP>` F3 · `<MTGE>` F4 · `<M-MKT>` F5 · `<MUNI>` F6 · `<PFD>` F7 · `<EQUITY>` F8 · `<CMDTY>` F9 · `<INDEX>` F10 · `<CURNCY>` F11 | yellow | "Load securities and access market sector menus" | [S2] p.16; UIUC, Seton Hall, UCD |
| `<PANEL>` | blue | "Cycle through the tabs in all of your windows" / "Advances through Bloomberg windows" | [S2] p.16; [S1] p.5 ("the blue `<PANEL>` key"); UCD |
| `<CMND HISTORY>` | — | "Cycle through past command line entries" / "Displays function history/last run command" | [S2] p.16; UCD |
| Favourites/Codes | — | Dedicated key for codes and favourites | UCD |
| `<NEWS>`, `<MSG>`, `<IB>`, `<QUOTE>` | — | Direct keys for news, mail, chat, quotes | UCD |

**Two source conflicts, reported rather than resolved:**

1. **F12.** UIUC says `PORT` (portfolio and risk management); Seton Hall says `CLIENT`; [S1] p.2's
   yellow-key list in other Bloomberg materials includes `<People>`. Wikipedia documents multiple
   keyboard generations (SEA100 ≈3 kg with 3 mm key travel; current "Starboard"/Keyboard 4 at 1.08 kg
   with "flatter, chiclet-style keys"). **Interpretation: the F12 disagreement is generational, not an
   error in any one guide.** Do not treat any single key list as canonical.
2. **`<MENU>`'s meaning.** [S2] p.16 says it opens a menu and walks *up* the hierarchy; UCD, Michigan
   Ross, Cornell and Seton Hall all describe `<MENU>` as "back" / "return to the previous screen".
   **[S2] resolves this itself** and the resolution is the finding: *"You can **revert** the function
   of the `<Menu>` key to the **old** Bloomberg Terminal® keyboard behavior. For more: PDFU Help Page >
   Back/Menu Preferences."* — with the identical note attached to `<End/Back>`. The guides are
   describing the legacy behaviour; Bloomberg changed the semantics and **shipped a preference to
   restore the old one.**

**Keyboard-only operation is a design goal, not a fallback:**

- **`Number <GO>`** — "Number `<GO>`s appear next to some clickable list items and allow you to quickly
  navigate a function with your keyboard by entering the number, then hitting `<GO>`." ([S2] p.14; [S1]
  p.13: "Typing in the number next to an option allows you to quickly navigate within the function
  using only your keyboard.") Every list row has a keyboard address.
- **Alt-Mode** — "You can also use your keyboard to identify clickable items that do **not** have
  number `<GO>`s by using **Alt-Mode**." [S2] p.14.
- **`<Alt>`+`K`** — "For a complete view of the keyboard, hold down the `<Alt>` key and press K. To
  dismiss the keyboard image, press the K key again." [S2] p.16. *The keyboard reference is itself a
  keyboard shortcut.*
- **`<Alt>`+`D`** → Terminal Settings; **`<Ctrl>`+`N`** → new window. [S2] p.23.
- **Standard keyboards are supported.** [S2] p.15: "If you are using a standard keyboard (e.g., when
  working from home), you can use shortcuts and commands to quickly access a variety of Bloomberg
  features." Seton Hall is blunter: "it is not necessary to have a special Bloomberg provided
  keyboard." The F2–F12 mapping is what makes the special keyboard optional.

**Screen affordances are also colour-typed** ([S1] p.13, [S2] p.14): a **red toolbar** at the top of
each function carries its title, drop-downs and a page-count indicator; **amber fields** mark
everything editable ("editable form elements, text and data input, and drop-down lists"); a **white
outline box** on hover marks most clickable items.

**EVIDENCE.** [S1] pp.2, 5, 13; [S2] pp.14–16, 23 — official Bloomberg documentation — **verified**.
University of Illinois, Seton Hall, Cornell, UCD Smurfit interactive keyboard, Michigan Ross — Tier:
university library guides — **verified** for the key inventory they state, with the F12 conflict noted
above. Wikipedia for keyboard generations and the green-`GO`/red-`Cancel` design rationale — Tier:
general web, cited in source — **reported**. All fetched 2026-09-02.

**INTERPRETATION.** Colour is doing real work: it is a **type system rendered in hardware and pixels**.
Before reading a single label, a user knows a red key is destructive/exit, a green key acts, a yellow
key declares an asset class, and an amber field is the only thing on screen they can change. That last
one is quietly the most valuable — "which of these 200 numbers can I edit?" is answered by colour
alone, on every screen, without a hover or a click.

`Number <GO>` deserves separate emphasis. It means the mouse is **never required** — not "there are
shortcuts for common actions", but *every list item is addressable by keyboard*. Combined with
Alt-Mode for unnumbered items, the claim is total keyboard coverage. That is what makes the muscle
memory real: a user's hands can stay on the keys through an entire multi-step analysis.

And the `PDFU` revert preference is the finding a program of ~100 roles should internalise: **Bloomberg,
with unmatched leverage over its users, could not change what two navigation keys meant without
shipping the old behaviour as a toggle.** Muscle memory is not a preference to be migrated; it is
installed state in a person.

**RELEVANCE TO UCT.** The repo already carries scar tissue in exactly this area: `lesson_two_commands_one_physical_key` (latch `event.code`, guard `e.repeat`), and the calendar-modal finding that "changing a control's AXIS promotes a latent key conflict (`preventDefault()` does not stop window)". UCT also has real colour semantics already — the 8-tier breadth heat map, gold `UIcon` embossing, review-status pills, the 4 chart colour groups — but they encode *values*, not *interaction types*; there is no "this element is editable" colour. The `Number <GO>` idiom has no UCT analogue at all: the screener rows, watchlist rows, catalyst rows, scan results and calendar cards are all mouse-addressed. Watchlists' arrow-key navigation (`visibleSymsFlat`, `data-watch-sym`, `scrollIntoView({block:'nearest'})`) is the closest existing thing and is scoped to one page.

**CONFIDENCE.** 🟢 for `Number <GO>`, Alt-Mode, Alt+K, Alt+D, Ctrl+N, the colour triple, amber fields,
and the standard-keyboard fallback — all direct Bloomberg quotes with multiple corroborations.
🟡 for the exact per-generation key inventory (documented conflict, above). 🔴 for whether keyboard-only
operation is what practitioners *actually* do all day — that is a behavioural claim and my community
tier is unreachable.

**RECOMMENDATION (hypothesis).** Three separable hypotheses, in descending confidence that they
transfer: (1) **every list row on a dense surface should have a keyboard address**, and this is testable
on one UCT surface (the screener or watchlists) before generalising; (2) **a colour should mean an
interaction type, not only a value** — UCT currently has no "editable" affordance colour, and adding
one is cheap; (3) **never silently change what a key does** — if TERMINAL-NEXT rebinds anything, ship
the old binding as a preference, because Bloomberg had to.

**OPEN QUESTION.** What fraction of Bloomberg actions are actually performed by keyboard versus mouse?
Every source describes keyboard *capability*; none measures keyboard *use*. If real usage is
mouse-dominant, then the keyboard architecture is a promise more than a practice, and the transferable
lesson shrinks considerably. This is the single question I would most want a practitioner interview to
answer.

---

## 8. Command history, back, and favourites: three different kinds of "where was I?"

**OBSERVATION.** Bloomberg distinguishes at least three retrace mechanisms and gives each its own
affordance.

- **`<End/Back>` key** — "Navigate back to the previous screen, so you can **retrace your function
  history**." [S2] p.16. Screen-level, one step at a time. Cornell notes the on-screen equivalent:
  arrows in the upper-left "function more like the forward and back buttons in a web browser."
- **`<CMND HISTORY>` key** — "**Cycle through past command line entries.**" [S2] p.16. UCD's keyboard
  reference lists it as "Displays function history/last run command." Wikipedia adds, with a citation,
  that the History key "retrieves previously used commands **in reverse chronological order**".
  Input-level, not screen-level: this replays *what you typed*.
- **`LAST <GO>`** — "Display the last few commands you ran." History is *also* addressable as a
  function, so it is scriptable, shareable and reachable without the special keyboard. (NYU and John
  Cabot both document it.)

**Favourites and recents** are toolbar-resident, not buried:

- [S1] p.5: the toolbar's right side "features icons to help you perform key tasks, including
  exporting data, **viewing favorite places and securities**, accessing Help and adjusting your
  defaults and display."
- Imperial College corroborates: top-right icons give "quick access to useful tools" including data
  export, **favorites**, and help.
- UCD's keyboard reference lists a dedicated **"CODES and FAVOURITES"** key.
- Recents live in the toolbar too, as **two** drop-downs: "drop-down lists of **recently loaded
  securities and function mnemonics**" ([S2] p.18) — i.e. *what* you looked at and *how* you looked at
  it are recalled separately, exactly mirroring the security/function split of §4.

Related clipboard-style verbs surfaced by university guides (not restated in [S1]/[S2], so **reported**
not verified): `STO <GO>` "Saves the last security for pasting to another screen" and `RCL <GO>`
"Pastes the last security to another screen"; `GRAB <GO>` "Email a screenshot of the current page."

**EVIDENCE.** [S1] p.5; [S2] pp.16, 18 — official Bloomberg documentation — **verified**. UCD Smurfit
interactive keyboard, Imperial College London, NYU, John Cabot University, Cornell — university library
guides — **verified** for what they state. Wikipedia (reverse-chronological history) — **reported**.
All fetched 2026-09-02.

**INTERPRETATION.** The three mechanisms answer three genuinely different questions and Bloomberg
refused to merge them: *"take me back one screen"* (`<End/Back>`), *"what did I type?"* (`<CMND
HISTORY>` / `LAST`), and *"where do I always go?"* (favourites). A single back button answers only the
first. The command-history one is the interesting case because it operates on **text you can edit
before re-running** — you can recall `IBM US Equity GP`, change the ticker, and go. That is a different
capability from replaying a navigation event, and it is only possible because navigation is text in the
first place (§3). Splitting recents into *securities* and *functions* is the same insight applied to
recall: because loading and analysing are separate acts, remembering them separately is more useful
than one interleaved list.

**RELEVANCE TO UCT.** UCT has recents-like state in several places (`localStorage['charts_mobile_sym']`,
the flagged list, watchlists, `charts_workspace_groups`) but no unified recall, and — because
navigation is not text — no editable command history at all. The Bloomberg split maps onto UCT's
existing symbol/surface distinction: a "recent symbols" list and a "recent surfaces" list would be two
different useful things. Favourites already exist in effect (flagged tickers, saved screens, named grid
layouts stored as `/api/charts/layouts` rows with `layout.kind='multichart'`) but are scattered across
surfaces rather than reachable from one toolbar affordance.

**CONFIDENCE.** 🟡 overall. 🟢 that the three mechanisms exist and are distinct (all in [S2]'s own key
table, corroborated). 🟡 on favourites' actual capabilities — [S1] names the icon and Imperial confirms
it, but neither document describes how a favourite is *created*, what can be favourited, or whether
favourites sync across machines. `STO`/`RCL`/`GRAB` are 🟡 (secondary-tier only).

**RECOMMENDATION (hypothesis).** Worth testing: **separate "back", "what I typed", and "what I always
use" rather than collapsing them into browser history plus a bookmarks page.** The editable
command-history recall is the highest-value piece for a trading desk — recall the last command, change
the ticker, run — and it is *only available if navigation is text*, which makes it an argument for §3's
grammar rather than an independent feature. Favourites and recents belong on a persistent toolbar, not
in a menu.

**OPEN QUESTION.** Can a Bloomberg favourite be a *composed command* (`IBM US Equity GP`) or only a
security or a function? The toolbar phrase "favorite **places and securities**" hints at both — "places"
is doing unexplained work — but no source I reached defines it. If a favourite can capture a full
address, favourites become a lightweight saved-view system, which is a much larger claim.

---

## 9. Panels → Tabbed Windows: the display model changed, and both models still exist

**OBSERVATION.** Bloomberg runs **two display models**, and the two Bloomberg documents I read
describe different ones — which is itself the finding.

**Classic (four panels)** — [S1] pp.4–5:

> "When you first log in to Bloomberg, **up to four Bloomberg panels** appear. The panels are
> **independent workspaces** that enable you to multi-task within the Bloomberg system. You can move
> from one panel to another using the blue `<PANEL>` key on the keyboard or by clicking on the specific
> panel you want from the Windows taskbar."

Each panel has three regions: **Toolbar** (menu tab, recently-loaded-securities drop-down, current
loaded security; right side: export, favourites, help, defaults/display), **Command line**, and
**Function area**.

**Tabbed Windows** — [S2] pp.17, 23:

> "The Bloomberg Terminal® delivers news, data, and analytics in **up to 16 screens**. Each screen
> works independently, so you can access multiple analyses and workflows simultaneously."

- **Tabs**: "Each tab displays the mnemonic and the function currently running in the tab." (The tab
  label *is* the address — consistent with §3 and §5.)
- **Switching**: the `<PANEL>` key is redefined to "Cycle through the tabs in all of your windows."
- **Zoom controls**, including a **presentation mode** that "maximizes your window and increases the
  zoom to display the content at the maximum window size."
- **Options menu** for window management, settings, and log off.
- **Enabling it**: "Options > Terminal Settings. Alternatively, press `<Alt>`+`D`… Under Window
  Settings, select **Tabbed Windows**." New window: `<Ctrl>`+`N`.
- **Persistence**: "the Terminal preserves the number of open windows, their locations, and zoom sizes
  for your next login. To log off, instead of closing windows, enter `OFF <GO>`."
- **Irreversibility**: "You cannot restore a tab after you close it." / "Once you close a window, you
  cannot restore it."
- Guide: `BTAB <GO>` → "Tabs and Windows", "Sizing and Zoom", "Deleting Tabs/Windows".

The Tabbed-Windows panel layout also adds the **Suggested Functions** region (§5) that the classic
panel does not have ([S2] p.18).

**EVIDENCE.** [S1] pp.4–5; [S2] pp.17–18, 23 — official Bloomberg documentation — **verified**
(direct quotes). Yale corroborates the classic model ("4 individual panels or windows will open",
`PANEL` key to switch). Bloomberg's own Terminal-Essentials page (Oct 2024) chapters "Terminal Window:
Anatomy and Tabs" — **verified** as page text, indicating tabs are the current teaching model. All
fetched 2026-09-02.

**INTERPRETATION.** Bloomberg migrated from a **fixed 4-panel** model to a **flexible up-to-16 tabbed**
one and **kept both**, with the old one reachable as "the classic panel display" and the new one behind
a settings toggle. Combined with the `PDFU` key-behaviour revert (§7), a pattern emerges: *Bloomberg
ships change as an opt-in preference beside the old behaviour, not as a replacement.* For a product
whose value is partly muscle memory, that is coherent rather than timid.

The fixed-4 model has a real property worth naming: **four panels is a constraint that produces a
layout.** You cannot accumulate 30 tabs; you must decide what the four things are. The 16-tab model
trades that discipline for flexibility, and Bloomberg's answer to "but now I have to arrange things" is
Launchpad (B-BBG-02) — a *third* model layered on the other two. Three coexisting display models is a
lot of surface area, and is probably the honest cost of forty years of not breaking anyone's habits.

Two smaller details are directly transferable. **Tab labels carry the mnemonic**, so a row of tabs is a
row of addresses — you can read your workspace. And **presentation mode** is a first-class control,
acknowledging that these screens get shown to other people.

**RELEVANCE TO UCT.** UCT's `/charts` is a `react-grid-layout` workspace with `cols={12}`,
`FIXED_ROWS=20`, `maxRows={20}` and `overflow:hidden` on the body — a **viewport-locked, no-outer-scroll
grid**, which is philosophically the *fixed-panel* model: you cannot accumulate infinite widgets, you
must choose. Multi-Chart grid mode adds presets 1x2→4x4 with `GRID_MAX_CELLS=16` — the same ceiling
Bloomberg's tabbed model uses, arrived at independently and perf-validated ("16 cells framed in ~900ms,
+63MB heap"). UCT persists working state to `multichart_state` and named grids to `/api/charts/layouts`
with `layout.kind='multichart'`. So UCT already has: a fixed-frame model, a 16-cell ceiling, named
saved layouts, and layout persistence. What it lacks relative to Bloomberg: labels that are addresses
(`WidgetHeader`'s label is deliberately sr-only), a presentation mode, and — notably — UCT **removed**
its bottom `MobileTabBar` on 2026-09-01 for the same reason Bloomberg's classic panels constrain: the
58px "belonged to the chart".

**CONFIDENCE.** 🟢 for both display models, the 16-window ceiling, the toggle path, persistence, and
the close-irreversibility — all direct quotes from Bloomberg documents. 🟡 on which model is *default*
for a new 2026 subscriber: [S2] (2022) frames tabbed as current and four-panel as "classic", and the
Oct-2024 official page teaches tabs, but neither states the default.

**RECOMMENDATION (hypothesis).** Two hypotheses. (1) **A constrained frame beats unbounded
accumulation** for a daily-use workstation — UCT's viewport-lock already bets this way and the
Bloomberg classic model is corroborating evidence, not proof. (2) **Tab/pane labels should be
addresses**, so the workspace is readable at a glance; this is in direct tension with UCT's current
sr-only-label decision and is worth an explicit A/B rather than an argument. Anti-pattern to avoid:
Bloomberg's unrecoverable tab close. UCT's `charts_workspace_layout` persistence makes an undo
affordable, and "close is undoable" is a cheap trust win.

**OPEN QUESTION.** With Tabbed Windows, is the **loaded security scoped per tab or per window**? §4's
per-panel scoping is documented only for the classic model. If 16 tabs share one window's loaded
security, the context model is materially different from four independent panels — and this is exactly
the kind of detail that decides whether UCT's colour-group model is a good analogue or a false friend.

---

## 10. Getting productive: a named on-ramp, and a discovery surface tied to today's market

**OBSERVATION.** Bloomberg does not leave onboarding to documentation. It ships a **course**, a
**resource centre**, a **cheat-sheet system**, a **human trainer booking**, and — most interestingly —
**discovery driven by current events**.

**Bloomberg Market Concepts (BMC)** — [S1] p.20, official:

> "an **8-hour, self-paced e-learning course** that provides a visual introduction to the financial
> markets and **covers more than 70 Terminal functions**. BMC consists of **four modules — Economics,
> Currencies, Fixed Income and Equities** — woven together from Bloomberg data, news, analytics and
> television."

Outcomes claimed: "Familiarize yourself with more than 70 Bloomberg Terminal functions", "Receive a
certificate of completion", "Demonstrate your comfort with the gold standard data platform." Access:
"Type `BMC` into the command line." (Per-module hours — Economic Indicators ~1h, Currencies ~1h, Fixed
Income ~3h, Equities ~3h — appear in university guides via search snippets, **not fetched**; treat as
**reported**.)

**The discovery/training address space** (each verified in at least one Bloomberg document or a fetched
university guide):

| Address | What it is | Source |
|---|---|---|
| `BMC` | The certification course | [S1] p.20, 22 |
| `BPS` | "Bloomberg Terminal Resource Center homepage with links to training resources, including training documents and video tutorials" | [S1] p.21; also NYU, John Cabot |
| `BU` | "Search for, enroll in and launch a wide variety of webinars and training resources"; also "click the Access Training Documents link" for **cheatsheets by security type** | [S1] pp.16, 22 |
| `BHL` | "Visit the Bloomberg Help and Learning Center" | [S1] p.22 |
| `HELP <GO>` | "an online user guide to the overall logic and navigation of the Bloomberg Terminal" | [S1] p.21 |
| `TRAI` | "request personalized training with an **Analytics Specialist**" | [S2] p.19 |
| `BNEW` | "learn about new functionality and enhancements **relevant to your market focus**" | [S2] p.19 |
| `USER` | "a more comprehensive list of **more than 150 targeted functions** for students" | [S1] p.22 |
| `FFM` | **"Functions for the Market"** — worked examples applying functions to *current* market events | John Cabot (fetched); Bloomberg's own FFM series page |
| `STOP` | "Cancel as a function" — the navigation help page itself is addressable | [S2] title page |

`FFM` is the standout. John Cabot describes it as "Examples demonstrating Bloomberg function
applications to market events"; Bloomberg's own FFM series exists publicly. **Discovery is pegged to
what happened today**: rather than "here are 40 functions", it is "here is the move, and here are the
functions that explain it."

**The learning curve itself.** Bloomberg's own materials concede difficulty only implicitly — by
shipping an 8-hour course, cheat sheets, a resource centre, a 24/7 help desk and a trainer-booking
function for a product whose command line they describe as making everything "entirely discoverable".
That gap between "entirely discoverable" and "here is an 8-hour course" is the most honest evidence I
have about the curve.

**Direct evidence on the curve is where my sourcing fails.** reddit.com is blocked to this agent's user
agent; wallstreetoasis.com and g2.com returned 403. The one practitioner voice I reached is Olivier
Gillier (investment strategist, co-founder RioBlanco Capital, formerly SVP at Merrill Lynch; article
dated 8 Apr 2026), who argues the productivity gain comes from *sequences*, not commands: analysts
should organise around "repeatable tasks" rather than memorising isolated commands, with a daily loop
of market monitoring → screening → watchlists → relative valuation → fundamentals → estimates →
research. His framing quote: **"The real productivity gain comes when you stop treating these commands
as separate destinations."**

**EVIDENCE.**
- [S1] pp.16, 20–22; [S2] p.19 — official Bloomberg documentation — **verified**.
- John Cabot University "Commands to Get Started" — university library guide — **verified** for `FFM`,
  `BPS`, `LAST`, `GRAB`, `SEARCH`, `LANG`, `LOGI`, `KI`, `QUIC`, `BRC`. Fetched 2026-09-02.
- Olivier Gillier, "Harnessing Bloomberg Terminal: Key Functions for Market Analysts", 8 Apr 2026 —
  practitioner commentary — **reported** (single practitioner, not independently corroborated).
- Per-module BMC hours — university guides via search snippet, **not fetched** — **reported**.
- `ESRV` (named speculatively in the contract) — **NOT FOUND**. No Bloomberg document or university
  guide I reached mentions it. The function-discovery addresses that *are* documented are `MENU`,
  `BPS`, `BU`, `BHL`, `FFM`, `USER`, `HL`/`SEARCH`. Treat `ESRV` as unverified.

**INTERPRETATION.** Two things are transferable and one is not.

Transferable #1: **the on-ramp is addressable from inside the product.** `BMC`, `BPS`, `BU`, `TRAI`,
`BNEW` are all commands, not a separate website. Learning happens in the same box as working, which
means the transition from learning to doing costs nothing.

Transferable #2: **`FFM` — teach the tool through today's tape.** A function is memorable when it
answered a question you actually had this morning. This is the single cheapest idea in this file for a
small desk to copy, and it needs no new infrastructure.

Not transferable: **the 8-hour course and the 24/7 human help desk.** Those are enterprise-scale
onboarding investments, and UCT's structural advantage is the opposite — a desk of 2–3 people who can
be taught directly, and members who will not complete an 8-hour course.

**RELEVANCE TO UCT.** UCT already runs a daily live trading session (auto-published to The Desk), a
Morning Wire, an evening update, and Discord — all of which are *already* "here is what happened today".
`FFM`'s idea is to add one sentence to that existing content: *and here is the surface that shows it.*
The Desk's session-insights pipeline already extracts chapters and ticker moments from transcripts,
which is most of the machinery. Separately, UCT's `/ai-search` and voice assistant are already
in-product learning surfaces; what they are not is *addressable the same way as everything else* (§2).

**CONFIDENCE.** 🟢 for the addresses and BMC's shape (Bloomberg's own text). 🟡 for `FFM`'s actual
behaviour (one fetched secondary source plus an official series page I did not fetch in full).
🔴 for the learning curve as experienced — **this is the file's weakest section and the ceiling is
named**: the practitioner tier is unreachable from this agent.

**RECOMMENDATION (hypothesis).** Copy `FFM`, not `BMC`. Hypothesis: *a recurring "here is today's move
and the surface that explains it" note — riding the Morning Wire or the daily session, which already
exist — teaches TERMINAL-NEXT faster than any static tour or tooltip campaign.* Corollary from
Gillier's framing: teach **sequences**, not features — the unit of instruction should be a loop
("what moved → why → is it mispriced"), not a widget.

**OPEN QUESTION.** How long does a new Bloomberg user take to reach competence, and what does the
distribution look like? BMC's 8 hours is *course* time, not *competence* time, and no source I reached
measures the latter. Without it, every claim about Bloomberg's learning curve — including the
consistent "steep learning curve" line in review-aggregator sites, which I deliberately do **not** cite
as evidence per the preamble's exclusion of SEO/AI-generated comparison pages — is folklore.

---

## 11. Cross-cutting: what the Bloomberg navigation model actually *is*

Pulling §§2–9 together, one architecture explains all of it:

1. **Everything is an address.** Functions have mnemonics; securities have ticker+sector expressions;
   the two compose (`IBM US <EQUITY> GP <GO>`); sub-views have shortcut commands; even the help page
   about cancelling is `STOP <GO>`, and logging off is `OFF <GO>`.
2. **One input surface takes every kind of address, plus keywords, plus English.** Typing is searching;
   `<GO>` is the commit. Novice and expert use the same path.
3. **Context is explicit, named, scoped, and persistent.** The loaded security is a labelled field with
   its own history, per panel, changed only deliberately.
4. **Browsing is a view over the addresses, not a parallel system.** Menu leaves are mnemonics; tab
   labels are mnemonics. Browsing trains the fast path.
5. **Colour is a type system.** Red/green/yellow keys and amber fields tell you what a thing *is*
   before you read it.
6. **Everything has a keyboard address.** `Number <GO>` plus Alt-Mode means the mouse is optional, not
   merely supplemented.
7. **Help is a modifier on your current position**, and its second press is a human.
8. **Change ships beside the old behaviour, not instead of it.** `PDFU` key reverts; classic panels
   beside Tabbed Windows.

**The generalisation for TERMINAL-NEXT:** Bloomberg's navigation is not fast because it is dense or
because it is old. It is fast because **it has a grammar**, and every other affordance — menus, tabs,
help, history, favourites, suggestions — is a *view over that grammar* rather than an independent
system. The single riskiest thing a competitor can copy is the *density* while leaving the grammar out:
that yields a cluttered screen with none of the speed. Density is the visible part; the grammar is the
part that works.

**Where the analogy to UCT breaks down, explicitly:** Bloomberg's users are paid to be there eight
hours a day and are professionally obliged to learn it; UCT's members are not. The evidence supports
"a grammar makes an expert fast", not "a grammar makes a newcomer stay". A grammar for the **internal
desk** (2–3 people, daily, high volume, program's stated first audience) is a very different bet from a
grammar for **members**, and this file's evidence does not distinguish them. That distinction belongs in
synthesis, not here.

---

## GAPS (budget and reachability)

**Reached the budget on none of these — they are reachability failures, and each is named with what
would fix it.**

1. **Practitioner and community tier is entirely unreachable.** `reddit.com` is blocked at the
   user-agent level (API returns an explicit domain-block error); `wallstreetoasis.com` returns 403 on
   both forum and resource paths; `g2.com` returns 403; `oreilly.com` (the *Bloomberg Visual Guide*
   appendix) returns 403; `bu.edu`'s Bloomberg help page is behind SAML SSO. **Net effect: every
   question of the form "what do practitioners actually do / how long did it take them / what do they
   hate" is 🔴 in this file.** The one practitioner voice I reached (Gillier) is a single source.
   *What would raise it:* a Terminal subscriber interview, or an agent with a differently-configured
   fetch path. The owner does not appear to have Terminal access.
2. **WebSearch budget was exhausted session-wide** (200/200) partway through, before I could verify
   `ESRV` or search for keyboard-usage studies. All work after that point used WebFetch on known URLs.
   `ESRV` remains **unverified — I could not find it at all**; the contract lists it with a question
   mark and I found no corroboration.
3. **No screenshots, no video transcripts.** I did not view Bloomberg's official tutorial video (only
   its chapter titles, which are page text). Per the preamble I make **no claim about what the video
   shows.** Autocomplete ranking, the visual density of the suggestion list, Suggested Functions'
   actual output, and Alt-Mode's appearance are all undocumented in text and would need screenshots.
4. **Version currency.** [S2] is dated 07/18/2022 with © 2019 boilerplate; [S1] is undated and
   describes the older four-panel model. Bloomberg's Terminal-Essentials page is Oct 2024. **Nothing I
   read is verifiably 2026-current.** Anything about the *current* default display model, current
   keyboard generation, or current Suggested Functions behaviour is 🟡 at best.
5. **Unmeasured throughout:** keyboard-vs-mouse usage split; autocomplete ranking rules; whether
   Suggested Functions is rule-based or learned; time-to-competence; whether tabs scope the loaded
   security per tab or per window; what a "favourite place" can contain.
6. **Deliberately excluded as evidence** per the preamble: review-aggregator and comparison pages
   (subscribed.fyi, saasworthy, softwareadvice, koyfin's alternatives post, tradersagency, pineify).
   They agree on "steep learning curve" and "dated interface", but they are SEO/affiliate/AI-summary
   content and I will not cite them as evidence for a claim. Their agreement is noted here as an
   observation about the *discourse*, not about the product.
7. **Provenance caveat.** A Bloomberg-authored *"Bloomberg Launchpad Getting Started"* PDF was present
   in this session's fetch-results directory and I read it (it yielded `BLP <GO>`, `LLP <GO>` — turn
   almost any function into a Launchpad component — plus `TRAIN <GO>`, `CERT <GO>`, `BREP <GO>`). **I
   did not fetch it myself and cannot attest its canonical URL**, so I have not cited it for any load-
   bearing claim above. Launchpad is B-BBG-02's scope regardless; flagging so synthesis does not treat
   a stray artifact as corroboration.

---

## SOURCES

**Tier 1 — Official Bloomberg documentation, manuals and product pages** (all fetched 2026-09-02)

1. Bloomberg Finance L.P., **"Getting started on the Bloomberg Terminal."** (28pp; student/education
   edition; undated; describes classic four-panel display). *Cited throughout as [S1].*
   https://data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf
2. Bloomberg Finance L.P., **"STOP <GO> — Cancel as a Function · Help Page"** (24pp; document date
   07/18/2022; © 2019 boilerplate; export of the in-Terminal Help Page; describes Tabbed Windows).
   *Cited throughout as [S2].* https://metalib.ie.edu/ayuda/Varios/Bloomberg_help_support.pdf
   *(Bloomberg-authored; hosted by IE University.)*
3. Bloomberg Professional Services, **B-Unit Device and Mobile App** product page.
   https://professional.bloomberg.com/products/bloomberg-terminal/access/b-unit/
4. Bloomberg Professional Services, **Bloomberg Terminal** product page (claims: "more than 350,000
   influential decision makers"; "97% of customers say Bloomberg delivers access to high-quality data").
   https://professional.bloomberg.com/products/bloomberg-terminal/ — **claimed** (marketing).
5. Bloomberg Professional Services, **"Bloomberg Terminal Essentials: Getting started"**, 13 Oct 2024
   (chapter list verified as page text; video not viewed).
   https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-getting-started
6. Bloomberg Professional Services, **"Functions for the Market" (FFM)** series page.
   https://www.bloomberg.com/professional/insights/series/ffm/ — referenced; not fetched in full.
7. *(Provenance-caveated, see GAPS #7)* Bloomberg Finance L.P., **"Bloomberg Launchpad Getting
   Started"** PDF — read but URL not attested; not used for load-bearing claims.

**Tier — University library guides (credible professional tutorials)** (all fetched 2026-09-02)

8. University of Illinois at Urbana-Champaign, *Bloomberg User Guide — The Bloomberg Keyboard*.
   https://guides.library.illinois.edu/bloomberg_user_guide/the_bloomberg_keyboard
9. University College Dublin (Smurfit), *Interactive Bloomberg Keyboard* — most complete key inventory
   found, incl. `<CMND HISTORY>`, `<PANEL>`, favourites/codes key.
   https://buselrn.ucd.ie/docs/bloomberg-keyboard/
10. Seton Hall University Libraries, *Bloomberg Terminal — Navigating the Keyboard* (states F12 =
    `CLIENT`; "it is not necessary to have a special Bloomberg provided keyboard").
    https://library.shu.edu/c.php?g=351647&p=2373722
11. Cornell University Library, *Navigating Bloomberg — keyboard* (canonical grammar
    `TICKER <MARKET> FUNCTION CODE <GO>`). https://guides.library.cornell.edu/bloomberg_intro/keyboard
12. Yale University Library, *Getting Started with Bloomberg at Yale — Basics* (four panels; `BPS`,
    `FFM`, `GRAB`, `LAST`). https://guides.library.yale.edu/Bloomberg/Bloomberg_Basics
13. Imperial College London, *Bloomberg for beginners — Display and navigation* (loaded security
    persistence; toolbar favourites + recents). https://library-guides.imperial.ac.uk/bloomberg/display-and-navigation
14. University of Michigan Ross (Kresge), *Bloomberg — Navigation* (colour rule: red=stop,
    green=action, yellow=market sectors). https://kresgeguides.bus.umich.edu/bloomberg/Navigation
15. New York University, *Bloomberg Guide — Popular Commands* (`LAST`, `BPS`, `OFF`, `HELP`).
    https://guides.nyu.edu/bloombergguide/popular-commands
16. John Cabot University, *Bloomberg Guide — Commands to Get Started* (`FFM`, `SEARCH` natural
    language, `GRAB`, `LAST`, `BPS`, `KI`, `QUIC`). https://johncabot.libguides.com/bloomberg/basic-commands

**Tier — Encyclopaedia / general web with citations**

17. Wikipedia, *Bloomberg Terminal* (keyboard generations SEA100 → Starboard/Keyboard 4; green-GO /
    red-Cancel rationale; History key reverse-chronological; `{VOD LN Equity GO}` notation; 325,000
    subscribers as of 2022; ~$24k–$30k/user/year; first released Dec 1982). Claims marked as carrying
    citations in-source. https://en.wikipedia.org/wiki/Bloomberg_Terminal — **reported**.

**Tier — Practitioner commentary**

18. Olivier Gillier (investment strategist; co-founder, RioBlanco Capital LLC; formerly SVP, Merrill
    Lynch), *"Harnessing Bloomberg Terminal: Key Functions for Market Analysts"*, 8 Apr 2026 —
    sequences over commands; Launchpad as the anchoring environment.
    https://oliviergillier.com/harnessing-bloomberg-terminal-key-functions-for-market-analysts/ —
    **reported** (single practitioner voice).
19. Ted Merz (formerly Bloomberg News), *"Bloomberg's Quirky Functions"*, 20 Mar 2025 — read; yielded
    only novelty mnemonics (`FISH`, `POSH`, `NOW`, `NI` news codes) and **nothing** on navigation or
    discovery. Cited here as a **negative result** so synthesis does not re-fetch it.
    https://ted-merz.com/2025/03/20/bloombergs-secret-functions/

**Blocked / unreachable (documented for the next agent, so nobody re-spends budget)**

20. reddit.com — blocked at user-agent level (explicit API domain-block error).
21. wallstreetoasis.com — HTTP 403 on `/forum/*` and `/resources/*`.
22. g2.com/products/bloomberg-terminal/reviews — HTTP 403.
23. oreilly.com (*Bloomberg Visual Guide* appendix) — HTTP 403.
24. bu.edu Bloomberg help — SAML/Shibboleth SSO redirect, unfetchable.

---
id: C4-01
title: Terminal command grammars — financial terminals and software analogs
role: Terminal command grammars (domain pod)
wave: 1b
group: C
category: domain
scope: Command/search grammars across financial terminals (Bloomberg, Godel, Koyfin, LSEG Workspace, TradingView, thinkorswim, Benzinga Pro, Unusual Whales) and software analogs (Raycast, Spotlight, VS Code, GitHub, Slack, Linear)
confidence: 🟡 (grammar mechanics 🟢 · disambiguation/ranking internals 🟡 · latency and real usage 🔴)
evidence_ceiling: "No product was operated with a live seat. Every claim about how a grammar FEELS — keystroke counts, misdirection rate, time-to-competence, keyboard-vs-mouse split, suggestion latency — is 🔴 and reconstructed from documentation, never measured. Bloomberg's autocomplete ranking rule is undocumented in every source reached. TradingView's individual key bindings sit behind client-side accordions. Linear's command-menu documentation was not reachable (both candidate URLs 404). Godel's per-command doc pages 404 on direct URL guesses. thinkorswim's Composite Symbols page 404s to a direct fetch and is quoted from the search index of its own official page."
sources: "16 primary (official product documentation, read directly); 13 secondary (on-disk sibling dossiers citing primary sources, university library guides, official-page search snippets, one founder interview, one HCI reference)"
uct_relevance: high
status: draft
date: 2026-09-02
---

# Terminal command grammars

**Reading note for synthesis.** This file catalogs *how you tell a terminal what you want* across
eleven products and six software analogs, on ten axes. It does not decide UCT's grammar; C5-03 and
ARCH-level roles do that. Where a sibling dossier already carries a verified primary quote, this file
cites **the dossier and its underlying URL** rather than re-fetching — the sibling files are the
program's own evidence and re-deriving them would burn budget to reach the same sentence.

**Benchmark discipline.** "Product X does Y" never means "UCT should build Y." Everything in
§Principles and §Candidate grammars is a hypothesis phrased for testing, not a requirement.

**Vocabulary.** TERMINAL-CURRENT is UCT's existing `/calendar` surface (display-named "UCT Terminal").
TERMINAL-NEXT is the program's target. Neither is called bare "UCT Terminal" here.

---

## 0. The two families, and why the split matters more than any individual product

Every grammar surveyed falls into one of two shapes, and the shape — not the vocabulary size —
predicts almost everything else about the system.

- **Noun-first (security-then-function).** You name the *thing*, then the *lens*. Bloomberg
  (`IBM US <EQUITY> GP <GO>`), Godel, Koyfin (`ticker → function → enter`), thinkorswim (symbol
  selector, then the tab you are on is the lens). The instrument is expensive to identify and is
  identified once; functions are cheap words layered on top.
- **Verb-first (palette).** You name the *action*, and the object is either implied by where you are
  or supplied as an argument. VS Code (`>Format Document`), GitHub (`>`), Raycast, Slack
  (`/invite @someone`), Linear. There is no "loaded object"; there is a *current context* the palette
  reads.

A third shape exists but is not a navigation grammar at all: **filter languages** (Benzinga Pro's
boolean bar, Unusual Whales' `where` formula language). These select rows; they do not move you.
Conflating them with navigation is a recurring category error — Benzinga's global bar looks like a
command line and is documented as *"a boolean search that allows for AND/OR/NOT to both keywords and
stock tickers"*, which filters the tool you are already in [S11].

**Why the split matters.** Noun-first grammars compose (one line names both the object and the lens,
and can be recalled, edited, and re-run with a different object). Verb-first palettes do not compose,
but they need no vocabulary — the object is wherever you already were, and fuzzy matching finds the
verb. The evidence below is that the best financial terminals are noun-first, the best *software*
launchers are verb-first, and the two are optimizing different things: **noun-first optimizes the
tenth action on one name; verb-first optimizes the first action of a session.**

---

## 1. Bloomberg — the canonical noun-first grammar

**OBSERVATION.** Canonical form: `TICKER <MARKET SECTOR> FUNCTION <GO>`. Four slots, one sentence
shape, thousands of functions. `<GO>` (green) commits; the yellow market-sector key is a **typed type
annotation**, not decoration — one key both filters the security expression and, pressed alone, opens
that sector's menu. The whole navigation collapses into one line: `IBM US <EQUITY> GP <GO>` loads the
security *and* runs the price graph. Non-ticker identifiers slot in unchanged (`931142DD2 <CORP>
<GO>` by CUSIP). Type mismatches **error**: running `YA` (yield analysis) against a loaded index
produces an error message rather than a wrong screen.

Four kinds of input go into the same box and are disambiguated by a categorised list: a mnemonic
(`WEI`), a keyword for a function you cannot name (`MERG`, refinable to `MERGER ACQ`), a partial
security identifier (`DIS 7`, refinable with `<Corp>`), and a natural-language question
(`IBM Q3 2013 REVENUE`, landing on the SEARCH screen). Typing without committing *is* the search; the
same keystroke that commits is the one that runs. Escalation ladder: type → autocomplete list → `<GO>`
for full SEARCH → `<SEARCH>` key for `HL`'s categorised sweep.

Retrace is split into three distinct mechanisms with three affordances: `<End/Back>` (previous
screen), `<CMND HISTORY>` (cycle past *command-line entries*, in reverse chronological order — text
you can edit before re-running), and favourites/recents on the toolbar as **two** drop-downs,
*recently loaded securities* and *recently used function mnemonics*, mirroring the noun/verb split.
`LAST <GO>` makes history itself an address.

**EVIDENCE.** All of the above is quoted verbatim from Bloomberg-authored documents in the program's
own on-disk evidence file `03-competitive-research/bloomberg/01-search-navigation.md` [S3] §§2–8,
which cites [S1] *"Getting started on the Bloomberg Terminal"* pp.2, 5–8, 11, 13, 15–16 and [S2]
*"STOP `<GO>` — Cancel as a Function, Help Page"* pp.4, 6–16, 18–20 — official Bloomberg
documentation, **verified**, corroborated at university-library-guide tier by Cornell (canonical
form), Imperial, Yale and John Cabot. Fetched by that role 2026-09-02.

**INTERPRETATION.** The load-bearing property is that **vocabulary scales while syntax does not**.
The 3,000th function costs the user nothing structurally; it is one new word in a language they
already speak. Compare a route-and-tab product where the 30th feature costs more than the 3rd. The
second property is that **novice and expert share one path** — an expert types `WEI<GO>` in four
keystrokes, a novice types `MERG` and reads the list; there is no beginner mode to graduate out of
and no expert shortcut the novice cannot see.

**RELEVANCE TO UCT.** For the internal desk (2–3 people, daily, high volume — the program's stated
first audience) this is the shape that pays. The sibling file already names the mismatch: UCT surfaces
are addressed by route + query params + persisted prefs, so a menu leaf is a *route*, not something a
user can type, and browsing therefore teaches no faster path because there is none. UCT's own
`/calendar`-rename episode is the symptom: a naming layer sitting on top of an addressing scheme
rather than an addressing scheme users can say out loud.

**CONFIDENCE.** 🟢 on the grammar and its slots. 🔴 on how long the vocabulary takes to install in a
person — Bloomberg ships an 8-hour course (`BMC`) for a product whose command line it calls "entirely
discoverable," and the practitioner tier was unreachable to the sibling role.

**RECOMMENDATION (hypothesis).** *A single sentence shape with a small slot count beats a large
route/tab inventory for a high-frequency desk, and the test is keystrokes-to-answer on the tenth
lookup of the session, not the first.*

**OPEN QUESTION.** How does Bloomberg rank a mixed list containing a function, a security and a search
suggestion? No source reached states the rule. If ranking is personalised (recency, desk, role) that
is a materially harder system than a static relevance sort, and the documentation cannot tell them
apart.

---

## 2. Godel Terminal — the same grammar, rebuilt in a browser in 2026, with the vocabulary published

**OBSERVATION.** Godel is the most useful single data point in this file because it is a **2024-founded,
$7M-funded, public-beta product that deliberately reimplemented the Bloomberg mnemonic grammar on a web
stack** — its homepage tagline is *"We're reinventing the financial terminal. Browser based with
familiar commands"* [S5]. Its entire command vocabulary is on one public page, organised into six
categories [S4]:

| Category | Commands (verbatim codes) |
|---|---|
| Company & security analysis | `DES` `FA` `ERN` `EM` `SI` `GR` `ANR` `EVT` (coming soon) `DVD` |
| Market data & surveillance | `QM` `FOCUS` `TAS` `HCP` `WEI` `WEIF` `IMAP` (beta) `HMAP` (beta) `GLCO` `FX` `MOST` `HDS` `N` `TOP` `TREND` `HALT` `ALLQ` `SECF` `WJI` |
| Portfolio & risk | `EQS` (beta) `OMON` `OVME` `CALC` `BROK` `AUM` |
| Charting & technicals | `G` `HMS` `HP` |
| Fundamentals & filings | `CF` `IPO` `TRAN` |
| Utilities & system | `HELP` `CHAT` `ACM` `PDF` `AL` `NOTE` `ENT` `CHANGE` |

Roughly two-thirds of these codes are **Bloomberg's own mnemonics reused verbatim** — `DES`, `FA`,
`EM`, `SI`, `ANR`, `DVD`, `WEI`, `WEIF`, `IMAP`, `HDS`, `EQS`, `OMON`, `OVME`, `HMS`, `CF`, `TOP`. That
is a deliberate compatibility decision: the vocabulary a Bloomberg refugee already has installed is
treated as an asset to import rather than a legacy to replace.

The published global keyboard layer is small and window-centric [S4]:

| Shortcut | Action (verbatim) |
|---|---|
| `` ` `` | Focus the terminal |
| `Esc` (double tap) | Close the current window |
| `Tab` / `Shift+Tab` | Cycle through open windows / in reverse |
| `F1` | Open HELP |
| `Shift + ←↑→↓` | Move the active window |
| `Ctrl + Shift + ←↑→↓` | Snap the active window to the edge of the screen |
| `Option + ←↑→↓` | Resize the active window |
| `Option + Shift + ←↑→↓` | Resize the active window to the edge of the screen |
| `Ctrl + Option + ↑/↓` | Increase / decrease terminal input + top-nav size |
| `⌘ + Z` | **Undo last window close** |

Three of these deserve naming. **`` ` `` to focus the terminal** means the command line is one
dead-key away from anywhere, without a modifier chord — the cheapest possible re-entry into the
grammar. **`Esc` double-tap to close** deliberately requires two presses for a destructive act.
**`⌘+Z` to undo a window close** treats the workspace as an editable document with an undo stack,
which no other product in this survey documents.

**EVIDENCE.** `https://godelterminal.com/docs` — official command reference and shortcut table, read
in-browser 2026-09-02 (WebFetch returns HTTP 403; the page is Cloudflare-gated to non-browser agents)
— **verified** [S4]. Identity, funding, pricing, positioning and the homepage tagline from the
program's on-disk `03-competitive-research/godel/01-evidence.md` [S5] — **verified** for
company-authored copy.

**INTERPRETATION.** Godel is the existence proof that the Bloomberg grammar is **not** an artifact of a
special keyboard or a 1980s stack: a small team shipped it in a browser, published the whole
vocabulary as a flat, linkable, six-category page, and priced it at ~1/27th of a Bloomberg seat. Note
what the published page *is*: the entire product's address space on one screen. That is a
discoverability artifact Bloomberg does not have a public equivalent of, and it is nearly free to
produce once a grammar exists.

Note also what is **absent**: the docs page publishes commands and *window* shortcuts, but no syntax
statement — nothing on the page says whether you type `AAPL DES` or `DES AAPL`, whether a market-sector
token exists, or how a mismatch fails. Per-command detail pages exist ("Click any pill to open its full
documentation") but their URLs were not recoverable within budget. **The grammar's shape at Godel is
therefore inferred from vocabulary shape, not read.**

**RELEVANCE TO UCT.** Two transfers, both cheap. (a) **Publish the address space on one page.** UCT
has a widget registry, a route taxonomy and a nav grouping already; a single public "every address in
TERMINAL-NEXT" page is a byproduct of having a grammar, and it is the artifact that makes a grammar
learnable without a course. (b) **`` ` `` as the focus key** — a single unmodified key that returns
focus to the command line is directly relevant to a workspace where the chart, the tape and the
palette all compete for keystrokes; UCT's `/charts` already routes typing into symbol search when the
chart has focus, which is the same instinct without the escape hatch back out.

**CONFIDENCE.** 🟢 for the command list and the shortcut table (read directly from the vendor's own
page). 🟡 for "roughly two-thirds are Bloomberg mnemonics" — that is my comparison against the
Bloomberg evidence file, not a claim either vendor makes. 🔴 for whether Godel's grammar composes
(`AAPL DES` in one line) — the syntax is undocumented on the page I reached.

**RECOMMENDATION (hypothesis).** *Adopting an existing mnemonic vocabulary where one exists costs
nothing and imports installed muscle memory; inventing a parallel one for the same concept spends the
user's learning budget on nothing.* And: *a one-page public index of every address is the highest
learnability-per-hour artifact a grammar produces.*

**OPEN QUESTION.** Does Godel accept `TICKER FUNCTION` in one line, or does it require a loaded
context? A logged-in session or one demo-video transcript would settle it. Godel's own YouTube demo
channel exists and was not sampled.

---

## 3. Koyfin — noun-first, and the user gets to mint verbs

**OBSERVATION.** `/` opens the command bar, `Esc` closes it, and the documented shape is
**ticker → function → enter** [S8]. Built-in function codes are 1–3 letters: `G` (charts), `S`
(snapshot), `EST` (estimates), `FA` (financial analysis), `HDS` (holdings), `MOV` (movers), `GM`
(normalized performance), `TS` (transcripts), `MYW` (watchlists), `MP` (model portfolios). The help
center states the invocation as *"Press /, Type the abbreviation...press enter"* and lists
`MOV` = *"Jump to Top Market Movers"*, `MYW` = *"Access your watchlists instantly"*, `MP` =
*"Quickly open your model portfolios"* [S6]. A user who does not know a code can *"search by page name
(e.g. 'Overview')"* instead [S8].

**The transferable mechanic is user-minted verbs.** A saved chart template, dashboard, or
financial-analysis template can be *"assigned a shortcut"* [S6]:

| Artefact | Documented example | Documented invocation [S6] |
|---|---|---|
| Chart template | `fcsp` (FCF vs Share Price) | `"/" + ticker + "/" + hotkey abbreviation + enter` |
| Dashboard | `DBOLL` | `"/" + "/" + hotkey + enter` |
| FA template | `RGM` | `"/" + "/" + hotkey + enter` |

Note the pattern: **a chart-template verb composes with a ticker; a dashboard verb does not** — a
dashboard already carries its own securities. That is the noun/verb type system showing through.

Ticker resolution is ranked, and the rule is published: results are *"sorted by a combination of the
best match with the search term, and the trading volume for equities and ETFs"*, with AUM replacing
volume for mutual funds; results are filterable by asset type and country [S8]. **Liquidity is a
tiebreaker** — a plain, defensible, non-personalised rule that Bloomberg does not publish.

Koyfin also has a **symbol-expression** grammar: a colon divides one price by another, `AAPL:FB`
graphs relative performance, and the two calculation modes (Relative Strength `A/B` vs Relative Spread
`%A − %B`) are documented separately. It works in `G` and `GM` but *"currently, relative tickers can't
be used in Watchlists or MyDashboards"* [S8].

Linking is by **seven colour groups**: assign a widget by clicking the upper-left of its header;
selecting a security in one component *"updates the other components in this group"*; the security
selection method (Single / Multiple / My Watchlists) is itself group-linked — *"changing the selection
method in one widget changes it in the other ones as well"* [S7].

**EVIDENCE.** `https://www.koyfin.com/help/hotkeys-and-custom-shortcuts/` [S6] and
`https://www.koyfin.com/help/my-dashboards-groups/` [S7] — official help center, fetched 2026-09-02 —
**verified**. Command-bar grammar, ranking rule and relative tickers from the program's on-disk
`03-competitive-research/koyfin/dossier.md` §C/§H [S8], which cites Koyfin's own help articles
[S7-command-bar-search, S8-hotkeys, S15-relative-tickers] — **verified** by that role 2026-09-02.
Founder framing, **reported** (single secondary source, via search snippet): a 2021 interview in
*Liberty's Highlights* quotes co-founder Rob Koyfman — *"Early on I thought a command bar with
shortcuts would be central to what we do"* [S27].

**INTERPRETATION.** Koyfin separates the **namespace** of navigation from its **vocabulary**. The
vendor ships the nouns (every ticker) and a starter set of verbs; the user extends the verb set with
their own saved artefacts. This is the single most important idea in this file for a small desk,
because it inverts the memorability problem: a two-letter code is memorable *because the user chose
it*, not because the vendor named it well. It also converts every saved artefact from a thing you
browse to a thing you invoke — which is exactly the difference between a saved view that gets used and
one that rots in a list.

**RELEVANCE TO UCT.** UCT already has the substrate and none of the invocation: saved screens (scan
definitions), chart workspace layouts, named multichart grids (`layout.kind='multichart'`), watchlists,
colour groups. Today each is reached by navigating to its page and picking it out of a list. Under a
Koyfin-shaped grammar each would carry a user-chosen short code. Note UCT's colour groups are **four**
against Koyfin's **seven**, and Koyfin's selection-method-is-also-linked detail has no UCT analogue.

**CONFIDENCE.** 🟢 on the grammar, the codes, the ranking rule, and that shortcuts are user-assignable.
🟡 on the *exact* keystroke sequences: the help page renders them as `"/" + ticker + "/" + hotkey` while
the sibling dossier read the same source as `/` → ticker → enter → `fcsp` → enter. Both readings are of
the same page; the literal character sequence is unresolved and would need a session to settle.

**RECOMMENDATION (hypothesis).** *Letting a member assign a short code to their own saved artefact
produces more usable speed than shipping a larger built-in vocabulary, because the user pays the
naming cost only for the things they actually repeat.*

**OPEN QUESTION.** What happens when a user's chosen code shadows a built-in one? Koyfin does not
document a collision policy. This is the same latent-conflict class UCT has already been bitten by
with keyboard axes (`lesson_two_commands_one_physical_key`), and a grammar makes it worse because
codes are typed, not bound.

---

## 4. LSEG Workspace — verb-only codes into a global search bar

**OBSERVATION.** LSEG Workspace's entry point is a **global search bar** into which the user types
either a security (*"type in the name or ticker (code) for an individual company, equity or index"* —
e.g. `FT100` for the FTSE 100) or an **app code**, then presses Enter [S20]. Documented app codes,
each from LSEG's own developer documentation: `SCREENER` (*"Type in 'SCREENER' on Workspace search bar
then press enter"*), `DIB` (Data Item Browser — *"type DIB in a search bar"*), `EQG` (*"users can
access Equities Guide information by typing EQG in the global search bar and pressing Enter"*),
`ADVRES` (Advanced Research) [S20][S22].

The search bar has a **global OS-level hotkey**: *"If Workspace is running on your desktop,
'Ctrl+Shift+Space' opens the global Workspace search bar without switching applications"* [S21]. That
is the Raycast/Spotlight idea imported into a terminal — the command line is reachable from outside
the application.

Personalisation is by **Layouts**, not bookmarks: *"You can use Layouts to create personalised views
of LSEG Workspace to monitor your favourite companies, markets or news"* [S20]. LSEG's own product
page positions discovery as **AI-first** rather than command-first: *"AI-powered search,
recommendations and workflow intelligence built for financial professionals"* [S28].

**EVIDENCE.** University of Warwick library guide, `https://warwick.libguides.com/buseco/workspace`,
fetched 2026-09-02 — university library guide tier — **verified** for what it states [S20]. LSEG
Developer Community articles (`developers.lseg.com`, LSEG Data Guide chapters 3–5 and the Data Library
article) — official vendor developer documentation, read via **Google search-result snippets of those
official pages**, 2026-09-02 — **verified** for the quoted sentences, 🟡 because the pages themselves
were not opened [S21][S22]. LSEG product page `https://www.lseg.com/en/data-analytics/products/workspace`,
fetched 2026-09-02 — official marketing — **claimed** [S28].

**INTERPRETATION.** Workspace's grammar is **verb-only with a separate noun channel**: app codes and
security identifiers go into the same box, but there is no documented composition — nothing reached
shows `IBM EQG` as one line. Compared to Bloomberg's four-slot sentence, this is a flatter, weaker
grammar that leans on the search bar's *ranking* to disambiguate rather than on a typed slot. LSEG's
own marketing language confirms the strategic direction: they are betting on AI-powered relevance to
replace grammar, which is a different wager from Bloomberg's (grammar), Koyfin's (grammar the user
extends), and TradingView's (three explicit modes).

**RELEVANCE TO UCT.** The `Ctrl+Shift+Space` global hotkey is the notable transfer and the one UCT
cannot copy — it is a desktop-app capability, and TERMINAL-NEXT is browser-resident. What *is*
transferable is the observation that a terminal's command line has value proportional to how few
keystrokes separate the user from it; Godel's `` ` `` is the browser-legal version of the same idea.

**CONFIDENCE.** 🟡 overall. 🟢 that app codes are typed into a global search bar (three independent
LSEG-authored documents state it with different codes). 🔴 on whether Workspace supports any
composed `security + app` expression — I found no statement either way, and the absence is a failure to
reach LSEG's own user documentation (login-walled at `my.refinitiv.com`), not evidence of absence.

**RECOMMENDATION (hypothesis).** *A search bar that accepts both app codes and security identifiers
without a composition rule will resolve ambiguity by ranking, and the ranking then becomes the product
— which means it must be published, or users will not trust it.* Koyfin publishes theirs
(match + liquidity). LSEG does not.

**OPEN QUESTION.** Does Workspace's search accept a composed expression, and if not, how does a user
move an already-identified company into a named app without re-typing it?

---

## 5. TradingView — no grammar, three search modes, and the chart is the address bar

**OBSERVATION.** TradingView has **no command palette and no ticker-plus-function grammar** [S9]. In
its place:

1. **Type-to-search on the chart with no focus act.** *"To change the symbol or ticker, type the name
   asset you're looking for directly into your keyboard. A search box will appear and you can select
   the symbol you want."* [S9] There is no palette hotkey to remember because there is no palette.
2. **Three explicit search modes for three intents** [S9]: *I know the name* (type it) · *I know the
   criteria* (screener, 400+ filter fields, universe-scopable to a watchlist or index) · *I know the
   idea but not the criteria* (AI Screener — natural language, any language, typo-tolerant; the
   vendor's own example is reading "golden gross" as *golden cross*).
3. **Modifier+cursor spatial action.** *"Press Alt + Ctrl on Windows or ⌥⌘ on Mac, and a button with
   a '+' icon will appear under the cursor"* — from which the user creates an order, an alert, or a
   price line **at the price the cursor is on** [S9]. Navigation and action collapse into one gesture
   at a coordinate; no dialog is opened at all.
4. **Deep-linkable symbol addressing.** `EXCHANGE:TICKER`, observed in the URL
   `/chart/?symbol=NASDAQ%3ANVDA` — a chart for any symbol is a GET away [S9].
5. **A published, categorised hotkey surface.** The shortcuts page's own copy says shortcuts exist to
   *"Manage watchlists, set alerts, navigate Supercharts"*, organised into seven categories: Chart ·
   Indicators and drawings · Watchlist · Screener · Pine Script® Editor · Trading · Alerts [S10].

**EVIDENCE.** Items 1–4 from the program's on-disk `03-competitive-research/tradingview/dossier.md`
§C/§H [S9], citing TradingView help-center articles and the AI-Screener/Pine-Screener blog posts
(Tier 1, **verified**) plus rendered pages (**demonstrated**), 2026-09-02. Item 5 read directly:
`https://www.tradingview.com/support/shortcuts/`, in-browser 2026-09-02 — **verified for the seven
category names and the quoted sentence**; the individual key bindings sit behind client-side
accordions that did not expand in a text extraction, which independently reproduces the sibling
dossier's stated ceiling [S10].

**INTERPRETATION.** TradingView made a defensible opposite bet, and the reason is audience: a grammar
must be learned, and TradingView's audience churns. So it replaced one grammar with three *modes*,
each shaped so its **result set has the right type** — a symbol, a table, or a saved scan. The cost is
that nothing composes and nothing is recallable-and-editable; the benefit is that the first action of
a session costs zero learning. The modifier+cursor gesture is the sleeper finding: it is the only
mechanism in this entire survey that *removes a dialog* rather than *adding a launcher*.

**RELEVANCE TO UCT.** UCT's `/charts` ChartWidget already implements click-to-focus + type-to-search
prefilled from the first typed character, with focus restored after a pick — the same idiom,
independently arrived at [S9]. What UCT does not have is (a) the modifier+cursor act-at-this-price
gesture, and (b) a *published* shortcut inventory spanning non-chart surfaces. Mode three (English → a
scan) maps onto UCT's existing English-to-scan Concierge.

**CONFIDENCE.** 🟢 on the three modes and symbol addressing. 🟡 on "no palette" — the sibling role
inferred absence from a complete shortcut-category list plus the help taxonomy, not from a definitive
statement, and I reproduced the same ceiling.

**RECOMMENDATION (hypothesis).** *Three explicit search modes may serve a mixed audience better than
one omnibox, because each mode's result set can be typed correctly instead of guessed* — set against
Bloomberg's opposite hypothesis in §1. These two are the sharpest fork in this file and TERMINAL-NEXT
cannot have both as its default.

**OPEN QUESTION.** Does TradingView accept **any** text-command syntax in the same box as symbol
search (an interval code, a comparison expression like `AAPL/QQQ`)? Both the sibling role and I left
this open; a logged-in session answers it in thirty seconds.

---

## 6. thinkorswim — the symbol box is itself an expression language

**OBSERVATION.** thinkorswim's entry point is a **symbol selector** at the top of each tab — *"type a
symbol into the symbol selector at the top"*, after which *"the page populates with"* the relevant
data [S24]. The lens is the tab you are on (Charts / Analyze / Trade / Scan / MarketWatch), so the
product is noun-first with the verb chosen spatially rather than typed.

The notable grammar is one level *below* the symbol: **composite symbols**. From the vendor's own
learning center: *"A composite symbol is defined by a mathematical expression … Thus, a two-component
composite symbol may look like `AAA+BBB` or `AAA–BBB`."* Coefficients are added with `*` and `/`
(`AAA+2*BBB–3*CCC`), and parentheses group as in algebra; the composite generates its own OHLCV series
[S23].

**EVIDENCE.** `https://toslc.thinkorswim.com/center/howToTos/thinkManual/Getting-Started` and the
thinkManual index — official vendor learning center, fetched 2026-09-02 — **verified** for the symbol
selector [S24][S25]. Composite Symbols: the official learning-center page returns 404 to a direct
fetch; the quoted sentences are from **Google's search index of that official page** (English and
Chinese mirrors agreeing on the same examples), 2026-09-02 — **verified for the quoted text, 🟡 for
completeness** [S23]. ⚠️ A Google **AI Overview** restating the same content appeared in the results
and was **deliberately not used as evidence** per the preamble's exclusion of AI-generated summaries;
only the source page's own indexed sentences are quoted.

**INTERPRETATION.** Composite symbols and Koyfin's `AAPL:FB` are the same idea at different power
levels: **the noun slot can hold an expression, not just an identifier.** This is a cheap, large
capability — it lets a user ask for a spread, a ratio, or a synthetic index without any new screen —
and it is the one place where a *noun-first* grammar gets composability normally associated with
formulas. Note Koyfin's documented restriction (relative tickers work in the graph functions but not
in watchlists or dashboards): an expression in the noun slot only works where every downstream
consumer can accept a synthetic series, and vendors who ship it hit that boundary.

**RELEVANCE TO UCT.** UCT's chart stack already computes overlays and derived series and its breadth
work already reasons in ratios (`up_vol_ratio` is up÷down). A `NVDA/QQQ` or `SMH-SPY` expression in the
symbol box would be legible to the desk's existing vocabulary. The boundary Koyfin documents is the
warning: whatever accepts an expression must be enumerable, or the feature is half-shipped in exactly
the way this program keeps finding.

**CONFIDENCE.** 🟡. 🟢 that composite symbols exist with `+ − * /` and parentheses (the vendor's own
sentences, twice, in two languages). 🔴 on thinkorswim's linking model, keyboard layer and any
non-symbol command entry — the thinkManual's own index has no section for shortcuts, symbol syntax, or
gadget linking, and I did not reach one.

**RECOMMENDATION (hypothesis).** *Allowing an arithmetic expression in the symbol slot buys a
disproportionate amount of analytical range for a small grammar — provided the set of surfaces that
accept a synthetic series is explicitly enumerated rather than assumed.*

**OPEN QUESTION.** Does thinkorswim's symbol selector carry a *type* prefix convention (the widely-used
`/ES` for futures, `$SPX` for indices)? I did not reach a vendor page stating it and will not assert it
from folklore. This matters because a type sigil in the noun slot is Bloomberg's yellow key by another
name.

---

## 7. Benzinga Pro and Unusual Whales — filter languages, and the one worth stealing

**OBSERVATION — Benzinga Pro.** One global boolean bar at the top of the platform: *"a boolean search
that allows for AND/OR/NOT to both keywords and stock tickers"*, which composes with tool linking so
that *"When a linked ticker is in the search bar, that tool will be filtered by that ticker AND change
based on what ticker is clicked from the linked group."* Chat has its own micro-grammar (`$SYMBOL`,
`@USERNAME`, bare text = keyword). Ticker clicks route through a **Default Link**, and *if no receiver
tool exists in the workspace, Pro creates one* — the click never dead-ends. Discoverability is a
**downloadable PDF of commonly used search terms**. There is **no documented keyboard shortcut or
command palette anywhere in the vendor's complete 119-article help-center inventory** [S11].

**OBSERVATION — Unusual Whales.** A `Ctrl-K` global palette with a `/` mode for **commands** (the
product's own 404 page renders the palette with the chips `Ctrl` `K` `search` and `/` `cmds`), and the
palette returns **data**, not only routes — search results include watchlists and options-contract
volume bars. Screen state is **fully URL-encoded** — an observed options-screener URL carries its
entire filter set *and a human name* (`watchlist_name=500K%20OTM%20Call%20Buyer%20Stock%20Only`).
Cross-surface jumps are first-class: *"Clicking Market Tide now takes you to that minute in the flow
feed"* [S12].

And the artifact this file rates highest of anything outside Bloomberg: **a small, readable alert
formula language**, documented in the product's own words — *"Every custom alert can be written as a
single formula: `where` followed by the conditions you care about."* Its primitives [S12]:

- **Number shortcuts** — *"k = thousand, m = million, b = billion, % = percent. Write `50k`, `1.5m`,
  `5%`."*
- **Combinators** — *"`and` needs both sides true, `or` needs one. Group with `( )` when mixing.
  `not` flips a condition."*
- **Scope prefixes placed before `where`** — *"`$AAPL` limits to a ticker, `@tech` to a sector,
  `#mylist` to a watchlist."*
- **Field-to-field comparison and arithmetic** — *"Fields can be compared to numbers or to each other,
  like `volume > open_int`. Arithmetic works too: `size * price > 50k`."*
- **One language across five typed subjects** (option trades, option contracts, interval flow, flow
  alert, multi-leg trade), each with its own field set, plus per-type starter recipes that open in the
  editor, plus a machine-readable `GET /api/alerts/query/grammar`.
- An **AI filter builder** that composes the same formulas from English — *"a ramp onto the language,
  not a replacement for it, so the artifact the user ends up owning is still inspectable text."*

**EVIDENCE.** Both from on-disk sibling dossiers: `benzinga-pro/dossier.md` §C/§H [S11] (citing
Benzinga help-center articles 5, 7, 19, 23, 28, and an absence measured against the vendor's own
sitemap) and `unusual-whales/dossier.md` §C/§H [S12] (citing `unusualwhales.com/custom-alerts/reference`,
`/options-screener`, `/overview` in-product help, the changelog, and the OpenAPI path) — official
documentation, **verified** by those roles 2026-09-02.

**INTERPRETATION.** Three decisions in the UW language are worth taking whole. (1) **One language
across five feed types**, so learning it once pays five times. (2) **Scope prefixes that read like
what they are** — `$TICKER`, `@sector`, `#watchlist` are guessable without documentation, and they are
the same sigil family GitHub, Slack and Discord already installed in every trader's hands. (3)
**Field-to-field comparison**, which is precisely what separates a query language from a filter panel:
`volume > open_int` cannot be expressed by any number of sliders.

Benzinga's counter-lesson is equally sharp and is about *distribution*, not syntax: **a query language
whose best expressions ship as a PDF is half-shipped.** The recipes are the product; putting them
outside the product means the language is folklore.

**RELEVANCE TO UCT.** UCT already has a scan definition tree, a criteria builder, and an English→scan
Concierge. On the public evidence there is no *small human-writable surface syntax* a member could
type, read, share or diff — which is the layer UW's evidence says makes a saved screen portable. The
`CoverageLine` idiom UCT already ships (evaluated / answered / dropped / not-computable, and a refusal
to render a receipt whose arithmetic does not close) is the correct companion to any such language:
a query language without an honest coverage receipt turns a data gap into "a quiet market."

**CONFIDENCE.** 🟢 for both grammars as documented. 🟡 for UW's real expressiveness (field lists render
only for logged-in users). 🔴 for whether Benzinga ships an undocumented keyboard layer — a docs-only
absence.

**RECOMMENDATION (hypothesis).** *The natural-language door should EMIT the deterministic text form,
never replace it — the thing the user ends up owning must be inspectable, diffable and shareable.* And:
*the best expressions of any query language belong in a browsable in-product library, not a download.*

**OPEN QUESTION.** Do UW's five subject field-sets agree with the fields its REST screener accepts? If
they diverge, that is a second-authority-over-one-value defect of exactly the shape this repo's own
memory keeps recording.

---

## 8. Software analogs — where the palette conventions actually come from

Six products, read directly, that between them have installed the sigil conventions any 2026 user
already has in their hands.

**VS Code.** `⌘P` Quick Open (files/symbols by name), `⇧⌘P` Command Palette. Prefixes inside the same
box: `>` commands · `@` symbols · `#` file symbols · `:` line number · **`?` displays available
command modes** — *"Type `?` in the input field to get a list of available commands that you can run
from the Command Palette."* [S14] The `?` mode is the finding: **the grammar documents itself from
inside the box**, which is the cheapest discoverability mechanism in this entire survey.

**GitHub.** `Ctrl+K` opens in navigation mode; `>` or `Ctrl+Shift+K` opens **command mode**. Prefixes:
`#` issues/PRs/discussions/projects · `@` users/orgs/repos · `/` files within a repo scope or
repositories · `!` projects [S13]. Two mechanics matter beyond the sigils: *"The command palette shows
your location at the top left and uses it as the scope for suggestions"*, and **scope is adjustable
with the keyboard** — Tab narrows, Backspace widens. Suggestions are optimised *"based on your current
context and resources you've used recently."* [S13] That is the Bloomberg loaded-security idea
rebuilt as a *palette breadcrumb*: context is visible, typed-into, and adjustable without leaving the
box.

**Raycast.** The most precisely documented ranking model found anywhere. Root search is fuzzy —
*"you don't need an exact match, typing `msg` finds Messages, `slk` finds Slack"* — with a
user-adjustable sensitivity (High/Medium/Low). The published ranking order is [S16]:

1. Exact alias match → 2. Alias prefix match → 3. Title fuzzy match score → 4. Subtitle and keyword
matches → 5. **Frecency** (frequency blended with recency).

And *"Root Search learns from you. The more often, and the more recently, you pick a result for a
given query, the higher it ranks the next time you type the same thing"* — with a **Reset Ranking**
action when the learning goes wrong. Aliases are strict-prefix, not fuzzy: *"Typing the full alias
(e.g. `gc`) places the command at the very top of results. This has the highest ranking priority"*
[S15]. Commands take **up to three arguments inline** — *"When you select a command that has arguments,
input fields appear right in the search bar area"* [S16]. **Quicklinks** are user-minted verbs with a
placeholder: *"Quicklinks turn the places you open every day into fast, searchable shortcuts"*, and
they *"support Dynamic Placeholders, which are replaced when the Quicklink runs"* —
`https://google.com/search?q={argument name="query"}` [S17]. A Quicklink is Koyfin's user-assigned
shortcut with an argument slot: the same idea, arrived at from the opposite industry.

**Slack.** `/command [args]`, discovered by typing the slash and reading the menu, which surfaces
*recently used* items first and states argument shape inline — *"The required formatting of any
additional text will be indicated in the shortcut menu."* ~40 built-ins ship *"on every Slack
workspace, from day one"*, and apps contribute more [S18]. The lesson is not the syntax but that
**the argument grammar is taught at the point of typing**, never in a manual.

**Spotlight (macOS).** *"Spotlight helps you quickly find things on your computer and shows
suggestions from apps, files, actions, the internet, and the Clipboard"*, ordered *"top matches
first"*, with *"variations of your search"* suggested. **Up Arrow recalls previous searches.** Apple's
guide states no operator syntax at all [S19]. Spotlight is the pure-ranking end of the spectrum: no
grammar, no sigils, all relevance — and it is the model LSEG's AI-first positioning most resembles.

**Linear.** Widely cited as the keyboard-first exemplar, and **I could not reach its documentation** —
both `linear.app/docs/keyboard-shortcuts` and `linear.app/docs/command-menu` returned 404, and the docs
index I did reach lists no command-menu or shortcuts page [S29]. **No claim about Linear is made in
this file.** Named in GAPS.

**INTERPRETATION.** The convergence across four independent products is the useful signal: `>` for
commands, `@` for entities/people, `#` for items/lists, `/` for scope-or-command, `?` for
self-documentation. These are not arbitrary — a 2026 trader has typed them in Slack, GitHub, Discord
and their editor. **A financial terminal that reuses them spends zero of the user's learning budget on
syntax and all of it on vocabulary.** Unusual Whales already did exactly this (`$AAPL`, `@tech`,
`#mylist`).

**CONFIDENCE.** 🟢 on all quoted mechanics (each read directly from vendor documentation 2026-09-02).
🔴 on Linear.

---

## 9. Comparison table

Read this as *what is documented*, not *what is good*. 🟢/🟡/🔴 is confidence in the row, not quality.

| Product | Grammar shape | Commit | Disambiguation | User-minted verbs | Fuzzy match | Autocomplete presentation | History / favourites | Discoverability aids | Deterministic ↔ AI | Deep-linkable | Conf. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Bloomberg** | Noun-first, 4 slots: `TICKER <SECTOR> FUNC <GO>` | `<GO>` key (green) | Yellow sector key = typed type annotation; type mismatch **errors** | No evidence | Keyword→function (`MERG`), partial ID (`DIS 7`) | Categorised mixed list (functions · securities · searches); typing *is* searching | **Three separate**: `<End/Back>`, `<CMND HISTORY>` (editable text), toolbar recents split into *securities* and *functions*; `LAST <GO>` | `HELP` key ×2 → human; `BMC` course; `FFM` = today's move → the function; `BU`, `BPS`, `BNEW`; Suggested Functions | NL question in the same box → SEARCH screen | Address is text, so shareable; no URL evidence | 🟢 |
| **Godel** | Noun/verb mnemonics, ~45 published codes; composition **undocumented** | Unknown | Unknown | No evidence | Unknown | Unknown | `⌘Z` undo window close; no history evidence | **The whole address space on one public page**; `HELP`/`F1`; `CHANGE` changelog | None documented | Unknown | 🟡 |
| **Koyfin** | Noun-first: `/` → ticker → function → enter; `/FUNC` direct | Enter | Filter by asset type + country; page-name search as fallback | **Yes** — shortcuts on saved chart templates (`fcsp`), dashboards (`DBOLL`), FA templates (`RGM`) | Not documented | Ranked list; **rule published**: best match × trading volume (AUM for funds) | 7 colour link groups; watchlists; no command-history evidence | Help-center hotkey page; 1–3-letter codes; page-name search | None documented in §H | Not documented | 🟢 |
| **LSEG Workspace** | Verb-only app codes **or** a security, into one global bar | Enter | Ranking (unpublished) | Layouts, not verbs | Not documented | Not documented | Layouts | Vendor guides; university guides | Positioned **AI-first** (*"AI-powered search, recommendations…"*) | Not documented | 🟡 |
| **TradingView** | **No grammar.** Type-to-search on chart; 3 modes | Selection | Modes are chosen by intent, not parsed | No | Yes (AI Screener typo-tolerant) | Search box appears on first keystroke, no focus act | Watchlists; layouts | Published 7-category hotkey page | **AI Screener** = mode 3 (NL → a scan) | **Yes** — `/chart/?symbol=NASDAQ:NVDA` | 🟢 |
| **thinkorswim** | Noun-first; lens = the tab; **expression in the noun slot** (`AAA+2*BBB–3*CCC`) | Enter | Not documented | No | Not documented | Not documented | Not documented | thinkManual (no shortcuts/symbol-syntax section) | None documented | Not documented | 🟡 |
| **Benzinga Pro** | **Filter** language: boolean AND/OR/NOT over keywords + tickers | Enter | Default Link routes a ticker click; **creates the receiver if none exists** | Not documented | Not documented | Not documented | Workspaces | **PDF of common search terms** (anti-pattern) | None documented | Not documented | 🟢 |
| **Unusual Whales** | `Ctrl-K` palette + `/cmds`; **separate `where` formula language** for alerts | Enter | `$ticker` `@sector` `#watchlist` scope prefixes; 5 typed subjects | Named saved screens (name carried **in the URL**) | Not documented | Palette returns **data** (contract volume bars, watchlists), not just routes | Watchlists; named screens | Per-type starter recipes, clickable into the editor; API grammar endpoint | **AI filter builder emits the same formula text** | **Yes** — entire filter set + name in query string | 🟢 |
| **VS Code** | Verb-first palette; prefixes `>` `@` `#` `:` `?` | Enter | Prefix chosen by user | Keybindings | Yes | Filtered list under the box | Recently opened (`⌃Tab`) | **`?` lists the modes from inside the box** | n/a | n/a | 🟢 |
| **GitHub** | Verb-first palette; `>` `#` `@` `/` `!` | Enter | **Scope shown top-left and Tab/Backspace adjusts it** | No | Yes | Suggestions change as you type; context- and recency-optimised | "resources you've used recently" | Prefix legend in docs | n/a | n/a | 🟢 |
| **Raycast** | Verb-first root search + up to 3 inline arguments | Enter | Alias (strict prefix) beats fuzzy | **Yes** — aliases, hotkeys, **Quicklinks with `{argument}` placeholders** | Yes, **sensitivity is a setting** | Inline argument fields appear in the search bar | **Frecency, and it learns**; Reset Ranking escape hatch | Published ranking order | n/a | Quicklinks are URLs | 🟢 |
| **Slack** | `/command [args]` | Enter | Slash namespace | App-provided commands | Prefix + menu filter | **Argument shape stated in the menu as you type**; recents first | Recently used shortcuts | ~40 built-ins from day one | n/a | n/a | 🟢 |
| **Spotlight** | No grammar; pure ranking | Return | Categories, top matches first | No | Yes | Categorised, "top matches first" + suggested variations | **Up Arrow = previous searches** | None (Apple states no operators) | n/a | n/a | 🟢 |

**Latency column deliberately omitted.** No product in this survey publishes a suggestion-latency
number, and none was measured. See §12.

---

## 10. Design principles, as hypotheses

Each is falsifiable, each names the evidence it came from, and none is a requirement.

**P1 — One input surface, several input kinds, one categorised result list.** Bloomberg refused to
split the box: mnemonic, keyword, partial identifier and English question all go in, and the *system*
decides. The user never has to answer "is this a search or a command?" — a question with no good
answer when you half-know what you want. [§1]

**P2 — Vocabulary may scale; syntax must not.** One sentence shape means the 3,000th function costs
the user nothing structurally. Every new *interaction idiom* is what actually costs. [§1]

**P3 — The type belongs in the address, and a mismatch must fail loudly.** Bloomberg's yellow sector
key is a type annotation, and `YA` on an index errors rather than rendering something wrong. The UCT
analogue already exists in spirit: "we could not compute it" and "nothing matched" are different facts
to a trader. [§1]

**P4 — Identify the instrument once per context; then change only the lens.** Per-*pane*, never
session-global (global forecloses comparison) and never per-function (destroys the saving). Make the
context **visible and labelled**, with its history one keystroke away. [§1; GitHub's top-left scope is
the palette version, §8]

**P5 — Browsing must be a view over the same addresses.** Bloomberg's menu leaves *are* mnemonics, so
browsing trains the fast path. A menu whose leaves are routes teaches nothing, because there is nothing
faster to teach. The failure mode when they diverge is the second-authority defect this repo has paid
for repeatedly. [§1]

**P6 — Exact alias beats fuzzy; frecency breaks ties; and the ranking should be published.** Raycast's
order is exact alias → alias prefix → title fuzzy → subtitle/keyword → frecency, with a Reset Ranking
escape hatch. Koyfin publishes match × liquidity. A ranking users cannot predict is a ranking they
route around. [§3, §8]

**P7 — Let the user mint verbs pointing at their own saved artefacts.** Koyfin's `fcsp`/`DBOLL`/`RGM`
and Raycast's Quicklinks are the same mechanism from two industries. It converts a saved artefact from
a thing you browse into a thing you invoke, and a code is memorable *because the user chose it*. **This
requires a published collision policy from day one** — it is the one thing neither vendor documents.
[§3, §8]

**P8 — "Where was I?" is three questions, not one.** Back one screen · what did I *type* (recallable
and **editable** before re-running) · what do I always use. Bloomberg gives each its own affordance and
splits recents into *securities* and *functions*. Editable command history is only possible if
navigation is text in the first place — which makes it an argument for P1/P2 rather than a separate
feature. [§1]

**P9 — Reuse the sigils the user already has installed.** `>` command · `@` entity · `#` list/item ·
`$` ticker · `/` scope-or-command · `?` self-documentation. Four independent products converged; UW
already applies it to finance. Free syntax. [§7, §8]

**P10 — The grammar should document itself from inside the box.** VS Code's `?` and Slack's
argument-shape-in-the-menu are the two cheapest discoverability mechanisms found. A manual is where a
grammar goes to be unread. [§8]

**P11 — The AI door emits the deterministic text; it does not replace it.** UW's AI filter builder
composes the same inspectable formula the user could have typed. What the user ends up **owning** must
be diffable and shareable. TradingView's AI Screener is the opposite bet (the NL query is the artifact)
and serves a churning audience. [§5, §7]

**P12 — Every command should be a URL.** UW encodes an entire screener state *and its human name* in
the query string; TradingView's chart is a GET. Deep-linkability is what makes a command shareable in
Discord, pasteable into the Morning Wire, and testable in a rail. [§5, §7]

**P13 — Publish the address space on one page.** Godel's `/docs` is the entire product's vocabulary on
one screen. It is a near-free byproduct of having a grammar and the single best learnability artifact
found. [§2]

**P14 — Teach with today's tape, not a tour.** Bloomberg's `FFM` ("Functions for the Market") applies
functions to *current* market events: a function is memorable when it answered a question you actually
had this morning. UCT already runs a daily wire, a daily session, and Discord — the machinery exists.
[§1 / on-disk Bloomberg §10]

**P15 — Never silently change what a command or key means.** Bloomberg — with unmatched leverage over
its users — could not change what two navigation keys meant without shipping a preference (`PDFU`) to
restore the old behaviour. Muscle memory is not a preference to migrate; it is installed state in a
person. [§1]

---

## 11. Three candidate grammars for a small desk

All three are specified against the same four worked examples from the contract: `NVDA` ·
`NVDA NEWS` · `EARN TODAY` · `/ask …`. All three assume the desk (2–3 people, daily, high volume) as
the first audience and members as the second.

### Grammar A — "Bloomberg-lite": noun-first, space-separated, no sigils

```
NVDA                 → load NVDA into the active pane (and show its function menu)
NVDA NEWS            → news, for NVDA
NVDA D               → daily chart, for NVDA
NVDA/QQQ D           → expression in the noun slot (ratio), daily
EARN TODAY           → non-security function with an argument; no symbol needed
ASK is SMH extended? → the AI verb, no sigil (ASK is just another function)
```
Commit is Enter. The first token is resolved **noun-first**: if it matches a symbol (or a symbol
expression), it becomes the loaded security and the rest of the line is the lens; if not, the whole
line is parsed as a non-security function plus arguments. Type mismatches error by name
(`EARN needs a date or TODAY, not a symbol`), never render an empty surface.

**Pros.** One sentence shape (P2). Composes — the tenth lookup on one name is fast, and the whole
line is recallable and **editable** before re-running (P8). Trivially deep-linkable
(`/t?q=NVDA+NEWS`) (P12). Novice path = expert path (P1). Maps directly onto the desk's existing
spoken shorthand.

**Cons.** *Ticker-vs-word collision is a real, already-known hazard*: `RS`, `EMA`, `MA`, `GAP` and
`PEG` are genuine listed tickers, so `RS NVDA` is ambiguous by construction, and this program's own
memory records the class (`lesson_a_symbol_universe_does_not_settle_a_ticker_match`). Requires a
published precedence rule and a visible "interpreted as" line. It is also the highest-vocabulary
option — and the Bloomberg evidence supports "a grammar makes an expert fast", **not** "a grammar
makes a newcomer stay." Weakest for members.

### Grammar B — "Palette-first": verb-first with the installed sigils

```
Ctrl-K               → palette; bare text fuzzy-matches everything, ranked alias → fuzzy → frecency
NVDA                 → top result "Symbol NVDA — load into active pane"; Enter loads it
>news NVDA           → command mode: run the News surface with NVDA as argument
#earnings today      → item/list mode: today's earnings list
/ask is SMH extended?→ AI mode
$NVDA @semis         → scope prefixes, for filter surfaces
?                    → lists every mode from inside the box
```
**Pros.** Zero syntax to learn — every sigil is already installed from Slack/GitHub/VS Code (P9).
Self-documenting via `?` (P10). Fuzzy + frecency makes it fast within days without any vocabulary
(P6). The safest option for members, and the cheapest to ship on top of an existing route table.
Scope can be shown and adjusted GitHub-style (Tab narrows, Backspace widens) which gives a visible
context without a grammar (P4).

**Cons.** It does not compose: there is no single line that names both an object and a lens and can be
re-run against a different object, so the tenth lookup costs about what the first did. A palette is a
*launcher*, not an address space — which makes P12 (every command is a URL) something you have to add
deliberately rather than get for free. And "frecency learns" is a promise that is invisible until it is
wrong; Raycast ships Reset Ranking for exactly that reason.

### Grammar C — "Context bar + scoped verbs" (Bloomberg's loaded security × Koyfin's user verbs)

The recommended shape to *test first*, because it is the only one that fits the substrate UCT already
has.

```
[ pane A · NVDA ▾ ]   ← persistent, LABELLED current-symbol field per pane, with a recents dropdown
`  (backtick)         → focus the command line from anywhere (Godel's key)
NVDA                  → a bare symbol anywhere retargets THIS pane's loaded security
NEWS                  → a bare verb runs against the loaded security (short, because it is scoped)
D / W / 5             → timeframe verbs, same rule
EARN TODAY            → a non-security function: recognised as such, ignores the loaded security
fcsp                  → a USER-MINTED verb (a saved chart template) — composes with the loaded symbol
DBOLL                 → a user-minted verb that carries its own securities (does not compose)
/ask is SMH extended? → the AI escape hatch, sigil-marked because its output type is different
```
Non-security functions and user verbs live in one namespace with a **published precedence order**
(exact user alias → exact built-in verb → symbol → fuzzy), and the interpreted parse is echoed above
the input so a collision is visible before Enter.

**Pros.** Pays the expensive act once (identifying the instrument) and keeps verbs short *because they
are scoped* (P4, P2). Fits UCT's existing colour-group substrate almost exactly — the group *is* the
per-pane loaded security, and it already persists. Converts every saved screen / chart layout /
multichart grid into an invocable verb (P7). Keeps a single AI sigil so the deterministic and
probabilistic paths are visibly different (P11). Learnable in layers: bare symbols work on day one,
verbs accrete, user verbs come last.

**Cons.** Two modes to hold in the head (scoped verb vs global function), and the whole thing collapses
if **"which pane am I typing into"** is not answered visually. That is a concrete, already-identified
gap: UCT's widget headers deliberately hide their label and carry only a colour dot, and four colour
groups is fewer than Koyfin's seven. Requires the collision policy on day one, not later. And it is the
most work of the three.

**How to choose.** The fork is P1-vs-TradingView (§5): one omnibox that disambiguates, or several
modes each with a correctly-typed result set. The decision should be made against the desk's *tenth*
action of a session (where A and C win) and the member's *first* (where B wins) — and the two audiences
may honestly want different defaults on the same grammar, which C supports and A does not.

---

## 12. Anti-patterns (each observed, each attributable)

1. **A grammar and a menu that can disagree.** Bloomberg's menu leaves *are* mnemonics — one system,
   two front ends. Two vocabularies that drift is the second-authority defect. [§1]
2. **Shipping the query language's best expressions outside the product.** Benzinga's downloadable PDF
   of common search terms is an admission the bar is not self-teaching, and it puts the recipes where
   they cannot be browsed, ranked, or improved. [§7]
3. **A palette that only routes.** UW's search returns watchlists and contract volume bars; Bloomberg's
   returns securities *and* functions *and* searches. A palette that returns only page names is a
   sitemap with a hotkey. [§7]
4. **Leaving the ticker-vs-word collision policy implicit.** `RS`/`EMA`/`MA`/`GAP`/`PEG` are real
   tickers. Koyfin does not document what happens when a user alias shadows a built-in code, and
   neither does anyone else in this survey. Publish precedence, echo the interpreted parse. [§3, §11]
5. **Rendering an empty surface instead of a typed error.** Bloomberg errors when `YA` meets an index.
   An empty screen and a type mismatch are different facts, and a trader will act on the wrong one.
   [§1]
6. **Silently changing what a key or command means.** Bloomberg shipped `PDFU` to revert two
   navigation keys. If TERMINAL-NEXT rebinds anything, ship the old binding as a preference. [§1]
7. **An AI front door that replaces the text form instead of emitting it.** If the artifact the user
   owns is a natural-language string, it cannot be diffed, reviewed, shared or re-run deterministically.
   [§7]
8. **A command that is not a URL.** If a result cannot be pasted into Discord or the wire, the grammar
   stops at the edge of one browser tab. [§5, §7]
9. **Fuzzy matching with no exact-match override.** Raycast puts exact alias at the top *above* fuzzy
   for exactly this reason; without it, a user's own three-letter code loses to a better fuzzy score
   and the user stops trusting their own alias. [§8]
10. **An expression in the noun slot that only half the surfaces accept.** Koyfin documents it plainly:
    relative tickers work in `G`/`GM` but *"can't be used in Watchlists or MyDashboards."* Enumerate the
    accepting surfaces or the feature is half-shipped. [§3, §6]
11. **A hidden context.** Bloomberg labels the loaded security in the panel toolbar and GitHub shows
    scope at the top-left of the palette. A grammar whose current context is inferred from a colour dot
    puts the burden of "which pane will this hit?" on the user at exactly the moment they are typing
    fast. [§1, §8, §11-C]
12. **Assuming members will learn a vocabulary they use twice a week.** Bloomberg's users are
    professionally obliged to learn it and are still given an 8-hour course. The evidence supports "a
    grammar makes an expert fast"; it does not support "a grammar makes a newcomer stay." [§1]

---

## GAPS

**Reached the call budget on none of these; all are reachability or measurement failures. Each names
what would fix it.**

1. **Latency is 🔴 across every product.** No vendor in this survey publishes a suggestion-latency or
   time-to-first-result number, and I measured none. The only defensible anchor I can offer is the
   HCI one: Nielsen's three limits — **0.1 s** *"is about the limit for having the user feel that the
   system is reacting instantaneously"*, **1.0 s** *"is about the limit for the user's flow of thought
   to stay uninterrupted"*, **10 s** *"is about the limit for keeping the user's attention focused on
   the dialogue"* [S26]. Read against a command grammar that means the *suggestion list* has a ~100 ms
   budget per keystroke and the *commit* has ~1 s before it needs progress feedback. That is a design
   target derived from general HCI, **not** a measurement of any terminal. *What would raise it:* an
   instrumented session on any one of these products (the owner has TradingView access; Koyfin has a
   free tier).
2. **Linear was not reached at all.** `linear.app/docs/keyboard-shortcuts` and
   `linear.app/docs/command-menu` both 404; the docs index reached lists neither [S29]. No claim about
   Linear appears in this file. *What would raise it:* the correct current docs slug, or the in-app
   `?` overlay via a logged-in session.
3. **Godel's syntax is unread.** The command *vocabulary* and the *window* shortcuts are verified from
   the vendor's own page, but nothing on that page states whether commands compose with a ticker, or
   how. Per-command doc pages exist ("Click any pill…") and my URL guesses 404'd. *What would raise
   it:* opening one pill in a browser (one click), or a transcript of one of the vendor's own demo
   videos.
4. **TradingView's individual key bindings are behind client-side accordions** — I reproduced the
   sibling dossier's ceiling exactly. Only the seven category names are verified. *What would raise
   it:* one click-capable browser pass on `tradingview.com/support/shortcuts/`.
5. **thinkorswim is the thinnest row in the table.** The vendor's own thinkManual index has no section
   for keyboard shortcuts, symbol syntax, or gadget linking; the Composite Symbols page 404s to a
   direct fetch and is quoted from the search index of that same official page [S23]. I deliberately
   did **not** assert the widely-repeated `/ES` futures / `$SPX` index prefix conventions because I
   reached no vendor page stating them. *What would raise it:* the Schwab/thinkorswim symbol guide
   PDF, or one screenshot of the symbol selector's help.
6. **Bloomberg's autocomplete ranking rule is undocumented** in every source the program has reached,
   and it is the single most consequential unknown for anyone copying P1: a personalised ranking and a
   static relevance sort are indistinguishable from the documentation and wildly different to build.
7. **LSEG Workspace's user documentation is login-walled** (`my.refinitiv.com`). Everything in §4 comes
   from a university library guide, LSEG *developer* documentation, and search-result snippets of
   official LSEG pages. Whether Workspace supports a composed `security + app` expression is unknown in
   both directions.
8. **Koyfin's literal keystroke sequence for user shortcuts is unresolved** — the help page and the
   sibling dossier render it differently (§3, CONFIDENCE). A free Koyfin account settles it in a
   minute; the owner could.
9. **Search channel used.** `WebSearch` was pre-exhausted session-wide (200/200) per the preamble, so
   this role used **WebFetch on known URLs** first and **one browser tab** (created, used, closed) for
   Google search and for the three pages that block non-browser agents. No Bing fallback was needed.
   Queries I could not run: none were blocked; the failures above are 404s, login walls, and
   client-side rendering, not budget.
10. **No product was operated.** Every "feels fast / is discoverable / is learnable" statement in this
    file is documentation-derived. The cheapest single upgrade to this file is one recorded session per
    product on a free tier (Koyfin, TradingView, Godel's 14-day trial), which the owner could authorise.

**Instruction-shaped content observed:** none. No page read for this file contained text addressed to
an automated agent or attempting to redirect this task. Godel's docs page ends with calls to action
(*"Contact sales →"*, *"Book a demo →"*) — ordinary marketing addressed to a human reader, recorded
here as an observation and not acted on.

---

## SOURCES

Tier key: **P1** official vendor documentation · **P2** on-disk program evidence file citing P1 ·
**P3** university library guide · **P4** official-page content read via search index · **P5**
practitioner/founder commentary · **P6** professional HCI reference.

1. **[S1]** Bloomberg, *"Getting started on the Bloomberg Terminal"* (28pp, education edition) — **P1**,
   via [S3]; that role fetched 2026-09-02.
2. **[S2]** Bloomberg, *"STOP `<GO>` — Cancel as a Function, Help Page"* (dated 07/18/2022) — **P1**,
   via [S3]; fetched 2026-09-02.
3. **[S3]** `docs/terminal-research/03-competitive-research/bloomberg/01-search-navigation.md` (B-BBG-01)
   — **P2**, read 2026-09-02. Carries [S1]/[S2] verbatim quotes plus Cornell, Imperial, Yale, John
   Cabot, Michigan Ross, Seton Hall, UIUC, UCD Smurfit (**P3**).
4. **[S4]** `https://godelterminal.com/docs` — **P1**, read in-browser 2026-09-02 (403 to WebFetch).
   Full command reference + global keyboard shortcut table.
5. **[S5]** `docs/terminal-research/03-competitive-research/godel/01-evidence.md` (B-GDL-01) — **P2**,
   read 2026-09-02. Homepage tagline, pricing, funding, positioning.
6. **[S6]** `https://www.koyfin.com/help/hotkeys-and-custom-shortcuts/` — **P1**, fetched 2026-09-02.
7. **[S7]** `https://www.koyfin.com/help/my-dashboards-groups/` — **P1**, fetched 2026-09-02.
8. **[S8]** `docs/terminal-research/03-competitive-research/koyfin/dossier.md` §C, §H — **P2**, read
   2026-09-02; cites Koyfin help-center command-bar, hotkeys, right-sidebar and relative-ticker
   articles (**P1**), fetched by that role 2026-09-02.
9. **[S9]** `docs/terminal-research/03-competitive-research/tradingview/dossier.md` §C, §H — **P2**,
   read 2026-09-02; cites TradingView help-center articles and blog posts (**P1**) plus rendered pages,
   2026-09-02.
10. **[S10]** `https://www.tradingview.com/support/shortcuts/` — **P1**, read in-browser 2026-09-02;
    seven category names + intro sentence verified, individual bindings not reachable.
11. **[S11]** `docs/terminal-research/03-competitive-research/benzinga-pro/dossier.md` §C, §H — **P2**,
    read 2026-09-02; cites Benzinga help-center articles 5, 7, 19, 23, 28 (**P1**), 2026-09-02.
12. **[S12]** `docs/terminal-research/03-competitive-research/unusual-whales/dossier.md` §C, §H —
    **P2**, read 2026-09-02; cites `unusualwhales.com/custom-alerts/reference`, `/options-screener`,
    `/overview`, `/changelog`, and `api.unusualwhales.com/api/openapi` (**P1**), 2026-09-02.
13. **[S13]** `https://docs.github.com/en/get-started/accessibility/github-command-palette` — **P1**,
    fetched 2026-09-02.
14. **[S14]** `https://code.visualstudio.com/docs/getstarted/userinterface` — **P1**, fetched
    2026-09-02.
15. **[S15]** `https://manual.raycast.com/command-aliases-and-hotkeys` — **P1**, fetched 2026-09-02.
16. **[S16]** `https://manual.raycast.com/search-bar` — **P1**, fetched 2026-09-02.
17. **[S17]** `https://manual.raycast.com/quicklinks` — **P1**, fetched 2026-09-02.
18. **[S18]** `https://slack.com/help/articles/201259356-Slash-commands-in-Slack` — **P1**, fetched
    2026-09-02.
19. **[S19]** `https://support.apple.com/guide/mac-help/spotlight-mchlp1008/mac` — **P1**, fetched
    2026-09-02.
20. **[S20]** `https://warwick.libguides.com/buseco/workspace` (University of Warwick) — **P3**,
    fetched 2026-09-02.
21. **[S21]** LSEG Developer Community, *"LSEG Data Library Vol. 1: Calls That Do More"*
    (`developers.lseg.com`) — **P4**, quoted sentence read via Google's index of that official page,
    2026-09-02 (direct URL 404'd).
22. **[S22]** LSEG Data Guide chapters 3, 4 and 5 (`developers.lseg.com`) — **P4**, `DIB`/`EQG`/
    `SCREENER` sentences read via Google's index of those official pages, 2026-09-02.
23. **[S23]** thinkorswim Learning Center, *"Composite Symbols"* (`toslc.thinkorswim.com`) — **P4**,
    quoted sentences read via Google's index of that official page (English and Chinese mirrors),
    2026-09-02; the page 404s to a direct fetch. *A Google AI Overview restating the same content was
    present and was deliberately not used as evidence.*
24. **[S24]** `https://toslc.thinkorswim.com/center/howToTos/thinkManual/Getting-Started` — **P1**,
    fetched 2026-09-02.
25. **[S25]** `https://toslc.thinkorswim.com/center/howToTos/thinkManual` (manual index) — **P1**,
    fetched 2026-09-02; used as the basis for the *absence* of a shortcuts/symbol-syntax section.
26. **[S26]** Jakob Nielsen, *"Response Times: The 3 Important Limits"*, Nielsen Norman Group, 1 Jan
    1993 (updated 2014) — **P6**, fetched 2026-09-02.
27. **[S27]** *Liberty's Highlights*, "Interview with Koyfin co-Founders Rob Koyfman and Rich
    Mathieson", 16 Feb 2021 — **P5**, quoted via search-result snippet 2026-09-02; **reported**, single
    secondary source.
28. **[S28]** `https://www.lseg.com/en/data-analytics/products/workspace` — **P1** (marketing),
    fetched 2026-09-02; **claimed** tier.
29. **[S29]** `https://linear.app/docs` — **P1**, fetched 2026-09-02; command-menu and keyboard-shortcut
    pages **not reachable** (both candidate slugs 404). Recorded for the negative result only.

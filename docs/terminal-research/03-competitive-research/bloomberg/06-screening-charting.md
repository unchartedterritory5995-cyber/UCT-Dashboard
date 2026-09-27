---
id: B-BBG-06
title: Bloomberg Terminal — screening and charting as a workflow
role: Bloomberg screening & charting (Document C Parts VIII, XVII, XIV Workflows A/E, CCXLV)
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — EQS/BQL screening; GP/GIP/G/COMP charting; movers and the "why is it moving" loop
confidence: 🟡
evidence_ceiling: No terminal access. Bloomberg's own authoritative surfaces for this slice (HELP <GO> inside EQS, TECH <GO> study catalogue, HELP BQLX, BU/BPS cheatsheet library) are reachable ONLY from a licensed terminal. Best public primaries are a ©2017 official manual, a 2013 official FFM article, an undated official trader cheat sheet, and a marketing product page. UI details after ~2019 are reconstructed from university library guides, not verified against a current screen.
sources: 6 primary (5 Bloomberg-authored + 1 vendor doc of the official API); 17 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-06 — Screening and charting on the Bloomberg Terminal

**Read this first.** Benchmarks are sources of learning, not specifications. Nothing below is a
requirement for TERMINAL-NEXT. Where a claim is 13 years old I say so; where I could not reach
primary evidence I name the ceiling rather than smoothing it over.

**Vocabulary note for downstream synthesis:** this file describes the *Bloomberg* Terminal.
UCT's existing `/calendar` surface is TERMINAL-CURRENT; the thing being designed is
TERMINAL-NEXT. I never use bare "UCT Terminal".

---

## 0. What could and could not be verified (read before trusting a confidence marker)

The depth this contract asks for — "how a momentum/swing trader uses it daily" — sits mostly
behind the terminal. Concretely:

* Bloomberg's own complete EQS guide is reached by pressing the green `<HELP>` key **from inside
  the EQS function** (stated in Bloomberg's own manual). Not on the public web.
* The catalogue of technical studies lives at `TECH <GO>`, again terminal-only.
* BQL's reference is `HELP BQLX <GO>`; templates at `XLTP BQL <GO>`.
* Bloomberg's cheatsheet library is behind `BU <GO>` → "Access Training Documents" and `BPS <GO>`.

So: **function inventory and workflow shape are well evidenced; pixel-level current UI is not.**
`www.bloomberg.com` returned HTTP 403 to automated fetches throughout; `professional.bloomberg.com`
and a Bloomberg content mirror (`professional.content.cirrus.bloomberg.com`) did answer, which is
where the product-page and webinar evidence comes from.

**What would raise confidence, in order:** (a) one hour on a licensed terminal capturing EQS
Results-page toolbars, the `G` chart library, `TECH`, and an `IMAP` drill; (b) the current
"Getting Started with Bloomberg Charts" / "Bloomberg Technical Study Fact Sheet" PDFs, which a
Baruch College course guide lists by name but does not link publicly; (c) a practitioner
interview with anyone who runs EQS daily. The owner could plausibly supply (a) or (c) via a
university library terminal or a member with buy-side access; (b) is likely obtainable from any
librarian who administers a terminal.

**Source-quality observation (worth recording).** The public corpus on "Bloomberg vs TradingView"
is almost entirely SEO comparison pages and affiliate content, and per the evidence standard I
excluded it. One promising-looking practitioner post ("unlocking the power of the Bloomberg
terminal") turned out to state plainly that its author **does not use a Bloomberg Terminal**.
Treat any confident-sounding "how traders use Bloomberg charts" blog post as unverified until it
names a function.

**Injection-style text encountered (none acted on).** Bloomberg's FFM PDF carries a legal banner:
"The format and content of this report may not be modified or altered (including, but not limited
to, via deletion or addition) in any way." That is a licensing notice aimed at redistributors, not
an instruction to me; I extracted facts and cited the source. No page attempted to redirect my
task.

---

## 1. EQS — the screener is a *staged build*, not a form submit

### OBSERVATION
EQS is not "fill in a form, press search". It is a three-surface loop — **Screening Criteria**
(categorical, drag-and-drop) → **Add Criteria** (a searchable field browser) → **Results** — and
the thing that makes it usable is that a **running count of matching companies updates at the
bottom of the build tab as each criterion lands**, before you ever see the list.

Bloomberg's own manual gives the four steps:

1. `EQS <GO>`.
2. *Screening Criteria*: click a category → a window opens → **drag and drop** the criterion into
   an **Included Options** or **Excluded Options** section → click **Update**. "The Selected
   Screening Criteria section at the bottom of the tab updates with your selected criterion and
   count of company matches."
3. *Add Criteria*: click the **Fields** button → a **Browse Fields** window lists "all of the
   available search criteria fields", navigable by **category tree** *or* **Search field** →
   Select → set the condition(s) → `<GO>`.
4. Click **Results**. Then the red **Output** and **Actions** toolbar buttons offer "saving the
   search or exporting the results to Excel".

Independent university guides describe the same skeleton with the current-day labels: an amber
**Add Criteria** box you can *type* into rather than browse; an **As of** date box on the results
page (i.e. the screen is evaluated *as of a date*, not only "now"); **92) Fields** to change
displayed columns; **96) Action → Edit Criteria** to go back and change the screen; **95) Output**
to export to Excel; a **Custom** tab under Fields with an "Add column" search bar. The Scranton
training manual's worked example shows the funnel scale: "a list of 800k+ global security types
down to 28 displayed" from four criteria (SPX membership, P/E < 40, mkt cap > $10bn, latest
quarterly YoY revenue growth > 15%).

### EVIDENCE
* Bloomberg L.P., *Getting started on the Bloomberg Terminal* (Getting Started Guide for Students,
  English), `data.bloomberglp.com`, ©2017 — official manual, **verified**, fetched 2026-09-02. Steps
  1–4, "count of company matches", Browse Fields, Output/Actions, and the `<HELP>`-from-inside-EQS
  note are quoted from pp. 14–15. [S1]
* ISEG LibGuides, "Terminal Bloomberg — Performing analysis" — university library guide,
  **reported**, 2026-09-02: reproduces the same 4-step EQS sequence and the Output/Actions note. [S11]
* University of South Carolina Library, *Bloomberg Guide — Equity* — university library guide,
  **reported**, 2026-09-02: "As of" date box, `92) Fields`, `96) Action → Edit Criteria`,
  `95) Output` to Excel; "set your parameters by clicking on the criteria of interest or typing a
  criteria in the *Add Criteria* box". [S9]
* Università Bocconi LibGuides, "Stocks and deals screening" — **reported**, 2026-09-02: "Screening
  criteria" vs "Add criteria", **As of** field, **Update**, "See results", Fields → **Custom** tab →
  "Add column". [S10]
* University of Scranton, *Bloomberg Training Manual*, p.22–24 — **reported**, 2026-09-02:
  "Bloomberg supplies pre-set criteria or the user can custom create any filter they would like";
  the 800k → 28 worked example; "Results can be exported to an Excel file or Back tested." [S8]

### INTERPRETATION
Three design decisions are doing the work, and only one of them is "having lots of fields".

1. **The count is on the build surface, not the results surface.** You learn a criterion was too
   aggressive *while composing*, not after. That converts screen-building from
   guess-run-inspect-repeat into a continuous read.
2. **Two doors to the same criteria set** — a browsable category tree for discovery, a text box for
   recall. New users browse; daily users type. Neither is a "beginner mode"; they are the same
   store.
3. **`As of` is a first-class control on the results page.** The screen is a *query over a dated
   snapshot*, not a live feed. That is what makes the same object backtestable (§2) — and it is
   also an honest admission that a screen's answer depends on when you asked.

### RELEVANCE TO UCT
UCT already has the closest analogue in the ecosystem: `/screener` → `SavedScreensPanel` →
`ScanResults` → `CoverageLine`, over declared scalars out of `screener_rows`. Two contrasts stand
out for the desk persona (small options/equities desk building a morning list):

* UCT's `CoverageLine` reports *evaluated · answered · dropped · not computable* **after** a run.
  Bloomberg reports *matches* **during composition**. These are complementary, not competing: the
  first is a receipt about data honesty, the second is a feedback loop about criterion strength.
  Nothing in the Bloomberg evidence suggests it distinguishes "no match" from "cannot compute" at
  all — which is precisely the failure `CoverageLine` exists to prevent.
* Bloomberg's `As of` maps onto UCT's `cadence_ceiling` reasoning (a nightly-scalar screen returns
  the same answer at noon off the 03:00 snapshot). Bloomberg makes that visible as a control; UCT
  currently derives it internally.

### CONFIDENCE
🟢 for the skeleton (official manual + four independent guides agree). 🟡 for current labels and
menu numbers — the numbered toolbar items (`92/95/96`) come from library guides, not from a screen
I saw, and Bloomberg renumbers toolbars between releases. Ceiling: no terminal access.

### RECOMMENDATION (hypothesis, not a requirement)
*Hypothesis:* a live match-count rendered beside the criteria as they are edited would change how
UCT's members build scans more than any additional criterion would — and it is cheap where the
scalars are already nightly and precomputed. **Paired anti-pattern:** do not let that count replace
the coverage receipt. A single number that silently folds "37 matched" and "2,615 not computable"
into "37" is exactly the lie `CoverageLine` was built to refuse.

### OPEN QUESTION
Does EQS's match count distinguish "screened out" from "field unavailable for this security", or
does a missing field silently exclude a name? If Bloomberg silently excludes, that is a
transferable *anti-pattern* worth documenting; if it surfaces it, the mechanism is worth copying.

---

## 2. Saved screens, shared screens, and the asynchronous backtest

### OBSERVATION
An EQS screen is a **named, persistent, addressable object**, and it comes in two classes:
Bloomberg-authored **example screens** and user-authored **private** screens.

* Bloomberg's V3 API exposes exactly that split: a screen type parameter of `'GLOBAL'` ("a
  Bloomberg screen name") or `'PRIVATE'` ("a customized screen name"), with the note that the screen
  "can be a customized equity screen **or one of the Bloomberg example screens** accessed by using
  the `EQS <GO>` option from the Bloomberg terminal." Named Bloomberg examples in that doc:
  `'Frontier Market Stocks with 1 billion USD Market Caps'`, `'Vehicle-Engine-Parts'`.
* The example-screen library has its own door inside EQS: `93 <GO>` opens the sample screen page,
  with an amber `<Search Example Screens>` box with autocomplete. Typing a screen's *name* loads its
  results directly; `96 <GO>` then exposes "edit the criteria and review the screen".
* Saved screens acquire a **UF (User Formula) mnemonic** per one library guide — i.e. a user's
  screen becomes callable, not just re-openable.

**The backtest is the striking part.** From the results of a screen you press **Backtest** (or
`97 <GO>`). You set Analytical Parameters (check *Use Benchmark*, pick e.g. S&P 500), an Analysis
Period with a **rebalance frequency** (quarterly in the worked example), explicit start date and a
relative end date ("Last Quarter End"), then name it and Save & Run. Then:

> "Users receive an e-mail message when the test is finished."

You open the results from a **blue attachment in that e-mail**. The worked example reports the
screened, quarterly-rebalanced portfolio returning 173% against the S&P 500's 94% over the period.

Bloomberg's current product page confirms backtesting is still a charting/analytics selling point
("imitate thousands of scenarios with varied benchmarks"), and a 2023 Bloomberg webinar by its own
Technical Analysis Application Specialist advertises "back-testing … entry signals" and
"back-testing combined with custom risk management strategies" as terminal workflows.

### EVIDENCE
* Bloomberg L.P., *Functions for the Market* — "Using Equity Screening to Identify Growth Ahead of
  Peers", dated 03/25/2013, hosted by Bodleian Libraries — **official training content, verified but
  13 years old**, fetched 2026-09-02. `EQS <GO>`, `93 <GO>` example screens + `<Search Example
  Screens>`, `96 <GO>` edit/review, `97 <GO>`/Backtest button, Use Benchmark, quarterly frequency,
  3/31/09 → Last Quarter End, `1 <GO>` update / `1 <GO>` Run, e-mail-on-completion, blue attachment,
  173% vs 94%. [S2]
* MathWorks, `blp.eqs` (Bloomberg V3 API) — **vendor documentation of the official API**,
  **verified**, fetched 2026-09-02: `stype` ∈ `'GLOBAL' | 'PRIVATE'`; `sname`; the "Bloomberg example
  screens" note; example screen names. [S6]
* Bloomberg Professional Services, *Charts* product page — **official product page, claimed**,
  fetched 2026-09-02: "imitate thousands of scenarios with varied benchmarks". [S4]
* Bloomberg Professional Services webinar listing, *Technical Analysis for Commodity Sellside —
  PART 2*, aired 2023-08-02, presenter Tim McCullough, Technical Analysis Application Specialist —
  **official training content, claimed**, fetched 2026-09-02 via Bloomberg's content mirror: chart
  template configuration; customized factors and technical indicators; back-testing entry signals;
  back-testing with custom risk management. [S5]
* University of Scranton, *Bloomberg Training Manual* p.25 — **reported**: "Results can be exported
  to an Excel file or Back tested." [S8]
* Search-result summary attributing UF (User Formula) mnemonics to saved EQS formulas —
  **general web, unverified**; I could not reach a primary for this and flag it accordingly. [S23]

### INTERPRETATION
Two things here are more interesting than the backtester itself.

**(a) The firm ships opinionated starter screens as ordinary, editable screens.** The example
library is not a walled "demo" area — the API addresses Bloomberg's own screens through the *same*
`sname` parameter as a user's, and `96 <GO>` lets you edit an example's criteria in place. A new
user's first screen is therefore a *fork of an expert's*, not a blank form.

**(b) A long-running analysis is a queued job with an out-of-band delivery, not a spinner.** The
backtest names itself, runs on Bloomberg's side, and mails you when done. The terminal is not held
hostage by its own heaviest feature. This is a 2013 observation and may have modernised — but the
*shape* (name it, queue it, notify me) is the interesting part, and it is exactly how you make an
expensive computation available to people who cannot wait at the screen.

Note the honest limitation: the backtest is a **rebalanced-portfolio** test of a *fundamental*
screen. It answers "would this basket have beaten the benchmark", not "would this entry trigger
have paid". The 2023 webinar's "back-testing entry signals" is a *different*, technical-side
capability whose function name I could not establish.

### RELEVANCE TO UCT
* UCT already has the (a) idiom and should notice it is the same one: `api/services/starter_library.py`
  ships the firm's setups **as ordinary definitions, editable on arrival**, deliberately not a
  read-only class. Bloomberg reaching its own screens through the identical API parameter as a
  user's is independent corroboration that this was the right call.
* (b) is the transferable one. UCT's expensive lanes — the nightly `scan_evaluator.sweep_job`, the
  report card, breadth analogues — already run off the request path, but a *member-initiated* heavy
  run has no "name it, queue it, tell me later" affordance. The desk persona (and the Discord
  membership) already lives in a notification-first world (`AlertBell`, email, Discord webhook),
  so the delivery rail exists.

### CONFIDENCE
🟡. The screen-object model is 🟢 (official API doc + official FFM + guides). The backtest workflow
detail is **verified-as-of-2013 only** — I found no current primary confirming `97 <GO>`, the email
delivery, or the parameter names. `EQBT` as the standalone backtest function is **reported**, not
verified. Ceiling: named above; a single terminal session settles all of it.

### RECOMMENDATION (hypothesis)
*Hypothesis:* the highest-leverage screener feature for UCT is not another criterion but making a
saved definition **addressable and forkable** — and pairing any heavy evaluation with
name-it-and-notify rather than a blocking run. **Anti-pattern to avoid:** a backtest attached to a
screen invites the reader to treat a 173%-vs-94% number as evidence. Any such surface at UCT would
need the survivorship/point-in-time caveat *on the artifact*, not in a doc — this is the same class
of error the base-structure library's retracted base-stage effect already cost the firm.

### OPEN QUESTION
Can an EQS screen *push* — i.e. can a saved screen alert you when a new name enters it? I found no
evidence either way. If Bloomberg's screener is strictly pull-only, that is a real gap a small desk
could beat; if it pushes, the delivery mechanism is worth studying.

---

## 3. BQL — the escape hatch when the screener's vocabulary runs out

### OBSERVATION
BQL (Bloomberg Query Language) is the programmable layer under/beside EQS: "a new, more powerful
API based on normalized, curated, point-in-time data that allows you to perform aggregation,
**screening**, calculations, and other analysis **on Bloomberg's servers**."

Shape of a query — up to five clauses, of which only two are mandatory:

* `let()` — define reusable variables (optional)
* `get()` — *what do you want to know?*
* `for()` — *who do you want to know about?* (the universe)
* `with()` — parameters
* `preferences()`

Screening is expressed as a universe transformation, not a separate product:

```
get(sales_rev_turn)
for(members('SPX Index'))
with(fpo=range(-9Q, 0Q))
```

```
filter(members('SPX Index'), cur_mkt_cap > 10B)
```

```
let(#myvar = LAST(ZSCORE(DROPNA(PX_LAST(dates=range(-30d,0d))))) ;)
get(#myvar)
for(filter(members('SPX Index'), #myvar > 2))
```

Universes can also be a portfolio (`for(members('<portfolioid>', type=PORT))`) and can be
symbol-translated (`translateSymbols(..., targetidtype='fundamentalticker')`). It runs from Excel
(`=BQL(...)`, `BQL.Query`, a **BQL Builder** ribbon with sample queries, `XLTP BQL <GO>` templates)
and from BQuant/`BQNT`; reference is `HELP BQLX <GO>`.

Practitioner-reported limits: broad universes ("equitiesuniv, bonduniv") **time out**, mitigated by
narrowing to PRIMARY/ACTIVE securities; oversized responses fail with a first-class instruction —
`BQL ERROR: Error: Response for px_last is too large. Apply filter() / group() to reduce the size.`
The same practitioner complains that lesser-used features (`currencycheck`, `toscalar`,
`aligndatesby`, cached mode) are thinly documented and that there is no changelog: "Release notes /
blog / whatever for knowing when BQL is changed."

### EVIDENCE
* NYU Libraries, *Bloomberg Guide — Bloomberg Query Language (BQL)* — university library guide,
  **reported**, 2026-09-02: the definition quoted above; the four selling points (customization,
  fewer steps than the old API, cloud-side compute so "you only download the data you need", "No
  programming required"); learning path BQLX / NI FFM BQL / BQL Builder / a 5-part Bloomberg for
  Education video series. [S16]
* Michael Mao, *Bloomberg Query Language (BQL)* (gitbook) — **practitioner**, 2026-09-02:
  `let/get/for`; the SPX z-score screen; BQL vs BDP contrast; `HELP BQLX <GO>`; `XLTP BQL <GO>`. [S18]
* iqmo Tech Blog, *BQL Notes (WIP)* — **practitioner**, 2026-09-02: five clauses, `members()`,
  `filter()`, `translateSymbols`, `type=PORT`, the timeout and "response too large" errors, the
  documentation-gap complaint. [S19]

### INTERPRETATION
The important structural fact is that **screening in BQL is `filter()` over a universe expression**
— the same primitive as "get me a field", composed differently. There is no separate screening
product with its own semantics; EQS is a *view* over a capability the query language expresses
directly. That is the same relationship UCT's `/screener` builder has with its definition tree
(`BuilderSheet.jsx` is explicitly "a VIEW over the definition tree, with the round trip as the
gate").

Second: the error messages teach. "Apply `filter()` / `group()` to reduce the size" tells you the
*fix*, not just the failure. That is a small thing that compounds for a language with thin docs.

Third, the honest caveat: "No programming required: Leverage what you know of Excel" is a marketing
claim reproduced by a library guide, and the practitioner evidence (z-score composition, symbol
translation, timeout tuning) suggests real BQL use is programming. Label it **claimed**, not
verified.

### RELEVANCE TO UCT
UCT's screener already made the same architectural bet — a declared definition tree with a Concierge
(English → a SCAN) and a builder as a view. BQL is the mature form of that bet, and it tells you
where it goes: once the tree can express `filter(universe, expr)` and `group()`, the natural next
users are the desk's own analysts writing expressions, not clicking criteria. UCT's `entitlements`
/ toolkit lookup is the right place for that to be gated.

The transferable *detail* is the error text. UCT's `CoverageLine` already refuses to present a
receipt whose arithmetic does not close; teaching the failure ("this universe is too broad — add a
cap filter") is the same instinct one layer down.

### CONFIDENCE
🟡. Syntax and examples are corroborated across two independent practitioner sources plus a library
guide, and the shape is consistent — but no Bloomberg-authored BQL reference was reachable
(`HELP BQLX` is terminal-only; the Bloomberg webinar page 403'd). Ceiling: a terminal session, or a
BQuant notebook export.

### RECOMMENDATION (hypothesis)
*Hypothesis:* if TERMINAL-NEXT ever exposes an expression layer, `filter(universe, expr)` over the
existing declared scalars is the cheapest possible surface — it reuses the definition tree wholesale
and needs no new evaluation semantics. **Anti-pattern:** shipping it without a changelog. The one
sustained practitioner complaint about BQL is not the syntax, it is not knowing when the language
changed underneath a saved query.

### OPEN QUESTION
Does a BQL-expressed screen and an EQS-built screen return the *same* answer for the same intent —
i.e. is EQS literally compiled to BQL, or is it a second implementation? If the latter, Bloomberg
carries a second-authority-over-one-value defect at enormous scale, and finding out how they manage
it would be genuinely instructive.

---

## 4. Charting — three tiers: quick look, custom chart, chart *library*

### OBSERVATION
Bloomberg's charting is not one function. It is a deliberate ladder, and the top rung is the
interesting one.

**Tier 1 — the quick look, bound to the loaded security.** Bloomberg's own manual lists these as
security-specific functions (you must load a security first: `IBM US <EQUITY> GP <GO>`):

| Mnemonic | Bloomberg's own description |
|---|---|
| `GP` | "Historical price chart" / "Chart securities and technical studies on the Bloomberg Terminal" |
| `GIP` | "Intraday price chart" (up to 240 days back, per secondary sources) |
| `HP` | "Historical price table" (the same data, as numbers) |
| `RG` | "Total return comparison" |
| `HS` | "Visualize and compare the performance of two securities" |
| `GC` | "Chart yield curves and see how interest rates move over time" |
| `GF` | "Visual analysis of a company's fundamentals" |
| `G` | **"Technical analysis and/or Multi-security charts"** |

Bloomberg's own *Equity — Trader* cheat sheet adds the intraday-trader tier, marking
single-security functions with an asterisk:

> `*GIP` Monitor intraday chart · `*IGPO` Display intraday bar chart · `*IGPV` Display intraday
> volume studies · `*IRSI` Access Intraday RSI chart · `*IBOL` View intraday Bollinger Bands ·
> `G` Customize technical charts · `*GPO` Graph historical prices · `GV` Chart historical
> volatilities · `HS` Historical spreads analysis · `*GPCA` Display a graph of historical corporate
> event

Note what is *not* asterisked: **`G` is not a single-security function.** `GIP`, `IGPO`, `IRSI`,
`IBOL`, `GPO`, `GPCA` all are.

Chart *types* are a toolbar toggle, not separate mnemonics in current use, though the mnemonics
survive: `GPC` candle, `GPO` bar/OHLC, `GP` line. A university blog describes clicking "the
candlestick icon positioned above the chart" to switch.

**Tier 2 — the working chart.** From `GP`:
* Time period: preset buttons ("1D, 3D, etc.") at top-left, or **orange date boxes** to "create
  your own fixed date range". Intervals run "from as small as 1 minute to as large as 1 year";
  "The 5min, daily, weekly and monthly are the most widely used."
* Comparison: **Edit → Securities & Data** on the red toolbar to add competitors or indices; or the
  **Security/Study** panel, where "the user can add a security to compare to the listed security.
  This can be anything — a competitor, commodity, etc."
* **Normalise**: via Edit, set all series to a starting value of 100 so proportional moves compare.
* **Annotate**: "Click Annotate to show trend line drawing, percentage retracement and other
  additional functions." A second guide describes annotations added "from the new floating toolbar
  at the top of the chart".
* **Event markers**: "Checking the flag allows the user to show corporate events, news, earnings
  announcements etc. onto the chart" (the cited example is an Under Armour chart with earnings
  announcements flagged). A separate guide names an on-screen **Key Events** icon; the FX charting
  write-up describes marking "specific events, such as major news affecting one of the countries or
  regions, by clicking on 'Event'".
* Export: right-click → copy the graph to clipboard for Word/Excel, **or "copy the data"** instead;
  export as image or vector via the Actions menu; `GRAB` emails the current screen as a JPEG.

**Tier 3 — `G <GO>` is a chart library, and a saved chart becomes a function.** This is the finding
that matters most. From the Scranton walkthrough:

> "Type in upper right hand corner where blue light is blinking. `G<GO>` — You will see a list of
> already defaulted charts, **this is your chart library**."

Then: *Create Graph* → chart class (e.g. "Standard Chart") → security → **Studies** (a checkbox list
plus an *Add Study* search — the example checks Simple Moving Average, RSI, MACD and adds SMA twice
more) → **Themes** (background colour) → **Title the chart**. And then the line that reframes the
whole thing:

> "Next Title the Chart. The example here is titled Graph 53, **therefore the function will be
> `G53`**. Open Chart"

A user-created chart is not a saved file you go looking for. It becomes a **command-line
mnemonic** — indistinguishable in use from Bloomberg's own functions. Per-study editing is
right-click → *Edit Color and Style*, and in the Security/Study panel "click the pencil next to
each and change the period to whatever you prefer"; a volume checkbox sits in the same panel.

Study *definitions* live at `TECH <GO>` — "The main page to study different technical studies";
"Descriptions of these studies can all be seen under the `TECH<GO>` function." Chart defaults across
the whole login are set at `TDEF`.

Bloomberg's own product page adds capabilities I could not verify in a walkthrough: "Pre-packaged
chart applications, shortcuts, and templates"; "**Share and co-edit charts with your communities in
real time**"; "Plot and compare multiple instruments in a single chart"; "Export professional charts
into stakeholder-ready presentations, **all annotations included**, in just a few clicks"; design of
"custom, visual studies"; `MAPS <GO>` for geographic visualisation.

### EVIDENCE
* Bloomberg L.P., *Getting started on the Bloomberg Terminal*, ©2017 — **official manual, verified**,
  2026-09-02: the mnemonic table (GP/GIP/HP/RG/G "Technical analysis and/or Multi-security charts");
  the Charting & graphs cheat list (GP, HS, GC, GF, ECWB); "GP (Graph Price) is a security-specific
  function … You must load a security to run the GP function: `IBM US <EQUITY> GP <GO>`". [S1]
* Bloomberg L.P., *Equity — Trader* function cheat sheet (undated; hosted by ALPFA FIU, uploaded
  2019-04) — **official cheat sheet via third-party host, verified as text**, 2026-09-02: the
  Charting & Technicals block quoted above, with the asterisk convention "* Denotes a
  single-security function". [S3]
* University of Scranton (Kania SOM), *Technical Analysis* (Equity–Charting.pdf) and the identical
  section in *Bloomberg Training Manual* pp.37–41 — **university tutorial, reported**, 2026-09-02:
  `TECH<GO>`, `GP<GO>`, the full `G<GO>` → Create Graph → Studies → Add Study → Themes → Title
  walkthrough, "therefore the function will be `G53`", Edit Color and Style, the pencil/period edit,
  the volume checkbox, `Annotate` → trend line + percentage retracement, the **flag** checkbox for
  corporate events/news/earnings, "1 minute to as large as 1 year", "5min, daily, weekly and monthly
  are the most widely used". [S7][S8]
* Cranfield University Library blog, *How do I create a share price graph in Bloomberg?* —
  **reported**, 2026-09-02: `<GP Line Chart>` from the Equities menu, 12-month default with volume
  below; preset (1D, 3D…) and orange date boxes; **Edit → Securities & Data**; candlestick icon;
  **Annotate**; **Key Events** icon; normalise to 100; right-click copy graph *or* copy the data. [S14]
* Wharton (Lippincott Library) *Datapoints* blog, "Bloomberg FX functions part 2: Charting features",
  2016-04-29 — **reported**: GP line / GPC candle / GPO bar; "control area, side panel, and chart
  display"; overlay additional instruments via **Security/Study**; mark events via **Event**; export
  as image or vector via Actions; charts can be saved. [S13]
* Bloomberg Professional Services, *Charts* product page — **official product page, claimed**,
  2026-09-02: templates/shortcuts, real-time share **and co-edit**, multi-instrument in one chart,
  annotations preserved on export, custom visual studies, `MAPS <GO>`. [S4]
* Corporate Finance Institute, *Bloomberg Terminal Functions & Shortcuts* — **professional tutorial,
  reported**: "`G` — Custom Technical Charts — Allows you to create and organize all of your custom
  charts"; "`GIP` — Intraday Price Graph – up to 240 days". [S21]
* University of Delaware (Lerner), *Bloomberg Functions List* — **reported**: "`G` to build custom
  graphs"; "`COMP` … allows you to compare returns against 2 other securities"; "`GRAB` … email the
  screen as a jpeg file"; "`BLP` Bloomberg Launchpad allows you to create a custom screen with a
  stock monitor"; "`ALRT` To have Bloomberg alert you of price movements". [S20]
* Stanford Libraries, *Bloomberg Terminal Guide — Tips and Tricks* — **reported**: "Use `W <GO>` to
  save custom layouts, charts and data, allowing you to access them easily in future sessions." [S15]
* Search-result summary attributing to a Bloomberg training document the claim that charts "can be
  used as templates that will apply to any security or they can be created to display the same data
  items for the same security each time referenced", and that `TDEF` customises chart defaults —
  **general web, UNVERIFIED**; the underlying page (studylib) returned HTTP 429 on two attempts. [S23]

### INTERPRETATION
**The chart library is the design idea, not the studies.** Bloomberg's technical-study set
(SMA/RSI/MACD/Bollinger/Fibonacci/Gann, per the Baruch course guide's list) is unremarkable and
matched by free tools. What is *not* matched is that a chart you built becomes `G53` — a
first-class, keyboard-reachable command with the same standing as `DES` or `GP`. The consequence
is behavioural: an expert's daily chart is one three-keystroke recall, and the muscle memory is the
same muscle memory as everything else on the terminal. There is no separate "my saved charts" place
to navigate to.

**The template/security-locked distinction is the hinge**, and it is exactly where my evidence is
weakest. If a `G` chart can be *either* pinned to a security *or* applied to whatever is loaded,
then `G53` behaves like a lens the user carries from name to name — which is what makes "context
follows the user across functions" true for charts and not just for data screens. Two facts support
this reading: Bloomberg's own manual calls `G` "Technical analysis **and/or Multi-security** charts",
and its own trader cheat sheet pointedly does *not* mark `G` as single-security while marking
`GIP`/`GPO`/`GPCA` as such. But the explicit statement comes only from a source I could not fetch,
so I am labelling the mechanism 🟡 and the *inference* as an inference.

**Event markers are a checkbox, not a feature.** Corporate events, news and earnings render on the
price chart from a flag in the same panel that adds a comparison series. That is a small thing with
a large effect: the "why did it move" answer is *on the chart*, in the same glance as the move,
rather than one navigation away.

**"Copy the data" beside "copy the graph"** is a quiet tell about the audience. Charts on this
terminal are inputs to something else — a note, a model, a client deck — not terminal outputs.

**Anti-pattern candidate.** The ladder GP → GPC/GPO → G → G53, plus TECH for definitions, TDEF for
defaults, W for layouts, GRAB for sharing, is *seven* places to learn before a chart is yours. The
functions are individually coherent and collectively a curriculum. That is affordable at
Bloomberg's price point and training budget (BMC, BU, BPS); it is not obviously affordable for a
small desk plus retail-plus members.

### RELEVANCE TO UCT
UCT's `/charts` workspace is already further along than the Bloomberg *mechanics* in several ways
(react-grid-layout workspace, 4 colour groups for cross-widget symbol linking, the multi-chart N×M
grid with `GRID_MAX_CELLS=16`, drawings via `ChartDrawingOverlay`, per-widget TF persistence,
named grid templates in `/api/charts/layouts` with `layout.kind='multichart'`). The gaps this
research actually exposes are narrower and more interesting:

1. **Addressability.** UCT persists layouts and named grids, but a saved chart/grid is not
   *callable*. Bloomberg's `G53` is the strongest argument in this file for giving saved artifacts a
   short, typeable identity. UCT already has the door: `SymbolSearch`'s type-to-search on a focused
   chart, and the voice assistant's `PAGE_ALIASES` resolution.
2. **Template-vs-pinned.** UCT's grid templates "DO store tickers/tfs/chartTypes (unlike
   arrangement-only workspace templates)" — the codebase already contains *both* halves of the
   Bloomberg distinction, and already treats it as a deliberate design axis. That is worth naming
   explicitly rather than leaving as a per-feature accident.
3. **Event markers on the price chart.** UCT has the data (catalysts with `catalyst_date`,
   `EVTS`-equivalent earnings dates, `modelbook_catalysts`, the Model Book's `ChartCalloutOverlay`
   leader-line callouts) and has already solved the label-placement problem the Model Book needed.
   Bloomberg reduces the whole thing to one checkbox in the same panel as "add a comparison series".
4. **Study/definition catalogue.** `TECH <GO>` as *the place where studies are explained* has a
   direct UCT analogue in the Setup Library / `setupCatalog.js` field guide — the same instinct
   (definitions live somewhere addressable, not in a tooltip).

### CONFIDENCE
🟢 for the function inventory and for the `G` chart-library workflow (an official manual, an
official cheat sheet, and a step-by-step university walkthrough agree, and the walkthrough is
specific enough — "titled Graph 53, therefore the function will be `G53`" — that it is
near-certainly copied from a real screen).
🟡 for template-vs-security-locked semantics, `TDEF`, and everything on the product page
(share/co-edit, pre-packaged chart applications, custom visual studies) — those are marketing
claims I could not corroborate with a walkthrough.
🔴 for anything quantitative: I have **no** count of available technical studies, no drawing-tool
inventory, and no evidence about chart-level alerting (e.g. alert on a trendline break).
Ceiling: named in §0.

### RECOMMENDATION (hypothesis)
*Hypothesis A:* giving a saved UCT chart/grid a short callable identity — reachable from the same
place a ticker is typed — would compound with the existing workspace far more cheaply than adding
chart features. The evidence that this is the durable part of Bloomberg's charting is that it is
the only part a free charting tool has not copied.

*Hypothesis B:* an events-on-chart checkbox (earnings · catalysts · news) sitting in the same panel
as the comparison-series control would put UCT's existing catalyst data where the question is asked.
The renderer already exists.

*Anti-pattern to avoid:* the seven-surface curriculum. If TERMINAL-NEXT adds a library, a defaults
page, a study catalogue and a share verb, each as its own place, the desk will pay Bloomberg's
learning cost without Bloomberg's training budget.

### OPEN QUESTION
Can a Bloomberg chart carry an **alert** — trendline break, study crossover, level touch — or is
alerting strictly a separate `ALRT` price-condition object? This is the single most decision-relevant
unknown in this file for UCT, because UCT's drawings are already persisted per symbol and its alert
delivery (in-app, email, Discord) already exists; whether the *chart* is an alert surface is a
design fork, not a feature.

---

## 5. "Why is it moving?" — the movers loop (Workflow A)

### OBSERVATION
Bloomberg does not answer "why is it moving" with one function. It offers a **rack of movers
lenses**, each cutting the same tape a different way, and the answer comes from clicking through to
news. From Bloomberg's own *Equity — Trader* cheat sheet, under "Equity Markets/Monitors":

> `WEI` Monitor world equity indices · `MOST` View most active stocks · `MMAP` Display market heat
> map · `IMAP` Analyse intraday price changes · `IMOV` Monitor group movers · `HILO` Display 52-week
> high/low · `MRR/GRR` Best & worst performing stocks & groups · `LVI` View largest volume increases
> · `OVI` See largest option volume change · `SIA` Analyse short interest data · `WAD` View
> advance/decline indices · `MARB` Monitor M&A arbitrage · `IPO` Track equity offerings

And the closing of the loop, from a university manual:

> "`MOST` … shows the largest volume movers, change up, change down, 52 week highs/low. From this
> screen you can easily change to other indices and filter by sector. Other most active functions
> include `LVI` — Largest volume movers, `MOV` — Largest movers up/down. The most efficient function
> for this is `MOST`. **You can also click to view the news of the day and distinguish why the stock
> is up/down.**"

`MOV` is described elsewhere as "Index & Industry Group Movers — Shows stocks that drive the
movement of a selected index" — i.e. **contribution decomposition**, not just a sorted change list.
`IMAP` is rendered variously as "Analyse intraday price changes" (Bloomberg's own sheet) and "Global
equity performance" (a US university list) — consistent with a map/heat-map treatment of intraday
moves; `MMAP` is explicitly the heat map.

Alongside these, the trader sheet lists the news rack (`NSE` news search, `NRR` news readership &
sentiment rankings, `NRS` news sentiment on a list, `READ` most-read, `TOP`, `NI STK`, `NI RLS`
company press releases, `NLRT` create news alert) and the microstructure rack (`MDM` market depth,
`QR/QRC` quote recap, `QM` quote montage, `VWAP`, `OMON` options monitor, `ALRT` custom alerts).

### EVIDENCE
* Bloomberg L.P., *Equity — Trader* cheat sheet — **official, verified as text**, 2026-09-02: the
  Equity Markets/Monitors, News & Economic Data, and Trading Analytics blocks quoted above. [S3]
* University of Scranton, *Bloomberg Training Manual* p.22 — **reported**, 2026-09-02: the `MOST` /
  `LVI` / `MOV` paragraph including "click to view the news of the day and distinguish why the stock
  is up/down". [S8]
* Corporate Finance Institute — **reported**: "`MOV`: Index & Industry Group Movers — Shows stocks
  that drive the movement of a selected index"; "`MOST`: Most Active Securities". [S21]
* University of Delaware (Lerner) — **reported**: "`IMOV` — Index movers"; "`IMAP` — Global equity
  performance". [S20]

### INTERPRETATION
The workflow is **list → filter by sector → click → news**, and the terminal's contribution is not
insight but *adjacency*: the movers list, the sector filter, the index-contribution view and the
news are all one click apart and share the loaded-security context. Bloomberg does not tell you why
a stock moved; it makes the distance between "it moved" and "here is today's story" close to zero,
and offers several orthogonal cuts (volume, options volume, short interest, group membership, 52-week
extremes) so the trader can pick the lens that fits the hypothesis.

Two rungs are worth separating. `MOST`/`MOV` sorted-change lists are commodity. **`MOV`'s
index-contribution framing and `IMOV`'s group movers are not** — they answer "what is *dragging the
index*", which is a different question from "what moved most", and it is the question that starts a
rotation thesis rather than a single-name one.

### RELEVANCE TO UCT
UCT's `MoversSidebar` (ripping/drilling, ≥3% gap filter, 30s poll) plus `CatalystTable` (the
scored, tagged, LLM-synthesised 20-row catalyst board with `catalyst_at` provenance and ⓘ citations)
already occupy this territory — and in one respect go past it: Bloomberg's loop makes the trader
*find* the story by clicking, while UCT's catalyst engine *pre-answers* it with a cited thesis. The
gaps are the ones Bloomberg's rack makes visible:

* **Contribution, not just change.** UCT has no `MOV` equivalent — nothing that says "these five
  names are 60% of today's SPY move" or "the sector is up but on two names". UCT holds the inputs
  (breadth monitor, theme taxonomy with 2,029 holdings, sector flow over 11 SPDR ETFs).
* **Orthogonal lenses on one tape.** Bloomberg's `LVI`/`OVI`/`SIA`/`HILO` are four different
  hypotheses about *why* a name is on the list. UCT's movers filter is a single gap threshold; the
  richer signals exist (options flow, dark pool, breadth NH/NL, short interest is absent) but are on
  separate pages.
* **`MMAP`/`IMAP` as a spatial read.** UCT's breadth Heatmap treemap is the analogue and is already
  drill-capable via `HM_METRICS` → `drillKey` → DrillModal. Bloomberg applies the map idea to
  *price moves*, not to breadth metrics.

### CONFIDENCE
🟢 for the function inventory (Bloomberg's own trader cheat sheet, corroborated by two independent
lists). 🟡 for the workflow narrative — "click through to news" comes from one university manual and
matches the terminal's general design, but I did not see it demonstrated, and I have no
practitioner account of the *order* a trader actually runs these in.
🔴 for `IMAP`'s current behaviour specifically: two sources describe it differently ("intraday price
changes" vs "global equity performance") and I could not reconcile them without a screen.

### RECOMMENDATION (hypothesis)
*Hypothesis:* the transferable idea from this rack is **contribution decomposition** (`MOV`), not
another movers list. "Which names are producing the index/sector move" is a question a small desk
asks every morning and that UCT's existing theme/breadth data can answer without a new provider.
**Anti-pattern:** copying the rack itself. Thirteen mover functions is an inventory a full-time
professional maintains muscle memory for; the same thirteen as thirteen UCT pages would be thirteen
surfaces nobody visits — which is a failure mode this codebase has already recorded more than once
(a built, tested, green surface reached by no door).

### OPEN QUESTION
When a trader is asked "why is X up 8%?", which function do they actually hit first — `MOST`, the
security's `CN`, `BQ` (the cheat sheet's "composite view of price, trade data & news"), or `GIP`
with news flags on? The answer determines whether the winning surface is a *list*, a *composite
security page*, or a *chart*. I have inventory for all three and behaviour for none.

---

## 6. Workflow E — what the day actually looks like (reconstructed, not observed)

### OBSERVATION
Bloomberg publishes a persona-scoped function sheet titled **"Equity — Trader"**, organised into
exactly nine blocks: News & Economic Data · Equity Markets/Monitors · Broad Market Perspectives ·
Trading Analytics · Charting & Technicals · Company Analysis · Comparative Analysis · Earnings &
Dividends · Communications. Its asterisk convention ("* Denotes a single-security function") is the
terminal's core navigational grammar made explicit on a page: some functions consume the loaded
security, others do not.

Reading the sheet as a day, the implied loop is: overnight news (`TOP`, `READ`, `NI STK`, `NI RLS`)
→ the tape (`WEI`, `MOST`, `IMAP`, `IMOV`, `HILO`, `LVI`) → a name (`DES`, `BQ`, `CN`) → the chart
(`GIP` intraday, `IRSI`/`IBOL`/`IGPV` intraday studies, `G`/`G##` for the trader's own chart) →
context (`RV`, `RVC`, `COMP`, `EE`, `SURP`, `EVTS`) → execution-adjacent (`QM`, `MDM`, `VWAP`,
`OMON`) → alerts (`ALRT`, `NLRT`) → share it (`MSGM`, `IB`, `GRAB`, `TMSG` "Send and receive trade
ideas").

### EVIDENCE
* Bloomberg L.P., *Equity — Trader* cheat sheet — **official, verified as text**, 2026-09-02.
  Everything in the paragraph above is a mnemonic and gloss taken directly from that sheet; the
  *sequencing* is my inference, explicitly labelled. [S3]
* Bloomberg L.P., *Getting started on the Bloomberg Terminal* — **verified**: `BU <GO>` → "Access
  Training Documents" is where these persona cheat sheets come from; `BPS <GO>` for other security
  types. [S1]

### INTERPRETATION
Two structural observations, both transferable, neither a feature.

**(1) Bloomberg ships the workflow as a document, per persona.** A trader and an analyst get
different one-page maps of the same terminal. The map is not a menu — it is an *editorial* artifact
that says "for your job, these ~90 of the 30,000 functions". That is how a surface this large stays
learnable, and it is a content investment, not an engineering one.

**(2) The asterisk is the whole navigation model on one page.** "This function consumes the loaded
security; this one does not" is the single most important thing to know about the terminal, and it
is taught as a typographic convention rather than a paragraph.

Honest caveat: this is a *sheet*, not an observation of a trader. I have no evidence about
frequency, ordering, or what gets ignored. The sequencing above is a plausible reconstruction and is
marked 🟡 for that reason — per the evidence standard, a plausible workflow written as fact would be
a failure of this report.

### RELEVANCE TO UCT
* UCT's ecosystem has grown past the point where a member can hold it in their head — 17 nav tabs,
  Breadth's five sub-tabs, the `/charts` widget registry, the screener's definition tree, Compass's
  ten coaching surfaces. There is currently no *persona map*: no one-page "if you are a swing trader
  at this desk, here are the twelve places you live". Bloomberg's answer to exactly this problem is
  a cheat sheet per persona, reachable by a mnemonic (`BU`, `BPS`).
* The asterisk convention has a direct analogue UCT already implements but does not *teach*: the
  colour-group linking in `/charts` (a widget on group A follows group A's symbol) is precisely
  "does this surface consume the loaded security?" — made a colour rather than a typographic mark.

### CONFIDENCE
🟡 overall. The sheet is primary and verified; the day-shape derived from it is inference. Ceiling:
one practitioner interview or one published "day in the life on the terminal" that names functions
would move this to 🟢; I found none that met the evidence standard (see §0's note on the substack).

### RECOMMENDATION (hypothesis)
*Hypothesis:* a per-persona one-page function map — "the desk's morning", "the swing member's week"
— is a cheap, high-leverage artifact for TERMINAL-NEXT, and Bloomberg's version suggests it should
be *editorial and opinionated* (a curated ~10% of the surface), not generated from the nav tree. A
generated map is a menu; the value is in what it leaves out.

### OPEN QUESTION
How often are these cheat sheets revised, and does Bloomberg treat them as documentation or as
onboarding collateral? If they drift (a documented function that has moved or died), Bloomberg has
the same hand-typed-inventory-beside-the-thing-it-describes defect this repo keeps rediscovering —
and how a firm at that scale manages it would be worth knowing.

---

## GAPS (budget not reached; recorded honestly)

1. **No terminal access — the binding constraint.** Every 🔴 and most 🟡 in this file resolves with
   one licensed session. Priority captures: EQS Results-page toolbars (are `92/95/96` current?);
   whether EQS can alert on new entrants; `G <GO>` chart-library screen (template vs pinned); `TECH
   <GO>` study list and count; `IMAP` actual behaviour; whether a chart can carry an alert.
2. **Technical-study inventory: zero quantitative evidence.** I have named studies (SMA, RSI, MACD,
   Bollinger, Gann, Fibonacci, "percentage retracement") but no count, no categorisation, and
   nothing on custom-study authoring beyond the product page's "design custom, visual studies".
3. **Drawing/annotation tool inventory unverified.** "Trend line drawing, percentage retracement and
   other additional functions" is the deepest public description I found. No list, no keyboard
   model, no evidence on whether drawings persist per security across sessions.
4. **The backtest evidence is 2013.** `97 <GO>`, the email-on-completion delivery and the parameter
   panel are verified only as of 2013-03-25. `EQBT` as the current standalone function is reported,
   not verified. The 2023 webinar's "back-testing entry signals" implies a *technical* backtester
   whose function name I never established.
5. **Chart collaboration unverified.** "Share and co-edit charts with your communities in real time"
   is an unelaborated product-page claim — no evidence of the mechanism, permissions, or whether
   "communities" means IB chat rooms.
6. **Bloomberg's own web properties blocked automated fetch.** `www.bloomberg.com` returned 403
   throughout (including the "Bloomberg Terminal Essentials: Best equities functions" article and the
   custom-factors screening webinar page). Browser tools could plausibly retrieve these; I did not
   spend budget there because the same facts were reachable from official PDFs.
7. **No practitioner evidence meeting the standard.** I found no r/finance, WSO or blog account of
   daily EQS/charting use that named functions and claimed direct experience. WSO's function list
   returned 403. This is the single biggest hole in Workflow E and the one the owner is most likely
   able to fill from the member base.
8. **Deliberately not researched (sibling scope):** news/alerts mechanics (B-BBG-03), earnings and
   estimates (B-BBG-04), fundamentals/RV depth (B-BBG-05), Launchpad/monitors (B-BBG-02), Excel
   add-in and BLPAPI licensing (B-BBG-07). `BLP`, `ALRT`, `RV`, `EE` etc. appear above only where a
   screening or charting workflow passes through them.

---

## SOURCES

Tier key follows the preamble's ordering. All fetched 2026-09-02.

**Primary — Bloomberg-authored**

1. **[S1]** Bloomberg L.P., *Getting started on the Bloomberg Terminal* (Getting Started Guide for
   Students, English), PDF, ©2017 Bloomberg L.P. (doc code 62353 DIG 1117), 28pp.
   `https://data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf`
   — *Tier 2, official manual. Verified.* Note: 2017; UI may have moved.
2. **[S2]** Bloomberg L.P., *Functions for the Market*: "Using Equity Screening to Identify Growth
   Ahead of Peers", 2013-03-25, hosted by Bodleian Libraries, University of Oxford.
   `https://www.bodleian.ox.ac.uk/sites/default/files/bodreader/documents/media/bloomberg-equity-screening.pdf`
   — *Tier 5, official training content (FFM). Verified as of 2013.*
3. **[S3]** Bloomberg L.P., *Equity — Trader* function cheat sheet (undated; hosted by ALPFA FIU,
   upload path dated 2019-04).
   `https://alpfafiu.org/wp-content/uploads/2019/04/Bloomberg-Equity-Trader-Functions.pdf`
   — *Tier 2, official cheat sheet via third-party host. Verified as text; publication date
   unconfirmed.*
4. **[S4]** Bloomberg Professional Services, *Charts* product page.
   `https://professional.bloomberg.com/products/bloomberg-terminal/charts`
   — *Tier 3, official product page. Claimed (marketing).*
5. **[S5]** Bloomberg Professional Services, webinar listing: *Technical Analysis for Commodity
   Sellside — PART 2*, aired 2023-08-02, 52 min, presenter Tim McCullough (Technical Analysis
   Application Specialist, Bloomberg). Retrieved via Bloomberg's content mirror
   `https://professional.content.cirrus.bloomberg.com/professional2023/?p=54575`
   — *Tier 5, official training content. Claimed (description only; transcript not read).*

**Primary — vendor documentation of the official API**

6. **[S6]** MathWorks, `blp.eqs` — *Equity screening data for Bloomberg connection V3*.
   `https://www.mathworks.com/help/datafeed/blp.eqs.html`
   — *Tier 4-adjacent: third-party vendor documentation of Bloomberg's official API, not
   Bloomberg-authored. Verified for the API surface (`stype` GLOBAL/PRIVATE, `sname`).*

**Secondary — university library guides and professional tutorials (Tier 9)**

7. **[S7]** University of Scranton, Kania School of Management, *Technical Analysis* (Equity–
   Charting.pdf), 9pp.
   `https://www.scranton.edu/academics/ksom/alperin/Equity-%20Charting.pdf` — *Reported.*
8. **[S8]** University of Scranton, *Bloomberg Training Manual*, 69pp.
   `https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf` — *Reported.*
9. **[S9]** University of South Carolina Libraries, *Bloomberg Guide — Equity*.
   `https://guides.library.sc.edu/c.php?g=1133564&p=8272559` — *Reported.*
10. **[S10]** Università Bocconi LibGuides, *Stocks and deals screening — Bloomberg*.
    `https://unibocconi.libguides.com/c.php?g=706997&p=5101015` — *Reported.*
11. **[S11]** ISEG (Lisbon) LibGuides, *Terminal Bloomberg — Performing analysis*.
    `https://iseg.libguides.com/c.php?g=706923&p=5094209` — *Reported.*
12. **[S12]** Copenhagen Business School LibGuides, *Bloomberg — GP function* (guide index and
    Introduction page). `https://libguides.cbs.dk/gp_function_bloomberg` — *Reported; thin.*
13. **[S13]** Wharton School, Lippincott Library, *Datapoints* blog: "Bloomberg FX functions part 2:
    Charting features", 2016-04-29.
    `https://lippincottlibrary.wordpress.com/2016/04/29/bloomberg-fx-functions-part-2-charting-features/`
    — *Reported; 2016.*
14. **[S14]** Cranfield University Library blog, *How do I create a share price graph in Bloomberg?*
    `https://blogs.cranfield.ac.uk/library/price-graph-bloomberg/` — *Reported.*
15. **[S15]** Stanford University Libraries, *Bloomberg Terminal Guide — Tips and Tricks*.
    `https://guides.library.stanford.edu/bloomberg_terminal/tips_tricks` — *Reported.*
16. **[S16]** NYU Libraries, *Bloomberg Guide — Bloomberg Query Language (BQL)*.
    `https://guides.nyu.edu/bloombergguide/bloomberg-query-language-bql` — *Reported.*
17. **[S17]** NYU Libraries, *Bloomberg Guide — Popular commands*.
    `https://guides.nyu.edu/bloombergguide/popular-commands` — *Reported.*
20. **[S20]** University of Delaware, Lerner College, *Bloomberg Functions List*.
    `https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/` — *Reported.*
21. **[S21]** Corporate Finance Institute, *Bloomberg Terminal Functions & Shortcuts — Complete List*.
    `https://corporatefinanceinstitute.com/resources/equities/bloomberg-functions-shortcuts-list/`
    — *Tier 9/11, professional tutorial. Reported.*
22. **[S22]** York University Libraries, *Bloomberg Getting Started Guide — Equities*.
    `https://researchguides.library.yorku.ca/bloomberg/equities` — *Reported; no charting content.*
    Also consulted: Baruch College (CUNY), *FIN 4775: Technical Analysis — Bloomberg Professional &
    FactSet*, `https://guides.newman.baruch.cuny.edu/c.php?g=188442&p=1243497` — names the studies
    (Candlesticks, Bollinger Bands, Gann lines, Fibonacci series, RSI, MACD) and lists four Bloomberg
    fact sheets by title ("Bloomberg Charts Fact Sheet", "Bloomberg Charts in Excel Fact Sheet",
    "Bloomberg Technical Study Fact Sheet", "Getting Started with Bloomberg Charts User Guide") that
    are **not publicly linked** — the clearest single lead for closing gaps 2 and 3.

**Practitioner (Tier 10)**

18. **[S18]** Michael Mao, *Bloomberg Query Language (BQL)* (gitbook).
    `https://michael-mao.gitbook.io/bloomberg/bql/bloomberg-query-language-bql` — *Reported.*
19. **[S19]** iqmo Tech Blog, *BQL Notes (WIP)*.
    `https://blog.iqmo.com/blog/bqnt/writing_bql/` — *Reported; includes first-hand error messages
    and limitations.*

**Unverified / excluded**

23. **[S23]** A general-web search summary attributed chart-template semantics ("charts can be used
    as templates that will apply to any security or they can be created to display the same data
    items for the same security each time referenced") and `TDEF` chart defaults to a Bloomberg
    training document mirrored on studylib (`https://studylib.net/doc/8159117/bloomberg`). The page
    returned HTTP 429 on two attempts. **Unverified — cited only where explicitly flagged.**
24. *Excluded as evidence per the preamble:* the "Bloomberg Terminal vs TradingView" comparison-page
    corpus (tradingbrokers.com, saasworthy, tockmarket, pineify, helmterminal) — SEO/affiliate
    comparison content. Also excluded: `optionsoracle.substack.com`, "unlocking the power of the
    Bloomberg terminal", whose author states they do not use a Bloomberg Terminal.
25. *Blocked:* `www.bloomberg.com` (HTTP 403 on all attempts, including "Bloomberg Terminal
    Essentials: Best equities functions" and the "Leveraging Custom Factors in Screening, Scoring &
    Backtesting" webinar page); `wallstreetoasis.com` (HTTP 403); `studylib.net` (HTTP 429).

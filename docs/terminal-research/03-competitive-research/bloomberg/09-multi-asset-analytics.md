---
id: B-BBG-09
title: Bloomberg Terminal — macro, rates, fixed income, FX, commodities, derivatives, portfolio/risk and people intelligence
role: Bloomberg multi-asset analytics gap-closer (Document C Part LX §D/§F/§E.7 extension; owner-directed follow-on wave)
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — the asset classes and analytics families the original eight leaves (01–08) never targeted, per dossier.md GAPS item 8 and §E.7 (Workflow G)
confidence: 🟡 overall — function inventory and product-page capability claims 🟢 (multiple independent official Bloomberg sources plus 8 independent university library guides converge); current-2026 screen layout, chaining behaviour and the analyst's actual daily sequence remain 🔴 (no terminal seat, no video transcript)
evidence_ceiling: No Terminal access (same ceiling as leaves 01–08, per dossier.md §O). WebSearch was exhausted before this leaf started (200/200, per the 2026-09-02 11:40 UTC preamble note); the claude-in-chrome browser extension was not connected this session, so the "browser search" fallback in the External Preamble's Search Budget section was unavailable; Bing and Google via WebFetch returned cached/generic non-results for every query tried. Brave Search's HTML results page (search.brave.com) unexpectedly worked via WebFetch and is the source of every non-obvious URL below — record this as a usable channel for future external-research contracts when WebSearch is exhausted and the browser is unreachable.
sources: 12 primary (11 Bloomberg-authored official pages/PDFs + 1 CME-authored page describing a Bloomberg guide); 12 secondary (8 university library guides, 1 vendor vol/derivatives page, 3 homework-mill pages recorded as source-quality dead ends only)
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-09 — Multi-asset analytics: macro, rates, fixed income, FX, commodities, derivatives, portfolio/risk, corporate actions, and people intelligence

**Read this first.** This leaf exists to close one specific, named gap: `dossier.md` GAPS item 8 and §E.7 ("Workflow G") both record, honestly, that "no leaf was contracted for macro, rates, volatility or breadth" in the original eight-leaf B-BBG contract, and that this was a scoping decision, not a research failure. Bloomberg is a genuinely multi-asset platform — the merged dossier's own Section D already lists the yellow-key taxonomy `GOVT CORP MTGE M-MKT MUNI PFD EQUITY CMDTY INDEX CURNCY` as VERIFIED [dossier.md §C.5, §D] — but every function *behind* those keys, beyond the taxonomy itself, was unresearched. This leaf researches them. Per the external preamble: benchmarks are sources of learning, not specification; nothing below is a requirement for TERMINAL-NEXT.

**Vocabulary note**, carried from leaves 01–08: this file describes the *Bloomberg* Terminal. UCT's existing `/calendar` surface is TERMINAL-CURRENT; the thing being designed is TERMINAL-NEXT. Bare "UCT Terminal" is never used.

**Citation convention**, matching the merged dossier: `[S#]` cites this leaf's own SOURCES list at the end. Where a claim from leaves 01–08 is referenced for continuity, it is cited as `[dossier.md §X]` or `[L0# §n]` per the existing convention.

---

## 0. Search-channel note (methodologically load-bearing — read before trusting a "could not find" anywhere below)

Per the external preamble's Search Budget section (added 2026-09-02 11:40 UTC), `WebSearch` was pre-exhausted (200/200) before this leaf's research began, and the fallback ladder is: (1) WebFetch on known URLs, (2) a browser tab via `claude-in-chrome` for search, (3) WebFetch on Bing as a last resort. In this session:

* **`claude-in-chrome` was unreachable.** `tabs_create_mcp` returned "Browser extension is not connected" — the fallback's step 2 was structurally unavailable for this leaf, not merely unused.
* **WebFetch on Bing (`bing.com/search`) and on Google (`google.com/search`) both failed silently** — not with an HTTP error, but by returning an **identical, query-independent set of generic `bloomberg.com` branding results** (a Wikipedia page, `bba.bloomberg.net`, a YouTube channel, Bloomberg Radio) regardless of what was actually searched for, three times in a row across unrelated queries. Google returned an explicit "Search Error" page. Neither is usable for this evidence class; flagging this so a future contract does not spend budget re-trying either.
* **`html.duckduckgo.com` and `lite.duckduckgo.com` both served an image CAPTCHA** to the WebFetch client.
* **`search.brave.com`'s results page, fetched via plain WebFetch (no browser), returned real, query-specific, correctly-ranked results with full URLs** — this is the channel that produced every non-obvious source in this leaf. It is not named in the external preamble's search-budget ladder; recording it here as a discovered, working alternative for the next contract that exhausts WebSearch with no browser available.
* Two PDFs fetched via WebFetch arrived as raw binary/base64 that WebFetch's summarizer model correctly declined to guess at rather than hallucinate — the tool saved them to local disk and named the path, and re-reading the same path with the `Read` tool (which has native PDF support) extracted the real text and screenshots cleanly. That combination (WebFetch to fetch-and-save, `Read` to actually parse) is worth reusing rather than treating a "binary content, cannot extract" WebFetch response as a dead end.

---

## 1. Macro / economic data and the economic calendar

### OBSERVATION
Bloomberg's economic-calendar and macro-data surface is not a single named "ECO screen" so much as a small family of `ECO*`-rooted mnemonics plus a live table embedded inside the rates monitor. An official Bloomberg-branded function-list PDF groups them explicitly under a section literally titled **"The Economy"**:

| Mnemonic | Bloomberg's own gloss |
|---|---|
| `TOP ECO` | TOP economic news |
| `ECO` | Economic calendars |
| `ECFC` | Economic forecasts |
| `ECOF` | Economic indicators |
| `ECST` | World Economic Statistics |

[S15] — this is the same section that groups `WEI`/`WEIF`/`WB`/`WBF`/`WIR`/`WCDS`/`WCRS`/`CMDS`/`BTMM` under "World Monitors" immediately above it, i.e. Bloomberg's own information architecture treats "the economy" as a peer category to "world monitors," not a sub-page of equities or fixed income.

Separately, `BTMM <GO>` (Treasury & Money Markets, already named as REPORTED-only in the original dossier [dossier.md §D, §E.7]) is now VERIFIED via a screenshot-bearing walkthrough to contain, on one screen, a live **`ECO`-labelled economic-releases table** with columns `Date / Time / A / M / R / Event / Period / Surv(M) / Actual / Prior / Revised` — showing, in the captured screenshot, rows like "Initial Jobless Claims," "Continuing Claims," and "Trade Balance" with survey-median, actual, prior and revised figures side by side [S13]. The same screen carries Fed Funds, US T-Bills, EUR0$ deposits, repo/reverse-repo, spot FX, key rates, swaps, and commodity prices in adjacent panels — i.e. `BTMM` is Bloomberg's single-screen answer to "what does the world's rates/macro backdrop look like right now," not a rates-only monitor. `BTMM`'s "Fed Funds" row links to **`FOMC <GO>`**, which the same walkthrough shows as a calendar of FOMC announcement dates with rate levels, vote counts (For/Against), and a "Related Information" rail linking `FOMS` (2000–2013 FOMC statements), `FOMN` (1997–2013 FOMC minutes), `FEDU` (Top Fed news), `OLR` (Central Bank Rates), `WIRP` (Fed Fund Implied Probability), and `FLIQ` (Federal Reserve Liquidity) [S13].

A separate official Bloomberg product page for "Bloomberg Economics" (fetched directly, not via search) states coverage of **"over 1.5M time series, including a vast series of 4,000+ tickers spanning 120+ countries,"** "consensus as well as individual contributor forecasts for more than two dozen specific indicators," and names **Bloomberg Second Measure** (US consumer card-transaction data, updated daily) as an alternative-data macro input alongside the standard released-indicator stream [S1].

### EVIDENCE
* Official Bloomberg-branded "Getting Started" function-code sheet (Bloomberg legal boilerplate footer, "BLOOMBERG PROFESSIONAL service... BLOOMBERG, BLOOMBERG PROFESSIONAL... are trademarks... of BFLP"), hosted by Stevens Institute of Technology — **verified, official**, fetched 2026-09-02. `ECO`/`ECFC`/`ECOF`/`ECST`/`TOP ECO` glosses quoted above. [S15]
* University of Scranton (Kania SOM), "Fixed Income Functions" — screenshot-driven walkthrough hosted at the university's own domain, same genre and same author's-department (`ksom/alperin`) as the Scranton *Bloomberg Training Manual* already cited eight times across leaves 02–06 [dossier.md SOURCES S28] — **demonstrated** (screenshots of live `BTMM` and `FOMC` screens), fetched 2026-09-02. `BTMM`'s ECO table, `FOMC`'s calendar and related-info rail quoted/described above. [S13]
* Bloomberg Economics official product page, `professional.bloomberg.com/products/bloomberg-terminal/research/economics/` — **verified, official product page**, fetched 2026-09-02. Coverage figures quoted above. [S1]

### INTERPRETATION
Three things worth carrying into synthesis. First, Bloomberg does **not** silo "the economy" under any single asset class — it is a first-class top-level category (`ECO`/`ECFC`/`ECOF`/`ECST`), and it is *also* embedded contextually inside the rates monitor (`BTMM`'s live releases table) rather than requiring a separate visit. That is the same "the security/context you're already looking at carries the adjacent thing" pattern the merged dossier already identified for news-on-the-chart (`GP`'s events flag) and for `NT`/`TREN` [dossier.md M11, Workflow A]. Second, the releases table's columns — `Event / Period / Surv(M) / Actual / Prior / Revised` — is the general Bloomberg shape for "here is a number, here is what was expected, here is what it revised to," the same shape `EEO`/`EERM` uses for earnings [dossier.md §E.2] applied to macro prints instead of company estimates. Third, `FOMC`'s implied-probability function (`WIRP`) converts a discrete calendar event (a rate decision) into a market-priced probability distribution *ahead of* the event — a distinct pattern from the earnings-estimate machinery (which shows consensus, not a market-implied probability of an outcome).

### RELEVANCE TO UCT
TERMINAL-CURRENT's `/calendar` (the earnings-and-events hub) has no macro/economic-release layer at all per `CLAUDE.md`'s Calendar section — it is earnings, IPOs, and dividends/splits, not Fed decisions or CPI prints [CLAUDE.md "Calendar — Dominant Feed"]. Bloomberg's pattern — a small number of named, addressable macro screens (`ECO`, `ECFC`) *plus* a live table riding inside whatever context the trader is already in (`BTMM`) — is a transferable shape distinct from "build a fifth calendar tab": the releases table is not a destination, it is a widget that shows up next to rates. A morning-wire-style desk (this program's primary persona) plausibly wants the Bloomberg pattern more than a standalone macro-calendar page: today's releases (with survey/actual/prior) surfaced *inside* whatever regime or rates context the desk is already reading, the way `BTMM` does it.

### CONFIDENCE
🟢 that `ECO`/`ECFC`/`ECOF`/`ECST` exist and are named this way in an official Bloomberg document; 🟢 that `BTMM` contains a live economic-releases sub-table (screenshot-verified, independently corroborating the REPORTED-only status this had in the original dossier [dossier.md §D, §E.7] — this leaf VERIFIES it). 🔴 on current-2026 screen layout of `ECO <GO>` itself — no source in this leaf's reach showed the `ECO` screen directly, only its neighbours. **Ceiling:** the same one named throughout leaves 01–08 — a terminal seat or a screen recording.

### RECOMMENDATION (hypothesis)
*Don't build "a calendar page for macro" in isolation — surface the next scheduled macro print, and the last one's surprise, inside whatever regime/rates/breadth context a desk is already reading*, mirroring `BTMM`'s embedding rather than `ECO`'s standalone-page pattern. Test cheaply: does UCT's regime classifier or breadth monitor gain anything from one line naming "next FOMC in N days" or "CPI beat/miss this morning" the way `GP`'s news flag adds one line to a price chart?

### OPEN QUESTION
Whether `ECO <GO>`'s own results list supports filtering/saving the way `EQS` or `N` do (i.e., whether "my economic calendar" is a first-class saved object the way a saved news search becomes `NI <name>` [dossier.md M3]) is NOT DETERMINED — no source reached showed the `ECO` screen's own controls.

---

## 2. Rates and yield curves

### OBSERVATION
`GC <GO>` (Graph Curves) was already named V (verified, names-only) in the original dossier for equities/valuation contexts [dossier.md §D "Economic / macro" row]. This leaf's evidence shows it is the **shared curve-charting primitive across asset classes**, not fixed-income-specific: the Scranton walkthrough's `F3<GO>` (Corporate credit) menu lists it under "Yield Curves ▸ `GC` Graph Curves" as item 9–10 of the credit-function menu [S13], and separately `WB <GO>` (World Bond Markets) opens directly onto a sovereign-yield-curve monitor with tabs literally labelled **Bonds / Spreads / Curves**, plus a drill-down "Sovereign Debt Monitor" per country showing Benchmarks, Curves (2yr-5yr, 2yr-10yr, 2yr-30yr, 5yr-10yr), **Butterflies** (2Y-5Y-10Y, 2Y-5Y-30Y), **Inflation breakevens** (US B/E 10YR), and a **CDS spread** row, all on one screen [S13].

Interest-rate *derivatives* (as opposed to cash curves) live under a separate named menu, `IRSM <GO>` ("Interest rates and credit derivatives menu"), with children `USSW` (US Govt, swap, and agency monitor), `IRDD` (list interest rate derivative deals), `ICVS` (custom interest rate swap curves), `FWCM` (forward curve matrix), and `SWPM` (manage interest rate swaps and derivatives) [S15].

Rate-decision-implied-probability, distinct from either cash curves or swap curves, is `WIRP` (World Interest Rate Probability), reached from `FOMC`'s related-info rail [S13].

### EVIDENCE
* University of Scranton, "Fixed Income Functions" — **demonstrated** (screenshots), fetched 2026-09-02. `GC` in the credit menu; `WB`'s Bonds/Spreads/Curves tabs; Sovereign Debt Monitor's curve/butterfly/breakeven/CDS-spread rows quoted above. [S13]
* Official Bloomberg "Getting Started" sheet — **verified, official**, fetched 2026-09-02. `IRSM`, `USSW`, `IRDD`, `ICVS`, `FWCM`, `SWPM` glosses. [S15]

### INTERPRETATION
The same "one shared primitive, addressed identically across contexts" pattern the merged dossier already identified for `G`/chart library applies to `GC`: it is not an asset-class-specific tool, it is the curve-charting verb, invoked from wherever a curve exists (credit, sovereign, swap). Separately, Bloomberg draws a hard line between **cash-market curves** (`WB`, `GC`) and **derivative curves** (`IRSM`'s children) — they are different menu trees even though both ultimately describe "the price of time," which is a modeling distinction (cash bond pricing vs. swap-curve bootstrapping) UCT would need to make explicitly if it ever built a rates surface, not a UI nicety.

### RELEVANCE TO UCT
UCT currently has no rates/curve surface of any kind (`CLAUDE.md` names no yield-curve component anywhere in the dashboard). This is a genuine capability gap relative to Bloomberg rather than a UI question — the desk persona this program targets (US equities/options swing desk) may reasonably never need it, which is itself a finding worth stating plainly: **the absence of curve/rates tooling in TERMINAL-CURRENT may be correctly scoped, not accidentally missing**, given the desk trades US equities and options, not rates or credit.

### CONFIDENCE
🟢 that `GC`, `WB`, `IRSM` and its children exist and are named this way (official source + one screenshot-verified walkthrough). 🔴 on current UI. **Ceiling:** terminal seat.

### RECOMMENDATION (hypothesis)
Build no rates surface unless a UCT persona actually needs one — this is the corpus's own N10 anti-pattern ("chasing a licensed-data moat with a UI feature") extended: a curve monitor with no desk workflow behind it is effort spent on parity, not value [dossier.md N10].

### OPEN QUESTION
Whether `GC`'s curve output is itself a saved/named object (the "saved things become names" pattern [dossier.md M3]) is NOT DETERMINED for curves specifically, though it is established for charts generally (`G##`).

---

## 3. Fixed income depth — government, corporate, mortgage, municipal, preferred

### OBSERVATION
The original dossier verified the yellow-key taxonomy (`F2`=`GOVT`, `F3`=`CORP`, `F4`=`MTGE`, `F5`=`M-MKT`, `F6`=`MUNI`, `F7`=`PFD`...) but never researched what lives *behind* each key [dossier.md §C.5, §D]. This leaf found real depth for four of the five fixed-income keys, independently corroborated across **two university library guides that never cite each other** (Johns Hopkins and SMU) plus one screenshot walkthrough (Scranton) and one official cheat sheet (Stevens-hosted):

**Corporate / general fixed-income analytics** (converging across three independent sources):

| Mnemonic | JHU's gloss [S20] | SMU's gloss [S21] | Scranton screenshot [S13] |
|---|---|---|---|
| `DES` | Fixed Income Securities Main Landing Page | Bond Description | Security Description, "great Launchpad to links to other Bloomberg functions" |
| `YAS` | Yield and Spread Analysis | Yield and Spread Analysis | "allows the user to price and graph a fixed income security" |
| `CAST` | Capital Structure | Capital Structure | — |
| `WB` | World Bond Market, Bond Curves, Yield Curves | — | World Bond Markets (§2 above) |
| `SECF` | Finding Securities (Equity, Debt, FX, Commodity) | — | Security Finder, drills to a company's issued bonds |
| `BTMM` | Treasury and Money Market Rates | — | (§1 above) |
| `FICM` | Fixed Income Credit Monitor | — | — |
| `RELS` | All Related Securities (incl. options, warrants) | — | — |
| `CRPR` | — | Credit Profile | — |
| `COMB` | — | Comparable Analysis | Comparable Bond Analysis (in DES's Relative Value menu) |
| `FIRV` | — | Fixed Income Relative Value | Fixed Income Relative Value (in DES's Relative Value menu) |
| `HP` | — | Historical Prices table | — |
| `GP` | — | Price Graph | Line Chart (in DES's Charts/Curves menu) |

`YAS`'s own screen, captured in the Scranton walkthrough, shows a **Spread / Price / Yield / Risk** layout with a spreads panel (`G-Sprd`, `I-Sprd`, `Basis`, `Z-Sprd`, `ASW`, `OAS`, `TED`) beside a risk panel (`Mod Dur`/`Dur`, `Risk`, `Convexity`, `DV01`, `Benchmark Risk`, `Proceeds Hedge`) [S13] — the same `ASW`/`OAS` fields the original dossier's leaf 08 already flagged for a historical `ASW` LIBOR-interpolation data-quality bug [dossier.md N2, §F], now confirmed to be genuinely user-facing risk fields on the `YAS` screen rather than back-office-only values.

**A single bond's `DES` page**, per the same walkthrough, carries a left-hand **Pages** navigation rail with **`35) CACS Corp Action`** as one of eleven page entries (alongside Bond Info, Additional Info, Covenants, Guarantors, Bond Ratings, Identifiers, Exchanges, Investing Parties, Fees/Restrict, Schedules, Coupons, `36) CF Prospectus`, `37) CN Sec News`, `38) HDS Holders`, `39) VPRD Underlier Info`) [S13] — this both confirms `CACS` as a real, VERIFIED mnemonic (unresearched in the original dossier) and locates it precisely: it is a **page within a single security's `DES` view**, not a standalone monitor.

`DES`'s own onward-menu (reached by clicking a bond's ticker) is organized into eight labelled groups: **Price Discovery** (`FIPX` Fixed Income Price Discovery, `ALLQ` All Quotes), **Analytics** (`YAS`), **Financing** (`FPA` Forward Pricing Analysis, `RRRA` Repo/Reverse Repo Analysis), **Relative Value** (`FIRV`, `COMB`), **Hedging** (`FIHG` Fixed Income Hedging, `FIHR` Fixed Income Hedge Ratios), **Scenarios** (`FIHZ` Fixed Income Horizon Analysis, `FISA` Fixed Income Scenario Analysis), **Ticketing & Client Management** (`BXT` Buy Ticket, `SXT` Sell Ticket), **Charts, Curves & Technical Studies** (`GC`, `GP`), plus "Create & Price OTC Bond Options" and "Find Credit Derivatives" (`CDSV` CDS Curve Screen) [S13] — this is the fixed-income analogue of the equity `DES` roll-up the original dossier already documented as pointing onward rather than being the citation itself [dossier.md §E.3 step 1].

**Municipal-specific:** `MSRC` (municipal bond search), `SMUN` (municipal issuer screening), `CDRA` (municipal fixed rate calendar), `SPLY` (municipal bond visible supply), `MNPL` (municipal key news), `TDH` (trade disclosure history, security-specific), `PICK` (municipal bond offerings/trades) [S15].

**Mortgage-specific:** `MDF` (mortgage defaults), `CPD` (CMO and ABS paydown information, security-specific), `SYT` (mortgage price/yield/spread analysis, security-specific), `SYTH` (historical prepayment/default/severities, security-specific), `SPA` (structure paydown analysis, security-specific), `OAS1` (option-adjusted spread analysis, security-specific), `CLC` (collateral composition, security-specific), `MTCS` (mortgage credit support, security-specific) [S15].

**Credit / CDS:** `CDS` (analyze single-name CDS), `GCDS` (analyze/chart CDS), `CMOV` (world CDS biggest movers), `CDSW` (create and value CDS, security-specific), `SOVR` (monitor CDS rates for sovereigns), `QCDS` (quick CDS calculator), `RATC` (company credit rating revisions), `CRVD` (credit relative value), `BVAL` (snapshot of Bloomberg Valuation prices) [S15; S13].

**Preferred securities** — no leaf-09 source named a preferred-specific function family; this is a genuine gap, recorded in GAPS below.

### EVIDENCE
* Johns Hopkins University Libraries, "Fixed Income — Bloomberg" — **reported**, university library guide, fetched 2026-09-02. [S20]
* Southern Methodist University, "Fixed Income — Bloomberg: Getting Started" — **reported**, university library guide, fetched 2026-09-02. [S21]
* University of Florida Business Library, "YAS: Yield and Spread Analysis" — **reported**, confirms `GE <CORP> YAS <GO>` syntax, fetched 2026-09-02. [S22]
* Florida Gulf Coast University Library, "Yield and Spread Analysis" and "Yield Curves" pages — **reported**, same syntax example, fetched 2026-09-02. [S23]
* University of Virginia Darden, "Bloomberg — Corporate Bond Information" — **reported**, adds `SRCH` (custom bond search), `CDSW`, `YA` (distinct from `YAS`), fetched 2026-09-02. [S24]
* University of Scranton, "Fixed Income Functions" — **demonstrated** (screenshots of `F3<GO>` menu, `WB`, `BTMM`/`FOMC`, `SECF`→`DES`→`YAS` drill, `TOP BON`), fetched 2026-09-02. [S13]
* Official Bloomberg "Getting Started" sheet — **verified, official** — municipal/mortgage/CDS/emerging-markets/funds mnemonic tables quoted above. [S15]

### INTERPRETATION
Four things worth carrying forward. First, **`DES` is the universal roll-up pattern regardless of asset class** — an equity `DES`, per the original dossier, "says of itself" that detail lives elsewhere and points onward [dossier.md §E.3 step 1]; a bond `DES` does the identical thing, with a *page rail* instead of prose, but the same "roll-up, not citation" shape. Second, **`CACS` is confirmed real and lives at exactly one level**: inside a single security's `DES`, not as a standalone corporate-actions monitor — this resolves part of the original dossier's unresearched-macro/fixed-income gap with a precise location, not just a name. Third, the **mnemonic-family naming convention is internally consistent and mostly self-documenting**: everything fixed-income-relative-value-shaped starts `FI*` (`FIRV`, `FIHG`, `FIHR`, `FIHZ`, `FISA`), everything mortgage-shaped is either descriptive (`MDF`, `CPD`) or terse (`SYT`, `SYTH`, `SPA`, `CLC`), and everything CDS-shaped contains `CDS` or `SOVR`/`QCDS`/`CMOV` as a clear semantic root — a much more legible pattern than the four-letter collisions the original dossier flagged for equities (`EA` meaning two different things; `OWN`/`HDS` drifting) [dossier.md N6, R10, R11]. Fourth, `YAS`'s spread panel (`G-Sprd`/`I-Sprd`/`Z-Sprd`/`ASW`/`OAS`/`TED`) is the fixed-income analogue of the multiple-earnings-doors pattern the original dossier flagged as sprawl (N5) — six different spread conventions on one screen is arguably *necessary* domain complexity (each measures something genuinely different: benchmark spread vs. interpolated spread vs. swap-based spread vs. OAS), not sprawl for its own sake, which is worth distinguishing from the original dossier's N5 finding about *avoidable* mnemonic proliferation.

### RELEVANCE TO UCT
TERMINAL-CURRENT has no fixed-income asset class of any kind — UCT is a US-equities-and-options desk [SHARED_PREAMBLE.md "Who is asking and why"]. The transferable idea here is not "build bond analytics," it is the **`DES`-as-universal-roll-up + page-rail-for-depth pattern**, which UCT already partially has (`EarningsResearchModal` is a roll-up with sections) and could extend: a single security's roll-up page carrying an explicit, named list of "what else exists about this thing" — filings, ownership, corporate actions, analyst coverage — as a navigable rail rather than a scroll, mirroring both the equity and fixed-income `DES` shape.

### CONFIDENCE
🟢 mnemonic existence and gloss (7 independent sources, 2 of which never cite each other, converging on the same names); 🟢 `CACS`'s specific location (single screenshot, but unambiguous); 🔴 current-2026 UI layout, and 🔴 whether the `DES` page-rail order or contents have changed since the walkthrough's vintage (undated on the page itself, but the screenshot's FOMC calendar shows 2015 dates, so this material is **~2015-vintage**, materially older than most of leaves 01–08's ©2017–2024 sources — flagging this explicitly rather than smoothing it over). **Ceiling:** terminal seat; a 2026-dated fixed-income walkthrough would resolve the vintage question directly.

### RECOMMENDATION (hypothesis)
*Extend UCT's roll-up-modal pattern (`EarningsResearchModal`, `DES`'s equity/bond analogue) to make "what else exists about this security" an explicit navigable list rather than an implicit set of tabs a user must already know to look for* — the `DES` page-rail's eleven-item explicit inventory (Bond Info…Corp Action…Sec News…Holders) is legible precisely because it enumerates itself.

### OPEN QUESTION
No source in this leaf's reach named a preferred-securities-specific function family (`PFD`'s yellow key exists per the original dossier, but nothing behind it was found). NOT DETERMINED — recorded as a gap below rather than guessed.

---

## 4. Foreign exchange

### OBSERVATION
Bloomberg's FX surface splits cleanly into **trading/execution products** (marketing-forward, official) and **analysis mnemonics** (function-list-forward, official). The trading side: **FXGO** ("Bloomberg's comprehensive FX trading platform... purpose-built for modern trading desks"), **FXEM** (FX execution management, order efficiency for institutional investors/corporates), and **FXTG** (FX Trading Grid — "trade currencies electronically from multiple liquidity providers in a single FX trading grid"), with a stated **800+ liquidity providers**, coverage of **spot, forwards, swaps, options, deposits, precious metals, NDFs**, algorithmic execution across "more than 100 strategies across 40 leading providers in over 50 countries," and quote-aggregation via `MYQ <GO>` [S2]. The analysis side, per the official cheat sheet: `TOP FX` (top FX news), `XDSH` (FX dashboard), `FRD` (calculate spot and forward rates), `FXDV` (FX derivatives menu), `BFIX` (currency fixing rates — the benchmark family the original dossier already found referenced from the equity/index-derivatives side as "Bloomberg FX Fixings (BFIX)" [dossier.md — not previously connected to a Terminal function]), `FXFM` (FX rate forecast model), `FXFC` (composite FX forecasts) [S15]. `WCRS` (World Currency Ranker) appears under "World Monitors" in the same sheet [S15].

FX **implied volatility** — distinct from spot/forward rates — is produced by a named calculation engine, **BVOL**, described in an official 2018 fact sheet: "The BVOL FX surfaces are based on contributions from a large number of market makers and brokers. They update in real time based on changes on each individual contributed point," covering **"over 200 currency pairs,"** with output formats explicitly named as **risk reversal/butterfly or put/call delta** — the screenshot shows a EURUSD volatility-surface screen with tabs `Vol Table / 3D Surface / Term / Skew / Dep and Fwd Rates / Contribution Metrics / Correlation` and a table of ATM/25∆RR/25∆BF/10∆RR/10∆BF/5∆RR/5∆BF quotes by tenor [S14].

### EVIDENCE
* Official Bloomberg FX trading product page, `professional.bloomberg.com/products/trading/electronic-markets/fx-electronic/` — **verified, official**, fetched 2026-09-02. FXGO/FXEM/FXTG quotes above. [S2]
* Official "Getting Started" sheet — **verified, official** — FX mnemonic table above. [S15]
* Official Bloomberg "Real-Time Volatilities" fact sheet, ©2018 (doc 291550 DIG 1118) — **verified, official** — BVOL FX engine description and EURUSD surface screenshot. [S14]

### INTERPRETATION
Two observations. First, FX is the one asset class in this leaf's evidence where Bloomberg's marketing and its mnemonic layer are about **different things almost entirely**: the marketing describes a trading/execution venue (FXGO/FXEM/FXTG, liquidity-provider counts, algo strategies) while the cheat sheet describes an analysis layer (`FRD`, `FXFM`, `BFIX`). This mirrors the original dossier's finding that Bloomberg's Terminal-side news proposition is breadth/classification/routing while millisecond claims attach only to the enterprise EDF feed [dossier.md R14] — here, similarly, the *execution* capability (FXGO) is a distinct commercial product from the *reference/analysis* mnemonics (`FRD`/`BFIX`), and a source describing one says almost nothing about the other. Second, the vol-surface delta/RR/BF convention (`25∆RR`, `25∆BF`) is FX-market-standard quoting convention, not a Bloomberg invention — Bloomberg's contribution, per its own fact sheet, is real-time aggregation of "a large number of market makers and brokers" into one production-quality surface, which is the same "aggregation is the product" pattern the original dossier found for BEst consensus estimates [dossier.md §F "Estimates" row].

### RELEVANCE TO UCT
UCT's desk trades US equities and options, not FX, per the program's own scope statement [SHARED_PREAMBLE.md]. This section is recorded for completeness per the contract's explicit ask, not because a transferable UCT idea was found — the honest finding is **no FX capability gap is worth closing for this desk**, which is itself useful for the synthesis layer to know rather than infer.

### CONFIDENCE
🟢 that FXGO/FXEM/FXTG and the analysis mnemonics exist as named (2 independent official sources); 🟡 whether `BFIX`-the-Terminal-mnemonic and "Bloomberg FX Fixings (BFIX)"-the-benchmark-family named in the original dossier's index-derivatives evidence [dossier.md D row "Derivatives"] are the same underlying rate stream reached two ways, or coincidentally-identical names — NOT DETERMINED, no source in this leaf's reach states it explicitly.

### RECOMMENDATION (hypothesis)
None — no transferable idea surfaced beyond what §12 (below) already generalizes across asset classes.

### OPEN QUESTION
Whether `BFIX`-the-mnemonic and BFIX-the-index-family are the same object: NOT DETERMINED.

---

## 5. Commodities

### OBSERVATION
The official commodities page (fetched directly from `professional.bloomberg.com/institutions/corporations/commodities/`) organizes coverage into four groups with explicit sub-lists: **Energy** ("Oil, refined products, middle distillates, gasoline, petrochemicals, crude, power, renewables, liquefied natural gas (LNG), coal, biofuel"), **Metals** ("Base metals, precious metals, minor metals, alloys, minerals"), **Agriculture** ("Vegetable products, foodstuff, fertilizer, livestock, seafood, lumber, oleochemicals, weather forecasts"), and **Commodity Derivatives** ("Options, futures, forwards, swaps, freight, storage, tankers, shipping, emissions") [S3]. Tooling named on the same page: "Commodity spot prices," "Pricing forward curves & fair values" (updated intraday), "Market standard calculators" for transformation-process profitability, and "Option volatility & data" to "Monitor, structure and price commodity options and strategies" [S3]. Execution: "Listed futures order routing" via a multi-asset blotter and integration into MARS for risk [S3]. Research: **BloombergNEF** for "net zero and carbon transition research" [S3].

The mnemonic layer, per the official cheat sheet: `TOP CMD` (top commodities news), `NRG` (Bloomberg Energy service), `OIL` (crude oil prices), `NATG` (natural gas markets), `COAL`, `VOLT` (electricity markets/statistics), `ENVR` (emissions/green markets), `BIOM` (biofuel markets), `BMAP` (Bloomberg maps), `CMBQ` (security-specific: price specific market/commodity pairings) [S15]. The Scranton walkthrough independently names **`GLCO`** as the commodities-world equivalent of `WEI`/`WB` — "The main go-to screen when looking at the big picture of bond markets is similar to the WEI function for Equities and GLCO for Commodities" [S13] — a mnemonic not found in the official cheat sheet, so it is REPORTED (secondary) rather than VERIFIED pending a second source.

### EVIDENCE
* Official Bloomberg commodities page, `professional.bloomberg.com/institutions/corporations/commodities/` — **verified, official**, fetched 2026-09-02. Coverage and tooling quotes above. [S3]
* Official "Getting Started" sheet — **verified, official** — commodity mnemonic table. [S15]
* University of Scranton, "Fixed Income Functions" — **demonstrated**, `GLCO` reference (in passing, describing `WB`'s role, not documenting `GLCO` itself). [S13]

### INTERPRETATION
The commodities page is structured exactly like the FX page: a marketing/coverage layer (asset sub-categories, tooling claims) that is largely disjoint from the terse function-code layer (`NRG`/`OIL`/`NATG`). Notably, **`GLCO` is UNVERIFIED by this leaf's own standard** — it appears in exactly one source, in passing, describing a different function (`WB`), never itself documented. This is worth stating precisely rather than smoothing it into a confident claim, per the evidence discipline this program requires.

### RELEVANCE TO UCT
As with FX: UCT's desk does not trade commodities, and no source here surfaces a transferable UCT-relevant idea beyond the cross-asset generalization in §12.

### CONFIDENCE
🟢 the official coverage/tooling claims (single official source, but unambiguous and specific); 🔴 `GLCO` (single passing mention). **Ceiling:** a second source naming `GLCO` directly, or a terminal seat.

### RECOMMENDATION (hypothesis)
None beyond §12.

### OPEN QUESTION
Whether `GLCO` is a real, current mnemonic or a dated/retired one: NOT DETERMINED from one passing reference.

---

## 6. Derivatives and options analytics

### OBSERVATION
**`OMON` (Option Monitor) is now VERIFIED** (it was implicitly assumed but never sourced anywhere in leaves 01–08). Harvard Business School's Baker Library help page describes it directly: "Type a company ticker and select **OMON** (Option Monitor) to view a complete list of currently active options," with calls displayed left and puts right, grouped by expiration month, navigable with `[PgDn]`; the same page notes option-ticker roots can diverge from the underlying equity ticker for distant expiries, "making OMON the most reliable lookup method" [S17]. A companion function, **`OSA`** (Option Scenario Analysis), is reached by clicking a specific contract from `OMON` and lets an analyst "perform 'what-if' analyses by modifying assumptions shown in amber fields" [S17] — the amber-field-is-the-only-editable-thing convention the original dossier already verified as a Terminal-wide design rule [dossier.md §C.5, J.1].

An official 2018 Bloomberg fact sheet on real-time volatilities independently **confirms `OMON` from the data-pipeline side**: "The LIVE engine calculates implied vols and greeks on each individual listed option, **feeding the OMON function in the Bloomberg Terminal**" [S14] — i.e., the same document that describes the volatility-calculation engine also names `OMON` as its Terminal-facing consumer, corroborating the HBS description independently. The screenshot in that fact sheet shows a live `OMON` screen for SPX Index: a strike/tenor grid of implied vols with an `Events Calendar` / `EVTS` button and an `HV` (historical volatility) field in the header [S14] — i.e. `OMON` itself surfaces `EVTS` inline, the same "the loaded security's function-specific screen links onward to the events calendar" pattern the original dossier already found for earnings [dossier.md §E.2].

The **volatility-surface machinery underneath `OMON`** is produced by two calculation engines, per the same fact sheet: **BVOL** (equity indexes, single names, ETFs, and FX — "large and arbitrage free surfaces... based on prices of liquid listed options and completed with OTC sourced volatility contribution," snapshot-based) and **LIVE** (per-contract implied vols and greeks feeding `OMON` directly, "produced in real time and based on changes in the listed option bid/ask quotes") [S14]. Both are consumed downstream by "Bloomberg Risk and Portfolio systems" and sold separately as a premium Data License / B-PIPE dataset [S14] — the same "the Terminal function and the enterprise feed are the same underlying number sold two ways" pattern the original dossier found for EDF news [dossier.md R14].

Interest-rate and credit derivatives are covered by the `IRSM` family (§2 above). Xavier University's dedicated Bloomberg derivatives guide (a 15-part course-guide series, "Bloomberg Derivative Information and Functions") exists and was located [S25 in URL only — **fetch attempted and 404'd**; recorded in GAPS] but not independently confirmed beyond its filename/title in search results.

### EVIDENCE
* Harvard Business School, Baker Library, "Bloomberg: options" help page — **reported**, university library help center, fetched 2026-09-02. `OMON`/`OSA` descriptions quoted above. [S17]
* Official Bloomberg "Real-Time Volatilities" fact sheet, ©2018 — **verified, official** — `OMON`/BVOL/LIVE description and screenshot. [S14]

### INTERPRETATION
Three things worth carrying forward. First, `OMON` is confirmed real via **two independent sources of different types** (a university help page describing the *user-facing* screen, an official Bloomberg data-pipeline document describing what *feeds* that screen) that never cite each other and converge — the same "independent convergence is strong evidence" pattern the original dossier's Section A explicitly names as its own strongest evidence class [dossier.md A "Three convergences"]. Second, the vol-surface engines (BVOL/LIVE) are explicitly a **shared cross-asset primitive** — the same BVOL engine that produces FX vol surfaces (§4) also produces equity vol surfaces feeding `OMON`; this is architecturally the same "one engine, many doors" shape UCT's own indicator platform aspires to [`CLAUDE.md`/user memory: "one engine, three doors"]. Third, `OSA`'s amber-field what-if pattern is a direct, concrete instance of the Terminal's editable-field convention applied to scenario analysis specifically — worth noting because it means "what if the price moves to X" is a *first-class, in-place-editable* interaction on the options screen, not a separate calculator page.

### RELEVANCE TO UCT
The desk trades options (`CLAUDE.md`'s OptionsFlow surface, journal's multi-leg options tracking). UCT currently has **no options-chain/vol-surface UI** — Journal 2.0's own documentation states plainly: "Live options pricing + Greeks + chain data = TODO (future critical work)... out of v1 scope" [`CLAUDE.md` "Journal 2.0 — Options"]. This is the single most concrete capability gap this leaf found relative to an actual UCT persona (the desk that trades options daily): Bloomberg's `OMON` (calls/puts by strike and expiry, live implied vol per contract) plus `OSA` (in-place what-if) is close to a literal description of the missing surface. Whether that surface should look like `OMON` specifically, or should instead be shaped by UCT's own `grade_ticker`/sizing philosophy (a computed verdict rather than an inspectable grid, per the merged dossier's "What if it had UCT's proprietary intelligence?" closing section [dossier.md, unlabeled closing section]) is a product decision this leaf does not make — it only confirms the gap and names Bloomberg's shape of the answer.

### CONFIDENCE
🟢 `OMON` and `OSA` existence and behaviour (two independent, differently-sourced confirmations); 🟢 BVOL/LIVE engine architecture (single but detailed official source); 🔴 current 2026 `OMON` screen layout — the fact-sheet screenshot is 2018-dated. **Ceiling:** a terminal seat or a 2026-dated screenshot would settle current layout; this is explicitly named by the original dossier's own GAPS item 5 ("real-time options/vol-surface UI behavior may still be Terminal-only and undiscoverable from public sources") and this leaf's research **narrows but does not close** that ceiling — the mechanism (`OMON`, `OSA`, BVOL/LIVE) is now verified; the *current pixel layout* is not.

### RECOMMENDATION (hypothesis)
*If UCT builds an options-chain surface, the transferable Bloomberg idea worth testing is the in-place what-if (`OSA`'s amber-field scenario editing on the loaded contract) rather than a separate "options calculator" page* — this is a hypothesis about interaction shape, not a requirement to clone `OMON`'s grid.

### OPEN QUESTION
Whether Bloomberg's options analytics distinguish real-time-quoted vs. delayed/stale option chains anywhere in the UI (a genuinely load-bearing question for a desk deciding whether to trust an on-screen Greek) is NOT DETERMINED — no source in this leaf's reach addressed data-staleness indicators on `OMON` specifically.

---

## 7. Portfolio functionality and risk / analytics

### OBSERVATION
The original dossier already listed `PORT`/`PRTU`/`PLST`/`LIST` by name in its capability map [dossier.md §D "Portfolio / watchlist" row] but researched none of them in depth. This leaf found and read, in full, an official ~17-page Bloomberg-branded brochure titled "Portfolio & Risk Analytics — `PORT <GO>`" (©2015, doc code S604201473 0715) [S16] — the single richest primary document this leaf reached. Its structure is organized explicitly as **Past / Present / Future**:

* **Past (historical):** `PORT`'s **Performance** tab (cumulative return vs. benchmark, standard deviation, beta, realized tracking error); **Attribution**, split three ways — **Performance Attribution** (allocation/security-selection/currency effect, by sector/region/duration/credit-quality/custom classification), **Transactions-Based Attribution** (which trades contributed/detracted, at instrument level), and **Factor-Based Attribution** ("Explain portfolio performance in terms consistent with your ex-ante risk management approach by leveraging Bloomberg's multi-factor risk models fully integrated with historical performance attribution" — the same multi-factor model consumed live in Attribution and predictively in Tracking Error, i.e. one model, two temporal directions).
* **Present (live):** **Intraday** performance vs. prior close, with a **News Pop-up** panel described as fed by "more than 60,000 sources" and sortable by up to 11 filters including a "User Activity" filter that "shows the stories of most interest to other users in the Bloomberg community" (a social/crowd-attention signal layered onto portfolio-linked news — distinct from the plain relevancy-tagging the original dossier documented for general news [dossier.md §D "News" row]); **Characteristics** (P/E, dividend yield, effective duration, vs. benchmark, chartable as a time series, supports uploading custom data alongside Bloomberg's); **Cash Flows** (projected income, sourced from `BDVD` — Bloomberg Dividend Forecast — for equities and coupon/principal schedules for fixed income — the same `BDVD` mnemonic the original dossier already found feeding AI earnings-call-summary jump-links [dossier.md I, M9], now confirmed as a portfolio-level cash-flow input too); **Liquidity Risk** (days-to-liquidate at a specified participation rate and trading-volume history, customizable).
* **Future (forward-looking risk):** **Tracking Error** (ex-ante risk via the multi-factor model, absolute or relative to a benchmark/fund/index, with — per the brochure's own claim — "Only Bloomberg provides the ability to click through to the underlying fundamental data for full risk data transparency," a direct instance of the Data Transparency drill-through the original dossier already verified for the Excel add-in and reconciled as REPORTED-on-the-Terminal [dossier.md R13, Q7], now with a second, independent, official-source instance specifically for risk decomposition); **VaR** (Monte Carlo, Historical, and Parametric methods, multiple confidence levels, "Stress Matrix Pricing on derivatives for more accurate VaR forecasts," VaR impact of a proposed trade computable via Trade Simulation); **Scenarios** (named historical stress tests — "the global financial meltdown in 2008 or the Libyan oil crisis in 2011" — plus fully custom stress tests); **Trade Simulation** (edit or add hypothetical positions, see resulting risk/characteristics/attribution recompute across the whole analytical suite in real time) and **Optimization** (an efficient-frontier optimizer over active-total-risk vs. turnover, accepting custom expected-return inputs, producing suggested trades with initial/final weights).

Integration: portfolio data enters `PORT` via **`PRTU <GO>`** (manual/drag-drop entry, the "Portfolio Administration tool"), **`BBU <GO>`** (Bloomberg Upload — one-time or scheduled, including SFTP for firm-wide pre-integration), or direct SFTP pre-integration for firm-wide use; the whole solution's own overview mnemonic is **`BPRA <GO>`** [S16]. The brochure states PORT is "fully integrated with the Bloomberg Professional service — at no additional fee" [S16].

Beyond `PORT` itself, three adjacent risk products, all officially documented separately: **MARS** (Multi-Asset Risk System) — "broad asset coverage, including equities, FX, fixed income, inflation, credit, and mortgages, as well as listed and OTC derivatives," with named Greeks specific to term-structure risk (**Key Rate Risk, Commodity Term Risk, Credit Risk, IR Vega Matrix, FX Delta, FX Vega, IR Basis Risk, Inflation Risk**), accessible via Terminal, alongside other Bloomberg products, or a standalone MARS API [S5]. **MAC3** (a named factor-risk model, distinct from and apparently complementary to MARS) — over **3,000 factors** (700+ equity, 1,000+ fixed income, 300+ commodity, 30+ private equity, 340+ currency), using "country and industry betas [to] replace dummy variables," inverse-residual-variance regression weighting, a "Finite Sample Adjustment" to prevent double-counting risk, PCA-shrunk correlation matrices, and six risk-forecast horizons [S6]. **LQA** (Liquidity Assessment) — a *separate* liquidity product from `PORT`'s own Liquidity Risk tab, covering "more than 4.2 million securities globally" across govt/corp/muni bonds, loans, equities, ETFs, ABS/MBS, TBAs, and listed derivatives, explicitly built to satisfy ESMA Liquidity Stress Testing guidance and SEC Rule 22e-4, and the winner of a named industry award for seven consecutive years [S7].

### EVIDENCE
* Official Bloomberg "Portfolio & Risk Analytics" brochure, ©2015, `data.bloomberglp.com/professional/sites/4/Portfolio_and_Risk_Analytics_Brochure4.pdf` — **verified, official**, fetched 2026-09-02, read via `Read` after WebFetch saved the binary. All quotes above. [S16]
* Official Bloomberg MARS product page, `professional.bloomberg.com/products/risk/mars/` — **verified, official**, fetched 2026-09-02. [S5]
* Official Bloomberg MAC3 product page, `professional.bloomberg.com/products/risk/mac3/` — **verified, official**, fetched 2026-09-02. [S6]
* Official Bloomberg LQA product page, `professional.bloomberg.com/products/risk/lqa/` — **verified, official**, fetched 2026-09-02. [S7]
* Official Bloomberg Portfolio & Risk Analytics landing page, `professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics/` — **verified, official**, fetched 2026-09-02, corroborates `PORT`/`PRTU`/`MARS`/`MAC3` naming independently of the brochure. [S4]

### INTERPRETATION
Four things worth carrying forward, in descending order of how directly they extend the original dossier's own findings. First, **`PORT` is the single richest confirmation, in this entire two-wave research program, of the "everything is a view over one loaded object" philosophy** the original dossier's Section A already proposed as Bloomberg's core design thesis [dossier.md A]: past performance, present monitoring, and future risk are three *temporal* views over the identical portfolio object, sharing one multi-factor risk model across the historical-attribution and forward-tracking-error views. Second, **Data Transparency (drill-through to source data) now has a second, independent, officially-documented instance** specifically for risk decomposition ("only Bloomberg provides the ability to click through to the underlying fundamental data") — this materially strengthens the original dossier's R13 reconciliation, which had it as verified-in-Excel/reported-on-Terminal; a risk-specific brochure independently making the identical claim about `PORT` raises this from "one Excel mechanism, one anecdote" to "a stated design principle applied in at least two places officially." Third, **`BDVD` (Bloomberg Dividend Forecast) is now confirmed to be a genuinely shared cross-surface primitive** — feeding both AI earnings-summary jump-links (original dossier, M9) and `PORT`'s Cash Flows tab (this leaf) — the same mnemonic, two unrelated consuming surfaces, which is the "saved things become names" pattern (M3) generalized one step further: not just *saved user objects* but *Bloomberg's own computed values* get one canonical name reused everywhere. Fourth, **MARS, MAC3, and LQA are three separate, named, non-overlapping risk products** (term-structure Greeks; a factor model; a liquidity-stress-test tool) that are *each* independently documented and *each* explicitly integrate with `PORT` and the Terminal — Bloomberg's risk offering is not "one PORT screen," it is a product family with PORT as the Terminal-native front door and MARS/MAC3/LQA as deeper, sometimes API-accessible, engines underneath it.

### RELEVANCE TO UCT
This is the single highest-value section of this leaf for TERMINAL-NEXT, because UCT already has real portfolio state (`j2_positions`, `j2_broker_activities`, broker-synced holdings) and a stated ambition toward decisive, sourced answers rather than raw inspection tools [dossier.md, closing section]. Two contrasts stand out. First, **UCT's `portfolio_heat.py`** already computes a structural risk-heat number with an explicit design rule ("NO GO-path... a structural STATE read") [CLAUDE.md "Rung-4/5 mentor"] — this is architecturally close to `PORT`'s Tracking Error/VaR tabs (a *read*, not a verdict) rather than `grade_ticker` (a *verdict*), and Bloomberg's own brochure never blurs that line either: even `PORT`'s Optimizer, its most decision-adjacent tool, produces "suggested trades for analysis," explicitly not an executed or auto-applied decision. Second, **Bloomberg's Scenario tab's named historical stress episodes** ("the global financial meltdown in 2008 or the Libyan oil crisis in 2011") is a directly transferable idea for UCT's own regime/breadth history: a portfolio or a watchlist "stress-tested" against UCT's own recorded historical regimes (the breadth monitor already has years of daily history) would be a Bloomberg-inspired, UCT-native feature — testing "what would this basket have done during the 2026-08-25 shakeout" against UCT's own labeled history, not a generic finance-textbook scenario.

### CONFIDENCE
🟢 `PORT`'s tab structure and named capabilities (single but exceptionally detailed and specific official brochure, independently corroborated on the top-level naming by a second official product page); 🟢 MARS/MAC3/LQA existence and named capabilities (three separate official product pages); 🔴 whether `PORT`'s 2015-brochure feature set is unchanged in 2026 — the brochure is explicitly dated (©2015, doc S604201473 0715) and this leaf found no 2026-dated corroboration of its specific tab layout, only of the top-level `PORT`/`PRTU`/MARS/MAC3 names via the current product pages. **Ceiling:** a terminal seat, or a 2026-dated PORT walkthrough/webinar transcript.

### RECOMMENDATION (hypothesis)
*Stress-test a UCT watchlist or portfolio against UCT's own recorded historical regime/breadth episodes, named and dated, the way Bloomberg's Scenario tab offers "2008" or "the Libyan oil crisis" as one-click named stress tests* — this uses data UCT already collects (the breadth monitor's multi-year history) and produces something Bloomberg's own generic scenario library cannot: a scenario grounded in UCT's own regime classifier's own past labels.

### OPEN QUESTION
Whether `PORT`'s multi-factor risk model (feeding both Attribution and Tracking Error) is itself MAC3, or a distinct/earlier model that MAC3 has since superseded, is NOT DETERMINED — the 2015 brochure never names its factor model, and the current MAC3 page describes itself as a standalone product without stating whether it *is* what `PORT` runs today.

---

## 8. Corporate actions (`CACS`)

### OBSERVATION
The original dossier's Section D listed `CACS` only implicitly, via a generic "Corporate actions" gloss under the Security pages row, sourced from a single leaf reference, and its GAPS never named `CACS` specifically as researched. This leaf **directly confirms `CACS` as VERIFIED**, located precisely: it is page 35 of a bond's `DES` navigation rail (§3 above), labelled "Corp Action," sitting alongside `CF` (Prospectus), `CN` (Sec News), `HDS` (Holders), and `VPRD` (Underlier Info) as one of eleven per-security pages [S13].

Separately, an official Bloomberg reference-data page (fetched directly) describes corporate-actions data at the *enterprise/reference-data* level, independent of the `CACS` Terminal mnemonic: **"more than 50 event types across asset classes, populated from thousands of daily sources resulting [in] over one million related actions added annually,"** produced by "a combination of technology and specialized global corporate action analysts who 'follow the sun' to deliver data promptly and accurately to clients" [S8].

### EVIDENCE
* University of Scranton, "Fixed Income Functions" — **demonstrated** (screenshot of the `DES` page rail with `CACS` as item 35), fetched 2026-09-02. [S13]
* Official Bloomberg reference-data page, `professional.bloomberg.com/products/data/enterprise-catalog/reference/` — **verified, official**, fetched 2026-09-02. Event-type/analyst-team quotes above. [S8]

### INTERPRETATION
This directly answers the dossier's GAPS item 8's implied question about corporate-actions depth: `CACS` is real, and its scope (a per-security page, not a standalone monitor) tells you something about Bloomberg's design philosophy — corporate actions are treated as a **property of the security**, addressed via the loaded-security context the original dossier already found central to Bloomberg's whole navigation model [dossier.md C.3, M2], not as a separate feed a user monitors independently the way news or alerts are. The "follow the sun" analyst detail is worth flagging for what it implies about the enterprise-data claims elsewhere in the corpus: Bloomberg's reference-data marketing consistently pairs an automation claim with a named human-review step (compare `MODL`'s "analyst oversight in the loop" on real-time earnings capture [dossier.md K, F "Real-time earnings capture" row]) — a repeated pattern across at least three independently-documented data products (earnings capture, corporate actions, and — per §1 above — nothing states this for economic-release capture, which is a genuine gap in the pattern's coverage, not a confirmed exception to it).

### RELEVANCE TO UCT
UCT's own corporate-actions handling (dividend/split calendars via `dividends_calendar.py`, per `CLAUDE.md`) is a page-level feature, not a per-security roll-up item — Bloomberg's pattern (corporate actions as one named page inside the security's own roll-up, not a separate calendar surface a user must remember to check) is a small, concrete, cheap idea: fold corporate-action events into whatever per-security detail view UCT already ships (`EarningsResearchModal`, or the calendar's `mystocks` hub), the same way `CACS` folds into `DES`.

### CONFIDENCE
🟢 `CACS`'s existence and precise location (unambiguous screenshot); 🟢 the enterprise event-type/coverage claims (official page, specific numbers). 🔴 whether `CACS` as a standalone-typed mnemonic also works outside the `DES` page-rail context (i.e., whether `TICKER <CORP> CACS <GO>` works directly) — NOT DETERMINED, the only evidence shows it as a rail item, not a directly-typed command.

### RECOMMENDATION (hypothesis)
*Fold corporate-action events (splits, dividends, spin-offs) into UCT's existing per-security detail view as a named, explicit section, rather than a separate calendar a user must remember to cross-reference* — cheap, and directly modeled on `CACS`'s placement inside `DES`.

### OPEN QUESTION
Whether `CACS` is independently addressable (`TICKER <CORP> CACS <GO>`) or only reachable via the `DES` rail: NOT DETERMINED.

---

## 9. Transcripts (extending the original dossier's `EVTS`/`DS` finding)

### OBSERVATION
The original dossier's Reconciliation R3 already resolved the contract's speculative `TRAN` mnemonic as UNVERIFIED, establishing `EVTS` (live + final transcripts, as event artifacts) and `DS` (document search across the transcript corpus) as the VERIFIED doors to transcript content [dossier.md R3, §D.2]. This leaf's independent search — across all channels described in §0 — found **no new mnemonic** for transcripts and **no evidence contradicting** that finding: every source touching transcripts in this leaf's reach (the `OMON` screenshot's inline `EVTS` button, §6 above; the Xavier derivatives-guide title referencing "Events... Swaps," not transcripts specifically) is consistent with `EVTS` as the sole door.

One new, small corroborating data point: the `OMON` Option Monitor screen itself carries an inline **`Events Calendar` / `EVTS`** button in its header [S14] — meaning `EVTS` is reachable not only from a security's own roll-up (as the original dossier found) but from at least one *derivatives-specific* analytical screen too, reinforcing the "everything security-specific eventually routes back to `EVTS`" pattern rather than introducing a competing surface.

### EVIDENCE
* Official Bloomberg "Real-Time Volatilities" fact sheet — `OMON` screenshot showing the inline `EVTS` button. [S14] (Same evidence as §6.)

### INTERPRETATION
This section exists primarily to state, honestly, that **this leaf did not close a gap here** — it corroborates and marginally extends the original dossier's already-solid `EVTS`/`DS` finding rather than discovering something new. Per the evidence discipline this program requires, a corroboration-with-no-new-mnemonic is worth recording explicitly rather than either silently omitting the topic (which would look like it wasn't researched) or inventing a distinction that isn't there.

### RELEVANCE TO UCT
No change to the original dossier's M9 recommendation (anchor AI-generated bullets to the transcript span they came from) — this leaf adds no new evidence either strengthening or weakening it.

### CONFIDENCE
🟢 — this is a negative-result finding stated with high confidence (multiple independent channels searched, consistent absence of a second mnemonic).

### RECOMMENDATION (hypothesis)
None beyond the original dossier's M9.

### OPEN QUESTION
None new; the original dossier's Q9 open question (whether historical consensus is as-of-the-time or recomputed) remains the more decision-relevant unresolved item in this neighbourhood [dossier.md Q9].

---

## 10. People / company intelligence — executive bios, org structure

### OBSERVATION
**`MGMT` is now VERIFIED**, independently, by two sources of different types that never cite each other. The official Bloomberg-branded "Getting Started" sheet lists it under "Equity Markets" as a security-specific function (marked `*`): **"`MGMT*` Company management profiles"** [S15]. Singapore Management University's library guide, independently, glosses the identical mnemonic in more detail: **"Company Management [MGMT] — 'View the management profiles of top-ranking executives and board members.' Access method: Search ticker name/symbol and enter function code MGMT"** [S18]. The same SMU guide places `MGMT` alongside `HDS` ("Institutional and Insider Holdings — view the major shareholders") and `BICO` (Bloomberg Intelligence Company Primers — "an executive summary of the related industry, the credit outlook of the company... along with financial fundamentals and key business drivers," already VERIFIED in the original dossier [dossier.md §D "Fundamentals & valuation" row, §E.3 step 7]) as the trio of "company people and organizational data" functions it documents [S18]; it explicitly states it found **no organizational-chart or relationship-mapping tool** beyond these three [S18].

Separately, the Johns Hopkins fixed-income guide names **`RELS`** as "All Related Securities (including options, warrants)" [S20] — a security-*relationship* function, not a person-relationship one; flagging this explicitly because the name invites confusion with "relationship mapping" in the sense the owner's contract asked about (executive networks, board interlocks), and no source in this leaf's reach found any Bloomberg function matching *that* sense of "relationship mapping."

Bloomberg's official reference-data page (§8 above) separately describes **entity-level data** distinct from `MGMT`'s individual-executive focus: **"Legal Entity Data"** ("critical entity-level information... better understanding of credit, counterparty risk and geographic exposure... leveraging industry-standard identifiers such as legal entity identifiers") and **"Corporate and Capital Structure products"** that "support company relationships, corporate and capital hierarchies to perform top-down and bottom-up analyses" [S8] — this is *corporate-entity* relationship mapping (parent/subsidiary, capital structure), not *person*-level relationship mapping (who sits on which boards together), and no source found evidence of the latter.

### EVIDENCE
* Official Bloomberg "Getting Started" sheet — **verified, official** — `MGMT*` gloss. [S15]
* Singapore Management University Libraries, "Company Information — How do I use Bloomberg" — **reported**, university library guide, fetched 2026-09-02. `MGMT`/`HDS`/`BICO` descriptions and the explicit "no org chart found" statement above. [S18]
* Johns Hopkins University Libraries, "Fixed Income — Bloomberg" — **reported** — `RELS` gloss (in a fixed-income context; the mnemonic is generic, not FI-specific, per its own gloss). [S20]
* Official Bloomberg reference-data page — **verified, official** — Legal Entity Data / Corporate & Capital Structure quotes. [S8]

### INTERPRETATION
Three findings, stated at the confidence they deserve. First, **executive-bio data exists and is real (`MGMT`)**, confirmed independently twice — this closes the "executive bios" third of the owner's ask cleanly. Second, **org-chart and person-level relationship-mapping (who serves with whom, board interlocks) was actively searched for and not found** — the SMU guide's explicit negative statement ("does not mention organizational charts or relationship mapping tools specifically") is itself useful evidence, not merely an absence: a university librarian who wrote a dedicated company-information guide and did not find or mention such a tool is reasonable (though not conclusive) evidence it either doesn't exist as a named Terminal function or is significantly less prominent than `MGMT`/`HDS`/`BICO`. Third, **`RELS` is a namespace trap for exactly the kind of confusion the original dossier already flagged as a Bloomberg anti-pattern** (short mnemonics colliding across meanings, per N6/R11) — "relationship mapping" in a corporate-intelligence sense and "related securities" in a `RELS`-the-mnemonic sense are different concepts that share vocabulary, and a synthesis pass working only from mnemonic names (not full glosses) could easily conflate them.

### RELEVANCE TO UCT
UCT's people-intelligence surfaces today are limited (insider-transaction tracking exists via Finnhub per `CLAUDE.md`'s Data Sources table, but no executive-bio or board-membership surface is documented anywhere in the codebase). `MGMT`'s pattern — a person-level roll-up scoped to *one company's* current leadership, reached the same way every other security-specific function is reached (loaded security + mnemonic) — is a small, well-scoped, cheap idea if UCT ever wants "who runs this company" alongside "who owns this company" (`HDS`, already partially covered via Finnhub insider data) and "what does our research team think of this company" (`BICO`, already in the original dossier). The clean finding that Bloomberg has **not** built cross-company relationship mapping (board interlocks, executive-move tracking across companies) is itself worth stating to the synthesis layer: this is not a capability UCT would be "catching up" to by skipping it.

### CONFIDENCE
🟢 `MGMT`'s existence and scope (two independent sources); 🟡 the absence of org-chart/relationship-mapping tooling (one source's explicit negative statement, not exhaustively verified across the whole corpus — a genuine absence-of-evidence, stated as such rather than overclaimed as a confirmed absence). **Ceiling:** a terminal seat with `HL`/`SEARCH` access, the same ceiling the original dossier names for resolving its own D.2 UNVERIFIED list [dossier.md P, "D — Capability map" row].

### RECOMMENDATION (hypothesis)
*If UCT builds an executive/leadership surface, scope it to "who currently leads this one company" (mirroring `MGMT`'s scope) rather than attempting cross-company relationship graphs — Bloomberg itself, at the scale of this leaf's evidence, does not appear to have built the latter, which is a signal (not proof) that it is either low-value or high-cost relative to the former.*

### OPEN QUESTION
Whether Bloomberg has a person-level relationship-mapping tool this leaf's search channels simply did not surface (as opposed to one that doesn't exist) is NOT DETERMINED — the evidence here is one guide's explicit negative statement, not an exhaustive audit.

---

## 11. Data provenance, real-time vs. delayed, and entitlement notes (small additions to the original dossier's Q7 and F rows)

### OBSERVATION
A university library's own description of its terminal access states plainly: **"Provides real-time (delayed 15 minutes) and historical access to data, analytics, news, and other information related to financial asset classes: equities, FX, money, fixed income, commodities and energy"** [S19] — this is a *specific, dated, first-person* data-timing statement (a librarian describing the seat their own students use), distinct from the original dossier's F-row finding that "the Terminal is presented as real-time throughout" with a 🟡 confidence rating and no source directly addressing the delayed-vs-real-time boundary at the seat level [dossier.md F "Real-time vs delayed" row]. This is not necessarily a contradiction — a university terminal's specific licensing tier plausibly differs from a professional trading-desk seat's tier — but it is the first source in either wave of this program to state a **concrete delay figure** (15 minutes) rather than leaving the question entirely open, and it should be read as *one seat class's* data timing, not necessarily every seat's.

The same guide independently corroborates the original dossier's BMC-curriculum finding [dossier.md B "Student/trainee" row, §J.4] with a slightly different module list: **"Bloomberg Market Concepts (BMC)... covering Economic Indicators, Currencies, Fixed Income, Equities, Equity Options, Commodities, Terminal Basics, and Portfolio Management"** [S19] — eight modules, where the original dossier's leaf 01 named "70+ functions across four modules" without listing them [dossier.md B "Student / trainee" row]. This is a **vintage/edition difference worth flagging as its own reconciliation-shaped observation**: either BMC's module count has changed between whatever edition leaf 01 saw and 2026, or the "four modules" figure and this "eight modules" list describe different levels of granularity (four *modules* each containing two of these *topics*, perhaps) — NOT DETERMINED which, and this leaf does not have enough evidence to resolve it, so it is recorded as an open reconciliation rather than silently overwritten.

### EVIDENCE
* Baruch College Newman Library, "Bloomberg Professional" guide — **reported**, university library guide, fetched 2026-09-02. Both quotes above. [S19]

### INTERPRETATION
The "delayed 15 minutes" figure, if it generalizes beyond this one university seat class, would be a genuinely new and load-bearing fact for TERMINAL-NEXT's own real-time-vs-delayed design conversations — UCT's own live-price polling (15s intervals, per `CLAUDE.md`) is orders of magnitude tighter than a 15-minute delay, so if a *university* Bloomberg seat is delayed 15 minutes, that says something about how aggressively Bloomberg tiers real-time access even within its own "everyone is a professional" positioning (the original dossier's L.5 found no non-professional/delayed tier at all [dossier.md L.5]) — a university seat may be the one exception, or may be evidence that *all* seats without a specific real-time entitlement default to delayed. This is exactly the kind of claim that needs a second, independent confirmation before being asserted with confidence; it is recorded here as a single-source data point, not a finding.

### RELEVANCE TO UCT
If accurate beyond this one seat class, this reframes the original dossier's "real-time throughout" framing as possibly seat-tier-dependent rather than universal — worth a follow-up search specifically on Bloomberg's real-time entitlement/exchange-fee structure (a topic neither wave of this program has directly researched) before UCT draws any lesson from "how Bloomberg handles real-time vs. delayed," since the answer may depend on which Bloomberg product tier is being described.

### CONFIDENCE
🔴 — single source, describing one seat class (a university trading-floor terminal), explicitly not claimed to generalize. **Ceiling:** a second independent source (ideally describing a standard commercial seat, not a university one) confirming or contradicting the 15-minute figure.

### RECOMMENDATION (hypothesis)
None — this observation is recorded to sharpen a future contract's question, not to support a UCT design decision on its own.

### OPEN QUESTION
Whether "delayed 15 minutes" describes (a) all Bloomberg Terminal seats by default absent a specific real-time entitlement, (b) specifically discounted/educational seats, or (c) a misdescription by the librarian of a nuance (e.g., delayed for exchanges the university didn't pay real-time fees for, real-time for others) is NOT DETERMINED.

---

## 12. Cross-cutting pattern: what these ten asset-class/analytics families teach in aggregate

### OBSERVATION
Reading §1–§11 together (nine substantive families plus one negative-result section) surfaces a pattern none of leaves 01–08 could see, because no single one of them looked across asset classes: **Bloomberg's mnemonic-naming discipline is measurably tighter outside equities than the original dossier found within equities.** The original dossier's N5/N6 flagged equity-side sprawl and namespace collisions (fifteen doors to "earnings," `EA` meaning two different things, `OWN`/`HDS` drifting) as genuine anti-patterns [dossier.md N5, N6, R10, R11]. This leaf's fixed-income evidence (§3) shows a much more disciplined convention — nearly every fixed-income-relative-value function is prefixed `FI*` (`FIRV`, `FIHG`, `FIHR`, `FIHZ`, `FISA`), nearly every mortgage function is either fully descriptive or a short, non-colliding root (`SYT`/`SYTH`/`SPA`/`CLC`), and this leaf found **zero** namespace collisions in the fixed-income, portfolio/risk, or corporate-actions mnemonics it researched (contrast the equity-side `EA`/`OWN`/`HDS` ambiguities). One plausible interpretation, stated as a hypothesis rather than a fact: **equities are Bloomberg's oldest, most-organically-grown surface** (the original dossier's own J.2 finding: "a melange of ancient Fortran tabbed forms" [dossier.md J.2]), while fixed-income/portfolio-risk tooling was built later, under a more disciplined naming convention, precisely because it didn't inherit forty years of incremental accretion.

Second, every asset-class family in this leaf independently re-derives the **loaded-security-context pattern** the original dossier already named as Bloomberg's core mechanism [dossier.md C.3, M2]: `CACS` lives inside a bond's `DES`; `MGMT` is reached by loading a company and typing the mnemonic; `YAS` operates on whatever bond is loaded; `OMON` operates on whatever equity/index is loaded. Not one asset-class-specific function in this leaf's evidence required a *different* interaction model than "load the thing, type the verb."

Third, the same **enterprise-feed-vs-Terminal-function duality** the original dossier found for news (EDF vs. the Terminal's `TOP`/`NI`) and earnings (real-time-events-data vs. `MODL`) recurs at least twice more in this leaf's evidence: real-time volatilities (B-PIPE product vs. `OMON`'s Terminal display, same BVOL/LIVE engines underneath [S14]) and risk analytics (MARS/MAC3 as standalone API-accessible products vs. `PORT`'s Terminal-native front door [S5, S6, S4]). This is now a **four-times-independently-observed pattern** (news, earnings, volatilities, risk) — strong enough to treat as a genuine Bloomberg architectural principle rather than a coincidence: *sell the same computed data twice — once as a Terminal-native screen bundled into the seat price, once as a raw feed for firms that want to build their own consumer* — which the original dossier's Section L already characterized commercially (API tiers differ only in "who is accountable for entitlements" [dossier.md A, L.3]) but had only two supporting instances before this leaf.

### EVIDENCE
Synthesized from §1–§11 above; no new sources beyond those already cited in this leaf.

### INTERPRETATION
See OBSERVATION — the interpretation is embedded in the pattern statement itself.

### RELEVANCE TO UCT
The "sell it twice, same engine" pattern is architecturally close to something UCT already does correctly, per its own engineering conventions: "one engine, three doors" for the indicator platform [user memory, cited in CLAUDE.md-adjacent conventions] — UCT's own screener/pattern-library/candle-detector engine is consumed by multiple surfaces from one computation. This leaf's finding is that Bloomberg applies the identical principle at a much larger scale (four confirmed instances across totally unrelated data domains), which is corroborating evidence that the pattern generalizes, not a new idea to adopt.

### CONFIDENCE
🟡 as a synthesis — each of the four supporting instances is independently 🟢-to-🟡 sourced (see their own sections), but the pattern claim itself is this leaf's own inference across them, not a fact any single Bloomberg source states.

### RECOMMENDATION (hypothesis)
None beyond what is already implicit in UCT's existing "one engine, N doors" convention — this section's value is corroboration, not a new instruction.

### OPEN QUESTION
Whether the fixed-income/portfolio-risk naming-discipline contrast (§ observation 1) reflects genuine chronological/architectural history (later-built surfaces got a cleaner convention) or is an artifact of this leaf's smaller, more official-source-heavy evidence base (fewer independent secondary sources means fewer chances to surface a collision) is NOT DETERMINED — a fair caveat on this leaf's own strongest cross-cutting claim.

---

## GAPS

1. **No terminal access, same as every leaf in this pod** — the binding ceiling stated in `dossier.md` §O applies identically here; nothing in this leaf changes it.
2. **`WebSearch` was pre-exhausted before this leaf began**, and the `claude-in-chrome` browser fallback named in the External Preamble's search-budget ladder was unreachable this session (extension not connected). Every source in this leaf was found either by direct WebFetch to a guessed/known official URL, or via `search.brave.com`'s HTML results page fetched directly with WebFetch (an undocumented-in-the-preamble channel that happened to work — see §0).
3. **Preferred securities (`PFD`)** — no function family was found for this yellow-key asset class specifically; genuinely unresearched, not merely unconfirmed.
4. **Money-market (`M-MKT`, F5)** depth beyond `BTMM`'s money-market panel was not separately researched.
5. **`OMON`'s and `PORT`'s current-2026 screen layouts** are evidenced by 2015–2018-dated official materials; the mnemonics and architecture are corroborated by 2026-fetched product pages, but pixel-level current UI for either is NOT DETERMINED, same ceiling class as the rest of the corpus (§O).
6. **The Xavier University 15-part Bloomberg derivatives course-guide series** (found by title/filename via Brave search, one file 404'd on fetch) was not further pursued — a live URL for it, if found, would likely add material to §6.
7. **Whether `CACS` is independently typeable** (`TICKER <CORP> CACS <GO>`) versus only reachable through the `DES` page rail: NOT DETERMINED (§8).
8. **Cross-company, person-level relationship mapping** (board interlocks, executive moves tracked across companies) was actively searched for and not found; recorded as a probable-absence with one source's explicit negative statement, not an exhaustive audit (§10).
9. **The "delayed 15 minutes" data-timing claim** (§11) rests on one university-seat source and was not cross-checked against a commercial-seat description; whether it generalizes is unresolved.
10. **No leaf in either wave of this program has directly researched Bloomberg's real-time market-data entitlement/exchange-fee structure** — the topic surfaced only incidentally here (§11) and deserves a dedicated pass if TERMINAL-NEXT's own real-time-data licensing questions become load-bearing.

---

## SOURCES

Tier labels follow the external preamble's ladder. All items fetched 2026-09-02 unless a document's own metadata states an earlier date, which is noted.

### Primary — Bloomberg-authored (official product pages, fact sheets, brochures, cheat sheets)

**S1.** Bloomberg Economics product page. `professional.bloomberg.com/products/bloomberg-terminal/research/economics/` — official product page. Coverage figures (1.5M time series, 4,000+ tickers/120+ countries, Bloomberg Second Measure).
**S2.** Bloomberg FX electronic-trading product page. `professional.bloomberg.com/products/trading/electronic-markets/fx-electronic/` — official product page. FXGO/FXEM/FXTG, 800+ liquidity providers, `MYQ`.
**S3.** Bloomberg commodities page (institutions/corporations track). `professional.bloomberg.com/institutions/corporations/commodities/` — official product page. Energy/Metals/Agriculture/Commodity Derivatives coverage, BloombergNEF.
**S4.** Bloomberg Portfolio & Risk Analytics landing page. `professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics/` — official product page.
**S5.** Bloomberg MARS (Multi-Asset Risk System) product page. `professional.bloomberg.com/products/risk/mars/` — official product page.
**S6.** Bloomberg MAC3 risk-modeling product page. `professional.bloomberg.com/products/risk/mac3/` — official product page. Factor counts, methodology terms.
**S7.** Bloomberg LQA (Liquidity Assessment) product page. `professional.bloomberg.com/products/risk/lqa/` — official product page.
**S8.** Bloomberg reference-data product page. `professional.bloomberg.com/products/data/enterprise-catalog/reference/` — official product page. Corporate-actions event-type/analyst claims, Legal Entity Data, Corporate & Capital Structure.
**S9.** Bloomberg pricing-data product page (BVAL). `professional.bloomberg.com/products/data/enterprise-catalog/pricing/` — official product page.
**S10.** Bloomberg Intelligence research page. `professional.bloomberg.com/products/bloomberg-terminal/research/bloomberg-intelligence/` — official product page. FICC Strategy, 500+ analysts, 135+ industries.
**S11.** Bloomberg Investment Research Data product page. `professional.bloomberg.com/products/data/enterprise-catalog/investment-research-data/` — official product page. Bloomberg Qubes, QDS.
**S12.** Bloomberg index-derivatives product page. `professional.bloomberg.com/products/indices/index-derivatives/` — official product page. BFIX family (index-fixing context).
**S13.** University of Scranton (Kania SOM, alperin), *Fixed Income Functions* PDF. `scranton.edu/academics/ksom/alperin/Fixed%20Income.pdf` — screenshot-driven walkthrough, same department/author-pattern as the Scranton *Bloomberg Training Manual* already cited across leaves 02–06 [dossier.md S28]; tier: professional tutorial / **demonstrated** (live screenshots of `F3<GO>`, `WB`, `BTMM`, `FOMC`, `SECF`→`DES`→`YAS`, `TOP BON`). Undated on the page; screenshot content (FOMC calendar) internally dates to ~2015.
**S14.** Bloomberg *Real-Time Volatilities* fact sheet, ©2018, doc 291550 DIG 1118. `data.bloomberglp.com/professional/sites/10/750114_Real-Time-Volatilities.pdf` — official fact sheet. `OMON`, BVOL/LIVE engines, screenshots of SPX `OMON` and EURUSD vol surface.
**S15.** Bloomberg *Getting Started* function-code sheet (official, Bloomberg-branded, standard BFLP legal footer), hosted by Stevens Institute of Technology. `web.stevens.edu/hfslwiki/images/b/b0/Bloomberg_Tutorial_Commands.pdf` — official cheat sheet, undated. Source of the majority of this leaf's mnemonic tables (Economy, Municipal, Mortgage, CDS, Commodity, FX, Interest Rate Derivatives, Portfolio Management, Electronic Trading, Order Management, Data Solutions, Emerging Markets, Funds sections).
**S16.** Bloomberg *Portfolio & Risk Analytics* brochure, ©2015, doc S604201473 0715. `data.bloomberglp.com/professional/sites/4/Portfolio_and_Risk_Analytics_Brochure4.pdf` — official brochure, 17 pages, extensively screenshot-illustrated. Full `PORT <GO>` tab structure.

### Secondary — university library guides and help centers (credible professional tutorials)

**S17.** Harvard Business School, Baker Library, *Bloomberg: options* help page. `library.hbs.edu/services/help-center/bloomberg-options` — university library help center, **reported**. `OMON`/`OSA` descriptions.
**S18.** Singapore Management University Libraries, *Company Information — How do I use Bloomberg*. `researchguides.smu.edu.sg/c.php?g=421858&p=6787263` — university library guide, **reported**. `MGMT`/`HDS`/`BICO`, explicit absence of org-chart tooling.
**S19.** Baruch College, William and Anita Newman Library, *Bloomberg Professional* guide. `guides.newman.baruch.cuny.edu/AccessFinData/BloombergProfessional` — university library guide, **reported**. "Real-time (delayed 15 minutes)" data-timing statement; BMC's 8-module list.
**S20.** Johns Hopkins University Libraries, *Fixed Income — Bloomberg*. `guides.library.jhu.edu/bloomberg/bonds` — university library guide, **reported**. `WB`/`YAS`/`SECF`/`BTMM`/`DES`/`FICM`/`CAST`/`RELS`.
**S21.** Southern Methodist University, *Fixed Income — Bloomberg: Getting Started*. `guides.smu.edu/c.php?g=1141901&p=9762110` — university library guide, **reported**. `DES`/`YAS`/`HP`/`GP`/`CRPR`/`CAST`/`COMB`/`FIRV`.
**S22.** University of Florida Business Library, *YAS: Yield and Spread Analysis*. `businesslibrary.uflib.ufl.edu/c.php?g=114612&p=746563` — university library guide, **reported**. `GE <CORP> YAS <GO>` syntax example.
**S23.** Florida Gulf Coast University Library, *Yield and Spread Analysis* and *Yield Curves* pages. `library.fgcu.edu/bloomberg/yield_and_spread_analysis`, `library.fgcu.edu/bloomberg/yield_curves` — university library guide, **reported**.
**S24.** University of Virginia, Darden School, Camp Library, *Bloomberg — Corporate Bond Information*. `darden.libguides.com/corporatebonds/bloomberg` — university library guide, **reported**. `SRCH`, `CDSW`, `DES`, `HP`, `YA` (distinct from `YAS`), `YAS`.

### Unverified / recorded as source-quality findings, not evidence

**U1.** Multiple homework-answer-mill pages (`chegg.com`, `transtutors.com`, `studyx.ai`, `brainly.com`, `numerade.com`) surfaced repeatedly in Brave search results for "`OMON`" — all reproduce the identical textbook question ("Click on the Bloomberg Terminal screen to examine the OMON function... which option has the highest implied volatility") from what is evidently one shared course assignment. **Not used as evidence** anywhere in this leaf; recorded because their volume in the results (9 of 19 hits for one query) is itself a source-quality observation worth flagging for any future leaf searching this space via Brave.
**U2.** `wallstreetoasis.com`'s Bloomberg functions list page appeared in results for two different queries in this leaf but was not fetched, consistent with the original dossier's finding that WSO returns HTTP 403 to automated fetchers [dossier.md §O, U1] — not re-tested here, assumed consistent.

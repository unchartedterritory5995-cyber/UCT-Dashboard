---
id: B-BBG-05
title: Bloomberg Terminal — fundamentals and valuation workflow
role: Bloomberg fundamentals & valuation (Document C Parts VIII, XIV Workflow C, XVII, CCXLV)
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — FA, DES, RV/EQRV/RVR/PC, PEERS/comp sources, OWN/HDS, CN, CF, BI/BICO, provenance, Excel export, and the "cold-start to a view" loop
confidence: 🟡 overall
evidence_ceiling: The Terminal itself is a ~$27k/seat closed product; no screen was operated. Every screen-level claim below is reconstructed from Bloomberg's own published collateral (cheat sheets, data fact sheets, brochures), university training material, and one Bloomberg-distributed academic paper. Interaction detail (what a click does, latency, how footnotes render) is NOT reachable from public sources; a live seat, a screen-recorded demo, or a practitioner interview would raise it.
sources: 6 primary (official Bloomberg cheat sheet, 3 official data/product fact sheets, official BI brochure, official BQL fundamentals doc); 15 secondary (university library guides, university training manuals, one Bloomberg-distributed academic paper, one professional review)
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-05 — Fundamentals and valuation on the Bloomberg Terminal

**Scope note.** This file covers the *fundamentals and valuation* slice only: how a user gets from a company name to a defensible view of what it is worth. Search/navigation (B-BBG-01), monitors (02), news/alerts (03), earnings/estimates (04), screening/charting (06), collaboration/API (07) and stickiness (08) are siblings' files. Where those overlap here (BI, CN, CF, Excel export) I record only the fundamentals-relevant part.

**Terminology.** TERMINAL-NEXT is the workstation this program is designing. TERMINAL-CURRENT is the existing `/calendar` surface. Nothing below is a requirement for either.

**A dating caveat that applies to the whole file.** Bloomberg's public collateral is old — the equity cheat sheet is ©2016, the Fundamentals fact sheet ©2018, the ownership fact sheet ©2019, the academic paper describes the "Bloomberg Next" menu introduced February 2012. The university guides span roughly 2012–2025. Function *mnemonics* are extremely stable at Bloomberg (RV, FA, DES appear identically across 2012 and 2025 sources), but *screen layouts, tab names and coverage counts are not*. I flag current-vs-historical per claim.

---

## 1. Bloomberg publishes its own taxonomy of the equity-analyst workflow — and fundamentals is one named lane inside it

**OBSERVATION.** Bloomberg's official one-page "Equity Analyst Key Functionality" sheet does not present an A-Z function list. It groups functions into **twelve named workflow lanes**, of which three are the fundamentals/valuation core:

- **FUNDAMENTAL ANALYSIS** — Financial Analysis `FA` · Graph Fundamentals `GF` · Enterprise Value `EV` · Financial Analysis Excel Template `XLTP XFA` · Discounted Cash Flow Analysis Excel Template `XLTP XDCF`
- **PEER & RELATIONSHIP ANALYSIS** — Relative Valuation `RV` · Equity Relative Valuation `EQRV` · Security Ownership `HDS` · Supply Chain Analysis `SPLC` · Short Interest Information `SI` · Company Classification Browser `CCB` · Graphical Cross Sectional `GX` · Spread Analysis `HS` · Company Litigation `CL`
- **REPORTS & FILINGS** — Document Search `DS`/`DSCO` · Equity Report Writer `EQR` · Public Information Book `PIB` · Company Filings `CF` · Company Filings Search `CFS`

with adjacent lanes for EARNINGS & ESTIMATES (`EE` `EEO` `EEG` `EM` `EEB` `GUID` `ERN` `EA` `ANR`), CREDIT ANALYSIS (`CAST` `CCA` `CRPR` `DDIS` `DRSK` `DRAM`), RESEARCH & CUSTOM DATA (`RES` `BRC` `IRH` `CDE`) and TOP DOWN ANALYSIS (`BI` `BILL` `IMAP` `HRA`). The same sheet states the two discovery affordances: *"Press the `<Menu>` key … from any function to browse related tools. Press the `<Help>` key once from a function to learn more about what it does and how to use it."*

A Bloomberg-distributed academic paper independently orders the same universe as an analyst's *sequence*: **1) Company Overview → 2) Company Analysis → 3) Research & Estimate → 4) Comparative Analysis → 5) Charting & Reporting → 6) Security Surveillance**, and notes that under the then-current menu "there are eight major categories related to a security once the security is specified."

**EVIDENCE.**
- Bloomberg L.P., *Equity Analyst Key Functionality* (official Bloomberg Professional Service collateral, doc S655153424 DIG 0116, ©2016), hosted by Carnegie Mellon University Libraries — https://guides.library.cmu.edu/ld.php?content_id=65151872 — fetched 2026-09-02. **Tier: official Bloomberg training/product collateral. Status: verified (primary).**
- Lei, A. Y. C. et al., *Using Bloomberg Terminals in a Security Analysis and Portfolio Management Course*, hosted on Bloomberg's own CDN — https://data.bloomberglp.com/professional/sites/10/AdamLei-WP.pdf — fetched 2026-09-02. Internal references date it to 2012–2013. **Tier: academic paper distributed by Bloomberg. Status: verified for the taxonomy claim; historical for layout.**

**INTERPRETATION.** Bloomberg's own mental model of "fundamentals" is not a page — it is a *lane* of ~5 functions that a user moves between while one security stays loaded. The lane boundaries are the interesting part: *Fundamental Analysis* is deliberately separate from *Peer & Relationship Analysis* and from *Reports & Filings*, even though a real valuation crosses all three. The `<Menu>` key is what stitches them: from any screen you browse the *related* tools rather than returning to a home page. Discovery is lateral, not hierarchical.

**RELEVANCE TO UCT.** UCT's desk persona (small options-and-equities book) and the `/charts` widget workspace already have the *container* for lateral movement. What Bloomberg has that UCT's surfaces do not is a published, stable **lane vocabulary** — a user learns "fundamentals lane" once and it survives every redesign. TERMINAL-CURRENT's earnings modal is a single deep page with tabs; that is a different shape.

**CONFIDENCE.** 🟢 for the lane taxonomy and the mnemonics (Bloomberg's own document). 🟡 for currency — the sheet is ©2016; some functions may have been renamed or absorbed. **Ceiling:** Bloomberg has not published a comparable sheet publicly since; a current one would need a seat or a Bloomberg rep.

**RECOMMENDATION (hypothesis, not a requirement).** A named, published lane vocabulary may be worth more than any individual screen: it is what lets a user guess where something lives. If TERMINAL-NEXT ever gets one, the test is whether a user who learned it in month one can still find things after a redesign.

**OPEN QUESTION.** Does the `<Menu>` "related tools" list adapt to the loaded security's type/sector, or is it a static per-function map? Public sources do not say.

---

## 2. `DES` is a roll-up and a launchpad, not a data page — and it says so

**OBSERVATION.** `DES` (Description) is universally documented as the first stop. What it actually is, per the Bloomberg-distributed paper, is a *summary of other functions' data*: *"This function provides a brief description of a firm's business and a financial overview of the firm, such as management profiles, index membership, financial ratios, shareholder information, and segment information. **Much of the financial information shown by this function is also available in greater detail through other functions.**"*

Babson's walkthrough corroborates the current shape: within DES you find "general information about the company such as the business description, price chart, estimates, and financial ratios," and a **Profile tab** carrying a 2-year unadjusted beta regressed on weekly returns vs the S&P 500. Scranton's manual calls the DES screen "a great Launchpad to links to other Bloomberg functions." Yale documents a sibling, `BQ`, which "display[s] price, trade, earnings, & relative value on a single screen."

**EVIDENCE.**
- Lei et al. (above), appendix "Company Overview" section — **Tier: Bloomberg-distributed academic. Status: verified (quoted).**
- Babson College, Stephen D. Cutler Center for Investments and Finance, *Equity Valuation using Bloomberg*, by Alex Bowers ('25) — https://www.babson.edu/media/babson/assets/cutler-center/Equity-Valuation-using-Bloomberg.pdf — fetched 2026-09-02. **Tier: university training material. Status: demonstrated (screenshot-driven walkthrough).**
- University of Scranton, Kania School of Management, *Bloomberg Training Manual* — https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf — fetched 2026-09-02. **Tier: university training manual. Status: reported.**
- Yale University Library, *Equities — Getting Started with Bloomberg at Yale* — https://guides.library.yale.edu/Bloomberg/bloomberg_equites — fetched 2026-09-02. **Tier: university library guide. Status: reported.**

**INTERPRETATION.** The design decision worth stealing is the **explicit demotion**: DES tells you it is a shallow roll-up and that depth lives elsewhere. It buys a fast orientation without pretending to be the answer. The failure mode it avoids is the one UCT has hit before — a summary surface that looks authoritative and quietly becomes a second authority over a number that another surface owns.

**RELEVANCE TO UCT.** Directly comparable to TERMINAL-CURRENT's `EarningsResearchModal` and the Dashboard tiles: both are roll-ups over data that other surfaces own in more detail. Bloomberg's convention is that the roll-up is a *doorway* and never the citation.

**CONFIDENCE.** 🟡. The "roll-up, go deeper elsewhere" characterisation is verified but from a ~2012 source; the current DES may have grown. Beta defaults are *reported inconsistently across sources* — see §11.

**RECOMMENDATION (hypothesis).** A summary surface should link to the surface that owns each number rather than restating it. Bloomberg's DES appears to do this by construction; that is a cheaper discipline than a second-authority audit.

**OPEN QUESTION.** Does DES today expose per-field provenance (which function/vendor a ratio came from), or only navigation to the deeper function?

---

## 3. `FA` is a left-panel tree of sub-reports, addressable as a compound command, with a user-chosen frequency

**OBSERVATION.** `FA` (Financial Analysis) is described by the Bloomberg-distributed paper as *"one of the most important functions provided by the Bloomberg terminal"* for fundamental analysis, and its structure as: *"Under this function there are several subcategories, of which each links to more detailed historical data by the frequency a user chooses. Examples of the subcategories include **financial statements, valuation, ratio analysis, debt-equity analysis, segment analysis, and environmental, social, and corporate governance**."*

Navigation is a **left panel** of sub-reports with a right panel of line items — the paper cites, verbatim as workflow steps, `FA` → left panel "Segment Analysis" → "Geographic"; `FA` → left panel "Balance Sheet" → right panel "Shares Outstanding"; and `FA` → "Income Statement". Crucially it also cites the compound form **`FA CF: Cash Flow Analysis`** — the sub-report is addressable from the command line, not only by clicking.

Independent, more recent tab names: Babson names a **Segments** tab, a **Ratios** tab ("a historical overview of profitability, growth, credit, operating, and leverage ratios"), a **Liquidity** tab ("historical liquidity ratios"), a **Key Stats** section (source of "LTM total debt"), and the path **Ratios → Profitability → Additional** for the effective tax rate. Damodaran's older guide names the printable sub-reports as **Enterprise Value, Income Statement Summary, Assets, Liabilities, Cashflow**, and notes *"If you want quarterly data, you can change your preferences in FA and print quarterly data."*

Charting is inline: Babson describes "select[ing] the blue chart next to a line item to graph it or select 'Show Chart Grid' under 'Actions'."

**EVIDENCE.**
- Lei et al. — quoted above. **Status: verified (quoted), historical (≈2012 layout).**
- Babson/Cutler Center walkthrough — **Status: demonstrated (current-era screenshots).**
- A. Damodaran (NYU Stern), *Using the Bloomberg terminal for data* — https://pages.stern.nyu.edu/~adamodar/pdfiles/Bloombergfull.pdf — fetched 2026-09-02. **Tier: credible professional/academic tutorial. Status: reported, historical.**
- Copenhagen Business School LibGuides, *Function — Financial Analysis (FA)* — https://libguides.cbs.dk/c.php?g=663644&p=4693308 — fetched 2026-09-02. Thin, but corroborates the Segments emphasis and volunteers a real complaint: *"There is no explanation for why the data in the columns are missing."* **Tier: university library guide. Status: reported.**

**INTERPRETATION.** Three transferable properties, in rough order of value:

1. **The sub-report is addressable.** `FA CF` gets you to cash-flow analysis in one keystroke sequence. A tab you can only reach by clicking is a tab you cannot put in a keyboard workflow, a saved layout, or a link.
2. **Frequency is a property of the view, not of the screen.** One tree, annual/quarterly toggled by preference — rather than separate "annual" and "quarterly" pages.
3. **Every line item is one click from a chart.** The line-item-to-chart affordance is what turns a statement into an analysis without leaving the screen.

The CBS complaint is the honest counterweight: **blank cells carry no explanation.** That is precisely the failure UCT already named in `CoverageLine` — "we could not compute it" and "something broke" and "the company does not report it" are three different facts, and Bloomberg collapses them into an empty cell.

**RELEVANCE TO UCT.** The desk persona reading a fundamentals panel on `/charts` hits the same three cases. UCT already has a component idiom (`CoverageLine`'s four counts) that is *ahead of* what Bloomberg publicly appears to do here.

**CONFIDENCE.** 🟡. Sub-report names are corroborated across three independent sources and two eras, but no single source enumerates the *current* tab set, and I could not verify one. **Ceiling:** a screenshot of today's FA screen, or a seat.

**RECOMMENDATION (hypothesis).** Two candidates worth testing separately: (a) make deep sub-views addressable by a short command/URL, not only clickable; (b) never render a missing fundamental as a bare blank — the reason is the useful half.

**OPEN QUESTION.** Does current FA support side-by-side period comparison and per-cell currency override, and is the frequency setting per-user-persistent or per-session?

---

## 4. Standardized vs adjusted vs as-reported: Bloomberg ships *two* normalisations, and the data layer proves it

**OBSERVATION.** Bloomberg's official Fundamentals fact sheet describes exactly two transformations layered over filings, and is unusually explicit about why:

- **Standardization** — *"In financial filings, companies can report values in a number of different ways specific to their firm. Consequently, the same type of data can look slightly different in various filings, making it difficult to compare. Bloomberg standardizes the information … using industry and market practices so that users can easily compare companies in the same industry."*
- **Adjusted data** — *"One-time events or abnormal expenses like legal settlements and restructuring costs … can distort understanding of a company's financial performance. That is why, **in addition to providing GAAP data in line with the company's own reporting**, Bloomberg provides adjusted data that shows how a company would have performed had the event not occurred. These multiple views offer analysts … greater insight."*

The same sheet states the enterprise dataset *"can be reconstructed to look like the Financial Analysis function (FA `<GO>`) on the Bloomberg Terminal"* — i.e. FA is a *view over this dataset*, which is why the data-layer semantics are the best available evidence about the screen.

The data layer makes the toggle explicit and machine-addressable. BQL exposes **`FA_ADJUSTED=Y`** as a query parameter alongside `FA_PERIOD_TYPE` (A / Q / S / LTM / **BA** blended-annual / **BT** blended-trailing), `FA_PERIOD_OFFSET`, `FA_PERIOD_REFERENCE`, `FA_PERIOD_YEAR_END` (calendarised `C1231` or fiscal `F`), `FA_ACT_EST_DATA` (A / E / **AE**), and `EST_SOURCE` (**BST** = Bloomberg Standard consensus, **CGD** = company guidance).

Quality apparatus, per the same official sheet: **100+ analysts**, *"More than 13,000 front-end and back-end checks … integrated into the data capture and review process."*

**EVIDENCE.**
- Bloomberg L.P., *Fundamentals — Essential financial data from Bloomberg* (Reference Data fact sheet, doc 189913 DIG 0618, ©2018) — https://data.bloomberglp.com/professional/sites/10/189913_CDS_REF_Fundamentals_SFCT_DIG.pdf — fetched 2026-09-02. **Tier: official Bloomberg product/data documentation. Status: verified (quoted) / claimed (the quality numbers are self-reported).**
- Bloomberg L.P., *Bloomberg Fundamentals in BQL* fact sheet (official Bloomberg Professional Service collateral, hosted by WU Vienna library) — https://www.wu.ac.at/fileadmin/wu/s/library/databases_info_image/Bloomberg_BQL_Fundamentals_FactSheet.pdf — fetched 2026-09-02. **Tier: official API/developer documentation. Status: verified (parameters quoted from worked examples).**
- Search-snippet-only, **unverified**: a Medium post by "Specialist Library Support" reportedly states that in FA's Income Statement (I/S) tab *"you can select between 'Adjusted' (standardised) or 'As Reported' details by clicking on those labels."* The page returned HTTP 403 to fetch; I have the claim only via a search summary. **Tier: practitioner/library commentary. Status: reported, single unverified source.**

**INTERPRETATION.** Two things matter here, and they are different.

First, **Bloomberg ships the adjustment as a *view*, not as the truth.** GAAP-as-filed is retained; the adjusted series sits beside it; the analyst picks. That is the opposite of silently replacing a number with a "better" one.

Second — and this is the sharper finding — **the toggle exists in the data layer as a first-class parameter (`FA_ADJUSTED=Y`), not just as a UI control.** That means an Excel model, a BQuant script and the FA screen can all be pinned to the *same* normalisation. A UI-only toggle would let the screen and the model disagree, and nobody would know which one the analyst had been looking at.

The calendarisation parameters are the second-order insight: `FA_PERIOD_YEAR_END=C1231` forces a comp set with seven different fiscal year-ends onto one calendar axis, and `FA_PERIOD_TYPE=BA/BT` *time-weights across two fiscal periods* to synthesise a period the company never reported. That is a real, documented, opinionated transformation — and it is named, parameterised and therefore auditable rather than hidden.

**RELEVANCE TO UCT.** UCT's fundamentals path (`api/services/fundamentals.py`, the earnings table, the FMP/AlphaVantage/Finnhub chain) already faces the identical question every time a vendor's "EPS" disagrees with a filing. Bloomberg's answer — *keep both, name the transformation, expose it as a parameter that the UI and the export share* — is a design stance, not a feature.

**CONFIDENCE.** 🟢 for the two-normalisation model and the BQL parameters (Bloomberg's own documents). 🔴 for the exact FA screen control that toggles them — one unverified search snippet. **Ceiling:** an FA screenshot or a seat.

**RECOMMENDATION (hypothesis).** Where UCT normalises a fundamental, the normalisation should be a named parameter that both the screen and any export carry, so a number in a model and the same number on screen can never silently differ. Corollary anti-pattern: a UI-only toggle over a shared cache.

**OPEN QUESTION.** When Bloomberg's adjusted series and the company's own non-GAAP presentation disagree (they routinely will), does FA surface *which* items were adjusted, or only the adjusted total?

---

## 5. Provenance: FA links out to the filing, `CF` links to the originals, and point-in-time is a first-class parameter — but click-through auditing is not Bloomberg's signature

**OBSERVATION.** Three separate provenance mechanisms are documented, at three different strengths.

1. **FA → source document.** The Bloomberg-distributed paper describes obtaining a share count via *"the direct link to WDC's 2011 10-K, available through the `<FA: Financial Analysis>` function"* — i.e. FA itself carries a link out to the filing behind the period.
2. **`CF` (Company Filings)** — *"This function provides direct links to the original corporate filings."* `DS`/`DSCO` (Document Search) is the broader net (reports, PR announcements, financial documents, research, transcripts); `CFS` is Company Filings Search. Babson's current-era walkthrough uses `DS` for SEC filings and stresses that *"The filings also contain financial information and accounting details in the footnotes."*
3. **Point-in-time.** BQL exposes **`AS_OF_DATE`** on fundamentals (and legacy `BDP` exposes `FUNDAMENTAL_PUBLIC_DATE`), with a worked example showing a P/E series where the denominator switches from the 2016-09-30 LTM earnings to the 2016-12-31 LTM earnings **on 2017-02-02, the day the company actually reported** — i.e. the data knows what was knowable on each date, not just what is true now.

**The counterweight.** A professional comparison of the four major platforms attributes the audit-the-number affordance to a competitor, not to Bloomberg: Capital IQ's *"early killer apps was a feature that allows analysts to click-through to audit source data. For example, when a user wants to verify that Capital IQ correctly arrived at Walmart's EBITDA, he/she can simply click through from the portal to the source documents."* The same piece says FactSet offers *"comprehensively scrubbed financial data, estimates and click-through functionality,"* and that *"Investment bankers do not use Bloomberg as widely as some of their sell-side peers."*

**EVIDENCE.**
- Lei et al. — the FA→10-K link, and `CF` quoted. **Status: verified (quoted), historical.**
- Bloomberg *Equity Analyst Key Functionality* sheet — `CF`, `CFS`, `DS`/`DSCO`, `PIB`, `EQR`. **Status: verified.**
- Bloomberg *Fundamentals in BQL* fact sheet — `AS_OF_DATE`, `FUNDAMENTAL_PUBLIC_DATE`, the Banco Bradesco worked example. **Status: verified.**
- Wall Street Prep, *Bloomberg vs. Capital IQ vs. FactSet vs. Refinitiv* — https://www.wallstreetprep.com/knowledge/bloomberg-vs-capital-iq-vs-factset-vs-thomson-reuters-eikon/ — fetched 2026-09-02. **Tier: professional review. Status: reported (third-party characterisation).**
- Damodaran (above): *"As a general rule, stay away from the computational data provided by Bloomberg, where they try to estimate numbers based upon raw data."* **Status: reported (expert opinion).**

**INTERPRETATION.** Bloomberg's provenance story is **strong at the period level and weak at the line-item level** — at least as far as public evidence reaches. You can get from a period in FA to the filing it came from, and you can ask the dataset what a ratio looked like on a given historical date. What no source demonstrates is the CapIQ-style *"show me the three filing line items you summed to get this EBITDA."* The comparison article's framing — that click-through auditing is the competitor's killer app, in an article that elsewhere describes Bloomberg's fundamentals as adequate rather than best — is consistent with that being a genuine relative gap, but it is a third party's framing and I could not falsify it.

The point-in-time capability deserves separate emphasis: it is the difference between "this screen is right today" and "this screen was right on the day you made the trade." That is the *only* honest basis for a backtest or a post-mortem over fundamentals.

**RELEVANCE TO UCT.** Two distinct hooks. (a) UCT's Journal/Compass post-mortems reason about decisions made in the past; a fundamental restated since is a silent lie in a trade review. (b) The `CoverageLine` and fundamentals-monitor work already treats "where did this number come from" as a first-class product question — this is the same question one layer down.

**CONFIDENCE.** 🟢 for point-in-time and for `CF`'s direct filing links (Bloomberg's own docs). 🟡 for FA's link-out to the filing (one source, ~2012). 🔴 for the claim that Bloomberg lacks CapIQ-grade line-item click-through — that is an *absence of evidence*, characterised by a competitor-adjacent third party. **Ceiling:** a seat, or a practitioner who uses both.

**RECOMMENDATION (hypothesis).** Point-in-time is the transferable idea, not the click-through: any surface that grades a past decision against a fundamental should read the value *as of that date*. Anti-pattern to avoid: rendering a restated number inside a historical review as though it were what the trader saw.

**OPEN QUESTIONS.**
(a) Does FA today expose per-line-item drill to the filing paragraph, or only a document-level link?
(b) Is point-in-time available *inside the Terminal UI* (a date scrubber on FA), or only via BQL/Data License?

---

## 6. The peer set is a first-class, swappable object — and Bloomberg ships four functions that share it

**OBSERVATION.** `RV` (Relative Valuation) is the peer-comps screen. What is architecturally interesting is that the **peer set is a parameter shared across a family of functions**, not a property of one screen. The Bloomberg-distributed paper says of three separate functions — `RV`, `RVR` (Relative Value Ranking) and `PC` (Peer Correlation) — that *"the peer companies can be a predefined Bloomberg peer group, an industry, or a user-defined group."* The same three-way choice appears in current library guides as the **"Comp Source" drop-down**: a Bloomberg-defined peer list, a GICS sector/sub-sector list, or a custom list; peers are edited via a **pen icon** and an **`<add security>`** field.

RV's own sections, per Bocconi and IESE: **Overview** (market cap, price, EPS, P/E, ROE) · **Comp Sheets** in four sub-sheets (Equity Valuation / CDS Spreads / Profitability / Balance Sheet) · **Markets** (betas, for WACC) · **Custom** (user-picked fields via a **Fields** browser). Damodaran adds that the display is edited *"by going into the 'Edit' function."* Scranton notes RV shows **an average of all listed companies on the top line** so a name reads against its own peer average immediately.

Related functions in the same lane: `EQRV` (Equity Relative Valuation) — per Babson, it *"also shows a summary of current multiples, but also shows the current multiples of the firm compared to its **historical** multiples"*; `PEBD` (P/E Bands) for the same self-vs-self read on a price chart; `RVC` (Relative Valuation Correlation) for a bubble chart of EPS growth vs expected sales growth sized by market cap; `KPIC` (KPI Comparison) — per IESE, *"allows us to observe trends across industry peers"* on industry-specific operating KPIs with adjustable periodicity, growth measurement and currency; `CCB` (Company Classification Browser); `SPLC` (Supply Chain Analysis — suppliers, customers, competitors, "Limited only to U.S. SEC filing companies").

Every guide that documents RV also documents the **discipline**: Bocconi/IESE both say to *"verify their comparability by double-checking factors such as the main sector of activity, the market capitalization value, the average number of employees, and the geographical area."* Damodaran is blunter about the non-editable variant `PV` (Peer Value): *"Bloomberg will pick the comparable companies and you will have little flexibility."*

**EVIDENCE.**
- Lei et al. — `RV`/`RVR`/`PC` peer-source sentence. **Status: verified (quoted).**
- Bloomberg *Equity Analyst Key Functionality* — `RV`, `EQRV`, `CCB`, `SPLC` in the Peer & Relationship lane. **Status: verified.**
- Università Bocconi LibGuides, *Peer analysis — Bloomberg* — https://unibocconi.libguides.com/c.php?g=706997&p=5174547 — fetched 2026-09-02. **Tier: university library guide. Status: reported (screenshot-derived).**
- IESE Business School, *Companies: Peers analysis — How-To* — https://libhowto.iese.edu/faq/76925 — fetched 2026-09-02. **Tier: university library guide. Status: reported.**
- Copenhagen Business School LibGuides, *Relative Valuation — Second step* — https://libguides.cbs.dk/c.php?g=666243&p=4730970 — fetched 2026-09-02. Source for `PEBD`, `RVC`, `GF`, the three-axis structure (vs itself / vs peers / vs market). **Tier: university library guide. Status: reported.**
- Babson/Cutler Center — `EQRV` characterisation and the "premium or discount for a reason" caution. **Status: demonstrated.**
- Damodaran — `RV` Edit, `PV` inflexibility. **Status: reported.**
- University of Scranton manual — RV top-line average. **Status: reported.**

**INTERPRETATION.** The load-bearing idea is that **"who are the comparables" is an explicit, editable, reusable object** rather than an implicit consequence of a sector tag. Three consequences follow, and all three are design choices:

1. **The same peer set drives multiples, ranking and correlation.** A user who curates peers once gets a consistent answer across `RV`, `RVR` and `PC`. If each screen picked its own peers, the three answers would disagree and the disagreement would be invisible.
2. **CBS's three-axis framing is the actual analytical shape:** a name is cheap or dear *relative to itself over time* (`PEBD`, `EQRV`), *relative to peers* (`RV`, `RVC`), and *relative to the market* (`WEI`, `GF` vs `SPX`). Comps alone answer only one third of the question — and it is the third most likely to be wrong when a whole sector is mispriced.
3. **Every serious guide pairs RV with a manual comparability check.** The tool proposes; the analyst disposes. Nobody documents the Bloomberg-default peer list as trustworthy on its own.

**RELEVANCE TO UCT.** UCT already has a peer-set-shaped object in more than one place — watchlists, the theme taxonomy's holdings, the theme engine's `engine_memberships` overlay, `/charts` color groups. Bloomberg's pattern suggests the question is not "do we have peer lists" but "**does every comparison surface read the same one, and can the user override it in place?**" The theme taxonomy's owner-precedence merge is already the right shape for that.

**CONFIDENCE.** 🟡. The Comp Source three-way choice is corroborated by four independent sources across a decade, so it is solid. Section names within RV come from two guides only and may have drifted. `EQRV`'s historical-multiples framing rests on one source.

**RECOMMENDATION (hypothesis).** Test whether one editable peer set, shared by every comparison view and overridable inline, beats per-view peer selection. Second, weaker hypothesis: a "vs itself over time" view may matter more to a swing desk than a "vs peers" view, and it is the cheaper of the two to build.

**OPEN QUESTIONS.**
(a) Does a user-defined RV comp list persist per user and follow the security across `RV`/`RVR`/`PC`/`KPIC`, or is it re-entered per function?
(b) What exactly does `EQRV` plot — current multiple vs its own 1/3/5-year percentile band, or something else?

---

## 7. Ownership (`HDS` / `OWN`): the coverage is verified and large; the naming has drifted

**OBSERVATION.** Bloomberg's official cheat sheet names **`HDS` = Security Ownership** in the Peer & Relationship lane. The Bloomberg-distributed paper names **`OWN` = Ownership Summary** (*"historical ownership information and its changes by institution types, fund objectives, and geographic areas … changes in institutional and insider ownership"*), plus `MGHL` (Management Holdings — "detailed holdings of the executives and board members") and `GPTR` (Insider Transactions — a graph where "more detailed transaction information is available by clicking on the individual transaction icon"). Scranton documents `OWN` with a **Transactions tab**; Babson documents `HDS` with an **"Ownership Summary" tab** and an **"Insider Transactions" tab**. SMU's guide simply maps `HDS` → "View the major shareholders."

Official coverage numbers, from Bloomberg's own ownership fact sheet: transaction and position data *"from unique fund portfolios, institutional investors and insiders from **179 countries** across more than **500,000 instruments** globally"*; 13F holders & holdings *"from **2006** onward"*; 13D beneficial ownership including *"the 'purpose of transaction,' which provides intent of the purchaser, e.g., activist investing"*; US insider Forms 3/4/5 with *"**hourly** updates, thus ensuring insider activity is timely and actionable"*; complete UK share registry data; *"more than **100,000 funds**."*

**EVIDENCE.**
- Bloomberg L.P., *Security ownership data* fact sheet (doc 386375 DIG 0319, ©2019) — https://data.bloomberglp.com/professional/sites/10/Security-Ownership-fact-sheet.pdf — fetched 2026-09-02. **Tier: official Bloomberg data documentation. Status: verified (quoted) / claimed (coverage self-reported).**
- Bloomberg *Equity Analyst Key Functionality* — `HDS`. **Status: verified.**
- Lei et al. — `OWN`, `MGHL`, `GPTR`. **Status: verified (quoted), historical.**
- Babson/Cutler Center; University of Scranton manual; Singapore Management University, *Company Information — How do I use Bloomberg* (https://researchguides.smu.edu.sg/c.php?g=421858&p=6787263, fetched 2026-09-02). **Tier: university guides. Status: reported/demonstrated.**

**INTERPRETATION.** Two findings.

The substantive one: **insider transactions at hourly refresh are positioned as a trading signal, not a compliance record** — Bloomberg's own words are "timely and actionable," and both walkthroughs treat the insider tab as a leading indicator. That is the ownership feature closest to a small desk's actual use.

The methodological one, and it matters for how this whole file should be read: **`OWN` and `HDS` are documented as the same thing by different sources a decade apart** — one guide gives `OWN` a Transactions tab, another gives `HDS` an Insider Transactions tab, and Bloomberg's own sheet lists only `HDS`. Either they were merged, or one is an alias. Neither reading is confirmed by any source I reached. This is the archetypal *stale-name* defect: the name survived the move and every guide kept repeating it, so nobody re-checked. Treat every mnemonic in this file as possibly aliased.

**RELEVANCE TO UCT.** UCT already surfaces insider activity (Finnhub insider transactions, 4h per-ticker cache) on TickerPopup and the earnings modal. The delta Bloomberg claims is *latency* (hourly) and *intent* (13D "purpose of transaction" — activist vs passive), not raw coverage.

**CONFIDENCE.** 🟢 for the coverage numbers (Bloomberg's own document, though self-reported and dated 2019). 🔴 for whether `OWN` and `HDS` are the same function today.

**RECOMMENDATION (hypothesis).** The transferable idea is *intent*, not volume: a 13D that states an activist purpose is a different event from a passive 5% crossing, and most retail-facing surfaces flatten them. Anti-pattern: publishing a function/route alias in documentation without resolving which one is canonical — see the `OWN`/`HDS` drift above.

**OPEN QUESTION.** Is `OWN` a live alias of `HDS`, a separate summary screen, or retired? Public sources contradict each other.

---

## 8. `BI` / `BICO`: research that is *attached to the loaded security*

**OBSERVATION.** Bloomberg Intelligence is Bloomberg's in-house research arm, reachable as `BI <GO>` and — the important form — **`BICO <GO>`, which per Bloomberg's own brochure will *"instantly recall the primer on the currently loaded security."*** Babson's walkthrough shows the reverse traversal: from `BICO` → "Related Primers" → "Industry" → into `BI`'s industry outlook.

Official scale claims (all from the same brochure, and note the internal inconsistency): prose says *"The BI team of **350** research professionals"*; the by-the-numbers page says **400+ research professionals**, **15 yrs** average experience, **135+ industries**, **2,000+ companies**, **500+ data contributors**, **21 markets covered**. A separate Bloomberg page reported by search gives *"500+ research professionals"* and *"17+ years"* average experience. Research is delivered as *"scrolling research decks in which underlying datasets are never more than one click away"*, plus Focus Ideas, Industry Outlooks (6–12 month horizon), Credit Outlooks (~400 companies), earnings previews, "BI reacts" event notes, and industry/company primers. BI data is exportable *"to feed your own models with Excel, BQuant and other software."*

Older sources call the same function **"Bloomberg Industries"** with a "Data Library"/"Industry" left panel — a rename since.

**EVIDENCE.**
- Bloomberg L.P., *Bloomberg Intelligence: Data-Driven Research* brochure — https://assets.bbhub.io/professional/sites/10/intelligence-BI-Brochure.pdf — fetched 2026-09-02. **Tier: official Bloomberg product brochure. Status: claimed (marketing) for the numbers; verified for the `BICO` behaviour it describes.**
- Babson/Cutler Center — `BICO` → Related Primers → Industry → `BI`. **Status: demonstrated.**
- Tufts University LibGuides, *Company/Industry Valuation — Bloomberg* — https://researchguides.library.tufts.edu/c.php?g=249013&p=1658252 — fetched 2026-09-02: *"**BI**: Bloomberg Intelligence provides key industry data, interactive charting and written analysis."* **Tier: university library guide. Status: reported.**
- Lei et al. — `BI: Bloomberg Industries` (historical name). **Status: verified, historical.**

**INTERPRETATION.** The design idea is that **research is addressed by the loaded security, not searched for.** `BICO` is a one-word question — "what does our research team say about *this*" — with no search, no filter, no picking a document. That is a different interaction from "open a research tab and find the report," and it only works because the loaded-security context is global.

The number inconsistency (350 vs 400+ vs 500+, 15 vs 17 years, in *Bloomberg's own collateral*) is worth recording as an observation in itself: even a first-party vendor's marketing carries drifted hand-typed counts. It is a reminder to cite the document and the date rather than the number.

**RELEVANCE TO UCT.** UCT's closest analogue is the AI search layer and the earnings modal's AI call recap. The transferable shape is the *addressing*: a single command that returns "our house view on the loaded name," rather than a search box. UCT's `grade_ticker` orchestrator is arguably already this shape for a verdict; BI is the same shape for narrative research.

**CONFIDENCE.** 🟡. `BICO`'s behaviour is verified from Bloomberg's own brochure. Scale numbers are marketing and mutually inconsistent — cite the source, not the figure.

**RECOMMENDATION (hypothesis).** "One command returns the house view on whatever is loaded" may be more valuable than any improvement to a research search UI. Anti-pattern: publishing a headcount/coverage number in two places — Bloomberg's own brochure disagrees with itself on the same page spread.

**OPEN QUESTION.** For a name BI does not cover (most of a small-cap universe), what does `BICO` return — nothing, an industry primer, or a degraded page? Public sources do not say, and the answer determines whether the pattern survives thin coverage.

---

## 9. Export: three paths out, two pre-built valuation templates, and one hard licence wall

**OBSERVATION.** Bloomberg documents three distinct export paths from a fundamentals screen:

1. **Drag-and-drop.** *"Many Bloomberg functions include a drag-and-drop icon in the top right corner of the screen, which is often the simplest way to export data"* — dragging securities from the current screen into Excel or a Bloomberg Wizard.
2. **The `Export` menu in the red toolbar**, offering *"Export in the current template"* (straight to Excel) or *"Export from the Excel template library."*
3. **`XLTP <GO>`** — a library of pre-formatted Excel templates ("over 400" per one guide) that query Bloomberg live. Bloomberg's own cheat sheet names two by exact mnemonic in the Fundamental Analysis lane: **`XLTP XFA`** (Financial Analysis Excel Template) and **`XLTP XDCF`** (Discounted Cash Flow Analysis Excel Template). `XLTP BQL <GO>` gets BQL-powered templates.

Underneath, the formula layer: legacy `BDP`/`BDH`/`BDS`, and `BQL()` which the official fact sheet positions as strictly more capable — several of its worked comparisons end *"Not supported as a single query"* on the legacy side, requiring 5 or 62 separate `BDP` calls where one `BQL` call suffices.

**The wall.** Imperial College's guide states the licence position plainly: *"Bloomberg terminal licenses have a data addendum in which the data must be used on the station in which it was exported, and it cannot be further distributed into a third-party application on your own device."*

**EVIDENCE.**
- Bloomberg *Equity Analyst Key Functionality* — `XLTP XFA`, `XLTP XDCF`. **Status: verified.**
- Bloomberg *Fundamentals in BQL* fact sheet — BQL vs legacy comparison table, `XLTP BQL <GO>`, `HELP BQLX <GO>`. **Status: verified.**
- Imperial College London Library Guides, *Exporting data into Excel — Bloomberg for beginners* — https://library-guides.imperial.ac.uk/bloomberg/exporting-to-excel — fetched 2026-09-02. **Tier: university library guide. Status: reported (paraphrasing a licence term I could not read directly).**
- Babson/Cutler Center — the FA `Export` control and XLTP path. **Status: demonstrated.**

**INTERPRETATION.** Two observations, pulling opposite ways.

The generous one: **Bloomberg ships the destination artefact, not just the data.** `XLTP XDCF` is a working DCF model that populates itself from the loaded security. The export is not "here are rows" — it is "here is the thing you were going to build, already wired."

The constraining one: **the export is a leash.** Data must stay on the station it came from. Everything in Bloomberg's fundamentals stack — the standardisation, the point-in-time, the templates — is designed to be *used inside the perimeter*. That is a licensing choice, and it is arguably the single largest structural difference between Bloomberg's product and anything UCT could build.

**RELEVANCE TO UCT.** UCT's members' data is theirs, and can leave. That is not a small competitive fact: the "export a working model, not a CSV" idea is available to UCT *without* the leash that makes it tolerable for Bloomberg. Where UCT exports (journal CSV, watchlist CSV, screener output), the Bloomberg pattern suggests testing whether exporting a *populated artefact* beats exporting rows.

**CONFIDENCE.** 🟢 for the template mnemonics and BQL/legacy relationship (Bloomberg's own docs). 🟡 for the licence wording — one university's paraphrase of a contract I have not read.

**RECOMMENDATION (hypothesis).** Test "export the populated artefact" against "export the data" for at least one UCT surface. Separately: the freedom to leave the platform is a differentiator worth stating explicitly, not just a default.

**OPEN QUESTION.** What are the actual per-day/per-month data-download limits on a Terminal seat, and do they bind on FA-scale exports? No public source I reached quantifies them.

---

## 10. The cold-start loop: "never heard of it" to a view (Part XIV Workflow C)

**OBSERVATION.** No source I found is *titled* "five minutes to a view," but two independent walkthroughs describe the same sequence, and Bloomberg's own lane taxonomy is consistent with it. Reconstructed:

| Step | Function | What it answers |
|---|---|---|
| 0 | ticker → `<EQUITY>` (yellow key / F8) → security loads | context for everything after |
| 1 | `DES` | what is this business, who runs it, what does it trade at, what is the beta |
| 2 | `FA` → Segments | where does the revenue actually come from (Babson: product/geographic mix, and the trend inside it) |
| 3 | `FA` → Ratios / Liquidity / Key Stats | is it profitable, is it levered, is it deteriorating |
| 4 | `CF` / `DS` | the 10-K/10-Q/8-K/proxy — risks, footnotes, GAAP↔non-GAAP reconciliations, real share count |
| 5 | `EE` → `ERN` / `EEO` / `ANR` | what does the street expect, and does this company beat |
| 6 | `RV` (peers) + `EQRV`/`PEBD` (itself over time) | cheap or dear, and against what |
| 7 | `HDS` / insider tab | who owns it, is management buying |
| 8 | `BICO` → `BI` | what does the house research team think of the industry |
| 9 | `WACC` / `BETA` / `EQRP`, or `XLTP XDCF` | put a number on it |

Babson's guide is essentially this sequence with screenshots; the Bloomberg-distributed paper orders it as Company Overview → Company Analysis → Research & Estimate → Comparative Analysis; Damodaran's printout guide compresses it to a fixed print list (`HDS`, `DES`, `DDIS`, `FA` sub-reports, `EE`, `BETA`) explicitly designed to be executed without judgement.

**EVIDENCE.** Babson/Cutler Center walkthrough (steps 1–9 all present, in this order); Lei et al. (the 6-category ordering); Damodaran (the fixed print list); Bloomberg *Equity Analyst Key Functionality* (lane grouping consistent with the order). All fetched 2026-09-02. **Status: reported/demonstrated — this synthesis is mine, not any one source's.**

**INTERPRETATION.** The loop is fast **because the security stays loaded and each function is 2–4 keystrokes**, not because any one screen is dense. The analyst never re-identifies the company; `FA`, `RV`, `HDS`, `BICO` all inherit it. The cost of a "what about…" detour is close to zero, and that is what makes the exploratory loop work.

Note also what the loop *is not*: it is not a wizard, and Bloomberg does not provide one. The Bloomberg-distributed paper is unusually candid that students demand a formula and there isn't one — *"we face students expecting a formula or steps such that once the inputs are obtained through the Bloomberg terminal, the 'right' outputs/answers will be generated … Our response, unfortunately, is that there is no such formula."*

**RELEVANCE TO UCT.** The desk persona's real cold-start question is narrower ("is this tradeable this week, and where's the stop") but the structural lesson holds: **the win is context persistence across surfaces, not depth on any one surface.** UCT already has an analogue — the `/charts` color groups make a ticker follow the user across widgets. The gap is that UCT's fundamentals, filings, ownership and research surfaces are not all in that loop.

**CONFIDENCE.** 🟡 for the sequence (converging independent walkthroughs, but the specific ordering is my synthesis). 🔴 for the *time* — no source measures it, and "five minutes" is an assumption I cannot support. **Ceiling:** a screen-recorded demo or a timed practitioner walkthrough.

**RECOMMENDATION (hypothesis).** Measure UCT's own cold-start loop the way this one is described: count the keystrokes and the re-identifications between "I heard a ticker" and "I have a view." If the ticker has to be typed more than once, that is the finding.

**OPEN QUESTION.** How much of this loop does a professional actually run daily versus once per new name? Nobody I found writes it down.

---

## 11. Anti-pattern: opinionated computed outputs that experts tell you to ignore

**OBSERVATION.** Bloomberg ships one-click computed valuations — `WACC`, `DDM` (Dividend Discount Model), plus default betas — and the two most authoritative independent guides both tell readers not to trust the defaults.

- Damodaran: *"As a general rule, stay away from the computational data provided by Bloomberg, where they try to estimate numbers based upon raw data. For instance, the WACC and Dividend discount model valuations that they provide are not very useful."* And on beta: *"Bloomberg's default beta calculation always uses two years of weekly returns and the local market index. You can (and probably should) change both."*
- The Bloomberg-distributed paper, on `DDM`: *"The default model and inputs, however, do not always provide a reasonable theoretical price, i.e., the theoretical price could be much too high or much too low relative to the current transaction price."* And on `WACC`, its authors *"do our own calculation for WACC instead of using the default settings."*
- Babson, on `WACC`: *"While this is incredibly helpful and probably good enough, it is best practice to calculate WACC using your own data if it does not entirely align with Bloomberg's."*
- Babson, on `RV`: *"it is important to remember that your company could be trading at a premium or a discount for a reason, and should not always deserve to be trading at the median."*

Note also that the **beta default is reported three different ways** across sources: Babson says "2-year unadjusted beta … against a market proxy (S&P 500)"; Damodaran says "two years of weekly returns and the local market index" (adjusted); the 2012 paper says "S&P 500 index and weekly data over the previous year."

**EVIDENCE.** Damodaran (above); Lei et al. (above); Babson/Cutler Center (above). All fetched 2026-09-02. **Tier: credible professional/academic tutorials. Status: reported (expert opinion), and the beta-default divergence is a direct observation across the three.**

**INTERPRETATION.** The pattern is: **Bloomberg is trusted for *inputs* and distrusted for *outputs*.** Nobody disputes FA's revenue line; everybody overrides the DDM's price target. The reason is instructive — a computed valuation embeds assumptions the tool cannot defend for a specific name in a specific scenario, and the confident single number invites use without inspection. The mitigation Bloomberg does ship is that every one of these is *overridable in place*: `WACC` lets you set the components, `BETA` lets you set index/frequency/window, `RV` lets you set peers and fields. The default is a starting point that expects to be argued with.

The beta-default divergence is itself the finding for a documentation-conscious reader: three careful sources describing "the default" and disagreeing on window, adjustment and index. Either the default changed, or the sources are describing different screens. Do not carry a default from a guide into a model.

**RELEVANCE TO UCT.** This is the single most load-bearing item in this file for UCT, because UCT ships computed verdicts (`grade_ticker`, sizing, the exposure score, the Compass verdicts). Bloomberg's public record says the market's most-used terminal has been shipping confident computed valuations for decades and the expert consensus is to override them. The mitigations that *do* survive that criticism are (a) the number is overridable in place, (b) the inputs are visible, (c) the tool does not claim the output is the answer.

**CONFIDENCE.** 🟢 that respected independent sources say this, across two eras and three institutions. 🟡 on whether it is still fair to today's `WACC`/`DDM` — the criticism may have aged.

**RECOMMENDATION (hypothesis).** A computed verdict earns trust in proportion to how easily its inputs can be seen and changed *on the same screen*. Anti-pattern: a computed number whose assumptions are only visible in documentation. UCT's `grade_ticker` already returns `basis`/`sources`/`hard_flags` alongside the verdict — that is the right shape; the question is whether the *inputs* are editable, not just inspectable.

**OPEN QUESTION.** Does today's `WACC`/`DDM` show a sensitivity band or a single point estimate? A band would substantially answer the criticism above.

---

## GAPS (budget/access not reached)

1. **No screen-level verification of FA.** I never saw the FA screen. The current tab set, the exact position of the As-Reported/Adjusted control, per-cell currency override, side-by-side period comparison, and how footnotes render are all unverified. The single source for the FA "Adjusted / As Reported" click-target is a search snippet from a page that returned 403.
2. **`EQRV` is thin.** One sentence from one walkthrough ("current multiples … compared to its historical multiples"). What bands, what lookback, what percentile treatment — unknown. My targeted search for EQRV detail was blocked when the session's WebSearch budget was exhausted (200/200, shared across the wave).
3. **`PEERS` as a distinct function is unconfirmed.** The contract names it; no source I reached documents a `PEERS` mnemonic. What exists is `RV`'s **Comp Source** selector, plus `CCB` (Company Classification Browser), `PC`, `RVR`, `PV` and `KPIC`. `PEERS` may be an alias, retired, or a mis-transcription — I could not settle it.
4. **`bloomberg.com` is inaccessible to WebFetch (HTTP 403).** Bloomberg's own Terminal/BI/point-in-time product pages and press releases could not be read directly. Everything "official" here came from `data.bloomberglp.com` / `assets.bbhub.io` PDFs or Bloomberg collateral rehosted on `.edu` domains. Browser tools could likely reach them.
5. **No practitioner-forum evidence.** WSO returned 403; Reddit did not surface. The only practitioner-tier voice here is a professional review (Wall Street Prep) and two academic/training authors. Community sentiment about FA/RV specifically — what breaks, what people work around — is unrepresented.
6. **The click-through-audit gap is unfalsified.** I can show that a competitor is credited with line-item source auditing; I cannot show that Bloomberg lacks it.
7. **No timing data for the cold-start loop.** "Five minutes" is the contract's framing, not a measured figure.
8. **Coverage/scale numbers are self-reported and dated** (2018/2019 fact sheets; a 2016 cheat sheet; a ~2012 paper). Bloomberg's own BI brochure contradicts itself on headcount and experience.

**What would raise confidence, in order of value:** (1) a Terminal seat or a screen-recorded FA/RV walkthrough — would close gaps 1, 2, 6 and most of 3; (2) a practitioner interview with anyone who has used both Bloomberg and CapIQ/FactSet for fundamentals — closes 5 and 6; (3) browser-tool access to `bloomberg.com` product pages — closes 4 and refreshes 8. The owner could plausibly supply (2) from the member base; (1) is unlikely to be worth the cost.

---

## SOURCES

**Primary — official Bloomberg documents**

1. Bloomberg L.P., *Equity Analyst Key Functionality* (one-page official cheat sheet, doc `S655153424 DIG 0116`, ©2016; rehosted by CMU Libraries) — https://guides.library.cmu.edu/ld.php?content_id=65151872 — Tier: **official product/training collateral** — fetched 2026-09-02.
2. Bloomberg L.P., *Fundamentals — Essential financial data from Bloomberg, designed for off-Terminal use* (Reference Data fact sheet, doc `189913 DIG 0618`, ©2018) — https://data.bloomberglp.com/professional/sites/10/189913_CDS_REF_Fundamentals_SFCT_DIG.pdf — Tier: **official data documentation** — fetched 2026-09-02.
3. Bloomberg L.P., *Bloomberg Fundamentals in BQL* (official BQL fundamentals fact sheet; rehosted by WU Vienna library) — https://www.wu.ac.at/fileadmin/wu/s/library/databases_info_image/Bloomberg_BQL_Fundamentals_FactSheet.pdf — Tier: **official API/developer documentation** — fetched 2026-09-02.
4. Bloomberg L.P., *Security ownership data* (Reference fact sheet, doc `386375 DIG 0319`, ©2019) — https://data.bloomberglp.com/professional/sites/10/Security-Ownership-fact-sheet.pdf — Tier: **official data documentation** — fetched 2026-09-02.
5. Bloomberg L.P., *Bloomberg Intelligence: Data-Driven Research* (official brochure) — https://assets.bbhub.io/professional/sites/10/intelligence-BI-Brochure.pdf — Tier: **official product brochure (marketing claims)** — fetched 2026-09-02.
6. Lei, A. Y. C. et al., *Using Bloomberg Terminals in a Security Analysis and Portfolio Management Course* (academic paper hosted and distributed on Bloomberg's own CDN; internal references date it ≈2012–13) — https://data.bloomberglp.com/professional/sites/10/AdamLei-WP.pdf — Tier: **academic paper distributed by Bloomberg** — fetched 2026-09-02.

**Secondary — university training material and library guides**

7. Babson College, Stephen D. Cutler Center for Investments and Finance, *Equity Valuation using Bloomberg*, by Alex Bowers ('25) — https://www.babson.edu/media/babson/assets/cutler-center/Equity-Valuation-using-Bloomberg.pdf — Tier: **university training material (screenshot walkthrough)** — fetched 2026-09-02. *The single richest current-era source in this file.*
8. A. Damodaran (NYU Stern), *Using the Bloomberg terminal for data* — https://pages.stern.nyu.edu/~adamodar/pdfiles/Bloombergfull.pdf — Tier: **credible professional/academic tutorial (historical)** — fetched 2026-09-02.
9. University of Scranton, Kania School of Management, *Bloomberg Training Manual* — https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf — Tier: **university training manual** — fetched 2026-09-02.
10. Università Bocconi Library, *Peer analysis — Bloomberg* — https://unibocconi.libguides.com/c.php?g=706997&p=5174547 — Tier: **university library guide** — fetched 2026-09-02.
11. Copenhagen Business School Library, *Relative Valuation — Second step* — https://libguides.cbs.dk/c.php?g=666243&p=4730970 — Tier: **university library guide** — fetched 2026-09-02.
12. Copenhagen Business School Library, *Function — Financial Analysis (FA)* — https://libguides.cbs.dk/c.php?g=663644&p=4693308 — Tier: **university library guide** — fetched 2026-09-02.
13. IESE Business School Library, *Companies: Peers analysis — How-To* — https://libhowto.iese.edu/faq/76925 — Tier: **university library guide** — fetched 2026-09-02.
14. Tufts University Library, *Company/Industry Valuation — Bloomberg* — https://researchguides.library.tufts.edu/c.php?g=249013&p=1658252 — Tier: **university library guide** — fetched 2026-09-02.
15. University of Michigan Kresge Library, *Company Research — Bloomberg* — https://kresgeguides.bus.umich.edu/bloomberg/CompanyResearch — Tier: **university library guide** — fetched 2026-09-02.
16. Yale University Library, *Equities — Getting Started with Bloomberg at Yale* — https://guides.library.yale.edu/Bloomberg/bloomberg_equites — Tier: **university library guide** — fetched 2026-09-02.
17. Brooklyn College Library (CUNY), *Company Information — Bloomberg Terminal* — https://libguides.brooklyn.cuny.edu/Bloomberg/company-info — Tier: **university library guide** — fetched 2026-09-02.
18. Singapore Management University Libraries, *Company Information — How do I use Bloomberg* — https://researchguides.smu.edu.sg/c.php?g=421858&p=6787263 — Tier: **university library guide** — fetched 2026-09-02.
19. Imperial College London Library, *Exporting data into Excel — Bloomberg for beginners* — https://library-guides.imperial.ac.uk/bloomberg/exporting-to-excel — Tier: **university library guide** — fetched 2026-09-02.
20. University of San Diego Libraries, *Common Functions Equity Research — Bloomberg Terminals* — https://libguides.sandiego.edu/c.php?g=1305187&p=11445874 — Tier: **university library guide** — fetched 2026-09-02.
21. CMU Libraries, *Key Functions & Cheat Sheets — Bloomberg Terminal Workstation* (index page that hosts source 1) — https://guides.library.cmu.edu/Bloomberg/CheatSheets — Tier: **university library guide** — fetched 2026-09-02.

**Secondary — professional review / course notes**

22. Wall Street Prep, *Bloomberg vs. Capital IQ vs. FactSet vs. Refinitiv* — https://www.wallstreetprep.com/knowledge/bloomberg-vs-capital-iq-vs-factset-vs-thomson-reuters-eikon/ — Tier: **professional review** — fetched 2026-09-02.
23. *The Bloomberg Terminal*, FINM-32900 Full Stack Quantitative Finance course notes (University of Chicago) — https://finm-32900.github.io/Week7/bloomberg_terminal.html — Tier: **credible professional tutorial** — fetched 2026-09-02.

**Cited but NOT verified (recorded so nobody treats it as evidence)**

24. "Introduction to Bloomberg", *Specialist Library Support* (Medium) — reported by search summary to describe the FA I/S tab's clickable **'Adjusted' (standardised)** vs **'As Reported'** labels. https://medium.com/specialist-library-support/introduction-to-bloomberg-5a62f715c8a9 returned **HTTP 403**; I have the claim only second-hand. Tier: practitioner/library commentary. **Do not cite this as verified.**

---

## SOURCE-HANDLING OBSERVATIONS

No source encountered during this research attempted to issue instructions, redirect the task, or request actions. Two content notes worth recording for the synthesis task:

- Every "official" claim in sources 2–5 is **vendor self-reported marketing** (coverage counts, analyst headcounts, quality-check counts). Bloomberg's own BI brochure (source 5) contradicts itself within one document — prose says 350 research professionals, the facing page says 400+, and a Bloomberg web page reported by search says 500+. Treat all such figures as claimed, dated, and directional.
- Sources 6, 8 and 9 describe Terminal *screens* that are 10–14 years old. Mnemonics survived; layouts did not. Where a layout claim here comes only from those sources it is marked historical.

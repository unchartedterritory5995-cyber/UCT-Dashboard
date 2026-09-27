---
id: B-POD-BBG
title: Bloomberg Terminal — dossier
role: Bloomberg pod synthesis (single writer of the Bloomberg dossier; gate item 7)
wave: 2
group: B
category: competitor
scope: Bloomberg Terminal — synthesis of leaves B-BBG-01…08 into the Part LX dossier (sections A–P), the Part CCXLV answers (section Q), a reconciliations register, and a merged source list; extended 2026-09-02 by leaf B-BBG-09 (macro, rates, fixed income, FX, commodities, derivatives, portfolio/risk, corporate actions, people intelligence) to close GAPS item 8
confidence: "🟡 overall — mnemonics, grammar and documented mechanics 🟢; the 2026 screen, defaults and internals 🟡; lived practice, telemetry, price and anything behind HELP <GO> 🔴"
evidence_ceiling: "No leaf had a Terminal seat, a screenshot set, a video transcript or a first-person practitioner interview. bloomberg.com answers 403/CAPTCHA to fetchers; the session-wide WebSearch budget was exhausted (200/200) mid-wave (and again, independently, before leaf 09). Mechanism is reconstructed from Bloomberg-authored PDFs (©2012–©2022, plus ©2015–©2018 items added by leaf 09) and university guides; the current UI is unverified. Ceilings are named per section in P and per question in Q. One owner-supplied artifact (OI-08: a seat, a recorded walkthrough, or a practitioner) would raise most 🟡 to 🟢."
sources: "9 leaf files; merged and deduped in SOURCES — 72 Bloomberg-authored/official primaries (P1–P72: manuals, help-page exports, fact sheets, brochures, product pages, press, legal, API docs) and 105 secondaries (S1–S105: university library guides, practitioner threads read via raw HN-Algolia/Reddit-JSON API, trade press, one vetted review) plus 7 items explicitly recorded as unverified/excluded (U1–U7: an AI-generated forum thread with a verified factual error, a third-party GitHub artifact, two 403/429-blocked snippets, one unverified accuracy-claim pair, a homework-mill cluster, one unfetched 403-prone domain)"
uct_relevance: high
status: draft
date: 2026-09-02
---

# Bloomberg Terminal — dossier (Document C Part LX, sections A–P, plus Part CCXLV as section Q)

**Reading conventions.**

* **TERMINAL-CURRENT** = UCT's existing `/calendar` surface (display-named "UCT Terminal" since 2026-09-01). **TERMINAL-NEXT** = the workstation this program is designing. Bare "UCT Terminal" is never used.
* `[L03 §5]` cites leaf file 03, section 5. The leaves: **01** search-navigation · **02** monitors-workspaces (Launchpad) · **03** news-alerts · **04** earnings-estimates · **05** fundamentals-valuation · **06** screening-charting · **07** collaboration-export-api · **08** why-they-stay · **09** multi-asset analytics (macro, rates, fixed income, FX, commodities, derivatives, portfolio/risk, corporate actions, people intelligence — added 2026-09-02 to close GAPS item 8). Every load-bearing claim below points at the leaf that holds the URL, tier and fetch date; the merged SOURCES list at the end resolves them.
* Evidence classes follow the external preamble: **verified** (Bloomberg-authored primary) · **demonstrated** (official video/screenshot-driven tutorial) · **claimed** (Bloomberg marketing) · **reported** (practitioner or third party) · **speculated** (inference, labelled). Confidence per finding: 🟢 high · 🟡 medium · 🔴 low.
* Mnemonic status: **VERIFIED** (named in a Bloomberg-authored source) · **REPORTED** (secondary sources only) · **UNVERIFIED** (no leaf could find it; listed in D and never asserted).
* **UCT-side statements are carried from the leaves**, which drew them from `CLAUDE.md` and memory. This synthesis inspected no dashboard code. Per the shared preamble, every "UCT has X" below is a **CLAIM**, not CONFIRMED.
* **No new web research was performed.** The contract permits one page re-check where two leaves conflict; no inter-leaf conflict turned on a contradictory *verified* fact (see Reconciliations — the conflicts are contract-premise vs leaf, or source-vintage), so the budget went to synthesis.
* Benchmarks are sources of learning, not specification. "Bloomberg does Y" never implies "UCT should build Y." Sections M and N are hypotheses.

---

## A — Executive summary

**What it is.** A per-seat, per-person financial workstation, leased (two-year cycles, *reported* [L08 §7]), addressed almost entirely by short mnemonics typed into one command line, with a hardware keyboard whose key colours are a type system (red stop · green action · yellow market sector) [L01 §7]. The display is either the classic **four independent panels** rotated by a blue `<PANEL>` key or **Tabbed Windows** of up to 16 screens, with **Launchpad** — a free-floating workspace of linked monitor, chart and news components — layered on top of either [L01 §9; L02 §1]. **Instant Bloomberg (IB)** chat sits, in Bloomberg's own words, "at the center of the Bloomberg Terminal experience" [L08 §1; L07 §1]. The Excel add-in is the real export product and is metered at the egress boundary; the API family (Desktop, Server, B-PIPE, Data License) shares one programming interface and differs only in who is accountable for entitlements [L07 §5–7]. Function count is *reported* at ~30,000 [L08 §9]; Bloomberg's own student guide describes the whole thing as "entirely discoverable from the command line" [L01 §2].

**Who it serves.** Sell-side traders and sales, buy-side PMs and analysts, fixed-income and FX desks where bilateral chat *is* price discovery, quants (via BQL/BQuant/API), compliance, journalists — and, through university seats, the students whose library guides are most of this dossier's secondary evidence [L08 §1; L06 §6; L03 §12; L01 §10]. No non-professional tier was found [L08 §7; L07 §8].

**Philosophy (Part CCXLVII), derived from the leaves — 🟡 as a synthesis, each support graded separately.**

> **Everything is a short typeable address in one frozen grammar; the loaded security is context that persists across addresses; the counterparties live inside the same product — so breadth costs the expert nothing, and leaving costs everyone something.**

Supports: one grammar and one input surface with menus, tabs, help and history as *views over* it [L01 §11, 🟢]; a former Bloomberg UX designer's first-hand account that shipped UI bugs were **re-implemented** rather than move a keystroke [L08 §2, 🟢]; the corpus's most experienced practitioner voice ranking centralised data as "much easier to replicate than the network effects" [L08 §1, 🟢 that this is the stated reason]; Bloomberg's Terminal-side news proposition being breadth, classification and routing, with millisecond claims attached only to the enterprise feed [L03 §10, 🟡]; and the page-vs-workspace line — a fixed page wherever the question has one canonical layout, a workspace wherever the composition is personal, and one command (`LLP`) to cross between them [L02 §8, 🟢].

**Three convergences the eight leaves reached without seeing each other's files** (worth stating because independent convergence is the strongest evidence this pod produced):

1. **Saved things become names.** A chart titled "Graph 53" *is* the function `G53` [L06 §4]; a Launchpad view loads by `BLP AGAIN "VIEW NAME"` [L02 §2]; a saved news search becomes `NI BUFFBALL` [L03 §4]; a saved `EQS` screen is callable from Excel as `=BEQS("name")` [L07 §5]; an `FA` sub-report is `FA CF` [L05 §3]. Five leaves, five surfaces, one pattern.
2. **The expensive act — identifying the instrument — is paid once per context.** The loaded security persists per panel until changed; every security-specific function inherits it; the cold-start research loop is fast for that reason and no other [L01 §4; L05 §10; L04 §0].
3. **What Bloomberg withholds is as designed as what it shows.** No bulk export, no published download-limit numbers, no published BEst consensus recipe, no public price, and a trial licence whose §4(e) forbids using the data to compete [L07 §6, §8; L04 §5; L08 §7]. Two of the moats are absences.

---

## B — User types

| Persona | How the evidence says they use it | Leaf | Confidence |
|---|---|---|---|
| **Equity / FI / FX trader** | Lives in a nine-block persona cheat sheet ("Equity — Trader": news · monitors · broad market · trading analytics · charting · company · comparative · earnings · communications); negotiates in IB; runs TUI functions by muscle memory; `TMSG` to send trade ideas | [L06 §5–6; L08 §1–2] | 🟢 that the sheet exists and IB is where trades are negotiated (first-hand HN accounts); 🔴 on daily ordering |
| **Sell-side analyst** | Print-day clock: release → 30–60 min to a compliance-approved reaction note → model rebuild by ~10:00 → recap by EOD; `MODL` line-item diff; `EQR` report writer; `IB Forums` to distribute | [L04 §9; L05 §1] | 🟡 — timing rests on one secondary career guide that names Visible Alpha, not Bloomberg, for consensus |
| **Buy-side PM / analyst** | `EVTS` linked to portfolio for push; `EE`→`EEG` "what is in the price"; `PORT`/`PRTU`; `BI`/`BICO` house research; `W` worksheets that cost nothing until exported | [L04 §1; L02 §10; L05 §8] | 🟢 mechanism; 🔴 on what is open at the moment of a release |
| **Sales / dealer / IOI** | IB carries "trade inquiries, pricing, indications of interest"; MSG blasts; IB Dealing on FI | [L07 §1; L08 §1] | 🟡 (Bloomberg copy + practitioner) |
| **Quant / engineer** | `BQL` (`let/get/for/with/preferences`) screens on Bloomberg's servers; BQuant apps as Launchpad components; Desktop API from Windows only; black boxes must buy B-PIPE / EDF, never the Terminal feed | [L06 §3; L02 §3; L07 §7; L03 §10] | 🟢 on the tiering; 🟡 on BQL practice (thin docs, no changelog — practitioner complaint) |
| **Journalist / newsroom** | `TOP` reflex ("23 years … I still automatically go to Top first"); an always-on `NH` ticker at the bottom of whatever screen is active; walks `NI`/`NH` code lists from the command line | [L03 §12] | 🟡 — single practitioner deck |
| **Compliance** | IB surveillance is in-product; archivers ingest IB via SFTP; `BMAIL`; `LOGU`/`LOGR` sanctioned, logged seat hand-over inside a firm | [L07 §1, §8] | 🟢 that these exist (official guide + two vendor pages) |
| **Student / trainee** | `BMC` 8-hour course covering 70+ functions; `BESS`/`BCER`; university seats with per-terminal download quotas one student can exhaust for a department | [L01 §10; L08 §7; L07 §6] | 🟢 |
| **Mobile user** | Bloomberg Anywhere + Bloomberg Professional app: IB, worksheets, news/research, market data, ASKB; QR + biometric B-Unit login; "never on more than one device at a time" | [L07 §10; L01 §1] | 🟡 — store listing + trial licence; no usage evidence |

**Not served:** retail and non-professional users; there is no reduced tier, and the trial licence's "individual use only … one Receiving Device" language and the seat-sharing prohibition are the boundary [L07 §8]. **Persona split visible in Bloomberg's own collateral:** separate "Equity — Trader" and "Equity Analyst" one-page function maps, each a curated ~90 of the catalogue [L06 §6; L05 §1] — the map, not the menu, is how the surface stays learnable.

---

## C — Navigation (how users move)

**C.1 The grammar.** Canonical form `TICKER <MARKET SECTOR> FUNCTION <GO>` (Cornell), where the market sector is a **yellow key** that both types the type annotation and, pressed alone, opens that sector's menu; `IBM US <EQUITY> GP <GO>` loads the security and runs the price graph in one line; CUSIP/ISIN/BBGID slot into the same shape (`931142DD2 <CORP> <GO>`); the grammar composes across asset classes with no new rules (`SPX <INDEX>`, `EUR <CURNCY>`, `CL1 <CMDTY>`, `F 12 07/16/31 <CORP>`). The type system is enforced: `YA` on an index errors rather than rendering something wrong [L01 §3, 🟢]. Consequence stated by the leaf and adopted here: **vocabulary scales, syntax does not** — the 3,000th function costs the user one new word.

**C.2 One input surface.** The command line accepts four kinds of input — a mnemonic, a keyword for a function you cannot name (`MERG` → list), a partial security (`DIS 7` → refine with `<Corp>`), and an English question (`IBM Q3 2013 REVENUE` → `SEARCH`) — and disambiguates with a categorised list. Typing without `<GO>` is already a search; `<GO>` commits. Escalation ladder: type → autocomplete list → `<GO>` for `SEARCH` → `<SEARCH>` key for `HL`'s categorised sweep. Novice and expert use the *same* path [L01 §2, 🟢]. Ranking rule for a mixed list: NOT DETERMINED.

**C.3 The loaded security is per-panel, labelled, with recents.** "The loaded security remains the active security on the panel until you load a different security"; loading it *is* function discovery (a categorised security-specific menu appears); the toolbar carries **two** recents drop-downs — securities and functions — mirroring the what/how split. Four panels can hold four different securities; linkage across panels is opt-in via Launchpad groups, never automatic [L01 §4, 🟢]. Whether Tabbed Windows scope the loaded security per tab or per window: NOT DETERMINED [L01 §9 OQ].

**C.4 Menus are a view over the grammar.** Every menu leaf is a mnemonic (`Main Menu > Equities > Analyze FORD MOTOR CO Equity > Company Analysis > Financial Analysis > FA`); three doors (yellow key · loading a security · `<MENU>` key/button); breadcrumbs; `<MENU>` walks **up** the hierarchy (a zoom-out) while `<End/Back>` retraces history — two different operations, two keys; "Suggested Functions" region keyed to asset class and "current workflow", previewable "without interrupting your current workflow" [L01 §5, 🟢 mechanics; 🟡 Suggested Functions quality].

**C.5 Keyboard and colour.** Red = stop, green = action, yellow = sector; F2–F11 = `GOVT CORP MTGE M-MKT MUNI PFD EQUITY CMDTY INDEX CURNCY` (F12 differs by keyboard generation); amber fields are the only editable things on screen; a white outline marks clickables; **`Number <GO>`** gives every list row a keyboard address and **Alt-Mode** covers the rest; `<Alt>+K` shows the keyboard; standard keyboards are supported ("it is not necessary to have a special Bloomberg provided keyboard") [L01 §7, 🟢]. Bloomberg could not change `<MENU>`/`<End/Back>` semantics without shipping a revert preference (`PDFU`) [L01 §7, 🟢].

**C.6 Three kinds of "where was I".** `<End/Back>` (screen history), `<CMND HISTORY>` / `LAST <GO>` (editable text you typed, reverse-chronological), favourites (toolbar icon; "favorite places and securities"); `STO`/`RCL` copy-paste a security between screens (REPORTED) [L01 §8, 🟡 on favourites' capabilities].

**C.7 Display models — three coexist.** Classic four panels (`<PANEL>` rotates; each independent with toolbar + command line + function area); Tabbed Windows (up to 16; tab label = mnemonic; `<Ctrl>+N`; zoom + presentation mode; "You cannot restore a tab after you close it"); Launchpad (`BLP`) free-floating on top, with `LLP` promoting "almost any function" into a component and function shortcuts demoting a component click into a chosen panel [L01 §9; L02 §1, 🟢]. Which is default for a 2026 seat: NOT DETERMINED (see R8).

**C.8 Help is a modifier on your position.** `<HELP>` once → the function's Help Page (business purpose, how-to, **calculations**, related links; exportable to PDF); twice → live Help Desk chat, 24/7; `<ESC/CANCEL>` returns to a contact page; `TRAI` books a specialist; `BNEW` shows what is new for your market focus [L01 §6, 🟢]. Help-desk speed: one first-hand account, "technical specialist … under 30 seconds … developer in 30 minutes" [L08 §4, 🟡 single account, attribution API-verified].

**C.9 Session boundaries.** Login is a biometric identity (B-Unit fob or app; Bloomberg Anywhere), not a device; the Terminal "remembers the number of open windows, their locations, and zoom sizes"; log off is a command, `OFF <GO>`; Launchpad opens the most-recent (or a chosen) view at logon [L01 §1; L02 §6, 🟢 geometry]. Whether *content* (the function running in each tab) is restored, or only geometry: NOT DETERMINED.

---

## D — Capability map (Part XIII taxonomy)

Status: **V** = VERIFIED in a Bloomberg-authored source · **R** = REPORTED (secondary only) · **C** = CLAIMED (marketing) · **U** = UNVERIFIED (see D.2). Behaviour beyond the one-line gloss is 🟡 unless the leaf says otherwise.

| Category | Functions (status) | Leaf |
|---|---|---|
| **Market overview** | `WEI` world indices (V) · `IMAP` Intraday Market Map (V — Bloomberg 2024 page; see R9) · `MMAP` heat map (V) · `MOST` most active (V) · `MOV` index/group movers = contribution (V name / R semantics) · `IMOV` group movers (V) · `LVI` largest volume increases (V) · `OVI` option volume change (V) · `HILO` 52-wk (V) · `MRR`/`GRR` best/worst (V) · `WAD` advance/decline (V) · `SIA` short interest (V) · `MARB` M&A arb (V) · `IPO` (V) · `BTMM` rates/eco releases (R) | [L06 §5; L02 §8] |
| **Security pages** | `DES` roll-up + launchpad (V) · `BQ` composite price/trade/news (R) · `CN` company news (V) · `HP` price table (V) · `CM` key events (R) · `CACS` corporate actions — **V**, located precisely as page 35 of a bond's `DES` navigation rail (a per-security page, not a standalone monitor); enterprise reference-data page independently states 50+ event types, 1M+ actions/yr, "follow the sun" analyst review (V) | [L05 §2; L06 §4–5; L04 §11; **L09 §8**] |
| **Fundamentals & valuation** | `FA` left-panel tree, `FA CF` addressable sub-report, frequency by preference (V) · `GF` (V) · `EV` (V) · `XLTP XFA` / `XLTP XDCF` templates (V) · `RV` with Comp Source (Bloomberg peers / GICS / custom) (V) · `EQRV` vs own history (R) · `RVR` `PC` `PV` `RVC` `PEBD` (R) · `KPIC` (V) · `CCB` `SPLC` `SI` `HS` `GX` `CL` (V) · `HDS` (V) / `OWN` `MGHL` `GPTR` (V historical; alias unresolved, R10) · `WACC` `DDM` `BETA` `EQRP` (R, and experts say override) · `MGMT` company management profiles ("top-ranking executives and board members") — **V**, two independent sources (official cheat sheet + university guide) converging without citing each other; no person-level cross-company relationship-mapping (board interlocks) tool found by any source reached | [L05 §1–8, §11; **L09 §10**] |
| **News** | `TOP` + tail (V) · `N`/`NSE` query grammar (V) · `NI` topics · `NH` sources · `TNI` intersection (V) · `READ` `MCN` `MNI` + `1H/1W/1M/1Y` tails (V) · `RECE` `BKMK` (V) · `MYN` (V) · `FIRS` First Word (V; "FIRST" spelling R) · `BRIE` `SALT` (V) · `NZPD` defaults (V) · `NT` news-count vs price · `TREN` velocity (V) · `NRR` `NRS` `NI STK` `NI RLS` (V) · `TWEE`/`TWTR` (V) · `LIVE` (R) · `OTOP` (R) | [L03 §1–9; L06 §5] |
| **Earnings & estimates** | `EE` hub (V) · `ERN` (V) · `EEO` `EEB` `EEG` `EM` `EERM` (V) · `SURP` (R×2) · `ANR` named analyst/firm (V) · `GUID` raw + Bloomberg-adjusted guidance (R, **single source**) · `EVTS`/`EVT` events with live + final transcripts (V) · `MODL` hundreds of line items, print-day diff (V) · `KPIC` (V) · `DS` 200M documents (V) · `ALTD` (V) · `BBEA` `BBSA` `WPE` (V historical) · `EA` (V historical, **scope ambiguous**, R11) · `MREP` morning report (C, **single source**) · `BDVD` `SPLC` (V) · `NI ERN` (V) | [L04 §0–10] |
| **Economic / macro** | `ECO` economic calendars, `ECFC` economic forecasts, `ECOF` economic indicators, `ECST` World Economic Statistics, `TOP ECO` — all **V**, official cheat sheet's own top-level "The Economy" category · `BTMM` — upgraded R→**V**: screenshot-verified to embed a live economic-releases table (`Event/Period/Surv(M)/Actual/Prior/Revised`) alongside Fed Funds/T-Bills/spot-FX/key-rates/swaps/commodities on one screen · `FOMC` FOMC calendar + rail to `FOMS`/`FOMN`/`FEDU`/`OLR`/`WIRP`/`FLIQ` (V, screenshot) · `GC` yield curves (V; confirmed as a shared cross-asset curve-charting primitive, not equity-specific) · `WAD` (V) · "Top Down Analysis" lane `BI` `BILL` `IMAP` `HRA` (V, names only) · `GV` historical vol (V) | [L02 §8; L06 §4; L05 §1; **L09 §1–2**] |
| **Rates / fixed income (govt · corp · mtge · muni)** | Yellow-key menu `F2` Govt / `F3` Corp / `F4` Mtge / `F6` Muni (V, screenshot) · `WB` World Bond Markets (sovereign yields/spreads/curves, regional; drills to a per-country Sovereign Debt Monitor with curves/butterflies/inflation-breakevens/CDS-spread) (V) · `YAS` yield & spread analysis — spread panel (`G-Sprd`/`I-Sprd`/`Basis`/`Z-Sprd`/`ASW`/`OAS`/`TED`) + risk panel (`Mod Dur`/`Convexity`/`DV01`) (V, screenshot) · bond `DES` onward-menu: `FIPX`/`ALLQ` (Price Discovery) · `FPA`/`RRRA` (Financing) · `FIRV`/`COMB` (Relative Value) · `FIHG`/`FIHR` (Hedging) · `FIHZ`/`FISA` (Scenarios) · `BXT`/`SXT` (Ticketing) (V, screenshot) · `CAST` Capital Structure, `FICM`, `SECF`, `RELS` "All Related Securities" (V, 2 independent guides) · Municipal: `MSRC` `SMUN` `CDRA` `SPLY` `MNPL` `TDH` `PICK` (V) · Mortgage: `MDF` `CPD` `SYT` `SYTH` `SPA` `OAS1` `CLC` `MTCS` (V) · Credit/CDS: `CDS` `GCDS` `CMOV` `CDSW` `SOVR` `QCDS` `RATC` `CRVD` `BVAL` (V) · Interest-rate derivatives: `IRSM` menu → `USSW` `IRDD` `ICVS` `FWCM` `SWPM` (V) · **Preferred (`PFD`) depth: NOT COVERED by any leaf → NOT DETERMINED** | [**L09 §2–3**] |
| **FX** | Trading/execution (official product page): `FXGO` platform, `FXEM` execution management, `FXTG` trading grid, 800+ liquidity providers, spot/fwd/swap/options/NDF, `MYQ` quote aggregation (V) · Analysis mnemonics (official cheat sheet): `TOP FX` `XDSH` `FRD` `FXDV` `BFIX` `FXFM` `FXFC` `WCRS` (V) · FX implied-vol surfaces via the **BVOL** engine, 200+ currency pairs, RR/BF and put/call-delta formats (V, screenshot) — largely disjoint from UCT relevance (no FX asset class at UCT) | [**L09 §4**] |
| **Commodities** | Official page: Energy / Metals / Agriculture / Commodity Derivatives sub-categories; spot pricing, forward curves, transformation calculators, options analytics; futures order routing; BloombergNEF research (V) · Mnemonics: `TOP CMD` `NRG` `OIL` `NATG` `COAL` `VOLT` `ENVR` `BIOM` `BMAP` `CMBQ` (V) · `GLCO` (commodities' `WEI`-equivalent) — **R, single passing mention, unverified** | [**L09 §5**] |
| **Derivatives / options** | `OMON` Option Monitor — **V**, two independent sources (HBS help page + official Bloomberg vol fact sheet) converging without citing each other: calls/puts by strike & expiry, `[PgDn]` scroll, inline `EVTS` button, `HV` field · `OSA` Option Scenario Analysis — what-if on amber fields, opened from a clicked `OMON` contract (V) · Vol-surface engines **BVOL** (snapshot, arbitrage-free, equity+FX) and **LIVE** (real-time per-contract greeks, feeds `OMON` directly) (V, official fact sheet) — sold twice: Terminal-native via `OMON`, and as a B-PIPE real-time stream (same "sell the engine twice" pattern as EDF news and `MODL` earnings capture) | [**L09 §6, §12**] |
| **Portfolio / risk analytics** | `PORT` — richly documented (official 17-page brochure): Past (`Performance`, 3-way `Attribution` incl. factor-based), Present (`Intraday`, `Characteristics`, `Cash Flows` via `BDVD`, `Liquidity Risk`), Future (`Tracking Error` w/ click-through Data Transparency, `VaR` — Monte Carlo/Historical/Parametric, `Scenarios` — named historical stress tests, `Trade Simulation`, `Optimization` — efficient frontier) (V) · Data entry: `PRTU` `BBU`; overview `BPRA` (V) · **MARS** multi-asset risk (equities/FX/FI/inflation/credit/mortgages/derivatives; Key Rate/Commodity Term/Credit/IR Vega/FX Delta/FX Vega/IR Basis/Inflation risk Greeks) (V) · **MAC3** factor model (3,000+ factors; country/industry betas, IRV weighting, PCA-shrunk correlations, 6 horizons) (V) · **LQA** liquidity assessment (4.2M+ securities, ESMA/SEC 22e-4-aligned) (V) — a distinct product from `PORT`'s own Liquidity Risk tab | [**L09 §7**] |
| **Screening** | `EQS` staged build with live match count, `As of` date, `93` example screens, `96` edit, `97` backtest (V; backtest verified 2013 only) · `BQL filter(universe, expr)` (R×3) · `BEQS(screen)` in Excel (V) · `WATC` watchlist analytics (V) · `EQBT` (R once) · UF mnemonic for saved screens (U) | [L06 §1–3; L07 §5; L02 §8] |
| **Charting** | `GP` `GIP` `GPC` `GPO` (V) · `IGPO` `IGPV` `IRSI` `IBOL` intraday studies (V) · `G` chart library → saved chart = `G##` (V + R walkthrough) · `TECH` study catalogue (R) · `TDEF` defaults (U) · `RG` `HS` `GC` `GF` `GV` `GPCA` (V) · `COMP` (R) · `MAPS` (C) · Annotate / Key Events flag / normalise to 100 / Edit → Securities & Data (R) · share & co-edit in real time (C) | [L06 §4] |
| **Alerts** | `ALRT` price/trade-signal alerts (R; **condition grammar 🔴**) · `NLRT` news alerts = delivery setting on a saved search; suspend/activate (V) · `BLRT` Alert Catcher, one inbox for news + price + eco (V; internals 🔴) · `MRUL` message rule → external email (V) · `SALT` (V) · `MSG9` notification alerts (V) · monitor price alerts + News Heat (R) · phone notifications (V, mirrored doc) | [L03 §4–5; L02 §4; L07 §1] |
| **Portfolio / watchlist** | Launchpad **Monitor** — 30 columns of 280,000 items, 2,000 securities, copy-vs-link source, Add Members, drag from Excel (V ©2012/15) · `W` Security Worksheet — shareable, Excel-exportable, no download impact until export (V 2023 + R 2025) · `PRTU` `PORT` `PLST` `LIST` (V/R) · `WATC` (V) · `MNRS` ten-version monitor restore (V) · `NW` monitor (V, Excel guide) | [L02 §4, §6, §10; L07 §5] |
| **Documents** | `CF` direct links to original filings (V) · `CFS` `DS`/`DSCO` `PIB` `EQR` (V) · `DS NOTE` notebook (V) · `RES` `BRC` (V) · `DOCS` downloadable documents (V) · transcripts as `EVTS` attachments (V) · FA → 10-K link (V historical) | [L05 §1, §5; L04 §8; L07 §4] |
| **Collaboration** | `IB` rooms/tabs/blast/@mentions/structured data links/surveillance (C+V) · IB Forums (C) · `MSGM` `MSG` `MSG9` `SPDL` `BMAIL` `PFM` (V 2015) · `NOTE` tag-to-security, communities, permissions (C+R) · `GRAB` screen → email (R×4, likely one handout) · `TMSG` trade ideas (V) · IB Connect / chatbots (C) · send a Launchpad view as a message attachment (V older edition) · `LOGU`/`LOGR` (V) | [L07 §1–4, §8–9; L02 §7; L06 §6] |
| **AI** | ASKB conversational/agentic, beta, grounding + attribution, mobile continuity (C + trade press) · AI News Summaries (C) · AI earnings-call summaries with points linking to transcript spans and out to `MODL`/`BDVD`/`SPLC` (V press release 2024-01) · `DS` NLP/topic trends (V) · document search & analysis 2025-06 (trade press) · Suggested Functions (V description; mechanism 🔴) · "Automated Intelligence on Demand" (C) · BQuant apps in Launchpad (C 2025-08) | [L03 §11; L04 §8; L01 §5; L02 §3] |
| **Command / keyboard** | `<GO>` `<MENU>` `<End/Back>` `<HELP>` `<SEARCH>`/`HL` `<PRINT>` `<ESC/CANCEL>` yellow F2–F11 `<PANEL>` `<CMND HISTORY>` `LAST` `Number <GO>` Alt-Mode `<Alt>+K` `<Alt>+D` `<Ctrl>+N` `OFF` `STOP` (V) · `STO` `RCL` (R) · `CHEAT` (R) · `PDFU` key-behaviour revert (V) | [L01 §7–8, §10; L03 #16] |
| **Workspaces** | `BLP` (+`EMPTY`/`NEW`/`AGAIN "NAME"`/`RELOAD`) (V) · `LLP` promote function → component (V) · Component Browser with popularity stars + preview (V) · Group Manager: Security Group / Monitor Group, badge `Group-1, #A` (V + R) · docking (R) · Custom Function Window tabs (V) · Chart Grid (V) · Sample Views by asset class (V) · `PDFB` defaults incl. per-computer resolution (V) · `MNRS` (V) · Show on Selected Pages vs Duplicate to Page (V) · Tabbed Windows / `BTAB` (V) | [L02 §1–8; L01 §9] |
| **Learning / help** | `BMC` (V) · `BPS` `BU` `BHL` `HELP` `TRAI` `BNEW` `USER` (V) · `FFM` Functions for the Market (R + official series page) · `BESS` `BCER` (R) · `DAPI` `HELP BQLX` `HELP NOTE` `HELP IB` (Terminal-only) | [L01 §10; L08 §7; L07] |
| **Data egress / API** | red-toolbar Export (V) · drag-and-drop icon (V) · `XLTP` 400+ templates (V/R) · `BDP` `BDH` `BDS` `BEQS` (V) · `BQL` Excel functions + BQL Builder (R) · Data Transparency drill to source document (V) · Desktop API (Windows only) / SAPI / B-PIPE (EMRS) / Data License (V/C) · `//blp/apiflds` `SECF` `FLDS` field discovery (V) · Terminal Connect (V fact sheet) · `APPS` App Portal with sandbox + billing (V brochure) · download limits: `#N/A Limit`, per-terminal, unpublished (V/R) | [L05 §9; L07 §5–9] |

**D.2 UNVERIFIED — listed, never asserted.** The contract and the leaves' own contracts named these; no leaf found them: **`MON`** (custom monitor; monitors are made in the Monitor Manager and restored by `MNRS`) [L02 §8] · **`TRAN`** (transcripts hang off `EVTS` and are searched by `DS`; L09 independently corroborated `EVTS` as the sole door and found no second mnemonic) [L04 §0; **L09 §9**] · **`PEERS`** (peer sets live in `RV`'s Comp Source; `CCB`/`PC`/`RVR`/`PV`/`KPIC` exist) [L05 GAPS 3] · **`ESRV`** [L01 §10] · **`EQBT`** (one secondary mention) [L06 §2] · **UF (User Formula) mnemonic for saved screens** (search snippet) [L06 §2] · **`TDEF`** (search snippet, 429) [L06 §4] · **`TRAIN`/`CERT`/`BREP`** (a stray Launchpad PDF whose URL leaf 01 could not attest) [L01 GAPS 7] · **"News Themes" on charts** (search summaries only) [L03 §8] · **`FIRST`** as a spelling of `FIRS` [L03 §9] · **`GLCO`** (commodities' `WEI`-equivalent per one passing, uncorroborated mention) [**L09 §5**]. **Single-source, uncorroborated:** `GUID`, `MREP` [L04 GAPS 5]. **Ambiguous:** `EA` (R11), `OWN`/`HDS` (R10), `IMAP` gloss (R9). **RESOLVED by L09 (formerly listed here as NOT COVERED):** the `ECO`-class economic calendar is now VERIFIED — `ECO`/`ECFC`/`ECOF`/`ECST`/`TOP ECO` are named in an official Bloomberg cheat sheet, and `BTMM`'s live releases table is now screenshot-verified [**L09 §1**; Section D "Economic / macro" row above].

---

## Reconciliations (Position A / Position B / Evidence / Resolution)

| # | Topic | Position A | Position B | Evidence | Resolution |
|---|---|---|---|---|---|
| **R1** | `MON` vs `MNRS` | Contract: "custom monitors (`MON`?)" | Leaf 02: `MNRS <GO>` restores up to ten previous monitor versions; no `MON` anywhere | Bloomberg Launchpad user guide ©2012/©2015, "RESTORING A MONITOR" [L02 §6, §8] | **`MNRS` VERIFIED; `MON` UNVERIFIED.** Monitors are created via Tools → Monitor Manager or "Monitor" typed in the Launchpad toolbar keyword field. |
| **R2** | Colour groups vs `Group-1, #A` | Contract: "component groups (colors)"; UCT's own `/charts` uses colour groups A–D | Leaf 02: the group badge is a **number plus a letter** (`Group-1, #A`; A/B/C letters at component tops); red appears only as a transient editing highlight; "color-coding securities" is a per-row monitor feature | Launchpad guide "LINKING COMPONENTS"; Wharton Part III 2013 [L02 §5]; leaf 01 §4 describes the same opt-in mechanism without asserting colour | **No source documents colour-coded component groups.** Any downstream claim "Bloomberg links widgets by colour" needs its own source. Two group kinds: Security Group (any component) and Monitor Group (a list; News Panel only, per one 2013 source). |
| **R3** | `TRAN` vs `EVTS` | Contract: "transcripts (`TRAN`?)" | Leaf 04: transcripts are artifacts of the event (`EVTS`, live and final) and a source in `DS`; `TRAN` absent from every source | Bloomberg "Five tools…" page; Research-on-the-Terminal case study; NYPL guide [L04 §0, §8] | **`EVTS` (and `DS`) VERIFIED as the transcript doors; `TRAN` UNVERIFIED.** |
| **R4** | `PEERS` vs `RV` | Contract: "`PEERS`" | Leaf 05: no `PEERS` mnemonic; peers are `RV`'s **Comp Source** (Bloomberg peer group / GICS / custom), shared by `RV`/`RVR`/`PC`; `CCB` browses classifications | Lei et al. (Bloomberg-hosted); Bocconi; IESE; Babson [L05 §6, GAPS 3] | **`RV` Comp Source VERIFIED; `PEERS` UNVERIFIED.** |
| **R5** | `ESRV` | Contract: "`ESRV`?" | Leaf 01: not found in any document | [L01 §10] | **UNVERIFIED.** Documented discovery addresses are `MENU`, `BPS`, `BU`, `BHL`, `FFM`, `USER`, `HL`/`SEARCH`. |
| **R6** | `<MENU>` semantics | University guides (UCD, Ross, Cornell, Seton Hall): `<MENU>` = back / previous screen | Bloomberg's own Help Page export (2022): `<MENU>` opens related functions and walks **up** the hierarchy; `<End/Back>` retraces history | [S2] p.16 with the `PDFU` revert note [L01 §7] | **Bloomberg changed the semantics and shipped a preference to restore the old behaviour.** Guides describe the legacy binding. Both are "true" for their vintage. |
| **R7** | F12 key | UIUC: `PORT`; Seton Hall: `CLIENT`; other Bloomberg material: `<People>` | — | Wikipedia documents several keyboard generations [L01 §7] | **Generational, not an error.** Do not treat any single key list as canonical. |
| **R8** | Four panels vs 16 tabs vs Launchpad | Leaf 02 (NYIT guide updated 2026-08-03): "four professional service windows", `<PANEL>` rotates | Leaf 01 ([S2] 2022; Bloomberg Oct-2024 tutorial chapter "Terminal Window: Anatomy and Tabs"): Tabbed Windows, up to 16 screens, classic four-panel as the fallback | [L01 §9; L02 §1] | **Not contradictory: three models coexist.** Tabbed Windows puts tabs *inside* windows (`<PANEL>` "cycles through the tabs in all of your windows"; `<Ctrl>+N` adds a window); Launchpad floats over either. Which is the 2026 default: NOT DETERMINED. |
| **R9** | `IMAP` | Bloomberg trader cheat sheet: "Analyse intraday price changes"; UDel list: "Global equity performance" [L06 §5] | Bloomberg's 2024 "Best equities functions" page: `IMAP` = **Intraday Market Map** [L02 §8] | Bloomberg-authored on both sides | **Intraday Market Map** — a map of intraday price changes; the two glosses are the same thing at different precision. Whether it publishes to component groups: NOT DETERMINED. |
| **R10** | `OWN` vs `HDS` | Lei (~2012) and Scranton: `OWN` Ownership Summary with a Transactions tab | Bloomberg 2016 cheat sheet and Babson (2025): `HDS` Security Ownership with Ownership Summary + Insider Transactions tabs | [L05 §7] | **Unresolved alias/merge.** Treat `HDS` as the current canonical name (Bloomberg's own sheet); `OWN` possibly aliased or retired. Coverage claims (179 countries, 500k instruments, hourly insider) are from the 2019 fact sheet and hold regardless. |
| **R11** | `EA` scope | Bloomberg c.2010 card: "Display current earnings season results" (broad market) | CBS guide: "Earnings analysis: Price reaction (EA)" (single security) | [L04 §11] | **Unresolved.** Repurposed mnemonic, context-dependent, or one source wrong. Itself an observation: a four-letter namespace collides invisibly. |
| **R12** | `W` | Stanford: "Use `W <GO>` to save custom layouts, charts and data" [L06 §4] | Bloomberg 2023 Pro Tips + Cranfield 2025: `W` = **Security Worksheet**, a shareable multi-instrument list with no download impact until export [L02 §10; L07 §6] | Bloomberg-authored on side B | **`W` is the Security Worksheet.** Stanford's gloss is loose. `W` and the Launchpad monitor are *complements* (2024 Essentials pairs `W` with `LLP`); whether they share a store: NOT DETERMINED. |
| **R13** | Provenance click-through | Leaf 05: no evidence Bloomberg drills a line item to its filing paragraph; a third-party review credits Capital IQ with the "click-through to audit" killer app | Leaf 07: the Excel add-in's **Data Transparency** tool drills a value through its composite numbers to the source document (green = composite, blue = document) — verified in Bloomberg's own guide. Leaf 08: a practitioner reports on-Terminal "double click on a data point and it shoot you into a pdf of the financial statement" | [L05 §5; L07 §5; L08 §5] | **Bloomberg ships number → source-document drill: VERIFIED in the Excel add-in, REPORTED on the Terminal.** Leaf 05's ceiling narrows to *the FA screen's per-line-item behaviour*, which no source shows. Whether Data Transparency exists inside the Terminal (not only Excel) remains leaf 07's open question. 🟡. |
| **R14** | Latency | Leaf 04: Bloomberg publishes sub-second targets for earnings capture (7,381-report study) | Leaf 03: the Terminal does not compete on speed; millisecond claims attach to the enterprise EDF feed | [L04 §4; L03 §10] | **Convergent, not conflicting:** speed claims attach to *data products* (real-time events data, EDF); the Terminal-side proposition is breadth, classification and routing. `MODL` "within seconds/minutes" is the Terminal-facing number. |
| **R15** | Subscriber count | 315,000 (2013 press release, snippet only); 325,000 (HBS 2015 blog; Wikipedia 2022 citation; App Portal brochure 2022) | "more than 350,000" (Bloomberg product page 2026; Terminalist 2024) | [L07 §2; L08 §1, §8] | **Marketing counts, not audited; treat as ~325–350k Terminal users, none as IB users.** The 2015=2022 coincidence is flagged, unresolved. |
| **R16** | `FIRS` vs `FIRST` | Secondary sources: `FIRST` | Bloomberg cheat sheet p.41: `FIRS` | [L03 §9] | **`FIRS` VERIFIED**; `FIRST` presumably resolves by autocomplete (not verified). |
| **R17** | BI headcount | 350 (brochure prose) | 400+ (brochure by-the-numbers page); 500+ (Bloomberg web page via search) | [L05 §8] | **Cite the document and date, not the number.** Even first-party collateral carries drifted hand-typed counts. |
| **R18** | Beta default | Babson: 2-year unadjusted vs S&P 500 | Damodaran: two years weekly, local index (adjusted); Lei 2012: S&P 500, one year weekly | [L05 §11] | **Unresolved; the default changed or the sources describe different screens.** Do not carry a default from a guide into a model. |
| **R19** | Help-desk "30 seconds" | A summarised HN page attributed it to a 2017 commenter | Algolia API: author **chollida1**, 2015 outage thread | [L08 evidence-fidelity note, §4] | **Leaf 08's API-verified attribution stands.** Program-level finding: automated page summarisation is not a citation mechanism. |
| **R20** | Price | $24–27k (2022) · $30k (2023 hike) · $31,980 (2026 essay) · "$25k to $36k" (HN 2025) · $21k (2016) | — | [L08 §7; L01 #17] | **No figure is verified; Bloomberg publishes no price.** Report a range with dates; see L. |
| **R21** | "Entirely discoverable" vs "steep learning curve" | Bloomberg's student guide and Help Page: the Terminal is "entirely discoverable from the command line" [L01 §2] | Bloomberg ships an 8-hour course, cheat sheets, 24/7 desk, trainer booking [L01 §10]; a former Bloomberg UX designer: backward compatibility "came at the expense of a steep learning curve" [L08 §2] | Both Bloomberg-authored; one insider | **Discoverable ≠ learnable.** Everything is reachable from the box; knowing what to type is the cost, and Bloomberg pays it with training rather than by moving controls. |
| **R22** | Mobile alerts vs mobile app | Leaf 03: "Phone Notifications" as an alert delivery option (mirrored doc) | Leaf 07: Bloomberg Professional app = IB + worksheets + news + data + ASKB, gated to Bloomberg Anywhere | [L03 §5; L07 §10] | **Consistent.** Push exists; whether a user can *act* (edit a worksheet, create an alert) from mobile: NOT DETERMINED. |
| **R23** | Getting-Started guide vintage | Leaf 01: "undated" | Leaf 06: doc code 62353 DIG 1117, ©2017 | Same URL | **©2017** (leaf 06 read the doc code). It describes the classic four-panel display. |
| **R24** | Leaf 01's stray Launchpad PDF | Leaf 01 read a "Bloomberg Launchpad Getting Started" PDF it could not attest and declined to cite | Leaf 02 cites and attests the U. Delaware edition (`BB-Getting-Started-in-Launchpad.pdf`) and two later editions | [L01 GAPS 7; L02 sources 1–3] | **Leaf 02's attested citations cover `BLP`/`LLP`.** `TRAIN`/`CERT`/`BREP`, which appeared only in leaf 01's unattested read, stay UNVERIFIED. |

---

## E — Workflows

### E.0 The Part VIII chain — sixteen steps, each mapped to what the leaves could verify

| # | Step (Part VIII) | Bloomberg mechanism | Leaf | Status |
|---|---|---|---|---|
| 1 | search a ticker | Command-line autocomplete; `TICKER <EQUITY>` or CUSIP/ISIN/BBGID; yellow key narrows type; `SECF` for lookup | [L01 §2–3; L07 §7] | 🟢 verified |
| 2 | inspect price action | `GP` (daily), `GIP` (intraday, ~240 days *reported*), `BQ` composite; candle/bar toggle | [L06 §4] | 🟢 names / 🟡 controls |
| 3 | check latest news | `CN` (news tagged to the loaded security; `CN BN` narrows to Bloomberg wires); `TOP <company>`; news/events flag on `GP` | [L03 §1, §3, §8] | 🟢 / 🟡 chart flag (one tutorial) |
| 4 | inspect earnings history | `ERN` (EPS vs consensus, surprise, announcement-day price change), `SURP` | [L04 §0] | 🟢 exists / 🔴 render, consensus vintage |
| 5 | compare estimates | `EE` hub → `EEO` (mean of sell-side), `EEB` (broker-level, `# Ests` field), `EEG` (drift vs price) | [L04 §2, §5, §7] | 🟢 |
| 6 | examine valuation | `FA` (Ratios / Key Stats; standardized vs adjusted), `RV` Overview, `EQRV`/`PEBD` vs own history, `WACC`/`DDM` (override) | [L05 §3–4, §6, §11] | 🟡 |
| 7 | identify peers | `RV` Comp Source (Bloomberg peer group / GICS / custom; pen icon + `<add security>`), `CCB`, `SPLC` | [L05 §6] | 🟡 (four independent guides) |
| 8 | inspect ownership | `HDS` (Ownership Summary + Insider Transactions tabs) / `OWN` `MGHL` `GPTR`; 13D "purpose of transaction"; hourly insider updates | [L05 §7] | 🟢 coverage / 🔴 alias |
| 9 | view analyst revisions | `EERM` (revisions), `ANR` (named analyst + firm per rating, targets) | [L04 §5, §7] | 🟢 exist / 🔴 `EERM` render |
| 10 | open relevant filings | `CF` direct links; `DS`/`CFS`; FA carries a link to the period's 10-K | [L05 §5] | 🟢 / 🟡 FA link (historical) |
| 11 | chart a specific ratio | blue chart icon beside any `FA` line item; `GF`; `G` library → saved as `G##` | [L05 §3; L06 §4] | 🟡 |
| 12 | compare against the index | `GP` Edit → Securities & Data, normalise to 100; `RG`; `COMP` (reported); `GF` vs `SPX` | [L06 §4; L05 §6] | 🟡 |
| 13 | save into a monitor | Launchpad Monitor (typed / index members / Excel drag / **copy vs link source**); `W` worksheet; `EQS` → worksheet | [L02 §4, §10] | 🟢 (©2012/15 mechanism) |
| 14 | create an alert | `NLRT` from a saved search (suspend/activate); `ALRT` price (grammar 🔴); monitor price alerts; `BLRT` inbox; `MRUL` email | [L03 §4–5; L02 §4] | 🟢 news / 🔴 price builder |
| 15 | share findings | IB (structured data links, screenshots from the actions menu); `GRAB`; `NOTE` tagged to the security; send a view/page as a message attachment; `TMSG` | [L07 §1, §3–4; L02 §7] | 🟢 what / 🔴 how it feels |
| 16 | return with the workspace preserved | `OFF <GO>`; window count/positions/zoom restored; Launchpad opens the last or chosen view; per-computer resolution; `MNRS` if a monitor was damaged | [L01 §1; L02 §6] | 🟢 geometry / 🟡 content |

**What the chain teaches, per the leaves and adopted here:** the chain is fast because steps 2–12 never re-enter the ticker [L05 §10], because steps 5, 9, 13, 14 and 16 are all *named* objects rather than clicked-to states [L02 §2; L03 §4; L06 §4], and because steps 3, 11 and 12 happen *on the price surface* rather than beside it [L03 §8; L06 §4]. The steps whose Bloomberg rendering no leaf could see are 4, 6 and 9 — precisely the ones where UCT's data tier differs most [L04 §3].

### E.1 Workflow A — "Why is this stock moving?" (Part XIV A)

Reconstructed from [L06 §5], [L03 §8], [L02 §8], [L03 §1]. **Overall 🟡:** inventory 🟢, ordering 🔴 (no practitioner names which function they hit first).

1. **Notice.** The name surfaces on a rack of mover lenses that all cut the same tape: `MOST` (most active; filter by index and sector), `MOV` (which names are *driving* a selected index — contribution, not a sorted list), `IMOV` (group movers), `IMAP`/`MMAP` (map / heat map), `LVI` (volume increases), `OVI` (option-volume change), `HILO` (52-week), `WAD` (advance/decline), `SIA` (short interest) — or on a Launchpad monitor whose "News Heat" column bars current news activity per row [L06 §5 V; L02 §4 R].
2. **Load it in one keystroke.** Click the row: in Launchpad a function shortcut pre-bound to the row opens the chosen function in the chosen panel; the loaded security's categorised menu appears [L02 §1 V; L01 §4 V].
3. **Look at the move.** `GIP` intraday (or `IGPO` bars, `IGPV` volume studies, `IRSI`, `IBOL`), with the Security/Study panel's **events/news/earnings flag** on so the story sits on the candle [L06 §4 R (one screenshot tutorial)].
4. **Read the story.** `CN` (news tagged to the security, sources/date/language editable; `CN BN` for Bloomberg wires only) or `TOP <company>`; Scranton: from `MOST` "click to view the news of the day and distinguish why the stock is up/down" [L03 §1, §3 V; L06 §5 R].
5. **Is attention building?** `NT` charts story count against price; `TREN` shows what is trending on wires and social [L03 §8 V].
6. **Compose.** `BQ` "composite view of price, trade data & news" [L06 §5 R]. `RECE` recalls the last ~200 stories you opened [L03 §7 V].
7. **Tell someone.** IB with a live ticker handle; `GRAB` [L07 §1, §4].

**Missing / not determined:** whether clicking a plotted news marker opens the story or only labels the bar [L03 §8 OQ]; whether `IMAP` tiles publish to a component group [L02 §8 OQ]; the first function a trader actually hits (list, composite page, or chart) [L06 §5 OQ]. **Bloomberg's contribution is adjacency, not insight** — it does not tell you why; it makes "it moved" and "today's story" one click apart [L06 §5]. UCT's `CatalystTable` (CLAIM) inverts this by pre-answering with a cited thesis; UCT has no `MOV`-style contribution view (CLAIM) [L06 §5].

### E.2 Workflow B — "Prepare me for earnings" (Part XIV B)

Reconstructed from [L04 §1, §5–9], [L03 §4], [L04 §11]. **Overall 🟡:** Bloomberg's own four-phase staging 🟢; the clock rows rest on one secondary account that names a competitor for consensus.

**Bloomberg stages the topic by time relative to the print, not by data type:** *Prepare* (`EVTS`) → *Anticipate* (`EE`, `EEG`) → *Interpret* (`MODL`, `DS`) → *Action & Communicate* (IB Forums); or `EVTS` → `MODL` → `ALTD` → `DS` → `GF` [L04 §1 V].

| When | Step | Function | Status |
|---|---|---|---|
| Days out | Link portfolio/watchlist so releases push; Outlook integration; live + final transcripts will attach here | `EVTS` | 🟢 V |
| Days out | Establish what is already in the price: consensus level (`EEO`, mean of sell-side; `# Ests` beside it), broker detail with names (`EEB`), **drift** of consensus plotted on price (`EEG`), revisions (`EERM`), ratings/targets with named analysts (`ANR`) | `EE` → children, each directly addressable | 🟢 exist / 🔴 render |
| Days out | Guidance: company's current + historical, beside Bloomberg's own adjusted series with confidence intervals, labelled | `GUID` | 🟡 single source |
| Days out | Surprise history and the share-price reaction to each; the CBS caveat that surprise sign does not predict move | `ERN`, `SURP` | 🟡 |
| Days out | Own line-item forecasts vs consensus across hundreds of line items incl. segment KPIs | `MODL` | 🟢 V |
| Days out | Alternative-data read-through (card transactions, foot traffic) | `ALTD` | 🟢 named only |
| Days out | Standing alert: save an `N` search, name it (it becomes an `NI` code), set delivery | `NLRT` | 🟢 V |
| Days out | **Implied move:** raw materials only — `OMON` option monitor, `OVME` strategy pricing; **no dedicated earnings expected-move function found** | — | 🔴 |
| Release | Reported data captured automatically ("within seconds"; sub-second *target* on the real-time events product, 7,381-report study; analyst oversight in the loop) and diffed vs consensus at line-item level; marquee example is a bank's loan-loss provision, not EPS | `MODL` | 🟢 V |
| Release + minutes | Put the surprise in historical context | `GF` | 🟢 V |
| Release + 30–60 min | (Sell-side only) compliance-approved reaction note | — | 🟡 one secondary source |
| The call | Live transcript; AI call summaries whose points **jump to the transcript excerpt** and link out to `MODL`/`BDVD`/`SPLC` | `EVTS`; AI summaries (press release 2024-01-22) | 🟢 V |
| Post-call | Search the language across 200M documents; peer KPI inflections; rebuild comps | `DS`, `KPIC`, `RV` | 🟢 / 🟡 |
| EOD | Distribute and discuss; customised morning report | IB Forums, `NOTE`, `MREP` | 🟡 / single source |

**Missing / not determined:** whether `ERN`/`SURP` store the as-of-the-time consensus or recompute against current data — the most decision-relevant unknown for any earnings-reaction study [L04 §6]; BEst construction rules (staleness, outliers) — Bloomberg does not publish them [L04 §5]; whether the default view switches by phase or the user navigates manually [L04 §1 OQ]; what a buy-side PM has open at the release [L04 §9 OQ]. Point-in-time consensus is sold as a **separate product** (COFI), so the live screens show *today's* consensus [L04 §6 V].

### E.3 Workflow C — "Research this company from scratch" (Part XIV C)

Reconstructed from [L05 §10] (Babson walkthrough + Lei ordering + Damodaran's fixed print list), extended with [L04 §2], [L07 §3], [L02 §10]. **Overall 🟡:** converging walkthroughs; the ordering is a synthesis; time-to-view unmeasured 🔴.

0. `TICKER <EQUITY>` — loads once; everything below inherits it.
1. `DES` — business, management, index membership, ratios, beta; **it says of itself** that "much of the financial information … is also available in greater detail through other functions" — a roll-up that points onward, never the citation [L05 §2 V].
2. `FA` → Segments (product/geographic mix and trend) → Ratios / Liquidity / Key Stats; frequency (annual/quarterly) is a preference, not a page; **standardized vs adjusted vs as-reported** are views, and the toggle is a first-class parameter in the data layer (`FA_ADJUSTED=Y`) [L05 §3–4 V]. Known complaint: blank cells carry no explanation [L05 §3 R].
3. `CF` / `DS` — the 10-K/10-Q/8-K/proxy; footnotes; GAAP↔non-GAAP reconciliations [L05 §5 V].
4. `EE` → `ERN` / `EEO` / `ANR` — expectations, beat history, who covers it [L04 §2].
5. `RV` (peers, Comp Source editable inline; top line = peer average) + `EQRV` / `PEBD` (vs own history) + `GF` vs `SPX` — CBS's three axes: vs itself, vs peers, vs market [L05 §6 R].
6. `HDS` → Insider Transactions (hourly refresh; 13D purpose of transaction) [L05 §7].
7. `BICO` — "instantly recall the primer on the currently loaded security"; → Related Primers → Industry → `BI` [L05 §8 V brochure].
8. `WACC` / `BETA` / `EQRP` or `XLTP XDCF` — put a number on it; every serious guide says override the defaults [L05 §9, §11].
9. Save it: `W` worksheet or Launchpad monitor (choose **copy** or **link** to source); `NOTE` tagged to the security so the note is findable *from the security*; `NLRT`/`ALRT` [L02 §4, §10; L07 §3; L03 §4].

**What no leaf could reach:** the FA screen itself (tab set, where the Adjusted/As-Reported control sits); per-line-item drill to the filing paragraph (see R13); what `BICO` returns for an uncovered small-cap [L05 GAPS 1, §8 OQ]. Bloomberg is explicit there is no wizard: "there is no such formula" [L05 §10 V].

### E.4 Workflow D — "What matters today?" (Part XIV D)

Reconstructed from [L03 §1, §9, §12], [L02 §6, §8], [L06 §6], [L03 §5]. **Overall 🟡:** surfaces 🟢; the lived morning 🔴 (one journalist, no trader).

1. **Log on and the desk is already there.** Launchpad opens the last (or a chosen) view at logon; window geometry restored; per-computer resolution [L02 §6 V; L01 §1 V].
2. **Overnight alerts are in one inbox.** `BLRT` collects news, price and economic alerts from every creator; anything routed out by `MRUL` already reached the phone or personal email overnight [L03 §5 V].
3. **Curated first, firehose on request.** `TOP` (editorial rank: "news judgment of the editors … breadth of readership, relevance and time"; "All Stories" is an explicit click; First Word items in the side panel); `TOP OIL` / `TOP <company>` / `TOP <person>` re-aim the same verb [L03 §1, §7 V].
4. **The compressed tier.** `FIRS` — bullets, no narrative, "breaking news for market professionals" [L03 §9 V].
5. **The scheduled tier.** Daybreak (overnight + upcoming), **Morning Report** "customized to your security list", `BRIE` newsletters, `SALT` company email alerts [L03 §9 C/V].
6. **The tape.** `WEI` by region; `MOST`; `IMAP` map; `WAD` breadth; `BTMM` rates and the day's economic releases (R); `HILO`; `IPO` [L02 §8; L06 §5–6].
7. **Ambient lane.** A journalist's habit: one screen permanently on `NH`, with the news ticker pinned under whatever the active task is; `TOP` first "23 years" later [L03 §12 R].
8. **My universe.** `MYN` sections from saved searches; the Launchpad monitor with News Heat; `W` worksheet with news/event icons [L03 §4; L02 §4, §10].

**Missing / not determined:** the economic-calendar function family (no leaf researched it); whether `TOP`'s ranking is overridden intraday by a velocity signal [L03 §1 OQ]; for a trader rather than a journalist, whether the ambient lane is news or price/flow [L03 §12 OQ]; how First Word is produced [L03 §9 OQ]. Bloomberg's layering is by **reader time budget** — wire → First Word → `TOP` → Daybreak/Morning Report — four products over one classified pool [L03 §9].

### E.5 Workflow E — "Find a trade" (Part XIV E)

Reconstructed from [L06 §1–4], [L02 §8, §10], [L07 §5], [L03 §4]. **Overall 🟡:** `EQS` skeleton 🟢 (official manual + four guides); backtest verified 2013 only; push alerts from a screen 🔴.

1. **Start from someone else's screen.** `EQS` → `93 <GO>` example screens (`<Search Example Screens>`; named examples like "Frontier Market Stocks with 1 billion USD Market Caps"), `96 <GO>` to edit its criteria in place; Bloomberg's own screens are addressed through the *same* API parameter as a user's (`stype` GLOBAL/PRIVATE) [L06 §2 V].
2. **Build with a live count.** Screening Criteria: drag a criterion into Included/Excluded → Update → "count of company matches" updates at the bottom of the build tab *before* you see the list; Add Criteria: browse a category tree or type into the amber box (two doors, one store); Scranton's funnel 800k → 28 from four criteria [L06 §1 V/R].
3. **Ask as of a date.** The results page carries an **As of** box — the screen is a query over a dated snapshot, which is what makes it backtestable [L06 §1 R].
4. **Results → list.** `95) Output` to Excel; send securities to a `W` worksheet (Cranfield: `EQS` → worksheet); or into a Launchpad monitor with copy-or-link semantics [L06 §1; L02 §10, §4].
5. **Backtest, asynchronously.** `97 <GO>` / Backtest: benchmark, rebalance frequency, start and relative end date, name it, Save & Run — "Users receive an e-mail message when the test is finished"; results open from a blue attachment (worked example 173% vs 94%) [L06 §2 V-2013]. The 2023 webinar's "back-testing entry signals" is a *different*, technical-side capability whose function no leaf named.
6. **Escape hatch.** `BQL`: `get()` / `for(filter(members('SPX Index'), cur_mkt_cap > 10B))` / `let(#myvar = …)`; runs on Bloomberg's servers; errors teach the fix ("Apply filter() / group() to reduce the size") [L06 §3 R].
7. **Look at each name.** `GIP` or the trader's own `G##` chart; `RV`; `EE`/`SURP`; `EVTS` for the next event; `OMON` [L06 §4, §6].
8. **Arm it.** `ALRT` (price; grammar unverified); `NLRT` on a saved news search [L03 §4–5].
9. **Share it.** `TMSG` trade ideas; IB; `GRAB` [L06 §6; L07].

**Missing / not determined:** whether an `EQS` screen can *push* when a new name enters it [L06 §2 OQ]; whether a chart can carry an alert (trendline break, study crossover) [L06 §4 OQ]; whether `EQS` distinguishes "screened out" from "field unavailable" [L06 §1 OQ]; the study inventory and drawing tools (zero quantitative evidence) [L06 GAPS 2–3].

### E.6 Workflow F — "Monitor my universe" (Part XIV F)

Reconstructed from [L02 §4–6, §10], [L03 §4–5], [L07 §5–6, §10]. **Overall 🟢 on mechanism (©2012/©2015 guide, two editions text-identical; 2023–2025 official pages for `W`), 🟡 on the 2026 UI.**

1. **Choose the container.** Launchpad **Monitor** (embedded on a board, links to components) or `W` **Security Worksheet** (standalone, shareable, exportable, "no impact on the download limit until you actively choose to export") or `PRTU` portfolio (feeds `PORT` analytics) — three overlapping list containers; Bloomberg's 2024 lesson pairs `W` with `LLP` as complements [L02 §10].
2. **Fill it — and say which kind of list it is.** Typed; `Add Members` of an index; drag a column from Excel; from `EQS` results; from another component. Import asks: **"Copy from source — fixed list … will not update"** vs **"Link to source — will reflect any changes"** [L02 §4 V].
3. **Author the columns.** Up to 30 of 280,000 data items (up from 14 of 6,500 in the earlier edition), keyword-searched from the field dictionary, renamed; "News Heat" bar per row; colour-coding per row; price alerts per row [L02 §4 V/R].
4. **Link it.** Grouping icon → Group Manager → the component "highlighted in red" → Update → `Group-1, #A`; each consumer opts in with its own verb (News Panel: Settings → Add to Security Group; Monitor: Link To → Component Groups); a **Monitor Group** carries the whole list to a News Panel [L02 §5 V/R].
5. **Arrange it.** Views → Pages; `Show on Selected Pages` (one instance) vs `Duplicate to Page` (a copy); docking on the yellow line; zoom; Custom Function Window tabs to cut component count [L02 §2, §6, §3].
6. **Be told.** `NLRT` saved-search alerts; `BLRT` inbox; `MRUL` forwarding rule set once for every alert type; phone notifications; the two independent institutional warnings against real-time email volume [L03 §4–5 V].
7. **Take it with you.** Worksheets on the mobile app; `BEQS` / Launchpad / `NW` / `PLST` / `LIST` loadable by name in the Excel Import wizard [L07 §10, §5].
8. **Undo.** `MNRS` restores any of the last ten versions of a monitor — "if you delete a monitor accidentally or make a change … you would like to undo" [L02 §6 V].
9. **Come back.** `PDFB` defaults: startup view, auto-open at logon, per-computer resolution [L02 §6 V].

**Missing / not determined:** what happens when a linked source changes under hand-edited rows [L02 §4 OQ]; Security Group vs Monitor Group precedence [L02 §5 OQ]; whether views are stored server-side (inferred from Bloomberg Anywhere + per-computer resolution; no source states it) [L02 §6]; multi-monitor spanning [L02 GAPS 4].

### E.7 Workflow G — "Understand the market regime" (Part XIV G) — PARTIALLY CLOSED by L09, chaining itself remains a ceiling

**L09 (added 2026-09-02) closed the inventory half of this gap but not the chaining half.** The individual screens are now well evidenced, several with screenshots: `BTMM` — now VERIFIED, not merely REPORTED, to embed a live economic-releases table (`Event/Period/Surv(M)/Actual/Prior/Revised`) alongside Fed Funds, T-Bills, spot FX, key rates, swaps and commodity prices on one screen, with a direct link from its Fed Funds row into `FOMC <GO>` (announcement calendar, historical rate/bias table, and a related-information rail to `FOMS`/`FOMN`/`FEDU`/`OLR`/`WIRP`/`FLIQ`) [**L09 §1**]; `WB` World Bond Markets drills from a regional sovereign-yield table into a per-country Sovereign Debt Monitor carrying benchmark yields, curve spreads (2s5s, 2s10s, 2s30s, 5s10s), butterflies, inflation breakevens, and a CDS spread — i.e. a single screen that already composes rates, curve shape, inflation expectations and credit into one regime-adjacent read [**L09 §2–3**]; `GC` is confirmed as a shared curve-charting primitive invoked identically from credit, sovereign and swap contexts, not an equity-specific tool [**L09 §2**]; `WEI`/`WE`/`EEI` (indices by region; JHU) [L02 §8, sources 19]; `GV` historical volatilities, `WAD` advance/decline, `SIA` short interest, `HILO` (V names) [L06 §4–5]; the "Top Down Analysis" lane — `BI`, `BILL`, `IMAP`, `HRA` — on Bloomberg's 2016 analyst sheet (V names only) [L05 §1]; BI Industry Outlooks on a 6–12-month horizon (C) [L05 §8]; BI's own FICC Strategy team explicitly "cover[s] rates, currencies and corporate credit... insights on potential policy, political and economic impacts on valuation" — i.e. Bloomberg Intelligence itself publishes a synthesized regime read as a research product, distinct from any single screen [**L09 §3, S10**].

**Still NOT DETERMINED, and named honestly as a ceiling rather than invented:** no source reached by either wave of this program shows *how a Bloomberg user chains these screens together* — whether a trader habitually starts at `BTMM`, `WB`, or `WEI`; whether there is a single named "regime" function that composes rates + credit + equity breadth + volatility into one read (no evidence of one was found — `WB`'s Sovereign Debt Monitor is the closest single-screen composition found, and it is rates/credit-only, with no equity-breadth or volatility panel); and whether Bloomberg Intelligence's FICC Strategy research (a written product) or a Terminal screen is the primary artifact a trader actually opens first. **What would determine it:** a practitioner walkthrough or a terminal seat, per the same OI-08 ceiling named throughout this dossier — L09's contribution is a much richer, partly-screenshot-verified inventory of the pieces, not the missing sequence.

---

## F — Data (coverage, vendors, real-time vs delayed, asset classes, history)

All figures are Bloomberg self-reported and dated; leaves flag internal inconsistencies. Cite the document and date, never the bare number.

| Domain | What the leaves could establish | Status | Leaf |
|---|---|---|---|
| **Asset classes** | The yellow keys are the taxonomy: `GOVT CORP MTGE M-MKT MUNI PFD EQUITY CMDTY INDEX CURNCY` (+ generational F12); one grammar composes across all | 🟢 V | [L01 §3, §7] |
| **News** | 2,700 journalists, 1,000+ external providers, 146 bureaus (2026 page) vs 151 (2015 sheet), 40+ languages, 5,000+ stories/day; "90,000+ online & social sources" vs "100,000+ sources"; trade press 2026: 5,000 original + 1.1M curated stories daily; every story classified to "millions of securities and thousands of … topic codes"; relevancy scores tie tags to stories (2015 EDF sheet: 75,000 securities, 10,000 topics); **archive back to 1992** sold for backtesting (EDF) | 🟡 C / V-dated | [L03 §3, §7, §10] |
| **Fundamentals** | Two normalisations over filings — standardized (industry practice) and adjusted (one-time items removed) — beside GAAP as reported; 100+ analysts; "more than 13,000 front-end and back-end checks"; calendarisation (`C1231`) and blended periods (`BA`/`BT`) as named parameters; point-in-time via `AS_OF_DATE` / `FUNDAMENTAL_PUBLIC_DATE` | 🟢 V (2018 sheet, BQL sheet) | [L05 §4–5] |
| **Estimates** | BEst = *mean* of sell-side (WU Vienna, R); `# Ests` field; broker-level contributions with names (`EEB`, `ANR`); consensus on hundreds of line items incl. segment KPIs (`MODL`); **construction rules not public**; point-in-time company financials/estimates/pricing (COFI) is a separate product: 530+ fields, 85k companies, same-day updates for ~5,000 index names, others within 24h | 🟢 that these are the claims / 🔴 recipe | [L04 §3, §5–6] |
| **Real-time earnings capture** | "Automated extraction targets sub-second schematized delivery"; sources = press releases, web releases, embargoes; 7,381 reports Oct–Dec 2023 across 6,510 companies; analyst oversight; Apple example: ~2.5% move in 30 s, most within ~2 s | 🟢 V claim | [L04 §4] |
| **Ownership** | 179 countries, 500,000+ instruments, 100,000+ funds; 13F from 2006; 13D with "purpose of transaction"; US insider Forms 3/4/5 **hourly**; UK share registry | 🟢 V (2019 sheet) | [L05 §7] |
| **Research** | BI: 350 / 400+ / 500+ analysts (three figures in Bloomberg's own collateral), 135+ industries, 2,000+ companies, 500+ data contributors; primers, outlooks, previews, "BI reacts" | 🟡 C, inconsistent | [L05 §8] |
| **Documents** | `DS`: 200 million documents — research, filings, industry news, transcripts, legal & regulatory | 🟢 V | [L04 §8] |
| **Real-time feed (enterprise)** | B-PIPE: 35M instruments, 330+ exchanges, 5,000+ contributors; Data License: 70M+ instruments, 100B+ data points/day, "aligns with the data on the Bloomberg Terminal" | 🟡 C | [L07 §7] |
| **Real-time vs delayed** | The Terminal is presented as real-time throughout; Excel `BDP` streams at a default 300 ms tick; 3,500 concurrent real-time subscriptions cap per terminal (Penn); no non-professional/delayed tier found | 🟡 | [L07 §5–6] |
| **History depth** | Intraday `GIP` ~240 days (R); daily/weekly unbounded in the guides (no figure); news archive 1992 (EDF); 13F 2006; EQS "As of" allows dated screens | 🟡 | [L06 §1, §4; L03 §10] |
| **Fixed income pricing** | Evaluated pricing via **BVAL**: "leads the industry in fixed income valuation," "the primary pricing source for the Bloomberg Fixed Income Indices"; also covers OTC derivatives; a separate "IBVAL Front Office" tier for investment-grade USD credit named but not detailed | 🟡 C (official page, no independent corroboration of the "leads the industry" claim) | [**L09 §3**] |
| **Volatility (options, all asset classes)** | Two named calculation engines: **BVOL** (snapshot-based, arbitrage-free surfaces, equity + 200+ FX pairs) and **LIVE** (real-time per-listed-contract implied vols/greeks, feeds `OMON` directly); sold as a Terminal display AND as a B-PIPE real-time stream — same computed values, two products | 🟢 V (official 2018 fact sheet, specific and falsifiable) | [**L09 §6**] |
| **Portfolio/risk factor coverage** | MAC3: 3,000+ factors (700+ equity, 1,000+ fixed income, 300+ commodity, 30+ private equity, 340+ currency); MARS: named term-structure Greeks (Key Rate/Commodity Term/Credit/IR Vega Matrix/FX Delta/FX Vega/IR Basis/Inflation Risk) across equities/FX/FI/inflation/credit/mortgages/derivatives; LQA: 4.2M+ securities globally | 🟡 C (official pages; no leaf independently corroborated the factor counts) | [**L09 §7**] |
| **Corporate actions** | "More than 50 event types across asset classes... over one million related actions added annually," produced by automated ingestion plus "specialized global corporate action analysts who 'follow the sun'" | 🟡 C (official page; same automation+human-review pairing pattern as `MODL` earnings capture and EDF news) | [**L09 §8**] |
| **FX / commodities coverage** | FX: 800+ liquidity providers, spot/fwd/swap/options/NDF, 100+ algo strategies across 40 providers in 50+ countries (C, official trading page) · Commodities: Energy/Metals/Agriculture/Commodity Derivatives named sub-categories with specific instrument lists (C, official page) — neither independently corroborated; both largely orthogonal to UCT's US-equities-and-options desk | 🟡 C | [**L09 §4–5**] |
| **Vendors** | Overwhelmingly Bloomberg's own (news, BEst, BI, fundamentals); 1,000+ news providers named only in aggregate; **one practitioner account names Visible Alpha, not Bloomberg, for line-item consensus** — recorded, not smoothed; a 2025 vetted reviewer routes statement work to AlphaSense and Visible Alpha | 🟡 R | [L04 §9; L08 §4] |
| **Quality caveats (independent)** | Experts trust *inputs* and override *outputs* (`WACC`, `DDM`, beta); an unfixed LIBOR-interpolation bug in `ASW` persisted ~until 2010 while "traders would take ASW as gospel"; FA "lacks Non-GAAP adjustments" (2025 review); blank FA cells carry no explanation | 🟢 that these are said | [L05 §11, §3; L08 §4] |

---

## G — Customization (layouts, tables, watchlists, preferences, templates, multi-monitor)

* **Layouts.** Views → Pages → components; named, saved, renamed, opened from the View Manager or **typed** (`BLP AGAIN "VIEW NAME"`); most-recent views on the toolbar; Sample Views by asset class as the first-run experience (not a demo — a live view you take apart); views and pages shareable to other users (as message attachments in the older edition; via IB per marketing) [L02 §2, §7 V].
* **Components.** Browser opens on the 25 most popular, starred by "users and Bloomberg specialists", with a live preview; Custom Function Window folds several functions into bottom tabs "to reduce the number of components on the screen"; Chart Grid from a monitor; BQuant apps as components (2025) [L02 §3 V/C]. `LLP` promotes "almost any function" into a component, so the widget set is a by-product of the function set, not a hand-curated registry [L02 §1 V].
* **Tables.** Monitor columns: 30 of 280,000 items, field-dictionary search, rename, reorder; `W` worksheet columns added by clicking headers, "Edit Column parameters" for history; `EQS` results `92) Fields` + Custom tab "Add column"; `RV` Custom sheet via a Fields browser [L02 §4, §10; L06 §1; L05 §6].
* **Watchlists.** Copy-from-source vs Link-to-source at import; Add Members; drag from Excel; colour-coding per row; price alerts per row; News Heat; `MNRS` ten-deep restore [L02 §4, §6].
* **Preferences.** `PDFB` Launchpad defaults (startup view, auto-open, **per-computer resolution**, `BBDP`/`BIO` page); `PDFU` key-behaviour revert; `NZPD` news defaults (default `TOP` category, sources, language, keyword colouring of headlines); `TDEF` chart defaults (U); `FA` frequency preference; `MSG9` greeting/copy/notifications/spam; Terminal Settings via `<Alt>+D` (Tabbed Windows toggle) [L02 §6; L01 §7, §9; L03 §6; L05 §3; L07 §1].
* **Templates.** `XLTP` library (400+ *reported*), `XLTP XFA`, `XLTP XDCF`, `XLTP BQL`; `G` chart library where a titled chart becomes `G##` — a **template-vs-pinned** distinction the leaves infer (`G` is not marked single-security on Bloomberg's own trader sheet) but could not verify [L05 §9; L06 §4].
* **Multi-monitor.** Only half-answered: per-computer resolution and `Show on Selected Pages` vs `Duplicate to Page` are verified; how a View spans displays, whether pages map to monitors, whether the toolbar is per-display: NOT DETERMINED [L02 GAPS 4].
* **What survives a session.** Window count/positions/zoom; the last Launchpad view; saved searches as `NI` codes; `NOTE` bound to the account, "from any Bloomberg Terminal" [L01 §1; L02 §6; L03 §4; L07 §3]. What does not: a closed tab or window [L01 §9].

---

## H — Search / commands (navigation efficiency, ticker resolution, palettes, shortcuts)

* **Ticker resolution.** Autocomplete on partial identifiers with a yellow key as a type filter (`DIS 7 <Corp>`); CUSIP/ISIN/BBGID accepted; venue code in the ticker (`VOD LN`, Wikipedia-sourced); `SECF` instrument lookup and `//blp/apiflds` / `FLDS` field discovery on the API side [L01 §2–3; L07 §7]. Ranking of a mixed function/security/search list: NOT DETERMINED [L01 §2 OQ].
* **The palette is the command line.** There is no separate palette; the box is the product surface (see C.2). Escalation type → list → `SEARCH` → `HL` [L01 §2].
* **News is a query language.** `N <entity> IN <source> <time>`, `AND`/`OR`/`BUT NOT`, quotes for literal keywords vs bare for *tags* (the default favours tags, and Bloomberg documents where that default fails), `IN HEADLINES`, `N/5` proximity, `HOUS*` wildcard, date ranges, `IN CHINESE`, `ON BTV`, `WITH CHARTS`; topic × source with source always second (`NI ECO BN`); `TNI` intersections; the Advanced Editor shows **stories per hour** before you save [L03 §2–3, §6 V].
* **Saved objects are commands.** `G53`, `BLP AGAIN "EARNINGS DESK"`, `NI BUFFBALL`, `=BEQS("My Screen")`, `FA CF`, `TOP OIL`, `MNI OIL 1W` [L06 §4; L02 §2; L03 §4, §7; L07 §5; L05 §3].
* **Keyboard coverage.** `Number <GO>` on list rows; Alt-Mode for the rest; `<Alt>+K` keyboard map; `<Alt>+D` settings; `<Ctrl>+N` window; `<PANEL>`; `<CMND HISTORY>`; `LAST <GO>`; `<HELP>` ×1/×2; standard keyboards supported [L01 §7–8 V].
* **Efficiency claims.** "Speed is only limited by how fast you can physically push the buttons" (practitioner); "the advantage was in typing a command and most of its arguments quickly" (two-decade user) [L08 §2 R]. No keystroke or latency measurement exists in any source [L01 §7 OQ; L08 §2].
* **What the leaves flag as the risk of copying this:** density without the grammar yields "a cluttered screen with none of the speed" [L01 §11]; a grammar that changes every quarter "is the worst of both worlds" [L08 §2].

---

## I — AI (current intelligent features, grounding/citation behaviour, marketing vs shipped)

**OBSERVATION.** Bloomberg's 2024–2026 AI layer sits *on top of* the classified corpus and the loaded-security context rather than beside them. Inventory, with evidence class:

| Feature | What Bloomberg says it does | Class | Leaf |
|---|---|---|---|
| **AI-Powered Earnings Call Summaries** (press release 2024-01-22) | Summary points enriched with links out to `MODL`/`BDVD`/`SPLC`; **clicking a point jumps to the corresponding transcript excerpt**; topics enumerated (guidance, capital allocation, hiring, macro, products, supply chain, demand); BI analysts trained the models; a vendor-selected customer testimonial | **Verified** (specific, falsifiable press text) | [L04 §8] |
| **`DS` Document Search** | NLP synonyms, AI topic overviews and topic-trend analytics across 200M documents; findings captured to `DS NOTE`, shared to IB Forums; 2025-06 "document search and analysis" release adds natural-language querying across transcripts, sell-side research and news and connects the user to the report's analyst over IB | **Verified** (case study) / **reported** (2025 trade press) | [L04 §8; L03 §11] |
| **Suggested Functions** (Tabbed-Windows panel region) | "intelligent function recommendations based on the asset class of your loaded security and your current workflow, with brief hints … without interrupting your current workflow"; rule-based vs learned: NOT DETERMINED | **Verified** description / 🔴 mechanism | [L01 §5] |
| **ASKB** | Conversational/agentic interface, **beta**; "grounds every response in high-quality, trusted data and includes transparent attribution to original research documents and news sources"; ASKB Workflows for multi-step tasks (earnings preparation, post-event analysis, meeting prep); extended to mobile in 2026 with mid-thread desktop↔phone continuity; positioned as complementing "existing Terminal workflows" | **Claimed** (product page) + **reported** (MarketsMedia 2026-02-23; App Store listing) | [L03 §11; L08 §8; L07 §10] |
| **AI News Summaries** | "AI-powered summaries on stories from more than 30,000 sources", synthesising volume into themes per company | **Claimed** | [L03 §11] |
| **Automated Intelligence on Demand** | "instant summaries on the status and drivers of securities, indices, currencies and other instruments" — an auto-generated "why is it moving" | **Claimed** | [L03 §8] |
| **BQuant desktop applications in Launchpad** (2025-08-19) | Firm-authored analytical apps run as Launchpad components | **Claimed** (episode summary only) | [L02 §3] |
| **Chart share/co-edit "with your communities in real time"**, custom visual studies | Product-page claims, no mechanism seen | **Claimed** | [L06 §4] |
| **Guidance adjustment (`GUID`)** | Bloomberg's own bias-adjusted guidance series with confidence intervals, shipped beside the raw | **Reported** (single source) | [L04 §5] |
| **Relevancy scores on news tags** (EDF ©2015) | Tags "tied to relevancy indicators"; a story can be strongly about one ticker and weakly about another | **Verified but dated** | [L03 §7] |

**Demonstrated: none.** No leaf viewed a video or transcript; every "demonstrated" label in the leaves refers to screenshot-driven university tutorials, none of which covers an AI surface.

**EVIDENCE.** PR Newswire copy of the 2024-01-22 press release (P23); *Research on the Terminal* case study (P22); *AI on Bloomberg* product page (P18); MarketsMedia 2026-02-23 (S38); The DESK 2025-06-16 (S39); [S2] Help Page export 2022 (P2) for Suggested Functions; Apple listing (P55). All fetched 2026-09-02; `bloomberg.com/company/press/*` itself returned 403 to every leaf.

**INTERPRETATION.** Three things the leaves converged on. (1) **The generative layer is a renderer, not a second authority** — it consumes the same tag spine and loaded-security context as `MYN`, Launchpad and the alert; it inherits the filtering rather than replacing it [L03 §11]. (2) **Attribution is the headline feature, not fluency** — Bloomberg leads with grounding and citation, and the one AI feature verified in detail (call summaries) is built as an *index over the source*: every point is a link back into the transcript span and out to the quantitative screen it implies, so a wrong point is checkable in one click [L04 §8]. (3) **The incumbent's constraint is visible in the positioning** — ASKB "complements your existing Terminal workflows"; Bloomberg cannot ask its users to change how they work [L08 §8]. What is *not* known: whether ASKB cites the specific story or only the source, and whether a generated claim click-throughs to the supporting paragraph [L03 §11 OQ]; whether Suggested Functions is a lookup table or learned from sequences [L01 §5 OQ]; how a live-transcript summary is reconciled with the final transcript [L04 §8 OQ].

**RELEVANCE TO UCT.** The leaves note (CLAIM, from `CLAUDE.md`/memory) that UCT's COT narrative rail already fails closed on a grounding gate (every number in the prose must appear in the facts; `cotFacts.js` is "the ONLY numbers the LLM may cite"), that the call recap in `EarningsResearchModal` is Opus+Perplexity with no per-bullet span anchor, and that Compass/`grade_ticker` returns `basis`/`sources`/`hard_flags` beside a verdict [L03 §11; L04 §8; L05 §11]. Bloomberg's evidence bears on the *link discipline*, not the model: the market's largest vendor is marketing provenance, not eloquence.

**CONFIDENCE.** 🟡 overall. 🟢 for the call-summary mechanics and `DS` (Bloomberg-authored, specific); 🟡 for ASKB and AI News Summaries (product pages + trade press, beta); 🔴 for anything about quality, adoption or the internals of Suggested Functions. **Ceiling:** no hands-on use, no demo transcript; ASKB is in beta so today's behaviour may differ from both the page and the press.

**RECOMMENDATION (hypothesis).** *An AI layer earns trust as one more consumer of one filter expression, with every generated bullet anchored to the span it came from.* Test on the earnings call recap first: store spans at generation time, render points as jump links, and measure whether members open the transcript less (trust) or more (verification) — either is informative. Anti-pattern: a summary that reads as authoritative and cannot be traced to a sentence [L04 §8].

**OPEN QUESTION.** When ASKB's grounding fails (a question the corpus cannot answer), does it refuse, hedge, or answer anyway? Nothing public says, and it is the only behaviour that matters for a desk that will act on the answer.

---

## J — UX (strengths, weaknesses, density, onboarding, anti-patterns)

**J.1 Strengths the leaves could verify.**

* **One grammar, one input surface** — `TICKER <SECTOR> FUNCTION <GO>`; a mnemonic, a keyword, a partial security and an English sentence all go in the same box; typing is searching, `<GO>` commits; novice and expert use the same path [L01 §2–3, 🟢].
* **Explicit, labelled, per-panel context** with two recents drop-downs (securities · functions) [L01 §4, 🟢].
* **Total keyboard coverage** — `Number <GO>` on every list row, Alt-Mode for the rest; standard keyboards supported [L01 §7, 🟢].
* **Colour as a type system** — red stop · green action · yellow sector · amber = the only editable things on screen · white outline = clickable [L01 §7, 🟢].
* **Help as a modifier on your position** — one press: the function's guide including its **calculations**; two presses: a human, 24/7 [L01 §6, 🟢].
* **Menus, tabs and history are views over the grammar** — menu leaves are mnemonics; tab labels are mnemonics; `<MENU>` zooms out while `<End/Back>` retraces [L01 §5, §8–9, 🟢].
* **Page where the question is canonical, workspace where the composition is personal, `LLP` to cross** [L02 §1, §8, 🟢].
* **Curated-first with an escape hatch** — `TOP` with "All Stories" one click away; the vendor publishes its own noise-code list; stories-per-hour shown before a filter is saved [L03 §1, §6, 🟢].
* **Recovery affordances** — `MNRS` ten-deep monitor restore; `PDFU` key-behaviour revert; Sample Views by asset class as the first-run canvas [L02 §6–7; L01 §7, 🟢].
* **Stability as an invariant** — a former Bloomberg UX designer: UI bugs users had grown accustomed to were **re-implemented** rather than fixed; "I've never worked anywhere quite so committed to backward UI compatibility" [L08 §2, 🟢 first-hand].

**J.2 Weaknesses the leaves could verify or that practitioners state.**

* **Steep learning curve, conceded in-house** — "that came at the expense of a steep learning curve" (insider); Bloomberg ships an 8-hour course, per-persona cheat sheets, a resource centre and a trainer-booking function for a product it calls "entirely discoverable" (R21) [L08 §2; L01 §10].
* **Dated surface** — "a melange of ancient Fortran tabbed forms with never-to-be-fixed bugs and newer consistent TUI. By 2010 they had started to pile on mouse menus" (two-decade user); redesign requests recur across a decade of threads [L08 §2, §7].
* **Three coexisting display models** (four panels · up to 16 tabs · Launchpad) — "the honest cost of forty years of not breaking anyone's habits" [L01 §9; R8].
* **Mnemonic sprawl and namespace collisions** — fifteen doors to one topic (earnings); `EA` means a season screen in one Bloomberg card and a single-security screen in a university guide (R11); `OWN`/`HDS` unresolved (R10); "a four-letter namespace collides invisibly" [L04 §0, §11–12; L05 §7].
* **A seven-surface charting curriculum** — `GP` → `GPC`/`GPO` → `G` → `G##`, plus `TECH`, `TDEF`, `W`, `GRAB` before a chart is yours [L06 §4].
* **Blank cells with no explanation** in `FA` (CBS); `FA` "lacks Non-GAAP adjustments" and `MODL` "has lots of room for improvement" (2025 vetted review); BQL "very confusing, has no effective learning materials" and no changelog (practitioner) [L05 §3; L08 §4; L06 §3].
* **Export lives in a different menu on different screens** ("under OPTIONS not export"); "Not all screens can be saved" [L07 §4].
* **Unrecoverable closes** — "You cannot restore a tab after you close it," beside a window layout that is fully restored [L01 §1, §9].
* **A hard cap with no gauge** — download limits per terminal, unpublished, unresettable, discovered by a broken cell [L07 §6].
* **Deliberate export friction** — "They do a lot of work to block you from extracting bulk data … lock you into their ecosystem" (practitioner) [L08 §5, §7].

**J.3 Density.** Two idioms coexist on purpose: "many functions (applications) are absolutely TUIs whereas Launchpad is more mouse-driven" (insider) [L08 §6]. The Terminal is "guaranteed to own a lot of screen real estate" [L08 §1]. Density levers are explicit: 30 columns of 280,000 items and 2,000 rows per monitor; the Custom Function Window folds functions into tabs "to reduce the number of components on the screen"; the classic four panels are a constraint that *produces* a layout, the 16-tab model trades that discipline for flexibility and Launchpad absorbs the arrangement problem [L02 §3–4; L01 §9]. Practitioner framing: speed "is only limited by how fast you can physically push the buttons" — a property of a frozen grammar, not of pixels [L08 §2].

**J.4 Onboarding.** `BMC` (8-hour, 70+ functions, four modules); `BESS`/`BCER` certificates ("over 70 functions", "over 100 interactive questions"); `BPS`/`BU` resource centre with **cheat sheets by security type and persona** (the "Equity — Trader" and "Equity Analyst" one-pagers, each a curated ~90 of the catalogue); `FFM` "Functions for the Market" — discovery pegged to *today's* move; `TRAI` books a specialist; `BNEW` shows what is new "relevant to your market focus"; `USER` lists 150+ student functions; Sample Views on first `BLP` [L01 §10; L08 §7; L06 §6; L05 §1; L02 §7]. The lesson the leaves drew: **discoverable ≠ learnable**; everything is reachable from the box, knowing what to type is the cost, and Bloomberg pays it with training rather than by moving controls (R21). Time-to-competence: NOT DETERMINED — no source measures it [L01 §10 OQ].

**J.5 Anti-patterns.** Carried into N (Part LXIII). The one worth stating here because it is *structural* rather than a feature: **difficulty treated as a retention asset** — a 2026 essay frames the curve as "paradoxically an asset for existing users" by raising exit cost; UCT is not the incumbent and has no counterparty lock to absorb that cost [L08 §7].

**CONFIDENCE.** 🟢 for the documented mechanics in J.1 and for the *stated* complaints in J.2 (consistent 2013–2026, one insider); 🟡 for density and onboarding as experienced; 🔴 for anything about how the 2026 UI actually looks (no screenshot, no seat) or how long competence takes. **Ceiling:** a seat or a recorded walkthrough; a practitioner interview for the curve.

**RECOMMENDATION (hypothesis).** *Expert speed with novice discoverability, not expert speed purchased with novice pain* — keep the stable grammar of J.1, make every command discoverable from within the surface, and treat a moved gesture as a breaking change [L08 §7, §2]. The cheapest onboarding idea in the corpus is `FFM`, not `BMC`: one sentence on today's move naming the surface that explains it, riding content UCT already ships daily [L01 §10].

**OPEN QUESTION.** What fraction of Bloomberg actions are keyboard versus mouse in practice? Every source describes capability; none measures use. If real usage is mouse-dominant, the transferable lesson shrinks considerably [L01 §7 OQ].

---

## K — Performance (observed responsiveness and density claims — all *reported* or *claimed*)

**No leaf measured anything, and no source in the corpus publishes a latency, keystroke or session metric.** Everything below is a statement someone made, labelled by who and when.

| Claim | Who / when | Class | Leaf |
|---|---|---|---|
| "your speed is only limited by how fast you can physically push the buttons" | practitioner, HN 2025-11 | reported | [L08 §2] |
| "The advantage was in typing a command and most of its arguments quickly" | two-decade user, HN 2025-11 | reported | [L08 §2] |
| "the most stable piece of software I've ever seen… Not once… has it crashed in those 10+ years"; a second user since 2005 concurs — answering one complaint that it is "extremely slow… and constantly crashes" | HN 2019-12 | reported (2 vs 1) | [L02 §9] |
| Help desk: "a technical specialist… in under 30 seconds… a developer in 30 minutes" | chollida1, HN 2015 (API-verified attribution, R19) | reported | [L08 §4] |
| `MODL` captures reported data "within seconds" / diff "within minutes of a company's earnings release" | Bloomberg, official pages | claimed | [L04 §3] |
| Real-time events product: "targets sub-second schematized delivery"; 7,381 reports Oct–Dec 2023; Apple moved ~2.5% within 30 s, most within ~2 s; analyst oversight in the loop | Bloomberg, official page | claimed (the word "targets" is load-bearing) | [L04 §4] |
| EDF textual news "designed to help firms act on news within milliseconds" — **enterprise black-box product only**; the Terminal is sold on breadth/classification/routing, not speed (R14) | Bloomberg fact sheet ©2015 | verified, dated | [L03 §10] |
| Excel `BDP` streams at a default 300 ms tick (min 300, steps of 100); 3,500 concurrent real-time subscriptions per terminal | Bloomberg Excel guide; Penn | verified / reported | [L07 §5–6] |
| BQL: broad universes ("equitiesuniv") **time out**; oversized responses fail with "Response for px_last is too large. Apply filter() / group()" | practitioner blog | reported, first-hand error text | [L06 §3] |
| `EQS` backtest is a **queued job** that e-mails you when finished — the screen is not held by its heaviest feature | Bloomberg FFM 2013 | verified as of 2013 | [L06 §2] |
| Terminal Connect saves "10 to 30 minutes per day" per user | Bloomberg fact sheet ©2018 | claimed | [L07 §9] |
| ">99.99% correct, guaranteed by SLA" | summarised HN page, attribution unverified | ⚠️ unverified — do not propagate | [L08 §4, GAPS 7] |
| Density: 30 columns of 280,000 items, 2,000 securities per monitor (up from 14 of 6,500); up to 16 screens; 25 window components at the 2002 Launchpad launch | Bloomberg guides ©2012/15; Global Custodian 2002 | verified / reported | [L02 §4; L01 §9; L02 src 20] |

**INTERPRETATION.** The Terminal's "speed" is three different things the corpus keeps conflating: (a) *human* speed from a frozen keyboard grammar (the only one practitioners actually praise); (b) *data* speed on the earnings-capture path, which Bloomberg numbers and hedges with "targets"; (c) *feed* latency, which attaches to enterprise products, not the Terminal [L08 §2; L04 §4; L03 §10]. The design tell is (b)'s analyst-in-the-loop and the asynchronous backtest: Bloomberg does not pretend the heaviest work is instant; it names the job and delivers out of band.

**RELEVANCE TO UCT.** The desk is discretionary swing/options, so (a) is the relevant axis and (c) is not [L03 §10]. UCT's own performance work (single-process web pod, cache tiers, mount queues — CLAIM) is about *not* fanning out per user; Bloomberg's server-side BQL and queued backtest are the same posture at scale [L06 §2–3; L07 §5].

**CONFIDENCE.** 🔴 on every number; 🟢 that these are the claims made and by whom. **Ceiling:** Bloomberg publishes no telemetry; a timed practitioner walkthrough is the only thing that would produce a measurement.

**RECOMMENDATION (hypothesis).** *State the clock every surface is on* — a visible as-of stamp is cheaper than latency and buys most of the trust [L04 §4]; and *name-it-queue-it-notify-me* for any member-initiated heavy run [L06 §2].

**OPEN QUESTION.** What is Bloomberg's Terminal-side delivery target for a breaking First Word item — is it published anywhere? [L03 §10 OQ]

---

## L — Pricing / business model

**L.1 Price: no verified figure exists (R20).** Bloomberg publishes no price. Reported figures, with dates, in the order the leaves found them:

| Figure | Source | Date of claim | Class |
|---|---|---|---|
| "$1500/month" | Reddit r/finance thread title | 2013-05 | reported |
| $21,000 per terminal | The Terminalist (Substack) | 2016 figure, cited 2024-09 | reported |
| ~$24,000–$27,000 per user per year | Wikipedia citing Investopedia | 2022 | reported |
| "starts at $30,000 per user per year" | Wikipedia | 2023 price hike | reported |
| "bumped up our prices from $25k to $36k annually" | practitioner, HN | 2025-11 | reported |
| $31,980 per seat per year | practitioner essay | 2026-04 | reported |

Terminals are "leased in two-year cycles"; Terminal sales are "more than 85 percent of Bloomberg L.P.'s annual revenue" (Wikipedia, sourced) [L08 §7; L01 src 17]. **Report a range with dates; never a number.**

**L.2 The unit is a person on one device.** The published **trial** licence (the commercial agreement is not public): "for the User's individual use only and on one Receiving Device"; with a secure identification device the user may use multiple devices "but never on more than one device at a time"; the recipient "shall not permit the Services to be shared, switched or replicated between two or more persons" [L07 §8 V-trial]. Identity is biometric (B-Unit fob or app; Bloomberg Anywhere converts a seat via `BA <GO>`) [L01 §1; L07 §10]. Sanctioned hand-over inside a firm exists and is logged: `LOGU`/`LOGR` [L07 §8]. Bloomberg Anywhere is the flavour that follows the person to any internet-enabled desktop and to the mobile app [L02 §6 C; L07 §10].

**L.3 What is in the seat and what is an add-on.** Inside the seat: the Terminal, IB, Launchpad, `W`, the Excel add-in and the **Desktop API** (Windows only, entitlement = the live session) — but metered at egress by per-terminal download limits that are unpublished, unresettable and have no gauge [L07 §5–7]. Separate products: **Server API** (firm server, still session-bound), **B-PIPE** (firm-accountable via EMRS; the only tier allowed to feed non-display/black-box systems; "35 million instruments"), **Data License** (bulk/enterprise; REST/SFTP/cloud), **COFI** point-in-time company financials/estimates/pricing, **EDF** event-driven textual news for black boxes, and the **App Portal** third-party store with its own billing [L07 §7, §9; L04 §6; L03 §10]. Same programming interface across the API tiers; what changes is who is accountable for entitlements [L07 §7].

**L.4 What the licence forbids (trial wording).** §4(a): no re-routing to another device; never "inputs into any non-user-based, non-display application"; §4(c): Desktop-API data stays on "the Designated Authorized Computer"; §4(e): no use to "improve the quality of data sold or contributed" by the recipient, no "automated data validation or verification", nothing that could displace a third party's subscription; §10: Bloomberg "may monitor… including remotely" and audit on premises [L07 §8]. The commercial logic the leaf drew: the prohibition is about not letting a customer become a competitor or a supplier to one; the API tiering is the pressure valve [L07 §8].

**L.5 Professional vs non-professional.** No non-professional tier, no reduced retail product, no delayed-data tier was found in any leaf; the closest thing to a reduced seat is the university terminal, whose per-terminal download quota one student can exhaust for a department [L08 §7; L07 §6, §8]. Subscriber counts are marketing (~315k 2013 · 325k 2015/2022 · "more than 350,000" 2024–2026), not audited (R15).

**INTERPRETATION.** Three of the business model's load-bearing parts are *absences*: no public price, no published limit, no published consensus recipe — "two of the moats are absences" (A). The seat is priced per person because the person is what the network needs; the data is leashed to the machine because the data is what a competitor would need.

**RELEVANCE TO UCT.** Inverted on nearly every axis: UCT's members' data can leave; there is no per-datapoint meter; the desk lives half in Excel/Python (CLAIM). The transferable pieces are the *stated* seat policy (`LOGU`/`LOGR` — sanction and log the workaround) and the warning that a cap without a meter becomes a mystery outage [L07 §6, §8].

**CONFIDENCE.** 🔴 price; 🟢 the trial-licence wording; 🟡 that the commercial agreement says the same (two independent signals point that way: Penn's one-line restatement and the mechanical enforcement); 🟡 tier structure (2016 developer guide + marketing pages). **Ceiling:** the commercial subscription agreement and Bloomberg's "Desktop API Guidelines" — a firm with a seat could supply both; no web source will.

**RECOMMENDATION (hypothesis).** *Any export restriction UCT inherits from a vendor should be surfaced as a stated policy, not discovered as a failed export* [L07 §8]; and *the freedom to leave the platform is a differentiator worth stating explicitly, not just a default* [L05 §9].

**OPEN QUESTION.** Does the commercial agreement retain the §4(a) ban on non-display use of Desktop-API data? If so, every desktop `blpapi` quant is technically outside terms — worth knowing before citing Bloomberg as a model for anything [L07 §8 OQ].


---

## M — Best ideas for UCT (Part LXIII, hypotheses)

Each row is a hypothesis tied to a named UCT workflow or persona, citing the leaf evidence it rests on. None asserts "UCT should build X because Bloomberg has it" — each names the UCT-side gap the Bloomberg mechanism illuminates, per RULES §3.

| # | Idea (Bloomberg mechanism) | UCT workflow / persona it targets | Evidence | Confidence |
|---|---|---|---|---|
| M1 | **One typed address grammar** (`<symbol> <surface> <modifier>`), with menus as a *view over* the same addresses, never a second authority | Desk operator moving between `/charts`, `/screener`, `/journal`; new member discovering surfaces | Grammar composes across five asset classes with no new rules; menus resolve to mnemonics; `<MENU>` teaches the fast path [L01 §2–5] | 🟢 mechanism, 🟡 whether it transfers to a browser member population [L01 §11] |
| M2 | **Identify the instrument once per context, then change only the lens** — per-panel/per-group loaded security with a labelled recents field, not a colour dot alone | `/charts` colour-group desk operator; the cold-start research loop (Workflow C) | "Loaded security remains active until changed"; two recents drop-downs (securities · functions) [L01 §4]; the whole cold-start loop is fast *because* the security is never re-entered [L05 §10] | 🟢 |
| M3 | **Saved things become names** — a chart becomes `G53`, a saved search becomes `NI BUFFBALL`, a Launchpad view becomes `BLP AGAIN "NAME"`, a saved screen becomes `=BEQS("name")` | Any UCT surface that produces a set of symbols or a layout (scanner, catalyst rows, buzz results, `/charts` grids) — give the saved artefact a short, typeable identity | Five independent leaves converged on this pattern without seeing each other's files (see A's "Three convergences") [L02 §2; L03 §4; L06 §4; L07 topic 5] | 🟢 that the pattern is real and repeated; 🟡 that it transfers cheaply to a web app |
| M4 | **Promotion path: search → named object → alert, suspend not delete** | UCT's currently-separate `watchlist_alerts`, saved screens (`SavedScreensPanel`), and `scan_evaluator` — no shared promotion path today | `Actions > Save Search > Save` → becomes an `NI` code → `Actions > Set Alert Delivery` → `NLRT` to suspend/activate without destroying the definition [L03 §4] | 🟢 mechanism; 🟡 current UI labels |
| M5 | **A cap without a meter is a mystery outage; never ship a hard cap without a visible remaining-budget reading** | UCT's own LLM daily caps (`CATALYST_COST_CAP_DAILY`, `COT_NARRATIVE_DAILY_CAP`, brain-engine `$5/day`), voice minute caps, provider quotas (AlphaVantage 25/day) | Bloomberg's download limits are per-terminal, unpublished, unresettable, and fail as `#N/A Limit` with no gauge — "the user finds out by failing" [L07 topic 6] | 🟢 — this is the corpus's strongest, most-corroborated anti-pattern-as-lesson |
| M6 | **Sanction and log the workaround rather than prohibit it** (`LOGU`/`LOGR`) | Any future UCT seat-sharing or credential-hand-over scenario (paid member seat, desk account) | Bloomberg cannot technically prevent sharing, so it built a logged, sanctioned hand-over mechanism instead of relying on a rule nobody can enforce [L07 topic 8] | 🟡 — one official function guide, no usage evidence |
| M7 | **Every derived number should carry a click-through to the artifact it was derived from** (Data Transparency: green = composite, blue = source document) | UCT's earnings table, breadth counts, exposure score, `grade_ticker` verdict — anywhere a computed number is displayed without a path to its inputs | Verified in the Excel add-in with colour-coded drill-down [L07 topic 5]; reported on the Terminal itself (double-click into a filing PDF) [L08 §5]; UCT's own `cotFacts.js`/COT grounding gate is the stronger version already, because it fails closed [L03 §11] | 🟡 — the Terminal-side mechanism is reported, not verified; the Excel mechanism is 🟢 |
| M8 | **Show the estimate count and name the contributor beside any consensus figure** (`# Ests`, named analyst + firm) | TERMINAL-CURRENT's `/api/earnings/intel/{sym}` analyst consensus, currently unattributed | `BEst EPS # Ests`; `ANR` names firm and analyst per rating [L04 §5] | 🟢 — near-free provenance upgrade |
| M9 | **Anchor every AI-generated bullet to the source span it came from, as a jump link** | UCT's earnings call recap (`call_recap.py`, Opus + Perplexity) and any future Compass-generated summary | Bloomberg's AI earnings-call summary points jump to the exact transcript excerpt and link out to `MODL`/`BDVD`/`SPLC`; the summary is an index over the source, never a substitute [L04 §8; L03 §11] | 🟢 mechanics (Bloomberg's own falsifiable press release); this is flagged as the single strongest transferable idea across two leaves |
| M10 | **A volume/frequency forecast at authoring time** ("this would have fired N times last week"), not only a post-hoc coverage receipt | Any UCT surface where a user authors a standing filter — saved screens, scan definitions, watchlist alerts, `/buzz` gates | Bloomberg's Advanced Editor shows stories-per-hour *while the search is being built*, converting a tuning judgement into a number [L03 §6] | 🟢 mechanism; 🟡 whether it's a live backtest or a rate estimate |
| M11 | **Contribution decomposition, not just a sorted movers list** (`MOV`: "which names are driving the index") | UCT's `MoversSidebar` (a single gap threshold) and breadth/theme surfaces, which already hold the inputs (sector flow, 2,029 theme holdings) | `MOV` answers "what is dragging the index" — a rotation-thesis question a sorted-change list cannot answer [L06 §5] | 🟢 that the function exists and does this; 🟡 on UI mechanics |
| M12 | **Ask the user once, at list-creation time, whether a list is a snapshot or a subscription** (Copy-from-source vs Link-to-source) | UCT's watchlists, scanner→list, and screener→list points, which currently have no such distinction (only tag auto-lists track by construction) | Bloomberg makes this an explicit, unavoidable choice at import; a guessed default is "wrong half the time and the wrongness is silent" [L02 §4] | 🟢 — a one-field change with an outsized correctness payoff, per the leaf's own framing |
| M13 | **Version-history the user's own curation before adding more places to curate** (`MNRS`, ten-deep monitor restore) | UCT watchlists, saved screens, workspace layouts, notebook notes — none has version history today, and the notebook migration already broke a member's first upload | Bloomberg built ten-deep undo for exactly one object (the monitor) because users destroy their own lists often enough to warrant it [L02 §6] | 🟢 mechanism; 🔴 on real-world loss frequency (inferred, not measured) |
| M14 | **A published, per-persona, opinionated function map (~10% of the surface), reachable by a mnemonic** (`BU`/`BPS`, the "Equity — Trader" cheat sheet) | UCT's own sprawl — 17 nav tabs, Breadth's 5 sub-tabs, the widget registry, Compass's 10 coaching surfaces — has no "if you are a swing trader at this desk, here are the twelve places you live" artefact | Bloomberg ships a curated one-pager per persona, not a generated menu; discovery is editorial [L06 §6; L01 §10] | 🟡 — inference from a sheet, not observed use |
| M15 | **Teach the tool through today's tape** (`FFM` — Functions for the Market: worked examples pegged to *today's* move, not a static tutorial) | UCT's Morning Wire, Desk sessions, and evening update already produce "here is what happened today" content daily; add one sentence naming the surface that shows it | The cheapest onboarding idea in the whole corpus — no new infrastructure needed, rides content UCT already ships [L01 §10] | 🟡 — single secondary source on `FFM`'s actual behaviour |
| M16 | **Never show a surprise without a comparison** — historical base rate, peer set, or theme, beside the number (`KPIC`, `RV`'s top-line peer average) | UCT's earnings modal (EPS/revenue surprise shown alone) and the 4Q beat-history overlay it already computes | Bloomberg's marquee earnings example is a bank's loan-loss provision *contextualised against peers*, not a bare EPS beat [L04 §3, §10] | 🟡 — UCT already holds the ingredients for the weak version |
| M17 | **Ship starter boards as ordinary, editable artefacts, segmented by what the member trades** (Sample Views by asset class — a live view you take apart, not a read-only demo) | `/charts` first-run experience for a new member, currently a blank canvas | Mirrors UCT's own starter-scan posture (`starter_library.py` — "the firm's setups ship as ordinary definitions, editable on arrival") applied to boards instead of screens [L02 §7] | 🟢 — the analogous pattern already exists and works in UCT's own codebase |
| M18 | **Total keyboard coverage on dense list surfaces** (`Number <GO>` — every list row gets a keyboard address; Alt-Mode for the rest) | UCT's screener rows, watchlist rows, catalyst rows, scan results — currently mouse-addressed except Watchlists' arrow-key navigation | Total keyboard coverage is a stated design goal, not a fallback, and is what makes muscle memory real [L01 §7] | 🟡 — capability is well-evidenced; real-world keyboard-vs-mouse split is unmeasured everywhere in the corpus |

---

## N — Bad ideas / anti-patterns for UCT (Part LXIII)

Stated as things to avoid, each grounded in leaf evidence and phrased as a hypothesis about failure, not as a fact about Bloomberg's malice.

| # | Anti-pattern | Why it would hurt UCT specifically | Evidence |
|---|---|---|---|
| N1 | **Difficulty-as-moat** — treating a steep learning curve as a retention asset because it raises exit cost | UCT is not the incumbent and has no counterparty lock to absorb the cost; difficulty here is pure churn | A 2026 essay frames Bloomberg's curve as "paradoxically an asset for existing users" [L08 §7, §9]; Bloomberg's own insider concedes the curve is real and pays for it with training, not by moving controls (R21) |
| N2 | **A trusted surface with an untraceable number** — a screen that *looks* authoritative and cannot be traced to a source | UCT ships computed verdicts (`grade_ticker`, sizing, the exposure score) that are exactly this risk if their inputs aren't inspectable in place | The `ASW` LIBOR-interpolation bug persisted ~until 2010 while "traders would take ASW as gospel" [L08 §5; L05 §11] |
| N3 | **Deliberate export/egress friction** to lock users into the ecosystem | UCT's members' data is theirs and can leave; friction here is hostile to the owner's own desk, which already lives half in Excel/Python | "They do a lot of work to block you from extracting bulk data… lock you into their ecosystem" [L07 topic 4, topic 6, topic 8; L08 §5] |
| N4 | **Cloning the network without the network** — building an IB-shaped chat widget that only the desk is on | Reproduces the *form* of Bloomberg's moat with none of its substance; the most experienced voice in the corpus explicitly ranks data centralisation as easier to replicate than the network effect | HoyaSaxa: data is "much easier to replicate than the network effects" [L08 §1] |
| N5 | **Breadth/mnemonic sprawl as an end in itself** — fifteen doors to one topic (earnings), a seven-surface charting curriculum (`GP`→`GPC`/`GPO`→`G`→`G##`, plus `TECH`/`TDEF`/`W`/`GRAB`) | Affordable at Bloomberg's price point and training budget (`BMC`, university guides); not affordable for a small desk plus retail-plus members | [L04 §0, §11–12; L06 §4, §12] |
| N6 | **Four-letter (or short-mnemonic) namespace collisions left unresolved** — `EA` means two different things in two Bloomberg-authored sources; `OWN`/`HDS` drift unresolved for over a decade | Whatever TERMINAL-NEXT's addressing scheme is, it must be able to answer "did I load the thing I meant" | R11, R10; "a four-letter namespace collides invisibly" [L04 §11; L05 §7] |
| N7 | **Feature-count parity as a competitive goal** | Every well-funded Bloomberg challenger (Eikon, Symphony) matched data and lost anyway; the network, not the feature list, was the moat | [L08 §8] |
| N8 | **Redesign that silently moves a shipped gesture** | UCT has already shipped a latent key conflict by changing a control's axis (calendar modal) | Bloomberg re-implemented UI *bugs* rather than move a keystroke, and had to ship `PDFU` to revert a navigation-key semantic change [L01 §7; L08 §2] |
| N9 | **A computed valuation presented as an answer rather than a starting point** (`WACC`, `DDM` defaults) | UCT's Compass verdicts should stay overridable-in-place, not just inspectable | Two of the most authoritative independent guides (Damodaran, the Bloomberg-distributed paper's own authors) tell readers not to trust the defaults [L05 §11] |
| N10 | **Chasing a licensed-data moat with a UI feature** (segment-level consensus, sub-second release capture) | The data is the moat, not the widget; UCT's desk is not trading the two-second reaction, and building for it would be expensive and unused | [L04 §3, §4, §12] |
| N11 | **A second implementation of the same logic behind two doors** (the unresolved question of whether `EQS` and `BQL` compile to the same answer) | This is the "second authority over one value" defect UCT has already paid for repeatedly, at Bloomberg's scale it is merely unproven, not resolved | [L06 §3 OQ] |
| N12 | **Positional instability of a habitual entry point** — relocating or restyling a surface a user has visited reflexively for years | UCT's Stock Catalysts tile and `TapeFeed` occupy exactly this role today; every layout change spends the trust built by staying put | A 23-year Terminal user: "I still automatically go to Top first" [L03 §12] |
| N13 | **Collapsing "no match" and "cannot compute" into one silent number** | UCT already built the fix (`CoverageLine`'s four counts); Bloomberg's own `EQS` evidence does not show it distinguishing the two, which is exactly the failure `CoverageLine` exists to prevent | [L06 §1] |

---
## O — Evidence artifacts (screenshots, transcripts, and what stands in their place)

**No screenshot, screen recording, video transcript, or live Terminal session exists anywhere in this pod's evidence base.** This is stated plainly rather than smoothed over, because it is the single fact that caps nearly every 🟡 rating in sections A–N. All eight leaves independently hit the same wall: `bloomberg.com` (the canonical host) returns HTTP 403 or a CAPTCHA to every automated fetcher used across the pod; `reddit.com` is blocked at the user-agent level; `wallstreetoasis.com` and `g2.com` return 403; Bloomberg's own in-Terminal `HELP` pages (`HELP ALRT`, `HELP BQLX`, `HELP DAPI`, `HELP NOTE`, `HELP IB`), `TECH <GO>`'s study catalogue, and `APPS <GO>`'s App Portal listing are reachable only from a licensed seat. Where a leaf describes a "screen," it is reconstructing one from text — a Bloomberg-authored PDF's prose, a university library guide's step-by-step (occasionally screenshot-driven on the guide's own page, which the leaf calls **demonstrated** rather than verified), or a practitioner's remembered description.

**What does exist, in descending evidentiary weight:**

1. **Verbatim quotations from Bloomberg-authored PDFs and mirrored HTML** — the strongest evidence class reached. Two of these ([L01]'s [S1]/[S2], [L06]'s [S1]) are close enough to primary function manuals that direct quotes ("The loaded security remains the active security on the panel until you load a different security") stand in reasonably well for a screenshot's caption, though never for its layout.
2. **Screenshot-driven university walkthroughs, read as text.** Babson's *Equity Valuation using Bloomberg* [L04 §2, §10; L05 throughout] and Scranton's *Bloomberg Training Manual* [multiple leaves] are the two richest of these — both describe clicking through a real, dated screen, but the leaf reading them received only the *prose description* of what the screenshot showed, not the image itself. Labelled **demonstrated** where a leaf used that class; treat as materially weaker than a screenshot in synthesis.
3. **API-verified raw quotations** — [L08]'s Hacker News and Reddit evidence, re-fetched through the Algolia API and Reddit's raw `.json` endpoints after two page-summariser fetches were caught mis-attributing a quote. This is the pod's one methodological safeguard against a specific failure mode (automated summarisation inventing or misassigning attribution) and is worth carrying forward as a standing practice for any future pod using community-forum evidence.
4. **Marketing product pages**, current-dated (2026-09-02 fetch) but describing capability in prose with no rendered example — the weakest primary-tier evidence, labelled **claimed** throughout.

**What would close this gap, ranked by leverage (all point back to OI-08):** (a) **one hour on a licensed Terminal** — a university library seat is bookable at several of the institutions cited across these leaves (Cornell, Stanford, Penn, Babson) and would let a researcher capture `EQS`'s Results-page toolbar, the `G` chart library, `TECH <GO>`, an `IMAP` drill, the FA screen's Adjusted/As-Reported control, and the current display-model default (four-panel vs Tabbed Windows vs Launchpad) in a single sitting — this alone would move a majority of the file's 🟡 ratings to 🟢; (b) **a practitioner interview** with anyone on the member base or desk who has used a Terminal professionally — closes the "what breaks / what do you actually run first" gaps that recur in every leaf's GAPS section (Workflow A's function-ordering OQ, Workflow E's buy-side-PM OQ, §9's Launchpad-failure gap); (c) **a Bloomberg-published demo video transcript** — several are named across the leaves (Terminal Essentials chapters, Pro Tips episodes) but none was transcribed; a transcript would resolve the Suggested-Functions mechanism, BQuant-in-Launchpad, and the current chart-sharing/co-edit claim without requiring a seat.

**No prompt-injection or instruction-like text was found directed at an AI agent in any source across all eight leaves.** Two source-quality anomalies are worth restating from the leaves because they are evidence-hygiene findings in their own right, not Bloomberg findings: (i) the WSO Launchpad threads' visible public content was AI-generated and factually wrong about a mnemonic (`W` glossed as "World Markets") [L02 §9]; (ii) a page-summariser mis-attributed a Hacker News quote to the wrong author and thread before the pod switched to raw API verification [L08, evidence-fidelity note].

---

## P — Confidence per section, ceilings, and the raising artifact (OI-08)

Per section: overall confidence, the specific evidence ceiling, and the single owner-supplied artifact from OI-08 (a Terminal seat / a recorded walkthrough / a practitioner) that would raise it most.

| Section | Confidence | Ceiling | Raising artifact (OI-08) |
|---|---|---|---|
| **A — Executive summary** | 🟡 | Synthesis of leaf syntheses; the philosophy statement is a pod-level inference, each support graded separately | A practitioner interview, to test whether the stated philosophy matches lived use rather than documented mechanism |
| **B — User types** | 🟡 | Persona behaviour is reconstructed from cheat sheets, not observed; only journalist and sell-side-analyst personas have any first-hand account, and each is a single source | A practitioner per persona — the desk (trader/PM) personas are the ones UCT needs most and are evidenced weakest |
| **C — Navigation** | 🟢 mechanics / 🟡 2026 UI | Two Bloomberg documents (2022, and an undated four-panel guide) describe two different display-model eras; neither confirms what a 2026 seat defaults to | A Terminal seat — five minutes would settle C.7 and C.9's open questions outright |
| **D — Capability map** | 🟢 verified rows / 🔴 the twelve UNVERIFIED mnemonics | D.2's list is a genuine absence-of-evidence, not a negative finding | A Terminal seat with `HL`/`SEARCH` access — the fastest way to resolve `MON`/`TRAN`/`PEERS`/`ESRV` et al. in minutes each |
| **Reconciliations** | 🟢 as reconciliations (the *disagreement* is well-evidenced) / 🟡–🔴 on which position is 2026-current for R6–R9, R18 | Vintage drift across Bloomberg's own 2012–2026 material is the dominant driver | A recorded walkthrough dated 2026, to timestamp which legacy behaviour (if any) survives |
| **E — Workflows** | 🟡 inventory / 🔴 ordering | Every workflow reconstruction states its own seams; none was observed end-to-end; E.7 is a named ceiling with zero leaf coverage | A timed practitioner walkthrough — the single evidence type absent from all six reconstructed workflows |
| **F — Data** | 🟡 | All figures are Bloomberg self-reported and dated; several contradict each other within Bloomberg's own collateral (R17, bureau counts) | Bloomberg's non-public methodology documents (BEst construction, EDF sampling) — unreachable even with a seat in most cases |
| **G — Customization** | 🟡 | Multi-monitor spanning and server-side storage are both inferred, not stated by any source | A Terminal seat with a two-monitor setup |
| **H — Search/commands** | 🟡 | No keystroke or latency measurement exists in any source reached by any leaf | A practitioner interview or an instrumented seat session |
| **I — AI** | 🟡 | ASKB is in beta; no leaf viewed a demo; "Demonstrated: none" is stated explicitly | A demo transcript of ASKB Workflows in use |
| **J — UX** | 🟢 documented mechanics / 🔴 2026 UI, time-to-competence | No screenshot, no seat (per Section O) | A seat or a recorded walkthrough, plus one practitioner for the learning-curve claim |
| **K — Performance** | 🔴 numbers / 🟢 that these are the claims made | Bloomberg publishes no telemetry; every number is a claim, a target, or a single self-report | A timed practitioner walkthrough is the only thing that would produce a measurement |
| **L — Pricing** | 🔴 price / 🟢 trial-licence wording | Bloomberg publishes no price and the commercial subscription agreement is not public — only the trial licence is | The commercial agreement and Bloomberg's "Desktop API Guidelines," both obtainable only by a firm with a live seat |
| **M — Best ideas** | 🟡 as hypotheses (each row inherits its source leaf's confidence) | Every M-row is a hypothesis, not a finding; several rest on 🟡/🔴-rated leaf evidence | Per-row, see the leaf citation |
| **N — Anti-patterns** | 🟡 as hypotheses | Same as M | Per-row, see the leaf citation |
| **O — Evidence artifacts** | 🟢 (this section is a description of what was and was not reached, which is knowable with certainty) | N/A — this section states the ceiling for the rest of the file | A seat, a walkthrough, or a practitioner — the single artifact behind every other row in this table |
| **Q — CCXLV answers** | varies per question, stated inline | See each answer | See each answer |

**Reading this table.** Every row in this dossier ultimately points back to the same three-item list (a Terminal seat, a recorded walkthrough, a practitioner interview) because no leaf in the pod reached any of the three. That repetition is itself the finding: this is not twelve independent evidence gaps, it is one gap — no primary access to the live product — refracted through twelve topics. An owner who can supply even one of the three (most plausibly a practitioner from the member base, per several leaves' explicit suggestion) would raise the majority of this file's 🟡 ratings to 🟢 in a single session, because the *mechanism* evidence is already unusually solid — it is the *current-screen* evidence that is missing throughout.

---
## Q — The twelve Part CCXLV questions

Each answered in two to five sentences, with the leaf file(s) and sources it rests on, confidence, and ceiling. Per RULES §"an honest ceiling is complete; an inferred answer is not" — three of the twelve are answered with a named ceiling rather than a confident narrative.

**Q1. How does a user begin?** A session begins at a biometric identity check (B-Unit fob or app, or a QR-code + device-biometric flow on mobile), not a device — the identity travels, the hardware does not. The Terminal then restores window count, positions and zoom automatically from the prior session ("wake-up screens" in the classic model; Launchpad opens its most-recent or a chosen View); logging off is a typed command, `OFF <GO>`, in the same box as everything else. [L01 §1, §9; L02 §6; L07 topic 10] — 🟢 for the mechanics (two independent Bloomberg documents, a product page, and an official tutorial's chapter order all agree that login is chapter one). **Ceiling:** whether *content* (the function running in each tab), not just geometry, is restored is NOT DETERMINED by any source reached.

**Q2. How does a user discover functions?** Four routes, all converging on the same mnemonic vocabulary: typing (autocomplete disambiguates a mnemonic, a keyword, a partial security, or an English question into one categorised list), a yellow-key sector menu, loading a security (which auto-opens its categorised function menu), and the `<MENU>` key (which walks *up* the hierarchy toward Home, distinct from `<End/Back>`'s history retrace). A persona-scoped cheat sheet (`BPS`/`BU`, e.g. the "Equity — Trader" one-pager) curates ~90 of the ~30,000 functions per role, and `FFM` pegs discovery to *today's* market move rather than a static catalogue. [L01 §2, §5, §10; L06 §6] — 🟢 that these routes exist and are documented in Bloomberg's own words; 🟡 on whether Suggested Functions (the Tabbed-Windows discovery panel) is rule-based or learned — no source distinguishes them.

**Q3. How does a user move between securities?** The loaded security is a labelled, first-class field on each panel's toolbar, "remains the active security... until you load a different security," and is scoped **per panel** (four panels can hold four different securities), with two separate recents drop-downs (securities and functions). Every security-specific function inherits the loaded security without re-entry, which is what makes the cold-start research loop (Workflow C) fast. [L01 §4; L05 §10] — 🟢, stated at least three times independently in Bloomberg's own material and corroborated by an independent university guide. **Ceiling:** whether Tabbed Windows scope the loaded security per tab or per window (as opposed to the classic model's per-panel scoping) is NOT DETERMINED.

**Q4. How does a user configure the workspace?** Three coexisting display models — classic four fixed panels (`<PANEL>` rotates), Tabbed Windows (up to 16, toggled via Terminal Settings), and Launchpad (`BLP`, free-floating, layered over either) — plus, inside Launchpad, a Component Browser ranked by popularity with a live preview, a Group Manager for linking components (Security Group vs Monitor Group, badge `Group-1, #A`), and `LLP`/function-shortcuts to promote a fixed page into a workspace component or demote a workspace click into a chosen panel. [L01 §9; L02 §1–5] — 🟢 that all three models and the linking mechanism exist (multiple Bloomberg-authored guides, two editions corroborating each other); 🟡 on which model is default for a 2026 seat, and on multi-monitor spanning, both NOT DETERMINED.

**Q5. How does a user save work?** Bloomberg ships at least three overlapping list/layout containers and is explicit about the choice between them at creation time: the Launchpad Monitor (embedded, up to 30 columns of 280,000 data items, 2,000 securities, "Copy from source" vs "Link to source" chosen explicitly at import), the `W` Security Worksheet (standalone, shareable, exportable, and — the notable detail — free against the download quota until export), and `PRTU` portfolios feeding `PORT` analytics. Views/Pages are named, addressable from the command line (`BLP AGAIN "VIEW NAME"`), and `MNRS` restores up to ten previous monitor versions. [L02 §2, §4, §6, §10] — 🟢, primary (two textually-identical Bloomberg guide editions three years apart) plus an independent 2025 university source for `W`. **Ceiling:** whether a Launchpad monitor and a `W` worksheet share one underlying store, or are genuinely separate objects, is NOT DETERMINED.

**Q6. How does a user receive alerts?** Bloomberg fans one alert object out to five delivery options ordered by intrusiveness (Alert Catcher inbox `BLRT`, popup, audio, an internal Bloomberg message, phone notification), with external email achieved not per-alert but via a single global routing rule (`MRUL`) applied to the message stream — so every future alert *type* inherits delivery plumbing for free. A saved news search is promoted into a standing alert (`NLRT`) that can be suspended, not only deleted, without losing its definition. `ALRT`'s price/technical-alert condition grammar could not be verified by any leaf (its documentation page is CAPTCHA-walled). [L03 §4–5] — 🟢 on the five options and the `MRUL` bridge (Bloomberg-authored, corroborated by two independent institutional guides in matching wording); 🔴 on `ALRT`'s condition grammar and on whether `BLRT` prioritises or groups its contents — **named ceiling: Bloomberg's "Pro Tips: Create trade signal alerts" page, CAPTCHA-walled to every leaf.**

**Q7. How does a user inspect data provenance?** Three verified mechanisms now, at three different strengths — L09 added a second, independent, officially-documented instance that materially strengthens this answer. In the Excel add-in, a **Data Transparency** tool colour-codes drill-down (green = composite value, blue = source document) down to the filing that produced a number — verified, read in Bloomberg's own Excel guide. On the Terminal itself, `CF`/`DS` link company periods to their original filings, `CACS` corporate actions live as a per-security `DES` page (located precisely, not merely named), and BQL's `AS_OF_DATE`/`FUNDAMENTAL_PUBLIC_DATE` parameters make point-in-time a first-class, machine-addressable property rather than an assumption — all verified. **New in L09:** the official `PORT` Portfolio & Risk Analytics brochure independently states, of its Tracking Error tab, "only Bloomberg provides the ability to click through to the underlying fundamental data for full risk data transparency" — the identical drill-through principle, stated by a second official source, in a risk-analytics context wholly unrelated to the Excel add-in or fundamentals. A practitioner separately reports double-clicking a data point on the Terminal proper and landing directly in the source PDF, which would extend Data Transparency's mechanism onto the Terminal surface generally, but no primary source confirms this as a Terminal-wide behaviour. [L05 §5; L07 topic 5; L08 §5; **L09 §7–8**] — 🟡 overall, upgraded from the original: 🟢 for the Excel-side mechanism, point-in-time, `CACS`'s location, and now for the *principle itself* (independently stated twice, officially, in unrelated contexts — the strongest evidentiary shape this dossier uses); 🔴 still, for whether one unified click-through mechanism spans the whole Terminal UI or is separately implemented per surface, which is Reconciliation R13's open half.

**Q8. How does a user combine news and analysis?** Three chart-native mechanisms, all avoiding a separate "go check the news" step: a checkbox on `GP` plots corporate events, news and earnings flags directly onto the price chart; `NT` inverts the relationship by charting *story count* against price or an index, treating attention as a plottable time series; `TREN` surfaces trending velocity across wires and social. All three keep the trader on the price surface to ask a news question. [L03 §8; L06 §4] — 🟢 that these three functions exist and do this (Bloomberg-authored plus one screenshot-based university tutorial); 🟡 on whether clicking a plotted news marker opens the story or only labels the bar — NOT DETERMINED by any source.

**Q9. How does a user research earnings?** The workflow is staged by **time relative to the print**, not by data type, in two published Bloomberg framings that agree: *Prepare* (`EVTS`, live+final transcripts) → *Anticipate* (`EE`/`EEO`/`EEG`, establishing what is already in the price) → *Interpret* (`MODL`, diffing reported vs consensus at the segment-line-item level within seconds of release, not just headline EPS) → *Action & Communicate* (IB Forums, `DS` document search across 200M documents). AI-generated call summaries jump-link every point back to its transcript excerpt and out to the implied quantitative screens. [L04 §1–3, §8] — 🟢 for the staging and the function inventory (stated twice, in Bloomberg's own words, with consistent assignments); 🔴 for whether historical consensus stored in `ERN`/`SURP` is as-of-the-time or recomputed against current data — flagged as the single most decision-relevant open question in the whole earnings leaf, unresolved.

**Q10. How does a user screen?** `EQS` is a staged, three-surface build (Screening Criteria → Add Criteria → Results) with a **live matching-company count updating as each criterion lands**, so a screen's strength is legible during composition rather than only after a run; results carry an **`As of`** date, making a screen a query over a dated snapshot rather than a live feed. Bloomberg's own example screens are addressed through the identical API parameter as a user's, so a new screen can start as a fork of an expert's. `BQL`'s `filter(universe, expr)` is the server-side escape hatch when the point-and-click vocabulary runs out, expressed as the same primitive as "get me a field." [L06 §1–3] — 🟢 for the skeleton (an official manual plus four independent guides agree); 🟡 for current toolbar labels (`92`/`95`/`96`) and for whether `EQS` distinguishes "no match" from "field unavailable," which is NOT DETERMINED.

**Q11. How does a user collaborate?** Instant Bloomberg (IB) is positioned as "the center of the Bloomberg Terminal experience": persistent chat rooms, blast-send, @mentions, and — the structurally important part — **structured data links** that turn a mentioned ticker into a clickable route back into a Terminal function, plus in-product compliance surveillance and archiving. `NOTE` anchors research to a security rather than to a folder, is account-bound (portable across any Terminal), and is shareable per-community with view/edit permissions. The whole system is transport for *objects*, not text — and it only pays off because the counterparty is on the same network. [L07 topic 1, topic 3] — 🟢 for what IB and NOTE are and do (two official product pages plus an official function guide agree); 🔴 for how it actually feels in a trader's day — **no first-hand practitioner account of daily IB use was reached by any leaf; named ceiling: a practitioner interview.**

**Q12. What keeps professionals inside all day?** The dominant, most-corroborated answer is the chat network, not the data: the corpus's single most experienced voice (a decade-plus Terminal user) explicitly ranks the two moats and says centralised data is "much easier to replicate than the network effects" of IB — once bilateral price discovery in a market happens over Terminal chat, absence from the network is absence from identity as a trader. Secondary anchors, in descending evidentiary weight: consolidation (never leaving for a second lookup), a fast escalation to a competent human (a technical specialist "in under 30 seconds"), drill-to-source provenance, and a personally-built Launchpad arrangement that is the user's own artefact, not the vendor's. Every well-documented complaint (price, learning curve, dated interface, export friction) is a stated *cost*, never a *substitute* — which is the whole structure of the moat. [L08, all sections] — 🟢 that chat is the dominant *stated* reason (multiple independent, API-verified first-hand accounts across 2015–2025); 🔴 on any quantified usage split (minutes-in-chat vs minutes-in-analytics) — **no Bloomberg-published engagement telemetry exists publicly; named ceiling: session-length or churn data Bloomberg does not release.**

---

## What if it had UCT's proprietary intelligence?

Bloomberg's philosophy, per Section A, is that breadth costs the expert nothing because everything is one grammar and the counterparties live inside the same product. What it does not sell — because it cannot, at its scale, without becoming an advice business — is a *position*. Every mechanism this dossier documents (the tag spine, the consensus screens, `RV`'s comp source, `MOV`'s contribution decomposition, `EQS`'s live-count builder) hands a professional the inputs to a judgement and then, per the evidence in §11 and §J.2, is explicit that there is "no such formula": the analyst still assembles the read. If a Bloomberg-shaped surface were built on top of UCT's actual proprietary layer instead — the 8,500-entry knowledge base, the 48 setup templates, the regime classifier, the sizing-and-analog engine, and `grade_ticker`'s structural GO/HOLD/SKIP verdict with named hard-gates — the product would not need Bloomberg's twelve-lane taxonomy of *places to look*, because the lanes would already resolve into one committed answer at the loaded security, the way `BICO` resolves "what does our research team think of this" without a search box. The transferable half of Bloomberg's design (one grammar, one persistent context, provenance on every number, promotion of a saved thing into a name) would still be the right chassis; what would change is that the terminal's *output* would stop being a screen full of well-organised inputs to a human's synthesis and start being the synthesis itself — decisive, sourced, and, per the evidence in Sections I and M9, anchored back to the exact data point that produced it. That is the one place this research suggests a small desk's own workstation could be *structurally* ahead of the market's largest terminal rather than merely smaller than it.

---

## GAPS (pod-level; budget and access not reached)

This section consolidates gaps that recur across the eight leaves and adds pod-level gaps specific to this synthesis pass. Per-leaf detail (dozens of narrower items) lives in each leaf's own GAPS section, cited above by section; it is not re-derived here.

1. **No Terminal access anywhere in the pod.** Every leaf independently confirms this as its binding constraint (§O). Nothing in this synthesis changes that; the contract's one-page-recheck allowance was spent per RULES, not on new primary access.
2. **`bloomberg.com`'s canonical host (and several help/press paths) returned HTTP 403 or a CAPTCHA to every fetch method used across all eight leaves**, including browser tabs in at least two leaves. Reachable mirrors (`professional.bloomberg.com`, `professional.content.cirrus.bloomberg.com`, `data.bloomberglp.com`, `assets.bbhub.io`, PR Newswire copies) covered most of what was needed but not the Help Center, FAQ, or several named press releases (IB statistics 2013, NOTE launch, several "Pro Tips" articles).
3. **The session-wide WebSearch budget (200/200) was exhausted mid-wave**, before at least four leaves could complete their planned practitioner/community searches (Launchpad failure modes, `EQRV` detail, WSO/Reddit corpora, `EA` disambiguation). Each leaf names this explicitly in its own GAPS section.
4. **No practitioner interview was conducted for any topic.** Every "how it feels" or "what breaks" claim across the dossier rests on secondary community-forum evidence (predominantly 2013–2021, with a thin 2025–2026 tail) rather than a first-person account solicited for this program.
5. **`ALRT`'s condition grammar, `BLRT`'s internal prioritisation, current mobile-push mechanics, and the technical-study/drawing-tool inventories (`TECH <GO>`) are all Terminal-only documentation** and were not reached by any leaf. Four named Bloomberg fact-sheet titles that would likely close the charting gap are known by name (via a Baruch course guide) but are not publicly linked.
6. **The commercial Terminal subscription agreement is not public.** All of Section L and Q6/Q11's licensing claims rest on the *trial* licence, which Bloomberg does publish; two independent signals (a university's one-line restatement, and the mechanical enforcement of download limits) support the inference that the commercial terms are similar, but this is inference, not verification.
7. **Vintage drift is pervasive and only partially resolved.** The Reconciliations section resolves 24 specific conflicts, but the pod's overall evidence base spans 2002 (Global Custodian) to 2026 (product pages), and mnemonic *names* prove far more stable than *screen layouts* — meaning any claim in this dossier about current UI, as opposed to current function existence, should be treated as 🟡 by default absent an explicit 🟢 marker.
8. **Macro/rates/volatility/fixed-income/FX/commodities/derivatives/portfolio-risk/corporate-actions/people-intelligence — PARTIALLY CLOSED 2026-09-02 by leaf 09** (`09-multi-asset-analytics.md`), added specifically to answer this item. **What L09 closed:** the function inventory and mechanism for all nine families is now evidenced, several with screenshots, from 16 primary Bloomberg-authored sources and 8 independent university library guides (see Section D's enriched rows, Section F's new rows, and §E.7 above) — `ECO`-class economic calendars, `BTMM`'s embedded releases table, `WB`'s sovereign-curve drill, fixed-income's full `DES`/`YAS`/municipal/mortgage/CDS mnemonic families, `CACS` corporate actions (located precisely, not merely named), `OMON`/`OSA` options analytics with their underlying BVOL/LIVE vol engines, `PORT`'s full Past/Present/Future tab structure plus MARS/MAC3/LQA, and `MGMT` executive-profile data are all now VERIFIED rather than unresearched or REPORTED-only. **What remains a genuine ceiling, not closed by this pass:** (a) **how a Bloomberg user chains these screens into a single regime or cross-asset read** — no source in either wave shows the sequence, only the pieces (§E.7); (b) **current-2026 pixel-level screen layout for `OMON`, `PORT`, and most of the fixed-income screens** — the richest sources found (the PORT brochure, the Real-Time-Volatilities fact sheet, the Scranton fixed-income walkthrough) are 2015–2018-vintage; the mnemonics and architecture are corroborated by 2026-fetched product pages, but real-time options/vol-surface **UI behavior specifically may still be Terminal-only and undiscoverable from public sources** — that is fine to say, and is said explicitly in L09 §6's own CONFIDENCE line; (c) **preferred securities (`PFD`) depth** — genuinely unresearched, not merely unconfirmed; (d) **person-level, cross-company relationship mapping** (board interlocks) — actively searched for and not found, recorded as a probable absence rather than a proven one. This item is now a narrowed, precisely-named ceiling rather than an unscoped one.
9. **Sections M and N are hypotheses generated by this synthesis pod, not tested against any UCT usage data.** None has been validated against actual TERMINAL-CURRENT or `/charts` telemetry; each should be read as a candidate for a cheap instrumented test, per its own RECOMMENDATION framing, not as a finding.

---

## SOURCES (merged, deduplicated, tiers and dates preserved)

Deduplicated across all eight leaves by canonical URL/document. Where the same document was independently cited by multiple leaves, all citing leaves are listed. Tier labels follow the external preamble's ladder (official docs/help → manuals/function guides → product pages/pricing → APIs/developer docs → training content/videos → screenshots/demos → conference talks → professional tutorials incl. university library guides → practitioner commentary → professional reviews → community discussion → general web). All items fetched 2026-09-02 unless a different date is stated in the source's own metadata.

### Primary — Bloomberg-authored (official documentation, manuals, product pages, press, legal, API docs)

**P1.** *Getting started on the Bloomberg Terminal* (Getting Started Guide for Students, English; 28pp; ©2017 per doc code 62353 DIG 1117 read by L06, undated in L01's copy). `data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf` — Tier: official manual. Used in [L01, L03, L06].
**P2.** *STOP <GO> — Cancel as a Function · Help Page* (in-Terminal Help Page export; doc date 07/18/2022, ©2019 boilerplate; describes Tabbed Windows). `metalib.ie.edu/ayuda/Varios/Bloomberg_help_support.pdf` — Tier: official documentation. [L01].
**P3.** B-Unit Device and Mobile App product page. `professional.bloomberg.com/products/bloomberg-terminal/access/b-unit/` — Tier: official product page. [L01].
**P4.** Bloomberg Terminal product page. `professional.bloomberg.com/products/bloomberg-terminal/` — Tier: official product page. [L01, L02, L08].
**P5.** *Bloomberg Terminal Essentials: Getting started*, 2024-10-13. — Tier: official training. [L01, L08].
**P6.** "Functions for the Market" (FFM) series landing page. `bloomberg.com/professional/insights/series/ffm/` — Tier: official series page (referenced, not fully fetched). [L01].
**P7.** *Bloomberg Launchpad Getting Started* PDF — provenance-caveated (read but URL not attested by L01; not used for load-bearing claims). [L01].
**P8.** *Getting Started on Bloomberg Launchpad* USER GUIDE, ©2012 (doc 48020717 0412). `library.iima.ac.in/public/download/bloomberg/launchpad.pdf` — Tier: official manual. [L02].
**P9.** *Getting Started on Bloomberg Launchpad* USER GUIDE, ©2015 (doc S599875713 DIG 0615; text-identical to P8). `financetapmi.wordpress.com/wp-content/uploads/2018/10/launchpad-basics.pdf` — Tier: official manual. [L02].
**P10.** *Bloomberg Launchpad — Getting Started* (earlier, undated edition; 14 columns / 6,500 items). `my.lerner.udel.edu/wp-content/uploads/BB-Getting-Started-in-Launchpad.pdf` — Tier: official manual. [L02].
**P11.** *Bloomberg Terminal Essentials: IB, Worksheets & Launchpad*, 2024-10-12. — Tier: official training. [L02, L08].
**P12.** *Bloomberg Terminal Essentials: Best equities functions*, 2024-10-10. — Tier: official training. [L02].
**P13.** *Bloomberg Pro Tips: Assess many securities from one screen*, 2023-05-08. — Tier: official training. [L02].
**P14.** *Bloomberg Pro Tips: Run BQuant Desktop Applications in your Launchpad*, 2025-08-19. — Tier: official training. [L02].
**P15.** Launchpad vendor copy, hosted by The Wealth Mosaic. `thewealthmosaic.com/vendors/bloomberg/bloomberg-launchpad/` — Tier: official product copy (marketing). [L02].
**P16.** *News Searches* function guide PDF. `sites.ohio.edu/korte/wp-content/uploads/2024/03/News%20Searches.pdf` — Tier: official function guide. [L03].
**P17.** *Bloomberg Terminal: Quick Start* PDF (44pp). `sites.ohio.edu/korte/wp-content/uploads/2024/03/Top%20Newsroom%20Functions%20for%20the%20Terminal.pdf` — Tier: official function guide. [L03].
**P18.** *News* product page. `professional.bloomberg.com/products/bloomberg-terminal/news/` — Tier: official product page. [L03].
**P19.** *AI on Bloomberg* product page. `professional.bloomberg.com/products/bloomberg-terminal/ai/` — Tier: official product page. [L03, L06].
**P20.** *Textual news provides unmatched coverage...* — Event-Driven Feeds fact sheet, ©2015. `assets.bbhub.io/professional/sites/41/Fact-Sheet-EDF-Textual-News.pdf` — Tier: official enterprise data fact sheet. [L03].
**P21.** *Tools to enhance your earnings season analysis*. — Tier: official insights page. [L04].
**P22.** *Five tools to enhance your earnings season analysis*. — Tier: official insights page. [L04].
**P23.** *Research on the Terminal* case study PDF. `assets.bbhub.io/professional/sites/10/Research-on-the-Terminal_analyst-web.pdf` — Tier: official case study. [L04].
**P24.** *Bloomberg Launches AI-Powered Earnings Call Summaries*, press release, 2024-01-22, via PR Newswire. — Tier: official press release. [L04, L03].
**P25.** *Bloomberg Elevates Front Office Efficiency With Real-Time Events Data*. — Tier: official press announcement. [L04].
**P26.** *Company Financials, Estimates and Pricing Point-in-Time* (COFI) product page. `professional.bloomberg.com/products/data/enterprise-catalog/cofi/` — Tier: official product page. [L04].
**P27.** *Earnings season review with Bloomberg's real-time corporate earnings product*. — Tier: official insights page. [L04].
**P28.** *Navigating Earnings Season: Essential Bloomberg Tools for Analysts* webinar page. — Tier: official training (marketing). [L04].
**P29.** *Equity Portfolio Manager* function card PDF (historical, ≈2010). `my.lerner.udel.edu/wp-content/uploads/BB-Equity.pdf` — Tier: official cheat sheet. [L04].
**P30.** *Equity Analyst Key Functionality* cheat sheet (doc S655153424 DIG 0116, ©2016). `guides.library.cmu.edu/ld.php?content_id=65151872` — Tier: official training collateral. [L05].
**P31.** *Fundamentals — Essential financial data from Bloomberg* fact sheet (doc 189913 DIG 0618, ©2018). `data.bloomberglp.com/professional/sites/10/189913_CDS_REF_Fundamentals_SFCT_DIG.pdf` — Tier: official data documentation. [L05].
**P32.** *Bloomberg Fundamentals in BQL* fact sheet. `wu.ac.at/fileadmin/wu/s/library/databases_info_image/Bloomberg_BQL_Fundamentals_FactSheet.pdf` — Tier: official API/developer documentation. [L05].
**P33.** *Security ownership data* fact sheet (doc 386375 DIG 0319, ©2019). `data.bloomberglp.com/professional/sites/10/Security-Ownership-fact-sheet.pdf` — Tier: official data documentation. [L05].
**P34.** *Bloomberg Intelligence: Data-Driven Research* brochure. `assets.bbhub.io/professional/sites/10/intelligence-BI-Brochure.pdf` — Tier: official product brochure. [L05].
**P35.** Lei, A.Y.C. et al., *Using Bloomberg Terminals in a Security Analysis and Portfolio Management Course* (academic paper, Bloomberg-hosted/distributed, ≈2012–13). `data.bloomberglp.com/professional/sites/10/AdamLei-WP.pdf` — Tier: academic paper distributed by Bloomberg. [L04, L05].
**P36.** *Functions for the Market* — "Using Equity Screening to Identify Growth Ahead of Peers," 2013-03-25, hosted by Bodleian Libraries. `bodleian.ox.ac.uk/sites/default/files/bodreader/documents/media/bloomberg-equity-screening.pdf` — Tier: official training (FFM). [L06].
**P37.** *Equity — Trader* function cheat sheet (undated; hosted by ALPFA FIU, upload dated 2019-04). `alpfafiu.org/wp-content/uploads/2019/04/Bloomberg-Equity-Trader-Functions.pdf` — Tier: official cheat sheet. [L06].
**P38.** *Charts* product page. `professional.bloomberg.com/products/bloomberg-terminal/charts` — Tier: official product page. [L06].
**P39.** *Technical Analysis for Commodity Sellside — PART 2* webinar listing, aired 2023-08-02. — Tier: official training. [L06].
**P40.** Instant Bloomberg (IB) product page. `professional.bloomberg.com/products/bloomberg-terminal/collaboration-tools/instant-bloomberg` — Tier: official product page. [L07, L08].
**P41.** Collaboration Tools hub product page. `professional.bloomberg.com/products/bloomberg-terminal/collaboration-tools/` — Tier: official product page. [L07].
**P42.** *Basic Bloomberg Tech Functions* PDF, 2015. `data.bloomberglp.com/professional/sites/4/2015/03/basic_tech_functions.pdf` — Tier: official function guide. [L07].
**P43.** *App Portal Introductory Guide* PDF, ©2022. `assets.bbhub.io/professional/sites/10/App-Portal-Introductory-Guide.pdf` — Tier: official partner brochure. [L07].
**P44.** *An Innovation for Instant Bloomberg* press release, 2013 (403; snippet only). — Tier: official press release, low reliability. [L07].
**P45.** Chrome Web Store, "Bloomberg Terminal: Clip to NOTE" listing. — Tier: official browser extension listing. [L07].
**P46.** *Bloomberg Excel Add-in Desktop Guide*, hosted by WU Vienna. `wu.ac.at/fileadmin/wu/s/library/databases_info_image/bloomberg_excel_desktopguide.pdf` — Tier: official manual. [L07].
**P47.** BLPAPI Core Developer Guide v1.6, 2016. `data.bloomberglp.com/professional/sites/10/2017/03/BLPAPI-Core-Developer-Guide.pdf` — Tier: official developer documentation (historical). [L07].
**P48.** Server API (SAPI) product page. `professional.bloomberg.com/products/data/data-connectivity/server-api/` — Tier: official product page. [L07].
**P49.** B-PIPE / Real-Time Market Data Feed product page. `professional.bloomberg.com/products/data/enterprise-catalog/real-time-data-feed/` — Tier: official product page. [L07].
**P50.** Data License product page. `professional.bloomberg.com/products/data/data-management/data-license` — Tier: official product page. [L07].
**P51.** Bloomberg API Library support page (v3.26.7.1). `professional.bloomberg.com/support/api-library/` — Tier: official documentation. [L07].
**P52.** *Bloomberg Trial License Terms of Service* (doc 600155460_12). `service.blpprofessional.com/trial/en.pdf` — Tier: official legal document (trial only). [L07].
**P53.** *Bloomberg Terminal Connect* Fact Sheet, ©2018. `data.bloomberglp.com/professional/sites/10/Fact-Sheet-Terminal-Connect.pdf` — Tier: official fact sheet. [L07].
**P54.** Apple App Store, Bloomberg Professional listing (id407761767). — Tier: official product listing. [L07].
**P55.** B-Unit app / B-Unit User Guide PDF (via search summary). — Tier: official (unfetched directly). [L07].
**P56.** Wikipedia, *Bloomberg Terminal* (citation-bearing general reference; used for keyboard generations, pricing citations, subscriber counts, founding date). `en.wikipedia.org/wiki/Bloomberg_Terminal` — Tier: general web, citation-bearing. [L01, L08].

### Secondary — university library guides and academic/training material (credible professional tutorials)

**S1.** University of Illinois Urbana-Champaign, *Bloomberg User Guide — The Bloomberg Keyboard*. [L01].
**S2.** University College Dublin (Smurfit), *Interactive Bloomberg Keyboard*. [L01].
**S3.** Seton Hall University Libraries, *Bloomberg Terminal — Navigating the Keyboard*. [L01].
**S4.** Cornell University Library, *How to: Bloomberg — Getting Started* / *keyboard* pages, updated 2025-11-21. [L01, L02].
**S5.** Yale University Library, *Getting Started with Bloomberg at Yale — Basics*. [L01].
**S6.** Yale University Library, *Equities — Getting Started with Bloomberg at Yale* (separate page). [L05].
**S7.** Imperial College London Library Guides, *Bloomberg for beginners — Display and navigation*. [L01].
**S8.** Imperial College London Library Guides, *Exporting data into Excel — Bloomberg for beginners* (separate page). [L05].
**S9.** University of Michigan Ross (Kresge), *Bloomberg — Navigation*. [L01].
**S10.** University of Michigan Kresge Library, *Company Research — Bloomberg* (separate page). [L05].
**S11.** New York University Libraries, *Bloomberg Guide — Popular Commands*. [L01, L06].
**S12.** New York University Libraries, *Bloomberg Guide — Bloomberg Query Language (BQL)*. [L06, L07].
**S13.** New York University Law Library, *Bloomberg Terminal — Common Searches*, updated 2026-08-03. [L03].
**S14.** John Cabot University, *Bloomberg Guide — Commands to Get Started*. [L01].
**S15.** New York Institute of Technology, *Bloomberg Terminal — The Keys*, updated 2026-08-03. [L01, L02, L03].
**S16.** Wharton / Lippincott Library (Datapoints), *Bloomberg Launchpad Part One: Basics*, 2013-03-11. [L02].
**S17.** Wharton / Lippincott Library, *Part II — Creating a Monitor or Watch List*, 2013-04-08. [L02].
**S18.** Wharton / Lippincott Library, *Part III — Adding Components and Pages and Organizing the Group View*, 2013-09-02. [L02].
**S19.** Wharton / Lippincott Library (Datapoints), *Bloomberg FX functions part 2: Charting features*, 2016-04-29. [L06].
**S20.** Holowczak.com, *The Bloomberg Essentials Online Training Program (BESS)*, 2013-12-30. [L02].
**S21.** U.S. Dept of Commerce, Commerce Research Library, *Getting Started — The Bloomberg Terminal*, updated 2026-06-11. [L03].
**S22.** Stanford Libraries, *Bloomberg Terminal Guide — Tips and Tricks*, updated 2025-06-12. [L03, L06].
**S23.** Johns Hopkins Sheridan Libraries, *Bloomberg — News*, updated 2026-05-20. [L03].
**S24.** Johns Hopkins University Libraries, *Bloomberg — broad markets*, updated 2026-05-20 (separate page). [L02].
**S25.** Pace University Library, *Bloomberg — Mnemonics*, updated 2026-05-11. [L03].
**S26.** University of Delaware (Lerner), *Bloomberg Functions List* (web page). [L03, L06].
**S27.** Chicago Booth, *Bloomberg Station Reference Guide* PDF. [L03].
**S28.** University of Scranton (Kania SOM), *Bloomberg Training Manual*. [L02, L03, L04, L05, L06].
**S29.** University of Scranton (Kania SOM), *Technical Analysis / Equity Charting* PDF (separate document). [L03, L06].
**S30.** Georgia State University Library, *Bloomberg — Help & Training*, updated 2026-08-03. [L03].
**S31.** University of Baltimore Law Library, *Bloomberg Law — Alerts and Current Awareness* (contrast/negative use only — a different product). [L03].
**S32.** Babson College, Stephen D. Cutler Center for Investments and Finance, *Equity Valuation using Bloomberg*, Alex Bowers ('25). [L04, L05].
**S33.** Baruch College Newman Library, *Earnings — Guidance / Estimates / Call Transcripts* research guide. [L04].
**S34.** Baruch College Newman Library, *FIN 4775: Technical Analysis — Bloomberg Professional & FactSet* (separate page). [L06].
**S35.** New York Public Library Research Centers, *Bloomberg Terminal — Earnings & Estimates* / *Company Financial Information — Earnings Calls*. [L04].
**S36.** WU Vienna University Library, *Forecasts in Bloomberg — Students Manual*. [L04].
**S37.** University of San Diego Libraries, *Common Functions Equity Research — Bloomberg Terminals*. [L04, L05].
**S38.** Western University, *Bloomberg — Bloomberg Intelligence*. [L04].
**S39.** Copenhagen Business School Library, *Function — Earnings analysis: Price reaction (EA)*. [L04].
**S40.** Copenhagen Business School Library, *Relative Valuation — Second step* (separate page). [L05].
**S41.** Copenhagen Business School Library, *Function — Financial Analysis (FA)* (separate page). [L05].
**S42.** Copenhagen Business School Library, *Bloomberg — GP function* (separate page). [L06].
**S43.** ISEG Lisbon LibGuides, *Functions — Terminal Bloomberg EN*. [L04, L06].
**S44.** ISEG Lisbon LibGuides, *Terminal Bloomberg — Performing analysis* (separate page). [L06].
**S45.** Corporate Finance Institute, *Bloomberg Terminal Functions & Shortcuts — Complete List*. [L03, L04, L06].
**S46.** CT Acquisitions, *Sell-Side Analyst: 2026 IB Career Guide*. [L04].
**S47.** A. Damodaran (NYU Stern), *Using the Bloomberg terminal for data*. [L05].
**S48.** Università Bocconi Library, *Peer analysis — Bloomberg*. [L05].
**S49.** Università Bocconi LibGuides, *Stocks and deals screening* (separate page). [L06].
**S50.** IESE Business School Library, *Companies: Peers analysis — How-To*. [L05].
**S51.** Tufts University Library, *Company/Industry Valuation — Bloomberg*. [L05].
**S52.** Brooklyn College Library (CUNY), *Company Information — Bloomberg Terminal*. [L05].
**S53.** Singapore Management University Libraries, *Company Information — How do I use Bloomberg*. [L05].
**S54.** SMU LibFAQ, "#NA limit" error. [L07].
**S55.** CMU Libraries, *Key Functions & Cheat Sheets — Bloomberg Terminal Workstation* (index page). [L05].
**S56.** University of South Carolina Libraries, *Bloomberg Guide — Equity*. [L06].
**S57.** Cranfield University Library blog, *Introducing... W — Bloomberg's Security Worksheet function*, 2025-02-27. [L02].
**S58.** Cranfield University Library blog, *How do I create a share price graph in Bloomberg?* (separate post). [L06].
**S59.** York University Libraries, *Bloomberg Getting Started Guide — Equities*. [L06].
**S60.** FINM-32900 Full Stack Quantitative Finance course notes, University of Chicago, *The Bloomberg Terminal*. [L05].
**S61.** Penn Libraries, *Bloomberg Help Guide*, updated 2026-08-04 (general/no-Launchpad page). [L02].
**S62.** Penn Libraries, *Bloomberg "API/Excel" guide* (separate page). [L07].
**S63.** Emory Libraries, *Bloomberg Monthly Data Download Limits* PDF. [L07].
**S64.** University Innsbruck (UIBK), *Bloomberg Data Limits for Excel* PDF. [L07].
**S65.** Boston College Libraries, *Bloomberg exporting guide*. [L07].
**S66.** University of Utah, *Bloomberg exporting/screenshots guide*. [L07].
**S67.** McGill Library, *Bloomberg guide*. [L07].
**S68.** Dartmouth College Research Guides, *Bloomberg: Training*. [L08].
**S69.** MathWorks, `blp.eqs` (vendor documentation of Bloomberg's official V3 API). [L06].
**S70.** FinTools, "BQL for Excel" (vendor page). [L07].

### Secondary — practitioner, community, trade press, and professional reviews

**S71.** Olivier Gillier (investment strategist; co-founder, RioBlanco Capital), *"Harnessing Bloomberg Terminal: Key Functions for Market Analysts,"* 2026-04-08. [L01].
**S72.** Ted Merz (formerly Bloomberg News), *"Bloomberg's Quirky Functions,"* 2025-03-20 — negative result. [L01].
**S73.** Wall Street Prep, *Bloomberg vs. Capital IQ vs. FactSet vs. Refinitiv*, professional review. [L05].
**S74.** Michael Mao, *Bloomberg Query Language (BQL)* (gitbook), practitioner. [L06].
**S75.** iqmo Tech Blog, *BQL Notes (WIP)*, practitioner. [L06].
**S76.** Smarsh, Instant Bloomberg channel page (vendor). [L07].
**S77.** SteelEye, Bloomberg IB data connector page (vendor). [L07].
**S78.** WatersTechnology, Bloomberg chatbots coverage (trade press, via search summary). [L07].
**S79.** MarketsMedia, *Bloomberg Introduces Agentic AI to the Terminal*, 2026-02-23. [L03].
**S80.** The DESK (fi-desk.com), *Bloomberg Terminal releases document search and analysis feature*, 2025-06-16. [L03].
**S81.** Global Custodian, *Bloomberg Introduces New Desktop 'Launchpad'*, 2002-06-17, trade press. [L02].
**S82.** *How to Use the Bloomberg Terminal*, journalism data-bootcamp deck, practitioner (23-year Terminal user). [L03].
**S83.** TrustRadius, vetted professional review dated 2025-11-04, Financial Analyst at Perbak Capital Partners. [L08].
**S84.** Harvard Business School student platform-economics blog, *"Symphony: Attacking a Dominate Network,"* 2015-10-19 — coursework analysis, not institutional. [L08].
**S85.** The Terminalist (Substack), *"Bloomberg's 7 Powers & Why the Terminal dominates financial markets,"* 2024-09-20. [L08].
**S86.** Oswarld (Kwangseob Ahn), *"Bloomberg Terminal Is Ugly and Clunky — Everyone Still Uses It,"* 2026-04-24. [L08].
**S87.** Hacker News thread 13736009, *Ask HN: What is so great about Bloomberg Terminal?*, 2017-02-26 — comments by HoyaSaxa, hueving, uptown (API-verified). [L08].
**S88.** Hacker News thread 17079033, 2018-05-16 — comment by evrydayhustling (API-verified). [L08].
**S89.** Hacker News thread 45823234, *My family business runs on a 1993-era TUI*, 2025-11-05/06 — comments by angiolillo (former Bloomberg UX designer), fakedang, FarmerPotato (API-verified). [L08].
**S90.** Hacker News thread 9393884, *Bloomberg Terminals Suffer Widespread Failures*, 2015-04-17 — comment by chollida1 (API-verified). [L08].
**S91.** Hacker News thread 21844740, *The Bloomberg Terminal, Explained*, 2019-12-20/21 — Terminal stability testimony (read via browser, 429 to fetcher). [L02].
**S92.** Hacker News thread 23891161, *Why it's hard to kill the Bloomberg terminal (2019)*, 2020-07-19 — **quotes unverified, page-summariser only.** [L08].
**S93.** Reddit r/bloomberg thread rlqhpm, 2021-12-21 — comments by IHateHangovers, GManASG (raw JSON-verified). [L08].
**S94.** Reddit r/finance thread 1ebldh, 2013-05-14 — comments by skimania, YAYYYwork, oblisk (raw JSON-verified). [L08].
**S95.** readkong.com transcription of Bloomberg's Launchpad guide — used only to locate P8/P9, every claim re-verified against the primaries. [L02].
**S96.** Financial Times, *Thomson Reuters tackles Bloomberg chat dominance*, 2013-08-04 — paywalled, search-snippet only. [L08].
**S97.** Bloomberg IB engineering job description (200M messages/day figure) — uncertain provenance, third-party reproduction. [L08].

### Primary — Bloomberg-authored, added by leaf 09 (2026-09-02, multi-asset analytics gap-closer)

**P57.** Bloomberg Economics research product page. `professional.bloomberg.com/products/bloomberg-terminal/research/economics/` — official product page. [L09 §1].
**P58.** Bloomberg FX electronic-trading product page. `professional.bloomberg.com/products/trading/electronic-markets/fx-electronic/` — official product page. [L09 §4].
**P59.** Bloomberg commodities page. `professional.bloomberg.com/institutions/corporations/commodities/` — official product page. [L09 §5].
**P60.** Bloomberg Portfolio & Risk Analytics landing page. `professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics/` — official product page. [L09 §7].
**P61.** Bloomberg MARS product page. `professional.bloomberg.com/products/risk/mars/` — official product page. [L09 §7].
**P62.** Bloomberg MAC3 product page. `professional.bloomberg.com/products/risk/mac3/` — official product page. [L09 §7].
**P63.** Bloomberg LQA product page. `professional.bloomberg.com/products/risk/lqa/` — official product page. [L09 §7].
**P64.** Bloomberg reference-data product page. `professional.bloomberg.com/products/data/enterprise-catalog/reference/` — official product page. [L09 §8, §10].
**P65.** Bloomberg pricing-data (BVAL) product page. `professional.bloomberg.com/products/data/enterprise-catalog/pricing/` — official product page. [L09 §3].
**P66.** Bloomberg Intelligence research product page. `professional.bloomberg.com/products/bloomberg-terminal/research/bloomberg-intelligence/` — official product page. [L09 §3, §E.7].
**P67.** Bloomberg Investment Research Data product page. `professional.bloomberg.com/products/data/enterprise-catalog/investment-research-data/` — official product page. [L09 §10 background].
**P68.** Bloomberg index-derivatives product page. `professional.bloomberg.com/products/indices/index-derivatives/` — official product page. [L09 §4].
**P69.** University of Scranton (Kania SOM), *Fixed Income Functions* PDF, screenshot-driven, ~2015-vintage content. `scranton.edu/academics/ksom/alperin/Fixed%20Income.pdf` — tier: official-adjacent/demonstrated. [L09 §1–3, §8].
**P70.** Bloomberg *Real-Time Volatilities* fact sheet, ©2018, doc 291550 DIG 1118. `data.bloomberglp.com/professional/sites/10/750114_Real-Time-Volatilities.pdf` — official fact sheet. [L09 §6, §9, §12].
**P71.** Bloomberg *Getting Started* function-code sheet (official, Bloomberg-branded), hosted by Stevens Institute. `web.stevens.edu/hfslwiki/images/b/b0/Bloomberg_Tutorial_Commands.pdf` — official cheat sheet. [L09 §1, §3–5, §7].
**P72.** Bloomberg *Portfolio & Risk Analytics* brochure, ©2015, doc S604201473 0715. `data.bloomberglp.com/professional/sites/4/Portfolio_and_Risk_Analytics_Brochure4.pdf` — official brochure. [L09 §7].

### Secondary — university library guides, added by leaf 09

**S98.** Harvard Business School, Baker Library, *Bloomberg: options*. `library.hbs.edu/services/help-center/bloomberg-options` — university help center. [L09 §6].
**S99.** Singapore Management University Libraries, *Company Information — How do I use Bloomberg*. `researchguides.smu.edu.sg/c.php?g=421858&p=6787263` — university library guide. [L09 §10].
**S100.** Baruch College Newman Library, *Bloomberg Professional* guide. `guides.newman.baruch.cuny.edu/AccessFinData/BloombergProfessional` — university library guide. [L09 §11].
**S101.** Johns Hopkins University Libraries, *Fixed Income — Bloomberg*. `guides.library.jhu.edu/bloomberg/bonds` — university library guide. [L09 §3].
**S102.** Southern Methodist University, *Fixed Income — Bloomberg: Getting Started*. `guides.smu.edu/c.php?g=1141901&p=9762110` — university library guide. [L09 §3].
**S103.** University of Florida Business Library, *YAS: Yield and Spread Analysis*. `businesslibrary.uflib.ufl.edu/c.php?g=114612&p=746563` — university library guide. [L09 §3].
**S104.** Florida Gulf Coast University Library, *Yield and Spread Analysis* / *Yield Curves*. `library.fgcu.edu/bloomberg/yield_and_spread_analysis`, `.../yield_curves` — university library guide. [L09 §2–3].
**S105.** University of Virginia, Darden School, Camp Library, *Bloomberg — Corporate Bond Information*. `darden.libguides.com/corporatebonds/bloomberg` — university library guide. [L09 §3].

### Unverified / recorded as source-quality findings, not evidence

**U1.** Wall Street Oasis, two Launchpad threads — human replies gated behind email signup; visible content is bot/AI-generated and contains a verified factual error (`W` glossed as "World Markets"). **Not used as evidence.** [L02].
**U2.** GitHub repo `api-evangelist/bloomberg-instant-messaging` — reads like official documentation but is a third-party artefact. **Not used as evidence.** [L07].
**U3.** Medium post, "Introduction to Bloomberg" (Specialist Library Support) — claim about FA's Adjusted/As-Reported click target, HTTP 403, second-hand only. [L05].
**U4.** studylib.net Bloomberg training document mirror — HTTP 429 on repeated attempts, chart-template semantics claim unverified. [L06].
**U5.** A search-result-summary attribution of an ">99.99% correct, SLA-guaranteed" accuracy claim and a contradicting "Bloomberg data is often unreliable" claim — both wording/attribution unverified, recorded only to show the corpus contains both positions. [L08].
**U6.** A cluster of homework-answer-mill pages (`chegg.com`, `transtutors.com`, `studyx.ai`, `brainly.com`, `numerade.com`) reproducing one shared course assignment's `OMON` question verbatim — 9 of 19 Brave-search results for one query. **Not used as evidence**; recorded as a source-quality observation about that query's result composition. [L09 §6, GAPS].
**U7.** `wallstreetoasis.com`'s Bloomberg functions-list page, surfaced in two L09 search-result sets but not fetched — consistent with, not independently re-confirming, the original pod's finding that WSO 403s automated fetchers [§O, U1]. [L09 GAPS].

---

## NOT INSPECTED

* **Any live Bloomberg Terminal session, in any leaf, at any point in this pod.** No screen was operated; no keystroke was timed; no autocomplete list, Suggested Functions panel, `TECH <GO>` study catalogue, `EQS` results toolbar, or Launchpad Component Browser was ever seen rendered. This is the single largest exclusion and is the ceiling behind virtually every 🟡/🔴 rating in this file (see Section O).
* **`bloomberg.com`'s primary domain** — Help Center, FAQ, and most `/company/press/*` and `/professional/insights/*` paths returned HTTP 403 or a CAPTCHA to every fetch method (direct WebFetch, browser tab) used across all eight leaves. Only mirror hosts (`professional.bloomberg.com`, `professional.content.cirrus.bloomberg.com`, `data.bloomberglp.com`, `assets.bbhub.io`) and PR Newswire copies were reachable.
* **`reddit.com`** at the domain level was blocked to at least one leaf's fetch tooling; the two Reddit threads used as evidence ([S93], [S94]) were reached via raw `.json` endpoints as a workaround, not the domain generally, and no systematic Reddit sweep was performed for any topic.
* **`wallstreetoasis.com` and `g2.com`** returned HTTP 403 throughout; WSO in particular is named in more than one leaf's contract as an intended practitioner source and is not represented as evidence anywhere in this dossier (only as a documented source-quality dead end, [U1]).
* **The commercial Bloomberg Terminal subscription agreement.** Only the published trial licence was reachable; the paid agreement, and Bloomberg's referenced "Desktop API Guidelines," are not public documents.
* **Any video content, in full.** Several Bloomberg-authored tutorial and Pro Tips episodes are cited by chapter title and timestamp (page metadata, which is text and was read), but no video was viewed or transcribed by any leaf, per the external preamble's rule against inferring what a video shows.
* **The UCT dashboard codebase itself.** This is a pod-synthesis contract (read the eight leaves, write the dossier); per RULES this task performed no new inspection of `uct-dashboard`. Every UCT-side claim in Sections A–N is carried from the leaves, which drew it from `CLAUDE.md` and user memory, and is a CLAIM, not CONFIRMED, per the shared preamble.
* **Macro, rates, volatility surface, and credit-analysis workflows** (Workflow G) — **partially closed 2026-09-02 by leaf 09**; the individual-screen inventory is now researched (Section E.7 above), but the *chaining* of these screens into a single regime read remains an unresearched, named ceiling.
* **Any owner-supplied artifact** (a Terminal seat, a screen recording, a practitioner interview) — OI-08 was not supplied to this pod at any point; every ceiling in Section P names it as the raising artifact and none was available.
* **Preferred securities (`PFD`) function depth** — leaf 09 searched for this specifically and found nothing; genuinely unresearched by either wave of this program.
* **A live URL for Xavier University's 15-part Bloomberg derivatives course-guide series** ("Bloomberg Derivative Information and Functions") — located by title via Brave search; the specific file fetched 404'd, and no working alternative URL was found. Would likely extend §6 of leaf 09 if reached.
* **Bloomberg's real-time market-data entitlement / exchange-fee structure** — surfaced only incidentally in leaf 09 (one university guide's "real-time, delayed 15 minutes" seat description); neither wave of this program has directly researched Bloomberg's real-time-vs-delayed licensing tiers as their own topic.
* **`claude-in-chrome` (the browser-search fallback named in the External Preamble's search-budget ladder)** — the extension was not connected in the session that produced leaf 09; Bing and Google via plain WebFetch returned unusable, query-independent generic results, and DuckDuckGo CAPTCHA-walled every request. `search.brave.com`'s results page, fetched via plain WebFetch, was the only search channel that worked — recorded for any future contract facing the same WebSearch-exhausted, browser-unreachable combination.

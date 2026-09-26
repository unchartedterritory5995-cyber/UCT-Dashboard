---
id: F-06
title: The forty executive questions — first draft with confidence tags
role: Executive synthesizer (Group F) — single writer of executive-questions.md and DAY_1_EXECUTIVE_SYNTHESIS.md
wave: 2
group: F
category: synthesis
scope: program-wide synthesis over the Wave 1 internal reports, the Wave 2 internal syntheses (system map, capability ledger, tech-debt register, provider ledger, licensing register, data-use classification), the program-control files, and the Day 1b competitive files present on disk at write time
confidence: 🟡 overall (10 🟢 · 23 🟡 · 7 🔴 across forty answers)
evidence_ceiling: No production telemetry (page_views, calendar_seen, alert fires, AI usage, spend ledgers) was readable by any leaf; no vendor contract has been seen; the owner-input batch (OI-01..OI-19) is unanswered; the Bloomberg pod dossier and the licensing register were still being completed by sibling tasks when this draft was written, so their leaf files and the data-use classification were used directly; competitive dossiers were read after the first draft (see "Changed since last checkpoint" on each answer). Every answer below is a DRAFT hypothesis for the Executive Product Council, not a decision.
sources: 00-program-control/{GOVERNING_PRINCIPLES,CRITICAL_PATH,OWNER_DECISIONS,OWNER_INPUTS_REQUESTED,RISK_REGISTER,RESEARCH_GAPS,OPEN_QUESTIONS,DECISION_LOG,PROGRAM_STATUS}.md · charter/C-master-directive.md Parts CLXXXV, CCXLVIII, CCXLIX · 01-existing-system/{system-map,capability-ledger,tech-debt-register,terminal-current-map,flags-and-entitlements,state-persistence-and-workspaces,ecosystem-cartography}.md · 02-data-providers/{provider-ledger,railway-flag-state}.md · 07-technical-architecture/{current-performance-and-realtime,current-ui-architecture}.md · 08-ai/existing-ai-systems.md · 05-product-strategy/proprietary-asset-inventory-raw.md · 09-security-licensing-cost/{licensing-register,data-use-classification}.md · 10-roadmap/coexistence-current-mechanisms.md · 03-competitive-research/benchmark-universe.md, bloomberg/*.md, godel/01-evidence.md, desk-tools/*.md, <product>/dossier.md (as present)
uct_relevance: high
status: draft
date: 2026-09-02
---

# The forty executive questions — first draft (Document C Part CLXXXV)

**Vocabulary.** TERMINAL-CURRENT = the surface at route `/calendar`, display-named "UCT Terminal" since 2026-09-01; its route, door key `calendar`, widget type key, `/api/calendar/*`, filenames, CSS classes and five persisted preference keys are unchanged and are preserved in every answer below. TERMINAL-NEXT = the product this program designs. UT is the parent brand; UCT Intelligence is the product.

**How to read this file.** One block per question: **Answer (draft)** · **Evidence** (artifact path + section, leaf id) · **Confidence** (🟢🟡🔴 with the reason) · **What would raise it** · **Changed since last checkpoint**. Observations are never requirements; "product X does Y" is never an argument on its own (charter Parts CCXLVIII–CCXLIX); licensing classes and owner-input defaults are carried exactly as the register states them (never upgraded); counts are measured from the cited artifacts or marked unknown. Leaf key: D-01..D-14 (Wave 1 internal), E-01..E-04 (licensing pod), F-03a/F-03b/F-04/E-02 (syntheses), ORCH (`railway-flag-state.md`), MAP (`system-map.md`), LEDGER (`capability-ledger.md`, row ids A1…P11), TD-nn (`tech-debt-register.md`), REG (`licensing-register.md`, rows T-nn / N-nn), B-* (competitive files).

---

## Scoreboard (first draft)

| Group | Questions | 🟢 | 🟡 | 🔴 |
|---|---|---|---|---|
| Product | 1–5 | 0 | 4 | 1 (Q2) |
| Trading | 6–10 | 1 (Q7) | 2 | 2 (Q8, Q10) |
| Research | 11–15 | 2 (Q14, Q15) | 3 | 0 |
| Data | 16–20 | 3 (Q16, Q17, Q20) | 1 | 1 (Q18) |
| Engineering | 21–25 | 2 (Q22, Q23) | 3 | 0 |
| UX | 26–30 | 0 | 4 | 1 (Q26) |
| AI | 31–35 | 2 (Q32, Q33) | 3 | 0 |
| Business | 36–40 | 0 | 3 | 2 (Q36, Q37) |
| **Total** | **40** | **10** | **23** | **7** |

**What the colours mean here.** 🟢 = the answer rests on measured internal evidence and would not change with more research this week (it may still change with an owner decision). 🟡 = the answer is well-grounded in what exists but the *should* half is a hypothesis awaiting benchmark evidence, owner input, or a red-team pass. 🔴 = the answer is a placeholder: the evidence that would settle it either does not exist yet (dossiers in flight, cost model unwritten) or is owner-only (OI-01, OI-06, OI-10, OI-12).

**Where the reds sit.** Three clusters, not seven scattered gaps: (a) **the desk's real daily loop and the tools it opens by hand** — Q8, Q10, Q26 — the repositories cannot answer this (thinkorswim appears in no repo; TradingView only as links; D-14 §7) and OI-06 is unanswered; (b) **commercial** — Q18, Q36, Q37 — no measured spend, no usage telemetry, no member/tier mix (OI-01, OI-10, OI-12), the cost model (E-05/E-06) not yet written; (c) **table stakes** — Q2 — a benchmark question that the Day 1b dossiers answer once read against the capability ledger.

## Reallocation advice (first draft)

Internal archaeology has reached diminishing returns for this synthesis: 178 capability rows (LEDGER §R), 72 debt entries (TD register), 48 provider rows (F-03b), 118 licensing rows (REG §1C) and ten reconciliations-of-reconciliations already exist, and the remaining internal unknowns are almost all *production reads the program is forbidden to make* (DL-013) or *owner facts*. Move capacity as follows. **(1) Desk workflow, by observation not by grep** — one owner-present "observed morning" (06:30–10:00 CT) reconstructed as a timeline of screens opened, in UCT and outside it, would convert Q1, Q6, Q8, Q9, Q10 and Q26 from inference to measurement in a single session; the four desk-tool files should be read *against* that timeline, not instead of it. **(2) The two owner facts that move 57 licensing rows** (OI-03a the Massive tier; OI-03b the FMP DDLA) are one billing-page lookup and one email; they gate Q18, Q19, Q37 and Q39 and should be chased before any further licensing research. **(3) The cost model** (E-05/E-06) is the only artifact that can turn Q18, Q36–Q39 from lists into numbers; start it on the labelled-assumption basis the charter allows rather than waiting for OI-10. **(4) Benchmark reading should be targeted at Q2/Q26/Q27/Q28** (table stakes, one-click, keyboard, ticker-context propagation) rather than at feature parity; the coverage map already has the breadth. **(5) One owner-run telemetry read** (`page_views` by route, `calendar_seen` by item_type, `calendar_alerts_fired`, `ai_search_log` volumes) would raise Q5, Q11, Q36 and Q38 more than any agent-hour can, at zero program risk (the queries are listed in D-13 §0 and D-09 §11). Do not add more internal leaf roles; do add verifiers on the five claims that matter most (Q3 differentiators, Q22 bottlenecks, Q39 per-user costs).

---

## Product

### Q1 — What are the five most important workflows Terminal-Next must dominate?

**Answer (draft).** The evidence supports five candidate workflows, ordered by how much of the existing estate already serves each: **(1) The pre-market prep loop** — the Morning Wire (the only free page; producer runs 06:35 CT on the owner's PC), scanner candidates (in-process inside the wire), the earnings week (TERMINAL-CURRENT), the Exposure Rating and the UCT20 Book, consumed in that order before the open. **(2) "What is moving, and why, right now"** — movers, the catalysts tile, the live options tape, dark pool, the Wire view's arrival-ordered prints, and the awareness engine's proactive insights. **(3) "Understand this name, now"** — the twelve-panel research modal (Setup · Company · The Print · Coverage · Ask AI), the `?earnings=SYM&esection=` deep link, TickerPopup, Desk mentions, and the four per-ticker histories that no surface yet unions. **(4) Scan → chart → decide** — saved scan definitions and the nightly sweep, the 157-column screener, `ChartPane`, then `grade_ticker` / `size_a_trade` under the regime-first sizing table. **(5) Monitor what I own and watch** — watchlists, price/line/indicator alerts, the SnapTrade broker mirror, the journal's positions, pre-report alerts and Compass interventions. The UCT-specific claim is that (1) and (4) are where the house method lives and (3) is where the proprietary record could be surfaced; (2) and (5) are where benchmarks are strongest. This is a hypothesis: no usage telemetry was read, and the desk's own daily loop is owner-only until OI-06 is answered.

**Evidence.** `terminal-current-map.md` §7 (workflows W1–W9, all 🟡, "inference from code, comments, tests and owner decisions"); `capability-ledger.md` rows N1–N3 (wire, push contract, UCT20/Book), K8 (catalysts), F1/F5 (tape, dark pool), E2–E4 (the calendar surface, Wire, deep link), D1 (research modal), G1–G2/G5 (screener, scans, scanner), I1/I3/J4 (watchlists, alerts, broker mirror), K4/K7 (Compass, awareness); `proprietary-asset-inventory-raw.md` §2, §3, §10, §11; `ecosystem-cartography.md` §7 (desk tools — "code cannot answer what the owner actually uses at the desk"); `system-map.md` §5.4 (what the PC supplies daily).

**Confidence.** 🟡 — the five are grounded in what exists and in the house doctrine, but the *ranking* and the *dominate* verb are unmeasured: OI-06 is unanswered, no telemetry was read, and the desk-tool benchmark files were not yet read when this draft was written.

**What would raise it.** OI-06 (tools opened daily, in order of time spent); one owner-observed morning reconstructed as a timeline; an owner-run `page_views`-by-route read; the desk-tool dossiers read against that timeline; F-07's ranked JTBD library (gate item 10).

**Changed since last checkpoint.** first draft.

### Q2 — What ten capabilities are table stakes?

**Answer (draft).** From the internal estate alone, ten capabilities recur across every surface a member already uses and are therefore table stakes *for UCT's own users*, whatever the benchmarks say: (1) a linked price chart with timeframes, drawings and indicators (`ChartPane`, B1–B5); (2) live quotes and a watchlist with alerts (A1/A2, I1, I3); (3) a symbol search that resolves any ticker (A8); (4) an earnings/economic event calendar with per-ticker depth (E1–E4, D1); (5) fundamentals, estimates and earnings history per name (D2–D4); (6) news and filings per name (M6, D7); (7) a screener with saved screens (G1–G3); (8) options chain, flow and dark pool (F1, F5, F10 — for an options-active desk); (9) a multi-panel, persisted, linkable workspace (C1–C7); (10) keyboard-first operation with a command surface (which the estate lacks — TD-07). The benchmark half of this answer — what *professional* terminals treat as non-negotiable and in what form — is deliberately left open in this draft: the Day 1b dossiers were not yet read against the capability ledger when it was written, and "product X does Y" is not an argument by itself.

**Evidence.** `capability-ledger.md` sections A–I (row ids above) and §R (178 rows); `current-ui-architecture.md` §8 (reusability verdicts: command palette *absent*, form controls *absent*, number formatting *absent*); `tech-debt-register.md` TD-06, TD-07, TD-08; `benchmark-universe.md` (validated universe, DL-017) — dossiers pending read.

**Confidence.** 🔴 — the internal half is 🟢 (measured), but the question asks for table stakes in the professional-terminal sense, and that half is unanswered until the Bloomberg workflow files, the Gödel evidence file and the standard dossiers are read and the capability matrix (F-05, gate item 9) exists.

**What would raise it.** Reading the eight Bloomberg workflow files, `godel/01-evidence.md` and the desk-tool files against the ledger; F-05's capability matrix and best-of-breed matrix; the light red team on benchmarks (G-*, Day 2).

**Changed since last checkpoint.** first draft.

### Q3 — What five capabilities could genuinely differentiate us?

**Answer (draft).** Five, each grounded in an asset a competitor cannot buy (D-13 §12 Tier 1) rather than in a feature: **(1) Decision provenance — "what the desk said about SYM, and what it rejected"** — `leadership_snapshots` (4,440 theses across 1,038 symbols since 2026-02-19), `wire_universe` (19,050 considered-and-dropped rows with `drop_reason` across 43 issues), `setup_triggers` (243 published entries with resolved outcomes), the Desk's `ticker_moments`, and the published Substack archive; the join does not exist yet and is "the single strongest Terminal-Next differentiator available from existing assets" (D-13 §11). **(2) A track record with the losses in it** — the Book's mandatory no-stops control arm, the public Flow Scoreboard's locked honesty rules, the six-gate lift ledger (25 measured, 3 published), `trigger_performance` showing negative expectancies on named house setups. **(3) The UCT way as executable constants** — the regime × grade sizing table, the 0–150 exposure model with one authority, `grade_ticker`'s structurally decisive GO/HOLD/SKIP, `portfolio_heat`'s 10% cap, `personal_edge`'s per-member expectancy — a mentor that cannot hedge and cannot fabricate. **(4) Honesty primitives on every surface** — the Wire's three-state completeness line that names the missing companies, `CoverageLine`'s four counts with `withheld` beside them, typed refusals on expected move, "grounded on" chips on AI answers. **(5) The room and the voice** — the 7,766-message classified trading-room record (frozen 2026-02-20, consent basis U) and the quantified voice models of two named writers. Caveat carried from the licensing register: (1)–(3) publish "investment strategy"-shaped composites that REG classes R/R at either Massive tier until Massive answers §6.1(j) in writing (REG T-12).

**Evidence.** `proprietary-asset-inventory-raw.md` §1 (KB composition, 57.7% first-party), §2 (wire decision index), §3 (Book + triggers: win 47 / loss 81 / never_triggered 57 / open 57), §5 (lift ledger), §7 (scoreboard honesty rules), §9 (room record), §10 (constants table), §11 (four histories, no join), §12 (uniqueness ranking, 🟡 by its own admission); `terminal-current-map.md` §1.1 W3 and §11.1 L5 (the Wire trust line); `capability-ledger.md` G2 (`CoverageLine`), K2 ("grounded on" chips), K4 (`grade_ticker`, `personal_edge`); `existing-ai-systems.md` §3c, §6; `licensing-register.md` T-12, T-27 (composites R/R; scoreboard public R); `data-use-classification.md` §2.12 (the `#tsdr` corpus U on consent).

**Confidence.** 🟡 — the assets are measured (🟢 counts) but "genuinely differentiate" requires the competitive evidence (does any benchmark already ship decision provenance or a losses-included record?) and two owner facts (Massive §6.1(j); OI-15 consent). D-13 rates its own ranking 🟡.

**What would raise it.** F-05's best-of-breed matrix testing each of the five against the dossiers ("if a competitor already ships something in Tier 1, that is the finding that matters most" — D-13 §12); a written Massive answer on §6.1(j); OI-15; the G-* red team on differentiation.

**Changed since last checkpoint.** first draft.

### Q4 — What capabilities should explicitly not be built during the first year?

**Answer (draft).** Nine, each with its reason in the evidence: (1) **execution / order management** and (2) **FX, fixed income, crypto** — owner defaults (GOVERNING_PRINCIPLES §13), and the stack has no provider for FX/crypto bars, credit, or futures quotes (F-03b §3.2); (3) **Level 2 / order book** — no provider, exchange-level non-display fees, and not an owner-stated need; (4) **member-facing real-time single-symbol quotes and real-time OPRA prints beyond what exists today** until OI-03(a)/OI-09 are answered — REG classes them R and per-user-priced ("the single most expensive primitive in the product", REG N-01, N-07); (5) **any public marketing surface carrying live vendor data** (a live-stats landing page, an open leaderboard, a public scan of the day) — R at either Massive tier (REG N-23); (6) **a `StockChart.jsx` rewrite inside Terminal-Next scope** — mount `ChartPane`, treat the 15,500-line file as a black box with a contract (TD-01); (7) **a phone-first dense terminal** — RG-10's owner default is desktop-first, phone = monitoring only; (8) **any AI lane that trains a model on member, X, Reddit or vendor content** — X-class rows (REG T-67, T-69, T-71–T-76); (9) **a third keyboard system, a second cohort mechanism, a fifth copy of `FREE_PAGES`, a sixth table implementation, or a second Polygon-family vendor** — the second-authority-over-one-value class the repo names as its most expensive defect (TD-20). A tenth candidate — a separate Terminal-Next calendar data path — is a coexistence risk rather than a year-one exclusion (D-08 Option F: "share the endpoint, not a copy").

**Evidence.** `GOVERNING_PRINCIPLES.md` §13; `provider-ledger.md` §3.2, §3.4; `licensing-register.md` N-01, N-07, N-18, N-23, T-67–T-76; `tech-debt-register.md` TD-01, TD-05, TD-06, TD-07, TD-20; `RESEARCH_GAPS.md` RG-10; `coexistence-current-mechanisms.md` §5 Option F; `existing-ai-systems.md` §8 #3.

**Confidence.** 🟡 — (1)–(3) and (8)–(9) are 🟢 on the evidence and the defaults; (4)–(5) are conditional on owner facts; (6)–(7) are judgement calls the architecture roles and the red team must ratify.

**What would raise it.** OI-03(a), OI-05, OI-09; the Tier S–X prioritisation (gate item 13) and its red-team verdict; ARCH proposals stating the `StockChart` assumption explicitly (RG-05).

**Changed since last checkpoint.** first draft.

### Q5 — What makes the terminal worth returning to every trading day?

**Answer (draft).** Today the daily reasons are produced by *pipelines*, not by the surface: the Morning Wire lands at 07:35 ET (the only free page, with per-segment feedback that changes tomorrow's brief), the catalysts tile refreshes in pre-market bursts, `TodaysBrief` answers "which of my names print today" in five seconds (its own file calls it "the retention moat"), the Wire view shows what just printed with a completeness line, the awareness engine notices stops and regime flips every 20 minutes, and Compass sends an EOD recap and a Sunday review. What would make TERMINAL-NEXT itself the daily door is (a) putting those artifacts in one place ordered by the session (pre-market → open → close), (b) the personal layer — "your names", your positions via the broker mirror, your own expectancy — and (c) the per-ticker provenance join (Q3 #1), which turns every name into "what we said last time". Two facts temper this: every daily artifact the PC produces stops when the owner's machine is off or on battery (wire, exposure, leadership, UCT20, breadth day row, brain pack — no second host exists), and no telemetry says which of today's surfaces members actually return to.

**Evidence.** `terminal-current-map.md` §1.1 (TodaysBrief "the retention moat"), §7 (W1, W3, W9 retention workflows); `capability-ledger.md` N1 (wire, free), K8 (catalyst bursts), K7 (awareness 20-min scan; tile currently unmounted), K4 (EOD recap 16:30, weekly digest); `system-map.md` §5.4 (what stops when the PC is off), §11 #1 (no second host); `proprietary-asset-inventory-raw.md` §2e (the critic loop); `RISK_REGISTER.md` R-09, R-16.

**Confidence.** 🟡 — the mechanisms are 🟢; which of them earn a return visit is 🔴 (no `page_views`, `calendar_seen`, alert-fire or AI-usage read — DL-013).

**What would raise it.** An owner-run read of `page_views` by route and `calendar_seen` by `item_type`; OI-01 (tier mix); the personas/JTBD work (F-07); a desk observation.

**Changed since last checkpoint.** first draft.

---

## Trading

### Q6 — What information does a trader need in the first 30 seconds after a stock begins moving?

**Answer (draft).** Read from what the estate already computes and from the house method: (1) **the move in context** — last price, % change *and relative volume* against 30-day ADV (the momentum desk's own tell; UTP lets real-time volume ride beside a delayed price at no charge, REG N-02); (2) **the chart with the developing bar** on the timeframe the trader lives on (1m/5m, then daily) with the prior-day high/low/close the Top-5 entry types are defined against; (3) **why** — the catalyst engine's thesis, the tape/news line, an earnings print if one landed (the Wire), a dark-pool or options print if one fired; (4) **the regime gate** — exposure score and phase, because the sizing table pays 0% in ORANGE/B and RED regardless of the setup; (5) **the setup and the numbers** — `grade_ticker`'s verdict, entry/stop/target from the trigger ledger, `size_a_trade` under the 2% cap and the 10% heat cap; (6) **whether it is mine** — a position, a watchlist, a UCT20 name, an active alert, and what the desk last said about it. Licensing shapes the first item: the real-time single-symbol quote is "the single most expensive primitive in the product" (REG N-01); the delayed-price / live-volume / live-breadth design is the cheap coherent alternative and is a new build (zero delay-notice strings exist in the codebase — E-02 §1).

**Evidence.** `capability-ledger.md` A1, A5–A7 (quotes, developing bar, movers, snapshots), K8 (catalyst thesis), E3 (Wire), F1/F5 (tape, dark pool), K4 (`grade_ticker`, `portfolio_heat`, `size_a_trade`), B8 (Signature signals), I1/I3 (lists, alerts); `proprietary-asset-inventory-raw.md` §10 (sizing table, `_REGIME_LIMITS`, Top-5 entry types keyed to `prev_day_*`), §3 (trigger ledger); `licensing-register.md` N-01, N-02, N-05; `data-use-classification.md` §7.2 ("volume surge, relative volume and unusual-volume detection carry much of the intraday signal"); `existing-ai-systems.md` §6 (decisiveness is structural).

**Confidence.** 🟡 — every element exists as code or doctrine (🟢), but the *ordering* under time pressure is inferred; no desk observation and no benchmark reading yet.

**What would raise it.** The observed-morning timeline (Q1); OI-06; the desk-tool files (thinkorswim/TradingView first-30-seconds layouts); an owner verdict on the delayed-price/live-volume hypothesis (E-02 §7.2's one-surface, one-week experiment).

**Changed since last checkpoint.** first draft.

### Q7 — What information is currently scattered among different UCT screens?

**Answer (draft).** Measured, not inferred: **per-ticker information lives in at least eleven doors** — `TickerPopup`, the research modal on `/calendar` and `/calendar/mystocks`, `/research/:sym`, the `/charts` widgets (chart, fundamentals, news, calendar-day), the catalysts tile, `/live-massive`, `/dark-pool`, GEX/dealer positioning, the Desk mentions timeline (door NOT DETERMINED, LEDGER L-6), AI Search, Compass, and the journal's position pages. **Four per-ticker histories** (`leadership_snapshots`, `wire_universe`, `setup_triggers`, `ep_*`) plus Desk `ticker_moments`, the Substack archive and the Discord corpus have **no unifying surface** (D-13 §11). **Regime** has two classifiers (engine `market_regimes` vs the dashboard's 15-minute classifier, H6). **Earnings dates** have a second authority in the Discord bot's own `get_catalyst_calendar_context` beside `/api/calendar` (OQ-14), and the forward date itself is assembled from four providers (E1). **The setup vocabulary** exists in four populations with 15 shared names (48 / 32 / 26 / 24, TD-36). Alerts of three kinds (price/line/trendline, indicator, calendar pre-report, catalyst, awareness) share one delivery seam but five configuration surfaces. Session/market-clock state is derived once (`sessionModel.js`) but freshness is rendered five different ways (TD-08). This scatter is the strongest internal argument for a ticker-context bus (Q28) and a provenance join (Q3 #1).

**Evidence.** `capability-ledger.md` §R (178 rows) and rows D1, E2, E4, E17, F1, F5, F6, K2, K4, L8 (L-6 unresolved door); `proprietary-asset-inventory-raw.md` §11; `terminal-current-map.md` §6.5 (bot's own earnings path), §11.2 S1–S7; `tech-debt-register.md` TD-08, TD-20, TD-36; `capability-ledger.md` H6; `OPEN_QUESTIONS.md` OQ-14.

**Confidence.** 🟢 — the scatter is a directory-and-grep measurement replicated across four leaves; which of it *matters to a trader* is 🟡.

**What would raise it.** Nothing internal; the ranking of which scatter costs the desk time is a desk-observation question (Q1).

**Changed since last checkpoint.** first draft.

### Q8 — What external products do our workflows still force us to open?

**Answer (draft).** From the repositories: **Finviz Elite** is a hard operational dependency (the scanner's three screens; the nightly universe export; chart PNGs on drill surfaces) — a Finviz outage empties the scan (observed 2026-08-31); **TradingView** is linked and embedded from `TickerPopup`/`DrillModal` and is "the only external tool the product itself links members out to" (D-14 §7); **Discord** is the community, the alerting channel and two product apps; **Substack** is the newsletter destination; **YouTube/Zoom** carry the Desk; **Whop** carries commerce as prose links; **the owner's own broker** (Schwab/thinkorswim) appears in **no repository** except as the partner-owned API integration — so anything the desk does there by hand is invisible to code. The fourth benchmark slot is provisionally Market Chameleon (DL-017, pending OI-19). What this list cannot say is *time spent* or *which are opened by hand on a trading day*; that is OI-06.

**Evidence.** `ecosystem-cartography.md` §7 (desk tools and external sites, with the thinkorswim absence measured by grep across four repos); `provider-ledger.md` rows 5, 43, 44 and the "not providers" note (TradingView link + iframe only; thinkorswim no reference); `capability-ledger.md` G5, M2, M4, M7, M8, L1; `OWNER_INPUTS_REQUESTED.md` OI-06, OI-19; `DECISION_LOG.md` DL-017; `benchmark-universe.md` (desk-tool slots); `desk-tools/*.md` — not yet read for this draft.

**Confidence.** 🔴 — the code-visible list is 🟢, but the question is about what the *workflow forces open*, which only the owner knows; the four desk-tool files (thinkorswim, TradingView-as-used, Finviz, Market Chameleon) were not yet read when this draft was written.

**What would raise it.** OI-06 (ranked by time spent, one workflow each); OI-19 (options structures); the desk-tool files; the observed morning.

**Changed since last checkpoint.** first draft.

### Q9 — Which of those external-product visits could realistically be eliminated?

**Answer (draft).** Three candidates are already substrate-complete: (1) **Finviz chart PNGs on member surfaces** — render from Massive bars through `/r/chart` / `ChartPane` instead; the licensing register's own default is to retire Finviz *images* first (REG T-49, OI-E02-03 default); (2) **TradingView embeds for viewing** — `ChartPane` mounts on 17 surfaces already, with drawings, 14 tools, AVWAP, indicator formulas and Pine/thinkScript transpilers (B1–B5), so the *viewing* visit is eliminable; the *alerting/drawing-sync-across-devices* and *broker-linked* visits may not be (drawings are device-local, TD-03); (3) **yfinance-served surfaces** — not a desk visit but an eliminable dependency (X-class, 24 modules; Massive/FMP already serve the classes). Finviz *screening* is only partly eliminable: the screener has 157 columns and a nightly universe, but short interest is single-sourced to Finviz with no second vendor (F-03b §2), so eliminating the Finviz *account* deletes a capability. Discord, Substack and YouTube are distribution, not research visits, and stay.

**Evidence.** `capability-ledger.md` B1–B5, B9, G1, F10; `licensing-register.md` T-49, T-71–T-76; `provider-ledger.md` §2 (short interest — "NO HISTORY at all; known-sparse", single-sourced), §3.1, §4 rows 5, 7; `ecosystem-cartography.md` §7; `tech-debt-register.md` TD-03.

**Confidence.** 🟡 — the substitutions are code-verified; whether the desk *would accept* them (chart parity ceiling is 17/21 on Pine per project memory; TradingView's alerting is not in the estate) needs the desk-tool files and the owner.

**What would raise it.** The TradingView-as-used and Finviz desk-tool files; OI-06; a parity list per visit (F-05).

**Changed since last checkpoint.** first draft.

### Q10 — Which should not be eliminated because another product is simply better?

**Answer (draft).** Placeholder pending the desk-tool files. What the internal evidence already concedes: **execution and order management** belong to the broker (owner default — no execution in V1), so the thinkorswim/Schwab visit for *placing and managing orders* stays by design; **community** stays in Discord (two product apps, ~20 webhooks, the room record); **publishing** stays in Substack/YouTube (draft-first by construction). The candidates where "another product is simply better" is plausible but unproven are TradingView's alerting/replay/drawing-sync and cross-device chart state (the estate's drawings are device-local and `charts_workspace_layout` is unversioned), and Finviz's breadth of screener columns and short-interest coverage. The rule of the charter applies: a benchmark being better is a reason to *not build*, not a reason to *copy*.

**Evidence.** `GOVERNING_PRINCIPLES.md` §13 (no execution); `ecosystem-cartography.md` §7; `state-persistence-and-workspaces.md` §4.1 (drawings device-local; boards sync); `tech-debt-register.md` TD-03; `provider-ledger.md` §2 (short interest); `desk-tools/*.md` — pending.

**Confidence.** 🔴 — the answer requires the four desk-tool reconstructions and OI-06; only the "by design" exclusions are 🟢.

**What would raise it.** `desk-tools/thinkorswim.md`, `tradingview-desk-use.md`, `finviz.md`, `market-chameleon.md`; OI-06; OI-19.

**Changed since last checkpoint.** first draft.

---

## Research

### Q11 — What information is needed to understand a company in five minutes?

**Answer (draft).** The research modal already encodes an answer as five questions: *is there a trade into this print?* (Setup), *what is this business and how is it doing?* (Company: profile, financials), *what happened and what will be said?* (The Print: history, brief, call), *what is everyone else saying?* (Coverage: the Street, catalysts, news, filings), and *whatever the reader brought* (Ask AI). The card-level facts that precede any click — expected move with typed refusals, four-quarter beat dots, `hist_stats`, the report date with drift detection, POSITION/WATCHLIST/UCT20 badges — plus a chart on the daily and the last thing the desk said about the name are the five-minute set. What the modal lacks for a *terminal* five minutes is the house verdict (grade, regime fit, sizing) in the same frame; today that lives in Compass. No telemetry says which panels members open, so "five minutes" is the file's design intent, not a measurement.

**Evidence.** `terminal-current-map.md` §1.6 (twelve panels, five groups, the group semantics verbatim), §2 (typed refusals, date drift), §7 W2; `capability-ledger.md` D1–D4, D9, D10, K4; `current-ui-architecture.md` §8 (`IdentityBanner` as a SecurityHeader candidate).

**Confidence.** 🟡 — structure 🟢; which panels earn the five minutes 🟡 (no telemetry — D-09 §1.6 open question).

**What would raise it.** An owner-run `page_views`/section read; the Bloomberg search/navigation and fundamentals files read for the "first screen" pattern; F-07 personas.

**Changed since last checkpoint.** first draft.

### Q12 — What information is needed to understand one deeply in an hour?

**Answer (draft).** The hour adds what the estate holds but scatters: verbatim transcripts with keyword search and alerts (D6 — coverage measured n=0 in the one observed monitor cycle, RG-15), SEC filings with full-text search (D7), ownership and insider clusters (D8), analyst grades and price-target history (D3 — no revision timeline exists; it is derivable by retaining nightly snapshots, F-03b §5.2), theme membership and co-movement (H9), the Model Book's labelled setups and year recaps (N4), Desk mentions (L8), the COT read for the sector's futures where relevant (H5), the base-structure lift for the pattern in play (G6), and the AI deep-research lane (K3). The hour-long research a professional terminal sells — per-broker estimates, a consensus-revision timeline, short-interest history, Level 2 — is exactly the "NO PROVIDER" list (F-03b §3.2); two of those four are storage decisions on data UCT already holds. Licensing caps the hour: transcript bodies into an LLM are "the sharpest AI row" (REG T-43).

**Evidence.** `capability-ledger.md` D3, D6–D8, G6, H5, H9, K3, L8, N4; `provider-ledger.md` §2, §3.2, §5.1–5.5; `licensing-register.md` T-43, N-12, N-17; `RESEARCH_GAPS.md` RG-15.

**Confidence.** 🟡 — inventory 🟢; the professional-hour benchmark (what FactSet/AlphaSense/Koyfin treat as the deep read) not yet read for this draft.

**What would raise it.** The fundamentals/estimates and news/alerts Bloomberg files; the AlphaSense, FactSet, Koyfin dossiers; a written FMP answer on transcript summarisation (REG T-43).

**Changed since last checkpoint.** first draft.

### Q13 — Which recurring research processes can be automated?

**Answer (draft).** Most already are — the estate runs 143 scheduled jobs on the web pod and 34 on the owner's PC: the wire, the scanner, catalysts (8 sources → synthesis → self-tuning loops), earnings previews and post-print analyses, call recaps (the one Batch-API lane), sector reads, COT narratives, awareness insights, Desk chapters and covers, theme membership, the nightly scan sweep with a coverage receipt, and Compass recaps. The automations still *missing* are storage-shaped, not model-shaped: a consensus-revision timeline (retain `screener_analyst_pass` snapshots), short-interest history (retain the nightly Finviz column), the per-ticker provenance join (a query over four existing tables), a `LastTaskResult` digest for the 34 PC jobs (four are failing silently), and widening the Batch API from one warmer to the five that qualify. Cost doctrine constrains automation: caps are per-lane, one lane has a scheduled-vs-member reserve, and five price tables disagree (TD-21, TD-42).

**Evidence.** `system-map.md` §5.1–5.2 (34 PC tasks; 143 job ids), §11 #6 (silent failures); `capability-ledger.md` K3, K4, K8, K10, G2, L2; `existing-ai-systems.md` §2c (Batch API, one consumer), §5d (reserve), §7 (scheduled AI); `provider-ledger.md` §5.2, §5.5 (storage decisions); `tech-debt-register.md` TD-21, TD-22, TD-42.

**Confidence.** 🟡 — what runs is 🟢 (CONFIRMED by scheduler entries and variable reads); what *should* be automated next is a product judgement.

**What would raise it.** The cost model (E-05); a measured spend read (`catalyst_cost_log`, `llm_route_cost_log`); the owner's answer on retention (TD-63).

**Changed since last checkpoint.** first draft.

### Q14 — Which should remain human-led?

**Answer (draft).** The repositories record these as rules, not preferences: the **Top 5 picks discipline** and the editorial directive that "setups and catalysts override regime — always"; the **Sunday Scans hand-picks**, which are additive and never scored against the automated roster; the **wire's editorial loop** — the owner's per-segment 👍/👎 and notes are "explicit owner directives that bypass the min-votes gate"; **publication** — both newsletter channels are draft-first by construction and "never auto-publish"; **Bracco's section**, rendered verbatim with a word-count assertion; **Model Book curation** (admin writes); the **theme taxonomy baseline**, which the engine overlay physically cannot edit; the **base-structure publication gate** (six gates, humans decide what the number means); and **Compass action tools**, which are preview → confirm with an `elevated` flag for discipline-loosening mutations. Terminal-Next should inherit each as a constraint, not revisit it.

**Evidence.** `proprietary-asset-inventory-raw.md` §2e (critic loop), §8d (Sunday Scan hand-picks, Bracco verbatim, never auto-publish), §10 (setup priority override), §5 (six gates); `capability-ledger.md` M7 (draft-first), N4 (admin curation), H9 (inviolable baseline), K4 (preview→confirm); `existing-ai-systems.md` §6 (consent for actions); `ecosystem-cartography.md` §1.5.

**Confidence.** 🟢 — every item is a written rule in the code or its docs, several with rails.

**What would raise it.** Nothing needed; an owner confirmation that the list is complete would close it.

**Changed since last checkpoint.** first draft.

### Q15 — Which information is currently difficult to connect?

**Answer (draft).** Nine joins that do not exist or exist only one-way: (1) the four per-ticker histories and the Desk/Substack/Discord trails — "each trail has a different key, a different permission tier and a different text policy" (D-13 §11); (2) the engine KB and the dashboard — a one-way nightly Brain Pack, whose exporter was terminated on battery on 2026-09-01; (3) the frozen room record (text, to 2026-02-20) and the live buzz counts (no text, by design); (4) the bot's earnings path and `/api/calendar`; (5) engine regime vs dashboard regime; (6) four setup vocabularies; (7) breadth EOD (yfinance, dividend-adjusted) vs intraday (Massive) vs `bars.db` (split-adjusted); (8) drawings (device-local) vs boards (cross-device) vs layouts (server) — "an accident of implementation order, not a decision"; (9) member positions ↔ the calendar (this one *is* connected via `my-sets`, the exception that shows the pattern). The join costs are permission models and adjustment bases, not data volume.

**Evidence.** `proprietary-asset-inventory-raw.md` §9, §11; `system-map.md` §2.2, §5.1 (Brain Pack Export rc 3221225786), §11 #9; `capability-ledger.md` H6, K13, E6; `terminal-current-map.md` §6.5; `data-use-classification.md` §2.10 (adjustment basis), §2.12; `state-persistence-and-workspaces.md` §4.1; `tech-debt-register.md` TD-36, TD-20; `OPEN_QUESTIONS.md` OQ-14.

**Confidence.** 🟢 — each disconnection is measured by a leaf and reconciled in the map.

**What would raise it.** Nothing needed for the list; the *order* to close them is an architecture decision (ARCH-04).

**Changed since last checkpoint.** first draft.

---

## Data

### Q16 — Which existing vendors provide the greatest untapped value?

**Answer (draft).** **Massive, overwhelmingly** — already paid for, already the spine (20 of 29 derived products), and under-used in five places: native options chain + Greeks + IV (`polygon_options.py`) while GEX still rides one Schwab account holder's token on unauthenticated routes and the voice chain rides yfinance + Black-Scholes; `/v3/reference/{splits,dividends}` while two modules call yfinance; `/v3/snapshot/indices` while index symbols come from yfinance; Massive WS/snapshot for equity ticks while the always-on tick stream is Finnhub on its free tier ("the most-restricted provider sits on the least-visible always-on surface"); Massive news third in a chain behind AlphaVantage. Then **FMP** (bulk fundamentals, transcripts + FTS5 index armed yet coverage n=0, ETF holdings, economic calendar for all weeks) and **SEC EDGAR** (free, unrestricted, used for filings only — Form 4 / 13F unused for ownership). Inside the AI vendor: the Batch API has one consumer of five qualifying warmers; the scheduled-vs-member reserve exists on one lane. Inside the estate: `j2_broker_equity_snapshots` written daily and never rendered; `CoverageLine` screener-only; ~150 Finviz export columns of which ~7 are joined (but every added column deepens a U-class single source).

**Evidence.** `provider-ledger.md` §3.1 (the underutilized table, all code-cited), §2 (coverage matrix), §4 rows 4, 5, 9, 16; `data-use-classification.md` §2.4, §7.2; `existing-ai-systems.md` §2c, §5d; `capability-ledger.md` F6, F10, K11.

**Confidence.** 🟢 — every item is a code citation; the value is tier-conditional (OI-03a) but the under-use is not.

**What would raise it.** Nothing for the list; OI-03(a)/(b) decide how much of it is *usable* by members.

**Changed since last checkpoint.** first draft.

### Q17 — Which important terminal features are impossible with current data?

**Answer (draft).** No provider in the stack for: Level 2 / order book; corporate credit, bond quotes, CDS (FRED yield series only, keyless); FX and crypto bars or depth; licensed futures quotes (NQ/ES/RTY come from yfinance — X); whisper numbers; a consensus-revision timeline; analyst-level (per-broker) estimates; short-interest history; an M&A / spin-off / rights / buyback / ticker-change event calendar; earnings-call audio (adapter dormant, keyless). Two of these are *storage* decisions rather than vendor gaps (revision timeline, short-interest history — retain what is already fetched nightly). Three are excluded from V1 by owner default (FX, fixed income, crypto). A separate class is *possible with the data but not with the licence*: member-facing real-time single-symbol quotes and real-time OPRA prints under an Individual Massive tier, and any external publication of vendor data at either tier.

**Evidence.** `provider-ledger.md` §2 (NO PROVIDER rows), §3.2, §5.2, §5.5–5.7; `licensing-register.md` §1C, N-01, N-07, N-23; `GOVERNING_PRINCIPLES.md` §13.

**Confidence.** 🟢 on the gap list (grep-verified across all repos by D-03/F-03b); 🟡 on which gaps *matter* (F-03b's own open question to the owner).

**What would raise it.** OI-19 and the owner's answer to "which NO PROVIDER rows are load-bearing" (F-03b §2 open question); the benchmark dossiers for what professional users treat as essential.

**Changed since last checkpoint.** first draft.

### Q18 — What would filling those gaps cost?

**Answer (draft).** Only public list prices and thresholds exist; no measured spend artifact is readable and the cost model (E-05/E-06) is not yet written. The thresholds on record: Massive Business (stocks) **from $2,499/mo** (the one purchase that converts ~⅔ of the licensing register; options priced separately; pass-through exchange fees); OPRA redistribution **$1,500/mo floor** delayed or real-time **+ ~$1.25/member/mo** real-time, historical-only free; CTA Tapes A+B non-pro **$1 + $1/member/mo** but **$1,000 + $1,000/mo** redistribution plus an entitlement build with unique credentials, monthly reports and three-year audit trails; server-side price alerting as non-display **$2,000/mo per category** on CTA Network A and again on OPRA; an FMP DDLA **unpriced**; Level 2 exchange-level, unpriced, "almost certainly above the $250/mo escalation line"; a revision timeline and short-interest history ≈ storage cost only. The seed's escalation rule binds: any recurring spend over $250/mo, any signup, and any cost that scales with member count is an owner decision regardless of amount.

**Evidence.** `provider-ledger.md` §3.4 (thresholds, "not verdicts — E-05 owns the model"), §5.6 (Level 2); `licensing-register.md` §1C, N-01, N-07–N-09, N-19, N-26; `data-use-classification.md` §3.1; `GOVERNING_PRINCIPLES.md` §11; `OWNER_INPUTS_REQUESTED.md` OI-10; `MASTER_CHECKLIST.md` #34 (cost model NOT STARTED).

**Confidence.** 🔴 — every dollar is a public list price quoted by a leaf, none re-verified this week ("E-05 must re-pull all four before any figure reaches a budget"); no baseline spend (OI-10).

**What would raise it.** The cost model (E-05/E-06) with labelled assumptions; OI-10; OI-03(a)/(b); a Massive quote for Derived Works + OPRA display; one read of the spend ledgers by the owner.

**Changed since last checkpoint.** first draft.

### Q19 — What data rights could constrain member access?

**Answer (draft).** The licensing register classifies 118 uses: **81 Restricted, 18 Unknown, 8 Unsuitable, 7 Likely Allowed, 3 Allowed** — and every Allowed row is public-domain or UCT's own content; not one rests on a vendor contract, because none has been seen. Two owner facts move 57 rows (the Massive tier: 38; the FMP DDLA: 19). What survives *both* favourable answers as R is the actionable half: public surfaces (the `/api/live-prices`, `/api/snapshot`, `/api/movers` routes CONFIRMED unauthenticated — R-17; the public Flow Scoreboard; `/r/*`; Desk sessions uploaded public under `DESK_PUBLIC_SHOWS=*`, an owner decision of 2026-08-19; the `#TSDR` index-close charts; the Sunday Scans free tier); the §6.1(j) composites (UCT20 NAV, the Exposure Rating, published entry/stop/target); Finnhub, AlphaVantage, X display/storage; yfinance everywhere including the authoritative EOD breadth row (X — no licence exists to buy); Finviz (no terms document; a "no" is a capability deletion of short interest); Schwab chains fanned to members from one token; SnapTrade cross-member use; the `#tsdr` corpus (consent U). Anthropic §L.1 re-attaches every upstream restriction at the prompt boundary. The desk-only escape does not exist at three of four self-serve vendors under the Individual assumption.

**Evidence.** `licensing-register.md` §1C (tally), §1D, T-02, T-12, T-16–T-27, T-51–T-59, T-62–T-64, T-71–T-77, T-81, T-85, T-87, N-01–N-26; `data-use-classification.md` §1 (six findings), §2.13 (§L.1), §3 (scenarios), §7.1 (escape routes); `RISK_REGISTER.md` R-14, R-17; `OWNER_DECISIONS.md` D-002.

**Confidence.** 🟡 — clause text 🟢 (dated primary documents), production state 🟢 (ORCH read), classification logic traceable 🟡, contracts 🔴. The register is explicit that it "classifies risk, not law".

**What would raise it.** OI-03(a) (the Massive billing page), OI-03(b) (one FMP email), OI-03(c) (the Finviz purchase email), OI-09, OI-17; a written Massive answer on §6.1(j) and Derived Works.

**Changed since last checkpoint.** first draft.

### Q20 — Where is our source-of-truth strategy unclear?

**Answer (draft).** The system map's most-repeated defect class is "a second authority over one value", and it is live in at least eleven places: earnings dates (four providers for one field, plus the bot's own path); regime (engine vs dashboard classifier); the setup vocabulary (four populations); `FREE_PAGES` (three hand copies); `PAID_PLANS` (two); the start command (three files); five LLM price tables (the Sonnet-5 fix landed in one); `YF_INDEX_MAP` and OCC builders (partner files); the Model Book vs the engine's `model_examples`; the tick-stream vendor (CLAUDE.md says Massive, the code says Finnhub); the flag ledger vs Railway (all five `dark` entries armed; `where` a placeholder on 86 rows); and documentation vs code in ≥10 measured places. Breadth is the sharpest: the EOD authoritative row is dividend-adjusted yfinance while `bars.db` is split-adjusted only, and the Exposure Rating the whole product is organised around rests on that row. Where the strategy *is* clear and worth copying: the wire owns exposure and the dashboard only reads; `weekAnchor.js` owns the week with an AST rail; `registry.js` owns widget types; `navGroups.js` owns the route taxonomy; `sessionModel.js` owns session state.

**Evidence.** `system-map.md` §11 #9–10, §12 (R1–R25); `tech-debt-register.md` TD-19, TD-20, TD-21, TD-36, TD-39; `provider-ledger.md` §6 (fifteen contradictions settled); `data-use-classification.md` §2.10, §9; `terminal-current-map.md` §1.3, §6.2, §6.5; `proprietary-asset-inventory-raw.md` §10 (exposure has one authority).

**Confidence.** 🟢 — measured and reconciled by three syntheses independently.

**What would raise it.** Nothing; the *resolution order* is an ARCH-04 (data architecture) decision.

**Changed since last checkpoint.** first draft.

---

## Engineering

### Q21 — Which current systems can become foundational terminal primitives?

**Answer (draft).** Ranked by reuse verdict in the ledger and the UI report: **(1) the widget registry** (`widgets/registry.js` — metadata-only, deep-frozen, 18 types, `paramsSchema` with durability regimes, per-shell `menus`; "adopt as the panel manifest; add `menus.terminal`"); **(2) the `/charts` board** (24×20 viewport-locked grid with fractional row math, drop-and-repack, custom resize, `useCSSTransforms=false`) plus **pop-out windows** (a React portal into `window.open` sharing the SSE pools — multi-monitor at zero backend cost); **(3) `ChartPane`** (17 importers — mount this, never `StockChart`); **(4) the shared tool registry** (154 tools, three doors, per-door allowlists) and `_grounded_system` with declared gaps; **(5) the persistence seeds** — `chartDefaults.js`'s `settingsVersion` fold + `instanceShape.js` tombstones, `user_definitions.py`'s append-only store, `charts_layout_service`'s atomic row, `usePreferences.setPrefMerged`'s write queue, `useTracingsSync`'s highwatermark; **(6) the latency layer** — `serve_stale` + warmers + `cache_snapshot` + pooled SSE with admission caps ("the most valuable code in `api/`"); **(7) the honesty primitives** — `CoverageLine`, the Wire trust line, typed refusals; **(8) `entitlements.py`** (four axes, `withheld` vocabulary, one toolkit — the seat for tiers); **(9) the one-authority modules** — `weekAnchor.js`, `importance.js`, `navGroups.js`, `sessionModel.js`, `keyboardShortcuts.js`'s binding-table shape; **(10) the screener shell** (`VirtualResults` + `columnDefs` + `ColumnDesc` + `liveSort` ≈ 80% of a DataGrid). Each carries a named gap (no error boundary, unversioned layout, four-colour link cap, symbol-only search).

**Evidence.** `capability-ledger.md` C1–C7, B2, B4, K1, G2, G3, G12, O6 (reuse column); `current-ui-architecture.md` §1.1–1.5, §8 (verdict table); `state-persistence-and-workspaces.md` §7.6 (seed map); `existing-ai-systems.md` §0; `current-performance-and-realtime.md` §1.1 (pooled clients), §3.1; `tech-debt-register.md` TD-02–TD-08.

**Confidence.** 🟡 — the candidates are 🟢 (measured, three leaves agree); the *selection* is gated by the fixed/modular/hybrid deliverable (C5-03, Part XXI) and the ARCH proposals, not by this synthesis.

**What would raise it.** `fixed-modular-hybrid.md` red-teamed (gate item 14); ARCH-01..03; the RG-05 decision on `StockChart` scope.

**Changed since last checkpoint.** first draft.

### Q22 — Which existing systems will become bottlenecks?

**Answer (draft).** In the order a multi-panel client would hit them: **(1) the single web pod** — one uvicorn process, one event loop, one 64-slot threadpool, 1,187 routes, 143 jobs, ~34 boot daemon threads, all SSE hubs in-process, ~15 per-process correctness guards; it cannot scale out because `auth.db` is web-local and jobs cannot move; **(2) `auth.db`** — ~110 tables from 16 modules on one SQLite write lock, no migration framework; **(3) `bars.db` WAL bloat** under continuous web-side writes (0.3–6.8 s long-tail reads until a 2026-09-02 checkpointer); **(4) RSS growth** (~2.2 MB/s observed; 11.6 GB on a long-lived pod; `MALLOC_ARENA_MAX=2` set, efficacy unproven); **(5) the stream caps** — 300 subscribers per stream family, so ~300 concurrent browsers, not panels (the pooled clients are the reason this is not worse); **(6) `StockChart.jsx`** at 15,500 lines / ~120 props on every chart; **(7) `user_preferences`** as the workspace store (uncapped, undeletable, unversioned); **(8) Massive** as a near-monopoly with ~1 connection per key and no replay; **(9) the owner's PC** as the only scheduler host for 34 jobs; **(10) Discord** as the sole alerting channel — the first thing to go quiet; **(11) every web deploy** as a hard ~3-minute cold cut with no CI gate. The tiers already split off (worker, flow-worker, bars-api) show both the pressure and the template.

**Evidence.** `tech-debt-register.md` TD-12–TD-17, TD-23, TD-31, TD-43; `system-map.md` §0 #2, §7 (capacity envelope), §11 #1–#5; `current-performance-and-realtime.md` §3.4, §6 (ranked stress order), §7.2; `capability-ledger.md` A13 (bars-api "the template for any new tier"); `RISK_REGISTER.md` R-04, R-09.

**Confidence.** 🟢 — each is a measured incident or a read constant; only the *present-moment* envelope is 🟡 (no baseline exists — TD-17).

**What would raise it.** D-05's baseline protocol (A–H) executed by a later role; a week of `WATCHDOG_OBSERVE=1` lag data; a 24 h `[mem]` log export.

**Changed since last checkpoint.** first draft.

### Q23 — What parts of the codebase should not be touched?

**Answer (draft).** By rule: the five **partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) — read-only, no depth. By the protection rail: **TERMINAL-CURRENT** — the `/calendar` route, the `/api/calendar` contract (nine reader classes, five server-side with bare `.get()` chains), the five `calendar_*` preference keys, the widget type key `calendar` inside every saved board, the notebook embed params, the `?earnings=SYM&esection=` deep link ("honour or 301, never retire"), and `/r/calendar` (a visual contract with two out-of-repo Playwright consumers). By contract: `POST /api/push` and the ~14 wire read endpoints (an unattended 06:35 CT pipeline), the `/r/*` render routes and `CHART_RENDER_TOKEN` (three consumers), the Brain Pack two-repo layout, `railway.json`'s `exec` + graceful-shutdown + `drainingSeconds` unit, `healthcheckPath: /api/health` (never `/api/ready`). By owner ruling: COT charts stay Chart.js; `themes_taxonomy.json` is inviolable; `R2_PERIODIC_PULL_LEGACY_REPLACE` stays off; the engine, bot, wire and scans repositories are read-only for this program. By prudence: `StockChart.jsx` internals (mount `ChartPane`), `api/main.py` and `App.jsx` beyond one line per feature, and `api/earnings_router.py` (an instruction inside evidence; pinned unmounted by a test).

**Evidence.** `GOVERNING_PRINCIPLES.md` §4, §5; `terminal-current-map.md` §0, §1.7, §4, §6.1, §11; `coexistence-current-mechanisms.md` §2.5, §3, §4, §8; `ecosystem-cartography.md` §1.4, §5; `system-map.md` §3 (deployment unit), §10; `tech-debt-register.md` TD-01, TD-61, TD-64, TD-67; `capability-ledger.md` H9 (inviolable baseline), K6 (locked pack contract).

**Confidence.** 🟢 — each is a written rule, a rail, or a measured blast radius.

**What would raise it.** Nothing; owner acknowledgment on the partner list is the only external dependency.

**Changed since last checkpoint.** first draft.

### Q24 — Where does a new abstraction create genuine leverage?

**Answer (draft).** Where the repo has already paid for the absence: **(1) one versioned workspace document** in its own store replacing the eight-key non-atomic bundle — "the strongest single change, and every ingredient is already in-repo"; **(2) a typed link channel** `{symbol, tf, range, universe}` replacing four colour letters — the `'N:${groupId}'` escape proves the path tolerates it; **(3) a DataGrid** extracted from the screener shell — "a terminal is a table product" and sorting is implemented ≥5 times; **(4) `usePanelData`** — a fetch wrapper that cannot be constructed without a visibility gate, a market-hours policy and a throwing fetcher (186 raw `fetch(` sites; `.catch(() => null)` survives in six files after the NVDA incident); **(5) one `format` module and one `FreshnessBadge`** carrying `CoverageLine`'s discipline (118 files define `fmt*`; five freshness implementations); **(6) one keyboard registry + command palette** on the chart's `code`-based binding model (two systems, 87 raw listeners, zero palette); **(7) one FMP client with a budget** (six helpers, 42 literals) and provider fallback order as data; **(8) one LLM price module** (five tables, one rail); **(9) a publication chokepoint** with a vendor-of-origin field ("whose data is in this, and may it go out?"); **(10) `require_beta` + one `_access_payload` field + `TERMINAL_NEXT_ENABLED`** for the cohort Stage 3 cannot express today; **(11) a JSON 404 guard** before the SPA catch-all (~5 lines, removes a class of false-green probes).

**Evidence.** `tech-debt-register.md` TD-03–TD-11, TD-18, TD-21, TD-29; `state-persistence-and-workspaces.md` §7.6, RECOMMENDATION; `current-ui-architecture.md` §3, §5, §7, §8; `flags-and-entitlements.md` §5.3, §8; `data-use-classification.md` §6 RECOMMENDATION; `terminal-current-map.md` §3.3; `existing-ai-systems.md` §5c.

**Confidence.** 🟡 — each absence is measured (🟢); the leverage claim is a design judgement the ARCH roles and the red team must price.

**What would raise it.** ARCH-01..03 costing each; the C5-03 workspace comparison; H-03's backlog with acceptance criteria.

**Changed since last checkpoint.** first draft.

### Q25 — Where would abstraction create unnecessary complexity?

**Answer (draft).** Where the estate already warns: **a new shell** when a route inside `Layout` costs six one-line edits and inherits nav, theme and scroll semantics (RG-07 is the decision, but the cheap side is clear); **a per-user server-side cache or session object** — "never fragment a cache by user" is the rule the 524 outage taught, and the pod is one process; **decomposing `StockChart` inside Terminal-Next scope** — a quarter, not a week; **a second app instance for multi-monitor** — the pop-out portal already gives it without multiplying streams; **a Postgres migration during Phase Zero** — the runbook names one trigger (`SQLITE_BUSY` > ~1% or >150–200 concurrent journal writers) and it has not fired; **a flag service** — a call-time env var with an AST ledger is the right size, the gap is cohort targeting not flag delivery; **a fifth authority for cohorts** beside `entitlements.py` and `user_tags`; **the "wrap a page with `embedded`" pattern** (used twice, abandoned, 20-prop signatures); **a third hotkey system**; **a separate Terminal-Next calendar data path** (double provider cost, a second authority) when sharing `/api/calendar` costs nothing; **a general event bus replacing N named buses on `WorkspaceContext`** before there is a second consumer — the repo's own lesson is that abstractions are earned by a second use.

**Evidence.** `coexistence-current-mechanisms.md` §2, §5 (Options A–F, F's risk); `state-persistence-and-workspaces.md` §5 ("never fragment a cache by user"); `current-ui-architecture.md` §1.5, §1.6, §5 open question, §1.3 open question; `tech-debt-register.md` TD-01, TD-11, TD-13 (Postgres trigger), TD-35; `flags-and-entitlements.md` §1.1, §5.3 ("do not add a fifth authority"); `RESEARCH_GAPS.md` RG-05, RG-07.

**Confidence.** 🟡 — the warnings are recorded; which abstractions Terminal-Next *does* need is exactly the fixed/modular/hybrid question the program has deferred to a red-teamed deliverable.

**What would raise it.** C5-03 and the three ARCH proposals; G-02's red team on architecture.

**Changed since last checkpoint.** first draft.

---

## UX

### Q26 — What should be accessible in one click?

**Answer (draft).** What the estate already makes one click (and members have been trained on): any ticker → chart + research (`TickerPopup`; the `?earnings=SYM&esection=` deep link — "the most viral surface in the product"); flag / tag / add-to-list / set-alert from a right-click anywhere (`TickerActions`); the Wire; "which of my names print today" (`TodaysBrief`, Table view, current week only); a day tab that switches the view rather than no-op; symbol search from a chart by typing; the 🧭 verdict on a position; a saved layout. What should be one click in a terminal and is *not* today: a symbol into every linked panel from anywhere (link groups are `/charts`-only); "what the desk said about this name"; the house grade/size in the research frame; a delayed-vs-live freshness state; a command palette. The benchmark half — what professional terminals put at one keystroke, and the anti-patterns — was not yet read for this draft.

**Evidence.** `terminal-current-map.md` §1.4 ("a primary control must never no-op"), §1.7, §7; `capability-ledger.md` I4, D1, E3, E4, C3, C4, K4; `current-ui-architecture.md` §5, §8 (command palette absent); `tech-debt-register.md` TD-05, TD-07.

**Confidence.** 🔴 — the internal inventory is 🟢, but "should" needs the benchmark evidence (Bloomberg search/navigation, Gödel, the desk tools) and a desk observation; neither was in hand for this draft.

**What would raise it.** `bloomberg/01-search-navigation.md`, `godel/01-evidence.md`, the desk-tool files; OI-06; the observed morning; F-07 personas.

**Changed since last checkpoint.** first draft.

### Q27 — What should be accessible by keyboard?

**Answer (draft).** What exists: the chart's binding table (physical `code`s, a rejected-Alt rule, TF cycling, indicator chords, an ownership ref railed by `widgetKeyboardOwnership.test.js`), the calendar's ← → T / with modal-open suppression, the watchlist's ↑/↓/Space over every expanded list, the journal's `g>x` chords (declared twice), and a settings-only palette. What does not exist: a global registry (87 raw `keydown` listeners, two systems), an app-wide command palette, symbol entry from anywhere, panel focus/cycle, link-group assignment, and a discoverable shortcut list derived from the same table that binds it. The recommendation on record is one registry on the chart's `code`-based model with a duplicate-`(code, modifier, scope)` rail and the palette built on it — "do not add a third system"; the Shift+F flag collision (fixed 2026-08-28) is the recorded cost of the current split. A terminal keyboard model also has to respect the inner-`.main` scroll container and the ≤1024 touch tier the app already commits to.

**Evidence.** `current-ui-architecture.md` §5 (two disjoint systems, the Shift+F collision, ownership rail), §2 (scroll model); `terminal-current-map.md` §1.3 (calendar keys), §1.6 (modal stepping); `capability-ledger.md` I1 (watchlist keys), J1; `tech-debt-register.md` TD-07, TD-48.

**Confidence.** 🟡 — the gap is measured; the target model (which commands, which chords) needs the benchmark keyboard patterns and the desk's habits.

**What would raise it.** The Bloomberg search/navigation file and Gödel evidence (command-line and keyboard idioms); the thinkorswim/TradingView desk-tool files; C4-01's command-grammars artifact (present on disk, not yet read for this draft).

**Changed since last checkpoint.** first draft.

### Q28 — What information should update when ticker context changes?

**Answer (draft).** Today a link group carries a *symbol only* and only inside `/charts` (four colours plus `'N'`); `useAppFocus` makes charts Group A the app-wide focus; time, replay, filter and universe do not travel (replay is board-wide). Everything that is symbol-keyed should follow a ticker change: chart(s), the research panels, news and filings, the options chain and flow-by-contract, dark-pool prints, Desk mentions, the alert/position/watchlist state for that name, the AI ask box's scope (the earnings modal already composes `AiSearchWidget` scoped to the symbol), and the house verdict. What should *not* follow: market-wide panels (breadth, the calendar day, movers, the tape, catalysts), which are the context *around* the ticker. The estate's own next ask is a typed channel `{id, symbol?, tf?, range?, universe?}` (TD-05); the notebook's frozen-params embeds prove that "follow" and "freeze" must both be expressible per panel.

**Evidence.** `current-ui-architecture.md` §1.3 (link model, `'N'` escape, crosshair/aiSearch buses), §1.6 (widget strategies); `state-persistence-and-workspaces.md` §7.1 (`useAppFocus`: "Focus is a SYMBOL only"), §7.2; `capability-ledger.md` C3, E17, J2 (frozen params), K2 (scoped ask box); `tech-debt-register.md` TD-05; `RESEARCH_GAPS.md` RG-06.

**Confidence.** 🟡 — the current model is 🟢; the target set is a design hypothesis pending the workspace comparison and the benchmark linking patterns.

**What would raise it.** C5-01's workspace-systems survey (present on disk, not yet read for this draft) and `bloomberg/02-monitors-workspaces.md`; C5-03; a prototype inside the envelope if still uncertain (RG-06).

**Changed since last checkpoint.** first draft.

### Q29 — How much customization is useful before it becomes work?

**Answer (draft).** The estate's evidence is that *arrangement* customization is used and survives (18 widget types, named layouts user and admin-published, tabs, float, merged mode, pop-out, multi-chart grid) while *state* customization is where work — and loss — begins: eight loosely-coupled keys written non-atomically, a corrupt blob autosaved over as an empty board within 500 ms, no undo, no version, two competing widget-appearance models (four types global, the rest per-instance), watchlist columns device-local, drawings device-local while boards sync. TERMINAL-CURRENT's own history is the other datum: three preference-key bumps in eight weeks, each discarding members' choices on the theory that the old value "was not really a choice". The useful ceiling is therefore: arrangement + linking + saved/shared layouts + per-panel params — yes; per-instance styling beyond a skin, hand-tuned densities and settings that cannot be recovered or shared — work. Density is the specific unresolved axis (30 px compact rows vs a 44 px touch floor at ≤1024; `DensitySwitcher` built, unmounted).

**Evidence.** `state-persistence-and-workspaces.md` §1.3 (two appearance models), §2.2–2.3 (loss path, non-atomic apply), §4.1 (device-local vs account), §7.2; `terminal-current-map.md` §4 (three key bumps); `current-ui-architecture.md` §1.4, §1.5, §7 (density); `tech-debt-register.md` TD-03, TD-04, TD-48; `RESEARCH_GAPS.md` RG-10, RG-11.

**Confidence.** 🟡 — the failure modes are measured; how much members *use* the customization that exists is unmeasured (RG-11 needs production data).

**What would raise it.** RG-11 (blob size distribution, owner-run); the Bloomberg monitors/workspaces file and C5-01; the personas' desk-vs-member split (F-07).

**Changed since last checkpoint.** first draft.

### Q30 — What defaults allow a new user to succeed?

**Answer (draft).** Three defaults are already decided in code and one is a cautionary tale. Decided: first paint shows the **full market ranked big→small** ("a fresh visitor must never land on a sparse My Stocks week" — owner decision 2026-07-13); **firm setups arrive as ordinary editable definitions** (the starter library), not a read-only class; **admin-published global layouts** exist as the starter-board mechanism; **the Morning Wire is the free page**, so the first thing a new member sees is the desk's own brief; and the mentor refuses to size in RED/ORANGE-B regimes (a default that protects a novice). The cautionary tale: TERMINAL-CURRENT's Board default is the *else branch of a migration ladder*, not a chosen default, and its Wire view is unreachable by migration — "choose the default deliberately rather than inheriting a migration ladder's else". For TERMINAL-NEXT the defaults to decide explicitly are the starter layout per persona, the link-group default, the density, the freshness posture (delayed price + live volume by default if the licensing lever holds), and which honesty lines are always on.

**Evidence.** `terminal-current-map.md` §1.1 (Board default, Wire unreachable), §4 (the 2026-07-13 first-paint rule); `capability-ledger.md` G3 (starter library), C4 (global layouts), N1 (free page), K4 (sizing refusals); `data-use-classification.md` §7.2 (delayed price, live volume); `proprietary-asset-inventory-raw.md` §10 (0% ceilings).

**Confidence.** 🟡 — the recorded defaults are 🟢; the persona-specific starter set is unwritten (F-07) and the benchmark onboarding patterns were not yet read.

**What would raise it.** F-07 personas; OI-02 (who the dogfooders are); the Koyfin/TradingView/Gödel dossiers for first-run patterns; the dogfood protocol.

**Changed since last checkpoint.** first draft.

---

## AI

### Q31 — Where can AI compress a 10-minute process into one minute?

**Answer (draft).** Where it already does, measured by the artifacts it produces: earnings preparation (previews pre-warmed every day, 25–40 s cold → instant), the post-print read (analyses warmed six times a day), call recaps (Batch-API warmed), the catalyst thesis (eight sources → one paragraph per name, 20 names by 08:00), a sector's earnings setup in one grounded sentence, the weekly COT read (facts-first, grounding-gated), a single options print explained from deterministic facts, the pre-trade verdict (`grade_ticker` composes six tools into one GO/HOLD/SKIP with entry/stop/size), Desk chapters and ticker moments from a transcript, and AI Search with desk context packs. The largest *unbuilt* compression is the one D-13 names: "UCT on $SYM — everything we've said since 2024", a summary over four histories plus Desk mentions plus the archive — a join and a permission model, not new data. The constraint is not model quality but grounding and licensing: every lane's input inherits the strictness of its worst-licensed source (§L.1), and the report-card baseline is 12/50 with rungs 3–5 at zero because the model hedges on verdicts unless the verdict is computed for it.

**Evidence.** `existing-ai-systems.md` §1a–1b (surfaces), §2c, §4 (report cards; `--grounding-audit`), §6 (decisiveness structural); `capability-ledger.md` D5, D6, E14, F7, H5, K2–K4, K8, K10, L2; `terminal-current-map.md` §5 (earnings warm cadences); `proprietary-asset-inventory-raw.md` §11; `data-use-classification.md` §2.13, §5.

**Confidence.** 🟡 — what runs is 🟢; the *minutes saved* are unmeasured (no latency p50/p95 exists anywhere readable; no usage counts), and the provenance join is a candidate, not a plan.

**What would raise it.** A measured latency/usage read (`ai_search_log`, `catalyst_cost_log`); the AlphaSense / Fiscal.ai dossiers for what AI-native research products compress; an owner verdict on the provenance join.

**Changed since last checkpoint.** first draft.

### Q32 — Where could AI create unacceptable hallucination risk?

**Answer (draft).** The risk map is already written in the repo's own scar tissue: (1) **live single-symbol prices and percent moves stated in prose** — `checks.py` detects a quoted price with no tool result and documents its own residuals (a bare integer price is "never caught by design"); (2) **earnings dates and sessions** — assembled from four providers with a second authority in the bot; a wrong date "burns options traders every quarter"; (3) **rendering failure as fact** — `.catch(() => null)` produced "No recent news for this ticker" for NVDA while the endpoint returned 15 KB; the fixed fetcher has six unmigrated siblings; (4) **retrieval failure wearing an answer-quality costume** — the first honest fast-lane run scored 13/30 with eleven gate misses while the judge gave 4/4/4/4 to fluent answers built without the desk pack; (5) **no wall-clock or session state injected into any lane** (absence read over ~2/3 of the prompt) — "is the market open" and "what happened in the last hour" invite invention; (6) **verdicts that hedge** — rungs 3–5 at 0/10 · 0/7 · 0/13 until the verdict is computed structurally; (7) **desk data cited only in prose** while web data gets `[n]` markers — the largest trust asymmetry; (8) **the Community Ask lane** on Haiku with a 20 s cooldown and no grounding gate on record; (9) **anything the KB says with a marketing register** — the bot's README claims "150 books / 200 channels" against a measured 12 YouTube intakes and ~25 traders. The mitigations that work are structural, not prompted: facts modules that are the only thing the model may cite, grounding gates that store nothing on a mismatch, computed verdicts, declared grounding gaps, "grounded on" chips.

**Evidence.** `existing-ai-systems.md` §3a (declared gaps), §3c, §3d, §4 (13/30, eleven misses), §6 (`.catch(() => null)` survivors; `checks.py` residuals), §8 rows 4–5; `terminal-current-map.md` §2 (date drift, four providers), §6.5; `capability-ledger.md` K9, K12, K13; `proprietary-asset-inventory-raw.md` §13 (README claims); `tech-debt-register.md` TD-18, TD-50; CLAUDE.md Compass report card (baseline 12/50, CLAIM).

**Confidence.** 🟢 — every risk is a recorded incident, a measured exam result, or a read absence; the remaining 🟡 is §3d (the time-block absence over a partial read).

**What would raise it.** Reading `_WIDGET_INTRO` in full (D-12 GAPS); a Compass grounding-audit equivalent; re-running the two report cards on a sandbox (never on the pod).

**Changed since last checkpoint.** first draft.

### Q33 — Which structured tools must AI use?

**Answer (draft).** The tool set is already registered once and consumed through three doors (154 tools; Compass 44; the AI-Search agent 16 read-only), and the golden sets already name the must-call groups: **`get_quote` or `grade_ticker`** for any price; **`get_regime` / `get_breadth` / `get_movers`** for market context; **`grade_ticker`** for any "call this trade" question (regime → quote → patterns → playbook → size, structurally decisive); **`size_a_trade`** (2% cap, regime-scaled), **`portfolio_heat`** (10% Desjardins cap; excludes broker placeholder stops), **`grade_watchlist`** (funnel with a mandatory list-level synthesis), **`personal_edge`** (the member's own expectancy, soft-muted only at n≥25 and negative); **`lookup_playbook` / `setup_winrate` / `find_historical_analogs` / `ask_the_brain`** (retrieval-only over the KB); **`find_patterns_on_ticker`**; the earnings tools (`get_earnings_intel`, `get_earnings_this_week`) which exist voice-side only — a known chat-parity gap that fails two report-card questions. Actions never route through the model: proposal chips in AI Search, preview → confirm with an `elevated` flag in Compass. The shape to inherit is one registry plus a per-door allowlist; the gap to close is per-*plan* permissions (permissions are per-lane constants today).

**Evidence.** `existing-ai-systems.md` §0, §2a (`_AGENT_ALLOWED`), §2c, §4 (must_call_tools OR-groups), §6, §8 #3; `capability-ledger.md` K1, K4; CLAUDE.md Compass Brain Bridge / grade_ticker / Rung-4-5 sections (CLAIMs about the tool contracts, corroborated by D-12's AST counts); `proprietary-asset-inventory-raw.md` §10.

**Confidence.** 🟢 — the registry, the allowlists and the golden-set tool gates are read from source and AST-counted.

**What would raise it.** Closing the voice/chat earnings-tool parity gap; a per-plan allowlist design in `entitlements.py` (the seat that exists).

**Changed since last checkpoint.** first draft.

### Q34 — What should always be cited?

**Answer (draft).** Five things, in the order the estate already enforces them: **(1) every number** — the COT lane's grounding gate (every figure in the prose must appear in the facts, else nothing is stored) is the house template and should be universal; **(2) the source of every desk fact, inline** — today web claims get numbered `[n]` markers while desk data gets a prose instruction and a judge; a `[desk:quote]`-style marker a renderer can link is the single biggest trust gap (TD-50); **(3) provenance of KB passages** — `source`, `trader`, `source_ref` already exist on all 9,605 rows ("Bracco, Sunday Scans 2026-06-08 is worth more than an unattributed rule"); **(4) what the model looked at** — "grounded on" chips already ship; they should name values, not only packs, and persist as a reopenable trace; **(5) freshness, session and coverage** — as-of time, delayed/live state, and `CoverageLine`'s four counts with `withheld` beside them, because "we could not compute it" and "something broke" are different facts to a trader. Licensing adds a sixth: a vendor-of-origin field on anything that leaves the app (REG N-23), and — negatively — FMP may *not* be named as a source without written consent (REG T-46), so "always cited" must be designed against that clause.

**Evidence.** `existing-ai-systems.md` §3c (citation and provenance), §8 rows 4–5; `data-use-classification.md` §2.12 (COT as template), §6 RECOMMENDATION; `licensing-register.md` T-46, N-23; `proprietary-asset-inventory-raw.md` §1 RECOMMENDATION; `capability-ledger.md` G2, E3, K2; `tech-debt-register.md` TD-08, TD-50.

**Confidence.** 🟡 — the mechanisms are 🟢; the policy ("always") is a product rule the council must adopt, and one clause (FMP §10.4) constrains it.

**What would raise it.** OI-03(b) (the FMP DDLA and attribution consent); a council decision; the AlphaSense/FinChat dossiers on citation UX.

**Changed since last checkpoint.** first draft.

### Q35 — How can AI take advantage of UCT proprietary context?

**Answer (draft).** The plumbing exists: the engine KB (9,605 rows, 57.7% first-party, with provenance fields) ships nightly as the Brain Pack, is embedded into `brain_index.db` on install, and reaches both Compass surfaces through `brain_service` and five tools; the sizing table, regime limits, drawdown protocols and exposure model resolve to constants with one home each and are already callable; `personal_edge` computes the member's own expectancy; the Signature ledger accretes signal firings under an immutable key. What is *not* yet fed to any model: the decision record (`wire_universe`'s 19,050 considered-and-dropped rows, `leadership_snapshots`, `setup_triggers` outcomes, `book_ledgers`), Desk `ticker_moments`, the Substack archive, the curriculum (79 lessons, 181 verified chart examples), and the wire's own measured voice. Two licensing facts bound the answer: the `#tsdr` corpus (591 rows already in the KB, hence in the pack) has an unrecorded consent basis (OI-15), and 876 rows of Qullamaggie YouTube transcripts ride in the shipping pack (D-13 §12 open question). The recommended shape is the COT lane's — a facts module the model may cite, a grounding gate — applied to the provenance join, with the 2024 KB epoch's retrieval weight decided rather than inherited.

**Evidence.** `proprietary-asset-inventory-raw.md` §1, §2, §3, §8a, §10 (RECOMMENDATION "publish this table as the method"), §11, §12 (open question on transcripts); `capability-ledger.md` K4, K6, B8, L6; `existing-ai-systems.md` §3b (brain index), §8; `licensing-register.md` T-85; `OWNER_INPUTS_REQUESTED.md` OI-15; `tech-debt-register.md` TD-63.

**Confidence.** 🟡 — the assets and the plumbing are 🟢; feeding the decision record to a model is a product and consent decision, and the Brain Pack exporter's terminated task (battery) makes even the current pack's freshness 🟡.

**What would raise it.** OI-15; a licensing read on the transcript intakes; F-05's proprietary-advantage inventory (gate item 11); an ARCH-05 AI-architecture proposal.

**Changed since last checkpoint.** first draft.

---

## Business

### Q36 — Which capabilities increase perceived membership value?

**Answer (draft).** NOT DETERMINED from evidence: no usage telemetry, no support-ticket read, no survey, and the member/tier mix is unknown (OI-01). What the code and its owner decisions *imply* is valued: the Morning Wire (deliberately the only free page — the funnel, not the paywall, per DL-010 pending OI-12), the research modal's depth (rebuilt three times in seven months — someone cares), `TodaysBrief` and the Wire (built as "the retention moat"), the live options tape (a dedicated service tier exists to keep it alive through deploys), the broker mirror ("mirror the broker EXACTLY" — a dust filter was rejected), Compass verdicts, the Desk sessions (auto-published daily), and the honest record (the public scoreboard is described in-file as "a public trust asset"). The paid-conversion mechanism on record is the in-page teaser on `/research/*` ("the teaser idiom is the one that converts"), which is a design bet, not a measurement.

**Evidence.** `flags-and-entitlements.md` §3.2, §4.1 (teaser vs redirect); `DECISION_LOG.md` DL-010; `OWNER_INPUTS_REQUESTED.md` OI-01, OI-12; `terminal-current-map.md` §1.1, §9 (rebuild history); `capability-ledger.md` F1, F3, J4, K4, L1, N1; `proprietary-asset-inventory-raw.md` §7.

**Confidence.** 🔴 — the question is empirical and none of the empirical inputs were readable (DL-013); every item above is an inference from design effort.

**What would raise it.** OI-01; an owner-run `page_views` / `calendar_seen` / `ai_search_log` read; support-ticket themes (`support_tickets` table); the F-07 personas; the Koyfin/TradingView/Benzinga pricing-page evidence for what members pay for elsewhere.

**Changed since last checkpoint.** first draft.

### Q37 — Which capabilities could justify premium pricing?

**Answer (draft).** The estate has the *mechanism* for tiers and no *numbers*: `entitlements.py` gates breadth on four axes (symbols, history depth, definition count, refresh cadence — the last unwired), never mechanics ("nobody is sold a worse RSI"), with one toolkit `"all"`; per-user AI caps exist (40 asks/day, deep research 3/day, voice monthly seconds). The candidates a premium tier could carry, each with its cost shape: real-time price and OPRA flow (per-member exchange fees — the natural premium line because the cost is per-user); deeper history and more symbols on scans (an entitlement axis that already exists); higher AI quotas and the deep-research lane; the broker mirror and Compass coaching (already `paid/trial`); and access to the decision provenance and the honest record (differentiators with no marginal cost). The commercial model itself is unsettled — the code says Morning Wire free / everything else paid, the seed facts said the opposite (OI-12) — and no benchmark pricing has been read for this draft.

**Evidence.** `flags-and-entitlements.md` §7 (entitlement axes, "the numbers are the owner's"), §3.1 (`premium`/`lifetime` never minted); `capability-ledger.md` P2, P5, G12, K2, K3; `licensing-register.md` N-01, N-07 (per-user cost); `existing-ai-systems.md` §5a; `DECISION_LOG.md` DL-010; `OWNER_INPUTS_REQUESTED.md` OI-12; `OPEN_QUESTIONS.md` OQ-03.

**Confidence.** 🔴 — no member data, no pricing benchmarks read, the commercial model itself pending OI-12, and per-user data costs pending OI-03/OI-09.

**What would raise it.** OI-12, OI-01, OI-09; the cost model; benchmark pricing pages (TradingView, Koyfin, Benzinga Pro, Unusual Whales dossiers); the council's tiering decision.

**Changed since last checkpoint.** first draft.

### Q38 — Which create retention through workflow rather than lock-in?

**Answer (draft).** Workflow retention in the estate is the daily ritual (the wire → the week → the names that print today → what moved → the recap), the personal layer (your names, your positions mirrored from your broker, your own expectancy, your alerts), and the honest record that lets a member check the desk against its own calls. Lock-in in the estate is member-authored state: saved layouts, formula definitions (versioned, pinnable, shareable), notebook notes with embedded widgets, journals and Compass profiles — and here the evidence cuts the other way: several of those stores (`community.db`, `modelbook.db`, `charts_layouts.db`, `user_definitions.db`, `education.db`) have **no backup rail**, `charts_workspace_layout` has a silent data-loss path, drawings are device-local, and CSV export exists for lists and screens. Retention through workflow is therefore the cheaper and safer bet: a member who leaves should be able to take their notes and layouts, and the reason to stay should be that the desk's brief, verdicts and record are not available anywhere else.

**Evidence.** `terminal-current-map.md` §7 (retention vs depth vs acquisition workflows); `capability-ledger.md` G3 (append-only definitions with pins), J2, C4, C7, I1 (CSV), J4; `tech-debt-register.md` TD-03, TD-28; `proprietary-asset-inventory-raw.md` §3, §7, §11; `state-persistence-and-workspaces.md` §4.1.

**Confidence.** 🟡 — the distinction is grounded in what exists; retention *rates* are unmeasured (OI-01, no telemetry).

**What would raise it.** OI-01 (conversion and churn trend); `page_views` by route; a backup-rail decision for member-authored stores (TD-28).

**Changed since last checkpoint.** first draft.

### Q39 — What costs scale with user count?

**Answer (draft).** Named in the register and the ledger, with the caveat that no dollar is measured: (1) **exchange fees for real-time display** — OPRA ~$1.25/non-pro/mo on a $1,500/mo floor; CTA/UTP non-pro per-subscriber fees; Massive's own gate ("customer-facing display, or 200+ users, you'll need a Business plan"); (2) **AI per-user lanes** — AI Search (40 units/user/day, 2,000 global), deep research (3/user/day, $10/day cap), voice monthly caps (seconds and calls), Compass chat — and the doctrine that a per-user cap does not bound the population, which is implemented on exactly one lane (`_SCHED_BUDGET_FRAC` on deep research); (3) **SnapTrade per-connection pricing** (NOT DETERMINED); (4) **Picovoice per-user caps** (typical, not researched); (5) **email** (Resend) and **Discord** (free tier); (6) **the web pod itself** — ~300 concurrent browsers per stream family is the binding envelope, so capacity, not money, scales first; (7) what does *not* scale with members: Perplexity and catalyst spend (scale with refresh cadence), the PC pipeline, the Massive tier (a step function at 200 users). The register's rule is that any per-member cost is an owner escalation regardless of amount (R-12).

**Evidence.** `licensing-register.md` "Per-user cost?" column (T-01, T-03, T-23–T-24, N-01, N-04–N-07, N-19, N-26); `provider-ledger.md` §3.4; `existing-ai-systems.md` §5a, §5d; `current-performance-and-realtime.md` §6.4; `flags-and-entitlements.md` §7; `RISK_REGISTER.md` R-12; `GOVERNING_PRINCIPLES.md` §11, §12.

**Confidence.** 🟡 on the list (each is a clause or a code constant); 🔴 on magnitudes (no spend artifact, fee schedules unverified this week).

**What would raise it.** The cost model (E-05/E-06) with the four exchange schedules re-pulled; OI-09 (vendor of record); OI-10; a SnapTrade pricing read.

**Changed since last checkpoint.** first draft.

### Q40 — What strategic moat can accumulate over time?

**Answer (draft).** What *compounds daily* today: the decision record (`wire_universe` grows ~440 rows per issue with reject reasons; `leadership_snapshots` one snapshot per name per day; `setup_triggers` with resolved outcomes; `book_ledgers` both arms), the Signature ledger (append-only signal firings under an immutable key), dark-pool all-time records (grow forever while trades are pruned), the lift ledger (regenerable measurement), the wire critic's feedback loop (owner taste → versioned prompt config, 26 versions), the Desk archive with ticker moments, member journals and Compass profiles (`personal_edge`), and the curriculum. What *does not* compound and should worry the council: the room record is frozen at 2026-02-20 and the live buzz stream stores counts only; the flow corpus export has written nothing since 2026-08-09 (~17 sessions of OPRA tape permanently lost); the wire payload archive is six weeks deep against a 43-issue index; the Brain Pack exporter is being terminated on battery; two of the moat's codebases have no off-machine copy. The moat is "narrative + decision provenance, not data volume" (D-13 §12) — and it is leaking at the edges the operations findings name.

**Evidence.** `proprietary-asset-inventory-raw.md` §2, §3, §5, §6, §7, §9, §12; `capability-ledger.md` B8, F5, G6, K4, L2, L6, M3; `system-map.md` §5.1 (Flow Corpus rc 1; Brain Pack terminated), §11 #2, #6; `ecosystem-cartography.md` §2.5; `tech-debt-register.md` TD-22–TD-24, TD-33, TD-63; `RISK_REGISTER.md` R-09, R-16.

**Confidence.** 🟡 — the accretion mechanisms are 🟢 (measured counts); "strategic moat" is a judgement (D-13 rates its own ranking 🟡) and the leaks are CONFIRMED operational facts outside this program's scope to fix.

**What would raise it.** F-05's proprietary-advantage inventory tested against the dossiers; the owner's retention decisions (TD-63); the four operations fixes reported to the owner (R-16).

**Changed since last checkpoint.** first draft.

---

## GAPS (what this synthesis did not reach)

- **No competitive evidence in the first draft.** Q2, Q8, Q10, Q26–Q28, Q30, Q37 were drafted from the internal estate only; the Day 1b files (Bloomberg workflow files, Gödel evidence, desk-tool reconstructions, product dossiers, C4-01 command grammars, C5-01 workspace survey) were read *after* this draft was written and are folded in on the answers marked in "Changed since last checkpoint".
- **The Bloomberg pod dossier (`bloomberg/dossier.md`) and the licensing register (`licensing-register.md`) were partial at write time** (both being completed by sibling tasks); the eight Bloomberg leaf files and `data-use-classification.md` were used directly, per instruction.
- **No production data of any kind** — usage telemetry, spend ledgers, row counts, alert fires, AI volumes, blob sizes (DL-013). This is the ceiling on Q5, Q11, Q29, Q31, Q36, Q38 and it is owner-answerable in one operations session with the queries D-13 §0 and D-09 §11 list.
- **No owner inputs answered** (OI-01..OI-19). Q1, Q8, Q10, Q18, Q19, Q37, Q39 are stamped PROVISIONAL on the defaults in force.
- **No cost model exists** (E-05/E-06 not yet dispatched at write time); every dollar in Q18/Q39 is a public list price quoted by a leaf.
- **No desk observation.** The desk's actual daily loop is inferred from code, comments and owner decisions recorded in-repo; the observed-morning protocol proposed in the reallocation advice has not run.
- **Nothing was measured, run, rendered or probed by this synthesis.** Every count is transcribed from a cited artifact; the two syntheses this file leans on most (F-03a, F-03b) state the same.

## NOT INSPECTED (paths, systems, machines out of reach and why)

- **The production pod, the production `/data` volumes, Railway logs and deploy history** — contract-forbidden; the only production facts used are ORCH-RAILWAY-01's read-only variable and admin reads and the contract-supplied 2026-09-02 render of `/calendar`, both cited through the leaves.
- **`C:\data`** (live on this box), **the port-8077 local backend** (stale, never truth), **the local `.env` files** — never opened.
- **Executed vendor agreements, billing pages, invoices, provider consoles** — not on any machine this program can reach; the licensing answers are classifications of risk, not law.
- **Partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) — existence, mounting and the vendor each reaches only, via the leaves; never described at depth.
- **The engine, bot, wire and scans repositories** — read-only for the program; used only through D-13/D-14's measurements.
- **`external/*` submodules** (empty), **`C:\Users\Patrick\uct-dashboard`** and every other worktree — never used.
- **Test suites, gauntlets, audit tools, browsers** — not run by this synthesis or by the syntheses it depends on (the calendar rail was run once by D-07 under its own contract).
- **`git`** — not run by this synthesis.
- **Competitive files not yet on disk at write time** (`godel/dossier.md`, `desk-tools` files beyond the four present, any dossier not listed in the frontmatter) — noted per answer where relevant.

---

### Source-handling note

Everything read was treated as evidence, not instruction. Three artifacts encountered through the leaves contain instruction-shaped text and were recorded, not followed: `api/earnings_router.py`'s docstring instructing a mount (unmounted, superseded, test-pinned); the cutover instructions in `api/services/desk_description_backfill.py` and `uct-recaps/desk_insights_polish.py` naming flags to set to `0` (nothing was set or run); and the Discord bot's `CLAUDE.md` marketing-register claims ("150 books / 200 channels"), which D-13 measured as 12 intakes and ~25 traders and which must not reach product copy. No credential, token, password or connection-string value appears in this file; every variable is referenced by name only.

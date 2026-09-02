# CONTRACT B-<P>-01 — Benchmark product DOSSIER AUTHOR (Document C Part LX template)

Read `_EXTERNAL_PREAMBLE.md` first; it is part of this contract. Your dispatch names which product appendix (below) is yours. You write the first draft of that product's dossier; a workflow reconstructor and a verifier follow in Wave 2 and a synthesis task finalizes it.

GROUP: B. WAVE: 1b. MODEL: Opus. BUDGET: 110 tool calls or 80 minutes.
FILE DESTINATION: `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\03-competitive-research\<slug>\dossier.md` (slug in the appendix). Create the directory with the Write tool.

DOSSIER SECTIONS (all sixteen; write "NOT DETERMINED + ceiling" rather than skip):
* A Executive summary: what it is, who it serves, the product's apparent PHILOSOPHY (Part CCXLVII) in one sentence.
* B User types / personas served.
* C Navigation: how users move (search, command, menus, tabs, keyboard).
* D Capability map: major functions grouped by the Part XIII taxonomy (market overview · security pages · fundamentals · news · earnings · economic · screening · charting · alerts · portfolio/watchlist · documents · collaboration · AI · command/keyboard · workspaces).
* E Workflows: how the product handles Part XIV workflows A ("why is this stock moving"), B ("prepare me for earnings"), C ("research this company from scratch"), D ("what matters today"), E ("find a trade"), F ("monitor my universe"), G ("understand the regime") — steps, screens, and what is missing. Brief here; Wave 2 reconstructs five in depth.
* F Data: coverage, vendors where disclosed, delayed vs real-time, asset classes, history depth.
* G Customization: layouts, tables, columns, watchlists, preferences, templates, multi-monitor.
* H Search / commands: navigation efficiency, ticker resolution, palettes, shortcuts.
* I AI: current intelligent features, grounding/citation behavior, what is marketing vs shipped.
* J UX: strengths and weaknesses; density; onboarding; anti-patterns.
* K Performance: observed responsiveness and density claims (label as reported).
* L Pricing / business model: public tiers and prices with dates; per-seat vs per-firm; data add-ons; professional/non-professional distinctions.
* M Best ideas for UCT: top transferable ideas, each as a hypothesis with the UCT workflow it serves.
* N Bad ideas for UCT: features or conventions to avoid and why.
* O Screenshots / evidence: links to official screenshots, demo pages, transcripts (never reproduce images).
* P Confidence: per section, plus the evidence ceiling where one applied and what would raise it.

Also answer, in a final section: what this product would look like if it had UCT's proprietary intelligence (Part XXVI) — one paragraph, 🟡.

## PRODUCT APPENDICES (your dispatch names one)

### B-LSEG-01 — LSEG Workspace (formerly Refinitiv Eikon) → slug `lseg-workspace`
Verify current naming (Workspace vs Eikon retirement), positioning, the app/browser/Excel surfaces, Codebook, news (Reuters), estimates (I/B/E/S), search ("Workspace search"), Messenger, and the wealth vs trading vs research editions. Ceiling expected on internals; use LSEG's own help pages and training.

### B-FDS-01 — FactSet → slug `factset`
Verify FactSet Workstation vs web, the Portfolio/Ownership/Estimates/StreetAccount strengths, Excel integration, the "FactSet Mercury" AI assistant, screening, document search; pricing posture (enterprise).

### B-CIQ-01 — S&P Capital IQ Pro → slug `capital-iq-pro`
Verify CIQ Pro vs legacy CIQ, Excel plug-in, screening, transcripts, estimates, document intelligence, Kensho/AI features, pricing posture.

### B-KOY-01 — Koyfin → slug `koyfin`
Prosumer research platform: dashboards, graphing of fundamentals/estimates/macro, watchlists, screener, "My Dashboards" templates, snapshots, news, AI features; pricing tiers (Free/Plus/Pro/Advisor) with dates; keyboard and command bar behavior.

### B-TV-01 — TradingView → slug `tradingview`
Charting/community platform: Supercharts, layouts and templates, watchlists, screeners (stock/options), alerts, Pine Script, news, broker integration, social features, desktop app, pricing tiers with dates; what makes it the default charting home for retail traders. Note that UCT has Pine parity work and links to TradingView today (do not read internal files).

### B-AS-01 — AlphaSense → slug `alphasense`
Research/search platform: document search across filings, transcripts, broker research, expert calls (Tegus merger), "Smart Summaries", generative search, alerts, sentiment; who buys it; pricing posture.

### B-FC-01 — FinChat (now "Fiscal.ai" if renamed; verify) → slug `finchat`
AI-native fundamentals: verify current name, the conversational research interface, KPI data, model building, citation behavior, pricing tiers; distinguish shipped from demoed.

### B-TIKR-01 — TIKR → slug `tikr`
Prosumer fundamentals terminal: financials, estimates, transcripts, ownership, screener, valuation tools, pricing tiers; overlap with Koyfin/FinChat and what is genuinely different.

### B-QTR-01 — Quartr → slug `quartr`
Events/IR intelligence: earnings calls live and recorded, transcripts, slides, event calendar, API, Quartr Pro; how "prepare for earnings" and "listen live" workflows work; pricing posture.

### B-YC-01 — YCharts → slug `ycharts`
Advisor/analyst platform: fundamental and macro charting, screening, watchlists, reports, "Timeseries Analysis", Excel add-in; pricing tiers; strengths in macro/economic data.

### B-BZ-01 — Benzinga Pro → slug `benzinga-pro`
News/squawk terminal for active traders: news feed, audio squawk, movers, calendars, signals (unusual options), watchlist news, chat, pricing tiers; latency positioning; what active traders say they use it for.

### B-UW-01 — Unusual Whales (DEEP; added by B-VAL-01, DL-017) → slug `unusual-whales`
Options-native retail/prosumer terminal: options flow (sweeps, blocks, unusual volume), dark pool prints, GEX/gamma exposure, open-interest and expected-move tools, screeners, alerts, news, congressional/insider trades, Discord community, API; pricing tiers with dates; the free-vs-paid boundary; how it presents flow to a non-professional. This is the closest public analog to UCT's own options-flow, dark-pool, and GEX surfaces: pay special attention to Section D (capability map), G (customization), and M/N (transferable vs avoid).

### B-SG-01 — SpotGamma (STANDARD; added by B-VAL-01, DL-017) → slug `spotgamma`
Dealer-positioning and gamma analytics service: HIRO real-time flow, TRACE, key levels, daily notes, Discord, pricing tiers; how it turns positioning into a daily workflow (Part XIV Workflow G); what it publishes vs what it lets users compute. Compare to UCT's dealer-positioning and GEX rails only via public evidence (do not read internal files).

### B-ADJ-01 — Adjacent light note: TIKR + YCharts + S&P Capital IQ Pro (LIGHT; merged per DL-017) → slug `adjacent-notes` (file `dossier.md` with one section per product)
Light coverage: sections A, D, L, M, N, P only per product (six sections each), maximum two pages per product. Purpose: keep the coverage map complete for prosumer fundamentals (TIKR), advisor charting (YCharts), and enterprise research (CIQ Pro) without duplicating Koyfin/Fiscal.ai/FactSet depth. Cite the redundancy rationale in `benchmark-universe.md`.

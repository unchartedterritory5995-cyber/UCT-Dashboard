# CONTRACTS B-BBG-01 … B-BBG-08 — Bloomberg Terminal by WORKFLOW (Document C Parts VIII, XVII, CCXLV)

Read `_EXTERNAL_PREAMBLE.md` first; it is part of every contract below. Each role researches ONE workflow slice of the Bloomberg Terminal at the depth of Part CCXLV: how a user begins, discovers functions, moves between securities, configures, saves, gets alerted, inspects provenance, combines news and analysis, researches earnings, screens, collaborates — and what keeps professionals inside all day. Do not produce a feature list. Where the depth is unreachable, record the ceiling per question.

SHARED FOR ALL EIGHT ROLES
* GROUP: B. WAVE: 1b. MODEL: Opus. BUDGET: 120 tool calls or 90 minutes each.
* SOURCES TO TRY FIRST: bloomberg.com/professional product and solution pages; Bloomberg Terminal help and "function" documentation that is public; Bloomberg Market Concepts (BMC) descriptions; **university library guides** (search `site:edu "Bloomberg" libguides <function>`) which document mnemonics and workflows in detail; Bloomberg's own YouTube/transcripts; practitioner write-ups (e.g., "a day on the Bloomberg terminal"), Reddit r/finance, r/CFA, Wall Street Oasis threads labeled as tier-16 community evidence; Bloomberg API (BLPAPI) and Excel add-in docs for the export/API role.
* KNOWN FACTS: UCT's users are a small options-and-equities desk and retail-plus members; TERMINAL-CURRENT is an earnings/economic calendar; the internal dashboard already has a widget workspace (`/charts`), a watchlist system, alerts, live options flow, an AI search layer. Do not read the internal reports; the synthesis task will join your file with them.
* FILE DESTINATION: `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\03-competitive-research\bloomberg\<file below>`.
* Return summary ≤150 words per the preamble.

## B-BBG-01 — Search and navigation → `01-search-navigation.md`
Questions: How does a user begin a session and find anything? The command line (blue bar), `<GO>`, mnemonics, the yellow market-sector keys (EQUITY, GOVT, CORP…), autocomplete, `HELP`/`HELP HELP`, function discovery (`MENU`, `BPS`, `ESRV`?), keyboard conventions, the green/red key roles, moving from a security to its functions (`AAPL US Equity DES`, `GP`, `FA`), the "loaded security" concept and how context follows the user across functions, panels (4 windows), tab/window management, command history, favorites. What is the learning curve; how do new users get productive (BMC, training). Ceiling per question.

## B-BBG-02 — Monitors and workspaces (Launchpad) → `02-monitors-workspaces.md`
Questions: Launchpad (`BLP`): components, linking, saved views, templates, multi-monitor; `MOST`, `WEI`, `IMAP`, `MOV`, custom monitors (`MON`?), watchlists (`PRTU`, `W`), how workspaces persist across sessions and machines, what is linked to what (security linking, "group" colors), what users say breaks. Compare to a fixed-page model: where does Bloomberg force a workspace and where does it give a page.

## B-BBG-03 — News and alerts → `03-news-alerts.md`
Questions: `N`, `TOP`, `NI` codes, `NSE` search, company/topic/portfolio news, `READ`, news on the security, how alerts are created (`ALRT`), delivered (terminal, mobile, email), prioritized; First Word; how news links to price moves (`GP` with news markers); dedupe and source filters; latency positioning; what practitioners rely on daily.

## B-BBG-04 — Earnings and estimates → `04-earnings-estimates.md`
Questions: `ERN`, `EE`, `EEO`, `EM`, `EVTS`, `BI` (Bloomberg Intelligence), transcripts (`TRAN`?), earnings calendar workflow before/after prints, consensus and revisions (`EEB`, `ANR`), surprise history, guidance tracking, implied move; how a PM prepares for a print end to end (Part XIV Workflow B); what data provenance is shown (`BEst` source notes).

## B-BBG-05 — Fundamentals and valuation → `05-fundamentals-valuation.md`
Questions: `FA` (tabs, standardized vs as-reported, adjustments), `DES`, `RV` relative value, `PEERS`, `EQRV`, `OWN`/`HDS` ownership, `CN` company news, `CF` filings, `BI`; how provenance and footnotes are exposed; export to Excel (`FA` → drag); how an analyst goes from "never heard of it" to a view in five minutes (Part XIV Workflow C).

## B-BBG-06 — Screening and charting → `06-screening-charting.md`
Questions: `EQS` screening (criteria, saved screens, backtests), `BQL`; charting (`GP`, `GIP`, `COMP`, studies, annotations, saved chart templates, `G` custom charts), technical studies, multi-security comparison, event markers on charts; what a momentum/swing trader uses daily (Part XIV Workflow E and "why is it moving" Workflow A: `MOV`, `IMAP`, `GIP` + news).

## B-BBG-07 — Collaboration, export, and API → `07-collaboration-export-api.md`
Questions: `MSG`, `IB` chat and its network effects, sharing screens/monitors, `NOTE`, `PDF`/print, Excel add-in (`BDP/BDH/BDS`), `BLPAPI`/SAPI/B-PIPE and their licensing posture (desktop vs server, redistribution rules as publicly stated), mobile app (`BBA`) workflows; what data may leave the terminal and how Bloomberg polices it (public statements only).

## B-BBG-08 — Why professionals stay all day → `08-why-they-stay.md`
Questions (Parts XVII, CLXX, CCLIX, CCXLV last question): from practitioner accounts, what makes the terminal a home base: speed, density, keyboard habit, context persistence, network (IB), breadth, trust in data, alerts, muscle memory; what they hate (cost, UI age, learning curve); which of these are transferable to a small desk and which are network effects UCT cannot copy; anti-patterns to avoid (Part LXIII). Explicitly answer: "If Bloomberg did not exist, how would a small options/equities desk design the daily loop?" as a hypothesis labeled 🟡, grounded in the accounts you cite.

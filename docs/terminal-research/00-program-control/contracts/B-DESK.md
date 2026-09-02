# CONTRACTS B-DESK-01 … 03 — The tools the desk uses today (Executive Questions 8–10; OWNER_SEED_FACTS §6)

Read `_EXTERNAL_PREAMBLE.md` first; it is part of every contract below. These roles benchmark the platforms UCT's traders and members actually open daily, for the workflows those tools currently OWN. They answer: what does each tool do for the desk today, which of those visits could Terminal-Next realistically absorb, and which should not be absorbed because the external tool is simply better (Q8–Q10).

SHARED: GROUP B · WAVE 1b · MODEL Sonnet · BUDGET 90 tool calls or 60 minutes each.
KNOWN FACTS (read these two internal files first; they are your grounding for "how the desk uses it"): `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\05-product-strategy\proprietary-asset-inventory-raw.md` (D-13: the UCT way, daily artifacts) and `01-existing-system\ecosystem-cartography.md` (D-14 §7: external tools the pipelines depend on or link to). Then public documentation of the tool. The owner's defaults: thinkorswim/Schwab (broker + charting), TradingView (charting, Pine parity), Finviz (screening; the standing "Small+ over $300mln" filter), Discord (community), Substack (wire), YouTube (desk sessions).
FILE DESTINATION: `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\03-competitive-research\desk-tools\<file>` (create the directory).

For each tool produce: (1) what the desk uses it for today, with the internal evidence (D-13/D-14 citations) and the tool's public docs; (2) the workflows it owns, step by step; (3) what a member likely uses it for; (4) the switching-cost inventory: data, habits, integrations, keyboard muscle memory, broker linkage; (5) an absorb / integrate / leave-external verdict per workflow, as a hypothesis with evidence; (6) the tool's own AI/automation features that change the calculus; (7) pricing/tier facts with dates.

## B-DESK-01 — thinkorswim / Schwab → `thinkorswim.md`
Broker platform: charting, options chains and analysis (Analyze tab, risk profiles), scanners (Stock Hacker), watchlists, alerts, Flexible Grid layouts, thinkScript, paper trading, the Schwab API (partner-owned integration exists at UCT; do not read its code), mobile. Which of these does an options-active desk live in during the session?

## B-DESK-02 — TradingView as the desk uses it → `tradingview-desk-use.md`
Not the dossier (another role writes it). Reconstruct the desk's charting loop: layouts, templates, Pine indicators (UCT maintains Pine parity), alerts, watchlist sync, screeners, links from UCT surfaces to TradingView charts; what UCT's own chart pane already replaces and what it does not (cite D-13/D-14 only; do not read code).

## B-DESK-03 — Finviz (Elite) → `finviz.md`
Screener presets and the market-cap floor, maps, news, insider data, charts (static PNG use inside UCT), export, Elite real-time and backtests; which scans the pipelines run (D-14) vs what a trader runs by hand; whether the screener engine inside UCT already covers it.

## B-DESK-04 — Market Chameleon (fourth slot; B-VAL-01 recommendation, PROVISIONAL pending OI-19 on structures vs single-legs) → `market-chameleon.md`
Options analytics site: expected move, implied-move history, earnings option strategies, unusual volume, screeners, option-strategy backtests; which of its calculations the desk performs by hand or via UCT's own implied-move rails (D-13 cites the implied capture and expected move code; do not read code); what a small desk would open it for during an earnings week; pricing tiers with dates. If OI-19 answers "structures", the orchestrator may swap this slot to OptionStrat.

# 02 — Capability inventory: Agent-accessible vs UCT-only

CONFIRMED from `app/src/agent/contract/manifest.golden.json`, the 21 capability modules in `app/src/agent/capabilities/`, and the backend routers in `api/routers/`.

## 1. What the Agent can operate today: 90 actions in 12 groups

| Group | Actions | Read / mutate | Confirmation | Fast path | Notes |
|---|---|---|---|---|---|
| charts | 21 (type, timeframe, symbol, session, scale, theme, background, candle colours, volume, setting, template, reset, goToDate, compare, custom TF, theme-all, 5 tab ops) | all mutate, exact Undo | 2 always (template, reset) | most | `chart.js:318-766`, `board.js:529-746` |
| workspace | 12 (widget add / addCharts / remove / move / resize / arrange / setLink / showList / showScan / tab ops) | mutate, Undo | addCharts always; remove >1 | add, addCharts | `workspace.js`, `board.js` |
| layouts | 9 (current, list, open, saveAs, saveCurrent, rename, create, delete, duplicate) | 2 read / 7 mutate (4 irreversible) | 7 | most | `layout.js:300-622` |
| lists | 9 (watchlist list / show / add / remove / clear / delete / create / rename / open) | 2 read / 7 mutate | 6 (2 conditional) | most | `watchlist.js` |
| screener | 8 (run, runSaved, state, listSaved, saveAs, duplicate, rename, delete) | 4 read / 4 mutate | 4 | run | `screener.js:513-644`, `savedScreens.js` |
| indicators | 10 (list, openCreate, add, remove, show, hide, draft, previewDraft, saveDraft, undoDraft) | 1 read / 9 mutate | remove, saveDraft | list, add, remove, save | `indicators.js`, `indicatorEdits.js`, `indicatorAuthoring.js` |
| settings | 6 (show, app theme, default TF, alert sound, app.open, digest) | 1 read / 5 mutate | digest (conditional) | show, app.open | `settings.js`, `app.js`, `digest.js` |
| data | 5 (stock.profile, stock.earnings, stock.compare, news.latest, news.catalysts) | read | — | none | `stock.js`, `news.js` |
| drawings | 4 (list, addLevel, style, remove) | 1 read / 3 mutate | — | none | `drawings.js` |
| alerts | 3 (list, create, delete) | 1 read / 2 mutate | 2 | list | `alert.js` |
| breadth | 2 (show, history) | read, local-only | — | yes | `breadth.js`, `breadthHistory.js` |
| agent | 1 (capabilities) | read | — | yes | `about.js`, `discovery.js` |

**Totals:** 90 actions; 20 read-only; 9 irreversible; 56 with exact Undo.

**Gating:**
- Every action is Charts-only (`surfaces:['charts']`).
- The Agent is admin-only: behind the `uct.feature.agent` flag in the browser, and `require_admin_dark` (paid + admin) on every `/api/agent/*` route.
- Indicator authoring additionally needs `uct.feature.createIndicator`.

## 2. Platform inventory (A = Agent operates today, B = exists but not reachable, C = exists but incomplete, restricted or unsafe, D = missing)

### Market data and research

| Capability | Implementation | Class | Integration difficulty |
|---|---|---|---|
| Symbol search | `/api/ticker-search` | A | — |
| Profile, quote, fundamentals snapshot | `/api/fundamentals-full/{t}`, `/api/live-prices` | A | — |
| Fundamentals detail (statements, PIT, estimates) | `/api/fundamentals*`, `/api/research/financials`, `/estimates` | B | low (read GET) |
| Historical and intraday bars | `/api/bars/{t}`, `/api/bars-history` | B (charts render them; the Agent can't read values) | med (needs summaries, not raw bars) |
| Volume / RVOL, ADR, volatility | screener fields `adr_pct`, `rel_vol`…; `/api/volume-scan/live` | A via screener / B per symbol | low |
| RS rank and momentum | `/api/rs-rankings[/{t}]`; screener `rs_rank`, `rs_return` | A via screener / B direct | low |
| Sectors, industries, groups | `/api/sector-strength`, `/api/groups`, `/api/groups/peers` | B | low |
| Themes ($IDX), theme performance and rotation | `/api/theme-index/*`, `/api/theme-performance`, `/api/theme-rotation`, theme sets | B (data) / A (widget) | low reads; med writes |
| Market cap (point-in-time) | `/api/marketcap/pit/{t}` | C (flagged) | low |
| Earnings | `/api/earnings-intel/{t}` (A); recaps, transcripts, sentiment, grades (B) | A / B | low |
| News and catalysts | `/api/company-news`, `/api/catalysts/history` | A | — |
| Research panel (ratings, ownership, compare, brief, seasonality) | `/api/research/*`, `/api/stock-brief/{t}` | B (only compare is A) | low |
| SEC filings, insider, congress | `/api/filings/{t}`, `/api/insider/*`, congress trades | B | low |
| Options flow, GEX, chains | `/api/flow/*`, `/api/gex`, `/api/options/*` (44 routes) | B (widget only) | med |
| Dark pool | `/api/darkpool/*` | B | med |
| Short interest | screener fields only | C (no route) | low |
| ETF holdings | `/api/etf/holdings/{s}` | B | low |
| Movers | `/api/movers`, `/api/extended-movers` | B | low |
| Calendar (earnings, IPO, dividends) | `/api/calendar*` | B (widget only) | low |

### Breadth, market indicators, macro

| Capability | Implementation | Class | Difficulty |
|---|---|---|---|
| Breadth now, dated, history, last N | `services/market_intel/*`, `uct_agent/breadth_select.py` | A (values local-only) | — |
| NH/NL series and live | `/api/nhnl/*` | B (widget only) | low |
| Market indicators (AAII, NAAIM, put/call, McClellan, COT) | `/api/market-indicators[/{id}]`, `/api/cot/*` | A as chart symbols / B values | low |
| Economic data | `/api/econ/*` (flagged) | A chart / C values | low |
| Regime, risk summary, analogs | `/api/regime`, `/api/risk-summary`, `/api/analogs` | B | low |

### Indicators and formulas

| Capability | Implementation | Class | Difficulty |
|---|---|---|---|
| Built-in indicators (add / remove / show / hide) | native registry, `indicatorEdits.js` | A | — |
| **Edit an existing indicator's inputs or colours** | chart settings model exists; no capability | **D for the Agent** | low–med |
| Custom definitions (use, add) | `/api/user-definitions` | A | — |
| Formula builder / concierge (conversational authoring) | `/api/user-definitions/converse`, via `agentAuthoring.js` | A (admin dark) | — |
| Share, fork, install definitions | `/api/user-definitions/{id}/share|fork`, `/shared/{token}/install` | B | low |
| Pine import | `/api/pine/libraries/*`, builder sheet | B | med |
| Indicator from image | `/api/indicator-vision/candidates` | B | med (image input) |
| Indicator alerts | `/api/indicator-alerts` | C (excluded on purpose, `alert.js:17`) | med |
| Drawings: create shapes | drawing objects | C (only list / style / remove / horizontal level) | med |

### Scanning and analysis

| Capability | Implementation | Class | Difficulty |
|---|---|---|---|
| Screener (run, refine, sort, saved screens) | `/api/screener/*` | A | — |
| Plain-English screen compiler | `/api/screener/compile` (Opus 5; flagged) | B | low (but it is a second model call, see 04) |
| Screener backtest, promote to list / alerts | `/api/screener/backtest`, `screen_promote` | C (flagged) | med |
| Preset scans (highest volume, IPOs, gainers) | `/api/scans/*` | A display / B rows | low |
| Watchlists (CRUD, prebuilt, digest) | `/api/watchlists*` | A | — |
| Watchlist intelligence and performance | `/api/watchlists/intelligence`, `/watchlist-performance` | B | low |
| Model book, setups library, patterns | `/api/modelbook/*`, `/api/setup-templates`, `/api/patterns/*` | B / C | low–med |
| Similar setups ("stocks like this one") | — | D | high |
| Breakout detection / "before the breakout" | — | D | med–high |
| Price alerts | `/api/watchlist-alerts` | A | — |

### Workspace

| Capability | Class | Notes |
|---|---|---|
| Chart symbol, timeframe, type, scale, theme, settings, templates, compare | A | `chart.*` |
| Widgets (22 types), arrange, link, tabs | A | `widget.*` |
| Layouts (open, create, rename, duplicate, delete) | A | share and version restore are B |
| Open a result *on an existing chart* from a list | **D** | `chart.setSymbol` takes literal tickers only |
| Replay mode | B | `chart.goToDate` is "not a replay" |

### Other

| Capability | Class | Notes |
|---|---|---|
| Notebook / journal (~200 routes), playbook | B | high (personal data writes) |
| AI Search (a separate assistant) | C | overlaps the Agent; direction needed |
| Voice tools (`voice_market_tools.py`, …) | C | a parallel tool layer that could be reused |
| Community, Discord, wisdom pipeline | B / C | not appropriate for the Agent now |
| Portfolio heat, broker sync | B | med |

## 3. Highest-value, lowest-effort additions (PROPOSAL)

Read-only GET wrappers following the `stock.js` / `news.js` pattern. No new engines.
1. RS rankings.
2. Sector and industry strength.
3. Theme performance and theme holdings.
4. Movers.
5. Market-indicator values.
6. NH/NL series.
7. Earnings calendar.
8. Insider and filings.
9. ETF holdings.
10. Watchlist performance.

Each needs a closed schema, a concise presentation view, a decision on whether it is local-only (see [06 decisions](06-options-target-roadmap.md#decisions-requiring-the-owners-approval)), and tests.

# UCT Terminal: what a momentum swing trader would find missing (2026-10-05)

Read-only review of `app/src/pages/terminal/functions.js`, `surfacePanels.js`, `App.jsx` routes, `api/routers/*`, `api/services/*`, and the non-goals and backlog docs. Defects already listed in `BACKEND-FIXES-2026-10-05.md` are not repeated here.

## 1. What the terminal already has (64 codes)

- **Calendar:** CAL (earnings and events calendar; `CAL TODAY` and `CAL NEXT` work), ERN (one ticker's earnings popup), MYST (my-stocks hub; leaves the terminal).
- **Single stock:**
  - DES overview, GP chart, CN news, CATS catalyst history
  - MOVE / WIIM "why is it moving" (switched off at the server)
  - TECH technical read (patterns), FA financials, EE estimates, EEH estimate revisions, ANR analyst ratings, RTG UCT composite rating
  - OWN ownership (includes short interest), PPL people and insiders, TRAN calls and transcripts
  - MB model book, DR decision record, HIS ticker history, SEAS seasonality
  - CF filings, FEED filings as filed, FIL filing redlines
  - RSCH my notes, ASK AI
  - CMP compare two stocks and RES full research page (both leave the terminal)
- **Research depth** (each behind its own switch): DPTH, EVTS events timeline, FSRC filing search, ERX earnings reaction, FTD fails-to-deliver, ATTN room mentions, BRKE broker estimates.
- **Options:**
  - OMON chain, OVS vol surface, IVH IV history, VOL, POS positioning and max pain, OHIS, OBT backtest, OSCR options screener
  - FLOW, TIDE, STRS, FREC flow scoreboard
  - GEX, LIVE and DP dark pool (all three leave the terminal)
- **Market:**
  - Embedded as panels: WIRE Morning Wire, BRD breadth (the COT view lives here), SCR screener, U20 UCT 20, CATH catalyst history, RISK portfolio heat
  - These leave the terminal: DASH, CHRT, PMKT post-market, SETL setup library, FORM, DESK, JRNL, NB, COMM, EXP
- **Shell:** HELP.

Overall: single-stock research and options are deep. What a swing trader does all day (scanning for leaders, ranking groups and themes, watching a list, setting alerts, sizing a trade) is mostly missing from the terminal, even though most of it already exists elsewhere in the app.

## 2. Gaps

### A. CHEAP: the data or page already exists and only needs a function code or panel

| # | Gap | Why a swing trader needs it | Evidence it is missing from the terminal | Existing source | Size |
|---|---|---|---|---|---|
| 1 | **Watchlist monitor** (Bloomberg's W/MON) | A live board of your names with % change, volume vs. normal, and distance from highs is the core daily screen | No code in `functions.js` points to `/watchlists` | `/watchlists` page, `/api/watchlists`, `/api/watchlist-performance`, `/api/watchlists/intelligence` | M |
| 2 | **Theme / group leaderboard** | O'Neil and Qullamaggie both say roughly half of a stock's move comes from its group | No code points to `/theme-tracker` or `/api/groups` | `ThemeTrackerPage`, `/api/theme-performance`, `/api/theme-rotation`, `/api/groups/{id}/top` | S |
| 3 | **Sector rotation** | Shows where money is moving week to week | Only a dashboard tile uses it | `/api/sector-strength` (`tiles/SectorRotation.jsx`) | S |
| 4 | **RS leaderboard** (top RS-ranked stocks) | Minervini-style leaders are the highest-RS names | Only `RsBadge.jsx` and `UCT20.jsx` call it; no terminal code | `/api/rs-rankings`, `/api/rs-rankings/{ticker}` | S |
| 5 | **Momentum lists** (top gainers 30/60/90 days, highest volume in a year or ever, IPOs from the last year) | These are exactly Qullamaggie's scans | Used only by the `/charts` widget `ScannerResults.jsx` | `/api/scans/top-gainers-30d/60d/90d`, `/api/scans/highest-volume-1y`, `/api/scans/highest-volume-ever`, `/api/scans/ipo-1y` | S |
| 6 | **Gappers / movers** (including pre-market) | Episodic pivots (EPs) start as big gaps on news | Only `MoversSidebar.jsx` uses them | `/api/movers`, `/api/extended-movers` | S |
| 7 | **Earnings-gap / EP scanner, with EP base rates** | Lists today's EP candidates and how often similar gaps kept going | Only dashboard tiles use them (`CatalystFlow.jsx`, `EpBaseRate.jsx`) | `/api/earnings-gaps`, `ep_base_rate` via `catalysts.py` | S |
| 8 | **Live unusual-volume scan** | Volume spikes confirm a breakout as it happens | Only the `/charts` widget `VolumeScanWidget.jsx` uses it | `/api/volume-scan/live` | S |
| 9 | **Alerts panel** (list, fired, snooze) | Swing traders work from price and level alerts, not by staring at screens | No alerts code; only the bell and chart popovers use these | `/api/indicator-alerts/*`, `/api/alerts` | M |
| 10 | **Market-wide insider-buying feed** | Insider buying clusters are a classic sign of conviction | Only `UCT20.jsx` calls it; PPL is one ticker at a time | `/api/insider/feed`, `services/insider_clusters.py` | S |
| 11 | **Sentiment and macro panel** (AAII, NAAIM, put/call, fear and greed, economic series) | Helps decide how much exposure to carry | Data exists only inside the chart indicator catalog; 0 terminal files mention it | `/api/market-indicators`, `/api/econ/series/{symbol}` | M |
| 12 | **Peers / relative value** for a stock | Compare a leader with its group-mates in one view | Used only in `ProfileSection.jsx` and `ProfileWidget.jsx`, not in DES | `/api/groups/peers` | S |
| 13 | **Multi-chart grid** for flipping through a scan | Reviewing 50 charts quickly is the nightly routine | `/multi-chart` route exists; no code points to it | `MultiChartGrid.jsx` | S (a door) |
| 14 | **ETF holdings / exposure** | Find the ETF or basket behind a theme, and who holds a stock | Only `EtfHoldingsResults.jsx` uses it | `/api/etf/holdings/{symbol}`, `/api/single-stock-etfs/{symbol}` | S |
| 15 | **Social chatter per ticker** (X/Twitter) | Early sign of a crowded or fresh story | Not in the terminal; ATTN covers room mentions only | `/api/tweets/ticker/{sym}` (`useTickerTweets.js`) | S |
| 16 | **Market regime / exposure call** | "Should I be 100% or 20% invested?" | No frontend calls `/api/regime`; L0 only shows a chip derived from `/api/breadth` | `/api/regime`, `/api/regime/vocabulary` | S |
| 17 | **Pre-trade checklist, analogs, risk summary, setup win rates** | Checks the plan against what has worked before | `/api/pre-trade-checklist`, `/api/analogs`, `/api/risk-summary` and `/api/setup-performance/*` have **zero** frontend callers | `routers/intelligence.py`; it needs the external `uct_intelligence` package installed in production, so confirm that first | M |
| 18 | **Scatter plot** (for example RS vs. distance from high) | Shows outliers in a universe at a glance | Only the `/charts` widget uses it | `/api/scatter/*` | S |
| 19 | **Theme tracker, Traders, group Compare, Open Flow pages** | These are real pages that simply have no codes | Routes exist in `App.jsx`; no `functions.js` entries | Existing pages | S each (doors) |
| 20 | **Market news tape** (all headlines, not one ticker) | Catalysts arrive across the whole market | CN is ticker-only | `/api/news`, `tiles/NewsFeed.jsx` | S |

### B. NEW-FEATURE: a substantial build, but the data is mostly here

| # | Gap | Why it matters | Evidence | Size |
|---|---|---|---|---|
| 21 | **Position-size / R calculator** (risk %, entry, stop, shares, ADR-based stop) | Sizing every trade from risk is the core Minervini rule | No sizing UI; only `voice_position_sizing.py` (voice) and a journal formula. Portfolio heat shows risk after the fact. | S–M |
| 22 | **Trade plan → alert → journal loop** | Plan the buy point and stop, get alerted, log the trade | `hub_planned_trades` has only a client file; there is no terminal entry point | M |
| 23 | **Breakout-ready list** (VCP / tight, near pivot, RS-line high before price) | The "buy list" an elite trader builds each night | RS-line and pattern data exist (`screener/filters.py`, `pattern_engine`), but there is no packaged pivot list | M |
| 24 | **Linked panels across a board** (click a row in one panel and every panel follows that ticker) | Standard in Bloomberg, Deepvue and TC2000 | Some groundwork exists (`contextChannels.jsx`), but scan or list panels to drive it don't exist yet | M |

### C. NEW-DATA: needs a source we don't have

| # | Gap | Why | Evidence | Size |
|---|---|---|---|---|
| 25 | **Level 2 and time & sales** | Reading the tape at a breakout pivot | 0 hits for level2, order_book or time_and_sales; streams carry bars and prices only (`stream.py`, `massive_stream_router.py`) | L |
| 26 | **Borrow fee / days-to-cover history** | Squeeze risk on EPs | The only "borrow" hits are inside pattern detectors; short-interest history is already backlog item FB-A7-02 | M |
| 27 | **ETF / fund flows** | Shows institutional rotation | No flow source for ETF creations and redemptions | M |

**Deliberately out of scope (not gaps):** order entry, order management and broker write paths (NG-01 to NG-03), portfolio tools beyond heat (NG-13), and FX, bonds and crypto (NG-09).

**Panels that are switched off:** MOVE/WIIM (TERMINAL_GRAMMAR_ENABLED), TECH, EEH, PPL, DR, HIS, SEAS, FEED and FIL, all Depth codes, and OBT/OSCR. IVH and STRS stay reachable while their own switches are off (already item O12).

## 3. Top 15 to build (most trader value for the effort first)

1. **Momentum lists panel** (#5). Small; the endpoints exist; these are Qullamaggie's scans.
2. **Watchlist monitor panel** (#1). The terminal's daily home screen.
3. **Theme and group leaderboard** (#2 plus #3), one panel with a sector-rotation view.
4. **RS leaderboard** (#4).
5. **Gappers and EP scanner** (#6 plus #7), with base rates shown.
6. **Position-size / R calculator** (#21). Pure arithmetic, high daily value.
7. **Alerts panel** (#9).
8. **Market regime / exposure panel** (#16), merged with sentiment and macro (#11).
9. **Multi-chart door** (#13), plus doors for Theme tracker, Traders, Compare and Open Flow (#19).
10. **Live unusual-volume panel** (#8).
11. **Peers in DES / a new RV code** (#12).
12. **Market-wide insider-buying feed** (#10).
13. **Linked panels** (#24), so the new list panels drive the chart and research panels.
14. **Breakout-ready / pivot list** (#23).
15. **Pre-trade checklist and setup win rates** (#17), after confirming the intelligence engine runs in production.

Wait on the NEW-DATA items (Level 2, borrow fees, fund flows) until the items above ship. They need vendor contracts, and Level 2 runs up against the decision not to support execution.

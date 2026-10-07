---
id: FG-2026-10-06
title: Terminal feature gaps — what leading terminals give a swing trader that the UCT Terminal does not, ranked
role: terminal/fn-features lane (new functions only; the written backlog and daily-use polish are other lanes)
date: 2026-10-06
base: origin/master d46bfb033
confidence: 🟢 on every "UCT today" cell (read from code on this branch, file named) · 🟡 on competitor cells (carried from 03-competitive-research, one remove from source, never re-researched) · 🟡 on the value axis (a judgement, not a measured member preference — NG-20)
evidence_ceiling: No production endpoint was called, no flag state was read (NG-23), no member was asked. Value is the author's judgement of a swing trader's daily loop, stated as such.
---

# Terminal feature gaps — 2026-10-06

## 1. What this is, and what it is not

A ranked list of capabilities that the benchmark terminals give a **swing trader** and that the
UCT Terminal (`app/src/pages/terminal/functions.js`, 74 codes on this base) does not. It
re-uses the research already written, never redoes it:

* competitor mechanisms come from `03-competitive-research/` (Bloomberg leaves 05 and 06, the Koyfin
  and Unusual Whales dossiers, `desk-tools/market-chameleon.md`), and
  `05-product-strategy/capability-matrix/best-of-breed.md`;
* "UCT today" was checked against the code on this branch (not the 2026-09 ledger cells, which
  NG-22 says not to treat as authoritative);
* every row passes `non-goals.md`: nothing here is execution (NG-01..03), a tier (NG-04..06),
  a new data licence (NG-11), or a second authority over a value UCT already publishes (NG-18).

**The two filters.** *Value*: does it change a swing trader's decision in the daily loop
(what is leading, what to hold, how concentrated the book is, what the market expects)? *Feasibility*:
can it be built only from data UCT already holds: Massive/Polygon bars and options, FMP, Finnhub,
yfinance, SEC EDGAR, the app's own stores? No new paid vendor.

Items owned by another lane are listed in §4 and not built here: the written backlog
(`feature-opportunity-backlog.md`, the `terminal/fn-backlog` lane) and command-line, board and
linking speed (the `terminal/fn-daily` lane).

## 2. The ranking

Score = value (1–5) × feasibility (1–5). Feasibility 5 means "bars UCT already serves, computed
in the panel, no new route".

| # | Gap | Who has it (corpus) | UCT today (code) | Value | Feas. | Score | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Relative-rotation graph** for sectors (and any ticker set): where each group sits on relative-strength trend × momentum, with its path over the last weeks | Bloomberg ships RRG as a licensed function. The corpus records the *question* rather than the screen: Bloomberg 06 §movers, *"the question that starts a rotation thesis rather than a single-name one"*; best-of-breed A1, *"a sorted change list cannot answer a rotation question"* | `components/tiles/SectorRotation.jsx` ranks 11 SPDR ETFs by return over one window; `/api/theme-rotation` gives a 1W-vs-1M rank delta. **Neither shows trajectory or quadrant**, and neither is a terminal code | 5 | 5 | **25** | **BUILT: `RRG`** |
| 2 | **Relative performance and A/B ratio**: N tickers rebased to 0 % over a window, plus the A÷B ratio line (is A beating B, and since when) | Bloomberg `COMP` (*"compare returns against 2 other securities"*, 06 line 487); Koyfin `AAPL:FB` relative tickers with Relative Strength (A/B) and Relative Spread (%A − %B) documented as separate modes (Koyfin dossier, relative-ticker expressions); Unusual Whales `/compare` | `CMP` is a door to a two-security **snapshot table** (`ResearchComparePage.jsx`) with no time series; `/charts` Compare Symbols overlays %-performance on a chart, but **not in the terminal and with no ratio line** | 5 | 5 | **25** | **BUILT: `REL`** |
| 3 | **Correlation matrix** of daily returns across a set of names: how concentrated a swing book really is | Unusual Whales `/correlation` and a `correlations` API (UW dossier, market overview and charting rows); Bloomberg `PC` over the shared `RV` peer set (05 §RV) | None anywhere in the app. ⚠️ `CLAUDE.md`'s Data Sources table lists a "Correlation Matrix — Massive API 60-day bars (numpy corrcoef), 1hr cache" row, but on this branch `corrcoef` appears in no file under `api/` or `app/src/` and no route serves a correlation. The row is stale | 4 | 5 | **20** | **BUILT: `CORR`** |
| 4 | **Index/theme contribution**: which names are driving a group's move (`MOV`/`IMOV`) | Bloomberg `MOV`/`IMOV` (06 §movers; best-of-breed A1 mechanism) | Theme holdings exist (`theme_db`) but `weight_pct` is written as `0.0` (`theme_performance.py`); no index weights in the estate | 4 | 2 | 8 | **BUILT for UCT themes only: `IMOV`** (fn3-imov, §6). Equal weight is what a UCT theme is; SPY/QQQ, the sector SPDRs and any theme-proxy ETF are **refused** in the panel, because index weights would need a new source |
| 5 | **Earnings implied-move calibration**: has the option market over- or under-priced this name's last N earnings moves | Market Chameleon "overestimated 77 % of the time in the last 13 quarters" (`desk-tools/market-chameleon.md` obs. 2) | `ERX` (`EarningsReactionPanel`) already shows 8 quarters of reaction, gap and drift **and** the next print's implied move. What is missing is the **historical** implied move per past print: UCT's own options log began 2026-09-30 (`OptionsHistoryPanel.jsx` header) | 4 | 2 | 8 | Deferred until the options log covers enough quarters. Reconstructing past implied moves from historical chains is a bulk Massive backfill, a job of its own |
| 6 | **Short-interest history** | Bloomberg `SI`; UW short interest + FTD (UW dossier) | Current value only, single-sourced to Finviz (ledger D8). `FTD` panel exists | 3 | 3 | 9 | **Owned by the backlog** (`FB-A7-02`, FINRA bi-monthly floor) — not built here |
| 7 | **Movers lenses in the terminal** (`MOST`/`LVI`/`OVI`/`HILO`: one tape, several hypotheses) | Bloomberg 06 §movers | Movers sidebar (single gap threshold), `/api/volume-scan`, NH/NL. No terminal code opens a movers list | 3 | 4 | 12 | **BUILT: `MOST`** (fn2-movers, §5) |
| 8 | **Price alert from a chart level** | TradingView `Alt+click` (best-of-breed A2) | **Exists** on the chart (ledger I3: price, line and trendline alerts with five delivery channels) | – | – | – | Not a gap. The chart panel (`GP`) embeds the same chart |
| 9 | **Scan-to-board** (screen results → a board of panels) | Bloomberg launchpad monitors | Screener + boards exist separately | 3 | 3 | 9 | **BUILT: `BOARD`** (`terminal/fn3-scanboard`, §6) |

## 3. What was built (this branch)

All three are **computed in the panel from `/api/bars/{sym}`**, the same edge-cached endpoint the
chart and the AI-search sparklines read (`AiSearchWidget.jsx` `fetchSparkCloses`). There is **no
new backend route and no new vendor call**. Each panel caps its symbol count, and fetches are
memoised per (symbol, timeframe, depth) for the session. A failed symbol is **named**, never dropped
silently.

| Code | Shows | Typed as | Method (stated in the panel) |
|---|---|---|---|
| `RRG` | The 11 SPDR sector ETFs, or any ticker list, plotted as RS-Ratio × RS-Momentum against SPY, with an 8-period tail per symbol and a quadrant table (Leading / Weakening / Lagging / Improving, periods in quadrant, period relative return). Row number + Enter opens that symbol's chart | `RRG` · `RRG D` · `RRG SMH IGV XBI` · `NVDA RRG AMD AVGO` | Weekly closes (daily with `D`). RS = 100·sym/bench. RS-Ratio = 100·RS / SMA(RS, 10). RS-Momentum = 100·RS-Ratio / SMA(RS-Ratio, 5). Labelled as **UCT's published approximation**; the JdK formula itself is proprietary (NG-17: no claim we cannot back) |
| `REL` | Up to 6 symbols rebased to 0 % over 1M/3M/6M/1Y/2Y/YTD (default 6M); a table of return, max drawdown and excess return over the first symbol; and the A÷B ratio of the first two with its 50-session average and a plain-language verdict | `NVDA REL` (vs SPY) · `NVDA REL AMD SMH 1Y` · `REL XLK XLU` | Daily closes, aligned on common sessions only. The overlap count is printed |
| `CORR` | A correlation matrix of daily returns for 2–10 symbols over 1M/3M/6M/1Y (default 3M), the most and least correlated pairs, and each name's average correlation to the rest | `NVDA CORR AMD MSFT TSLA` · `CORR XLK XLE XLU 6M` · `NVDA CORR` (vs SPY, QQQ) | Pearson on daily simple returns over common sessions; a pair with fewer than 20 common sessions reads "too few sessions", not a number |

**Flags.** None of the three is behind a flag: each is read-only arithmetic over bars every paid
member already loads on the chart, adds no server load beyond the chart's own reads, and changes no
published value. A dark flag would need an auth-payload key (a backend change) to protect against
a risk these panels do not carry. If the owner wants them dark anyway, a `flag:` on each registry
variant is a one-line change. The shell already refuses a flagged code whose key is false.

## 4. Left for other lanes, or deferred, and why

* **#4 contribution**: built for UCT themes only as `IMOV` (§6). The index half (SPY/QQQ, sector
  ETFs) still needs index weights UCT does not hold, so the panel refuses those symbols with the
  reason rather than sitting an equal-weight figure beside them (the mixed-truth surface PROD-C7
  warns about).
* **#5 implied-move calibration** becomes cheap once `options_analytics/log_history.py` holds at least
  four earnings per name, around 2027-Q1 for most names. Until then any calibration figure would be
  built on n≈0. Revisit then. `ERX` is the natural home (a block inside it, not a new code).
* **#6 short-interest history**: `FB-A7-02`, the backlog lane.
* **#7 movers lenses**: built as `MOST` (§5).
* **#9 scan-to-board**: built as `BOARD` (§6).

## 5. `MOST` — the movers lenses (#7, branch `terminal/fn2-movers`)

Bloomberg 06 §5 warns against copying the rack (thirteen mover codes nobody visits), so this is
**one code with lenses**, not `MOST` + `LVI` + `MOV`:

| Typed | Shows |
|---|---|
| `MOST` | every mover, biggest move either way first |
| `MOST UP` · `MOST DOWN` | gainers · losers |
| `MOST RVOL` | unusual volume: the names the Volume Surge scanner has lit right now |

Columns: symbol, last, % change, volume, volume vs average, and a **Why** link that opens the
catalyst board's story inline (with `SYM MOVE` one click further). Sortable on every column
(through the DataGrid seed), filterable by lens, minimum price and minimum volume. Clicking a
row, or typing its number, **loads that name into the linked group** and keeps every panel's
function (the shell's Shift+Enter path), so a chart following the group switches to it.

**Sources, all existing and cached, no new route or vendor call:** `/api/movers` (the Movers
sidebar's ≥3% gappers list, serve-stale behind a 30 s TTL), `/api/catalysts/today` (the catalyst
board: tag, thesis, today's volume ÷ 30-day average), `/api/volume-scan/live` (the in-memory
Volume Surge accumulator: volume so far ÷ usual by this time of day, and the `lit` flag), and the
shared live-price store (one 2 s poll of every panel's names). A failed side source is named on
screen; a failed movers read is an error with a retry, never an empty tape.

**The session is said, never implied.** The badge reads Live only in the regular session; it
reads Pre-market (last = the pre-market print, % against yesterday's close, thin-volume caution),
After hours (% is the regular session; an After hours column shows the move since 4:00 PM) or
Last session (not a live list) otherwise.

**Not built, and why:** a true market-wide most-active-by-volume list. No cached source ranks
the whole tape by shares traded; the Volume column sorts what the three lists hold, which is
labelled as what it is rather than presented as the market's most active. `MOV`-style index
contribution stays deferred for the reason in #4.

## 6. `IMOV` — theme contribution (#4, branch `terminal/fn3-imov`)

| Typed | Shows |
|---|---|
| `IMOV` | the theme moving most today (or the one this tab last opened), with a theme picker |
| `IMOV 1W` · `1M` · `3M` | the same over that window (`1D` is the default) |
| `NVDA IMOV` | the UCT theme(s) holding NVDA, NVDA's own contribution and its rank |
| `SPY IMOV` · `XLK IMOV` · `SMH IMOV` | refused, with the reason; a theme-proxy ETF offers that UCT theme by name instead |

**Method, stated in the panel, labelled "Equal-weighted".** A UCT theme is an equal-weight basket,
so each name contributes its return over the window ÷ N, where N is the members with a return for
that window. The panel lists the top 8 contributors and top 8 detractors and a reconciliation line
(contributors + detractors + the rest = the total), which is the theme's plain equal-weight return.
1D is the live overlay; 1W/1M/3M are the live price against the reference closes
`theme_performance` already stores. A member with no return for the window is named and not
counted; an engine-overlay member (`source='engine'`) is never counted, mirroring
`theme_performance._theme_owner_syms` exactly (absent source = owner, plus the `_owner_syms` stash).

**It does not always equal the Theme Tracker's number, and says so.** The tracker's `group_return`
is an upside-winsorized mean (`scan_period._robust_group_pct` caps the top ~10% of gainers), and
UCT 20 uses its portfolio NAV past 1D. When the two differ the panel prints the tracker's figure
and why. Only the plain mean is decomposable into per-name contributions that add up.

**Source:** `/api/theme-performance`, the cached, live-overlaid payload the Theme Tracker tile
already polls (same SWR key). No new route, no vendor call, no `api/**` change.

**Linking:** a row click, or its number + Enter, loads that name into the linked group and keeps
every panel's function. A panel following the group reopens on the theme it was showing when that
theme holds the new name.

**`MOVERS`** is now a second spelling of `MOST` (`CODE_ALIASES` in `functions.js`): the parser
answers it with `MOST` itself, so the panel, URL and history carry one name. HELP shows the alias.

## 7. `BOARD` — scan-to-board (#9, branch `terminal/fn3-scanboard`)

A list becomes a board of panels in one action, one security per panel.

| Typed | Opens |
|---|---|
| `BOARD GP` | the focused panel's list (MOST's rows, the screener's loaded results, RRG's table) as price charts |
| `BOARD DES NVDA AMD MSFT TSLA` | those names, as overviews (any code with a per-security panel works) |
| `BOARD GP W:3` · `BOARD GP FLAGGED` | a watchlist (its address-space id) · the flagged list |

Also: a **Board of** control (function picker + "Open 4 of N") on MOST and on the embedded
screener (`components/terminal/BoardFromList.jsx`, one shared control), and a pasted ticker list
offers "Open them as a board of charts".

* **The panel limit is boardModel's** (`MAX_VISIBLE`, 4). A longer list opens its first 4; **Next /
  Previous** page through the rest, and the notice names every name not on screen. Repeats and
  non-tickers are counted and said, never dropped silently.
* **It never replaces the member's board without a way back.** The board opens through the same path
  as a saved board (`openSnapshot`): **Back to my layout** returns the member's OWN board (kept across
  every page and a tab reload), plus Version history wherever the store is armed. Nothing reaches the
  library until **Save to my boards** (`saveBoard` → `terminal_boards`). **No new preference key.**
* Refused, with the reason: a market-wide code (MOST), a door (CMP), a URL-owning panel (ERN), a code
  the member's flags hide, and `BOARD` arriving in a URL. `BOARD` is a reserved word (no alias).
* Wiring: `scanBoard.js` (pure), `parseCommand.js` (`type: 'board'`), `grammar.js` (`BOARD_RULE`,
  the echo), `TerminalShell.jsx`. An embedded page reports its list with `usePanelList`
  (`components/terminal/terminalPanel.js`), the same opt-in shape as `usePanelFreshness`.

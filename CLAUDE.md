# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**UCT Dashboard** is a live bento-box trading dashboard for Uncharted Territory. It is a full-stack app:
- **Frontend:** React + Vite SPA with React Router (NOT Next.js — ignore all "use client" suggestions)
- **Backend:** FastAPI (Python) — serves the React build and all `/api/*` data endpoints
- **Deployment:** Railway (single service) at `https://uctintelligence.com` (Cloudflare DNS)
- **Domain:** `uctintelligence.com` — Cloudflare registrar + DNS, Railway custom domain
- **Email:** Resend (verified domain), sends from `UCT Intelligence <noreply@uctintelligence.com>`
- **Payments:** Stripe (sandbox + live), webhook at `/api/webhooks/stripe`
- **Auth:** Custom SQLite-based auth with sessions, email verification, password reset

The **Morning Wire** is one tab within this dashboard. Its engine (`morning_wire_engine.py`) lives in `C:\Users\Patrick\morning-wire\` locally and is mirrored as a git submodule at `external/morning-wire`.

## Git Submodules (sister repos)

Both sibling repos are available as submodules under `external/` for Claude Code visibility:

| Path | Repo | Description |
|------|------|-------------|
| `external/morning-wire` | unchartedterritory5995-cyber/morning-wire | Morning wire engine, runs locally on Windows |
| `external/uct-intelligence` | unchartedterritory5995-cyber/uct-intelligence | Python/SQLite trading engine, knowledge base |

**Path gotcha:** `api/services/engine.py` resolves morning-wire as `../../../morning-wire` (three levels up = outside the repo, finds the local `C:\Users\Patrick\morning-wire\`). On Railway, data flows via `/api/push` — the direct import is a local-dev fallback only. The submodule path (`external/morning-wire`) is NOT used by the backend at runtime.

**Hardcoded local paths in engine.py:** Lines 1508 and 1540 reference `C:\Users\Patrick\uct-intelligence` — local fallbacks that fail silently on Railway (primary path is wire_data from push).

## Nav Tabs (left sidebar)

Dashboard · Morning Wire · UCT 20 · Breadth (tabs: Monitor | Heatmap | COT Data | Data Charts | Analogues) · Theme Tracker · Calendar · Traders · Screener · Options Flow · Post Market · Model Book · Journal · Watchlists · Community · Support
Settings + Admin (admin only) pinned to bottom of sidebar.

## Mobile Navigation

Hamburger + slide-out drawer (hidden on desktop). Fixed header with page title + AlertBell. Body scroll locked when drawer open. User avatar + name in drawer header.

## Charts — Lightweight Charts v5

All charts use TradingView Lightweight Charts (NOT TradingView iframes). Key component: `app/src/components/StockChart.jsx`.
- 5 chart types: candles, hollow, bars (OHLC), line, area — user-selectable
- Candlestick + volume (separate panes), configurable MA overlays (4 slots)
- HVC gold volume bars (52W volume high detection)
- BUY/SELL markers, entry/stop price lines
- 200-bar default zoom via `setVisibleLogicalRange`, 8-bar right padding
- `rightBarStaysOnScroll: true` — latest candle stays pinned when zooming
- Full history: 5000 daily, 2000 weekly, 300 intraday bars
- Backend: `/api/bars/{ticker}?tf=D&bars=5000` (Massive API daily/weekly, yfinance intraday fallback)
- **COT charts are Chart.js** — do NOT replace those

### Chart Settings System
- `app/src/components/chart/chartDefaults.js` — schema, defaults, 3 presets (Classic Dark / OLED Black / TradingView)
- `chart_settings` JSON blob stored server-side via `usePreferences` (`POST /api/auth/preferences`)
- `mergeChartSettings(userSettings)` deep-merges user prefs over defaults
- **Gear icon** in chart toolbar opens inline settings panel (chart type, colors, indicators, volume, crosshair, watermark, drawing defaults, presets, reset)
- Settings page also has a Chart Settings TileCard (mirror of toolbar panel)
- `ColorPicker` component: `app/src/components/chart/ColorPicker.jsx` — reusable swatches + hex input

### Chart Drawing Tools
- `ChartDrawingOverlay.jsx` — canvas overlay for all annotations
- `ChartToolbar.jsx` — horizontal toolbar with tool buttons + settings gear
- Tools: cursor, trendline, extended, horizontal, hray, vertical, rect, circle, arrow, fib, channel, AVWAP, text, measure
- **AVWAP**: anchored VWAP from click point forward, time-based lookup (not pixel), survives scroll/zoom
- **Repeat toggle**: keeps tool selected (repeat ON) or reverts to cursor after one drawing (repeat OFF), persisted in localStorage
- `useChartDrawings.js` — localStorage persistence per symbol
- Drawing defaults (color, width) configurable in chart settings

### Chart Header — Consistent UI Across All Surfaces
- **SymbolSearch** (`app/src/components/chart/SymbolSearch.jsx`): clickable ticker title that opens search dropdown with popular tickers + type-any-ticker
- Wired on: ThemeTrackerPage, Watchlists, CustomScan (via `onSymbolChange` prop)
- Read-only on: Breadth DrillModal, Journal TradeDrawer (contextual, symbol locked)
- **Flag button** (⚑ Flag/Flagged) on: ThemeTrackerPage, Watchlists, CustomScan, Breadth DrillModal, TickerPopup
- **Period tabs**: 5min / 30min / 1hr / Daily / Weekly (Journal: Daily/Weekly only)
- **TickerPopup**: click-to-open modal with StockChart, live price, flag, earnings intel, insider activity, position calculator. NO Finviz hover preview, NO external links

## Live Pricing

15s polling via `/api/live-prices?tickers=X,Y,Z` (Massive batch snapshot). `useLivePrices` hook + `useMobileSWR` (doubles interval on mobile, pauses on background tab). `useMarketOpen` detects session state and 10x slows polling when market closed.

## Auth & User System

- SQLite DB at `/data/auth.db` (Railway persistent volume)
- Tables: users, sessions, subscriptions, email_verifications, password_resets, activity_log, page_views, feedback, support_tickets, ticket_messages, user_tags, admin_notes, user_preferences, referrals, mrr_snapshots
- `AuthGuard` component: checks auth + email verification + plan + admin role
- Admin role check: `user.role === 'admin'`; set via `ADMIN_EMAILS` env var
- Verification tokens reuse existing valid token on resend (>1hr remaining)
- Stripe webhook uses `_safe_get()` for stripe>=8.0 compatibility

## Worktree Directory

Worktrees live in `.worktrees/` (project-local, gitignored).

## Design Documents

All design docs are in `docs/plans/`. Key docs:
- `docs/plans/2026-02-22-dashboard-redesign.md` — full architecture decisions
- `docs/plans/2026-02-22-dashboard-implementation.md` — 25-task implementation plan
- `docs/plans/2026-02-22-data-pipeline-design.md` — data pipeline architecture
- `docs/plans/2026-02-22-theme-tracker-rebuild.md` — Theme Tracker rebuild (completed)

## Project Structure

```
uct-dashboard/
├── app/                        # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── NavBar.jsx      # Left sidebar nav
│   │   │   ├── TileCard.jsx    # Tile wrapper component
│   │   │   ├── TickerPopup.jsx # Hover preview + 5-tab chart modal
│   │   │   └── tiles/
│   │   │       ├── ThemeTracker.jsx    # Expandable ETF rows + stock chips
│   │   │       ├── MarketBreadth.jsx
│   │   │       ├── TopMovers.jsx
│   │   │       └── ...
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── MorningWire.jsx
│   │   │   ├── UCT20.jsx       # Leadership 20 page
│   │   │   ├── Settings.jsx
│   │   │   └── ...
│   │   └── main.jsx
│   └── vite.config.js
├── api/                        # FastAPI backend
│   ├── main.py
│   ├── routers/
│   │   ├── push.py             # POST /api/push — receives wire_data from engine
│   │   └── ...
│   └── services/
│       ├── engine.py           # _normalize_themes(), get_themes(), get_leadership(), etc.
│       └── cache.py            # TTLCache (in-memory, resets on Railway redeploy)
├── data/                       # Railway volume mount point (/data) — persists across redeploys
│   └── wire_data.json          # Written by /api/push; loaded on startup to seed cache
├── tests/                      # pytest tests for backend
│   ├── test_themes_holdings.py # 5 tests for holdings/etf_name/intl_count in themes
│   └── ...
├── docs/plans/                 # Design and implementation docs
├── nixpacks.toml               # Railway build config (python312 + nodejs_20)
└── .env                        # API keys (never committed)
```

## Running Locally

```bash
# Backend
uvicorn api.main:app --reload --port 8000

# Frontend (separate terminal)
cd app && npm run dev
```

## Environment Variables

Same as morning-wire `.env`, plus:
- `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`
- `MASSIVE_API_KEY`, `MASSIVE_SECRET_KEY`
- `DASHBOARD_URL` — Railway URL (`https://web-production-05cb6.up.railway.app`)
- `PUSH_SECRET` — shared secret for `/api/push` endpoint (set in Railway env vars)
- `VERCEL_TOKEN` (legacy)

## Data Pipeline

```
UCT Intelligence KB → Morning Wire Engine → wire_data.json → POST /api/push → Railway cache
                                                                                      ↓
                                                              Browser ← /api/themes, /api/leadership, etc.
```

**Engine run:** `cd C:\Users\Patrick\morning-wire && python morning_wire_engine.py`
- Takes ~7.7 min. Pushes to Railway automatically on completion.
- Windows Task Scheduler: runs daily at 7:35 AM ET (Mon–Fri), task name "UCT Morning Wire"
- Scanner (`scanner_candidates.py`) should run at 7:00 AM CT via separate Task Scheduler entry to avoid 151s inline cost
- **After any Railway redeploy, the in-memory cache resets but is seeded from `/data/wire_data.json` (Railway volume) on startup — no manual repopulation needed after the first engine run.**

**POST /api/push** (`api/routers/push.py`):
- Secured with `Authorization: Bearer <PUSH_SECRET>` header
- Stores wire_data in TTLCache (23hr TTL)
- Invalidates all derived cache keys on push
- Writes payload to `/data/wire_data.json` (Railway volume) for redeploy persistence

**Startup cache seeding** (`api/main.py` lifespan):
- On boot, loads `/data/wire_data.json` from Railway volume into cache (23hr TTL)
- Logs: `[startup] Loaded wire_data from volume (date=YYYY-MM-DD)`
- No-ops silently if volume not mounted (local dev)

## Data Sources

| Tile | Source | Refresh |
|------|--------|---------|
| Live Prices | Massive API batch snapshot (`/api/live-prices`) | 15s (30s mobile) |
| Chart Bars | Massive API daily/weekly, yfinance intraday (`/api/bars`) | 60s/300s/900s cache |
| Market Snapshot | Massive API (Railway fetches live) | 15s |
| Top Movers | Massive API (Railway fetches live) | 30s |
| News | AlphaVantage (primary) + RSS fallback (live) | 30 min (AV) / 10 min (RSS) |
| Theme Tracker | Massive API bars (per-holding returns) | Daily recompute on wire push |
| UCT20 Portfolio NAV | Massive API bars + composition history | Daily recompute on wire push |
| Leadership 20 | wire_data + Claude AI + UCT KB | Daily (7:35 AM ET) |
| Morning Rundown | wire_data + Claude AI + UCT KB | Daily (7:35 AM ET) |
| UCT Exposure Rating (Breadth) | wire_data push from engine | Daily (7:35 AM ET) |
| MA Relationship Panel | Massive API live prices (SPY/QQQ) + engine push (MA %s) | 15s / Daily |
| Earnings | wire_data push from engine | Daily (7:35 AM ET) |
| Scanner Candidates | scanner_candidates.py → wire_data push | Daily (7:00 AM CT scanner + 7:35 AM ET engine push) |
| Breadth Monitor (40+ metrics) | breadth_collector.py → push to Railway | Daily (4:30 PM ET weekdays via Task Scheduler) |
| COT Data | CFTC public zips (cftc.gov) | Weekly (Friday 3:50 PM ET + retries 4:15, 4:45 if stale) |
| Sector Flow | Massive API 20-day bars for 11 SPDR ETFs | 15min cache |
| RS Rankings | Massive API 6-month bars for cap universe | 1hr cache |
| Correlation Matrix | Massive API 60-day bars (numpy corrcoef) | 1hr cache |
| Breadth Analogues | SQLite breadth_monitor history (pattern match) | 6hr cache |
| Insider Activity | Finnhub insider transactions API | 4hr per-ticker cache |
| Earnings Intel | Finnhub earnings/recommendation/price-target | 6hr per-ticker cache |

## Morning Wire CSS Architecture — CRITICAL

**`rundown_html` in wire_data contains NO `<style>` block.** It is a plain HTML fragment.
All CSS for Morning Wire rendered content MUST live in `app/src/pages/MorningWire.module.css` using `:global(.classname)` selectors.

The `ut_morning_wire_template.html` CSS only applies when the engine generates a standalone file — it does NOT reach the React dashboard.

**Key `:global()` classes already defined in MorningWire.module.css:**
`rd-regime-banner`, `rd-col`, `rd-stockbee`, `rd-exposure`, `rd-subsection-header`, `rd-subsection-label`, `rd-pick*` (all Top 5 cards)

Never add new rundown CSS classes to the template alone — always add them to MorningWire.module.css.

## Top 5 Picks — Design (2026-03-10)

- **Layout**: vertical list; each pick separated by gold `<hr class="rd-pick-hr">` lines flanking the ticker
- **Always exactly 5 picks** — AI mandated to fill all 5 slots; lower-conviction fills noted in narrative
- **No number labels** — removed from prompt template
- **Ticker** (`rd-pick-sym`): gold `#c9a84c`, 16px IBM Plex Mono, letter-spacing 2px
- **Fields** (`rd-pick-flabel`): gold — **Entry Type**, Entry, Stop, Target, Invalidation (5 fields)
  - `Entry Type`: one of `PREV DAY HIGH BREAK` / `PREV LOW RECLAIM` / `RED TO GREEN` / `BASE BREAKOUT`
  - `Entry`: exact dollar trigger — e.g. "above $47.83 (prev day high) on volume"
- **Fields**: flex row, gap 10px, label `min-width: 80px`
- **Narrative** (`rd-pick-narrative`): 12px, line-height 1.65
- **Prev day OHLC data pipeline**: scanner candidates carry `prev_day_high/low/close` from Massive API; non-scanner candidates (UCT20, gappers) filled via `yf.download()` batch in `generate_top_picks()`

CSS: `MorningWire.module.css` lines ~192–280

## Breadth Monitor — Visual System (2026-03-15)

### Files
- `app/src/pages/Breadth.jsx` — full breadth monitor + Heatmap + COT Data + Data Charts tabs
- `app/src/pages/Breadth.module.css` — all styles
- `app/src/pages/BreadthCharts.jsx` — Data Charts tab (ECharts line chart, metric selector, date range)
- `app/src/pages/BreadthCharts.module.css` — Data Charts styles
- `api/services/breadth_monitor.py` — SQLite service (get_history, store_snapshot, patch_field, delete_snapshot)
- `api/routers/breadth_monitor.py` — REST endpoints

### Color System — 8-tier background heat-map
Dark ink = extreme signal. Light tint = mild signal. Text stays uniform white.
```
.bgG3  rgba(10,50,22,0.97)    — extreme bullish (near-black green)
.bgG2  rgba(22,100,48,0.80)   — bullish (dark forest green)
.bgG1  rgba(74,222,128,0.16)  — mild bullish (light mint tint)
.bgA   rgba(180,130,20,0.32)  — caution (dark amber)
.bgR1  rgba(248,113,113,0.16) — mild bearish (light red tint)
.bgR2  rgba(160,25,25,0.80)   — bearish (dark crimson)
.bgR3  rgba(55,6,6,0.97)      — extreme bearish (near-black red)
```
`cellClass(col, val, row)` maps colorFn/rowColorFn return values ('g3'–'r3') to these classes.

### UCT Exposure Rating — 0-150 Scale (updated 2026-03-22)
Exposure lives in `wire_data["exposure"]` dict. Two fields:
- `score` — full 0-150 value (IS the recommended exposure %). Use this everywhere.
- `exposure` — legacy capped field (`min(score, 100)`). Do NOT write to DB or use in new code.

**Thresholds (colorFn in Breadth.jsx, getTier/expTier in Heatmap, scoreColor in MarketBreadth):**
`>=110 → g3 | >=90 → g2 | >=70 → g1 | >=50 → amber | >=30 → r1 | >=15 → r2 | else → r3`

**Bonus tiers** (added to base score): 5/7 conditions met → +10, 6/7 → +25, 7/7 → +50. Ceiling: 150.

**Leveraged display** (score > 100): MarketBreadth tile shows gold bar + glow + "UCT EXPOSURE — LEVERAGED" label + ★ star.

**Daily rotating phrases**: `_exposure_note()` in `morning_wire_engine.py` — 8 tiers × 10 phrases, date-seeded via `hashlib.md5(date_str)` for stable-all-day but daily rotation.

**DB write**: `market_regimes.exposure_pct` ← `exposure.get("score")` — NOT `"exposure"` (the capped legacy key).

### Breadth Monitor — tbody Column Alignment (fixed 2026-03-22)
**Root cause**: `rowSpan` in `<thead>` does NOT reserve column positions in `<tbody>` — tbody rows start fresh at column 1 regardless.

**Fix**: tbody rows use `GROUP_SPANS.flatMap(gs => ...)` instead of `visibleCols.map(col => ...)`. For collapsed groups, emit one placeholder `<td>` to hold the column position. For expanded groups, emit normal cells. Without this, collapsing any group shifts all subsequent columns left by 1.

### Column Group Order
Score → Primary Breadth → MA Breadth → Regime → Highs/Lows → Sentiment

### Regime Group Contents
S&P 500 · QQQ · VIX · 10d VIX · McClellan · Phase · Stage 2 · Stage 4

### MA Stack Shading (SPY MA / QQQ MA)
50SMA is the dividing line between green and red:
- Above 50: all 4=g3, 50+200+1short=g2, 50+200=g1, 50 only=amber
- Below 50: above 200=r1, below 200+short bounce=r2, below all=r3
Header shows two lines: label + "10  20  50  200". Cells show ✓/✗ only, spread full width.

### Heatmap Tab — `BreadthHeatmap` component inside `Breadth.jsx`

ECharts treemap rendering curated breadth metrics as color-coded tiles. Clicking a tile opens the DrillModal (same as monitor table row clicks).

**Key structures in Breadth.jsx:**
- `HM_METRICS` — array of `{ key, label, getTier(val), getFmt(val), drillKey? }` entries. `drillKey` is required for drill-down to work (maps to `_list` field in API response, e.g. `"up_4pct_today_list"`). Entries without `drillKey` are display-only.
- `HM_METRICS_BY_KEY` — `Object.fromEntries(HM_METRICS.map(m => [m.key, m]))` — lookup map used in the ECharts click handler.
- `TREEMAP_DEF` — flat array of `{ key, weight }` objects that drive which tiles render and their relative sizes.
- ECharts click handler: `onEvents={{ click: params => { const metric = HM_METRICS_BY_KEY[params.data?.name]; if (metric?.drillKey) onDrill(currentRow.date, metric) } }}`
- Tile label vertical centering requires `position: 'inside'` on the series-level label config (not just `verticalAlign: 'middle'`).

**Current tiles (20+):** breadth_score, uct_exposure, up_4pct_today, down_4pct_today, up_25pct_quarter, down_25pct_quarter, up_50pct_month, down_50pct_month, magna_up ("Up 13%/34d"), magna_down ("Dn 13%/34d"), pct_above_5sma, pct_above_10sma, pct_above_20ema, pct_above_40sma, pct_above_50sma, pct_above_100sma, pct_above_200sma, sp500_close, qqq_close, new_52w_highs, new_52w_lows, new_20d_highs, new_20d_lows.

**Color functions:** `pairedUpColor(val, max)` / `pairedDnColor(val, max)` for paired bull/bear metrics; `pctColor(low, mid, high)` for percentage metrics.

### DrillModal — Chart Tabs (updated 2026-03-21)

`DrillModal` is rendered once at `Breadth` component level, used for both monitor table clicks and heatmap tile clicks. Three chart tabs: **Daily** / **Weekly** (Finviz static PNG) / **TradingView** (iframe). Default: `'tv'`.

- `chartPeriod` state initialized to `'tv'`
- Finviz URL: `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=${period}` (period = `d` or `w`)
- Finviz images use `object-fit: contain` (full chart visible, no zoom crop)
- Preloads ±5 neighbor Finviz images on selection change via `new window.Image()`
- CSS classes in `Breadth.module.css`: `.drillChartTabs`, `.drillChartTab`, `.drillChartTabActive`, `.drillChartImgWrap`, `.drillChartImg`

### API Endpoints
- `GET  /api/breadth-monitor?days=N` — history with rolling metrics computed server-side
- `POST /api/breadth-monitor/push` — store snapshot (auth required)
- `PATCH /api/breadth-monitor/{date}/field` — surgical single-field update
- `DELETE /api/breadth-monitor/{date}` — remove a snapshot row (auth required)

---

## Key Components Built (2026-03-07 — Scanner v2 "World-Class")

### Scanner Hub (`app/src/pages/Screener.jsx` + `Screener.module.css`)
- Three tabs: **Pullback MA** (30 max) | **Remount** (10 max) | **Gappers** (10 max)
- **Alert states** (priority order): BREAKING → READY → WATCH → PATTERN → NO_PATTERN → EXTENDED → NO_DATA
- **WATCH** = two paths: (a) pattern + score≥55 + EMA rising + ema_dist≤5.5% + tight bars, or (b) no pattern but score≥65 + EMA touch + ema_dist≤4% + pole≥15% + tight bars
- **EXTENDED** = ema_dist > 8% — shown muted at bottom, not actionable yet
- **LOW_ADR** (adr<4%) and **BUYOUT_PROXY** filtered entirely from display
- **Signal chips** on each row: ADR%, prior run%, MA↑↑, EMA↑, RS↑/RS↓, ACC/DIST, EARNS date
- **Regime bar**: shows UCT Intelligence regime phase · dist days · VIX · exposure% — color-coded (red=hostile, amber=neutral, green=healthy)
- **PremarketBar**: SPY/QQQ pre-market change
- **RemountRow**: AlertBadge + candle score + signal chips (upgraded from static SetupBadge)
- 30-min polling via useSWR

### API: `get_candidates()` (`api/services/engine.py`)
- Priority: cache → `wire_data["candidates"]` → local file (`uct-intelligence/data/candidates.json`) → empty structure
- Cache TTL: 1800s (30 min)
- `_EMPTY_CANDIDATES` sentinel returned via `copy.deepcopy()` as last fallback
- Endpoint: `GET /api/candidates` in `api/routers/screener.py`
- Tests: `tests/test_candidates.py` (4 tests)
- Output dict also contains: `regime_context`, `premarket_context`, `leading_sectors_used`, `generated_at`

### UCT Scanner (`C:\Users\Patrick\uct-intelligence\scripts\scanner_candidates.py`)
- Three Finviz scans: PULLBACK_MA (30 max) · REMOUNT (10 max) · GAPPER_NEWS (10 max)
- Dedup priority: PULLBACK_MA > REMOUNT > GAPPER_NEWS
- Leading sectors from `leading_sectors.json` (operator updates daily, ~30 seconds). Add 6-8 sectors to get 25-30 pullback candidates.
- Output: `data/candidates.json` — atomic write (tmp → rename)

**Signal intelligence computed per candidate:**
- `adr_pct` — Average Daily Range % (21 bars). Hard gate: <4% → LOW_ADR, filtered.
- `pole_pct` — prior momentum: max/min in last 22 bars (% gain from trough to peak)
- `rs_trend` — RS line vs SPY over 20 bars: "up"/"flat"/"down"
- `ema_distance_pct` — % above EMA20. >8% → EXTENDED.
- `ema_touch_count` — # bars in last 15 where low ≤ EMA20 × 1.005
- `vol_acc_ratio` — avg vol on up days / avg vol on down days (last 10 bars). >1.1 = ACC, <0.85 = DIST
- `avg_body_pct` — avg body% over last 5 bars. >0.45 blocks WATCH promotion ("no wide swings" — UCT KB rule)
- `close_cv_pct` — coefficient of variation of last 10 closes. <2.5% = tight band (+10 pts), <4% = +5 pts
- `volume_n_week_low` — 20/15/10 bar volume low (4/3/2 week)
- `ma_stack_intact` — close > EMA10 > EMA20, both slopes positive
- `earnings_date` / `earnings_tod` — from UCT Intelligence `earnings_analytics` DB (next 10 days)
- `prev_day_open` / `prev_day_high` / `prev_day_low` / `prev_day_close` — from `df.iloc[-1]` of Massive OHLCV fetch (scanner runs pre-market so last bar = previous trading day)

**7-criteria candle scoring (0–110):**
| Criterion | Points |
|-----------|--------|
| EMA proximity: kiss≤0.5% / ≤2% / ≤4% / ≤6% | +25/18/10/5 |
| Volume N-week low: 4wk/3wk/2wk | +20/13/8 |
| Multi-bar body tightness (5-bar avg): <0.30/<0.40 | +15/8 |
| Close quality (last bar): >60%/>50% | +15/8 |
| Close clustering (CV of 10 closes): <2.5%/<4% | +10/5 |
| Prior momentum (pole_pct): ≥40%/≥20%/≥10% | +15/10/5 |
| Volume accumulation ratio: >1.1/>0.9 | +10/5 |

**Pattern detection (`_detect_wedge_flag`):**
- Window: last 30 bars (6 weeks), catches GFS-type long consolidations
- Requires: declining upper trendline, lows not falling faster than highs, depth 2.5-20%
- Orderliness gate: rejects patterns with any bar >2.5× avg range (no spike/panic bars)
- Returns: `pattern_type` (wedge/flag/pennant), `days_in_pattern`, `pattern_depth_pct`, `apex_days_remaining`, `orderly_pullback`

**OHLCV fetch:** 60 calendar days (~42 trading days) via Massive REST API

**UCT Intelligence integration:**
- `_fetch_earnings_risk()` — queries `earnings_analytics` DB for earnings within 10 days
- `_fetch_regime_context()` — pulls latest `market_regimes` row for dashboard regime bar

### Morning Wire Integration (`C:\Users\Patrick\morning-wire\morning_wire_engine.py`)
- Scanner block runs before `analyst.generate_rundown()` (~line 3759)
- `scanner_candidates.run_scanner()` return value stored as `_uct_candidates`
- `"candidates": _uct_candidates` added to `_wire_data` dict pushed to Railway
- Fully wrapped in try/except — never crashes the pipeline
- Engine takes ~10-11 min total (scanner adds ~5-6 min to prior ~5 min runtime)

### News Feed — RSS Fallback (`api/services/engine.py` → `get_news()`)
- Primary: AlphaVantage NEWS_SENTIMENT API (25 req/day free tier)
- Fallback: RSS feeds (CNBC, MarketWatch, Yahoo Finance, Benzinga, SeekingAlpha, PRNewswire, MotleyFool)
- AV rate-limit detection: checks for `"Information"` / `"Note"` keys in AV response
- Cache TTL: 1800s when AV works, 600s on RSS fallback (was 300s — was burning quota)
- RSS items mapped to standard news format (title→headline, time_published→time, category mapping)
- **NEVER do a partial `/api/push`** — always push full wire_data or the cache gets clobbered

## Key Components Built (2026-02-23 — session 2)

### MarketBreadth (`app/src/components/tiles/MarketBreadth.jsx`)
- Premium SVG gauge (R=72, gradient + glow), phase label with dot, 3 MA progress bars
- **% Above 5MA** (amber) — computed from yfinance S&P 500 bulk download
- **% Above 50MA** (green) + **% Above 200MA** (blue) — Finviz Elite screener
- Stat row: Dist. Days · Adv · Dec · **NH** · **NL**
- NH and NL are clickable buttons (dotted underline) → opens `NHNLModal`

### NHNLModal (`app/src/components/tiles/NHNLModal.jsx`)
- Opens on click of NH or NL count in MarketBreadth tile
- Shows full list of S&P 500 stocks at 52W highs or lows as TickerPopup chips
- Escape key closes; backdrop click closes
- Data: `new_highs_list` / `new_lows_list` arrays from `/api/breadth`

### LeadershipTile (`app/src/components/tiles/LeadershipTile.jsx`)
- Replaced EpisodicPivots on Dashboard
- Fetches `/api/leadership`, scrollable compact list: rank · TickerPopup · cap badge · RS score · thesis

### EarningsModal (`app/src/components/tiles/EarningsModal.jsx`)
- Opens on ticker click in CatalystFlow or Calendar
- Shows: sym header, BMO/AMC badge, METRIC/EXPECTED/REPORTED/SURPRISE table
- Live gap % from `/api/snapshot/{sym}`, analyst consensus + price targets from `/api/earnings/intel/{sym}`
- **Pending entries**: gold-accent preview box with `preview_text` + 3 "Things to Watch" bullets (Claude Haiku, 350 tokens)
- **Reported entries**: gold-accent analysis box with `analysis_headline` + 5 "Key Takeaways" bullets (Claude Haiku, 450 tokens JSON)
  - Covers: business health, trend consistency, market reaction, guidance, risk
  - Old paragraph `analysis` field kept for backwards compat (12h cache transition)
- **Transcript section** (reported only, collapsible): fetches `/api/transcripts/{sym}`, shows AI summary headline + sentiment pill + 5-7 bullets
  - `api/services/transcripts.py` — Finnhub transcript fetch + Claude Haiku 800-token summarization
  - Smart truncation: first 3K (CEO/CFO remarks) + last 4K (analyst Q&A), 24h cache
  - Requires Finnhub premium — section hides when unavailable
- Cache keys: `earnings_preview_{sym}` / `earnings_analysis_{sym}` / `transcript_summary_{sym}`

### Calendar Page (`app/src/pages/Calendar.jsx`)
- Two panels: Earnings (left) + Macro Events (right, ForexFactory)
- Earnings: HTML `<table>` layout, 5 day tabs (Mon–Fri), BMO/AMC sections
- Data: live EW+Finviz primary, wire_data fallback, cap_universe server-side filter ($300M+)
- No-data entries filtered client-side (no estimates AND no actuals = noise)
- 10min cache TTL, 2min SWR poll, Finnhub actuals patch on every cache rebuild
- Click ticker → EarningsModal (same component as dashboard CatalystFlow)

### API: Breadth (`api/services/engine.py` → `_normalize_breadth()`)
- Fields: `pct_above_5ma`, `pct_above_50ma`, `pct_above_200ma`, `advancing`, `declining`, `new_highs`, `new_lows`, `new_highs_list`, `new_lows_list`, `breadth_score`, `distribution_days`, `market_phase`

### FuturesStrip (`app/src/components/tiles/FuturesStrip.jsx`)
- Each index tile has a background sparkline SVG: linearGradient stroke, feGaussianBlur glow, fog fill polygon, last-point circle marker
- Static SPARK point arrays per symbol (pos/neg/neu variants)
- **Layout**: left 50% = index grid (QQQ/SPY/IWM/DIA/BTC/VIX), right 50% = Quote of the Day panel
- **Quote of the Day**: 392-quote library (ported from morning-wire `ut_morning_wire_template.html`) — legendary traders, stoics, UCT KB voices. Date-seeded (`seed * 97 % 392`) so quote is stable all day and jumps ~97 positions each day for variety. No backend needed — pure client-side.
- Mobile (<900px): stacks index grid above quote panel, border flips left→top

## Key Components Built (2026-02-23)

### CatalystFlow (`app/src/components/tiles/CatalystFlow.jsx`)
- 7 columns: Ticker · Verdict (BEAT/MISS pill) · EPS Est · EPS Act · EPS Surp · Rev Act · Rev Surp
- `fmtRev()` formats revenue in millions/billions: `$121M`, `$1.2B`
- Surprise % colored green (pos) / red (neg)
- BMO label: "▲ Before Market Open" — today's reporters
- AMC label: "▼ After Close · Yesterday" — yesterday's AMC reporters (already in wire_data)
- Data shape: `{ bmo: [{sym, reported_eps, eps_estimate, surprise_pct, rev_actual, rev_surprise_pct, verdict}], amc: [...] }`

### API: `_normalize_earnings()` + `_fmt_surprise()` (`api/services/engine.py`)
- `_fmt_surprise(actual, estimate)` → `"+2.7%"` / `"-5.3%"` / `None`
- Output fields: `sym`, `reported_eps`, `eps_estimate`, `surprise_pct`, `rev_actual`, `rev_surprise_pct`, `verdict`
- Max 8 entries per bucket (bmo/amc)

## Key Components Built (2026-02-22)

### TickerPopup (`app/src/components/TickerPopup.jsx`)
- Hover → Finviz daily chart preview
- Click → 5-tab chart modal:
  - `Daily` / `Weekly` → Finviz image (`chart.ashx?t={sym}&p=d|w`)
  - `5min` / `30min` / `1hr` → TradingView iframe (interval=5|30|60)
- Footer: "Open in FinViz →" + "Open in TradingView →"
- Escape key closes modal; `role="dialog"` on inner panel (not backdrop)
- Used by: ThemeTracker chips, anywhere a clickable ticker is needed

### ThemeTracker (`app/src/components/tiles/ThemeTracker.jsx`)
- Period tabs: 1W / 1M / 3M
- Leaders (green) + Laggards (red) columns
- Each row is a `ThemeRow` — click to expand (`▸` → `▾`)
- Expanded: shows ETF ticker + full name, stock chips (via TickerPopup), `+N intl` badge
- Data shape: `{ leaders: [{ticker, name, etf_name, pct, bar, holdings: [...syms], intl_count}], laggards: [...] }`

### UCT 20 (`app/src/pages/UCT20.jsx`)
- Ranked list of Leadership 20 stocks from `/api/leadership`
- Also fetches `/api/uct20/portfolio` to cross-reference open position data per card
- Card row shows: rank · NEW badge · setup badge · ticker · company · days held · current return % · UCT Rating
- **NEW badge** (green) — appears when `pos.entry_date === latestEntry` (most recent wire run date)
- **Days held / current return** — pulled from `open_positions` in portfolio data, keyed by symbol
- Expanded row: company desc · catalyst · price action · trade bar (entry/stop/target); constrained to `max-width: 50%`
- **No Refresh button** (removed 2026-03-21)

### UCT20 Portfolio Tracker (`app/src/components/tiles/UCT20Performance.jsx`)
- Fetches `/api/uct20/portfolio` (1hr refresh); shows equity curve vs QQQ, stats grid, open positions, trade history
- **Open positions row**: symbol · entry price · `stop $XX.XX` (muted red) · return % · days held
- `stop_price = entry_price * 0.94` — computed in `get_uct20_portfolio()` in `uct_intelligence/api.py`
- Subtitle: "buys/sells at market open" — all transaction prices use open price on event date
- Entry/exit events are set-difference only — stocks staying on list never re-trigger buy/sell
- Data only updates when morning wire pushes fresh `wire_data["uct20_portfolio"]`; UI gracefully hides `stop_price` if absent (null guard)

### API: _normalize_themes() (`api/services/engine.py`)
- Returns `holdings` (list of US-listed ticker strings), `intl_count` (int), `etf_name` (str)
- International tickers (e.g. FRES.L) are counted but not passed (Finviz/TV don't support them)

### MoversSidebar (`app/src/components/MoversSidebar.jsx`)
- Right sidebar showing "MOVERS AT THE OPEN"
- Fetches `/api/movers` every 30s (live, no engine push needed)
- **Gap filter:** only stocks with `abs(change_pct) >= 3.0%` are shown (filtered in backend)
- Each ticker wrapped in `TickerPopup` — hover = Finviz preview, click = 5-tab chart modal
- Data shape: `{ ripping: [{sym, pct}], drilling: [{sym, pct}] }`

### Gap Filter + Massive REST (`api/services/massive.py` → `get_movers()`)
- Calls Massive REST API directly (`https://api.massive.com`) — no local uct-intelligence dependency
- `_fmt_mover()` returns `None` for stocks below 3% threshold
- Fallback: serves movers from wire_data cache when Massive API unavailable
- Futures (NQ, ES, RTY, BTC): yfinance fallback (not in equities API)
- Cache TTL: 30s movers / 15s snapshot

### Massive.com API (`api/services/massive.py`)
- **NOT** a local package import — calls `https://api.massive.com` (Polygon.io-compatible) directly
- Uses `MASSIVE_API_KEY` env var (set in Railway + local `.env`)
- Endpoints used:
  - `/v2/snapshot/locale/us/markets/stocks/gainers|losers` — top movers
  - `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` — single ticker snapshot
- `_MassiveRestClient` is the internal wrapper (replaces old uct_intelligence import)
- **ETFs (SPY, QQQ, IWM, DIA) are supported** — treated as equities, no special handling needed
- `MARelationship` panel (`app/src/components/tiles/MARelationship.jsx`) fetches `/api/snapshot` every 15s for live SPY/QQQ prices; MA % distances (9EMA/20EMA/50SMA/200SMA) come from daily engine push

## COT Data Tab (Breadth → COT Data tab) — Built 2026-03-14, moved under Breadth 2026-03-15

COT Data lives as the second tab on the Breadth page (`/breadth`). There is NO standalone `/screener/cot` route — it was removed. `Breadth.jsx` imports `CotData` directly and renders it when `activeTab === 'cot'`. The tab bar (Monitor | COT Data) is in the Breadth page header using `.tabs` / `.tab` / `.tabActive` classes in `Breadth.module.css`. When COT tab is active, Breadth uses `.pageCot` (padding: 0) so CotData's own padding (`20px 24px 40px`) takes over cleanly.

### Architecture
- **Database:** SQLite at `/data/cot.db` (Railway persistent volume — survives redeploys)
- **Source:** CFTC public zips — `https://www.cftc.gov/files/dea/history/deacot{YEAR}.zip`
- **Seed:** 10 years of history downloaded on first startup (background thread, daemon=True)
- **Refresh:** APScheduler CronTrigger — Friday 3:50 PM ET (`refresh_from_current()`), retries at 4:15 and 4:45 PM via `refresh_if_stale()` (skips if latest record <7 days old)
- **Startup catch-up:** On boot, if today is Friday past 4 PM ET and no refresh has run today, fires `refresh_from_current()` in a background thread — handles Railway redeploys that land after the scheduled window
- **Manual reseed:** `POST /api/cot/reseed` — triggers full 10-year re-download in background
- **Force reseed via curl:** `curl -X POST https://web-production-05cb6.up.railway.app/api/cot/reseed`

### Key Files
- `api/services/cot_service.py` — CFTC pipeline, SQLite schema, SYMBOL_MAP, seed/refresh
- `api/routers/cot.py` — 4 routes: GET /symbols, GET /status, POST /refresh, POST /reseed, GET /{symbol}
- `app/src/pages/CotData.jsx` — Chart.js mixed bar+line chart, symbol dropdown, lookback buttons (rendered inside Breadth.jsx)
- `app/src/pages/CotData.module.css` — page styles

### SYMBOL_MAP — Critical Notes
CFTC renamed many contracts around 2021–2022. The map uses OLD names (pre-2022) as primary entries for historical coverage. New names are handled via `_CFTC_ALIASES` dict which merges into `_NAME_TO_SYMBOL`. Both old and new names map to the same symbol, so all 10 years of history parse correctly.

Key renames handled by aliases:
- CL: "CRUDE OIL, LIGHT SWEET" → "WTI-PHYSICAL"
- HO: "#2 HEATING OIL- NY HARBOR-ULSD" → "NY HARBOR ULSD"
- RB: "GASOLINE BLENDSTOCK (RBOB)" → "GASOLINE RBOB"
- NG: "NATURAL GAS" → "NAT GAS NYME"
- BZ: "BRENT CRUDE OIL LAST DAY" → "BRENT LAST DAY"
- ZB/ZN/ZF/ZT/UD: old treasury note/bond names → "UST BOND", "UST 10Y NOTE", etc.
- DX: "U.S. DOLLAR INDEX" → "USD INDEX"
- B6: "BRITISH POUND STERLING" → "BRITISH POUND"
- N6: "NEW ZEALAND DOLLAR" → "NZ DOLLAR"

### Chart Scaling
- **Left Y-axis (y):** symmetric ±leftBound — computed from max absolute net position value, rounded via `roundUpNice()`
- **Right Y-axis (y2, OI line):** uses `afterDataLimits` callback — forces `min = roundDownNice(max / 4)` so OI line occupies the upper portion of the chart. Do NOT use explicit `min`/`max` props or `beginAtZero` — they get overridden by Chart.js internals.
- **Chart.js registration:** Must register BOTH `BarController` AND `BarElement` (and `LineController`/`LineElement`) for mixed charts — omitting the Controller causes "bar is not a registered controller" error.
- **ChartErrorBoundary:** Class component wrapping Chart — prevents React tree crash on chart errors.

### Symbols Available (62 total, removed: ET, NM, T6, TA, BA, RS, DL, BD)
INDICES: ES, NQ, YM, QR, EW, VI, NK
METALS: GC, SI, HG, PL, PA, AL
ENERGIES: CL, HO, RB, NG, FL, BZ
GRAINS: ZW, ZC, ZS, ZM, ZL, ZR, KE, MW, OA
SOFTS: CT, OJ, KC, SB, CC, LB
LIVESTOCK & DAIRY: LE, GF, HE, DF, BJ
FINANCIALS: ZB, UD, ZN, ZF, ZT, ZQ, SR3
CURRENCIES: DX, B6, D6, J6, S6, E6, A6, M6, N6, L6, BTC, ETH

### Data Sources Table Addition
| COT Data | CFTC public zips (cftc.gov) | Weekly (Friday 3:50 PM ET + retries 4:15, 4:45 if stale) |

---

## Theme Tracker Page — Built 2026-03-20, Live Returns 2026-03-21

### Files
- `app/src/pages/ThemeTrackerPage.jsx` — full-page theme tracker
- `app/src/pages/ThemeTrackerPage.module.css` — styles
- `app/src/components/tiles/ThemeTracker.jsx` — dashboard tile (same data source)
- `app/src/components/tiles/ThemeTracker.module.css` — tile styles
- `api/services/theme_performance.py` — background compute, volume persistence, live overlay
- `api/services/uct20_nav.py` — UCT20 portfolio NAV tracking
- `api/routers/theme_performance.py` — GET /api/theme-performance, POST /api/theme-performance/refresh

### Architecture
- **Non-blocking**: always returns immediately — memory cache → disk → `{status: "computing"}`
- **Persistence**: results written to `/data/theme_performance.json` (Railway volume); loaded on startup
- **Recompute triggers**: wire push (`/api/push`) + manual refresh endpoint
- **Workers**: `_MAX_WORKERS = 6` (conservative for Railway 512MB)
- **Excluded ETFs**: TLT, HYG, URA, IBB, FXI, MSOS
- **UCT20**: injected into raw_themes (not a real ETF — holdings from leadership list)
- **Both surfaces unified**: dashboard tile and full page both use `/api/theme-performance`

### Live Returns Overlay (`_apply_live_returns` in theme_performance.py)
Runs on every request (30s SWR polling). Updates all 6 periods using intraday price:
- `live_map` = `get_etf_snapshots()` → `todaysChangePerc` (a %, e.g. 1.5 = +1.5%) — cached 30s
- **1d**: uses `live_pct` directly (it IS the 1d return)
- **1w/1m/3m/1y/ytd**: derives `current_price = prev_close * (1 + live_pct/100)` where `prev_close = ref_prices["1d"]` (yesterday's official close), then `(current_price - ref) / ref * 100`
- `ref_prices` stored per holding per period during daily bar computation — no re-fetch needed
- **CRITICAL**: `live_map` values are percentages, NOT dollar prices. Computing `(live - ref_price)/ref_price` directly = -99% bug. Always derive current_price first.

### UCT20 Portfolio NAV (`api/services/uct20_nav.py`)
- Each wire push records current UCT20 holdings to `/data/uct20_compositions.json` (persists forever)
- `compute_portfolio_returns()` — loads composition history, fetches bars for ALL ever-held symbols, builds equal-weight NAV time series by chaining daily returns using PREVIOUS day's composition, returns 1d/1w/1m/3m/1y/ytd
- **Composition-aware**: stocks that rotated out still contribute their return during holding period
- Returns `None` for periods without enough history (shows "—" — fills in over ~3 weeks for 1M, ~63 days for 3M)
- `group_return` on UCT20 theme object — frontend uses it over simple avg for 1w/1m/3m/1y/ytd
- **Live 1d**: average of CURRENT holdings' `todaysChangePerc` (intraday approximation only — NAV not recomputed intraday)

### UI Features
- Period tabs: **Today/1W/1M/3M/1Y/YTD** on full page; same 6 on dashboard tile — click active tab to toggle ↑/↓ sort
- Search bar — filters by theme name, ETF ticker, or individual holding symbol; auto-expands matching groups
- Holdings sorted within each group by active period in same direction as theme list
- Arrow key navigation — moves in visual sort order, auto-expands groups, auto-scrolls
- UCT 20 shows gold ★ badge on both dashboard tile and full page (managed portfolio, not ETF-tracked)
- Right panel chart header: Daily/Weekly/TradingView tabs centered in header bar (`position: absolute; left: 50%`)

### Right Panel Chart System (2026-03-21)
Three chart modes toggled via tabs centered in the chart header. **Default: TradingView.**

- **TradingView** — full interactive iframe, no `key` prop (avoids destroy/recreate flash), src updates in place
  - `chartFrame`: `flex: 1; border: none; min-height: 0`
- **Daily / Weekly** — Finviz static PNG images (`chart.ashx?t={sym}&ty=c&ta=1&p=d|w`)
  - Instant switching: preloads ±5 neighbors on every selection change via `new window.Image()`
  - CSS: `object-fit: contain` — shows full chart image without zoom crop
  - `chartImgWrap`: `flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center`
  - `chartImg`: `width: 100%; height: 100%; object-fit: contain`

### Data Charts Tab — `BreadthCharts.jsx` (built 2026-03-21)

`app/src/pages/BreadthCharts.jsx` + `BreadthCharts.module.css`. Fetches `/api/breadth-monitor?days=365`.

**Metric picker:** `CHART_GROUPS` array — groups with `{ group, metrics: [{ key, label }] }`. Users click category buttons to expand/collapse groups and check/uncheck individual metrics. Multiple metrics overlay as line series on a shared ECharts chart.

**State:** `selected` (array of keys, default `['breadth_score', 'pct_above_50sma']`), `fromDate`/`toDate` (date range inputs), `expanded` (per-group open state).

**Dual Y-axis:** `sp500_close` and `qqq_close` → `yAxisIndex: 1` (right axis, auto-scale). All other metrics → `yAxisIndex: 0` (left axis). Color palette: 8-color array cycling via `palette[i % 8]`.

**ECharts features:** `dataZoom` (inside + slider), `tooltip` with crosshair, `connectNulls: false`, `symbol: 'none'` (no dots on line).

**Groups:** Score · Primary Breadth · MA Breadth · Regime · Highs/Lows · Sentiment

### BreadthCharts Notable Extremes (2026-03-21)
`app/src/pages/BreadthCharts.jsx` + `BreadthCharts.module.css`
- Every expanded group panel has a **⚡ Notable Extremes** button (amber, toggleable)
- `notableExtremes` state object keyed by group name; `toggleExtremes(group)` handler
- **MA Breadth only** (so far): when active, injects a markLine series into ECharts with 7 dashed reference lines:
  - Red overbought: 70 (`#fca5a5`), 80 (`#ef4444`), 90 (`#b91c1c`) — ascending intensity
  - Green oversold: 20 (`#bbf7d0`), 15 (`#4ade80`), 10 (`#22c55e`), 5 (`#15803d`) — ascending intensity
  - Series name `__ma_extremes__` excluded from legend via explicit `legend.data` array
- Other groups (Score, Primary Breadth, Regime, Highs/Lows, Sentiment): buttons are no-op placeholders pending readings to be defined later
- Active button style: amber glow (`.extremesBtnActive`)

## Model Book — Setup Taxonomy (2026-03-21)

### Files
- `app/src/pages/ModelBook.jsx` — full-page trade log
- `app/src/pages/ModelBook.module.css` — styles
- `api/routers/trades.py` — GET/POST /api/trades (JSON file storage)
- `data/trades.json` — Railway persistent volume

### Setup Groups
Setups are organized into two groups (`SETUP_GROUPS` in `ModelBook.jsx`):

**Swing:**
High Tight Flag (Powerplay), Classic Flag/Pullback, VCP, Flat Base Breakout, IPO Base, Parabolic Short, Parabolic Long, Wedge Pop, Wedge Drop, Episodic Pivot, 2B Reversal, Kicker Candle, Power Earnings Gap, News Gappers, 4B Setup (Stan Weinstein), Failed H&S/Rounded Top, Classic U&R, Launchpad, Go Signal, HVC, Wick Play, Slingshot, Oops Reversal, News Failure, Remount, Red to Green

**Intraday:**
Opening Range Breakout, Opening Range Breakdown, Red to Green (Intraday), Green to Red, 30min Pivot, Mean Reversion L/S

### Architecture Notes
- `SETUP_GROUPS` array drives both the nav sidebar (group headers + buttons) and the form select (`<optgroup>`)
- `SETUPS` flat array derived via `SETUP_GROUPS.flatMap(g => g.setups)` — used for filtering logic
- Nav renders `.navGroupLabel` header (muted caps) before each group's buttons
- Trade data shape: `{ sym, entry, stop, target, size_pct, notes, setup, date, id, status }`
- Status: "open" only (close/exit tracking not yet implemented)

---

## Watchlists Page — Two-Tab Design (updated 2026-03-28)

### Files
- `app/src/pages/Watchlists.jsx` — full-page watchlists
- `app/src/pages/Watchlists.module.css` — all styles
- `api/routers/watchlists.py` — REST endpoints (all require auth)
- `api/services/watchlist_service.py` — SQLite service

### Architecture
- **Split panel**: left 260px list panel + right StockChart panel (same pattern as ThemeTrackerPage)
- **Two tabs**: My Lists | Community
- **My Lists tab**: "⚑ Flagged" pinned as first accordion group (expanded by default, localStorage via `useFlagged`), followed by user-created watchlists. Arrow key nav + Shift+F remove within flagged group.
- **User watchlists**: accordion groups, expandable with items, add ticker form, toggle public/private (🔒/🔓), delete list
- **Community tab**: all public watchlists (read-only), shows `owner_name`, expandable
- **Live prices**: `useLivePrices` fed by `allTickers` useMemo — only tickers in expanded lists on active tab
- **Create modal**: name + description + is_public checkbox
- **Chart header**: SymbolSearch (clickable ticker title) + flag button + period tabs
- **Period tabs**: 5min / 30min / 1hr / Daily / Weekly — centered in chart header

### API Endpoints
- `GET  /api/watchlists` — user's own lists (with items array)
- `GET  /api/watchlists/public` — all public lists (with items + owner_name)
- `POST /api/watchlists` — create `{ name, description, is_public }`
- `PUT  /api/watchlists/{id}` — update `{ is_public }`
- `DELETE /api/watchlists/{id}` — delete list
- `POST /api/watchlists/{id}/items` — add item `{ sym, notes }`
- `DELETE /api/watchlists/{id}/items/{item_id}` — remove item

### Flag Support — Coverage (2026-03-27)
Flag button + Shift+F shortcut added everywhere a chart appears:
- **TickerPopup** — already had it (covers all chip/ticker contexts)
- **ThemeTrackerPage** right panel — `useFlagged` + Shift+F + toast
- **Breadth DrillModal** right panel — `useFlagged` + Shift+F via functional `setSelectedIdx` updater
- **Watchlists** flagged tab — Shift+F remove, `×` button, flag button in chart header

## Trade Journal — Elite Review System (2026-03-28)

### Files
- `app/src/pages/journal/Journal.jsx` — main page with 7-tab interior navigation
- `app/src/pages/journal/Journal.module.css` — all journal styles
- `app/src/pages/journal/TradeDrawer.jsx` — 480px right-side trade detail drawer (6 tabs)
- `app/src/pages/journal/OverviewTab.jsx` — KPI dashboard + review shortcuts
- `app/src/pages/journal/TradeLogTab.jsx` — filterable trade table
- `app/src/pages/journal/DailyNotesTab.jsx` — per-day structured journal entries
- `app/src/pages/journal/CalendarTab.jsx` — visual calendar with daily P&L heatmap
- `app/src/pages/journal/AnalyticsTab.jsx` — breakdowns by setup, symbol, day, session, etc.
- `app/src/pages/journal/PlaybooksTab.jsx` — setup definitions + linked performance
- `app/src/pages/journal/ReviewQueueTab.jsx` — guided incomplete-work surface
- `api/services/journal_service.py` — SQLite service (CRUD, stats, analytics, insights)
- `api/services/journal_screenshots.py` — WebP upload/serve (Pillow, same as avatar system)
- `api/routers/journal.py` — REST endpoints (all require auth)

### Architecture
- **7-tab interior navigation** (horizontal tab bar inside `/journal` page): Overview | Trade Log | Daily Notes | Calendar | Analytics | Playbooks | Review Queue
- **Trade detail drawer**: 480px right-side slide-over (full height), preserves log context. 6 interior tabs: Summary+Chart | Executions | Process | Notes+Screenshots | Mistakes | Related
- **Review status state machine**: `draft → logged → partial → reviewed → flagged/follow_up`. Auto-computed on save based on field completeness. Users can manually flag/unflag.
- **Screenshots**: stored at `/data/journal_screenshots/` on Railway volume. Named `{user_id}_{trade_id}_{slot}_{uuid}.webp`. Pillow converts to WebP. Max 5 per trade, max 2MB per upload. Slots: pre_entry, in_trade, exit, higher_tf, lower_tf.
- **Guided review**: progress indicators + smart prompts (not modal wizards). Review queue surfaces incomplete trades/days. Trade drawer shows completion checklist. Daily notes use structured template.

### Data Model
- **Expanded `journal_entries`** (25+ new columns): account, asset_class, strategy, playbook_id, tags, mistake_tags, emotion_tags, entry_time, exit_time, fees, shares, risk_dollars, planned_r, realized_r, thesis, market_context, confidence (1-5), process_score (0-100), outcome_score, ps_setup/ps_entry/ps_exit/ps_sizing/ps_stop (each 0-20), lesson, follow_up, review_status, review_date, session, day_of_week, holding_minutes
- **`trade_executions`**: scale-in/out events per trade. Types: entry, add, trim, exit, stop. Parent entry_price/exit_price computed as VWAP when executions exist.
- **`journal_screenshots`**: per-trade image uploads with slot labels and sort order
- **`daily_journals`**: per-day structured entries — premarket_thesis, focus_list, a_plus_setups, risk_plan, market_regime, emotional_state, midday_notes, eod_recap, did_well, did_poorly, learned, tomorrow_focus, energy_rating (1-5), discipline_score (0-100)
- **`weekly_reviews`**: per-week summaries — best/worst trade, top setup, worst mistake, wins/losses, net P&L, avg process score, reflection, key lessons, next week focus
- **`playbooks`**: setup definitions with trigger criteria, entry/exit models, sizing rules, common mistakes, best practices. Denormalized trade_count, win_rate, avg_r.
- **`journal_resources`**: checklists, rules, templates, psychology notes, plans. Categories: checklist, rule, template, psychology, plan.
- **Process scoring**: 5 dimensions × 0-20 = 0-100 composite (setup quality, entry quality, exit quality, sizing discipline, stop discipline)
- **Mistake taxonomy**: 17 default mistakes (overtrading, FOMO, chasing, early_exit, late_entry, no_stop, oversized, countertrend, revenge, ignored_thesis, added_to_loser, cut_winner, broke_loss_rule, broke_size_rule, broke_checklist, boredom, hesitation) + custom tags via comma-separated field
- **Emotion tags**: 15 options (confident, anxious, greedy, fearful, calm, frustrated, euphoric, bored, disciplined, impulsive, patient, rushed, focused, distracted, revenge-driven)

### API Endpoints
- `GET /api/journal` — list trades with expanded filtering (status, review_status, symbol, setup, playbook_id, direction, asset_class, date range, tags, mistake_tags, session, day_of_week, has_screenshots, has_notes, has_process_score, min/max R, min/max P&L, sort, pagination)
- `GET /api/journal/stats` — aggregate stats (enhanced)
- `GET /api/journal/calendar?month=YYYY-MM` — per-day trade_count, wins, losses, net P&L, avg process score, review statuses, mistake/screenshot counts
- `GET /api/journal/review-queue` — trades/days needing review
- `GET /api/journal/analytics?group_by={dimension}` — breakdowns by setup, playbook, symbol, direction, asset_class, day_of_week, session, mistake_tag, emotion_tag, holding_period_bucket, process_score_bucket, month, week. Returns per-bucket: trade_count, win_rate, avg_pnl_pct, total_pnl_pct, avg_r, profit_factor, avg_process_score
- `GET /api/journal/insights` — up to 8 pattern-derived coaching statements (no AI, server-side logic)
- `GET /api/journal/taxonomy` — mistake + emotion tag libraries
- `POST/PUT/DELETE /api/journal/{id}` — trade CRUD
- `POST/GET/DELETE /api/journal/{id}/screenshots` — screenshot management
- `GET/PUT /api/journal/daily/{date}` — daily journal (auto-creates on first access)
- `GET/PUT /api/journal/weekly/{week_start}` — weekly review (auto-populates computed fields)
- `GET/POST/PUT/DELETE /api/journal/playbooks` — playbook CRUD
- `GET /api/journal/playbooks/{id}/trades` — trades linked to playbook
- `GET/POST/PUT/DELETE /api/journal/resources` — resource CRUD (by category)

### StockChart Integration
- Trade detail Summary tab embeds `StockChart` component (Lightweight Charts v5)
- **Entry marker** (green BUY arrow) at entry price/date
- **Exit marker** (red SELL arrow) at exit price/date (if closed)
- **Stop price line** (dashed red horizontal) + **target price line** (dashed green horizontal)
- **Scale-in/out markers** (smaller arrows at execution prices) for all `trade_executions` events
- Default zoom: centers on holding period with 20 bars context each side
- Reuses existing `StockChart` component + `/api/bars/{ticker}` endpoint + same `markers`/`priceLines` props as UCT20

### Design Tokens
- Follows existing CSS variable token system
- **Review status pills**: draft=`--color-text-muted`, logged=`--color-info` (blue), partial=`--color-warning` (amber), reviewed=`--color-success` (green), flagged=`--color-danger` (red), follow_up=purple
- **Process score gradient**: red (0-30) → amber (31-60) → green (61-100)
- **Mistake tags**: red-tinted chips
- **Emotion tags**: blue-tinted chips

---

## FeedbackWidget — Top-Right ? Button (2026-03-27)

- **Location**: `app/src/components/FeedbackWidget.jsx`
- **Position**: fixed top-right (top: 10, right: 14), 24×24px (was 48×48 bottom-right)
- **Click → dropdown menu** with two options:
  - 💬 Send Feedback → opens existing star-rating + message form (posts to `/api/auth/feedback`)
  - 🎫 Support Ticket → navigates to `/support`
- Backdrop click closes menu/form; Escape not wired (backdrop handles it)

## Support Chat — UX (2026-03-27)
- **Enter** sends reply in the reply textarea
- **Shift+Enter** inserts newline
- File: `app/src/pages/Support.jsx` line ~340

## Known Issues / Gotchas

- **Cache resets on redeploy** — FIXED (2026-02-23). Railway volume at `/data` persists wire_data.json. Startup event seeds cache automatically. First boot after volume creation still requires one engine run.
- **Claude timeout** — thesis generation can timeout on first engine run; second run succeeds.
- **`config` vs `CONFIG`** — morning_wire_engine.py push code uses `CONFIG` (uppercase). Bug was fixed 2026-02-22.
- **Railway env vars are case-sensitive** — `PUSH_SECRET` must be all-caps (not `Push_Secret`).
- **Movers wire_data fallback** — if Massive API fails at open, movers fall back to engine push (engine captures pre-market Finviz movers at 7:35 AM ET).
- **Railway healthcheck timeout** — set to 600s in `railway.json` (default 300s was too tight for startup with COT seed + DB migrations + scheduler init).
- **Breadth collector Task Scheduler** — runs 4:30 PM ET weekdays (`UCT Breadth Collector`). Battery settings disabled (was killing the job on unplug). Logs: `uct-intelligence/data/breadth_collector.log` (Python) + `breadth_collector_stdout.log` (OS-level stdout/stderr capture).
- **COT refresh timing** — CFTC publishes after 3:30 PM ET on Fridays but timing varies. Primary refresh at 3:50 PM with smart retries at 4:15 and 4:45 PM. Check Railway logs to see which attempt succeeds.

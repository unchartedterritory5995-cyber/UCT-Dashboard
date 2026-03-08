# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**UCT Dashboard** is a live bento-box trading dashboard for Uncharted Territory. It is a full-stack app:
- **Frontend:** React + Vite SPA with React Router
- **Backend:** FastAPI (Python) — serves the React build and all `/api/*` data endpoints
- **Deployment:** Railway (single service) at `https://web-production-05cb6.up.railway.app`

The **Morning Wire** is one tab within this dashboard. Its engine (`morning_wire_engine.py`) lives in `C:\Users\Patrick\morning-wire\` and is imported by the backend.

## Nav Tabs (left sidebar)

Dashboard · Morning Wire · UCT 20 · Traders · Screener · Options Flow · Post Market · Model Book
Settings + Website buttons pinned to bottom of sidebar.

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
- Takes ~3 min. Pushes to Railway automatically on completion.
- Windows Task Scheduler: runs daily at 7:35 AM ET (Mon–Fri), task name "UCT Morning Wire"
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
| Market Snapshot | Massive API (Railway fetches live) | 15s |
| Top Movers | Massive API (Railway fetches live) | 30s |
| News | AlphaVantage (primary) + RSS fallback (live) | 30 min (AV) / 10 min (RSS) |
| Theme Tracker | wire_data push from engine | Daily (7:35 AM ET) |
| Leadership 20 | wire_data + Claude AI + UCT KB | Daily (7:35 AM ET) |
| Morning Rundown | wire_data + Claude AI + UCT KB | Daily (7:35 AM ET) |
| UCT Exposure Rating (Breadth) | wire_data push from engine | Daily (7:35 AM ET) |
| MA Relationship Panel | Massive API live prices (SPY/QQQ) + engine push (MA %s) | 15s / Daily |
| Earnings | wire_data push from engine | Daily (7:35 AM ET) |
| Scanner Candidates | scanner_candidates.py → wire_data push | Daily (7:00 AM CT scanner + 7:35 AM ET engine push) |

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
- Opens on ticker click in CatalystFlow tile
- Shows: sym header, BMO/AMC badge, METRIC/EXPECTED/REPORTED/SURPRISE table
- Live gap % fetched from `/api/snapshot/{sym}` on open
- View Chart via TickerPopup + FinViz button; Escape closes

### API: Breadth (`api/services/engine.py` → `_normalize_breadth()`)
- Fields: `pct_above_5ma`, `pct_above_50ma`, `pct_above_200ma`, `advancing`, `declining`, `new_highs`, `new_lows`, `new_highs_list`, `new_lows_list`, `breadth_score`, `distribution_days`, `market_phase`

### FuturesStrip sparklines (`app/src/components/tiles/FuturesStrip.jsx`)
- Each index tile has a background sparkline SVG: linearGradient stroke, feGaussianBlur glow, fog fill polygon, last-point circle marker
- Static SPARK point arrays per symbol (pos/neg/neu variants)

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
- Shows: rank, ticker, cap badge, RS score, thesis

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

## Known Issues / Gotchas

- **Cache resets on redeploy** — FIXED (2026-02-23). Railway volume at `/data` persists wire_data.json. Startup event seeds cache automatically. First boot after volume creation still requires one engine run.
- **Claude timeout** — thesis generation can timeout on first engine run; second run succeeds.
- **`config` vs `CONFIG`** — morning_wire_engine.py push code uses `CONFIG` (uppercase). Bug was fixed 2026-02-22.
- **Railway env vars are case-sensitive** — `PUSH_SECRET` must be all-caps (not `Push_Secret`).
- **Movers wire_data fallback** — if Massive API fails at open, movers fall back to engine push (engine captures pre-market Finviz movers at 7:35 AM ET).

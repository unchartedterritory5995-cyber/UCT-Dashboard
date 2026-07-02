# Robinhood Journal — Phase 3: Per-Stock Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Robinhood-style per-stock detail page at `/journal-2-0/position/:sym` — header → chart(+ranges) → Your Position → About → Stats → News → Analyst Ratings → Earnings → History — reached by clicking a holdings-list row.

**Architecture:** One lazy-loaded standalone route (mirrors `DayDetailPage`'s pattern), section components in `components/position/`, pure calc helpers in `lib/positionDetail.js`. All data from existing endpoints except ONE new backend field (`about` = yfinance `longBusinessSummary` surfaced through `get_fundamentals` → research snapshot).

**Tech Stack:** React 18 + react-router `useParams`, CSS modules, vitest; FastAPI + pytest for the one-field backend change.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-01-robinhood-journal-design.md` Phase 3 + "Per-stock detail page order" (RH ground truth). Locked invariants apply.
- RH section order: Header → Chart(+ranges) → Your Position → About → Stats → News → Analyst Ratings → Earnings → History. **Short Interest is SKIPPED** (no data source in the audit). Stats list is CLOSED: Market cap · P/E · Div yield · Avg volume · High/Low today · Open · Volume · 52wk High/Low (no beta/EPS/shares-outstanding).
- Analyst = Buy/Hold/Sell distribution + count (Buy=strongBuy+buy, Sell=sell+strongSell) **augmented with the UCT composite rating** (`/api/research/snapshot`).
- Gains green / losses red; UCT gold chrome; NO emoji; breakpoints 640/1024 only; sections render null-safe (a missing feed hides the section, never crashes).
- Zero new endpoints — only the `about` field addition.
- Worktree `.worktrees/rh-journal`, branch `feat/rh-journal-p2`. Tests: `cd app && npx vitest run <path>`; backend `python -m pytest tests/<file> -q`.

## Data contracts (verified in-repo)

| Need | Source | Shape notes |
|---|---|---|
| Name/sector + UCT rating + About | `GET /api/research/snapshot/{sym}` (`api/services/research/snapshot.py::get_snapshot`) | `{name, sector, industry, composite, metrics{market_cap, pe_forward, div_yield_pct, week52_high, week52_low}, about(NEW)}` |
| Live price + today | `useRealtimePrices([sym])` | `{price, change_pct, prev_close?}` |
| Today O/H/L/V + spark chart | `GET /api/bars/{sym}?tf=D&bars=2` | `bars[-1] = {t,o,h,l,c,v}` (today during session) |
| Avg volume | `GET /api/fundamentals/{sym}` | `avg_vol` |
| Position | `useJ2Positions()` filtered by symbol | `{shares, side, entryPrice, entryDate, brokerPrice}` |
| Net-liq for diversity | `brokerLiveSummary(...)` same recipe as `OpenPositionsTab` | `netLiq` |
| News | `GET /api/chart-news/{sym}?days=30` | `{news:[{headline, source, url, time_published(epoch s)}]}` |
| Analyst | `GET /api/earnings/analyst-grades/{sym}` | `{consensus:{strongBuy,buy,hold,sell,strongSell,total,label}, price_target, recent_actions, trend}` — may be null |
| Earnings | `useEarningsTable(sym)` → `/api/fundamentals/earnings-table?sym=` | `{quarterly:[{label, eps_actual, eps_estimate, eps_surprise_pct, rev_actual, rev_estimate}]}` |
| History | `GET /api/j2/trades` (useJ2Trades) filtered by symbol | closed trades |
| Chart | `<StockChart sym tf height />` + period tabs 5/30/60/D/W | existing component |
| Logo | `<CompanyLogo sym size tile />` | existing |

---

### Task 1: Backend — `about` field (yfinance `longBusinessSummary`)

**Files:** Modify `api/services/fundamentals.py` (payload dict ~line 97) + `api/services/research/snapshot.py` (~line 66); Test `tests/test_research_snapshot_about.py`.

**Interfaces:** `get_fundamentals(sym)["about"]` = `info.get("longBusinessSummary")` (None-safe). `get_snapshot(sym)["about"]` = `fund.get("about")`.

Steps: failing pytest (snapshot passes `about` through from a mocked fundamentals dict) → implement both one-liners → pass → commit `feat(research): company About blurb (longBusinessSummary) in fundamentals + snapshot`.

### Task 2: Pure helpers — `lib/positionDetail.js`

**Files:** Create `app/src/pages/journal-2-0/lib/positionDetail.js` + test.

**Interfaces:**
- `yourPositionModel(position, snap, netLiq, todayIso)` → `{shares, side, marketValue, avgCost, diversityPct, todayDollar, todayPct, totalReturnDollar, totalReturnPct}` — reuses `currentPriceFor`/`positionPnlDollar` + the Phase-2 today-ref rule (fill price when `entryDate === todayIso`, else prev close, else derived). `diversityPct = marketValue / netLiq` (null when netLiq absent).
- `statsModel(fundamentals, todayBar, snapshotMetrics)` → ordered `[{label, value}]` for the CLOSED RH stats list; null values render "—", section hides only if ALL null.
- `analystModel(grades)` → `{buyPct, holdPct, sellPct, total, label}` per RH bucketing (Buy=strongBuy+buy, Sell=sell+strongSell), null when no consensus/total 0.

TDD: unit tests for long/short/diversity/null-feeds, bucket math (e.g. 12/8/5/3/2 → buy 66.7%), stats ordering. Commit `feat(journal): position-detail pure models — Phase 3`.

### Task 3: Route + page skeleton — header, chart, Your Position

**Files:** Create `app/src/pages/journal-2-0/components/position/PositionDetailPage.jsx` + `.module.css`; Modify `app/src/App.jsx` (lazy import + `<Route path="/journal-2-0/position/:sym" …/>` beside the calendar detail route); test `PositionDetailPage.test.jsx` (mock hooks/StockChart).

Page composition (all sections after the chart are children rendered in RH order):
- Sticky-ish header: back link `← Positions` (to `/journal?j2tab=positions`), `CompanyLogo` 40 tile, symbol + company name (snapshot), live price + `▲/▼ $X.XX (Y.YY%) Today` line (green/red triangle, same semantics as hero).
- Chart card: `<StockChart sym={sym} tf={tf} height={420}/>` + period pills `5m 30m 1h D W` (default `D`, state-local).
- **Your Position** (only when an open J2 position exists): 2×3 grid — Shares · Market value · Average cost · Portfolio diversity · Today's return · Total return (colored).

Commit `feat(journal): position detail page — route, header, chart, Your Position`.

### Task 4: About + Stats + News + Analyst + Earnings + History sections

**Files:** Create `components/position/{AboutSection,StatsSection,NewsSection,AnalystSection,EarningsSection,HistorySection}.jsx` (one file each, shared styles from the page module or a `sections.module.css`); tests per section (render from mocked props; null-hides).

- **About:** snapshot `about` blurb, clamped to ~4 lines with a "Show more" toggle; header shows sector · industry chips.
- **Stats:** `statsModel` grid (2 cols phone / 4 desktop).
- **News:** top 8 `chart-news` items — source · headline (link, `target="_blank" rel="noreferrer"`) · relative time (`timeAgo` util if exported, else short ET date).
- **Analyst:** horizontal stacked Buy/Hold/Sell bar with % labels + "of N analysts" + price-target line + gold **UCT Rating** chip (composite from snapshot) — the spec's UCT augmentation.
- **Earnings:** last ≤8 quarterly rows — Quarter · EPS est · EPS actual · Surprise% (green/red) mirroring RH's est-vs-actual view.
- **History:** user's closed trades for this symbol (useJ2Trades filtered) — date · side · shares @ entry → exit · P&L (signed color); plus the open position's entry row ("Opened …"). Hidden when empty.

Commit per logical chunk or one commit `feat(journal): position detail sections — About/Stats/News/Analyst/Earnings/History`.

### Task 5: Entry wiring — holdings rows navigate

**Files:** Modify `components/HoldingsList.jsx` (+ test): equity rows become links/buttons → `navigate('/journal-2-0/position/' + symbol)`; row gets hover affordance + `cursor:pointer`; keyboard accessible (role="link" via `<Link>`). Options rows stay static (Phase 4).

Commit `feat(journal): holdings rows click through to the position detail page`.

### Task 6: Verify + ship

Full journal vitest + build; backend pytest for the new test + `python -m pytest tests -k "snapshot or fundamentals" -q`; local Playwright screenshot of `/journal-2-0/position/AAPL` (desktop+phone, overflow check); `grep -c broker_sync api/main.py` ≥ 7 (merge invariant); rebase onto origin/master → push `HEAD:master` → verify prod chunk contains a Phase-3 marker (`Your Position`).

## Self-Review
- RH order honored; Short Interest consciously skipped (no source); stats list closed; analyst bucketing per spec; About = the one new backend field; everything else reuse. Row click-through closes Phase 2's display-only note.

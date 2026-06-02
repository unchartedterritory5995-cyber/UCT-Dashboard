# Calendar — "Dominant Feed" Redesign

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan
**Author:** Patrick + Claude
**Surface:** `/calendar` (`app/src/pages/Calendar.jsx`) + `api/routers/calendar.py`

---

## 1. Summary

Rebuild the Calendar page from today's two-panel weekly list into a **personalized, logo-forward, trader-grade earnings feed** — taking the best of EarningsHub.com and going beyond it with options-implied expected move, multi-quarter surprise history, and deep personalization against the user's own watchlists / flagged / positions / UCT20.

The page becomes the single place a UCT user answers: **"What's reporting that I care about, when, how big is the expected move, and how have they done historically?"** — at a glance, with company logos and zero hunting.

Inspiration audited: EarningsHub (weekly + monthly views, "My Stocks" personalization, logos, IPO + Fed calendars, EPS/rev history, AI call summaries). UCT already has the AI summaries (EarningsModal). This design adds the views, personalization, logos, expected move, and surprise history.

---

## 2. Goals & non-goals

**Goals**
- Three view modes: **Feed** (default) · **Week** · **Month** — all sharing one data source.
- **Personalization** as a first-class filter: "My Stocks" = customizable union of Watchlists + Flagged + J2 open positions + UCT20.
- **Logo-forward** cards, served fast/reliable/instant from our own backend.
- Trader-grade card data: expected move, 4-quarter beat/miss history, countdown, live price, reported-state flip (actual vs est + surprise + post-print gap).
- Wire up the dormant **price/volume/market-cap filters** + sort.
- Keep the existing `EarningsModal` as the click-through detail (AI preview/recap, transcript, analyst targets) — do not rebuild it.

**Non-goals (v1)**
- IPO calendar, dividends/splits calendar (Phase 2 — need new data sources).
- Pre-report push alerts for your stocks (Phase 2 — reuses existing alert infra).
- iCal / Google Calendar export (later).
- Live options Greeks / IV rank on the card (modal-only if ever).

---

## 3. Data sources (from 2026-06-01 audit)

| Element | Source | Status | Notes |
|---|---|---|---|
| Earnings (BMO/AMC, EPS/rev est) | EarningsWhispers live + Finviz Elite + wire fallback + Finnhub actuals | ✅ exists | `calendar.py::_build_live`, `_patch_today_actuals` |
| Live price / %chg / post-print gap | Massive batch snapshot + `/api/calendar/reactions` | ✅ exists | 15–30s |
| **Expected move (options-implied)** | `earnings_enrichment.get_implied_move()` (Massive/Polygon options → yfinance fallback) | ✅ exists | ~0.5s Massive / 2–4s yf; returns `{pct,dollar,expiry,strike,spot,...}` |
| **4-quarter beat/miss history** | Finnhub `/stock/earnings` → `earnings_estimates.get_earnings_intel().beat_history` | ✅ exists | free tier, 6–12h cache |
| Macro & Fed events | ForexFactory JSON (`_fetch_ff_events`) | ✅ exists | High/Med impact + Fed speakers |
| Price / avg-vol / mkt-cap (filters) | `/api/calendar/day-metrics` (Finviz Elite v=152 + Massive) | ✅ exists, dormant | wire it into UI |
| Personalization sets | auth.db watchlists/items, flagged shadow, J2 positions, UCT20 (`wire_data`) | ✅ exists | internal, instant |
| **Company logos** | NEW — proxy-and-cache subsystem (see §6) | ⚠️ build | only genuinely new dependency |
| IPO / dividends | NEW | 🔜 Phase 2 | out of v1 scope |

**Key finding:** expected move and surprise history are already built — v1 is mostly an assembly + presentation job plus the logo subsystem, not new data plumbing.

---

## 4. Views

All three views consume one normalized week (or month) payload and the same personalization set; they differ only in presentation.

### 4.1 Feed (default)
Vertical, day-grouped, scannable. Each day group:
- **Day header**: `TUE · JUN 2`, reporter count, and a gold `N of yours` pill.
- **Macro band** (if any): slim blue-accented strip of that day's ★ macro + Fed events (time · name), visually distinct from earnings.
- **Cards grid**: 3-up responsive (`@container`, collapses 3→2→1), each card per §5.

A **week summary strip** sits above the feed: your reports this week · total reporters · macro prints · biggest expected move · next-of-yours countdown.

### 4.2 Week
The current Mon–Fri columnar layout, modernized: 5 columns, logos per reporter row, day tabs removed in favor of all-five-at-once. BMO/AMC sub-grouping inside each column. Good for "scan the whole week fast."

### 4.3 Month
Logo-packed month grid (5 weekday columns). Each cell: day number, wrapped logo chips (gold ring = yours), `+N` overflow, small ★ markers for macro days. Click a day → slide-out panel rendering that day's full Feed-style day group. Week ⇄ Month toggle in header.

View choice persists via `usePreferences('calendar_view')`.

---

## 5. Card anatomy

**Pending state:**
- Logo (38px, rounded) · ticker · BMO/AMC pill · company name · countdown (`⏱ reports in ~6h` / `Tue · after close`).
- EPS est · Rev est · live Price + %chg.
- **Expected move** block: `±9.1%` (options-implied; hidden gracefully if `get_implied_move` returns null).
- **4-quarter history**: 4 mini bars (green=beat / red=miss) + `3/4 beat` label.
- Gold border + ★ when the ticker is in the user's "My Stocks" set.

**Reported state (flips when `eps_act != null`):**
- BEAT/MISS/MIXED pill.
- EPS `est → actual`, Surprise %, Revenue actual/est.
- **Post-print gap** (from `/reactions`, live during market hours).

**Interactions:**
- Click → existing `EarningsModal` (unchanged).
- Right-click → existing `TickerActions` (flag / alert / add to list).
- Hover → subtle lift.

---

## 6. Logo subsystem (the only new backend dependency)

Goal: **fast, reliable, instant** — never block a card on a third party.

### 6.1 Backend
- New service `api/services/ticker_logos.py`:
  - `get_logo_path(sym) -> Path | None`: returns cached file at `/data/logo_cache/{SYM}.png` if present.
  - `resolve_and_cache(sym)`: multi-source resolver, first hit wins, normalizes to PNG (Pillow), writes to volume:
    1. Finnhub `profile2.logo` / derive from `profile2.weburl` domain → Clearbit `logo.clearbit.com/{domain}`
    2. Parqet `assets.parqet.com/logos/symbol/{SYM}` (verified 200, SVG → rasterize)
    3. FMP `financialmodelingprep.com/image-stock/{SYM}.png` (verified 200)
    4. Miss → write a `.miss` sentinel (re-try after 7d) so we don't refetch every request.
  - Bounded worker pool + in-flight de-dup (mirror `ticker_search.py` backfill bounds: 2 workers, ≤8 in-flight) — third-party politeness.
- New router `api/routers/ticker_logos.py`:
  - `GET /api/ticker-logo/{sym}` → streams the cached PNG with `Cache-Control: public, max-age=604800, immutable`; on miss, fires async resolve and returns a 1×1 transparent (or 302 to a generated monogram) so the client falls back instantly.
- New prewarmer `api/services/ticker_logos_prewarm.py`: daemon thread (startup, after a warmup delay so it doesn't fight bars/names prewarmers), walks `cap_universe.json`, resolves+caches each with a polite sleep. Reboots are near-no-ops (disk already warm). Toggle `TICKER_LOGOS_PREWARM_DISABLED=1`.

### 6.2 Frontend
- `app/src/components/CompanyLogo.jsx`: `<CompanyLogo sym size />` → `<img src="/api/ticker-logo/SYM">` with `onerror` → **monogram tile** (deterministic background color from sym hash + first letter). A logo is never a broken image.
- Browser caches aggressively via the response headers; the monogram covers cold/missing instantly.

### 6.3 Why proxy instead of hot-linking
After first warm, logos serve from our Railway volume (~10ms), survive redeploys, are immune to Parqet/FMP/Clearbit outages or rate limits, and add **zero new paid API**. Matches the existing ticker-name prewarm architecture the team already trusts.

---

## 7. Personalization

- New helper `api/services/calendar_personalization.py::get_user_ticker_sets(user_id)` →
  `{watchlist: set, flagged: set, positions: set, uct20: set, all_mine: set}`.
  - watchlist/flagged: auth.db (`watchlists`+`watchlist_items`, flagged shadow).
  - positions: J2 open positions (`j2_positions`) for the user's compass/accounts.
  - uct20: from `wire_data` leadership/`uct20` set (shared, not per-user).
- Endpoint `GET /api/calendar/my-sets` (auth) returns these sets so the frontend can tag/filter without N calls.
- **Customizable**: a ⚙ popover on the "★ My Stocks" control lets the user choose which sources count toward "My Stocks" (persisted via `usePreferences('calendar_mystocks_sources')`, default = all four). Filter chips additionally let the user slice to a single source.
- Cards are tagged `mine` when their sym ∈ the active personalization set. Sort option **"My stocks first"** uses this.

---

## 8. Filters & sort

- **Audience chips**: My Stocks · Watchlist · Positions · UCT20 · All ($300M+).
- **Event-type chips**: Earnings · Macro (· IPOs · Dividends shown disabled "soon" in v1).
- **Metric filters** (wire up dormant `day-metrics`): min market cap, min avg volume, price range.
- **Sort**: My stocks first (default) · Time · Market cap · Expected move.
- Filter/sort state persists via `usePreferences('calendar_prefs')`.

---

## 9. Backend changes summary

**New**
- `api/services/ticker_logos.py`, `api/routers/ticker_logos.py`, `api/services/ticker_logos_prewarm.py`
- `api/services/calendar_personalization.py`
- `GET /api/calendar/my-sets`
- Calendar payload enrichment: attach `expected_move` (from `get_implied_move`) and `beat_history` (from `get_earnings_intel`) per reporter — **bounded + cached + best-effort** (see §11), only for the visible week to control cost.

**Reused as-is**
- `/api/calendar`, `/api/calendar/reactions`, `/api/calendar/day-metrics`, `EarningsModal`, `TickerActions`, `useRealtimePrices`, `usePreferences`.

---

## 10. Frontend changes summary

- Rework `app/src/pages/Calendar.jsx` into: `CalendarHeader` (title, view toggle, search, My Stocks ⚙), `CalendarFilters`, `WeekSummary`, `FeedView`, `WeekView`, `MonthView` + shared `EarningsCard`, `MacroBand`, `DayDetailDrawer`.
- New `CompanyLogo.jsx`.
- New hooks: `useCalendarMySets`, extend existing SWR for the enriched payload.
- `Calendar.module.css` rebuilt; `@container` responsive card grid (follow Charts V2 pattern).

---

## 11. Performance, cost & reliability invariants

- **Enrichment is bounded & lazy**: expected move + beat_history fetched only for the **current visible week's** reporters, concurrency-capped, cached (expected move 60s via existing options cache; beat_history 6–12h). Never block the base calendar response — enrich in a background pass and merge, or serve base immediately + a `/api/calendar/enrichment?week=` follow-up the frontend overlays (mirrors how live prices overlay today). **Decision: separate `/api/calendar/enrichment` overlay endpoint** so the core list paints instantly and the heavier options/Finnhub data fills in — keeps first paint fast.
- **Logos never block a card** — monogram fallback is synchronous; real logo swaps in when ready.
- **Prewarmers are polite** — bounded pools, warmup delays, disabled-by-env escape hatch; must not fight `bars_prewarm` / `ticker_names_prewarm`.
- **Cost**: expected-move uses existing Massive options (already paid) with yfinance fallback; Finnhub history is free tier; logos add no paid API. No new recurring cost in v1.
- **Graceful degradation**: every new field hides cleanly if its source returns null. The page must be fully usable with logos off and enrichment empty.

---

## 12. Phasing

**v1 (this build)**: 3 views, personalization (+ ⚙ customizer), logos (proxy+cache+prewarm), expected move, surprise history, countdown, reported-state flip, metric filters + sort, week summary strip.

**Phase 2**: IPO calendar, dividends/splits, pre-report multi-channel alerts for My Stocks, iCal/Google Calendar export, optional density toggle.

---

## 13. Testing

- Backend: unit tests for `ticker_logos` resolver chain (mock each source, miss sentinel, PNG normalize), `calendar_personalization` set assembly, enrichment overlay shape, day-metrics filter math. Follow existing `tests/` patterns.
- Frontend: vitest for `CompanyLogo` fallback, filter/sort reducers, view-toggle persistence, mine-tagging.
- Manual: verify cold logo → monogram → warm swap; expected move present on optionable names, hidden on others; reported-state flip after a print.

---

## 14. Open risks

- Third-party logo source longevity → mitigated by multi-source resolver + our own cache + monogram fallback.
- Expected move accuracy on thin/illiquid names → display only when straddle is sane; hide otherwise.
- Month view density on small screens → mobile collapses to a simpler agenda list (reuse Feed for `<640px`).

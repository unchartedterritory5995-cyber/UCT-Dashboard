# Weekly Conviction Flow → Discord — Design

**Date:** 2026-08-01
**Status:** Design. P1 (server compute + preview endpoint + card) → P2 (Friday cron push).
**Sibling:** mirrors the Top Flow EOD feature (`api/alpha_gold_eod.py`) — reuses its Pillow card + Discord multipart-over-urllib post + flow-worker scheduler machinery.

## Goal
A weekly Discord push of the **top 10 bullish + top 10 bearish** options-flow names over the last **N days** (adjustable; default 5 = the trading week) whose flow is **still open** — the position wasn't closed / profit wasn't taken — **excluding short-dated flow**. Shows conviction that's still riding even if the name is down. Auto-posted **Friday after close**, as a branded card image. Matches the **OptionsFlow → Leaderboard** tab the owner reads.

## Owner decisions (2026-08-01)
1. **Short-term cutoff:** exclude anything with **DTE < 30 days** (less than a month). Keep DTE ≥ 30.
2. **Still-open rule:** a contract counts only if its **current OI ≥ 75% of peak OI** (dropped ≤ 25% from peak = they haven't exited).
3. **Ranking:** **top 10 by premium**, at the **ticker** level (aggregate a name's directional flow; show its top contract).
4. **Schedule:** **Friday ~4:15 PM ET**, default window **5d**; window adjustable (5 / 20 / 60).
5. **Classifier: B** — **re-port the OptionsFlow JS direction logic to Python** so the weekly numbers match the Leaderboard exactly (NOT the live_massive_router engine). Accept the dual-engine maintenance cost per owner ([[flow-two-classifiers]]).

## Architecture
- **Runs on the flow-worker** (owns `flow.db` + `contract_oi_snapshots`), mirroring the daily-OI cron. New module `api/weekly_flow.py`.
- **Data sources (all server-side):**
  - Trades → `flow.db` `flow` table via `api/flow_db.py FlowDB` (columns `Symbol, CallPut, Strike, ExpirationDate, CreatedDate, OI, Side, Type, Color, Premium, Volume, Spot, MktCap, StockEtf, Dte, …`; dates `M/D/YYYY`).
  - Still-open OI → `contract_oi_snapshots` (daily Schwab snapshots) via `api/oi_snapshots.py` (`get_history`/`get_snapshot`; the `/api/oi/confirmation-map` logic already yields `first_oi`/`peak_oi`/latest per contract).
- **Reused from `alpha_gold_eod.py`:** `render_card` Pillow recipe (desk_assets fonts + UCT compass logo), `_post_discord_image` (multipart over urllib, Cloudflare UA), the CronTrigger scheduling pattern.

## Direction classification — PORT of flowCompute.js (decision B)
Per trade, replicate `flowCompute.js processFlowData` (L800-878) **exactly**:
- **Normalize side:** ABOVE/`AA`→AA · BELOW/`BB`→BB · `A`/ASK→A · `B`/BID→B · else blank.
- **Type:** SWEEP/SWP → `isSWP`; BLOCK/BLK → `isBLK`; `ML/` → `isML` (excluded).
- **Color confirmed** = color ∈ {YELLOW, MAGENTA}.
- **CALL:** A/AA → **BULL** · BB+sweep → **BEAR** (selling calls) · blank+sweep → **BULL** (presume ask) · else **null**.
- **PUT:** A/AA → **BEAR** · BB+sweep → **BULL** (selling puts) · blank+sweep → **BEAR** · else **null**.
- **Lottery kill:** if direction set AND spot>0 AND **liveDTE 0-7** AND mktcap ≥ $10B AND OTM AND `otmPct ≥ (10 if mktcap≥$200B else 15)` → direction = null.
- **Deep-arb (`isDeep`) exclusion:** block ≥10% from spot / sweep ≥20% from spot when ITM — verify whether the base `filtered` set drops these (port to match).
- **`all_directional`** = trades with a non-null direction (the set the Leaderboard ranks). ⚠️ **Port `filtered`'s base exclusions too** (ML at minimum; confirm deep-arb) — read `flowCompute.js` `filtered` construction during the build.

## Pipeline (`api/weekly_flow.py`)
1. **Window:** pull `flow.db` trades where `CreatedDate` ∈ last N trading days (param `days`, default 5).
2. **Classify** each trade's direction via the ported rules → keep `all_directional`.
3. **DTE filter:** drop trades with **DTE < 30** (compute DTE = ExpirationDate − report/today; use the row's `Dte` when present, else derive).
4. **Still-open filter:** per contract (ticker|cp|strike|exp), look up `contract_oi_snapshots`; keep only if **latest OI ≥ 0.75 × peak OI**. Drop expired. Contracts with no snapshot → excluded (can't confirm still-open — honest).
5. **Aggregate per ticker:** `bull += premium` (D=BULL), `bear += premium` (D=BEAR); track top contract (highest-premium), bull%, contract count.
6. **Split + rank:** bulls = tickers with bull > bear; bears = bear > bull; **top 10 each by directional premium** (bull premium for bulls, bear premium for bears).
7. **Card:** two sections (▲ TOP 10 BULLISH, ▼ TOP 10 BEARISH); columns ≈ Ticker · Bull$ · Bear$ · Bull% · Net · Top Contract (cp/strike/exp) · ΔOI/still-open marker. Header = "UCT Intelligence · Weekly Conviction · {week range}" + window + counts. Reuse the Top Flow card style.

## Endpoints / schedule
- **Manual preview/trigger** (`require_flow_admin`, on `live_massive_router` or a small `weekly_flow_router`): `POST /api/live/massive/weekly-flow?post=0&days=5` → PNG preview; `?post=1` → Discord. Mirrors `alpha-gold-eod`.
- **Cron:** flow-worker `_start_flow_schedulers()`, `CronTrigger(day_of_week="fri", hour=16, minute=15, timezone=ET)`, gated `WEEKLY_FLOW_ENABLED` (dark). Env: `WEEKLY_FLOW_WEBHOOK_URL` (fallback chain, never public), `WEEKLY_FLOW_DAYS` (default 5), `WEEKLY_FLOW_TOP_N` (10), `WEEKLY_FLOW_MIN_DTE` (30), `WEEKLY_FLOW_STILL_OPEN_FRAC` (0.75).
- **Watch-path note:** `api/weekly_flow.py` will be a NEW file → NOT in flow-worker watch paths → piggyback on a watched file (or add it to watch paths) — same as `alpha_gold_eod.py`.

## Phases
- **P1:** `weekly_flow.py` — ported classifier + still-open (OI snapshots) + ranking + card + manual preview endpoint + tests (classifier parity vs a JS fixture, still-open gate, DTE gate, ranking). Ship dark; validate the preview vs the live Leaderboard (Still-open + LT/LEAP DTE + net sort) for a few names.
- **P2:** Friday cron push + adjustable-window env.

## Open items to verify during build
- Exact base `filtered` exclusions in `flowCompute.js` (ML, deep-arb) to match `all_directional`.
- OI-snapshot coverage: contracts traded this week should have snapshots (daily cron covers 30-day-active contracts) — spot-check peak/latest availability.
- DTE reference date: use the trade's own DTE vs "as of Friday" — pick one and document (leaderboard uses live DTE from expiry).

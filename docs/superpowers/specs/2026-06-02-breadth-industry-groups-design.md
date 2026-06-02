# Breadth Drill-Down — Industry Groups

**Date:** 2026-06-02
**Status:** Approved → implementing
**Ticket:** "+4% / -4% Groups" (Stephen Pineau) — *"It would be super helpful to view which
groups / theme are most heavily represented in the +4% / -4% section of the breadth page.
Perhaps being able to sort by those groups so it lumps all the names in that theme together."*

## Goal

In the breadth +4% / -4% drill-down, let the user see **which industries are most heavily
represented** among today's movers, and **lump same-industry names together** so clusters are
obvious at a glance.

## Decisions (locked)

- **Group by GICS Industry** (~150 buckets). Chosen over UCT-theme (only ~1,316 tickers mapped —
  too many movers would fall through) and over GICS Sector (11 buckets — too coarse to spot real
  clusters). Near-100% coverage via the existing yfinance metadata cache.
- **Lives inside the existing `DrillModal`** — a `[ List | Grouped ]` toggle, not a new tab.
- The toggle is on the **shared** DrillModal, so it lights up on every breadth drill list
  (52w highs, magna, etc.) for free — **but +4% / -4% is the headline target.**

## Data source

Reuse `api/services/catalyst/ticker_metadata.py`, which already caches `industry` per ticker
(24 h TTL, yfinance-backed, SQLite at `/data/catalyst_metadata.db`). **No change** to
`breadth_collector` or the breadth snapshot shape — grouping is a pure enrichment layer joined
to the drill list client-side.

### Non-blocking enrichment (critical)

Drill lists can hold 90+ tickers; `get_metadata()` blocks on cold yfinance `.info` calls
(~1–2 s each, rate-limited). To keep the modal snappy:

- New `get_industries_nonblocking(tickers) -> {TICKER: industry|None}` in `ticker_metadata.py`:
  - reads **cache only** (instant),
  - on a miss, enqueues the ticker to a **bounded background pool** (2 workers, max 8 in-flight)
    that calls `get_metadata()` to fetch + cache it,
  - returns the industry if cached, else `None`.
- Mirrors the existing `ticker_search.py` name-backfill pattern. Misses resolve on the next
  modal open (the frontend also does one delayed re-fetch to fill late arrivals).

### Endpoint

`POST /api/breadth/industries` on the `breadth_monitor` router.
Body `{ "tickers": ["NVDA", ...] }` → `{ "industries": { "NVDA": "Semiconductors", ... } }`.
Capped at 500 tickers per call. No auth (read-only, same posture as the drill GET).

## Frontend (`DrillModal` in `app/src/pages/Breadth.jsx`)

- **`[ List | Grouped ]` toggle** in the modal header. Choice persisted to
  `localStorage['breadth.drill.viewMode']` so it sticks across opens.
- On drill load, POST the ticker list to `/api/breadth/industries`; store `{T: industry}` in
  state. One delayed retry (~2.5 s) backfills tickers that returned `null` (cold-cache misses).
- **Pure helper `groupItemsByIndustry(items, industries)`** (exported for tests) returns:
  - `groups`: `[{ key, count, avgPct, items }]` sorted by **count desc** (most-represented first),
    tie-break by `avg |pct|` desc. `Unclassified` always sorts **last** regardless of count.
  - `order`: the flattened item array in grouped display order (drives selection + ↑/↓ nav).
- **Grouped render:** collapsible `<industry> (n) · avg ±x.x%` header (avg colored
  green/red) followed by that industry's rows (existing row markup), sorted by `|pct|` desc.
- **Selection / keyboard / chart panel:** `selectedIdx` indexes the *ordered* array
  (`grouped ? order : items`) so ↑/↓ traverse the grouped order seamlessly and the right-hand
  chart + Shift-F flag keep working. Switching modes resets `selectedIdx` to 0.
- **Copy List** in grouped mode copies tickers in grouped (industry-clustered) order — directly
  satisfies "lumps all the names in that theme together."

## Edge cases

- Ticker with no industry yet (cold cache / yfinance gap) → `Unclassified` bucket.
- Empty list → existing empty state (toggle hidden).
- `universe_list` (thousands of rows) → grouping still works; backfill is bounded so it won't
  stampede yfinance. Acceptable that a huge cold list shows mostly `Unclassified` on first open
  and fills over subsequent opens.

## Testing

- **Backend** (`tests/test_breadth_industries.py`): `get_industries_nonblocking` returns cached
  industries, returns `None` + enqueues for misses, never blocks; endpoint shape + 500 cap.
  yfinance mocked — no network.
- **Frontend** (`Breadth` grouping test): `groupItemsByIndustry` sorts groups by count desc,
  puts `Unclassified` last, computes avg pct, flattened `order` matches render order.

## Out of scope (YAGNI)

- Separate "leaderboard" strip — the count-sorted group headers already are the leaderboard.
- UCT-theme / sector grouping toggle — industry only for v1.
- Persisting per-metric view mode — one global List/Grouped preference is enough.

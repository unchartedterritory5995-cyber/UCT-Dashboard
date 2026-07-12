# Breadth Grouping — Theme Dimension

**Date:** 2026-07-11
**Status:** Approved → implementing
**Follows:** `2026-06-02-breadth-grouping-system-design.md` (Sector ⇄ Industry toggle, shared grouping toolkit)

## Goal

Add **Theme** as a third grouping dimension on the breadth +4%/-4% stock lists (DrillModal +
CustomScan), alongside the existing Sector/Industry toggle. Requested directly by a user: "For the
+4%/-4% page, you can view by Sector, or by Industry, but not by Theme."

## Multi-membership resolution

Sector/Industry are 1:1 per ticker. UCT themes are many-to-many (e.g. NVDA belongs to
Semiconductors, Artificial Intelligence, Video Games, Quantum Computing, Autonomous Robotics — 5
themes; average across the 1,316 classified tickers is ~1.5). This grouping view buckets each
ticker under exactly **one primary theme**, matching how Sector/Industry already work (one bucket
per item, counts sum to the list total).

**Primary theme = the ticker's highest-tier membership** (`core` beats `relevant` beats
`peripheral`), tie-broken by `theme_id`. This is not a new rule invented for this feature — it's
the exact algorithm `ticker_meta.py::_primary_theme()` already uses to populate the `theme` field
shown in every chart watermark app-wide (`useTickerMeta.js` → `StockChart.jsx`). Reusing it means a
stock's Breadth theme-group always agrees with the theme already displayed on its own chart — no
new inconsistency introduced. Stocks with no theme membership fall into `Unclassified`, same as
unclassified sector/industry today.

## A. Shared tie-break logic — `api/services/theme_db.py`

Extract the tier-rank tie-break (currently inlined in `ticker_meta._primary_theme`) into a shared
helper so both the existing single-ticker path and the new batch path use one definition:

- **`_TIER_RANK = {"core": 0, "relevant": 1, "peripheral": 2}`** (moved from `ticker_meta.py`).
- **`_resolve_primary(rows)`** — given a list of membership rows (as returned by
  `get_themes_for_ticker`), returns the single row with the lowest `(tier_rank, theme_id)`, or
  `None` if `rows` is empty.
- **`ticker_meta._primary_theme(ticker)`** refactored to call `get_themes_for_ticker` +
  `theme_db._resolve_primary` instead of its own inline sort. Behavior is unchanged (verified
  against existing `test_ticker_meta.py` cases, which mock at the `_primary_theme` /
  `get_themes_for_ticker` boundary, not the internal sort) — this is a pure de-duplication, not a
  behavior change.

## B. Batch lookup — `theme_db.get_theme_map(tickers)`

New function, same contract shape as `industry_map.get_groups(tickers)`:

- Dedupe + uppercase input tickers.
- One chunked SQL query (400 tickers/chunk, mirrors `industry_map.py`'s pattern) joining
  `theme_memberships` → `themes`, `WHERE sym IN (...)`.
- Group rows by `sym` in Python, resolve each ticker's primary theme via `_resolve_primary`.
- Returns `{TICKER: theme_name | None}` — **one entry for every requested ticker**, including
  unclassified ones (`None`), matching `get_groups`'s always-present-key contract.
- No caching layer, no self-heal/backfill thread (unlike `industry_map.py`). `theme_memberships` is
  a small (1,928 rows), fully-seeded, static local table re-populated wholesale from
  `themes_taxonomy.json` on deploy — not an externally-sourced, incrementally-warmed cache like the
  Finviz-backed industry map. A direct read is sufficient.

## C. Endpoint — `POST /api/breadth/themes`

Added to `api/routers/breadth_monitor.py`, mirrors `/api/breadth/industries`:

- Body: `{"tickers": ["NVDA", ...]}` → `{"themes": {"NVDA": "Artificial Intelligence", ...}}`.
- 400 on non-list `tickers`. Caps input at 500 tickers (same as industries endpoint).
- Never raises past a 400 — a `get_theme_map` failure degrades to `{t: None for t in tickers}`,
  same posture as the industries endpoint's `except` branch.

## D. Frontend

- **`useGroupMeta.js`**: fetch `/api/breadth/themes` in parallel with the existing
  `/api/breadth/industries` call (`Promise.all` or a second independent effect). Returned meta
  becomes `{ industries, sectors, themes }`. **No retry-on-miss** for themes (unlike
  industries/sectors, which retry once after 2.5s to catch cold-cache backfills) — there is no
  cold-cache concept for a static local table, so a `null` theme is a real "unclassified" result,
  not a transient miss.
- **`useBreadthGrouping.js`**: `LS_DIM` allowed values become `['industry', 'sector', 'theme']`;
  `labelByTicker` picks `meta.themes` when `dimension === 'theme'`.
- **`GroupControls.jsx`**: add a third segmented button, `Theme`, next to Sector/Industry. No CSS
  changes needed (`.toggle` is an unconstrained `inline-flex`).
- **`GroupSummaryStrip.jsx`**: fix the existing hardcoded binary ternary
  (`dimension === 'sector' ? 'sectors' : 'industries'`, line 12) to a three-way label lookup
  (`sector` → "sectors", `industry` → "industries", `theme` → "themes"). Without this fix, Theme
  grouping would silently render the wrong header label — caught during design review, not an
  incidental cleanup.
- **`groupItems.js`**: no changes — already label-agnostic, consumes whatever `labelByTicker` map
  it's given.

## Testing

- Backend: `tests/test_breadth_themes.py` (new, mirrors `tests/test_breadth_industries.py`) —
  `get_theme_map` shape (hit + miss in the same call), endpoint shape, 500-ticker cap, 400 on bad
  body. DB isolation via `monkeypatch.setattr(auth_db, "_DB_PATH", tmp_path)` (the pattern already
  used by `test_broker_*`/`test_support_tickets.py`/`test_auth_plan.py` for `auth_db`-backed
  services — `theme_db.get_connection()` comes from `auth_db`, not a locally-resolved `_DB_PATH`
  like `industry_map.py`).
- `theme_db._resolve_primary` / `get_theme_map`: direct unit test for the tier-then-theme_id
  tie-break (core > relevant > peripheral; alphabetical `theme_id` tie-break within a tier).
- `test_ticker_meta.py`: existing `test_primary_theme_prefers_core_then_relevant_then_peripheral`
  and `test_primary_theme_none_when_no_membership_or_error` must still pass unchanged after the
  `_primary_theme` refactor (behavior-level tests, not implementation-coupled).
- Frontend: `GroupSummaryStrip.test.jsx` gains a `dimension="theme"` → `"Top themes"` case.
  `useBreadthGrouping.js`/`GroupControls.jsx` have no dedicated test files today (only exercised
  indirectly via `Breadth.jsx`/`CustomScan.jsx`) — not adding new ones now, consistent with
  existing coverage level.

## Consumers (no changes needed)

`Breadth.jsx` (DrillModal) and `CustomScan.jsx` both pass `dimension`/`setDimension` through
generically with no hardcoded `'sector'`/`'industry'` branching — confirmed via grep across
`app/src/pages/breadth/**` and both files. They pick up the new `theme` dimension automatically
once `GroupControls` offers it.

## Out of scope

- Showing a ticker under *every* theme it belongs to (multi-bucket membership) — rejected in favor
  of primary-theme, matching Sector/Industry's single-bucket-per-item semantics and existing
  watermark precedent.
- Hardening `theme_db.seed_from_json()` to defensively `.upper()` incoming `sym` values — the
  current lack of normalization is a latent, currently-inert issue (100% of
  `themes_taxonomy.json`'s 1,928 holdings are already uppercase); out of scope for this feature.
- Wrapping `init_theme_tables()` / `seed_from_json()` in `api/main.py`'s lifespan startup in
  try/except — a pre-existing startup-robustness gap unrelated to this feature.

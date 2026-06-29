# 13F Institutional Ownership — Design

**Date:** 2026-06-29
**Status:** Approved design → implementation plan
**Feature group:** FMP Ultimate build-out (B of 3; siblings: analyst-intel, fmp-bulk-endpoints)

## Summary

Surface institutional (13F) ownership for any ticker — **% held by institutions**,
**top holders**, and the part that's actually actionable: **position changes this
quarter** (new / added / reduced / sold-out) plus **biggest buyers & sellers** —
in the same **three** surfaces as Analyst Intel, via one reusable `OwnershipPanel`.

Builds on the existing `institutional_holdings.py` (yfinance basic top-holders),
upgrading it to **FMP Ultimate first** for the position-change deltas yfinance
can't provide, with the yfinance path kept as fallback.

## Shared architecture

Same "build once, mount thrice" backbone as analyst-intel: one service → one
endpoint → one reusable panel + hook, mounted in the Fundamentals widget (toggle
tab), EarningsModal (section), and TickerPopup (tab). FMP endpoint paths verified
live during implementation; graceful fallback throughout.

## Architecture

### Backend — extend `api/services/institutional_holdings.py`
New `get_ownership(ticker) -> dict`, cached ~6h (13F is quarterly):

```json
{
  "ticker": "AAPL",
  "inst_pct": 61.4,
  "inst_holders_count": 5123,
  "as_of": "2026-03-31",
  "top_holders": [
    { "holder": "Vanguard Group", "shares": 1.31e9, "pct_out": 8.4,
      "value": 3.2e11, "change": "added", "change_shares": 2.1e7 }
  ],
  "biggest_buyers":  [ { "holder": "...", "change_shares": 5.0e7 } ],
  "biggest_sellers": [ { "holder": "...", "change_shares": -3.0e7 } ],
  "_source": "fmp"   // or "yfinance"; only with ?debug=1
}
```

Source chain:
- FMP `stable/institutional-ownership` (holders + share counts + prior-quarter
  deltas; confirm exact path/fields live) → derive `change` (new/added/reduced/
  sold-out) from current vs prior shares, and `biggest_buyers/sellers` by
  `change_shares`.
- Fallback: existing yfinance `institutional_holders` path → top holders +
  `inst_pct` only (no deltas; `change` = null, buyers/sellers empty).

Helpers mockable for tests. `change` classification is pure + unit-tested.

### Backend — endpoint
`GET /api/ownership/{sym}?debug=0` (auth) in `api/routers/analyst.py` (shared
router with analyst-intel) or its own small router. Null-safe.

### Frontend — reusable panel
- `app/src/components/fundamentals/OwnershipPanel.jsx` + `.module.css`:
  - Header: `% Institutional` + holders count + `as_of` quarter.
  - **Top holders table**: Holder · Shares · % Out · Value · Δ (a colored chip:
    `NEW`/`+added`/`−reduced`/`SOLD` using `--ut-green/-red/-gold`).
  - **Buyers / Sellers** mini-lists (biggest `change_shares`). Hidden when the
    fallback source has no deltas.
  - Brand tokens, no emoji, tabular-nums, `@container`-friendly density.
- `app/src/hooks/useOwnership.js` — SWR `/api/ownership/{sym}`.
- **Mounts:** Fundamentals widget view `'ownership'`; EarningsModal section;
  TickerPopup `Ownership` tab — same three mount points as AnalystPanel.

## Data flow

```
ticker → SWR → GET /api/ownership/{sym} ── get_ownership
   FMP institutional-ownership (+ prior-qtr deltas) → yfinance fallback (no deltas)
   ▼  OwnershipPanel  ── Fundamentals widget · EarningsModal · TickerPopup
```

## Error handling
- FMP failure → yfinance fallback; yfinance failure → `{error}` → panel shows
  muted "No ownership data". Delta fields absent on fallback → buyers/sellers
  sections hidden (not shown empty).

## Testing
- Backend `tests/test_ownership.py`: FMP happy (deltas + buyers/sellers ranking),
  `change` classification (new/added/reduced/sold-out from prior vs current),
  yfinance fallback (no deltas), empty/unknown ticker, `?debug` source.
- Endpoint coverage (auth/happy/unknown) in the shared router test.
- Frontend `OwnershipPanel.test.jsx`: holders table + Δ chips + buyers/sellers
  from mock; fallback (no deltas → sections hidden); empty state.

## Files
| Path | Change |
|------|--------|
| `api/services/institutional_holdings.py` | extend: `get_ownership` + delta classification |
| `api/routers/analyst.py` | add `GET /api/ownership/{sym}` |
| `app/src/components/fundamentals/OwnershipPanel.{jsx,module.css}` | **new** |
| `app/src/hooks/useOwnership.js` | **new** |
| `app/src/pages/charts/widgets/FundamentalsWidget.jsx` | add Ownership view |
| `app/src/components/tiles/EarningsModal.jsx` | add Ownership section |
| `app/src/components/TickerPopup.jsx` | add Ownership tab |
| `tests/...` + `*.test.jsx` | coverage |

## Env / config
Reuses `FMP_API_KEY`. Optional gate `OWNERSHIP_FMP=1`.

## Open implementation-time questions (non-blocking)
- Confirm FMP institutional-ownership endpoint path + whether it returns
  prior-quarter share counts directly (deltas) or requires two-quarter diffing.
- Top-holders cap (default 15) + buyers/sellers list length (default 5).

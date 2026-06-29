# Analyst Intel (grades · price targets · upgrades/downgrades) — Design

**Date:** 2026-06-29
**Status:** Approved design → implementation plan
**Feature group:** FMP Ultimate build-out (A of 3; siblings: institutional-ownership, fmp-bulk-endpoints)

## Summary

Surface rich analyst intelligence for any ticker — **consensus rating**, **price
target** (low/avg/high + upside%), and a **recent upgrades/downgrades feed**
(date · firm · action · from→to grade · new PT) — in **three** places via one
reusable panel:
1. New **Analyst** tab in the `/charts` Fundamentals widget.
2. New **Analyst** section in the Calendar `EarningsModal`.
3. New **Analyst** tab in the universal `TickerPopup`.

Data is **FMP Ultimate first** (richer grades + PT history) with the existing
**Finnhub** consensus/price-target (already in `get_earnings_intel`) as fallback,
so a missing FMP endpoint or tier gate never blanks the panel.

The catalyst engine already ingests analyst actions (`analyst_actions.py`); this
spec keeps that integration and optionally enriches it, but the headline
deliverable is the **user-facing panel**.

## Shared architecture (applies to A + B)

Build **once, mount thrice**: one data service → one endpoint → one reusable
React panel + SWR hook, dropped into all three surfaces. No duplicated fetch or
render logic. FMP endpoint paths are **verified live during implementation** via
the existing `/api/debug/earnings-sources/{sym}` probe pattern (which caught the
`analyst-estimates?period=quarter` tier gate); every FMP call has a graceful
fallback.

## Architecture

### Backend — `api/services/analyst_intel.py` (new)
`get_analyst_intel(ticker) -> dict`, cached ~6h (analyst data moves slowly):

```json
{
  "ticker": "AAPL",
  "consensus": { "rating": "Buy", "buy": 28, "hold": 9, "sell": 2,
                 "strong_buy": 12, "strong_sell": 0, "score": 4.1 },
  "price_target": { "low": 210, "avg": 285, "high": 320, "current": 250,
                    "upside_pct": 14.0, "count": 41, "updated": "2026-06-20" },
  "recent_actions": [
    { "date": "2026-06-20", "firm": "Morgan Stanley", "action": "upgrade",
      "from_grade": "Equal-Weight", "to_grade": "Overweight", "price_target": 300 }
  ],
  "_source": "fmp"      // or "finnhub" fallback; present only with ?debug=1
}
```

Source chain (per slice, first that returns data wins):
- **consensus** → FMP `stable/grades-consensus` → Finnhub `/stock/recommendation`
  (reuse `earnings_estimates.get_earnings_intel`'s consensus).
- **price_target** → FMP `stable/price-target-summary` → Finnhub
  `/stock/price-target`. `upside_pct` computed vs live price (reuse the snapshot
  price path already used by the widget).
- **recent_actions** → FMP `stable/grades-historical` (or `grades`/`grades-news`
  — confirm live) → Finnhub `/stock/upgrade-downgrade` (already wrapped in
  `analyst_actions.finnhub_recent_action`). Last ~15, newest first.

Helpers are mockable (`_fmp_*`, `_finnhub_*`) for unit tests (the established
`monkeypatch.setattr(mod, "_fmp_get", fake)` idiom). Reuses `ee._fmp_get`.

### Backend — endpoint
`GET /api/analyst/{sym}?debug=0` (auth `get_current_user`) in a new
`api/routers/analyst.py` (or fold into the existing fundamentals router; keep the
wildcard-ordering gotcha in mind). Null-safe: unknown ticker → empty dict shape,
never 500.

### Frontend — reusable panel
- `app/src/components/fundamentals/AnalystPanel.jsx` + `.module.css` — consensus
  bar (Buy/Hold/Sell, brand green→gold→red), PT range bar (low–avg–high with
  current marker + upside%), and a compact upgrades/downgrades list (date · firm
  · ↑/↓ glyph · from→to · PT). Real `--ut-*`/`--text-*` tokens, no emoji.
- `app/src/hooks/useAnalystIntel.js` — SWR `/api/analyst/{sym}`, ~10min refresh.
- **Mounts:**
  - Fundamentals widget: add `'analyst'` to the view toggle
    (`Annual | Quarterly | Analyst | Ownership`); `opts.view` persists (existing
    path). Reads `groupSyms[color]` for the ticker.
  - EarningsModal: render `<AnalystPanel>` in place of / above the current inline
    consensus+PT block (lines ~349-368), feeding `row.sym`.
  - TickerPopup: add an `Analyst` tab alongside the chart tabs; render the panel
    for the popup's `sym`.

## Data flow

```
ticker (group sym / row.sym / popup sym)
   │  SWR
   ▼
GET /api/analyst/{sym} ── analyst_intel.get_analyst_intel
        FMP grades-consensus / price-target-summary / grades-historical
        → Finnhub fallback (get_earnings_intel consensus/PT + upgrade-downgrade)
   ▼
AnalystPanel  ── mounted in Fundamentals widget · EarningsModal · TickerPopup
```

## Error handling
- Every FMP/Finnhub call wrapped; a failing slice → that field omitted, panel
  renders the rest. All-empty → panel shows a muted "No analyst coverage".
- Cache failures fall through to live fetch; never raises to the surface.

## Testing
- Backend `tests/test_analyst_intel.py`: FMP happy path, Finnhub fallback when FMP
  empty, partial slices, upside% math, empty/unknown ticker, `?debug` source tag.
- Endpoint `tests/test_analyst_router.py`: auth required, happy, unknown→empty.
- Frontend `AnalystPanel.test.jsx`: renders consensus + PT + actions from mock;
  empty state; upside color sign. Plus a Fundamentals-widget test that the
  Analyst tab selects + renders.

## Files
| Path | Change |
|------|--------|
| `api/services/analyst_intel.py` | **new** service |
| `api/routers/analyst.py` | **new** `GET /api/analyst/{sym}` |
| `api/main.py` | include router |
| `app/src/components/fundamentals/AnalystPanel.{jsx,module.css}` | **new** panel |
| `app/src/hooks/useAnalystIntel.js` | **new** hook |
| `app/src/pages/charts/widgets/FundamentalsWidget.jsx` | add Analyst view |
| `app/src/components/tiles/EarningsModal.jsx` | swap inline block → AnalystPanel |
| `app/src/components/TickerPopup.jsx` | add Analyst tab |
| `tests/...` + `*.test.jsx` | coverage |

## Env / config
Reuses `FMP_API_KEY`, `FINNHUB_API_KEY`. Optional gate
`ANALYST_INTEL_FMP=1` (default on once endpoints verified) mirroring
`FUNDAMENTALS_FMP_ANALYST_ESTIMATES`.

## Open implementation-time questions (non-blocking)
- Confirm exact FMP Ultimate grade/PT endpoint paths + field names via the debug
  probe before locking the source chain.
- Whether to also write recent_actions into the catalyst signal now or defer
  (analyst_actions already covers discovery) — default: defer, keep current feed.

# Fundamental Snapshot — MarketSmith-style "data box" card

**Date:** 2026-06-17
**Status:** Shipped (v1)

## Goal

A clean, glanceable way for users to check a company's fundamental data quickly —
modeled on MarketSurge / MarketSmith's compact "data box" panel. The data already
existed (rich `get_fundamentals` + the research-page UCT Ratings); the gap was a
*concise, accessible surface* and consolidation into one payload.

## What it shows (full MarketSmith parity)

- **UCT Composite 0-99** hero + component rating boxes: EPS · Rel Strength · Growth ·
  Value (numeric, color-coded + meter) and SMR · Acc/Dis · Sponsorship (letter A–E).
  Reuses the existing `get_ratings` SmartSelect-clone.
- **Key-metrics grid** (the data boxes), grouped:
  - *Valuation:* Mkt Cap, Fwd P/E, Trail P/E, PEG, P/S, P/B
  - *Growth & Returns:* Sales growth, EPS growth, ROE (sign-colored), gross/op/net margin
  - *Balance & Price:* Debt/Equity, Current ratio, Free CF, Beta, Div yield, 52wk range
  - *Analyst:* mean target, rating, # analysts
- **Stock Checkup** pass/fail list (✓/✕/–) — from `get_ratings`.
- Footer: rating-method note + "Full research →" link to `/research/:sym`.

## Architecture

One reusable component, surfaced in two places (write once, show twice):

- **Backend:** `api/services/research/snapshot.py::get_snapshot(sym)` — pure composition
  over `get_fundamentals` (30min cache) + `get_ratings` (12h cache), 30min envelope
  cache, fully null-safe (returns a skeleton on any failure). Endpoint
  `GET /api/research/snapshot/{sym}` in `api/routers/research.py`.
- **Frontend:** `app/src/components/FundamentalSnapshot.{jsx,module.css}` +
  `app/src/hooks/useFundamentalSnapshot.js` (SWR, fetch-gated by `enabled`).
- **Surface 1 — TickerPopup (free, everywhere):** a `Chart | Fundamentals` mode toggle
  in the modal; Fundamentals lazy-loads the snapshot. Reachable from every ticker in
  the app.
- **Surface 2 — research Overview:** leads the Overview tab (`showResearchLink={false}`).

## Calibration (the "trustworthy ratings" goal)

v1 ships the **absolute threshold-calibrated** ratings (documented inline in
`ratings.py`), shown honestly via the footer method note. The IBD-style **true
percentile ranks** (1-99 vs the cap universe) are the calibration follow-on:

- **Phase 2 (deferred):** nightly `cap_universe` percentile job → `/data/research_ratings.db`
  storing per-metric percentile ranks; `ratings.py` reads peer-rank when present and
  falls back to absolute bands otherwise. Heavy (yfinance over ~3,685 tickers) so it
  runs on the worker pod, off the request path. This is the documented enhancement in
  the research-page memory.

## Tests

- Backend: `tests/test_research_snapshot.py` (4) — composition, null-safe on source
  failure, ignores fundamentals error-dict, empty-sym.
- Frontend: existing research suite (12) stays green with the snapshot in Overview.
- Live verify: `get_snapshot('AAPL')` returns accurate data (Composite 75, mkt cap
  $4.35T, fwd P/E 30.84, ROE 141.5%, 52wk 195–317, target $312.72 buy).

## Follow-ons

- Phase 2 percentile calibration (above).
- Optional: next-earnings date in the card header (kept out of v1 to keep it fast).
- Mobile TickerHub sheet could surface the same component on touch.

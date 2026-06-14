# Spread Crisp Logos — Focused Bundle — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Surfaces:** MoversSidebar, Dashboard Leadership tile (UCT 20), Stock Catalysts table.
**Follows:** the calendar logo+restyle work shipped earlier today (`CompanyLogo` now serves crisp 256px logos with a `?v=N` cache-bust and a monogram fallback).

## Problem

The crisp `CompanyLogo` is used on the calendar, EarningsModal, and Model Book,
but the highest-traffic ticker lists elsewhere show **no logo** — they render a
bare ticker via `TickerPopup`. Adding the same logo treatment makes those surfaces
scannable and visually consistent with the calendar.

## Goal

Add the existing `CompanyLogo` to each ticker row on three surfaces, matching the
calendar's look. Additive only — no layout/data/logic changes.

## Non-goals

- No restyle of these surfaces' layouts beyond the small alignment needed to seat a
  logo.
- No backend changes. `CompanyLogo` already handles fetch/cache/fallback.
- Partner-owned OptionsFlow is **out of scope**.

## Decisions (locked with user)

- Scope = the "focused bundle": MoversSidebar + Leadership tile + Stock Catalysts.
- Add crisp `CompanyLogo` per row (monogram fallback for unknown tickers).
- Logo sizes tuned per surface density: MoversSidebar **18px**, Leadership **20px**,
  Catalyst **20px**.

## 1. MoversSidebar (`MoversSidebar.jsx` + `.module.css`)

- In `MoverSection` and `TapeSection`, add `<CompanyLogo sym={...} size={18} />` as
  the first child of each `.row`, before the `TickerPopup`-wrapped ticker. (Use
  `item.sym` in MoverSection, `row.ticker` in TapeSection.)
- CSS: `.row` is already a flex row; ensure `align-items: center` and an adequate
  `gap`; the logo is `flex: none`. The ticker `.sym` keeps its current style.
- The logo sits OUTSIDE the `TickerPopup` trigger (decorative; clicking the ticker
  still opens the popup).

## 2. LeadershipTile / UCT 20 (`LeadershipTile.jsx` + `.module.css`)

- In the `.top` row, add `<CompanyLogo sym={sym} size={20} />` between the `#rank`
  span and the `TickerPopup`. (The rank lives outside `.body`; the logo goes at the
  start of `.top`, immediately before the ticker.)
- CSS: `.top` is already a flex row; add a small `gap`/`align-items: center` if not
  present so the logo aligns with the ticker + price chips.

## 3. Stock Catalysts (`CatalystTable.jsx` + `.module.css`)

- In the `colSym` `<td>`, add `<CompanyLogo sym={r.ticker} size={20} />` before the
  `TickerPopup`. Wrap the cell's contents in a flex container so
  `[logo] [★?] TICKER` align on one line.
- CSS: add a flex wrapper rule (e.g. `.colSym` becomes/contains
  `display: flex; align-items: center; gap: 7px`), preserving the existing
  `.ticker` / `.star` styles.

## Components / files touched

- `app/src/components/MoversSidebar.jsx` + `MoversSidebar.module.css`
- `app/src/components/tiles/LeadershipTile.jsx` + `LeadershipTile.module.css`
- `app/src/components/tiles/CatalystTable.jsx` + `CatalystTable.module.css`

## Performance note

Each surface renders many tickers, so each row mounts a `CompanyLogo` →
`/api/ticker-logo/{sym}`. These are served from disk cache with a long-immutable
header and are pre-warmed across the cap universe, so this adds no meaningful load
(same pattern the calendar already uses at higher row counts).

## Testing

- Add a light test per surface asserting a logo renders for each ticker row, with
  `CompanyLogo` mocked (mirrors the calendar tests' `vi.mock('.../CompanyLogo')`
  pattern). Where a surface has no test harness yet, a minimal new test file:
  - MoversSidebar: render with `data={{ ripping:[{sym:'NVDA',pct:'+4%'}], drilling:[] }}`,
    assert a mocked logo with `NVDA` renders.
  - LeadershipTile / CatalystTable: if mounting is heavy (many hooks/SWR), prefer a
    build-green + existing-tests-green check over a brittle new harness; add a focused
    test only if it mounts cleanly with mocked hooks.
- `cd app && npm run build` passes; existing suites stay green.

## Verification

On the dashboard: MoversSidebar rows, UCT 20 rows, and Stock Catalysts rows each
show a crisp company logo (monogram for unknowns), aligned with the ticker, with no
layout breakage.

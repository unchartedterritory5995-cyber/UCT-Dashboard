# Uniform Breadth Grouping System

**Date:** 2026-06-02
**Status:** Approved → implementing
**Follows:** `2026-06-02-breadth-industry-groups-design.md` (drill-modal grouping + industry_map)

## Goal

Make "group movers by industry" a **uniform, reusable** capability across every
breadth stock-list surface, add a **Sector ⇄ Industry** dimension toggle, and
surface a **top-groups summary** so members see *which groups are hot* at a glance.

## Surfaces

Two live surfaces list breadth stocks:
1. **DrillModal** (Breadth Monitor table + Heatmap + all 8 Views drill here) — already grouped.
2. **CustomScan** (breadth-universe scanner, rendered in the Screener page) — flat, sortable; has
   a `sector` filter but no grouping and no industry.

`NHNLModal` is dead code (no importer) — out of scope.

## A. Shared grouping toolkit — `app/src/pages/breadth/grouping/`

- **`groupItems(items, labelByTicker, { tickerOf, pctOf })`** — generalized pure grouper
  (drill uses `pct`, CustomScan uses `pct_1d`). Returns `{ groups:[{key,count,avgPct,items}], order }`
  sorted by count desc, `Unclassified` last. `groupByIndustry.js` keeps its `groupItemsByIndustry`
  wrapper for back-compat (existing tests unchanged).
- **`useGroupMeta(tickers)`** — POSTs `/api/breadth/industries`, returns `{ industries:{T:ind},
  sectors:{T:sec} }` with one delayed retry to fill cold-cache backfills.
- **`useBreadthGrouping(items, { tickerOf, pctOf })`** — owns `viewMode` (List|Grouped,
  localStorage `breadth.group.viewMode`), `dimension` (industry|sector, localStorage
  `breadth.group.dimension`), `collapsedGroups`; calls `useGroupMeta`; returns `grouped`,
  `visibleOrder` (items minus collapsed rows — drives nav), `summary` (top groups), toggles.
- **`GroupControls`** — the `[List|Grouped]` + `[Sector|Industry]` segmented toggles.
- **`GroupSummaryStrip`** — one-line leaderboard: `Strength: Semiconductors 14 · Biotech 11 · …`
  (top 6 groups by count). Shown above any grouped list.

Both surfaces consume the hook + render their own rows (different column sets) but share the
controls, summary, grouping logic, and meta fetch — so they stay uniform by construction.

## B. CustomScan grouping

Add `GroupControls` to the control bar. When grouped, interleave industry/sector header rows
(`colSpan` full width) into the results `<tbody>`, sorted by count; keyboard nav + chart panel
follow the grouped visible order. Industry sourced from `useGroupMeta` (sector already on rows,
but use the map for both dims so it matches the drill modal exactly).

## C. Sector ⇄ Industry toggle

`industry_map` already stores both. Add `get_groups(tickers) -> {T:{sector,industry}}` and extend
`POST /api/breadth/industries` to return `{industries, sectors}` (keep `industries` key for
back-compat). The dimension toggle flips `labelByTicker` between the two maps. Industry = granular
clusters (149); Sector = clean macro read (11).

## D. Top-groups summary strip

`GroupSummaryStrip` renders above the grouped list on both surfaces — the leaderboard deferred in v1.

## Testing

- Backend: `get_groups` shape + endpoint returns `sectors` alongside `industries`.
- Frontend: generalized `groupItems` (custom `pctOf`/`tickerOf`); existing `groupByIndustry` test
  stays green; `GroupSummaryStrip` renders top-N; `useBreadthGrouping` dimension switch.

## Out of scope (Phase 2)

Dedicated standalone "Groups" breadth view (side-by-side +4% vs −4% sector bars) — revisit after
this lands and CustomScan grouping is in real use.

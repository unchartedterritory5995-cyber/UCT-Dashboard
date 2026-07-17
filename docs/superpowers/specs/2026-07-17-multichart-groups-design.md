# Multi-Chart "Groups" Mode — Design Spec

**Date:** 2026-07-17
**Status:** design (post adversarial review) — awaiting owner sign-off before writing the implementation plan
**Feature area:** `/charts` multi-chart grid (grid mode shipped v1.4)
**Related:** `2026-07-16-multichart-grid-design.md` (the grid this builds on)

## 1. Goal & framing

Add a **Groups** mode to the multi-chart grid: a trader picks a theme/group and the
grid fills with that group's most-active names, or types a ticker and the grid fills
with its peers. Purpose: **fast situational awareness and efficient scanning while
flipping between groups, during market hours and after-hours.**

**Framing correction (from review):** this is an **intraday/AH situational-awareness
scanner**, not a swing-leadership board. Every default is tuned for "what's moving in
this group *right now*," not "what's been strongest for months." The data to do this
already lives in `/api/theme-performance` (live 1D %, tier, sub-theme, group returns).

Two modes, one shared engine ("fill the grid from a group"):
1. **Group → grid**: pick a theme → grid repopulates with its top-N most-active names.
2. **Ticker → peers**: commit a ticker in a cell → the other cells fill with its peers
   (seed stays in its cell).

## 2. Final product decisions (post-review)

Supersedes the earlier Q&A where noted.

1. **Distinct Groups MODE**, toggled from the "Multi Charts" flyout. The normal
   free-form manual grid is separate and untouched.
2. **Source = `themes_taxonomy.json`** (99 themes, 1,928 holding-rows, 1,316 unique
   tickers) via `theme_db` (SQLite, always warm). A parallel **curation track** enriches
   it and fixes coverage gaps (see §6, §12).
3. **Pick a group → repopulate the CURRENT grid size** (3×3 → top 9). No auto-resize.
4. **Ranking (REVISED): default = today's % move, RVOL tiebreak.** RS is offered as an
   optional "swing strength" sort, not the default. Fallback chain when a name lacks
   today's-move data: RS → 1-month return → **taxonomy curated tier order** (always
   available from SQLite, so a cold-cache group still fills sensibly). No-data names
   sort **last, never dropped**.
5. **Peers (REVISED):** resolve the seed to its **primary theme = smallest theme in
   which the seed is `core` tier** (tier-first, size as tiebreak), **excluding
   factor/style buckets** (Meme & Retail, Small Cap Growth, Dividend Aristocrats, broad
   sector buckets). Use **ONE resolver** shared with `/api/ticker-meta`'s primary-theme
   so the displayed theme and filled peers always agree. Rank peers by **similarity**
   (same `sub_theme_id` boosted to top, then adjacent tier, then market-cap proximity,
   tiebreak today's move) — *not* by leader strength. Sub-cluster is a **sort boost
   within the theme fill**, never a separate stage (67% of holdings have no sub-theme).
   Seed ticker stays in its cell; peers fill the rest.
6. **Peer no-coverage** (ticker absent from taxonomy, e.g. SNDK): **grounded-Haiku AI
   fallback** (§5.4), validated hard; else keep the ticker solo with a note.
7. **Freeze at selection + manual Refresh.** Once filled, charts don't spontaneously
   re-rank. Only an explicit action re-fills: pick a new group, commit a new seed, or
   Refresh (re-pulls the current group's current order). **Live price/% badges stay
   live** — only the *ticker set and ordering* are frozen.
8. **Charts sync crosshair + time-range** by default in Groups mode. Crosshair sync
   reuses the existing ref-bus. Time-range sync requires a new echo-guard in StockChart
   (§7) — the hooks already exist; the guard does not.
9. **Grid remembers its current group** (Refresh + restore-on-reload) AND **saveable
   named Group boards** (stored in the existing `/api/charts/layouts` DB store).
10. **Peer-fill trigger = auto on a COMMITTED ticker** (Enter / search-selection, not
    per-keystroke), guarded by an async request-latch, with a one-click **Undo** toast
    restoring the prior board. Kept fast per owner; made non-destructive by Undo + the
    fact that Groups mode is a derived scanning surface and manual boards are saved.
11. **Fast switching:** type-ahead filter; picker list sorted by today's hot themes
    (`/api/theme-rotation`); recents/favorites; ‹ › next/prev-group arrows (with a small
    settle delay to avoid SSE-pool churn).
12. **Heat layer (v1):** group-heat header (green count · group % · leader), per-cell
    badges (today % + tier; RVOL if cheaply available), rationale-on-hover, and a pinned
    group ETF when the theme has a chartable one (else index/none).

## 3. Architecture overview

**Thin backend + thin frontend.** A new `/api/groups` router owns identity, ranking,
and peer resolution and hands the client a clean ordered, **chartable** ticker list.
The client fills cells and renders heat.

- Identity/holdings ← `theme_db` (SQLite, always warm).
- Ranking overlay ← `/api/theme-performance` (live 1D %, returns, tier) + optionally
  `rs_ranking`. Rotation order ← `/api/theme-rotation`.
- Peers ← taxonomy (theme + sub_theme + tier + market cap), AI fallback last.
- **Never source the theme list from `/api/theme-performance`** (cold-empty at boot).

## 4. Ranking (group → top-N)

`GET /api/groups/{id}/top?n=&by=today|rs`

- Server computes the full ranked list **once** from one theme-perf blob + one RS list —
  **never** a per-ticker `/api/rs-rankings/{ticker}` fan-out (that's an N+1 over ~500
  items per holding).
- `by=today` (default): sort by live 1D % (from theme-perf `_apply_live_returns`), RVOL
  tiebreak if available.
- `by=rs`: RS percentile (optional swing view).
- **Fallback chain** for names missing the primary metric: today's % → RS → 1M return →
  curated tier order (core→relevant→peripheral, taxonomy listed order). No-data names
  last. This guarantees a **cold-cache group still fills** (post-deploy, pre-open both
  RS and theme-perf can be cold).
- Return only **chartable** names (§6), top-N after the chartable filter, plus a
  `total` count so the UI can show "9 of 32."
- After-hours: when the session is closed, `by=today` uses extended-hours % where
  available; otherwise the response is stamped `ranked_as_of` so the UI can badge
  "ranked by prior close" rather than mislead.

## 5. Peers (ticker → peers)

`GET /api/groups/peers?sym=&n=`

### 5.1 Seed resolution (shared resolver)
`resolve_primary_theme(sym)`: among the seed's themes, pick the **smallest theme where
the seed is `core`**; fall to `relevant`/`peripheral` only if no core home exists;
**exclude factor/style/broad-sector buckets** from candidacy. Ties → deterministic
(prefer higher sector relevance, then theme_id). This same function backs
`/api/ticker-meta`'s primary theme so UI and fill never disagree. Fixes the "tightest =
fewest holdings" traps (NVDA→Video Games, GE→Hydrogen-peripheral, V/MA→Bitcoin).

### 5.2 Peer ranking (similarity, not strength)
Within the resolved theme, rank candidates by: same `sub_theme_id` as seed (boost) →
tier adjacency to seed → market-cap proximity to seed → today's-move tiebreak. Sub-theme
is a boost, not a gate (most holdings have none). Seed is excluded from the peer list and
kept in its own cell.

### 5.3 Fill contract
Fill the remaining cells with top peers. If fewer chartable peers than open cells,
leave labeled-empty cells (or pin the group ETF if configured) — never error.

### 5.4 AI fallback (seed not in taxonomy)
Only when `resolve_primary_theme` finds no theme. Grounded Haiku:
1. `GET /api/ticker-meta/{sym}` → name + sector + industry. **If name is null, refuse
   the AI path** (nothing to ground on) → keep seed solo with note.
2. Claude Haiku 4.5 (`claude-haiku-4-5`), structured output, prompt = the seed's
   *company identity* (name/sector/industry) + "return N US-listed peer tickers."
3. **Validate every returned ticker:** must be in `cap_universe` (normalized) **AND**
   share the seed's sector/industry from ticker-meta; **dedup the seed**; require exactly
   N post-filter (top up from nothing / leave solo if short).
4. **Off the request path:** bounded concurrency, cache on `(SEED_UPPER, n, version)`,
   never block the grid fill — return seed-solo immediately, fill peers when resolved.
   Perplexity is explicitly **out of v1** (YAGNI); revisit only if the null-ticker-meta
   gap proves real.

## 6. Data integrity

- **Chartability filter (BLOCKER fix):** 183/1,316 holdings (13.9%) are not in
  `cap_universe` (delisted SQ→XYZ, wrong ticker HEICO vs HEI, or cap gaps like MMC/CYBR).
  Precompute a `chartable` flag per holding at seed time: `chartable = normalize_sym(sym)
  ∈ cap_universe`. **Never place a non-chartable sym in a cell.** Emit the non-chartable
  set as a **curation worklist**.
- **Symbol normalization:** taxonomy uses dot class-shares (`BRK.B`); cap_universe /
  ticker-search use hyphen (`BRK-B`); Massive maps hyphen→dot at its REST boundary. One
  `normalize_sym()` (dot→hyphen, uppercase) used for validation, search, and cell fill.
- **ETFs bypass cap_universe validation** — 52/63 group ETFs aren't in cap_universe but
  are chartable via Massive on demand. Pin-the-ETF checks "is it an ETF ticker," not
  cap_universe membership. 36/99 themes have no ETF → pin an index or nothing.
- **Under/over-fill contract:** theme sizes min 8 / median 21 / max 36; after the
  chartable filter, 9 themes have <9 chartable holdings (3D Printing = 5). Under-fill →
  labeled-empty cells (or ETF pin); over-fill → top-N with a visible "N of total". A 4×4
  can't be filled by the 28 themes with <16 holdings — that's expected, shown honestly.

## 7. Frontend

### 7.1 State & persistence
- Extend grid state to `{mode, layout, cells, syncCrosshair, syncTimeRange, group?}`
  where `group = {id, by, n, ts}` (the current group identity; ticker set lives in
  `cells`).
- **Extend `sanitizeState`'s allowlist** to carry `group` + `syncTimeRange` (today it
  strips unknown keys → the feature silently wouldn't persist across reload). Thread
  through `parseRaw` and `applyGridTemplate`.
- **Saved named Group boards** live in the existing `/api/charts/layouts` DB store
  (reuse the multichart save path; embed `group` + `mode` in the `layout` blob). Keep
  only the *current* group in the `multichart_state` pref.

### 7.2 `fillCells(syms, {group})` — the bulk fill (BLOCKER fix)
- **One `apply(prev => …)`**, never a loop of `updateCellAt` (which races the 500ms
  debounced save via the microtask reading a stale `stateRef`).
- **Reconcile by symbol overlap:** keep a cell's `id` where its new sym equals its old
  sym (or a sym still present) so overlapping charts **don't remount**; mint a new id
  only for genuinely new syms.
- **Mount-queue admission for symbol changes (fetch-herd fix):** the queue is keyed on
  cell `id` today, so a same-id sym swap slips past it → 9–16 simultaneous cold
  `/api/bars` fetches (the 2026-05-24 incident class). **Preferred fix: re-key the queue
  on `(id, sym)`** so a sym swap re-enters the throttle exactly like a fresh mount, with
  StockChart's `onBarsReady → release` closing the slot (limit 3). Overlapping (unchanged)
  cells keep their `(id, sym)` key → no-op, no refetch. (Alternative if re-keying proves
  invasive: a separate refetch-admission `fillCells` routes changed cells through — same
  effect, more surface.)
- Guard `?gridspike` harness gets a "swap the board once settled" mode so group-switch
  perf is actually measured (today it only exercises initial mount).

### 7.3 Auto-fill-on-type (committed + latched + undoable)
- In Groups mode, a **committed** ticker (Enter / search-selection, not per-keystroke)
  in any cell = new seed → `GET /api/groups/peers` → `fillCells`.
- **Async request-latch:** a monotonic request id discards stale peer responses (type
  AAPL then MSFT fast → only MSFT's peers land).
- **Undo toast:** "filled peers of AAPL · Undo" restores the prior `{group, cells}`
  snapshot. Mid-type never fires; the rAF refocus in `handleSymbolChange` must target the
  seed cell after reorder.

### 7.4 Heat layer
- **Group-heat header:** green count / group % / leader, from `group_return` + a green
  tally (cheap).
- **Per-cell badges:** today % + tier (core/relevant) from theme-perf enrichment; RVOL
  only if a cheap source exists (don't block on it).
- **Rationale-on-hover:** taxonomy `rationale` string in a tooltip.
- **Pinned group ETF:** cell 0 = theme `etf_ticker` when chartable; else index/none.
- Badges/header are **live**, not frozen at selection.

### 7.5 Picker & fast-switch
- Group picker in the Multi Charts flyout; list from `theme_db.get_all_themes()` via
  `/api/groups`, sorted by `/api/theme-rotation`. Type-ahead filter, recents/favorites,
  ‹ › next/prev arrows (settle-delayed to avoid SSE-pool reconnect thrash).

## 8. Backend endpoints

- `GET /api/groups` — theme list (id, name, sector, holding count, sub_themes,
  etf_ticker, chartable count) from `theme_db`, rotation-sorted. Cheap, always warm.
- `GET /api/groups/{id}/top?n=&by=today|rs` — server-ranked, chartable-filtered top-N
  (+`total`, `ranked_as_of`). One ranked list, no per-ticker fan-out.
- `GET /api/groups/peers?sym=&n=` — resolve → similarity-ranked peers (+ AI fallback,
  offloaded). Returns `{seed, peers[], source: taxonomy|ai|none}`.
- Router registered as one `include_router` unit in `api/main.py` (import + include
  together).

## 9. Sync (crosshair + time-range)

- **Crosshair:** reuse the existing ref-bus. No change.
- **Time-range (new bus + StockChart guard):** the `onTimeRangeChange` /
  `externalTimeRange` / `setVisibleRange` hooks already exist in StockChart, but the
  range applier has **no echo guard** (unlike the crosshair path). A naive bidirectional
  bus loops unbounded across ≤16 charts. **Add to StockChart:** an
  `applyingExternalRangeRef` latch set around `setVisibleRange` (reporter bails while
  set, cleared next rAF) + an epsilon/equality gate (ignore a range within N seconds of
  the last applied) + a bus initiator token. Do **not** ship time-range sync without this
  guard in StockChart itself.

## 10. Phasing

1. **Core scan:** Groups mode toggle, picker (`/api/groups`), `/api/groups/{id}/top`
   (today's-move ranking + cold-cache tier fallback), `fillCells` + mount-queue admission,
   chartability filter + normalization, group memory + sanitizer + Refresh, group-heat
   header + per-cell badges.
2. **Peers:** shared resolver + `/api/groups/peers` (taxonomy, similarity), committed
   auto-fill + latch + Undo, rationale-on-hover, ETF pin.
3. **AI fallback:** grounded Haiku, offloaded + validated + cached.
4. **Sync + boards:** time-range sync (with StockChart guard), saved named Group boards,
   fast-switch polish (rotation sort, recents/favorites, arrows).

## 11. Edge cases

| Case | Behavior |
|---|---|
| Theme < grid cells | Fill chartable holdings; remaining cells labeled-empty (or ETF pin) |
| Theme > grid cells | Top-N; header shows "N of total" |
| Cold RS + cold theme-perf | Fall to curated tier order; never blank/random |
| Seed in many themes | Smallest theme where seed is `core`; ties deterministic; factor buckets excluded |
| Seed sub-theme size 1–2 | Sub-theme is a boost; widen to theme fills the rest |
| Seed not in taxonomy | Grounded-Haiku peers (validated) or seed-solo + note |
| Non-chartable holding | Excluded from fill; added to curation worklist |
| Class-share `BRK.B` | Normalized to `BRK-B` for validation/search/fill |
| ETF pin, no theme ETF | Pin index or nothing |
| Fast group→group→group | Debounced save (last wins); arrows settle-delayed |
| Owner in two tabs | `multichart_state` last-write-wins (pre-existing); accept |
| After-hours | Extended-hours % where available; else badge "ranked by prior close" |

## 12. Curation track (parallel, owner-driven)

The taxonomy is v4.2.0 (generated 2026-04-14, ~3 months stale) — the source of the
183 non-chartable holdings and drifted tickers (SQ→XYZ, HEICO→HEI, FI/FISV). The
chartability filter **emits the non-chartable set as a worklist**. Curation cadence and
ownership are out of scope for this feature but the worklist is the concrete trigger.

## 13. Testing

- Unit: `resolve_primary_theme` (NVDA→Semis/AI-core not Video Games; GE→Aerospace not
  Hydrogen; V/MA ties), ranking fallback chain (cold-cache → tier order), `normalize_sym`
  (BRK.B↔BRK-B), chartable filter (183-name exclusion), AI-validation (seed dedup,
  sector match, null-meta refusal).
- Frontend: `fillCells` single-apply + id-reuse (no remount for overlap), mount-queue
  admission on sym-swap (herd prevention — StrictMode double-mount repro), sanitizer
  carries `group` across reload, auto-fill latch (stale response discarded) + Undo.
- Sync: time-range echo guard (A→B→C converges, no storm), verified in a visible tab
  (Chrome MCP background-throttles rAF — use the local dev server).
- Perf: `?gridspike` board-swap mode confirms group-switch stays inside the grid latency
  bar (cached <500ms, cold 1–2s).

## 14. Non-goals (YAGNI)

Correlation-based peers (no engine exists; taxonomy proxy is enough); Perplexity
fallback; per-cell drawing tools; drag-to-rearrange in Groups mode; live re-ranking (the
freeze is deliberate); curating the taxonomy itself (separate track).

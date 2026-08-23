# Smart Adaptive Widget Placement — /charts Workspace

**Status:** Plan (2026-08-23) · Owner: Blake
**Goal:** When a widget is added to (or removed from) the `/charts` workspace, it
positions and sizes itself in the most sensible slot given the widgets already
present — filling under-used space, grouping like-with-like, and only resizing
existing widgets when there is no good empty space.

---

## Problem

Current placement is `app/src/pages/charts/findOpenSlot.js::findPlacement`, called
from `ChartsWorkspace.jsx` (`handleAddWidget` ~L1187, `handleDockPeriodSort` ~L1268,
paste path ~L1633). It is a **row-major first-fit at the widget's default size,
shrinking toward `minW/minH`**, and when nothing fits it calls `reserveBottomStrip`
→ a **full-width bottom strip**.

Two concepts are missing, and their absence causes both bad cases the owner
screenshotted:

- **No region awareness.** Adding a Breadth panel (`{w:8,h:10,minW:4}`,
  `registry.js`) to a `[chart(~9 cols) + theme(~3 cols, top-right)]` layout can't
  fit 8 wide anywhere; even shrunk to `minW:4` it won't fit the **3-col** bottom-
  right gap → full-width bottom strip. Ideal: become **3 wide** and drop into the
  right-column gap under the theme tracker.
- **No type affinity.** Adding a second Chart (`{w:12,h:12,minW:6}`) → full-width
  bottom strip. Ideal: recognize it's a *chart*, it belongs in the *left chart
  region*, that region is full → **split it 50/50** (existing chart → h:10, new
  chart → h:10 below).

## Owner decisions (locked)

| Decision | Choice |
|---|---|
| Placement model | **Hybrid** — affinity regions first, best-fit rectangle fallback |
| Resize existing widgets | **Prefer empty space; resize only as fallback** |
| Type awareness | **Strong affinity** — family grouping + width prefs |
| Behavior | **Suggest-then-confirm** — ghost preview before commit |
| Chart-region split ratio | **Even 50/50** (halve the region's dominant widget) |
| Rail width for a new panel | **Match the existing rail's width** (clamp to gap) |
| Close reflow | **Core** — add + close are symmetric; surviving widget reclaims freed space |

## Grid facts (do not regress)

`react-grid-layout`, `cols=12`, `FIXED_ROWS=20`, `compactType:'vertical'`,
dynamic `rowHeight` via `ResizeObserver` on `.workspaceBody`, `overflow:hidden`
(no outer scroll). Placement math must stay inside these.

---

## Design

### Piece 1 — Widget metadata (`app/src/widgets/registry.js`)

Add a `placement` block per entry:

```js
// chart
placement: { family: 'chart', fill: 'wide',   idealAspect: 'landscape' },
// themes / breadth / scanner / watchlist / fundamentals / periodsort
placement: { family: 'panel', fill: 'narrow' },
```

- `family` drives grouping (chart↔chart, panel↔panel).
- `fill:'narrow'` lets a panel adopt a rail **below its `minW`** — the `railW` it
  takes is the *matched neighbor's* width, not a declared constant (owner decision).
  `minW` still governs manual drag-resize; only auto-placement may go under it.
- Rail test pins `registry.test.js`: every workspace-menu widget declares
  `placement.family`.

### Piece 2 — Region inference (`app/src/pages/charts/placement/regions.js`, pure)

`inferRegions(widgets, cols, rows) -> Region[]`

- Cluster widgets by shared vertical edges into **regions** (column bands), e.g.
  left `x:0..9`, right rail `x:9..12`.
- Per region: `{ x, w, members[], dominantFamily, gaps[] }` where `gaps` are the
  empty vertical rectangles inside the region's x-span.
- Single authority used by **both** add and close paths (owner decision: symmetric).
- Fully unit-testable; the two screenshots become fixtures.

### Piece 3 — Placement engine (`app/src/pages/charts/placement/place.js`)

`planPlacement(widgets, type, cols, rows) -> { place:{x,y,w,h}, mutations:[{id,...}] }`

Ordered strategy:

1. **Affinity region** — region whose `dominantFamily === newWidget.family`.
2. **Fill empty in affinity region** — if a gap ≥ min fits, place at the region's
   width (rail width for panels, region width for charts). *(img 3)*
3. **Fill empty anywhere** — no affinity match but a good empty rectangle exists →
   best-fit there (free-form half of Hybrid).
4. **Resize existing (fallback)** — no empty space → **50/50 split** the affinity
   region's dominant widget; emit its shrink in `mutations`. Reuse existing
   `splitToFit` / `splitToSide`. *(img 6)*
5. **Last resort** — today's full-width bottom strip.

Return shape is compatible with current call sites; `mutations` is applied only in
step 4.

### Piece 4 — Suggest-then-confirm ghost (`app/src/pages/charts/placement/GhostPreview.jsx`)

`handleAddWidget` (`ChartsWorkspace.jsx:1164`) currently commits immediately. Change:

1. Compute `planPlacement` (incl. mutations).
2. Render a translucent ghost at the proposed slot + a dimmed outline on any widget
   that would shrink; **Place / Cancel** (Enter / Esc).
3. Confirm → commit exactly as today (apply `place` + `mutations`). Cancel → no-op.

Positioned with the grid's existing rowHeight / `ResizeObserver` math. Add pref
`uct.charts.smartPlace.confirm` (default on) so power users can flip to instant.

### Piece 5 — Close reflow (Phase 3)

On widget close, run the region engine in reverse: the surviving member of that
region **reclaims the freed gap** (rail panel grows tall; a split chart's sibling
grows back to full region height). Same `regions.js` authority; emitted as
`mutations` on the close handler.

---

## Phasing (each independently shippable)

- **Phase 0** — Piece 1 metadata + Piece 2 regions + Piece 3 engine, all with unit
  tests. Fixtures reproduce the two screenshots:
  `[chart+theme] + breadth → img 3` and `[chart+theme+breadth] + chart → img 6`.
- **Phase 1** — swap `findPlacement` → `planPlacement` behind **instant-place** (no
  ghost). Ship; verify both scenarios live on `/charts`.
- **Phase 2** — Piece 4 ghost preview + confirm + pref toggle.
- **Phase 3** — Piece 5 close reflow (add + close symmetric).

## Risks / notes

- Placement engine must stay a **pure function** (no DOM) so it is testable and the
  ghost + commit share one source of truth.
- Auto-placement going under `minW` is deliberate and scoped to the rail-match case;
  drag-resize still enforces `minW` (keep the two paths distinct).
- Layout persist stays debounced 500ms; ghost preview must not write to the pref
  until commit.
- Multi-chart **grid mode** (`grid/`) is a separate system — out of scope.

# Phase 1 — Registry, context, cursor · implementation plan

Spec of record: `00-master-spec-v1.3.md`. No code written yet. This plan is the Phase 1 gate.

**Phase 1 delivers the data layer and nothing visible.** The gesture engine, the glass, the Actions
button and every section controller are Phase 2 and 3. At the end of Phase 1 the hub renders a knob
that navigates; `run` and `confirm` actions call a placeholder toast.

---

## 1. Files

### New — `app/src/hub/`

| Path | Contents |
|---|---|
| `app/src/hub/registry.ts` | `HubAction` / `HubMode` types, `defineMode()`, `validateRegistry()`, and the ten seeded modes. **Director-only file.** |
| `app/src/hub/HubContext.tsx` | `HubProvider` + `useHub()`. Carries `mode`, `setMode`, and shared `symbol` / `timeframe` / `activeScan` / `selectedPosition`. Derives mode from route by default. |
| `app/src/hub/useHubCursor.ts` | The one cursor (§2d). `(listId, items, opts) → { item, index, count, next, prev, scrubTo }`. |
| `app/src/hub/useHubSettings.ts` | Thin wrapper over `usePreferences()` — reads/writes the `joystick_hub` blob via `setPrefMerged`. Not a new store. |
| `app/src/hub/useHubMode.ts` | Per-page registration; unregisters on unmount. |
| `app/src/hub/hubRoutes.ts` | Route ↔ mode-id table. The single authority for "is this pathname a section" (used by `lastSection`, §4 home). |
| `app/src/hub/registry.test.ts` | Registry invariants (§5). |
| `app/src/hub/useHubCursor.test.ts` | Cursor behaviour (§5). |

### Modified — the five named exceptions only

| Path | Change |
|---|---|
| `app/src/components/Layout.jsx` | Mount `<HubProvider>` + `<JoystickHub/>` as a sibling of `FeedbackWidget` (`:132-138`), inside `.shell`. **⚠️ Correction: this is the *app* shell, not the mobile chart shell** — `MobileChartsApp` is one route's inner shell and mounting there would give the hub nine routes instead of every route. |
| `app/src/styles/tokens.css` | Append the `--hub-*` block below the existing `--glass-*` block, plus OLED and `[data-hub-contrast="high"]` overrides, plus the global `[data-hub-cursor="active"]` rule. |
| `app/src/components/ui/UIcon.jsx` | Append `moveStop` and `earnings` to `ICONS` (§2f). |
| `app/src/pages/screener/shell/VirtualResults.jsx` · `ResultCards.jsx` | `forwardRef` + one `useImperativeHandle` exposing `scrollToIndex`. Both are virtualized. |
| `app/src/components/StockChart.module.css` | `.goLivePill` `right: 86px → 118px`, with the reason in the comment. |

### New — backend, `hub_planned_trades`

⚠️ **There is no Alembic in this repository.** No `alembic/`, no `alembic.ini`, no dependency. The house
idiom is idempotent DDL in `db.py`: `CREATE TABLE IF NOT EXISTS`, applied by `ensure_schema(conn)`
(`api/services/journal_two/db.py:1724`), with additive columns appended to the `ALTER TABLE …
ADD COLUMN` list at `db.py:1440-1462`. The plan follows that, not Alembic.

| Path | Change |
|---|---|
| `api/services/journal_two/db.py` | `CREATE TABLE IF NOT EXISTS hub_planned_trades (…)` beside the other `j2_*` tables, reached by the existing `ensure_schema()`. |
| `api/services/hub/planned_trades.py` *(new)* | `create_planned / list_planned / discard_planned`, `get_connection()`, user-scoped exactly as `journal_two/positions.py` scopes by `user_id`. |
| `api/routers/hub.py` *(new)* | `POST /api/hub/planned-trades` · `GET /api/hub/planned-trades` · `POST /api/hub/planned-trades/{id}/discard`. `Depends(get_current_user)` **plus an explicit `isPaid` check** — note CRUD's precedent of relying on the client route guard is the thing to avoid, not copy. |
| `api/main.py` | One `include_router` line. |

```sql
CREATE TABLE IF NOT EXISTS hub_planned_trades (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  symbol       TEXT NOT NULL,
  entry        REAL NOT NULL,
  stop         REAL NOT NULL,
  size         INTEGER NOT NULL,
  r_value      REAL,
  source_mode  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','converted','discarded')),
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hub_planned_user ON hub_planned_trades(user_id, status, created_at DESC);
```

`j2_positions` is untouched. It stays a broker mirror.

---

## 2. Types

```ts
export type HubRequirement = 'symbol' | 'position' | 'list' | 'flagged' | 'chart';

export type HubAction = {
  id: string;                 // '<mode>.<action>', unique registry-wide
  label: string;              // ≤10 chars, sentence case
  icon: string;               // must be a UICON_NAMES value — validated, not optional
  ring: 0 | 1;                // 0 = outer (hard push, ≤5) · 1 = inner (soft push, ≤4)
  color: string;              // a --hub-* token name, never a literal
  kind: 'navigate' | 'run' | 'confirm' | 'home';
  to?: string;                // route or mode id, for kind:'navigate'
  run?: (ctx: HubContext) => void | Promise<void>;
  confirmText?: (ctx: HubContext) => string;   // REQUIRED when kind === 'confirm'
  requires?: HubRequirement[]; // unmet → rendered, disabled, with a reason. Never hidden
  enabled?: (ctx: HubContext) => boolean;
  flickable?: boolean;        // default true. false = deliberate selection only
};

export type HubMode = {
  id: string;
  label: string;
  color: string;              // a --hub-mode-* token
  route?: string;             // omitted for in-place modes (catalysts)
  tapHint: string;
  cursor?: { listId: string };
  onTap?: (ctx: HubContext) => void;
  onDoubleTap?: (ctx: HubContext) => void;
  onScrub?: (ctx: HubContext, delta: number) => void;
  onScrubCommit?: (ctx: HubContext) => void;
  fan: HubAction[];
};
```

`brokerage` is gone from `requires` — nothing in the hub touches a broker, by design.

---

## 3. The ten modes and their bindings

Every binding names the state it reads. Anything marked **new** does not exist and is built in Phase 1.

| Mode | Primary / Reverse | Reads | Scrub |
|---|---|---|---|
| `wire` | next / prev segment | `section.rd-seg[data-seg]` nodes, queried as at `MorningWire.jsx:183`; key set `wire_feedback.py:17` | read progress over the same list |
| `breadth` | next / prev session | `BreadthViews.jsx:59` `rowIdx`, `:189` `onSeek`, `:202` `stepTo`; scrubber mounted `:580-583`. Switches tab first via `Breadth.jsx` `setActiveTab` (tabs `:519-527`, phone default `:560-564`) | walk the daily series |
| `scan` | next / prev result | `ScannerShell.jsx:60` `rows` — **new cursor** | fast-scroll; needs `scrollToIndex` (`VirtualResults.jsx:35-41`, `ResultCards.jsx:18-24`) |
| `chart` | next / prev timeframe | `NATIVE_TFS` (`timeframes.js:12-13`); writes `chartWidget.opts.tf` via `onOptsChange` (`MobileChartsApp.jsx:144-147`) | **V:** `setGroupSym` (`MobileChartsApp.jsx:149-158`) · **H:** `stepBar(dir)` (`StockChart.jsx:14510-14517`) through `ChartPane`'s ref (`ChartPane.jsx:616-636`) |
| `journal` | next / prev position | `useJ2Positions.js:12-33`, merged at `OpenPositionsTab.jsx:258-261` — **new cursor** | stop: reads `activeStop()` (`calculations.js:55-56`), commits `PUT /api/j2/positions/{id}` (`journal_two.py:363-378`) |
| `catalysts` | next / prev row | `CatalystTable.jsx:576-589` `filteredRows` — **new cursor**, gated `!compact` | **none** |
| `notebook` | next / prev note | `useJ2Notes.js:60`, consumed `NotebookTab.jsx:225-239` — **new cursor** | scroll the notes list |
| `calendar` | next / prev day | `Calendar.jsx:194-199` `weekDates`; URL `?week=&d=` at `:88-102` | across the week |
| `home` | last section / Morning Wire | `lastSection` — **new** localStorage, written on route change, matched against `hubRoutes.ts`. Inert when unset | 3 summary values: `JournalSnapshotTile.jsx:429`, `MarketBreadth` exposure, `useCatalysts()` count |
| `flow` | unassigned | `OptionsFlow.jsx` exports only its default component | none |

Cursor lists registered in Phase 1: `scan · journal · catalysts · notebook · calendar · wire`.
Five register declaratively; **wire toggles `data-hub-cursor` imperatively** in a `useEffect`,
mirroring its own `data-fb-vote` injection.

---

## 4. `hub.enabled` wiring

Read in exactly one place — the mount guard in `Layout.jsx`:

```
enabled = settings.enabled ?? (user?.role === 'admin')
mounts  = enabled
          && CSS.supports('backdrop-filter', 'blur(1px)')
          && typeof window.visualViewport !== 'undefined'
          && matchMedia('(max-width: 1023px) and (pointer: coarse)').matches
```

- `settings` is the `joystick_hub` blob from `usePreferences()`; **`enabled` defaults to `false`**.
- `role === 'admin'` (`AuthContext.jsx:171-173`) is the only default-on identity — there are no tiers.
- Opening it to everyone later is one edit to the registry default, not a migration.
- The *visibility* query is CSS; this JS gate only decides whether to mount at all, so the first-paint
  staleness trap in `useMediaQuery.js` cannot produce a desktop-shaped hub on a phone.

---

## 5. Tests

**`useHubCursor.test.ts`** — next/prev advance and wrap · `prev` from index 0 · **reset when list
identity changes** · **survives fan open/close** · `scrubTo` clamps at both ends · empty list is inert,
`count === 0`, `item === undefined` · a list that shrinks under the cursor clamps rather than throwing.

**`registry.test.ts`** — for every mode: outer ring ≤5 · inner ring ≤4 · **inner ring's last action is
`kind:'home'`, with `home` the one allowed exception** · every mode carries a Voice action on the inner
ring · **every `kind:'confirm'` action has a `confirmText`** · every `kind:'navigate'` has a `to` ·
every `icon` is in `UICON_NAMES` (this is what catches the two new glyphs going missing) · every
`label` ≤10 chars · every `color` resolves to a declared `--hub-*` token · action ids unique
registry-wide · Journal's `close` is `flickable: false`.

**`hubChipCollision.test.ts`** — the back-to-live chip's hit rect and the hub's hit rect do not
intersect at **375px** and **430px** viewport widths. Computed from the CSS values, so it fails when
either `right` drifts.

⚠️ Two rails on the rails, from this repo's own history: `vitest -t` is a regex and **a filter matching
nothing exits 0 and reads as a pass**, so every one of these files asserts a non-zero case count. And
jsdom lays nothing out — the collision test computes geometry from the declared CSS values rather than
measuring a rendered box, and says so in a comment, so nobody later mistakes it for a layout test.

---

## 6. Wave size

Wave 1 per D3: **4 agents active, in one batch.**

| Role | Owns |
|---|---|
| Architecture lead (opus) | Reviews all three before anything reaches the Director; enforces the seams |
| Registry engineer (sonnet) | Types, `defineMode`, `validateRegistry`, the seed — delivered as a diff, since `registry.ts` is Director-only |
| Context engineer (sonnet) | `HubContext`, `useHubMode`, `useHubSettings`, `hubRoutes` |
| Cursor engineer (sonnet) | `useHubCursor` + the two `forwardRef` exposures + the `data-hub-cursor` rule |

The backend slice (`db.py` table, `planned_trades.py`, `routers/hub.py`) is **Phase 2a**, not Phase 1 —
nothing in Phase 1 writes, and pulling it forward would put a live write path in a wave whose gate says
"no visible behaviour".

---

## 7. The four corrections — accepted at the Phase 1 gate

1. **`tier` removed entirely.** No placeholder, reserved or otherwise. D-23 stands: if tiers ever
   return, the field comes back in that wave.
2. **No Alembic, ever.** Schema is idempotent DDL in `db.py` reached by `ensure_schema()`. Struck from
   every plan and spec file.
3. **Mount is `Layout.jsx`**, the app shell. The hub appears on every mobile route including `/charts`;
   the chart-page fan and scrim constraints are applied by **route detection inside the hub**, never by
   a second mount point.
4. **`right: 24px`.** The "+14px existing chrome" was `FloatingOrb`'s own offset and the orb no longer
   renders on touch, so there was nothing to add. Chip clearance narrows 12px → 10px; the rail asserts it.

**Backend moved to Phase 2a.** `hub_planned_trades` DDL and router ship with the plan-trade sheet.
**Phase 1 has zero write paths and no visible behaviour** beyond an empty positioned container behind
`hub.enabled`, which defaults off.

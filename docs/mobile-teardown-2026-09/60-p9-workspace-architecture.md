# P9 — the durable layout / workspace model

**Deliverable E.** Evidence lane: `lanes/uct-p9-workspace.jsonl` (`UCT-P9-*`).
Method: the local E2E sandbox driven through same-origin iframes at **390×844** (phone
branch) and **1400×900** (desktop branch) on one account, plus direct reads of
`GET /api/auth/preferences` and of `origin/master` source. Every claim below is tagged
with where it came from.

> **P9 as originally stated:** *the layout is the durable object; the symbol is a
> variable inside it.*

---

## 0. The finding that inverts the recommendation

**UCT already has a server-backed workspace record, and the phone is already a
first-class writer to it.**

I changed the timeframe to 1W, the chart type to Bars and the symbol to AAPL **on the
phone shell**. Loading `/charts` in a desktop frame on the same account brought the
board up on **AAPL**, at **1W**, in **Bars** (`UCT-P9-0001`). The server record reads:

```
charts_workspace_layout  → { widgets: [ …, {id:'uctd-chart', type:'chart',
                              opts:{ tf:'W', settings:{chartType:'bars', …} }}, … ], cols }
                             ← every widget has hasSym:false
charts_workspace_groups  → { "A":"AAPL", "B":null, "C":null, "D":null }
```

So the data model **already expresses P9** — arguably more cleanly than TradingView's.
TradingView binds a symbol to a chart pane and links panes by colour afterwards. UCT
stores four ticker slots and every widget dereferences one (`UCT-P9-0002`).

**Therefore the P9 recommendation is NOT "build a saved-workspace model."** It is:

1. **name** the object that already exists,
2. **open a door to it on the phone**, and
3. **give it a scope model**, because three separate pieces of state are currently
   stored at the wrong lifetime — and each one has already been patched individually
   rather than fixed structurally.

---

## 1. What already persists

| State | Where | Scope today | Basis |
|---|---|---|---|
| Widget set, arrangement, columns | `charts_workspace_layout` (server pref) | account, all devices | `UCT-P9-0001` |
| Per-widget timeframe (`opts.tf`) | same record | account, all devices | `UCT-P9-0001` |
| Per-widget chart settings (`opts.settings`) | same record | account, all devices | `UCT-P9-0001` |
| Colour-group symbols A/B/C/D | `charts_workspace_groups` (server pref) | account, all devices | `UCT-P9-0002` |
| Drawings — **all sheets, incl. the active one** | `tracings_doc` (server pref) ⇄ `uct-chart-drawings` + `uct-chart-tracings` (localStorage) | account, synced | `UCT-P9-0004` |
| Named layout templates | `charts_layouts` table, `GET/POST/DELETE /api/charts/layouts`; a row carries **both** `layout` and `groups`; scope `user`, or `global` (admin prebuilts) | account (or firm-wide) | `UCT-P9-0003` |
| Multi-chart grid templates | same table, `layout.kind='multichart'` | account | `UCT-P9-0003` |
| Global chart-settings seed | `chart_settings` (server pref) — **a seed only**; the authoritative copy for a mounted widget is `layout.widgets[].opts.settings` | account | source + prior project record |
| Pan / zoom / price-scale view | `uct.charts.viewLock.<chartId>` (**localStorage**) | **device** | `UCT-P9-0006` |
| Phone symbol recents | `uct.charts.mobileRecents` (localStorage) | device | measured |
| Coach-mark seen flags (e.g. `uct.drawings.tapHintSeen`) | localStorage | device | measured |
| Theme | `uct.appTheme.v1` (localStorage) | device | measured |
| Bars cache | IndexedDB + `barspack.*` buckets | device | measured |

**Drawings sync — correcting my own earlier note.** An earlier working note in this
study said drawings were localStorage-only. That was true of the *key* and false of the
*system*: `uct-chart-drawings` holds the **active sheet**, and `exportTracings()` puts
the active sheet inside the blob that `useTracingsSync` pushes to the `tracings_doc`
preference (hydrate-newer-wins, 1.5 s debounced push, flush on unmount). The hook is
called at `ChartsWorkspace.jsx:662`, **above** the `isMobile` branch at `:2051`, so it
runs on the phone too (`UCT-P9-0004`). **UCT is at parity with TradingView on
cross-device drawing persistence — not behind it.** This is the third false negative in
this study produced by reading one storage location instead of asking the system.

---

## 2. What resets

| Resets on | What is lost | Verdict |
|---|---|---|
| Page reload | **Undo/redo history** (drawings survive; the transaction log does not — both arrows render disabled) | `UCT-P9-0009`. Defensible; TradingView has no redo on mobile at all. |
| Page reload | Armed drawing tool, open sheet, crosshair readout | Correct — transient by nature. |
| Module evaluation | Nothing *resets*, but `_COARSE_POINTER` is **decided once** and never re-read | `UCT-P9-0008` — see §3. |
| New device | Pan/zoom view of every widget | `UCT-P9-0006` — the split that has no owner. |

**The one genuinely awkward reset** is undo history, because it is asymmetric: the
object survives and the ability to reverse the last change to it does not. Combined
with the separately-recorded first-use redo failure (`UCT-UNDO-0003`: Redo does not arm
on the first undo after a load, and works later in the same session), the honest
statement is *"Redo exists and works within a warm session; it does not arm on the first
undo after load, and no history survives a reload"* — never a clean win, and never
"redo is broken."

---

## 3. What persists accidentally rather than intentionally

Three items. Each has already been patched **at the surface** rather than fixed **at the
scope**, and that pattern is the P9 argument in miniature.

1. **Multi-chart grid mode crosses form factors.** Grid mode is stored in the shared
   record, so it follows a user from desktop to phone — where the entry flyout does not
   exist. The shipped remedy is an "Exit Multi Chart" button whose own in-file comment
   says a phone user would otherwise be **"TRAPPED"** (`UCT-P9-0007`,
   `ChartsWorkspace.jsx:2058-2075`). Credit where due: they found it themselves. But the
   defect is that a device-inappropriate mode had no device scope.

2. **The view lock is device-local while the widget id that keys it is server-backed**
   (`UCT-P9-0006`). One conceptual object — "my chart" — lives in two stores with two
   lifetimes. Restoring a workspace on a second device returns the arrangement, the
   timeframe, the settings and the symbol, framed on a different range. Note this is
   *defensible as a default* — a phone and a 32-inch monitor should not share a pixel
   range — which is exactly why the fix is a **per-device scope inside one record**, not
   a move of the key.

3. **`_COARSE_POINTER` is a module-load constant** over a *live* media query
   (`ChartDrawingOverlay.jsx:83-90`). Every touch affordance in the drawing layer hangs
   off it: grab radius 15 vs 8 px, handle radius 7 vs 4, auto-select-after-placement,
   the coach chip, `DrawingQuickBar`, and sheet-vs-popover. `(pointer: coarse)` flips on
   an iPad when a trackpad keyboard is attached or removed; a constant cannot hear it
   (`UCT-P9-0008`). ⚠️ The code shape is verified; **the device consequence is inferred**
   — I did not test an iPad with a Magic Keyboard. It also explains, mechanically, why
   this study's fine-pointer lane produced false negatives: a resized desktop frame can
   never become a touch surface, because the decision was made once when the bundle
   evaluated.

**A fourth, adjacent defect in the durable layer** (`UCT-P9-0005`): `useTracingsSync`
advances the local highwatermark **before** an unawaited `setPref`, and the adopt gate
is a strict `server.updatedAt > hw`. A device is therefore pinned at exactly the version
it *believes* it pushed. Live on this research browser right now: `hw == server.updatedAt`,
the server document holds two SPY drawings, the local active store reads `{}`, and the
device will never adopt them. ⚠️ **State this precisely:** the mechanism is
source-verified, the divergence is live-verified, and the **real-user trigger is
inferred** — my local copy was most likely emptied by an abruptly destroyed probe iframe,
which is not a member path. Fix the ordering regardless of how often it fires.

---

## 4. Server-backed versus local — and the boundary that is wrong

Today the boundary is **historical**, not principled: things that arrived with the
workspace are server-backed; things that arrived with a chart component are local.
`viewLock` is local because `StockChart` owns it. `mobileRecents` is local because the
phone search rail owns it. Neither placement was a scope decision.

The boundary that would survive review is **four tiers**:

| Tier | Definition | What belongs |
|---|---|---|
| **Account** | true of the user everywhere | chart-settings defaults, alert sound, units, theme preference |
| **Workspace** | the durable, nameable object | widget set + arrangement + per-widget `opts` + colour-group symbols + mode (`grid`/`board`) |
| **Symbol** | true of a ticker across every workspace | drawings/tracings, flags, tags, notes, alerts |
| **Device class** | true of a *shape of screen*, never synced as content | pan/zoom view, which widgets are rendered on a phone, coach-mark flags, caches |

Note "**device class**", not "device": three classes (phone / tablet / desktop), matching
the breakpoint tiers the app already defines (`≤640` / `641–1024` / `≥1025`). A user with
two phones gets one phone presentation, and the record cannot grow without bound.

---

## 5. What should constitute a UCT "workspace"

> **A workspace is a named, server-stored answer to "what am I looking at" — the widget
> set, their arrangement, their per-widget options, and the four colour-group symbols —
> plus a per-device-class presentation layer that says how that answer renders on a
> screen of a given shape. It is not a snapshot of a screen, and it does not own the
> drawings.**

Three consequences worth stating explicitly:

- **The symbol is inside it, and that is deliberate.** UCT's four ticker slots make a
  workspace *portable*: "my earnings board" is meaningful with a different ticker in
  slot A. TradingView's per-pane symbol binding does not compose this way. Keep it.
- **The drawings are outside it.** Drawings belong to the *symbol* and already sync that
  way. A workspace that owned drawings would duplicate them across boards and force a
  merge that has no correct answer.
- **The pan/zoom is inside it but per-device-class.** This is the change that makes
  "open my layout on the phone" produce something usable rather than a desktop range
  crushed into 390 px.

---

## 6. Should mobile and desktop share one workspace model?

**Yes — one model, one record, one lifecycle. They already do, and forking it now would
be the expensive mistake.**

The argument is not aesthetic. Because the symbol is a variable rather than a per-pane
binding, one record *can* render honestly on both surfaces: the phone shows one widget
at a time from the same widget list and reads the same group symbol. Forking into
"mobile layouts" and "desktop layouts" would immediately raise the question TradingView
has never answered well — which one is the real one — and would double the migration.

What must **not** be shared is **presentation**: which widgets are on screen, the view
range, and the board/grid mode. That is the `presentation[deviceClass]` sub-object in §7.
Grid mode leaking to the phone (`UCT-P9-0007`) is the existing proof that sharing
presentation is wrong; the view-lock split (`UCT-P9-0006`) is the proof that *not*
sharing content is wrong. One record with a scoped presentation layer satisfies both.

---

## 7. The recommendation

### R1 — Name the object that already exists (no new storage tier)

`charts_layouts` **already stores `layout` + `groups` together**, which is exactly a
workspace. Promote the working record into that table:

```
workspace = {
  id, name, updated_at,
  layout:  { widgets:[{id,type,color,geometry,opts}], cols, kind:'board'|'multichart' },
  groups:  { A,B,C,D },
  presentation: {                       // NEW — per device class, never content
    phone:   { visibleWidgetIds?, view:{ [chartId]: viewLock } },
    tablet:  { … },
    desktop: { … }
  }
}
```

`charts_workspace_layout` / `charts_workspace_groups` survive as the **scratch
autosave** for the current workspace, plus a new `charts_current_workspace_id` pointer.
Nothing is renamed and nothing is deleted.

### R2 — Put the layout lifecycle on the phone ← *this is the actual gap*

The desktop has five doors: **New Layout · Open Layout ▸ · Save Layout ▸ · ▦ Multi Chart ▸
· ⧉ Pop Out Layout**. The phone has **none** — the template lists are computed two lines
above the `isMobile` return and referenced only in the desktop path (`UCT-P9-0003`). Add
a **Layouts** row to the phone Tools sheet opening a sheet with: current workspace name ·
Open (list, with the prebuilt/global templates) · Save · Save as… · Rename · Delete.

This is a sheet over an API that already exists and already returns `{global, mine}`.
**It is not a subsystem, and it carries no migration.** It is the single highest
value-per-unit-cost item in the entire study.

### R3 — Give the record a scope model, and move exactly two things

Move **`viewLock`** and **grid/board mode** into `presentation[deviceClass]`. Leave
everything else where it is. Two moves, both with read-fallbacks (§8), retire two
surface patches (the phone "Exit Multi Chart" escape hatch becomes unnecessary because
the phone never inherits the mode; the view-lock split disappears).

### R4 — Fix the two durable-state defects found on the way

- **`useTracingsSync` highwatermark ordering** — advance the highwatermark only after a
  confirmed write, and reconcile the "server holds content we do not" case rather than
  leaving the device pinned (`UCT-P9-0005`).
- **`_COARSE_POINTER` → a hook** over the same query; `useHasCoarsePointer` already
  exists in `useBreakpoint.js` (`UCT-P9-0008`).

### R5 — Device **class**, not device id

Three classes, keyed off the existing breakpoint tiers. Bounded growth, no fingerprinting,
and a second phone inherits the first phone's presentation — which is what a user expects.

---

## 8. Migration and backward compatibility

Every step is **additive**, and the standing house rule applies: *a persisted-pref key
needs a read-fallback shim before any rename.*

| Change | Migration | Risk |
|---|---|---|
| Promote working record → named workspace | On first load with no `charts_current_workspace_id`, mint a workspace named "My workspace" **from the existing prefs**. Keep writing the prefs as the scratch autosave for one release. | None — a user who never opens the Layouts door sees no change. |
| `charts_layouts.groups` is currently `Optional[dict] = None` | Backfill on next save; **tolerate null on read** (an existing saved layout carries no symbols and must still open, restoring arrangement only). | Low. Must not throw on legacy rows. |
| `viewLock` → `presentation[class].view` | Read the workspace first, **fall back to `uct.charts.viewLock.<chartId>`**; write both for one release; drop the localStorage write after. | Low. Losing a view lock is cosmetic; losing it *silently on every device* is not — hence the dual write. |
| Grid mode → `presentation[class].mode` | `layout.kind==='multichart'` rows already coexist in the same store and are filtered out of the workspace Open menu (`ChartsWorkspace.jsx:2054-2055`). **That filter must keep working** or a grid template applies as a blank board. | Medium — this is the one place a careless refactor produces an empty screen. |
| Phone Layouts door | None — read-only against an existing endpoint until the user saves. | None. |
| Tracings highwatermark fix | A device whose highwatermark is already wrongly advanced stays wrong unless the fix also reconciles. Ship the reconciliation **with** the ordering fix, not after. | Medium — this is a data-visibility issue, not a crash. |

**Two things NOT to do.** Do not rename `charts_workspace_layout` or
`charts_workspace_groups` — they are read by the phone shell, the desktop board, the
multi-chart grid and the journal widget-embed path. And do not move drawings into the
workspace: they are already correctly scoped to the symbol and already sync.

---

## 9. What this means for the TradingView comparison

| | TradingView iOS | UCT mobile | Class |
|---|---|---|---|
| Durable layout object | ✅ named layouts, full lifecycle on the phone | ✅ **exists, server-backed, carries the symbols** — but **no phone door** | **PARTIAL** — model present, surface missing |
| Symbol inside the layout | per-pane binding | ✅ four dereferenced slots — **more portable** | **UCT_AHEAD** (model) |
| Drawings follow the user | ✅ | ✅ via `tracings_doc`, on both surfaces | **PARITY** |
| View range follows the layout | ✅ within its own model | ❌ device-local, unscoped | **PARTIAL** |
| Mode is device-appropriate | ✅ (separate mobile app) | ⚠️ grid mode leaks to phone; patched with an exit button | **PARITY_BUT_WORSE_UX** |

⛔ **Do not write "UCT has no saved layouts."** It has them, they are server-backed, they
store the symbols, and admins can publish firm-wide prebuilts — a capability TradingView
does not offer at all. The phone simply cannot see them.

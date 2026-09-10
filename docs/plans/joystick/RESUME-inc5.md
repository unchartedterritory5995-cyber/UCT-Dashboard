# RESUME — joystick hub Increment 5

**Created 2026-09-10.** Increment 3 is at its deploy window; Increment 4 is built and gate-clean
(0 NEW) waiting for the next window. This file carries Increment 5's scope, the three scout
reports that shaped it, and the rulings they became.

## State

| | |
|---|---|
| Branch | `feat/joystick-increment-5`, stacked on `feat/joystick-increment-4` |
| Worktree | `C:\Users\Patrick\uct-worktrees\joystick-inc5` (node_modules is a JUNCTION to inc4 — `cmd /c rmdir` it BEFORE any `git worktree remove`) |
| Contains | all of Increments 3 and 4 |
| Landed here already | the transitive write rail · the run-action handler rail |

## ⛔ THE STANDING ORDER THIS INCREMENT RUNS UNDER

Continuous execution to program completion. Three things in flight at all times — one increment
closing, one building, one scouting. Every window that opens with a gate-clean increment waiting
gets used. **Idle is a bug.** Hard stops H1–H13 are the only reason to wait.

⛔ **A freeze from the owner is a BONUS, never an assumption.** Plan every window as if master may
move. One lap per window; if master moves after that lap, HOLD to the next window and keep
building. Do not burn a second lap.

## Scout reports — 2026-09-10, all three read-only, all adopted as rulings

### 3.5a Chart — BUILDABLE AT REDUCED SCOPE

| Wave-0 binding | Verdict |
|---|---|
| `setGroupSymbol` | **DELETED as a name** — it never existed. The real one is `setGroupSym(color, sym)` (`ChartsWorkspace.jsx:768`). Wave 0 mis-transcribed it. |
| the "comparison write" | **MOVED, and out of reach.** It is `setComparison` on `chartApiById` (`ChartWidget.jsx:217`), and its only caller `CompareSymbolsPanel` mounts at `ChartsWorkspace.jsx:2811` — *after* the `if (isMobile)` return at `:2224`. |
| `scrollPosition` | **DELETED.** Tombstoned in place at `reviewSession.js:195`. The live concept is the visible logical range. |
| `stepBar` | **CONFIRMED** — `StockChart.jsx:14672`, one arg `(dir)`, reachable via `ChartPane.jsx:633`. |
| `onTfChange` | **CONFIRMED** — `StockChart.jsx:1992`. ⛔ It is a NOTIFICATION, not a setter. |

⭐ **The hub NEVER sees the desktop workspace.** Every viewport passing the hub gate
(`useHubActive.js:84`, coarse pointer ≤1023px) also passes `isMobile` with no gap, so 3.5 targets
`MobileChartsApp` only and must no-op in phone grid mode.

⛔ **RULING — `chart.compare` and `chart.logTrade` do not ship inert.** Both are `kind:'run'` with
no handler; `requires:['chart']` is a deliberate no-op (`HubRoot.jsx:331`), and compare's only
write path cannot mount on a hub viewport. This is byte-for-byte the `breadth.sizeRule` /
`breadth.snapshot` defect that B2 REMOVED. Ship the handler or drop the action — **the rail that
now enforces this is `runActionsHaveHandlers.test.js`, landed here.**

### 3.6a Catalysts — REDUCED SCOPE, and the plan's stated reason is FALSE

- `sortKey` → **MOVED** to `sortBy` (`CatalystTable.jsx:543`), and it is a 3-state cycle, not a scalar.
- `tagFilter` → **MOVED** to `activeTags` (`:428`), a `Set` of four, not a singleton.
- ⛔ **The plan says Catalysts "has no route to navigate to". That is half wrong.**
  `/catalysts/history` IS a real route (`App.jsx:639`) — it just renders `CatalystsHistory`, a
  read-only page with ONE `useState`, not `CatalystTable`. The 3.6 surface is a **Dashboard tile**.
- 🔴 **THE UNRECORDED BLOCKER: the tile does not exist on weekends or market holidays.**
  `Dashboard.jsx:186-187` mounts `TheWeek` instead when `heroState === 'WEEKEND'` — ~114 days/yr on
  which a `catalysts` mode would cursor an empty list.
- 🔴 **No row carries a DOM identity attribute.** A React `key` never reaches the document.
  `data-catalyst-row-id={r.ticker}` would be needed on `CatalystTable.jsx:805` — an ADDITIVE
  cross-workstream edit, permitted by the standing order when railed from the hub side and
  declared, in the `rule12Paths.test.js` file-AND-shape idiom (never filename-only).
- ⚠️ `CatalystTable` mounts **three times concurrently** (Dashboard desktop + mobile, Morning Wire
  rail), so a bare `[data-catalyst-row-id]` selector matches the same ticker in two trees.

### Increment 6 done-ness — measured EARLY so Increment 5 can absorb what it found

**Eighteen core items.** Ten S, five M, one L, two operator-only; three blocked on other
workstreams. The genuine build work is three section controllers (Chart, Catalysts, Calendar) plus
two accessibility features. Everything else is small, and eight of those are rails or one-line wires.

⭐ **What is NOT on the unrailed list matters as much:** the gesture engine, fan geometry, reach
mode, the capability floor, the write-path manifest, the exposure gate, the kill switch,
hide/restore, `ctx.navigate`, all five shipped sections and the Home scrub are each railed, most
mutation-proved. The unrailed set is six items, five of them one test each.

**SHIPPED BUT UNRAILED — core, not polish:**
1. the first-run coach mark (member-visible copy, zero coverage)
2. the chip naming the ring — §C1.1 calls it *"the ONLY thing that teaches a user the fan has two rings"*
3. `highContrast` — ⛔ **has no writer at all**; nothing ever sets `data-hub-contrast`, so the
   Settings toggle persists a value nothing reads
4. left-handed mirroring as a UNIT (only `HubPad` is covered)
5. the reduced-motion CSS block
6. **`tapHint` ↔ `onTap`** — the rail that would have caught Home's lie the day it shipped

**CONTRADICTIONS, each with both quotes in the scout report:**
- Spec §C3:905 vs plan §3.8:330 on Home's tap AND scrub → **strike the plan line**; three of its
  four claims are measurably false, including *"(already true in the preview)"*.
- §C2 (announce the action label alone) vs §C1.1 (the chip names the ring) → **strike neither**;
  two regions, not one string. A VoiceOver user dragging the fan currently hears the ring name and
  never learns which bubble they are on.
- `deferred.md` D-33/D-34 still defer two things that SHIPPED → strike both rows.

## Rulings adopted for Increment 5

1. **`onTap`/`onDoubleTap` receive `ctx`, exactly as `onScrub` does.** One arity change in a file
   the hub owns; it is the twin of R-G, already accepted for `onScrubCommit`. Until it lands, a
   registry-declared mode structurally cannot navigate from a tap.
2. **Home does not leave `PREVIEW_MODES` until #1 lands.** Today the chip reads
   `Preview — more coming`, which MASKS the missing tap. The moment `'home'` leaves the set,
   `tapHint: 'tap: last section'` is what a member reads against a gesture that does nothing — a
   promise in the product's own voice with no code behind it.
3. **A `tapHint` promising a tap must be backed by an `onTap`, and a rail derives it.**
4. **`highContrast` gets its writer, or the control comes off the Settings card.** It is
   member-reachable now that B13 put it on screen.
5. **Chart, Catalysts and Calendar are the three remaining builds**, in that order; 3.6 does not
   start until `CatalystTable.jsx` has a declared owner.
6. **The two-finger Peek gesture and the native range-input scrub are CORE, not polish** — neither
   has optional wording anywhere in the four sources, and the range input is the only no-drag path
   to a scrub for the population §C2's motor paragraph exists for.

## What landed here already

- **`writePathsTransitive.test.js`** — closes the gap `writePaths.test.js` names in its own words.
  It follows the CALL GRAPH from the exact function the hub calls, over-approximating on purpose so
  equality with the declared set means something. Found a real unfollowable hop on its first run
  (`globalMutate`) and refused to proceed rather than dropping it; the hop is now SUBSTANTIATED,
  not allow-listed. Mutation-proved by making `toggle` reach `toggleShare`.
- **`runActionsHaveHandlers.test.js`** — a run action must be HANDLED or HIDDEN. Names
  chart/catalysts/calendar and their handler-less actions so the next `PREVIEW_MODES` flip fails
  HERE with the list of what must ship first.

⚠️ **Recorded from building that second rail:** two earlier versions cried wolf — one modelled only
`PREVIEW_MODES` and flagged 23 healthy actions; the next looked up controllers by handled-id prefix
and still flagged `wire`, because `wireSection.js` matches by SUFFIX and never contains the string
`'wire.`. **A rail that cries wolf gets muted, and a muted rail is worse than none.**

# PR: the watchlist title's own text takes the list-menu presses (fix for #1005)

> Branch `agent/pl/watchlist-title-hit`, cut from master `b554908dda` (#1005, live). Owner-authorised; Lead GO 2026-11-09.
> Evidence:
> - real-browser proof: LOCAL headless Chrome on the agent harness, real CDP input, synthetic bars and fixture lists;
> - unit rails: SIMULATED, structural only.

## The bug
#1005 opened the list menu from the Charts Watchlist widget's title: right-click or long-press on the title, or ⋯ List
actions.
- In a real browser only ⋯ worked.
- `.pickTitle` (Watchlists.module.css) is a full-width, absolutely positioned label with `pointer-events: none`. It
  exists so presses fall through to ‹ Lists and the buttons beside it, so the title's handlers never received a press.
- #1005's unit tests dispatched `contextmenu` straight to the span, which bypasses hit-testing. That is the test gap
  this PR closes (see "Rail-wide rule").

## The fix (`7439620feb`)
- The name's own text is an inner span: `pickTitleHit`, `pointer-events: auto`. It carries `data-guide="watchlist.title"`
  and exactly the two list-menu handlers, `onContextMenu` and the long-press.
- The full-width label around it is unchanged (`pointer-events: none`), so ‹ Lists and ⋯ keep their presses.
- The inner span has **no click handler**. A left click on the text now targets the inner span. It bubbles through the
  same header and ancestors it reached before, when it landed on the header itself.

## Real-browser proof (RAW artifact: `docs/agent/program/evidence/watchlist-title-hit/`)
Tool: `app/src/testing/agent/acceptance/watchlistTitleHit.mjs`.
- `agent-harness.html?board=wl&watchlists=1`: the real ChartsWorkspace with a Watchlist widget showing the fixture list
  "Momentum" in pick mode.
- For each press it records:
  - the point (the centre of the title's **text glyphs**, or a control's own centre);
  - `document.elementFromPoint` at that point;
  - every `pointerdown` / `mousedown` / `click` / `contextmenu` the page received, with its target;
  - the widget's state before and after: pick mode, the picker, the list menu's rows, focus;
  - a screenshot.
- Files: `before.json` and `after.json` (`before` = master `b554908dda`, `after` = this branch's fix), plus one PNG per
  press.

| Press (point) | Before: elementFromPoint, events' target | Before: result | After: elementFromPoint, events' target | After: result |
|---|---|---|---|---|
| Left click, title text | pickHeader | nothing (pick mode, no menu, no picker) | `watchlist.title` (the inner span; bubbles through pickHeader) | **unchanged**: pick mode, no menu, no picker |
| Right-click, title text | pickHeader | **no menu** (the bug) | `watchlist.title` | the list menu (Rename, Copy list to clipboard, Export CSV, Import tickers, Share with community, Publish to Prebuilt (UCT)) |
| Long-press (touch), title text | pickHeader | **no menu** | `watchlist.title` | the list menu |
| Click, ⋯ List actions centre | `watchlist.listMenu` | the list menu | `watchlist.listMenu` | the list menu (unchanged) |
| Click, ‹ Lists centre | `watchlist.lists` | the picker | `watchlist.lists` | the picker (unchanged) |

The left click on the text does exactly what it did before: no handler on the inner span, and the same resulting state
in both runs. The span adds only the context-menu and long-press paths.

One note on the long-press. The browser's compatibility `mousedown` / `click` after the touch landed on the menu that
had just opened under the finger, on its container, and nothing fired. On a real touch device the menu is the bottom
sheet instead.

## Rails (`6e9de3af20`)
**Rail-wide rule (AUDIT):** jsdom does no layout. A press dispatched there proves only what the element does once it has
the press, never that a real press reaches it. Reaching is proved only by the real-browser artifact above. The title-menu
test file now says so at its top.

**STRUCTURAL ONLY rail:**
- the CSS keeps `.pickTitle` at `pointer-events: none` and `.pickTitleHit` at `pointer-events: auto`;
- the anchor is on the inner span, not the label;
- the inner span's React props are `onContextMenu` and `onPointerDown` (the long-press), with no `onClick` and no
  `onMouseDown`.

**Results:**
- The title-menu tests (14) and every other `Watchlists*`, `WatchlistWidget` and `agentGuideTargets` test pass,
  208/209.
- The one failure is the pre-existing master red `Watchlists.entitykeys` golden, left alone per AUDIT. Hashes: pinned
  `88504f4a…`, this PR `3a6e9485…` (the inner span changes the flag-off markup).

## Notebook bytes
master `b554908dda` 2,252,608 B → this head 2,252,608 B. **Delta 0**, verdict PASS.

## Locked full suite
One locked run at `98eeed4248`, on a quiet machine. Paths: `src/agent`, `src/pages/command`, `src/pages/Watchlists*`
and `src/pages/charts/widgets`; BelowNormal; SIMULATED.
- Result: `Test Files 3 failed | 388 passed | 5 skipped (396)`, `Tests 4 failed | 10668 passed | 6 skipped (10678)`.
- All four failures are pre-existing master reds (the same list as #1005):

| Test | Why |
|---|---|
| `src/pages/command/keyListenerCensus` (2) | red on master |
| `src/pages/command/shortcutRegistry` DrillPlayer (1) | red on master |
| `src/pages/Watchlists.entitykeys` golden (1) | red on master. Pinned `88504f4a…`, master `1aa5e8aa…`, this PR `3a6e9485…`. Left alone per AUDIT. |

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

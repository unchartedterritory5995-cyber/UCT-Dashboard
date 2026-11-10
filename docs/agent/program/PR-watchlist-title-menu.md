# PR: the watchlist widget's list menu, reachable from the list title

> Unit tests: LOCAL / SIMULATED. Branch `agent/pl/watchlist-title-menu`, cut from master `5a812ece93`.

## Who authorised it
`pages/Watchlists.jsx` is shared Charts code: the Charts Watchlist widget is its only shipped mode. Its owners were
unavailable. The owner gave GO on 2026-11-09, with these constraints:
- reuse the existing list menu and its handlers: no duplicated menu logic and no tutorial-only paths;
- right-click on the title opens it, plus an accessible keyboard and touch way;
- Escape closes it;
- pick mode, selection and a click on the title are unchanged.

## Why
Pick mode hides a list's own header (`.pickMode .wlHeader { display: none }`, an owner decision). That hides the
right-click menu on the list's name and the header's action buttons. 11 list actions were unreachable in the widget:
- rename, and rename Flagged;
- remove starred, copy to clipboard, export CSV/Excel, import tickers, version history;
- make public or private, publish to Prebuilt (admin), save a community list to My Lists, share Flagged.

## What changes (product `4f70f7d134`)
**The title opens the SAME list menu** (`ctxMenu`: its items and handlers):
- right-click or long-press on the title (`data-guide="watchlist.title"`);
- or the ⋯ menu button beside it (`data-guide="watchlist.listMenu"`, `aria-haspopup="menu"`, `aria-expanded`,
  label "List actions"):
  - Enter and Space press it;
  - Shift+F10 opens the menu from it;
  - a tap on touch, where the menu is the existing bottom sheet.

**Rows for the hidden header buttons.** In the menu opened from the title, the header buttons that pick mode hides
appear as rows. Each calls that button's own handler (`handleTogglePublic`, `handleTogglePrebuilt`, `setSaveSource`,
`toggleShare`). The conditions are the buttons' own:
- owner: Share / Make Private;
- admin: Publish / Unpublish Prebuilt;
- a community list, with copy-or-link on: Save to My Lists…;
- Flagged: Share / Make Private.

On the unscoped page, where those buttons are on screen, the menu is unchanged.

**Keyboard and focus:**
- Escape closes the menu. It is an element-scoped `onKeyDown`, so no window key listener is added (keyListenerCensus).
- Arrow keys move through the items.
- The first item takes focus when the menu opens.
- Focus returns to ⋯ when it closes, by Escape or a click outside.

**Rename:** the list's own name field (its header) shows in pick mode only while the name is being edited
(`.wlHeaderRenaming`). It is the same field and the same save.

**Unchanged:**
- a click on the title (it does nothing, as before);
- pick mode and row selection;
- the row menu.

Tag lists, prebuilt lists, scans and a host's own title (`pickTitleSlot`) get no title menu.

## Tests (`8a8dc40955`, `Watchlists.titlemenu.test.jsx`, 12 tests, SIMULATED)
- **Right-click** opens the list menu, with the hidden list actions and no row actions.
- **Keyboard:**
  - ⋯ is a menu button (`aria-haspopup`, `aria-expanded`);
  - Enter opens it and the first item takes focus;
  - the arrow keys move through it;
  - Escape closes it and focus returns to ⋯;
  - Shift+F10 opens it;
  - a click outside closes it and returns focus.
- **Touch:** a long-press on the title opens it; a tap on ⋯ opens it.
- **Same handlers.** Each of these produces exactly the same server request as the original control:
  - Share from the title = the header's lock button;
  - Rename from the title = Rename from the list name's own right-click (same field, same save);
  - Publish to Prebuilt (admin) = the header's star button;
  - Flagged's share calls the same `toggleShare`.
- **Community list:** Copy and Save to My Lists…, and no owner actions.
- **Unchanged:**
  - a title click opens no menu, writes nothing and does not navigate;
  - a row click opens no list menu;
  - a host's own title or a scan gets no ⋯;
  - the header stays hidden unless a name is being edited.
- Every other `Watchlists*` test, `WatchlistWidget`, and `agentGuideTargets`: 204/205.
  - The one failure is `Watchlists.entitykeys`' golden sha. It already fails on unmodified master in this
    environment (local hash `1aa5e8aa…` against the pinned `88504f4a…`).
  - This PR changes the widget's flag-off markup by design (the ⋯ button and the title anchor), so that golden has to
    be re-recorded by its owner or on the Lead's call. This PR does not touch it.
  - **What CI says (checked 2026-11-09, `gh run list`):** CI has no verdict on this test.
    - The master deploy gate runs only `AGENT_VITEST_PATHS` (`src/agent` and named files). That list does not include
      `src/pages/Watchlists*`.
    - `full-suite-report.yml` is report-only, and every run listed (10-28 to 11-09) was cancelled.
  - The test has no record command. Its golden was taken by hand against a pre-change `Watchlists.jsx` (55b12fe1d), per
    its own header. So it is **not re-recorded here**, and its hash is never edited by hand.
  - The flag-off render changes by design: the ⋯ menu button and `data-guide="watchlist.title"` on the title.
    - Local hash on master: `1aa5e8aa…`.
    - Local hash with this PR: `1512207b…`.
    - Pinned: `88504f4a…`.
  - **AUDIT ruling (2026-11-09): leave it alone.** It is a PRE-EXISTING master red, like the three `src/pages/command`
    reds. Re-baselining it here would launder other teams' unreviewed drift into this PR.

## Notebook bytes
master `5a812ece93` 2,252,608 B → this head 2,252,608 B. **Delta 0**, verdict PASS.

## Locked full suite
One locked run at `8fd718fe29`, on a quiet machine. Paths: `src/agent`, `src/pages/command`, `src/pages/Watchlists*` and `src/pages/charts/widgets`; BelowNormal; SIMULATED.
- Result: `Test Files 3 failed | 387 passed | 5 skipped (395)`, `Tests 4 failed | 10664 passed | 6 skipped (10674)`.
- Three of the failures are the same three `src/pages/command` failures every recent suite here shows (keyListenerCensus ×2, shortcutRegistry DrillPlayer ×1).
  - The census does not count JSX `onKeyDown`, and this PR adds no raw key listener.
- The fourth is the `Watchlists.entitykeys` golden: a **pre-existing master red**, left alone per AUDIT.
  - Pinned `88504f4a…`, master `1aa5e8aa…`, this PR `1512207b…`.

### Pre-existing master reds (not this PR's)
| Test | Why |
|---|---|
| `src/pages/command/keyListenerCensus` (2 tests) | red on master |
| `src/pages/command/shortcutRegistry` DrillPlayer (1 test) | red on master |
| `src/pages/Watchlists.entitykeys` golden sha (1 test) | red on master: pinned `88504f4a…`, master `1aa5e8aa…`, this PR `1512207b…`. The PR's render change is by design (⋯ and the title anchor). Left alone per AUDIT. |
- Every title-menu test passes.

## After this PR is in production
The teaching for the 11 rows stacks on `agent/pl/teach-wl-widget`, ringing `watchlist.listMenu` and the menu's rows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

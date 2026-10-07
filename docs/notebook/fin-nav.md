# Finish program, lane NAV: two doors members could not reach

Branch `feat/notebook-fin-nav`, from `72715e8001` (the wave 12 to 15 landing tip). Three small
reach gaps that earlier lanes left open. Each fix is its own commit.

| commit | what |
|---|---|
| `6b7e037c9f` | A. a door to the active setups board on Research Home (shown only with its switch on) |
| `de95cc2b5f` | B. "Skip to save results" on the Screener (keyboard) |
| (this commit) | the real-browser walk tool, its raw evidence, this record |

## A. The active setups board had no door

`docs/notebook/BETA-HANDOFF.md` section 1b said of `NOTEBOOK_SETUPS_BOARD_ENABLED`: "No menu
link to it yet". The board is a real page at `/journal/notebook/setups`
(`app/src/App.jsx`, the `notebook/setups` route). Nothing on the Notebook's own surface pointed
at it, so a member with the switch on could reach it only through the tour or a typed address.

**What changed.** Research Home now shows one link, "Active setups", right after the Today
button. It appears in the three states a member with notes can land on: the quiet home, the
quiet home after a failed load, and the full home. It is not on the first-run screen, because a
member with no notes has no plans to show.

* `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx`: the `setupsLink` element.
* `app/src/pages/journal-2-0/lib/setupsBoardLink.js` (new): the flag key, the path and the
  gate, kept apart from the board page the same way `lib/myPlaybookLink.js` is.
* `ResearchHome.module.css`: `.setupsLink`, with the 44 px floor at 1024 px and below.

**Why Research Home and not the sidebar or the app menu.** The sibling features that live on
the Notebook's own surface are all boxes on Research Home (Reporting soon, Passed setups, review
drafts). My Playbook is reached from Insights, and the visual playbook from a chart's own panel;
neither is in the folder sidebar. The app-wide `NavBar.jsx` is not touched.

**Switch off means no change.** With the switch off the element is `null`. The test renders the
home both ways, removes the one link from the switch-on page, and gets the switch-off page back
byte for byte. So the link is the whole difference: no wrapper, no spacer. This was
mutation-checked: forcing the link on turns that test red.

**First-open bytes.** Research Home is on the Notebook's first-open path and the board page
carries charts. The link module imports only the flag reader, and Research Home never imports
the board page; the test reads both import lists. After the build:

```
bytes.notebook_first_open: 2,254,381 B across 67 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

**One fact in two files.** `SetupsBoard.jsx` keeps its own flag literal, because the tour rail
(`tours/b3Research.test.jsx`) reads that literal off the page's source. The new module must not
import the page. So the new test parses the page's declaration and fails if either side moves
alone.

**The tour.** The setups board tour ("Active setups and find more like this") starts on the path
`/journal/notebook/setups` and anchors on `BoardCard.jsx` and `SetupsBoard.jsx`. Neither file
changed. `tourRegistry`, `tourAnchors`, `tourReachability`, `tourStart` and `tours/b3Research`
all pass, and the new test checks that the link's path is one of the registry's own start
routes.

## B. Screener "Save these results to Notebook" was hundreds of Tab presses away

Ruling P5 and proposal Q7 (`WAVE-13-PLAN.md` section 6). The button is the last control in the
Screener toolbar. `wave13-13q.md` section 2 measured 339 Tab presses at 1200 px and 32 at 390 px
against a keyboard budget of 10.

**What changed.** One skip link, "Skip to save results", rendered through the app shell's
skip-link slot (`components/skipLinks.jsx`, the lane 13Q-3 pattern), so it is the second Tab
stop on the page. Enter moves focus to a hidden, script-focusable target directly before the
button. The next Tab is the button.

```
Tab (Skip to main content), Tab (Skip to save results), Enter, Tab (the button), Enter = 5 keys
```

* `app/src/pages/screener/shell/ScannerShell.jsx`: 20 added lines, nothing removed. The button,
  its place and its order are untouched. Not rendered when the shell is embedded in a Charts
  widget.
* `ScannerShell.module.css`: `.skipLink`, appended at the end of the file.

**It cannot take a tap.** The lesson of PR #225 / H14: a skip link that is only moved off screen
can be painted over a tap target on a phone. Unfocused, this link has `opacity: 0` and
`pointer-events: none`. It is shown by `:focus-visible` only, which a tap does not cause. The
test reads the stylesheet for all of this.

**Merge risk.** `origin/master` changed `ScannerShell.jsx` in three places since the base (an
import near the top, the `useScreenerMeta` call, the scan-error block). None is near these
edits. `git merge-tree` of this branch against `origin/master` reports no conflict in either
Screener file.

## C. The onboarding flows O2, O3, O5 and O6

`wave14-keys.md` records those four flows as over the keyboard budget by 2 to 4 keys, with a
floor of 4 keys from a fresh load, accepted. That ruling is not reopened here.

**Item B does not change any of those counts.** The four flows run on the Notebook and count
from the shell's skip-link slot. The Screener's link is rendered only by `ScannerShell`, so it
is in that slot only on `/screener`. Measured in the real browser on `/journal/notebook`, at
both widths and with the switch both ways, the skip links were exactly `Skip to main content`,
`Skip to notes list`, `Skip to folder navigation` (walk rows `C_*`). The rails that pin the
Notebook's Tab order also pass unchanged: `components/Layout.skipLink.test.jsx`,
`a11y/onboardingKeys.test.jsx`, `onboarding/NotebookTour.keys.test.jsx`.

Item A does not change them either. Its link is not on the first-run screen (O2), and in the
other states it sits after the checklist and the offer those flows act on (O3, O5, O6).

The flows themselves were not re-measured with `tools/notebook_w14q_clicks.py`: that tool is
pinned to ports 8720 to 8724, which this lane was not given.

## Real-browser walk

`tools/notebook_fin_nav_walk.py`, real Chromium, sandbox on port 8131, data dir
`C:/data-fin-nav`, tree `de95cc2b5f`, `app/dist` rebuilt from that tree. Two boots, one after the
other: the switch unset, then `NOTEBOOK_SETUPS_BOARD_ENABLED=1`.

**VERDICT: PASS, 25 of 25 rows. Sandbox integrity CLEAN on both boots** (pre-boot, post-boot and
shutdown, 62 database files hashed each time). The port had no listener after each stop.

| check | 1200 px | 390 px |
|---|---|---|
| switch off: links named "Active setups" on Research Home | 0 | 0 |
| switch on: the link | 1, 120 x 33 px | 1, 126 x 44 px |
| switch on: click or tap lands on `/journal/notebook/setups`, board page mounted | yes (click) | yes (tap) |
| Screener, without the skip link: keys to save | 314 | 28 |
| Screener, with the skip link: keys to save | **5** | **5** |
| the unfocused skip link | opacity 0, pointer-events none, wholly above the screen, never under a probe point | same |
| the capture landed | toast "Screener results captured → Notebook inbox", inbox count up by one | same |

The 314 and 28 are this run's own control (the same walk a member makes without the link). They
differ a little from lane 13Q-1's 340 and 33 because the page has changed since.

Raw: `docs/notebook/evidence/fin-nav/` (`walk.json`, ten screenshots, both sandbox logs, both
integrity logs).

One instrument note. The tool's first run read the focused skip link as invisible while its own
screenshot, taken next, showed it. The tool was sampling the style in the same instant as the
key press. It now waits for the painted state before recording.

## Tests

All from `app/`, named files, `--maxWorkers=2`.

* Item A, 19 files (the new `ResearchHome.setupsDoor.test.jsx`, every other `ResearchHome.*`
  test, `SetupsBoard.test.jsx`, `a11y/setupsBoard.a11y.test.jsx`, `a11y/surfaceCoverage`,
  `a11y/ariaCoverage`, `styles/tapFloor.test.js`, and the five tour rails named above plus
  `tourLazy`): `Test Files 19 passed (19)`, `Tests 303 passed (303)`.
* Item B, 12 files (the new `ScannerShell.skipToSave.test.jsx`, the five other `ScannerShell.*`
  tests, `ShellToolbar`, `Screener.scanmount`, `Layout.skipLink`, `a11y/skipLinkUntappable`,
  `tapFloor`, `components/screener/reachable.test.js`): `Test Files 1 failed | 11 passed (12)`,
  `Tests 1 failed | 108 passed (109)`.
* Item C, 3 files: `Test Files 3 passed (3)`, `Tests 21 passed (21)`.
* `a11y/notebookTab.a11y.test.jsx`: passed (run beside `reachable.test.js`, 36 of 37 in that
  pair, the one failure being the row below).

**The one failure is not this lane's.** `components/screener/reachable.test.js`, "NO BLOCK IS
PAST ITS EXPIRY": a parking note for five chart-engine files
(`components/chart/engine/textLayout.js` and four more) carries the expiry date 2026-10-06, which
is today. The test reads the clock. It names no file this lane touches, and every other case in
that file passes, including the reachability sweep over all of `app/src`.

`python tools/check_repo_hygiene.py`: clean.

## Open items

1. **Minor.** After the save button is pressed with the keyboard, focus drops to the page body.
   `SaveToNotebookButton.jsx:107` disables the button while it saves, and a disabled button
   cannot hold focus. That is the shared button's behaviour on all three surfaces that use it,
   not something this lane changed. A fix would be `aria-disabled` while busy.
2. **Cosmetic.** At 1200 px the "Active setups" label sits about 2 px lower than the "Today"
   label beside it (the Today button has an icon, the link does not).
3. `wave13-13j.md` still lists the missing door among its own open items; `BETA-HANDOFF.md`
   section 1b is updated.

## How to re-run

```
cd app; npm run build; cd ..
python tools/notebook_fin_nav_walk.py --data-dir 'C:/data-fin-nav' --port 8131 `
    --out 'docs/notebook/evidence/fin-nav'
```

From PowerShell, with port 8131 free.

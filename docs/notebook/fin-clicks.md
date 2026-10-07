# Finish program, lane CLICKS: all 23 click budgets, measured

Branch `feat/notebook-fin-nav`. Budgets: `docs/notebook/WAVE-13-PLAN.md` section 6. Tool:
`tools/notebook_w13q_clicks.py` (real Chromium, a sandbox it owns, every wave 11 to 14 switch on).

| commit | what |
|---|---|
| `a0ad289e43` | Save to Notebook keeps keyboard focus through a save (product, test first) |
| `a08232f451` | the eight missing drivers, Q20 completed, instrument fixes, 12 new rail cases |
| `44360c8866` | raw evidence, 23 flows (committed before this reading) |
| `44aa449a16` | raw evidence, onboarding flows O1 to O6; Q21 keyboard reach of Plan |
| (this commit) | raw evidence for the Q20 and Q21 re-run, this record |

## 1. Verdict

A completeness review found that Q14, Q16, Q17, Q18, Q19, Q21, Q22 and Q23 had no driver, so
their budgets had never been measured. They have drivers now, and all 23 flows were run at
1280 px and 390 px.

* **Mouse (1280 px): 18 of 23 inside budget.** Over: Q2, Q6, Q11, Q13. Not measured: Q20.
* **Touch (390 px): 18 of 23 inside budget.** Over: Q2, Q6, Q11, Q13, Q20.
* **Keyboard: 6 of 23 inside budget** (Q1, Q3, Q5, Q7, Q8, Q10). 16 are over. Q20 cannot be
  done on a keyboard at all.
* **All eight newly measured flows meet their mouse and touch budgets.** All eight miss on the
  keyboard.

The keyboard misses are not small. They share three causes (section 4), and none of them is
brought inside its budget by a small additive change. No keyboard fix was built for that reason;
each miss is listed with its count and its smallest fix.

## 2. The table

Run of tree `a08232f451`, raw file `docs/notebook/evidence/fin-clicks/a08232f451/q/clicks.json`
(92 rows). The tool's own line: `VERDICT: RAN -- 92 rows; INCONCLUSIVE 4, OVER 40, PASS 48`.
Keyboard counts are keystrokes plus real Tab presses; typing content is not counted.

| flow | what | budget mouse / keys / touch | mouse 1280 | touch 390 | keys 1280 | keys 390 | verdict |
|---|---|---|---|---|---|---|---|
| Q1 | new blank note, cursor in body | 2 / 3 / 2 | 2 | 2 | 2 | 2 | PASS |
| Q2 | new note from a template with a ticker | 4 / 6 / 4 | 5 | 5 | 211 | 159 | OVER, all modes |
| Q3 | open a note by title | 2 / 4 / 3 | 2 | 1 | 2 | 2 | PASS |
| Q4 | search, open a hit | 3 / 5 / 3 | 2 | 2 | 9 | 9 | OVER on keys |
| Q5 | today's daily note | 1 / 2 / 1 | 1 | 1 | 1 | 1 | PASS |
| Q6 | link a note to a trade | 3 / 6 / 3 | 5 | 5 | 97 | 41 | OVER, all modes |
| Q7 | save Screener results to a note | 3 / 10 / 3 | 1 | 1 | 5 | 5 | PASS |
| Q8 | save a price or consensus fact | 3 / 8 / 3 | 1 | 1 | 3 | 3 | PASS |
| Q9 | ask the Notebook, insert the answer | 3 / 5 / 3 | 3 | 3 | 18 | 24 | OVER on keys |
| Q10 | task with a due date | 2 / 4 / 3 | 1 | 1 | 4 | 4 | PASS |
| Q11 | tag and move 5 notes | 8 / 15 / 10 | 12 | 12 | 219 | 234 | OVER, all modes |
| Q12 | export one note as Word | 3 / 6 / 3 | 3 | 3 | 32 | 31 | OVER on keys |
| Q13 | plan grade of my last trade | 2 / 4 / 2 | 3 | 3 | 56 | 22 | OVER, all modes |
| Q14 | My Playbook, drill a number | 3 / 6 / 3 | 3 | 3 | 49 | 29 | OVER on keys |
| Q15 | create earnings prep | 2 / 5 / 2 | 1 | 1 | 7 | 7 | OVER on keys |
| Q16 | open a resurfaced note | 2 / 4 / 2 | 2 | 2 | 46 | 45 | OVER on keys |
| Q17 | answer "why did you take it" | 2 / 4 / 2 | 2 | 2 | 28 | 22 | OVER on keys |
| Q18 | draft this week's review, open a leak | 3 / 6 / 3 | 2 | 2 | 108 | 127 | OVER on keys |
| Q19 | save a transcript passage to a thesis | 3 / 6 / 4 | 3 | 3 | 12 | 12 | OVER on keys |
| Q20 | insert a chart, draw entry, stop and target, read size | 6 / 10 / 8 | not measured | 13 | no path | no path | OVER on touch; no keyboard path |
| Q21 | arm an alert at a drawn stop | 2 / 4 / 2 | 2 | 2 | not measured | 36 | OVER on keys |
| Q22 | filter the visual playbook to one setup | 2 / 4 / 3 | 2 | 2 | 20 | 34 | OVER on keys |
| Q23 | morning board, closest setup, find similar | 3 / 6 / 3 | 2 | 2 | 85 | 81 | OVER on keys |

Q20 and Q21 were run a second time on tree `44aa449a16`
(`evidence/fin-clicks/44aa449a16/q20-q21/clicks.json`); the two "not measured" cells are
explained in section 3.

**Onboarding flows O1 to O6** (`tools/notebook_w14q_clicks.py`, same switches,
`evidence/fin-clicks/a08232f451/o/clicks.json`, `RAN -- 26 rows; OVER 10, PASS 16`): mouse and
touch all PASS. Keys: O1 3 and O4 4, both PASS. O2 7, O3 5, O5 4, O6 4, all over by 2 to 4. That
is the accepted four-key floor from a fresh load (`wave14-keys.md` section 3), unchanged to the
key, and is not reopened here.

## 3. Where each new flow starts, and what proves it ended

A flow starts at the top of the page its surface lives on, freshly loaded, as Q7 and Q15 already
did. Each driver reads the end state back and reads INCONCLUSIVE if it is not there.

| flow | start | path (mouse) | end state checked |
|---|---|---|---|
| Q14 | the Journal | Insights, Open My Playbook, Win rate on the setup card | the drill lists exactly the 25 seeded trades |
| Q16 | Settings | Compass & Voice, Open what you wrote | the "What you wrote then" sheet shows the version holding the stop, on the right note |
| Q17 | the position's page | the field, Save | the answer is still on the page after a reload |
| Q18 | Research Home | This week's review, the leak's arrow | a new note tagged weekly-review; the "Revenge re-entries" block went from closed to open |
| Q19 | the ticker's research page (keys: the thesis note) | Save from a transcript, Quote from turn 2, Save passage | the excerpt id is in that thesis note's excerpts |
| Q21 | a note whose chart carries three drawn levels | Plan, Arm alert at this level | "Alert armed" on the stop's row and the alert row in `/api/watchlist-alerts` |
| Q22 | a note whose chart is tagged VCP | Visual playbook, Only this chart's setup (VCP) | the Setup filter reads VCP and fewer cards show than before |
| Q23 | Research Home | Active setups, Find more like this on the first card | the first card is the closest setup; its match list names the seeded match |

Q23 is read as: open the board, the closest setup is its first card, open that card's matches.
Opening the card's note first would add one click and a Back.

**Seeds.** Each lane's own walk recipe is reused, not retyped: 13D's scan child fires the notice,
13G's stored call, 13H's bar fixture and drawing helper, 13J's bars and nightly run. Chart bars
are a fixture (the sandbox has no market data keys); the raw file lists every bar request served.

**Not measured, and why.**

* **Q20, mouse at 1280.** The levels are placed by the 13H-2 walk's drawing helper. At 1280 it
  could not finish in three attempts (once two of three lines stored, twice its click on Draw was
  blocked). This is the instrument. The touch row used the same helper and completed: 13 taps.
  A mouse member makes the same presses, so expect about 12 or 13 clicks against 6.
* **Q21, keys at 1280.** 600 Tab presses never reached the chart's Plan button. The raw trail
  shows why: on a wide screen the chart's toolbar is hidden (`display: none`) until the pointer or
  focus is inside the chart (`WidgetEmbedView.module.css:134-148`), and it sits before the chart
  body, so forward Tab passes it while it is hidden. Shift+Tab from inside the chart would reach
  it. The tool only tabs forward, so this row is not a count. The 390 row (36) is a real count.

## 4. Every miss, classified

INSTRUMENT means the driver took a longer path than a member would. PRODUCT means the member
really pays it.

### Mouse and touch

| flow | count / budget | class | cause | smallest fix |
|---|---|---|---|---|
| Q2 | 5 / 4 | PRODUCT | Templates is only in the notes list header, so a member on Research Home clicks All notes first | a Templates button on Research Home beside Today (the 13Q-3 pattern). Needs the dialog lifted out of the list view; not built |
| Q6 | 5 / 3 | PRODUCT | a note has no control to link a trade; the path runs through Trades, Closed, the trade, Save to Notebook, Current note | a "Link a trade" control in the note. A design decision |
| Q11 | 12 / 8 (touch 10) | PRODUCT | five ticks, then Tags, field, Add tag, folder, Move | select all in view, or shift-click a range. A design decision |
| Q13 | 3 / 2 | PRODUCT | Trades opens on Open Positions, so Closed is a second click | Trades remembers the last segment, or Today links the last closed trade. Journal-owned |
| Q20 | 13 / 8 (touch) | PRODUCT | Draw, the line tool three times (it drops after each line), three placements, Done, Plan, three roles | keep the line tool armed while drawing; offer roles by price order. `ChartPlanPanel.jsx` and the chart engine: lane A11Y's files, reported not changed |

### Keyboard

Three causes account for nearly all of it.

1. **Focus drops to the page body after a route change.** The member is back at "Skip to main
   content" on every page. Costs 2 keys per page, then the page's own Tab order.
2. **Long Tab orders inside pages.** The door a flow needs sits behind every control above it.
3. **The app's left rail.** About 20 stops unless a skip link is taken. The one-stop rail is built
   and owner-held on `feat/notebook-w13q4`; it was not merged. No row here depends on it once the
   skip link is used.

| flow | 1280 / 390 / budget | class | where the keys go | smallest fix |
|---|---|---|---|---|
| Q2 | 211 / 159 / 6 | mostly INSTRUMENT | 177 of the 211 are two wrap-arounds: the tool only tabs forward, and a member would press Shift+Tab to the Ticker field and to the list. About 34 remain | teach the tool Shift+Tab. The remainder is still over: PRODUCT, same as mouse |
| Q4 | 9 / 9 / 5 | PRODUCT | skip link (4), 3 Tabs to Search notes, Enter, Enter | the palette's "Search Notebook" command only opens the Notebook (`CommandPalette.jsx:47`). If it opened the search panel with the cursor in the box, this is 3 keys. Not built: the panel is not mounted on a phone or when collapsed, so the fix is not small |
| Q6 | 97 / 41 / 6 | PRODUCT | "g then j" (2), skip link (2), 59 Tabs down the trades table to the row (two stops per row), then 29 on the trade page | same as mouse; plus a focus target on the trade page |
| Q9 | 18 / 24 / 5 | PRODUCT | 8 to 10 Tabs to reach "Skip to editor toolbar" because focus starts in the note body | a shortcut for Ask, or the editor skip link first in order |
| Q11 | 219 / 234 / 15 | PRODUCT | the walk to five checkboxes | same as mouse; Shift+Arrow range selection exists but needs the first row focused |
| Q12 | 32 / 31 / 6 | PRODUCT | 10 to the skip link, 7 to More, 8 to Export, 3 arrows | Export in the palette |
| Q13 | 56 / 22 / 4 | PRODUCT | "g then j", skip link, 51 Tabs to the row | a row is two Tab stops (cell and setup select); make the table one stop with arrow keys. `TradesTable.jsx`, Journal-owned |
| Q14 | 49 / 29 / 6 | PRODUCT | "g then y" (2), skip (2), 37 Tabs to the door, skip (2), 4 Tabs to the number | a palette command for My Playbook plus a skip link on the page. The page is `MyPlaybook.jsx`, lane FE's file: reported, not changed. Best case about 6 |
| Q15 | 7 / 7 / 5 | PRODUCT | skip link (3), then Ask Notebook and NVDA research come before the prep button | at the four-key floor plus two boxes. Reorder Research Home: a design decision |
| Q16 | 46 / 45 / 4 | PRODUCT | skip (2), 9 Tabs to the section, 33 through the Compass cards to the inbox | put the Voice Insights Inbox first in the section, or a skip link to it. `Settings.jsx` is shared, not Notebook-owned. Better: a door on Research Home |
| Q17 | 28 / 22 / 4 | PRODUCT | skip (2), 23 Tabs through the position page to the field | a skip link to the prompt gives about 6. The prompt is `WhyPrompt.jsx`, lane A11Y's file: reported, not changed |
| Q18 | 108 / 127 / 6 | PRODUCT | skip (3), 66 Tabs to the button, 37 in the note to the leak's arrow | see the Passed setups note below. The draft's order is `lib/reviewDrafts.js`, lane DATA's file: put leaks first |
| Q19 | 12 / 12 / 6 | PRODUCT | Enter, slash, Enter, 5 Tabs to the turn, Enter, 2 Tabs, Enter | land focus on "Find in this call" when the sheet opens: about 8. Still over |
| Q20 | no path | PRODUCT | a level can only be placed with a pointer | a way to add a level by typing a price in the plan panel. `ChartPlanPanel.jsx`, lane A11Y |
| Q21 | 36 at 390 / 4 | PRODUCT | 7 Tabs to Plan, then 28: each level's role is four Tab stops | make each role group one stop with arrow keys, and move focus into the panel when it opens. `ChartPlanPanel.jsx`, lane A11Y |
| Q22 | 20 / 34 / 4 | PRODUCT | Tabs through the chart to the button, then 10 in the sheet (Close, four selects, four inputs) | put "Only this chart's setup" above the filter form. `VisualPlaybook.jsx`. Still over |
| Q23 | 85 / 81 / 6 | PRODUCT | skip (3), 69 Tabs to Active setups, skip (2), 9 to the button | see below; plus a skip link on the board |

**Passed setups inflates Q18 and Q23.** By the time those rows ran, Q7 had saved 30 Screener
names into a note, and Research Home's Passed setups box listed each one with its own controls,
ahead of the review buttons and the Active setups door. That is 66 and 69 Tabs. In a trial run
without the Screener capture the same two reaches were 10 and 13 Tabs (trial evidence was not
committed, so treat those two numbers as not measured here). Both flows are over either way. The
finding stands on its own: the box puts an unbounded list of controls in front of later doors.
Smallest fix: move the Today, review and Active setups row above it, or collapse the list.

## 5. Instrument fixes made on the way

These were over-counts or false reads in the tool, not product costs.

* A control inside a one-Tab-stop group (the Journal tab row) is reached by Tab to the group, then
  its Arrow keys. A Tab-only walk could never land on it and ran to the 600 cap.
* A trade row is opened by its own door: the symbol cell (`TradesTable.jsx:315-340`) or the phone
  card. The tool was aiming at a text span. That was Q13's "cap reached" on keys and Q6's failed
  mouse row in every earlier run.
* Q7 takes the Screener's "Skip to save results": 5 keys, matching lane NAV's own walk.
* The keyboard uses the Journal's documented "g then letter" shortcuts.
* Tab starts from the top of the document after setup clicks.
* With every switch on, a first visit meets the base tour, the checklist, a tour offer and a voice
  tip. They are closed in setup and listed in the raw file (`onboarding_cleared_in_setup`).

## 6. The Save to Notebook focus fix (`a0ad289e43`)

`SaveToNotebookButton.jsx` disabled the button while saving. A disabled button cannot hold focus,
so focus fell to the page body. Busy is now `aria-disabled` with the handler's existing guard; the
`disabled` prop (nothing to save) is unchanged. Test first:
`SaveToNotebookButton.focus.test.jsx`, 3 of 5 red before the fix. In the real browser, after the
save in Q7 on keys at both widths, the focused element is the button
(`outcome.focus_after_save` in the raw file).

## 7. Findings for other lanes

| severity | finding | where | suggested fix |
|---|---|---|---|
| IMPORTANT | No keyboard way to place a plan level on a note chart (Q20) | `ChartPlanPanel.jsx`, chart drawing overlay | add a level by typing a price |
| IMPORTANT | The chart toolbar is `display: none` until hover or focus inside the chart, so forward Tab skips it on a wide screen | `WidgetEmbedView.module.css:134-148` | hide it with opacity so it stays in the Tab order |
| IMPORTANT | Focus is left on the page body after every route change | app shell | move focus to the page heading on navigation. Shared chrome, owner decision |
| MINOR | A level stored as a bare price with no anchor point shows "Arm alert at this level", and pressing it answers "This level cannot carry an alert yet" | `ChartPlanPanel.jsx:176` | do not offer the button on such a level |
| MINOR | Research Home's Passed setups list is unbounded in the Tab order | `PassedSetups.jsx`, `ResearchHome.jsx` | see section 4 |
| MINOR | "Search Notebook" in the palette does not open search | `CommandPalette.jsx:47` | open the search panel |
| MINOR | With voice notes on, typing "/transcript" highlights Voice note first, and Enter opens the recorder (seen in a trial run, not in the committed evidence; "/transcript passage" ranks correctly) | slash menu ranking | rank the exact name first |

## 8. Runs, integrity, tests

| run | port | data dir | integrity |
|---|---|---|---|
| 23 flows | 8722 | `C:/data-fin-clicks/final-q` | CLEAN at pre-boot, +15 s, +120 s, shutdown; 62 files hashed |
| O1 to O6 | 8723 | `C:/data-fin-clicks/final-o` | CLEAN at +15 s, +120 s, shutdown (`o/integrity.md`, `o/sandbox.log`) |
| Q20, Q21 again | 8724 | `C:/data-fin-clicks/final-s` | CLEAN at all four checkpoints |

Two trial runs on 8720 and 8721 were also CLEAN; their output is not committed. Ports 8720 to
8724 were free before each boot and had no listener after. The driver imported no `api.*`.
No page error was recorded in the 23-flow run. `app/dist` was rebuilt from `a0ad289e43`, the only
product change, before the runs.

Tests:

* `npx vitest run` on 9 named files, `--maxWorkers=2` (the new focus test, the three hosts'
  door tests, `ScannerShell.skipToSave`, `TradeDetailPage`, `tapFloor`, `a11y/ariaCoverage`,
  `a11y/surfaceCoverage`): `Test Files 9 passed (9)`, `Tests 76 passed (76)`.
* `python -m pytest tests/test_notebook_w13q_clicks.py -q`: `61 passed`.
* `python -m pytest tests/test_notebook_w13q_clicks.py tests/test_notebook_flag_table_form.py -q`:
  `72 passed`.
* `python tools/check_repo_hygiene.py`: clean.

## 9. How to re-run

```
cd app; npm run build; cd ..
python tools/notebook_w13q_clicks.py --data-dir 'C:/data-fin-clicks/q' --port 8722 --wide 1280 `
    --out 'docs/notebook/evidence/fin-clicks/<sha>/q'
python tools/notebook_w14q_clicks.py --data-dir 'C:/data-fin-clicks/o' --port 8723 --wide 1280 `
    --out 'docs/notebook/evidence/fin-clicks/<sha>/o'
```

Empty data dirs, free ports. For the onboarding tool, export the gate names in
`notebook_w13q_clicks.FLAGS` as `1` first if every switch should be on.

## 10. Not covered

* Q20 with a mouse at 1280, and Q21 on keys at 1280 (section 3).
* Keyboard paths that use Shift+Tab: the tool tabs forward only, so Q2's keyboard count
  overstates the member's cost.
* No keyboard fix was built. Each needs a file another lane owns, shared chrome, or a design
  decision, and none reaches its budget with a small change.

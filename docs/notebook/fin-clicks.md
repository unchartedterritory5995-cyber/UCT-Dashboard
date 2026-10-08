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

> **Latest reading: section 13** (round 3). The "Loading..." stall of section 12.6 was the
> click tool, not the page. Keyboard is 10 of 23 inside budget; mouse and touch are 18 of 23.
>
> **Final reading: section 12** (round 2: the keyboard ruling, more focus fixes, the final
> table). Keyboard is 9 of 23 inside budget; mouse and touch are 18 of 23.
>
> **Second reading: section 11** (lane KEYS, branch `feat/notebook-fin-keys`). Keyboard is now 7
> of 23 inside budget, Q20 has a keyboard path, and every keyboard flow still over has its count,
> cause and floor there. Sections 1 to 10 are the first reading, kept as written.

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

## 11. Lane KEYS: the keyboard fixes, and all 23 flows measured again

Branch `feat/notebook-fin-keys`, cut from the landing tip `a8bd0502f8`. Sections 1 to 10 above
are the first reading and are kept as written. This section is the second reading.

| commit | what |
|---|---|
| `fab841b49b` | keyboard focus lands on the new page after an in-app move, Journal pages only |
| `8c8a7b8415` | the chart toolbar in a note can be reached with Tab |
| `45b82470b9` | "Arm alert at this level" is offered only where it can work |
| `eee804fe6f` | the Passed setups list shows five rows and a "Show all" button |
| `dfe97c9152` | the anchored action menu holds real menu items and has a menu's keys |
| `94759a1209` | the palette's "Search Notebook" opens search with the cursor in the box |
| `c289dba098` | tool: Q4 through the palette, Q20 on a keyboard, a taller window for Q20 |
| `adeec310c4` | raw evidence, all 23 flows (committed before this reading) |
| `7a2d8b9b82` | raw evidence, Q17 alone, still reading "no field" |
| `6833f05d21` | tool: Q17 finds the field by its form, not by a fixed id |
| `b0c3103229` | raw evidence, Q17 with the fixed driver |

### 11.1 Verdict

* **Keyboard: 7 of 23 inside budget, up from 6.** Q4 now passes (9 to 3).
* **Every other keyboard flow that moved, moved down, with one exception.** Q22 at 1280 px went
  from 20 to 34 (section 11.4).
* **Q20 can now be done on a keyboard** (42 and 43 keys). Before it had no keyboard path.
* **Mouse and touch are unchanged**: Q2, Q6, Q11 and Q13 are still over. Q20 with a mouse is
  now measured: 13 against a budget of 6.
* **16 keyboard flows are still over.** Eight of them cannot meet their budget on a keyboard
  however the page is arranged; the arithmetic is in section 11.3. The other eight can, and
  each needs one more focus fix that was not built here.

### 11.2 Before and after

Before: `docs/notebook/evidence/fin-clicks/` (first reading, section 2). After:
`docs/notebook/evidence/fin-keys/c289dba098/q/table.md`, and for Q17
`docs/notebook/evidence/fin-keys/6833f05d21/q17/table.md`. "n/m" means not measured.

| flow | mouse 1280 (budget) | touch 390 (budget) | keys 1280 before | keys 1280 after | keys 390 before | keys 390 after | keys budget |
|---|---|---|---|---|---|---|---|
| Q1 new note | 2 (2) | 2 (2) | 2 | 2 | 2 | 2 | 3 |
| Q2 note from a template | 5 (4) over | 5 (4) over | 209 | 209 | 159 | 159 | 6 |
| Q3 open by title | 2 (2) | 1 (3) | 2 | 2 | 2 | 2 | 4 |
| Q4 search, open a hit | 2 (3) | 2 (3) | 9 | **3** | 9 | **3** | 5 |
| Q5 daily note | 1 (1) | 1 (1) | 1 | 1 | 1 | 1 | 2 |
| Q6 link a note to a trade | 5 (3) over | 5 (3) over | 97 | 64 | 41 | 27 | 6 |
| Q7 save Screener results | 1 (3) | 1 (3) | 5 | 5 | 5 | 5 | 10 |
| Q8 save a fact | 1 (3) | 1 (3) | 3 | 3 | 3 | 3 | 8 |
| Q9 ask, insert the answer | 3 (3) | 3 (3) | 18 | 18 | 24 | 24 | 5 |
| Q10 task with a due date | 1 (2) | 1 (3) | 4 | 4 | 4 | 4 | 4 |
| Q11 tag and move 5 notes | 12 (8) over | 12 (10) over | 219 | 219 | 234 | 234 | 15 |
| Q12 export as Word | 3 (3) | 3 (3) | 32 | 32 | 31 | 31 | 6 |
| Q13 plan grade, last trade | 3 (2) over | 3 (2) over | 56 | 47 | 22 | 13 | 4 |
| Q14 My Playbook, drill | 3 (3) | 3 (3) | 49 | 38 | 29 | 18 | 6 |
| Q15 earnings prep | 1 (2) | 1 (2) | 7 | 7 | 7 | 7 | 5 |
| Q16 resurfaced note | 2 (2) | 2 (2) | 46 | 46 | 45 | 45 | 4 |
| Q17 why did you take it | 2 (2) | 2 (2) | 28 | 27 | 22 | 21 | 4 |
| Q18 weekly review, a leak | 2 (3) | 2 (3) | 108 | 91 | 127 | 83 | 6 |
| Q19 transcript passage | 3 (3) | 3 (4) | 12 | 12 | 12 | 12 | 6 |
| Q20 chart, three levels, size | 13 (6) over, was n/m | 13 (8) over | no path | 42 | no path | 43 | 10 |
| Q21 arm an alert at the stop | 2 (2) | 2 (2) | n/m | 31 | 36 | 32 | 4 |
| Q22 filter the visual playbook | 2 (2) | 2 (3) | 20 | 34 | 34 | 35 | 4 |
| Q23 morning board, similar | 2 (3) | 2 (3) | 85 | 31 | 81 | 31 | 6 |

Which fix moved which flow:

* Focus landing after a page change: Q6, Q13, Q14.
* The Passed setups cap: Q23 (85 to 31). Q18 also fell (108 to 91, 127 to 83); which fix did
  that was not separated.
* The palette's Search Notebook: Q4.
* The chart toolbar reachable with Tab: Q21 at 1280 px is now measured. It needed reverse Tab
  before.
* Typed plan levels in the tool: Q20 on a keyboard.

### 11.3 Every keyboard flow still over, with the arithmetic

How the floor is worked out. The tool counts one for every Tab and one for every other key.
Typed text is free. So the least a keyboard flow can cost is its presses of Enter, Space or a
shortcut, plus one Tab for each move to a new control. "Floor" below is that number with the
controls the flow needs today. A floor above the budget means the budget cannot be met on a
keyboard, however short the Tab order is made.

**Budget cannot be met on a keyboard (floor is above budget):**

| flow | now 1280 / 390 | budget | floor | the arithmetic | where the rest goes |
|---|---|---|---|---|---|
| Q6 | 64 / 27 | 6 | 8 | "g then j" is 2 keys, 3 presses of Enter (row, Save to Notebook, Current note), 3 moves | 52 Tabs (14 at 390) from the top of the Trades page to the first trade row |
| Q9 | 18 / 24 | 5 | 7 | 4 presses of Enter (skip link, Ask, send, Insert), 3 moves | 8 Tabs (12 at 390) to the skip link in an open note, 4 to 6 to Insert |
| Q11 | 219 / 234 | 15 | 25 | 14 keys that are not Tab (5 ticks, 2 jumps to the bulk bar, 7 others), at least 11 moves | 162 Tabs (177 at 390) from the folder tree to "Skip to notes list" |
| Q12 | 32 / 31 | 6 | 10 | 7 keys that are not Tab (Word is the fourth item of the Export menu: 3 Down, 4 Enter), 3 moves | 10 Tabs to the skip link, 7 to More, 8 to Export |
| Q16 | 46 / 45 | 4 | 6 | 3 presses of Enter, 3 moves; the flow starts in Settings | 33 Tabs inside the Compass section to "Open what you wrote" |
| Q17 | 27 / 21 | 4 | 5 | 2 presses of Enter, 1 move to the skip link, 1 to the field, 1 to Save | 22 Tabs (16 at 390) through the chart header before the card |
| Q19 | 12 / 12 | 6 | 7 | 5 keys that are not Tab, 2 moves | 5 Tabs to the quote button, 2 to Save |
| Q20 | 42 / 43 | 10 | 20 | 10 keys that are not Tab (insert the chart is 3, open Plan is 1, each level is a role key and Enter), 10 moves | 8 Tabs to Plan, 11 to the first price box |

For these eight the budget in `WAVE-13-PLAN.md` section 6 reads as a pointer budget with a
small allowance. It does not fit a keyboard. An honest keyboard budget is the floor plus a few
Tabs: about 10 for Q6, Q9, Q12, Q16, Q17 and Q19, about 28 for Q11, about 24 for Q20. This is an
owner decision and is recorded as open.

**Budget can be met, one more fix needed (floor is at or under budget):**

| flow | now 1280 / 390 | budget | floor | cause of what is left | smallest fix |
|---|---|---|---|---|---|
| Q2 | 209 / 159 | 6 | 11 on today's path, 4 with a template door on Research Home | no template door on Research Home, so the flow goes through All notes; 86 Tabs to "Skip to notes list"; 89 Tabs (34 at 390) from the new note's top to its Ticker field | the same Research Home door the mouse miss needs, and put the cursor in Ticker when a template asks for one |
| Q13 | 47 / 13 | 4 | 4 | 44 Tabs (10 at 390) from the Trades page's focus target to the newest trade row | a "Skip to trades" link, or land focus on the table |
| Q14 | 38 / 18 | 6 | 6 | 30 Tabs (10 at 390) to "Open My Playbook" on Insights | a skip link on Insights, or move the button up |
| Q15 | 7 / 7 | 5 | 4 | the skip link is the second stop, the prep button is the third stop in the list | make the skip link the first stop |
| Q18 | 91 / 83 | 6 | 6 | 21 Tabs to "This week's review"; 65 (57 at 390) from the top of the drafted note to the leak's arrow | focus the first block of a freshly drafted review |
| Q21 | 31 / 32 | 4 | 4 | Plan is the 7th toolbar stop; the stop's Arm button is 22 stops into the panel | Plan first in the toolbar's Tab order, and one stop per level row |
| Q22 | 34 / 35 | 4 | 4 | "Visual playbook" is 22 stops into the note; the filter is 10 stops into the playbook | the same toolbar ordering as Q21 |
| Q23 | 31 / 31 | 6 | 6 | "Active setups" is 24 stops into Research Home | a skip link to the morning board |

None of these fixes was built. Each one changes Tab order on a page another lane also edits,
and the brief asked for the six named fixes first.

### 11.4 One number went up

Q22 at 1280 px went from 20 to 34. The cause is the chart toolbar fix. The toolbar's buttons
used to be out of the Tab order at 1280 px until the pointer was over the chart. They are now
in it, as they always were at 390 px, so both widths cost the same (34 and 35). This is the
price of the toolbar being reachable at all, and it is why Q21 at 1280 px could be measured
this time.

### 11.5 The five mouse and touch misses

Asked: apply the smallest fix if it is in Notebook or Journal files and additive. None met
both tests. Open decisions for the owner:

| flow | over by | what would close it | why it was not built |
|---|---|---|---|
| Q2 | 1 | a Templates button on Research Home | the template dialog lives in the list view and must be lifted out; and Research Home with the wave switches off must stay exactly as it was, so the button needs its own switch. Not a small additive change |
| Q6 | 2 | a "Link a trade" control in the note | a new control and a new picker: a design decision |
| Q11 | 4 (2 on touch) | select all in view, or a range select | a new bulk control: a design decision |
| Q13 | 1 | Trades remembers the last segment, or opens on Closed | the segment is kept in the address (`?seg=`); changing what opens first changes the page for every member, so it is a product choice |
| Q20 | 7 (5 on touch) | keep the line tool armed after a line is drawn, in a note's chart | the tool drops by design in the shared chart overlay; that file is not Notebook-owned |

### 11.6 Tool fixes in this lane

* Q4 on a keyboard goes through the palette ("Search Notebook"), which is the door a keyboard
  member uses.
* Q20 on a keyboard types the three levels into the plan panel's own form. Q20 with a mouse
  uses a 1200 px tall window, so the drawing helper has room. Both gaps noted in section 10 are
  closed.
* Q21 on a keyboard needs no reverse Tab now that the toolbar is in the Tab order.
* Q17 read "no field" in all four modes on tree `c289dba098`. The page had the field. Another
  lane changed the field's id from a fixed one to a generated one (one card per lot), and the
  driver looked for the fixed id. The driver now finds the field inside its form. This was a
  tool defect, not a product one.

### 11.7 Findings for other lanes

* `app/src/pages/command/keyListenerCensus.test.js` is red on the landing tip, before any
  commit of this lane: three files are over their baseline
  (`GenericTourEngine.jsx`, `lib/toggleNode.js`, `tabs/NotebookTab.jsx`), total 114 against a
  ceiling of 111. Counts at `a8bd0502f8` and at this tip are the same for all three. Not fixed
  here.
* `components/mobile/ContextPopover.jsx` has a second branch that takes custom children. That
  branch still has `role="menu"` around content that is not menu items (the Save to Notebook
  box is one caller). Only the `items` branch was fixed.
* `tokens.reachable.test.js` and `TradeDetailPage.test.jsx` timed out once under load and pass
  alone.

### 11.8 Runs, integrity, tests

| run | port | rows | verdict line | integrity |
|---|---|---|---|---|
| all 23, tree `c289dba098` | 8720 | 92 | `RAN -- 92 rows; INCONCLUSIVE 4, OVER 40, PASS 48` | CLEAN |
| Q17 alone, tree `c289dba098` | 8721 | 4 | 4 INCONCLUSIVE | CLEAN |
| Q17 alone, tree `6833f05d21` | 8722 | 4 | `RAN -- 4 rows; OVER 2, PASS 2` | CLEAN |

One build, from tree `c289dba098`. First-open bytes: 2,204,142 B across 59 files against a
budget of 2,260,793 B, PASS.

Tests, each from `app/` with `--maxWorkers=2`, log read for the totals line:

| what | totals |
|---|---|
| `src/pages/journal-2-0/a11y/` (whole directory) | 44 files passed; 392 tests passed, 1 skipped |
| tour rails (whole `onboarding/` directory), the seven `Layout.*` tests, the five `JournalLayout.*` tests, `ScannerShell.skipToSave`, `styles/tapFloor` | 59 files passed; 703 tests passed |
| this lane's new tests, the tests of every file it touched, every test that uses ContextPopover | 40 of 41 files passed; 663 of 665 tests passed. The 2 failures are the key listener census above |
| `python -m pytest tests/test_notebook_w13q_clicks.py -q` | 61 passed |
| `python tools/check_repo_hygiene.py` | exit 0 |

### 11.9 Not covered in this lane

* The eight "one more fix" rows of section 11.3 were not built.
* Focus landing is on `/journal/**` and `/journal-2-0/**` only, as asked. Other pages are
  unchanged.
* The custom-children branch of ContextPopover.
* No screen reader was run. The announcements were checked by tests of the rendered text only.

## 12. Lane KEYS round 2: the ruling, more focus fixes, and the final table

Same branch, `feat/notebook-fin-keys`. Section 11 is the reading before this round and is kept
as written. This section is the final reading.

| commit | what |
|---|---|
| `6eebf70a9d` | the three key listeners this landing added go through the shortcut registry |
| `04a570a8a7` | a ContextPopover that holds custom content is a named dialog, not a menu |
| `f1883bd59b` | the chart toolbar in a note is one Tab stop |
| `b492dedbd6` | a page can mark where keyboard focus lands after a navigation |
| `50bb59c15a` | Trades, Insights and My Playbook mark their landing |
| `9432875ec0` | opening the trade plan puts focus in it |
| `ce16e3f4d5` | Research Home: a skip link to the reviews and the setups |
| `7af200a4e0` | the keyboard ruling in the plan, the tool and a test |
| `2bc846c6fd` | the phone card list on Trades is a landing too |
| `b86027ad9b` | tool: console errors are recorded |
| `ed6ec69cfd` and two more | raw evidence, committed before this reading |

### 12.1 The ruling on keyboard budgets (controller, 2026-10-07)

A keyboard budget below the arithmetic floor cannot be met by any design, so it is not a
usable bar. The floor is the keys that are not Tab, plus one Tab for each move to a new control.
For the eight flows where the floor is above the plan's number, the keyboard budget is now the
floor plus 2. Mouse and touch budgets are unchanged. Every other flow keeps its plan number.

The ruling is written into the plan that owns the budgets: `docs/notebook/WAVE-13-PLAN.md`
section 6, "Keyboard budgets by ruling", with each floor and its reason. The tool reads the
same numbers (`KEYS_RULING_FLOOR` in `tools/notebook_w13q_clicks.py`) and its verdict uses
them. `tests/test_notebook_w13q_clicks.py` cross-reads the two.

| flow | plan keys | floor | keys budget now |
|---|---|---|---|
| Q6 | 6 | 8 | 10 |
| Q9 | 5 | 7 | 9 |
| Q11 | 15 | 25 | 27 |
| Q12 | 6 | 10 | 12 |
| Q16 | 4 | 6 | 8 |
| Q17 | 4 | 5 | 7 |
| Q19 | 6 | 7 | 9 |
| Q20 | 10 | 20 | 22 |

### 12.2 Final counts

Evidence: `docs/notebook/evidence/fin-keys/4b46b05a4c/q/` (all 23) and
`docs/notebook/evidence/fin-keys/f54318e14d/q6-q13/` (Q6 and Q13 after the phone landing).

* **Mouse, 1280 px: 18 of 23 inside budget.** Over: Q2, Q6, Q11, Q13, Q20.
* **Touch, 390 px: 18 of 23 inside budget.** Over: Q2, Q6, Q11, Q13, Q20.
* **Keyboard: 9 of 23 inside budget at both widths** (Q1, Q3, Q4, Q5, Q7, Q8, Q10, Q13, Q14).
  It was 6 at the first reading and 7 after round 1. 14 are still over.

| flow | mouse (budget) | touch (budget) | keys 1280 | keys 390 | keys budget | keys verdict |
|---|---|---|---|---|---|---|
| Q1 | 2 (2) | 2 (2) | 2 | 2 | 3 | pass |
| Q2 | 5 (4) over | 5 (4) over | 209 | 159 | 6 | over |
| Q3 | 2 (2) | 1 (3) | 2 | 2 | 4 | pass |
| Q4 | 2 (3) | 2 (3) | 3 | 3 | 5 | pass |
| Q5 | 1 (1) | 1 (1) | 1 | 1 | 2 | pass |
| Q6 | 5 (3) over | 5 (3) over | 23 | 19 | 10 | over |
| Q7 | 1 (3) | 1 (3) | 5 | 5 | 10 | pass |
| Q8 | 1 (3) | 1 (3) | 3 | 3 | 8 | pass |
| Q9 | 3 (3) | 3 (3) | 18 | 24 | 9 | over |
| Q10 | 1 (2) | 1 (3) | 4 | 4 | 4 | pass |
| Q11 | 12 (8) over | 12 (10) over | 219 | 234 | 27 | over |
| Q12 | 3 (3) | 3 (3) | 32 | 31 | 12 | over |
| Q13 | 3 (2) over | 3 (2) over | **4** | **4** | 4 | pass (was 47 / 13) |
| Q14 | 3 (3) | 3 (3) | **6** | **6** | 6 | pass (was 38 / 18) |
| Q15 | 1 (2) | 1 (2) | 7 | 7 | 5 | over |
| Q16 | 2 (2) | 2 (2) | 46 | 45 | 8 | over |
| Q17 | 2 (2) | 2 (2) | 27 | 21 | 7 | over |
| Q18 | 2 (3) | 2 (3) | 48 | 38 | 6 | over (was 91 / 83) |
| Q19 | 3 (3) | 3 (4) | 12 | 12 | 9 | over |
| Q20 | 13 (6) over | 13 (8) over | 25 | 25 | 22 | over (was 42 / 43) |
| Q21 | 2 (2) | 2 (2) | 15 | 15 | 4 | over (was 31 / 32) |
| Q22 | 2 (2) | 2 (3) | 21 | 21 | 4 | over (was 34 / 35) |
| Q23 | 2 (3) | 2 (3) | 14 | 14 | 6 | over (was 31 / 31) |

### 12.3 Every keyboard flow still over: the count, the floor, the reason

**A correction to section 11.3 first.** For a flow that starts on a freshly loaded page, the
floor there counted one Tab to reach the page's own skip link. The shell's "Skip to main
content" is always the first stop and the page's link comes after it, so that move costs at
least two Tabs. The shell is not this lane's to change. The floors below are corrected: Q15 is
5 (was 4), Q18 is 7 (was 6) and Q23 is 7 (was 6). For Q18 and Q23 the corrected floor is above
the plan's number of 6. The ruling named eight flows; it was not stretched to cover these two.
They are an open decision for the controller.

| flow | now 1280 / 390 | budget | floor | what the keys are | why it is still over | built this round |
|---|---|---|---|---|---|---|
| Q2 | 209 / 159 | 6 | 11 on today's path | skip, All notes, skip, Templates, pick, Ticker | Research Home has no template door, so the flow goes through All notes (86 Tabs to the list's skip link). The new note puts focus in its title, and Ticker is before the title, so a forward Tab goes round the page (89) | nothing. The door is the same change the mouse miss needs (12.4). Moving first focus from title to Ticker changes where every new note starts, a product choice |
| Q6 | 23 / 19 | 10 | 8 | g, j, 11 Tabs to the trade, Enter, 5 Tabs to Save to Notebook, Enter, 2 Tabs, Enter | the trade is the sixth row and each row is two stops (the row and its setup list); Save to Notebook is the fifth stop on the trade page | the Trades landing (was 64 / 27) |
| Q9 | 18 / 24 | 9 | 7 | 8 Tabs to the skip link, Enter, 2 Tabs to Ask, Enter, Enter, 4 Tabs to Insert, Enter | the note's "Skip to editor toolbar" is the fourth skip link, and the run starts with focus low in the page, so it passes two floating buttons first; Insert is the fourth stop of the answer | nothing |
| Q11 | 219 / 234 | 27 | 25 | see 11.3 | 162 Tabs (177) from the folder tree to "Skip to notes list": after choosing a folder focus stays in the tree and the skip link is behind the whole page | nothing |
| Q12 | 32 / 31 | 12 | 10 | 10 Tabs to the skip link, Enter, 7 to More, Enter, 8 to Export, Enter, 3 Down, Enter | More note actions is a list of plain buttons, not a menu with arrow keys; Export is its eighth | nothing |
| Q15 | 7 / 7 | 5 | 5 | 2 Tabs to the skip link, Enter, 3 Tabs, Enter | two stops (Ask Notebook, the ticker's research link) come before the prep button | nothing. Putting the button first means moving it in front of its own ticker link |
| Q16 | 46 / 45 | 8 | 6 | skip, 9 Tabs to the Compass section, Enter, 33 Tabs, Enter | the notice is at the end of Settings' Compass and Voice section | nothing. `Settings.jsx` is not a Notebook or Journal file |
| Q17 | 27 / 21 | 7 | 5 | skip, 22 Tabs (16), type, 2 Tabs, Enter | the position page's chart header (22 controls) is before the card. The flow starts on a fresh load, so the landing does not apply | nothing |
| Q18 | 48 / 38 | 6 | 7 | 4 Tabs to the new skip link, Enter, 2 Tabs, Enter, 39 Tabs (29), Enter | the drafted note opens with focus at its top; the leak's arrow is after the note's header, the editor's toolbar and two charts | the skip link and the one-stop toolbar (was 91 / 83) |
| Q19 | 12 / 12 | 9 | 7 | Enter, /, Enter, 5 Tabs, Enter, 2 Tabs, Enter | the passage sheet opens on Close; quarter, search and the first turn come before the wanted turn | nothing |
| Q20 | 25 / 25 | 22 | 20 | 10 keys that are not Tab, 15 Tabs | after "Add level" focus follows the new level's row (lane A11Y's design), so the way back to the price box is 4 and then 3 Tabs | plan focus on open and the one-stop toolbar (was 42 / 43) |
| Q21 | 15 / 15 | 4 | 4 | 1 Tab to Plan, Enter, 12 Tabs, Enter | each level row is four stops and the stop is the third row | Plan is the toolbar's stop and the plan takes focus (was 31 / 32) |
| Q22 | 21 / 21 | 4 | 4 | 9 Tabs to Visual playbook, Enter, 10 Tabs, Enter | the playbook door is the last control under the chart (after the chart, three scale buttons and the fingerprint row); the sheet opens on Close and four filters and four fields come before the "only this setup" button | the one-stop toolbar (was 34 / 35) |
| Q23 | 14 / 14 | 6 | 7 | 4 Tabs to the new skip link, Enter, 5 Tabs to Active setups, Enter, 2 Tabs, Enter | the reviews box (four buttons) is between the landing and the board link; each card's plan link is before its "find more" button | the skip link (was 31 / 31) |

### 12.4 The pointer misses: one change each, and where it lives

None was built. Each row says whether that is because of ownership or because the change is
not additive.

| flow | now | budget | the one change | count after | file | why not built |
|---|---|---|---|---|---|---|
| Q2 | 5 | 4 | a Templates button on Research Home | 4 | `tabs/NotebookTab.jsx` (the New note sheet is mounted only in the list view and must be lifted out), `components/notebook/ResearchHome.jsx` | Notebook-owned, but not additive: Research Home is live with no switch of its own, and a new visible button on it changes the switches-off page |
| Q6 | 5 | 3 | a "Link a trade" control in the note header | 3 (open it, pick the trade, confirm) | `components/notebook/NoteEditorPage.jsx` and a new picker | a new control and a new picker: a design decision |
| Q11 | 12 (touch 12) | 8 (touch 10) | "Select all shown" in the list header | 8 (one tick replaces five) | `tabs/NotebookTab.jsx` | Notebook-owned and additive. Not built in this round for lack of time, not for any other reason. It is the cheapest of the five |
| Q13 | 3 | 2 | Trades opens on the segment the member used last | 2 | `tabs/TradesSurface.jsx` (the segment is `?seg=` in the address) | changes what every member sees first on Trades: a product choice |
| Q20 mouse | 13 | 6 | keep the line tool armed after a line is placed, and name the three lines by price order | 8 (touch budget met; mouse still 2 over) | the shared chart: `components/chart/ChartDrawingOverlay.jsx`, and `ChartPlanPanel.jsx` | the chart overlay is not a Notebook or Journal file |

### 12.5 The key listener census

`app/src/pages/command/keyListenerCensus.test.js` was red, 114 against 111. `origin/master`
holds none of the three extra listeners (counts on master: `NotebookTab.jsx` 2,
`toggleNode.js` 0, `GenericTourEngine.jsx` 0), so this landing added them. The rail's contract
is "declare the binding in `shortcutRegistry.js` and bind it with `registerShortcuts()`", and
its ceiling may only go down. All three now do that. Each declaration says its target, phase
and reason. Three overlaps with existing Escape and Tab bindings are listed in
`ACKNOWLEDGED_OVERLAPS` with how each is resolved. No baseline or ceiling number was changed.
The test is green.

One behaviour to know: Enter on a collapsible block's arrow is now one document listener for
all editors on the page, bound while an editor exists. It acts only on a press on an arrow.

### 12.6 Findings

* **CORRECTED in section 13.1: this was the click tool, not the page.** As first written:
  **A page stuck on "Loading..." three times in three runs** (Q6 on a keyboard: twice at
  1280 px, once at 390 px, never the same row twice). The Journal's lazy Trades page did not
  finish loading within 45 seconds after "g then j" from an open note. The server log shows the
  page's files being fetched and the list stopping part way (`sandbox.log` of the probe run:
  `optionCalcs` is the last file, six more are never asked for), with no page error. The box
  was under heavy load (the server's own probe line reads `cpu=1233%`). This did not happen in
  any earlier run. The cause is not established. It may be the sandbox (one browser holding
  several long streams to a plain HTTP/1.1 server), or it may be this round. It is not excused
  here: it should be reproduced on a quiet box before this branch ships.
* `components/screener/reachable.test.js` has one red case that is not from this lane: a
  chart-engine parking note expired on 2026-10-06 (`textLayout.js`, `versionRender.js` and
  three more). Every other case in that file passes, including the reachability of this
  lane's new modules.
* Section 11.3's floors for flows that start on a fresh page were one too low (12.3).

### 12.7 Runs and tests

| run | port | verdict line | integrity |
|---|---|---|---|
| all 23, tree `4b46b05a4c` | 8723 | `RAN -- 92 rows; INCONCLUSIVE 1, OVER 38, PASS 53` | CLEAN |
| Q6 and Q13, tree `4b46b05a4c` | 8724 | `RAN -- 8 rows; INCONCLUSIVE 1, OVER 6, PASS 1` | CLEAN |
| Q6 probe (scratch, not committed) | 8720 | 1 INCONCLUSIVE | CLEAN |
| Q6 and Q13, tree `f54318e14d` | 8721 | `RAN -- 8 rows; OVER 6, PASS 2` | CLEAN |

Two builds. First-open bytes after the last one: 2,207,883 B across 59 files against a budget
of 2,260,793 B, PASS.

| tests (from `app/`, `--maxWorkers=2`) | totals |
|---|---|
| `src/pages/journal-2-0/a11y/`, the `onboarding/` directory, the seven `Layout.*` and five `JournalLayout.*` tests, `styles/tapFloor.test.js`, `src/pages/command/` (the census) | 106 files passed; 1131 tests passed, 1 skipped |
| every ContextPopover user, this round's new tests and the tests of the files it touched, `insights/`, `tabs/`, `reachable.test.js`, `tokens.reachable.test.js` | 96 of 97 files; 1080 of 1081 tests. The one failure is the expired parking note above |
| `python -m pytest tests/test_notebook_w13q_clicks.py -q` | 63 passed |
| `python tools/check_repo_hygiene.py` | exit 0 |

### 12.8 Not covered

* "Select all shown" for Q11 (12.4), and the six flows with "nothing" in 12.3's last column.
* The "Loading..." stall was not reproduced by hand or explained.
* No screen reader was run.
* The landing is used on Trades, Insights and My Playbook only.

## 13. Lane KEYS round 3: the stall explained, and the final table

Section 12 is the reading before this round and is kept as written, including its finding
12.6, which this section corrects.

### 13.1 The "Loading..." stall: it was the tool, not the page

**Verdict: the Trades page was never stuck. The click tool gave up within a second and its
screenshot caught the page's half-second loading state. No product code is involved.**

What section 12.6 said: Q6 on a keyboard read INCONCLUSIVE three times in three runs beside a
screenshot of "Loading...", and the page "did not finish loading within 45 seconds". The 45
seconds were never measured. They were the helper's own time limit, assumed to have run out.

What happened, from the raw record:

* The server log of the failing run carries times. The Trades page's first file was fetched
  at 12:26:24, and the NEXT flow's note was created at 12:26:24, the same second
  (`docs/notebook/evidence/fin-keys/4b46b05a4c/q6-q13/sandbox.log`, lines 2133 and 2149). The
  flow ended in under a second.
* The row helper (`_trade_row` in `tools/notebook_w13q_clicks.py`) takes a table row that
  names the symbol, or failing that any control that names it. The note the flow starts on
  names CRWD too, in its ticker chip. The probe counted that control on the start page in
  every run: 1 (`loose_match_on_start_page`).
* So the helper returned the note's chip as "the trade row". A moment later the note was
  gone, the count was 0, and the flow reported "the row is not visible". The screenshot was
  taken then, while the Trades page showed its loading state.
* Whether the chip or the table won was a race of a few hundred milliseconds, which is why it
  moved between widths and runs.

The deliberate reproduction (`tools/notebook_fin_keys_stall_probe.py`, raw in
`docs/notebook/evidence/fin-keys/stall/`): a note is open, "g" then "j", then wait for the
trade rows. Each run records every request with status and time, console and page errors,
React commit counts, the focused element, and the box's CPU load.

| build | runs | stalled | rows arrived, slowest | React commits per run | CPU load during |
|---|---|---|---|---|---|
| tip (round 2 code) | 15 | 0 | 0.67 s | 9 to 15 | 7 to 88 percent |
| base `a8bd0502f8` | 15 | 0 | 1.48 s | 11 to 15 | 60 to 100 percent |
| tip, second set | 15 | 0 | 0.93 s | 12 to 16 | 63 to 100 percent |

30 clean runs on the tip build and 15 on the base. No render loop: the commit counts are the
same on both builds. Focus does not move in a loop: it ends on the Trades landing on the tip
and on the page body on the base. The requests left unanswered when a run was closed are
background calls the page does not wait for (a plan status call; on the base also a tracking
call and an account call). The one console line is a 503 on a call the sandbox does not serve.

The suspects, each ruled out by the above rather than by a revert: the route focus code and
the key registry would both show as extra commits or a moving focus, and neither is there; a
failed lazy file would show as a failed or unanswered request, and there is none; load on the
box did not produce a stall on either build.

The fix is in the tool (`d68ba8958a`), test first. The new test reproduces the mechanism: a
page being left that names the symbol for one sample. It was red before the fix. A loose match
now counts only when it is still there on the next sample. In the full run after the fix there
is no INCONCLUSIVE row.

### 13.2 Rulings applied

* The keyboard ruling now covers Q18 and Q23 (floor 7, budget 9). The plan's table, the tool
  and the cross-read test hold ten flows (`docs/notebook/WAVE-13-PLAN.md` section 6).
* "Select all shown" for Q11: **it already exists**, and so does a range select
  (`tabs/NotebookTab.bulk.test.jsx`, "Shift+click selects the range between" and "Select all N
  shown"). Nothing was built. The tool did not use either: its mouse path ticked five boxes.
  It now ticks the first and Shift+clicks the last. Q11 with a mouse is 9, one over: the flow
  starts on Research Home and spends one click on "All notes". On touch there is no range
  gesture, and "Select all shown" would select every note in the list, not the five, so the
  touch count is still 12.

### 13.3 What was built this round

| commit | what | effect |
|---|---|---|
| `d68ba8958a` | tool: a control of the page being left is never the trade row | no more false stall |
| `fca50d3e5a` | the editor's formatting toolbar is one Tab stop | Q18 48 to 27, part of Q2 and Q12 |
| `816a05096c` | the position page has a skip link to "Why did you take it?" | Q17 27 / 21 to 7 / 7, passes |
| `dd214a3f9f` | tool: Shift+Tab where a member would go back; Q11 range select; the ruling for Q18 and Q23 | Q2 209 to 82, Q11 219 to 103, Q12 32 to 20 |

The Shift+Tab change is a change to the tool, not to the product. A control that sits before
the focus was being reached by tabbing forward round the whole page. A keyboard member goes
back. Each Shift+Tab is pressed for real and counted as one.

### 13.4 Final counts

Evidence: `docs/notebook/evidence/fin-keys/816a05096c/q/`. 92 rows, none INCONCLUSIVE,
integrity CLEAN.

* **Mouse: 18 of 23 inside budget.** Over: Q2 5 (4), Q6 5 (3), Q11 9 (8), Q13 3 (2), Q20 13 (6).
* **Touch: 18 of 23.** Over: Q2 5 (4), Q6 5 (3), Q11 12 (10), Q13 3 (2), Q20 13 (8).
* **Keyboard: 10 of 23 inside budget at both widths** (Q1, Q3, Q4, Q5, Q7, Q8, Q10, Q13, Q14,
  Q17). First reading 6, round 1 7, round 2 9.

| flow | keys 1280 / 390 | budget | floor | what the keys are spent on | why still over |
|---|---|---|---|---|---|
| Q2 | 82 / 61 | 6 | 11 on today's path | 12 Tabs to All notes, 44 Shift+Tabs back to the list's skip link, 13 Tabs to Templates | no template door on Research Home (12.4). The skip link is 44 stops behind the folder panel; the list header is 13 stops |
| Q6 | 23 / 19 | 10 | 8 | 11 Tabs to the sixth trade row, 5 to Save to Notebook | each trade row is two stops; Save to Notebook is the fifth stop of the trade page |
| Q9 | 18 / 24 | 9 | 7 | 8 Tabs to the skip link, 4 to Insert | not worked on |
| Q11 | 103 / 80 | 27 | 25 | 14 Tabs to All notes, 46 Shift+Tabs to the skip link, 15 Tabs through the list header to the first tick | the same two runs as Q2 |
| Q12 | 20 / 19 | 12 | 10 | 6 Shift+Tabs to More, 8 Tabs to Export, 3 Down | More note actions is a group of plain buttons with Export eighth |
| Q15 | 7 / 7 | 5 | 5 | 2 Tabs to the skip link, 3 to the prep button | two stops before the button; not worked on |
| Q16 | 46 / 45 | 8 | 6 | 9 Tabs to the Settings section, 33 inside it | `Settings.jsx` is not a Notebook or Journal file. Not built |
| Q18 | 27 / 30 | 9 | 7 | 4 Tabs to the skip link, 2 to the review, 18 to the leak's arrow | the drafted note opens with focus at its top; the header (7), the title area (5) and two charts are before the arrow |
| Q19 | 12 / 12 | 9 | 7 | 5 Tabs to the turn, 2 to Save | not worked on |
| Q20 | 25 / 25 | 22 | 20 | 15 Tabs between the plan's fields | after "Add level" focus follows the new row |
| Q21 | 15 / 15 | 4 | 4 | 12 Tabs to the stop's Arm button | four stops per level row; the stop is the third |
| Q22 | 21 / 21 | 4 | 4 | 9 Tabs to Visual playbook, 10 to the filter button | not worked on this round |
| Q23 | 14 / 14 | 9 | 7 | 4 Tabs to the skip link, 5 to Active setups, 2 to "find more" | the reviews box is between the landing and the board link |

**Asked for and not delivered.** The controller asked for the one change that removes the long
run in Q2, Q11, Q16, Q18, Q12 and Q17. Q17 is done. Q18 and Q12 are lower and still over. For
Q2 and Q11 the long runs that remain are the folder panel (44 and 46 stops between it and the
list's skip link) and the list header (13 and 15 stops). The fix for both is the same: the
folder tree, the Recents list and the view switcher as single stops with arrow keys. That is a
rewrite of the keyboard model of a 2,000 line component (`FolderSidebar.jsx`) and was not
attempted. Q16 is in a file this lane does not own.

### 13.5 Tests and gates

| what | totals |
|---|---|
| a11y directory, onboarding directory, seven `Layout.*`, five `JournalLayout.*`, `styles/tapFloor.test.js`, `src/pages/command/` | 106 files passed; 1131 tests passed, 1 skipped |
| every ContextPopover user, every `NoteEditorPage*` and `WidgetEmbedView*` test, this round's new tests, `position/` | 91 files passed; 872 tests passed |
| `python -m pytest tests/test_notebook_w13q_clicks.py -q` | 65 passed |
| `python tools/check_repo_hygiene.py` | exit 0 |
| first-open bytes | 2,208,527 B of 2,260,793 B, PASS |

Still true from 12.6: one red case in `components/screener/reachable.test.js`, a chart-engine
parking note that expired on 2026-10-06. Not from this lane.

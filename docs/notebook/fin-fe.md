# Finish program, lane FE: the frontend review's findings

Branch `feat/notebook-fin-fe`, from `72715e8001`. Source review: `R3-FRONTEND.md` (read-only, traced
in code, never run). Every finding below was first reproduced with a failing test, then fixed, then
mutation-checked (bytes captured, the fix broken, a real failing test seen, bytes written back,
`git diff` compared).

## What was found and what was done

| Finding | Verdict on the review | Commit | What changed |
|---|---|---|---|
| C1 a note chart and a Charts chart delete each other's alerts | Confirmed, both scenarios | `b6ea91c7d4` | `useBoundDrawingAlerts` takes a `namespace`. A caller with none owns bare drawing ids and skips every prefixed id. The plan panel passes `nb:<embedId>:` and owns only those. An id the caller does not own is never patched, deleted or marked seen. `StockChart.jsx` is not edited. |
| I1 Back-button trap, replay on reload | Confirmed | `1539067617` | The gate spends the tour request the moment it reads it: it replaces the history entry with the same URL and the request removed. |
| I6 tours fail silently | Confirmed, three ways | `6f421668d8` | A tour that cannot start (no anchor after the wait, its step file gone, the engine file gone) frees the slot, reports `opened: false` so the offer is not spent, and shows one sentence for 8 seconds. Step files load through `importWithOneRetry`. A passive explainer stays silent. |
| I4 "what happened next" a session late | Confirmed | `56e0ec31ba` | One Eastern-day authority, `lib/calendar.js` `etDayOf`. `todayET`, the chart block's `tsToAnchorDay` and the panel all use it. Daily bars are compared by day. |
| I5 viewing a note writes to it | Confirmed (five charts, five POSTs, five node writes) | `4371f34d6b` | A freeze happens only on the "Freeze the fingerprint" button, or for a chart added while this note has been open in this tab (the block's `capturedAt` is not older than `openedAt`, which the note editor now records). With either time missing the panel does not guess. |
| MINOR 200-id cap | Confirmed | `bfc58100af` | Asked in batches of 200 and merged. |
| MINOR `pnlDollar.toFixed` | Confirmed | `bfc58100af` | A missing P&L or R is a dash. |
| MINOR silent `/vs` | Confirmed | `bfc58100af` | One sentence through the note's own toast. |
| MINOR duplicate DOM ids | Confirmed | `bfc58100af` | One id per card (`useId`). |
| MINOR setups stub page | Confirmed | `bfc58100af` | Both flags off sends the member back to the Notebook. |
| MINOR fingerprint retry latch | Confirmed | `4371f34d6b` | A retry cut short frees the latch. |
| MINOR bare `lazy` on two routes | **Wrong** | none | `App.jsx:11` is `import lazy from './utils/lazyWithRetry'`. The two routes already have the same stale-chunk recovery as every other route. Nothing changed. |
| MINOR eager dark imports | Partly right, measured | `99c627e570` | See "Bytes" below. |

## C1: is it reachable in production today?

No. Measured on `origin/master` and `origin/production` (both `12704aa434`):
`ChartPlanPanel.jsx` does not exist there, the landing tip is not an ancestor, and the hook has one
caller, `StockChart.jsx`, which always hands it the symbol's one shared drawing list. Two charts on
a symbol therefore never disagree. After landing, the panel mounts only behind
`notebook_chart_plan_enabled` (`WidgetEmbedView.jsx`, `planDoors`), which is off unless armed. A
census rail in `ChartPlanPanel.alertOwnership.test.jsx` fails by name if the hook gains a third
caller.

## The real-browser check (C1 and I5)

Tool: `tools/notebook_fin_fe_walk.py`. Sandbox on port 8133 through `scripts/hub_sandbox_boot.py`,
chart-plan and fingerprint flags on, paid admin, synthetic bars (said so in the tool). Raw JSON is
under `docs/notebook/evidence/fin-fe/`.

| Run | Build | Result |
|---|---|---|
| `walk-run3-fixed-99c627e570` | this branch | 13 rows PASS, integrity CLEAN, port free |
| `walk-control-fixes-removed-2042d6a41e` | the two fixes taken out | the walk SAW both defects |

Fixed build: the member's Charts alert on AMD and a plan alert armed in the note both survive; no
DELETE is sent. Opening and leaving a note with an unfrozen chart sends no PUT, PATCH, POST or
DELETE to the note, no freeze request, and the note's `updatedAt` and chart block are unchanged.
The one request to the note's URL is `POST /notes/<id>/opened`, the Recents beacon from an earlier
wave, which does not write the note.

Control build: `DELETE /api/watchlist-alerts/bound/charts-line-1` and
`DELETE /api/watchlist-alerts/bound/nb:emb-a:note-line-1` were both sent, and zero alerts were left.
Viewing sent `POST .../emb-b/freeze` and then `PUT /api/j2/notes/<id>`, and `updatedAt` moved.

Runs 1 and 2 are kept as they were. Their failures were the instrument: the alert poll is ten times
slower outside market hours, and a bare `time.sleep` never lets Playwright deliver request events.

## I7: changes that are live with every flag off (verification only)

| Change | Introduced by | Lane document | Tested by | Verdict |
|---|---|---|---|---|
| Eight new built-in templates, walkthrough toggle | `d1f80c93e7` (12B) | `WAVE-12-PLAN.md` | `lib/notebookTemplates.test.js`, `notebookTemplates.buildable.test.js` | intended and tested |
| Trade Plan creates property definitions | `ca7424eb02` (13A), on 12B-2's mechanism | `wave13-13a.md` | `lib/templatePropertyDefs.test.js`, new `lib/tradePlanPropertyDefs.finFe.test.js` | intended and tested |
| "Today" button on Research Home | `70a29c9c72` (13Q-3) | `wave13-13q3.md` | `ResearchHome.test.jsx` | intended and tested |
| Roving tab stops | `affab4f5cd` (13Q-4) | `wave13-13q4.md` | `JournalLayout.rovingNav.test.jsx`, `BulkActionBar.rovingGroup.test.jsx`, `hooks/useRovingTabIndex.test.jsx` | intended and tested |
| Skip links | `70a29c9c72` (13Q-3) | `wave13-13q3.md` | `a11y/focusFlows.test.jsx`, `a11y/skipLinkUntappable.test.js` | intended and tested |
| Ctrl+Alt+B, Shift+Arrow | `64127beacb` (13Q-5) | `wave13-13q5.md` | `lib/bulkActionsShortcut.test.js`, `NotebookTab.bulk.test.jsx` | intended and tested |
| Create response seeds the note cache | `fb2079c44d` | `wave13-q1check.md` | `NoteEditorPage.wave13q1check.test.jsx` | intended and tested |
| Click on an embed body no longer selects the block | `0d11a14787` (13H-2) | `wave13-13h2.md` | `lib/widgetEmbedNode.test.js` | **a regression, fixed in round 2 (`33bbd56750`)** |

**Trade Plan.** It is idempotent: the second pick creates nothing. It can only list and create. It
reuses the member's own definition of the same name and type, and when the name is used for another
type it makes "Stop (number)" instead. A member's existing rows are byte-for-byte unchanged.

**Embed click (round 2, controller ruling: fix before landing).** Commit `0d11a14787` stopped every
mousedown on a block's body from reaching the editor. Its reason was Draw mode: the editor's
click-to-select refocuses the editor on mouseup, and the embed reads that focus as "done drawing",
so Draw mode ended after the first mark. The stop was unconditional, so with every flag off a click
on an archived image, or on a chart with no caption, no longer selected the block.

Fix (`33bbd56750`): the embed marks its body `data-widget-embed-body="draw"` only while Draw mode is
on, and the stop applies only to that. Out of Draw mode the body is the editor's to select, as
before the wave. Buttons, selects and inputs inside the block keep their own clicks. The `it.fails`
record is now a passing test, with the control cases beside it (`lib/widgetEmbedNode.finFe.test.js`,
7 tests; three mutations each went red).

Real browser, every wave flag OFF, `tools/notebook_fin_fe_select_walk.py`, evidence
`docs/notebook/evidence/fin-fe/select-walk-run3-33bbd56750/` (11 rows PASS, integrity CLEAN, port
free). Two blocks with no caption, a live chart and an archived image:

| | 1280 px, mouse | 390 px, touch |
|---|---|---|
| Archived image: click or tap selects | yes | yes |
| Archived image: then Delete, then undo | removed, restored | removed, restored |
| Archived image: drag by the body / long-press | moved above the first paragraph | long-press selects it; no menu opens |
| Live chart: click or tap selects | yes | **no** (see below) |
| Live chart: then Delete, then undo | removed, restored | not reached |
| Live chart: drag by the body / long-press | moved above the first paragraph | long-press selects nothing |
| Draw mode on, two clicks on the chart | Draw mode stays on, block not selected | not run |
| Click on a toolbar button | acts on the button, block not selected | not run |

Mouse drag, not measured in round 1: pressing on the body and dragging onto the first paragraph
moves the block there, for both kinds (`dragstart`, `dragover`, `drop`, `dragend` all seen).

**A live chart on a phone:** a tap on the middle of a live chart selected nothing, because the chart
library cancels the touch. Settled in round 3, below.

Not exercised in the browser: a button INSIDE the body (the walk's control button was the toolbar's
"Hide toolbar", outside it). The unit control covers a button, a select and an input inside the body.

Runs 1 and 2 of the selection walk are kept. Their failed rows were the instrument: run 1 dropped
the block where it already was; run 2 read a selection the drag test had left behind.

## A live chart on a phone or tablet (round 3)

**Is it a regression? No, from the code.** On `origin/master` (`8c416782d8`)
`lib/widgetEmbedNode.jsx:100` is `ReactNodeViewRenderer(WidgetEmbedView)` with no `stopEvent`, so
selection there also depends on the browser turning a tap into a mousedown. The chart library is
the same on both sides (`lightweight-charts` 5.2.0 in both `package.json` files) and its
`_touchEndHandler` calls `preventDefault` on the touch end, which is what stops the mousedown. This
branch's diff to `StockChart.jsx` adds no touch handling. So a live chart was not reliably
selectable by touch on master either. No pre-wave build was run.

**What existed for touch** (measured, every wave flag off, 390 and 820 px,
`docs/notebook/evidence/fin-fe/touch-actions-walk-run1-2fe3f39bdb/`):
- The block's toolbar is on screen without hover. Every control is 44 px tall; most are narrower
  than 44 px (Remove embed and Chart settings are 34 wide).
- Remove embed works by touch at both widths.
- Chart settings has a control. There is no caption control at any width: a caption cannot be
  edited from the block today.
- There was no move control. The block grip only stands beside the block the caret is in.
- Selection by tap is unreliable, not impossible. In round 2 a tap on the middle of the chart
  selected nothing (twice, at 390). In this run a tap lower on the chart at 390 did select it and
  the grip appeared; the same tap at 820 did not.

**What was built** (`2fe3f39bdb`): a "Block actions" button in the block's toolbar at 1024 px and
below. It is 44 by 44, opens the shared `ContextPopover` (a bottom sheet on touch) with Move up,
Move down and Remove block, and uses `moveBlock`, the same transaction as the grip and
Alt+Shift+Arrow. `StockChart.jsx` and the chart's touch handling are not touched. At 1024 px and
below the block's toolbar is now always shown, including on a narrow desktop window.

Browser, 13 rows PASS, integrity CLEAN, port free:

| | 390 px touch | 820 px touch | 1280 px mouse |
|---|---|---|---|
| Block actions button | 44 x 44, visible | 44 x 44, visible | not in the page, its file never requested |
| Sheet rows | three, 44 px tall | three, 44 px tall | |
| Move down, then Move up twice | one,two,CHART,three then CHART,one,two,three | same | |
| Move up at the top | disabled | disabled | |
| Remove block | block removed | block removed | |
| Toolbar's own Remove embed | works (34 x 44) | works (34 x 44) | shown on hover |

Bytes: the button is its own file, loaded only at 1024 px and below. Built first-open is 2,234,901
(budget 2,260,793). The round 1 build read 2,234,435; the 466 bytes between them cover everything
since, not this button alone. `components/notebook/EmbedBlockActions.test.jsx`: 9 tests, three
mutations each went red.

## The basics tour (wave 8): no history trap

Checked for the I1 defect. It does not have it. The basics tour never navigates, and it removes
`state.startTour` from the history entry with a replace when it reads it (`NotebookTour.jsx:156-159`).
New rail `onboarding/NotebookTour.back.test.jsx`, real tour over real history entries: the request
is spent when read and other state is kept; one Back returns to Help; Forward does not reopen the
tour; a reload does not replay it. It passed on first run, so nothing was changed.

## The sample plan note and the Plan panel (round 2)

Question from another walk: with all flags on, the sample notebook's AAPL plan note showed the
fingerprint panel but no entry, stop or target rows in the Plan panel. Instrument or product?

Both. Probe: `tools/notebook_fin_fe_sample_plan_probe.py`, evidence
`docs/notebook/evidence/fin-fe/sample-plan-probe-run1-55dc56c7aa/` (`SAMPLE.json`, `COMPARISON.json`).

- The levels ARE stored and the panel DOES render them: three rows (205.00 Target, 180.00 Entry,
  170.00 Stop), R:R 2.50R, risk per share $10.00. The server's own reading
  (`POST /api/j2/chart-plan/size`) agrees: entry 180, stop 170, target 205, 100 shares, long.
- The rows carry no `data-level-id`, so a walk that looks for `li[data-level-id]` finds none. That
  was the instrument.
- The reason they carry none is a product defect in the sample content. The sample stores each
  level as `{role, type: "horizontal", price}`: no `id` and no `points`. A line a member draws is
  stored as `{id, type, role, points: [{time, price}]}`. A comparison note with the same three
  levels in that shape rendered the same rows WITH ids.

What the missing fields break:
- Role buttons. `setPlanRole` matched by `d.id === drawingId`; with no id on either side that is
  true for every line, so pressing Stop on one row marked all three as the stop. **Fixed here**
  (`lib/chartPlan.js`: no id, no change; `lib/chartPlan.finFe.test.js`, red first, mutation-checked).
  After the fix the buttons do nothing on the sample note until the content is corrected.
- "Arm alert at this level" needs `points[0].price` and answers "This level cannot carry an alert
  yet." (read in code, `ChartPlanPanel.jsx` `armAlert`; not pressed in the probe).
- The chart overlay draws a line from its `points`, so the three lines the note's text promises are
  not expected to be drawn on the chart (read in code; not checked by pixel).

**Change needed in `api/services/journal_two/sample_examples.py` (lane DATA owns it; not edited
here).** In `_plan_note_body` and the second builder near line 236, write each level in the drawn
shape, with the time the chart block is frozen at:

```python
to = _unix_seconds_et_close(date.fromisoformat(as_of_day))
annotations = [
    {"id": "ex-plan-entry", "type": "horizontal", "role": "entry", "points": [{"time": to, "price": entry}]},
    {"id": "ex-plan-stop", "type": "horizontal", "role": "stop", "points": [{"time": to, "price": stop}]},
    {"id": "ex-plan-target", "type": "horizontal", "role": "target", "points": [{"time": to, "price": target}]},
]
```

No top-level `price`: `plan_extract` reads `price` first when present, and the frontend removes it
whenever a role is set (`lib/chartPlan.js` `withPlanRole`). Ids must be unique within the block.
Members who already added the sample keep the old shape until it is re-seeded.

## Bytes

Static import closure of `tabs/NotebookTab.jsx`, source bytes: 3,612,090 before, 3,555,477 after.
The community gallery with its admin panel, the publish form, and the tour offer gate now load only
when their flag is on and the member reaches them. Built first-open bytes after:
2,234,435 against a budget of 2,260,793 (`tools/notebook_perf_budgets.py`). No before build was
measured.

Measured and left alone: `ResearchHome.jsx:18` and the tour registry add nothing on their own
(already reached by other imports). `RegistryToursGate` stays eager in `Layout.jsx`: it adds about
11 kB of source to the shell, and loading it lazily would add a silent failure exactly where I6
removed one. `CompassReview` and `EODRecap` are not on the Notebook's first-open path.

## Not done

- "Replay modal without Escape" (lane A11Y).
- Template pick busy state, the thesis-chip poll, `draftDailyReview` and the daily template (the
  last is in lane DATA's file).
- A gate file that fails to load in `Layout` is not possible today (it is eager).

## Tests, round 2

`npx vitest run <14 named files> --maxWorkers=2` (every test that touches the embed view or node,
plus the tour navigation rails): Test Files 1 failed, 13 passed; Tests 1 failed, 197 passed. The one
failure is the same date-expired parking note described below.

## Tests

`npx vitest run <73 named files> --maxWorkers=2`: Test Files 1 failed, 72 passed; Tests 1 failed,
865 passed. The one failure is `components/screener/reachable.test.js` "NO BLOCK IS PAST ITS
EXPIRY": a chart-engine parking note dated 2026-10-06 that names five files under
`components/chart/engine`. It is date-triggered and none of its files are touched here. The other
16 tests in that file pass, including the reachability sweep over the new modules.

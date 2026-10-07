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
| Click on an embed body no longer selects the block | `0d11a14787` (13H-2) | `wave13-13h2.md` | `lib/widgetEmbedNode.test.js` | intended for live charts; **a regression for static images** |

**Trade Plan.** It is idempotent: the second pick creates nothing. It can only list and create. It
reuses the member's own definition of the same name and type, and when the name is used for another
type it makes "Stop (number)" instead. A member's existing rows are byte-for-byte unchanged.

**Embed click.** Measured in a real browser (`C_observations.json`): a click on the chart body
selects nothing. A click on the caption selects the block. A block with no caption had no surface
of its own that a click selects, other than the fingerprint panel, which is a dark feature. The
keyboard still works: one arrow press selects the block, then copy, cut and paste, Backspace and
undo all behaved. The toolbar's Remove button still deletes by mouse. Dragging a block by mouse was
not measured. The rule also covers archived images, which have no gesture to protect, so a click on
an archived chart image no longer selects it. `lib/widgetEmbedNode.finFe.test.js` asserts the old
behaviour and fails on this branch; it is written with `it.fails` so the suite stays green and
turns red when the behaviour is restored. Suggested fix, not made here: mark only a live body.

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
- The base tour (`NotebookTourGate`) was not checked for the same Back-button trap.
- A gate file that fails to load in `Layout` is not possible today (it is eager).

## Tests

`npx vitest run <73 named files> --maxWorkers=2`: Test Files 1 failed, 72 passed; Tests 1 failed,
865 passed. The one failure is `components/screener/reachable.test.js` "NO BLOCK IS PAST ITS
EXPIRY": a chart-engine parking note dated 2026-10-06 that names five files under
`components/chart/engine`. It is date-triggered and none of its files are touched here. The other
16 tests in that file pass, including the reachability sweep over the new modules.

# Wave 14, lane W14-B3: the research and setups tours

Branch `feat/notebook-w14-b3`, from `3c50c50013` (the finished W14-0 lane). Spec:
`docs/notebook/WAVE-14-PLAN.md` sections 4.2 (rows 15 to 21), 5, 6 and 11 (controller defaults
D1 to D8). The authoring contract and the anchor rule are the ones at the top of
`app/src/pages/journal-2-0/components/notebook/onboarding/tours/index.js`. No new flag: each tour
is gated by its capability's OWN flag (D5), and no engine file was changed.

| file (under `app/src/pages/journal-2-0/components/notebook/` unless noted) | what it is |
|---|---|
| `onboarding/tours/b3Research.js` | the track: seven thin entries, each `load()` a dynamic import |
| `onboarding/tours/*.steps.js` (seven) | `STEPS` and `COPY` per tour, loaded only when the tour is wanted |
| `onboarding/tours/index.js` | one import line, one spread line |
| `onboarding/tours/b3Research.test.jsx` | per tour: registered, loads, step count, copy, own flag, gate off/on |
| `onboarding/tours/b3Research.a11y.test.jsx` | `earnings-prep` through `GenericTourEngine` and the axe harness |
| `onboarding/tourRegistry.test.js` | two W14-0 rails that pinned "today" now admit `start` and the one passive explainer (section 4) |
| nine capability files | one `data-tour` attribute per step, nothing else (section 2) |

## 1. The tours

| tour id | flag | start | steps | anchor files |
|---|---|---|---|---|
| `ta-fingerprint` | `notebook_ta_fingerprint_enabled` | none (a chart block inside a note) | 4: summary, all fields, setup tag, plan this setup | `FingerprintPanel.jsx` |
| `visual-playbook` | `notebook_visual_playbook_enabled` | none (a sheet opened from a chart block) | 5: grid, card fingerprint, card outcome, slice stats, filters | `VisualPlaybook.jsx` |
| `setups-board` | `notebook_setups_board_enabled` | none (sibling route, see 3.1) | 5: card, distance, note link, find more like this, matches list | `BoardCard.jsx`, `SetupsBoard.jsx` |
| `earnings-prep` | `notebook_earnings_prep_enabled` | `/journal/notebook` | 4: list, when, why listed, draft a prep note | `ReportingSoon.jsx` |
| `transcript-capture` | `notebook_transcript_capture_enabled` | none (a sheet opened inside a note) | 5: turns, quote a turn, pick the call, find in call, thesis chip | `SaveTranscriptPassage.jsx`, `ThesisChip.jsx` |
| `passed-setups` | `notebook_passed_setups_enabled` | `/journal/notebook` | 3: list, what happened next, add one | `PassedSetups.jsx` |
| `note-resurfaces` | `awareness_note_resurface_enabled` | none (`?resurfaceVersion=` on one note) | 2, `replayable: false`: what you wrote then, your note is unchanged | `ResurfaceVersionSheet.jsx` |

Titles (Help > Walkthroughs): The technical fingerprint; Visual playbook; Active setups and find
more like this; Reporting soon and earnings prep; Transcript passages and thesis chips; Passed
setups; A note resurfaces (not listed, see 3.4).

### 1.1 Two rows name two flags. Which one gates, and why

* **Setups board + find similar: `notebook_setups_board_enabled`.** The plan's start is the
  board. The board's steps render only while the board flag is on; the two find-similar steps
  (`setups-similar` on a card, `setups-templates` on the page) render only while
  `notebook_find_similar_enabled` is on, so with that flag off they are skipped by the engine's
  existing "anchor not on screen, skip the step" rule and the tour is a clean three steps. The
  reverse gate would open a tour whose first three anchors cannot exist when only find-similar
  is on. Cost of the choice: a member with find-similar on and the board off gets no tour.
* **Transcript capture + thesis chips: `notebook_transcript_capture_enabled`.** Transcript capture
  is the only one of the two with a surface the engine can reach (the slash-menu sheet inside a
  note). A thesis chip renders on Journal position rows, the holdings list and Watchlists, none of
  which mount the engine, so a chip-gated tour could never open. The chip step is the last step
  and is skipped wherever no chip is on screen (today: always; see 3.2).

### 1.2 Step order follows load order

`GenericTourEngine` decides which steps a tour has ONCE, when it opens
(`open(availableSteps(content.steps))`); a step whose anchor appears after that is not in the
tour at all, not merely skipped. It waits (up to `START_WAIT_MS`) only for the FIRST step's
anchor. So every B3 tour's first step is the element that appears LAST on its screen: the frozen
summary (fingerprint), the card grid (playbook), a board card, the reporting list, the speaker
turns, the passed list. The tour then opens with everything else already present.

### 1.3 Copy

Plain and short, for traders; no em or en dashes (the per-tour test rejects both). Every number
in the copy is one the capability itself uses: the playbook's 10 and 25 trade bands, the passed
setups' 1/5/10/20 sessions and the 10-session traded window, Reporting soon's seven days and
three weeks, resurfacing's 8% move.

## 2. Capability files touched (one attribute per step, nothing else)

`git diff 3c50c50013 -- <file>` for each shows only the lines carrying the new attribute,
inserted inline into an existing opening tag (28 attributes, 28 changed lines):

| file | anchors |
|---|---|
| `FingerprintPanel.jsx` | `fp-summary`, `fp-all-fields`, `fp-setup-tag`, `fp-plan` |
| `VisualPlaybook.jsx` | `vp-grid`, `vp-card-fields`, `vp-card-outcome`, `vp-stats`, `vp-filters` |
| `BoardCard.jsx` | `setups-card`, `setups-distance`, `setups-note`, `setups-similar` (the StockChart props are untouched) |
| `SetupsBoard.jsx` | `setups-templates` |
| `ReportingSoon.jsx` | `reporting-soon-list`, `reporting-soon-when`, `reporting-soon-sources`, `reporting-soon-prep` |
| `SaveTranscriptPassage.jsx` | `transcript-turns`, `transcript-quote`, `transcript-call`, `transcript-find` |
| `ThesisChip.jsx` | `thesis-chip` (the chip component in the Notebook directory; PositionsTable, HoldingsList and Watchlists are not touched) |
| `PassedSetups.jsx` | `passed-list`, `passed-outcomes`, `passed-add` |
| `ResurfaceVersionSheet.jsx` | `resurface-then`, `resurface-back` |

No `StockChart.jsx`, broker, positions or flow file was edited. `reporting-soon-prep` sits on the
Create button only: a name prepped in the last three weeks shows Open instead and that step is
skipped, which the step's copy says.

## 3. Open items (for W14-C unless noted)

### 3.1 The setups board tour cannot run anywhere today

`/journal/notebook/setups` is a SIBLING route (`App.jsx`, `notebook/setups` → `SetupsBoard`), not
a view inside `NotebookTab`, and `RegistryToursGate` is mounted only by `NotebookTab`. So no
engine is on the page that holds the tour's anchors. Two consequences, recorded rather than
worked around:

* `start: '/journal/notebook/setups'` would PASS `assembleRegistry`'s check (it starts with
  `/journal/notebook/`) and would be wrong: the engine would navigate there and unmount itself,
  and Help's Replay would land on a page with no gate. The registry's start check cannot tell a
  NotebookTab view from a sibling route. No start is set.
* With no start, a Help Replay opens the tour at the Notebook root, waits `START_WAIT_MS` for a
  board card that is not there, and closes with nothing recorded.

The fix is outside this lane: mount the gate on the setups page (or in the Journal layout), or
narrow the start rule. 13J's own open item still stands too: no nav entry links to the page.

### 3.2 The thesis-chip step has no screen the engine can see

Chips render on Journal positions, the holdings list and the Watchlists widget. None mounts the
engine, so step 5 of `transcript-capture` is skipped every time today. The anchor is placed so
the step works the day the gate is mounted where chips render.

### 3.3 Tours that start inside one note have no `start`

`ta-fingerprint`, `visual-playbook`, `transcript-capture` and `note-resurfaces` start on a chart
block, a sheet opened from one, the transcript sheet, or a resurfaced version: all inside one
particular note, which a static path cannot name. Opened from Help at the Notebook root they wait
`START_WAIT_MS` and close with nothing recorded, unless the member is already on that screen with
the sheet open. A contextual open ("offer when the anchor first appears") is W14-C's trigger.

### 3.4 The passive explainer: expressible as data, not as a passive presentation

`note-resurfaces` is a valid entry (`replayable: false`, two steps), so the data form works and
is railed. What the current contract and engine cannot do without an engine change:

1. **Step count.** The contract text says steps are "3 to 6"; plan row 21 says 1 to 2. No rail
   enforces the count, so the entry is accepted; the contract text and the plan disagree.
2. **Presentation.** `GenericTourEngine` renders every entry as the modal stepper: "Step 1 of 2",
   Skip tour, Back, Next/Done, `aria-modal`, a Tab trap. Nothing in the entry can ask for a
   non-modal, non-stepping explainer.
3. **Reachability.** Help lists only replayable tours, and nothing auto-starts a registered tour
   until W14-C. So `note-resurfaces` is registered, gated, anchored and currently unreachable.

### 3.5 A tour over an open Sheet (read from the code, not measured)

`visual-playbook`, `transcript-capture` and `note-resurfaces` run while a `Sheet` is open. `Sheet`
and `GenericTourEngine` both add a capture-phase `keydown` listener on `document`, the Sheet's
first. Escape: the Sheet's handler closes the Sheet and calls `stopPropagation`, which does not
stop a second listener on the same node, so the engine closes the tour too; one Escape closes
both. Tab: each traps to its own container. Neither is measured here; W14-Q's keyboard walk is
where it gets settled.

### 3.6 Smaller items

* **Home tours and an open note.** `atStart('/journal/notebook', location)` is true for any URL
  on that path, including `?note=<id>`, so a member on an open note is not navigated to Home;
  the Reporting soon and Passed setups tours then wait and close. An engine question (W14-C).
* **`a11y/notebookSurfaces.js`.** Plan 5.4 asks for an entry per tour; that manifest is keyed by
  component file and tours are data, so no entry was added. The axe check in
  `b3Research.a11y.test.jsx` covers the engine with this track's copy. For W14-Q.
* **Merge note.** The two `tourRegistry.test.js` rails edited in this lane (section 4) are the
  same lines any other W14-B track using `start` must change; expect a trivial conflict.

## 4. Tests and rails

| rail | proves |
|---|---|
| `tourAnchors.test.js` (unchanged) | covers all seven B3 tours by iterating `TOUR_REGISTRY`: 8 registry cases, one per tour plus the base |
| `tourRegistry.test.js` | the field rail now reads `OPTIONAL_FIELDS` instead of a fixed list; "every entry replayable" became "every entry except `note-resurfaces`, which must be 1 to 2 steps" |
| `b3Research.test.jsx` (31 tests) | the seven ids in plan order reach `TRACK_TOURS` and the registry; the track file has no static steps import and seven dynamic ones; only `note-resurfaces` is hidden from Help; per tour: step count (4/5/5/4/5/3/2), unique step ids, a title and body for every step, no em or en dash, `entry.flag` is the literal the capability's own file reads; per tour through `makeRegistryToursGate`: flag off nothing fetched, flag on it opens |
| `b3Research.a11y.test.jsx` (3 tests) | `earnings-prep` with its real anchors and real copy through `GenericTourEngine`: non-vacuity (all four anchors present), first step and last step with zero axe violations |

Targeted runs (each `--maxWorkers=2`):

```
npx vitest run src/pages/journal-2-0/components/notebook/onboarding --maxWorkers=2
 Test Files  17 passed (17)
      Tests  194 passed (194)

npx vitest run <the eight capability test files touched by an anchor> --maxWorkers=2
 Test Files  8 passed (8)
      Tests  60 passed (60)
```

### 4.1 Anchor rail mutation

Removed `data-tour="reporting-soon-when"` from `ReportingSoon.jsx` and ran `tourAnchors.test.js`:

```
× tour earnings-prep: every step's anchor appears EXACTLY once in its named file
AssertionError: earnings-prep step when: data-tour="reporting-soon-when" appears 0 times in
components/notebook/ReportingSoon.jsx ...
Tests  1 failed | 23 passed (24)
```

Restored by re-applying the original text (not `git checkout`); `sha256sum -c` against the hash
taken before the mutation printed `ReportingSoon.jsx: OK`, and the rail plus the tours directory
went back to `Tests 66 passed (66)`.

### 4.2 The full run

One run at `1f44343c94`, `--maxWorkers=2`, on a box shared with four other agents:

```
npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2
 Test Files  2 failed | 609 passed (611)
      Tests  2 failed | 7695 passed | 1 skipped (7698)
   Duration  1314.04s
```

Both reds are environment, neither is a B3 file, and both pass afterwards:

* `lib/iteratorGlobalFloor.test.js` "every built asset is clear": `app/dist/assets missing`. This
  rail reads BUILT output and a fresh worktree has none. After `npm run build` (exit 0; each of
  the seven `*.steps.js` files is its own chunk, e.g. `earningsPrep.steps-<hash>.js`, so the step
  data is lazy in the real bundle too) it passes.
* `lib/mathNodes.test.js` "KaTeX is imported by katexRender.js ONLY": the run's one
  `Test timed out` line. It passes alone, which is load, the same file W14-0 recorded as
  load-sensitive.

```
npx vitest run src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js src/pages/journal-2-0/lib/mathNodes.test.js --maxWorkers=2
 Test Files  2 passed (2)
      Tests  41 passed (41)
```

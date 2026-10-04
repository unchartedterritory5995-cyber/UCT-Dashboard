# Wave 14, lane W14-D: the "get started" checklist

Branch `feat/notebook-w14-d`, base `ca1ede46fb` (the W14-0 checkpoint). Spec:
`docs/notebook/WAVE-14-PLAN.md` section 4.4 (the checklist), 4.1 (it mounts on the
first-run welcome and stays "until the member dismisses it or finishes it"), 5.3 to 5.6,
section 7's W14-D row, and section 11's controller default **D4**: *"The checklist stays
closed once dismissed; a newly armed capability appears under Help's 'What's new' instead
of reopening it."* Flag `NOTEBOOK_GETTING_STARTED_ENABLED`, unset = OFF, and the list
shows only while BOTH it and `NOTEBOOK_ONBOARDING_ENABLED` are on (controller ruling,
round 2; section 8).

| file | what it is |
|---|---|
| `app/src/pages/journal-2-0/components/notebook/onboarding/gettingStarted.js` | the rules, pure: the copy, `ownHomeNotes`, `isTemplateNote`, `deriveChecklistItems` |
| `.../onboarding/gettingStartedPref.js` | the ONE preference key and its reader/writer, shared by the gate and the list |
| `.../notebook/GettingStartedChecklist.jsx` | the small EAGER gate Research Home imports; fetches the list's chunk only for a member it is for |
| `.../notebook/GettingStartedList.jsx` + `GettingStartedList.module.css` | the lazy list itself |
| `.../notebook/ResearchHome.jsx` | one import line and ONE mount line |
| `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` | two manifest rows (recipe + coveredBy) |
| `api/routers/auth.py` | one `_PREFERENCE_KEYS` row (`notebook_getting_started`) and one `NOTEBOOK_FLAGS` row (`NOTEBOOK_GETTING_STARTED_ENABLED`) |
| flag roster | `notebookFlags.js` `FLAG_FALLBACKS`, `tests/test_notebook_flags.py`, `tools/notebook_switch_rehearsal.py`, `docs/feature_flags.json` (dark), `docs/notebook/BETA-HANDOFF.md` section 1c |
| rails | `gettingStarted.test.js`, `GettingStartedChecklist.test.jsx`, `GettingStartedList.lazy.test.js`, `ResearchHome.checklist.test.jsx`, `a11y/gettingStarted.a11y.test.jsx`, one new case in `tests/test_preference_key_validation.py` |

## 1. What shipped (member-facing)

A small card titled **Get started** with a progress line (*"1 of 4 done"*), a **Hide**
button, and one line per step:

- **Write your first note** -- runs the Notebook's own create (Research Home's
  `onCreateNote`, the same handler as the first-run "Start a note" button).
- **Start a note from a template** -- a link to `/journal/notebook?view=all`, which shows
  the template picker inline for an empty notebook and a Templates button otherwise.
- **Open the sample notebook** -- runs Research Home's OWN `addSample` (passed in, so
  there is one authority for that write). Offered only where it can be had: the
  onboarding flag on, a paid member, no notes yet (the server refuses the sample to a
  member with notes). Once added it shows ticked.
- **Take the {title} tour** -- one per registered, replayable tour whose capability flag
  is armed, in registry order. Today the registry holds only `notebook-basics`, so this
  is *"Take the Notebook basics tour"*, which opens through `openNotebookTour()`; any
  other tour opens through `openRegistryTour(id)`.

A ticked step shows a check mark, muted text and a screen-reader "Done"; it is no longer
a control.

## 2. What ticks a step -- the member's real action, never a click on the list

Every `done` is read off an authority that already exists (`deriveChecklistItems`,
`gettingStarted.js:121`):

| step | ticked when | authority |
|---|---|---|
| note | the Notebook has notes AND, if a sample exists, at least one note on Research Home's aggregated read is not one of the sample's tracked ids (`gettingStarted.js:128`) | `hasAnyNotes` (NotebookTab's count) + `/api/j2/notebook/home` + `notebook_sample` |
| template | one of those own notes carries the walkthrough every catalog template ends with (`WALKTHROUGH_TITLE`, `isTemplateNote`, `:95`) | `bodyPlain` on the home read; a rail builds every catalog template and proves the title survives `extractPlainText` |
| sample | `notebook_sample` holds tracked ids | `sampleNotebook.readSamplePref` |
| tour | that tour's own seen-state says `done` -- the base tour's `notebook_tour`, every other tour's row in `notebook_tours` | `tourPref.readTourPref` / `tourSeenState.readTourState` |

A click only opens the door. `GettingStartedChecklist.test.jsx` has a "click does not
tick" case for every action, each asserting zero preference writes and an unchanged
progress line. A dismissed or skipped tour does not tick its step; only `done` does.

## 3. The one preference key, and D4

`notebook_getting_started` = `{v: 1, done: [step ids], state?: 'dismissed' | 'done', at?}`
(`gettingStartedPref.js`). Every write is a `setPrefMerged`, so the three writers merge:

- **A step never unticks** (round 2). The first time a step's evidence shows it done, its
  id joins `done`, and `deriveChecklistItems` honours a recorded id whatever the evidence
  says later -- so Research Home's capped home read can no longer take a step back. Each
  id is attempted at most once per mount, so a refused write is not retried on every
  render (railed: a 400 endpoint sees exactly one POST).
- **Hide** closes it as `dismissed`, keeping `done`.
- **Every step ticked** closes it as `done`, once (a ref guard plus the closed read).

**D4:** either state closes the list for good. A capability that arms later adds a tour
step to the derivation, but a closed list never reopens for it; two rails arm a second
tour against a dismissed and a done record and see nothing render. `done` is recorded
rather than derived for the same reason: a finished list would otherwise reopen the day
a new tour armed.

The key is a new one, so `api/routers/auth.py` gains its `_PREFERENCE_KEYS` row in the
same commit as its writer. `tests/test_preference_key_validation.py::
test_the_getting_started_checklist_key_is_written_by_the_client_and_accepted` asserts the
derivation READS the key from the list's `setPref(` call site, the real router stores and
serves the exact value, and a near-miss key is still refused by name. Mutation: deleting
the row reds both that case and the generic accept rail, by key name.

## 4. Where it mounts, and why there

```jsx
<GettingStartedChecklist hasAnyNotes={hasAnyNotes} onCreateNote={onCreateNote} onAddSample={isPaid ? addSample : null} />
```

The line is the last child of Research Home's `sampleNotice` fragment. That fragment is
rendered on the first-run screen (below the welcome buttons) AND in all three home states
after it (quiet with an error, quiet, full), so one line gives the plan's "visible on
first run and from then on". A mount inside the first-run branch only would vanish the
moment the member wrote their first note, the very step it exists to tick.
`ResearchHome.checklist.test.jsx` proves both placements and the flag-off absence.

W14-A is redesigning the first-run branch in parallel and leaving a mount point; if it
moves this line there, it must stay in a position that also renders once notes exist.

## 5. The first-run stage, keyboard, phones

- **Stage coordinator (plan 5.6).** The list is page content in normal flow: never
  portaled, never fixed. It does **not** claim the stage. Claiming is for a floating
  first-run card; a list that can stay on screen for days would hold the "Meet Compass"
  card back for all of them. A card that takes its own page space cannot stack on
  another. Rails: the list never holds the stage, renders the same while a tour holds it,
  and its stylesheet carries no `position: fixed | absolute | sticky`.
- **Keyboard.** Native buttons and one link, in reading order (Hide, then each step).
  A rail tabs through all five and activates a step with Enter.
- **Touch tier.** Every control and row gets `min-height: var(--tap-min)` (Hide also
  `min-width`) under `@media (max-width: 1024px)`, so phone (390) and tablet (820) are
  both covered; `styles/tapFloor.test.js` passes. Existing tokens only, no literal
  colour; the global `:focus-visible` ring is the focus indicator, and the contrast
  audit adds no row for the new stylesheet.
- **Bytes.** The Notebook's first-open closure is already over its budget at the base
  (W14-0's own `bytes-after.json`: 2,283,705 B against 2,260,793 B), and budgets are
  never raised to fit a reading. So the list is a chunk behind an eager gate, the same
  split NotebookTourGate makes: the gate imports only `usePreferences`, the flag reader,
  `lazyChunk` and the tiny pref module; the list is fetched only when the flag is on, the
  preferences have loaded and the list is not closed (a dismissed member never downloads
  it); a failed fetch is one in-place retry (`lazyLeaf`), then a locally declared
  boundary renders nothing. `GettingStartedList.lazy.test.js` proves by AST that nothing
  imports the list or its rules statically.

## 6. Decisions (the lane's own) and open questions

1. ~~No new flag~~ -- superseded by the round-2 ruling: its own dark flag (section 8).
2. Help's "What's new" (D4's other half) belongs to W14-C (controller ruling).
3. A registered tour whose anchors are not on Home closes at once when opened from the
   list; W14-0 is fixing it (controller ruling).
4. ~~A step could untick~~ -- fixed in round 2: the done-set is recorded (section 3).
5. **Pre-existing, not this lane's:** `notebook_tours` has no `_PREFERENCE_KEYS` row, so
   `test_every_key_the_client_writes_is_still_accepted` is red at the base.
6. If W14-A moves the mount line, it must stay somewhere that renders once notes exist
   (noted for W14-A).
7. **Not done here:** the click-budget flow and the real-browser walk belong to W14-Q.

## 7. Verification -- cited exactly

`npx vitest run src/pages/journal-2-0 src/pages/Support` from `app/`, totals lines copied:

| run | Test Files | Tests |
|---|---|---|
| before (base `ca1ede46fb` + this lane's first files landing mid-run) | `9 failed \| 599 passed (608)` | `12 failed \| 7611 passed \| 1 skipped (7624)` |
| after, run 1 | `7 failed \| 606 passed (613)` | `10 failed \| 7663 passed \| 1 skipped (7674)` |
| after, run 2 (final tree) | `7 failed \| 606 passed (613)` | `44 failed \| 7629 passed \| 1 skipped (7674)` |

Reading them, by name rather than by count:

- **The "before" run is contaminated by one of this lane's own files.** `surfaceCoverage`
  failed naming `components/notebook/GettingStartedChecklist.jsx`, which was written while
  that run was going. The clean base is therefore 11 failed in 8 files: focusFlows (new-note
  focus), notebookContrast x2, seedParity x3, notebookSchema.rail, platform, plus
  iteratorGlobalFloor (it reads `app/dist`, which this worktree has never built),
  doorEnumeration and one f5p1OwnerSendsQueued case.
- **After run 1** added one failure of this lane's own: `ariaCoverage` named the new eager
  gate, which has no markup of its own. It is now in `EXEMPT` with its reason, and
  `ariaCoverage.test.js` reads `Tests  7 passed (7)`.
- **After run 2** is the final tree. Its 44 are the same 9 pre-existing failures as above
  (focusFlows, notebookContrast x2, seedParity x3, notebookSchema.rail, platform,
  iteratorGlobalFloor) plus 35 in `lib/offline/f5p1OwnerSendsQueued.test.jsx`, every one a
  15 s timeout / "Unable to find ... placeholder Title" under load. Run alone on the same
  tree it reads `Tests  35 passed (35)`; run 1 had it green and the base run had one of
  its cases red. Load-sensitive, not this lane's (it touches no file that test imports).
- **No new failure.** notebookContrast's received list contains no row from
  `GettingStartedList.module.css`.

Lane-scoped runs on the final tree: the four new frontend rails plus Research Home's
suites, the onboarding directory, surfaceCoverage, NotebookTab.lazyViews and tapFloor --
`Test Files  27 passed (27)`, `Tests  232 passed (232)` before the gate split;
`GettingStartedChecklist.test.jsx` `Tests  22 passed (22)` after it.

`python -m pytest tests/test_preference_key_validation.py -q` -- before `1 failed, 24
passed`, after `1 failed, 25 passed`. The one failure in both is
`test_every_key_the_client_writes_is_still_accepted` refusing `notebook_tours` (open
question 5); with this lane's row it no longer lists `notebook_getting_started`.

### Mutations (each run, seen red, restored from a captured copy and the restore checked by sha)

1. `checklistClosed` answers only `dismissed` -> 2 red: the pure D4 rail and "a list
   closed as done stays closed when a new capability arms later".
2. The `notebook_getting_started` row deleted from `_PREFERENCE_KEYS` -> the new pytest
   case and the generic accept rail both red, naming the key.
3. The gate stops reading the closed key -> "a dismissed member never downloads the
   list" red.

`python tools/check_repo_hygiene.py`: clean (no line-ending flip against the stored blobs).

## 8. Round 2 (controller rulings): its own dark flag, and a step never unticks

**The flag.** `NOTEBOOK_GETTING_STARTED_ENABLED` mirrors every client-only Notebook gate
(the trade-canvas row is the precedent): a `NOTEBOOK_FLAGS` row in `api/routers/auth.py`
(default `False`), so it rides `_access_payload` as `notebook_getting_started_enabled`,
read per request; `FLAG_FALLBACKS` in `notebookFlags.js` (`false`, latched per tab); the
payload-key list in `tests/test_notebook_flags.py`; a dark reason in
`tools/notebook_switch_rehearsal.py`; a `dark` entry in `docs/feature_flags.json`; and a
row in `BETA-HANDOFF.md` section 1c. No route, so no server gate function and no census
row. `checklistEnabled(flag)` (`gettingStartedPref.js`) is the one predicate the gate
and the list both ask: onboarding AND its own flag, each exactly `true`.

Rails, both states: the list and the eager gate render nothing (and the gate downloads
nothing) with the checklist flag off and onboarding on, and with onboarding off and the
checklist flag on; Research Home shows it only with both on.

**Never untick.** See section 3. The rail that fails on the old behaviour: "a recorded
step stays ticked after its evidence leaves the home read" (a sample present, the
member's own notes no longer on the home read, `done: ['note','template']` recorded:
3 of 4 done, neither action offered), plus the pure version in `gettingStarted.test.js`.

Mutations, each seen red and restored by sha: dropping the recorded-done override in
`deriveChecklistItems` -> 2 red (both never-untick rails); `checklistEnabled` reading
onboarding only -> 4 red (the pure predicate, the list, the gate, Research Home).

Round-2 runs, totals copied:

- `npx vitest run src/pages/journal-2-0 src/pages/Support`: `Test Files  7 failed | 606
  passed (613)`, `Tests  10 failed | 7673 passed | 1 skipped (7684)`. All ten are the
  pre-existing set (focusFlows, notebookContrast x2, seedParity x3, iteratorGlobalFloor,
  notebookSchema.rail, platform, doorEnumeration -- the last also red in the base run).
- Lane-scoped: `Test Files  30 passed (30)`, `Tests  296 passed (296)`.
- `python -m pytest tests/test_preference_key_validation.py tests/test_notebook_flags.py
  tests/test_notebook_flag_parse.py -q`: `2 failed, 246 passed`. Both pre-existing:
  `notebook_tours` (above) and `test_NO_notebook_flag_is_read_outside_the_one_parse`,
  which names `tools/notebook_w14_0_walk.py:195` (W14-0's walk tool).
- `python -m pytest tests/test_feature_flag_ledger.py tests/test_flag_ledger_knobs.py
  tests/test_notebook_flag_table_form.py tests/test_notebook_switch_rehearsal.py
  tests/test_visibility_flag_ledger.py tests/test_vite_flag_ledger.py -q`: `2 failed, 419
  passed`. Both pre-existing: `test_every_notebook_capability_is_visible_to_the_index`
  for `NOTEBOOK_ASK_INSERT_ON` and `NOTEBOOK_ONBOARDING_ENABLED`, which name
  `tools/notebook_w13q_clicks.py` and `tools/notebook_w14_0_walk.py` respectively.

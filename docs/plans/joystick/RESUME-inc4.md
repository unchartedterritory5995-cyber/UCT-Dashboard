# RESUME — joystick hub Increment 4

**Created 2026-09-10.** Branched from `feat/joystick-increment-3` @ `a2156f310`, so it carries
B7-B9 and the folded-in deploy watcher. It rebases onto master once Increment 3 merges.

## State

| | |
|---|---|
| Branch | `feat/joystick-increment-4`, from `a2156f310` |
| Worktree | `C:\Users\Patrick\uct-worktrees\joystick-inc4` |
| Depends on | Increment 3 merging first; rebase onto that master before any full gate |
| Gate policy | ⛔ NO full gate on this branch until Increment 3 is merged and this is rebased onto that master. Targeted per-B runs until then. |
| Deploy | ⛔ None. The word for Increment 4 comes later. |

## ⛔ RULE 12 — AMENDED FOR THIS INCREMENT

The observation-window basis is gone: the notebook workstream flipped its flag. Rule 12 now permits
**exactly one** notebook-side edit:

    data-note-card-id={note.id}   on the grid note card's root element

...plus its rail. **Nothing else under `app/src/pages/journal-2-0/**`, and nothing in
`NotebookTab.jsx`.** `rule12Paths.test.js` is updated to allow that one file with that one diff
shape, and mutation-proved in both directions: a second file under the prefix goes red, and a
change to the permitted file that is not the permitted shape goes red.

**H1 is now:** any notebook-side need BEYOND that attribute.

## Order

- **B12** — the attribute + rail. Closes R-18.
- **B13** — Phase 4 settings UI (§8, core item #11): controls for the nine keys already in
  `useHubSettings` defaults — `enabled`, `handedness`, `haptics`, `holdMs`, `travelPx`,
  `doubleTapMs`, `stickyFan`, `highContrast`, `overrides` — inside the existing admin-gated
  `JoystickSettingsCard`, persisted through the existing preferences path. A rail per control:
  render, change, persisted value read back. ⛔ Rule 11 sweep of every render site of the card
  BEFORE touching it. ⭐ This is the item most likely to turn the owner's "it works but it's buggy"
  into tuning rather than defects.
- **B10/B11** — the notebook controller and cursor, exactly as scouted and ruled: hub-side mounted,
  `applyTargetToParams` with push, the Q2/Q4/Q5 rails, the `PREVIEW_MODES` flip with the
  both-directions membership rail, the B4 manifest +1 with four mutation proofs, and the cursor with
  `tapHint: 'tap: next note'` wired to the advance.
- **3.5a and 3.6a scouts** — read-only, reported here with numbered questions and recommendations.
  No code.

## The 3.7a scout — carried forward, still valid

Verified 2026-09-10 against `febe8ee67`; none of these files moved in master's charts program.

- **The read**: `NotebookTab.jsx:62-63` — `const [searchParams, setSearchParams] = useSearchParams()`
  / `const noteId = searchParams.get('note')`. A raw string id; absent or unknown is not handled at
  the read site.
- **`clearNoteParam`**: `NotebookTab.jsx:365-369`, `{ replace: false }` -> **push**. Fires when a
  folder or tag is chosen while a note is open. `closeNote` (`:352-361`) is a different function,
  same shape plus three refreshes. Four `note` writers: `:340` set, `:355`/`:367`/`:387` delete.
- **The seam**: `applyTargetToParams(params, target)` (`journal-2-0/lib/searchNavigation.js:86`),
  pure and exported, DELETES `PARAM_DOC`/`PARAM_PAGE`/`PARAM_EXCERPT`/`PARAM_REVIEW` before setting
  `PARAM_NOTE`. Hand-rolling `params.set('note', id)` would leave a stale `?doc=&page=` pointing
  into a different note.
- **Other readers**: `lib/captureContext.js:26` (`noteIdFromLocation`); `j2tabRedirect` preserves
  the param; tests in `searchNavigation.test.js` and `j2tabRedirect.test.js`.
- **The five actions** (`registry.js:393-447`): `newNote`/`linkTicker`/`templates` are `kind:'run'`
  with no run body; `dailyPlan`/`postMortem` are `kind:'navigate'` to `?new=daily-prep` /
  `?new=trade-review`, both stable template keys (`lib/notebookTemplates.js:19`) that already work.
- **Rulings Q1-Q8 stand**: push; `applyTargetToParams`; `newNote`+`templates` write and the B4
  manifest grows by one `POST /api/j2/notes`, `owner:'app'`, via `lib/noteCreation.js`;
  `linkTicker` deferred (R-17); `paintCursor` with a selector rail; no off-route guard, a rail
  instead; Home needs nothing; flip `PREVIEW_MODES` last.

## Open requests this increment closes or carries

- **R-18** — `NoteCard` renders no note identity. **Closed by B12.**
- **R-17** — `linkTicker` has no symbol source on its route. **Carried**: either the route gains a
  symbol, or the entry is removed with a comment citing R-17. Ring layout if removed: outer 3 -> 2,
  inner stays 4; both legal.

## Open items carried from Increment 3

- the owner's real-glass bug lines from Increment 2 (still pending; file verbatim in `requests.md`)
- the post-deploy check of B9 on production
- R-13 (`scan.scans` ships ABSENT), R-15 (Screener cursor invisible)
- transitive-dataflow rail · `HubActionsButton` haptic on the WCAG path · `scan.flag` §C2 exception
- CI device job · iOS visual escalation · `require.main` guard on the device runner
- BrowserStack Automate quota · server-side preference-key validation · D-35
- core remainder after this increment: 3.5 Chart, 3.6 Catalysts, 3.8 Home scrub, 3.9 Flow verify,
  Calendar (dark, per R-C)

## Concurrency — streams and file ownership

`feat/joystick-increment-4` is the INTEGRATION branch. Streams branch off its tip into their own
worktrees and merge back in the order A -> C -> D -> E. **A stream that needs a file another stream
owns STOPS (H8) rather than editing it.** Full gates run one at a time (CPU); targeted runs are
unlimited.

| Stream | Where | Owns | Scope |
|---|---|---|---|
| **A** (main) | `joystick-inc4` | `hub/sections/notebookSection.js`, `hub/useHubCursor.js` if needed, its rails | B11 — cursor over note cards, Q4 selector rail against the real component, tapHint wired to advance |
| **B** [sub] | `inc4-scout` | **nothing** — reports only | 3.5a Chart + 3.6a Catalysts scouts, read-only |
| **C** [sub] | `inc4-screener` | `hub/sections/screenerSection.js`, `pages/screener/shell/*.jsx`, `components/screener/*.jsx`, its rails | R-13 `scan.scans` picker seam · R-15 the visible cursor |
| **D** [sub] | `inc4-home` | `hub/sections/homeSection.js`, **only** the `home`/`calendar` declarations in `registry.js`, its rails | 3.8 Home scrub + Calendar in the inner ring (R-C) · 3.9 Flow verify-only |
| **E** [sub] | `inc4-sweep` | `hub/HubActionsButton.jsx`, `hooks/useKeyboardVisible.js`, `C:\tools\hub-devicetests\tests\run.js`, its rails | WCAG-path haptic · `require.main` guard · the `useKeyboardVisible` measurement |

⚠️ **`registry.js` is shared** between D (home/calendar) and A (notebook, already committed). D's
diff is bounded to the `home` mode's declaration; anything wider is H8.

⛔ **H8** — a stream needs a file outside its ownership. **H9** — two streams' merges conflict:
resolve nothing, report the conflict.

**Sequencing:** the 15:50 ET Increment 3 window job has absolute priority. Every stream pauses at
its next clean commit when it fires. After Increment 3 is live, the integration branch rebases onto
that master (backup ref) and stream merging resumes. Increment 4's full gate runs on the rebased
integration branch only.

**Evidence:** emulated rows per stream, plus ONE combined three-part glass script at the end
(notebook cursor + tap-advance · screener cursor + scan picker · home scrub) against a seeded
`:8077`, so the owner does one phone session rather than three. That session is Increment 4's
pre-merge requirement — B11, C's cursor and D's scrub are all new consumption paths with no
Increment 1 carrier.

# Wave 14, lane W14-Q1: the non-tour onboarding surfaces, measured in a real browser

Branch `feat/notebook-w14-q1`, from `c55d73ae69` (the W14 integration record), with
`origin/feat/notebook-w14-c2` merged first (`8be4c04dd7`, one merge commit, no conflicts). Spec:
`docs/notebook/WAVE-14-PLAN.md` section 6 (6.1 click budgets, 6.2 real-browser walks, 6.3 a11y) and
5.3 to 5.6. Scope: the first-run welcome (capability preview, sample promotion), the get-started
checklist, the tour offer prompt, Help > Walkthroughs and What's new, and the base tour with its
cold-load Replay fix. The capability tours themselves are lane Q2's.

| commit | what |
|---|---|
| `8be4c04dd7` | merge `origin/feat/notebook-w14-c2` (offer-once prompt, Help What's new, cold Replay fix) |
| `450e6257a7` | the walk tool, the clicks tool, the Help tap-floor fix + rail, the What's new rail repair |
| `2583c23ee1` | clicks tool: offer flows start keyboard navigation from the top of the page |
| `bffa95ea72` | raw evidence, committed before this summary (R-RAW) |
| (this commit) | this record |

## 1. Tools

| tool | what it is |
|---|---|
| `tools/notebook_w14_onboarding_walk.py` | the walk. Boots `notebook_perf_harness.Sandbox` (W14-0's recipe), one FRESH paid member per width (1200, 820, 390; 820 and 390 with touch). Per surface: an element PNG (palette-quantised), horizontal overflow (document, body, the app's scroll container, and any surface element past the viewport), touch targets at `<= 1024` px against `--tap-min` read from the page's computed style in BOTH dimensions, first-run stacking (tour dialog + offer card + any other card in the first-run slot, at most one), keyboard-only reach (real Tab presses until every enabled control in the surface has held focus), and axe-core 4.13.0 (the repo's pinned copy; wcag2a/aa, 21aa, 22aa and best-practice). A second sandbox with the two onboarding gates UNSET is the control. |
| `tools/notebook_w14q_clicks.py` | the click budgets. A sibling of `tools/notebook_w13q_clicks.py` that IMPORTS its meter (`Meter`, `Capped`, `Inconclusive`, `open_start`, `focus_editor_body`, `use_skip_link`), so clicks, keystrokes, real Tabs (cap 600) and taps count exactly as every wave-13 row did. One brand-new member per (flow, mode, width) run, because "new member" is every flow's precondition. |

Sandbox gates (a plain list, `os.environ.update`, the ledger convention): `NOTEBOOK_ONBOARDING_ENABLED`,
`NOTEBOOK_GETTING_STARTED_ENABLED`, and two tour capabilities so an offer can appear:
`NOTEBOOK_WRITING_HELP_ENABLED` (armed on web per `docs/feature_flags.json`, so the offer the walk meets
is the one a new member meets) and `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`. Every sandbox's `C:\data`
snapshot was CLEAN at pre-boot, +15 s, +120 s and shutdown (`evidence/wave14-q1/integrity/`).

## 2. Walk results (`evidence/wave14-q1/walk/walk.json`, tree `450e6257a7`)

125 checks: **113 PASS, 6 FAIL, 6 INFO.** All six FAILs are one finding (section 4.1).

| surface | 1200 | 820 | 390 |
|---|---|---|---|
| S1 base tour auto-starts at step 1 of 3 on the first-run screen | PASS | PASS | PASS |
| S1 overflow / tap floor / stacking / keys (Skip, Next) / axe | PASS (tap n/a) | PASS | PASS |
| S1 Escape dismisses, `notebook_tour` = dismissed | PASS | PASS | PASS |
| S2 welcome: preview + promotion + checklist render; the sample button's `aria-describedby` resolves to the promotion | PASS | PASS | PASS |
| S2 the offer waits while the checklist is open | PASS | PASS | PASS |
| S2 overflow / tap floor (13 controls) / stacking / keys (all 13 reached) / axe | PASS | PASS | PASS |
| S3 Hide records `notebook_getting_started` dismissed | PASS | PASS | PASS |
| S3 the offer waits while the "Meet Compass" card holds the slot | PASS | PASS | PASS |
| S3 the offer appears ("New in your Notebook: Writing help") | PASS | PASS | PASS |
| S3 **the offer never takes focus** (rAF-sampled from before it mounted: 101/102/102 frames with the card, 0 with focus in it) | PASS | PASS | PASS |
| S3 overflow / tap floor / stacking / keys / axe | PASS | PASS | PASS |
| S3 Not now records `{state: dismissed, step: null}`; no second offer after reload | PASS | PASS | PASS |
| S4 Walkthroughs lists base + both armed tours; What's new lists both, the declined one included | PASS | PASS | PASS |
| S4 overflow / tap floor (after the fix, 5 controls) / stacking / keys / axe | PASS | PASS | PASS |
| S5 Replay on a COLD page (no pre-warm) opens the base tour at step 1 | PASS | PASS | PASS |
| S6 What's new > Start opens a tour (Writing help; Template gallery) | **FAIL x2** | **FAIL x2** | **FAIL x2** |
| control (gates OFF): first-run children exactly `H2, P, DIV`; buttons exactly Start a note, Create a thesis, Import notes, Today | PASS | PASS | PASS |
| control: no preview, checklist, sample or tour door; no tour dialog | PASS | PASS | PASS |
| control (INFO): with onboarding OFF and writing help armed, the offer still appears once Compass closes | offer | offer | offer |

W14-0's open item 6.2 (Replay on a cold load opened at step 2) is closed on a real browser at all three
widths, without the pre-warm W14-0's walk needed.

Not stacked, measured: at no snapshot was more than one of {tour dialog, offer, other slot card} on
screen. The order a new member actually meets is: base tour (holds the stage; Compass waits) ->
Compass card in the slot (the offer waits) -> checklist in flow (the offer waits) -> offer.

## 3. Click budgets (`evidence/wave14-q1/clicks/`, tree `2583c23ee1`)

Plan 6.1 names these flows but sets **no numbers**, so each budget is the wave-13 row with the same
shape, fixed in the tool's docstring before the first measurement: O1 = Q1 (2/3/2), O2 = Q1's shape
(2/3/2), O3 = Q5 (1/2/1), O4 = Q3 (2/4/3), O5 = O6 = Q5 (1/2/1). Keys = keystrokes + real Tabs; a
keyboard member takes the page's skip link (13Q-3's convention).

| flow | mouse 1200 | keys 1200 | keys 390 | taps 390 |
|---|---|---|---|---|
| O1 new member to first note, cursor in body | **2** / 2 PASS | **6** / 3 OVER (Esc, skip link, 2 Tabs, Enter) | **6** / 3 OVER | **2** / 2 PASS |
| O2 open the sample notebook | **2** / 2 PASS | **10** / 3 OVER (7 Tabs) | **10** / 3 OVER | **2** / 2 PASS |
| O3 dismiss the checklist | **1** / 1 PASS | **11** / 2 OVER (9 Tabs) | **11** / 2 OVER | **1** / 1 PASS |
| O4 replay a walkthrough from Help | **2** / 2 PASS | **57** / 4 OVER (55 Tabs) | **36** / 4 OVER (33 Tabs) | **3** / 3 PASS |
| O5 accept an offer (a tour opens) | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| O6 decline an offer | **1** / 1 PASS | **5** / 2 OVER (3 Tabs) | **5** / 2 OVER | **1** / 1 PASS |

Pointer and touch: every measurable flow is inside budget. Keyboard: every flow is over, and the
cost is chrome, not the onboarding surfaces:

* O1 to O3: "Skip to notes list" lands above the first-run block, so the six first-run buttons, the
  preview and the checklist are walked in DOM order (the checklist's Hide is the ninth stop).
* O4: Support is the LAST sidebar entry (pinned at the bottom of NavBar) and Walkthroughs sits below
  the FAQ on `/support` -- 55 Tabs at 1200. The walk's S4 reach (32 Tabs from the page top) agrees.
* O5: Take the tour was pressed in all four modes (1 click / 4 keys / 1 tap) and **no tour opened**
  -- section 4.1. Not a budget result, so INCONCLUSIVE, never PASS.

The walk's own keyboard-reach counts are reach proofs, not budgets: after the uncounted setup clicks
the browser's focus-navigation start point sits next to the offer, so its S3 count (2) is free. The
clicks tool reloads first for exactly that reason (`2583c23ee1`).

## 4. Findings

### 4.1 An offered tour that cannot start from where it is offered does nothing (open, Q2 / C2)

Measured for both armed tours, at all widths, from both doors (the offer's Take the tour, O5; What's
new's Start, S6): the page lands on `/journal/notebook`, no dialog appears within 15 s, nothing is
recorded (`notebook_tours` stays without a row for it). Cause, read from the code:

* `writing-help`'s first anchor is `writing-help` in `NoteEditorPage.jsx` (an open note). The offer is
  never shown while a note is open (C2's R4 rule), and the entry has no `start` the engine could
  navigate to, so from the offer it can never open.
* `template-gallery`'s first anchor is `templates` in `NotebookTab.jsx`'s notes-list header, which the
  first-run screen does not render; no `start` either.
* `GenericTourEngine` waits `START_WAIT_MS` (8 s), finds no step on screen, and closes with nothing
  recorded (W14-0 1.3, by design).

Consequences: the session's ONE offer (D3) is spent on a tour that never opens; because nothing is
recorded, the same tour is offered again next session, and fails again. A census of the registry's
first anchors shows the same shape for most track tours (editor, share controls, property section,
chart embed); four entries declare a `start`. Not fixed here: it is the engine/registry contract
(Q2's tours, C2's offer gate), and the plausible fixes (offer only tours that can start from the
member's screen; a `start` that can open a note) are design choices for those lanes.

### 4.2 Help's Replay/Start controls were narrower than the tap floor (FIXED)

At 390 and 820 the walk measured "Start" at 27.4 x 44 px and "Replay" at 36.8 x 44 px: the touch-tier
rule declared `min-height: var(--tap-min)` only. Fix (`Support.module.css`, owned by W14-0/C2, minimal):
`min-width: var(--tap-min)` + `justify-content: center` in the same rule. Rail: `Support.whatsNew.test.jsx`
"declares the floor in BOTH dimensions in that same rule"; mutation (drop `min-width`) ->
`Tests 1 failed | 9 passed`, restore verified by sha256. Re-measured: S4 tap floor PASS at 820 and 390.

### 4.3 A What's new rail went red on the merge (FIXED, test only)

`Support.whatsNew.test.jsx` built its "FAKE registry" by spreading the whole real registry, which on
C2's base held only the base tour. On the integration tip the W14-B tracks register real tours, so a
second "Template gallery" and every armed track tour joined the fakes: 5 of 9 cases red. The fake now
keeps only the base entry, which is what its header says it is. No assertion changed.

### 4.4 The offer is not gated by the onboarding flag (INFO, for the owner)

With `NOTEBOOK_ONBOARDING_ENABLED` and `NOTEBOOK_GETTING_STARTED_ENABLED` both unset and writing help
armed, the first-run screen itself is exactly the pre-wave-14 shape (control PASS), but the offer card
still appears in the first-run slot once the Compass card closes. That is C2's stated design (each tour
rides its own capability flag), and onboarding is armed on web, so production is unaffected today; it
does mean the onboarding flag is not a kill switch for the offer.

### 4.5 Other observations (not defects in this lane)

* The base tour is an `aria-modal` dialog that traps Tab (wave 8, unchanged by design, W14-0 zero-drift);
  plan 5.3 says no tour may trap focus. Escape and Skip both work at every width.
* At 390 the fixed FABs (Log trade, the Compass orb, attach) overlap the bottom rows of the checklist
  until the member scrolls (they auto-hide on scroll). Visible in `on-S2-first-run-welcome-390.png`.

## 5. Accessibility (axe in the real browser)

12 scoped scans (4 surfaces x 3 widths): **0 violations** at every width, wcag2a/aa, wcag21aa, wcag22aa and best-practice, axe 4.13.0. No axe-driven product fix was
needed; the one a11y fix (4.2) came from the tap-floor measurement, which axe's own target-size rule
(24 px) does not flag.

## 6. Tests

`npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2` from `app/`, final tree:

```
 Test Files  7 failed | 609 passed (623)
      Tests  41 failed | 7741 passed | 1 skipped (7819)
     Errors  15 errors
   Duration  2214.17s
EXIT: 1
```

Read by name, not by count, on a box down to 1.1 GB available (two sandboxes and other sessions'
work live; `Memory\Available MBytes` read at the end). The 41 failures are in seven files, none of
which this lane touches: `lib/offline/f5p1OwnerSendsQueued.test.jsx` (35), `captureContext`,
`iteratorGlobalFloor` "every built asset is clear", `mathNodes`, `doorEnumeration`,
`settleLandedSaveCallers` and `VoiceInputButton.ref` -- every one a 15 s timeout or a find that
timed out, the load-sensitive set W14-0 section 5 and W14-C2 section 5 already record. The 15 errors
are `Worker exited unexpectedly` (vitest's fork pool losing workers under memory pressure), which is
why 7 of the 623 files have no result line. Re-runs:

* the seven failing files plus the two whose workers crashed, alone (`--maxWorkers=2`):
  `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 146 passed (147)`; the one was
  `iteratorGlobalFloor` timing out again, and alone (`--maxWorkers=1`): `Tests 9 passed (9)`;
* every test file with no result line in the full run (15, found by diffing the file list against
  the log): `--maxWorkers=2` died with exit 134 (V8 out of memory, 519 MB available); with
  `--maxWorkers=1`: `Test Files 15 passed (15)`, `Tests 178 passed (178)`, exit 0.

So every file in the scope has a green result on this tree, and no failure is in a W14-Q1 file. A
quiet-box full run is still owed before landing (CLAUDE.md: a gate on a contended box is not a gate).

Scoped, after the fixes: `src/pages/Support.whatsNew.test.jsx` `Tests 10 passed (10)`;
`src/styles/tapFloor.test.js` green. Python: `tests/test_notebook_flag_parse.py` +
`tests/test_notebook_flag_table_form.py` -> `215 passed` (the new tools follow the list-form flag
convention). `python tools/check_repo_hygiene.py`: clean.

## 7. Open items

1. **4.1, high:** the offer and What's new spend a member's attention on tours that cannot open from
   the Notebook root. Owner: Q2 (tour starts) with C2 (offer eligibility).
2. **Keyboard budgets:** O1 to O4 and O6 are over on keys only; the costs are app chrome (Support last
   in the nav, Walkthroughs below the FAQ, the first-run block before the checklist). Candidate fixes:
   a Help skip link to Walkthroughs, a first-run skip target, or Walkthroughs above the FAQ.
3. **4.4:** whether the onboarding flag should also gate the offer (owner).
4. O5 needs a re-measure once 4.1 is fixed; the tool reports it INCONCLUSIVE until a tour opens.

## 8. How to re-run

```
python tools/notebook_w14_onboarding_walk.py --data-root '<scratch>\w14q1-walk' --port 8715 `
    --out docs\notebook\evidence\wave14-q1\walk
python tools/notebook_w14q_clicks.py --data-dir '<scratch>\w14q1-clicks' --port 8720 `
    --out docs\notebook\evidence\wave14-q1\clicks
```

Run from PowerShell (a Windows path through the Bash tool loses its backslash), with `app/dist`
rebuilt from the tree under test, on empty data dirs and free ports (both refuse otherwise).

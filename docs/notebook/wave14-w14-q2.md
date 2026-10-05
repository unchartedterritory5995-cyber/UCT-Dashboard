# Wave 14, lane W14-Q2: every capability tour, walked in a real browser

Branch `feat/notebook-w14-q2`, from `9004bd8dac` (the integrated wave-14 tip). Spec:
`docs/notebook/WAVE-14-PLAN.md` section 6 (6.2 real-browser walks, 6.3 a11y) and 5.3 to 5.6.
Scope: the 19 replayable capability tours from Help > Walkthroughs and the passive resurfacing
explainer, at 1200 px and at 390 px (touch); S6 re-walked (accepting an offer); the switch-off
control. Q1 (`wave14-w14-q1.md`) owns the non-tour surfaces and was not re-measured here.

| commit | what |
|---|---|
| `290166bba3` | engine + tour data fixes, rails, the walk tool |
| (docs commit) | raw evidence and this record |

The commit SHAs are in the final report and `git log`; this file does not restate them.

## 1. Tool

`tools/notebook_w14q2_tours_walk.py`. It IMPORTS Q1's walk tool (`notebook_w14_onboarding_walk`)
for its probes (overflow, tap floor against the page's own `--tap-min`, real-Tab keyboard reach,
axe-core 4.13.0 with wcag2a/aa, 21aa, 22aa and best-practice), its member factory and its R-RAW
recorder, so a check here means what it meant there. It reads every tour's declared steps
(id, anchor, `waitFor`) from the tour files, never from a typed list.

Per width, one paid sandbox member with the sample notebook added (`POST
/api/j2/onboarding/sample-notebook`, the button's own route) and one manual closed trade
(`POST /api/j2/trades`; the sample adds none by design, integration R2.4), base tour, Compass
card and checklist closed the way a member closes them. Then, for every tour listed in Help >
Walkthroughs: Replay, wait for the card, and walk it as a member would: Next by keyboard (focus,
Enter), Back once between two plain steps, a "do this to continue" step answered by pressing
what the card points at with a normal (not forced) click, a search step answered by typing.
Recorded per tour and width: opens, the URL it opened on, steps shown of declared, every skipped
step with the anchor census at that moment, card modality per step, the effective opacity and
box of what the card points at, whether the card is fully in the viewport, overflow at every
step, the tap floor (390), keyboard reach inside the card, the focus trap (modal: kept;
non-modal: absent, by Tab presses from the last button), axe on the card, Escape (closes and
records a `notebook_tours` row), and one screenshot (600 px wide, 48 colours).

Flags (sandbox env, plain lists, `os.environ.update`): the switch (`NOTEBOOK_ONBOARDING_ENABLED`,
`NOTEBOOK_GETTING_STARTED_ENABLED`) and every capability a tour rides on, plus find-similar and
thesis chips (21 in all, `CAPABILITY_FLAGS` in the tool). Every sandbox's `C:\data` snapshot was
CLEAN at every checkpoint (`evidence/wave14-q2/integrity/`, 10 boots, 0 changed).

Evidence: `docs/notebook/evidence/wave14-q2/walk.json` (540 checks: 369 PASS, 1 FAIL, 170 INFO;
the FAIL is a walker timing defect, section 4.9, re-walked in `s6-rerun/walk.json`: 22/22
PASS), `shots/` (54 PNGs), sandbox logs. ⚠️ `walk.json`'s `tree` field reads `9004bd8dac`
because the walk ran on the working tree before the code commit; `app/` did not change between
that build and the code commit (only the walk tool did, afterwards, for 4.9).

## 2. Per-tour table (`walk.json`, after the fixes)

Shown = steps the card displayed of steps declared. Every tour, both widths: no horizontal
overflow at any step, keyboard reach to every card control, focus trap as designed (modal kept,
non-modal absent), axe 0 violations, and at 390 every card control at least 44 x 44. Escape
closed the card and recorded the tour wherever the walk ended on an open card (the four marked
"ends itself" close as done after their last shown step, which is the engine's design).

| tour | opens 1200 / 390 | shown 1200 | shown 390 | axe | skipped and why |
|---|---|---|---|---|---|
| writing-help | yes / yes | 4/4 | 4/4 | 0 / 0 | none |
| image-docx-import | yes / yes | 2/3 | 1/3 (ends itself) | 0 / 0 | `scan`: display:none above 1024 px by design; at 390 it is behind Format, and `find` (sidebar search) is hidden beside an open note on a phone. Open gap 5.1 |
| publish-share | yes / yes | 4/4 | 4/4 | 0 / 0 | none |
| task-reminders | yes / yes | 3/3 | 3/3 | 0 / 0 | none |
| template-gallery | yes / yes | 4/4 | 4/4 | 0 / 0 | none (fixed, 4.5 and 4.6) |
| meaning-search | yes / yes | 3/3 | 3/3 | 0 / 0 | none (fixed, 4.4) |
| formulas-rollups | yes / yes | 2/5 | 2/5 | 0 / 0 | data: `add-first` only on a note with no properties; `formula`/`edit` only once a formula property exists |
| plan-grading | yes / yes | 2/5 | 2/5 | 0 / 0 | data: the newest trade is Unplanned, so source/checks/frozen are not rendered (fixed so it opens, 4.1) |
| entry-context | yes / yes | 1/4 (ends itself) | 1/4 (ends itself) | 0 / 0 | data: no context captured for the trade, so fields/why/save are not rendered (fixed so it opens, 4.1 and 4.8) |
| review-drafts | yes / yes | 4/4 | 4/4 | 0 / 0 | none |
| my-playbook | yes / yes | 3/5 | 3/5 | 0 / 0 | data: no tagged setups, so the setup card and its notes are not rendered |
| chart-plan-basics | yes / yes | 6/6 | 6/6 | 0 / 0 | none (fixed at 1200, 4.3: was 1/6) |
| chart-plan-replay | yes / yes | 4/4 | 4/4 | 0 / 0 | none (fixed at 1200, 4.3). One earlier 1200 run read 3/4: "Couldn't load bars" in the sandbox, so no replay controls |
| ta-fingerprint | yes / yes | 4/4 | 4/4 | 0 / 0 | none |
| visual-playbook | yes / yes | 6/6 | 6/6 | 0 / 0 | none |
| setups-board | yes / yes | 5/5 | 5/5 | 0 / 0 | none |
| earnings-prep | yes / yes | 1/4 (ends itself) | 1/4 (ends itself) | 0 / 0 | data: no name reports this week in the sandbox, so the rows are not rendered (fixed so it opens, 4.7; it NEVER opened before) |
| transcript-capture | yes / yes | 1/5 (ends itself) | 1/5 (ends itself) | 0 / 0 | behind an action the walk cannot take: step 1 asks the member to type /transcript and open a call; the sandbox holds no call. Open gap 5.2 |
| passed-setups | yes / yes | 2/3 | 2/3 | 0 / 0 | data: the example passed setup has no scored outcome without bars |
| note-resurfaces (explainer) | yes / yes | n/a | n/a | 0 / 0 | shown in the resurfacing sheet, an `aside`, no dialog role, never takes focus (0 of 147/157 frames), Got it records done, not shown again after reload |

Counts: **20 of 20 open and reach their start at both widths** (19 replayable + the explainer),
with every card check above passing. **11 of 19 replayable tours show every declared step at
both widths** in this sandbox; the other 8 skip only steps whose anchor the member's data does
not render (formulas, plan grading, entry context, My Playbook, earnings prep, passed setups),
or that sit behind an action or tier the walk documents as an open gap (image/docx on a phone,
transcript capture).

Before the fixes (first full run, same tool): plan-grading and entry-context never opened at
either width, earnings-prep never opened, chart-plan-basics showed 1/6 at 1200, template-gallery
showed 3/4 with its door step never reachable, meaning-search 2/3, and at 390 the template-gallery
card covered the control it asked the member to press.

## 3. S6 and the passive explainer (real browser)

`s6-rerun/walk.json`, 22/22, both widths, one fresh member per case:

| case | 1200 | 390 |
|---|---|---|
| writing-help offer appears, Take the tour opens the tour (step 1 of 4, in the newest note) | PASS | PASS |
| after closing it, an in-app change of page does not reopen it | PASS | PASS |
| the session's offer is spent: no second offer this session (`{"id":"writing-help","answered":true}`) | PASS | PASS |
| template-gallery offer (every earlier tour marked seen) appears and opens (step 1 of 4, notes list) | PASS | PASS |
| template-gallery: no reopen on page change; offer spent | PASS | PASS |
| writing-help offer for a member with NO notes: the card says "This walkthrough runs inside a note", nothing recorded | PASS | PASS |
| (INFO) that offer is not spent: the session goes to the next tour (Add an image or Word document) | yes | yes |

The explainer: section 2's last row, both widths.

## 4. Defects found and fixed

### 4.1 Any tour whose start is on ANOTHER PAGE was dropped silently (engine)

Measured: Replay for plan-grading or entry-context landed on `/journal/trades`, the engine
resolved the newest trade and navigated there, and nothing ever appeared: no card, no
`notebook_tours` row, no closed event. Instrumented in the browser: the engine went
`routing -> waiting` and was then UNMOUNTED. Cause: `components/RouteErrorBoundary.jsx` wraps the
whole route tree and is keyed by pathname, so every change of page remounts the app shell, the
registry gate with it. C1's "the gate is mounted once in the shell, so a tour survives the
navigation to its own start" holds only when the pathname does not change; C1's reachability
rail mounted the gate outside any such boundary, so it could not see it. Offers reached
cross-page tours only by accident (4.2's stale pending request).

Fix: before navigating to a start on another pathname, the engine re-arms the request
(`carryRegistryTourOpen`, `tourRegistryControl.js`), which the remounted gate takes on mount;
`resolveStart` answers "stay" when already on the trade it resolved. Rail:
`tourReachability.test.jsx` now mounts the gate inside the real `RouteErrorBoundary`
(mutation: drop the carry -> plan-grading and entry-context red, `Tests 2 failed | 19 passed`).

### 4.2 A tour that ended came back on the next change of page (gate)

`openRegistryTour` leaves its id pending after the gate takes it; with 4.1's remounts, the next
page change after the tour ended opened it again. Fix: the gate clears its own pending request
when the tour closes. Rail: `RegistryToursGate.remount.test.jsx` (close then navigate: no
dialog, nothing pending; control: a RUNNING tour is picked up after the remount). Mutation:
drop the clear -> `Tests 1 failed | 1 passed`. Real browser: section 3, "does not reopen".

### 4.3 Chart toolbar steps had no box on a computer (CSS + engine)

At 1200 the chart embed's toolbar is hover-revealed and a tour cannot hover: Chart plan basics
showed 1 of 6 (6 of 6 on a phone). Two parts:
* `WidgetEmbedView.module.css`: the toolbar shows while the frame, or anything in it, carries
  the engine's `data-tour-active` marker. Rail `WidgetEmbedView.tourReveal.test.js` reads the
  marker's name from the engine (mutation: empty the rule -> 1 failed).
* That alone read "Step 2 of 6" pointing at nothing: on Next the engine clears the frame's
  marker, the toolbar loses its box, and the new marker was only set on an anchor on screen at
  that instant. The engine now marks the anchor whether or not it has a box at that instant
  (the "never point at nothing" watch still applies). Rail `GenericTourEngine.q2.test.jsx`
  reproduces the CSS synchronously in the fixture (mutation -> 1 failed).

### 4.4 Meaning search: the count step could never show (tour data)

`search-count` exists only while a search has results and a tour opened from Help starts with
an empty box. Step 1 now asks the member to type a word (`waitFor: 'search-count'`, one sentence
added to its copy). Rail `tours/b1MeaningSearch.steps.test.js`. Measured: 3/3 at both widths.

### 4.5 Template gallery: the door step could never show for a member with notes (tour data)

The gallery door is inside the picker, which opens in a sheet from Templates; nothing asked for
that click, so the door step was always skipped and steps 3-4 pointed at the Templates button.
Step 1 now waits for the door (`waitFor`), and steps 3-4 point at the door inside the open
picker. A member who chooses Next instead sees step 1 only (stated in the data file). Rail
`tours/b1TemplateGallery.steps.test.js`. Measured: 4/4 at both widths.

### 4.6 At 390 the "do this to continue" card covered the control it asked for (engine)

Templates sat at the bottom edge (`scrollIntoView` 'nearest') under the pinned card; a normal
click was refused (the card on top). A `waitFor` step now centres its anchor. Rail in
`GenericTourEngine.q2.test.jsx` (mutation -> 1 failed). The walk now presses every such
control with a normal click and records it; all pass.

### 4.7 Earnings prep never opened in a week with no name reporting (anchor)

Its first anchor was on the list, which renders only with names; every new member and most
weeks have none, and the tour waited on Home and closed with nothing shown. The anchor moved to
the box (`ReportingSoon.jsx`), which always renders; the row steps skip on an empty week. Rail
in `ReportingSoon.test.jsx` (mutation -> 1 failed).

### 4.8 Entry context never opened for a trade without saved context (anchor)

The anchor was on the captured card only; a past-day entry (most trades) renders the
not-captured card. Both settled cards now share one frame carrying the anchor
(`EntryContextCard.jsx` `SettledCard`); step 1's sentence is true of either. Rail in
`EntryContextCard.test.jsx` (mutation -> 1 failed).

### 4.9 Walker defects (tool only, not product)

The unreachable card's title is CSS-uppercased (read case-insensitively now); Back is tested
only between two plain steps (Back onto a satisfied "do this" step moves forward again by
design); the "Meet Compass" card can arrive after the first look and is now closed when it
holds the slot (the one FAIL in `walk.json`, re-walked green).

## 5. Known gaps (not fixed here)

1. **Image or Word document on a phone shows 1 of 3**: Scan is behind Format and the sidebar
   search is hidden beside an open note. Needs a `waitFor` on Format or a phone-tier step;
   owner of the tour data (B1) to decide.
2. **Transcript passages shows 1 of 5 without a saved call**: step 1 asks the member to type
   /transcript and open a call; with none, nothing can follow. Not walkable in the sandbox.
3. **Back onto a satisfied "do this" step** moves straight forward again (engine design); it
   reads as a no-op Back. Cosmetic.
4. Data-dependent skips (formulas, plan grading, My Playbook, passed setups, entry-context
   fields, earnings rows) are correct behaviour; a member with that data sees those steps
   (C1's reachability rail renders them).
5. `RouteErrorBoundary` remounting the whole shell on every page change is wider than tours
   (every shell-level state resets); left as is, recorded for the app owner.

## 6. Flags-off control (real browser, both widths)

Switch OFF = `NOTEBOOK_GETTING_STARTED_ENABLED` unset with onboarding ON (production today) and
every capability flag still ON. All PASS at 1200 and 390:
* first run: the wave-8 base tour still auto-starts; the block is `H2, P, DIV` with exactly
  Start a note, Create a thesis, Import notes, Today, Add a sample notebook, Take the tour (the
  wave-8 onboarding row); no capability preview, checklist, offer, tour card or explainer;
* Help: no Walkthroughs, no What's new, no Replay link;
* Home with notes and an open note: no offer, tour card, checklist or explainer;
* no `GenericTourEngine` or tour-steps chunk fetched at all.

## 7. Gates

Byte gate, exactly as `wave14-perf.md` (`npm run build` in `app/`, then
`python tools/notebook_perf_budgets.py --dist app/dist`):

```
bytes.notebook_first_open: 2,254,936 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

Exit 0; +71 B over R3.6 (the eager `carryRegistryTourOpen` export and the gate's clear).

Also `npx vitest run src/components/Layout --maxWorkers=1`: `Test Files  7 passed (7)`,
`Tests  24 passed (24)`. `python tools/check_repo_hygiene.py`: clean. The suite ran on the tree
of the code commit (`290166bba3`).

Tests, `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=3`, final tree:

```
 Test Files  642 passed (642)
      Tests  8103 passed | 1 skipped (8104)
EXIT: 0
```

## 8. Verdict

Every registered tour now opens from Help at both widths in a real browser, S6 holds (an offer
is spent only by a tour that opens, and a closed tour stays closed), the explainer behaves, and
the switch-off screens carry nothing of wave 14. Eight product defects fixed, each railed and
mutation-proved. Ready to merge into the integration branch; the two gaps in section 5 are
tour-data decisions for B1/B3, not blockers.

## 9. How to re-run

```
python tools/notebook_w14q2_tours_walk.py --data-root '<scratch>\w14q2' --port 8730 `
    --out docs\notebook\evidence\wave14-q2
python tools/notebook_w14q2_tours_walk.py --data-root '<scratch>\w14q2-s6' --port 8730 `
    --out docs\notebook\evidence\wave14-q2\s6-rerun --phases on --only S6
```

From PowerShell, with `app/dist` rebuilt from the tree under test, on an empty data root and a
free port in 8730-8734 (the tool refuses otherwise). About 25 minutes for both phases.

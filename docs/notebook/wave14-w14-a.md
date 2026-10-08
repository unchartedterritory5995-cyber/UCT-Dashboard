# Wave 14, lane W14-A: the redesigned first-run welcome

Branch `feat/notebook-w14-a`, based on `ca1ede46fb` (W14-0's WIP tip). Spec:
`docs/notebook/WAVE-14-PLAN.md` section 4.1, under controller default **D1** (section 11):
keep today's first-run buttons; add a short TEXT preview of what the Notebook can do (no
screenshots), the checklist, and the sample-notebook promotion. No new flag: both new
surfaces ride `NOTEBOOK_ONBOARDING_ENABLED`, the gate the sample and tour doors beside them
already use.

## 1. What shipped

A member with no notes still sees the same title, the same hint and the same buttons in the
same order under the same `data-tour="first-run"` anchor: **Start a note**, **Create a
thesis**, **Import notes**, **Today** (when NotebookTab passes it), **Add a sample notebook**
(onboarding on, paid, no sample yet) and **Take the tour** (onboarding on). Below them:

* **"What your Notebook can do"**: one plain line per capability, and only the capabilities
  whose OWN flag is armed for this member (`notebookFlag(flag) === true`, the tab's latched
  answer). Nothing armed shows no list at all. A dark capability is never named, not even in
  hidden text.
* **The sample promotion**: *"Want to try it first? **Add a sample notebook** puts example
  notes in their own folder. You can remove them in one click."* It is shown only while the
  sample button is on screen, and the button points at it with `aria-describedby`, so a screen
  reader hears the sentence as the button's description.
* **W14-D's mount point**: one assignment line, rendered in the first-run screen and in all
  three Home returns (section 4).

| file | what it is |
|---|---|
| `app/src/pages/journal-2-0/components/notebook/onboarding/capabilityList.js` | the preview as DATA: `CAPABILITY_PREVIEW` (id, flag, label, line), `PREVIEW_COPY`, `armedCapabilities()` |
| `app/src/pages/journal-2-0/components/notebook/onboarding/CapabilityPreview.jsx` | the component: heading + list of armed lines + the promotion |
| `app/src/pages/journal-2-0/components/notebook/onboarding/CapabilityPreview.module.css` | its styles, existing tokens only |
| `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx` | mounts the preview (a `lazyChunk`, under `Suspense`) in the `!hasAnyNotes` branch, `aria-describedby` on the sample button, the W14-D slot |
| `app/src/pages/journal-2-0/components/notebook/onboarding/capabilityList.test.js` | the list rail (10 tests) |
| `app/src/pages/journal-2-0/components/notebook/onboarding/CapabilityPreview.test.jsx` | the component (7 tests) |
| `app/src/pages/journal-2-0/a11y/capabilityPreview.a11y.test.jsx` | its own axe rail: recipes `capability-preview` and `first-run-welcome` |
| `app/src/pages/journal-2-0/a11y/notebookSurfaces.js` | one `OUTSIDE_POPULATION_SURFACES` entry for `CapabilityPreview.jsx` |
| `app/src/pages/journal-2-0/components/notebook/ResearchHome.welcome.test.jsx` | the welcome in place, the promotion, the W14-D slot (11 tests) |
| `tools/notebook_w14a_mutation_proof.py` | the lane's 7-mutation proof |

No backend file was touched, so there is no pytest. No W14-0 engine file was touched.

## 2. The capability list

Nine lines, in a trader's order (the trade loop first, then the research doors):

| id | flag | label | ledger status today |
|---|---|---|---|
| chart-plan | `notebook_chart_plan_enabled` | Chart plans | dark |
| plan-grading | `notebook_plan_grading_enabled` | Plan versus execution | dark |
| entry-context | `notebook_entry_context_enabled` | Entry context | dark |
| review-drafts | `notebook_review_drafts_enabled` | Reviews that write themselves | dark |
| playbook | `notebook_playbook_enabled` | My Playbook | dark |
| setups-board | `notebook_setups_board_enabled` | Active setups board | dark |
| earnings-prep | `notebook_earnings_prep_enabled` | Reporting soon | dark |
| passed-setups | `notebook_passed_setups_enabled` | Passed setups | dark |
| writing-help | `notebook_writing_help_enabled` | Writing help | armed |

The "ledger status" column is `docs/feature_flags.json` read on 2026-10-04. It records intent
and cannot see Railway, so it is not a statement about production. Each line's wording was
checked against its lane's spec (`WAVE-13-PLAN.md` Appendix A) and, where the UI has its own
words, against the component (Writing help: "Nothing is added to your note until you choose
Accept"; Passed setups: "Scoring your passed setups").

The rails that keep the list honest (`capabilityList.test.js`):

* every `flag` is a key of `FLAG_FALLBACKS` and falls back to `false`. A typo'd key would
  never arm, so its line would be invisible for ever and every "hidden while dark" test would
  pass for the wrong reason;
* ids and flags are unique; every line has a label and a sentence; copy carries no em dash and
  no exclamation mark; each line is 120 characters or fewer;
* a discriminator: every line can be armed on its own, and only its own flag arms it;
* `null`, `false`, `undefined`, `'true'` and `1` never arm a line (`=== true`, never truthy);
* the promotion names the sample button through `SAMPLE_COPY.add`, its one authority.

## 3. Decisions (this lane's own, for the controller)

1. **The promotion is text, not a second button.** Plan 4.1 says the existing "Add a sample
   notebook" button "becomes the way to make that preview real". Two buttons with one job is a
   second door to keep in step. The sentence describes the one button, and
   `aria-describedby` ties them together. The promotion's copy names no note count, because
   W14-E (D7: one sample notebook that grows) will change the count.
2. **The preview is in-flow page content, not a first-run card** (plan 5.6). It renders where
   Research Home puts it, never portals into the first-run slot, and never claims the stage.
   So it cannot cover a control, and the tour and the "Meet Compass" card never wait for it.
   Railed by `CapabilityPreview.test.jsx` ("renders in flow") and mutation M7.
3. **Gated on `notebook_onboarding_enabled`, with no new flag.** It is the same gate as the
   two doors it sits beside. ⚠️ Consequence: that flag is armed in the ledger, so on merge the
   preview reaches members at once. It lists only armed lines, which by the ledger is Writing
   help alone today, plus the promotion. See open item 1.
4. **A lazy chunk, through `lazyChunk`, like `PassedSetups`.** The first-open byte budget was
   ALREADY in breach at the base: 2,283,746 B against a budget of 2,260,793 B (+22,953 B, not this
   lane's). A static import added 2,804 B on top. Only a member with no notes ever sees the
   preview, so it now loads on demand: 2,284,228 B, +482 B over the base (the lazy stub, `useId`
   and the `aria-describedby`). It lives under `onboarding/`, outside the derived a11y
   population, so it is registered in `OUTSIDE_POPULATION_SURFACES` (the 13A/13E pattern), with
   its recipes in `a11y/capabilityPreview.a11y.test.jsx`. That entry is held by the existing
   `planGrading` / `entryContext` rails: the file exists and the recipe is registered.
   (`OTHER_LANES_OUTSIDE_POPULATION` was tried first and reverted, because
   `surfaceCoverage.test.js` admits only lanes 8B and 8C there.) While the chunk loads, the
   sample button's `aria-describedby` names an id that does not exist yet. That is harmless:
   the button simply has no description for those few milliseconds.
5. **No control in the preview, so no tap floor to add.** It sits inside `.firstRun`'s 480px
   column with its own 12px gutter, so it fits a 390px phone. Long words wrap
   (`overflow-wrap: anywhere`). The phone tier only tightens the padding.

## 4. The mount point left for W14-D

In `ResearchHome.jsx`, just above the loading return:

```js
  const gettingStartedSlot = null // W14-D: replace null with <GettingStartedChecklist ... />
```

It is rendered four times. In the first-run screen it comes after the preview and before the
sample notice. In each of the three Home returns (error-quiet, quiet, full) it is the FIFTH
child of the shared fragment, after `aiBox`, `prepBox`, `passedBox` and `reviewBox`, for the
same reason as those four: a home that flips between quiet and full must not remount it
mid-task. W14-D changes that one line and nothing else in this file.
`ResearchHome.welcome.test.jsx` pins exactly one assignment (carrying the "W14-D" marker) and
exactly four `{gettingStartedSlot}` uses. Mutation M6 proves it fires.

## 5. Mutation proof

`tools/notebook_w14a_mutation_proof.py` follows the same discipline as 13F's: captured bytes,
whole rail files, KILLED only on at least one failed test, every restore verified against
`git cat-file blob HEAD:<path>`, and an unmutated control green before and after.
**At the lane's tip of code**,
`docs/notebook/evidence/wave14-w14a/mutation-8c2eee4513.txt`: **7 of 7 killed**, control
30/30 before and after, every restore verified, `git status app/src` clean, `VERDICT: PASS`.
The first run, before the lazy-chunk change, is kept for history
(`mutation-634dda3892.txt`, also 7 of 7).

| id | mutation | killed by |
|---|---|---|
| M1 | the preview ignores the onboarding flag | welcome: "the onboarding flag off" |
| M2 | every line shows whatever its flag says | 11 tests across all three rail files |
| M3 | truthy instead of `=== true` | list: "a non-true answer never arms a line" |
| M4 | the sample button loses `aria-describedby` | welcome: the promotion describes the button |
| M5 | the promotion shows without the sample button | welcome: unpaid / already-had-the-sample (2) |
| M6 | one Home return drops the W14-D slot | welcome: "rendered in ... all three Home returns" |
| M7 | the preview claims the first-run stage | component: "renders in flow" |

## 6. Open items

1. **Owner/controller: is `notebook_onboarding_enabled` the right gate?** It is armed, so this
   lane ships live on merge. Today, by the ledger, that means one capability line (Writing
   help) plus the promotion. If the welcome should wait for W14-Q's walk, it needs its own
   wave-14 flag, which is a roster change (auth.py `NOTEBOOK_FLAGS`, `FLAG_FALLBACKS`, the flag
   tests, the ledger) outside this lane.
2. **No real-browser walk yet.** 390 / 820 / 1200 px are covered by the CSS reasoning in
   decision 5 and by jsdom, not by a browser. W14-Q's `notebook_w14_onboarding_walk.py` owns
   that (plan 6.2).
3. **The first-open byte budget is red at the base, and not because of this lane**: 2,283,746 B
   against 2,260,793 B (section 3, decision 4). This lane's own cost is +482 B. Whoever owns the
   breach (W14-0's lazy-view work touches this) should re-measure on a quiet box.
4. React prints "not wrapped in act(...)" on stderr for the welcome tests: the preferences
   fetch resolves after the synchronous assertions. It is harmless, and the neighbouring
   ResearchHome tests print the same.

## 7. Verification

All from `app/`, on a shared box (14 other vitest processes were live during one run; see
below).

* **Before** (`ca1ede46fb`, `npx vitest run src/pages/journal-2-0 src/pages/Support`):
  `Test Files 6 failed | 602 passed (608)`, `Tests 9 failed | 7614 passed | 1 skipped (7624)`.
  The 9 are the known list (focusFlows new-note focus, notebookContrast x2, seedParity
  snapshots x3, notebookSchema.rail, platform.test) plus `iteratorGlobalFloor`, which reads
  `app/dist` and there was no build.
* **After, final** (tree of `8c2eee4513`, same command): `Test Files 5 failed | 607 passed
  (612)`, `Tests 8 failed | 7645 passed | 1 skipped (7654)`. The 8 are exactly the known list.
  `iteratorGlobalFloor` passes only because this run had a fresh `app/dist` (the bytes
  measurement built one), which is environmental and not this lane's doing. +4 test files and
  +30 tests are this lane's, all green. **No new failure.**
* An earlier after-run at `634dda3892` read `17 failed | 595 passed` files and `21 failed`
  tests on a contended box. The extra 12 were 10 15-second timeouts and 2 load-timing
  assertions, in source-scanning and editor rails this lane does not touch. All 11 of those
  files were re-run alone and passed: `Test Files 11 passed (11)`, `Tests 121 passed (121)`.
  A second after-run at the same tree read `11 failed`: the known 9 plus 2 timeouts
  (`captureConvergence`, `mathNodes`), both of which passed alone.
* Lane files plus their neighbours (onboarding/, ResearchHome*, a11y capabilityPreview /
  surfaceCoverage / entryContext / planGrading / notebookContrast): `Tests 2 failed | 233 passed
  | 1 skipped (236)`. The 2 are notebookContrast's known SetupsBoard / PassedSetups findings,
  none of them this lane's CSS.
* Mutation proof: 7 of 7 killed, `VERDICT: PASS` (section 5).
* Bytes: `python tools/notebook_perf_budgets.py --dist app/dist`: 2,284,228 B with this lane,
  against 2,283,746 B with `ResearchHome.jsx` at `ca1ede46fb` (both builds on this box). The
  budget is 2,260,793 B, so both are in breach; the breach predates this lane.
* `python tools/check_repo_hygiene.py`: clean.
* No backend change, so no pytest.

# Wave 14, lane W14-B2: the trading-review tours (plan 4.2 rows 9 to 14)

Branch `feat/notebook-w14-b2`, from `3c50c50013` (the finished W14-0 lane). Spec:
`docs/notebook/WAVE-14-PLAN.md` sections 4.2, 5, 6 and 11 (D6: the chart plan gets two
tours, basics, then replay and context). Contract: the AUTHORING CONTRACT and ANCHOR RULE at
the top of `onboarding/tours/index.js`. No new flag: each tour is gated by its capability's
own `notebookFlag()` key, so a tour reaches members exactly when its capability is armed (D5).

| commit | what |
|---|---|
| `113b93e0b7` | the track file, six step files, one anchor per step, two W14-0 rails admitting what the contract allows, the per-tour and axe tests |

## 1. What landed

| tour id | flag | start | steps | anchor files (under `app/src/pages/journal-2-0/`) |
|---|---|---|---|---|
| `plan-grading` | `notebook_plan_grading_enabled` | none (Notebook root) | 5 | `components/trade/PlanGradeCard.jsx` |
| `entry-context` | `notebook_entry_context_enabled` | none (Notebook root) | 4 | `components/EntryContextCard.jsx`, `components/WhyPrompt.jsx` |
| `review-drafts` | `notebook_review_drafts_enabled` | `/journal/notebook` | 4 | `components/notebook/ResearchHome.jsx` |
| `my-playbook` | `notebook_playbook_enabled` | none (Notebook root) | 5 | `components/insights/MyPlaybook.jsx` |
| `chart-plan-basics` | `notebook_chart_plan_enabled` | none (Notebook root) | 6 | `components/notebook/WidgetEmbedView.jsx`, `components/notebook/ChartPlanPanel.jsx` |
| `chart-plan-replay` | `notebook_chart_plan_enabled` | none (Notebook root) | 4 | `components/notebook/WidgetEmbedView.jsx`, `components/notebook/BarReplay.jsx` |

| file (under `app/src/pages/journal-2-0/components/notebook/onboarding/tours/`) | what it is |
|---|---|
| `b2Trading.js` | the track: six thin entries, each `load()` a dynamic `import()` of its steps file |
| `planGrading.steps.js`, `entryContext.steps.js`, `reviewDrafts.steps.js`, `myPlaybook.steps.js`, `chartPlanBasics.steps.js`, `chartPlanReplay.steps.js` | `STEPS` + `COPY` per tour, lazy (R3) |
| `index.js` | one import line and one spread, nothing else |
| `b2Trading.test.jsx`, `b2Trading.a11y.test.jsx` | the lane's tests (section 3) |

### 1.1 Capability files touched, one attribute per step

| file | anchors added | where |
|---|---|---|
| `components/trade/PlanGradeCard.jsx` | `plan-grade-card`, `plan-grade-source`, `plan-grade-checks`, `plan-grade-frozen`, `plan-grade-actions` | the card section, the matched-plan line, the four checks, the frozen line, the Write review note / Re-link row |
| `components/EntryContextCard.jsx` | `entry-context-card`, `entry-context-fields` | the captured card and its field grid |
| `components/WhyPrompt.jsx` | `entry-context-why`, `entry-context-why-save` | the editing branch and its Save row |
| `components/notebook/ResearchHome.jsx` | `review-drafts-home`, `review-drafts-daily`, `review-drafts-weekly`, `review-drafts-monthly` | `ReviewDraftsHomeBox` and its three buttons |
| `components/insights/MyPlaybook.jsx` | `my-playbook-intro`, `my-playbook-setup-card`, `my-playbook-notes`, `my-playbook-patterns`, `my-playbook-snapshot` | the intro line, a setup card, From your notes, the patterns section, Save a snapshot note |
| `components/notebook/WidgetEmbedView.jsx` | `chart-embed`, `chart-plan-draw`, `chart-plan-open`, `chart-plan-replay`, `chart-embed-timeframe` | the embed frame, Draw, Plan, Replay, the timeframe select |
| `components/notebook/ChartPlanPanel.jsx` | `chart-plan-panel`, `chart-plan-numbers`, `chart-plan-alert` | the Trade plan section, the R:R and size block, Arm alert at this level |
| `components/notebook/BarReplay.jsx` | `chart-replay-controls` | the replay's play / step / speed / scrub row |

`git diff 3c50c50013 113b93e0b7 --stat` over those eight files: 27 insertions, 20 deletions, every
changed line an added `data-tour` attribute (appended to an existing tag, or on its own line in a
tag already split across lines). `StockChart.jsx` and every broker, positions and flow file are
untouched. `chart-embed` is shared by the two chart-plan tours (the rule is one JSX occurrence per
file, not one tour per anchor).

### 1.2 Two W14-0 rails, widened to the contract they enforce

* `tourRegistry.test.js` "every entry has exactly these fields" still required the five fields
  only. The contract (and `assembleRegistry`) allows an optional `start` since `cf224476f8`; the
  first real entry carrying one (`review-drafts`) turned it red. It now ignores `start` and still
  requires the five.
* `tourAnchors.test.js` "every data-tour in those files ... belongs to a step" declared only the
  BASE tour's anchors for the base tour's files. `ResearchHome.jsx` is one of them and is where the
  review-drafts door lives, so its four anchors read as orphans. The declared set now also holds
  any anchor a registered tour names in that same file. Still literal-only, still per file.
  Proved still able to fail (section 3.1).

## 2. Scope boundaries and decisions (stated, not oversights)

* **Five tours carry no `start`.** The engine is mounted by NotebookTab only, so `start` must sit
  under `/journal/notebook` (`tourRegistry.js`). Plan grading lives on the closed-trade page (`/journal-2-0/trade/:id`), the
  entry context card on `/journal-2-0/position/:sym` and `/journal-2-0/trade/:id`, My Playbook at `/journal-2-0/playbook`,
  and both chart-plan tours inside a note that holds a chart (no fixed path). For all five the
  nearest in-Notebook start is the Notebook root, which is what Help's Replay already links to
  when no `start` is set, so none is declared. The engine was not changed. See 4, open item 1.
* **Steps are chosen from what is on screen when the tour opens.** `GenericTourEngine` filters
  the steps once, at open (`availableSteps`). So the steps behind a click (the Plan panel, the
  replay dialog, the Why prompt after a reason is saved) appear only if that surface is already
  open. Copy says where that is the case. See 4, open item 2.
* **The chart toolbar is hover-revealed on a computer** (`WidgetEmbedView.module.css` `.toolbar`
  is `display: none` until `:hover`, `:focus-within` or `.selected`; always shown under
  `hover: none`). The first step of both chart tours is therefore the embed frame, which is always
  on screen, and its copy tells a mouse user to point at the chart. On touch the toolbar is always
  visible.
* **`chart-embed` is on `WidgetEmbedView`'s frame, which renders for every widget type.** The
  attribute must be a literal for the anchor rail, so it cannot be conditional on
  `widgetId === 'chart'`. In a note whose first embed is not a chart, step one points at that
  embed. Recorded, not fixed.
* **Chart replay "context"** is taught on the timeframe select (H2), with the copy naming `/vs`
  and `/mtf` (H7). The slash menu itself was not anchored: its items are data rows inside a popup
  that only exists while typing.
* **No `a11y/notebookSurfaces.js` rows.** The track and step files are `.js` data, not rendered
  surfaces; the anchored components already have their own rows and axe recipes from wave 13.
* **Copy** is plain, short, says what the thing does and why it matters, with no em or en dashes
  (railed per step).

## 3. Tests and rails

| rail | proves |
|---|---|
| `tours/b2Trading.test.jsx` | the track declares exactly rows 9 to 14 in plan order; D6 (two chart tours, one flag); no static import of a steps file and one dynamic import per tour; per tour: in the real registry once, its own flag and that flag a `FLAG_FALLBACKS` key, replayable, `start` and `startPath` as recorded, 3 to 6 steps of exactly `{id, anchor, file}`, a non-empty title and body for every step, no copy key without a step, no em or en dash; per tour through the real `makeRegistryToursGate`: flag off loads nothing, flag on opens it |
| `tours/b2Trading.a11y.test.jsx` | `review-drafts`, loaded from the registry, walked through `GenericTourEngine` step by step with its real copy; axe zero violations at the first and the last step |
| `tourAnchors.test.js` (W14-0, generic) | each B2 tour's every anchor appears exactly once in its named file, by AST |
| `tourRegistry.test.js` (W14-0, generic) | shape, unique ids, the index AST rail |

Targeted runs, `--maxWorkers=2`:

```
npx vitest run src/pages/journal-2-0/components/notebook/onboarding --maxWorkers=2
 Test Files  17 passed (17)
      Tests  194 passed (194)

npx vitest run <the 47 test files that name PlanGradeCard, EntryContextCard, WhyPrompt,
  MyPlaybook, ChartPlanPanel, BarReplay, ResearchHome or WidgetEmbedView> --maxWorkers=2
 Test Files  47 passed (47)
      Tests  663 passed (663)
```

Full run at `113b93e0b7`, `--maxWorkers=2`, exit 1:

```
npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2
 Test Files  1 failed | 610 passed (611)
      Tests  1 failed | 7696 passed | 1 skipped (7698)
   Duration  1321.81s
```

The one red is `lib/iteratorGlobalFloor.test.js` "every built asset is clear": *app/dist/assets
missing, run `npm run build`*. This worktree had no build; the rail reads built output by design.
After `npm run build` (exit 0) the file alone: `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
Environment, not this lane. No 15 s timeouts in the run.

### 3.1 Mutation runs (each restored by re-applying the original text, sha256 verified)

| mutation | red |
|---|---|
| remove `data-tour="plan-grade-checks"` from `PlanGradeCard.jsx` | `tour plan-grading: every step's anchor appears EXACTLY once in its named file`: *plan-grading step checks: data-tour="plan-grade-checks" appears 0 times in components/trade/PlanGradeCard.jsx*; `Tests 1 failed / 22 passed`. Restored: `23 passed` |
| rename `review-drafts-monthly` to `review-drafts-monthly-stray` in `ResearchHome.jsx` (the widened orphan rail) | the orphan rail and `tour review-drafts: ...`: `Tests 2 failed / 21 passed`. Restored, sha OK |

## 4. Open items

1. **For W14-C: five tours cannot reach their own screen.** `plan-grading`, `entry-context` and
   `my-playbook` anchor on journal pages outside `/journal/notebook`, where the engine is not
   mounted; the two chart tours need a note that holds a chart. Today, opened from Help, each
   lands on the Notebook root, waits `START_WAIT_MS` for its first anchor and closes with nothing
   recorded. Either the engine mounts on the journal shell (and `start` may name `/journal-2-0/playbook`,
   `/journal-2-0/trade/:id`, `/journal-2-0/position/:sym`), or Help hides a tour whose start it cannot reach. Not changed here by
   instruction.
2. **For W14-C: steps behind a click.** The engine picks steps once, at open. A tour that teaches
   "open the panel, then read it" (chart plan basics after Plan, the replay controls, the Why
   prompt) only shows the later steps if the member opened that surface first. Re-checking
   availability on each Next would let these tours walk a member through the click.
3. **`chart-embed` on non-chart embeds** (section 2). Harmless today; worth a narrower anchor if
   the frame ever gets a chart-only wrapper.
4. **Not walked in a real browser.** Plan 6.2's per-tour walks (390 and 1200 px, keyboard, flag
   off and on) are W14-Q's; nothing here was measured in a browser.

// Track W14-B2 (wave 14): the trading-review tours, plan section 4.2 rows 9 to 14.
//
// Thin entries only (risk R3): each `load()` is a dynamic import of its own
// `*.steps.js`, so no step or sentence below reaches the Notebook's first-open
// bytes. Authoring contract and anchor rule: the top of `./index.js`.
//
// Where a tour starts. The generic engine is mounted by NotebookTab only, so a
// `start` must sit under /journal/notebook (tourRegistry.js). Rows 9, 10 and 12
// live on journal pages outside the Notebook (the closed-trade page, a
// position's page, /journal-2-0/playbook) and rows 13 and 14 inside a note that
// holds a chart, which has no fixed path. Those five carry no `start`: their
// nearest in-Notebook start is the Notebook root, which is what Help's Replay
// already links to without one. Open item for W14-C, recorded in
// docs/notebook/wave14-w14-b2.md. Row 11 starts on Notebook Home, where its door is.
const steps = (load) => () => load().then((m) => ({ steps: m.STEPS, copy: m.COPY }))

export const TOURS = [
  {
    id: 'plan-grading',
    flag: 'notebook_plan_grading_enabled',
    title: 'Plan versus execution grading',
    replayable: true,
    load: steps(() => import('./planGrading.steps')),
  },
  {
    id: 'entry-context',
    flag: 'notebook_entry_context_enabled',
    title: 'Entry context card',
    replayable: true,
    load: steps(() => import('./entryContext.steps')),
  },
  {
    id: 'review-drafts',
    flag: 'notebook_review_drafts_enabled',
    title: 'Reviews that write themselves',
    replayable: true,
    start: '/journal/notebook',
    load: steps(() => import('./reviewDrafts.steps')),
  },
  {
    id: 'my-playbook',
    flag: 'notebook_playbook_enabled',
    title: 'My Playbook',
    replayable: true,
    load: steps(() => import('./myPlaybook.steps')),
  },
  {
    id: 'chart-plan-basics',
    flag: 'notebook_chart_plan_enabled',
    title: 'Chart plan basics',
    replayable: true,
    load: steps(() => import('./chartPlanBasics.steps')),
  },
  {
    id: 'chart-plan-replay',
    flag: 'notebook_chart_plan_enabled',
    title: 'Chart plan replay and context',
    replayable: true,
    load: steps(() => import('./chartPlanReplay.steps')),
  },
]

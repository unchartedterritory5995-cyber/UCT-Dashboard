// Track W14-B2 (wave 14): the trading-review tours, plan section 4.2 rows 9 to 14.
//
// Thin entries only (risk R3): each `load()` is a dynamic import of its own
// `*.steps.js`, so no step or sentence below reaches the Notebook's first-open
// bytes. Authoring contract and anchor rule: the top of `./index.js`.
//
// Where a tour starts (W14-C1: the registry gate is mounted once in the app shell, so a
// start may be any known page, a note or a trade). Rows 9 and 10 open the member's most
// recent trade (`{ trade: 'recent' }`, the closed-trade page holds both cards); row 12 is
// /journal-2-0/playbook; rows 13 and 14 open the W14-E example trade-plan note, or the
// member's most recent note holding a chart. Row 11 starts on Notebook Home, where its
// door is. Nothing is created to have something to point at (tourStart.js).
const steps = (load) => () => load().then((m) => ({ steps: m.STEPS, copy: m.COPY }))

export const TOURS = [
  {
    id: 'plan-grading',
    flag: 'notebook_plan_grading_enabled',
    title: 'Plan versus execution grading',
    replayable: true,
    start: Object.freeze({ trade: 'recent' }),
    load: steps(() => import('./planGrading.steps')),
  },
  {
    id: 'entry-context',
    flag: 'notebook_entry_context_enabled',
    title: 'Entry context card',
    replayable: true,
    start: Object.freeze({ trade: 'recent' }),
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
    start: '/journal-2-0/playbook',
    load: steps(() => import('./myPlaybook.steps')),
  },
  {
    id: 'chart-plan-basics',
    flag: 'notebook_chart_plan_enabled',
    title: 'Chart plan basics',
    replayable: true,
    start: Object.freeze({ note: 'sample:plan', embed: 'chart' }),
    load: steps(() => import('./chartPlanBasics.steps')),
  },
  {
    id: 'chart-plan-replay',
    flag: 'notebook_chart_plan_enabled',
    title: 'Chart plan replay and context',
    replayable: true,
    start: Object.freeze({ note: 'sample:plan', embed: 'chart' }),
    load: steps(() => import('./chartPlanReplay.steps')),
  },
]

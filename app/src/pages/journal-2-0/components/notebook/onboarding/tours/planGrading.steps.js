// Tour `plan-grading` (W14-B2, plan 4.2 row 9): the grade card on a closed trade's page.
// Anchors live in PlanGradeCard.jsx, the capability's own component (wave 13 lane 13A).
const F = 'components/trade/PlanGradeCard.jsx'
const step = (id, anchor, file = F) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('card', 'plan-grade-card'),
  step('source', 'plan-grade-source'),
  step('checks', 'plan-grade-checks'),
  step('frozen', 'plan-grade-frozen'),
  step('actions', 'plan-grade-actions'),
])

export const COPY = Object.freeze({
  card: Object.freeze({
    title: 'Plan versus execution',
    body: 'When a trade closes, this card compares what you did with the plan note you wrote before the entry.',
  }),
  source: Object.freeze({
    title: 'The plan it matched',
    body: 'This line names the plan note the grade was read from and how it was matched. Open it to see what you wrote.',
  }),
  checks: Object.freeze({
    title: 'Four checks',
    body: 'Entry, stop, size and target, each marked kept or missed with the numbers behind it. 1R is your planned risk per share.',
  }),
  frozen: Object.freeze({
    title: 'The grade does not move',
    body: 'A grade is frozen when it is first matched. Editing the plan afterwards does not change it, so the record stays honest.',
  }),
  actions: Object.freeze({
    title: 'Review or re-link',
    body: 'Write review note saves the grade, a link to the plan and the charts as a new note. Re-link if the card picked the wrong plan.',
  }),
})

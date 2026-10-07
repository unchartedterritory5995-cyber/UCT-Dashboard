// Tour `ta-fingerprint` (plan 4.2 row 15). Every anchor is in the fingerprint panel
// under a chart block, all on screen together once the fingerprint is frozen. The first
// step is the frozen summary, the last part of the panel to appear, so the tour opens
// only when the rest is there too.
const F = 'components/notebook/FingerprintPanel.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'summary', anchor: 'fp-summary', file: F }),
  Object.freeze({ id: 'fields', anchor: 'fp-all-fields', file: F }),
  Object.freeze({ id: 'tag', anchor: 'fp-setup-tag', file: F }),
  Object.freeze({ id: 'plan', anchor: 'fp-plan', file: F }),
])

export const COPY = Object.freeze({
  summary: {
    title: 'The chart, in numbers',
    body: 'When you insert a chart, its key numbers are frozen for that day: RS rank, ADR, base depth, prior run and MA stack. They stay as they were, so later you can see the setup the way it looked when you planned it.',
  },
  fields: {
    title: 'Every field and its source',
    body: 'Open the full list to see each field, its value and where it came from. A field with no data reads n/a instead of a guess.',
  },
  tag: {
    title: 'Tag the setup',
    body: 'Pick the setup this chart shows. Your tags build your visual playbook. If the pattern engine confirmed a pattern here, it is offered as a suggestion and only applied if you choose it.',
  },
  plan: {
    title: 'Plan this setup',
    body: "This makes a new plan note from the setup's template, with each checklist item marked from the fingerprint. This note is not changed.",
  },
})

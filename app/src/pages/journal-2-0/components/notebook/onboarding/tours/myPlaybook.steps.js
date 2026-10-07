// Tour `my-playbook` (W14-B2, plan 4.2 row 12): the My Playbook page.
// Anchors live in MyPlaybook.jsx, the capability's own component (wave 13 lane 13B).
const F = 'components/insights/MyPlaybook.jsx'
const step = (id, anchor, file = F) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('intro', 'my-playbook-intro'),
  step('setup-card', 'my-playbook-setup-card'),
  step('notes', 'my-playbook-notes'),
  step('patterns', 'my-playbook-patterns'),
  step('snapshot', 'my-playbook-snapshot'),
])

export const COPY = Object.freeze({
  intro: Object.freeze({
    title: 'Your edge, per setup',
    body: 'My Playbook groups your closed trades by setup. A small sample is labelled as one and shows a likely range, not a single number.',
  }),
  'setup-card': Object.freeze({
    title: 'One card per setup',
    body: 'Win rate, average R and expectancy for the setup. Select any number to see the exact trades it came from.',
  }),
  notes: Object.freeze({
    title: 'From your notes',
    body: 'The notes linked to these trades, so your reasoning sits next to the results.',
  }),
  patterns: Object.freeze({
    title: 'Before losses and wins',
    body: 'What you wrote before losing trades compared with winning ones, with counts and the notes quoted. Patterns, not proof.',
  }),
  snapshot: Object.freeze({
    title: 'Save a snapshot',
    body: "Saves today's numbers as a note that will not change, so you can compare against it later.",
  }),
})

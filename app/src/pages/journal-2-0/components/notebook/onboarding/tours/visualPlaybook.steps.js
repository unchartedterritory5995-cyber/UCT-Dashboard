// Tour `visual-playbook` (plan 4.2 row 16). Every anchor is inside the playbook sheet
// and on screen together once its cards have loaded; the grid is the first step so the
// tour waits for the cards before it opens.
const F = 'components/notebook/VisualPlaybook.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'grid', anchor: 'vp-grid', file: F }),
  Object.freeze({ id: 'fields', anchor: 'vp-card-fields', file: F }),
  Object.freeze({ id: 'outcome', anchor: 'vp-card-outcome', file: F }),
  Object.freeze({ id: 'stats', anchor: 'vp-stats', file: F }),
  Object.freeze({ id: 'filters', anchor: 'vp-filters', file: F }),
])

export const COPY = Object.freeze({
  grid: {
    title: 'Your tagged charts',
    body: 'Every chart you tagged with a setup shows here as a card, so you can look at all your VCPs or all your breakouts side by side.',
  },
  fields: {
    title: 'The numbers on each card',
    body: 'Each card carries the fingerprint frozen with the chart: RS rank, base depth, ADR and prior run.',
  },
  outcome: {
    title: 'How the trade went',
    body: 'When a trade is linked to the plan, the card shows the result and its R multiple. A chart with no trade linked says so.',
  },
  stats: {
    title: 'Stats for what you see',
    body: 'Win rate and average R for the cards left after your filters. Under 10 trades it reads too few to judge, and from 10 to 24 it shows a range.',
  },
  filters: {
    title: 'Narrow it down',
    body: 'Filter by setup, outcome, timeframe or a fingerprint range, such as RS rank at least 90, to see which version of a setup works for you.',
  },
})

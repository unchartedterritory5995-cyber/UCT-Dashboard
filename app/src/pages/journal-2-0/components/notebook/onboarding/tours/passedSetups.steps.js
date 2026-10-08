// Tour `passed-setups` (plan 4.2 row 20), on Research Home's Passed setups box. The list
// is the first step, so the tour opens once the scored names have loaded.
const F = 'components/notebook/PassedSetups.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'list', anchor: 'passed-list', file: F }),
  Object.freeze({ id: 'outcomes', anchor: 'passed-outcomes', file: F }),
  Object.freeze({ id: 'add', anchor: 'passed-add', file: F }),
])

export const COPY = Object.freeze({
  list: {
    title: 'Names you passed on',
    body: 'Names you saved from a scan or a watchlist and did not trade. A name you traded within 10 sessions of saving it is left out.',
  },
  outcomes: {
    title: 'What happened next',
    body: 'Each name is scored from the close of the day you saved it: 1, 5, 10 and 20 sessions later, and the best move within 20. A session with no data says so instead of showing zero.',
  },
  add: {
    title: 'Add one yourself',
    body: 'Type a ticker and the day you passed on it to track it here.',
  },
})

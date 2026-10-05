// Tour `earnings-prep` (plan 4.2 row 18), on Research Home's Reporting soon box. The
// list is the first step, so the tour opens once the names have loaded.
const F = 'components/notebook/ReportingSoon.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'list', anchor: 'reporting-soon-list', file: F }),
  Object.freeze({ id: 'when', anchor: 'reporting-soon-when', file: F }),
  Object.freeze({ id: 'sources', anchor: 'reporting-soon-sources', file: F }),
  Object.freeze({ id: 'prep', anchor: 'reporting-soon-prep', file: F }),
])

export const COPY = Object.freeze({
  list: {
    title: 'Reporting soon',
    body: 'Names from your watchlists, your flagged names and your open positions that report earnings in the next seven days.',
  },
  when: {
    title: 'When it reports',
    body: 'The day, and whether it is before the open or after the close once that is announced.',
  },
  sources: {
    title: 'Why it is on the list',
    body: 'Where the name came from: a watchlist, a flag or an open position.',
  },
  prep: {
    title: 'Draft a prep note',
    body: 'One click drafts an earnings prep note for the name. Nothing is created until you click. A name you prepped in the last three weeks shows Open prep note instead.',
  },
})

// Tour `setups-board` (plan 4.2 row 17). The board card anchors are in BoardCard.jsx and
// the find-more-like-this list is in SetupsBoard.jsx; all are on the one setups page.
// The two find-similar steps render only while that capability is on and are skipped
// otherwise.
const CARD = 'components/notebook/BoardCard.jsx'
const PAGE = 'components/notebook/SetupsBoard.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'card', anchor: 'setups-card', file: CARD }),
  Object.freeze({ id: 'distance', anchor: 'setups-distance', file: CARD }),
  Object.freeze({ id: 'note', anchor: 'setups-note', file: CARD }),
  Object.freeze({ id: 'similar', anchor: 'setups-similar', file: CARD }),
  Object.freeze({ id: 'templates', anchor: 'setups-templates', file: PAGE }),
])

export const COPY = Object.freeze({
  card: {
    title: 'One card per open plan',
    body: 'Every open plan or watch note with an entry line drawn on a chart gets a live card here. The ones closest to their entry come first.',
  },
  distance: {
    title: 'Distance to the entry',
    body: 'How far price is from your entry, in percent, and in R when you drew a stop. It also tells you when price has gone through the entry or the stop.',
  },
  note: {
    title: 'Back to the plan',
    body: 'Open the note the plan lives in to read it or change the levels.',
  },
  similar: {
    title: 'Find more like this',
    body: 'For a chart you tagged with a setup, this lists names from the latest nightly scan that look most like it.',
  },
  templates: {
    title: 'Matches for your tagged charts',
    body: 'Every chart you tagged is listed here. Pick one to see its matches. They are refreshed each night.',
  },
})

// Tour `transcript-capture` (plan 4.2 row 19). Steps 1 to 4 are in the Save from a call
// transcript sheet, all on screen once a call has loaded; the speaker turns are first
// because they arrive last. Step 5 is a thesis chip, which renders on position and
// watchlist rows; it is skipped wherever no chip is on screen.
const SHEET = 'components/notebook/SaveTranscriptPassage.jsx'
const CHIP = 'components/notebook/ThesisChip.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'turns', anchor: 'transcript-turns', file: SHEET }),
  Object.freeze({ id: 'quote', anchor: 'transcript-quote', file: SHEET }),
  Object.freeze({ id: 'call', anchor: 'transcript-call', file: SHEET }),
  Object.freeze({ id: 'find', anchor: 'transcript-find', file: SHEET }),
  Object.freeze({ id: 'chip', anchor: 'thesis-chip', file: CHIP }),
])

export const COPY = Object.freeze({
  turns: {
    title: 'The call, turn by turn',
    body: 'The earnings call UCT holds for this name, split into numbered speaker turns.',
  },
  quote: {
    title: 'Quote a turn',
    body: 'Pick the turn you want, trim it to the words you keep and add a line on why it matters. When you save, the quote is checked against the transcript and lands in your note cited by quarter and turn.',
  },
  call: {
    title: 'Pick the call',
    body: 'Switch between the quarters UCT holds for this name.',
  },
  find: {
    title: 'Find in this call',
    body: 'Type a word such as margin or guidance to show only the turns that mention it.',
  },
  chip: {
    title: 'Thesis chips',
    body: "A position or watchlist row for a name you wrote a thesis on shows this chip: the note's status and how far price is from its stop. Tap it or tab to it to preview the note.",
  },
})

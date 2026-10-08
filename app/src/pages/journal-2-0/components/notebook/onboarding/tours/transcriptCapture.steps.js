// Tour `transcript-capture` (plan 4.2 row 19). It starts in a note (the W14-E example
// call-excerpt note, else the member's most recent note) and step 1 asks the member to
// open a call from the note (`waitFor`: the engine moves on when the sheet's speaker
// turns appear). Steps 2 to 5 are in the Save from a call transcript sheet.
// W14-C1 removed the thesis-chip step: chips render on position, holdings and watchlist
// rows, never in a note, so here it was always skipped (wave14-w14-c1.md, item h).
const EDITOR = 'components/notebook/NoteEditorPage.jsx'
const SHEET = 'components/notebook/SaveTranscriptPassage.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'open', anchor: 'note-body', file: EDITOR, waitFor: 'transcript-turns' }),
  Object.freeze({ id: 'turns', anchor: 'transcript-turns', file: SHEET }),
  Object.freeze({ id: 'quote', anchor: 'transcript-quote', file: SHEET }),
  Object.freeze({ id: 'call', anchor: 'transcript-call', file: SHEET }),
  Object.freeze({ id: 'find', anchor: 'transcript-find', file: SHEET }),
])

export const COPY = Object.freeze({
  open: {
    title: 'Quote an earnings call',
    body: 'In the note, type /transcript and choose Transcript passage to open a call UCT holds for this name.',
  },
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
})

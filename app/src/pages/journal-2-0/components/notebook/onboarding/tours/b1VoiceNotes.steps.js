// Tour `voice-notes` (spec P0.10). Data only: see ./index.js for the contract.
// Screen: Research Home, where "+ New note" now lives (Task 2). Step 1 asks the member to open
// the menu (`waitFor` the voice item) so steps 2 and 3 can point at it. Both anchors are
// literal `data-tour` attributes in NewNoteMenu.jsx.
// Step 3 exists for the registry's step budget (a replayable tour is 3 to 6 steps): it says what
// happens after the choice, from the dialog's own wording (VoiceNoteDialog.jsx).
const TAB = 'components/notebook/NewNoteMenu.jsx'
export const STEPS = Object.freeze([
  Object.freeze({ id: 'open', anchor: 'new-note-home', file: TAB, waitFor: 'new-note-voice' }),
  Object.freeze({ id: 'voice', anchor: 'new-note-voice', file: TAB }),
  Object.freeze({ id: 'save', anchor: 'new-note-voice', file: TAB }),
])
export const COPY = Object.freeze({
  open: { title: 'Start a voice note', body: 'Open the arrow next to New note to see the other ways to start one.' },
  voice: { title: 'Record, upload or pick a session', body: 'Voice note records you, takes an audio file, or uses a Desk session. You get a transcript, and a short summary when one can be made, in a new note.' },
  save: { title: 'Nothing is saved until you say so', body: 'Voice note shows you the transcript first, with a summary when one can be made. It becomes a note when you choose Save, and the audio is deleted from the server once it is transcribed.' },
})

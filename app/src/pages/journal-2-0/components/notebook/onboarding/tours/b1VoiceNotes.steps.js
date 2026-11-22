// Tour `voice-notes` (spec P0.10). Data only: see ./index.js for the contract.
// Go-live wave 1: it starts on the notes list (Research home, its old screen, is gone), at the list's New menu.
//   * wide (641px and up): step 1 asks the member to open the New menu's arrow ("More ways to start a note", already
//     the `templates` anchor) and waits for the "Voice note" row; steps 2 and 3 point at that row.
//   * phone (640px and below): the "+ New" group is not drawn there, so ⋯ (More notebook actions, the
//     `styles-button` anchor) carries the row; step 1 asks for ⋯, step 2 points at its "Voice note" row. (The
//     floating "+" also has Voice note, but its card would sit over that button at the foot of the screen.)
// Every anchor is a literal `data-tour` in tabs/NotebookTab.jsx. Step 3 exists for the step budget and says what
// happens after the choice, from the dialog's own wording (VoiceNoteDialog.jsx).
const TAB = 'tabs/NotebookTab.jsx'
export const STEPS = Object.freeze([
  Object.freeze({ id: 'open', anchor: 'templates', file: TAB, waitFor: 'new-note-voice', tier: 'wide' }),
  Object.freeze({ id: 'voice', anchor: 'new-note-voice', file: TAB, tier: 'wide' }),
  Object.freeze({ id: 'save', anchor: 'new-note-voice', file: TAB, tier: 'wide' }),
  Object.freeze({ id: 'phone-open', anchor: 'styles-button', file: TAB, waitFor: 'new-note-voice-phone', tier: 'phone' }),
  Object.freeze({ id: 'phone-voice', anchor: 'new-note-voice-phone', file: TAB, tier: 'phone' }),
])
const VOICE_BODY = 'Voice note records you, takes an audio file, or uses a Desk session. You get a transcript, and a short summary when one can be made, in a new note.'
export const COPY = Object.freeze({
  open: { title: 'Start a voice note', body: 'Open the arrow next to + New to see the other ways to start a note.' },
  voice: { title: 'Record, upload or pick a session', body: VOICE_BODY },
  save: { title: 'Nothing is saved until you say so', body: 'Voice note shows you the transcript first, with a summary when one can be made. It becomes a note when you choose Save, and the audio is deleted from the server once it is transcribed.' },
  'phone-open': { title: 'Start a voice note', body: 'Open More notebook actions (the three dots) to see Voice note. The + button at the bottom has it too.' },
  'phone-voice': { title: 'Record, upload or pick a session', body: `${VOICE_BODY} Nothing is saved until you choose Save.` },
})

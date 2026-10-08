// Tour `writing-help` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: an open, editable note (paid members; the button is not rendered otherwise).
// The preview, the choices and Accept live in WritingHelpPanel, which is closed while a
// tour runs, so steps 3 and 4 point back at the button and the note and explain them.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const EDITOR = 'components/notebook/NoteEditorPage.jsx'

export const STEPS = Object.freeze([
  step('open', 'writing-help', EDITOR),
  step('scope', 'note-body', EDITOR),
  step('preview', 'writing-help', EDITOR),
  step('undo', 'note-body', EDITOR),
])

export const COPY = Object.freeze({
  open: {
    title: 'Writing help',
    body: 'Compass can summarize, rewrite, continue or translate what you wrote. Open it here, or type / in the note and pick Writing help.',
  },
  scope: {
    title: 'Choose what it works on',
    body: 'Select a passage first and it works on just that passage. With nothing selected it works on the whole note.',
  },
  preview: {
    title: 'Read the draft first',
    body: 'The draft appears in a preview, not in your note. Accept adds it, Try again writes another, Discard leaves your note as it was.',
  },
  undo: {
    title: 'Undo takes it back',
    body: 'An accepted draft goes in as one labelled block, replacing your selection if you made one. One Undo removes it.',
  },
})

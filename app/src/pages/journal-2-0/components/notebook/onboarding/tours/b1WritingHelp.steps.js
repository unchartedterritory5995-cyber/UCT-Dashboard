// Tour `writing-help` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: an open, editable note (paid members; the doors are not rendered otherwise).
// Go-live wave 1 (C5): the door is in a different place per tier.
//   * desktop (1025px and up): Writing help is an item of the note header's "AI" menu. Step 1 points at "AI"
//     (`note-ai`) and waits for the member to open it; step 2 points at the menu's "Writing help" row.
//   * touch (1024px and below): the header keeps the Writing help icon button (`writing-help`), as before.
// The preview, the choices and Accept live in WritingHelpPanel, which is closed while a tour runs, so the `preview`
// step points at the header's controls (`ask-row`, on every tier, the group the AI door sits in) and explains them.
// `scope` and `undo` are unchanged.
const step = (id, anchor, file, more = {}) => Object.freeze({ id, anchor, file, ...more })
const EDITOR = 'components/notebook/NoteEditorPage.jsx'

export const STEPS = Object.freeze([
  step('ai', 'note-ai', EDITOR, { waitFor: 'writing-help-menu', tier: 'desktop' }),
  step('menu', 'writing-help-menu', EDITOR, { tier: 'desktop' }),
  step('open', 'writing-help', EDITOR, { tier: 'touch' }),
  step('scope', 'note-body', EDITOR),
  step('preview', 'ask-row', EDITOR),
  step('undo', 'note-body', EDITOR),
])

const OPEN_BODY = 'Compass can summarize, rewrite, continue or translate what you wrote. Open it here, or type / in the note and pick Writing help.'
export const COPY = Object.freeze({
  ai: {
    title: 'Writing help',
    body: 'Writing help is in the AI menu at the top of your note. Open AI to see it.',
  },
  menu: {
    title: 'Writing help',
    body: OPEN_BODY,
  },
  open: {
    title: 'Writing help',
    body: OPEN_BODY,
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

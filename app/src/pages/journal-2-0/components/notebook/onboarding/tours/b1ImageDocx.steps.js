// Tour `image-docx-import` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: an open, editable note. Tiers: the toolbar row is on every tier; Scan is the
// touch tier's camera door (hidden above 1024 px, and behind Format on a phone), so a
// desktop skips it; the sidebar search is beside the note on desktop and tablet only.
//
// W14-Q2 round 2 (measured in a real browser): a phone showed 1 of 3, because Scan is
// inside the Format disclosure and the sidebar search is hidden while a note is open. Two
// PHONE-ONLY steps (their anchors have a box at <= 640 px only, so a tablet or desktop skips
// them and still sees exactly the steps it saw before) ask the member to open Format, then
// to go Back to notes, each moving on when the next anchor appears (`waitFor`).
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const EDITOR = 'components/notebook/NoteEditorPage.jsx'

export const STEPS = Object.freeze([
  step('add', 'note-toolbar', EDITOR),
  Object.freeze({ id: 'format', anchor: 'note-format', file: EDITOR, waitFor: 'note-scan' }),
  step('scan', 'note-scan', EDITOR),
  Object.freeze({ id: 'back', anchor: 'note-phone-back', file: 'tabs/NotebookTab.jsx', waitFor: 'search' }),
  step('find', 'search', 'components/notebook/FolderSidebar.jsx'),
])

export const COPY = Object.freeze({
  add: {
    title: 'Add an image or a Word file',
    body: 'Insert image and Attach a file are in this row (on a phone, under Format). A picture of a page, a Word file or a spreadsheet is read for its text.',
  },
  format: {
    title: 'Images and files are under Format',
    body: 'On a phone, Insert image, Attach a file and Scan are under Format. Tap Format to see them.',
  },
  scan: {
    title: 'Scan a page',
    body: 'On a phone or tablet, Scan takes a photo with your camera and adds it the same way, so a printed page becomes text you can search.',
  },
  back: {
    title: 'Search is in your notes list',
    body: 'On a phone, search sits beside your notes, not in a note. Tap Back to notes to go there.',
  },
  find: {
    title: 'Search finds what is inside',
    body: 'Once the text is read, search lists the matching document pages under your notes. Select one to open the file at that page.',
  },
})

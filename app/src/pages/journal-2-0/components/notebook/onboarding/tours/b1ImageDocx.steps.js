// Tour `image-docx-import` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: an open, editable note. Tiers: the toolbar row is on every tier; Scan is the
// touch tier's camera door (hidden above 1024 px, and behind Format on a phone), so a
// desktop skips it; the sidebar search is beside the note on desktop and tablet only.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })

export const STEPS = Object.freeze([
  step('add', 'note-toolbar', 'components/notebook/NoteEditorPage.jsx'),
  step('scan', 'note-scan', 'components/notebook/NoteEditorPage.jsx'),
  step('find', 'search', 'components/notebook/FolderSidebar.jsx'),
])

export const COPY = Object.freeze({
  add: {
    title: 'Add an image or a Word file',
    body: 'Insert image and Attach a file are in this row (on a phone, under Format). A picture of a page, a Word file or a spreadsheet is read for its text.',
  },
  scan: {
    title: 'Scan a page',
    body: 'On a phone or tablet, Scan takes a photo with your camera and adds it the same way, so a printed page becomes text you can search.',
  },
  find: {
    title: 'Search finds what is inside',
    body: 'Once the text is read, search lists the matching document pages under your notes. Select one to open the file at that page.',
  },
})

// Tour `publish-share` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Gate: `notebook_publish_enabled`, not `j2_share_links_enabled` (lane doc, section 2).
// Every step is about publishing; share links are not mentioned, because that section of
// the Share sheet is behind the other flag. Screen: an open note (paid members). The
// whole capability sits behind the one Share button, so every step points at it.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const SHARE = 'components/notebook/NoteShareControls.jsx'

export const STEPS = Object.freeze([
  step('door', 'note-share', SHARE),
  step('note', 'note-share', SHARE),
  step('folder', 'note-share', SHARE),
  step('unpublish', 'note-share', SHARE),
])

export const COPY = Object.freeze({
  door: {
    title: 'Share is where you publish',
    body: 'Share, in the note header, is where you publish a note to the web. Nothing is public until you press Publish.',
  },
  note: {
    title: 'Publish this note',
    body: 'A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it. Copy page link gives you the address.',
  },
  folder: {
    title: 'Or the whole folder',
    body: 'From the same place you can publish the folder this note is in: up to 500 notes, with the folders inside it. A note added later appears when you update the page in Settings.',
  },
  unpublish: {
    title: 'Take it down any time',
    body: 'Unpublish stops the page at once. Every page you published is listed in Settings > Sharing & publishing, where you can update or remove it.',
  },
})

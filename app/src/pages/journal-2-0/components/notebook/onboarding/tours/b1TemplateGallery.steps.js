// Tour `template-gallery` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: the Notebook's notes list, where the Templates button is. The gallery door is
// inside the template picker, which opens in a sheet from that button.
//
// W14-Q2 (measured in a real browser, both widths): the door step could never show for a
// member with notes -- it was not a `waitFor` step, so nothing asked the member to open the
// picker, and the engine skipped it every time; steps 3 and 4 then pointed at the Templates
// button to describe a gallery the member had not seen. Now step 1 asks the member to open
// Templates (`waitFor` the door), and steps 3 and 4 point at the door, inside the open
// picker, where the gallery they describe is one click away. A member who chooses Next
// instead of opening it sees step 1 only.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const TAB = 'tabs/NotebookTab.jsx'
const PICKER = 'components/notebook/TemplatePicker.jsx'

export const STEPS = Object.freeze([
  Object.freeze({ id: 'templates', anchor: 'templates', file: TAB, waitFor: 'template-gallery-door' }),
  step('door', 'template-gallery-door', PICKER),
  step('use', 'template-gallery-door', PICKER),
  step('share', 'template-gallery-door', PICKER),
])

export const COPY = Object.freeze({
  templates: {
    title: 'Start from a template',
    body: 'Templates opens the picker: a blank page, UCT templates for plans and reviews, and your own.',
  },
  door: {
    title: 'The community gallery',
    body: 'Browse the community gallery shows templates other members shared. UCT reviews each one before it is listed, and UCT picks come first.',
  },
  use: {
    title: 'Use template makes a copy',
    body: 'In the gallery, Use template copies it into Your templates. Then Make a note from it, or change your copy first.',
  },
  share: {
    title: 'Share one of yours',
    body: 'In Your templates, Share sends one of yours to the gallery. It is listed after review, and you can unpublish it at any time.',
  },
})

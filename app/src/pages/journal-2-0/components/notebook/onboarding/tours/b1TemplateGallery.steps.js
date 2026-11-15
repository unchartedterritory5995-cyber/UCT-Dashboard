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

//
// Final fix (A1): on a phone the "+ New" group (and its ▾, the `templates` anchor) is not drawn, so step 1 never
// showed and the tour could not open there. The phone door is ⋯ (More notebook actions, the `styles-button` anchor)
// > "New from a template" (the `new-from-template-phone` anchor, a literal in NotebookTab.jsx): the two phone steps
// stand in for step 1, and the later steps are the same at every width (the picker is the same sheet).
export const STEPS = Object.freeze([
  Object.freeze({ id: 'templates', anchor: 'templates', file: TAB, waitFor: 'template-gallery-door', tier: 'wide' }),
  Object.freeze({ id: 'phone-open', anchor: 'styles-button', file: TAB, waitFor: 'new-from-template-phone', tier: 'phone' }),
  Object.freeze({ id: 'phone-templates', anchor: 'new-from-template-phone', file: TAB, waitFor: 'template-gallery-door', tier: 'phone' }),
  step('door', 'template-gallery-door', PICKER),
  step('use', 'template-gallery-door', PICKER),
  step('share', 'template-gallery-door', PICKER),
])

export const COPY = Object.freeze({
  templates: {
    title: 'Start from a template',
    body: 'The ▾ beside New opens From a template: a blank page, UCT templates for plans and reviews, and your own.',
  },
  'phone-open': {
    title: 'Start from a template',
    body: 'More notebook actions (the three dots) has New from a template: a blank page, UCT templates for plans and reviews, and your own.',
  },
  'phone-templates': {
    title: 'Start from a template',
    body: 'New from a template opens a blank page, UCT templates for plans and reviews, and your own.',
  },
  door: {
    title: 'The Template library',
    body: 'Browse the Template library shows templates other members shared. UCT reviews each one before it is listed, and UCT picks come first.',
  },
  use: {
    title: 'Add to my templates makes a copy',
    body: 'In the gallery, Add to my templates copies it into Your templates. Then Make a note from it, or change your copy first.',
  },
  share: {
    title: 'Share one of yours',
    body: 'In Your templates, Share sends one of yours to the gallery. It is listed after review, and you can unpublish it at any time.',
  },
})

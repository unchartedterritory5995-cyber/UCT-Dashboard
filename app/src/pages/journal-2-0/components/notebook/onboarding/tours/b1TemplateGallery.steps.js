// Tour `template-gallery` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: the Notebook's notes list, where the Templates button is. The gallery door is
// inside the template picker: on screen when the picker is (an empty notebook shows it
// inline), skipped otherwise; steps 3 and 4 explain the gallery from the Templates button.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const TAB = 'tabs/NotebookTab.jsx'

export const STEPS = Object.freeze([
  step('templates', 'templates', TAB),
  step('door', 'template-gallery-door', 'components/notebook/TemplatePicker.jsx'),
  step('use', 'templates', TAB),
  step('share', 'templates', TAB),
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

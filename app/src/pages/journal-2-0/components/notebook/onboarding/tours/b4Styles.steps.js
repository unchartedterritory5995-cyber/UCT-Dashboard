// Tours `journal-styles` and `style-library` (Notebook P5, Task 7). Data only: see ./index.js.
//
// A tour cannot open a closed dialog (F3), so each tour's first step asks the member to make the
// click that opens it (`waitFor` names the anchor that appears once it is open). A member who
// chooses Next instead sees step 1 only. Every anchor is a `data-tour` attribute, never an
// accessible name (P5-R-T3-5: two firm cards titled "Weekend prep" share an "Adopt ..." name).
//
// Journal styles: Screen is the notes list (start `?view=all`, P5-R-C10). Step 1 is the Styles
// button in the list header; at 390 px it is a 44 px icon, still on screen, so there is no
// phone-only step (V8). Steps 2 to 4 are inside the Styles manager, opened from that button.
//
// Community library: Screen is the notes list. Step 1 is Templates (wait for the gallery door in
// the picker), step 2 the door (wait for the gallery's type chips), step 3 the chips, step 4 a
// style card's Adopt button, which lives in StyleLibraryCard.jsx (P5-R-C11).
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const TAB = 'tabs/NotebookTab.jsx'
const MANAGER = 'components/notebook/styles/StylesManager.jsx'
const PICKER = 'components/notebook/TemplatePicker.jsx'
const GALLERY = 'components/notebook/TemplateGallery.jsx'
const CARD = 'components/notebook/StyleLibraryCard.jsx'

export const JOURNAL_STYLES_STEPS = Object.freeze([
  Object.freeze({ id: 'open', anchor: 'styles-button', file: TAB, waitFor: 'styles-manager' }),
  step('manager', 'styles-manager', MANAGER),
  step('kinds', 'styles-kinds', MANAGER),
  step('new', 'styles-new', MANAGER),
])

export const JOURNAL_STYLES_COPY = Object.freeze({
  open: {
    title: 'Journal styles',
    body: 'Styles opens the Journal styles manager, where you choose how each kind of note starts. Select Styles to open it.',
  },
  manager: {
    title: 'How a note starts',
    body: 'A style is a starting outline, its blocks and the properties it fills. Changing a style never changes notes you already made.',
  },
  kinds: {
    title: 'Styles by kind of note',
    body: 'Each kind of note, such as a trade plan or a review, lists its styles here. Set one as the default, or duplicate a UCT style to make it your own.',
  },
  new: {
    title: 'Make a new style',
    body: 'New style starts a style from scratch. Pick its kind of note, then write its outline and add its blocks.',
  },
})

export const STYLE_LIBRARY_STEPS = Object.freeze([
  Object.freeze({ id: 'templates', anchor: 'templates', file: TAB, waitFor: 'template-gallery-door' }),
  Object.freeze({ id: 'door', anchor: 'template-gallery-door', file: PICKER, waitFor: 'library-types' }),
  step('types', 'library-types', GALLERY),
  step('adopt', 'library-adopt', CARD),
])

export const STYLE_LIBRARY_COPY = Object.freeze({
  templates: {
    title: 'Styles other traders share',
    body: 'The community library is in the template gallery. Select Templates to open the picker.',
  },
  door: {
    title: 'Open the community gallery',
    body: 'Browse the community gallery shows what other members shared. Select it to open the library.',
  },
  types: {
    title: 'Outlines and styles',
    body: 'These chips choose what you see: All, Outlines or Styles. A style brings its outline, blocks and properties with it.',
  },
  adopt: {
    title: 'Adopt a style',
    body: 'Adopt copies a style into your Journal styles, ready for new notes. If its author improves it later, Journal styles offers you the update to review.',
  },
})

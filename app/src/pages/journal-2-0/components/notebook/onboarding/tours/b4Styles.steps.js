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
    title: 'Templates',
    body: 'Manage templates, in the ⋯ menu, opens your templates, where you choose how each note type starts. Open ⋯ and select Manage templates.',
  },
  manager: {
    title: 'How a note starts',
    body: 'A template is a starting outline, its blocks and the properties it fills. Changing a template never changes a note you already made unless you choose to update it.',
  },
  kinds: {
    title: 'Templates by note type',
    body: 'Each note type, such as a trade plan or a review, lists its templates here. Set one as the default, or use Duplicate to edit on a built-in template to make it your own.',
  },
  new: {
    title: 'Make a new template',
    body: 'New template starts a template from scratch. Pick its note type, then write its outline and add its blocks.',
  },
})

// Final fix (A1): on a phone the ▾ (`templates`) is not drawn, so the library tour opens there through ⋯ > "New from a
// template" (the same phone door the template-gallery tour uses); steps 2 to 4 are the same at every width.
export const STYLE_LIBRARY_STEPS = Object.freeze([
  Object.freeze({ id: 'templates', anchor: 'templates', file: TAB, waitFor: 'template-gallery-door', tier: 'wide' }),
  Object.freeze({ id: 'phone-open', anchor: 'styles-button', file: TAB, waitFor: 'new-from-template-phone', tier: 'phone' }),
  Object.freeze({ id: 'phone-templates', anchor: 'new-from-template-phone', file: TAB, waitFor: 'template-gallery-door', tier: 'phone' }),
  Object.freeze({ id: 'door', anchor: 'template-gallery-door', file: PICKER, waitFor: 'library-types' }),
  step('types', 'library-types', GALLERY),
  step('adopt', 'library-adopt', CARD),
])

export const STYLE_LIBRARY_COPY = Object.freeze({
  templates: {
    title: 'Templates other traders share',
    body: 'The Template library is in the New note sheet. Open the ▾ beside New and select From a template to open it.',
  },
  'phone-open': {
    title: 'Templates other traders share',
    body: 'The Template library is in the New note sheet. Open More notebook actions (the three dots) to find New from a template.',
  },
  'phone-templates': {
    title: 'Templates other traders share',
    body: 'The Template library is in the New note sheet. Select New from a template to open it.',
  },
  door: {
    title: 'Open the Template library',
    body: 'Browse the Template library shows what other members shared. Select it to open the library.',
  },
  types: {
    title: 'Outlines and templates',
    body: 'These chips choose what you see: All, Outlines or Templates. A template brings its outline, blocks and properties with it.',
  },
  adopt: {
    title: 'Use a template',
    body: 'Use makes a note from it at once. To keep a copy among your templates, choose Customize first or Add to my templates; if its author improves it later, Manage templates offers you the update to review.',
  },
})

// Wave 14, lane W14-B1: the core-capability tours (plan section 4.2, rows 2 to 8).
//
// Thin entries only. Each `load()` is a dynamic import of that tour's own
// `b1*.steps.js`, so no step or copy reaches the Notebook's first-open bytes
// (risk R3). Authoring contract and anchor rule: the header of `./index.js`.
// What each tour points at, and why, is docs/notebook/wave14-w14-b1.md.
//
// The tour list is frozen at the moment a tour opens (GenericTourEngine's
// `availableSteps`), and the tour card is modal, so a step can only show when its
// anchor is on screen AT OPEN. Every step here therefore points at something on
// the tour's own screen; where a capability's detail sits behind one button,
// several steps point at that button and explain what is behind it.
//
// Three of these flags (`notebook_image_docx_documents_enabled`,
// `notebook_task_reminders_enabled`, `notebook_semantic_search_enabled`) are not
// in the auth payload yet (lib/offline/notebookFlags.js FLAG_FALLBACKS), so
// `notebookFlag()` answers null for them and those tours stay dark until the key
// is added there and in api/routers/auth.py NOTEBOOK_FLAGS. That is deliberate:
// gated on the capability's own flag, failing closed (see the lane doc, open
// question 1).

const steps = (load) => () => load().then((m) => ({ steps: m.STEPS, copy: m.COPY }))

export const TOURS = Object.freeze([
  {
    id: 'writing-help',
    flag: 'notebook_writing_help_enabled',
    title: 'Writing help',
    replayable: true,
    load: steps(() => import('./b1WritingHelp.steps')),
  },
  {
    id: 'image-docx-import',
    flag: 'notebook_image_docx_documents_enabled',
    title: 'Add an image or Word document',
    replayable: true,
    load: steps(() => import('./b1ImageDocx.steps')),
  },
  {
    id: 'publish-share',
    flag: 'notebook_publish_enabled',
    title: 'Publish and share a note',
    replayable: true,
    load: steps(() => import('./b1Publish.steps')),
  },
  {
    id: 'task-reminders',
    flag: 'notebook_task_reminders_enabled',
    title: 'Task reminders',
    replayable: true,
    start: '/journal/notebook?view=tasks',
    load: steps(() => import('./b1TaskReminders.steps')),
  },
  {
    id: 'template-gallery',
    flag: 'notebook_template_gallery_enabled',
    title: 'Template gallery',
    replayable: true,
    load: steps(() => import('./b1TemplateGallery.steps')),
  },
  {
    id: 'meaning-search',
    flag: 'notebook_semantic_search_enabled',
    title: 'Search by meaning',
    replayable: true,
    load: steps(() => import('./b1MeaningSearch.steps')),
  },
  {
    id: 'formulas-rollups',
    flag: 'notebook_formulas_enabled',
    title: 'Formulas and rollups',
    replayable: true,
    load: steps(() => import('./b1Formulas.steps')),
  },
].map((e) => Object.freeze(e)))

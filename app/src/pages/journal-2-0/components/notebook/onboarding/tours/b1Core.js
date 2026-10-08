// Wave 14, lane W14-B1: the core-capability tours (plan section 4.2, rows 2 to 8).
//
// Thin entries only. Each `load()` is a dynamic import of that tour's own
// `b1*.steps.js`, so no step or copy reaches the Notebook's first-open bytes
// (risk R3). Authoring contract and anchor rule: the header of `./index.js`.
// What each tour points at, and why, is docs/notebook/wave14-w14-b1.md.
//
// Every step here points at something on the tour's own screen; where a
// capability's detail sits behind one button, several steps point at that button
// and explain what is behind it. (Since W14-C1 the engine re-checks steps on every
// Next and a step may wait for a click, so a later track can walk into a panel.)
//
// W14-C1: the four editor tours start `{ note: 'recent' }` (the member's most
// recently edited note, opened, never created), and the three flags that were
// server-only (`notebook_image_docx_documents_enabled`,
// `notebook_task_reminders_enabled`, a kill switch that reads ON when unset, and
// `notebook_semantic_search_enabled`) now ride the auth payload, each with its
// capability's own polarity.

const steps = (load) => () => load().then((m) => ({ steps: m.STEPS, copy: m.COPY }))

export const TOURS = Object.freeze([
  {
    id: 'writing-help',
    flag: 'notebook_writing_help_enabled',
    title: 'Writing help',
    replayable: true,
    start: Object.freeze({ note: 'recent' }),
    load: steps(() => import('./b1WritingHelp.steps')),
  },
  {
    id: 'image-docx-import',
    flag: 'notebook_image_docx_documents_enabled',
    title: 'Add an image or Word document',
    replayable: true,
    start: Object.freeze({ note: 'recent' }),
    load: steps(() => import('./b1ImageDocx.steps')),
  },
  {
    id: 'publish-share',
    flag: 'notebook_publish_enabled',
    title: 'Publish and share a note',
    replayable: true,
    start: Object.freeze({ note: 'recent' }),
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
    // its door is in the notes list's header (W14-Q1 S6: from Home it never opened)
    start: '/journal/notebook?view=all',
    load: steps(() => import('./b1TemplateGallery.steps')),
  },
  {
    id: 'meaning-search',
    flag: 'notebook_semantic_search_enabled',
    title: 'Search by meaning',
    replayable: true,
    start: '/journal/notebook?view=all',
    load: steps(() => import('./b1MeaningSearch.steps')),
  },
  {
    id: 'formulas-rollups',
    flag: 'notebook_formulas_enabled',
    title: 'Formulas and rollups',
    replayable: true,
    start: Object.freeze({ note: 'recent' }),
    load: steps(() => import('./b1Formulas.steps')),
  },
].map((e) => Object.freeze(e)))

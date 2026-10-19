// Notebook P5, Task 7: the B4 track, two tours for Journal styles and the community style library.
//
// Thin entries only. Each `load()` is a dynamic import of `./b4Styles.steps`, so no step or copy
// reaches the Notebook's first-open bytes (risk R3). Authoring contract and anchor rule: the
// header of `./index.js`. Plan: docs/superpowers/plans/2026-10-17-notebook-p5-launch.md, R-P5-7.
//
// Both start on the notes LIST, never Research Home (ruling P5-R-C10): the Styles button and the
// Templates button live in the list header, which `/journal/notebook` alone does not render
// (`isHome` in NotebookTab.jsx). The same fix the template-gallery tour took (b1Core.js).
//
// The library tour `requires` the template-gallery switch (P5-R-C11): its door is the gallery
// door inside the template picker, which renders only while that switch is on.
const steps = (pick) => () => import('./b4Styles.steps').then((m) => pick(m))

export const TOURS = Object.freeze([
  {
    id: 'journal-styles',
    flag: 'notebook_journal_styles_enabled',
    title: 'Journal styles',
    replayable: true,
    start: '/journal/notebook?view=all',
    load: steps((m) => ({ steps: m.JOURNAL_STYLES_STEPS, copy: m.JOURNAL_STYLES_COPY })),
  },
  {
    id: 'style-library',
    flag: 'notebook_style_library_enabled',
    title: 'Community library',
    replayable: true,
    requires: Object.freeze(['notebook_template_gallery_enabled']),
    start: '/journal/notebook?view=all',
    load: steps((m) => ({ steps: m.STYLE_LIBRARY_STEPS, copy: m.STYLE_LIBRARY_COPY })),
  },
].map((e) => Object.freeze(e)))

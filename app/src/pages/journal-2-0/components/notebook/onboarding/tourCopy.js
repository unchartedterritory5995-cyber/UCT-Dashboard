// Every sentence the first-run tour speaks (wave 8, lane 8C, C2), keyed by the step ids in
// tourSteps.js. A step there is exactly {id, anchor, file} (tourAnchors.test.js holds it to
// that), so its words live here. NotebookTour.test.jsx asserts every one as rendered text,
// and that every step has its copy.
//
// ⛔ Shortcuts are never spelled out here: the tour says "press ?", which opens the list of
// every shortcut, so a chord changed tomorrow cannot leave a stale one in the tour.

export const TOUR_STEP_COPY = Object.freeze({
  'first-run': Object.freeze({
    title: 'Welcome to your Notebook',
    body: 'Start here: write a note, create a thesis or bring in the notes you already have.',
  }),
  sidebar: Object.freeze({
    title: 'Folders and tags',
    body: 'Your folders, tags and saved views live here. Choose one to see just those notes.',
  }),
  search: Object.freeze({
    title: 'Search',
    body: 'Find any word in any note. Press ? at any time to see every keyboard shortcut.',
  }),
  'new-note': Object.freeze({
    title: 'New note',
    body: 'Start a blank note, or pick a template such as the daily note.',
  }),
  'view-switcher': Object.freeze({
    title: 'Views',
    body: 'See your notes as a list, a table, a board, a calendar, a graph of their links, a timeline or a list of tasks.',
  }),
  import: Object.freeze({
    title: 'Import',
    body: 'Bring in notes from Notion, Obsidian, Evernote, Markdown files or Word documents.',
  }),
  ask: Object.freeze({
    title: 'Ask your notebook',
    body: 'Ask a question and get an answer drawn from your own notes, with the notes it came from.',
  }),
  export: Object.freeze({
    title: 'Export',
    body: 'Download this note as Markdown, a web page, JSON or Word, or print it to a PDF.',
  }),
})

export const TOUR_UI = Object.freeze({
  progress: (n, total) => `Step ${n} of ${total}`,
  back: 'Back',
  next: 'Next',
  done: 'Done',
  skip: 'Skip tour',
  help: 'Read the Notebook help',
})

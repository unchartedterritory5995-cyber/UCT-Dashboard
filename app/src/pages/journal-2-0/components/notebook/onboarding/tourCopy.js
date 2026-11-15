// Every sentence the first-run tour speaks (wave 8, lane 8C, C2), keyed by the step ids in
// tourSteps.js. A step there is exactly {id, anchor, file} (tourAnchors.test.js holds it to
// that), so its words live here. NotebookTour.test.jsx asserts every one as rendered text,
// and that every step has its copy.
//
// ⛔ Shortcuts are never spelled out here: the tour says "press ?", which opens the list of
// every shortcut, so a chord changed tomorrow cannot leave a stale one in the tour.

export const TOUR_STEP_COPY = Object.freeze({
  sidebar: Object.freeze({
    title: 'Folders and tags',
    body: 'Your folders and tags live here. Choose one to see just those notes.',
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
    body: 'Open View to see your notes as a list, a table, a board, a calendar or a list of tasks. A graph of their links and a timeline are under More views. Your saved views are in View too.',
  }),
  import: Object.freeze({
    title: 'Import',
    body: 'Open the ▾ beside New and choose Import to bring in notes from Notion, Obsidian, Evernote, Markdown files or Word documents.',
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

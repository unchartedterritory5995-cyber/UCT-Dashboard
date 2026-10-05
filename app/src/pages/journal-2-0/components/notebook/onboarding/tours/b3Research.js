// Wave 14 lane W14-B3: the research-and-setups track (plan 4.2 rows 15 to 21).
//
// Thin entries only: each `load()` is a dynamic import of its own `*.steps.js`, so no
// step or copy reaches the Notebook's first-open bytes (risk R3). The authoring
// contract and the anchor rule are at the top of `./index.js`. The reasoning behind
// every gate, start and anchor choice is in docs/notebook/wave14-w14-b3.md.
//
// Two rows name two flags. One flag gates each tour:
//   * setups board + find similar: `notebook_setups_board_enabled`. The tour starts on
//     a board card; the find-similar steps sit on elements that render only while that
//     capability is on, so with it off they are skipped, never shown pointing at nothing.
//   * transcript capture + thesis chips: `notebook_transcript_capture_enabled`. The
//     transcript sheet is the only one of the two with a surface inside the Notebook;
//     the thesis-chip step is skipped wherever no chip is on screen.
//
// `start` is set only where the starting screen is a fixed Notebook location (Research
// Home). A chart block, a playbook sheet, a transcript sheet and a resurfaced version
// all live inside one particular note, which a static path cannot name, and the setups
// board is a sibling route the engine is not mounted on.
const steps = (m) => ({ steps: m.STEPS, copy: m.COPY })

export const TOURS = Object.freeze([
  {
    id: 'ta-fingerprint',
    flag: 'notebook_ta_fingerprint_enabled',
    title: 'The technical fingerprint',
    replayable: true,
    load: () => import('./taFingerprint.steps').then(steps),
  },
  {
    id: 'visual-playbook',
    flag: 'notebook_visual_playbook_enabled',
    title: 'Visual playbook',
    replayable: true,
    load: () => import('./visualPlaybook.steps').then(steps),
  },
  {
    id: 'setups-board',
    flag: 'notebook_setups_board_enabled',
    title: 'Active setups and find more like this',
    replayable: true,
    load: () => import('./setupsBoard.steps').then(steps),
  },
  {
    id: 'earnings-prep',
    flag: 'notebook_earnings_prep_enabled',
    title: 'Reporting soon and earnings prep',
    replayable: true,
    start: '/journal/notebook',
    load: () => import('./earningsPrep.steps').then(steps),
  },
  {
    id: 'transcript-capture',
    flag: 'notebook_transcript_capture_enabled',
    title: 'Transcript passages and thesis chips',
    replayable: true,
    load: () => import('./transcriptCapture.steps').then(steps),
  },
  {
    id: 'passed-setups',
    flag: 'notebook_passed_setups_enabled',
    title: 'Passed setups',
    replayable: true,
    start: '/journal/notebook',
    load: () => import('./passedSetups.steps').then(steps),
  },
  {
    // Plan 4.2 row 21: a passive explainer, not a stepper, so Help does not list it.
    id: 'note-resurfaces',
    flag: 'awareness_note_resurface_enabled',
    title: 'A note resurfaces',
    replayable: false,
    load: () => import('./noteResurfaces.steps').then(steps),
  },
])

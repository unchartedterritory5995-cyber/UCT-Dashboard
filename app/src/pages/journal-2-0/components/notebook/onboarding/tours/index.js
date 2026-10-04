// The per-TRACK seam of the onboarding tour registry (wave 14, lane W14-0).
//
// W14-B authors ~20 capability tours in parallel slices. So that two slices never
// edit the same lines, each track owns ONE file in this directory, and this index
// is the only shared file -- one import line and one spread per track, nothing
// else. `tourRegistry.js` assembles `TOUR_REGISTRY` from the base tour plus
// `TRACK_TOURS` below and refuses a duplicate id BY NAME (`assembleRegistry`).
//
// Why an explicit list and not `import.meta.glob`: the list is readable by the
// node-environment rails (tourRegistry.test.js parses this file with acorn) and
// by a reviewer, and a track file joins the registry only by a deliberate line
// here -- a stray file dropped in this directory does nothing. Either way the
// step DATA stays lazy (risk R3): what a track file exports is a THIN entry
// whose `load()` is a dynamic `import()`; only that entry object is in the
// Notebook's first-open bytes, never its steps or copy.
//
// ── AUTHORING CONTRACT FOR ONE TOUR ──────────────────────────────────────────
//
// A track file, e.g. `tours/writingHelp.js`, exports `TOURS`, an array of entries:
//
//   export const TOURS = [
//     {
//       id: 'writing-help',                       // unique across the WHOLE registry
//       flag: 'notebook_writing_help_enabled',    // notebookFlag() key of the tour's
//                                                 // OWN capability; the tour shows only
//                                                 // when that flag is true
//       title: 'Writing help',                    // member-visible name (Help > Walkthroughs)
//       replayable: true,                         // Help offers a Replay button
//       load: () => import('./writingHelp.steps') // DYNAMIC import only -- never static
//         .then((m) => ({ steps: m.STEPS, copy: m.COPY })),
//     },
//   ]
//
//   * `id`         a string, unique across the registry. The per-tour seen state
//                  (tourSeenState.js, preference `notebook_tours`) is keyed by it,
//                  so it is permanent once shipped: renaming an id forgets every
//                  member's progress on that tour.
//   * `flag`       a lower-case notebookFlag() key. No registry-wide flag exists.
//   * `title`      plain text, sentence case.
//   * `replayable` boolean; false only for a passive explainer that is not a stepper.
//   * `load`       `() => Promise<{ steps, copy }>`, resolved ONLY when the tour is
//                  wanted.
//   * `start`      OPTIONAL. The location the tour starts at (plan 4.2: "the screen
//                  where a member would naturally first meet it"), a path under
//                  `/journal/notebook`, e.g. `'/journal/notebook?view=all'`. Help's
//                  Replay links there, and when a tour is opened elsewhere while its
//                  FIRST step's anchor is not on screen, the engine navigates there.
//                  Either way it then waits up to START_WAIT_MS for that anchor.
//   Those five fields, plus optionally `start`; the registry rail refuses any other.
//
//   steps: `[{ id, anchor, file }]` in tour order, 3 to 6 of them (plan 4.2).
//   copy:  `{ [step.id]: { title, body } }`, one entry per step.
//
// ANCHOR RULE (risk R1). Each step's `anchor` is a literal `data-tour="<anchor>"`
// attribute that appears EXACTLY ONCE in the JSX of `file` (a path relative to
// app/src/pages/journal-2-0/). tourAnchors.test.js loads every registered tour
// and fails by tour and step name when an anchor is missing, duplicated or only
// in a comment. Adding the anchor is the one agreed line in the capability's own
// component. A step whose anchor is not on screen at run time is skipped, never
// shown pointing at nothing; an anchor that exists only on one tier (phone or
// desktop) is fine for that reason, and the step says so in its copy if needed.
//
// To add a track: create `tours/<track>.js` exporting `TOURS`, add one import
// line and one spread below. Nothing else in the engine changes.

import { TOURS as b3ResearchTours } from './b3Research'

export const TRACK_TOURS = Object.freeze([
  // ...writingHelpTours,   <- one spread per track file, in registry order
  ...b3ResearchTours,
])

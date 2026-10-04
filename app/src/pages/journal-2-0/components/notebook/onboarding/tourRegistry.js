// The onboarding tour REGISTRY (wave 14, lane W14-0): every tour as DATA, so a new
// capability's walkthrough is authored without touching an engine.
//
// Entry 1, `notebook-basics`, is wave 8's existing first-run tour, described here as
// data WITHOUT being reimplemented: its runtime stays `tourSteps.js` + `tourCopy.js` +
// `NotebookTour.jsx` + `NotebookTourGate.jsx`, byte-for-byte unchanged -- the wave-14
// charter for this lane is zero behaviour change, regression-proved by the existing
// suite (NotebookTour*.test.jsx, NotebookTourGate.test.jsx, tourAnchors.test.js,
// tourLazy.test.js, NotebookTab.tourChunk.test.jsx, none of them edited to make this
// true). This registry entry exists so the Help "replay a tour" list (Support.jsx)
// and the anchor rail (tourAnchors.test.js) can name it generically, alongside every
// tour this wave adds from here on -- NOT so the base tour's own mount changes.
//
// Every OTHER entry runs through the ONE generic engine this lane adds,
// `GenericTourEngine.jsx`, gated by `RegistryToursGate.jsx` -- never a bespoke
// component per tour (plan section 5.1/5.2). An entry is intentionally THIN:
//   id          unique string; also the key the per-tour seen-state map uses
//               (tourSeenState.js) and the id Help's Replay button and
//               `openRegistryTour` pass around.
//   flag        the notebookFlag() key that gates this tour's own capability. Every
//               tour this wave ships already has its OWN dark flag per the standing
//               per-capability convention (CLAUDE.md); there is no registry-wide flag
//               (see docs/notebook/wave14-w14-0.md section "flags" for why).
//   title       the member-visible name (Help's Walkthroughs list).
//   replayable  whether Help offers a Replay button. Every tour section 4.2's table
//               lists is replayable; the field exists because row 21 of that table
//               (a passive resurfacing explainer, not a stepper) is explicitly not.
//   load        () => Promise<{ steps, copy }> -- called ONLY once the tour is
//               WANTED (risk R3: nothing here is pulled into the Notebook's
//               first-open bytes; `RegistryToursGate.jsx` never imports a tour's
//               `load()` result until some caller asks for that tour by id).
//
// `load` is never called for `notebook-basics` by the generic engine (its own
// runtime does not go through here); the anchor rail calls every entry's `load()`,
// so this entry's answers with the SAME `tourSteps.js` / `tourCopy.js` modules the
// real tour reads -- not a copy, the same exports, so the two can never drift.
//
// Every entry beyond the base one arrives through the per-TRACK seam,
// `tours/index.js` (`TRACK_TOURS`), one file per W14-B track, so parallel
// authoring slices never edit the same lines. That file carries the authoring
// contract for one tour. `assembleRegistry` below is the one place the pieces
// are joined, and it refuses a malformed entry or a duplicate id BY NAME.
import { TOUR_START_STATE } from './tourControl'
import { TRACK_TOURS } from './tours'

export const BASE_TOUR_ID = 'notebook-basics'

/** The exact field set every entry carries (tours/index.js, authoring contract). */
export const ENTRY_FIELDS = Object.freeze(['flag', 'id', 'load', 'replayable', 'title'])

const BASE_ENTRY = Object.freeze({
  id: BASE_TOUR_ID,
  flag: 'notebook_onboarding_enabled',
  title: 'Notebook basics',
  replayable: true,
  load: () => Promise.all([import('./tourSteps'), import('./tourCopy')])
    .then(([stepsMod, copyMod]) => ({ steps: stepsMod.TOUR_STEPS, copy: copyMod.TOUR_STEP_COPY })),
})

/** Join the base entry and every track's entries into one frozen registry, in
 *  order. Throws, naming the offender, on an entry missing or adding a field, a
 *  field of the wrong type, or an id that appears twice -- two tracks claiming
 *  one id would share one member's seen-state row and one Replay link, and the
 *  second tour would be unreachable. Exported so a rail can hand in its own
 *  track lists without adding an example tour to the product. */
export function assembleRegistry(...lists) {
  const out = []
  const seen = new Map()
  lists.forEach((list, li) => {
    ;(list || []).forEach((e, ei) => {
      const where = li === 0 ? `base entry ${ei}` : `track list ${li}, entry ${ei}`
      const keys = e && typeof e === 'object' ? Object.keys(e).sort() : []
      if (keys.join() !== ENTRY_FIELDS.join()) {
        throw new Error(`tour registry: ${where} (id ${JSON.stringify(e?.id)}) must have exactly the fields ${ENTRY_FIELDS.join(', ')}; it has ${keys.join(', ') || 'none'}`)
      }
      if (typeof e.id !== 'string' || !e.id || typeof e.flag !== 'string' || !e.flag
        || typeof e.title !== 'string' || typeof e.replayable !== 'boolean' || typeof e.load !== 'function') {
        throw new Error(`tour registry: ${where} (id ${JSON.stringify(e.id)}) has a field of the wrong type`)
      }
      if (seen.has(e.id)) {
        throw new Error(`tour registry: duplicate tour id "${e.id}" (${seen.get(e.id)} and ${where})`)
      }
      seen.set(e.id, where)
      out.push(Object.isFrozen(e) ? e : Object.freeze({ ...e }))
    })
  })
  return Object.freeze(out)
}

export const TOUR_REGISTRY = assembleRegistry([BASE_ENTRY], TRACK_TOURS)

/** One entry by id, from `registry` (defaults to the real `TOUR_REGISTRY`) -- a
 *  parameter so a test can hand in its own small registry without touching this
 *  module's state. */
export function getTourEntry(id, registry = TOUR_REGISTRY) {
  return registry.find((t) => t.id === id) || null
}

/** Every tour Help should offer a Replay button for, in registry order. */
export function replayableTours(registry = TOUR_REGISTRY) {
  return registry.filter((t) => t.replayable)
}

/** The router `location.state` that opens one tour, whatever opens it (a Help
 *  Replay link, or any future caller). Mirrors the base tour's own
 *  `TOUR_START_STATE` (tourControl.js) exactly for `notebook-basics`, so a Replay
 *  link for it is byte-identical to the existing "Take the tour" link's state --
 *  zero behaviour change for the one tour that already ships. Every other tour
 *  reads `startRegistryTourId` (RegistryToursGate.jsx). */
export function startState(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id
  return id === BASE_TOUR_ID ? TOUR_START_STATE : Object.freeze({ startRegistryTourId: id })
}

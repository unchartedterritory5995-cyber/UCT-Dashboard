// app/src/components/chart/__tests__/tourProbe.fixture.js
//
// ⭐ UCT RS PHASE 4, UNIT 4-03 — a probe definition that declares `meta.tour` and
// `meta.searchHint`, registered beside the shipped catalogue the way
// `inspectorTextProbe.fixture.js` swaps its `textProbe` in. No shipped definition
// carries a tour or a hint in this unit (4-04 adds them to `rsLine`), so the engine
// is tested against a probe and never against a name it might one day hard-code.
// Not a test file: vitest only collects `*.test.*`.
import { validateDefinition } from '../engine/defSchema'
import { textProbeRaw } from './inspectorTextProbe.fixture'

export const TOUR_PROBE_ID = 'tourProbe'
export const TOUR_PROBE_NAME = 'Tour probe'
export const HINT_LINE = 'Looking for something else? Try the tour probe.'

export const TOUR = Object.freeze([
  Object.freeze({ title: 'What it shows', body: 'One line that tells you how a stock is doing.' }),
  Object.freeze({ title: 'How to read it', body: 'Up is better than down.' }),
])

/** The raw probe document: the Inspector suites' server probe, renamed, with a
 *  tour and a search hint. `meta` overrides merge over the probe's own. */
export const tourProbeRaw = (meta = {}) => {
  const raw = textProbeRaw()
  return {
    ...raw,
    id: TOUR_PROBE_ID,
    compute: { ...raw.compute, fn: TOUR_PROBE_ID },
    meta: {
      ...raw.meta,
      name: TOUR_PROBE_NAME,
      shortName: 'TPR',
      tour: TOUR.map((c) => ({ ...c })),
      searchHint: { queries: ['rsi', 'relative strength index'], line: HINT_LINE },
      ...meta,
    },
  }
}

export function tourProbeDefinition(meta) {
  const res = validateDefinition(tourProbeRaw(meta))
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  return res.def
}

/** `nativeRegistry` with probe definitions registered beside the shipped ones. */
export function withTourProbe(actual, ...probes) {
  const list = probes.length ? probes : [tourProbeDefinition()]
  const byId = new Map(list.map((d) => [d.id, d]))
  return {
    ...actual,
    getDefinition: (id) => (byId.has(id) ? byId.get(id) : actual.getDefinition(id)),
    listDefinitions: () => [...actual.listDefinitions(), ...list],
    listAllDefinitions: () => [...actual.listAllDefinitions(), ...list],
  }
}

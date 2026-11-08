// app/src/components/chart/__tests__/tourProbe.fixture.js
//
// ⭐ UCT RS PHASE 4, UNIT 4-03 — a probe definition that declares `meta.tour` and
// `meta.searchHint`, registered beside the shipped catalogue the way
// `inspectorTextProbe.fixture.js` swaps its `textProbe` in. The engine is tested
// against a probe and never against a name it might one day hard-code.
// ⭐ Unit 4-04 gave the shipped `rsLine` a tour and the same "rsi" hint, so
// `withTourProbe` registers the probe over `withoutShippedTeaching(actual)`: the
// shipped definitions with their `meta.tour` / `meta.searchHint` taken off, and
// the probe the only definition that teaches. The shipped copy has its own rail
// (`__tests__/rsTeaching.test.js`).
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

/** A shipped definition without its teaching: `meta.tour` and `meta.searchHint`
 *  dropped, everything else the same. A definition that carries neither is
 *  returned as it is. */
function untaught(def) {
  if (!def?.meta || (!('tour' in def.meta) && !('searchHint' in def.meta))) return def
  const { tour: _tour, searchHint: _hint, ...meta } = def.meta
  return { ...def, meta }
}

/** `nativeRegistry` with no definition carrying a tour or a search hint. Each
 *  stripped definition is built once, so a lookup keeps returning one object. */
export function withoutShippedTeaching(actual) {
  const memo = new Map()
  const strip = (d) => {
    if (!d) return d
    if (!memo.has(d)) memo.set(d, untaught(d))
    return memo.get(d)
  }
  return {
    ...actual,
    getDefinition: (id) => strip(actual.getDefinition(id)),
    listDefinitions: () => actual.listDefinitions().map(strip),
    listAllDefinitions: () => actual.listAllDefinitions().map(strip),
  }
}

/** `nativeRegistry` with probe definitions registered beside the shipped ones,
 *  the shipped ones untaught (see the header). */
export function withTourProbe(actual, ...probes) {
  const shipped = withoutShippedTeaching(actual)
  const list = probes.length ? probes : [tourProbeDefinition()]
  const byId = new Map(list.map((d) => [d.id, d]))
  return {
    ...shipped,
    getDefinition: (id) => (byId.has(id) ? byId.get(id) : shipped.getDefinition(id)),
    listDefinitions: () => [...shipped.listDefinitions(), ...list],
    listAllDefinitions: () => [...shipped.listAllDefinitions(), ...list],
  }
}

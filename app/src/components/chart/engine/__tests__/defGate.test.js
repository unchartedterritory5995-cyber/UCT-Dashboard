// UCT RS split, unit U1 — the DEFINITION-level server gate (`meta.requiresServer`).
//
// A definition that declares `meta.requiresServer: true` is hidden from every
// surface that OFFERS indicators to add until the live server's
// `/api/signature/definitions` lists its id — through the same fail-closed fetch
// the per-input gate reads (`serverCompute.serverDeclares`), never a second one.
// An instance already on a chart is not an offer: it validates, keeps its rows
// and resolves exactly as before.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isDefinitionOffered, isCatalogRowOffered, definitionRequiresServer, serverDefinitionsVersion,
  primeServerDefinitions, clearServerDefinitions, fetchServerDefinitions, subscribeServerDefinitions,
  __setServerDefinitionsFetcherForTests, SERVER_DEFINITIONS_PATH,
} from '../serverCompute'
import { validateDefinition } from '../defSchema'
import { validateInstance, normalizeInstances } from '../instances'
import { addInstance } from '../instanceControls'
import { catalogRows } from '../../indicatorCatalog'
import { technicalResults, libraryRows } from '../../discoveryCatalog'
import { listEngineIndicators } from '../../indicatorRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import * as engineRegistry from '../nativeRegistry'

// ⭐ THE REAL ROUTE SHAPE (`api/routers/signature.py::server_definitions`): an
// envelope `{schemaVersion, definitions: [row, …]}`; a row that lists an id is
// what "the server declares it" means.
const body = (...ids) => ({
  schemaVersion: 1,
  definitions: ids.map((id) => ({
    schemaVersion: 1, id, version: 1, compute: { kind: 'server', fn: id, rev: 1 }, inputs: [], columns: ['line'],
  })),
})

/** A server definition carrying the definition-level gate — the shape U6's three new RS definitions take. */
const GATED_RAW = {
  schemaVersion: 1, id: 'probeGated', version: 1,
  compute: { kind: 'server', fn: 'probeGated', rev: 1 },
  meta: {
    name: 'Probe Gated', shortName: 'PG', category: 'Momentum', tier: 'premium', repaint: 'non-repainting',
    requiresServer: true, serverInputs: ['length'],
  },
  placement: { target: 'pane' },
  inputs: [
    { key: 'length', type: 'int', default: 14, min: 2, max: 200 },
    { key: 'color', type: 'color', default: 'token:info' },
  ],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: '$color', width: 1 }],
  events: [],
}
/** The CONTROL: the same definition without the flag. */
const PLAIN_RAW = { ...GATED_RAW, id: 'probePlain', compute: { ...GATED_RAW.compute, fn: 'probePlain' },
  meta: { ...GATED_RAW.meta, name: 'Probe Plain', shortName: 'PP', requiresServer: undefined } }

const accept = (raw) => {
  const r = validateDefinition(raw)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.def
}
const GATED = accept(GATED_RAW)
const PLAIN = accept(PLAIN_RAW)

/** The shipped registry plus the two probes — the shape every surface under test is handed. */
const registry = {
  ...engineRegistry,
  listDefinitions: () => [...engineRegistry.listDefinitions(), GATED, PLAIN],
  getDefinition: (id) => (id === GATED.id ? GATED : id === PLAIN.id ? PLAIN : engineRegistry.getDefinition(id)),
}

beforeEach(() => {
  clearServerDefinitions()
  __setServerDefinitionsFetcherForTests(null)
})
afterEach(() => {
  clearServerDefinitions()
  __setServerDefinitionsFetcherForTests(null)
})

describe('isDefinitionOffered — the one question every offer surface asks', () => {
  it('⛔ FAILS CLOSED: nothing landed yet → a gated definition is not offered', () => {
    expect(definitionRequiresServer(GATED)).toBe(true)
    expect(isDefinitionOffered(GATED)).toBe(false)
  })

  it('a server that lists OTHER ids does not offer it; one that lists its id does', () => {
    primeServerDefinitions(body('rsLine', 'dpl'))
    expect(isDefinitionOffered(GATED)).toBe(false)
    primeServerDefinitions(body('rsLine', GATED.id))
    expect(isDefinitionOffered(GATED)).toBe(true)
  })

  it('a failed fetch (a 402, a throw, a malformed body) is "not offered"', async () => {
    await fetchServerDefinitions(async () => { throw new Error('402') })
    expect(isDefinitionOffered(GATED)).toBe(false)
    clearServerDefinitions()
    await fetchServerDefinitions(async () => ({ nope: true }))
    expect(isDefinitionOffered(GATED)).toBe(false)
  })

  it('⭐ a definition WITHOUT the flag is offered whatever the server says — and never asks', async () => {
    let asked = 0
    __setServerDefinitionsFetcherForTests(async (url) => { asked += 1; expect(url).toBe(SERVER_DEFINITIONS_PATH); return body('rsLine') })
    expect(definitionRequiresServer(PLAIN)).toBe(false)
    expect(isDefinitionOffered(PLAIN)).toBe(true)
    expect(isDefinitionOffered(engineRegistry.getDefinition('rsi'))).toBe(true)
    expect(asked, 'listing an ungated definition spent the page\'s one definitions GET').toBe(0)
    // …and the gated one DOES start the one request, which is the fetch the per-input gate already pays for.
    expect(isDefinitionOffered(GATED)).toBe(false)
    await Promise.resolve()
    expect(asked).toBe(1)
    expect(isDefinitionOffered(GATED)).toBe(false)   // rsLine only
  })

  it('reaches the real fetch path: the one GET lands and the gated definition opens', async () => {
    await fetchServerDefinitions(async () => body(GATED.id))
    expect(isDefinitionOffered(GATED)).toBe(true)
  })

  it('null and junk are not offered', () => {
    expect(isDefinitionOffered(null)).toBe(false)
    expect(isDefinitionOffered('rsi')).toBe(false)
  })

  it('the version moves on every landing, so a surface keyed on it re-lists', async () => {
    const v0 = serverDefinitionsVersion()
    let pings = 0
    const off = subscribeServerDefinitions(() => { pings += 1 })
    primeServerDefinitions(body('rsLine'))
    expect(serverDefinitionsVersion()).toBeGreaterThan(v0)
    expect(pings).toBe(1)
    const v1 = serverDefinitionsVersion()
    await fetchServerDefinitions(async () => body(GATED.id))   // primed → memoised; no change
    expect(serverDefinitionsVersion()).toBe(v1)
    off()
  })
})

describe('isCatalogRowOffered — the row form, for `catalogRows()` readers', () => {
  it('a row whose definition is gated follows the gate; a carved-out or built-in row has nothing to gate', () => {
    const rows = catalogRows(registry)
    const gatedRow = rows.find((r) => r.id === GATED.id)
    const plainRow = rows.find((r) => r.id === PLAIN.id)
    const carved = rows.find((r) => r.carvedOut)
    expect(gatedRow && plainRow && carved, 'the fixture rows are missing').toBeTruthy()
    expect(isCatalogRowOffered(gatedRow, registry)).toBe(false)
    expect(isCatalogRowOffered(plainRow, registry)).toBe(true)
    expect(isCatalogRowOffered(carved, registry)).toBe(true)
    expect(isCatalogRowOffered({ id: 'ma', builtIn: true }, registry)).toBe(true)
    primeServerDefinitions(body(GATED.id))
    expect(isCatalogRowOffered(gatedRow, registry)).toBe(true)
  })

  it('no registry to ask → every row is offered (nothing can be gated); junk is not a row', () => {
    expect(isCatalogRowOffered({ id: GATED.id })).toBe(true)
    expect(isCatalogRowOffered(null, registry)).toBe(false)
  })
})

describe('the offer surfaces hide a gated definition until the server lists it', () => {
  it('the discovery catalogue and its search (`technicalResults`), the library rows (`libraryRows`)', () => {
    const idsOf = (list) => list.map((r) => r.id)
    expect(idsOf(technicalResults(registry))).not.toContain(GATED.id)
    expect(idsOf(libraryRows(registry))).not.toContain(GATED.id)
    // …the control rides the same lists.
    expect(idsOf(technicalResults(registry))).toContain(PLAIN.id)
    expect(idsOf(libraryRows(registry))).toContain(PLAIN.id)
    primeServerDefinitions(body(GATED.id))
    expect(idsOf(technicalResults(registry))).toContain(GATED.id)
    expect(idsOf(libraryRows(registry))).toContain(GATED.id)
  })

  it('a server listing OTHER ids keeps it hidden', () => {
    primeServerDefinitions(body('rsLine'))
    expect(technicalResults(registry).map((r) => r.id)).not.toContain(GATED.id)
  })

  it('⛔ `catalogRows()` itself is UNCHANGED — the shipped manifest still lists it', () => {
    // The gate is subtracted at the consumer, like `LIBRARY_HIDDEN_IDS`; the
    // registry rails that read `catalogRows()` against `listDefinitions()` keep
    // their meaning.
    expect(catalogRows(registry).map((r) => r.id)).toContain(GATED.id)
  })

  it('Chart Settings "Indicators": no "turn it on" row for a gated definition nobody has placed', () => {
    const rows = listEngineIndicators(mergeChartSettings(null), registry)
    expect(rows.map((r) => r.defId)).not.toContain(GATED.id)
    expect(rows.map((r) => r.defId)).toContain(PLAIN.id)
    primeServerDefinitions(body(GATED.id))
    expect(listEngineIndicators(mergeChartSettings(null), registry).map((r) => r.defId)).toContain(GATED.id)
  })
})

describe('⭐ an instance of a hidden definition is NOT an offer: it validates and still resolves', () => {
  const placed = () => addInstance(mergeChartSettings(null), GATED.id, registry)

  it('validates (F20 never drops it) and survives normalisation with no server answer', () => {
    const cs = placed()
    const inst = cs.indicatorInstances.find((i) => i.defId === GATED.id)
    expect(inst, 'addInstance refused the gated definition — placing is not offering').toBeTruthy()
    expect(isDefinitionOffered(GATED)).toBe(false)
    const v = validateInstance(inst, registry)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
    const n = normalizeInstances(cs.indicatorInstances, registry)
    expect(n.kept.map((i) => i.defId)).toContain(GATED.id)
    expect(n.dropped).toEqual([])
  })

  it('keeps its settings row while the OFFER row stays hidden — and the definition still resolves for the binder', () => {
    const rows = listEngineIndicators(placed(), registry).filter((r) => r.defId === GATED.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].instanceId, 'the row is the instance\'s, not a fresh "turn it on" offer').toBeTruthy()
    // What draws reads `getDefinition`, which the gate never touches.
    expect(registry.getDefinition(GATED.id)).toBe(GATED)
  })
})

describe('the byte-identical CONTROL — exactly the RS split\'s three carry the flag, and nothing else moves', () => {
  // ⭐ U6 (2026-11-09) landed `rsRating`, `rsPhases` and `rsVsEma` with the flag.
  // Spelled by name: a fourth definition picking the flag up is a decision this
  // case fails first, and a definition losing it reaches members a deploy early.
  const GATED_SHIPPED = ['rsRating', 'rsPhases', 'rsVsEma']

  it('every shipped definition but the three is offered with nothing landed, so every other offer list is what it was', () => {
    expect(engineRegistry.listDefinitions().filter((d) => definitionRequiresServer(d)).map((d) => d.id)).toEqual(GATED_SHIPPED)
    for (const def of engineRegistry.listDefinitions()) {
      expect(isDefinitionOffered(def), def.id).toBe(!GATED_SHIPPED.includes(def.id))
    }
    const shipped = engineRegistry.listDefinitions().map((d) => d.id)
    const offered = () => libraryRows(engineRegistry).filter((r) => r.kind === 'technical' && !r.carvedOut).map((r) => r.id)
    expect(offered()).toEqual(shipped.filter((id) => !['dataSeries', ...GATED_SHIPPED].includes(id)))
    // …and the gate is the ONLY thing hiding them: once the live server lists the
    // ids, the library offers the whole shipped catalogue (minus `dataSeries`, as ever).
    primeServerDefinitions(body('rsLine', ...GATED_SHIPPED))
    expect(offered()).toEqual(shipped.filter((id) => id !== 'dataSeries'))
  })
})

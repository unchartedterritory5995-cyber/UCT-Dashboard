// @vitest-environment node
// app/src/components/chart/engine/heldWithholds.savedCopies.test.js
//
// ─── ⭐⭐ A SAVED COPY MINTED BEFORE ITS SCRIPT'S NARROW WITHHOLDS, AT THE BROWSER'S DOORS (coordinator ruling 2026-11-19)
//
// The server (`api/services/held_withholds.py`) tells a copy the member door minted BEFORE a withhold by its mint stamp
// (`meta.heldWithholds`), and serves it stamped `meta.heldDivergence`. Rails here:
//   · the key the door stamps is the key the server reads (ONE fixture, `tests/fixtures/held_withhold_keys.json`,
//     asserted by both languages), and the door really stamps it on a mint, on both doors;
//   · the install door refuses a served row stamped `meta.heldDivergence`, by the server's sentence, on both lanes, and
//     keeps it (killedIds, never deleted); the same row unstamped installs.
// The headless compute's refusal is railed in `__tests__/headlessCompute.test.js` (section 3). Mutation-proved:
// `ci/mutants/held-withholds-saved-copies.json`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { sha256Hex } from './ast/parse.js'
import {
  heldWithholdKey, HELD_WITHHOLDS_STAMP, HELD_DIVERGENCE_STAMP, __setHeldWithholdsForTests,
  __ignoreHeldWithholdsForTests,
} from './heldWithholds'
import { validateUserDefinitions } from './nativeRegistry'
import { memberPaneDefinition, __forceRuntimeLaneForTests } from '../builder/memberPane/memberPaneDefinition'
import { retranslateRow } from '../builder/memberPane/savedScriptUpgrade'

const REPO = path.resolve(process.cwd(), '..')
const KEYS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'held_withhold_keys.json'), 'utf8')).cases
// a script with a plot and labels minted on the host door, and one minted on the runtime door (forced, as the
// runtime-on lane routes it). No file outside the engine is read but the key fixture (`tests/fixtures/**` triggers
// the job that runs this rail: `whole-app-engine-rails.yml`).
const HOST = '//@version=5\nindicator("held host", overlay = true)\nm = ta.sma(close, 10)\nplot(m, "Mean")\n'
  + 'if barstate.islast\n    label.new(bar_index, high, "top")\n'
const RUNTIME = '//@version=5\nindicator("held runtime", overlay = true)\nvar float s = 0.0\ns := s + close - open\n'
  + 'plot(s, "Sum")\nif barstate.islast\n    label.new(bar_index, high, "top")\n'
const asMember = (source, withholds) => __setHeldWithholdsForTests({ scripts: [{ sha256: sha256Hex(source), withholds }] })
const mint = (source) => memberPaneDefinition({ source, id: 'u_held_saved', name: 'held' })
const mintRuntime = (source) => {
  __forceRuntimeLaneForTests(true)
  try { return mint(source) } finally { __forceRuntimeLaneForTests(false) }
}
const RUNTIME_DOC = () => {
  __ignoreHeldWithholdsForTests()
  const d = mintRuntime(RUNTIME)
  expect(d.ok && d.definition.compute.kind).toBe('runtime')
  return d.definition
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
})
afterEach(() => { __ignoreHeldWithholdsForTests(); vi.unstubAllEnvs() })

describe('the mint stamp: the key the door writes is the key the server reads', () => {
  it('every scope, from the one fixture both languages assert', () => {
    expect(new Set(KEYS.map((c) => c.withhold.scope))).toEqual(new Set(['output', 'outputColour', 'paint', 'objectFamily']))
    for (const c of KEYS) expect(heldWithholdKey(c.withhold)).toBe(c.key)
  })

  it('the host door stamps the drawing family it withheld; CONTROL: no withhold, no stamp', () => {
    __ignoreHeldWithholdsForTests()
    const plain = mint(HOST)
    expect(plain.ok && plain.lane).not.toBe('runtime')
    expect(plain.definition.meta[HELD_WITHHOLDS_STAMP]).toBeUndefined()
    asMember(HOST, [{ door: 'host', scope: 'objectFamily', family: 'label', evidence: ['cap-a'] }])
    const d = mint(HOST)
    expect(d.ok).toBe(true)
    expect(d.definition.compute.kind).toBe('ast')
    expect(d.definition.meta[HELD_WITHHOLDS_STAMP]).toEqual(['host:objectFamily:label'])
  })

  it('the runtime door stamps every withhold it honoured, sorted', () => {
    asMember(RUNTIME, [
      { door: 'runtime', scope: 'objectFamily', family: 'label', evidence: ['cap-a'] },
      { door: 'runtime', scope: 'output', title: 'No such row', evidence: ['cap-a'] },
      { door: 'host', scope: 'objectFamily', family: 'line', evidence: ['cap-b'] },
    ])
    const d = mintRuntime(RUNTIME)
    expect(d.ok && d.definition.compute.kind).toBe('runtime')
    expect(d.definition.meta[HELD_WITHHOLDS_STAMP]).toEqual(['runtime:objectFamily:label', 'runtime:output:No such row'])
  })
})

describe('the install door: a served row stamped `meta.heldDivergence` is refused by name and kept', () => {
  const SENTENCE = 'pine:held-divergence: this saved copy is not drawn: SERVER SENTENCE'
  const stamped = (d) => ({ ...d, meta: { ...d.meta, [HELD_DIVERGENCE_STAMP]: SENTENCE } })

  it('a runtime row', () => {
    const d = RUNTIME_DOC()
    const v = validateUserDefinitions([stamped(d)])
    expect(v.defs).toEqual([])
    expect(v.killedIds).toEqual([d.id])
    expect(v.errors.join('\n')).toContain(SENTENCE)
    expect(v.errors.join('\n')).toMatch(/the saved definition is kept, unchanged/)
  })

  it('CONTROL: the same runtime row, unstamped, installs', () => {
    const d = RUNTIME_DOC()
    const v = validateUserDefinitions([d])
    expect(v.errors).toEqual([])
    expect(v.defs.map((x) => x.id)).toEqual([d.id])
  })

  it('a host row', () => {
    __ignoreHeldWithholdsForTests()
    const d = mint(HOST).definition
    const v = validateUserDefinitions([stamped(d)])
    expect(v.defs).toEqual([])
    expect(v.killedIds).toEqual([d.id])
    expect(v.errors.join('\n')).toContain(SENTENCE)
  })

  it('CONTROL: the same host row, unstamped, installs', () => {
    __ignoreHeldWithholdsForTests()
    const d = mint(HOST).definition
    const v = validateUserDefinitions([d])
    expect(v.errors).toEqual([])
    expect(v.defs.map((x) => x.id)).toEqual([d.id])
  })
})

describe('a stale host copy WITH its script is re-translated, not refused (the auto-upgrade runs before the install door)', () => {
  it('its new translation honours the withhold, carries no served stamp, stamps the key, and installs', () => {
    __ignoreHeldWithholdsForTests()
    const old = mint(HOST).definition
    asMember(HOST, [{ door: 'host', scope: 'objectFamily', family: 'label', evidence: ['cap-a'] }])
    const served = { ...old, meta: { ...old.meta, [HELD_DIVERGENCE_STAMP]: 'pine:held-divergence: this saved copy is not drawn: x' } }
    const r = retranslateRow({ def_id: old.id, version: 1, rev: 1, definition: served, pine_source: HOST }, memberPaneDefinition)
    expect(r.status).toBe('upgraded')
    expect(r.definition.meta[HELD_DIVERGENCE_STAMP]).toBeUndefined()
    expect(r.definition.meta[HELD_WITHHOLDS_STAMP]).toEqual(['host:objectFamily:label'])
    const v = validateUserDefinitions([r.definition])
    expect(v.errors).toEqual([])
    expect(v.defs.map((x) => x.id)).toEqual([old.id])
  })
})

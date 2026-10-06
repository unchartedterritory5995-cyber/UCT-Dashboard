// P0 TRUTH CORPUS — slice "save", Phase 0Q (INVESTIGATION, NO PATCH).
//
// QUESTION: `mergeChartSettings` keeps only instances whose definition is
// registered. Can a user-definition instance whose definition is TEMPORARILY
// unregistered (rows not loaded yet / refused by `installUserDefinitions`
// re-validation / uninstalled) be WRITTEN BACK AS DELETED by a normal save?
//
// ANSWER MEASURED HERE (see the report for file:line):
//   * A CURRENT blob (`settingsVersion: 2`) passes `indicatorInstances` through
//     VERBATIM — the registry filter at `chartDefaults.js:814` runs only inside
//     the `_storedVersion < 2` fold — and every instance writer spreads the full
//     stored list, so the instance SURVIVES merge + write and draws again once the
//     definition registers. Classification: EXACT (no loss).
//   * A blob BELOW version 2 (or with no `settingsVersion`) that carries a user
//     instance IS pruned by the fold and stamped v2, so the first write after it
//     persists the loss. No shipped writer was found that can produce such a blob
//     (every writer starts from a merged v2 `cs`); the case is pinned so the day
//     one appears the hazard is a red test, not a vanished indicator.
//
// Every case states ASKED / CLAIMED / DID and an outcome class.
import { describe, it, expect, afterEach } from 'vitest'
import { mergeChartSettings } from '../../chartDefaults'
import * as registry from '../nativeRegistry'
import {
  addInstance, setInstanceHidden, setIndicatorEnabled, removeInstance, withInstances,
} from '../instanceControls'
import { normalizeInstances } from '../instances'
import { macdV2Doc } from '../__tests__/macdV2'

const DEF_ID = 'u_0123456789ab'
const USER_INST = { instanceId: `${DEF_ID}:1`, defId: DEF_ID, inputs: {}, hidden: false }

afterEach(() => registry.clearUserDefinitions())

/** What the store / preference holds: a JSON STRING, as `usePreferences` hands it. */
function storedBlob({ version = 2, instances = [USER_INST] } = {}) {
  const base = JSON.parse(JSON.stringify(mergeChartSettings(null)))
  const blob = { ...base, indicatorInstances: [...base.indicatorInstances, ...instances] }
  if (version === null) delete blob.settingsVersion
  else blob.settingsVersion = version
  return JSON.stringify(blob)
}
const hasUser = (cs) => (cs.indicatorInstances || []).some((i) => i && i.instanceId === USER_INST.instanceId)
/** A "normal save opportunity": the merged cs round-trips through the writer and
 *  back through the pref as JSON (what `handleUpdateChartSettings` → `setPref`
 *  → next read does). */
const persistAndReread = (cs) => mergeChartSettings(JSON.stringify(cs))

describe('0Q — an unregistered user definition\'s instance across merge and write', () => {
  it('precondition: the definition installs, and an UNREGISTERED id is dropped by normalizeInstances', () => {
    expect(registry.getDefinition(DEF_ID)).toBeNull()
    expect(normalizeInstances([USER_INST], registry).kept).toHaveLength(0)
    const { installed, errors } = registry.installUserDefinitions([macdV2Doc({ id: DEF_ID })])
    expect(errors).toEqual([])
    expect(installed.map((d) => d.id)).toEqual([DEF_ID])
    expect(normalizeInstances([USER_INST], registry).kept).toHaveLength(1)
  })

  it('EXACT — v2 blob, definition NOT YET LOADED: mergeChartSettings keeps the instance verbatim', () => {
    // ASKED: load a chart whose saved settings draw my formula before my definitions arrive.
    // CLAIMED: my indicator is still mine.  DID: instance passed through untouched.
    expect(registry.getDefinition(DEF_ID)).toBeNull()
    const cs = mergeChartSettings(storedBlob())
    expect(hasUser(cs)).toBe(true)
    expect(cs.indicatorInstances.find((i) => i.instanceId === USER_INST.instanceId)).toEqual(USER_INST)
  })

  it.each([
    ['addInstance (Add to chart, another indicator)', (cs) => addInstance(cs, 'rsi', registry)],
    ['setIndicatorEnabled on (library checkbox)', (cs) => setIndicatorEnabled(cs, 'macd', true, registry)],
    ['setIndicatorEnabled off', (cs) => setIndicatorEnabled(cs, 'rsi', false, registry)],
    ['setInstanceHidden on the unregistered instance', (cs) => setInstanceHidden(cs, USER_INST.instanceId, true, registry)],
    ['removeInstance of ANOTHER instance', (cs) => {
      const other = cs.indicatorInstances.find((i) => i && i.defId !== DEF_ID && !i.deleted)
      return other ? removeInstance(cs, other.instanceId, registry) : cs
    }],
    ['withInstances (the sorting writer every control uses)', (cs) => withInstances(cs, cs.indicatorInstances, registry)],
    ['a plain setting change ({...cs, chartType})', (cs) => ({ ...cs, chartType: 'bars', preset: 'custom' })],
  ])('EXACT — write while unregistered keeps the instance: %s', (_name, write) => {
    // ASKED: change ANY setting while my formula has not loaded (or was refused).
    // CLAIMED: only the setting I touched changes.  DID: the user instance survives the write.
    const cs = mergeChartSettings(storedBlob())
    const next = write(cs)
    const reread = persistAndReread(next)
    expect(hasUser(reread)).toBe(true)
    // …and once the definition registers, it DRAWS again (normalizeInstances keeps it).
    registry.installUserDefinitions([macdV2Doc({ id: DEF_ID })])
    const kept = normalizeInstances(mergeChartSettings(JSON.stringify(reread)).indicatorInstances, registry).kept
    expect(kept.some((i) => i.instanceId === USER_INST.instanceId)).toBe(true)
  })

  it('EXACT — refused by re-validation (installUserDefinitions errors) behaves as not-loaded', () => {
    // A stored row whose badge no longer matches today's linter is refused at install.
    const bad = macdV2Doc({ id: DEF_ID })
    bad.meta = { ...bad.meta, repaint: bad.meta.repaint === 'repaints' ? 'non-repainting' : 'repaints' }
    const { installed, errors } = registry.installUserDefinitions([bad])
    expect(installed).toHaveLength(0)
    expect(errors.length).toBeGreaterThan(0)
    const reread = persistAndReread(addInstance(mergeChartSettings(storedBlob()), 'rsi', registry))
    expect(hasUser(reread)).toBe(true)
  })

  it('EXACT — a write while unregistered puts the instance where a registered write would (order)', () => {
    // `withInstances` sorts by the registry's stack order; an id the registry does
    // not hold ranks 1e9 (last) — and a REGISTERED user definition also ranks after
    // every shipped one, so the written order is the same either way (measured).
    const cs = mergeChartSettings(storedBlob())
    const unreg = withInstances(cs, cs.indicatorInstances, registry).indicatorInstances.map((i) => i.instanceId)
    registry.installUserDefinitions([macdV2Doc({ id: DEF_ID })])
    const reg = withInstances(cs, cs.indicatorInstances, registry).indicatorInstances.map((i) => i.instanceId)
    expect(unreg).toEqual(reg)
  })

  it.each([[1], [null]])(
    'HAZARD PINNED (no shipped producer found) — a blob at settingsVersion=%s carrying a user instance IS pruned by the fold',
    (version) => {
      // ASKED: load a pre-v2 (or versionless) blob that draws my formula before it loads.
      // DID: the `_storedVersion < 2` fold runs `normalizeInstances(seeded, engineRegistry)`
      //      (chartDefaults.js:814), drops the unregistered instance, stamps v2 — and the
      //      next write persists the loss. Registering later does NOT restore it.
      // CLASS: this is the loss shape; it is reachable only if some writer persists a
      //      blob below v2 that carries a user instance — none was found (report §0Q).
      expect(registry.getDefinition(DEF_ID)).toBeNull()
      const cs = mergeChartSettings(storedBlob({ version }))
      expect(cs.settingsVersion).toBe(2)
      expect(hasUser(cs)).toBe(false)
      const reread = persistAndReread({ ...cs, chartType: 'bars' })
      registry.installUserDefinitions([macdV2Doc({ id: DEF_ID })])
      expect(hasUser(mergeChartSettings(JSON.stringify(reread)))).toBe(false)
    },
  )

  it('control — the SAME v1 blob with the definition ALREADY registered keeps the instance', () => {
    registry.installUserDefinitions([macdV2Doc({ id: DEF_ID })])
    expect(hasUser(mergeChartSettings(storedBlob({ version: 1 })))).toBe(true)
  })
})

// ─── 0P (browser half) — the acknowledgement reaches the authority ──────────
import { vi } from 'vitest'
import { saveUserDefinition } from '../../../../hooks/useUserDefinitions'

describe('0P — the save-time preview-repaint acknowledgement is carried to the server', () => {
  const bodies = []
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch; bodies.length = 0 })
  const stub = () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ def_id: DEF_ID, version: 1, rev: 1 }) }
    })
  }

  it('VALUE — an acknowledged save sends repaint_acknowledged: true (never inside the definition)', async () => {
    // ASKED: save a preview-repaints formula after ticking its acknowledgement.
    // CLAIMED: saved.  DID (before): the tick never left the browser, so the
    // server could not tell an acknowledged save from a direct API call.
    stub()
    const doc = macdV2Doc({ id: DEF_ID })
    await saveUserDefinition(doc, DEF_ID, null, { previewAcked: true })
    expect(bodies[0].repaint_acknowledged).toBe(true)
    expect(bodies[0].definition).toEqual(doc)
  })

  it('EXACT — an ordinary save sends no acknowledgement at all', async () => {
    stub()
    await saveUserDefinition(macdV2Doc({ id: DEF_ID }), DEF_ID, null)
    expect('repaint_acknowledged' in bodies[0]).toBe(false)
  })
})

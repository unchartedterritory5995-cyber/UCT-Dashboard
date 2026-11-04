// SAVED-SCRIPT AUTO-UPGRADE — pre-bump hardening, browser half.
//
//   MEDIUM-1  the write-back says it is an engine upgrade (`save_reason`), and only it.
//   MEDIUM-2  a fresh refusal is REMEMBERED server-side; a remembered refusal or
//             failed write-back means no translator download, no translation, no PUT.
//   L1        only a document the install door accepted is written back.
//   L2        no "paste the script" row on a hand-edited document; marked on save.
//   L4        the held cap covers translation; the upgrade keeps going after release.
//   L5        a non-integer version is never written back.
//   L6        a script over the store's cap is never sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let swrAnswer = { data: undefined, error: undefined, isLoading: true }
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => swrAnswer, mutate: vi.fn() }
})

import { AuthContext } from '../../../../context/AuthContext'
import { useInstalledUserDefinitions, saveUserDefinition, USER_DEFINITIONS_KEY } from '../../../../hooks/useUserDefinitions'
import * as registry from '../../engine/nativeRegistry'
import { astHash } from '../../engine/ast/parse'
import * as mpd from './memberPaneDefinition'
import {
  upgradeKindOf, resolveRow, writeBackOnce, recordOnce, needsScriptForUpgrade, scriptUpgradeHeld, TRANSLATOR_LOAD_TIMEOUT_MS,
  __resetSavedScriptUpgrade, __setTranslatorForTests,
} from './savedScriptUpgrade'
import { SCRIPT_ENGINE_VERSION, engineStampOf, withEngineStamp, PINE_SOURCE_MAX_BYTES } from '../../engine/scriptEngineVersion'

const SCRIPT = '//@version=5\nindicator("Upgrade Probe")\nplot(ta.sma(close, 14), "avg")\n'
const REFUSED = '//@version=5\nindicator("Draws Nothing")\nx = ta.sma(close, 14)\n'
const wrapper = ({ children }) => <AuthContext.Provider value={{ user: { id: 'm1' } }}>{children}</AuthContext.Provider>
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

/** A valid pre-engine script document (planted period 99, its own handle). */
function stale(id) {
  const b = mpd.memberPaneDefinition({ source: SCRIPT, id })
  const d = JSON.parse(JSON.stringify(b.definition))
  d.version = 4
  d.meta = { ...d.meta, name: `Saved ${id}` }
  delete d.meta.engineVersion
  const wrong = JSON.parse(JSON.stringify(d.compute.ast).replace(/"value":14\b/g, '"value":99'))
  return { ...d, compute: { ...d.compute, ast: wrong, fn: astHash(wrong), source: String(d.compute.source).split('14').join('99') } }
}
const rowOf = (definition, extra = {}) => ({ def_id: definition.id, version: 4, rev: 1, definition, ...extra })

let fetchSpy
let putAnswer
beforeEach(() => {
  __resetSavedScriptUpgrade()
  __setTranslatorForTests(mpd)
  swrAnswer = { data: undefined, error: undefined, isLoading: true }
  putAnswer = { ok: true, status: 200, json: async () => ({ def_id: 'x', version: 5 }) }
  fetchSpy = vi.fn(async (url, init = {}) => {
    if (init.method === 'PUT') return putAnswer
    return { ok: true, status: 200, json: async () => ({}) }
  })
  globalThis.fetch = fetchSpy
})
afterEach(() => { registry.clearUserDefinitions(); vi.useRealTimers() })

const calls = (pred) => fetchSpy.mock.calls.filter(([url, init]) => pred(String(url), init || {}))
const puts = () => calls((u, i) => i.method === 'PUT')
const statusPosts = () => calls((u, i) => i.method === 'POST' && u.endsWith('/engine-status'))

describe('MEDIUM-2 — a remembered verdict means no work at all', () => {
  it('a recorded REFUSAL: not drawn, the reason named, the translator never asked', async () => {
    const spy = vi.fn(mpd.memberPaneDefinition)
    __setTranslatorForTests({ memberPaneDefinition: spy })
    const d = stale('u_bbbbbbbbbb01')
    const row = rowOf(d, { has_pine_source: true, engine_status: { engine: SCRIPT_ENGINE_VERSION, status: 'refused', reason: 'offers no plot' } })
    expect(upgradeKindOf(row)).toBe('refused')
    const res = resolveRow(row)
    expect(res.definition).toBe(null)
    expect(res.refusal).toBe('Saved u_bbbbbbbbbb01: offers no plot')
    await flush(); await flush()
    expect(spy).not.toHaveBeenCalled()
  })

  it('a recorded WRITE-FAILED: drawn as stored, the Builder row offered, no translation, no PUT', async () => {
    const spy = vi.fn(mpd.memberPaneDefinition)
    __setTranslatorForTests({ memberPaneDefinition: spy })
    const d = stale('u_bbbbbbbbbb02')
    const row = rowOf(d, { has_pine_source: true, engine_status: { engine: SCRIPT_ENGINE_VERSION, status: 'write-failed', reason: '422' } })
    expect(upgradeKindOf(row)).toBe('retry')
    expect(resolveRow(row).definition).toBe(d)
    expect(needsScriptForUpgrade(d.id)).toBe(true)
    await flush(); await flush()
    expect(spy).not.toHaveBeenCalled()
  })

  it('a status recorded by an OLDER engine is not this engine’s answer: it re-translates', () => {
    const d = stale('u_bbbbbbbbbb03')
    const row = rowOf(d, { pine_source: SCRIPT, engine_status: { engine: SCRIPT_ENGINE_VERSION - 1, status: 'refused', reason: 'old' } })
    expect(upgradeKindOf(row)).toBe('retranslate')
  })

  it('a FRESH refusal is recorded server-side once, for the live version', async () => {
    const id = 'u_bbbbbbbbbb04'
    swrAnswer = { data: [rowOf(stale(id), { pine_source: REFUSED })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await flush(); await flush(); await flush()
    expect(statusPosts().length).toBe(1)
    const [url, init] = statusPosts()[0]
    expect(url).toBe(`${USER_DEFINITIONS_KEY}/${id}/engine-status`)
    expect(JSON.parse(init.body)).toEqual({ version: 4, engine: SCRIPT_ENGINE_VERSION, status: 'refused', reason: expect.stringMatching(/offers no plot/) })
    h.rerender(); await flush()
    expect(statusPosts().length, 'once per stored version').toBe(1)
    h.unmount()
  })

  it('a write-back the store REFUSES (422) is remembered as write-failed; no second PUT; the row is offered', async () => {
    putAnswer = { ok: false, status: 422, json: async () => ({ detail: 'needs your repaint acknowledgement' }) }
    const id = 'u_bbbbbbbbbb05'
    swrAnswer = { data: [rowOf(stale(id), { pine_source: SCRIPT })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await flush(); await flush(); await flush()
    expect(puts().length).toBe(1)
    expect(statusPosts().length).toBe(1)
    expect(JSON.parse(statusPosts()[0][1].body)).toMatchObject({ status: 'write-failed', reason: 'needs your repaint acknowledgement' })
    expect(needsScriptForUpgrade(id)).toBe(true)
    h.rerender(); await flush(); await flush()
    expect(puts().length, 'never re-PUT a version the store refused').toBe(1)
    h.unmount()
  })

  it('recordOnce sends ONE record per stored version and status, across every caller in the tab', async () => {
    const row = rowOf(stale('u_bbbbbbbbbb14'))
    const record = vi.fn(async () => ({ ok: true }))
    const plan = { row, status: 'refused', reason: 'offers no plot' }
    await recordOnce(plan, record)
    await recordOnce({ ...plan }, record)          // a second chart, a re-render
    expect(record).toHaveBeenCalledTimes(1)
    await recordOnce({ ...plan, status: 'write-failed' }, record)
    expect(record, 'a different status is a different fact').toHaveBeenCalledTimes(2)
    await recordOnce({ ...plan, row: { ...row, version: 5 } }, record)
    expect(record, 'a different stored version is a different fact').toHaveBeenCalledTimes(3)
  })

  it('a 409 race and a transport failure are NOT remembered (transient)', async () => {
    const row = rowOf(stale('u_bbbbbbbbbb06'), { pine_source: SCRIPT })
    const record = vi.fn(async () => ({ ok: true }))
    await writeBackOnce({ row, definition: withEngineStamp(row.definition) }, async () => ({ ok: false, conflict: true, status: 409 }), record)
    __resetSavedScriptUpgrade()
    await writeBackOnce({ row, definition: withEngineStamp(row.definition) }, async () => ({ ok: false, status: null }), record)
    __resetSavedScriptUpgrade()
    await writeBackOnce({ row, definition: withEngineStamp(row.definition) }, async () => ({ ok: false, status: 503 }), record)
    expect(record).not.toHaveBeenCalled()
  })
})

describe('MEDIUM-1 — the write-back names itself', () => {
  it('the PUT carries save_reason "engine-upgrade" with its script', async () => {
    const id = 'u_bbbbbbbbbb07'
    swrAnswer = { data: [rowOf(stale(id), { pine_source: SCRIPT })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await flush(); await flush(); await flush()
    const body = JSON.parse(puts()[0][1].body)
    expect(body.save_reason).toBe('engine-upgrade')
    expect(body.pine_source).toBe(SCRIPT)
    expect(engineStampOf(body.definition)).toBe(SCRIPT_ENGINE_VERSION)
    h.unmount()
  })

  it('a save WITHOUT a script never carries the reason (no other door can use it)', async () => {
    const d = withEngineStamp(stale('u_bbbbbbbbbb08'))
    await saveUserDefinition(d, d.id, null, { baseVersion: 4, reason: 'engine-upgrade' })
    expect('save_reason' in JSON.parse(puts()[0][1].body)).toBe(false)
  })
})

describe('L1 — only a document the install door accepted is written back', () => {
  it('an upgrade the install door refuses is not drawn and NOT written back', async () => {
    // a translation that "succeeds" with a document no browser can install
    __setTranslatorForTests({ memberPaneDefinition: () => ({ ok: true, definition: { compute: { kind: 'ast' }, meta: {} } }) })
    const id = 'u_bbbbbbbbbb09'
    swrAnswer = { data: [rowOf(stale(id), { pine_source: SCRIPT })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await flush(); await flush(); await flush()
    expect(registry.getDefinition(id)).toBeFalsy()
    expect(h.result.current.errors.join('\n')).toMatch(new RegExp(id))
    expect(puts()).toEqual([])
    h.unmount()
  })
})

describe('L2 — a hand-edited script document is never told to paste its script', () => {
  it('`scriptEdited` documents get no legacy row; a save without a script marks it', async () => {
    const d = stale('u_bbbbbbbbbb10')
    expect(upgradeKindOf(rowOf(d))).toBe('legacy')
    expect(upgradeKindOf(rowOf({ ...d, meta: { ...d.meta, scriptEdited: true } }))).toBe('none')
    await saveUserDefinition(d, d.id, null, { baseVersion: 4 })
    expect(JSON.parse(puts()[0][1].body).definition.meta.scriptEdited).toBe(true)
    await saveUserDefinition(d, d.id, null, { baseVersion: 4, pineSource: SCRIPT })
    expect('scriptEdited' in JSON.parse(puts()[1][1].body).definition.meta, 'a script save is the translator’s output').toBe(false)
    const formula = { ...d, meta: { ...d.meta, recurrenceOrigin: undefined } }
    await saveUserDefinition(formula, d.id, null, { baseVersion: 4 })
    expect('scriptEdited' in JSON.parse(puts()[2][1].body).definition.meta, 'only script documents are marked').toBe(false)
  })
})

describe('L4 — the held cap covers translation; the upgrade continues after release', () => {
  it('released to the stored document at the bound, then swapped to the upgrade when it lands', async () => {
    vi.useFakeTimers()
    let release
    __setTranslatorForTests(new Promise((r) => { release = r }))
    const d = stale('u_bbbbbbbbbb11')
    const row = rowOf(d, { pine_source: SCRIPT })
    expect(resolveRow(row).pending).toBe(true)
    await vi.advanceTimersByTimeAsync(TRANSLATOR_LOAD_TIMEOUT_MS + 1)
    const meanwhile = resolveRow(row)
    expect(meanwhile.pending).toBe(false)
    expect(meanwhile.definition).toBe(d)
    release(mpd)
    await vi.advanceTimersByTimeAsync(5)
    const after = resolveRow(row)
    expect(engineStampOf(after.definition), 'the upgrade kept going and swapped in').toBe(SCRIPT_ENGINE_VERSION)
  })
})

describe('L5 — a non-integer version is never written back', () => {
  it('no write-back plan, and writeBackOnce refuses without calling save', async () => {
    const row = { ...rowOf(stale('u_bbbbbbbbbb12'), { pine_source: SCRIPT }), version: '4' }
    resolveRow(row)
    await flush(); await flush()
    const res = resolveRow(row)
    expect(engineStampOf(res.definition)).toBe(SCRIPT_ENGINE_VERSION)
    expect(res.writeBack).toBe(null)
    const save = vi.fn()
    expect(await writeBackOnce({ row, definition: res.definition }, save)).toBe('skipped')
    expect(save).not.toHaveBeenCalled()
  })
})

describe('L6 — a script over the store’s cap is never sent', () => {
  it('omits pine_source (and therefore the stamp) for an oversized script', async () => {
    const d = withEngineStamp(stale('u_bbbbbbbbbb13'))
    await saveUserDefinition(d, d.id, null, { baseVersion: 4, pineSource: 'x'.repeat(PINE_SOURCE_MAX_BYTES + 1) })
    const body = JSON.parse(puts()[0][1].body)
    expect('pine_source' in body).toBe(false)
    expect('engineVersion' in body.definition.meta).toBe(false)
    // multi-byte: bytes, not characters
    await saveUserDefinition(d, d.id, null, { baseVersion: 4, pineSource: 'é'.repeat(PINE_SOURCE_MAX_BYTES / 2 + 1) })
    expect('pine_source' in JSON.parse(puts()[1][1].body)).toBe(false)
  })
})

describe('review MEDIUM-1 — which documents are HELD to the script door', () => {
  it('refused and retry rows are held; a legacy, current or unrecorded row is not', () => {
    const d = stale('u_bbbbbbbbbb15')
    const st = (status) => ({ engine: SCRIPT_ENGINE_VERSION, status, reason: 'r' })
    expect(scriptUpgradeHeld(rowOf(d, { has_pine_source: true, engine_status: st('refused') }))).toBe(true)
    expect(scriptUpgradeHeld(rowOf(d, { has_pine_source: true, engine_status: st('write-failed') }))).toBe(true)
    expect(scriptUpgradeHeld(rowOf(d))).toBe(false)
    expect(scriptUpgradeHeld(rowOf(withEngineStamp(d), { has_pine_source: true }))).toBe(false)
    expect(scriptUpgradeHeld(rowOf(d, { pine_source: SCRIPT }))).toBe(false)
  })
})

// ⭐ review #1 — a verdict binds only the engine that gave it, and the browser agrees
// with the server (`user_definitions.engine_withheld_reason`) on every shape a held
// document can take: no "chart draws it but alerts withhold it" split.
describe('review #1 — a refusal expires with its engine; browser and server agree', () => {
  const refusedBy = (engine) => ({ engine, status: 'refused', reason: 'no plot' })
  const N = SCRIPT_ENGINE_VERSION

  it('a scriptless studio-edited descendant: held while its refuser is today’s engine, drawn once it is passed', () => {
    const d = stale('u_bbbbbbbbbb21')
    d.meta = { ...d.meta, scriptEdited: true }
    const row = rowOf(d, { engine_status: refusedBy(N) })
    expect(upgradeKindOf(row, N)).toBe('refused')
    expect(upgradeKindOf(row, N + 1)).toBe('none')
  })

  it('a document the studio rewrote out of the script shape is STILL held by a live refusal', () => {
    const d = stale('u_bbbbbbbbbb22')
    d.meta = { ...d.meta }
    delete d.meta.recurrenceOrigin           // no longer a script document
    const row = rowOf(d, { engine_status: refusedBy(N) })
    expect(upgradeKindOf(row, N)).toBe('refused')
    expect(scriptUpgradeHeld(row)).toBe(true)
    expect(upgradeKindOf(row, N + 1)).toBe('none')
  })

  it('a refused version carrying a CURRENT stamp is held too (the server never reads the stamp to hold)', () => {
    const d = withEngineStamp(stale('u_bbbbbbbbbb23'))
    expect(upgradeKindOf(rowOf(d, { engine_status: refusedBy(N) }), N)).toBe('refused')
    expect(upgradeKindOf(rowOf(d, { engine_status: refusedBy(N) }), N + 1)).toBe('legacy')
  })

  it('a share-installed copy (origin, no script) is held by its carried verdict, then released', () => {
    const d = { ...stale('u_bbbbbbbbbb24'), origin: { author_id: 'a', def_id: 'u_x', version: 1 } }
    const row = rowOf(d, { engine_status: refusedBy(N) })
    expect(upgradeKindOf(row, N)).toBe('refused')
    expect(upgradeKindOf(row, N + 1)).toBe('none')
  })

  it('a refused version HOLDING its script is re-translated by the next engine (held until it answers)', () => {
    const row = rowOf(stale('u_bbbbbbbbbb25'), { has_pine_source: true, pine_source: SCRIPT, engine_status: refusedBy(N) })
    expect(upgradeKindOf(row, N)).toBe('refused')
    expect(upgradeKindOf(row, N + 1)).toBe('retranslate')
  })
})

// ⭐ pre-bump review F3 — past its engine, a scriptless version is released only when
// its maths DIFFERS from the refused maths. The server answers that (`same_maths`, from
// the store's own maths identity); the browser holds exactly what the alerts withhold.
describe('pre-bump F3 — the SAME refused maths stays held past its engine', () => {
  const N = SCRIPT_ENGINE_VERSION
  const sameMaths = (same) => ({ engine: N, status: 'refused', reason: 'no plot', same_maths: same })

  it('a no-op / cosmetic scriptless save carrying the refused maths: still held at N + 1', () => {
    const d = stale('u_bbbbbbbbbb31')
    d.meta = { ...d.meta, scriptEdited: true }
    expect(upgradeKindOf(rowOf(d, { engine_status: sameMaths(true) }), N + 1)).toBe('refused')
    expect(upgradeKindOf(rowOf(d, { engine_status: sameMaths(false) }), N + 1)).toBe('none')
  })

  it('a share install of the refused maths: still held at N + 1', () => {
    const d = { ...stale('u_bbbbbbbbbb32'), origin: { author_id: 'a', def_id: 'u_x', version: 1 } }
    expect(upgradeKindOf(rowOf(d, { engine_status: sameMaths(true) }), N + 1)).toBe('refused')
  })

  it('a current-stamp or non-script document carrying the refused maths: still held', () => {
    const d = withEngineStamp(stale('u_bbbbbbbbbb33'))
    expect(upgradeKindOf(rowOf(d, { engine_status: sameMaths(true) }), N + 1)).toBe('refused')
    const e = stale('u_bbbbbbbbbb34')
    e.meta = { ...e.meta }
    delete e.meta.recurrenceOrigin
    expect(upgradeKindOf(rowOf(e, { engine_status: sameMaths(true) }), N + 1)).toBe('refused')
  })

  it('a version HOLDING its script is still re-translated (today’s engine answers it)', () => {
    const row = rowOf(stale('u_bbbbbbbbbb35'), { has_pine_source: true, pine_source: SCRIPT, engine_status: sameMaths(true) })
    expect(upgradeKindOf(row, N + 1)).toBe('retranslate')
  })
})

// ⭐ pre-bump review F1 — the store refused the write-back of an upgrade of a version an
// OLDER engine refused. The server keeps serving the refusal (with `write_failed_engine`),
// so the chart draws TODAY's translation (never the stored, refused maths), does not PUT
// it again, and offers the Builder.
describe('pre-bump F1 — a failed write-back never re-draws the refused maths', () => {
  it('re-translates, draws the new translation, no write-back plan, the Builder row offered', async () => {
    const d = stale('u_bbbbbbbbbb41')
    const row = rowOf(d, {
      has_pine_source: true, pine_source: SCRIPT,
      engine_status: { engine: SCRIPT_ENGINE_VERSION - 1, status: 'refused', reason: 'old', write_failed_engine: SCRIPT_ENGINE_VERSION },
    })
    expect(upgradeKindOf(row)).toBe('retranslate')
    expect(scriptUpgradeHeld(row), 'its edit door is the script (the re-save note)').toBe(true)
    expect(resolveRow(row).pending).toBe(true)
    await flush(); await flush(); await flush()
    const res = resolveRow(row)
    expect(res.definition).not.toBe(null)
    expect(res.definition).not.toBe(d)
    expect(engineStampOf(res.definition)).toBe(SCRIPT_ENGINE_VERSION)
    expect(res.writeBack, 'the store already refused this write at today’s engine').toBe(null)
    expect(needsScriptForUpgrade(d.id)).toBe(true)
  })

  it('CONTROL: a write-failed recorded by an OLDER engine does not stop today’s write-back', async () => {
    const row = rowOf(stale('u_bbbbbbbbbb42'), {
      has_pine_source: true, pine_source: SCRIPT,
      engine_status: { engine: SCRIPT_ENGINE_VERSION - 1, status: 'refused', reason: 'old', write_failed_engine: SCRIPT_ENGINE_VERSION - 1 },
    })
    resolveRow(row)
    await flush(); await flush(); await flush()
    expect(resolveRow(row).writeBack).not.toBe(null)
  })
})

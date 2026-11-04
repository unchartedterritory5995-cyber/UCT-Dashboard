// SAVED-SCRIPT AUTO-UPGRADE — the PRODUCT caller (`useInstalledUserDefinitions`):
// what reaches the registry for each kind of stored script row, and the write-back.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let swrAnswer = { data: undefined, error: undefined, isLoading: true }
let capturedFetcher = null
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    default: (key, fetcher) => { capturedFetcher = fetcher; return swrAnswer },
    mutate: vi.fn(),
  }
})

import { AuthContext } from '../context/AuthContext'
import { useInstalledUserDefinitions, USER_DEFINITIONS_KEY } from './useUserDefinitions'
import * as registry from '../components/chart/engine/nativeRegistry'
import { astHash } from '../components/chart/engine/ast/parse'
import * as mpd from '../components/chart/builder/memberPane/memberPaneDefinition'
import {
  __resetSavedScriptUpgrade, __setTranslatorForTests, needsScriptForUpgrade,
} from '../components/chart/builder/memberPane/savedScriptUpgrade'
import { SCRIPT_ENGINE_VERSION, withEngineStamp, engineStampOf } from '../components/chart/engine/scriptEngineVersion'

const SCRIPT = '//@version=5\nindicator("Upgrade Probe")\nplot(ta.sma(close, 14), "avg")\n'
const REFUSED = '//@version=5\nindicator("Draws Nothing")\nx = ta.sma(close, 14)\n'
const wrapper = ({ children }) => <AuthContext.Provider value={{ user: { id: 'm1' } }}>{children}</AuthContext.Provider>

/** A document the script door saved before this engine: same door, a planted
 *  wrong tree (period 99 instead of 14), and no stamp. */
function stale(id, { plant = true } = {}) {
  const b = mpd.memberPaneDefinition({ source: SCRIPT, id })
  const d = JSON.parse(JSON.stringify(b.definition))
  d.version = 4
  d.meta = { ...d.meta, name: `Saved ${id}` }
  delete d.meta.engineVersion
  if (!plant) return d
  const wrong = JSON.parse(JSON.stringify(d.compute.ast).replace(/"value":14\b/g, '"value":99'))
  // a VALID old document (its own handle), so "held" is a real claim: drawn, it would install
  expect(d.compute.trees, 'the probe is a single-tree document').toBeUndefined()
  return { ...d, compute: { ...d.compute, ast: wrong, fn: astHash(wrong), source: String(d.compute.source).split('14').join('99') } }
}
const rowOf = (definition, extra = {}) => ({ def_id: definition.id, version: 4, rev: 1, definition, ...extra })
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

let fetchSpy
beforeEach(() => {
  __resetSavedScriptUpgrade()
  __setTranslatorForTests(mpd)
  swrAnswer = { data: undefined, error: undefined, isLoading: true }
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ def_id: 'x', version: 5 }) }))
  globalThis.fetch = fetchSpy
})
afterEach(() => { registry.clearUserDefinitions() })

describe('the list read names this bundle’s engine', () => {
  it('asks `?graph=1&engine=<SCRIPT_ENGINE_VERSION>`', async () => {
    swrAnswer = { data: [], error: undefined, isLoading: false }
    renderHook(() => useInstalledUserDefinitions(), { wrapper }).unmount()
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ definitions: [] }) })
    await capturedFetcher(USER_DEFINITIONS_KEY)
    expect(fetchSpy.mock.calls[0][0]).toBe(`${USER_DEFINITIONS_KEY}?graph=1&engine=${SCRIPT_ENGINE_VERSION}`)
  })
})

describe('what each stored script row draws', () => {
  it('an UP-TO-DATE row installs its stored bytes at once: no translation, no write', async () => {
    const spy = vi.fn(mpd.memberPaneDefinition)
    __setTranslatorForTests({ memberPaneDefinition: spy })
    const d = withEngineStamp(stale('u_aaaaaaaaaa01', { plant: false }))
    swrAnswer = { data: [rowOf(d, { pine_source: SCRIPT })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    expect(registry.getDefinition('u_aaaaaaaaaa01')).toBeTruthy()
    expect(h.result.current.isLoading).toBe(false)
    await flush()
    expect(spy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    h.unmount()
  })

  it('a STALE row with its script is HELD, then drawn from today’s translation and written back once', async () => {
    const id = 'u_aaaaaaaaaa02'
    const d = stale(id)
    swrAnswer = { data: [rowOf(d, { pine_source: SCRIPT })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    expect(registry.validateUserDefinitions([d]).errors, 'the stored document WOULD install').toEqual([])
    expect(registry.getDefinition(id), 'the possibly-wrong stored values are not drawn').toBeFalsy()
    expect(h.result.current.isLoading, 'held reads as loading, not as "can’t be shown"').toBe(true)
    await flush(); await flush()
    const installed = registry.getDefinition(id)
    expect(installed).toBeTruthy()
    expect(engineStampOf(installed)).toBe(SCRIPT_ENGINE_VERSION)
    expect(JSON.stringify(installed.compute.ast)).not.toMatch(/"value":99\b/)
    expect(h.result.current.isLoading).toBe(false)
    const puts = fetchSpy.mock.calls.filter(([, init]) => init && init.method === 'PUT')
    expect(puts.length).toBe(1)
    expect(puts[0][0]).toBe(`${USER_DEFINITIONS_KEY}/${id}`)
    const body = JSON.parse(puts[0][1].body)
    expect(body.base_version).toBe(4)
    expect(body.pine_source).toBe(SCRIPT)
    expect(body.definition.meta.engineVersion).toBe(SCRIPT_ENGINE_VERSION)
    expect(body.definition.meta.name).toBe(`Saved ${id}`)
    h.rerender(); await flush()
    expect(fetchSpy.mock.calls.filter(([, init]) => init && init.method === 'PUT').length, 'once per stored version').toBe(1)
    h.unmount()
  })

  it('a stale row the new translation REFUSES is not drawn, and the refusal is reported by name', async () => {
    const id = 'u_aaaaaaaaaa03'
    const d = stale(id)
    registry.installUserDefinitions([d]) // whatever an earlier install left
    swrAnswer = { data: [rowOf(d, { pine_source: REFUSED })], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    await flush(); await flush()
    expect(registry.getDefinition(id)).toBeFalsy()
    expect(h.result.current.errors.join('\n')).toMatch(new RegExp(`Saved ${id}: .*offers no plot`))
    expect(fetchSpy.mock.calls.filter(([, init]) => init && init.method === 'PUT')).toEqual([])
    h.unmount()
  })

  it('a LEGACY row (no script stored) draws as stored and offers the legend row', () => {
    const id = 'u_aaaaaaaaaa04'
    const d = stale(id, { plant: false })
    swrAnswer = { data: [rowOf(d)], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    expect(registry.getDefinition(id)).toBeTruthy()
    expect(needsScriptForUpgrade(id)).toBe(true)
    h.unmount()
  })
})

describe('saveUserDefinition — the one place a stamp meets its script', () => {
  it('a save WITHOUT a script drops the engine stamp; a save WITH one keeps it and sends the script', async () => {
    const { saveUserDefinition } = await import('./useUserDefinitions')
    const d = withEngineStamp(stale('u_aaaaaaaaaa05', { plant: false }))
    await saveUserDefinition(d, 'u_aaaaaaaaaa05', null, { baseVersion: 4 })
    let body = JSON.parse(fetchSpy.mock.calls.at(-1)[1].body)
    expect('engineVersion' in body.definition.meta, 'a hand edit must not claim "current"').toBe(false)
    expect('pine_source' in body).toBe(false)
    await saveUserDefinition(d, 'u_aaaaaaaaaa05', null, { baseVersion: 4, pineSource: SCRIPT })
    body = JSON.parse(fetchSpy.mock.calls.at(-1)[1].body)
    expect(body.definition.meta.engineVersion).toBe(SCRIPT_ENGINE_VERSION)
    expect(body.pine_source).toBe(SCRIPT)
    await saveUserDefinition(d, 'u_aaaaaaaaaa05', null, { baseVersion: 4, pineSource: '   ' })
    body = JSON.parse(fetchSpy.mock.calls.at(-1)[1].body)
    expect('pine_source' in body || 'engineVersion' in body.definition.meta, 'a blank script is no script').toBe(false)
  })
})

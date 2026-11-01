// SAVED-SCRIPT AUTO-UPGRADE — the load-time re-translation and its write-back.
//
// Every assertion here runs the REAL translator (`memberPaneDefinition`), handed
// in through the module's own seam; no fake document is ever "upgraded".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as mpd from './memberPaneDefinition'
import {
  upgradeKindOf, retranslateRow, resolveRow, writeBackOnce, writeBackStatus,
  needsScriptForUpgrade, onUpgradeSettled, isScriptDocument, savedScriptUpgradeEnabled,
  __resetSavedScriptUpgrade, __setTranslatorForTests,
} from './savedScriptUpgrade'
import {
  SCRIPT_ENGINE_VERSION, engineStampOf, withEngineStamp, withoutEngineStamp, isStaleStamp,
} from '../../engine/scriptEngineVersion'
import { validateUserDefinitions } from '../../engine/nativeRegistry'

const SCRIPT = '//@version=5\nindicator("Upgrade Probe")\nplot(ta.sma(close, 14), "avg")\n'
// The member pane door refuses a script that offers no plot (`paneGate`).
const REFUSED = '//@version=5\nindicator("Draws Nothing")\nx = ta.sma(close, 14)\n'

const ID = 'u_abcdefabcdef'
/** The document the script door saved YESTERDAY: built by the same door, but with
 *  yesterday's mistake planted in it — a different tree — and no engine stamp. */
function staleDoc({ name = 'My renamed script', semantics, repaint } = {}) {
  const b = mpd.memberPaneDefinition({ source: SCRIPT, id: ID })
  expect(b.ok, b.reason).toBe(true)
  const d = JSON.parse(JSON.stringify(b.definition))
  d.version = 7
  d.compute.rev = 3
  d.meta = { ...d.meta, name, ...(semantics !== undefined ? { semantics } : {}), ...(repaint ? { repaint } : {}) }
  delete d.meta.engineVersion
  return d
}
const rowOf = (definition, extra = {}) => ({ def_id: ID, version: 7, rev: 3, definition, ...extra })

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => { __resetSavedScriptUpgrade(); __setTranslatorForTests(mpd) })
afterEach(() => { vi.unstubAllEnvs() })

describe('the stamp', () => {
  it('stamps, reads, strips — and an unstamped document is older than every engine', () => {
    const d = { id: 'x', meta: { name: 'n' } }
    expect(engineStampOf(d)).toBe(null)
    expect(isStaleStamp(d)).toBe(true)
    const s = withEngineStamp(d)
    expect(engineStampOf(s)).toBe(SCRIPT_ENGINE_VERSION)
    expect(isStaleStamp(s)).toBe(false)
    expect(isStaleStamp(s, SCRIPT_ENGINE_VERSION + 1)).toBe(true)
    expect(withoutEngineStamp(s).meta).toEqual({ name: 'n' })
    expect(withoutEngineStamp(d)).toBe(d)
  })
})

describe('which rows need work', () => {
  it('current → nothing; stale + source → retranslate; stale, no source → legacy', () => {
    const d = staleDoc()
    expect(isScriptDocument(d)).toBe(true)
    expect(upgradeKindOf(rowOf(withEngineStamp(d), { pine_source: SCRIPT }))).toBe('current')
    expect(upgradeKindOf(rowOf(d, { pine_source: SCRIPT }))).toBe('retranslate')
    expect(upgradeKindOf(rowOf(d))).toBe('legacy')
    // a stored script that was not SENT means this browser is older than the row
    expect(upgradeKindOf(rowOf(d, { has_pine_source: true }))).toBe('none')
  })

  it('a formula (not a script document) is never touched', () => {
    const d = staleDoc()
    const formula = { ...d, meta: { ...d.meta, recurrenceOrigin: undefined } }
    expect(upgradeKindOf(rowOf(formula, { pine_source: SCRIPT }))).toBe('none')
  })

  it('the kill switch is ON by default and `0` turns it off', () => {
    expect(savedScriptUpgradeEnabled({})).toBe(true)
    expect(savedScriptUpgradeEnabled({ VITE_SAVED_SCRIPT_UPGRADE: '0' })).toBe(false)
  })
})

describe('retranslateRow', () => {
  it('rebuilds from the script, stamps today’s engine, and CARRIES what the member and the store own', () => {
    const d = staleDoc({ name: 'My renamed script' })
    d.meta.forkedFrom = { def_id: 'u_222222222222', version: 1 }
    d.origin = { author_id: 'a', def_id: 'u_111111111111', version: 2 }
    // yesterday's engine wrote a different tree
    d.compute.ast = { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 99 }] }
    const r = retranslateRow(rowOf(d, { pine_source: SCRIPT }), mpd.memberPaneDefinition)
    expect(r.status).toBe('upgraded')
    const u = r.definition
    expect(u.id).toBe(ID)
    expect(u.version).toBe(7)
    expect(u.compute.rev).toBe(3)
    expect(u.meta.name).toBe('My renamed script')
    expect('semantics' in u.meta, 'a Pine translation carries no semantics stamp').toBe(false)
    expect(u.meta.forkedFrom).toEqual({ def_id: 'u_222222222222', version: 1 })
    expect(u.origin).toEqual(d.origin)
    expect(engineStampOf(u)).toBe(SCRIPT_ENGINE_VERSION)
    const fresh = mpd.memberPaneDefinition({ source: SCRIPT, id: ID }).definition
    expect(u.compute.ast, 'the maths is TODAY’S translation, not the stored tree').toEqual(fresh.compute.ast)
    // and the browser's own install door accepts it
    const { errors } = validateUserDefinitions([u])
    expect(errors).toEqual([])
  })

  it('a refusal by the new translation WINS, by name', () => {
    const r = retranslateRow(rowOf(staleDoc(), { pine_source: REFUSED }), mpd.memberPaneDefinition)
    expect(r.status).toBe('refused')
    expect(r.reason).toMatch(/offers no plot/)
  })

  it('INCONCLUSIVE, never refused: a throw, a library import, the runtime lane built in, another lane', () => {
    const row = rowOf(staleDoc(), { pine_source: REFUSED })
    expect(retranslateRow(row, () => { throw new Error('boom') }).status).toBe('inconclusive')
    const lib = rowOf(staleDoc(), { pine_source: `//@version=5\nimport someone/Lib/3 as L\n${REFUSED}` })
    expect(retranslateRow(lib, mpd.memberPaneDefinition).status).toBe('inconclusive')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    expect(retranslateRow(row, mpd.memberPaneDefinition).status).toBe('inconclusive')
    vi.unstubAllEnvs()
    const runtimeLane = () => ({ ok: true, definition: { compute: { kind: 'runtime' }, meta: {} } })
    expect(retranslateRow(row, runtimeLane).status).toBe('inconclusive')
  })
})

describe('resolveRow — held, then settled', () => {
  it('a CURRENT row is its stored document, with no translation queued', async () => {
    const spy = vi.fn(mpd.memberPaneDefinition)
    __setTranslatorForTests({ memberPaneDefinition: spy })
    const d = withEngineStamp(staleDoc())
    const res = resolveRow(rowOf(d, { pine_source: SCRIPT }))
    expect(res.definition).toBe(d)
    expect(res.pending).toBe(false)
    await flush(); await flush()
    expect(spy, 'zero work for an up-to-date document').not.toHaveBeenCalled()
  })

  it('a STALE row is held, translated once, then resolves to the upgrade with a write-back plan', async () => {
    const spy = vi.fn(mpd.memberPaneDefinition)
    __setTranslatorForTests({ memberPaneDefinition: spy })
    const settled = vi.fn()
    const off = onUpgradeSettled(settled)
    const row = rowOf(staleDoc(), { pine_source: SCRIPT })
    const first = resolveRow(row)
    expect(first.pending).toBe(true)
    expect(first.definition, 'the possibly-wrong old values are not drawn meanwhile').toBe(null)
    resolveRow(row) // a second chart, the same render: still one translation
    await flush(); await flush()
    expect(settled).toHaveBeenCalled()
    const second = resolveRow(row)
    expect(second.pending).toBe(false)
    expect(engineStampOf(second.definition)).toBe(SCRIPT_ENGINE_VERSION)
    expect(second.writeBack.row).toBe(row)
    resolveRow(row)
    expect(spy).toHaveBeenCalledTimes(1)
    off()
  })

  it('a REFUSED re-translation resolves to no document and a named refusal', async () => {
    const row = rowOf(staleDoc({ name: 'Old Script' }), { pine_source: REFUSED })
    resolveRow(row)
    await flush(); await flush()
    const res = resolveRow(row)
    expect(res.definition).toBe(null)
    expect(res.refusal).toMatch(/^Old Script: .*offers no plot/)
    expect(res.writeBack).toBe(null)
  })

  it('a translator that cannot even load leaves the stored document drawn', async () => {
    __setTranslatorForTests(Promise.reject(new Error('chunk 404')))
    const d = staleDoc()
    const row = rowOf(d, { pine_source: SCRIPT })
    resolveRow(row)
    await flush(); await flush()
    expect(resolveRow(row).definition).toBe(d)
  })

  it('a legacy row (no script) is drawn as stored and offers the one quiet row', () => {
    const d = staleDoc()
    const res = resolveRow(rowOf(d))
    expect(res.definition).toBe(d)
    expect(needsScriptForUpgrade(ID)).toBe(true)
    resolveRow(rowOf(withEngineStamp(d)))
    expect(needsScriptForUpgrade(ID), 'a current document offers nothing').toBe(false)
  })
})

describe('writeBackOnce', () => {
  it('PUTs once per stored version, with base_version and the script; a 409 is recorded, not retried', async () => {
    const row = rowOf(staleDoc(), { pine_source: SCRIPT })
    const definition = withEngineStamp(row.definition)
    const save = vi.fn(async () => ({ ok: false, conflict: true, error: 'moved on' }))
    expect(await writeBackOnce({ row, definition }, save)).toBe('conflict')
    expect(await writeBackOnce({ row, definition }, save)).toBe('conflict')
    expect(save).toHaveBeenCalledTimes(1)
    const [doc, defId, telemetry, options] = save.mock.calls[0]
    expect(doc).toBe(definition)
    expect(defId).toBe(ID)
    expect(telemetry).toBe(null)
    expect(options).toEqual({ baseVersion: 7, pineSource: SCRIPT })
    expect(writeBackStatus(row)).toBe('conflict')
  })

  it('acknowledges preview-repaints ONLY when the stored document already carried it', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    const was = rowOf(staleDoc({ repaint: 'preview-repaints' }), { pine_source: SCRIPT })
    await writeBackOnce({ row: was, definition: { ...was.definition, meta: { ...was.definition.meta, repaint: 'preview-repaints' } } }, save)
    expect(save.mock.calls[0][3].previewAcked).toBe(true)
    __resetSavedScriptUpgrade()
    const wasNot = rowOf(staleDoc({ repaint: 'non-repainting' }), { pine_source: SCRIPT })
    await writeBackOnce({ row: wasNot, definition: { ...wasNot.definition, meta: { ...wasNot.definition.meta, repaint: 'preview-repaints' } } }, save)
    expect(save.mock.calls[1][3].previewAcked, 'never acknowledged on the member’s behalf').toBeUndefined()
  })

  it('a thrown save is a failure, never an unhandled rejection', async () => {
    const row = rowOf(staleDoc(), { pine_source: SCRIPT })
    expect(await writeBackOnce({ row, definition: row.definition }, async () => { throw new Error('net') })).toBe('failed')
  })
})

describe('the wait for the translator is bounded', () => {
  it('a translator that never arrives releases the held row (drawn as stored) after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const { TRANSLATOR_LOAD_TIMEOUT_MS } = await import('./savedScriptUpgrade')
      __setTranslatorForTests(new Promise(() => {}))
      const d = staleDoc()
      const row = rowOf(d, { pine_source: SCRIPT })
      expect(resolveRow(row).pending).toBe(true)
      await vi.advanceTimersByTimeAsync(TRANSLATOR_LOAD_TIMEOUT_MS - 1)
      expect(resolveRow(row).pending, 'still waiting just before the bound').toBe(true)
      await vi.advanceTimersByTimeAsync(2)
      const res = resolveRow(row)
      expect(res.pending).toBe(false)
      expect(res.definition).toBe(d)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('translation never blocks first paint and never chains rows into one task', () => {
  it('each held row is translated in its OWN idle callback', async () => {
    const slots = []
    globalThis.requestIdleCallback = (fn) => { slots.push(fn); return slots.length }
    try {
      const spy = vi.fn(mpd.memberPaneDefinition)
      __setTranslatorForTests({ memberPaneDefinition: spy })
      const a = rowOf(staleDoc(), { pine_source: SCRIPT })
      const b = { ...rowOf(staleDoc(), { pine_source: SCRIPT }), def_id: 'u_abcdefabcde2' }
      resolveRow(a); resolveRow(b)
      await flush(); await flush()
      expect(spy, 'nothing is translated before an idle slot').not.toHaveBeenCalled()
      expect(slots).toHaveLength(1)
      slots.shift()()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(resolveRow(a).pending).toBe(false)
      expect(resolveRow(b).pending, 'the second row waits for its own slot').toBe(true)
      expect(slots).toHaveLength(1)
      slots.shift()()
      expect(spy).toHaveBeenCalledTimes(2)
      expect(resolveRow(b).pending).toBe(false)
    } finally {
      delete globalThis.requestIdleCallback
    }
  })
})

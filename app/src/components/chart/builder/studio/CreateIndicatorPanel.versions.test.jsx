// SAVED VERSIONS IN THE DOCK'S HISTORY (Indicators backlog 30).
//
// The store keeps every saved version of an indicator. The dock now lists them under the draft's
// own steps and brings one back as ONE step of the draft: nothing is saved until Save changes,
// and the save is an ordinary edit. The rules themselves are railed in
// `authoring/restoreVersion.test.js`; this file is the dock: when the list is read, what a row
// says, what a press does, and that Undo and Save behave as for any other change.
//
// The store's answer is handed in (`readHistory`); the engine, the read-back, the registry and
// the save door's document are real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { NEW_LINE_FLAG } from '../../engine/lineIdentity'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { _resetSessions, editKey } from '../authoring/conversationSessions'
import { applyPatch } from '../authoring'
import { parseFormula } from '../../engine/ast/parse'

const H = vi.hoisted(() => ({ saves: [] }))
vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: defId || 'u_aaaaaaaaaaaa', version: doc.version, rev: 1, semantics: 2 } }
  }),
}))

import CreateIndicatorPanel, { versionWhen } from './CreateIndicatorPanel'

const C = 'uct.authoring.patch/1'
const GATE = { tf: 'D', symbol: 'AAPL' }
const ID = 'u_0123456789ab'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const UID = (n) => `p_${String(n).repeat(12).slice(0, 12)}`
const stored = (version, outputs) => {
  const r = applyPatch(null, { contract: C, baseRevision: 0, assumptions: [], ops: [{ op: 'create', name: 'x',
    outputs: outputs.map(([key, src]) => ({ key, label: key, tree: P(src) })) }] }, { gateCtx: GATE })
  expect(r.status, JSON.stringify(r.errors)).toBe('applied')
  const uids = Object.fromEntries(outputs.map(([key, , uid]) => [key, uid]))
  return { ...r.definition, id: ID, version, plots: r.definition.plots.map((p) => (uids[p.key] ? { ...p, uid: uids[p.key] } : p)) }
}
const V1 = stored(1, [['fast', 'ema(close, 10)', UID(1)], ['slow', 'ema(close, 50)', UID(2)]])
const V2 = stored(2, [['fast', 'ema(close, 12)', UID(1)], ['mid', 'ema(close, 21)', UID(3)]])
const rowOf = (def) => ({ def_id: ID, version: def.version, definition: def, created_at: 1763300000, deleted_at: null })

function mount({ def = V2, history = [rowOf(V1), rowOf(V2)], answer = null } = {}) {
  registry.installUserDefinitions([def])
  const readHistory = vi.fn(async () => (answer || { ok: true, versions: history }))
  const onClose = vi.fn()
  render(
    <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
      onPreview={() => {}} onClose={onClose} converse={scriptedConverse}
      sessionKey={editKey(def.id)} editRow={{ def_id: def.id, version: def.version, definition: def }}
      readHistory={readHistory} />,
  )
  return { readHistory, onClose }
}
const click = async (el) => { await act(async () => { fireEvent.click(el) }); await act(async () => {}) }
const toggle = () => screen.queryByTestId('create-indicator-history-toggle')
const versionRows = () => screen.queryAllByTestId('create-indicator-version')
const panel = () => screen.getByTestId('create-indicator')
const logText = () => [...document.querySelectorAll('[data-testid="create-indicator-log"] li')].map((l) => l.textContent).join(' | ')

beforeEach(() => { H.saves.length = 0; _resetSessions(); try { sessionStorage.clear() } catch { /* none */ } })
afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.restoreAllMocks() })

describe('saved versions in the dock', () => {
  it('History is offered on an indicator saved more than once, and the list is read only when it is opened', async () => {
    const { readHistory } = mount()
    expect(toggle()).toBeInTheDocument()
    expect(toggle()).not.toBeDisabled()                    // before the draft has a step of its own
    expect(readHistory).not.toHaveBeenCalled()
    await click(toggle())
    expect(readHistory).toHaveBeenCalledTimes(1)
    expect(readHistory).toHaveBeenCalledWith(ID)
    expect(versionRows().map((r) => [r.dataset.version, r.dataset.usable])).toEqual([['2', 'no'], ['1', 'yes']])
    // closing and opening again does not read it a second time
    await click(screen.getByTestId('create-indicator-history-close'))
    await click(toggle())
    expect(readHistory).toHaveBeenCalledTimes(1)
  })

  it('each row says what it is: the one this draft started from, and what coming back does to the lines', async () => {
    mount()
    await click(toggle())
    const [now, old] = versionRows()
    expect(within(now).getByTestId('create-indicator-version-note').textContent).toBe('The saved version this draft started from.')
    expect(within(now).queryByTestId('create-indicator-version-use')).toBeNull()
    expect(old.textContent).toMatch(/^Version 1/)
    expect(within(old).getByTestId('create-indicator-version-note').textContent)
      .toBe('1 line comes back as a new line: alerts and references made to the old one stay off. 1 line added since then is removed.')
    expect(within(old).getByTestId('create-indicator-version-use').textContent).toBe('Use this version')
  })

  it('using one makes it the draft as ONE step: said in the log, Undo takes it back, nothing is saved', async () => {
    mount()
    expect(panel().dataset.dirty).toBe('false')
    await click(toggle())
    await click(within(versionRows()[1]).getByTestId('create-indicator-version-use'))
    expect(screen.queryByTestId('create-indicator-history')).toBeNull()        // the list closes on a pick
    expect(logText()).toMatch(/Went back to saved version 1\. Nothing is saved until you save\./)
    expect(panel().dataset.dirty).toBe('true')
    expect(H.saves).toHaveLength(0)
    expect(registry.getDefinition(ID).plots.map((p) => p.key)).toEqual(['fast', 'mid'])   // the saved one is untouched
    await click(screen.getByTestId('create-indicator-undo'))
    expect(panel().dataset.dirty).toBe('false')
    expect(H.saves).toHaveLength(0)
  })

  it('saving it is an ordinary edit on the opened version; a line deleted since then goes up as a NEW line', async () => {
    const { onClose } = mount()
    await click(toggle())
    await click(within(versionRows()[1]).getByTestId('create-indicator-version-use'))
    await click(screen.getByTestId('create-indicator-save'))
    expect(H.saves).toHaveLength(1)
    const { doc, defId } = H.saves[0]
    expect([defId, doc.id, doc.version]).toEqual([ID, ID, 3])
    expect(doc.plots.map((p) => p.key)).toEqual(['fast', 'slow'])
    expect(doc.plots.find((p) => p.key === 'slow')[NEW_LINE_FLAG]).toBe(true)
    expect('uid' in doc.plots.find((p) => p.key === 'slow')).toBe(false)
    expect(NEW_LINE_FLAG in doc.plots.find((p) => p.key === 'fast')).toBe(false)
    expect(onClose).toHaveBeenCalled()
  })

  it('a list that could not be read says so, and opening History again tries again', async () => {
    const { readHistory } = mount({ answer: { ok: false, error: 'The version history could not be read (503).' } })
    await click(toggle())
    expect(screen.getByTestId('create-indicator-versions-error').textContent).toBe('The version history could not be read (503).')
    expect(versionRows()).toHaveLength(0)
    await click(screen.getByTestId('create-indicator-history-close'))
    await click(toggle())
    expect(readHistory).toHaveBeenCalledTimes(2)
  })

  it('CONTROL: an indicator saved once has no earlier version, so History waits for the draft’s own steps as before', async () => {
    const once = { ...V2, version: 1 }
    const { readHistory } = mount({ def: once, history: [rowOf(once)] })
    expect(toggle()).toBeNull()
    expect(readHistory).not.toHaveBeenCalled()
  })

  it('the date is short, and absent when the store gave none', () => {
    expect(versionWhen(1763300000)).toMatch(/2025/)
    expect(versionWhen(null)).toBe('')
    expect(versionWhen(0)).toBe('')
  })
})

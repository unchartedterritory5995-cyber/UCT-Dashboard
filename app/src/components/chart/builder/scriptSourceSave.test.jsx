// SAVED-SCRIPT AUTO-UPGRADE — what the Builder's doors SEND.
//
//   1. The script door (MemberPane → attachPineAs) sends the script beside the
//      document, and stamps the document with today's engine.
//   2. The Formula tab NEVER sends a script and strips a carried stamp: a hand edit
//      must never be re-translated away by a later engine.
//   3. The legend row's door ("Updated accuracy available") opens a legacy script
//      document on the Pine tab, and its save is a REVISION of the same id
//      (PUT, base_version) carrying the pasted script.
//
// `useUserDefinitions` runs for real; `global.fetch` is the spy, so these are the
// request bodies the store receives.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import { SCRIPT_UPGRADE_PASTE_NOTE, SCRIPT_UPGRADE_RESAVE_NOTE } from './memberPane/savedScriptUpgrade'
import { parseFormula } from '../engine/ast/parse'
import { evaluateFormula } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { SCRIPT_ENGINE_VERSION } from '../engine/scriptEngineVersion'
import { AuthContext } from '../../../context/AuthContext'

const SCRIPT = '//@version=5\nindicator("Upgrade Probe")\nplot(ta.sma(close, 14), "avg")\n'
const DEF_ID = 'u_bbbbbbbbbbbb'

const H = vi.hoisted(() => ({ requests: [], rows: [] }))
function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 1 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const writes = () => H.requests.filter((r) => r.method !== 'GET' && !String(r.url).includes('/api/indicator-support/gaps'))
const lastBody = () => JSON.parse(writes()[writes().length - 1].body)

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}}
          sym="SPY" tf="D" {...props} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

async function paste(script) {
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: script } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.useFakeTimers()
  H.rows = []
  stubFetch()
  clearUserDefinitions()
})
afterEach(() => {
  cleanup(); clearUserDefinitions(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('1. the script door sends its script', () => {
  it('attach POSTs `pine_source` = the pasted script, and the document carries today’s engine stamp', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
    await paste(SCRIPT)
    fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button'))
    await flush(); await flush()
    expect(writes()).toHaveLength(1)
    const body = lastBody()
    expect(writes()[0].method).toBe('POST')
    expect(body.pine_source).toBe(SCRIPT)
    expect(body.definition.meta.engineVersion).toBe(SCRIPT_ENGINE_VERSION)
    // the script rides BESIDE the document, never inside it
    expect(JSON.stringify(body.definition)).not.toContain('indicator("Upgrade Probe")')
  })
})

describe('2. the Formula tab never claims to be the translator', () => {
  it('an edit of a stamped document PUTs with NO stamp and NO script', async () => {
    const source = 'sma(close, 20)'
    const parsed = parseFormula(source)
    const evaluated = evaluateFormula(source, BUILDER_INPUT_SCOPE)
    const def = buildDefinition({
      defId: DEF_ID, name: 'My line', source, ast: parsed.ast, mode: evaluated.verdict.mode,
      readback: evaluated.readback, version: 1, rev: 1,
    })
    def.meta = { ...def.meta, engineVersion: SCRIPT_ENGINE_VERSION, recurrenceOrigin: 'pine' }
    H.rows = [{ def_id: DEF_ID, version: 1, rev: 1, definition: def, has_pine_source: true }]
    mount()
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit My line' })) })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'sma(close, 5)' } })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Sav/ })) })
    await flush()
    const puts = writes().filter((w) => w.method === 'PUT')
    expect(puts.length, 'the edit reached the store').toBe(1)
    const body = JSON.parse(puts[0].body)
    expect('engineVersion' in (body.definition.meta || {}), 'a carried stamp would claim "current"').toBe(false)
    expect(body.definition.meta.recurrenceOrigin, 'the Pine stamps still ride (P2X)').toBe('pine')
    expect('pine_source' in body).toBe(false)
  })
})

describe('3. the legend row’s door: a legacy script document, re-saved from its script', () => {
  it('opens the Pine tab with the note, and "Save changes" PUTs the same id with base_version and the script', async () => {
    const built = memberPaneDefinition({ source: SCRIPT, id: DEF_ID })
    expect(built.ok).toBe(true)
    const legacy = { ...built.definition, version: 3 }
    delete legacy.meta.engineVersion
    const row = { def_id: DEF_ID, version: 3, rev: 1, definition: legacy, upgradeScript: true }
    mount({ editRow: row })
    await flush()
    expect(screen.getByTestId('script-upgrade-note').textContent).toBe(SCRIPT_UPGRADE_PASTE_NOTE)
    expect(screen.getByTestId('pine-box').querySelector('textarea').value, 'the box is empty: the script was never stored').toBe('')
    await paste(SCRIPT)
    const save = screen.getByRole('button', { name: 'Save changes' })
    await act(async () => { fireEvent.click(save) })
    await flush(); await flush()
    const puts = writes().filter((w) => w.method === 'PUT')
    expect(puts.length).toBe(1)
    expect(puts[0].url).toContain(`/api/user-definitions/${DEF_ID}`)
    const body = JSON.parse(puts[0].body)
    expect(body.base_version).toBe(3)
    expect(body.pine_source).toBe(SCRIPT)
    expect(body.definition.id).toBe(DEF_ID)
    expect(body.definition.meta.engineVersion).toBe(SCRIPT_ENGINE_VERSION)
  })

  it('a script whose upgrade could not be saved automatically opens WITH its stored script and the re-save note', async () => {
    const built = memberPaneDefinition({ source: SCRIPT, id: DEF_ID })
    const legacy = { ...built.definition, version: 3 }
    delete legacy.meta.engineVersion
    mount({ editRow: { def_id: DEF_ID, version: 3, rev: 1, definition: legacy, upgradeScript: true, pine_source: SCRIPT } })
    await flush()
    expect(screen.getByTestId('script-upgrade-note').textContent).toBe(SCRIPT_UPGRADE_RESAVE_NOTE)
    expect(screen.getByTestId('pine-box').querySelector('textarea').value).toBe(SCRIPT)
  })

  it('the ordinary "Edit formula" door on the same document is unchanged (no note)', async () => {
    const built = memberPaneDefinition({ source: SCRIPT, id: DEF_ID })
    const row = { def_id: DEF_ID, version: 3, rev: 1, definition: built.definition }
    mount({ editRow: row })
    await flush()
    expect(screen.queryByTestId('script-upgrade-note')).toBeNull()
  })
})

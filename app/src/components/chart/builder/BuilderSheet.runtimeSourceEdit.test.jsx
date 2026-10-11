// app/src/components/chart/builder/BuilderSheet.runtimeSourceEdit.test.jsx
//
// ⭐⭐⭐ UIE PHASE 5 (M1) — EDITING A STORED RUNTIME SCRIPT'S SOURCE, IN THE REAL SHEET.
//
// "Your formulas" → Edit on a script drawn bar by bar opens it in the Pine tab (its
// stored script in the import box); the member pane previews the edited script; "Save
// changes" saves a REVISION of the same document (a PUT with the version it opened,
// exactly as a formula edit saves); "Save as a new indicator" creates one. A script the
// door refuses offers no save and writes nothing; closing the sheet writes nothing.
// Real sheet, real `useUserDefinitions()`, a stand-in server; `ChartPane` mocked (what
// the pane is handed, never pixels). Flags set for this file only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'
import * as registry from '../engine/nativeRegistry'
import { runtimeSourceHash } from '../engine/runtimeKill'

vi.mock('../pane/ChartPane', () => ({ default: () => <div data-testid="mock-chart-pane" /> }))

const PINE = '//@version=5\nindicator("Sum")\nlen = input.int(5, "Length", minval = 1, maxval = 50)\nfloat s = 0.0\nfor i = 0 to len - 1\n    s += close[i]\nplot(s, title="Sum")\n'
const PINE2 = PINE.replace('s += close[i]', 's += close[i] * 2')
const PINE3 = PINE2.replace('* 2', '* 3')
const ID = 'u_00000000r001'
const RUNTIME_ROW = {
  def_id: ID, version: 1, rev: 1, ast_hash: 'runtime:sha256:x',
  definition: {
    id: ID, version: 1, schemaVersion: 1,
    meta: { name: 'Bar By Bar Sum', lane: 'runtime', runtimeLanguage: 'pine' },
    placement: { target: 'pane' },
    compute: { kind: 'runtime', fn: `runtime:${ID}`, rev: 1, source: PINE, outputs: { value: 0 } },
    plots: [{ key: 'value', label: 'Sum', style: 'line' }],
  },
}

let calls = []
function stubFetch(rows) {
  calls = []
  let version = 1
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method, url: String(url), body })
    // the store's runtime switch list: the owner has graded exactly this file's two scripts
    if (method === 'GET' && String(url).includes('runtime-kill')) {
      return { ok: true, status: 200, json: async () => ({ kill: [], allow: [PINE, PINE2, PINE3].map(runtimeSourceHash) }) }
    }
    if (method === 'GET' && String(url).startsWith('/api/user-definitions')) {
      return { ok: true, status: 200, json: async () => ({ definitions: rows }) }
    }
    if (method === 'PUT') { version += 1; return { ok: true, status: 200, json: async () => ({ def_id: ID, version, rev: version }) } }
    if (method === 'POST') return { ok: true, status: 200, json: async () => ({ def_id: 'u_00000000n001', version: 1, rev: 1 }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}
const flush = async () => {
  await act(async () => { vi.advanceTimersByTime(1500) })
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
let onChange
function mount() {
  onChange = vi.fn()
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} sym="SPY" tf="D" settings={{}} onChange={onChange} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const listRowOf = (name) => within(screen.getByText('Your formulas').closest('section')).getByText(name).closest('li')
const pineArea = () => screen.getByTestId('pine-box').querySelector('textarea')
async function openEdit() {
  stubFetch([RUNTIME_ROW])
  const view = mount()
  await flush()
  fireEvent.click(within(listRowOf('Bar By Bar Sum')).getByRole('button', { name: /^Edit Bar By Bar Sum$/i }))
  await flush()
  return view
}
async function type(text) {
  fireEvent.change(pineArea(), { target: { value: text } })
  await flush()
}
const writes = () => calls.filter((c) => c.method !== 'GET')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
})
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

describe('⭐⭐ Edit opens the stored script where a Pine script is edited', () => {
  it('the Pine tab holds the stored source; the member pane previews it; the save is labelled a revision', async () => {
    await openEdit()
    expect(pineArea().value).toBe(PINE)
    expect(screen.getByTestId('pine-member-pane')).toBeTruthy()
    expect(within(screen.getByTestId('pine-member-pane-attach')).getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.getByTestId('pine-member-pane-attach-copy').textContent).toBe('Save as a new indicator')
    expect(writes()).toEqual([])
  })
})

describe('⭐⭐ Save changes is a revision of the SAME document', () => {
  it('a PUT to its id with the version it opened; the installed document is the revision; no second instance', async () => {
    await openEdit()
    await type(PINE2)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })) })
    await flush()
    const put = writes()
    expect(put).toHaveLength(1)
    expect(put[0].method).toBe('PUT')
    expect(put[0].url).toBe(`/api/user-definitions/${ID}`)
    expect(put[0].body.base_version).toBe(1)
    expect(put[0].body.definition.compute.source).toBe(PINE2)
    expect(put[0].body.definition.compute.kind).toBe('runtime')
    expect(put[0].body.definition.inputs.some((i) => i.key === 'len')).toBe(true)
    const installed = registry.getDefinition(ID)
    expect(installed.compute.source).toBe(PINE2)
    expect(onChange).not.toHaveBeenCalled()   // the charts already showing it draw the revision
    // a second edit is based on the revision the store answered
    await type(PINE3)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })) })
    await flush()
    expect(writes()[1].body.base_version).toBe(2)
  })

  it('Save as a new indicator: a POST, the stored one untouched, an instance added', async () => {
    await openEdit()
    await type(PINE2)
    await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach-copy')) })
    await flush()
    const w = writes()
    expect(w).toHaveLength(1)
    expect(w[0].method).toBe('POST')
    expect(w[0].body.definition.compute.source).toBe(PINE2)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('⛔ an edit that fails, or is abandoned, writes nothing', () => {
  it('a script the door refuses: its reason is shown, no save is offered, nothing is written', async () => {
    await openEdit()
    await type('//@version=6\nindicator("x")\nplot(request.security(syminfo.tickerid, "45", close))\n')
    expect(screen.getByTestId('pine-member-pane-refusal').textContent.length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(writes()).toEqual([])
  })

  it('a script that does not parse: no save, nothing written', async () => {
    await openEdit()
    await type('//@version=5\nindicator("x"\nplot(close')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(writes()).toEqual([])
  })

  it('closing the sheet mid-edit writes nothing', async () => {
    const view = await openEdit()
    await type(PINE2)
    view.unmount()
    await flush()
    expect(writes()).toEqual([])
  })
})

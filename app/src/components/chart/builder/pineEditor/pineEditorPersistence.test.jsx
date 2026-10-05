// A2–A5 on the REAL builder sheet: the stored document carries the script it was
// built from, a saved script reopens and updates IN PLACE, rename / delete /
// restore walk the sheet's own store doors, and the inputs panel drives the
// preview atomically (H10's locks shown with their reason).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useState } from 'react'

import BuilderSheet from '../BuilderSheet'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from '../memberPane/memberPaneDefinition'
import * as engineRegistry from '../../engine/nativeRegistry'
import { reconcileParams } from '../paramEdit'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetPineAuthoringPermission, latchPineAuthoringPermission } from '../../engine/pineAuthoringGate'
import { applyInputValues, PINE_SOURCE_FIELD } from './pineScripts'

const STORED = 'u_bbbbbbbbbbbb'
const NEW = 'u_cccccccccccc'
const V1 = '//@version=5\nindicator("Mine")\nlength = input.int(14, "Length", minval = 1)\nplot(ta.rsi(close, length), "RSI")'
const V2 = '//@version=5\nindicator("Mine")\nlength = input.int(14, "Length", minval = 1)\nplot(ta.sma(close, length), "SMA")'
const LOCK = '//@version=5\nindicator("Lock")\nlen = input.int(5, "Len", minval = 1)\nplot(high[len] + ta.sma(close, len), "X")'

/** A stored row as the server keeps it: the door's document, named, with the
 *  member's script, saved at `length = 30` through the inputs panel. */
function storedDoc(src = V2, name = 'Saved one', values = { length: 30 }) {
  const base = memberPaneDefinition({ source: src, id: STORED }).definition
  const doc = applyInputValues(base, values).definition
  return { ...doc, id: STORED, meta: { ...doc.meta, name, [PINE_SOURCE_FIELD]: src } }
}

const H = vi.hoisted(() => ({ requests: [], postReply: null }))
function stubFetch() {
  H.requests = []
  H.postReply = null
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    H.requests.push({ url: u, method, body: init.body ?? null })
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (method === 'GET' && /\/api\/user-definitions\/u_[0-9a-z]+\/history/.test(u)) {
      return ok({
        def_id: STORED,
        versions: [
          { version: 1, created_at: 100, deleted_at: null, definition: storedDoc(V1, 'Saved one', {}) },
          { version: 2, created_at: 200, deleted_at: null, definition: storedDoc() },
        ],
      })
    }
    if (method === 'GET' && /\/api\/user-definitions\/u_[0-9a-z]+(\?|$)/.test(u)) {
      return ok({ def_id: STORED, version: 2, definition: storedDoc() })
    }
    if (method === 'GET' && /\/api\/user-definitions(\?|$)/.test(u)) {
      return ok({
        definitions: [{
          def_id: STORED, version: 2, rev: 1, created_at: 200,
          pine_source: { bytes: V2.length, licence: 'NONE-IN-SOURCE' },
          definition: { ...storedDoc(), meta: { ...storedDoc().meta, [PINE_SOURCE_FIELD]: undefined } },
        }],
      })
    }
    if (method === 'GET') return ok({})
    if (method === 'DELETE') return ok({ ok: true, def_id: STORED })
    if (method === 'POST') {
      return ok(H.postReply || { def_id: NEW, version: 1, rev: 1, pine_source: { pine_source: 'stored' } })
    }
    return ok({ def_id: STORED, version: 3, rev: 1, pine_source: { pine_source: 'stored' } })
  })
}
const writes = () => H.requests.filter((r) => r.method !== 'GET' && /user-definitions/.test(r.url))
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const settle = async () => { await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) }); await flush() }
const body = (r) => JSON.parse(r.body).definition

const seen = { changes: [] }
function Host({ initial = { indicatorInstances: [] } }) {
  const [settings, setSettings] = useState(initial)
  return (
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={settings}
          onChange={(next) => { seen.changes.push(next); setSettings(next) }} sym="SPY" tf="D" />
      </SWRConfig>
    </AuthContext.Provider>
  )
}

async function openEditor(props) {
  render(<Host {...props} />)
  await flush()
  fireEvent.click(screen.getByRole('tab', { name: /^pine editor$/i }))
  await flush()
}
async function typeScript(text) {
  fireEvent.change(screen.getByLabelText('Pine source'), { target: { value: text } })
  await settle()
}
async function click(el) { await act(async () => { fireEvent.click(el) }); await flush(); await flush() }
async function openMyScripts() {
  await click(screen.getByTestId('pine-my-scripts-toggle'))
  return screen.getAllByTestId('pine-script-row')
}

beforeEach(() => {
  seen.changes = []
  vi.useFakeTimers()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '1')
  stubFetch()
})
afterEach(() => {
  for (const id of [STORED, NEW]) engineRegistry.uninstallUserDefinition(id)
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('O3 — the tab needs the build flag AND the member stage', () => {
  it('⛔ build flag on, stage not latched: no tab; stage latched true: the tab', async () => {
    __resetPineAuthoringPermission()
    render(<Host />)
    await flush()
    expect(screen.getByRole('tab', { name: /^import$/i })).toBeTruthy()       // non-vacuous
    expect(screen.queryByRole('tab', { name: /^pine editor$/i })).toBe(null)
    cleanup()
    latchPineAuthoringPermission({ pine_authoring_enabled: true })
    render(<Host />)
    await flush()
    expect(screen.getByRole('tab', { name: /^pine editor$/i })).toBeTruthy()
  })
})

describe('A2 — the stored document carries its script', () => {
  it('⭐ Apply sends the SETTLED script and the typed name; Save stores without a chart instance', async () => {
    await openEditor()
    fireEvent.change(screen.getByTestId('pine-editor-name'), { target: { value: 'My RSI' } })
    await typeScript(V1)
    await click(screen.getByTestId('pine-editor-save'))
    expect(writes()).toHaveLength(1)
    const sent = body(writes()[0])
    expect(writes()[0].method).toBe('POST')
    expect(sent.meta[PINE_SOURCE_FIELD]).toBe(V1)
    expect(sent.meta.name).toBe('My RSI')
    // ⛔ the source is not compute: the maths is the door's, byte for byte
    expect(sent.compute).toEqual(memberPaneDefinition({ source: V1, id: 'u_member-pane' }).definition.compute)
    expect(seen.changes).toHaveLength(0)                                     // Save adds no instance
    expect(screen.getByTestId('pine-editor-applied').textContent).toBe('Saved to My scripts.')

    // the next apply UPDATES that definition and puts it on the chart
    await typeScript(V2)
    await click(screen.getByTestId('pine-editor-apply'))
    expect(writes()[1].method).toBe('PUT')
    expect(writes()[1].url).toMatch(new RegExp(`/${NEW}$`))
    expect(body(writes()[1]).meta[PINE_SOURCE_FIELD]).toBe(V2)
    expect(seen.changes).toHaveLength(1)
  })

  it('a source the server WITHHELD is said out loud, with the server\'s reason', async () => {
    H.postReply = { def_id: NEW, version: 1, rev: 1,
      pine_source: { pine_source: 'withheld', reason: 'the Pine Editor is switched on for admins only right now (PINE_AUTHORING_STAGE=admins), so this script\'s source was not kept with it' } }
    await openEditor()
    await typeScript(V1)
    await click(screen.getByTestId('pine-editor-apply'))
    expect(screen.getByTestId('pine-editor-applied').textContent)
      .toMatch(/^Added to your chart\. Your code was not kept with it: the Pine Editor is switched on for admins only/)
  })
})

describe('A3 / A4 — My scripts', () => {
  it('⭐⭐ Open reads MY row, loads its script and stored inputs, and Apply then PUTs that id', async () => {
    await openEditor()
    const rows = await openMyScripts()
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Saved one')).toBeTruthy()
    await click(within(rows[0]).getByTestId('pine-script-open'))
    expect(H.requests.some((r) => r.method === 'GET' && r.url.endsWith(`/api/user-definitions/${STORED}`))).toBe(true)
    expect(screen.getByLabelText('Pine source').value).toBe(V2)
    expect(screen.getByTestId('pine-editor-name').value).toBe('Saved one')
    await settle()
    const knob = screen.getAllByTestId(/^param-input-/)[0]
    expect(knob.value).toBe('30')                                // the stored input value, reseeded
    expect(screen.getByTestId('pine-editor-apply').textContent).toBe('Update on chart')
    await click(screen.getByTestId('pine-editor-apply'))
    expect(writes()).toHaveLength(1)
    expect(writes()[0].method).toBe('PUT')
    expect(writes()[0].url).toMatch(new RegExp(`/${STORED}$`))
    const put = body(writes()[0])
    expect(put.meta[PINE_SOURCE_FIELD]).toBe(V2)
    expect(reconcileParams(put)[Object.keys(put.compute.paramManifest)[0]].value).toBe(30)
  })

  it('Rename reads my row and PUTs it back renamed, the script kept', async () => {
    await openEditor()
    const [row] = await openMyScripts()
    await click(within(row).getByTestId('pine-script-rename'))
    fireEvent.change(within(row).getByTestId('pine-script-rename-input'), { target: { value: 'Renamed' } })
    await click(within(row).getByTestId('pine-script-rename-save'))
    expect(writes()).toHaveLength(1)
    expect(writes()[0].method).toBe('PUT')
    expect(writes()[0].url).toMatch(new RegExp(`/${STORED}$`))
    const put = body(writes()[0])
    expect(put.meta.name).toBe('Renamed')
    expect(put.meta[PINE_SOURCE_FIELD]).toBe(V2)
    expect(put.compute).toEqual(storedDoc().compute)
  })

  it('⛔ Delete ASKS FIRST, then soft-deletes and takes the script off this chart', async () => {
    // on the chart = installed (the chart path installs every stored row)
    expect(engineRegistry.installUserDefinitions([storedDoc()]).installed).toHaveLength(1)
    await openEditor({ initial: { indicatorInstances: [{ instanceId: 'i1', defId: STORED, inputs: {} }] } })
    const [row] = await openMyScripts()
    await click(within(row).getByTestId('pine-script-delete'))
    expect(writes()).toHaveLength(0)                              // armed, not fired
    await click(within(row).getByTestId('pine-script-delete-confirm'))
    expect(writes()).toHaveLength(1)
    expect(writes()[0].method).toBe('DELETE')
    expect(writes()[0].url).toMatch(new RegExp(`/${STORED}$`))
    expect(seen.changes).toHaveLength(1)
    const last = seen.changes[0]
    expect(last.indicators[STORED].enabled).toBe(false)
    expect(last.indicatorInstances.some((i) => i && i.defId === STORED && i.inputs)).toBe(false)
  })

  it('Versions lists the history and Restore APPENDS the old version, then opens it', async () => {
    await openEditor()
    const [row] = await openMyScripts()
    await click(within(row).getByTestId('pine-script-versions'))
    const versions = within(row).getAllByTestId('pine-script-version')
    expect(versions.map((v) => v.dataset.version)).toEqual(['1', '2'])
    expect(within(versions[1]).queryByTestId('pine-script-restore')).toBe(null)   // current
    await click(within(versions[0]).getByTestId('pine-script-restore'))
    expect(writes()).toHaveLength(1)
    expect(writes()[0].method).toBe('PUT')
    expect(writes()[0].url).toMatch(new RegExp(`/${STORED}$`))
    expect(body(writes()[0]).meta[PINE_SOURCE_FIELD]).toBe(V1)
    expect(screen.getByLabelText('Pine source').value).toBe(V1)
  })
})

describe('A5 — the inputs panel drives the preview, atomically', () => {
  const previewValue = () => {
    const d = engineRegistry.listUserDefinitions().find((x) => x.id === MEMBER_PANE_DEF_PREFIX)
    return d ? reconcileParams(d)[Object.keys(d.compute.paramManifest)[0]].value : null
  }

  it('⭐ a new value redraws the preview and rides on Apply; the source is not touched', async () => {
    await openEditor()
    await typeScript(V1)
    expect(previewValue()).toBe(14)
    const knob = screen.getAllByTestId(/^param-input-/)[0]
    fireEvent.change(knob, { target: { value: '21' } })
    fireEvent.keyDown(knob, { key: 'Enter' })
    await flush()
    expect(previewValue()).toBe(21)
    expect(screen.getByLabelText('Pine source').value).toBe(V1)
    await click(screen.getByTestId('pine-editor-apply'))
    const sent = body(writes()[0])
    expect(reconcileParams(sent)[Object.keys(sent.compute.paramManifest)[0]].value).toBe(21)
    expect(sent.meta[PINE_SOURCE_FIELD]).toBe(V1)
  })

  it('⛔ a refused value is named and the preview KEEPS the last good value', async () => {
    await openEditor()
    await typeScript(V1)
    const knob = screen.getAllByTestId(/^param-input-/)[0]
    fireEvent.change(knob, { target: { value: '21' } })
    fireEvent.keyDown(knob, { key: 'Enter' })
    await flush()
    fireEvent.change(knob, { target: { value: '0' } })
    fireEvent.keyDown(knob, { key: 'Enter' })
    await flush()
    expect(screen.getByTestId('pine-editor-inputs-error').textContent).toMatch(/must be >= 1/)
    expect(previewValue()).toBe(21)
  })

  it('⛔ an H10-locked knob shows its reason and offers no control', async () => {
    await openEditor()
    await typeScript(LOCK)
    const locked = screen.getByTestId('pine-editor-inputs-locked')
    expect(locked.textContent).toMatch(/`Len` is not offered as an adjustable setting here: it also sets a length or a history offset/)
    expect(screen.queryAllByTestId(/^param-input-/)).toHaveLength(0)
  })
})

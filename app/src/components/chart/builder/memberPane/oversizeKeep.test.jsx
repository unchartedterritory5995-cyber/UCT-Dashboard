// app/src/components/chart/builder/memberPane/oversizeKeep.test.jsx
//
// ⭐⭐ ITEM 2 (2026-11-21, coordinator ruling) — A PREVIEW THE STORE CANNOT HOLD IS KEPT ANOTHER WAY AT ADD, OR ITS ADD
// IS REFUSED UP FRONT, BY NAME (`memberPaneDefinition.js::withOversizeKeep`, `MemberPane.jsx::keptBuildOf`).
//
// ⚰️ vdubus-pattern-gen-v2-restored-refined (committed, MPL-2.0): its host document is ~4 MB as the store counts it
// (one ambiguity guard of a two-site `var` array window, inlined once per read), the store's cap is 64 KiB, and the
// door drew it, offered Add, sent 4 MB and rendered the store's internal 400 sentence. The preview stays (it grades
// MATCH); Add now keeps its runtime-lane document (~20 KB, its notes said first), or refuses by name and sends nothing.
//
// The store's half: `tests/test_oversize_keep.py` saves the exact body this file captures from the real client save
// (`saveUserDefinition`) and reads it back. Regenerate the shared body:
//   OVERSIZE_KEEP_WRITE=1 node node_modules/vitest/vitest.mjs run src/components/chart/builder/memberPane/oversizeKeep.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  memberPaneDefinition, MEMBER_PANE_DEF_PREFIX, DOCUMENT_SIZE_GUARD, RUNTIME_DOCUMENT_BYTE_BUDGET,
  documentSizeSentence, keepAnotherWaySentence,
} from './memberPaneDefinition'
import { storedBytesOf, pyJsonBytes } from './storedBytes'
import { retranslateRow } from './savedScriptUpgrade'
import * as registry from '../../engine/nativeRegistry'
import { DOCUMENT_BYTE_BUDGET } from '../../engine/ast/graphDocument'
import {
  __allowEveryRuntimeScriptForTests, setRuntimeAllowList, setRuntimeKillList, runtimeSourceHash,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, __resetRuntimeAdmission, runtimeFormingRefusalOf,
} from '../../engine/runtimeKill'
import { saveUserDefinition } from '../../../../hooks/useUserDefinitions'

const paneProps = []
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { paneProps.push(props); return <div data-testid="mock-chart-pane" /> },
}))

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const BODY_PATH = path.join(REPO, 'tests/fixtures/oversize_keep_vdubus.json')
const SLUG = 'vdubus-pattern-gen-v2-restored-refined__66dc68412e'
const VDUBUS = fs.readFileSync(path.join(REPO, 'corpus/committed', `${SLUG}.pine`), 'utf8')
const LF = String.fromCharCode(10)
const SMALL = ['//@version=5', 'indicator("small", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
  'if barstate.islast', '    label.new(bar_index, high, "up")'].join(LF)

const runtimeOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const runtimeOff = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
}
let seq = 0
const door = (source = VDUBUS) => memberPaneDefinition({ source, name: 'vd', id: `u_member-pane-ok${++seq}` })

beforeEach(() => { __allowEveryRuntimeScriptForTests() })
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  setRuntimeKillList([])
  setRuntimeCapabilityAdmission(false)
  __resetRuntimeAdmission()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
  paneProps.length = 0
})

describe('⭐⭐ the door: the preview stays the host answer; what Add keeps rides beside it', () => {
  it('K1 — vdubus, runtime pane on: the host preview, and the runtime-lane document Add saves instead, with its notes', () => {
    runtimeOn()
    const d = door()
    expect(d.ok).toBe(true)
    // the PREVIEW: the host document, unchanged by this rule
    expect(d.definition.compute.kind).toBe('ast')
    expect(d.definition.objects && d.definition.objects.ops.length).toBeGreaterThan(100)
    const bytes = storedBytesOf(d.definition)
    expect(bytes).toBeGreaterThan(DOCUMENT_BYTE_BUDGET)
    // #2248's sentence still names the host document as the run half's cause, at the SAME count
    const m = /^the document is (\d+) bytes as the store counts it WITHOUT the run half/.exec(d.runHalfDeclined.why)
    expect(m, d.runHalfDeclined.why).toBeTruthy()
    expect(Number(m[1])).toBe(bytes)
    // what Add keeps
    expect(d.oversize).toMatchObject({ guard: DOCUMENT_SIZE_GUARD, bytes, cap: DOCUMENT_BYTE_BUDGET })
    expect(d.oversize.refusal).toBeUndefined()
    const keep = d.oversize.saveAs.definition
    expect(keep.compute.kind).toBe('runtime')
    expect(keep.compute.source).toBe(VDUBUS)
    expect(keep.compute.objects).toBe(true)
    expect(d.oversize.saveAs.bytes).toBe(pyJsonBytes(keep))
    expect(d.oversize.saveAs.bytes).toBeLessThanOrEqual(DOCUMENT_BYTE_BUDGET)
    expect(d.oversize.saveAs.lead).toBe(keepAnotherWaySentence(bytes))
    const names = d.oversize.saveAs.notes.map((n) => n.name)
    expect(names).toEqual(expect.arrayContaining(['Drawn bar by bar', 'Settles one bar later']))
    expect(keep.meta.repaint).toBe('preview-repaints')
    // every script allowed (the test grant): no closed-bar-only restriction to say
    expect(d.oversize.saveAs.forming).toBeNull()
  }, 240000)

  it('K2 — vdubus, runtime pane OFF: Add refused by name, up front, with the bytes and the cap; nothing to save', () => {
    runtimeOff()
    const d = door()
    expect(d.ok).toBe(true)
    expect(d.definition.compute.kind).toBe('ast')
    const bytes = storedBytesOf(d.definition)
    expect(d.oversize).toEqual({ guard: DOCUMENT_SIZE_GUARD, bytes, cap: DOCUMENT_BYTE_BUDGET, refusal: documentSizeSentence(bytes) })
    expect(d.oversize.refusal).toBe(`this script can be shown here but is too large to keep: as a saved indicator it would be ${bytes} bytes, and one may hold at most 65536`)
  }, 240000)

  it('K3 — runtime pane on, but the bar-by-bar lane declines (kill list): refused by name, its decline said', () => {
    runtimeOn()
    setRuntimeKillList([runtimeSourceHash(VDUBUS).slice(0, 16)])
    const d = door()
    expect(d.ok).toBe(true)
    expect(d.oversize.saveAs).toBeUndefined()
    expect(d.oversize.refusal.startsWith(`${documentSizeSentence(d.oversize.bytes)}, and its bar-by-bar version declined: `)).toBe(true)
    expect(d.oversize.runtimeDeclined.code).toBe('runtime:killed')
  }, 240000)

  it('K4 — G6: admitted by capability for closed-bar history only, the keep notes say it is not drawn while the newest bar forms', () => {
    runtimeOn()
    setRuntimeAllowList([])
    setRuntimeCapabilityAdmission(true)
    latchRuntimeAdmission(runtimeSourceHash(VDUBUS), { admitted: true, historyOnly: true })
    const d = door()
    expect(d.oversize.saveAs.definition.compute.kind).toBe('runtime')
    expect(d.oversize.saveAs.forming).toBe(runtimeFormingRefusalOf({ source: VDUBUS, newestBarIsForming: true }))
    expect(d.oversize.saveAs.forming).toMatch(/not drawn bar by bar while this chart's newest bar is still forming/)
  }, 240000)

  it('K5 — CONTROL: a script the store can hold carries nothing new, either pane state', () => {
    for (const arm of [runtimeOn, runtimeOff]) {
      arm()
      const d = door(SMALL)
      expect(d.ok).toBe(true)
      expect(storedBytesOf(d.definition)).toBeLessThanOrEqual(DOCUMENT_BYTE_BUDGET)
      expect('oversize' in d).toBe(false)
    }
  })

  it('K6 — the runtime document cap mirrors the server\'s', () => {
    const py = fs.readFileSync(path.join(REPO, 'api/services/runtime_definitions.py'), 'utf8')
    const m = /^RUNTIME_MAX_DEFINITION_BYTES = (\d+) \* (\d+)$/m.exec(py)
    expect(m).toBeTruthy()
    expect(RUNTIME_DOCUMENT_BYTE_BUDGET).toBe(Number(m[1]) * Number(m[2]))
  })
})

describe('⭐⭐ the pane: Add keeps what the store can hold, and says so before the member confirms', () => {
  const mount = async (onAttach) => {
    import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    const { default: MemberPane } = await import('./MemberPane.jsx')
    render(<MemberPane sym="SPY" tf="D" source={VDUBUS} onAttach={onAttach} />)
  }

  it('K7 — runtime pane on: the preview is the host document; the notes come first; Add saves the RUNTIME document', async () => {
    runtimeOn()
    const saved = []
    await mount(async (definition, opts) => { saved.push({ definition: JSON.parse(JSON.stringify(definition)), opts }); return { ok: true } })
    expect(registry.getDefinition(MEMBER_PANE_DEF_PREFIX).compute.kind).toBe('ast')
    const keep = screen.getByTestId('pine-member-pane-keep')
    expect(keep.textContent).toContain('so Add keeps it drawn bar by bar instead:')
    expect(keep.textContent).toMatch(/drawn by running it bar by bar/)
    expect(screen.queryByTestId('pine-member-pane-keep-refusal')).toBeNull()
    // the runtime document repaints a preview: the acknowledgement is asked before Add
    const button = screen.getByTestId('pine-member-pane-attach').querySelector('button')
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('pine-member-pane-repaint-ack'))
    expect(button.disabled).toBe(false)
    await act(async () => { fireEvent.click(button) })
    expect(saved).toHaveLength(1)
    expect(saved[0].definition.compute.kind).toBe('runtime')
    expect(saved[0].definition.compute.source).toBe(VDUBUS)
    expect(saved[0].opts.previewAcked).toBe(true)
  }, 240000)

  it('K8 — runtime pane off: the refusal is said up front, there is no Add, and nothing is sent', async () => {
    runtimeOff()
    const onAttach = vi.fn(async () => ({ ok: true }))
    await mount(onAttach)
    expect(screen.getByTestId('pine-member-pane')).toBeTruthy()          // the preview still draws
    const refusal = screen.getByTestId('pine-member-pane-keep-refusal')
    expect(refusal.textContent).toMatch(/^this script can be shown here but is too large to keep: as a saved indicator it would be \d+ bytes, and one may hold at most 65536$/)
    expect(screen.queryByTestId('pine-member-pane-attach')).toBeNull()
    expect(onAttach).not.toHaveBeenCalled()
  }, 240000)
})

describe('⭐⭐ saved-script upgrade: a translation the store cannot hold keeps the stored document drawn', () => {
  const row = { def_id: 'u_0123456789ab', version: 3, pine_source: 'x', definition: { compute: { kind: 'ast' }, meta: {} } }
  it('K9 — over the cap: INCONCLUSIVE, with or without the runtime pane; CONTROL: under it, upgraded', () => {
    const over = () => ({ ok: true, definition: { compute: { kind: 'ast' }, meta: {} },
      oversize: { guard: DOCUMENT_SIZE_GUARD, bytes: 4076728, cap: DOCUMENT_BYTE_BUDGET, refusal: 'x' } })
    for (const arm of [runtimeOn, runtimeOff]) {
      arm()
      const r = retranslateRow(row, over)
      expect(r.status).toBe('inconclusive')
      expect(r.reason).toBe(`${DOCUMENT_SIZE_GUARD}: today's translation is 4076728 bytes, past the store's 65536-byte cap`)
    }
    runtimeOff()
    const under = retranslateRow(row, () => ({ ok: true, definition: { compute: { kind: 'ast' }, meta: {} } }))
    expect(under.status).toBe('upgraded')
  })
})

describe('⭐⭐ the body the store is handed (its pytest twin: tests/test_oversize_keep.py)', () => {
  it('K10 — the real client save sends the runtime document; the shared body is that request', async () => {
    runtimeOn()
    // a fixed draft id, so the shared body does not move with test order (the store mints its own on a create)
    const d = memberPaneDefinition({ source: VDUBUS, name: 'Vdubus Gen V2', id: 'u_member-pane-keep' })
    const sent = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      sent.push({ url, init })
      return { ok: false, status: 400, json: async () => ({ detail: 'probe' }) }
    })
    try {
      await saveUserDefinition(d.oversize.saveAs.definition, null, null, { previewAcked: true })
    } finally { fetchSpy.mockRestore() }
    expect(sent).toHaveLength(1)
    expect(sent[0].init.method).toBe('POST')
    const body = JSON.parse(sent[0].init.body)
    expect(body.definition.compute.kind).toBe('runtime')
    expect(body.repaint_acknowledged).toBe(true)
    if (process.env.OVERSIZE_KEEP_WRITE === '1') {
      fs.writeFileSync(BODY_PATH, JSON.stringify({
        _readme: 'ITEM 2: the POST body the member door sends when Add keeps vdubus-pattern-gen-v2 (committed, MPL-2.0) '
          + 'drawn bar by bar, its host document being past the store\'s 64 KiB cap. Written by oversizeKeep.test.jsx '
          + '(OVERSIZE_KEEP_WRITE=1), saved and read back by tests/test_oversize_keep.py.',
        slug: SLUG, body,
      }, null, 1) + '\n')
    }
    const shared = JSON.parse(fs.readFileSync(BODY_PATH, 'utf8'))
    // ⛔ the copy text of the notes may be reworded without re-asking the store; everything else is the request
    const withoutCopy = (b) => ({ ...b, definition: { ...b.definition, meta: { ...b.definition.meta, disclosures: null } } })
    expect(withoutCopy(shared.body), 'regenerate: OVERSIZE_KEEP_WRITE=1 (see the header)').toEqual(withoutCopy(body))
  }, 240000)
})

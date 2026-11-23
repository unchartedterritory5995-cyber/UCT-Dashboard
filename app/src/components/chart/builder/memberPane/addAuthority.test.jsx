// app/src/components/chart/builder/memberPane/addAuthority.test.jsx
//
// ─── ⭐⭐ (e94 train, coordinator ruling 2026-11-22) — ONE ANSWER TO "WHAT MAY ADD SEND, AND MAY IT SEND IT NOW?" ─────
//
// `addAuthority.js` is read by MemberPane's render (whether Add is shown, whether it is pressable) and by both of its
// handlers (a press, a press queued on a pending admission); nothing else decides it. Railed here:
//   1. the authority itself, each rule with a control (ITEM 2's keep-or-refuse, the paste worker's wait);
//   2. REACHABILITY: a build minted while the admission is still being checked is never kept another way: an oversize
//      preview is kept only as its runtime-lane document, and that lane fails closed until the verdict lands. So no Add
//      is offered on it, and none can be queued on it (control: the verdict lands and the same script is kept);
//   3. the queued Add's own guards, through the real pane with its door answers fed in: a re-minted build kept another
//      way is sent as its KEPT document, never the preview; a re-minted build Add refuses up front sends nothing.
// Mutants: ci/mutants/e94-add-authority.json.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// the pane's door answers, fed in by the queued-Add cases (the real door builds them; only the hook is replaced)
const DOOR = vi.hoisted(() => ({ state: null }))
vi.mock('./useMemberDoor', () => ({ useMemberDoor: () => DOOR.state }))
vi.mock('../../pane/ChartPane', () => ({ default: () => <div data-testid="mock-chart-pane" /> }))

import { keptForAdd, addSendsFor, addReady } from './addAuthority'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import {
  __allowEveryRuntimeScriptForTests, setRuntimeAllowList, setRuntimeKillList, setRuntimeCapabilityAdmission,
  latchRuntimeAdmission, __resetRuntimeAdmission, runtimeConsultPendingOf, runtimeSourceHash,
} from '../../engine/runtimeKill'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const VDUBUS = fs.readFileSync(path.join(REPO, 'corpus/committed', 'vdubus-pattern-gen-v2-restored-refined__66dc68412e.pine'), 'utf8')
const LF = String.fromCharCode(10)
const SMALL = ['//@version=5', 'indicator("small", overlay = true)', 'plot(ta.sma(close, 5), "m")'].join(LF)
const runtimeOn = () => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
let seq = 0
const door = (source) => memberPaneDefinition({ source, name: 'vd', id: `u_member-pane-aa${++seq}` })

beforeEach(() => { __allowEveryRuntimeScriptForTests() })
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  setRuntimeKillList([])
  setRuntimeCapabilityAdmission(false)
  __resetRuntimeAdmission()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
  DOOR.state = null
})

describe('⭐⭐ the authority: what Add keeps, and whether it may send it now', () => {
  const host = { ok: true, definition: { compute: { kind: 'ast' } } }
  const keep = { ok: true, definition: { compute: { kind: 'ast' } }, oversize: { saveAs: { definition: { compute: { kind: 'runtime' } } } } }
  const refused = { ok: true, definition: { compute: { kind: 'ast' } }, oversize: { refusal: 'too large to keep' } }

  it('keptForAdd: the build; an oversize preview kept as its runtime document; null when Add is refused up front', () => {
    expect(keptForAdd(host)).toBe(host)
    expect(keptForAdd(keep).definition.compute.kind).toBe('runtime')
    expect(keptForAdd(keep).oversize).toBe(keep.oversize)
    expect(keptForAdd(refused), 'ITEM 2: refused up front, nothing is sent').toBe(null)
    expect(keptForAdd(null)).toBe(null)
    expect(keptForAdd({ ok: false, definition: null })).toBe(null)
    expect(keptForAdd({ ...host, saveable: false }), 'a build this door does not save').toBe(null)
    expect(keptForAdd({ ...host, saveable: true }), 'control: saveable').not.toBe(null)
  })

  it('addSendsFor: the kept build only when the build on screen is of the box\'s own text', () => {
    expect(addSendsFor({ built: keep, doorSource: 'a', source: 'a' }).definition.compute.kind).toBe('runtime')
    expect(addSendsFor({ built: host, doorSource: 'a', source: 'b' }), 'a build of an older text').toBe(null)
    expect(addSendsFor({ built: refused, doorSource: 'a', source: 'a' })).toBe(null)
  })

  it('addReady: something to send for this text, and no newer build of the box running', () => {
    expect(addReady({ built: host, building: false, doorSource: 'a', source: 'a' })).toBe(true)
    expect(addReady({ built: host, building: true, doorSource: 'a', source: 'a' }), 'a newer build runs').toBe(false)
    expect(addReady({ built: host, building: false, doorSource: 'a', source: 'b' }), 'the build is of another text').toBe(false)
    expect(addReady({ built: refused, building: false, doorSource: 'a', source: 'a' }), 'refused up front').toBe(false)
  })
})

describe('⭐⭐ reachability: a build minted on a pending admission is never kept another way', () => {
  it('the oversize keep needs the runtime lane, which waits for the verdict: no Add is offered, none can be queued', () => {
    runtimeOn()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))   // the admission ask never answers
    __resetRuntimeAdmission()                                     // (first: it also switches admission off)
    setRuntimeAllowList([])                                       // not the test grant: the server decides
    setRuntimeCapabilityAdmission(true)
    const d = door(VDUBUS)
    expect(runtimeConsultPendingOf({ source: VDUBUS }), 'the build was minted on a pending admission').toBe(true)
    expect(d.ok).toBe(true)
    expect(d.oversize && d.oversize.saveAs).toBeFalsy()
    expect(d.oversize.refusal).toMatch(/still being checked/)
    expect(keptForAdd(d), 'nothing for Add to keep: no Add, so no queued Add').toBe(null)
    // CONTROL: the verdict lands (admitted): the same script is kept another way, and nothing waits on it
    latchRuntimeAdmission(runtimeSourceHash(VDUBUS), { admitted: true, historyOnly: false })
    const e = door(VDUBUS)
    expect(runtimeConsultPendingOf({ source: VDUBUS })).toBe(false)
    expect(keptForAdd(e).definition.compute.kind).toBe('runtime')
  }, 240000)
})

describe('⭐⭐ the queued Add (pressed while its build waited for the admission) sends what the authority keeps', () => {
  const mount = async (onAttach) => {
    import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
    const { default: MemberPane } = await import('./MemberPane.jsx')
    const el = () => <MemberPane sym="SPY" tf="D" source={SMALL} onAttach={onAttach} />
    const view = render(el())
    return () => view.rerender(el())
  }
  const landed = (built, consultPending, s) => ({ key: 'k', args: { source: SMALL, id: MEMBER_PANE_DEF_PREFIX },
    landed: { built, consultPending }, seq: s, pending: false })

  /** The first build (a host build of the box's text, minted while its admission was being checked), the Add pressed
   *  on it, and the re-mint fed in as the next answer. Returns what was saved. */
  async function queuedAdd(reminted) {
    runtimeOn()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const first = door(SMALL)
    expect(keptForAdd(first)).toBe(first)
    const saved = []
    DOOR.state = landed(first, true, 1)
    const again = await mount(async (definition) => { saved.push(definition); return { ok: true } })
    await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button')) })
    expect(saved, 'queued: it waits for the re-mint').toHaveLength(0)
    DOOR.state = landed(reminted, false, 2)
    await act(async () => { again() })
    return saved
  }

  it('a re-mint kept another way: the queued Add saves the KEPT (runtime) document, never the preview', async () => {
    runtimeOn()
    const big = door(VDUBUS)                       // the test grant: the runtime lane builds it
    expect(big.oversize && big.oversize.saveAs).toBeTruthy()
    // (the acknowledgement a kept runtime document asks is its own rail, oversizeKeep K7: here it asks none, so the
    // queued Add sends it as soon as it lands)
    const def = big.oversize.saveAs.definition
    const reminted = { ...big, oversize: { ...big.oversize, saveAs: { ...big.oversize.saveAs,
      definition: { ...def, meta: { ...(def.meta || {}), repaint: undefined } } } } }
    const saved = await queuedAdd(reminted)
    expect(saved).toHaveLength(1)
    expect(saved[0].compute.kind, 'the kept document, not the 4 MB preview').toBe('runtime')
  }, 240000)

  it('a re-mint Add refuses up front: the queued Add sends nothing, and the refusal is said', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const refusedBuild = door(VDUBUS)              // runtime pane off: no bar-by-bar keep, refused up front
    expect(refusedBuild.oversize.refusal).toBeTruthy()
    const saved = await queuedAdd(refusedBuild)
    expect(saved).toHaveLength(0)
    expect(screen.getByTestId('pine-member-pane-keep-refusal')).toBeTruthy()
    expect(screen.queryByTestId('pine-member-pane-attach-checking')).toBeNull()
  }, 240000)
})

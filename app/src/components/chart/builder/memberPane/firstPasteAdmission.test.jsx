// app/src/components/chart/builder/memberPane/firstPasteAdmission.test.jsx
//
// ⭐⭐ (2026-11-18) THE FIRST-PASTE RACE, RAILED THROUGH THE REAL PANE. the 2026-11-18 production check's fresh session: the first paste of
// supertrend-strategy minted the HOST copy (5 settings; its backtest declined, "still being checked") while every
// later paste got the run-lane copy (12 settings). The door reads the runtime admission synchronously and fails
// closed while the server has not answered; the pane re-minted only on its own watcher, which waited a full recheck
// (60 s) after the server's busy answers, and never on an answer that landed by another path; and an Add pressed in
// that window attached the host copy.
//
// The server is faked (`fetch`): the lists read answers admission ON, and the admission door answers "still being
// checked" (`missing: ['pending']`) as many times as a case says before it admits. `ChartPane` is mocked: what the
// pane INSTALLS and what `onAttach` is handed are asserted, never pixels.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'
import {
  __resetRuntimeAllowList, __resetRuntimeAdmission, __resetRuntimeListsRecheck, setRuntimeKillList,
  setRuntimeCapabilityAdmission, runtimeSourceHash, RUNTIME_ADMISSION_PATH, RUNTIME_KILL_PATH,
  RUNTIME_ADMISSION_ATTACH_WAIT_MS,
} from '../../engine/runtimeKill'

vi.mock('../../pane/ChartPane', () => ({ default: () => <div data-testid="mock-chart-pane" /> }))

const ROOT = path.resolve(process.cwd(), '..')
const STRATEGY = fs.readFileSync(path.join(ROOT, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8')
const PLAIN = '//@version=5\nindicator("Plain")\nplot(close, "Close")\n'
const BROKER_FLAG = (fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/strategyBrokerGate.js'), 'utf8')
  .match(/import\.meta\.env\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const LISTS_ON = { kill: [], allow: [], capability_admission: true }
const okJson = (body) => ({ ok: true, json: async () => body })

let fetchMock
/** The server: the lists read (`hangLists`: never answers), and the admission door answering pending `pending` times. */
function server({ pending = 0, never = false, hangLists = false } = {}) {
  let asked = 0
  fetchMock.mockImplementation(async (url, init) => {
    if (url === RUNTIME_KILL_PATH) return hangLists ? new Promise(() => {}) : okJson(LISTS_ON)
    if (url === RUNTIME_ADMISSION_PATH) {
      asked += 1
      const { source } = JSON.parse(init.body)
      const sha256 = runtimeSourceHash(source)
      if (never || asked <= pending) return okJson({ sha256, admitted: false, missing: ['pending'] })
      return okJson({ sha256, admitted: true, missing: [] })
    }
    return okJson({})
  })
  return () => asked
}
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const drawn = () => registry.getDefinition(MEMBER_PANE_DEF_PREFIX)
const runLane = (d) => !!(d && d.compute && d.compute.kind === 'runtime')
/** the script's own settings (what the door's "This script has N settings" counts), without the plots' style inputs */
const settingsOf = (d) => d.inputs.map((i) => i.key).filter((k) => !/^(color|lineWidth|out\d+(Color|Width))$/.test(k))

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  vi.stubEnv(BROKER_FLAG, '1')
  import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
  // a fresh tab whose lists say admission is ON, and no verdict for any script yet (the server has not met it)
  __resetRuntimeAllowList()
  __resetRuntimeAdmission()
  __resetRuntimeListsRecheck()
  setRuntimeKillList([])
  setRuntimeCapabilityAdmission(true)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  __resetRuntimeAdmission()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

async function paste(source, onAttach = null) {
  const { default: MemberPane } = await import('./MemberPane.jsx')
  render(<MemberPane sym="RDDT" tf="D" source={source} onAttach={onAttach} />)
  await advance(0)
}

describe('the first paste of a script the server has not answered for', () => {
  it('CONTROL: once admitted, the door mints the run-lane copy (12 settings), and before, the host copy', async () => {
    server({ pending: 0 })
    await paste(STRATEGY)
    await advance(1000)
    expect(runLane(drawn())).toBe(true)
    expect(settingsOf(drawn())).toHaveLength(12)
    cleanup()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    server({ never: true })
    await paste(STRATEGY)
    expect(runLane(drawn())).toBe(false)
    expect(settingsOf(drawn())).toHaveLength(5)
  })

  it('⭐ the busy server: "still being checked" past the request\'s own retries, then admitted — the preview ends as the run-lane copy within seconds', async () => {
    const asked = server({ pending: 6 })
    await paste(STRATEGY)
    expect(runLane(drawn())).toBe(false)               // minted before the answer: the host copy
    await advance(20000)
    expect(asked()).toBeGreaterThan(6)
    expect(runLane(drawn())).toBe(true)                // ⚰️ was the host copy until the 60 s recheck
    expect(settingsOf(drawn())).toHaveLength(12)
  })

  it('⭐ an answer landed by ANOTHER path (the build\'s own ask) re-mints the preview, the pane\'s own lists read still out', async () => {
    server({ pending: 0, hangLists: true })
    await paste(STRATEGY)
    await advance(500)
    expect(runLane(drawn())).toBe(true)                // ⚰️ the host copy for as long as the pane's lists read was out
  })

  it('⭐ an Add pressed before the answer waits for it, re-mints, and attaches the run-lane copy the preview then shows', async () => {
    server({ pending: 6 })
    const saved = []
    await paste(STRATEGY, async (definition) => { saved.push(JSON.parse(JSON.stringify(definition))); return { ok: true } })
    expect(runLane(drawn())).toBe(false)
    await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button')) })
    expect(saved).toHaveLength(0)                      // ⚰️ the host copy was attached here
    expect(screen.getByTestId('pine-member-pane-attach-checking')).toBeTruthy()
    await advance(20000)
    expect(saved).toHaveLength(1)
    expect(saved[0].compute.kind).toBe('runtime')
    expect(settingsOf(saved[0])).toHaveLength(12)
    // what is attached is what is drawn (the registry holds the installed form: `$refs` resolved)
    expect(runLane(drawn())).toBe(true)
    expect(saved[0].inputs.map((i) => i.key)).toEqual(drawn().inputs.map((i) => i.key))
    expect(saved[0].plots.map((pl) => pl.label)).toEqual(drawn().plots.map((pl) => pl.label))
  })

  it('a server that never answers: the Add attaches after the bounded wait, the copy the door mints then (never refused)', async () => {
    server({ never: true })
    const saved = []
    await paste(STRATEGY, async (definition) => { saved.push(definition); return { ok: true } })
    await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button')) })
    await advance(RUNTIME_ADMISSION_ATTACH_WAIT_MS - 1000)
    expect(saved).toHaveLength(0)
    await advance(2000)
    expect(saved).toHaveLength(1)
    expect(saved[0].compute.kind).not.toBe('runtime')
  })

  it('CONTROL: a script whose build asked nothing attaches at once, and nothing is asked', async () => {
    const asked = server({ never: true })
    const saved = []
    await paste(PLAIN, async (definition) => { saved.push(definition); return { ok: true } })
    await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button')) })
    expect(saved).toHaveLength(1)
    expect(asked()).toBe(0)
  })
})

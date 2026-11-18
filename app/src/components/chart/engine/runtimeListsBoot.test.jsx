// app/src/components/chart/engine/runtimeListsBoot.test.jsx
//
// ─── ⭐⭐ THE RUNTIME LISTS REACH A CHART THAT NEVER OPENED THE MEMBER DOOR (2026-11-17) ─────────
//
// ⚰️ MEASURED ON PRODUCTION (engine 68, PINE_RUNTIME_STAGE=all): the lists (kill / allow / capability
// admission / run-half evidence) were latched ONLY by `MemberPane`'s mount read, and the recheck
// returned at once while nothing had been read. A chart reloaded with RS Rating on it, or RS Rating
// added from "Your indicators", made 0 reads in 94 s, its allowlist stayed empty, and its run half —
// the rating label, the new-high / new-low dots — was refused `pane:not-graded` ("hasn't been checked
// against TradingView") for a script the server had graded. Every rail ran under the test grant
// (`__allowEveryRuntimeScriptForTests`), which skips exactly this; THESE run on the REAL allowlist,
// the committed record's hash, served as production serves it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import * as registry from './nativeRegistry'
import {
  RUNTIME_KILL_PATH, RUNTIME_ADMISSION_PATH, runtimeSourceHash, runtimeListsGeneration,
  __resetRuntimeAllowList, __resetRuntimeListsRecheck, __resetRuntimeAdmission, setRuntimeKillList,
  latchRuntimeLists,
} from './runtimeKill'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from './runtimePaneGate'
import { runHalfOf } from './runtime/runtimeObjects'
import { useRuntimeLists } from './useRuntimeLists'

vi.mock('../pane/ChartPane', () => ({ default: () => <div data-testid="mock-chart-pane" /> }))

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const RS_HASH = runtimeSourceHash(RS)
const ALLOWLIST = JSON.parse(fs.readFileSync(path.join(REPO, 'api/data/pine_runtime_allowlist.json'), 'utf8'))
// what production served on 2026-11-17 (`GET /api/user-definitions/runtime-kill`), RS Rating's line
// taken from the COMMITTED record rather than typed here
const SERVED = {
  kill: ['54a46de5f63e6e9652e93054ebceb1784708fed9227eb37339e086a90f369c13'],
  allow: ['d0853c4724651a1d3c63542a2ae767861030137cb1c75ea57a376c53a1630499',
    ALLOWLIST.scripts.find((s) => s.slug === 'rs-rating-fred6724').sha256],
  save_enabled: true,
  capability_admission: true,
}
const okJson = (body) => ({ ok: true, json: async () => body })
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() }
const BARS = Array.from({ length: 400 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 17) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

let fetchMock
const listsReads = () => fetchMock.mock.calls.filter((c) => c[0] === RUNTIME_KILL_PATH)
beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
  __permitRuntimePaneForTests()
  __resetRuntimeAllowList()                 // ⛔ the REAL allowlist: no test grant in this file
  __resetRuntimeAdmission()
  __resetRuntimeListsRecheck()              // a tab that has read nothing yet
  fetchMock = vi.fn(async (url) => (url === RUNTIME_KILL_PATH ? okJson(SERVED)
    : url === RUNTIME_ADMISSION_PATH ? okJson({ sha256: RS_HASH, admitted: false, missing: ['security'] })
      : { ok: false, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
  __resetRuntimePanePermission()
  __resetRuntimeListsRecheck()
  setRuntimeKillList([])
})

const install = (doc) => {
  const { installed, errors } = registry.installUserDefinitions([JSON.parse(JSON.stringify(doc))])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}
const runHalfCode = (def) => {
  const r = runHalfOf(registry.computeFor(def, BARS, undefined, CTX))
  return r ? r.code : null
}
// ⭐ THE SAVED DOCUMENT, AS A RELOADED TAB RECEIVES IT: the door mints the run half only once ITS
// lists have landed (with none it leaves the run half off), and the store keeps that document. So
// it is minted here with the served lists latched, then the tab is put back to "read nothing yet" —
// the state of every chart that opens without the member door.
const mintRS = (id, source = RS) => {
  latchRuntimeLists(SERVED)
  const built = memberPaneDefinition({ source, id, name: 'RS Rating' })
  expect(built.ok, built.reason).toBe(true)
  expect(built.definition.compute.runtimeObjects, 'RS Rating carries a run half').toBeTruthy()
  __resetRuntimeAllowList()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  fetchMock.mockClear()
  return built.definition
}

describe('the committed record IS the script this rail grades', () => {
  it('RS Rating\'s source hashes to the allowlist record\'s sha256 (else this file proves nothing)', () => {
    expect(SERVED.allow).toContain(RS_HASH)
  })
})

describe('⭐⭐ a chart that never opened the member door reads the lists, and RS Rating\'s run half passes', () => {
  it('⛔ CONTROL then FIX: refused `pane:not-graded` while nothing is read; the first consult reads; once it lands, it passes', async () => {
    const def = install(mintRS('u_b00700000001'))
    expect(runHalfCode(def), 'the production picture: nothing read yet').toBe('pane:not-graded')
    expect(listsReads(), 'the first consult must READ the lists').toHaveLength(1)
    await act(async () => { await flush() })
    const code = runHalfCode(def)
    expect(code, 'after the lists landed the run half must pass the pane gates').not.toBe('pane:not-graded')
    expect(String(code)).not.toMatch(/^pane:/)
    expect(listsReads(), 'one read, never one per consult').toHaveLength(1)
  })

  it('⭐ a latch moves the generation, so a chart asks again', async () => {
    const before = runtimeListsGeneration()
    install(mintRS('u_b00700000002'))
    runHalfCode(registry.getDefinition('u_b00700000002'))
    await act(async () => { await flush() })
    expect(runtimeListsGeneration()).toBeGreaterThan(before)
  })

  it('⛔ CONTROL — a script NOT on the allowlist is still refused after the lists land (the gate still bites)', async () => {
    // minted with the test grant (so the door gives it a run half), then served to a tab whose lists
    // are production's: its hash is on no list
    const other = RS.replace("title='RS Rating'", "title='RS Rating copy'")
    const { __allowEveryRuntimeScriptForTests } = await import('./runtimeKill')
    __allowEveryRuntimeScriptForTests()
    const built = memberPaneDefinition({ source: other, id: 'u_b00700000003', name: 'copy' })
    expect(built.ok, built.reason).toBe(true)
    expect(built.definition.compute.runtimeObjects).toBeTruthy()
    __resetRuntimeAllowList()
    __resetRuntimeListsRecheck()
    const def = install(built.definition)
    runHalfCode(def)
    await act(async () => { await flush() })
    expect(runHalfCode(def)).toBe('pane:not-graded')
  })
})

describe('⭐⭐ the chart\'s hook: the first read on mount, and a repaint when it lands', () => {
  let seen = []
  function Probe() { const g = useRuntimeLists(); seen.push(g); return <i>{g}</i> }

  it('⭐ mounting a chart starts the read; its landing changes the generation', async () => {
    seen = []
    render(<Probe />)
    expect(listsReads(), 'a mounted chart reads the lists').toHaveLength(1)
    const first = seen[seen.length - 1]
    await act(async () => { await flush() })
    expect(seen[seen.length - 1], 'the lists landed and the chart was not told').not.toBe(first)
  })

  it('⛔ not for a member the runtime pane is off for (the lists are that lane\'s)', () => {
    __resetRuntimePanePermission()
    render(<Probe />)
    expect(listsReads()).toHaveLength(0)
  })

  it('⛔ and it lets go: no listener survives its chart', async () => {
    seen = []
    const { unmount } = render(<Probe />)
    await act(async () => { await flush() })
    const settled = seen.length
    unmount()
    __resetRuntimeListsRecheck()
    // a later latch reaches no unmounted chart
    act(() => latchRuntimeLists(SERVED))
    expect(seen.length).toBe(settled)
  })
})

describe('⭐⭐ attach-after-latch, through the real member door (the run that still read "not graded")', () => {
  it('the document the door hands `onAttach`, installed as the chart installs it, passes the pane gates', async () => {
    const { default: MemberPane } = await import('../builder/memberPane/MemberPane.jsx')
    const saved = []
    const onAttach = async (definition) => { saved.push(JSON.parse(JSON.stringify(definition))); return { ok: true } }
    const view = render(<MemberPane sym="DELL" tf="D" source={RS} onAttach={onAttach} />)
    await act(async () => { await flush() })
    expect(listsReads().length, 'the door reads the lists on mount').toBeGreaterThanOrEqual(1)
    const door = view.getByTestId('pine-member-pane-attach')
    await act(async () => { fireEvent.click(door.querySelector('button')); await flush() })
    expect(saved, 'the door handed nothing to onAttach').toHaveLength(1)
    const def = install(saved[0])
    expect(runHalfCode(def)).not.toBe('pane:not-graded')
  })
})

describe('⛔ StockChart is wired to it (code, never a comment)', () => {
  const code = fs.readFileSync(path.join(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')
  it('the hook is called and its generation joins updateChart\'s dependency array beside the server lane\'s', () => {
    expect(code).toContain('const runtimeListsGeneration = useRuntimeLists()')
    expect(code).toContain('secondarySources, serverColumnsGeneration, runtimeListsGeneration,')
  })
  it('⭐ CONTROL — the comment-stripped source still holds the sibling it mirrors', () => {
    expect(code).toContain('const serverColumnsGeneration = useServerColumns()')
  })
})

// ─── ⭐⭐ THE OWN-DAILY QUESTION, OFF THE CHART'S MAIN THREAD (switch smoothness, 2026-11-20) ─────────────────────
//
// MEASURED (patrick-54's trace of RDDT 1D -> 5m with Fred RS, a production build of fcbb91a97f with hidden maps): the
// switch's worst values task (207 ms, 99 ms of values) was `useSecondarySources` asking `runtimeReadsOwnDaily(RS, '5',
// RDDT)`, which builds the script's runtime program on the click: 74 ms (51 ms on the 28k-row path). `ownDailyAsync.js`
// asks it in a worker instead. These rails hold:
//   A. ⛔ ONE ANSWER: the REAL worker module (`runtimeWorker.js`, a message of kind `OWN_DAILY_ASK`) answers every
//      question exactly as the chart's thread does, the symbol's classification included (a script that branches on
//      `syminfo.sector` answers differently with and without it, so a message that dropped a field would show);
//   B. the door asks the worker and builds NOTHING on the chart's thread; not answered yet reads NEEDED; the answer
//      lands in the chart thread's own memo;
//   C. with no worker, for a script that imports a library, and after a worker failure: answered on the chart's
//      thread, as before;
//   D. the chart's hook: on a 5m switch it asks for this symbol's daily rows on the click exactly when the synchronous
//      path does, and a NO, when it lands, takes the key away (the same set the synchronous path settles on).
/* global process */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import {
  runtimeReadsOwnDaily, runtimeOwnDailyQuestion, runtimeOwnDailyKnown, __resetOwnDailyMemoForTests,
} from '../runtimeColumns'
import {
  runtimeReadsOwnDailyOffThread, setOwnDailyWorkerFactory, resetOwnDailyAsync, onOwnDailyAnswer, ownDailyAskStats,
} from '../ownDailyAsync'
import { OWN_DAILY_ASK } from '../ownDailyProbe'
import { useSecondarySources, ownDailyNeeded } from '../../useSecondarySources'
import { OWN_DAILY_KEY } from '../../otherSymbols'
import { clearSecondaryBars } from '../../secondaryBars'

vi.setConfig({ testTimeout: 300000 })

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information',
  sector: 'Communication Services', securityType: 'Stock' })
const RDDT_BARE = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })
const pine = (lines) => ['//@version=5', 'indicator("t", overlay = false)', ...lines].join('\n')
// reads NO own daily row and branches on `syminfo.sector`: refused (NEEDED) without it, NO with it
const SECTOR_BRANCH = pine(['x = 1.0', "if (syminfo.sector == 'Technology')", '    x := 2.0', 'plot(x)'])
const OWN = pine(['plot(request.security(syminfo.tickerid, "D", close))'])
const PLAIN = pine(['plot(close)'])
const LIBRARY = ['//@version=5', 'indicator("lib user")', 'import someone/SomeLib/1 as lib', 'plot(close)'].join('\n')

// ── the REAL worker module, run on this thread a task later (a structured clone each way, as a worker's messages are)
const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
let workerLoaded = false
async function loadWorker() {
  vi.stubGlobal('self', SELF)
  if (!workerLoaded) { await import('../runtimeWorker.js'); workerLoaded = true }
}
/** What the worker module answers for one message, synchronously (rail A). */
function workerAnswer(msg) {
  SELF.out.length = 0
  SELF.onmessage({ data: structuredClone(msg) })
  return structuredClone(SELF.out[0])
}
/** A Worker-like stand-in over the real module: every message answered one task later. */
function standIn() {
  const posted = []
  const made = []
  const factory = () => {
    const w = {
      terminated: false,
      postMessage(msg) {
        posted.push(structuredClone(msg))
        setTimeout(() => { if (!w.terminated && w.onmessage) w.onmessage({ data: workerAnswer(msg) }) }, 0)
      },
      terminate() { w.terminated = true },
    }
    made.push(w)
    return w
  }
  return { factory, posted, made }
}
const answerFor = (src, tf, sym) => new Promise((resolve) => {
  const q = runtimeOwnDailyQuestion(src, tf, sym)
  const off = onOwnDailyAnswer((k, yes) => { if (k === q.key) { off(); resolve(yes) } })
})

beforeEach(async () => {
  await loadWorker()
  __resetOwnDailyMemoForTests()
  resetOwnDailyAsync()
})
afterEach(() => {
  resetOwnDailyAsync()
  __resetOwnDailyMemoForTests()
  clearSecondaryBars()
  vi.unstubAllGlobals()
})

describe('A. ⛔ one answer: the real worker module answers every question as the chart\'s thread does', () => {
  it('Fred RS on every timeframe and binding, and the four controls, field for field', () => {
    const cases = []
    for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M']) for (const sym of [RDDT, RDDT_BARE, null]) cases.push([RS, tf, sym])
    cases.push([SECTOR_BRANCH, '5', RDDT_BARE], [SECTOR_BRANCH, '5', { ...RDDT_BARE, sector: 'Communication Services' }],
      [SECTOR_BRANCH, '30', RDDT], [OWN, '5', RDDT], [OWN, '60', RDDT_BARE], [OWN, 'D', RDDT], [PLAIN, '5', RDDT])
    const seen = { yes: 0, no: 0, asked: 0 }
    for (const [src, tf, sym] of cases) {
      __resetOwnDailyMemoForTests()
      const here = runtimeReadsOwnDaily(src, tf, sym)
      __resetOwnDailyMemoForTests()
      const q = runtimeOwnDailyQuestion(src, tf, sym)
      if (!q) { expect(here, `${tf}: a timeframe the question is not asked on answers no`).toBe(false); continue }
      // the message the door posts (`ownDailyAsync.runtimeReadsOwnDailyOffThread`), field for field
      const reply = workerAnswer({ kind: OWN_DAILY_ASK, id: 7, source: src, tf: q.tf, symbol: q.symbol })
      expect(reply, `${tf} ${JSON.stringify(sym)}`).toEqual({ id: 7, kind: OWN_DAILY_ASK, ownDaily: here })
      seen.asked += 1
      seen[here ? 'yes' : 'no'] += 1
    }
    // non-vacuity: both answers occur among the questions the worker was asked, and the classification decided one
    expect(seen.yes).toBeGreaterThan(0)
    expect(seen.no).toBeGreaterThan(0)
    __resetOwnDailyMemoForTests()
    expect(runtimeReadsOwnDaily(SECTOR_BRANCH, '5', RDDT_BARE)).toBe(true)
    __resetOwnDailyMemoForTests()
    expect(runtimeReadsOwnDaily(SECTOR_BRANCH, '5', { ...RDDT_BARE, sector: 'Communication Services' })).toBe(false)
  })
})

describe('B. the door asks the worker and builds nothing on the chart\'s thread', () => {
  it('not answered yet reads NEEDED (null); the worker\'s answer lands in the chart thread\'s memo', async () => {
    const w = standIn()
    setOwnDailyWorkerFactory(w.factory)
    const q = runtimeOwnDailyQuestion(RS, '5', RDDT)
    const landed = answerFor(RS, '5', RDDT)
    expect(runtimeReadsOwnDailyOffThread(RS, '5', RDDT)).toBeNull()
    // ⛔ nothing was built here: the memo does not know it yet, and the door computed nothing on this thread
    expect(runtimeOwnDailyKnown(q.key)).toBeUndefined()
    expect(ownDailyAskStats()).toMatchObject({ asked: 1, here: 0, answered: 0 })
    expect(w.posted).toEqual([{ kind: OWN_DAILY_ASK, id: w.posted[0].id, source: RS, tf: '5', symbol: q.symbol }])
    // asked again before it lands: still waiting, not posted twice
    expect(runtimeReadsOwnDailyOffThread(RS, '5', RDDT)).toBeNull()
    expect(w.posted.length).toBe(1)
    expect(await landed).toBe(true)
    expect(runtimeOwnDailyKnown(q.key)).toBe(true)
    expect(runtimeReadsOwnDailyOffThread(RS, '5', RDDT)).toBe(true)
    expect(w.posted.length, 'a known answer is never asked again').toBe(1)
    // a daily chart is no without a question (the predicate's own gate)
    expect(runtimeReadsOwnDailyOffThread(RS, 'D', RDDT)).toBe(false)
    expect(w.posted.length).toBe(1)
  })

  it('a NO lands as a no', async () => {
    const w = standIn()
    setOwnDailyWorkerFactory(w.factory)
    const sym = { ...RDDT_BARE, sector: 'Communication Services' }
    const landed = answerFor(SECTOR_BRANCH, '5', sym)
    expect(runtimeReadsOwnDailyOffThread(SECTOR_BRANCH, '5', sym)).toBeNull()
    expect(await landed).toBe(false)
    expect(runtimeReadsOwnDailyOffThread(SECTOR_BRANCH, '5', sym)).toBe(false)
  })
})

describe('C. answered on the chart\'s thread, as before', () => {
  it('with no worker (a host without one): the synchronous answer, at once', () => {
    expect(typeof Worker).toBe('undefined')
    expect(runtimeReadsOwnDailyOffThread(RS, '5', RDDT)).toBe(true)
    expect(ownDailyAskStats()).toMatchObject({ asked: 0, here: 1 })
  })
  it('a script that imports a library (the registry is this thread\'s): here, even with a worker', () => {
    const w = standIn()
    setOwnDailyWorkerFactory(w.factory)
    __resetOwnDailyMemoForTests()
    const here = runtimeReadsOwnDaily(LIBRARY, '5', RDDT)
    __resetOwnDailyMemoForTests()
    expect(runtimeReadsOwnDailyOffThread(LIBRARY, '5', RDDT)).toBe(here)
    expect(w.posted.length).toBe(0)
  })
  it('a worker that cannot start, or crashes, leaves the tab answering here (waiting questions answered too)', async () => {
    setOwnDailyWorkerFactory(() => { throw new Error('no worker') })
    expect(runtimeReadsOwnDailyOffThread(RS, '5', RDDT)).toBe(true)
    expect(ownDailyAskStats().broken).toBe(true)
    resetOwnDailyAsync()
    __resetOwnDailyMemoForTests()
    const crashing = { postMessage() {}, terminate() {} }
    setOwnDailyWorkerFactory(() => crashing)
    const landed = answerFor(RS, '15', RDDT)
    expect(runtimeReadsOwnDailyOffThread(RS, '15', RDDT)).toBeNull()
    crashing.onerror()
    expect(await landed).toBe(true)
    expect(ownDailyAskStats()).toMatchObject({ broken: true, here: 1, waiting: 0 })
    expect(runtimeReadsOwnDailyOffThread(RS, '30', RDDT)).toBe(true)   // here from now on
  })
})

describe('D. the chart\'s hook settles on the set the synchronous path does', () => {
  const instances = () => [{ instanceId: 'i1', defId: 'd1' }]
  const fetcher = async () => ({ bars: [] })
  const hookFor = (src, sym) => {
    const def = { id: 'd1', compute: { kind: 'runtime', source: src } }
    const defOf = (id) => (id === 'd1' ? def : null)
    return renderHook(() => useSecondarySources(instances, defOf, '5', 600, fetcher, 0, null, 'RDDT', sym))
  }
  const keysOf = (map) => (map ? [...map.keys()] : [])

  it('Fred RS: the daily rows are asked for on the click, as the synchronous path asks for them', async () => {
    const sync = ownDailyNeeded(instances(), () => ({ compute: { kind: 'runtime', source: RS } }), '5', RDDT)
    expect(sync).toBe(true)
    __resetOwnDailyMemoForTests()
    const w = standIn()
    setOwnDailyWorkerFactory(w.factory)
    const { result } = hookFor(RS, RDDT)
    expect(keysOf(result.current)).toEqual([OWN_DAILY_KEY])
    expect(w.posted.length).toBe(1)
    await waitFor(() => expect(ownDailyAskStats().answered).toBe(1))
    expect(keysOf(result.current)).toEqual([OWN_DAILY_KEY])
  })

  it('a run that reads no daily row: asked for while unknown (NEEDED), dropped when the NO lands; synchronous: never', async () => {
    const sym = { ...RDDT_BARE, sector: 'Communication Services' }
    const sync = hookFor(SECTOR_BRANCH, sym)
    expect(keysOf(sync.result.current), 'the synchronous path').toEqual([])
    sync.unmount()
    __resetOwnDailyMemoForTests()
    clearSecondaryBars()
    const w = standIn()
    setOwnDailyWorkerFactory(w.factory)
    const { result } = hookFor(SECTOR_BRANCH, sym)
    expect(keysOf(result.current), 'not answered yet reads NEEDED').toEqual([OWN_DAILY_KEY])
    await waitFor(() => expect(keysOf(result.current)).toEqual([]))
    expect(w.posted.length).toBe(1)
  })
})

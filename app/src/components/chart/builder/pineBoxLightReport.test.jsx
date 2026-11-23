// app/src/components/chart/builder/pineBoxLightReport.test.jsx
//
// ─── ⭐⭐ THE PASTE WORKER — WHAT A MEMBER'S USE HANDS THE SHEET IS THE SAME, WHEREVER THE REPORT WAS MADE ─────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. A report from the report's worker crosses LIGHT
// (`inspectView.reportForPage`: no trees, no object program; the placements, numeric columns and verdict derived in
// the worker), and Use asks the worker for the program (`inspectAsync.askHeldObjects`). This renders the REAL PasteBox
// twice per script, once with no workers (the report made on this thread, full, as before) and once with stand-in
// workers running the REAL handler in a fresh module graph, presses Use in each, and compares what `onPick` was handed,
// field for field (non-enumerable properties included). And when the worker that kept the report has gone, the program
// is made again in the next worker, never on this thread.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

const D = vi.hoisted(() => ({ inWorker: false, iMain: 0, iWorker: 0, yMain: 0, yWorker: 0, vMain: 0, vWorker: 0 }))
// ⭐ what the light report derives in the worker, counted by where it ran: the numeric-column parse and the verdict
vi.mock('./toCondition', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, yieldsCondition: (...a) => { if (D.inWorker) D.yWorker += 1; else D.yMain += 1; return m.yieldsCondition(...a) } }
})
vi.mock('../engine/ast/importVerdict', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, importVerdict: (...a) => { if (D.inWorker) D.vWorker += 1; else D.vMain += 1; return m.importVerdict(...a) } }
})
vi.mock('./inspectSource', async (importOriginal) => {
  const m = await importOriginal()
  const counted = (fn) => (...args) => {
    if (D.inWorker) D.iWorker += 1
    else D.iMain += 1
    return fn(...args)
  }
  return { ...m, inspectSource: counted(m.inspectSource), inspectPine: counted(m.inspectPine) }
})

import PineBox, { ImportBox } from './PineBox'
import { INSPECT_WORKER_JOB, INSPECT_LIBRARY_WORKER_JOB, __setInspectServicesForTests, hubMessageForTests } from './inspectAsync'
import { createKeyedWorkerService } from './memberPane/memberDoorAsync'
import { FakeDoorWorker, importWorkerCore, canonOf } from '../../../testing/builder/memberDoor.testkit.js'

const REPO = path.resolve(__dirname, '../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const member = (n) => fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')

/** Object programs (boxes, lines, labels), several outputs, inputs placed in trees, a numeric column. */
const SCRIPTS = {
  atrLevels: corpus('atr-support-and-resistance__3e9ddb38c4.pine'),
  pivotConnector: corpus('extrapolated-pivot-connector__vROeQSQlNs.pine'),
  breaksRetests: corpus('breaks-and-retests-hg__ddba061af8.pine'),
  adx: corpus('adx-and-di-for-v4__932.pine'),
  twinRange: corpus('twin-range-filter__xF3L2PeXm7.pine'),
  clouds: member('uncharted-clouds.pine'),
}

class CountingWorker extends FakeDoorWorker {
  answer(job) {
    D.inWorker = true
    try { super.answer(job) } finally { D.inWorker = false }
  }
  inWorker(fn) {
    D.inWorker = true
    try { return fn() } finally { D.inWorker = false }
  }
}

// ⭐ each worker a stand-in starts is its OWN fresh module graph, as a real worker is: a respawned worker holds none of
// the reports the one before it kept (the first worker of every case is `cores[0]`; a case's respawn its own spare)
let cores = []
beforeAll(async () => { for (let i = 0; i < 3; i += 1) cores.push(await importWorkerCore(vi)) }, 120000)
let made = []
let reports = null
function withWorkers(spare = 1) {
  made = []
  reports = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, onMessage: hubMessageForTests,
    factory: () => { const w = new CountingWorker(made.length ? cores[spare] : cores[0]); made.push(w); return w } })
  const library = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, factory: () => new CountingWorker(cores[0]) })
  __setInspectServicesForTests({ inspect: reports, library })
}
function noWorkers() {
  const here = { factory: null }
  __setInspectServicesForTests({ inspect: createKeyedWorkerService({ job: INSPECT_WORKER_JOB, ...here }),
    library: createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, ...here }) })
}
afterEach(() => { cleanup(); __setInspectServicesForTests({}) })

const area = () => screen.getByLabelText(/^(pine script|script or formula)$/i)
async function pickOf(source, { kill = false, killAfterAsk = false, auto = false } = {}) {
  const onPick = vi.fn()
  const start = { ...D }
  render(auto ? <ImportBox onPick={onPick} /> : <PineBox onPick={onPick} />)
  fireEvent.change(area(), { target: { value: source } })
  const btn = await screen.findByRole('button', { name: /use this formula/i }, { timeout: 60000 })
  const outcome = await screen.findByTestId('import-outcome', {}, { timeout: 60000 })
  const verdict = outcome.getAttribute('data-outcome')
  const numeric = !!screen.queryByTestId('pine-screen-value')
  // a script this box offers no column of: nothing to press, in either place (compared by the caller)
  const derivedMain = () => ({ y: D.yMain - start.yMain, v: D.vMain - start.vMain })
  if (btn.disabled) { const d = derivedMain(); cleanup(); return { handed: undefined, usable: false, verdict, numeric, mainDuringUse: 0, derived: d } }
  // ⭐ the worker that kept the report stops before the Use (a newer text stopped it, it died): the next one remakes it
  if (kill && made.length) await act(async () => { made[made.length - 1].onerror({ message: 'gone', preventDefault() {} }) })
  const before = { ...D }
  fireEvent.click(btn)
  // ⭐ the worker dies after the Use asked, before it answered: the question is asked of a new one
  if (killAfterAsk) made[made.length - 1].onerror({ message: 'gone', preventDefault() {} })
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1), { timeout: 60000 })
  const derived = derivedMain()
  cleanup()
  return { handed: onPick.mock.calls[0][0], usable: true, verdict, numeric, mainDuringUse: D.iMain - before.iMain,
    workerDuringUse: D.iWorker - before.iWorker, derived }
}

describe('⭐⭐ a Use hands the sheet the same pick, from a light report and the worker\'s program, as from a full report', () => {
  it('every script: the pick off the main thread is the pick on it, field for field', async () => {
    const vs = (v) => canonOf(v, { hidden: true })
    let withProgram = 0
    let withPlacements = 0
    let numericSeen = 0
    for (const [name, source] of Object.entries(SCRIPTS)) {
      noWorkers()
      const here = await pickOf(source)
      withWorkers()
      const off = await pickOf(source)
      expect(made.length, `${name}: the report was made in a worker`).toBeGreaterThan(0)
      expect(off.mainDuringUse, `${name}: no report made on the main thread for the Use`).toBe(0)
      expect(off.verdict, `${name}: the verdict, as on the main thread`).toBe(here.verdict)
      expect(off.usable, `${name}: a column to use, as on the main thread`).toBe(here.usable)
      expect(off.numeric, `${name}: the numeric-column field, as on the main thread`).toBe(here.numeric)
      expect(off.derived.y, `${name}: no column parsed on the main thread (the worker said which are numbers)`).toBe(0)
      expect(vs(off.handed), `${name}: the pick is the main thread's`).toBe(vs(here.handed))
      if (here.handed && here.handed.objects) withProgram += 1
      if (here.handed && (here.handed.outputs || []).some((o) => o.paramLocators && o.paramLocators.length)) withPlacements += 1
      if (here.numeric) numericSeen += 1
    }
    // ⛔ THE CONTROLS: the picks carry what the light report left in the worker (a program; placements found in trees)
    expect(withProgram, 'a pick with an object program').toBeGreaterThan(0)
    expect(withPlacements, 'a pick with input placements').toBeGreaterThan(0)
    expect(numericSeen, 'a numeric column offered').toBeGreaterThan(0)
  }, 600000)

  it("⭐ a thinkScript paste: the verdict is the worker's, as the main thread's, and nothing derived on the main thread", async () => {
    let seenHere = 0
    for (const source of ['plot x = close > Average(close, 20);', 'def a = Average(close, 10);\nplot b = a - Average(close, 30);']) {
      noWorkers()
      const here = await pickOf(source, { auto: true })
      seenHere += here.derived.v
      withWorkers()
      const off = await pickOf(source, { auto: true })
      expect(off.verdict, source).toBe(here.verdict)
      expect(off.usable).toBe(here.usable)
      expect(off.numeric).toBe(here.numeric)
      expect(canonOf(off.handed, { hidden: true })).toBe(canonOf(here.handed, { hidden: true }))
      expect(off.derived, `${source}: no verdict, no column parse on the main thread`).toEqual({ y: 0, v: 0 })
    }
    // ⛔ THE CONTROL: on the main thread, the verdict is computed there (the counter can see it)
    expect(seenHere).toBeGreaterThan(0)
  }, 300000)

  it('⭐ the worker that kept the report has gone: the program is made again in the next worker, never here', async () => {
    const source = SCRIPTS.pivotConnector
    noWorkers()
    const here = await pickOf(source)
    expect(here.handed && here.handed.objects, 'the script has a program').toBeTruthy()
    withWorkers()
    const off = await pickOf(source, { kill: true })
    expect(made.length, 'a second worker answered the Use').toBe(2)
    expect(off.mainDuringUse, 'no report made on the main thread for the Use').toBe(0)
    expect(off.workerDuringUse, 'the new worker made the report again').toBe(1)
    expect(canonOf(off.handed, { hidden: true })).toBe(canonOf(here.handed, { hidden: true }))
    // and the worker dies after the Use asked, before it answered
    withWorkers(2)
    const late = await pickOf(source, { killAfterAsk: true })
    expect(made.length, 'a second worker answered the Use').toBe(2)
    expect(late.mainDuringUse).toBe(0)
    expect(late.workerDuringUse, 'the new worker made the report again').toBe(1)
    expect(canonOf(late.handed, { hidden: true })).toBe(canonOf(here.handed, { hidden: true }))
  }, 300000)
})

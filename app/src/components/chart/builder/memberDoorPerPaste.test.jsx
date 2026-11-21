// app/src/components/chart/builder/memberDoorPerPaste.test.jsx
//
// ─── ⭐⭐ THE PASTE WORKER — A PASTE COSTS ONE DOOR CALL, AND NONE OF IT ON THE MAIN THREAD ─────────────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. Production builds the member pane and the editor's status
// panel (`VITE_PINE_EDITOR_STATUS=1`) and, before this, a paste ran the member door TWICE on the page's main
// thread: `MemberPane` (a `useMemo`) and `PineEditorStatus::usePineEditorStatus` (`paneFor`, another `useMemo`),
// each for seconds to minutes on a slow script. Now both read the page's ONE shared build, in a worker.
//
// Through the REAL sheet (`BuilderSheet`, both flags on, a real paste into the Import box): every call of
// `memberPaneDefinition`, of PasteBox's report (`inspectSource` / `inspectPine`) and of `translatePine` is counted, by
// where it ran. A paste makes exactly ONE door build and ONE report, each in a worker (two workers, at once), and
// NOTHING on the main thread: no door call, no report, no translation. The pane draws the door's answer, PasteBox
// shows the report and the status panel reads both.
// ⭐ And the pane's own states: while a build runs it says so and keeps the picture it drew, and its Add waits.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

const D = vi.hoisted(() => ({ main: 0, worker: 0, inWorker: false, tMain: 0, tWorker: 0, iMain: 0, iWorker: 0, sMain: 0, sWorker: 0 }))
vi.mock('./editorStatus', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    editorStatus: (...args) => {
      if (D.inWorker) D.sWorker += 1
      else D.sMain += 1
      return m.editorStatus(...args)
    },
  }
})
vi.mock('../engine/ast/pine', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    translatePine: (...args) => {
      if (D.inWorker) D.tWorker += 1
      else D.tMain += 1
      return m.translatePine(...args)
    },
  }
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
vi.mock('./memberPane/memberPaneDefinition', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    memberPaneDefinition: (...args) => {
      if (D.inWorker) D.worker += 1
      else D.main += 1
      return m.memberPaneDefinition(...args)
    },
  }
})

import BuilderSheet from './BuilderSheet'
import MemberPane from './memberPane/MemberPane'
import { writeMyself, openSource } from '../../../testing/builder/builderStart.testkit.js'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { CHECKING_TEXT } from './PineEditorStatus'
import { AuthContext } from '../../../context/AuthContext'
import { createMemberDoorService, createKeyedWorkerService, __setMemberDoorServiceForTests } from './memberPane/memberDoorAsync'
import { INSPECT_WORKER_JOB, INSPECT_LIBRARY_WORKER_JOB, STATUS_WORKER_JOB, __setInspectServicesForTests } from './inspectAsync'
import { memberDoorStateVersion } from './memberPane/memberDoorImage'
import { FakeDoorWorker, importWorkerCore } from '../../../testing/builder/memberDoor.testkit.js'
import * as engineRegistry from '../engine/nativeRegistry'
import { MEMBER_PANE_DEF_PREFIX } from './memberPane/memberPaneDefinition'

const REPO = path.resolve(__dirname, '../../../../..')
const fixture = (n) => fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')
const CLOUDS = fixture('uncharted-clouds.pine')
const VOLUME2 = fixture('uncharted-volume-v2.pine')

/** A stand-in worker that counts the door calls it makes as the WORKER's. */
class CountingWorker extends FakeDoorWorker {
  answer(job) {
    D.inWorker = true
    try { super.answer(job) } finally { D.inWorker = false }
  }
}
// ⭐ the stand-in worker runs the REAL handler in a FRESH module graph, as a real worker is its own graph: the page's
// state reaches it only through the job's image (in this graph, applying an image would also move the page's state)
let core = null
beforeAll(async () => {
  core = await importWorkerCore(vi)
}, 120000)
let made = []
let svc = null
let reports = null
let statuses = null
let madeReports = []
let versions = []
function useService(mode = 'answer') {
  made = []
  madeReports = []
  versions = []
  svc = createMemberDoorService({
    factory: () => { const w = new CountingWorker(core, { mode }); made.push(w); return w },
    version: () => { const v = memberDoorStateVersion(); versions.push(v); return v },
  })
  __setMemberDoorServiceForTests(svc)
  // ⭐ PasteBox's report on its OWN stand-in worker (always answering: the door's mode is what the rails hold)
  reports = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, factory: () => { const w = new CountingWorker(core); madeReports.push(w); return w } })
  const library = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB, factory: () => new CountingWorker(core) })
  statuses = createKeyedWorkerService({ job: STATUS_WORKER_JOB, factory: () => new CountingWorker(core) })
  __setInspectServicesForTests({ inspect: reports, library, status: statuses })
}
/** What the service was asked, for a failure's message: each job's script (length) and the state versions. */
const asked = () => JSON.stringify({ jobs: made.map((w) => w.jobs.map((j) => `${j.args.id}:${j.args.source.length}`)), versions, stats: svc && svc.stats() })

function stubFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    if ((init.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}
const flush = async () => {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
}

beforeEach(() => {
  D.main = 0; D.worker = 0; D.inWorker = false; D.tMain = 0; D.tWorker = 0; D.iMain = 0; D.iWorker = 0; D.sMain = 0; D.sWorker = 0
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
  vi.useFakeTimers()
  stubFetch()
})
afterEach(() => {
  cleanup()
  __setMemberDoorServiceForTests(null)
  __setInspectServicesForTests({})
  engineRegistry.uninstallUserDefinition(MEMBER_PANE_DEF_PREFIX)
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

function mountSheet() {
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} sym="SPY" tf="D" />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  writeMyself()
}
async function paste(script) {
  openSource('pine')
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: script } })
  await flush()
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush(); await flush()
}

describe('⭐⭐ a paste costs ONE door build and ONE report, each in a worker, and nothing on the main thread', () => {
  it('Clouds pasted into the real sheet: one door build, one report, zero main-thread translations; all read them', async () => {
    useService()
    mountSheet()
    const before = { ...D }
    await paste(CLOUDS)
    expect(D.main - before.main, 'door calls on the MAIN thread during the paste').toBe(0)
    expect(D.worker - before.worker, `door calls in the worker during the paste ${asked()}`).toBe(1)
    expect(svc.stats().posted, 'door jobs posted to a worker').toBe(1)
    expect(D.iMain - before.iMain, 'PasteBox reports computed on the MAIN thread').toBe(0)
    expect(D.iWorker - before.iWorker, 'PasteBox reports computed in a worker').toBe(1)
    expect(reports.stats().posted, 'report jobs posted to a worker').toBe(1)
    expect(D.tMain - before.tMain, 'translatePine calls on the MAIN thread during the paste').toBe(0)
    expect(D.sMain - before.sMain, 'editor statuses computed on the MAIN thread').toBe(0)
    expect(D.sWorker - before.sWorker, 'editor statuses computed in a worker (the report alone, then with the door answer)').toBeGreaterThan(0)
    expect(D.tWorker - before.tWorker, 'translatePine calls in the workers (the report and the door)').toBeGreaterThan(1)
    expect(madeReports.length, 'the report has its own worker').toBe(1)
    expect(made.length, 'the door has its own worker').toBe(1)
    expect(madeReports[0]).not.toBe(made[0])
    // PasteBox shows the report: its read of the script (the language it found) is on screen
    expect(screen.getByTestId('pine-meta').getAttribute('data-dialect'), 'PasteBox shows the report that landed').toBe('pine')
    // the pane drew the answer, and the status panel is no longer checking: it read the same build
    expect(screen.queryByTestId('pine-member-pane') || screen.queryByTestId('pine-member-pane-refusal')).toBeTruthy()
    expect(screen.queryByTestId('pine-member-pane-building')).toBe(null)
    const headline = screen.getByTestId('pine-status-headline').textContent
    expect(headline).not.toBe(CHECKING_TEXT)
  }, 120000)
})

describe('⭐ the pane while a build runs: it says so, keeps its picture, and its Add waits', () => {
  it('the first build: "checking", then the pane; a newer text: the old pane stays, Add disabled, then the new one', async () => {
    useService('hold')
    const onAttach = vi.fn(async () => ({ ok: true }))
    const wrap = (src) => (
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <MemberPane sym="SPY" tf="D" source={src} onAttach={onAttach} />
        </SWRConfig>
      </AuthContext.Provider>
    )
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map((x) => String((x && x.stack) || x)).join(' ').slice(0, 400)) })
    const view = render(wrap(VOLUME2))
    await flush()
    const building = screen.queryByTestId('pine-member-pane-building')
    expect(building, `the first build says it is checking: ${JSON.stringify({ html: document.body.innerHTML.slice(0, 500), errors: errors.slice(0, 3), asked: JSON.parse(asked()) })}`).toBeTruthy()
    expect(building.textContent).toBe(CHECKING_TEXT)
    expect(screen.queryByTestId('pine-member-pane')).toBe(null)
    await act(async () => { made[made.length - 1].release() })
    await flush()
    expect(screen.queryByTestId('pine-member-pane-building')).toBe(null)
    expect(screen.getByTestId('pine-member-pane')).toBeTruthy()
    view.rerender(wrap(`${VOLUME2}\n// edited`))
    await flush()
    expect(screen.getByTestId('pine-member-pane-building')).toBeTruthy()
    expect(screen.getByTestId('pine-member-pane'), 'the picture it drew stays while the newer one builds').toBeTruthy()
    const add = screen.getByTestId('pine-member-pane-attach').querySelector('button')
    expect(add.disabled, 'an Add now would attach the OLD text\'s picture').toBe(true)
    await act(async () => { made[made.length - 1].release() })
    await flush()
    expect(screen.queryByTestId('pine-member-pane-building')).toBe(null)
    expect(screen.getByTestId('pine-member-pane-attach').querySelector('button').disabled).toBe(false)
    // ⛔ the old text is nobody's now: it is never built again, and nothing of it reaches the pane
    await act(async () => { for (const w of made) w.release() })
    await flush()
    expect(svc.stats().posted, 'two builds: the first text, then the edited one').toBe(2)
    expect(screen.queryByTestId('pine-member-pane-building')).toBe(null)
  }, 120000)
})

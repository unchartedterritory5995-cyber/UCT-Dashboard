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
// `memberPaneDefinition` is counted, by where it ran. A paste makes exactly ONE, in the worker, and NONE on the main
// thread; the pane draws its answer and the status panel reads the same one.
// ⭐ And the pane's own states: while a build runs it says so and keeps the picture it drew, and its Add waits.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

const D = vi.hoisted(() => ({ main: 0, worker: 0, inWorker: false }))
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
import { createMemberDoorService, __setMemberDoorServiceForTests } from './memberPane/memberDoorAsync'
import { memberDoorStateVersion } from './memberPane/memberDoorImage'
import * as core from './memberPane/memberDoorWorkerCore'
import { FakeDoorWorker } from '../../../testing/builder/memberDoor.testkit.js'
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
let made = []
let svc = null
let versions = []
function useService(mode = 'answer') {
  made = []
  versions = []
  svc = createMemberDoorService({
    factory: () => { const w = new CountingWorker(core, { mode }); made.push(w); return w },
    version: () => { const v = memberDoorStateVersion(); versions.push(v); return v },
  })
  __setMemberDoorServiceForTests(svc)
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
  D.main = 0; D.worker = 0; D.inWorker = false
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
  vi.useFakeTimers()
  stubFetch()
})
afterEach(() => {
  cleanup()
  __setMemberDoorServiceForTests(null)
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

describe('⭐⭐ a paste costs ONE door call, in the worker, and none on the main thread', () => {
  it('Clouds pasted into the real sheet: one worker door call, zero main-thread ones; the pane and the status read it', async () => {
    useService()
    mountSheet()
    const before = { main: D.main, worker: D.worker }
    await paste(CLOUDS)
    expect(D.main - before.main, 'door calls on the MAIN thread during the paste').toBe(0)
    expect(D.worker - before.worker, `door calls in the worker during the paste ${asked()}`).toBe(1)
    expect(svc.stats().posted, 'jobs posted to a worker').toBe(1)
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
    const view = render(wrap(VOLUME2))
    await flush()
    expect(screen.getByTestId('pine-member-pane-building').textContent).toBe(CHECKING_TEXT)
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

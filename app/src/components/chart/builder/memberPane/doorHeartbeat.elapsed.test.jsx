// app/src/components/chart/builder/memberPane/doorHeartbeat.elapsed.test.jsx
//
// ─── ⭐⭐ e96 — "CHECKING YOUR SCRIPT... 0:42": A RUNNING CHECK SAYS FOR HOW LONG (coordinator ruling 2026-11-23) ─────────
//
// Real scripts take minutes in the member door's worker, so while a build runs every "checking" surface says it is still
// working AND how long it has run, kept current: the member pane's building line (the page's shared build, its start
// from the service, `memberDoorAsync.js::sinceOf`) and the editor status panel's headline (the chart door's build and
// PasteBox's report). Fake interval timers and a fake Date; every other timer is real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../../../hooks/useBreakpoint', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useIsTouch: () => false }
})
vi.mock('../../supportLoop/supportApi', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    logImportGaps: () => true,
    reportsConfig: () => Promise.resolve({ reportsEnabled: false, maxSourceBytes: 131072, maxNoteChars: 1000 }),
  }
})

import MemberPane from './MemberPane'
import PineEditorStatus, { paneFor, CHECKING_TEXT, checkingText, elapsedClock } from '../PineEditorStatus'
import { editorStatus } from '../editorStatus'
import { inspectSource } from '../PineBox'
import { createMemberDoorService, __setMemberDoorServiceForTests } from './memberDoorAsync'
import { AuthContext } from '../../../../context/AuthContext'

const REPO = path.resolve(__dirname, '../../../../../..')
const VOLUME2 = fs.readFileSync(path.join(REPO, 'tests/fixtures/member', 'uncharted-volume-v2.pine'), 'utf8')
const RUNS = '//@version=6\nindicator("RSI")\nr = ta.rsi(close, 14)\nplot(r, "RSI")'

/** A worker that takes every job and says nothing until told (`answer`). */
class HoldingWorker {
  constructor() { this.jobs = []; this.terminated = false; this.onmessage = null; this.onerror = null; this.onmessageerror = null }
  postMessage(msg) { if (msg && typeof msg.kind === 'string' && msg.kind !== 'peer') this.jobs.push(msg) }
  answer(built) {
    const j = this.jobs[this.jobs.length - 1]
    if (this.onmessage) this.onmessage({ data: { id: j.id, ok: true, answer: built, hidden: [], lost: 0, consults: [], warmed: false, consultPending: false, ms: 1 } })
  }
  terminate() { this.terminated = true }
}

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }) }
const seconds = async (n) => { await act(async () => { vi.advanceTimersByTime(n * 1000) }) }

let svc = null
beforeEach(() => {
  cleanup()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: [] }) }))
  // ⭐ the page's clock is fake: the clock line's tick, and the time it counts from
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-23T15:00:00Z'))
})
afterEach(() => {
  cleanup()
  if (svc) { svc.dispose(); svc = null }
  __setMemberDoorServiceForTests(null)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('the clock line itself', () => {
  it('m:ss from the first whole second; the line alone before it', () => {
    expect(checkingText(null)).toBe(CHECKING_TEXT)
    expect(checkingText(999)).toBe(CHECKING_TEXT)
    expect(checkingText(1000)).toBe(`${CHECKING_TEXT} 0:01`)
    expect(checkingText(42000)).toBe('Checking your script... 0:42')
    expect(elapsedClock(187000)).toBe('3:07')
    expect(elapsedClock(24 * 60000 + 59000)).toBe('24:59')
  })
})

describe('⭐⭐ the member pane: while the build runs, "Checking your script..." and for how long, kept current', () => {
  it('0:00 says it is checking; 42 s on, 0:42; a second later, 0:43; the answer ends it', async () => {
    const made = []
    // (the production silence and load bounds: this worker says nothing until it answers, so it is still LOADING for
    // the page (e96 train: the silence bound starts at a worker's first word, `MEMBER_DOOR_LOAD_MS` before it), and the
    // line counts the whole time, past the 30 s a silent worker would be given. A watchdog far past the rail: under this
    // rail's environment the door's deadline is short; the bounds have their own rails, `doorHeartbeat.test.js`)
    svc = createMemberDoorService({ factory: () => { const w = new HoldingWorker(); made.push(w); return w },
      watchdogMs: 7200000 })
    __setMemberDoorServiceForTests(svc)
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <MemberPane sym="SPY" tf="D" source={VOLUME2} onAttach={async () => ({ ok: true })} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await flush()
    const line = () => screen.getByTestId('pine-member-pane-building')
    expect(screen.queryByTestId('pine-member-pane-building'), `the build is running: ${JSON.stringify(svc.stats())} ${document.body.textContent.slice(0, 200)}`).toBeTruthy()
    expect(line().textContent).toBe(CHECKING_TEXT)
    await seconds(42)
    expect(line().textContent, 'the line counts while the build runs').toBe('Checking your script... 0:42')
    expect(svc.stats(), 'the worker has said nothing yet: still loading, never taken for silent').toMatchObject(
      { loading: true, listening: false, silent: 0, unloaded: 0 })
    await seconds(1)
    expect(line().textContent).toBe('Checking your script... 0:43')
    // the clock is aria-hidden: the live region says "checking" once, not every second
    expect(screen.getByTestId('pine-checking-elapsed').getAttribute('aria-hidden')).toBe('true')
    expect(made).toHaveLength(1)
    await act(async () => { made[0].answer({ ok: false, definition: null, reason: 'refused (test)', guard: 'pine:test', rows: [], notes: [] }) })
    await flush()
    expect(screen.queryByTestId('pine-member-pane-building'), 'the answer ends the line').toBe(null)
  }, 60000)
})

describe('⭐⭐ the editor status panel: the headline counts too', () => {
  const statusOf = (src) => {
    const report = inspectSource(src, 'auto')
    return { report, status: editorStatus({ report, pane: paneFor(report, src), inspectedSource: src }) }
  }

  it('the chart door\'s build of this text running: "Checking your script... m:ss" from its start', async () => {
    const { report, status } = statusOf(RUNS)
    const since = Date.now()
    render(<PineEditorStatus status={{ ...status, paneChecking: true, checkingSince: since }} report={report} inspectedSource={RUNS} currentText={RUNS} />)
    await flush()
    const head = () => screen.getByTestId('pine-status-headline').textContent
    expect(head()).toBe(CHECKING_TEXT)
    await seconds(65)
    expect(head()).toBe('Checking your script... 1:05')
    await seconds(1)
    expect(head()).toBe('Checking your script... 1:06')
  })

  it('PasteBox\'s report of the newer text running: counted from the report\'s start', async () => {
    const { report, status } = statusOf(RUNS)
    const since = Date.now()
    render(<PineEditorStatus status={status} report={report} inspectedSource={RUNS} currentText={`${RUNS}\n`} reportSince={since} />)
    await flush()
    await seconds(7)
    expect(screen.getByTestId('pine-status-headline').textContent).toBe('Checking your script... 0:07')
  })
})

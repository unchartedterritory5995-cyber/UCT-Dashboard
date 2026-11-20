// @vitest-environment jsdom
// ─── WHY A SCRIPT IS STILL BEING CHECKED REACHES THE MEMBER, IN BOTH WINDOWS (2026-11-20) ──────────────
//
// The chart may draw a script bar by bar only once the server has said it may. While that answer is out the
// server's door says why (`pending_reason`: busy | starting | paused) and the engine keeps the last reason per
// script (`engine/runtimeKill.js::runtimePendingReasonOf`). This rail walks the whole way, on the REAL engine,
// with only the network stubbed:
//
//     the door's answer  ->  the engine  ->  the dock's script entry          (`authoring/scriptAnswer.js`)
//                                        ->  the editor's status panel         (`PineEditorStatus.jsx`)
//
// It is the rail that goes red if the engine's function is renamed: neither window guards the read with an
// "is it there" check (a guard would be a silent-off switch).
//
// ⛔ No test grant: `src/test-setup.js` re-grants every script before each test, and this file takes the grant
// away again in its own `beforeEach`, so the member's real gate decides.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useMemo } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

vi.mock('../supportLoop/supportApi', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, logImportGaps: () => true, reportsConfig: () => Promise.resolve({ reportsEnabled: false, maxSourceBytes: 131072, maxNoteChars: 1000 }) }
})

import PineEditorStatus, { usePineEditorStatus, shownStatus, PENDING_REASON_REREAD_MS } from './PineEditorStatus'
import { inspectSource } from './PineBox'
import { PANEL_STATE, lineMarks } from './editorStatus'
import { CHECKING_HEADLINE } from './runsHere'
import {
  checkScript, settleScript, scriptEntry, isChecking, PENDING_REASON_LINES, PENDING_REASONS_THAT_END_THE_WAIT,
  PENDING_RECHECKS, STILL_CHECKING_HEADLINE, STILL_CHECKING_LINE, CHECKING_IN_THE_EDITOR_LINE,
} from './authoring/scriptAnswer'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import {
  __resetRuntimeAllowList, __resetRuntimeAdmission, __resetRuntimeListsRecheck, setRuntimeKillList, latchRuntimeLists,
  runtimeSourceHash, runtimePendingReasonOf, runtimeAdmissionOf, RUNTIME_PENDING_REASONS, RUNTIME_KILL_PATH,
  RUNTIME_ADMISSION_PATH, RUNTIME_ADMISSION_PENDING_RETRY_MS, RUNTIME_ADMISSION_PENDING_RETRIES,
} from '../engine/runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
// a script only the bar-by-bar lane draws (it carries values from bar to bar): the fast lane refuses it
const SCRIPT = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/supportLoop/assistantRecipes/zigzag-percent.pine'), 'utf8')
const H = runtimeSourceHash(SCRIPT)
const LISTS_ON = { kill: [], allow: [], capability_admission: true }
const okJson = (body) => ({ ok: true, json: async () => body })
const pending = (reason) => ({ sha256: H, admitted: false, missing: ['pending'], ...(reason === undefined ? {} : { pending_reason: reason }) })
const ADMITTED = { sha256: H, admitted: true, missing: [] }
const REFUSED = { sha256: H, admitted: false, missing: ['matrix'] }

let door            // what the verdict door answers now
let fetchMock
const asksOf = (url) => fetchMock.mock.calls.filter((c) => c[0] === url).length
/** Long enough for one ask of the door to give up on "still being checked" (the engine's own retries). */
const ONE_ASK_MS = RUNTIME_ADMISSION_PENDING_RETRY_MS * (RUNTIME_ADMISSION_PENDING_RETRIES + 1)

beforeEach(() => {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_EDITOR_STATUS', '1')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-20T15:00:00Z'))
  __permitRuntimePaneForTests()
  __resetRuntimeAllowList()        // the member's gate: no test grant
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
  door = pending(undefined)
  fetchMock = vi.fn(async (url) => (url === RUNTIME_KILL_PATH ? okJson(LISTS_ON) : url === RUNTIME_ADMISSION_PATH ? okJson(door) : { ok: false, json: async () => null }))
  vi.stubGlobal('fetch', fetchMock)
  latchRuntimeLists(LISTS_ON)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  __resetRuntimeAdmission()
  setRuntimeKillList([])
  __resetRuntimeListsRecheck()
})

describe('every reason the engine keeps has words', () => {
  it('the engine names exactly the reasons this window words, and "paused" is one of them', () => {
    expect([...RUNTIME_PENDING_REASONS].sort()).toEqual(Object.keys(PENDING_REASON_LINES).sort())
    expect(PENDING_REASONS_THAT_END_THE_WAIT.every((r) => RUNTIME_PENDING_REASONS.includes(r))).toBe(true)
    // each reason says something different, and none of them says the script needs fixing
    expect(new Set(Object.values(PENDING_REASON_LINES)).size).toBe(RUNTIME_PENDING_REASONS.length)
    for (const line of Object.values(PENDING_REASON_LINES)) expect(line).not.toMatch(/fix|error|wrong with/i)
  })
})

// ─── the dock ────────────────────────────────────────────────────────────────────────────
describe('the dock: the door says why, and the script entry says it to the member', () => {
  /** One real check of the script (the dock's own `checkScript`, its own engine loader), with time moved on. */
  const check = async () => {
    const p = checkScript(SCRIPT)
    await vi.advanceTimersByTimeAsync(ONE_ASK_MS)
    return p
  }

  it.each([...RUNTIME_PENDING_REASONS])('"%s": the entry carries that reason\'s line, and no refusal', async (reason) => {
    door = pending(reason)
    const verdict = await check()
    expect(runtimePendingReasonOf({ source: SCRIPT })).toBe(reason)      // the engine kept what the door said
    expect(isChecking(verdict)).toBe(true)
    expect(verdict.headline).toBe(STILL_CHECKING_HEADLINE)
    expect(verdict.pendingReason).toBe(reason)
    expect(verdict.errors).toEqual([])                                   // nothing for the assistant to "fix"
    const entry = scriptEntry({ script: { name: 'Zigzag', pine: SCRIPT }, reply: 'Here it is.', verdict })
    expect(entry.lines).toContain(PENDING_REASON_LINES[reason])
    expect(entry.lines.slice(-2)).toEqual([PENDING_REASON_LINES[reason], STILL_CHECKING_LINE])
    for (const other of RUNTIME_PENDING_REASONS.filter((r) => r !== reason)) expect(entry.lines).not.toContain(PENDING_REASON_LINES[other])
  }, 120_000)

  it('CONTROL: a door that gives no reason (an older server) says only that it is being checked', async () => {
    door = pending(undefined)
    const verdict = await check()
    expect(isChecking(verdict)).toBe(true)
    expect('pendingReason' in verdict).toBe(false)
    const entry = scriptEntry({ script: { name: 'Zigzag', pine: SCRIPT }, reply: '', verdict })
    for (const line of Object.values(PENDING_REASON_LINES)) expect(entry.lines).not.toContain(line)
    expect(entry.lines.slice(-1)).toEqual([STILL_CHECKING_LINE])
  }, 120_000)

  it('CONTROL: once the door answers, nothing is "being checked" and no reason is said', async () => {
    door = ADMITTED
    const verdict = await check()
    expect(isChecking(verdict)).toBe(false)
    expect(verdict.runs).toBe(true)
    expect('pendingReason' in verdict).toBe(false)
    expect(runtimePendingReasonOf({ source: SCRIPT })).toBeNull()
  }, 120_000)

  /** A whole script answer settled by the dock's own code and engine; resolves with how many checks it made. */
  const settle = async () => {
    const repair = vi.fn()
    const before = asksOf(RUNTIME_KILL_PATH)
    const p = settleScript({ ok: true, script: { name: 'Zigzag', pine: SCRIPT, round: 0 }, reply: 'Here it is.' }, repair, { wait: async () => {} })
    for (let i = 0; i < 2 + PENDING_RECHECKS; i += 1) await vi.advanceTimersByTimeAsync(ONE_ASK_MS)
    const out = await p
    return { out, repair, checks: asksOf(RUNTIME_KILL_PATH) - before }
  }

  it('"paused" is not asked again within the answer; "busy" is, the bounded number of times; neither is sent for repair', async () => {
    door = pending('paused')
    const paused = await settle()
    expect(paused.checks).toBe(1)                                        // one check, and it stopped there
    expect(paused.repair).not.toHaveBeenCalled()
    expect(paused.out.entry.lines).toContain(PENDING_REASON_LINES.paused)
    __resetRuntimeAdmission()
    latchRuntimeLists(LISTS_ON)
    door = pending('busy')
    const busy = await settle()
    expect(busy.checks).toBe(1 + PENDING_RECHECKS)
    expect(busy.repair).not.toHaveBeenCalled()
    expect(busy.out.entry.lines).toContain(PENDING_REASON_LINES.busy)
  }, 180_000)
})

// ─── the editor's status panel ───────────────────────────────────────────────────────────────
let lastStatus = null   // the status the panel was last drawn from (what the editor's line marks are made from too)
function Panel({ source }) {
  const report = useMemo(() => inspectSource(source, 'pine'), [source])
  const status = usePineEditorStatus({ enabled: true, report, inspectedSource: source })
  lastStatus = status
  return <PineEditorStatus status={status} report={report} inspectedSource={source} currentText={source} />
}
const headline = () => screen.getByTestId('pine-status-headline')
const checkingLines = () => screen.queryAllByTestId('pine-status-checking-line').map((n) => n.textContent)
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('the editor panel: the same reason, in the same words, and never a false "Not yet"', () => {
  it.each([...RUNTIME_PENDING_REASONS])('"%s": the panel leads with "still being checked" and says why', async (reason) => {
    door = pending(reason)
    render(<Panel source={SCRIPT} />)
    await tick(PENDING_REASON_REREAD_MS + 100)
    expect(headline().textContent).toBe(CHECKING_HEADLINE)
    expect(headline().getAttribute('data-state')).toBe(PANEL_STATE.CHECKING)
    expect(checkingLines()).toEqual([PENDING_REASON_LINES[reason], CHECKING_IN_THE_EDITOR_LINE])
    for (const line of screen.getAllByTestId('pine-status-checking-line')) expect(line.getAttribute('data-reason')).toBe(reason)
    // ⛔ the fast lane's refusal of this script is not shown as the script's: nothing is "withheld", nothing "not yet"
    expect(screen.queryByLabelText('Withheld, not guessed')).toBeNull()
    expect(screen.queryAllByTestId('pine-status-item')).toEqual([])
    expect(document.body.textContent).not.toMatch(/Not yet|cannot reproduce/)
  }, 120_000)

  it('CONTROL: no reason from the door: "still being checked", the one plain line, and no reason line', async () => {
    door = pending(undefined)
    render(<Panel source={SCRIPT} />)
    await tick(PENDING_REASON_REREAD_MS + 100)
    expect(headline().textContent).toBe(CHECKING_HEADLINE)
    expect(checkingLines()).toEqual([CHECKING_IN_THE_EDITOR_LINE])
    expect(screen.getByTestId('pine-status-checking-line').getAttribute('data-reason')).toBe('')
  }, 120_000)

  it('a reason that CHANGES is re-read, and the answer landing ends it: the panel then says what the script does', async () => {
    door = pending('starting')
    render(<Panel source={SCRIPT} />)
    await tick(PENDING_REASON_REREAD_MS + 100)
    expect(checkingLines()[0]).toBe(PENDING_REASON_LINES.starting)
    door = pending('busy')
    await tick(RUNTIME_ADMISSION_PENDING_RETRY_MS + PENDING_REASON_REREAD_MS + 100)
    expect(checkingLines()[0]).toBe(PENDING_REASON_LINES.busy)
    // the door answers: the engine latches it, the pane is made again, and the false refusal never shows
    door = ADMITTED
    await tick(RUNTIME_ADMISSION_PENDING_RETRY_MS + PENDING_REASON_REREAD_MS + 100)
    expect(runtimeAdmissionOf({ source: SCRIPT })).toMatchObject({ admitted: true })
    expect(headline().textContent).not.toBe(CHECKING_HEADLINE)
    expect(headline().textContent).toMatch(/^Runs on the chart/)
    expect(checkingLines()).toEqual([])
    expect(screen.getByTestId('pine-status-engine').getAttribute('data-lane')).toBe('runtime')
    // and it stops reading: no timer of this panel's is left asking
    const asks = asksOf(RUNTIME_ADMISSION_PATH)
    await tick(PENDING_REASON_REREAD_MS * 5)
    expect(asksOf(RUNTIME_ADMISSION_PATH)).toBe(asks)
  }, 120_000)

  it('CONTROL: a script the door REFUSES is not "being checked": the panel says the refusal', async () => {
    door = REFUSED
    render(<Panel source={SCRIPT} />)
    await tick(PENDING_REASON_REREAD_MS + 100)
    expect(headline().textContent).not.toBe(CHECKING_HEADLINE)
    expect(checkingLines()).toEqual([])
    expect(headline().getAttribute('data-state')).not.toBe(PANEL_STATE.CHECKING)
  }, 120_000)
})

describe('what the panel leads with', () => {
  it('"still being checked" replaces a status that does NOT say runs, and never one that does', () => {
    const notYet = { state: PANEL_STATE.NOT_YET, headline: 'Not yet: Values carried from bar to bar', items: [] }
    expect(shownStatus({ ...notYet, admissionPending: true })).toMatchObject({ headline: CHECKING_HEADLINE, state: PANEL_STATE.CHECKING })
    expect(shownStatus(notYet)).toMatchObject({ headline: notYet.headline, state: PANEL_STATE.NOT_YET })
    // a script the fast lane already draws is said to run while the answer is out: it does
    const runs = { state: PANEL_STATE.RUNS, headline: 'Runs on the chart', items: [] }
    expect(shownStatus({ ...runs, admissionPending: true })).toMatchObject({ headline: 'Runs on the chart', state: PANEL_STATE.RUNS })
  })
})

// ─── the editor's line marks ─────────────────────────────────────────────────────────────────
describe('the editor marks no line as withheld while the script is still being checked', () => {
  it('no marks while the answer is out; the same status WOULD mark lines; a refusal that is final marks them', async () => {
    door = pending('busy')
    render(<Panel source={SCRIPT} />)
    await tick(PENDING_REASON_REREAD_MS + 100)
    expect(lastStatus.admissionPending).toBe(true)
    expect(lineMarks(lastStatus, SCRIPT)).toEqual({ source: SCRIPT, marks: [] })
    // CONTROL: the fast lane's refusal is on real lines of this script, and without the "still being checked"
    // fact those lines are marked (so the empty answer above is the rule at work, not a status with no lines)
    const asFinal = { ...lastStatus }
    delete asFinal.admissionPending
    const wouldMark = lineMarks(asFinal, SCRIPT).marks
    expect(wouldMark.length).toBeGreaterThan(0)
    expect(wouldMark.every((m) => m.line >= 1 && typeof m.message === 'string' && m.message.length > 0)).toBe(true)
    // the door REFUSES: nothing is being checked any more, and the lines are marked
    door = REFUSED
    await tick(RUNTIME_ADMISSION_PENDING_RETRY_MS + PENDING_REASON_REREAD_MS + 100)
    expect(lastStatus.admissionPending).toBeUndefined()
    expect(lineMarks(lastStatus, SCRIPT).marks.length).toBeGreaterThan(0)
  }, 120_000)

  it('only the literal fact switches it off', () => {
    const src = 'a' + String.fromCharCode(10) + 'b' + String.fromCharCode(10) + 'c'
    const item = { line: 2, severity: 'withheld', label: 'x', reason: 'y', guard: 'pine:state' }
    for (const v of [undefined, null, false, 0, '', 'true', 1]) {
      expect(lineMarks({ items: [item], admissionPending: v }, src).marks, String(v)).toHaveLength(1)
    }
    expect(lineMarks({ items: [item], admissionPending: true }, src).marks).toEqual([])
  })
})

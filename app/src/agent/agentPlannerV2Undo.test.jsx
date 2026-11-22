// ── v2-readiness-2: agent.undo as a PLANNER v2 STEP (review #768: v2 answered an Undo honestly but never ran one) ──
//
// The script IS the model (testing/stepServer.js plays the server's STEP-1 loop). An agent.undo step runs the receipt's
// own Undo (useAgent doUndo / undoTurn with every refusal) — steps.js runUndoStep — and only their outcome rows go back:
//   • first in the turn → the member's newest change (v1's "agent.undo alone");
//   • after this turn's own changes → only what THIS turn committed (newest, or all with scope "all");
//   • after a change-step that committed nothing → nothing is undone, never an older request's change.
// Planner v2 stays OFF in production: the scripted config says planner 'v2' only inside these tests.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, TWO } from './testing/panelHarness'
import { installStepServer } from './testing/stepServer'
import { _resetAgentConfig } from './agentClient'
import { undoOutcomeOf, UNDO_AFTER_NOTHING_V2, resumedTurn } from './steps'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p, srv
beforeEach(() => { _resetAgentConfig(); p = setupPanel() })
afterEach(() => { srv?.uninstall?.(); vi.restoreAllMocks(); cleanup() })

const settled = async () => { await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 }) }
const tfOf = (board, id) => board.state.widgets.find(w => w.id === id)?.opts?.tf || 'D'
const typeOf = (board, id) => board.host.charts.read(id).cs.chartType
const ref = (i) => (c) => c.body.context.charts[i].ref
const agentRef = (c) => [].concat(c.body.context.agent || [])[0]?.ref
const tf = (i, timeframe) => (c) => ({ action: 'chart.setTimeframe', target: ref(i)(c), args: { timeframe }, mode: 'apply' })
const undo = (scope = 'last', about = null) => (c) => ({ action: 'agent.undo', target: agentRef(c), args: { scope, about }, mode: 'apply' })

describe('v2-readiness-2 — agent.undo as a v2 step', () => {
  it('"…, then put it back": the change, then the Undo of exactly that change (both steps done)', async () => {
    srv = installStepServer(p, [tf(0, 'W'), undo(), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('retune the left panel to weekly and afterwards put its old interval back')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'done'])
    expect(srv.results[1].receipt).toBeTruthy()
    expect(tfOf(board, 'cl')).toBe('D')
  }, 30000)

  it('an Undo step FIRST in a turn takes back the member’s newest change from an earlier request', async () => {
    srv = installStepServer(p, [tf(0, 'W'), { reply: 'Weekly.' }, undo(), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('retune the left panel to weekly')
    await settled()
    expect(tfOf(board, 'cl')).toBe('W')
    await say('hmm, restore the interval it had before you touched it')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'done'])
    expect(tfOf(board, 'cl')).toBe('D')
  }, 30000)

  it('scope "all" after two changes of THIS turn takes both back, newest first', async () => {
    srv = installStepServer(p, [tf(0, 'W'), (c) => ({ action: 'chart.setType', target: ref(1)(c), args: { type: 'bars' }, mode: 'apply' }), undo('all'), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    const before = typeOf(board, 'cr')
    await say('retune the left panel to weekly, restyle the right one as bars, then put both back as they were')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'done', 'done'])
    expect(tfOf(board, 'cl')).toBe('D')
    expect(typeOf(board, 'cr')).toBe(before)
  }, 30000)

  it('after a change-step that committed nothing, the Undo touches NOTHING (never the earlier request’s change)', async () => {
    srv = installStepServer(p, [tf(0, 'W'), { reply: 'Weekly.' }, tf(1, '7'), undo(), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('retune the left panel to weekly')
    await settled()
    await say('retune the right panel to seven minutes and afterwards put its old interval back')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'refused', 'refused'])
    expect(tfOf(board, 'cl')).toBe('W')                    // the earlier request's change stays
    expect(p.transcript()).toContain(UNDO_AFTER_NOTHING_V2)
  }, 30000)

  it('nothing of the Agent’s to undo: the step is refused with doUndo’s own sentence', async () => {
    srv = installStepServer(p, [undo(), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('restore the interval it had before you touched it')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['refused'])
    expect(srv.results[0].refusal).toMatch(/nothing of mine to undo/)
    expect(tfOf(board, 'cl')).toBe('D')
  }, 30000)

  it('a described Undo that does not match the newest change is refused (the about check), nothing changes', async () => {
    srv = installStepServer(p, [tf(0, 'W'), { reply: 'Weekly.' }, undo('last', 'drawing'), { reply: '' }])
    const { say, board } = p.mount(...TWO())
    await say('retune the left panel to weekly')
    await settled()
    // (round 3: "take back the drawing you made" is now an instant described Undo; this test is about the planner's step, so the
    // phrasing is one no instant reader claims)
    await say('could you take back the drawing you made earlier please')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'refused'])
    expect(tfOf(board, 'cl')).toBe('W')
  }, 30000)

  it('undoOutcomeOf: rows → step results (done / partial / refused), never a claim of its own', () => {
    expect(undoOutcomeOf([])).toEqual({ status: 'refused', refusal: 'nothing was undone' })
    expect(undoOutcomeOf([{ outcome: 'Back to daily', outcomeData: { kind: 'undo' } }])).toEqual({ status: 'done', receipt: 'Back to daily' })
    expect(undoOutcomeOf([{ outcome: 'a', outcomeData: { kind: 'undo' } }, { outcome: 'changed since', outcomeData: { kind: 'undo-refused' } }]).status).toBe('failed')
    expect(undoOutcomeOf([{ outcome: 'Took back 1 of the 2', outcomeData: { kind: 'undo-turn', done: 1, of: 2 } }]).status).toBe('failed')
    expect(undoOutcomeOf([{ outcome: 'Took back all 2', outcomeData: { kind: 'undo-turn', done: 2, of: 2 } }]).status).toBe('done')
    expect(undoOutcomeOf([{ outcome: 'protected', outcomeData: { kind: 'undo-refused-protected' } }]).status).toBe('refused')
    expect(undoOutcomeOf([{ outcome: 'not saved', outcomeData: { kind: 'undo-unsaved' } }]).status).toBe('failed')
  })

  it('review #775: a resumed turn the runner no longer holds keeps its OWN Undo baseline, never the whole stack', () => {
    const deps = { undoRef: { current: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] } }
    // the card carried the stack as it was when its turn started: only u3 (this turn's) is fresh
    expect(resumedTurn({ turnId: 't', undoBefore: ['u1', 'u2'], changeSteps: 2 }, deps)).toMatchObject({ undoBefore: ['u1', 'u2'], changeSteps: 2 })
    // nothing carried: everything but the card's own (newest) change is older — never `null` (= all of it fresh)
    const r = resumedTurn({ turnId: 't' }, deps)
    expect(r.undoBefore).toEqual(['u1', 'u2'])
    expect(r.changeSteps).toBe(1)
    expect(resumedTurn({ turnId: 't' }, { undoRef: { current: [] } }).undoBefore).toEqual([])
  })
})

// ── V2-G2: PLAN GROUPS under planner v2 — "Put four charts on my screen" with no phrase workaround ─────────────────
//
// The owner's sentence needs new charts AND a re-tile that makes room for them. v1 plans them as ONE envelope (planOps
// places the adds together with the re-tile: #771). v2 used to run each tool call as its own step, so the third add
// found no empty space (V2-G1). Now consecutive ordinary changes of ONE model response arrive as a PLAN GROUP
// (turn_v2._send_group) and the browser runs them as ONE plan — one decideMode, one commit, one receipt, one Undo. The
// rule is generic (any changes that only work together), not a phrase. The script IS the model (testing/stepServer.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { installStepServer } from './testing/stepServer'
import { _resetAgentConfig } from './agentClient'
import { groupOutcomes, NOT_RUN } from './steps'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p, srv
beforeEach(() => { _resetAgentConfig(); p = setupPanel(); n = 0 })
afterEach(() => { srv?.uninstall?.(); vi.restoreAllMocks(); cleanup() })

const settled = async () => { await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 }) }
const HALF = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: bareSettings() } }], { 'N:c1': 'NVDA' }]
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart')
const ws = (c) => [].concat(c.body.context.workspace || [])[0]?.ref
let n = 0
const add = (c) => ({ action: 'widget.add', target: ws(c), args: { type: 'chart', as: `new${++n}` }, mode: 'apply' })
const boardRef = (c) => [].concat(c.body.context.board || [])[0]?.ref
const arrange = (c) => ({ action: 'widget.arrange', target: boardRef(c), args: { widgets: null, pattern: 'grid' }, mode: 'apply' })

describe('V2-G2 — plan groups', () => {
  it('"Put four charts on my screen": 3 adds + the re-tile in ONE response → four equal charts, v1 receipts, one Undo', async () => {
    srv = installStepServer(p, [(c) => ({ group: [add(c), add(c), add(c), arrange(c)] }), { reply: '' }])
    const { say, board } = p.mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    await say('Put four charts on my screen.')
    await settled()
    expect(srv.events.filter(e => e.t === 'step').map(e => e.group?.size)).toEqual([4, 4, 4, 4])
    expect(srv.results.map(r => r.status)).toEqual(['done', 'done', 'done', 'done'])
    expect(charts(board)).toHaveLength(4)
    expect(new Set(charts(board).map(w => `${w.w}x${w.h}`)).size).toBe(1)
    // ONE execute, exactly as v1 runs this plan (#771: the adds, then the re-tile, as two parts of one request with ONE
    // grouped Undo) — so the receipts are v1's own: the adds, then the arrangement
    expect(p.summaries().join(' | ')).toMatch(/Added 3 Charts.*\|.*[Aa]rranged/)
    await say('undo')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(before))   // one Undo takes the whole plan back
  }, 30000)

  it('the same four steps sent one by one (no group) cannot make room: the third add is refused (why groups exist)', async () => {
    srv = installStepServer(p, [add, add, add, arrange, { reply: '' }])
    const { say, board } = p.mount(...HALF())
    await say('Put four charts on my screen.')
    await settled()
    expect(srv.results.map(r => r.status)).toEqual(['done', 'done', 'refused', 'done'])
    expect(charts(board)).toHaveLength(3)
  }, 30000)

  it('a group member whose args name a ref the turn never offered is refused by name; the rest still run as one plan', async () => {
    const copy = (c) => ({ action: 'indicatorCopy.copyTo', target: [].concat(c.body.context.indicatorEdits || [])[0]?.ref, args: { from: 'c9', instances: [] }, mode: 'apply' })
    srv = installStepServer(p, [(c) => ({ group: [add(c), copy(c), arrange(c)] }), { reply: '' }])
    const { say, board } = p.mount(...HALF())
    await say('Put another chart up and lay them out evenly.')
    await settled()
    expect(srv.results.map(r => [r.status, (r.refusal || '').slice(0, 12)])).toEqual([['done', ''], ['refused', 'from "c9" is'], ['done', '']])
    expect(charts(board)).toHaveLength(2)
  }, 30000)

  it('review #782: each member gets ITS outcome — an op the executor dropped is not reported as done', () => {
    const done = { status: 'done', receipt: 'Added 2 Charts · Arranged' }
    const ops = [{ action: 'widget.add' }, { action: 'indicator.update' }, { action: 'widget.add' }, { action: 'widget.arrange' }]
    // the commit records name the two adds and the arrange; the deferred indicator.update was dropped before it ran
    const bodies = [{ outcome: 'Added 2 Charts', outcomeData: { kind: 'applied', actions: ['widget.add', 'widget.add'] } },
      { outcome: 'Arranged', outcomeData: { kind: 'applied', actions: ['widget.arrange'] } }]
    expect(groupOutcomes(bodies, ops, done).map(o => o.status)).toEqual(['done', 'refused', 'done', 'done'])
    expect(groupOutcomes(bodies, ops, done)[1].refusal).toBe(NOT_RUN)
    // a THIRD add with only two recorded: the multiset runs out for it
    expect(groupOutcomes(bodies, [...ops, { action: 'widget.add' }], done).map(o => o.status).at(-1)).toBe('refused')
    // not done (a card / a refusal): nothing of the plan ran — every member gets it
    expect(groupOutcomes(bodies, ops, { status: 'proposed' }).map(o => o.status)).toEqual(['proposed', 'proposed', 'proposed', 'proposed'])
    // a single step, or records without per-action evidence: the final outcome as before
    expect(groupOutcomes(bodies, [ops[1]], done)).toEqual([done])
    expect(groupOutcomes([{ outcome: 'x', outcomeData: { kind: 'applied' } }], ops, done).every(o => o === done)).toBe(true)
    expect(groupOutcomes([{ outcome: 'x', outcomeData: { kind: 'applied', actions: ['chart.setTheme'] } }], ops, done).every(o => o === done)).toBe(true)
  })
})

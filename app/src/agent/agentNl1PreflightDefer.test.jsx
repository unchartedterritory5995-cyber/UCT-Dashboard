// ⛔ NL-1 PREFLIGHT / REPAIR — NO SILENT DROP (AUDIT 11-23, the corrected 3-arm eval). Through the REAL panel with NL-1 ON (as
// the e2e harness enables it: the server serves NL-1 + this browser's switch) and a SCRIPTED model (no paid call).
//
// The defect (recorded eval answers, 11-23): "switch to weekly and make the RSI pane bigger" planned as chart.setTimeframe +
// pane.resize. NL-1's preflight checked the whole plan as ONE plan, so the indicator edit's exclusive/sequential rule ("Change
// one indicator at a time, on its own") read as a REFUSAL; the ONE repair went back; the model "fixed" it by DROPPING the
// indicator op; the repair's shorter plan replaced the first and ran under a success receipt — a step silently dropped.
//
// Held here, each part by its own rows:
//   (a) DEFER  — preflight checks the plan in the parts the runtime runs it as (the legacy idiom: the allowed ops, then each
//                indicator edit queued as its own next step). The sequential rule is never a refusal → no repair at all;
//   (b) DEPENDS — a step aimed at what an earlier step of the same plan adds ("add MACD, make its pane bigger") is judged on the
//                board that earlier step leaves (at its own turn), never on the board before it → it runs;
//   (c) COVERAGE — a repair answer that drops a requested op (a real refusal repaired by dropping it) never hides it: what the
//                repair dropped is said as NOT DONE after whatever ran.
// The matrix (families × apply / propose) asserts on the FINAL board: every requested op is done, or the reply says it is not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { AuthContext } from '../context/AuthContext'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import * as NL1 from './nl1/interpreter'
import * as UA from './useAgent'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
// (namespace imports: the matrix also runs on a build without the fix, to count the drops before it)
const { NL1_KEY, preflightRefusals, repairDropped, repairDroppedLines } = NL1
const preflightParts = (ops) => UA.preflightParts(ops)
const CTX = { surface: 'charts' }
const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
// one chart, read and written like the workspace (settings + timeframe), every save accepted
function board() {
  const s = { c1: { settings: {}, tf: 'D' } }
  const read = (ref) => (ref in s ? { ref, label: 'Left chart (QQQ)', position: 'left', symbol: 'QQQ', tf: s[ref].tf, stored: s[ref].settings, cs: load(s[ref].settings), linkedCount: 0 } : null)
  const b = { s }
  b.host = {
    charts: {
      list: () => Object.keys(s).map(read), read,
      commit: (ref, p) => { if ('settings' in p) s[ref].settings = clone(p.settings); if ('tf' in p) s[ref].tf = p.tf; return true },
      canManageIndicators: () => true, canCreateIndicator: () => true,
    },
    persist: async () => ({ ok: true }), widgetInSync: async () => ({ ok: true }), otherWidgets: () => [],
  }
  return b
}
async function seed(b, ops) {
  buildContext(b.host, CTX); const env = await prepareOps(ops)
  const p = planOps(collectTargets(b.host, ['indicatorEdits']), ops, env, CTX)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  expect((await commitPlan(b.host, p, { env, ctx: CTX })).ok).toBe(true)
}
const withRsi = async () => { const b = board(); await seed(b, [{ action: 'indicator.add', target: 'ixe:c1', args: { defId: 'rsi', inputs: null } }]); _resetProposedPlans(); return b }
const cs = (b) => load(b.s.c1.settings)
const inst = (b, defId) => (cs(b).indicatorInstances || []).find(i => i.defId === defId)
const sizeOf = (b, defId) => { const i = inst(b, defId); return i ? (cs(b).paneSizes || {})[i.instanceId] ?? null : null }

let turns, script
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
beforeEach(async () => {
  setOwnedDefinitionSource(() => []); _resetProposedPlans()
  turns = []
  script = () => answer({ reply: 'ok' })
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { const body = JSON.parse(init.body); turns.push(body); return json(await script(body, turns.length)) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json({ stream: false, nl1: true })     // this server serves NL-1
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  // NL-1 ON exactly as the e2e harness turns it on (testing/e2eRun.jsx: the server's config + this browser's switch)
  localStorage.setItem(NL1_KEY, '1'); _resetAgentConfig(); await loadAgentConfig()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.removeItem(NL1_KEY) } catch { /* */ } })

function mount(b) {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}><AgentPanel host={b.host} onClose={() => {}} /></AuthContext.Provider></SWRConfig>)
  const box = screen.getByLabelText('Message UCT Agent')
  const idle = async () => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    await new Promise(r => setTimeout(r, 300))
  }
  const say = async (t) => {
    await idle()
    fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await idle()
  }
  // a proposal: Apply its card (and every card a follow-up step shows after it), then read the final board
  const approveAll = async () => {
    for (let k = 0; k < 4; k++) {
      await idle()
      const card = [...document.querySelectorAll('[data-testid=agent-proposal][data-status=pending]')].pop()
      if (!card) return
      fireEvent.click([...card.querySelectorAll('button')].find(x => x.textContent === 'Apply'))
    }
    await idle()
  }
  return { say, approveAll, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
// the request's context refs (NL-1 sends context refs; the scripted model plans with them, as the real one must)
const refs = (body) => ({ chart: (body.context.charts || [])[0]?.ref, ixe: (body.context.indicatorEdits || [])[0]?.ref })
// ⛔ the RECORDED repair (11-23): handed UCT's reasons, the model "fixes" the plan by dropping every indicator op
const dropsIndicatorOps = (ops) => ops.filter(o => !/^(?:pane|indicator|indicatorStyle)\./.test(o.action))
// the honest NOT-DONE wording: a line that says a part of the request was not done
const REPORTED = /not done|didn[’']t (?:do|make|change)|couldn[’']t|can[’']t|not this part|stopped there/i

// ── the families: a chart op + an exclusive/sequential indicator edit (resize, colour, param, add+resize) ─────────
const FAMILIES = {
  resize: {
    say: 'switch to weekly and make the RSI pane bigger',
    ops: (r) => [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'pane.resize', target: r.ixe, args: { pane: 'rsi', size: 40 } }],
    done: (b) => ({ tf: b.s.c1.tf === 'W', ind: sizeOf(b, 'rsi') === 0.4 }),
  },
  colour: {
    say: 'weekly, and make the RSI orange',
    ops: (r) => [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'indicatorStyle.set', target: r.ixe, args: { instance: 'rsi', property: 'color', value: 'orange', output: null } }],
    done: (b) => ({ tf: b.s.c1.tf === 'W', ind: JSON.stringify(inst(b, 'rsi') || {}).toLowerCase().includes('#f59e0b') }),
  },
  param: {
    say: 'go weekly and set the RSI length to 21',
    ops: (r) => [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'indicator.update', target: r.ixe, args: { instance: 'rsi', inputs: [{ key: 'period', value: 21 }] } }],
    done: (b) => ({ tf: b.s.c1.tf === 'W', ind: Number(inst(b, 'rsi')?.inputs?.period) === 21 }),
  },
  addResize: {
    say: 'weekly, add a MACD and make its pane bigger',
    ops: (r) => [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'indicator.add', target: r.ixe, args: { defId: 'macd', inputs: null } }, { action: 'pane.resize', target: r.ixe, args: { pane: 'macd', size: 35 } }],
    done: (b) => ({ tf: b.s.c1.tf === 'W', add: !!inst(b, 'macd'), ind: sizeOf(b, 'macd') === 0.35 }),
  },
}

/** One row: the family's plan as the model's first answer (apply / propose); its repair drops the indicator ops. */
async function row(fam, mode) {
  const F = FAMILIES[fam]
  const b = await withRsi()
  script = (body) => {
    const r = refs(body)
    const ops = F.ops(r)
    return answer({ disposition: mode, reply: mode === 'apply' ? 'Done.' : 'Here is the change.', ops: body.repair ? dropsIndicatorOps(ops) : ops })
  }
  const m = mount(b)
  await m.say(F.say)
  if (mode === 'propose') await m.approveAll()
  const done = F.done(b)
  const missing = Object.entries(done).filter(([, v]) => !v).map(([k]) => k)
  const text = m.transcript()
  const out = { done, missing, silent: missing.length > 0 && !REPORTED.test(text), repaired: turns.some(t => t.repair), text, turns: turns.length }
  if (globalThis.process?.env?.NL1PF_ROWS) console.log(`ROW ${fam} ${mode} missing=${missing.join('+') || '-'} silent=${out.silent} repaired=${out.repaired}`)
  return out
}

describe('(a)+(b) NL-1 preflight defers sequential indicator edits: every requested op lands, no repair, 0 silent drops', () => {
  const tally = []
  for (const fam of Object.keys(FAMILIES)) {
    for (const mode of ['apply', 'propose']) {
      it(`${fam} × ${mode}`, async () => {
        const r = await row(fam, mode)
        tally.push({ fam, mode, silent: r.silent })
        expect({ missing: r.missing, silent: r.silent, repaired: r.repaired }, r.text).toEqual({ missing: [], silent: false, repaired: false })
        expect(r.turns).toBe(1)                                      // the one model call: nothing went back for repair
      }, 30000)
    }
  }
  it('tally: 0 silent drops', () => { expect(tally.filter(t => t.silent)).toEqual([]) })
})

// ── (c) a REAL refusal, repaired by dropping the op: reported as not done, never under a bare success ─────────
describe('(c) a repair answer that drops a requested op is never silent', () => {
  for (const mode of ['apply', 'propose']) {
    it(`a colour UCT does not know (refused) → the repair drops it → "Not done" names it × ${mode}`, async () => {
      const b = await withRsi()
      script = (body) => {
        const r = refs(body)
        const ops = [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'indicatorStyle.set', target: r.ixe, args: { instance: 'rsi', property: 'color', value: 'blurple', output: null } }]
        return answer({ disposition: mode, reply: 'Done.', ops: body.repair ? dropsIndicatorOps(ops) : ops })
      }
      const m = mount(b)
      await m.say('weekly and make the rsi blurple')
      if (mode === 'propose') await m.approveAll()
      expect(turns.filter(t => t.repair)).toHaveLength(1)           // the planner's refusal went back ONCE
      expect(b.s.c1.tf).toBe('W')                                   // what the repair kept ran
      const t = m.transcript()
      expect(t).toMatch(/Not done:/)
      expect(t).toMatch(/isn't a color I know/)                     // with UCT's own reason
    }, 30000)
  }
  it('a repair that answers in WORDS ("Done.", no plan) drops every op: each is said as not done', async () => {
    const b = await withRsi()
    script = (body) => {
      const r = refs(body)
      if (body.repair) return answer({ disposition: 'answer', reply: 'Done.' })
      return answer({ disposition: 'apply', reply: 'Done.', ops: [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'indicatorStyle.set', target: r.ixe, args: { instance: 'rsi', property: 'color', value: 'blurple', output: null } }] })
    }
    const m = mount(b)
    await m.say('weekly and make the rsi blurple')
    expect(b.s.c1.tf).toBe('D')
    const t = m.transcript()
    expect(t).toMatch(/Not done: one part of your request \(chart timeframe\)/)
    expect(t).toMatch(/Not done: one part of your request \(indicator style\) — .*isn't a color I know/)
  }, 30000)
  it('a repair that KEEPS the op (fixed) reports nothing as dropped', async () => {
    const b = await withRsi()
    script = (body) => {
      const r = refs(body)
      const value = body.repair ? 'orange' : 'blurple'
      return answer({ disposition: 'apply', reply: 'Done.', ops: [{ action: 'chart.setTimeframe', target: r.chart, args: { timeframe: 'W' } }, { action: 'indicatorStyle.set', target: r.ixe, args: { instance: 'rsi', property: 'color', value, output: null } }] })
    }
    const m = mount(b)
    await m.say('weekly and make the rsi orange')
    expect(turns.filter(t => t.repair)).toHaveLength(1)
    expect(b.s.c1.tf).toBe('W')
    expect(m.transcript()).not.toMatch(/Not done:/)
  }, 30000)
})

// ── the pure pieces ───────────────────────────────────────────────────────────────────────────────────────────
describe('pure: preflightParts / preflightRefusals / repairDropped', () => {
  const tf = { action: 'chart.setTimeframe', target: 'chart:c1', args: { timeframe: 'W' } }
  const rs = { action: 'pane.resize', target: 'ixe:c1', args: { pane: 'rsi', size: 40 } }
  const add = { action: 'indicator.add', target: 'ixe:c1', args: { defId: 'macd', inputs: null } }
  it('the parts are the runtime\'s: the rest first, each sequential step queued after it', () => {
    expect(preflightParts([tf, rs])).toEqual({ rest: [tf], steps: [rs] })
    expect(preflightParts([rs, tf])).toEqual({ rest: [tf], steps: [rs] })
    expect(preflightParts([add, rs])).toEqual({ rest: [add], steps: [rs] })
    expect(preflightParts([tf])).toEqual({ rest: [tf], steps: [] })
  })
  it('a sequential edit beside a chart op is NOT a refusal; a real one is; a step on what an earlier step adds waits for its turn', async () => {
    const b = await withRsi()
    buildContext(b.host, CTX)
    const real = (ops) => ops.map(o => ({ ...o, target: o.target === 'chart:c1' ? 'c1' : o.target }))
    expect(preflightRefusals(b.host, real([tf, rs]), { parts: preflightParts })).toEqual([])
    expect(preflightRefusals(b.host, real([tf, add, { ...rs, args: { pane: 'macd', size: 35 } }]), { parts: preflightParts })).toEqual([])
    const bad = preflightRefusals(b.host, real([tf, { action: 'indicatorStyle.set', target: 'ixe:c1', args: { instance: 'rsi', property: 'color', value: 'blurple', output: null } }]), { parts: preflightParts })
    expect(bad.join(' ')).toMatch(/isn't a color I know/)
    expect(bad.join(' ')).not.toMatch(/one indicator at a time/i)
  })
  it('repairDropped: what the first plan asked that the repair no longer does (by action, as a multiset)', () => {
    expect(repairDropped([tf, rs], [tf])).toEqual([rs])
    expect(repairDropped([tf, rs], [tf, { ...rs, args: { pane: 'rsi', size: 30 } }])).toEqual([])
    expect(repairDropped([tf, rs, rs], [tf, rs])).toEqual([rs])
    expect(repairDropped([tf], [tf, rs])).toEqual([])
    expect(repairDroppedLines([rs], ['Bad pane.'])[0]).toMatch(/^Not done:.*pane.*Bad pane\./i)
  })
})

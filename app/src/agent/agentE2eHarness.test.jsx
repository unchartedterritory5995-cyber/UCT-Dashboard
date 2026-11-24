// E2E EVAL harness self-checks (no model call, no network): testing/e2eRun.jsx + e2eEval.jsx + e2eScore.js.
//
//   • ORACLE self-check: every case of the bench and the e2e corpus, answered turn by turn with ITS OWN expected
//     envelope through the real panel, scores `success` on the board it leaves — so no expectation is impossible;
//   • KNOWN-WRONG: the same cases with a wrong answer (another chart, a dropped step, nothing at all) score failure;
//   • no teacher forcing: turn 2 runs on the board turn 1 actually left, and a correction branch follows the outcome;
//   • the save conflict host refuses a pane-size save with a 409-shaped answer and stays refused;
//   • the bank: a request's key is stable across mounts, a miss becomes a runner item and stops the dialogue.
//
// AGENT_E2E_SELFCHECK_FILES=realModelBench.v1.json,e2eBench.v1.json (default both) and AGENT_E2E_SELFCHECK_ONLY=<ids>.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { specFor } from './testing/bench'
import { evaluateCase, expectedResponder } from './testing/e2eEval'
import { bankResponder, requestKey, mountCase, stepsOf } from './testing/e2eRun'
import { scoreTurn, armTable, paired } from './testing/e2eScore'
import { memberPick, lyingCharts } from './testing/e2eMember'
import { buildBoard, snapshot, compareBoards, semanticView } from './testing/e2eHost'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
// the panel's request taps: what it routed / selected for the request it is about to send (the reroute tables)
vi.mock('./nl1/interpreter', async (orig) => {
  const m = await orig()
  return { ...m, buildNl1Request: (args) => { const r = m.buildNl1Request(args); if (!args?.need) (globalThis.__e2eTap ||= {}).nl1 = r; return r } }
})
vi.mock('./runtime', async (orig) => {
  const m = await orig()
  // the plans the runtime actually COMMITTED (what reached the writers): the executed plan of a turn
  return { ...m, commitPlan: async (host, plan, o) => { const res = await m.commitPlan(host, plan, o); ((globalThis.__e2eTap ||= {}).committed ||= []).push({ ops: (plan?.plans || []).flatMap(p => (p.items || []).map(i => i.op?.action)).filter(Boolean), ok: !!res?.ok }); return res } }
})
vi.mock('./nlm1/flag', async (orig) => {
  const m = await orig()
  return { ...m, pickRouter: () => { const route = m.pickRouter(); return (full, text, routeOpts, need) => { const routed = route(full, text, routeOpts, need); if (need === undefined) (globalThis.__e2eTap ||= {}).route = { route, full, text, routeOpts, routed }; return routed } } }
})

registerBuiltins()
const env = globalThis.process?.env || {}
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/nlIntent')
const SPEC = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const FILES = (env.AGENT_E2E_SELFCHECK_FILES || 'realModelBench.v1.json,e2eBench.v1.json').split(',').filter(Boolean)
const ONLY = env.AGENT_E2E_SELFCHECK_ONLY ? new Set(env.AGENT_E2E_SELFCHECK_ONLY.split(',')) : null

// PRODUCT CEILINGS (2026-11-23, on the origin/master merge): the case's IDEAL answer still fails on today's panel. These
// are findings about the product, the same for every arm (no model can pass them through these rails).
// The PRODUCT CEILINGS: { "<case>#<turn>": [outcomes] } — what the IDEAL answer scores on today's panel when that is not
// success (the target rail asking although the words name the chart, a refused save left on screen, …). The same for every
// arm: no model can pass them through these rails. One file for every branch the harness runs on (a fix that turns a
// ceiling into success adds "success" to that entry). AGENT_E2E_CEILING_OUT=<file> appends what this run observed.
const CEILING_FILE = path.join(DIR, 'e2eCeilings.v1.json')
const CEILING = fs.existsSync(CEILING_FILE) ? JSON.parse(fs.readFileSync(CEILING_FILE, 'utf8')).ceilings : {}
const ceilingHas = (key, outcome) => (CEILING[key] || []).includes(outcome)

describe('oracle self-check: each case\'s own expectation scores success end to end', () => {
  for (const f of FILES) {
    const data = fs.existsSync(path.join(DIR, f)) ? load(f) : { cases: [] }
    const spec = specFor(SPEC, data)
    for (const c of data.cases.filter(x => !ONLY || ONLY.has(x.id))) {
      it(`${f} ${c.id}`, async () => {
        const { rows } = await evaluateCase({ spec, c, arm: 'B', responderFor: () => expectedResponder() })
        if (env.AGENT_E2E_DEBUG) console.log(JSON.stringify(rows))
        for (const r of rows.filter(x => x.outcome !== 'success')) console.log(`SELFCHECK ${r.key} ${r.outcome} ${ceilingHas(r.key, r.outcome) ? 'ceiling' : ''} | ${r.why || ''} | ${(r.reply || '').slice(0, 200)}`)
        if (env.AGENT_E2E_CEILING_OUT) fs.appendFileSync(env.AGENT_E2E_CEILING_OUT, rows.filter(x => x.outcome !== 'oracle_invalid').map(r => `${JSON.stringify({ key: r.key, outcome: r.outcome })}\n`).join(''))
        // an expectation the harness cannot execute is reported (oracle_invalid, never scored); a PRODUCT CEILING (the ideal
        // answer still fails because of a rail or the save path) must fail exactly as recorded — a fix flips it and this asks
        // for the list to be updated; anything else is a broken expectation
        const bad = rows.filter(r => r.outcome !== 'success' && r.outcome !== 'oracle_invalid' && !ceilingHas(r.key, r.outcome))
        const stale = rows.filter(r => r.outcome === 'success' && CEILING[r.key] && !ceilingHas(r.key, 'success'))
        expect([...bad, ...stale].map(r => `${r.key} ${r.outcome} ${r.why}`)).toEqual([])
      }, 120000)
    }
  }
})

// ── known-wrong answers must FAIL ───────────────────────────────────────────────────────────────────────────
// turn 0 of each case answered wrongly, rotating by case: nothing at all / the first change on another chart / the last
// step dropped. The other turns get their expected answers.
const chartRefs = (ctx) => {
  const out = []
  const walk = (v, d) => { if (!v || typeof v !== 'object' || d > 6) return; if (Array.isArray(v)) { v.forEach(x => walk(x, d + 1)); return } const lab = v.label || v.chart; if (typeof v.ref === 'string' && /(chart \(|^drawings on )/i.test(String(lab || '')) && !out.some(([r]) => r === v.ref)) out.push([v.ref, lab]); for (const x of Object.values(v)) walk(x, d + 1) }
  walk(ctx, 0)
  return out
}
const MUTATIONS = {
  nothing: (env) => ({ ...env, disposition: 'answer', reply: 'Done.', ops: [], question: null }),
  // the first op's target moved to ANOTHER chart's entry of the same kind (same ref initial, another label)
  otherChart: (env, req) => {
    const labels = chartRefs(req.body.context)
    const ops = env.ops || []
    const i = ops.findIndex(o => labels.some(([r]) => r === o.target))
    if (i < 0) return null
    const mine = labels.find(([r]) => r === ops[i].target)
    const other = labels.find(([r, l]) => r[0] === mine[0][0] && l !== mine[1])
    if (!other) return null
    return { ...env, ops: ops.map((o, k) => (k === i ? { ...o, target: other[0] } : o)) }
  },
  dropLast: (env) => ((env.ops || []).length > 1 ? { ...env, ops: env.ops.slice(0, -1) } : null),
}
// a mistake the rails cannot see (the words name an indicator, not which one): RSI planned as MACD
const wrongIndicator = (env) => ({ ...env, ops: (env.ops || []).map(o => (o.args?.defId === 'rsi' ? { ...o, args: { ...o.args, defId: 'macd' } } : o)) })
// known-wrong answers the PRODUCT neutralises or the board cannot see (2026-11-23): a rail re-targets the plan to the chart the
// words name, the moved op was a no-op on that chart, or the dropped op has no effect on the board snapshot (a panel opens)
const NEUTRAL = {
  'rb-s05:otherChart': 'rail: "this one" re-targets to the clicked chart',
  'rb-m02:otherChart': 'the moved op (MSFT to daily) is already so',
  'rb-m09:dropLast': 'blind spot: watchlist.open opens a panel, outside the board snapshot',
  'e2-t11:otherChart': 'rail: the words name the chart',
  'e2-b05:otherChart': 'rail: "this one" re-targets to the clicked chart',
  'e2-fc07:otherChart': 'rail: "this one" re-targets to the clicked chart',
}

describe('known-wrong answers score failure', () => {
  for (const f of FILES) {
    const data = fs.existsSync(path.join(DIR, f)) ? load(f) : { cases: [] }
    const spec = specFor(SPEC, data)
    data.cases.filter(x => !ONLY || ONLY.has(x.id)).forEach((c, idx) => {
      const names = Object.keys(MUTATIONS)
      const want = names[idx % names.length]
      it(`${f} ${c.id} (${want})`, async () => {
        let used = want
        const mutate = (turn, env, req) => {
          if (turn !== 0) return null
          const m = MUTATIONS[used](env, req) || MUTATIONS.nothing(env, req)
          if (!MUTATIONS[used](env, req)) used = 'nothing'
          return m
        }
        const { rows } = await evaluateCase({ spec, c, arm: 'B', responderFor: () => expectedResponder({ mutate }) })
        const r0 = rows[0]
        // the wrong answer never reached the board when: a deterministic reader answered the turn (no model call), the
        // expectation is not executable here (oracle_invalid), or the case is a recorded blind spot / rail catch (NEUTRAL)
        // (an expectation of NO change with no ops: answering with nothing is the right answer, there is nothing to get wrong)
        const e0 = stepsOf(c)[0].expect || {}
        if (!['act', 'propose', 'clarify'].includes(e0.kind) && !(e0.ops || []).length) return
        if (r0.lane === 'deterministic' || r0.outcome === 'oracle_invalid' || r0.lookup || r0.blocked || NEUTRAL[`${c.id}:${used}`]) return
        expect(`${r0.key} ${used} ${r0.outcome}`).not.toMatch(/ success$/)
      }, 120000)
    })
  }
})

// ── rounds, the bank, and no teacher forcing ────────────────────────────────────────────────────────────────
describe('rounds without teacher forcing', () => {
  const data = load('e2eBench.v1.json')
  const spec = specFor(SPEC, data)
  const byId = (id) => data.cases.find(c => c.id === id)

  it('a request key is stable across mounts and ignores the conversation id', () => {
    const b = { message: 'x', context: { a: 1 }, conversationId: 'one' }
    expect(requestKey('A', b, [])).toBe(requestKey('A', { ...b, conversationId: 'two' }, []))
    expect(requestKey('A', b, [])).not.toBe(requestKey('B', b, []))
    expect(requestKey('A', b, [])).not.toBe(requestKey('A', b, [{ role: 'member', text: 'y' }]))
  })

  it('round by round: a miss is written out and stops the dialogue; the next round runs on the board turn 1 left', async () => {
    const c = byId('e2-t02')                                  // 2 turns
    const exp = expectedResponder({ mutate: (turn, env) => (turn === 0 ? wrongIndicator(env) : null) })
    const bank = new Map()
    const roundOf = async () => { const collect = new Map(); const r = await evaluateCase({ spec, c, arm: 'B', bank, collect, catalogs: new Map() }); return { rows: r.rows, items: [...collect.values()] } }
    const r1 = await roundOf()
    expect(r1.rows.map(r => r.outcome)).toEqual(['pending', 'pending'])
    expect(r1.items).toHaveLength(1)
    expect(r1.items[0]).toMatchObject({ mode: 'nl1', caseId: 'e2-t02', turn: 0 })
    expect(r1.items[0].selection && r1.items[0].reroutes).toBeTruthy()     // NL-1 reroute tables for the runner
    // "the paid run": answer each written request as the (wrong) model would, as a runner results row
    const pay = (items) => { for (const it2 of items) bank.set(it2.key, { key: it2.key, envelope: exp({ body: it2.body, history: it2.history, turn: it2.turn, step: stepsOf(c)[it2.turn], host: hostNow }).envelope, model_ms: 900, rounds: 1, usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 1000, cache_write_tokens: 0, model_calls: 1 } }) }
    // the wrong answer needs the board's own targets: a mount of the same board gives them (same fixture, same refs)
    let hostNow = (await mountCase({ spec, c, arm: 'B', responder: () => ({ miss: true, status: 503 }) })).built.host
    pay(r1.items)
    // the panel may need more than one round for turn 1 (its client repair is a new model request): pay until it is scored
    let r2 = await roundOf()
    for (let k = 0; k < 3 && r2.rows[0].outcome === 'pending'; k++) { expect(r2.items[0].turn).toBe(0); pay(r2.items); r2 = await roundOf() }
    expect(r2.rows[0].outcome).toBe('wrong_action')                         // turn 1 really went wrong (MACD, not RSI)
    expect(r2.rows[1].outcome).toBe('pending')
    expect(r2.items).toHaveLength(1)
    expect(r2.items[0].turn).toBe(1)
    // turn 2's request carries what turn 1 REALLY did (its receipt names MACD), not the expected RSI
    const h = JSON.stringify(r2.items[0].history)
    expect(h).toMatch(/MACD/i)
    expect(r2.items[0].body.message).toBe(stepsOf(c)[1].say)
  }, 180000)

  it('a client repair REPLACES the first plan: the executed plan and the score follow what ran (AUDIT 11-23)', async () => {
    const c = byId('e2-p02')                                  // AMD to the hourly + shrink its RSI pane
    const exp = expectedResponder({ repairable: true, mutate: (turn, env, req) => {
      // a REAL refusal on every branch: the first plan names a pane this chart does not have ("blurple"), NL-1's preflight
      // refuses that op, the panel sends its ONE repair, and the repair answer drops the resize (the 11-23 recorded shape)
      if (req.body.repair) return { ...env, ops: env.ops.filter(o => o.action !== 'pane.resize') }
      return { ...env, ops: env.ops.map(o => (o.action === 'pane.resize' ? { ...o, args: { ...o.args, pane: 'blurple' } } : o)) }
    } })
    const { rows } = await evaluateCase({ spec, c, arm: 'B', responderFor: () => exp })
    expect(rows[0].requests).toBe(2)                         // the first call and its repair
    expect(rows[0].planned).toEqual(['chart.setTimeframe'])   // the repair's plan, never first + repair concatenated
    expect(rows[0].executed).toEqual(['chart.setTimeframe'])  // what the runtime committed
    // the timeframe landed, the resize did not, on the SAME chart: a partial, not a wrong change
    expect(['partial_silent', 'partial_reported']).toContain(rows[0].outcome)
    expect(rows[0].why).toMatch(/partly done: chart:cl/)
    // a panel that SAYS what the repair dropped (the NL-1 preflight fix's fixed "Not done: …" line) scores it as reported;
    // a panel that does not (master before that fix) scores the same turn as a silent drop
    expect(rows[0].outcome).toBe(/Not done:/.test(rows[0].reply) ? 'partial_reported' : 'partial_silent')
    expect(rows[0].flags.includes('silentDrop')).toBe(rows[0].outcome === 'partial_silent')
  }, 180000)

  it('a correction branch follows what turn 1 actually did', async () => {
    const c = byId('e2-b09')
    const seen = []
    const exp = expectedResponder({ mutate: (turn, env, req) => { seen.push(req.body.message); return turn === 0 ? wrongIndicator(env) : null } })
    const { rows } = await evaluateCase({ spec, c, arm: 'B', responderFor: () => exp })
    expect(rows[0].outcome).toBe('wrong_action')
    expect(seen).toContain('fix that, rsi on xle')                          // the fail branch, not the follow-up
    expect(seen).not.toContain('make it a 21 period')
    expect(rows[1].outcome).not.toBe('pending')                             // judged from the first board
  }, 180000)
})

// ── the shared pipeline's new ASKS are scored as asks, never as drops (side-by-side ruling #2692, G1/G2 gate #2697) ──────────
// Inline cases (not corpus rows): what the panel itself does with these words on the deterministic path (arm A) and with an
// expected clarify on NL-1 (arm B). A question with nothing changed must score `success` for a clarify expectation, and the
// headline columns must stay empty for it.
describe('the pipeline asks score as asks', () => {
  const data = load('e2eBench.v1.json')
  const spec = specFor(SPEC, data)
  const NEVER = ['chart.setSymbol', 'chart.resetDefaults', 'widget.remove', 'indicator.remove']
  const CASES = [
    // side by side with tickers no chart shows: which chart they go beside is unclear -> ASKED (add beside, or replace)
    { id: 'ask-sbs-1', fx: 'rb_solo', text: 'show nvda and amd side by side', expect: { kind: 'clarify', never: NEVER } },
    // G1: "this one" with nothing clicked has no grounded referent -> ASKED, nothing changes
    { id: 'ask-g1-1', fx: 'rb_pair_nosel', text: 'Change MSFT to the 1-hour timeframe, add a 20 EMA to it, and do the same on this one', expect: { kind: 'clarify', never: NEVER } },
  ]
  for (const arm of ['A', 'B']) {
    for (const c of CASES) {
      it(`${arm} ${c.id}: "${c.text}"`, async () => {
        const { rows } = await evaluateCase({ spec, c, arm, responderFor: () => expectedResponder() })
        const r = rows[0]
        if (env.AGENT_E2E_DEBUG) console.log(`ASKCASE ${arm} ${c.id} ${r.outcome} asked=${r.asked} lane=${r.lane} | ${r.reply}`)
        expect([r.outcome, r.asked]).toEqual(['success', true])
        expect(r.flags.filter(f => f === 'silentDrop' || f === 'wrongChartWrite')).toEqual([])
      }, 120000)
    }
  }
})

// ── the SIMULATED MEMBER's pick on a card (testing/e2eMember.memberPick, AUDIT 11-24): one test per branch ────────────
describe('member pick', () => {
  const charts = [{ ref: 'cl', label: 'Left chart (META)', symbol: 'META' }, { ref: 'cr', label: 'Right chart (NVDA)', symbol: 'NVDA' }]
  const ce01 = { charts, expectedRefs: ['cl'] }                                   // e2-ce01 turn 2: only META changes
  it('match: the choice naming only the expected chart, or an Apply whose text names only it', () => {
    expect(memberPick({ ...ce01, choices: ['Both charts', 'Just Left chart (META)', 'Cancel'] })).toMatchObject({ action: 'choose', label: 'Just Left chart (META)', named: ['cl'] })
    expect(memberPick({ ...ce01, cardLines: 'Left chart (META): Switched timeframe to Daily' })).toMatchObject({ action: 'apply', named: ['cl'] })
    expect(memberPick({ ...ce01, choices: ['Just META', 'Cancel'] })).toMatchObject({ action: 'choose', label: 'Just META' })   // a unique ticker names its chart
  })
  it('no match: Cancel, and the turn scores cancelled (safe, incomplete: never success, never WRONG)', () => {
    expect(memberPick({ ...ce01, choices: ['Both charts', 'Keep both as they are', 'Cancel'] })).toMatchObject({ action: 'cancel' })
    const B2 = (c) => ({ charts: c, widgets: {}, layouts: null, watchlists: {}, drawings: {}, residue: false })
    const pre2 = B2({ cl: { tf: 'W' }, cr: { tf: 'W' } })
    const r = scoreTurn({ e: { kind: 'act', ops: [{ a: 'chart.setTimeframe' }] }, pre: pre2, mid: pre2, post: pre2, oracles: [B2({ cl: { tf: 'D' }, cr: { tf: 'W' } })], pick: { action: 'cancel', why: 'no option matches' } })
    expect([r.outcome, r.flags.includes('wrongChartWrite'), r.flags.includes('silentDrop')]).toEqual(['cancelled', false, false])
  })
  it('a lying card (it named one chart, another changed) is a WRONG-CHART-WRITE whatever was picked', () => {
    expect(lyingCharts(['cl'], ['cl', 'cr'])).toEqual(['cr'])
    expect(lyingCharts(['cl'], ['cl'])).toEqual([])
    const B2 = (c) => ({ charts: c, widgets: {}, layouts: null, watchlists: {}, drawings: {}, residue: false })
    const pre2 = B2({ cl: { tf: 'W' }, cr: { tf: 'W' } }), both = B2({ cl: { tf: 'D' }, cr: { tf: 'D' } })
    const r = scoreTurn({ e: { kind: 'act', ops: [{ a: 'chart.setTimeframe' }] }, pre: pre2, mid: pre2, post: both, oracles: [both], lying: ['cr'] })
    expect([r.outcome, r.flags.includes('wrongChartWrite')]).toEqual(['wrong_chart', true])   // even though the board matched
  })
  it('an Apply (or a choice) naming a chart the case does not expect changed is never picked', () => {
    expect(memberPick({ ...ce01, cardLines: 'Left chart (META): Daily | Right chart (NVDA): Daily' })).toMatchObject({ action: 'cancel' })
    expect(memberPick({ ...ce01, choices: ['Right chart (NVDA)', 'Cancel'] })).toMatchObject({ action: 'cancel' })
    expect(memberPick({ ...ce01, cardLines: 'Right chart (NVDA): Switched timeframe to Daily' })).toMatchObject({ action: 'cancel' })
  })
  it('reads only UCT text: the model reply is not an input (a card with no chart named, on a case that changes no chart, is applied)', () => {
    expect(memberPick({ charts, expectedRefs: [], targetWords: ['Swing'], cardLines: 'Add NFLX to Swing' })).toMatchObject({ action: 'apply' })
    expect(memberPick({ charts, expectedRefs: [], targetWords: ['Swing'], cardLines: 'Add NFLX to Momentum' })).toMatchObject({ action: 'cancel' })
  })
})

// ── the save-conflict host (409 workspace_conflict, sticky) ─────────────────────────────────────────────────
describe('save conflict host', () => {
  const data = load('e2eBench.v1.json')
  const spec = specFor(SPEC, data)
  it('refuses a save that carries a pane-size change, then every later save; an unchanged board saves', async () => {
    const b = buildBoard(spec, 'e2_solo_rsi', { conflict: 'paneSizes' })
    expect(await b.host.persist()).toEqual({ ok: true })
    const w = b.state.widgets.find(x => x.id === 'c1')
    b.state.widgets = b.state.widgets.map(x => (x === w ? { ...w, opts: { ...w.opts, settings: { ...w.opts.settings, paneSizes: { 'inst:rsi:1': 0.5 } } } } : x))
    expect(await b.host.persist()).toEqual({ ok: false, conflict: true, reason: 'conflict' })
    expect(snapshot(b).residue).toBe(true)
    b.state.widgets = b.state.widgets.map(x => (x.id === 'c1' ? w : x))
    expect(await b.host.persist()).toMatchObject({ ok: false, conflict: true })    // sticky until a reload
    expect(snapshot(b).residue).toBe(false)
  })
})

// ── the scorer (pure) ───────────────────────────────────────────────────────────────────────────────────────
describe('scoreTurn', () => {
  const B = (charts, extra = {}) => ({ charts, widgets: {}, layouts: null, watchlists: {}, drawings: {}, residue: false, ...extra })
  const pre = B({ a: { tf: 'D' }, b: { tf: 'D' } })
  const want = B({ a: { tf: 'W' }, b: { tf: 'D' } })
  const act = { kind: 'act', ops: [{ a: 'chart.setTimeframe' }] }
  it('outcomes', () => {
    expect(scoreTurn({ e: act, pre, mid: want, post: want, oracles: [want] }).outcome).toBe('success')
    expect(scoreTurn({ e: act, pre, mid: B({ a: { tf: 'D' }, b: { tf: 'W' } }), post: B({ a: { tf: 'D' }, b: { tf: 'W' } }), oracles: [want] }).outcome).toBe('wrong_chart')
    expect(scoreTurn({ e: act, pre, mid: pre, post: pre, oracles: [want], reply: 'Switched to weekly' }).outcome).toBe('refusal')
    expect(scoreTurn({ e: act, pre, mid: pre, post: pre, oracles: [want], reply: 'Switched to weekly' }).flags).toContain('silent')
    expect(scoreTurn({ e: act, pre, mid: pre, post: pre, oracles: [want], asked: true }).outcome).toBe('unnecessary_ask')
    expect(scoreTurn({ e: { kind: 'clarify' }, pre, mid: want, post: want }).outcome).toBe('missed_ask')
    const two = B({ a: { tf: 'W' }, b: { tf: 'W' } })
    expect(scoreTurn({ e: act, pre, mid: want, post: want, oracles: [two], reply: 'Weekly on a.' }).outcome).toBe('partial_silent')
    expect(scoreTurn({ e: act, pre, mid: want, post: want, oracles: [two], reply: "Weekly on a. I couldn't change b." }).outcome).toBe('partial_reported')
    // a destructive change that ran before any card
    const gone = B({ a: { tf: 'D' } })
    expect(scoreTurn({ e: act, pre, mid: gone, post: gone, oracles: [want] }).outcome).toBe('unsafe')
    expect(scoreTurn({ e: { ...act, kind: 'propose' }, pre, mid: want, post: want, oracles: [want] }).outcome).toBe('unsafe')
  })
  it('one chart, two changes, one landed: partial (not wrong); a leaf the oracle never moved: wrong', () => {
    const pre2 = B({ a: { tf: 'D', pane: 0 } })
    const want2 = B({ a: { tf: 'W', pane: 1 } })
    expect(scoreTurn({ e: act, pre: pre2, mid: B({ a: { tf: 'W', pane: 0 } }), post: B({ a: { tf: 'W', pane: 0 } }), oracles: [want2], reply: 'Switched to weekly' }).outcome).toBe('partial_silent')
    expect(scoreTurn({ e: act, pre: pre2, mid: B({ a: { tf: 'W', pane: 0 } }), post: B({ a: { tf: 'W', pane: 0 } }), oracles: [want2], reply: 'UCT only lets me change one pane at a time — ask me to resize it next' }).outcome).toBe('partial_reported')
    expect(scoreTurn({ e: act, pre: pre2, mid: B({ a: { tf: 'M', pane: 0 } }), post: B({ a: { tf: 'M', pane: 0 } }), oracles: [want2] }).outcome).toBe('wrong_action')
  })
  it('headline flags: a wrong-chart write and a silent drop are flagged whatever the outcome', () => {
    const other = B({ a: { tf: 'D' }, b: { tf: 'W' } })
    expect(scoreTurn({ e: act, pre, mid: other, post: other, oracles: [want] }).flags).toContain('wrongChartWrite')
    const both = B({ a: { tf: 'W' }, b: { tf: 'W' } })
    expect(scoreTurn({ e: act, pre, mid: both, post: both, oracles: [want] }).flags).toContain('wrongChartWrite')   // right + an extra write
    expect(scoreTurn({ e: act, pre, mid: want, post: want, oracles: [want] }).flags).not.toContain('wrongChartWrite')
    expect(scoreTurn({ e: act, pre, mid: want, post: want, oracles: [both], reply: 'Weekly on a.' }).flags).toContain('silentDrop')
    expect(scoreTurn({ e: act, pre, mid: want, post: want, oracles: [both], reply: 'Not done: one part of your request (timeframe) — it failed.' }).flags).not.toContain('silentDrop')
    expect(scoreTurn({ e: act, pre, mid: pre, post: pre, oracles: [want], reply: 'Switched to weekly' }).flags).toContain('silentDrop')
  })
  it('semantic view (side by side): geometry and minted ids do not matter; an original chart changing does', () => {
    const before = { charts: { c1: { symbol: 'AAPL', tf: 'D' } }, widgets: { c1: { type: 'chart', x: 0, y: 0, w: 24, h: 20 } }, layouts: null, watchlists: {}, drawings: {} }
    const added = (x, id) => ({ ...before, charts: { c1: before.charts.c1, [id]: { symbol: 'NVDA', tf: 'D' } }, widgets: { c1: { type: 'chart', x: 0, y: 0, w: x, h: 20 }, [id]: { type: 'chart', x, y: 0, w: 24 - x, h: 20 } } })
    const ids = new Set(['c1'])
    expect(JSON.stringify(semanticView(added(12, 'w-chart-1'), ids))).toBe(JSON.stringify(semanticView(added(16, 'w-chart-7'), ids)))
    const replaced = { ...before, charts: { c1: { symbol: 'NVDA', tf: 'D' } } }
    expect(JSON.stringify(semanticView(replaced, ids))).not.toBe(JSON.stringify(semanticView(added(12, 'w-chart-1'), ids)))
  })
  it('alsoOk: a clarify case may accept a named change; any other change is still a missed ask', () => {
    const both = B({ a: { tf: 'D' }, b: { tf: 'D' }, n: { tf: 'D' } })
    const e = { kind: 'clarify', alsoOk: [[{ a: 'widget.addCharts' }]] }
    expect(scoreTurn({ e, pre, mid: both, post: both, oracles: [both] })).toMatchObject({ outcome: 'success', flags: [] })
    expect(scoreTurn({ e, pre, mid: want, post: want, oracles: [both] }).outcome).toBe('missed_ask')
    expect(scoreTurn({ e, pre, mid: pre, post: pre, oracles: [both], asked: true }).outcome).toBe('success')
  })
  it('crossed plan: a click + a named chart, two different changes swapped between them, is a WRONG-CHART-WRITE', () => {
    const pre2 = B({ a: { tf: 'D', rsi: 0 }, b: { tf: 'D', rsi: 0 } })
    const want2 = B({ a: { tf: 'W', rsi: 0 }, b: { tf: 'D', rsi: 1 } })          // "this one (a) weekly, rsi on b"
    const crossed = B({ a: { tf: 'D', rsi: 1 }, b: { tf: 'W', rsi: 0 } })        // each change on the other chart
    const r = scoreTurn({ e: act, pre: pre2, mid: crossed, post: crossed, oracles: [want2] })
    expect([r.outcome, r.flags.includes('wrongChartWrite')]).toEqual(['wrong_chart', true])
    const half = B({ a: { tf: 'W', rsi: 0 }, b: { tf: 'W', rsi: 0 } })          // one right, the other change on the wrong chart
    const h = scoreTurn({ e: act, pre: pre2, mid: half, post: half, oracles: [want2] })
    expect([h.outcome, h.flags.includes('wrongChartWrite')]).toEqual(['wrong_chart', true])
    expect(scoreTurn({ e: act, pre: pre2, mid: want2, post: want2, oracles: [want2] }).flags).not.toContain('wrongChartWrite')
  })
  it('vague "fix that" (P0.2): a ticker change is unsafe, a silent revert is wrong_action, an ask (or a card) is right', () => {
    const p0 = B({ a: { symbol: 'NVDA', tf: 'W' } })
    const e = { kind: 'clarify', unsafeIf: ['symbol'], changedOutcome: 'wrong_action' }
    const resym = B({ a: { symbol: 'NVDL', tf: 'W' } }), revert = B({ a: { symbol: 'NVDA', tf: 'D' } })
    expect(scoreTurn({ e, pre: p0, mid: resym, post: resym }).outcome).toBe('unsafe')
    expect(scoreTurn({ e, pre: p0, mid: revert, post: revert }).outcome).toBe('wrong_action')
    expect(scoreTurn({ e, pre: p0, mid: p0, post: p0, asked: true }).outcome).toBe('success')
  })
  it('explicit revert, crossed (e2-ce01 turn 2): NVDA reverted = wrong_chart + WRONG-CHART-WRITE; an ask, or META back alone, is right', () => {
    const t1 = B({ cl: { tf: 'W' }, cr: { tf: 'W' } })                       // after "make both charts weekly"
    const want3 = B({ cl: { tf: 'D' }, cr: { tf: 'W' } })                    // META back, NVDA keeps its weekly
    const e = { kind: 'act', clarifyOk: true, ops: [{ a: 'chart.setTimeframe' }] }
    const nvdaBack = B({ cl: { tf: 'W' }, cr: { tf: 'D' } }), bothBack = B({ cl: { tf: 'D' }, cr: { tf: 'D' } })
    for (const b of [nvdaBack, bothBack]) {
      const r = scoreTurn({ e, pre: t1, mid: b, post: b, oracles: [want3], notOnIds: ['cr'] })
      expect([r.outcome, r.flags.includes('wrongChartWrite')]).toEqual(['wrong_chart', true])
    }
    expect(scoreTurn({ e, pre: t1, mid: t1, post: t1, oracles: [want3], notOnIds: ['cr'], asked: true }).outcome).toBe('success')
    const ok = scoreTurn({ e, pre: t1, mid: want3, post: want3, oracles: [want3], notOnIds: ['cr'] })
    expect([ok.outcome, ok.flags]).toEqual(['success', []])
  })
  it('a save conflict: right only with no residue AND the refusal said', () => {
    const e = { ...act, blocked: ['chart.setTimeframe'] }
    expect(scoreTurn({ e, pre, mid: pre, post: pre, oracles: [pre], reply: "the save was not confirmed (conflict), so it is not done" }).outcome).toBe('success')
    expect(scoreTurn({ e, pre, mid: pre, post: pre, oracles: [pre], reply: 'Done.' }).outcome).toBe('partial_silent')
    expect(scoreTurn({ e, pre, mid: want, post: { ...want, residue: true }, oracles: [pre], reply: 'failed (conflict)' }).outcome).toBe('residue')
  })
  it('paired McNemar: 10 discordant all one way is significant, 3 is not', () => {
    const rows = (oks) => oks.map((ok, i) => ({ key: `k${i}`, outcome: ok ? 'success' : 'wrong_action' }))
    expect(paired(rows(Array(10).fill(true)), rows(Array(10).fill(false))).p).toBeLessThan(0.01)
    expect(paired(rows([true, true, true]), rows([false, false, false])).p).toBeGreaterThan(0.2)
    expect(armTable([{ key: 'a', dialogue: 'd', outcome: 'success', lane: 'model', modelMs: 10, rounds: 1, usd: 0.01, requests: 1 }]).successPct).toBe(100)
  })
  void compareBoards; void bankResponder
})

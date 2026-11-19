// app/src/components/chart/builder/authoring/scriptAnswer.test.js
//
// AN ANSWER THAT IS A SCRIPT (`scriptAnswer.js`): the engine judges it, a refusal goes back a
// bounded number of times, and the last verdict is shown as it is. The door half is
// `tests/test_script_conversation.py`.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  verdictFrom, refusalOf, sameRefusals, checkScript, settleScript, scriptEntry,
  MAX_REPAIR_ROUNDS, SCRIPT_REFUSAL_LIMITS, RUNS_STATES, drawingLossOf, DRAWINGS_NOTE, LOST_DRAWINGS_HEADLINE,
  PENDING_RECHECKS, PENDING_RECHECK_MS, STILL_CHECKING_LINE, isChecking, scriptNeedsFixing, WAITS_ON_A_LIVE_CHART_LINE,
  STILL_CHECKING_HEADLINE, UNCHECKED_STATE, latchAnswerAdmission, PENDING_REASON_LINES, PENDING_REASONS_THAT_END_THE_WAIT,
} from './scriptAnswer'
import { RUN, STOPPED_HEADLINE, CHECKING_HEADLINE, WAITING_HEADLINE, NOT_RUN_HEADLINE, runHereWhenLanded, verdictOnChart } from '../runsHere'
import { recipeBars, recipeContext, RUN_STOP_PROBES } from '../../supportLoop/assistantRecipes'
import { inspectSource } from '../PineBox'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import { editorStatus } from '../editorStatus'

/** The engine modules `checkScript` loads, with nothing to fetch (the lists are allowed in `beforeAll`). */
const realEngine = async () => ({ inspectSource, memberPaneDefinition, editorStatus, prepare: async () => {}, runHereWhenLanded, verdictOnChart })
import { DRAWING_NOTE_NAME } from '../../engine/ast/objectLoss'
import { converseBody, converseTurn, scriptOf, scriptRefusalBlock, ACCEPTS, ACCEPTS_SCRIPT, SCRIPT_LIMITS, admissionOf, ADMISSION_LIMITS } from './converseClient'
import { modelTurn } from './authoringSession'
import { newAuthoringState } from './index'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import * as runtimeKill from '../../engine/runtimeKill'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
// (a script is run on a chart only where member scripts are drawn at all: `runsHere.js` asks the gate first)
vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')

const EXAMPLES = path.resolve(process.cwd(), 'src/components/chart/supportLoop/assistantExamples')
const TABLE = fs.readFileSync(path.join(EXAMPLES, 'table-summary.pine'), 'utf8')
const LOOP = fs.readFileSync(path.join(EXAMPLES, 'loops-and-arrays.pine'), 'utf8')
const BROKEN = '//@version=5\nindicator("x", overlay=true)\nplot(ta.not_a_function(close, 14), "x")\n'

const runs = { runs: true, attaches: true, state: 'runs', lane: 'host', headline: 'Runs on the chart', withheld: [], notes: [], errors: [] }
const refused = (...errors) => ({ runs: false, attaches: false, state: 'not-yet', lane: 'host', headline: 'Not yet: a built-in this chart does not have',
  withheld: errors, notes: [], errors })
const answer = (pine, reply = 'A table of the ATR.') => ({ ok: true, script: { name: 'ATR table', pine, round: 0 }, reply })

describe('the verdict is the status panel\'s own', () => {
  it('a script that attaches and runs fully runs; its notes are kept and are not refusals', () => {
    const v = verdictFrom({ state: 'runs-with-notes', headline: 'Runs on the chart, with 1 note',
      items: [{ severity: 'note', name: 'Drawn bar by bar', reason: 'It is run the way TradingView runs it.' }] }, { ok: true, lane: 'runtime' })
    expect(v.runs).toBe(true)
    expect(v.headline).toBe('Runs on the chart, with 1 note')
    expect(v.notes).toEqual(['Drawn bar by bar: It is run the way TradingView runs it.'])
    expect(v.errors).toEqual([])
    expect(v.lane).toBe('runtime')
  })

  it('a withheld value is not "runs", and its line and the engine\'s sentence are what goes back', () => {
    const v = verdictFrom({ state: 'runs-withheld', headline: 'Runs, 1 value withheld (not guessed)',
      items: [{ severity: 'withheld', line: 13, reason: '`hline` is not drawn on this chart' }] }, { ok: true })
    expect(v.runs).toBe(false)
    expect(v.attaches).toBe(true)
    expect(v.withheld).toEqual(['line 13: `hline` is not drawn on this chart'])
    expect(v.errors).toEqual(v.withheld)
  })

  it('a script that does not attach says why in the engine\'s words, even with no item', () => {
    const v = verdictFrom({ state: 'not-yet', headline: 'Not yet: Nothing a chart can draw', items: [] },
      { ok: false, reason: 'the only outputs that translate are helper series', runtimeDeclined: { code: 'runtime:nothing-drawn', why: 'the script declares nothing a chart row draws' } })
    expect(v.runs).toBe(false)
    expect(v.errors).toEqual(['the script declares nothing a chart row draws'])
  })

  it('a state it does not know is never "runs"', () => {
    for (const state of ['saved-stale', 'unknown', undefined, 'not-yet']) {
      expect(verdictFrom({ state, headline: 'x', items: [] }, { ok: true }).runs).toBe(false)
    }
    expect(RUNS_STATES).toEqual(['runs', 'runs-with-notes'])
  })

  it('what goes back is bounded', () => {
    const items = Array.from({ length: 20 }, (_v, i) => ({ severity: 'withheld', line: i + 1, reason: 'x'.repeat(900) }))
    const v = verdictFrom({ state: 'not-yet', headline: 'Not yet', items }, { ok: false })
    expect(v.errors).toHaveLength(SCRIPT_REFUSAL_LIMITS.maxErrors)
    expect(v.errors.every((e) => e.length <= SCRIPT_REFUSAL_LIMITS.maxChars)).toBe(true)
    expect(refusalOf('x', runs, 1)).toBeNull()                            // nothing to send for a script that runs
    expect(refusalOf('', v, 1)).toBeNull()
    expect(refusalOf(BROKEN, v, 2)).toEqual({ pine: BROKEN, errors: v.errors, round: 2 })
    expect(sameRefusals(refused('a', 'b'), refused('a', 'b'))).toBe(true)
    expect(sameRefusals(refused('a', 'b'), refused('a', 'c'))).toBe(false)
    expect(sameRefusals(refused('a'), refused('a', 'b'))).toBe(false)
  })
})

describe('the REAL engine, on a script an assistant would write', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })

  it('a table script runs; a loop over an array runs on the bar-by-bar lane', async () => {
    const table = await checkScript(TABLE)
    expect(table.runs).toBe(true)
    expect(table.errors).toEqual([])
    const loop = await checkScript(LOOP)
    expect(loop.runs).toBe(true)
    expect(loop.lane).toBe('runtime')
  }, 120_000)

  it('a script that calls a built-in this engine does not have does not run, and says which line', async () => {
    const v = await checkScript(BROKEN)
    expect(v.runs).toBe(false)
    expect(v.errors.length).toBeGreaterThan(0)
    expect(v.errors.join(' ')).toMatch(/not_a_function|line 3/)
  }, 120_000)

  it('a check that cannot be made is never read as "runs"', async () => {
    const v = await checkScript(TABLE, { load: async () => { throw new Error('the engine did not load') } })
    expect(v.runs).toBe(false)
    expect(v.state).toBe('unchecked')
    expect(v.headline).toBe('This script could not be checked here')
  })
})

describe('checked, repaired a bounded number of times, and the last verdict shown as it is', () => {
  it('a script that runs is not sent back at all, and the entry leads with the engine\'s verdict', async () => {
    const repair = vi.fn()
    const out = await settleScript(answer(TABLE), repair, { check: async () => runs })
    expect(repair).not.toHaveBeenCalled()
    expect(out.rounds).toBe(0)
    expect(out.entry.kind).toBe('script')
    expect(out.entry.lines[0]).toBe('Runs on the chart')                    // the engine's headline, first
    expect(out.entry.said).toBe('A table of the ATR.')                      // the assistant's words, labelled as its own
    expect(out.entry.script).toEqual({ name: 'ATR table', pine: TABLE, runs: true, attaches: true, state: 'runs' })
  })

  it('a refused script goes back with the engine\'s words, and the repair that runs is what is shown', async () => {
    const verdicts = [refused('line 3: not a built-in here'), runs]
    const repair = vi.fn(async () => answer(TABLE, 'Fixed.'))
    const out = await settleScript(answer(BROKEN), repair, { check: async () => verdicts.shift() })
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0][0]).toEqual({ pine: BROKEN, errors: ['line 3: not a built-in here'], round: 1 })
    expect(out.rounds).toBe(1)
    expect(out.entry.script.pine).toBe(TABLE)
    expect(out.entry.script.runs).toBe(true)
  })

  it('never more than the bound, and each round is numbered', async () => {
    let n = 0
    const check = async () => refused(`line ${n += 1}: something else`)
    const repair = vi.fn(async (r) => answer(`${BROKEN}// round ${r.round}\n`))
    const out = await settleScript(answer(BROKEN), repair, { check })
    expect(repair).toHaveBeenCalledTimes(MAX_REPAIR_ROUNDS)
    expect(repair.mock.calls.map((c) => c[0].round)).toEqual([1, 2])
    expect(out.rounds).toBe(MAX_REPAIR_ROUNDS)
    expect(out.entry.script.runs).toBe(false)
    expect(out.entry.lines[0]).toBe('Not yet: a built-in this chart does not have')
    expect(out.entry.lines.at(-1)).toBe('The assistant rewrote it 2 times and the chart still does not run it fully.')
  })

  it('stops as soon as a repair changes nothing', async () => {
    const repair = vi.fn(async () => answer(`${BROKEN}// again\n`))
    const out = await settleScript(answer(BROKEN), repair, { check: async () => refused('line 3: the same thing') })
    expect(repair).toHaveBeenCalledTimes(1)                                 // the same refusals twice running is the end
    expect(out.rounds).toBe(1)
    expect(out.entry.lines.at(-1)).toBe('The assistant rewrote it once and the chart still does not run it fully.')
    const same = vi.fn(async () => answer(BROKEN))
    const verdicts = [refused('a'), refused('b')]
    expect((await settleScript(answer(BROKEN), same, { check: async () => verdicts.shift() })).rounds).toBe(1)
    expect(same).toHaveBeenCalledTimes(1)                                   // the same script back is the end too
  })

  it.each([
    ['the door refuses the repair', { ok: false, gate: 'script:rounds', reason: 'no' }],
    ['the door answers without a script', { ok: true, reply: 'I cannot.' }],
    ['nothing comes back', null],
  ])('%s: the last checked verdict stands', async (_name, back) => {
    const out = await settleScript(answer(BROKEN), async () => back, { check: async () => refused('line 3: x') })
    expect(out.rounds).toBe(0)
    expect(out.entry.script.pine).toBe(BROKEN)
    expect(out.entry.script.runs).toBe(false)
  })

  it('an entry never says more than the verdict does', () => {
    const e = scriptEntry({ script: { name: '', pine: BROKEN }, reply: 'It works perfectly.', verdict: refused('line 3: x'), rounds: 0 })
    expect(e.lines).toEqual(['Not yet: a built-in this chart does not have', 'line 3: x'])
    expect(e.said).toBe('It works perfectly.')                             // kept apart, as the assistant's claim
    expect(e.script.runs).toBe(false)
  })
})

describe('the wire', () => {
  const state = newAuthoringState()

  it('ONLY a window that shows a script tells the door it accepts one', () => {
    // ⚰️ 2026-11-19: the word was sent by every sender; the builder's own box got a script it cannot show
    expect(ACCEPTS).not.toContain('script')
    expect(ACCEPTS_SCRIPT).toBe('script')
    expect(converseBody({ message: 'x', state }).accepts).toEqual(['note.by', 'offer'])
    expect(converseBody({ message: 'x', state, gateCtx: { symbol: 'AAPL', tf: 'D' } }).accepts).toEqual(['note.by', 'offer'])
    expect(converseBody({ message: 'x', state, gateCtx: { showsScripts: true } }).accepts).toEqual(['note.by', 'offer', 'script'])
    // exactly true: a truthy word is not a yes
    for (const other of ['true', 1, {}, [], null, undefined, false]) {
      expect(converseBody({ message: 'x', state, gateCtx: { showsScripts: other } }).accepts, String(other)).toEqual(['note.by', 'offer'])
    }
  })

  it('a refusal is sent back bounded', () => {
    expect('script_refusal' in converseBody({ message: 'x', state })).toBe(false)
    const body = converseBody({ message: 'x', state, scriptRefusal: { pine: BROKEN, errors: ['  line 3:\n  not here  ', '', 7], round: 2 } })
    expect(body.script_refusal).toEqual({ pine: BROKEN, errors: ['line 3: not here'], round: 2 })
    expect(scriptRefusalBlock({ pine: BROKEN, errors: [] })).toBeNull()
    expect(scriptRefusalBlock({ pine: 'x'.repeat(SCRIPT_LIMITS.maxChars + 1), errors: ['e'] })).toBeNull()
    expect(scriptRefusalBlock({ pine: BROKEN, errors: ['e'], round: 0 }).round).toBe(1)
    expect(scriptRefusalBlock({ pine: BROKEN, errors: Array(20).fill('e'.repeat(900)) }).errors).toHaveLength(SCRIPT_LIMITS.maxErrors)
  })

  it('keeps the script of an answer as text, a name and a round, and nothing else', async () => {
    const body = {
      ok: true, disposition: 'answer', reply: 'A table.', turn: 'script',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'A table.' },
      script: { name: 'ATR table', pine: TABLE, round: 1, runs: true, verdict: 'Runs fully' },
    }
    const res = await converseTurn({ message: 'x', state, fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) })
    expect(res.script).toEqual({ name: 'ATR table', pine: TABLE, round: 1 })   // the server's opinion of it is not read
    expect(scriptOf({ script: { pine: '   ' } })).toEqual({})
    expect(scriptOf({ script: { pine: 'x'.repeat(SCRIPT_LIMITS.maxChars + 1) } })).toEqual({})
    expect(scriptOf({ script: 'plot(close)' })).toEqual({})
    expect(scriptOf({})).toEqual({})
  })

  it('a script answer becomes ONE entry that leads with the engine\'s verdict, and the working indicator is untouched', async () => {
    const sent = []
    const door = async (args) => {
      sent.push(args)
      return { ok: true, disposition: 'answer', reply: sent.length === 1 ? 'A table.' : 'Fixed.', turn: 'script',
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'x' },
        script: { name: 'T', pine: sent.length === 1 ? BROKEN : TABLE, round: sent.length - 1 }, notUnderstood: [], unavailable: [] }
    }
    const verdicts = [refused('line 3: not a built-in here'), runs]
    const out = await modelTurn(state, () => state, 'Show a table of the ATR', { converse: door, checkScript: async () => verdicts.shift() })
    expect(sent).toHaveLength(2)
    expect(sent[1].scriptRefusal).toEqual({ pine: BROKEN, errors: ['line 3: not a built-in here'], round: 1 })
    expect(out.state).toBeNull()                                            // nothing was applied
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].kind).toBe('script')
    expect(out.entries[0].lines[0]).toBe('Runs on the chart')
    expect(out.entries[0].script.pine).toBe(TABLE)
    expect(out.ok).toBe(true)
  })
})

// ═══ lost drawings are not "runs" ══════════════════════════════════════════════════════

const LOST_SCRIPT = '//@version=5\nindicator("Levels", overlay=true)\nn = input.int(100, "Lookback")\nhh = ta.highest(high, n)\nll = ta.lowest(low, n)\nvar line[] ls = array.new_line(0)\nif barstate.islast\n    for l in ls\n        line.delete(l)\n    array.clear(ls)\n    for lv in array.from(0.0, 0.5, 1.0)\n        array.push(ls, line.new(bar_index - n, hh - (hh - ll) * lv, bar_index, hh - (hh - ll) * lv))\nplot(hh, "Range high")\nplot(ll, "Range low")\n'
const OWNED_SCRIPT = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/supportLoop/assistantRecipes/zigzag-percent.pine'), 'utf8')

describe('a script whose drawings the lane lost has not run, whatever the status headline says', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
  const LOSS = '3 of 3 drawing elements in this script are not supported yet, so what it draws is incomplete.'
  const hostPane = (disclosures) => ({ ok: true, lane: 'host', definition: { compute: { kind: 'ast' }, meta: { disclosures } } })
  const status = { state: 'runs-with-notes', headline: 'Runs on the chart and in alerts, with 1 note',
    items: [{ severity: 'note', name: 'Drawings', reason: LOSS }, { severity: 'note', name: 'Alerts', reason: 'Its alert is under Alerts.' }] }

  it('the loss leads the reasons, is what goes back to the assistant, and is said once', () => {
    const v = verdictFrom(status, hostPane([{ name: 'Drawings', note: LOSS }]))
    expect(v.runs).toBe(false)
    expect(v.attaches).toBe(true)
    expect(v.lostDrawings).toBe(true)
    expect(v.headline).toBe(LOST_DRAWINGS_HEADLINE)
    expect(v.withheld).toEqual([LOSS])
    expect(v.errors).toEqual([LOSS])
    expect(v.notes).toEqual(['Alerts: Its alert is under Alerts.'])              // the loss is not also a note
    expect(refusalOf('x', v, 1)).toEqual({ pine: 'x', errors: [LOSS], round: 1 })
    // a long loss is cut to what one refusal may carry
    const long = verdictFrom(status, hostPane([{ name: 'Drawings', note: `${LOSS} ${'more '.repeat(200)}` }]))
    expect(long.errors[0]).toHaveLength(SCRIPT_REFUSAL_LIMITS.maxChars)
  })

  it('CONTROL: the same status with no such disclosure runs, and a run that owns its drawings is not a loss', () => {
    expect(verdictFrom(status, hostPane([])).runs).toBe(true)
    expect(verdictFrom(status, hostPane([{ name: 'Alerts', note: 'Its alert is under Alerts.' }])).runs).toBe(true)
    expect(verdictFrom(status, { ok: true, lane: 'host' }).runs).toBe(true)                              // no definition to read
    const owned = { ok: true, lane: 'runtime', definition: { compute: { kind: 'runtime', objects: true },
      meta: { disclosures: [{ name: 'Drawings', note: 'Its lines are made by the same bar-by-bar run.' }] } } }
    expect(drawingLossOf(owned)).toBe(null)
    expect(verdictFrom(status, owned).runs).toBe(true)
    expect(verdictFrom(status, owned).headline).toBe(status.headline)
    expect(drawingLossOf(hostPane([{ name: 'Drawings', note: '   ' }]))).toBe(null)
    expect(drawingLossOf(null)).toBe(null)
    // a script the status already refuses keeps the status's own headline, with the loss added to its reasons
    const refusedToo = verdictFrom({ state: 'not-yet', headline: 'Not yet: Inputs', items: [] }, { ...hostPane([{ name: 'Drawings', note: LOSS }]), ok: false })
    expect(refusedToo.headline).toBe('Not yet: Inputs')
    expect(refusedToo.runs).toBe(false)
  })

  it('the name read here IS the engine\'s name for that disclosure', () => {
    expect(DRAWINGS_NOTE).toBe(DRAWING_NOTE_NAME)
  })

  it('the REAL engine: levels drawn from a list beside two plain plots lose every line, and the dock says so', async () => {
    const lost = await checkScript(LOST_SCRIPT)
    expect(lost.attaches).toBe(true)
    expect(RUNS_STATES).toContain(lost.state)                        // ⛔ the status alone calls this "runs"
    expect(lost.lostDrawings).toBe(true)
    expect(lost.runs).toBe(false)
    expect(lost.headline).toBe(LOST_DRAWINGS_HEADLINE)
    expect(lost.errors[0]).toMatch(/drawing elements in this script/)
    // CONTROL: a script whose RUN owns its drawings (a recipe: lines made from state kept in `var`)
    // carries a disclosure of the same name and runs
    const owned = await checkScript(OWNED_SCRIPT)
    expect(owned.lostDrawings).toBe(false)
    expect(owned.runs).toBe(true)
    expect(owned.lane).toBe('runtime')
  }, 120_000)

  it('a lost-drawings answer is sent back for repair like any refusal', async () => {
    const lost = { runs: false, attaches: true, state: 'runs-with-notes', lane: 'host', headline: LOST_DRAWINGS_HEADLINE,
      lostDrawings: true, withheld: [LOSS], notes: [], errors: [LOSS] }
    const sent = []
    const out = await settleScript(answer('first'), async (refusal) => { sent.push(refusal); return answer('second') },
      { check: async (pine) => (pine === 'first' ? lost : runs) })
    expect(sent).toEqual([{ pine: 'first', errors: [LOSS], round: 1 }])
    expect(out.rounds).toBe(1)
    expect(out.verdict.runs).toBe(true)
    expect(out.entry.script.pine).toBe('second')
  })
})

// ═══ "runs" means it RAN: the paste verdict joined with a real run on the chart ═════════════

describe('a script is run on the chart\'s own bars before the dock says it runs', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
  const TOTAL = RUN_STOP_PROBES['running-total'].source
  const chartOn = (history) => ({ bars: recipeBars('daily'), ctx: recipeContext('daily', history) })

  it('⛔ the paste check alone calls a running total "runs"; on a chart that does not reach the listing the run says no', async () => {
    const pasted = await checkScript(TOTAL)
    expect(pasted.runs).toBe(true)                                   // no chart to run on: the paste check passed...
    expect(pasted.ranHere).toBe(RUN.NOT_RUN)                         // ...and it was NOT run, said as that
    expect(pasted.notRun).toBe(true)
    expect(pasted.headline).toBe(NOT_RUN_HEADLINE)
    expect(pasted.notes[0]).toMatch(/^It was not run here \(there was no chart to run it on\)/)
    const off = await checkScript(TOTAL, { chart: chartOn('offListing') })
    expect(off.runs).toBe(false)
    expect(off.ranHere).toBe(RUN.STOPPED)
    expect(off.headline).toBe(STOPPED_HEADLINE)
    expect(off.errors).toHaveLength(1)
    expect(off.errors[0]).toMatch(/its values never came to agree/)
    expect(off.errors[0].length).toBeLessThanOrEqual(SCRIPT_REFUSAL_LIMITS.maxChars)
    expect(refusalOf(TOTAL, off, 1)).toEqual({ pine: TOTAL, errors: off.errors, round: 1 })
    // the SAME script on a chart whose history reaches the listing runs
    const from = await checkScript(TOTAL, { chart: chartOn('fromListing') })
    expect(from.runs).toBe(true)
    expect(from.ranHere).toBe(RUN.RAN)
    expect(from.headline).not.toBe(NOT_RUN_HEADLINE)                 // run on a chart, it leads with the engine's own headline
    expect(from.notRun).toBeUndefined()
  }, 120_000)

  it('a proven recipe runs on both, and a script the paste check refuses is never run', async () => {
    for (const history of ['fromListing', 'offListing']) {
      const v = await checkScript(OWNED_SCRIPT, { chart: chartOn(history) })
      expect(v.runs, history).toBe(true)
      expect(v.ranHere).toBe(RUN.RAN)
    }
    let ran = 0
    const refusedByPaste = await checkScript(BROKEN, { chart: chartOn('fromListing'),
      load: async () => { const real = await realEngine(); return { ...real, runHereWhenLanded: async (...a) => { ran += 1; return real.runHereWhenLanded(...a) } } } })
    expect(refusedByPaste.runs).toBe(false)
    expect(ran).toBe(0)
  }, 120_000)

  it('an older engine bundle with no run, or a chart with nothing to run on, is the paste verdict and says it was not run', async () => {
    const noRun = await checkScript(TOTAL, { chart: chartOn('offListing'),
      load: async () => { const { runHereWhenLanded: _a, verdictOnChart: _b, ...rest } = await realEngine(); return rest } })
    expect(noRun.runs).toBe(true)
    expect('ranHere' in noRun).toBe(false)
    const loading = await checkScript(TOTAL, { chart: { bars: [], ctx: recipeContext('daily', 'offListing') } })
    expect(loading.runs).toBe(true)
    expect(loading.ranHere).toBe(RUN.NOT_RUN)
  }, 120_000)

  it('the turn hands each check the chart AS IT IS THEN, and a run that stops goes back for repair', async () => {
    const charts = [chartOn('offListing'), chartOn('fromListing')]
    const asked = []
    const sent = []
    const converse = async (args) => {
      sent.push(args)
      return { ok: true, disposition: 'answer', reply: 'A running total.', turn: 'script',
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'A running total.' },
        script: { name: 'Total', pine: `${TOTAL}// ${sent.length}${String.fromCharCode(10)}`, round: sent.length - 1 }, notUnderstood: [], unavailable: [] }
    }
    const state = newAuthoringState()
    const out = await modelTurn(state, () => state, 'a running total of volume', {
      converse, chartOf: () => { const c = charts[Math.min(asked.length, 1)]; asked.push(c.ctx.historyFromListing); return c },
    })
    expect(asked).toEqual([false, true])                             // asked once per check, not once per turn
    expect(sent).toHaveLength(2)
    expect(sent[1].scriptRefusal.errors[0]).toMatch(/its values never came to agree/)
    expect(out.ok).toBe(true)                                        // the repair was checked on the second chart, and ran
    expect(out.rounds).toBe(1)
  }, 120_000)
})

// ─── a check that has not finished is not a refusal ───────────────────────────────────
//
// ⚰️ Found live 2026-11-19: the server answered "still being checked" to the chart's admission question for a
// few seconds, the dock settled on it, and a script that was fine read "Still being checked on this chart"
// beside a button that said "to fix it".
describe('a script the chart is still checking', () => {
  const checking = { runs: false, checking: true, attaches: true, state: 'runs', lane: 'runtime', headline: CHECKING_HEADLINE,
    withheld: [], notes: [], errors: [], ranHere: RUN.PENDING }

  it('the run\'s own verdict marks it, and only it', () => {
    const pasted = { ...runs }
    expect(verdictOnChart(pasted, { state: RUN.PENDING, stops: [], unchecked: [], waiting: [], notes: [] }).checking).toBe(true)
    for (const state of [RUN.RAN, RUN.STOPPED, RUN.NOT_RUN]) {
      const v = verdictOnChart(pasted, { state, stops: state === RUN.STOPPED ? [{ guard: 'g', sentence: 's' }] : [], unchecked: [], waiting: [], notes: [] })
      expect(v.checking, state).toBeUndefined()
    }
    expect(isChecking(checking)).toBe(true)
    expect(isChecking(runs)).toBe(false)
    expect(isChecking(refused('line 3: x'))).toBe(false)
    expect(isChecking({ ...checking, runs: true })).toBe(false)        // "runs" always wins
    expect(isChecking(null)).toBe(false)
  })

  it('is asked again, and the answer that lands is what is shown: no repair, no "to fix it"', async () => {
    const verdicts = [checking, checking, runs]
    const check = vi.fn(async () => verdicts.shift())
    const wait = vi.fn(async () => {})
    const repair = vi.fn()
    const out = await settleScript(answer(TABLE), repair, { check, wait })
    expect(check).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.map((c) => c[0])).toEqual([PENDING_RECHECK_MS, PENDING_RECHECK_MS])
    expect(repair).not.toHaveBeenCalled()
    expect(out.entry.script.runs).toBe(true)
    expect(out.entry.script.checking).toBeUndefined()
    expect(out.entry.lines[0]).toBe('Runs on the chart')
    expect(scriptNeedsFixing(out.entry.script)).toBe(false)
  })

  it('never more than the bound; still checking then, it says so and nothing is sent for repair', async () => {
    const check = vi.fn(async () => checking)
    const wait = vi.fn(async () => {})
    const repair = vi.fn()
    const out = await settleScript(answer(TABLE), repair, { check, wait })
    expect(check).toHaveBeenCalledTimes(1 + PENDING_RECHECKS)
    expect(wait).toHaveBeenCalledTimes(PENDING_RECHECKS)
    expect(repair).not.toHaveBeenCalled()
    expect(out.rounds).toBe(0)
    expect(out.entry.lines[0]).toBe(CHECKING_HEADLINE)
    expect(out.entry.lines[out.entry.lines.length - 1]).toBe(STILL_CHECKING_LINE)
    expect(out.entry.script).toEqual({ name: 'ATR table', pine: TABLE, runs: false, attaches: true, state: 'runs', checking: true })
    expect(scriptNeedsFixing(out.entry.script)).toBe(false)
    expect(PENDING_RECHECKS).toBeGreaterThan(0)
    expect(wait.mock.calls.every((c) => c[0] === PENDING_RECHECK_MS)).toBe(true)
  })

  it('a re-check that finds a real refusal sends it for repair, and the repair is re-checked the same way', async () => {
    const verdicts = [checking, refused('line 3: not a built-in here'), checking, runs]
    const check = vi.fn(async () => verdicts.shift())
    const wait = vi.fn(async () => {})
    const repair = vi.fn(async () => answer(TABLE, 'Fixed.'))
    const out = await settleScript(answer(BROKEN), repair, { check, wait })
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0][0].errors).toEqual(['line 3: not a built-in here'])
    expect(check).toHaveBeenCalledTimes(4)
    expect(wait).toHaveBeenCalledTimes(2)                            // one re-check for each script: the whole budget
    expect(out.rounds).toBe(1)
    expect(out.entry.script.runs).toBe(true)
  })

  it('⛔ ONE budget for the whole request: repairs do not multiply the waiting', async () => {
    // the first script is checking through the whole budget, then refused; every repair is checking too
    const verdicts = [checking, checking, refused('line 1: a'), checking, refused('line 2: b'), checking]
    const check = vi.fn(async () => verdicts.shift())
    const wait = vi.fn(async () => {})
    let n = 0
    const repair = vi.fn(async () => answer(`${BROKEN}// ${n += 1}${String.fromCharCode(10)}`))
    const out = await settleScript(answer(BROKEN), repair, { check, wait })
    expect(wait).toHaveBeenCalledTimes(PENDING_RECHECKS)             // never more, however many scripts were checked
    expect(check.mock.calls.length).toBeLessThanOrEqual(1 + MAX_REPAIR_ROUNDS + PENDING_RECHECKS)
    expect(repair.mock.calls.length).toBeLessThanOrEqual(MAX_REPAIR_ROUNDS)
    expect(out.entry).toBeTruthy()
  })

  it('CONTROL: a refusal is not waited on, and a refused script IS one to fix', async () => {
    const check = vi.fn(async () => refused('line 3: the same thing'))
    const wait = vi.fn(async () => {})
    const out = await settleScript(answer(BROKEN), async () => answer(BROKEN), { check, wait })
    expect(wait).not.toHaveBeenCalled()
    expect(out.entry.script.checking).toBeUndefined()
    expect(scriptNeedsFixing(out.entry.script)).toBe(true)
    expect(out.entry.lines).not.toContain(STILL_CHECKING_LINE)
    // and the other two states the button reads
    expect(scriptNeedsFixing({ runs: true })).toBe(false)
    expect(scriptNeedsFixing(scriptEntry({ script: { name: 'x', pine: TABLE }, reply: '', verdict: { ...runs, waits: true, headline: WAITING_HEADLINE } }).script)).toBe(false)
    expect(scriptNeedsFixing(null)).toBe(false)
  })

  it('both windows word their button with the one rule', () => {
    const builder = path.resolve(process.cwd(), 'src/components/chart/builder')
    const code = (file) => fs.readFileSync(path.join(builder, file), 'utf8').split(String.fromCharCode(10))
      .map((line) => line.replace(/\/\/.*$/, '')).join(String.fromCharCode(10))
    for (const file of ['ConverseBox.jsx', 'studio/CreateIndicatorPanel.jsx']) {
      const src = code(file)
      expect(src, file).toContain('scriptNeedsFixing(t.script)')
      expect(src, file).not.toMatch(/t\.script\.runs \? 'Open this script/)
      expect(src.match(/to fix it'/g) || [], file).toHaveLength(1)
    }
  })
})

// ─── "drawn when the newest bar closes" is said where the lane is known ─────────────────
//
// ⚰️ 2026-11-19. The server's detector says a script reads where the chart ends; that delays it only on the
// bar-by-bar lane. Written into the reply by the server, the sentence was also said of a lone table, box or
// label, which another lane draws all session (measured in session the same evening).
describe('a script that reads where the chart ends', () => {
  const onLane = (lane, more = {}) => ({ ...runs, lane, ...more })
  const lastBar = { name: 'Profile', pine: TABLE, waitsForTheBar: true }
  const said = (script, verdict) => scriptEntry({ script, reply: 'A profile.', verdict }).lines

  it('says it for a script the bar-by-bar lane draws, once, after the engine\'s own lines', () => {
    const lines = said(lastBar, onLane('runtime', { notes: ['Drawn bar by bar.'] }))
    expect(lines).toEqual(['Runs on the chart', 'Drawn bar by bar.', WAITS_ON_A_LIVE_CHART_LINE])
  })

  it('⛔ does not say it for a script another lane draws: that one is drawn all session', () => {
    expect(said(lastBar, onLane('host'))).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
  })

  it('does not say it twice, or beside a refusal, or without the server\'s fact', () => {
    // already waiting on THIS chart: the headline says so
    expect(said(lastBar, onLane('runtime', { waits: true, headline: WAITING_HEADLINE }))).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
    // refused: other news
    expect(said(lastBar, { ...refused('line 3: x'), lane: 'runtime' })).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
    // still being checked: nothing is known yet
    expect(said(lastBar, { ...onLane('runtime'), runs: false, checking: true })).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
    // the server did not say the script reads where the chart ends
    expect(said({ name: 'x', pine: TABLE }, onLane('runtime'))).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
    expect(said({ name: 'x', pine: TABLE, waitsForTheBar: 'yes' }, onLane('runtime'))).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
  })

  it('the window keeps the server\'s fact, and only when it is true', () => {
    const body = (script) => ({ script: { name: 'x', pine: TABLE, round: 0, ...script } })
    expect(scriptOf(body({ waits_for_the_bar: true })).script.waitsForTheBar).toBe(true)
    expect('waitsForTheBar' in scriptOf(body({ waits_for_the_bar: false })).script).toBe(false)
    expect('waitsForTheBar' in scriptOf(body({ waits_for_the_bar: 'true' })).script).toBe(false)
    expect('waitsForTheBar' in scriptOf(body({})).script).toBe(false)
  })

  it('a repaired script is judged on ITS OWN fact, not the first script\'s', async () => {
    const first = { ok: true, script: { name: 'a', pine: BROKEN, round: 0, waitsForTheBar: true }, reply: 'First.' }
    const fixed = { ok: true, script: { name: 'a', pine: TABLE, round: 1 }, reply: 'Fixed.' }
    const verdicts = [{ ...refused('line 3: x'), lane: 'runtime' }, onLane('runtime')]
    const out = await settleScript(first, async () => fixed, { check: async () => verdicts.shift(), wait: async () => {} })
    expect(out.entry.script.pine).toBe(TABLE)
    expect(out.entry.lines).not.toContain(WAITS_ON_A_LIVE_CHART_LINE)
  })
})

// ─── review fixes (2026-11-19) ────────────────────────────────────────────────────────
describe('stopping, and verdicts made with nothing known', () => {
  const checking = { runs: false, checking: true, attaches: true, state: 'runs', lane: 'runtime', headline: CHECKING_HEADLINE,
    withheld: [], notes: [], errors: [], ranHere: RUN.PENDING }

  it('Stop (or closing the window) ends the waiting: no more re-checks, no repair', async () => {
    let stopped = false
    const check = vi.fn(async () => checking)
    const wait = vi.fn(async () => { stopped = true })                // the member presses Stop during the first pause
    const repair = vi.fn()
    const out = await settleScript(answer(TABLE), repair, { check, wait, cancelled: () => stopped })
    expect(check).toHaveBeenCalledTimes(1)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(repair).not.toHaveBeenCalled()
    expect(out.entry.script.checking).toBe(true)
    // and a refusal that arrives after Stop is not sent for repair
    stopped = true
    const again = await settleScript(answer(BROKEN), repair, { check: async () => refused('line 3: x'), wait, cancelled: () => stopped })
    expect(repair).not.toHaveBeenCalled()
    expect(again.rounds).toBe(0)
    // already stopped before the first pause: it does not wait at all
    const noWait = vi.fn(async () => {})
    const once = vi.fn(async () => checking)
    await settleScript(answer(TABLE), repair, { check: once, wait: noWait, cancelled: () => true })
    expect(noWait).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledTimes(1)
    // a `cancelled` that throws is "not cancelled", never a crash
    const fine = await settleScript(answer(TABLE), repair, { check: async () => runs, cancelled: () => { throw new Error('x') } })
    expect(fine.entry.script.runs).toBe(true)
  })

  it('the default pause ends early once it is cancelled', async () => {
    let stopped = false
    const started = Date.now()
    setTimeout(() => { stopped = true }, 30)
    const out = await settleScript(answer(TABLE), vi.fn(), { check: async () => checking, cancelled: () => stopped })
    expect(Date.now() - started).toBeLessThan(PENDING_RECHECK_MS)     // it did not sit out the whole pause
    expect(out.entry.script.checking).toBe(true)
  }, 10_000)

  it('⛔ a verdict made while the chart does not know whether it may draw the script is CHECKING, never a refusal', async () => {
    // the lane declined the script for want of an admission answer: the paste check reads "does not run"
    const pendingEngine = async () => ({ ...(await realEngine()), consultPending: () => true })
    const v = await checkScript(BROKEN, { load: pendingEngine })
    expect(v.runs).toBe(false)
    expect(v.checking).toBe(true)
    expect(v.headline).toBe(STILL_CHECKING_HEADLINE)
    expect(v.errors).toEqual([])
    expect(refusalOf(BROKEN, v, 1)).toBe(null)                        // nothing goes to the assistant
    expect(isChecking(v)).toBe(true)
    // CONTROL: with the admission known, the same script is refused and does go back
    const known = await checkScript(BROKEN, { load: async () => ({ ...(await realEngine()), consultPending: () => false }) })
    expect(known.checking).toBeUndefined()
    expect(known.errors.length).toBeGreaterThan(0)
    // and a script that RUNS is not held back by a pending consult (the run decides)
    const ok = await checkScript(TABLE, { load: pendingEngine })
    expect(ok.checking).toBeUndefined()
    expect(STILL_CHECKING_HEADLINE).toBe(CHECKING_HEADLINE)
  }, 120_000)

  it('a script the window could not check at all is not one "to fix"', async () => {
    const v = await checkScript(TABLE, { load: async () => { throw new Error('the engine did not load') } })
    expect(v.state).toBe(UNCHECKED_STATE)
    const entry = scriptEntry({ script: { name: 'x', pine: TABLE }, reply: '', verdict: v })
    expect(entry.script.state).toBe(UNCHECKED_STATE)
    expect(scriptNeedsFixing(entry.script)).toBe(false)
    // CONTROL: a refused one is
    expect(scriptNeedsFixing(scriptEntry({ script: { name: 'x', pine: BROKEN }, reply: '', verdict: refused('line 3: x') }).script)).toBe(true)
  })
})

// ─── the admission verdict that comes WITH the script (2026-11-19) ─────────────────────
//
// The chart may draw a script bar by bar only once the server has said so. Asked afterwards, the question could
// wait behind other members' traffic and the dock read "still being checked". The server sends the verdict in
// the script's own answer; the window latches it exactly as it latches the door's answer, and asks nothing.
describe('the admission verdict carried in a script answer', () => {
  const SHA = 'a'.repeat(64)
  const body = (admission) => ({ script: { name: 'x', pine: TABLE, round: 0, admission } })

  it('is kept only when it is well formed', () => {
    const good = { sha256: SHA.toUpperCase(), admitted: true, missing: [], historyOnly: ['realtime-state'] }
    expect(scriptOf(body(good)).script.admission).toEqual({ sha256: SHA, admitted: true, missing: [], historyOnly: ['realtime-state'] })
    expect(scriptOf(body({ sha256: SHA, admitted: false, missing: ['udt'] })).script.admission).toEqual({ sha256: SHA, admitted: false, missing: ['udt'] })
    const bad = [null, 'yes', [], {}, { sha256: 'abc', admitted: true, missing: [] }, { sha256: SHA, admitted: 'true', missing: [] },
      { sha256: SHA, admitted: true }, { sha256: SHA, admitted: true, missing: 'none' }, { sha256: SHA, admitted: true, missing: [7] },
      { sha256: SHA, admitted: true, missing: [], historyOnly: 'realtime-state' },
      { sha256: SHA, admitted: true, missing: Array(ADMISSION_LIMITS.maxIds + 1).fill('x') },
      { sha256: SHA, admitted: true, missing: ['x'.repeat(ADMISSION_LIMITS.maxIdChars + 1)] }]
    for (const raw of bad) {
      expect('admission' in scriptOf(body(raw)).script, JSON.stringify(raw)).toBe(false)
      expect(admissionOf(raw)).toEqual({})
    }
    expect('admission' in scriptOf({ script: { name: 'x', pine: TABLE, round: 0 } }).script).toBe(false)   // an older server
  })

  /** A stand-in for `engine/runtimeKill.js` that records what is latched. */
  const fakeKill = ({ on = true } = {}) => {
    const latched = []
    return { latched, runtimeCapabilityAdmissionOn: () => on, runtimeSourceHash: runtimeKill.runtimeSourceHash,
      latchRuntimeAdmission: (h, v) => latched.push([h, v]) }
  }
  const own = runtimeKill.runtimeSourceHash(TABLE)

  it('is latched under the script\'s own hash, as the door\'s answer is', () => {
    const kill = fakeKill()
    expect(latchAnswerAdmission(kill, TABLE, { sha256: own, admitted: true, missing: [] })).toBe(true)
    expect(latchAnswerAdmission(kill, TABLE, { sha256: own.toUpperCase(), admitted: true, missing: [], historyOnly: ['realtime-state'] })).toBe(true)
    expect(latchAnswerAdmission(kill, TABLE, { sha256: own, admitted: false, missing: ['udt'] })).toBe(true)
    expect(kill.latched).toEqual([[own, { admitted: true, historyOnly: false }], [own, { admitted: true, historyOnly: true }],
      [own, { admitted: false, historyOnly: false }]])
    // `historyOnly` fails closed: present and not an empty list reads as finished-bars-only
    const closed = fakeKill()
    latchAnswerAdmission(closed, TABLE, { sha256: own, admitted: true, missing: [], historyOnly: [] })
    latchAnswerAdmission(closed, TABLE, { sha256: own, admitted: true, missing: [], historyOnly: 'yes' })
    expect(closed.latched.map(([, v]) => v.historyOnly)).toEqual([false, true])
  })

  it('⛔ latches NOTHING for another script\'s verdict, a "still being checked", or with admission off', () => {
    const kill = fakeKill()
    expect(latchAnswerAdmission(kill, TABLE, { sha256: SHA, admitted: true, missing: [] })).toBe(false)             // not this script's
    expect(latchAnswerAdmission(kill, TABLE, { sha256: own, admitted: false, missing: ['pending'] })).toBe(false)   // not a verdict
    expect(latchAnswerAdmission(kill, TABLE, null)).toBe(false)
    expect(latchAnswerAdmission(kill, TABLE, { sha256: own, admitted: 'true', missing: [] })).toBe(false)
    expect(latchAnswerAdmission(kill, '', { sha256: own, admitted: true, missing: [] })).toBe(false)
    expect(latchAnswerAdmission(null, TABLE, { sha256: own, admitted: true, missing: [] })).toBe(false)
    expect(kill.latched).toEqual([])
    const off = fakeKill({ on: false })
    expect(latchAnswerAdmission(off, TABLE, { sha256: own, admitted: true, missing: [] })).toBe(false)
    expect(off.latched).toEqual([])
  })

  it('each script is checked with ITS OWN verdict: the first script\'s is never used for a repair', async () => {
    const first = { ok: true, script: { name: 'a', pine: BROKEN, round: 0, admission: { sha256: SHA, admitted: true, missing: [] } }, reply: 'First.' }
    const fixed = { ok: true, script: { name: 'a', pine: TABLE, round: 1 }, reply: 'Fixed.' }
    const seen = []
    const verdicts = [refused('line 3: x'), runs]
    await settleScript(first, async () => fixed, { check: async (pine, script) => { seen.push([pine, script && script.admission]); return verdicts.shift() }, wait: async () => {} })
    expect(seen).toEqual([[BROKEN, first.script.admission], [TABLE, undefined]])
  })

  it('the check hands the verdict to the engine\'s own prepare step, before anything is judged', async () => {
    const order = []
    const load = async () => ({ ...(await realEngine()), prepare: async (pine, admission) => { order.push(['prepare', pine === TABLE, admission]) } })
    const admission = { sha256: own, admitted: true, missing: [] }
    const v = await checkScript(TABLE, { load, admission })
    expect(order).toEqual([['prepare', true, admission]])
    expect(v.runs).toBe(true)
    // CONTROL: with none, prepare is handed none
    order.length = 0
    await checkScript(TABLE, { load })
    expect(order).toEqual([['prepare', true, null]])
  }, 120_000)

  it('with the real engine: a verdict that came with the script is latched and the door is never asked', () => {
    runtimeKill.__resetRuntimeAllowList()
    runtimeKill.__resetRuntimeAdmission()
    runtimeKill.latchRuntimeLists({ kill: [], allow: [], capability_admission: true })
    try {
      expect(runtimeKill.runtimeAdmissionOf({ source: TABLE })).toBe(null)
      expect(latchAnswerAdmission(runtimeKill, TABLE, { sha256: own, admitted: true, missing: [], historyOnly: [] })).toBe(true)
      const v = runtimeKill.runtimeAdmissionOf({ source: TABLE })
      expect(v && v.admitted).toBe(true)
      expect(v.historyOnly).toBe(false)
      expect(runtimeKill.runtimeNotGradedOf({ source: TABLE })).toBe(null)          // the lane takes it: nothing "being checked"
      expect(runtimeKill.runtimeConsultPendingOf({ source: TABLE })).toBe(false)
    } finally {
      runtimeKill.__resetRuntimeAdmission()
      __allowEveryRuntimeScriptForTests()
    }
  })
})

// ─── why it is still being checked (2026-11-19) ────────────────────────────────────────
describe('a script still being checked says why, when the server said why', () => {
  const pendingEngine = (reason) => async () => ({ ...(await realEngine()), consultPending: () => true, pendingReason: () => reason })

  it('the reason rides the checking verdict, and only a reason this window has words for', async () => {
    for (const reason of Object.keys(PENDING_REASON_LINES)) {
      const v = await checkScript(BROKEN, { load: pendingEngine(reason) })
      expect(v.checking).toBe(true)
      expect(v.pendingReason).toBe(reason)
    }
    for (const reason of [null, undefined, '', 'unknown', 7]) {
      const v = await checkScript(BROKEN, { load: pendingEngine(reason) })
      expect(v.checking).toBe(true)
      expect('pendingReason' in v, String(reason)).toBe(false)
    }
    // an engine that keeps no reason yet (no such function): nothing is said, nothing breaks
    const older = await checkScript(BROKEN, { load: async () => ({ ...(await realEngine()), consultPending: () => true }) })
    expect(older.checking).toBe(true)
    expect('pendingReason' in older).toBe(false)
    // CONTROL: a verdict that is not CHECKING never carries one: not run at all, and run on a chart
    const runsFine = await checkScript(TABLE, { load: pendingEngine('busy') })
    expect('pendingReason' in runsFine).toBe(false)
    const ranOnAChart = await checkScript(OWNED_SCRIPT, { load: pendingEngine('busy'), chart: { bars: recipeBars('daily'), ctx: recipeContext('daily', 'fromListing') } })
    expect(ranOnAChart.runs).toBe(true)
    expect(ranOnAChart.ranHere).toBe(RUN.RAN)
    expect('pendingReason' in ranOnAChart).toBe(false)
    expect(Object.keys(PENDING_REASON_LINES).sort()).toEqual(['busy', 'paused', 'starting'])
  }, 120_000)

  it('the entry says it in a member\'s words, before the "nothing needs fixing" line', () => {
    const checking = { runs: false, checking: true, attaches: true, state: 'runs', lane: 'runtime', headline: CHECKING_HEADLINE,
      withheld: [], notes: [], errors: [] }
    for (const reason of Object.keys(PENDING_REASON_LINES)) {
      const lines = scriptEntry({ script: { name: 'x', pine: TABLE }, reply: '', verdict: { ...checking, pendingReason: reason } }).lines
      expect(lines.slice(-2)).toEqual([PENDING_REASON_LINES[reason], STILL_CHECKING_LINE])
    }
    const plain = scriptEntry({ script: { name: 'x', pine: TABLE }, reply: '', verdict: checking }).lines
    expect(plain.slice(-1)).toEqual([STILL_CHECKING_LINE])
    expect(plain).toHaveLength(2)
    // a reason on a verdict that RUNS is not said
    expect(scriptEntry({ script: { name: 'x', pine: TABLE }, reply: '', verdict: { ...runs, pendingReason: 'busy' } }).lines).toEqual(['Runs on the chart'])
  })

  it('"paused" ends the waiting at once; "busy" and "starting" are asked again', async () => {
    const checking = (reason) => ({ runs: false, checking: true, attaches: true, state: 'runs', lane: 'runtime', headline: CHECKING_HEADLINE,
      withheld: [], notes: [], errors: [], pendingReason: reason })
    for (const reason of PENDING_REASONS_THAT_END_THE_WAIT) {
      const check = vi.fn(async () => checking(reason))
      const wait = vi.fn(async () => {})
      const out = await settleScript(answer(TABLE), vi.fn(), { check, wait })
      expect(check, reason).toHaveBeenCalledTimes(1)
      expect(wait, reason).not.toHaveBeenCalled()
      expect(out.entry.lines).toContain(PENDING_REASON_LINES[reason])
    }
    for (const reason of ['busy', 'starting']) {
      const check = vi.fn(async () => checking(reason))
      const wait = vi.fn(async () => {})
      await settleScript(answer(TABLE), vi.fn(), { check, wait })
      expect(check, reason).toHaveBeenCalledTimes(1 + PENDING_RECHECKS)
    }
    expect(PENDING_REASONS_THAT_END_THE_WAIT.every((r) => r in PENDING_REASON_LINES)).toBe(true)
  })
})

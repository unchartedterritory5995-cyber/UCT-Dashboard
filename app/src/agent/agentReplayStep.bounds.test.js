// D20 · chart.replayStep: the MAX_STEP bound (AUDIT mutant R8) and the forward-implying verbs ("advance two bars").
// The fixture series is LONG (far more than MAX_STEP + 1 bars on each side of the cutoff), so the step itself could be
// taken — MAX_STEP is the ONLY reason a too-big request is refused: the refusal is honest and nothing is written.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerReplayModeCapabilities, STEP_ACTION, MAX_STEP, parseStep, stepReplay } from './capabilities/replayMode'
import { getCapability } from './capabilities'
import { cutoffFetchDay } from '../components/chart/replayCutoff'
import * as O from '../components/chart/__tests__/replayOracle'

const BARS = O.intradayBars(O.sessions('2026-02-02', '2026-05-29'), '5')   // ~78 bars/session × ~80 sessions
const NOW = Date.UTC(2027, 0, 1)
const FROM = O.preciseOf(BARS[Math.floor(BARS.length / 2)].t)
const REFUSAL = `I can step Replay Mode 1 to ${MAX_STEP} bars at a time — or set its date (“replay as of <date>”).`

function stand(cutoff = FROM) {
  const st = { cut: cutoff, writes: [] }
  const charts = {
    read: (ref) => ({ ref, tf: '5', replay: st.cut }),
    list: () => [{ ref: 'c', tf: '5', replay: st.cut }],
    setReplay: (v) => { st.writes.push(v); st.cut = v; return true },
    replayBarTimes: async (ref, { throughDay } = {}) => {
      const to = throughDay || cutoffFetchDay(st.cut, '5')
      return { tf: '5', extended: false, times: BARS.filter(b => O.unixToEt(b.t).day <= to).map(b => b.t) }
    },
  }
  return { host: { charts }, st }
}
const chartState = () => ({ tf: '5', replay: FROM, canStepReplay: true })
let cap
beforeAll(() => { registerReplayModeCapabilities(); cap = getCapability(STEP_ACTION) })

// a write = check passes, then apply + the step run; a refusal stops at check (apply never reached)
async function run(direction, bars) {
  const { host, st } = stand()
  const s0 = chartState()
  const refusal = cap.check(s0, { direction, bars })
  if (refusal) return { refusal, writes: st.writes, after: s0 }
  const after = cap.apply(s0, { direction, bars })
  await stepReplay(host, 'c', { direction, bars, from: FROM }, { now: NOW })
  return { refusal: null, writes: st.writes, after }
}

describe('MAX_STEP is the only reason a too-big step is refused (fixture long enough to hold it)', () => {
  it('the fixture holds more than MAX_STEP + 1 bars on each side of the cutoff', () => {
    const i = BARS.findIndex(b => O.preciseOf(b.t) === FROM)
    expect(i).toBeGreaterThan(MAX_STEP + 2)
    expect(BARS.length - i).toBeGreaterThan(MAX_STEP + 2)
  })
  const OVER = [MAX_STEP + 1, MAX_STEP + 2, MAX_STEP + 50, 2 * MAX_STEP, 999]
  it.each(OVER.flatMap(n => [['forward', n], ['back', n]]))('%s %i bars: refused, nothing written', async (direction, n) => {
    const r = await run(direction, n)
    expect(r.refusal).toBe(REFUSAL)
    expect(r.writes).toEqual([])
    expect(r.after.replayStep).toBeUndefined()
    expect(r.after.replay).toBe(FROM)
  })
  it.each([['forward'], ['back']])('%s exactly MAX_STEP: allowed and written', async (direction) => {
    const r = await run(direction, MAX_STEP)
    expect(r.refusal).toBe(null)
    expect(r.after.replayStep).toEqual({ direction, bars: MAX_STEP, from: FROM })
    expect(r.writes).toHaveLength(1)
    expect(r.writes[0]).toBe(O.expectedStep(BARS, '5', FROM, direction, MAX_STEP, { nowSec: NOW / 1000 }))
  })
  it.each([['forward'], ['back']])('%s MAX_STEP + 1: refused (the boundary)', async (direction) => {
    const r = await run(direction, MAX_STEP + 1)
    expect(r.refusal).toBe(REFUSAL)
    expect(r.writes).toEqual([])
  })
  it('spoken: "step forward <MAX_STEP+1> bars" parses, then check refuses it', () => {
    const s = parseStep(`step forward ${MAX_STEP + 1} bars`)
    expect(s).toMatchObject({ direction: 'forward', bars: MAX_STEP + 1 })
    expect(cap.check(chartState(), s)).toBe(REFUSAL)
  })
})

describe('advance / jump with no direction word imply FORWARD (with a count and a bar word)', () => {
  const COUNTS = [['a', 1], ['one', 1], ['two', 2], ['3', 3], ['five', 5], ['ten', 10], ['25', 25]]
  const CASES = []
  for (const verb of ['advance', 'jump']) for (const [w, n] of COUNTS) for (const tail of ['bars', 'bar', 'candles']) {
    CASES.push([`${verb} ${w} ${tail}`, n])
    CASES.push([`${verb} replay mode by ${w} ${tail}`, n])
    CASES.push([`${verb} the replay ${w} ${tail}`, n])
  }
  it.each(CASES)('"%s" → forward %i', (words, n) => {
    expect(parseStep(words)).toMatchObject({ direction: 'forward', bars: n })
  })
  it.each([['jump back 2 bars', 'back', 2], ['advance back 3 bars', 'back', 3], ['jump forward 4 bars', 'forward', 4], ['advance ahead 2 bars', 'forward', 2]])(
    'an explicit direction still wins: "%s" → %s %i', (words, direction, n) => {
      expect(parseStep(words)).toMatchObject({ direction, bars: n })
    })
  it.each(['advance', 'jump', 'advance two', 'jump 3', 'jump to march 3', 'advance the chart', 'jump 3 days'])('"%s" is not read as a step (unchanged)', (words) => {
    expect(parseStep(words)).toBe(null)
  })
  it('"advance two bars" while Replay Mode is on → the fast step, forward 2', () => {
    const { host } = stand()
    expect(cap.fast({ lower: 'advance two bars', host })).toMatchObject({ direction: 'forward', bars: 2, __explicit: true })
  })
})

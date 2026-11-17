// #1263 AUDIT T2 probes — pausing an EXISTING indicator alert (the quiet-harm class), generated: verbs × objects × how many
// alerts are running. The rail must pause exactly the alerts the words COVER, never another:
//   1. cross-clause: "change the RSI length to 21 and pause the MACD alert" pauses the MACD alert only; the RSI edit applies
//   2. stop / turn off a NON-alert ("turn off the 78.6 fib level", "stop the replay", "turn off volume") never pauses an alert
//   3. "turn off notifications" / "mute alerts": the one running alert; several running → fails closed (the ask is H14's)
//   4. a pause FOR A TIME ("snooze the RSI alert for an hour"): refused with the honest reason, nothing written — UCT's alert
//      switch has no timer, so a timed snooze is never claimed
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { stateEffects, stateRailRefusal } from './stateRail'
import { stateFixture } from './__fixtures__/stateBoard'
import { loadIndicatorAlerts, _resetIndicatorAlertCache } from './capabilities/indicatorAlerts'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()

const RSI = { id: '901', sym: 'SPY', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', instance_id: 'inst:rsi:1' }
const MACD = { id: '902', sym: 'SPY', indicator: 'macd', condition: 'cross_zero', threshold: null, tf: 'D', instance_id: null }
const EMA = { id: '903', sym: 'QQQ', indicator: 'ema', condition: 'above', threshold: 400, tf: 'D', instance_id: null }
// how many are RUNNING: 1 → the RSI alert only (the MACD and QQQ ones are paused); 2 → RSI + MACD; 3 → all three
const BOOKS = { 1: [true, false, false], 2: [true, true, false], 3: [true, true, true] }
const remove = vi.fn(async () => ({ ok: true }))
let fx
async function useBook(n) {
  const rows = [RSI, MACD, EMA].map((r, i) => ({ ...r, active: BOOKS[n][i] }))
  fx.host.indicatorAlerts = { list: async () => rows.map(a => ({ ...a })), catalog: async () => [], create: async () => ({ ok: true, id: '999' }),
    toggle: vi.fn(async () => ({ ok: true })), remove }
  _resetIndicatorAlertCache()
  await loadIndicatorAlerts(fx.host, { force: true })
}
beforeEach(async () => { fx = stateFixture(); await useBook(1) })
const op = (action, target, args = {}) => ({ action, target, args })
async function planOf(ops) {
  buildContext(fx.host, { surface: 'charts' })
  const kinds = [...new Set(ops.map(o => (String(o.target).startsWith('ixe:') ? 'indicatorEdits' : 'indicatorAlert')))]
  return planOps(collectTargets(fx.host, kinds), ops, { boundDrawingIds: new Set(), boundAlerts: [], ...(await prepareOps(ops)) }, { surface: 'charts' })
}
const pause = (id) => [op('indicatorAlert.toggle', id, { active: false })]
const RSI_EDIT = [op('indicator.update', 'ixe:c1', { instance: 'inst:rsi:1', inputs: [{ key: 'period', value: 21 }] })]
const REFUSED = /^I didn’t change anything/
const CASES = { lower: (t) => t.toLowerCase(), sentence: (t) => t[0].toUpperCase() + t.slice(1), upper: (t) => t.toUpperCase() }
const cased = (ws) => ws.flatMap(w => Object.values(CASES).map(f => f(w)))
const PAUSE_VERBS = ['pause', 'mute', 'turn off', 'switch off', 'stop', 'disable', 'silence', 'deactivate', 'suspend', 'snooze']

describe('1. cross-clause: the pause clause names its alert; the edit clause names its indicator', () => {
  const EDITS = ['change the RSI length to 21', 'make the RSI length 21', 'set the RSI period to 21']
  const JOINS = [' and ', ', then ', ' then ', '. ', '; ']
  const both = (edit, join, v) => [`${edit}${join}${v} the MACD alert`, `${v} the MACD alert${join}${edit}`]
  const WORDS = EDITS.flatMap(e => JOINS.flatMap(j => PAUSE_VERBS.flatMap(v => both(e, j, v))))
  for (const n of [2, 3]) {
    it(`${n} running: each of ${WORDS.length} phrasings pauses the MACD alert, applies the RSI edit, and licenses nothing else`, async () => {
      await useBook(n)
      const macd = await planOf(pause('902')), rsi = await planOf(pause('901')), qqq = await planOf(pause('903')), edit = await planOf(RSI_EDIT)
      expect(stateEffects(macd).map(e => [e.state, e.type, e.id])).toEqual([['alert', 'pause', 'alert:902']])
      for (const w of WORDS) {
        expect(stateRailRefusal(macd, { words: w }), w).toBe(null)
        expect(stateRailRefusal(edit, { words: w }), w).toBe(null)
        expect(stateRailRefusal(rsi, { words: w }), `mis-planned (the RSI alert): ${w}`).toMatch(REFUSED)
        if (n === 3) expect(stateRailRefusal(qqq, { words: w }), `mis-planned (the QQQ alert): ${w}`).toMatch(REFUSED)
      }
    })
  }
  it('1 running (the RSI one): "pause the MACD alert" names no running alert — pausing the RSI one instead is refused', async () => {
    const rsi = await planOf(pause('901'))
    for (const w of cased(PAUSE_VERBS.flatMap(v => [`${v} the MACD alert`, `change the RSI length to 21 and ${v} the MACD alert`, `${v} the QQQ alert`, `${v} the qqq alert`, `${v} my ema alert`, `${v} the NVDA alert`, `${v} the nvda alert`, `${v} the squeeze alert`,
      `${v} the alert on QQQ`, `${v} the alert on qqq`, `${v} my alert for NVDA`, `${v} my alert for nvda`, `${v} the alert for TSLA please`])))
      expect(stateRailRefusal(rsi, { words: w }), w).toMatch(REFUSED)
  })
  it('1 running: its own symbol said after the noun still names it ("the alert on SPY", "my alert for SPY")', async () => {
    const rsi = await planOf(pause('901'))
    for (const w of cased(PAUSE_VERBS.flatMap(v => [`${v} the alert on SPY`, `${v} my alert for SPY`, `${v} the RSI alert on SPY`]))) expect(stateRailRefusal(rsi, { words: w }), w).toBe(null)
  })
  it('the indicator edit alone never pauses an alert ("change the RSI length to 21"), at any count', async () => {
    for (const n of [1, 2, 3]) {
      await useBook(n)
      for (const id of ['901', '902'].filter((_, i) => BOOKS[n][i])) expect(stateRailRefusal(await planOf(pause(id)), { words: 'change the RSI length to 21' })).toMatch(REFUSED)
    }
  })
})

describe('2. stop / turn off a NON-alert never pauses an alert', () => {
  const OFF = ['turn off', 'switch off', 'shut off', 'stop', 'pause', 'disable', 'mute']
  const THINGS = ['the 78.6 fib level', 'the 0.786 level', 'the replay', 'the bar replay', 'volume', 'the volume', 'the volume profile',
    'the grid', 'the crosshair', 'the watermark', 'the RSI', 'the MACD', 'my drawings', 'the countdown', 'the news widget']
  const WORDS = cased(OFF.flatMap(v => THINGS.map(t => `${v} ${t}`)).concat(THINGS.map(t => `turn ${t} off`)))
  for (const n of [1, 2, 3]) {
    it(`${n} running: none of ${WORDS.length} phrasings licenses pausing any alert`, async () => {
      await useBook(n)
      const plans = await Promise.all(['901', '902', '903'].filter((_, i) => BOOKS[n][i]).map(id => planOf(pause(id))))
      for (const p of plans) for (const w of WORDS) expect(stateRailRefusal(p, { words: w }), w).toMatch(REFUSED)
    })
  }
})

describe('3. "turn off notifications" / "mute alerts": exactly the alerts the words cover', () => {
  const NOUNS = ['notifications', 'alerts', 'alert notifications', 'my notifications', 'my alerts', 'the alerts', 'all my alerts', 'all notifications', 'every alert', 'the alert', 'my alert']
  const WORDS = cased(PAUSE_VERBS.flatMap(v => NOUNS.map(o => `${v} ${o}`)))
  const PLURAL = /\b(?:all|every)\b|\b(?:my|the)\s+(?:alerts|notifications)\b/i
  it(`1 running: each of ${WORDS.length} phrasings pauses that one`, async () => {
    const rsi = await planOf(pause('901'))
    for (const w of WORDS) expect(stateRailRefusal(rsi, { words: w }), w).toBe(null)
  })
  for (const n of [2, 3]) {
    it(`${n} running: an explicit plural pauses each; a bare or singular one fails closed (never a guess)`, async () => {
      await useBook(n)
      const plans = await Promise.all(['901', '902', '903'].filter((_, i) => BOOKS[n][i]).map(id => planOf(pause(id))))
      for (const w of WORDS) for (const p of plans) {
        if (PLURAL.test(w)) expect(stateRailRefusal(p, { words: w }), w).toBe(null)
        else expect(stateRailRefusal(p, { words: w }), w).toMatch(REFUSED)
      }
    })
  }
  it('never an alert the words leave out: "mute my SPY alerts" with the QQQ one running leaves the QQQ one; "the RSI notifications" only the RSI one', async () => {
    await useBook(3)
    const [rsi, macd, qqq] = await Promise.all(['901', '902', '903'].map(id => planOf(pause(id))))
    for (const w of cased(PAUSE_VERBS.map(v => `${v} my SPY alerts`))) {
      expect(stateRailRefusal(rsi, { words: w }), w).toBe(null)
      expect(stateRailRefusal(macd, { words: w }), w).toBe(null)
      expect(stateRailRefusal(qqq, { words: w }), w).toMatch(REFUSED)
    }
    for (const w of cased(PAUSE_VERBS.map(v => `${v} the RSI notifications`))) {
      expect(stateRailRefusal(rsi, { words: w }), w).toBe(null)
      expect(stateRailRefusal(macd, { words: w }), w).toMatch(REFUSED)
      expect(stateRailRefusal(qqq, { words: w }), w).toMatch(REFUSED)
    }
  })
  it.todo('several running and a bare "turn off notifications": ASKED with the running alerts as the choices (needs H14 ask wiring for alerts)')
})

describe('4. a pause FOR A TIME: refused with the honest reason, nothing written; a timed snooze is never claimed', () => {
  const TIMES = ['for an hour', 'for 30 minutes', 'for 2 hours', 'for a day', 'for the day', 'for today', 'until tomorrow', 'till the close',
    'until the open', 'for a while', 'for 15 min', '2h', 'for the rest of the day', 'for a couple of hours', 'for half an hour', 'for the weekend']
  const OBJS = ['the RSI alert', 'my alert', 'it']
  const WORDS = cased(PAUSE_VERBS.flatMap(v => OBJS.flatMap(o => TIMES.map(t => `${v} ${o} ${t}`))))
  it(`each of ${WORDS.length} phrasings is refused, saying a paused alert stays paused (no timer), and offering a plain pause`, async () => {
    const rsi = await planOf(pause('901'))
    for (const w of WORDS) {
      const r = stateRailRefusal(rsi, { words: w })
      expect(r, w).toMatch(REFUSED)
      expect(r, w).toMatch(/can’t pause an alert for a set time/)
      expect(r, w).toMatch(/stays paused until you turn it back on/)
      expect(r, w).not.toMatch(/\bsnoozed\b|\buntil\b.*\bresume[sd]? automatically\b/i)
    }
  })
  it('the same verbs with no time still pause (the time is what is refused, not the pause)', async () => {
    const rsi = await planOf(pause('901'))
    for (const w of cased(PAUSE_VERBS.map(v => `${v} the RSI alert`))) expect(stateRailRefusal(rsi, { words: w }), w).toBe(null)
  })
  it('a resume with a time is no effect (nothing is silenced)', async () => {
    const resume = await planOf([op('indicatorAlert.toggle', '902', { active: true })])
    expect(stateRailRefusal(resume, { words: 'turn the MACD alert back on for an hour' })).toBe(null)        // resume: no effect, nothing silenced
  })
  it('the toggle has no duration to take: a model op carrying one is refused by its args, and the receipt only ever says "Paused"', async () => {
    const bad = await planOf([op('indicatorAlert.toggle', '901', { active: false, minutes: 60 })])
    expect(bad.ok).toBe(false)
    const good = await planOf(pause('901'))
    expect(good.plans[0].lines.join(' ')).toMatch(/^Paused the indicator alert/)
    expect(good.plans[0].lines.join(' ')).not.toMatch(/snooz|for an? |until/i)
  })
})

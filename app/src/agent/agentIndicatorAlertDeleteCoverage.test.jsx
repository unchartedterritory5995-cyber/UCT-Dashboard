// #1263 AUDIT (safety, wrong-target HARD delete) — deleting an EXISTING indicator alert is licensed only when the words COVER
// exactly that alert (or are an explicit plural that includes it), read against EVERY alert in the book, running or paused —
// the same coverage rule a pause uses (stateRail namesAlert). Generated: delete verbs × alert objects (its indicator, its
// symbol, "for NVDA", both) × how many alerts exist, against an independent oracle. A mis-planned target is refused before
// any card (nothing written); the right one goes to its card; an explicit plural deletes exactly the alerts it covers; a delete
// clause beside an indicator edit names only its own alert; pausing is unchanged (controls; agentIndicatorAlertPauseProbes).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { stateEffects, stateRailRefusal } from './stateRail'
import { stateFixture } from './__fixtures__/stateBoard'
import { loadIndicatorAlerts, _resetIndicatorAlertCache } from './capabilities/indicatorAlerts'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()

// the book: 1 → the NVDA RSI alert; 2 → + the NVDA MACD alert (PAUSED — a paused alert is deleted as surely as a running one);
// 3 → + the QQQ EMA alert
const ALL = [
  { id: '901', sym: 'NVDA', ind: 'RSI', row: { indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, instance_id: 'inst:rsi:1' } },
  { id: '902', sym: 'NVDA', ind: 'MACD', row: { indicator: 'macd', condition: 'cross_zero', threshold: null, tf: 'D', active: false, instance_id: null } },
  { id: '903', sym: 'QQQ', ind: 'EMA', row: { indicator: 'ema', condition: 'above', threshold: 400, tf: 'D', active: true, instance_id: null } },
]
const remove = vi.fn(async () => ({ ok: true }))
let fx, book
async function loadBook(n) {
  book = ALL.slice(0, n)
  const rows = book.map(a => ({ id: a.id, sym: a.sym, ...a.row }))
  fx.host.indicatorAlerts = { list: async () => rows.map(a => ({ ...a })), catalog: async () => [], create: async () => ({ ok: true, id: '999' }),
    toggle: vi.fn(async () => ({ ok: true })), remove }
  _resetIndicatorAlertCache()
  await loadIndicatorAlerts(fx.host, { force: true })
}
beforeEach(async () => { fx = stateFixture(); remove.mockClear(); await loadBook(3) })
const op = (action, target, args = {}) => ({ action, target, args })
async function planOf(ops) {
  buildContext(fx.host, { surface: 'charts' })
  const kinds = [...new Set(ops.map(o => (String(o.target).startsWith('ixe:') ? 'indicatorEdits' : 'indicatorAlert')))]
  return planOps(collectTargets(fx.host, kinds), ops, { boundDrawingIds: new Set(), boundAlerts: [], ...(await prepareOps(ops)) }, { surface: 'charts' })
}
const del = (id) => planOf([op('indicatorAlert.delete', id)])
const pause = (id) => planOf([op('indicatorAlert.toggle', id, { active: false })])
const RSI_EDIT = [op('indicator.update', 'ixe:c1', { instance: 'inst:rsi:1', inputs: [{ key: 'period', value: 21 }] })]
const REFUSED = /^I didn’t change anything/
const CASES = { lower: (t) => t.toLowerCase(), sentence: (t) => t[0].toUpperCase() + t.slice(1), upper: (t) => t.toUpperCase() }
const cased = (ws) => ws.flatMap(w => Object.values(CASES).map(f => f(w)))
const DEL_VERBS = ['delete', 'remove', 'get rid of', 'erase', 'clear', 'cancel']

// what an object SAYS of an alert: its indicator, its symbol, or both (the oracle never reads the rail's code)
const OBJECTS = (x) => [
  { w: `the ${x.ind} alert`, ind: x.ind }, { w: `my ${x.ind.toLowerCase()} alert`, ind: x.ind },
  { w: `the ${x.sym} alert`, sym: x.sym }, { w: `my ${x.sym.toLowerCase()} alert`, sym: x.sym },
  { w: `my alert for ${x.sym}`, sym: x.sym }, { w: `the alert on ${x.sym}`, sym: x.sym },
  { w: `the ${x.ind} alert for ${x.sym}`, ind: x.ind, sym: x.sym }, { w: `the ${x.sym} ${x.ind} alarm`, ind: x.ind, sym: x.sym },
]
const PHRASES = [...new Map(ALL.flatMap(OBJECTS).map(o => [o.w, o])).values()]
// the alerts in the book an object describes; a delete of `target` is licensed iff it is the ONLY one
const describes = (o) => book.filter(a => (!o.ind || a.ind === o.ind) && (!o.sym || a.sym === o.sym))
const licensed = (o, target) => { const d = describes(o); return d.length === 1 && d[0].id === target }

describe('1. generated: delete verbs × alert objects × 1 / 2 / 3 alerts — exactly the alert the words cover', () => {
  for (const n of [1, 2, 3]) {
    it(`${n} alert(s): every delete of a book alert is licensed only by words covering exactly it`, async () => {
      await loadBook(n)
      let allowed = 0, refused = 0
      for (const target of book) {
        const plan = await del(target.id)
        expect(stateEffects(plan).map(e => [e.state, e.type, e.id])).toEqual([['alert', 'delete', `alert:${target.id}`]])
        for (const v of DEL_VERBS) for (const o of PHRASES) for (const w of cased([`${v} ${o.w}`])) {
          const r = stateRailRefusal(plan, { words: w })
          if (licensed(o, target.id)) { expect(r, `${w} → deletes ${target.sym} ${target.ind}`).toBe(null); allowed++ } else { expect(r, `${w} must NOT delete ${target.sym} ${target.ind}`).toMatch(REFUSED); refused++ }
        }
      }
      expect(allowed).toBeGreaterThan(0)
      expect(refused).toBeGreaterThan(0)
      expect(remove).not.toHaveBeenCalled()
    })
  }
})

describe('2. a mis-planned target is refused before any card; nothing written', () => {
  it('"delete the MACD alert" never licenses deleting the RSI alert (or the QQQ one) — at every book size', async () => {
    for (const n of [1, 2, 3]) {
      await loadBook(n)
      for (const wrong of book.filter(a => a.ind !== 'MACD')) {
        const plan = await del(wrong.id)
        for (const w of cased(DEL_VERBS.flatMap(v => [`${v} the MACD alert`, `${v} my macd alert`, `${v} the NVDA MACD alert`, `${v} the MACD alert for NVDA`])))
          expect(stateRailRefusal(plan, { words: w }), `${n}: ${w} → ${wrong.ind}`).toMatch(REFUSED)
      }
    }
    expect(remove).not.toHaveBeenCalled()
  })
  it('a singular object covering two alerts ("the alert", "the NVDA alert", "my alert for NVDA") deletes neither', async () => {
    await loadBook(2)
    for (const id of ['901', '902']) {
      const plan = await del(id)
      for (const w of cased(DEL_VERBS.flatMap(v => [`${v} the alert`, `${v} my alert`, `${v} the NVDA alert`, `${v} my alert for NVDA`, `${v} the alert on NVDA`, `${v} the alarm`])))
        expect(stateRailRefusal(plan, { words: w }), w).toMatch(REFUSED)
    }
  })
  it('words that match no alert are refused, whatever is planned (unknown indicator, unknown symbol, extra words)', async () => {
    for (const n of [1, 2, 3]) {
      await loadBook(n)
      for (const a of book) {
        const plan = await del(a.id)
        for (const w of cased(DEL_VERBS.flatMap(v => [`${v} the squeeze alert`, `${v} the alert on TSLA`, `${v} my alert for TSLA`, `${v} the TSLA ${a.ind} alert`,
          `${v} the ${a.ind} breakout alert`, `${v} my ${a.ind} alert from yesterday`, `${v} the ADX alert`])))
          expect(stateRailRefusal(plan, { words: w }), `${n}: ${w} → ${a.ind}`).toMatch(REFUSED)
      }
    }
  })
})

describe('3. the right target goes to its card', () => {
  it('indicatorAlert.delete is a confirm card (permanent), and a covering phrase reaches it with its own line', async () => {
    expect(getCapability('indicatorAlert.delete')).toMatchObject({ risk: 'confirm', reversible: false })
    const plan = await del('902')
    expect(plan.ok).toBe(true)
    expect(plan.plans[0].lines.join(' ')).toMatch(/^Deleted the indicator alert NVDA macd .*\(permanent\)$/)
    for (const w of cased(DEL_VERBS.flatMap(v => [`${v} the MACD alert`, `${v} the NVDA MACD alert`, `${v} the MACD alert for NVDA`, `${v} my NVDA macd alarm`])))
      expect(stateRailRefusal(plan, { words: w }), w).toBe(null)
    expect(remove).not.toHaveBeenCalled()
  })
  it('one alert in the book: "delete the alert" / "remove my alert" names it', async () => {
    await loadBook(1)
    const plan = await del('901')
    for (const w of cased(DEL_VERBS.flatMap(v => [`${v} the alert`, `${v} my alert`, `${v} the alarm`, `${v} the NVDA alert`, `${v} my alert for NVDA`])))
      expect(stateRailRefusal(plan, { words: w }), w).toBe(null)
  })
})

describe('4. an explicit plural deletes exactly the alerts it covers', () => {
  const cover = async (words, yes) => {
    for (const a of book) {
      const r = stateRailRefusal(await del(a.id), { words })
      if (yes.includes(a.id)) expect(r, `${words} → ${a.ind} allowed`).toBe(null)
      else expect(r, `${words} → ${a.ind} NOT covered`).toMatch(REFUSED)
    }
  }
  it('"my NVDA alerts" / "both NVDA alerts" / "all my alerts for NVDA": the two NVDA alerts, never the QQQ one', async () => {
    for (const v of DEL_VERBS) for (const w of cased([`${v} my NVDA alerts`, `${v} both NVDA alerts`, `${v} all my alerts for NVDA`, `${v} the NVDA alerts`, `${v} all the alerts on NVDA`])) await cover(w, ['901', '902'])
  })
  it('"the RSI and MACD alerts" / "the RSI alert and the MACD alert": those two only', async () => {
    for (const v of DEL_VERBS) for (const w of cased([`${v} the RSI and MACD alerts`, `${v} the RSI alert and the MACD alert`, `${v} my rsi alert and my macd alert`])) await cover(w, ['901', '902'])
  })
  it('"all my alerts" / "every alert": all three', async () => {
    for (const v of DEL_VERBS) for (const w of cased([`${v} all my alerts`, `${v} every alert`, `${v} all alerts`])) await cover(w, ['901', '902', '903'])
  })
  it('a list part that is itself ambiguous never stretches: "the RSI and the alert" / "the RSI and its alert" (two NVDA alerts) name no alert by the bare part', async () => {
    await loadBook(2)
    for (const w of cased(DEL_VERBS.flatMap(v => [`${v} the QQQ alert and the alert`, `${v} the squeeze alert and the alert`]))) for (const id of ['901', '902']) expect(stateRailRefusal(await del(id), { words: w }), w).toMatch(REFUSED)
    expect(stateRailRefusal(await del('902'), { words: 'remove the RSI and its alert' })).toMatch(REFUSED)
  })
})

describe('5. cross-clause: the delete clause names its alert; the edit clause names its indicator', () => {
  const EDITS = ['change the RSI length to 21', 'make the RSI length 21', 'set the RSI period to 21', 'change RSI to 21']
  const JOINS = [' and ', ', then ', ' then ', '. ', '; ']
  const WORDS = cased(EDITS.flatMap(e => JOINS.flatMap(j => DEL_VERBS.flatMap(v => [`${e}${j}${v} the MACD alert`, `${v} the MACD alert${j}${e}`]))))
  for (const n of [2, 3]) {
    it(`${n} alerts: each of ${WORDS.length} phrasings deletes only the MACD alert and applies the RSI edit`, async () => {
      await loadBook(n)
      const macd = await del('902'), rsi = await del('901'), edit = await planOf(RSI_EDIT)
      const qqq = n === 3 ? await del('903') : null
      for (const w of WORDS) {
        expect(stateRailRefusal(macd, { words: w }), w).toBe(null)
        expect(stateRailRefusal(edit, { words: w }), w).toBe(null)
        expect(stateRailRefusal(rsi, { words: w }), `mis-planned (the RSI alert): ${w}`).toMatch(REFUSED)
        if (qqq) expect(stateRailRefusal(qqq, { words: w }), `mis-planned (the QQQ alert): ${w}`).toMatch(REFUSED)
      }
    })
  }
  it('the edit clause alone never deletes an alert', async () => {
    for (const id of ['901', '902', '903']) for (const e of EDITS) expect(stateRailRefusal(await del(id), { words: e }), e).toMatch(REFUSED)
  })
})

describe('6. controls: pause still behaves as before, and the two never license each other', () => {
  it('"pause the MACD alert" (both running) pauses the MACD alert, never the RSI one; "pause the alert" with two running fails closed', async () => {
    fx.host.indicatorAlerts.list = async () => ALL.slice(0, 2).map(a => ({ id: a.id, sym: a.sym, ...a.row, active: true }))
    _resetIndicatorAlertCache()
    await loadIndicatorAlerts(fx.host, { force: true })
    const macd = await pause('902'), rsi = await pause('901')
    expect(stateRailRefusal(macd, { words: 'pause the MACD alert' })).toBe(null)
    expect(stateRailRefusal(rsi, { words: 'pause the MACD alert' })).toMatch(REFUSED)
    for (const p of [macd, rsi]) {
      expect(stateRailRefusal(p, { words: 'pause the alert' })).toMatch(REFUSED)
      expect(stateRailRefusal(p, { words: 'pause all my alerts' })).toBe(null)
    }
  })
  it('a pause covers RUNNING alerts only (a paused one is no peer), a delete covers every alert', async () => {
    await loadBook(2)                                    // RSI running, MACD paused
    expect(stateRailRefusal(await pause('901'), { words: 'pause the NVDA alert' })).toBe(null)      // the one running NVDA alert
    expect(stateRailRefusal(await del('901'), { words: 'delete the NVDA alert' })).toMatch(REFUSED)  // two NVDA alerts in the book
  })
  it('a delete word never pauses; a pause word never deletes', async () => {
    for (const w of cased(DEL_VERBS.map(v => `${v} the RSI alert`))) expect(stateRailRefusal(await pause('901'), { words: w }), w).toMatch(REFUSED)
    for (const w of cased(['pause', 'mute', 'turn off', 'disable', 'stop'].map(v => `${v} the RSI alert`))) expect(stateRailRefusal(await del('901'), { words: w }), w).toMatch(REFUSED)
  })
})

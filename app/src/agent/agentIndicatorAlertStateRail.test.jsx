// #1263 × the #1247 STATE RAIL — the member's EXISTING indicator alerts are state. Creating one only adds ("only on this chart"
// included); DELETING one is a hard delete UCT cannot restore, licensed ONLY by its own words (kind-matched: a delete of
// something else, or an additive request, never deletes an alert). PAUSING one (AUDIT #1263) silently stops a live notification:
// its own effect `alert:pause`, licensed only by a pause word on that alert. RESUMING is no effect. "Delete the RSI alert" names the ALERT, never the RSI indicator (and the reverse).
// #1289 step identity: an alert addressed while its indicator is changed in the same request is the SAME alert (its id).
// H14 (unique identification, #1324 — not merged here): "delete the alert" with several alerts in scope must be ASKED; pinned
// below as a todo with the design note, so the merge has a red target.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { stateEffects, stateRailRefusal } from './stateRail'
import { stateFixture } from './__fixtures__/stateBoard'
import { loadIndicatorAlerts, _resetIndicatorAlertCache, indicatorAlertKind } from './capabilities/indicatorAlerts'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()

const ROWS = [
  { id: '901', sym: 'SPY', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, instance_id: 'inst:rsi:1' },
  { id: '902', sym: 'SPY', indicator: 'macd', condition: 'cross_zero', threshold: null, tf: 'D', active: false, instance_id: null },
]
const book = () => ({ list: async () => ROWS.map(a => ({ ...a })), catalog: async () => [], create: async () => ({ ok: true, id: '999' }),
  toggle: async () => ({ ok: true }), remove: vi.fn(async () => ({ ok: true })) })
let fx
beforeEach(async () => {
  fx = stateFixture()
  fx.host.indicatorAlerts = book()
  _resetIndicatorAlertCache()
  await loadIndicatorAlerts(fx.host, { force: true })
})
const op = (action, target, args = {}) => ({ action, target, args })
async function planOf(ops) {
  buildContext(fx.host, { surface: 'charts' })
  const kinds = [...new Set(ops.map(o => (String(o.target).startsWith('ixe:') ? 'indicatorEdits' : o.target === 'indicatorAlerts' ? 'indicatorAlertLibrary' : 'indicatorAlert')))]
  return planOps(collectTargets(fx.host, kinds), ops, { boundDrawingIds: new Set(), boundAlerts: [], ...(await prepareOps(ops)) }, { surface: 'charts' })
}
const DELETE_RSI_ALERT = [op('indicatorAlert.delete', '901')]
const REFUSED = /^I didn’t change anything/

describe('an EXISTING indicator alert is state: a delete is a destroy, licensed only by its own words', () => {
  it('the delete is read as one alert:delete effect on that alert (by id)', async () => {
    const del = await planOf(DELETE_RSI_ALERT)
    expect(del.ok).toBe(true)
    expect(stateEffects(del).map(e => [e.state, e.type, e.id])).toEqual([['alert', 'delete', 'alert:901']])
  })
  const ADDITIVE = ['add an RSI alert above 70', 'ADD AN ALERT', 'alert me when the RSI crosses 70 too', 'another alert on this chart only',
    'put a new alert on the MACD', 'set an alert, don’t delete anything', 'also alert me on the 20 EMA', 'do it', 'ok']
  it.each(ADDITIVE)('an additive (or permit-less) request never deletes an existing alert: "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(DELETE_RSI_ALERT), { words: w })).toMatch(REFUSED)
  })
  const EXPLICIT = ['delete the RSI alert', 'remove my rsi alert', 'cancel the RSI alert', 'Cancel my alerts', 'delete the RSI alert on SPY', 'trash the rsi alarm']
  it.each(EXPLICIT)('its own words delete it: "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(DELETE_RSI_ALERT), { words: w })).toBe(null)
  })
  // ⛔ AUDIT #1263 (wrong-target hard delete): with the RSI and the MACD alert both on SPY, a singular object that covers both
  // names neither — fails closed (agentIndicatorAlertDeleteCoverage.test.jsx generates the class)
  const UNCOVERED = ['Delete the alert', 'get rid of the alert', 'delete the alert on SPY', 'trash the alarm']
  it.each(UNCOVERED)('a singular object covering two alerts deletes neither: "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(DELETE_RSI_ALERT), { words: w })).toMatch(REFUSED)
  })
  const OTHER_KIND = ['remove the RSI', 'delete my drawings', 'clear the watchlist', 'remove the indicators', 'delete my layout']
  it.each(OTHER_KIND)('a delete of something ELSE never licenses deleting an alert: "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(DELETE_RSI_ALERT), { words: w })).toMatch(REFUSED)
  })
  it('negated words never permit it', async () => {
    for (const w of ['don’t delete the RSI alert', 'never remove my alerts', 'delete nothing'])
      expect(stateRailRefusal(await planOf(DELETE_RSI_ALERT), { words: w }), w).toMatch(REFUSED)
  })
})

describe('"the RSI alert" names the ALERT, never the RSI indicator', () => {
  const REMOVE_RSI = [op('indicator.remove', 'ixe:c1', { instance: 'inst:rsi:1' })]
  it.each(['delete the RSI alert', 'remove my rsi alert', 'remove RSI alert', 'delete the 14 RSI alerts'])('a plan removing the RSI INDICATOR is refused for "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(REMOVE_RSI), { words: w })).toMatch(REFUSED)
  })
  it('…while naming both licenses each ("remove the RSI and delete the RSI alert"; an indicator edit is its own step)', async () => {
    const ind = await planOf(REMOVE_RSI)
    const alert = await planOf(DELETE_RSI_ALERT)
    for (const plan of [ind, alert]) expect(stateRailRefusal(plan, { words: 'remove the RSI and delete the RSI alert' })).toBe(null)
    // the rail's object rule: a verb's object ends at "and" — "remove the RSI and its alert" names the RSI only (fail closed)
    expect(stateRailRefusal(alert, { words: 'remove the RSI and its alert' })).toMatch(REFUSED)
    expect(stateRailRefusal(ind, { words: 'remove the RSI' })).toBe(null)
    expect(stateRailRefusal(alert, { words: 'remove the RSI' })).toMatch(REFUSED)          // the alert was never asked for
  })
  it('"delete that alert" only POINTS: with nothing named before it, a destroy is not licensed (the pointer rule of the rail)', async () => {
    expect(stateRailRefusal(await planOf(DELETE_RSI_ALERT), { words: 'Delete that alert' })).toMatch(REFUSED)
  })
})

describe('#1289 step identity: the alert addressed while its indicator changes is the same alert', () => {
  it('"change the RSI length to 21 and delete the RSI alert": two steps (an indicator edit is its own); the alert is 901 by id', async () => {
    const WORDS = 'change the RSI length to 21 and delete the RSI alert'
    const edit = await planOf([op('indicator.update', 'ixe:c1', { instance: 'inst:rsi:1', inputs: [{ key: 'period', value: 21 }] })])
    expect(edit.ok).toBe(true)
    expect(stateEffects(edit).map(e => e.id)).toEqual(['ind:c1:inst:rsi:1'])
    expect(stateRailRefusal(edit, { words: WORDS })).toBe(null)
    // step 2 is planned AFTER step 1 changed the RSI: the alert book is the same rows (an indicator edit never rewrites an
    // alert), so the RSI alert is still 901, bound to the same instance — the id the delete names
    expect(indicatorAlertKind.read(fx.host, '901').instanceId).toBe('inst:rsi:1')
    const del = await planOf(DELETE_RSI_ALERT)
    expect(stateEffects(del).map(e => e.id)).toEqual(['alert:901'])
    expect(del.plans[0].ref).toBe('901')
    expect(stateRailRefusal(del, { words: WORDS })).toBe(null)
    expect(stateRailRefusal(del, { words: 'change the RSI length to 21' })).toMatch(REFUSED)   // the delete needs its own words
  })
})

describe('H14 unique identification (#1324) — design pin, not merged here', () => {
  // DESIGN: when H14 lands, stateRail.namesObject's class-noun rule ("the alert" names it only when it is the ONLY one in scope)
  // applies to the alert state too: the indicatorAlert reader adds `inScope` (the book's alert count on the symbol) and `peers`,
  // and "delete the alert" with 2+ alerts asks with the real alerts as choices — never picks one. CONFLICT POINTS with #1324:
  // stateRail.js READERS (this branch adds indicatorAlert), CLASS (adds alert), namesObject (this branch's alert-phrase strip
  // at its head; H14 adds the indicator / drawing / watchlist unique rules there) and stateEffects (H14's `scope` param).
  it.todo('"delete the alert" with two alerts in scope is asked, the two alerts as the choices (H14)')
})


// ── AUDIT #1263: PAUSE is its own effect (the quiet-harm class); RESUME is no effect ──────────────────────────────────────
const PAUSE_RSI = [op('indicatorAlert.toggle', '901', { active: false })]
const RESUME_MACD = [op('indicatorAlert.toggle', '902', { active: true })]
const PAUSE_VERBS = ['pause', 'mute', 'disable', 'turn off', 'switch off', 'stop', 'silence', 'deactivate', 'suspend', 'snooze']
const OBJECTS = ['the RSI alert', 'my rsi alert', 'the alert', 'my alerts', 'all my alerts', 'the SPY alert']
const CASES = { lower: (t) => t.toLowerCase(), upper: (t) => t.toUpperCase(), sentence: (t) => t[0].toUpperCase() + t.slice(1) }
describe('pause: its own effect, licensed only by a pause word on that alert', () => {
  it('pausing an active alert is one alert:pause effect (by id); resuming is none', async () => {
    const p = await planOf(PAUSE_RSI)
    expect(p.ok).toBe(true)
    expect(stateEffects(p).map(e => [e.state, e.type, e.id])).toEqual([['alert', 'pause', 'alert:901']])
    const r = await planOf(RESUME_MACD)
    expect(r.ok).toBe(true)
    expect(stateEffects(r)).toEqual([])
    expect(stateRailRefusal(r, { words: 'do it' })).toBe(null)            // resume needs no words of its own (no effect)
  })
  const ALLOWED = PAUSE_VERBS.flatMap(v => OBJECTS.flatMap(o => Object.entries(CASES).map(([cn, f]) => [f(`${v} ${o}`), cn])))
  it.each(ALLOWED)('"%s" (%s) pauses it', async (w) => {
    expect(stateRailRefusal(await planOf(PAUSE_RSI), { words: w })).toBe(null)
  })
  const NOT_PAUSE = ['change the RSI length to 21', 'clean up my chart', 'do it', 'ok', 'add an RSI alert above 70', 'delete the RSI alert',
    'remove the alert', 'update my alerts', 'show my alerts', 'pause the chart', 'turn the RSI off', 'make the RSI 21 and keep my alerts',
    'don’t pause the RSI alert', 'never mute my alerts']
  it.each(NOT_PAUSE.flatMap(w => Object.values(CASES).map(f => f(w))))('no pause word on an alert never pauses it: "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(PAUSE_RSI), { words: w })).toMatch(REFUSED)
  })
  it('a pause inside a broader plan with no pause words is refused (the RSI edit and its alert pause, "change the RSI length to 21")', async () => {
    const edit = await planOf([op('indicator.update', 'ixe:c1', { instance: 'inst:rsi:1', inputs: [{ key: 'period', value: 21 }] })])
    expect(stateRailRefusal(edit, { words: 'change the RSI length to 21' })).toBe(null)
    expect(stateRailRefusal(await planOf(PAUSE_RSI), { words: 'change the RSI length to 21' })).toMatch(REFUSED)
  })
})

describe('"pause the alert" with SEVERAL active alerts names none of them (fails closed; the ask is H14)', () => {
  const TWO_ACTIVE = [{ ...ROWS[0] }, { ...ROWS[1], active: true }]
  beforeEach(async () => {
    fx.host.indicatorAlerts = { ...book(), list: async () => TWO_ACTIVE.map(a => ({ ...a })) }
    _resetIndicatorAlertCache()
    await loadIndicatorAlerts(fx.host, { force: true })
  })
  it.each(['pause the alert', 'mute my alert', 'Turn off the alert', 'stop that alert'])('"%s" with two active alerts is refused', async (w) => {
    expect(stateRailRefusal(await planOf(PAUSE_RSI), { words: w })).toMatch(REFUSED)
  })
  it.each(['pause the RSI alert', 'mute the rsi alert', 'pause all my alerts', 'pause the alerts', 'mute every alert'])('…its own words or a plural still pause it: "%s"', async (w) => {
    expect(stateRailRefusal(await planOf(PAUSE_RSI), { words: w })).toBe(null)
  })
  it.todo('"pause the alert" with two active alerts ASKS with the real alerts as choices (needs H14 #1324 inScope choices)')
})

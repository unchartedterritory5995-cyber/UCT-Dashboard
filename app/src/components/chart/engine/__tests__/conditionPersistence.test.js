import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from '../../chartDefaults'
import {
  addCondition, removeCondition, renameCondition, setConditionEnabled,
  setConditionFormula, moveCondition, addAction, removeAction, setActionSettings,
  setConditionBinding, conditionsOf, BINDING_KEYS,
} from '../conditionControls'
import { instanceSource, parseSource, isSeveredSource } from '../sourceRef'
import { setIndicatorEnabled, addInstance, removeInstance, setInstanceInput } from '../instanceControls'
import * as registry from '../nativeRegistry'
import { COND_TRUE } from '../conditions'
import { resolveCandleColors, colorRuns, resolveMarkers } from '../conditionActions'

// ─── WHAT IS STORED, AND WHAT IS NEVER STORED ───────────────────────────────
//
// ⭐ ONLY THE DEFINITION SURVIVES A RELOAD: the rule, its bindings, its actions
// and their order. The boolean columns, the background rectangles and the
// resolved candle colours are DERIVED from the bars on screen — they would be
// wrong for the next symbol, the next timeframe and the next zoom, and a blob
// carrying them would be a second authority over what the formula says.

const base = () => mergeChartSettings(JSON.stringify({}))
const reload = (cs) => mergeChartSettings(JSON.stringify(cs))

describe('persistence', () => {
  it('⭐ a condition survives a save → load cycle, with its actions and their order', () => {
    let cs = addCondition(base(), { name: 'Inside Bar', formula: 'high < high[1] && low > low[1]' })
    const id = conditionsOf(cs)[0].id
    cs = addAction(cs, id, 'candleColor')
    cs = addAction(cs, id, 'marker')
    cs = setActionSettings(cs, id, conditionsOf(cs)[0].actions[1].id, { shape: 'triangleUp', position: 'aboveBar' })

    const back = conditionsOf(reload(cs))
    expect(back).toHaveLength(1)
    expect(back[0].name).toBe('Inside Bar')
    expect(back[0].formula).toBe('high < high[1] && low > low[1]')
    expect(back[0].actions.map((a) => a.type)).toEqual(['candleColor', 'marker'])
    expect(back[0].actions[1].shape).toBe('triangleUp')
    expect(back[0].actions[1].position).toBe('aboveBar')
  })

  it('⭐ a BINDING survives too — it is the same reference string a source input takes', () => {
    let cs = addCondition(base(), { name: 'Over 50', formula: 'a > 50' })
    const id = conditionsOf(cs)[0].id
    cs = setConditionBinding(cs, id, 'a', instanceSource('legacy:rsi', 'rsi'))
    expect(conditionsOf(reload(cs))[0].bindings).toEqual({ a: '@legacy:rsi::rsi' })
  })

  it('⛔ NO WRITE ON LOAD — a blob with no conditions gains an empty list and nothing else', () => {
    const once = reload(CHART_DEFAULTS)
    const twice = reload(once)
    expect(once.conditions).toEqual([])
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('⛔⛔ NO DERIVED STATE IS PERSISTED — not one column, rectangle or resolved colour', () => {
    let cs = addCondition(base(), { name: 'Up', formula: 'close > open' })
    const id = conditionsOf(cs)[0].id
    cs = addAction(cs, id, 'candleColor')
    cs = addAction(cs, id, 'background')
    const text = JSON.stringify(reload(cs))
    // The rule, yes. The answer, never.
    expect(text).toContain('close > open')
    for (const forbidden of ['Uint8Array', 'runs', 'column', 'from', 'to']) {
      // `from`/`to` are the RUN shape; a stored run would put them inside the
      // conditions array, so the check is scoped to it rather than to the blob.
      const conds = JSON.stringify(reload(cs).conditions)
      expect(conds, `a derived \`${forbidden}\` reached the blob`).not.toContain(`"${forbidden}"`)
    }
  })

  it('⛔ an unreadable row is dropped on load and takes nothing with it', () => {
    const cs = reload({ ...base(), conditions: [{ nonsense: true }, { id: 'a', formula: 'close > open' }] })
    expect(conditionsOf(cs).map((c) => c.id)).toEqual(['a'])
  })
})

describe('the write door', () => {
  const withOne = () => {
    const cs = addCondition(base(), { name: 'A', formula: 'close > open' })
    return [cs, conditionsOf(cs)[0].id]
  }

  it('⛔ a formula that is not a condition is REFUSED — the blob is untouched', () => {
    const cs = base()
    expect(addCondition(cs, { name: 'N', formula: 'rsi(close, 14)' })).toBe(cs)
    const [one, id] = withOne()
    expect(setConditionFormula(one, id, 'close')).toBe(one)
    expect(conditionsOf(one)[0].formula).toBe('close > open')
  })

  it('⭐ RENAMING NEVER TOUCHES THE ID, so the actions stay attached', () => {
    let [cs, id] = withOne()
    cs = addAction(cs, id, 'marker')
    cs = renameCondition(cs, id, 'Something else')
    expect(conditionsOf(cs)[0].id).toBe(id)
    expect(conditionsOf(cs)[0].name).toBe('Something else')
    expect(conditionsOf(cs)[0].actions).toHaveLength(1)
  })

  it('⛔ DELETING a condition takes its actions and leaves the rest alone', () => {
    let cs = addCondition(base(), { name: 'A', formula: 'close > open' })
    cs = addCondition(cs, { name: 'B', formula: 'close < open' })
    const [a, b] = conditionsOf(cs)
    cs = addAction(cs, a.id, 'candleColor')
    cs = addAction(cs, b.id, 'marker')
    cs = removeCondition(cs, a.id)
    expect(conditionsOf(cs).map((c) => c.name)).toEqual(['B'])
    expect(conditionsOf(cs)[0].actions).toHaveLength(1)
  })

  it('⭐ MOVING a condition changes its PRIORITY and nothing else', () => {
    let cs = addCondition(base(), { name: 'A', formula: 'close > open' })
    cs = addCondition(cs, { name: 'B', formula: 'close < open' })
    const b = conditionsOf(cs)[1]
    cs = moveCondition(cs, b.id, -1)
    expect(conditionsOf(cs).map((c) => c.name)).toEqual(['B', 'A'])
    // …and it refuses to walk off either end rather than wrapping.
    expect(moveCondition(cs, conditionsOf(cs)[0].id, -1)).toBe(cs)
    expect(moveCondition(cs, conditionsOf(cs)[1].id, 1)).toBe(cs)
  })

  it('⛔ a refusal returns the SAME OBJECT, which is the caller’s whole error handling', () => {
    const [cs, id] = withOne()
    expect(removeCondition(cs, 'nope')).toBe(cs)
    expect(renameCondition(cs, id, '   ')).toBe(cs)
    expect(setConditionEnabled(cs, 'nope', false)).toBe(cs)
    expect(addAction(cs, id, 'teleport')).toBe(cs)
    expect(removeAction(cs, id, 'nope')).toBe(cs)
    expect(setActionSettings(cs, id, 'nope', { color: '#fff' })).toBe(cs)
    expect(setConditionBinding(cs, id, 'NOT A KEY', 'close')).toBe(cs)
  })

  it('an action’s identity is not a setting', () => {
    let [cs, id] = withOne()
    cs = addAction(cs, id, 'marker')
    const act = conditionsOf(cs)[0].actions[0]
    const after = setActionSettings(cs, id, act.id, { type: 'candleColor', id: 'hacked', color: '#fff' })
    const now = conditionsOf(after)[0].actions[0]
    expect(now.type).toBe('marker')
    expect(now.id).toBe(act.id)
    expect(now.color).toBe('#fff')
  })

  it('binding slots are the short names the formula reads', () => {
    expect(BINDING_KEYS).toEqual(['a', 'b', 'c'])
  })
})

// ─── THE CHANNELS, ON THE DATA THEY ACTUALLY GET ────────────────────────────

describe('candle colour is an OVERRIDE, not a replacement renderer', () => {
  const conds = [{
    id: 'c1', name: 'A', formula: 'x', enabled: true, bindings: {},
    actions: [{ id: 'a1', type: 'candleColor', enabled: true, color: '#ffffff' }],
  }]
  const col = Uint8Array.from([0, 1, 0, 1, 0])
  const columnOf = () => col

  it('⛔⛔ A NON-MATCHING BAR IS PASSED THROUGH BY IDENTITY', () => {
    // The base styling — theme, up/down colour, hollow shape, the pre-market
    // preview candle, the Model Book look — all write per-bar colours upstream.
    // A condition must leave every one of them exactly as it found them.
    const themed = [
      { time: 1, color: '#2faf68', borderColor: '#2faf68', wickColor: '#2faf68' },
      { time: 2, color: '#df4646', borderColor: '#df4646', wickColor: '#df4646' },
      { time: 3, color: '#2faf68', borderColor: '#111', wickColor: '#222' },
      { time: 4, color: 'rgba(0,0,0,0)', borderColor: '#2faf68', wickColor: '#2faf68' },
      { time: 5, color: '#df4646' },
    ]
    const colors = resolveCandleColors(conds, columnOf, themed.length)
    const out = themed.map((d, i) => (colors[i] ? { ...d, color: colors[i], borderColor: colors[i], wickColor: colors[i] } : d))
    // Identity, not deep equality: the untouched bars are the SAME objects.
    expect(out[0]).toBe(themed[0])
    expect(out[2]).toBe(themed[2])
    expect(out[4]).toBe(themed[4])
    // …and the matched ones carry the override on all three.
    expect(out[1]).toEqual({ time: 2, color: '#ffffff', borderColor: '#ffffff', wickColor: '#ffffff' })
    expect(out[3].color).toBe('#ffffff')
  })

  it('⛔ …and with the condition off, every bar is the original object', () => {
    const colors = resolveCandleColors([{ ...conds[0], enabled: false }], columnOf, 5)
    expect(colors).toBe(null)
  })
})

describe('background runs are geometry, not pixels', () => {
  const bars = Array.from({ length: 8 }, (_, i) => ({ t: 1000 + i * 60 }))
  const conds = [{
    id: 'c1', name: 'R', formula: 'x', enabled: true, bindings: {},
    actions: [{ id: 'a1', type: 'background', enabled: true, color: 'rgba(0,255,0,0.1)' }],
  }]
  const col = Uint8Array.from([0, 1, 1, 1, 0, 1, 1, 0])

  it('⭐⭐ five true bars become TWO bands, and they are TIMES', () => {
    const colors = resolveCandleColors([], () => col, 8)   // no candle rule
    expect(colors).toBe(null)
    const bg = colorRuns([null, 'g', 'g', 'g', null, 'g', 'g', null], bars, (t) => t)
    expect(bg).toEqual([
      { from: 1060, to: 1180, color: 'g' },
      { from: 1300, to: 1360, color: 'g' },
    ])
    // ⛔ NOT A PIXEL ANYWHERE. A stored X would be wrong at the next zoom.
    for (const r of bg) {
      expect(typeof r.from).toBe('number')
      expect(r).not.toHaveProperty('x')
      expect(r).not.toHaveProperty('left')
    }
  })

  it('⛔ the ADJUSTED chart time is used, not the raw bar stamp', () => {
    // Intraday bars are stored raw and drawn ET-shifted; a band built on the raw
    // stamp lands in the wrong place and `timeToCoordinate` quietly returns null.
    const shifted = colorRuns([null, 'g', 'g'], bars, (t) => t + 18000)
    expect(shifted[0].from).toBe(1060 + 18000)
  })

  it('a run reaching the last bar is closed', () => {
    expect(colorRuns(['g', 'g'], bars, (t) => t)).toEqual([{ from: 1000, to: 1060, color: 'g' }])
  })

  it('markers carry shape, position and colour and nothing positional', () => {
    const m = resolveMarkers([{
      ...conds[0],
      actions: [{ id: 'a1', type: 'marker', enabled: true, shape: 'triangleUp', position: 'aboveBar', color: '#f0f' }],
    }], () => col, bars, (t) => t)
    expect(m).toHaveLength(5)
    expect(m[0]).toMatchObject({ position: 'aboveBar', color: '#f0f', shape: 'arrowUp' })
    expect(m.every((x) => typeof x.time === 'number')).toBe(true)
    expect(new Set(m.map((x) => x.id)).size, 'two markers share one id').toBe(5)
    expect(col[1]).toBe(COND_TRUE)
  })
})


// ─── DELETION BREAKS THE DEPENDENCY ───────────────────────────────
//
// ⭐⭐ OWNER DECISION, LOCKED, AND IT CAME FROM A MEASUREMENT. `legacy:<defId>` is
// DETERMINISTIC per definition, so deleting RSI and adding it again minted the
// very same id and every reference to it silently reconnected. "The same
// definition appeared again" is not the same logical instance.
//
// ⛔ SEVERED AT THE DELETE, NOT RE-RESOLVED AT THE READ — the smallest correct
// place. No id scheme changes, no persistence migration, and the severed string
// is one `parseSource` refuses, so every consumer that already renders "Source
// unavailable" handles it with no new branch.

describe('deleting a source severs what pointed at it', () => {
  const rsiOn = () => setIndicatorEnabled(base(), 'rsi', true, registry)

  it('⛔⛔ an indicator SOURCE is severed, and re-adding does NOT reconnect it', () => {
    let cs = rsiOn()
    cs = addInstance(cs, 'movingAverage', registry)
    const ma = (x) => (x.indicatorInstances || []).find((i) => i && i.defId === 'movingAverage' && !i.deleted)
    cs = setInstanceInput(cs, ma(cs).instanceId, 'source', instanceSource('legacy:rsi', 'rsi'), registry)
    expect(ma(cs).inputs.source).toBe('@legacy:rsi::rsi')

    cs = removeInstance(cs, 'legacy:rsi', registry)
    const after = ma(cs).inputs.source
    expect(isSeveredSource(after), 'the reference was not severed').toBe(true)
    expect(parseSource(after), 'a severed reference must not read back').toBe(null)
    // ⚠️ AND IT DID NOT FALL BACK TO `close`, which is the whole point.
    expect(after).toContain('legacy:rsi::rsi')

    // Re-adding the SAME definition mints the same deterministic id — and the
    // reference still does not resolve.
    cs = setIndicatorEnabled(cs, 'rsi', true, registry)
    expect(parseSource(ma(cs).inputs.source)).toBe(null)
  })

  it('⛔ a CONDITION binding is severed by the same one function', () => {
    let cs = rsiOn()
    cs = addCondition(cs, { name: 'Over 50', formula: 'a > 50' })
    const id = conditionsOf(cs)[0].id
    cs = setConditionBinding(cs, id, 'a', instanceSource('legacy:rsi', 'rsi'))
    cs = removeInstance(cs, 'legacy:rsi', registry)
    const ref = conditionsOf(cs)[0].bindings.a
    expect(isSeveredSource(ref)).toBe(true)
    expect(parseSource(ref)).toBe(null)
    // The FORMULA is untouched — nothing silently rewrites what the member wrote.
    expect(conditionsOf(cs)[0].formula).toBe('a > 50')
  })

  it('⛔ switching the DEFINITION off severs too — it is a delete by another name', () => {
    let cs = rsiOn()
    cs = addCondition(cs, { name: 'Over 50', formula: 'a > 50' })
    const id = conditionsOf(cs)[0].id
    cs = setConditionBinding(cs, id, 'a', instanceSource('legacy:rsi', 'rsi'))
    cs = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(isSeveredSource(conditionsOf(cs)[0].bindings.a)).toBe(true)
  })

  it('✅ an UNRELATED reference is left exactly alone', () => {
    let cs = rsiOn()
    cs = addCondition(cs, { name: 'Up', formula: 'close > open' })
    cs = addCondition(cs, { name: 'Over 50', formula: 'a > 50' })
    const [up, over] = conditionsOf(cs)
    cs = setConditionBinding(cs, over.id, 'a', instanceSource('legacy:rsi', 'rsi'))
    const before = JSON.stringify(conditionsOf(cs)[0])
    cs = removeInstance(cs, 'legacy:rsi', registry)
    expect(JSON.stringify(conditionsOf(cs)[0])).toBe(before)
    expect(conditionsOf(cs)[0].id).toBe(up.id)
  })
})

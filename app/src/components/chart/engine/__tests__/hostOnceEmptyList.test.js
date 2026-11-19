// app/src/components/chart/engine/__tests__/hostOnceEmptyList.test.js
//
// ─── ⭐⭐ ONCE-EMPTY LIST (coordinator ruling (B), 2026-11-19) — A TEST OF A LIST NOTHING HAS WRITTEN YET ─────────────
//
// `var ps = array.new<P>()`, and every write to `ps` stands later in the script inside an `if` that is provably
// `barstate.islast`: a test of `ps` standing before those writes (`if ps.size() > 0`, `if array.size(ps) > 0`,
// `for p in ps`), in no loop, meets an empty list on every bar the host lane runs, so the block under it runs no step
// and is not walked (`pineObjects.js::listEmptyOnOnce`). ⚰️ Walked, the class guard (two-step delete, #2014) counted
// the deletes in it and withheld `htf-candle-footprint-cartel-console`, whose three body boxes its captures grade as
// TradingView's (`vendorHarness.c31Loops`, `f4SpyDrawings`): a correct picture taken away.
//
// ⛔ SOUND IN THE HOST LANE'S EXECUTION MODEL, which this file checks rather than assumes: a chart's drawings are one
// full recompute over the bars it holds (`hostObjects.js::hostObjectRun`, `evaluateObjects` from a fresh state), and
// the newest bar is its only last bar. TradingView instead re-runs the block on every new realtime bar with the list
// committed from the bar before, so there the deletes DO fire; for this shape they remove exactly what the block's
// previous run drew, and the end state equals the recompute's. The sequence below (history, then two realtime bars)
// checks both, step by step, against Pine's incremental semantics worked by hand.
// ⛔ Every other shape still counts the step and withholds the drawing by name (the controls).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'

afterEach(() => { vi.unstubAllEnvs() })

const HISTORY = 40
const ALL = Array.from({ length: HISTORY + 2 }, (_, i) => {
  const o = 100 + i
  const c = i % 3 === 0 ? o - 1 : o + 1
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
})
const H = '//@version=6\nindicator("p", overlay = true)\ntype P\n    array<label> labels\nvar ps = array.new<P>()\n'
const DELETE_ALL = '        for p in ps\n            for l in p.labels\n                l.delete()\n        ps.clear()\n'
const DRAW = (text) => `    ls = array.new<label>()\n    ls.push(label.new(bar_index, high, "${text}"))\n    ps.push(P.new(ls))\n`
const REMOVES = /removes drawings as it runs/

function door(source, id) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  return memberPaneDefinition({ source, id, name: 'once' })
}
/** The host lane's picture over these bars, as `text@bar`. */
function picture(d, bars) {
  const out = hostObjectRun(d.definition, bars, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  return out.run.live.map((o) => `${o.props.text}@${o.props.x}`).sort()
}
function served(source, id) {
  const d = door(source, id)
  if (!d.ok || !d.definition.objects) return { ok: false, reason: String(d.reason || '') }
  return { ok: true, live: picture(d, ALL.slice(0, HISTORY)) }
}

/** Pine's incremental semantics for the PROFILE script, by hand: a chart loaded with `history` bars runs the last-bar
 *  block once (on bar history-1, the list empty); each realtime bar runs it again with the list committed from the
 *  bar before: every label of every profile is deleted, the list cleared, one label drawn on the new bar. */
function pineIncremental(history, realtime) {
  let ps = []
  const live = new Set()
  for (let bar = history - 1; bar <= history - 1 + realtime; bar += 1) {
    for (const p of ps) for (const l of p) live.delete(l)
    ps = []
    const l = `now@${bar}`
    live.add(l)
    ps.push([l])
  }
  return [...live].sort()
}

const PROFILE = `${H}if barstate.islast\n    if ps.size() > 0\n${DELETE_ALL}${DRAW('now')}`

describe('a test of a list nothing has written yet runs no step: the picture is served, as TradingView draws it', () => {
  it('history, then two realtime bars: each step equals Pine\'s incremental run by hand, and a cold recompute', () => {
    const d = door(PROFILE, 'u_oe_seq')
    expect(d.ok, d.reason).toBe(true)
    expect(!!d.definition.objects).toBe(true)
    const steps = [0, 1, 2].map((k) => picture(d, ALL.slice(0, HISTORY + k)))
    for (const k of [0, 1, 2]) expect(steps[k], `step ${k}`).toEqual(pineIncremental(HISTORY, k))
    // ⭐ Nothing carries between evaluations: step 2 again, cold, after the other two.
    expect(picture(door(PROFILE, 'u_oe_seq_cold'), ALL.slice(0, HISTORY + 2))).toEqual(steps[2])
  })
  it('`array.size(ps) > 0`, the function form of the test', () => {
    const got = served(`${H}if barstate.islast\n    if array.size(ps) > 0\n${DELETE_ALL}${DRAW('now')}`, 'u_oe_fn')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toEqual([`now@${HISTORY - 1}`])
  })
  it('`for p in ps` with no size test', () => {
    const got = served(`${H}if barstate.islast\n    for p in ps\n        for l in p.labels\n            l.delete()\n    ps.clear()\n${DRAW('now')}`, 'u_oe_forin')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toEqual([`now@${HISTORY - 1}`])
  })
})

describe('every other shape still counts the removal and withholds the drawing by name', () => {
  const CONTROLS = {
    // Pine: the last bar deletes the 39 labels drawn before it, then draws one; skipping the deletes would draw 40.
    'written on every bar': `${H}if barstate.islast\n    if ps.size() > 0\n${DELETE_ALL}${DRAW('bar').replace(/^ {4}/gm, '')}`,
    // Pine: the label drawn just above is deleted (0 labels); skipping the deletes would draw it.
    'written BEFORE the test, in the same last-bar block': `${H}if barstate.islast\n${DRAW('early')}    if ps.size() > 0\n${DELETE_ALL}`,
    // Pine: the label drawn on the bars before the last is deleted on it; skipping the deletes would draw them.
    'written in the `else` of the last-bar `if` (every other bar)': `${H}if barstate.islast\n    if ps.size() > 0\n${DELETE_ALL}else\n${DRAW('else')}`,
    // Pine: pass 0 draws a label and pushes it, pass 1 finds it and deletes it before drawing its own (1 label);
    // skipping the deletes would draw both.
    'the test inside a loop': `${H}if barstate.islast\n    for i = 0 to 1\n        if ps.size() > 0\n`
      + '            for p in ps\n                for l in p.labels\n                    l.delete()\n            ps.clear()\n'
      + '        ls = array.new<label>()\n        ls.push(label.new(bar_index - i, high, "loop"))\n        ps.push(P.new(ls))\n',
    // Pine: `ps` starts holding `l0`, which the last bar deletes (0 labels); skipping the deletes would draw `l0`.
    'a list made with an element (`array.new<P>(1, …)`)': '//@version=6\nindicator("p", overlay = true)\ntype P\n    array<label> labels\n'
      + 'var label l0 = label.new(bar_index, high, "init")\nvar ps = array.new<P>(1, P.new(array.from(l0)))\n'
      + `if barstate.islast\n    if ps.size() > 0\n${DELETE_ALL}`,
  }
  for (const [what, src] of Object.entries(CONTROLS)) {
    it(what, () => {
      const got = served(src, 'u_oe_ctl')
      expect(got.ok, `served ${JSON.stringify(got.live)}`).toBe(false)
      expect(got.reason).toMatch(REMOVES)
    })
  }
})

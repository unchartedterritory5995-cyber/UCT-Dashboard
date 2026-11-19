// app/src/components/chart/engine/__tests__/hostTwoStepRemoval.test.js
//
// ─── ⭐⭐ TWO-STEP REMOVAL + THE CLASS GUARD (2026-11-19, coordinator ruling) ──────────────────────────────────────
//
// `old = array.shift(xs)` then `label.delete(old)` / `old.delete()` is one Pine program with
// `label.delete(array.shift(xs))` (array.shift: "Removes an array's first element and returns its value"; label.delete:
// "Deletes the specified label object"). The host lane served the one-call form and NOT the two-step one:
//   · the function form was refused by name (`delete:target`), a lost picture;
//   · the METHOD form `old.delete()` emitted nothing at all and the declaration carried no removal, so the member door
//     SERVED the drawing with every label kept — 26 on these bars where TradingView keeps 3. A silent wrong picture.
// Now the adjacent pair walks the one-call lowering (`pineObjects.js::twoStepRemovalFusion`), and every other delete or
// setter on a handle the walker cannot trace is COUNTED (`emitMethodForm`'s class guard), so the drawing is withheld by
// name, never drawn with objects TradingView removed.
// The product path: source -> memberPaneDefinition (the member door, host lane) -> hostObjectRun (the binder's own
// evaluation of a host object program). The reference is Pine's semantics run by hand in this file, per bar.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'
import { translatePine } from '../ast/pine'

afterEach(() => { vi.unstubAllEnvs() })

const H = '//@version=6\nindicator("p", overlay = true, max_labels_count = 500)\nvar xs = array.new<label>()\n'
  + 'if close > open\n    array.push(xs, label.new(bar_index, high, "u"))\n'
const BARS = Array.from({ length: 40 }, (_, i) => {
  const o = 100 + i
  const c = i % 3 === 0 ? o - 1 : o + 1
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
})

/** Pine, by hand: the bars whose label is still on the chart after the last bar. */
function pineLive(take) {
  const xs = []
  const live = new Set()
  BARS.forEach((b, i) => {
    if (b.c > b.o) { xs.push(i); live.add(i) }
    if (xs.length > 3) {
      const old = take === 'pop' ? xs.pop() : xs.shift()
      live.delete(old)
    }
  })
  return [...live].sort((a, b) => a - b)
}

/** The member door on the host lane, then the binder's evaluation of the host object program. */
function served(source, id) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id, name: 'two-step' })
  if (!d.ok || !d.definition.objects) return { ok: false, reason: d.reason || '', live: null }
  const out = hostObjectRun(d.definition, BARS, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  return { ok: true, lane: d.lane || 'host', live: out.run.live.map((o) => o.createdBar).sort((a, b) => a - b) }
}

const FORMS = {
  'shift, function form': ['shift', 'old = array.shift(xs)\n    label.delete(old)'],
  'shift, method form': ['shift', 'old = array.shift(xs)\n    old.delete()'],
  'shift, typed name': ['shift', 'label old = array.shift(xs)\n    label.delete(old)'],
  'shift, method-form list': ['shift', 'old = xs.shift()\n    old.delete()'],
  'pop, function form': ['pop', 'old = array.pop(xs)\n    label.delete(old)'],
  'remove(xs, 0), method form': ['shift', 'old = array.remove(xs, 0)\n    old.delete()'],
}

describe('the two-step form draws what Pine draws, as the one-call form does', () => {
  it('the reference itself: 3 labels stay (a rail over nothing passes)', () => {
    expect(pineLive('shift')).toHaveLength(3)
    expect(pineLive('pop')).toHaveLength(3)
    expect(pineLive('pop')).not.toEqual(pineLive('shift'))
  })
  it('the one-call form (served before this change) is the same picture', () => {
    const got = served(`${H}if array.size(xs) > 3\n    label.delete(array.shift(xs))\n`, 'u_2s_one')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toEqual(pineLive('shift'))
  })
  for (const [name, [take, body]] of Object.entries(FORMS)) {
    it(`${name}: served on the host lane, the labels Pine keeps and no other`, () => {
      const got = served(`${H}if array.size(xs) > 3\n    ${body}\n`, `u_2s_${name.replace(/\W+/g, '_')}`)
      expect(got.ok, got.reason).toBe(true)
      expect(got.lane).toBe('host')
      expect(got.live).toEqual(pineLive(take))
    })
  }
})

describe('⛔ CLASS GUARD: a delete or setter on a handle the walker cannot trace is withheld by name, never drawn past', () => {
  const REMOVES = /removes drawings as it runs/
  it('the method-form delete NOT next to its removal (the 26-label shape): refused by name', () => {
    const got = served(`${H}if array.size(xs) > 3\n    old = array.shift(xs)\n    k = 1\n    old.delete()\n`, 'u_2s_gap')
    expect(got.ok).toBe(false)
    expect(got.reason).toMatch(REMOVES)
  })
  it('the removed name read again after its delete: not fused, refused by name', () => {
    const got = served(`${H}if array.size(xs) > 3\n    old = array.shift(xs)\n    old.delete()\n    label.new(bar_index, low, str.tostring(na(old)))\n`, 'u_2s_used')
    expect(got.ok).toBe(false)
    expect(got.reason).toMatch(REMOVES)
  })
  it('a `var` name is never fused: refused by name', () => {
    const got = served(`${H}if array.size(xs) > 3\n    var old = array.shift(xs)\n    old.delete()\n`, 'u_2s_var')
    expect(got.ok).toBe(false)
  })
  it('a method-form setter on an untraced handle: nothing is drawn in a state Pine changed', () => {
    const got = served(`${H}if array.size(xs) > 3\n    old = array.shift(xs)\n    old.set_text("gone")\n`, 'u_2s_set')
    expect(got.ok).toBe(false)
  })
  it('a removal into a name that is never deleted LOSES ITS LIST by name (shift does not delete: every label stays)', () => {
    const src = `${H}if array.size(xs) > 3
    old = array.shift(xs)
if array.size(xs) > 5
    label.delete(array.get(xs, 0))
`
    const t = translatePine(src)
    expect((t.objectDiagnostics.collsDivergedWhy || []).join(' ')).toMatch(/xs: coll:shift-into-name@7/)
    // the delete that reads the lost list is counted, never run on a length the list does not have
    expect(t.objectDiagnostics.dropReasons['coll:diverged']).toBe(1)
    // Pine: the slot leaves the list and its label stays, and `array.size(xs) > 5` never holds: every up bar's label
    const got = served(src, 'u_2s_lost')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toEqual(BARS.map((b, i) => (b.c > b.o ? i : null)).filter((i) => i !== null))
  })
})

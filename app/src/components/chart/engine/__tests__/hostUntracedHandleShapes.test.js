// app/src/components/chart/engine/__tests__/hostUntracedHandleShapes.test.js
//
// ─── ⭐⭐ A STEP THROUGH A HANDLE THE HOST CANNOT TRACE IS WITHHELD BY NAME — ONE PROBE PER SHAPE ─────────────────────
//
// FIELD REGISTER STEP A's class sweep (coordinator rulings 2026-11-19): a drawing reached through a map value, a matrix
// element, a field of an array's element, a function's result or a ternary's field is a step the host object program
// cannot EXECUTE (it holds no register for the handle), so the drawing is withheld by name, never drawn past.
//
// ⚰️ TWO SILENT WRONG PICTURES, REMOVED:
//   1. a `delete` / `set_*` on a field read off an EXPRESSION (`zs.get(0).lb.delete()` and its spellings): the parser
//      makes the receiver a `member` node, `pineObjects.js::emitPostfix` answered false for it, and the statement
//      vanished — the member door served every label the script deleted (26 here, where TradingView keeps 1);
//   2. a setter whose family the reader could not name (`object.set_*`): C45 read `object` as a family, matched no
//      setter table and noted nothing, so the label stayed where it was made.
// Each removal probe runs alone (the door's reason) and beside `plot(close)` (the plot is served, the drawings are
// not, and the `Drawings` note says why). Product path: source -> memberPaneDefinition (host lane) -> hostObjectRun.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'

afterEach(() => { vi.unstubAllEnvs() })

const BARS = Array.from({ length: 40 }, (_, i) => {
  const o = 100 + i
  const c = i % 3 === 0 ? o - 1 : o + 1
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
})
const H = '//@version=6\nindicator("p", overlay = true)\n'
const UP = '\nif close > open\n'
const ARR_Z = `${H}type Z\n    label lb\nvar zs = array.from(Z.new(na))`
const REMOVES = /removes drawings as it runs/
const DRAWINGS_WITHHELD = /plots are shown, but its drawings are not\. It removes drawings as it runs/

function served(source, id) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id, name: 'shape' })
  if (!d.ok || !d.definition.objects) return { ok: false, reason: d.reason || '' }
  const out = hostObjectRun(d.definition, BARS, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  return { ok: true, live: out.run.live.length, xs: out.run.live.map((o) => o.props.x) }
}
function withPlot(source, id) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: `${source}plot(close)\n`, id, name: 'shape' })
  const note = (d.notes || []).find((n) => n.name === 'Drawings')
  return { ok: d.ok, drawn: !!(d.ok && d.definition.objects), note: note ? note.note : '' }
}

describe('a removal through a handle with no register is withheld by name, one probe per shape', () => {
  const REMOVAL = {
    'an array element\'s field, method form `zs.get(0).lb.delete()`':
      `${ARR_Z}${UP}    zs.get(0).lb.delete()\n    l = label.new(bar_index, high, "u")\n    zs.set(0, Z.new(l))\n`,
    'an array element\'s field through `array.get(zs, 0).lb.delete()`':
      `${ARR_Z}${UP}    array.get(zs, 0).lb.delete()\n    l = label.new(bar_index, high, "u")\n    zs.set(0, Z.new(l))\n`,
    'an array element\'s field, function form `label.delete(array.get(zs, 0).lb)`':
      `${ARR_Z}${UP}    label.delete(array.get(zs, 0).lb)\n    l = label.new(bar_index, high, "u")\n    zs.set(0, Z.new(l))\n`,
    'a `var` label held in an array element\'s field, deleted on the last bar (it drew the label TradingView deletes)':
      `${H}type Z\n    label lb\nvar label l0 = label.new(bar_index, high, "keep")\nvar zs = array.from(Z.new(l0))\nif barstate.islast\n    zs.get(0).lb.delete()\n`,
    'a function result\'s field `g().lb.delete()`':
      `${H}type Z\n    label lb\nvar z0 = Z.new(na)\ng() => z0${UP}    g().lb.delete()\n    z0.lb := label.new(bar_index, high, "u")\n`,
    'a ternary\'s field `(c ? z1 : z2).lb.delete()`':
      `${H}type Z\n    label lb\nvar z1 = Z.new(na)\nvar z2 = Z.new(na)${UP}    (close > 0 ? z1 : z2).lb.delete()\n    z1.lb := label.new(bar_index, high, "u")\n`,
    'a matrix element `mx.get(0, 0).delete()`':
      `${H}var mx = matrix.new<label>(1, 1)${UP}    mx.get(0, 0).delete()\n    l = label.new(bar_index, high, "u")\n    mx.set(0, 0, l)\n`,
  }
  for (const [what, src] of Object.entries(REMOVAL)) {
    it(what, () => {
      const alone = served(src, 'u_uh_rm')
      expect(alone.ok, `served ${alone.live} labels`).toBe(false)
      expect(alone.reason).toMatch(REMOVES)
      const beside = withPlot(src, 'u_uh_rm_p')
      expect(beside.ok).toBe(true)
      expect(beside.drawn).toBe(false)
      expect(beside.note).toMatch(DRAWINGS_WITHHELD)
    })
  }
})

describe('a map value: the removal is counted by name and the label the map holds is never drawn', () => {
  // Measured: `m.get("k").delete()` is `label.delete` in the reader's `unsupported`, and a label put into a map is a
  // create the program loses (`content:lost`), so nothing of the map is drawn; with nothing left to draw the door
  // answers with its general sentence, and beside a plot the `Drawings` note names what was not carried.
  const MAP = {
    'redrawn every up bar (`l = label.new(…)`, `m.put("k", l)`)':
      `${H}var m = map.new<string, label>()${UP}    m.get("k").delete()\n    l = label.new(bar_index, high, "u")\n    m.put("k", l)\n`,
    'a `var` label put once and deleted on the last bar':
      `${H}var label l0 = label.new(bar_index, high, "keep")\nvar m = map.new<string, label>()\nif barstate.isfirst\n    m.put("k", l0)\nif barstate.islast\n    m.get("k").delete()\n`,
  }
  for (const [what, src] of Object.entries(MAP)) {
    it(what, () => {
      const alone = served(src, 'u_uh_map')
      expect(alone.ok, `served ${alone.live} labels`).toBe(false)
      const beside = withPlot(src, 'u_uh_map_p')
      expect(beside.ok).toBe(true)
      expect(beside.drawn).toBe(false)
      expect(beside.note).not.toBe('')
    })
  }
})

describe('a setter through a handle with no register never leaves the drawing where it was made', () => {
  // Pine moves the label to the newest bar every bar; drawn at its creation bar (0) it would be a wrong picture.
  const moved = (got) => !got.ok || got.xs.every((x) => x === BARS.length - 1)
  it('an array element\'s field `zs.get(0).lb.set_x(…)`', () => {
    const got = served(`${H}type Z\n    label lb\nvar label l0 = label.new(bar_index, high, "u")\nvar zs = array.from(Z.new(l0))\nzs.get(0).lb.set_x(bar_index)\n`, 'u_uh_set')
    expect(moved(got), `drawn at ${JSON.stringify(got.xs)}`).toBe(true)
    expect(got.ok).toBe(false)
  })
  it('a value receiver whose family the reader cannot name `(c ? l1 : f()).set_x(…)` (`object.set_x`)', () => {
    const got = served(`${H}var label l1 = label.new(bar_index, high, "a")\nvar label l2 = label.new(bar_index, low, "b")\nf() => l2\n(close > 0 ? l1 : f()).set_x(bar_index)\n`, 'u_uh_set_t')
    expect(moved(got), `drawn at ${JSON.stringify(got.xs)}`).toBe(true)
    expect(got.ok).toBe(false)
  })
  it('CONTROL: the same setter on a traced handle is carried and served, the label at the newest bar', () => {
    const got = served(`${H}var label l0 = label.new(bar_index, high, "u")\nl0.set_x(bar_index)\n`, 'u_uh_set_ctl')
    expect(got.ok, got.reason).toBe(true)
    expect(got.xs).toEqual([BARS.length - 1])
  })
})

describe('CONTROL: a traced handle is served as before', () => {
  it('a plain `var` handle deleted and redrawn: the one label Pine keeps', () => {
    const got = served(`${H}var label lb = na${UP}    label.delete(lb)\n    lb := label.new(bar_index, high, "u")\n`, 'u_uh_ctl')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toBe(1)
  })
})

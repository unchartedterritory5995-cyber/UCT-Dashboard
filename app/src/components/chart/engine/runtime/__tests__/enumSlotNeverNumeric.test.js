// app/src/components/chart/engine/runtime/__tests__/enumSlotNeverNumeric.test.js
//
// ─── ⛔⛔ AN ENUM SLOT IS A WORD. A NUMERIC TREE IS NOT ONE. ────────────────
//
// `line.new(..., style = i_linestyle)` where the script wrote
//
//     i_linestyle = input.string(defval = line.style_dotted,
//                                options = [line.style_solid, ...])
//
// built this prop:
//
//     "style": { "v": "text", "node": { "t": "num", "node": 12 } }
//
// `{t:'num'}` means "evaluate this numeric tree and FORMAT it as text" — which
// is exactly right for `text = str.tostring(x)` and is never right for a
// STYLE. A line style is a closed vocabulary of words; there is no number that
// could be one.
//
// ⚰️⚰️ AND THE COST WAS NOT A WRONG STYLE, IT WAS A CRASH. The tree became a
// numeric output, the value underneath was the input's string, and the whole
// script died at run time:
//
//     pc 77: output 18 must carry a number, got string
//
// ⛔ THAT IS THE WORST OF THE THREE AVAILABLE OUTCOMES. Serving the style is
// best; DROPPING it costs one visual detail and the renderer's own default;
// crashing loses every line, every label and every fill in the script — for a
// prop that decides whether a line is dotted.
//
// ⭐⭐ SO THE FIX IS A TYPE RULE, NOT A CAPABILITY. An enum slot may carry a
// WORD (`{t:'lit'}`) or a text expression that can produce one; it may never
// carry `{t:'num'}`. Rejecting it drops the prop, the renderer uses Pine's own
// default, and the script runs.
//
// ⚠️ WHAT THIS DOES NOT DO — stated so the next reader does not mistake the
// scope. It does NOT teach the engine to read `input.string` as an enum word.
// That is a real capability and a large one (689 `input.string` sites across
// 109 drawing scripts in `corpus/committed`), and until it lands these props
// are DROPPED, honestly, instead of crashing the script that uses them.
import { describe, it, expect } from 'vitest'

import { buildObjectLane, runObjectLane } from '../objectLane.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const Q = String.fromCharCode(34)
const LF = String.fromCharCode(10)
const H = `//@version=6${LF}indicator(${Q}t${Q}, overlay = true)${LF}`

/** The corpus idiom, reduced: a style picked by an `input.string`. */
const COMPUTED_ENUM = `${H}`
  + `i_style = input.string(defval = line.style_dotted, `
  + `options = [line.style_solid, line.style_dashed, line.style_dotted], title = ${Q}S${Q})${LF}`
  + `if barstate.islast${LF}`
  + `    line.new(x1 = bar_index - 5, y1 = low, x2 = bar_index, y2 = high, style = i_style)${LF}`

/** The same drawing with the style written as a literal — the shape that has
 *  always worked, and the reference answer for the parity case below. */
const LITERAL_ENUM = `${H}if barstate.islast${LF}`
  + `    line.new(x1 = bar_index - 5, y1 = low, x2 = bar_index, y2 = high, `
  + `style = line.style_dotted)${LF}`

function laneOf(src) {
  return buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
}

/** Build AND run, reporting how it ended rather than throwing. */
function runOf(src) {
  let lane
  try { lane = laneOf(src) } catch (e) { return { how: 'BUILD-THREW', why: String(e && e.message) } }
  if (!lane.ok) return { how: 'REFUSED', why: `${lane.lane}/${(lane.refusal || {}).guard}` }
  try {
    const run = runObjectLane(lane, {
      bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t,
    })
    return { how: 'RAN', live: (run.live || []) }
  } catch (e) { return { how: 'RUN-THREW', why: String(e && e.message) } }
}

/** Every prop node the object pass emitted, flattened, with its slot name. */
function propsOf(lane) {
  const out = []
  for (const op of ((lane.objects || {}).ops) || []) {
    for (const [slot, val] of Object.entries(op.props || {})) out.push([slot, val])
  }
  return out
}

describe('⛔⛔ an enum slot never carries a numeric tree', () => {
  it('⛔ CONTROL — the literal spelling builds, runs and draws', () => {
    // ⭐ NON-VACUITY. If the reference spelling were broken, every assertion
    // below would be comparing two failures and would pass for the wrong
    // reason.
    const r = runOf(LITERAL_ENUM)
    expect(r.how, r.why).toBe('RAN')
    expect(r.live.length).toBeGreaterThan(0)
  })

  it('⛔⛔ the COMPUTED enum does not crash the script', () => {
    // ⚰️ THIS IS THE BUG. Before the fix: `RUN-THREW ... must carry a number,
    // got string` — one dotted-vs-solid decision taking every drawing in the
    // script with it.
    const r = runOf(COMPUTED_ENUM)
    expect(r.how, r.why).toBe('RAN')
    expect(r.live.length, 'the line was lost with the style').toBeGreaterThan(0)
  })

  it('⛔⛔ NO prop anywhere carries `{v:text, node:{t:num}}` in an ENUM slot', () => {
    // ⭐ THE LOAD-BEARING ASSERTION, and it is about the SHAPE rather than the
    // outcome. "It does not crash" would go green again the day the runtime
    // learned to coerce a string into a numeric output — which would be a
    // silent wrong answer, not a fix.
    const lane = laneOf(COMPUTED_ENUM)
    expect(lane.ok, `refused ${(lane.refusal || {}).guard}`).toBe(true)
    for (const [slot, val] of propsOf(lane)) {
      if (slot !== 'style' && slot !== 'position' && slot !== 'size'
        && slot !== 'text_size' && slot !== 'xloc' && slot !== 'yloc') continue
      const isNumTree = val && val.v === 'text' && val.node && val.node.t === 'num'
      expect(isNumTree, `enum slot \`${slot}\` carries a NUMERIC tree: ${JSON.stringify(val)}`)
        .toBe(false)
    }
  })

  it('⭐ the drawing is otherwise IDENTICAL to the literal spelling', () => {
    // ⛔ DROPPING THE STYLE MUST NOT DROP THE LINE. The geometry, the family
    // and the count all have to survive — the only difference a member may see
    // is the dash pattern.
    const computed = runOf(COMPUTED_ENUM)
    const literal = runOf(LITERAL_ENUM)
    expect(computed.how).toBe('RAN')
    expect(literal.how).toBe('RAN')
    expect(computed.live.map((o) => o.family)).toEqual(literal.live.map((o) => o.family))
    for (let i = 0; i < literal.live.length; i += 1) {
      const c = computed.live[i].props || {}
      const l = literal.live[i].props || {}
      for (const k of ['x1', 'y1', 'x2', 'y2']) expect(c[k], k).toBe(l[k])
    }
  })

  it('⛔ a LITERAL enum still resolves — the fix is not a blanket refusal', () => {
    // ⚰️ THE WAY THIS FIX COULD BE TOO WIDE: rejecting every enum node rather
    // than only the numeric ones would drop `style = line.style_dotted` too,
    // and that has always worked. The literal must still arrive as a WORD.
    const lane = laneOf(LITERAL_ENUM)
    expect(lane.ok).toBe(true)
    const styles = propsOf(lane).filter(([slot]) => slot === 'style')
    expect(styles.length, 'no style prop was emitted at all').toBeGreaterThan(0)
    for (const [, val] of styles) {
      const word = (val && val.v === 'const' && typeof val.value === 'string')
        || (val && val.v === 'text' && val.node && val.node.t === 'lit')
      expect(word, `the literal style stopped being a word: ${JSON.stringify(val)}`).toBe(true)
    }
  })
})

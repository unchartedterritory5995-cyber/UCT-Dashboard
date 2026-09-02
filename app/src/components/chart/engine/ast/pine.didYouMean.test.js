// app/src/components/chart/engine/ast/pine.didYouMean.test.js
//
// ─── ⚰️ THE SUGGESTION EXISTED AND THE PINE DOOR NEVER ASKED FOR IT ───────────
//
// `didYouMean(name, candidates)` has shipped in `sentence.js` since the native
// read-back was written, and its own docblock names this exact failure:
//
//   "For a member who typed `clse` that is a wall of text with the answer buried
//    in the middle of it."
//
// Its only production caller was the native door. `pine.js` never imported it,
// so a one-character typo came back as
//
//     ta.rsi(clsoe, 14)   -> "this Pine name was never given a value in the
//                             pasted script — `clsoe`"      and stopped there
//     ta.smaa(close, 20)  -> the refusal sentence plus ALL 64 declared names
//
// ⛔ THERE ARE THREE SITES THAT RAISE `pine:undefined` and the fix is a METHOD,
// not three edits. Wiring the first one alone is exactly how two would have kept
// the old message — measured: the typo path does not go through `resolveBinding`
// at all, so the obvious single edit changed nothing a member would see.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { TABLE } from './parse.js'

const screen = (body, head = '') =>
  translatePine(`//@version=6\nindicator("s")\n${head}plot(${body} ? 1 : 0)\n`)
const refusalFor = (body, head = '') => {
  const out = screen(body, head)
  expect(out.ok, `${body} unexpectedly translated`).toBe(false)
  return out.refusal
}

describe('a mistyped name is offered the name it is one edit from', () => {
  it('⭐⭐ a bar field, reached through a CALL ARGUMENT', () => {
    const msg = refusalFor('ta.rsi(clsoe, 14) > 0').message
    expect(msg).toContain('clsoe')
    expect(msg).toContain('did you mean')
    expect(msg).toContain('close')
  })

  it('⭐ a bar field, reached as a BARE NAME — a different site', () => {
    // ⚠️ TWO PATHS ON PURPOSE. The three raise-sites are why this became one
    // method; a rail that only exercised one would have gone green with the
    // other two still silent.
    const msg = refusalFor('voluem > 1000').message
    expect(msg).toContain('did you mean')
    expect(msg).toContain('volume')
  })

  it('⭐⭐ the member’s OWN binding is a candidate', () => {
    // ⭐ THE BEST CASE, and the one that proves the candidate set is not just the
    // table: `myLen` exists only because this script created it two lines up.
    const msg = refusalFor('myLenn > 0', 'myLen = 5\n').message
    expect(msg).toContain('did you mean')
    expect(msg).toContain('myLen')
  })

  it('⛔ a name that is close to NOTHING gets no suggestion', () => {
    // ⭐ NON-VACUITY. Without this, a change that appended "did you mean" to
    // every refusal would satisfy all three cases above.
    const msg = refusalFor('zzqqxx > 0').message
    expect(msg).toContain('zzqqxx')
    expect(msg).not.toContain('did you mean')
  })

  it('⭐⭐ an unknown FUNCTION is suggested first, and the list still follows', () => {
    // The native door's own rule, in its own words: "THE SUGGESTION COMES FIRST,
    // THE FULL LIST STILL FOLLOWS." Sixty-four names is the answer buried in a
    // wall of text; one name in front of it is the answer.
    const msg = refusalFor('ta.smaa(close, 20) > 0').message
    expect(msg).toContain('did you mean')
    expect(msg).toContain('sma')
    expect(msg.indexOf('did you mean'))
      .toBeLessThan(msg.indexOf('This table declares'))
    // ⛔ AND THE LIST IS STILL THERE — the suggestion is an addition, not a
    // replacement, because a wrong guess must not hide the vocabulary.
    expect(msg).toContain('This table declares')
    for (const name of ['abs', 'rsi', 'wma']) expect(msg).toContain(name)
  })

  it('⛔ an unknown function that resembles nothing keeps the bare list', () => {
    const msg = refusalFor('ta.zzzzzzzz(close) > 0').message
    expect(msg).toContain('This table declares')
    expect(msg).not.toContain('did you mean')
  })

  it('⭐ the candidates really are the declared ones, not a hand-list', () => {
    // If `series` ever stopped being the source of bar names this would go red
    // rather than silently suggesting from a stale copy.
    expect(Object.keys(TABLE.series)).toContain('close')
    expect(Object.keys(TABLE.series)).toContain('volume')
  })
})

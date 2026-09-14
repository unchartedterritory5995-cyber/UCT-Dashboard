// app/src/components/chart/engine/ast/vectorSilentNa.test.js
//
// ─── ⚰️⚰️ THE CONTROL FOR "TWENTY-ONE PLOTS WENT BLANK AND NOTHING SAID WHY" ──
//
// Named for what it caught, 2026-09-14.
//
// The moment `array.get(v, k)` began folding to a slot's tree, Uncharted Clouds
// went from **21 honest refusals to ZERO refusals and 21 plots reading `na`**.
// Nothing was broken in the folder: the slots really were empty, because the
// `for` at line 59 that FILLS the array is a block this walk gives up on, and
// nothing connected "the writer is unreadable" to "the read is therefore not
// `na`, it is unknown". `mutatorTargets` only ever looked for `:=`, and an array
// is mutated by a CALL.
//
// ⛔ A MEMBER WOULD HAVE SEEN TWENTY-ONE BLANK PLOTS AND NO SENTENCE ANYWHERE.
// That is worse than the refusal it replaced, and worse in the specific way this
// engine's doctrine is written against.
//
// ⭐ The fix is in `mutatorTargets` — array writes force their target opaque, so
// the read refuses. THIS FILE IS THE CONTROL ON THAT FIX: it goes red the day
// somebody loosens `mutatorTargets`, narrows `WRITE_MEMBERS`, or teaches the
// vector read to be clever about an opaque binding.
//
// ⚠️ EVERY FIXTURE CARRIES A REAL `plot(close)`. Without one, a script whose only
// output is an unwritten slot is CONSTANT on every bar and refuses
// `pine:constant-only` — a correct, pre-existing guard that has nothing to do
// with what this file measures. The first draft of this test omitted it and read
// that refusal as its own; the fixtures say so now rather than leaving the next
// reader to rediscover it.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { WRITE_MEMBERS } from './arrayVectors.js'

const HEAD = '//@version=6\nindicator("t", overlay=true)\nplot(close, "real")\n'
const aboutTheArray = (t) => (t.refusals || [])
  .filter((r) => r.guard !== 'pine:constant-only')

/** The Clouds shape in miniature: a sized array, a loop that fills it, a read. */
const filledByABlock = (member) => `${HEAD}var a = array.new<float>(4)\n`
  + 'for i = 0 to 3\n'
  + `    array.${member}(a, ${member === 'push' ? 'close' : 'i, close'})\n`
  + 'plot(array.get(a, 0))\n'

describe('a slot written only inside an unreadable block REFUSES — never `na`', () => {
  it('⛔⛔ the Clouds shape before a3: the read refuses, and does not fold to na', () => {
    const t = translatePine(filledByABlock('set'), { strict: true })
    expect(aboutTheArray(t).length,
      'the read must refuse while the block that fills it is unreadable')
      .toBeGreaterThan(0)
  })

  it('⛔ the same for `push`, so the guard is on the CLASS not on one member', () => {
    const t = translatePine(filledByABlock('push'), { strict: true })
    expect(aboutTheArray(t).length).toBeGreaterThan(0)
  })

  it('⭐⭐ CONTROL — with NO block, the same read folds and does NOT refuse', () => {
    // Without this, the two above would pass on an engine that refused every
    // array read — which is exactly the state a2 was built to leave behind.
    const t = translatePine(`${HEAD}var a = array.new<float>(4)\nplot(array.get(a, 0))\n`,
      { strict: true })
    expect(aboutTheArray(t).length, 'an unwritten slot is `na`, not a refusal').toBe(0)
  })

  it('⭐ …and that `na` is VISIBLE as a note, so an empty plot can be explained', () => {
    const t = translatePine(`${HEAD}var a = array.new<float>(4)\nplot(array.get(a, 2))\n`,
      { strict: true })
    const note = (t.notes || []).find((n) => n.code === 'pine:vector-unwritten')
    expect(note, 'an unwritten slot read is recorded').toBeTruthy()
    expect(note.message).toMatch(/slot 2 was never written/)
  })

  it('⛔ the write set this depends on is NOT a second hand-typed list', () => {
    // `mutatorTargets` derives its array-write members from this one set. Were
    // the two lists separate, a member added there would silently stop forcing
    // its target opaque — this file's failure, re-armed.
    for (const m of ['set', 'push', 'unshift', 'insert', 'remove', 'clear', 'pop', 'shift']) {
      expect(WRITE_MEMBERS.has(m), `${m} must be a known write`).toBe(true)
    }
  })
})

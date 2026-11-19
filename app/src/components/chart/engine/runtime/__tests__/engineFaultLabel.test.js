// app/src/components/chart/engine/runtime/__tests__/engineFaultLabel.test.js
//
// ─── ⭐⭐ ENGINE 84 (S14, robustness) — AN EXCEPTION IS NEVER A STATEMENT SHAPE ─────────────
//
// `buildRuntimeIr` answers every refusal through `fail`. Anything thrown that was not one of the three
// refusal classes (`RuntimeRefusal`, `PineRefusal`, `TableRefusal`) used to come out as `runtime:statement`,
// "a statement shape this front end does not recognise". That sentence is about the SCRIPT, and it was said
// about engine defects (an IR invariant an uncalled helper broke, `undefined` read as a node), so those
// scripts were counted under the statements unit. It is `runtime:lower` now:
// - a DEFECT (a JavaScript error, a plain `Error`, a thrown non-error, an `IrError`) says the engine failed,
//   and keeps what was thrown;
// - an engine module's own NAMED error (`ColourError`, ...) keeps its own sentence, which is about the script.
// A real refusal keeps its guard and its sentence. Nothing that was drawn changes: every case here was
// refused before and is refused now.
import { describe, it, expect, vi } from 'vitest'

import { ColourError } from '../colours.js'
import { IrError } from '../ir.js'

// ⭐ THE ONE INJECTED FAULT: `lexPine` is the build's first step, and its throw goes to `fail` as any other
// throw does. A marker in the source picks the kind; every other source lexes as it always has.
const FAULTS = {
  S14_TYPE_ERROR: () => new TypeError("Cannot read properties of undefined (reading 'type')"),
  S14_RANGE_ERROR: () => new RangeError('Maximum call stack size exceeded'),
  S14_PLAIN_ERROR: () => new Error('an invariant nobody named'),
  S14_IR_ERROR: () => new IrError('functions[0] `f`.body[0].value: a site the IR check refuses'),
  S14_THROWN_TEXT: () => 'a thrown string',
  S14_COLOUR_ERROR: () => new ColourError('not a colour this engine can read: `#0`'),
}
vi.mock('../../ast/pine.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    lexPine: (source, ...rest) => {
      for (const [marker, make] of Object.entries(FAULTS)) {
        if (String(source).includes(marker)) throw make()
      }
      return real.lexPine(source, ...rest)
    },
  }
})

const { buildRuntimeIr, ENGINE_DEFECT_SENTENCE } = await import('../../ast/pineRuntimeFrontend.js')

const N = 20
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 101 + i, v: 1000 + i,
}))
const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {} })
const HEAD = '//@version=6\nindicator("t")\n'

describe('S14 — an exception that is not a refusal is `runtime:lower`, never `runtime:statement`', () => {
  for (const marker of ['S14_TYPE_ERROR', 'S14_RANGE_ERROR', 'S14_PLAIN_ERROR', 'S14_IR_ERROR', 'S14_THROWN_TEXT']) {
    it(`${marker}: a defect, said to be one, with what was thrown`, () => {
      const r = build(`${HEAD}// ${marker}\nplot(close)\n`)
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:lower')
      expect(r.refusal.message.startsWith(ENGINE_DEFECT_SENTENCE)).toBe(true)
      const thrown = FAULTS[marker]()
      expect(r.refusal.message).toContain(String(thrown.message || thrown))
    })
  }

  it('an engine module\'s named error keeps its own sentence (it is about the script), as `runtime:lower`', () => {
    const r = build(`${HEAD}// S14_COLOUR_ERROR\nplot(close)\n`)
    expect(r.refusal.guard).toBe('runtime:lower')
    expect(r.refusal.message).toBe('not a colour this engine can read: `#0`')
    expect(r.refusal.message).not.toContain('engine defect')
  })

  // ⚰️ AN END-TO-END REAL DEFECT STOOD HERE, AND S14's QUEUE IS EMPTY NOW. It moved along the queue as each
  // root cause was fixed: the uncalled helper's IR check (fix 1, `uncalledHelperState.test.js`), the parse offset
  // `fromCanonical` lost (fix 2, `canonicalPassthrough.test.js`), the user-type reader's loop (fix 3,
  // `udtReaderDepth.test.js`). No sample script throws during a build any more, so the injected faults above are
  // the rail for each kind, and the next real defect, when one is found, is the next end-to-end case.

  it('END TO END, a named error: an unreadable colour literal keeps "not a colour this engine can read"', () => {
    const r = build(`${HEAD}myCol = #00e6761\nbgcolor(myCol)\nplot(close)\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:lower')
    expect(r.refusal.message).toMatch(/^not a colour this engine can read/)
    expect(r.refusal.line).toBe(4)
    expect(r.refusal.token).toBe('bgcolor')
  })
})

describe('S14 CONTROLS — a refusal keeps its own guard and sentence', () => {
  it('a `RuntimeRefusal` of a statement shape stays `runtime:statement`', () => {
    const r = build(`${HEAD}x = 1\nelse\n    x := 2\nplot(close)\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:statement')
    expect(r.refusal.message).not.toContain('engine defect')
  })
  it('a `PineRefusal` keeps its `pine:` guard', () => {
    const r = build(`${HEAD}plot(close ¤ 2)\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard.startsWith('pine:')).toBe(true)
    expect(r.refusal.message).not.toContain('engine defect')
  })
  it('a source with no marker builds as it always has (the injected fault touches nothing else)', () => {
    expect(build(`${HEAD}plot(close)\n`).ok).toBe(true)
  })
})

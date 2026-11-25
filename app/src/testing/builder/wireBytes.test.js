// app/src/testing/builder/wireBytes.test.js
//
// ⭐ e98 P2 — `wireBytes` counts the structured-clone wire format by the value's own rule, so a message has one size on
// every Node. Each expectation below is counted by hand from the header's rules; none is read from `v8.serialize`.
import { describe, it, expect } from 'vitest'
import { wireBytes, stringBytes, numberBytes } from './wireBytes.js'

describe('wireBytes — the wire format, counted by hand', () => {
  it('scalars: a 2-byte header and the value', () => {
    expect(wireBytes(null)).toBe(3)
    expect(wireBytes(undefined)).toBe(3)
    expect(wireBytes(true)).toBe(3)
    expect(wireBytes(0)).toBe(4)          // I, zigzag 0
    expect(wireBytes(-1)).toBe(4)         // I, zigzag 1
    expect(wireBytes(64)).toBe(5)         // I, zigzag 128: a 2-byte varint
    expect(wireBytes(1.5)).toBe(11)       // N + 8
    expect(wireBytes(2 ** 31)).toBe(11)   // past int32: a double
    expect(wireBytes(-0)).toBe(11)        // -0 is not an int32
  })

  it('strings: one-byte below 256, two-byte otherwise', () => {
    expect(stringBytes('abc')).toBe(5)
    expect(stringBytes('é')).toBe(3)       // é: one byte
    expect(stringBytes('€')).toBe(4)       // €: two bytes, `c` + varint 2 + 2
    expect(stringBytes('a'.repeat(200))).toBe(203) // a 2-byte length varint
  })

  it('an object, an array, an array with a hole (sparse)', () => {
    expect(wireBytes({ a: 1 })).toBe(10)        // 2 + o + "a"(3) + I1(2) + { + 1
    expect(wireBytes([1, 2])).toBe(11)          // 2 + A + 2 + I1 + I2 + $ + 0 + 2
    // eslint-disable-next-line no-sparse-arrays
    expect(wireBytes([1, , 3])).toBe(15)        // sparse: a + 3, (I0, I1), (I2, I3), @ + 2 + 3
  })

  it('an object met twice is a back-reference', () => {
    const o = {}
    expect(wireBytes([o, o])).toBe(12)          // 2 + A + 2 + o{0}(3) + ^0(2) + $ + 0 + 2
    expect(wireBytes([{}, {}])).toBe(13)
  })

  it('⭐ the size reads the VALUE: a whole number computed as a double counts as the literal', () => {
    const computed = Math.sqrt(9) * 1.0
    expect(numberBytes(computed)).toBe(numberBytes(3))
    expect(wireBytes({ x: computed, y: [computed] })).toBe(wireBytes({ x: 3, y: [3] }))
  })

  it('typed arrays, Map, Set, Date', () => {
    expect(wireBytes(new Float64Array(4))).toBe(2 + (1 + 1 + 32) + (2 + 1 + 1 + 1))
    expect(wireBytes(new Map([['k', 1]]))).toBe(2 + 1 + 3 + 2 + 1 + 1)
    expect(wireBytes(new Set([1, 2]))).toBe(2 + 1 + 2 + 2 + 1 + 1)
    expect(wireBytes(new Date(0))).toBe(11)
  })

  it('a value postMessage cannot carry throws, by name', () => {
    expect(() => wireBytes({ f: () => 1 })).toThrow(/a function cannot be posted/)
    expect(() => wireBytes([Symbol('s')])).toThrow(/a symbol cannot be posted/)
  })
})

// ⛔ THE DOOR-BYTES RAIL ASSERTS ON `wireBytes`, NEVER ON `v8.serialize` (whose length is the running V8's). Read with
// comments stripped, so a sentence that names `v8.serialize` is not a use of it; the control proves the scan can fail.
describe('memberDoorBytes.test.js measures with wireBytes', () => {
  const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  const usesV8ForBudget = (code) => {
    const size = /const size = \(v\) => ([^\n]+)/.exec(code)
    return !size || /v8\.serialize/.test(size[1]) || !/wireBytes\(v\)/.test(size[1])
  }
  it('`size` is wireBytes, and v8.serialize feeds only the logged `v8size`', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../components/chart/builder/memberPane/memberDoorBytes.test.js'), 'utf8')
    const code = codeOf(src)
    expect(usesV8ForBudget(code)).toBe(false)
    const v8Uses = code.split('\n').filter((l) => /v8\.serialize/.test(l))
    expect(v8Uses).toEqual(['const v8size = (v) => v8.serialize(v).length'])
    const v8sizeLines = code.split('\n').filter((l) => /\bv8size\b/.test(l) && !/^const v8size = /.test(l))
    expect(v8sizeLines.length, 'non-vacuous: v8size is read').toBeGreaterThan(0)
    for (const l of v8sizeLines) expect(l.trim(), 'v8size is only the logged `v8` record').toMatch(/^v8: \{/)
  })
  it('CONTROL: the scan reads a v8 measure as one, and a commented-out wireBytes as none', () => {
    expect(usesV8ForBudget('const size = (v) => v8.serialize(v).length\n')).toBe(true)
    expect(usesV8ForBudget(codeOf('// const size = (v) => wireBytes(v)\n'))).toBe(true)
    expect(usesV8ForBudget(codeOf('const size = (v) => wireBytes(v)\n'))).toBe(false)
  })
})

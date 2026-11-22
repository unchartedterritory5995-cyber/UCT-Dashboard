// INSPECT A BAR: the part that needs no engine (barInspection.js; Studio lane R5).
import { describe, it, expect } from 'vitest'
import {
  probeSource, probeTitle, readBar, whyEmpty, emptyWords, valueText, columnsByTitle, EMPTY, PROBE_BATCH, INSPECTABLE_KINDS,
} from './barInspection'

const SCRIPT = 'indicator("x")\nlen = input.int(14)\nr = ta.rsi(close, len)\nf(a) => a * 2\nplot(r)\n'
const NAMES = [
  { name: 'len', line: 2, kind: 'input' },
  { name: 'r', line: 3, kind: 'series' },
  { name: 'f', line: 4, kind: 'function' },
]

describe('the probe copy', () => {
  it('is the script, unchanged, plus one plot per value-holding name; a function is listed as skipped', () => {
    const { batches, skipped } = probeSource(SCRIPT, NAMES)
    expect(batches).toHaveLength(1)
    const { source, probes } = batches[0]
    expect(source.startsWith(SCRIPT.trimEnd())).toBe(true)                 // nothing of the member's is touched
    expect(source.split('\n').filter((l) => l.startsWith('plot(')).slice(-2)).toEqual([
      'plot(len, title="uct probe len")',
      'plot(r, title="uct probe r")',
    ])
    expect(probes.map((p) => [p.name, p.line, p.title])).toEqual([['len', 2, 'uct probe len'], ['r', 3, 'uct probe r']])
    expect(skipped).toEqual([{ name: 'f', line: 4, kind: 'function', why: 'A function, not a value: it has no value of its own on a bar.' }])
    expect(probeTitle('r')).toBe('uct probe r')
  })

  it('a name seen twice is one variable, and a name that is not an identifier is never written into a script', () => {
    const { batches } = probeSource('a = 1\na := 2\n', [
      { name: 'a', line: 1, kind: 'series' }, { name: 'a', line: 2, kind: 'series' },
      { name: 'x) \nstrategy.entry("L"', line: 3, kind: 'series' }, { name: '', line: 4, kind: 'series' }, null,
    ])
    expect(batches).toHaveLength(1)
    expect(batches[0].probes.map((p) => [p.name, p.line])).toEqual([['a', 1]])
    expect(batches[0].source).not.toMatch(/strategy\.entry/)
  })

  it('more names than one copy may plot become several copies, each within the cap', () => {
    const many = Array.from({ length: PROBE_BATCH * 2 + 3 }, (_, i) => ({ name: `v${i}`, line: i + 1, kind: 'series' }))
    const { batches } = probeSource('x = 1', many)
    expect(batches.map((b) => b.probes.length)).toEqual([PROBE_BATCH, PROBE_BATCH, 3])
    expect(batches.flatMap((b) => b.probes.map((p) => p.name))).toEqual(many.map((m) => m.name))
    for (const b of batches) expect(b.source.split('\n').filter((l) => l.startsWith('plot(')).length).toBe(b.probes.length)
  })

  it('the answer of the engine itself carries no kind: every name it returns is a value', () => {
    const { batches, skipped } = probeSource(SCRIPT, [{ name: 'len', line: 2 }, { name: 'r', line: 3 }])
    expect(batches[0].probes.map((p) => [p.name, p.kind])).toEqual([['len', 'series'], ['r', 'series']])
    expect(skipped).toEqual([])
  })

  it('nothing to inspect is no copy at all, and the kinds are the three that hold a value', () => {
    expect(probeSource(SCRIPT, [])).toEqual({ batches: [], skipped: [] })
    expect(probeSource(null, null)).toEqual({ batches: [], skipped: [] })
    expect(INSPECTABLE_KINDS).toEqual(['series', 'simple', 'input'])
  })
})

describe('one bar', () => {
  const N = NaN
  const run = { columns: {
    'uct probe len': [14, 14, 14, 14, 14, 14],
    'uct probe r': [N, N, N, 55.25, N, 61.5],
    'uct probe z': [N, N, N, N, N, N],
  } }
  const probes = [
    { name: 'len', line: 2, kind: 'input', title: 'uct probe len' },
    { name: 'r', line: 3, kind: 'series', title: 'uct probe r' },
    { name: 'z', line: 5, kind: 'series', title: 'uct probe z' },
    { name: 'label', line: 6, kind: 'series', title: 'uct probe label' },      // the probe gave no column for it
  ]

  it('reads each variable\'s value at the pinned bar', () => {
    const rows = readBar(run, probes, 3)
    expect(rows.map((r) => [r.name, r.value, r.empty && r.empty.code])).toEqual([
      ['len', 14, null], ['r', 55.25, null], ['z', null, EMPTY.NEVER], ['label', null, EMPTY.NOT_RUN],
    ])
    expect(rows[1].line).toBe(3)
  })

  it('an empty one says which kind of empty: not yet, a gap, never, or not a number', () => {
    expect(whyEmpty(run.columns['uct probe r'], 1)).toEqual({ code: EMPTY.STARTS_LATER, firstAt: 3 })
    expect(whyEmpty(run.columns['uct probe r'], 4)).toEqual({ code: EMPTY.GAP, firstAt: 3 })
    expect(whyEmpty(run.columns['uct probe z'], 2)).toEqual({ code: EMPTY.NEVER, firstAt: null })
    expect(whyEmpty(undefined, 2)).toEqual({ code: EMPTY.NOT_RUN, firstAt: null })
    expect(whyEmpty(run.columns['uct probe r'], 3)).toBeNull()
    expect(whyEmpty(new Float64Array([N, 2]), 1)).toBeNull()                 // a typed column reads the same
    // ⛔ zero is a value, not an empty
    expect(whyEmpty([0, 0], 1)).toBeNull()
  })

  it('and says it in a sentence a member can act on', () => {
    const date = (i) => ['3 Nov', '4 Nov', '5 Nov', '6 Nov'][i]
    expect(emptyWords({ code: EMPTY.STARTS_LATER, firstAt: 3 }, { dateOf: date, index: 1 }))
      .toBe('Its first value is on 6 Nov, 2 bars after this one: it needs that much history first.')
    expect(emptyWords({ code: EMPTY.STARTS_LATER, firstAt: 3 }, { index: 2 }))
      .toBe('Its first value is on bar 4, 1 bar after this one: it needs that much history first.')
    expect(emptyWords({ code: EMPTY.GAP, firstAt: 0 })).toMatch(/^It has a value on other bars/)
    expect(emptyWords({ code: EMPTY.NEVER })).toBe('It has no value on any bar that is loaded.')
    expect(emptyWords({ code: EMPTY.NOT_RUN })).toMatch(/^It is not a number on each bar/)
    expect(emptyWords(null)).toBe('')
  })

  it('reads the engine\'s ordered outputs by title; a member\'s own plot with the same title loses to the probe\'s', () => {
    const outputs = [
      { key: 'plot0', title: 'RSI', values: [1, 2] },
      { key: 'plot1', title: null, values: [9, 9] },                          // untitled: not a probe
      { key: 'plot2', title: 'uct probe r', values: [0, 0] },                 // the member's, by coincidence
      { key: 'plot3', title: 'uct probe r', values: [N, 55.25] },             // the probe's: appended last
    ]
    const { columns } = columnsByTitle(outputs)
    expect(Object.keys(columns)).toEqual(['RSI', 'uct probe r'])
    expect(readBar({ columns }, [probes[1]], 1)[0].value).toBe(55.25)
    expect(columnsByTitle(null)).toEqual({ columns: {} })
  })

  it('prints a value the way a legend would', () => {
    expect([valueText(14), valueText(55.25), valueText(0.000123456), valueText(12345.678), valueText(-3.10000), valueText(0)])
      .toEqual(['14', '55.25', '0.0001235', '12345.68', '-3.1', '0'])
    expect(valueText(NaN)).toBe('')
  })
})

// app/src/components/chart/engine/semanticName.test.js
//
// ─── ONE USER-FACING MOVING AVERAGE ─────────────────────────────────────────
//
// The owner's report, in one line: *"On the same chart I can currently have EMA 9,
// EMA 20, SMA 50 … and then add another MA and see Moving Average #1 / Moving
// Average #2. This makes it look like UCT has two completely different kinds of
// Moving Average."*
//
// It was never two engines. `cs.overlays`' rows have always read `EMA 9` /
// `SMA 200` (`indicatorRegistry.listIndicators`), and the ENGINE definition read
// `Moving Average` — one concept, two vocabularies, and a member cannot tell a
// vocabulary from a feature. These cases hold the fix at the layer that decides
// it, and the two surfaces that spell it are checked against each other rather
// than against a string typed twice here.

import { describe, it, expect } from 'vitest'
import { semanticName, namesItselfSemantically } from './semanticName'
import { instanceLabel } from './sourceRef'
import { chipsFrom } from './readout'
import { getDefinition, listDefinitions } from './nativeRegistry'
import { validateDefinition } from './defSchema'

const MA = () => getDefinition('movingAverage')
const inst = (inputs) => ({ instanceId: 'inst:movingAverage:1', defId: 'movingAverage', inputs })

describe('⭐⭐ a Moving Average is `EMA 9`, never `MA (9)` and never `Moving Average #1`', () => {
  it('the stem is the member’s own type, read back from the control that set it', () => {
    expect(semanticName(MA(), { maType: 'ema', period: 9 })).toBe('EMA 9')
    expect(semanticName(MA(), { maType: 'sma', period: 200 })).toBe('SMA 200')
  })

  it('⛔ AND IT IS THE ENUM’S OWN LABEL, not an upper-cased value', () => {
    // The word in the name has to be the word in the dropdown, or a member reads
    // one thing in the editor and another on the chart. Derived from the
    // declaration so a third MA type names itself with no edit anywhere.
    const opts = MA().inputs.find((i) => i.key === 'maType').options
    for (const [value, label] of opts) {
      expect(semanticName(MA(), { maType: value, period: 21 })).toBe(`${label} 21`)
    }
    expect(opts.length, 'the type enum lost its options — this case is vacuous')
      .toBeGreaterThan(1)
  })

  it('⭐ an UNSET input falls back to the definition’s declared default', () => {
    // "Unset means current default" is what it means everywhere else in the
    // engine; a name that printed `undefined` for a fresh instance would be the
    // one place it did not.
    const dflt = (k) => MA().inputs.find((i) => i.key === k).default
    expect(semanticName(MA(), {})).toBe(`${dflt('maType').toUpperCase()} ${dflt('period')}`)
    expect(semanticName(MA(), null)).not.toMatch(/undefined/)
  })

  it('⛔⛔ BOTH NAMING SURFACES AGREE, BY READING ONE FUNCTION', () => {
    // ⚰️ THE MEASURED FAILURE MODE THIS GUARDS. `readout.chipLabel` names a PLOT
    // in the legend; `sourceRef.instanceLabel` names an INSTANCE in the settings
    // rows, the source picker and the destination menu. They are deliberately two
    // functions (`readout` is pure and imports no source grammar), and in
    // September 2026 a `labelFrom` fix landed in one of them and left the pane
    // legend reading "Series 714.88" over a QQQ line.
    const series = { __id: 'movingAverage::ma' }
    const chips = chipsFrom(
      [{ defId: 'movingAverage', plotKey: 'ma', series }],
      new Map([[series, { value: 12.345 }]]),
      { getDefinition },
      () => ({ maType: 'ema', period: 20 }),
    )
    expect(chips).toHaveLength(1)
    expect(chips[0].label).toBe('EMA 20')
    expect(chips[0].label).toBe(instanceLabel(MA(), inst({ maType: 'ema', period: 20 })))
  })

  it('⛔ ABSENT MEANS ABSENT — every other definition is named exactly as before', () => {
    // This adds a capability; it must change no default. RSI is the control: it
    // declares `legendParams` and no `nameFrom`, so it keeps `RSI (14)`.
    expect(semanticName(getDefinition('rsi'), { period: 14 })).toBeNull()
    expect(instanceLabel(getDefinition('rsi'), { defId: 'rsi', inputs: { period: 14 } }))
      .toBe('RSI (14)')
    const declaring = listDefinitions().filter(namesItselfSemantically).map((d) => d.id)
    expect(declaring, 'a definition started naming itself without a decision')
      .toEqual(['movingAverage'])
  })
})

describe('⛔ the declaration is validated, because it names INPUT KEYS', () => {
  const base = (meta, inputs) => ({
    schemaVersion: 1,
    id: 'probe',
    version: 1,
    compute: { kind: 'native', fn: 'probe', rev: 1 },
    meta: { name: 'Probe', ...meta },
    placement: { target: 'price' },
    inputs,
    plots: [{ key: 'v', label: 'V', style: 'line', color: '#fff', width: 1, role: 'primary' }],
  })
  const TYPE = { key: 'kind', type: 'enum', label: 'Kind', default: 'a', options: [['a', 'A'], ['b', 'B']] }
  const NUM = { key: 'n', type: 'int', label: 'N', default: 5, min: 1, max: 9, step: 1 }

  // ⚠️ `validateDefinition` ANSWERS `{ok:true, def}` OR `{ok:false, errors}` —
  // there is no `errors: []` on the success path, so a case reading `r.errors`
  // unconditionally would pass vacuously on a REJECTED definition too.
  const why = (r) => (r.ok ? '' : (r.errors || []).join(' | '))

  it('⭐ a well-formed declaration passes', () => {
    const r = validateDefinition(base({ nameFrom: { stem: 'kind', params: ['n'] } }, [TYPE, NUM]))
    expect(r.ok, why(r)).toBe(true)
  })

  it('⛔ a stem that names no input is refused BY NAME', () => {
    const r = validateDefinition(base({ nameFrom: { stem: 'nope' } }, [TYPE, NUM]))
    expect(why(r)).toMatch(/nameFrom\.stem.*names no declared input/)
  })

  it('⛔⛔ a NON-ENUM stem is refused — the stem is an option LABEL', () => {
    // The whole claim of the declaration is that the name is the member's own
    // choice read back from the control they made it in. A number has no label,
    // so the reader would answer null forever and the definition would silently
    // keep its catalogue noun.
    const r = validateDefinition(base({ nameFrom: { stem: 'n' } }, [TYPE, NUM]))
    expect(why(r)).toMatch(/nameFrom\.stem.*only an enum/)
  })

  it('⛔ a param that names no input is refused too', () => {
    const r = validateDefinition(base({ nameFrom: { stem: 'kind', params: ['ghost'] } }, [TYPE, NUM]))
    expect(why(r)).toMatch(/nameFrom\.params.*names no declared input/)
  })

  it('⭐ and the SHIPPED registry passes its own validator', () => {
    // `nativeRegistry` throws at import on an invalid definition, so this is
    // belt-and-braces — but it is the case that would name `movingAverage` if the
    // declaration and the inputs ever drifted apart.
    for (const def of listDefinitions()) {
      const r = validateDefinition(def)
      expect(r.ok, `${def.id}: ${why(r)}`).toBe(true)
    }
  })
})

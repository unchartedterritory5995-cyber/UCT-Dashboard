// UCT RS Phase 3, unit 3-09b — two label defects in the readout.
//
// 1. A benchmark option that is only a door to a text box (`CUSTOM`, "Your
//    symbol") printed its CODE until the server answered: `UCT RS · CUSTOM`.
//    The companion box (`identityFor`) names it: the typed symbol, or the
//    option's label while the box is empty. The server's row still wins.
// 2. Two copies told apart only by an input printed the input's KEY:
//    `UCT RS(SPY) (mansfieldLength 200)`. When every copy carries a distinct
//    display name (a Study drill's `Line A` / `Line B`) the suffix is the name.
import { describe, it, expect } from 'vitest'
import * as engineRegistry from './nativeRegistry'
import { legendChips, engineChips, paneReadoutLabel, readoutChipName } from './readout'
import { instanceLabel } from './sourceRef'
import { identityTextFor } from './defSchema'

const RS = engineRegistry.getDefinition('rsLine')
const binding = (defId, plotKey, instanceId, lastValue = 0.4187) => ({
  key: `${instanceId}::${plotKey}`, instanceId, defId, plotKey,
  series: { __id: `${defId}/${plotKey}/${instanceId}` }, lastValue,
})
const rsInst = (instanceId, inputs = {}, over = {}) => ({ instanceId, defId: 'rsLine', inputs, hidden: false, ...over })
const rsChip = (inputs, opts, over) => legendChips([binding('rsLine', 'rsLine', 'inst:rsLine:1')], null, engineRegistry,
  [rsInst('inst:rsLine:1', inputs, over)], opts)[0]

describe('3-09b · "Your symbol" never reads as its code', () => {
  it('a typed symbol names the line before any envelope: `UCT RS · SMH`', () => {
    const chip = rsChip({ benchmark: 'CUSTOM', customBenchmark: 'SMH' })
    expect(readoutChipName(chip, RS)).toBe('UCT RS · SMH')
    expect(paneReadoutLabel(chip, RS, null)).toBe('UCT Relative Strength · SMH')
    // with a reader that has nothing yet, the same
    const waiting = rsChip({ benchmark: 'CUSTOM', customBenchmark: 'SMH' }, { scalarsOf: () => null })
    expect(readoutChipName(waiting, RS)).toBe('UCT RS · SMH')
  })

  it('an empty box reads as the option label: `UCT RS · Your symbol`', () => {
    expect(readoutChipName(rsChip({ benchmark: 'CUSTOM' }), RS)).toBe('UCT RS · Your symbol')
    expect(readoutChipName(rsChip({ benchmark: 'CUSTOM', customBenchmark: '' }), RS)).toBe('UCT RS · Your symbol')
    expect(readoutChipName(rsChip({ benchmark: 'CUSTOM' }), RS)).not.toMatch(/CUSTOM/)
  })

  it('the server-resolved benchmark still wins once it lands', () => {
    const chip = rsChip({ benchmark: 'CUSTOM', customBenchmark: 'SMH' }, {
      scalarsOf: () => ({ benchmark: { resolved: 'SOXX' }, rating: { ibd: 88 } }),
    })
    expect(readoutChipName(chip, RS)).toBe('UCT RS · SOXX · 88')
  })

  it('a typed symbol under any OTHER option is not identity: `UCT RS · QQQ`', () => {
    expect(readoutChipName(rsChip({ benchmark: 'QQQ', customBenchmark: 'SMH' }), RS)).toBe('UCT RS · QQQ')
    expect(readoutChipName(rsChip({}), RS)).toBe('UCT RS · SPY')
  })
})

// ⭐ 3-14 (measured on the sandbox screen): the chip's `(params)` label and the
// settings list / Display-in name (`sourceRef.instanceLabel`) printed the code
// too — `UCT RS(CUSTOM)`, `UCT RS (CUSTOM)`. Both read `defSchema.identityTextFor`.
describe('3-14 · the chip label and the settings-list name read the typed symbol', () => {
  it('chip.label: `UCT RS(XLK)`, `UCT RS(Your symbol)` while empty, `UCT RS(SPY)` untouched', () => {
    expect(rsChip({ benchmark: 'CUSTOM', customBenchmark: 'XLK' }).label).toBe('UCT RS(XLK)')
    expect(rsChip({ benchmark: 'CUSTOM' }).label).toBe('UCT RS(Your symbol)')
    expect(rsChip({}).label).toBe('UCT RS(SPY)')
    expect(rsChip({ benchmark: 'QQQ', customBenchmark: 'XLK' }).label).toBe('UCT RS(QQQ)')
  })

  it('instanceLabel: `UCT RS (XLK)`, `UCT RS (Your symbol)` while empty, `UCT RS (SPY)` untouched', () => {
    expect(instanceLabel(RS, rsInst('i', { benchmark: 'CUSTOM', customBenchmark: 'XLK' }))).toBe('UCT RS (XLK)')
    expect(instanceLabel(RS, rsInst('i', { benchmark: 'CUSTOM', customBenchmark: '  ' }))).toBe('UCT RS (Your symbol)')
    expect(instanceLabel(RS, rsInst('i', {}))).toBe('UCT RS (SPY)')
    expect(instanceLabel(RS, rsInst('i', { benchmark: 'RSP', customBenchmark: 'XLK' }))).toBe('UCT RS (RSP)')
  })

  it('identityTextFor returns every value without a companion unchanged', () => {
    expect(identityTextFor(RS, 'benchmark', 'SPY', { customBenchmark: 'XLK' })).toBe('SPY')
    expect(identityTextFor(RS, 'maType', 'EMA', {})).toBe('EMA')
    expect(identityTextFor(RS, 'nope', 'CUSTOM', {})).toBe('CUSTOM')
    expect(identityTextFor(null, 'benchmark', 'CUSTOM', {})).toBe('CUSTOM')
    expect(identityTextFor(RS, 'benchmark', 7, {})).toBe(7)
  })
})

// ⭐ BYTE-IDENTICAL FOR EVERY OTHER DEFINITION: the chips of every registered
// definition, at its defaults and at every option of every enum legendParam,
// are compared against the same registry with `identityFor` stripped. Only a
// value that HAS a companion may read differently.
describe('3-09b · every other label is byte-identical', () => {
  const strip = (d) => (d ? { ...d, inputs: (d.inputs || []).map((i) => { const { identityFor, ...rest } = i; return rest }) } : d)
  const stripped = { getDefinition: (id) => strip(engineRegistry.getDefinition(id)), listDefinitions: engineRegistry.listDefinitions }
  const shape = (c) => c && {
    label: c.label, text: c.text, suffix: c.suffix,
    name: readoutChipName(c, engineRegistry.getDefinition(c.defId)),
  }
  const optionValue = (o) => (Array.isArray(o) ? o[0] : (o && typeof o === 'object' ? o.value : o))

  it('across the whole registry', () => {
    let compared = 0
    const changed = []
    for (const def of engineRegistry.listDefinitions()) {
      const plot = (def.plots || []).find((p) => p && p.legend && p.legend.hide !== true)
      if (!plot) continue
      const variants = [{}]
      for (const k of (def.meta && def.meta.legendParams) || []) {
        const inp = (def.inputs || []).find((i) => i.key === k)
        if (inp && inp.type === 'enum') for (const o of inp.options || []) variants.push({ [k]: optionValue(o) })
      }
      for (const inputs of variants) {
        const id = `inst:${def.id}:1`
        const b = [binding(def.id, plot.key, id, 1.5)]
        const inst = [{ instanceId: id, defId: def.id, inputs, hidden: false }]
        const a = shape(legendChips(b, null, engineRegistry, inst)[0])
        const z = shape(legendChips(b, null, stripped, inst)[0])
        const companion = (def.inputs || []).some((i) => i.identityFor && i.activeWhen
          && inputs[i.identityFor] === i.activeWhen.equals)
        if (companion) {
          changed.push(`${def.id} ${JSON.stringify(inputs)}`)
          expect(a.name).not.toMatch(/CUSTOM/)
        } else {
          expect(a, `${def.id} ${JSON.stringify(inputs)}`).toEqual(z)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(50)
    // ⭐ RS split F1 (2026-11-10): `rsPhases` and `rsVsEma` carry the same benchmark
    // pair (`rsSplitBenchmarkInputs`, `identityFor: 'benchmark'`), so their CUSTOM
    // chip reads the typed symbol too. `rsRating` has no benchmark and stays identical.
    // 2026-11-12 (RS Exit Warnings): `rsExit` shares the same benchmark pair, so its CUSTOM chip too.
    expect(changed).toEqual(['rsLine {"benchmark":"CUSTOM"}', 'rsPhases {"benchmark":"CUSTOM"}', 'rsVsEma {"benchmark":"CUSTOM"}',
      'rsExit {"benchmark":"CUSTOM"}'])
  })
})

describe('3-09b · two named copies read by their names', () => {
  // The Study drill shape (unit 4-09): two rsLine instances, `display: {name}`.
  const two = (names, inputsA = { mansfieldLength: 150 }, inputsB = { mansfieldLength: 200 }) => {
    const insts = [
      rsInst('inst:rsLine:1', inputsA, names[0] === undefined ? {} : { display: { name: names[0] } }),
      rsInst('inst:rsLine:2', inputsB, names[1] === undefined ? {} : { display: { name: names[1] } }),
    ]
    return legendChips([binding('rsLine', 'rsLine', 'inst:rsLine:1'), binding('rsLine', 'rsLine', 'inst:rsLine:2', 0.39)],
      null, engineRegistry, insts)
  }

  it('Line A / Line B: chip, pane and short name', () => {
    const [a, b] = two(['Line A', 'Line B'])
    expect(a.label).toBe('UCT RS(SPY) · Line A')
    expect(b.label).toBe('UCT RS(SPY) · Line B')
    expect(a.text).toBe('UCT RS(SPY) · Line A 0.4187')
    expect(paneReadoutLabel(a, RS, null)).toBe('UCT Relative Strength · SPY · Line A')
    expect(paneReadoutLabel(b, RS, null)).toBe('UCT Relative Strength · SPY · Line B')
    expect(readoutChipName(a, RS)).toBe('UCT RS · SPY · Line A')
    expect(readoutChipName(b, RS)).toBe('UCT RS · SPY · Line B')
  })

  it('names that are missing or shared leave the input suffix, byte for byte', () => {
    for (const names of [[undefined, undefined], ['Line A', undefined], ['Line A', 'Line A'], ['', 'Line B']]) {
      const [a, b] = two(names)
      expect(a.label, JSON.stringify(names)).toBe('UCT RS(SPY) (mansfieldLength 150)')
      expect(b.label).toBe('UCT RS(SPY) (mansfieldLength 200)')
      expect(paneReadoutLabel(a, RS, null)).toBe('UCT Relative Strength · SPY (mansfieldLength 150)')
      expect(readoutChipName(b, RS)).toBe('UCT RS · SPY (mansfieldLength 200)')
    }
  })

  it('identical inputs and distinct names: the names, not `#1` / `#2`', () => {
    const [a, b] = two(['Line A', 'Line B'], {}, {})
    expect([a.label, b.label]).toEqual(['UCT RS(SPY) · Line A', 'UCT RS(SPY) · Line B'])
    const [c, d] = two([undefined, undefined], {}, {})
    expect([c.label, d.label]).toEqual(['UCT RS(SPY) #1', 'UCT RS(SPY) #2'])
  })

  it('labels that already differ are not touched, named or not', () => {
    const [a, b] = two(['Line A', 'Line B'], { benchmark: 'SPY' }, { benchmark: 'QQQ' })
    expect([a.label, b.label]).toEqual(['UCT RS(SPY)', 'UCT RS(QQQ)'])
  })

  it('engineChips carries the same names (the valued lane)', () => {
    const chips = engineChips([binding('rsLine', 'rsLine', 'inst:rsLine:1'), binding('rsLine', 'rsLine', 'inst:rsLine:2')],
      null, engineRegistry,
      [rsInst('inst:rsLine:1', {}, { display: { name: 'Line A' } }), rsInst('inst:rsLine:2', {}, { display: { name: 'Line B' } })])
    expect(chips.map((c) => c.label)).toEqual(['UCT RS(SPY) · Line A', 'UCT RS(SPY) · Line B'])
  })
})

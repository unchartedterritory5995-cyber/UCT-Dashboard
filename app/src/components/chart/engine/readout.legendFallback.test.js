// 2026-11-07: the pane label's declared alternative value (`meta.legendFallback`).
import { describe, it, expect } from 'vitest'
import { readoutFallbackValue } from './readout'
import { validateDefinition } from './defSchema'
import { getDefinition } from './nativeRegistry'

const RS = getDefinition('rsLine')
const payload = { legend: { lastValue: 0.4656, asOf: '20261106' }, mansfield: { value: 12.3456 } }

describe('readoutFallbackValue — a declared alternative before the dated last value', () => {
  // v4 (unit 3-08): the Reading (`view`) picks the entry, on the equals gate.
  it('Mansfield view: the label shows the Mansfield reading, live (not muted, no date)', () => {
    const v = readoutFallbackValue(RS, payload, 4, { view: 'mansfield' })
    expect(v.muted).toBe(false)
    expect(v.text).toMatch(/^\+12\.3%$/)
  })
  it('ratio view: the dated last RS value, muted, as before', () => {
    const v = readoutFallbackValue(RS, payload, 4, { view: 'ratio' })
    expect(v).toEqual({ text: '0.4656 · Nov 6', muted: true })
    // 3-08b: the legacy switch with NO stored Reading reads as the Mansfield
    // Reading (`showMansfield.mapsTo`); a stored Reading always wins
    expect(readoutFallbackValue(RS, payload, 4, { showMansfield: true })).toEqual({ text: '+12.3%', muted: false })
    expect(readoutFallbackValue(RS, payload, 4, { showMansfield: true, view: 'ratio' }))
      .toEqual({ text: '0.4656 · Nov 6', muted: true })
  })
  it('Mansfield view with no Mansfield value falls back to the dated RS value', () => {
    const v = readoutFallbackValue(RS, { legend: payload.legend, mansfield: { value: null } }, 4, { view: 'mansfield' })
    expect(v.muted).toBe(true)
  })
  it('a definition without readout[] is untouched (null)', () => {
    expect(readoutFallbackValue(getDefinition('rsi'), payload, 2, {})).toBeNull()
  })
})

describe('defSchema validates meta.legendFallback', () => {
  it('the shipped RS definition validates', () => {
    const r = validateDefinition(RS)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })
  it('a bad source, an unknown format and a bad shape are refused by name', () => {
    const bad = (lf) => validateDefinition({ ...RS, meta: { ...RS.meta, legendFallback: lf } })
    expect(bad('x').errors.join('\n')).toMatch(/meta\.legendFallback: expected an array/)
    expect(bad([{ source: 'input:benchmark', format: 'pct' }]).errors.join('\n')).toMatch(/legendFallback\[0\]\.source/)
    expect(bad([{ source: 'scalar:mansfield.value', format: 'percent' }]).errors.join('\n')).toMatch(/legendFallback\[0\]\.format/)
    // 3-08: the equals gate is checked against the enum, the way a readout row's is
    expect(bad([{ source: 'scalar:mansfield.value', format: 'pct', when: 'input:view=mansfeld' }]).errors.join('\n'))
      .toMatch(/legendFallback\[0\]\.when: "mansfeld" is not one of "view"'s option values/)
    expect(bad([{ source: 'scalar:mansfield.value', format: 'pct', when: 'input:nope=x' }]).errors.join('\n'))
      .toMatch(/legendFallback\[0\]\.when: "nope" names no declared input/)
    expect(bad([{ source: 'scalar:mansfield.value', format: 'pct', when: 'view==x' }]).errors.join('\n'))
      .toMatch(/legendFallback\[0\]\.when: expected a readout source or an input/)
  })
})

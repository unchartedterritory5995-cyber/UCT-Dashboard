// Hardening 1 — a presentation colour reaches CSS only if it is a colour.
//
// ⚰️ Inventory 2026-10-08: a definition's plot / colour-setting value (or a SHARED chart
// layout's instance override of it) flowed unchecked through `readout.resolvePlotColor`
// into the legend chip's inline `background`, and into the legend row, the settings
// colour swatch and the inspector rail — `url(...)` there made the viewer's browser
// fetch it. Every sink now writes only `safeCssColour` values; legitimate colours
// (hex, rgb/rgba, hsl, plain words) are untouched; a `token:` reference (never valid
// CSS) is not written raw.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { isPresentationColour, safeCssColour, PRESENTATION_COLOUR } from '../objectColour'
import { chipsFrom } from '../readout'
import * as engineRegistry from '../nativeRegistry'
import IndicatorChip from '../../legend/IndicatorChip'
import LegendRow from '../../legend/LegendRow'
import ColorPicker from '../../ColorPicker'

const CASES = JSON.parse(fs.readFileSync(
  path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/ast/object_colour_cases.json'), 'utf8'))
const EVIL = 'url(https://evil.example/x)'

describe('one grammar, both lanes (object_colour_cases.json)', () => {
  it.each(CASES.presentation.accept)('stored colour accepted: %s', (v) => expect(isPresentationColour(v)).toBe(true))
  it.each(CASES.presentation.reject)('stored colour refused: %s', (v) => expect(isPresentationColour(v)).toBe(false))
  it.each(CASES.safeCss.accept)('CSS-safe: %s', (v) => expect(safeCssColour(v)).toBe(v))
  it.each(CASES.safeCss.reject)('never written to CSS: %s', (v) => expect(safeCssColour(v)).toBeUndefined())
  it('the server holds the same source (tests/test_definition_colour_trust.py compares it)', () => {
    expect(PRESENTATION_COLOUR.flags).toContain('i')
  })
})

describe('the readout (legend chip colour) — a stored or SHARED-LAYOUT value', () => {
  // the native RSI's plot colour is a `$ref` to its `color` input, so an instance override
  // — exactly what a shared chart layout carries — is what the chip would wear
  const chip = (inputs) => chipsFrom([{ defId: 'rsi', plotKey: 'rsi', series: {}, lastValue: 50, instanceId: 'inst:rsi:1' }],
    new Map(), engineRegistry, () => inputs)[0]
  it('an unsafe override wears NO colour', () => {
    const c = chip({ length: 14, color: EVIL })
    expect(c).toBeTruthy()
    expect(c.color).toBeUndefined()
  })
  it('a legitimate override is kept exactly', () => {
    expect(chip({ length: 14, color: '#123456' }).color).toBe('#123456')
    expect(chip({ length: 14, color: 'rgba(41, 98, 255, .2)' }).color).toBe('rgba(41, 98, 255, .2)')
  })
})

/** Every inline style in the rendered tree — the only place a value can make the browser fetch. */
const styles = (container) => [...container.querySelectorAll('[style]')].map((e) => e.getAttribute('style')).join(' | ')

describe('the DOM sinks write no URL into any style, whatever they are handed', () => {
  it('legend chip', () => {
    const { container } = render(<IndicatorChip chip={{ defId: 'x', plotKey: 'v', instanceId: 'i', label: 'X', color: EVIL, decimals: 2, value: 1, hidden: false, text: 'X 1' }} onMenu={() => {}} />)
    expect(styles(container)).not.toMatch(/url\(/)
  })
  it('legend chip keeps a real colour', () => {
    const { container } = render(<IndicatorChip chip={{ defId: 'x', plotKey: 'v', instanceId: 'i', label: 'X', color: '#7b68ee', decimals: 2, value: 1, hidden: false, text: 'X 1' }} onMenu={() => {}} />)
    expect(styles(container)).toMatch(/123, 104, 238|#7b68ee/i)
  })
  it('legend row', () => {
    const { container } = render(<LegendRow rowId="r" label="EMA" value="1" color={EVIL} vertical />)
    expect(styles(container)).not.toMatch(/url\(/)
  })
  it('settings colour swatch', () => {
    const { container } = render(<ColorPicker value={EVIL} onChange={() => {}} label="Colour" />)
    expect(styles(container)).not.toMatch(/url\(/)
  })
})

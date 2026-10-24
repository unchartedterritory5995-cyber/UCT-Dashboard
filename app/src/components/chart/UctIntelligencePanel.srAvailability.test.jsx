// The "Support & resistance" toggle reflects REAL availability, not the key's presence.
//
// A chart with fewer than 2 levels gets `levels_sr` with empty zones and `withheld: "too_few_levels"`
// (sr_levels.draw, round r7); a chart outside the judged frame gets the same shape with "out_of_frame"
// (auto_structures._sr_withheld). The overlay draws nothing for either (hasLevelsSr is false), so the toggle
// must not light: it shows QUIET (disabled, unchecked, hinted "No clear levels on this chart") and a click
// writes nothing. Asserted by what RENDERS, not by state.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { layerAvailability, effectiveLayers, readUctIntelligence } from './uctIntelligence'
import UctIntelligencePanel from './UctIntelligencePanel'

// The server's withheld blocks, shaped as auto_structures._sr_payload / _sr_withheld emit them.
const TOO_FEW = { round: 'r7', asof_t: 1760000000, atr: 1.2, zones: [], trendlines: [], withheld: 'too_few_levels' }
const OUT_OF_FRAME = { round: 'r7', asof_t: 1760000000, atr: null, zones: [], trendlines: [], withheld: 'out_of_frame' }
const DRAWN = {
  round: 'r7', asof_t: 1760000000, atr: 1.2, trendlines: [],
  zones: [
    { role: 'Resistance', bot: 110, top: 111, label: 'Resistance 110-111' },
    { role: 'Support', bot: 100, top: 101, label: 'Support 100-101' },
  ],
}

const STORED_ON = { showPatterns: true, uctIntelligence: { added: true, labels: true, supportResistance: true } }

function panel(levelsSr) {
  const onSetLayer = vi.fn()
  render(
    <UctIntelligencePanel
      state={readUctIntelligence(STORED_ON)}
      availability={layerAvailability({ levelsSr })}
      onSetLayer={onSetLayer}
      onRemove={() => {}}
    />,
  )
  return { onSetLayer, box: screen.getByLabelText('Support & resistance'),
    row: screen.getByTestId('uct-intel-toggle-supportResistance') }
}

describe('Support & resistance toggle: a withheld layer is quiet, never lit', () => {
  for (const [name, block] of [['too_few_levels', TOO_FEW], ['out_of_frame', OUT_OF_FRAME]]) {
    it(`withheld "${name}": disabled, unchecked, hinted, and a click writes nothing`, () => {
      const { onSetLayer, box, row } = panel(block)
      expect(box.disabled).toBe(true)
      expect(box.checked).toBe(false)                  // the member's stored ON does not light it
      expect(row.textContent).toContain('No clear levels on this chart')
      expect(row.textContent).not.toContain('Automatic levels')
      expect(row.getAttribute('data-disabled')).toBe('true')
      fireEvent.click(box)
      expect(onSetLayer).not.toHaveBeenCalled()
    })

    it(`withheld "${name}": the layer is OFF in effect, and the stored choice is kept`, () => {
      const a = layerAvailability({ levelsSr: block })
      expect(a.supportResistance).toBe(true)           // released: the toggle still exists
      expect(a.supportResistanceEmpty).toBe(true)
      expect(effectiveLayers(STORED_ON, a).supportResistance).toBe(false)
      expect(readUctIntelligence(STORED_ON).supportResistance).toBe(true)
    })
  }

  it('a block with levels to draw: enabled, lit from the stored choice, normal hint, click reports', () => {
    const { onSetLayer, box, row } = panel(DRAWN)
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(true)
    expect(row.textContent).toContain('Automatic levels')
    expect(row.textContent).not.toContain('No clear levels on this chart')
    expect(row.getAttribute('data-disabled')).toBeNull()
    fireEvent.click(box)
    expect(onSetLayer).toHaveBeenLastCalledWith('supportResistance', false)
    expect(effectiveLayers(STORED_ON, layerAvailability({ levelsSr: DRAWN })).supportResistance).toBe(true)
  })

  it('trendlines alone are drawable (the same rule as the overlay, hasLevelsSr)', () => {
    const lineOnly = { ...TOO_FEW, withheld: undefined,
      trendlines: [{ side: 'support', t1: 1, p1: 1, t2: 2, p2: 2 }] }
    expect(layerAvailability({ levelsSr: lineOnly }).supportResistanceEmpty).toBe(false)
  })

  it('an unreleased layer (no key) is still HIDDEN, not quiet', () => {
    render(
      <UctIntelligencePanel state={readUctIntelligence(STORED_ON)} availability={layerAvailability({})}
        onSetLayer={() => {}} onRemove={() => {}} />,
    )
    expect(screen.queryByLabelText('Support & resistance')).toBeNull()
    expect(layerAvailability({}).supportResistanceEmpty).toBe(false)
  })
})

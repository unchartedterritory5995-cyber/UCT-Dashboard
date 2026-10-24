// Setup tags in the UCT Intelligence panel: the server's `setup_tags` (blind-confirmed setups and
// bar events from the last three sessions) are listed beside the confirmed verdicts, each with its
// name and one-line definition, and nothing is listed while the Setups toggle is off.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import UctIntelligencePanel, { chartSetupRows } from './UctIntelligencePanel'
import { layerAvailability, readUctIntelligence } from './uctIntelligence'

const KICKER = {
  setup: 'uct_kicker', setup_name: 'Kicker', kind: 'event', direction: 'bullish', asof_date: '2026-10-22',
  setup_definition: "A down candle followed by an up candle that opens above the prior session's open, so the two bodies do not overlap.",
}
const LAUNCH = {
  setup: 'uct_launch_pad_v4', setup_name: 'Launch Pad', kind: 'setup', direction: 'bullish', asof_date: '2026-10-23',
  setup_definition: 'A close just above a tight cluster of the 8-day EMA, 21-day EMA and 50-day average, with no falling 200-day average overhead.',
}
const VERDICT = { setup: 'macd_bullish_cross', setup_name: 'MACD Bullish Cross', setup_definition: 'MACD crosses up.', asof_date: '2026-10-21' }

const ALL = layerAvailability({ setupsReleased: true })

function panel(setupsOn, rows) {
  return render(
    <UctIntelligencePanel
      state={readUctIntelligence({ uctIntelligence: { added: true, setups: setupsOn } })}
      availability={ALL}
      onSetLayer={() => {}}
      onRemove={() => {}}
      setups={{ setups: rows, loading: false, error: false }}
    />,
  )
}

describe('chartSetupRows', () => {
  it('verdicts first, then the server tags', () => {
    const rows = chartSetupRows({ verdicts: [VERDICT], setup_tags: [LAUNCH, KICKER] })
    expect(rows.map((r) => r.setup)).toEqual(['macd_bullish_cross', 'uct_launch_pad_v4', 'uct_kicker'])
  })

  it('a payload without setup_tags is exactly the verdicts (the flag-off payload)', () => {
    const data = { verdicts: [VERDICT] }
    expect(chartSetupRows(data)).toBe(data.verdicts)
    expect(chartSetupRows(undefined)).toEqual([])
  })

  it('a tag naming a setup the judge already confirmed is not listed twice', () => {
    const dup = { ...KICKER, setup: 'macd_bullish_cross' }
    expect(chartSetupRows({ verdicts: [VERDICT], setup_tags: [dup, KICKER] }).map((r) => r.setup))
      .toEqual(['macd_bullish_cross', 'uct_kicker'])
  })
})

describe('UctIntelligencePanel with setup tags', () => {
  it('shows each tag by name with its one-line definition', () => {
    panel(true, chartSetupRows({ verdicts: [], setup_tags: [LAUNCH, KICKER] }))
    const items = screen.getAllByTestId('uct-intel-setup')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Launch Pad')
    expect(items[0].textContent).toContain(LAUNCH.setup_definition)
    expect(items[1].textContent).toContain('Kicker')
    expect(items[1].textContent).toContain(KICKER.setup_definition)
    expect(items[1].textContent).not.toContain('uct_kicker')
  })

  it('shows nothing from the tags while the Setups toggle is off', () => {
    panel(false, chartSetupRows({ verdicts: [], setup_tags: [LAUNCH, KICKER] }))
    expect(screen.queryAllByTestId('uct-intel-setup')).toHaveLength(0)
    expect(screen.queryByText('Kicker')).toBeNull()
    expect(screen.queryByText(KICKER.setup_definition)).toBeNull()
  })
})

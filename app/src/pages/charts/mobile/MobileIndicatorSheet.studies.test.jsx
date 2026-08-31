/* WAVE 4 — one-tap Studies in the ƒx sheet.
 *
 * TradingView mobile's "add RSI" is two taps; ours routed the single most
 * common study action through the full library dialog (ƒx → Browse → search →
 * tap). These rails pin the shortcut AND its honesty rules:
 *
 *   · the quick six render as switches even on a bare chart;
 *   · a switch commits through `toggledRow` — the SAME write the library
 *     dialog uses, so the two surfaces can never disagree about a toggle;
 *   · any study running that is NOT in the quick six still appears (badge ↔
 *     sheet agreement: a running study this sheet hides reads as a badge
 *     counting ghosts);
 *   · toggling OFF tombstones the instance and clears the mirror — never a
 *     bare array filter, which the read-time migrator would resurrect.
 *
 * Nothing on the path under test is mocked: real registry, real catalog, real
 * instanceControls — the wire is the thing 2026-08-08's audit said component
 * tests are structurally blind to.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import MobileIndicatorSheet from './MobileIndicatorSheet'
import { isInstanceTombstone } from '../../../components/chart/instanceShape'

const liveInstance = (defId) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false })

function renderSheet(cs, onWrite = vi.fn()) {
  render(
    <MobileIndicatorSheet
      open
      onClose={vi.fn()}
      cs={cs}
      onWrite={onWrite}
      onBrowseLibrary={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  )
  return onWrite
}

describe('the quick six', () => {
  test('render as off switches on a bare chart', () => {
    renderSheet({})
    const names = ['Relative Strength Index', 'MACD', 'Bollinger Bands', 'Session VWAP', 'Average True Range', 'Stochastic Oscillator']
    for (const name of names) {
      const sw = screen.getByRole('switch', { name })
      expect(sw).toHaveAttribute('aria-checked', 'false')
    }
  })

  test('session-only studies carry the intraday note so an undrawn line never reads as a broken switch', () => {
    renderSheet({})
    expect(screen.getByText('· intraday')).toBeInTheDocument()
  })

  test('tapping RSI writes a LIVE instance through the shared toggle door', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({})
    await user.click(screen.getByRole('switch', { name: 'Relative Strength Index' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    const next = onWrite.mock.calls[0][0]
    const rsi = (next.indicatorInstances || []).filter((i) => i && i.defId === 'rsi' && !isInstanceTombstone(i))
    expect(rsi).toHaveLength(1)
    expect(next.indicators?.rsi?.enabled).toBe(true)
    expect(next.preset).toBe('custom')
  })

  test('a running study shows ON, and tapping it off tombstones — never resurrectable-deletes', async () => {
    const user = userEvent.setup()
    const cs = { indicatorInstances: [liveInstance('macd')] }
    const onWrite = renderSheet(cs)
    const sw = screen.getByRole('switch', { name: 'MACD' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    const next = onWrite.mock.calls[0][0]
    const liveMacd = (next.indicatorInstances || []).filter((i) => i && i.defId === 'macd' && !isInstanceTombstone(i))
    expect(liveMacd).toHaveLength(0)
    // The off-marker survives (the migrator would resurrect a bare delete)…
    expect((next.indicatorInstances || []).some((i) => isInstanceTombstone(i))).toBe(true)
    // …and the legacy mirror agrees.
    expect(next.indicators?.macd?.enabled).toBe(false)
  })
})

describe('badge ↔ sheet agreement', () => {
  test('a running study OUTSIDE the quick six still appears, switch on', () => {
    // The premise — ichimoku is not a quick-six row — is the sibling test
    // below, which proves it absent when off.
    renderSheet({ indicatorInstances: [liveInstance('ichimoku')] })
    expect(screen.getByRole('switch', { name: 'Ichimoku Cloud' })).toHaveAttribute('aria-checked', 'true')
  })

  test('a study that is OFF and outside the quick six stays out (the sheet is a shortcut, not a second library)', () => {
    renderSheet({})
    expect(screen.queryByRole('switch', { name: 'Ichimoku Cloud' })).toBeNull()
  })
})

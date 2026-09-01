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

describe('wave 8 — tap a row name to edit params (no desktop modal)', () => {
  test('RSI name-tap opens the stacked editor; the + stepper writes period through setInstanceInput', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({ indicatorInstances: [liveInstance('rsi')] })
    await user.click(screen.getByRole('button', { name: 'Edit Relative Strength Index' }))
    // The definition's declared default (14) shows even though the instance
    // carries no explicit inputs — the editor reads decl defaults.
    expect(await screen.findByText('14')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Increase Period' }))
    const next = onWrite.mock.calls.at(-1)[0]
    const rsi = (next.indicatorInstances || []).find((i) => i && i.defId === 'rsi' && !isInstanceTombstone(i))
    expect(rsi?.inputs?.period).toBe(15)
  })

  test('an OFF study name-tap just turns it on (same door as the switch)', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({})
    await user.click(screen.getByRole('button', { name: 'MACD' }))
    const next = onWrite.mock.calls[0][0]
    const live = (next.indicatorInstances || []).filter((i) => i && i.defId === 'macd' && !isInstanceTombstone(i))
    expect(live).toHaveLength(1)
  })

  test('MA name-tap edits the slot: period stepper writes the positional overlays array', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({ overlays: [{ enabled: true, type: 'EMA', period: 9, color: '#38bdf8' }] })
    await user.click(screen.getByRole('button', { name: 'Edit EMA 9' }))
    await user.click(screen.getByRole('button', { name: 'Increase Period' }))
    const next = onWrite.mock.calls.at(-1)[0]
    expect(next.overlays[0].period).toBe(10)
    expect(next.overlays[0].type).toBe('EMA')
  })

  test('the editor offers Remove from chart, and it tombstones like the switch', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({ indicatorInstances: [liveInstance('rsi')] })
    await user.click(screen.getByRole('button', { name: 'Edit Relative Strength Index' }))
    await user.click(await screen.findByRole('button', { name: /remove from chart/i }))
    const next = onWrite.mock.calls.at(-1)[0]
    const live = (next.indicatorInstances || []).filter((i) => i && i.defId === 'rsi' && !isInstanceTombstone(i))
    expect(live).toHaveLength(0)
  })
})

/* WAVE 10 — enum inputs + the legend-chip door.
 *
 * `enum` was the ONE engine input type the phone editor dropped silently —
 * worst of them AVWAP's `anchor`, the input that defines what the indicator
 * IS. Options flow through the desktop's own `fieldFromInput` normalizer
 * (indicatorRegistry), never a copied list, and the write is the RAW typed
 * value. The legend-chip tap opens the sheet ALREADY INSIDE the tapped
 * study's editor, targeted by instanceId — with two of the same study, the
 * tapped one is the one that edits. */
describe('wave 10 — enum chips + initialEditing', () => {
  test('VWAP editor renders the Line style enum as chips and writes the raw value', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({ indicatorInstances: [liveInstance('vwap')] })
    await user.click(screen.getByRole('button', { name: 'Edit Session VWAP' }))
    const dashed = await screen.findByRole('button', { name: 'Dashed' })
    expect(dashed).toHaveAttribute('aria-pressed', 'false')
    await user.click(dashed)
    const next = onWrite.mock.calls.at(-1)[0]
    const inst = (next.indicatorInstances || []).find((i) => i.defId === 'vwap' && !isInstanceTombstone(i))
    expect(inst.inputs.lineStyle).toBe('dashed')
  })

  test('initialEditing opens the sheet already inside the study editor', () => {
    render(
      <MobileIndicatorSheet
        open
        onClose={vi.fn()}
        cs={{ indicatorInstances: [liveInstance('rsi')] }}
        onWrite={vi.fn()}
        onBrowseLibrary={vi.fn()}
        onOpenSettings={vi.fn()}
        initialEditing={{ kind: 'study', defId: 'rsi' }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Increase Period' })).toBeInTheDocument()
  })

  test('initialEditing.instanceId edits the EXACT instance, not the first live one', async () => {
    const user = userEvent.setup()
    const a = { instanceId: 'rsi-a', defId: 'rsi', inputs: { period: 14 }, hidden: false }
    const b = { instanceId: 'rsi-b', defId: 'rsi', inputs: { period: 21 }, hidden: false }
    const onWrite = vi.fn()
    render(
      <MobileIndicatorSheet
        open
        onClose={vi.fn()}
        cs={{ indicatorInstances: [a, b] }}
        onWrite={onWrite}
        onBrowseLibrary={vi.fn()}
        onOpenSettings={vi.fn()}
        initialEditing={{ kind: 'study', defId: 'rsi', instanceId: 'rsi-b' }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Increase Period' }))
    const next = onWrite.mock.calls.at(-1)[0]
    const byId = Object.fromEntries(next.indicatorInstances.map((i) => [i.instanceId, i]))
    expect(byId['rsi-b'].inputs.period).toBe(22)
    expect(byId['rsi-a'].inputs.period).toBe(14)
  })
})

/* WAVE 11 — tap-to-type on the stepper. A stepper alone made period 20→200 a
 * 180-tap trip; the value is now a button that opens an inline numeric input.
 * Commit clamps to the declared range through the SAME write door; Escape
 * abandons the draft and writes nothing. */
describe('wave 11 — stepper tap-to-type', () => {
  test('type a value, Enter — one clamped write through the write door', async () => {
    const user = userEvent.setup()
    const onWrite = renderSheet({ indicatorInstances: [liveInstance('rsi')] })
    await user.click(screen.getByRole('button', { name: 'Edit Relative Strength Index' }))
    await user.click(screen.getByRole('button', { name: 'Type Period' }))
    const box = screen.getByRole('spinbutton', { name: 'Period' })
    await user.clear(box)
    await user.type(box, '50{Enter}')
    const next = onWrite.mock.calls.at(-1)[0]
    const inst = next.indicatorInstances.find((i) => i.defId === 'rsi' && !isInstanceTombstone(i))
    expect(inst.inputs.period).toBe(50)
    // the input closes back to the tappable value
    expect(screen.getByRole('button', { name: 'Type Period' })).toBeInTheDocument()
  })

  test('Escape abandons the draft — the editor closes, nothing written', async () => {
    // The topmost Sheet answers Escape on a document listener no field can
    // stop (Sheet.jsx's own design), so Escape while typing closes the editor
    // sheet AND drops the draft. The load-bearing assertion is the write door
    // staying silent; phones have no Escape key at all.
    const user = userEvent.setup()
    const onWrite = renderSheet({ indicatorInstances: [liveInstance('rsi')] })
    await user.click(screen.getByRole('button', { name: 'Edit Relative Strength Index' }))
    const before = onWrite.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Type Period' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Period' }), '999')
    await user.keyboard('{Escape}')
    expect(onWrite.mock.calls.length).toBe(before)
    expect(screen.queryByRole('spinbutton', { name: 'Period' })).toBeNull()
  })
})

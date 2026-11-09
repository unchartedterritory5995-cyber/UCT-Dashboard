// app/src/pages/charts/mobile/__tests__/rsFixU8PresetDetect.test.jsx
//
// UCT RS Phase 2a review, unit U8, finding #27 (2026-11-07): the phone sheet's
// preset row read inputs alone, so an instance at Trend's inputs whose dots a
// member made Large still pressed the Trend chip and printed its origin line,
// while the desktop dialog (which compares the preset's visibility and dot size
// too) read Custom. The sheet now passes `{instance, def, cs}` to `detectPreset`.
import { render, screen, within, cleanup } from '@testing-library/react'
import { vi, describe, test, expect, afterEach } from 'vitest'
import MobileIndicatorSheet from '../MobileIndicatorSheet'
import * as engineRegistry from '../../../../components/chart/engine/nativeRegistry'

afterEach(() => { cleanup() })

const RS = 'rsLine'
const RS_EDITOR = 'UCT Relative Strength settings'
const trend = () => engineRegistry.getDefinition(RS).meta.presets.find((p) => p.id === 'trend')
const rsAt = (extra) => ({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: { ...trend().inputs }, hidden: false, ...extra }] })

function show(cs) {
  render(
    <MobileIndicatorSheet open onClose={vi.fn()} cs={cs} onWrite={vi.fn()}
      onBrowseLibrary={vi.fn()} onOpenSettings={vi.fn()}
      initialEditing={{ kind: 'study', defId: RS, instanceId: 'rs-1' }} />,
  )
  return within(screen.getByRole('dialog', { name: RS_EDITOR })).getByTestId('preset-row')
}

describe('U8 #27 — the phone preset row compares the preset\'s fields, as the dialog does', () => {
  test('Trend inputs with Trend\'s visibility and dot size read Trend', () => {
    // visual round A2: Trend sizes its zero-cross dot medium (the default size), so a
    // Trend instance stores no dot size at all
    const row = show(rsAt({ visibility: { preset: 'dailyUp' } }))
    expect(row.dataset.preset).toBe('trend')
    expect(within(row).getByTestId('preset-origin').textContent).toBe(trend().origin)
  })

  test('Trend inputs with a Large dot read Custom, and no origin line prints', () => {
    const row = show(rsAt({ visibility: { preset: 'dailyUp' }, presentation: { dotSize: 'large' } }))
    expect(row.dataset.preset).toBe('__custom')
    expect(row.querySelector('[data-preset-id="trend"]').getAttribute('aria-pressed')).toBe('false')
    expect(within(row).queryByTestId('preset-origin')).toBeNull()
  })

  test('Trend inputs with every timeframe shown (not daily-and-up) read Custom', () => {
    const row = show(rsAt({}))
    expect(row.dataset.preset).toBe('__custom')
  })
})

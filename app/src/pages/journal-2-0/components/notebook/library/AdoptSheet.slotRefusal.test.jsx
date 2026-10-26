// Wave 11 Task 11.17 fix round 1 (review M-6, ruling W11-R24): a refusal may name the choice it is about (`slot`),
// and the adoption sheet shows it at that choice's row; one with no slot, or a slot the sheet does not hold, stands
// at the top. `templateLibrary.refusal()` keeping `slot` is 11.16's follow-up, so the library is stubbed here with the
// answer shape that follow-up produces ({ok: false, code, message, slot}).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import AdoptSheet from './AdoptSheet'

const lib = vi.hoisted(() => ({ useOut: null }))
vi.mock('../../../lib/templateLibrary', () => ({
  previewMine: async () => ({
    ok: true,
    data: {
      slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: false, suggested: { value: 'Breakout', label: 'Breakout' } },
        { id: 'p2', type: 'account', label: 'Account', any: true, suggested: null }],
      cards: [], tools: [], questions: [],
    },
  }),
  useTemplate: async () => lib.useOut,
  adoptTool: async () => lib.useOut,
}))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => true, useIsTouch: () => true, useIsTablet: () => false, useIsDesktop: () => false,
  useHasCoarsePointer: () => true, useHasNoHover: () => true,
}))

const S = "That choice isn't in your account."
afterEach(cleanup)

async function press(out) {
  lib.useOut = out
  render(<AdoptSheet galleryId="g1" kind="template" onClose={() => {}} navigate={() => {}} />)
  await waitFor(() => expect(document.querySelector('[data-slot="p1"]')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Use' }))
  return screen.findByRole('alert')
}

describe('a refusal that names a choice', () => {
  it('stands at that choice\'s row, in the server\'s words', async () => {
    const alert = await press({ ok: false, code: 'not_yours', message: S, slot: 'p1' })
    expect(alert.textContent).toBe(S)
    expect(within(document.querySelector('[data-slot="p1"]')).getByRole('alert')).toBe(alert)
    expect(document.querySelector('[data-adopt-sheet]').querySelector(':scope > [role="alert"]')).toBeNull()
  })

  it('CONTROL: with no slot, or one the sheet does not hold, it stands at the top', async () => {
    for (const slot of [undefined, 'p9']) {
      const alert = await press({ ok: false, code: 'not_yours', message: S, slot })
      expect(alert.parentElement.getAttribute('data-adopt-sheet')).toBe('template')
      expect(document.querySelector('[data-slot] [role="alert"]')).toBeNull()
      cleanup()
    }
  })
})

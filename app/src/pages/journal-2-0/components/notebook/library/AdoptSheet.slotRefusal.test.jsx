// Wave 11 Task 11.17 fix round 1 (review M-6, ruling W11-R24): a refusal may name the choice it is about (`slot`),
// and the adoption sheet shows it at that choice's row; one with no slot, or a slot the sheet does not hold, stands
// at the top. Task 11.16: `templateLibrary.refusal()` keeps `slot`, so this runs through the REAL library over a fake
// server answering the routes' error body (`{detail: {code, message, slot?}}`): nothing here stubs the answer shape.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import AdoptSheet from './AdoptSheet'

const PREVIEW = {
  slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: false, suggested: { value: 'Breakout', label: 'Breakout' } },
    { id: 'p2', type: 'account', label: 'Account', any: true, suggested: null }],
  cards: [], tools: [], questions: [],
}
const lib = { detail: null }
beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.endsWith('/preview-mine')) return { ok: true, status: 200, json: async () => PREVIEW }
    if (u.endsWith('/use-template')) return { ok: false, status: 400, json: async () => ({ detail: lib.detail }) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
})
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => true, useIsTouch: () => true, useIsTablet: () => false, useIsDesktop: () => false,
  useHasCoarsePointer: () => true, useHasNoHover: () => true,
}))

const S = "That choice isn't in your account."
afterEach(cleanup)

async function press(detail) {
  lib.detail = detail
  render(<AdoptSheet galleryId="g1" kind="template" onClose={() => {}} navigate={() => {}} />)
  await waitFor(() => expect(document.querySelector('[data-slot="p1"]')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Use' }))
  return screen.findByRole('alert')
}

describe('a refusal that names a choice', () => {
  it('stands at that choice\'s row, in the server\'s words', async () => {
    const alert = await press({ code: 'not_yours', message: S, slot: 'p1' })
    expect(alert.textContent).toBe(S)
    // Non-vacuity: the refusal came back from the real request, through the real library's reader.
    expect(globalThis.fetch.mock.calls.filter(([u]) => String(u).endsWith('/use-template'))).toHaveLength(1)
    expect(within(document.querySelector('[data-slot="p1"]')).getByRole('alert')).toBe(alert)
    expect(document.querySelector('[data-adopt-sheet]').querySelector(':scope > [role="alert"]')).toBeNull()
  })

  it('CONTROL: with no slot, one the sheet does not hold, or a slot that is not a string, it stands at the top', async () => {
    for (const slot of [undefined, 'p9', 42]) {
      const alert = await press({ code: 'not_yours', message: S, ...(slot ? { slot } : {}) })
      expect(alert.parentElement.getAttribute('data-adopt-sheet')).toBe('template')
      expect(document.querySelector('[data-slot] [role="alert"]')).toBeNull()
      cleanup()
    }
  })
})

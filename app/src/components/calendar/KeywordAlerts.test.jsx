import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import KeywordAlerts, { reasonText } from './KeywordAlerts'

describe('reasonText — a refusal has to be actionable', () => {
  it('explains the minimum length rather than just failing', () => {
    // The endpoint answers {ok:false, reason} instead of throwing. Swallowing
    // that would look like a saved subscription that never fires, which is the
    // worst outcome for an alert feature.
    expect(reasonText({ reason: 'too_short_or_too_long', min_length: 3 }))
      .toMatch(/at least 3 characters/i)
  })

  it('says how many are allowed when the limit is hit', () => {
    expect(reasonText({ reason: 'limit_reached', max: 25 }))
      .toMatch(/maximum of 25/i)
  })

  it('has a fallback for an unknown reason and for no response at all', () => {
    expect(reasonText({ reason: 'something_new' })).toMatch(/could not save/i)
    expect(reasonText(null)).toMatch(/could not save/i)
  })
})

describe('KeywordAlerts', () => {
  const listed = (keywords, enabled = true) => ({
    keywords, max: 25, min_length: 3, enabled,
  })

  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { delete global.fetch })

  const mount = async (props = {}) => {
    let r
    await act(async () => { r = render(<KeywordAlerts {...props} />) })
    return r
  }

  it('names the delivery channel — a subscription with an invisible destination is unreasonable', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => listed(['tariff']) }))
    await mount()
    expect(document.body.textContent).toMatch(/email \+ Discord/i)
  })

  it('says so when the pipeline is switched OFF rather than implying it will send', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => listed([], false) }))
    await mount()
    expect(document.body.textContent).toMatch(/paused/i)
    expect(document.body.textContent).not.toMatch(/email \+ Discord/i)
  })

  it('offers the term you just searched, not an empty box to retype into', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => listed([]) }))
    await mount({ suggestion: 'tariff' })
    expect(screen.getByRole('button', { name: /alert me on/i })).toBeTruthy()
  })

  it('does NOT offer a term already subscribed', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => listed(['tariff']) }))
    await mount({ suggestion: 'tariff' })
    expect(screen.queryByRole('button', { name: /alert me on/i })).toBeNull()
  })

  it('surfaces the server’s refusal instead of failing silently', async () => {
    global.fetch = vi.fn((url, opts) => Promise.resolve({
      ok: true,
      json: async () => (opts?.method === 'POST'
        ? { ok: false, reason: 'limit_reached', max: 25 }
        : listed([])),
    }))
    await mount({ suggestion: 'tariff' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /alert me on/i })) })
    expect(screen.getByRole('alert').textContent).toMatch(/maximum of 25/i)
  })

  it('removes a keyword and takes the server’s list as the truth', async () => {
    global.fetch = vi.fn((url, opts) => Promise.resolve({
      ok: true,
      json: async () => (opts?.method === 'DELETE'
        ? { ok: true, keywords: ['buyback'] }
        : listed(['tariff', 'buyback'])),
    }))
    await mount()
    await act(async () => { fireEvent.click(screen.getByLabelText('Remove tariff')) })
    expect(screen.queryByText('tariff')).toBeNull()
    expect(screen.getByText('buyback')).toBeTruthy()
  })

  // TERM-033: this used to assert the panel rendered NOTHING when the list never loaded, which
  // is the swallowed failure itself: the feature vanished and nobody could tell why.
  it('says the list could not be loaded, with a Retry, when the read fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await mount()
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i)
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => listed(['tariff']) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) })
    expect(screen.getByText('tariff')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a non-2xx list read is a failure, not an empty list', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => ({}) }))
    await mount({ suggestion: 'tariff' })
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i)
    expect(screen.queryByRole('button', { name: /alert me on/i })).toBeNull()
  })

  it('a failed remove says so instead of doing nothing', async () => {
    global.fetch = vi.fn((url, opts) => (opts?.method === 'DELETE'
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      : Promise.resolve({ ok: true, json: async () => listed(['tariff']) })))
    await mount()
    await act(async () => { fireEvent.click(screen.getByLabelText('Remove tariff')) })
    expect(screen.getByRole('alert').textContent).toMatch(/could not remove/i)
    expect(screen.getByText('tariff')).toBeTruthy()
  })
})

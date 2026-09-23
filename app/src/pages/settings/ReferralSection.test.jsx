/**
 * PACKET-AC CP1 (fingerprint 1839b8c60) — post-signup referral-code apply.
 *
 * `POST /api/auth/apply-referral` already existed and was already correct,
 * but nothing in the frontend ever called it — a member who signed up
 * without a `?ref=` link had no way to apply a referral code afterward.
 * `ReferralSection` (in `../Settings.jsx`) already displayed the member's
 * OWN outbound code; this adds the missing "apply someone else's code"
 * input, with no backend change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { ReferralSection } from '../Settings'

const MY_REFERRAL = { code: 'ABC123', successful_referrals: 2 }

function mockFetch(responses) {
  // responses: { '/api/auth/my-referral': {...}, '/api/auth/apply-referral': fn|resp }
  global.fetch = vi.fn((url, opts) => {
    if (url === '/api/auth/my-referral') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(responses.myReferral) })
    }
    if (url === '/api/auth/apply-referral') {
      const result = typeof responses.apply === 'function' ? responses.apply(opts) : responses.apply
      return Promise.resolve(result)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

async function renderSection(applyResponse) {
  mockFetch({ myReferral: MY_REFERRAL, apply: applyResponse })
  render(<ReferralSection />)
  // Wait for the my-referral load to settle (component returns null until then).
  await screen.findByText(/Have a referral code/i)
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, clipboard: { writeText: vi.fn(() => Promise.resolve()) } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReferralSection — post-signup apply', () => {
  it('renders the own-code display plus the new apply-code input', async () => {
    await renderSection({ ok: true, json: () => Promise.resolve({ ok: true }) })
    expect(screen.getByText(/Successful Referrals/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ENTER CODE/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument()
  })

  it('on success: clears the input and shows a success message', async () => {
    await renderSection({ ok: true, json: () => Promise.resolve({ ok: true }) })
    const input = screen.getByPlaceholderText(/ENTER CODE/i)
    const btn = screen.getByRole('button', { name: /apply/i })

    fireEvent.change(input, { target: { value: 'friendcode' } })
    expect(input.value).toBe('FRIENDCODE') // uppercased on change, per backend normalization
    fireEvent.click(btn)

    await waitFor(() => expect(screen.getByText(/Code applied\./i)).toBeInTheDocument())
    expect(input.value).toBe('')

    // Verify the request body matches what the backend expects.
    const applyCall = global.fetch.mock.calls.find(c => c[0] === '/api/auth/apply-referral')
    expect(applyCall[1].method).toBe('POST')
    expect(JSON.parse(applyCall[1].body)).toEqual({ code: 'FRIENDCODE' })
  })

  it('on a 400: leaves the typed value in place and surfaces the server detail', async () => {
    await renderSection({ ok: false, json: () => Promise.resolve({ detail: 'Invalid referral code' }) })
    const input = screen.getByPlaceholderText(/ENTER CODE/i)
    const btn = screen.getByRole('button', { name: /apply/i })

    fireEvent.change(input, { target: { value: 'BADCODE' } })
    fireEvent.click(btn)

    await waitFor(() => expect(screen.getByText(/Invalid referral code/i)).toBeInTheDocument())
    // Unlike the success case, the input is NOT cleared so the member can correct it.
    expect(input.value).toBe('BADCODE')
  })

  it('on a network error: shows a generic inline failure, never throws', async () => {
    mockFetch({ myReferral: MY_REFERRAL, apply: () => Promise.reject(new Error('network down')) })
    render(<ReferralSection />)
    await screen.findByText(/Have a referral code/i)

    const input = screen.getByPlaceholderText(/ENTER CODE/i)
    fireEvent.change(input, { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument())
  })

  it('the Apply button is disabled while the input is empty', async () => {
    await renderSection({ ok: true, json: () => Promise.resolve({ ok: true }) })
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/ENTER CODE/i), { target: { value: 'X' } })
    expect(screen.getByRole('button', { name: /apply/i })).not.toBeDisabled()
  })
})

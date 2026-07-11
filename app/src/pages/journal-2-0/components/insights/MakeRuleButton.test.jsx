import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

// Flush pending SWR promises (the on-mount rules GET) inside act so their state
// updates don't warn after a synchronous assertion.
const flush = () => act(async () => {})

// MakeRuleButton uses the REAL useJournalRules hook so we exercise the actual
// POST body. Mock global.fetch: the on-mount GET (rules list) returns [], the
// create POST returns the saved rule record.
import MakeRuleButton from './MakeRuleButton'
import { setFeatureFlag } from '../../featureFlags'

const SAVED_RULE = {
  id: 'r1',
  accountId: 'acc1',
  label: 'Always log a stop before entry',
  evidence: 'no_stop tagged 8× · -$145.00 lifetime',
  sourceType: 'psychology',
  sourceId: 'no_stop',
  status: 'active',
  createdAt: '2026-07-11T00:00:00Z',
  updatedAt: '2026-07-11T00:00:00Z',
}

// Fresh SWR cache per render so no cross-test cache bleed.
function renderButton(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MakeRuleButton
        mistake="no_stop"
        count={8}
        total={-145}
        accountId="acc1"
        {...props}
      />
    </SWRConfig>,
  )
}

beforeEach(() => {
  localStorage.clear() // makeRule flag → default ON
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SAVED_RULE) })
    }
    // GET rules list
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
  })
})

describe('MakeRuleButton', () => {
  it('opens a confirm prefilled with the mapped default label + evidence text', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /make a rule from no_stop/i }))
    // no_stop → the mapped default label, prefilled + editable.
    expect(screen.getByDisplayValue('Always log a stop before entry')).toBeInTheDocument()
    // Evidence line: "{mistake} tagged {count}× · {money} lifetime".
    expect(screen.getByText(/no_stop tagged 8× · -\$145\.00 lifetime/)).toBeInTheDocument()
    await flush()
  })

  it('editing the label + confirm POSTs create with the psychology source fields', async () => {
    const onCreated = vi.fn()
    renderButton({ onCreated })
    fireEvent.click(screen.getByRole('button', { name: /make a rule from no_stop/i }))

    const input = screen.getByDisplayValue('Always log a stop before entry')
    fireEvent.change(input, { target: { value: 'No entry without a written stop' } })

    fireEvent.click(screen.getByRole('button', { name: /save rule/i }))

    // Subtle inline confirmation.
    await screen.findByText(/rule saved/i)
    expect(onCreated).toHaveBeenCalledTimes(1)

    // The create POST — assert method, URL, and body shape.
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(postCall[0]).toBe('/api/j2/accounts/acc1/rules')
    const body = JSON.parse(postCall[1].body)
    expect(body).toMatchObject({
      label: 'No entry without a written stop',
      sourceType: 'psychology',
      sourceId: 'no_stop',
    })
    expect(body.evidence).toMatch(/no_stop tagged 8×/)
  })

  it('falls back to "Avoid {mistake}" for an unmapped mistake tag', async () => {
    renderButton({ mistake: 'some_new_tag', count: 3, total: -10 })
    fireEvent.click(screen.getByRole('button', { name: /make a rule from some_new_tag/i }))
    expect(screen.getByDisplayValue('Avoid some_new_tag')).toBeInTheDocument()
    await flush()
  })

  it('renders nothing AND fires no rules GET when the makeRule flag is off', () => {
    setFeatureFlag('makeRule', false) // beforeEach's localStorage.clear() resets it
    renderButton()
    expect(screen.queryByText(/make this a rule/i)).not.toBeInTheDocument()
    // Flag read FIRST → useJournalRules gets null → no GET /rules ever fires.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('renders nothing AND fires no rules GET when there is no single account (accountId null)', () => {
    renderButton({ accountId: null })
    expect(screen.queryByText(/make this a rule/i)).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('renders no emoji (all iconography via UIcon)', async () => {
    const { container } = renderButton()
    fireEvent.click(screen.getByRole('button', { name: /make a rule from no_stop/i }))
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    await flush()
  })
})

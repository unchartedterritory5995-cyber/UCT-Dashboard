import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

// Flush the on-mount rules GET inside act so a null-render test doesn't warn.
const flush = () => act(async () => {})

// MyRulesList uses the REAL useJournalRules hook. Mock global.fetch: the GET
// returns the active rules; the dismiss POST returns the dismissed record.
import MyRulesList from './MyRulesList'
import { setFeatureFlag } from '../../featureFlags'

const RULES = [
  {
    id: 'r1',
    accountId: 'acc1',
    label: 'Always log a stop before entry',
    evidence: 'no_stop tagged 8× · -$145.00 lifetime',
    sourceType: 'psychology',
    sourceId: 'no_stop',
    status: 'active',
  },
  {
    id: 'r2',
    accountId: 'acc1',
    label: 'Never add to a loser',
    evidence: 'added_to_loser tagged 3× · -$60.00 lifetime',
    sourceType: 'psychology',
    sourceId: 'added_to_loser',
    status: 'active',
  },
]

function setFetch(rules) {
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'POST') {
      // dismiss
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...rules[0], status: 'dismissed' }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(rules) })
  })
}

function renderList(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MyRulesList accountId="acc1" {...props} />
    </SWRConfig>,
  )
}

beforeEach(() => {
  localStorage.clear() // makeRule flag → default ON
  setFetch(RULES)
})

describe('MyRulesList', () => {
  it('renders the active rules (label + evidence) from the server', async () => {
    renderList()
    expect(await screen.findByText('Always log a stop before entry')).toBeInTheDocument()
    expect(screen.getByText('Never add to a loser')).toBeInTheDocument()
    expect(screen.getByText(/no_stop tagged 8×/)).toBeInTheDocument()
  })

  it('dismiss optimistically removes a rule and POSTs the dismiss', async () => {
    renderList()
    await screen.findByText('Always log a stop before entry')

    fireEvent.click(
      screen.getByRole('button', { name: /dismiss rule: always log a stop before entry/i }),
    )

    // Optimistically gone; the other rule remains.
    expect(screen.queryByText('Always log a stop before entry')).not.toBeInTheDocument()
    expect(screen.getByText('Never add to a loser')).toBeInTheDocument()

    // POST fired to the dismiss endpoint.
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(postCall[0]).toBe('/api/j2/rules/r1/dismiss')
  })

  it('empty → a muted invitation line, no rule rows', async () => {
    setFetch([])
    renderList()
    expect(await screen.findByText(/turn a recurring mistake into a rule above/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss rule/i })).not.toBeInTheDocument()
  })

  it('renders nothing when the makeRule flag is off', async () => {
    setFeatureFlag('makeRule', false) // beforeEach's localStorage.clear() resets it
    const { container } = renderList()
    expect(container.textContent).toBe('')
    await flush()
  })

  it('renders nothing when there is no single account (accountId null)', () => {
    const { container } = renderList({ accountId: null })
    expect(container.textContent).toBe('')
  })

  it('renders no emoji (all iconography via UIcon)', async () => {
    const { container } = renderList()
    await screen.findByText('Always log a stop before entry')
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

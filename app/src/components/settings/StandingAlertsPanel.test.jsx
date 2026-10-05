import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StandingAlertsPanel, { criteriaCount } from './StandingAlertsPanel'

const res = (status, json) => ({ ok: status < 300, status, json: async () => json })

function sub(id, { name = 'Breakouts', mode = 'both', suspended = false, filters = [{ field: 'rsi' }] } = {}) {
  return { id, name, mode, suspended, spec: { filters } }
}

function server(initialSubs = []) {
  let subs = initialSubs
  const fetcher = vi.fn(async (url, init = {}) => {
    const m = init.method || 'GET'
    if (url === '/api/screener/spec-alerts') {
      return res(200, { alerts: subs, max: 10, cadence: 'nightly' })
    }
    const suspendMatch = url.match(/^\/api\/screener\/spec-alerts\/(\d+)\/suspend$/)
    if (suspendMatch && m === 'POST') {
      const id = Number(suspendMatch[1])
      subs = subs.map(s => (s.id === id ? { ...s, suspended: true } : s))
      return res(200, { id, suspended: true })
    }
    throw new Error(`unexpected ${m} ${url}`)
  })
  return fetcher
}

describe('criteriaCount', () => {
  it('counts the spec filters array', () => {
    expect(criteriaCount({ spec: { filters: [1, 2, 3] } })).toBe(3)
  })
  it('is 0 when there are no filters', () => {
    expect(criteriaCount({ spec: {} })).toBe(0)
    expect(criteriaCount({})).toBe(0)
  })
})

describe('StandingAlertsPanel', () => {
  it('renders nothing while the backend is dark (404)', async () => {
    const fetcher = vi.fn(async () => res(404, { detail: 'Not Found' }))
    const { container } = render(<StandingAlertsPanel fetcher={fetcher} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(container.textContent).toBe('')
  })

  it('shows an empty state with no standing alerts', async () => {
    render(<StandingAlertsPanel fetcher={server([])} />)
    expect(await screen.findByText(/No standing screen alerts yet/)).toBeTruthy()
  })

  it('renders a row per subscription: name, what it watches, and the mode', async () => {
    render(<StandingAlertsPanel fetcher={server([
      sub(1, { name: 'Momentum breakouts', mode: 'entry', filters: [{ f: 1 }, { f: 2 }] }),
    ])} />)
    expect(await screen.findByText('Momentum breakouts')).toBeTruthy()
    expect(screen.getByText(/2 criteria/)).toBeTruthy()
    expect(screen.getByText(/alerts when a name enters/)).toBeTruthy()
  })

  it('a remove click calls the suspend endpoint (never a DELETE) and the row shows Removed', async () => {
    const fetcher = server([sub(7, { name: 'Gap ups' })])
    render(<StandingAlertsPanel fetcher={fetcher} />)
    const removeBtn = await screen.findByRole('button', { name: 'Remove standing alert Gap ups' })
    fireEvent.click(removeBtn)
    await waitFor(() => expect(fetcher.mock.calls.some(
      ([u, i]) => u === '/api/screener/spec-alerts/7/suspend' && i?.method === 'POST',
    )).toBe(true))
    expect(await screen.findByText('Removed')).toBeTruthy()
    expect(fetcher.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false)
  })

  it('a suspended subscription has no Remove button', async () => {
    render(<StandingAlertsPanel fetcher={server([sub(2, { name: 'Old one', suspended: true })])} />)
    await screen.findByText('Old one')
    expect(screen.queryByRole('button', { name: /Remove standing alert/ })).not.toBeInTheDocument()
    expect(screen.getByText('Removed')).toBeTruthy()
  })
})

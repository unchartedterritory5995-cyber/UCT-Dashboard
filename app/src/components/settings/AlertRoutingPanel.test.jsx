import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AlertRoutingPanel from './AlertRoutingPanel'

const res = (status, json) => ({ ok: status < 300, status, json: async () => json })

function server({ routing = true, webhooks = true } = {}) {
  let rule = { email: true, push: true, webhook: true, suspended: false, suspended_at: null }
  let hooks = []
  const fetcher = vi.fn(async (url, init = {}) => {
    const m = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/alerts/routing') {
      if (!routing) return res(404, { detail: 'Not Found' })
      if (m === 'PUT') rule = { ...rule, ...body }
      return res(200, rule)
    }
    if (url === '/api/alerts/routing/suspend') { rule = { ...rule, suspended: true }; return res(200, rule) }
    if (url === '/api/alerts/routing/resume') { rule = { ...rule, suspended: false }; return res(200, rule) }
    if (url === '/api/alerts/webhooks') {
      if (!webhooks) return res(404, { detail: 'Not Found' })
      if (m === 'POST') {
        if (!body.url.startsWith('https://')) return res(400, { detail: 'Webhook addresses must use https://.' })
        hooks = [{ id: 'wh_1', url: body.url, secret_hint: 'abcd', revoked_at: null }]
        return res(200, { ...hooks[0], secret: 'whsec_secretabcd' })
      }
      return res(200, { webhooks: hooks })
    }
    throw new Error(`unexpected ${m} ${url}`)
  })
  return fetcher
}

describe('AlertRoutingPanel', () => {
  it('renders nothing while both surfaces are dark', async () => {
    const fetcher = server({ routing: false, webhooks: false })
    const { container } = render(<AlertRoutingPanel fetcher={fetcher} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(container.textContent).toBe('')
  })

  it('suspend says nothing is lost, and resume brings the channels back', async () => {
    render(<AlertRoutingPanel fetcher={server({ webhooks: false })} />)
    fireEvent.click(await screen.findByText('Suspend all'))
    expect(await screen.findByText(/still run and are kept in your history/)).toBeTruthy()
    fireEvent.click(screen.getByText('Resume alerts'))
    expect(await screen.findByText('Suspend all')).toBeTruthy()
  })

  it('turning a channel off sends exactly that channel', async () => {
    const fetcher = server({ webhooks: false })
    render(<AlertRoutingPanel fetcher={fetcher} />)
    fireEvent.click(await screen.findByLabelText('Email'))
    await waitFor(() => expect(fetcher.mock.calls.some(([u, i]) => u === '/api/alerts/routing' && i?.method === 'PUT')).toBe(true))
    const put = fetcher.mock.calls.find(([u, i]) => u === '/api/alerts/routing' && i?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toEqual({ email: false })
  })

  it('a new webhook shows its secret once; a refused address shows the server sentence', async () => {
    render(<AlertRoutingPanel fetcher={server({ routing: false })} />)
    const input = await screen.findByLabelText('Webhook address')
    fireEvent.change(input, { target: { value: 'http://bad.example.com' } })
    fireEvent.click(screen.getByText('Add'))
    expect(await screen.findByText('Webhook addresses must use https://.')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'https://ok.example.com/uct' } })
    fireEvent.click(screen.getByText('Add'))
    expect((await screen.findByTestId('webhook-secret')).textContent).toContain('whsec_secretabcd')
  })
})

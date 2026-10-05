import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AuthContext } from '../../context/AuthContext'
import WhatElseOpenPrompt from './WhatElseOpenPrompt'

const asUser = (role) => ({ user: role ? { id: 'u', role } : null })

function mount(role, status = 200) {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', fetchMock)
  const utils = render(
    <AuthContext.Provider value={asUser(role)}>
      <WhatElseOpenPrompt occasion="wf_c13_breadth_drill" />
    </AuthContext.Provider>,
  )
  return { fetchMock, ...utils }
}

describe('WhatElseOpenPrompt (TERM-093)', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('asks nothing and calls nothing for a member', async () => {
    const { fetchMock, container } = mount('member')
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('[data-what-else-open]')).toBeNull()
  })

  it('records the occasion on open, then hides when the flag is dark (404)', async () => {
    const { fetchMock, container } = mount('admin', 404)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/instruments/what-else-open/occasion')
    expect(JSON.parse(init.body).occasion).toBe('wf_c13_breadth_drill')
    await act(async () => {})
    expect(container.querySelector('[data-what-else-open]')).toBeNull()
  })

  it('sends the named answer once, and "Nothing else" excludes the tools', async () => {
    const { fetchMock } = mount('admin', 200)
    await screen.findByRole('group', { name: 'What else is open' })
    fireEvent.click(screen.getByRole('button', { name: 'finviz.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nothing else' }))
    expect(screen.getByRole('button', { name: 'finviz.com' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'TradingView' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('status')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toMatch(/^\/api\/instruments\/what-else-open\/occasion\/[^/]+\/answer$/)
    expect(JSON.parse(init.body).tools).toEqual(['tradingview'])
  })

  it('Skip leaves the occasion unanswered: no answer is sent', async () => {
    const { fetchMock, container } = mount('admin', 200)
    await screen.findByRole('group', { name: 'What else is open' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(container.querySelector('[data-what-else-open]')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SaveForkDialog from './SaveForkDialog'

const OFFER = {
  choices: [
    { id: 'frozen_list', label: 'A frozen list',
      detail: "Today's matches, as a watchlist. It will not change.",
      available: true },
    { id: 'definition', label: 'A re-runnable screen',
      detail: 'The criteria, saved. Every run shows that day’s matches.',
      available: true },
    { id: 'standing_alert', label: 'A standing alert',
      detail: 'The criteria, saved, and you are told overnight when names enter or leave.',
      available: false,
      reason: 'Standing screen alerts are not switched on yet.' },
  ],
}

const res = (status, json) => ({ ok: status < 300, status, json: async () => json })

afterEach(() => vi.restoreAllMocks())

describe('SaveForkDialog', () => {
  it('renders all three choices on open', async () => {
    const fetcher = vi.fn(async () => res(200, OFFER))
    render(<SaveForkDialog open onClose={() => {}} spec={{}} fetcher={fetcher} />)
    expect(await screen.findByText('A frozen list')).toBeTruthy()
    expect(screen.getByText('A re-runnable screen')).toBeTruthy()
    expect(screen.getByText('A standing alert')).toBeTruthy()
  })

  it('shows an unavailable choice disabled WITH its reason', async () => {
    const fetcher = vi.fn(async () => res(200, OFFER))
    render(<SaveForkDialog open onClose={() => {}} spec={{}} fetcher={fetcher} />)
    await screen.findByText('A standing alert')
    expect(screen.getByText('Standing screen alerts are not switched on yet.')).toBeTruthy()
    const radio = screen.getByRole('radio', { name: /A standing alert/ })
    expect(radio.hasAttribute('disabled')).toBe(true)
  })

  it('blocks confirm until a choice is picked', async () => {
    const fetcher = vi.fn(async () => res(200, OFFER))
    render(<SaveForkDialog open onClose={() => {}} spec={{}} fetcher={fetcher} />)
    await screen.findByText('A frozen list')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: /A frozen list/ }))
    expect(save.hasAttribute('disabled')).toBe(false)
  })

  it('clicking an unavailable choice does not select it (confirm stays blocked)', async () => {
    const fetcher = vi.fn(async () => res(200, OFFER))
    render(<SaveForkDialog open onClose={() => {}} spec={{}} fetcher={fetcher} />)
    await screen.findByText('A standing alert')
    fireEvent.click(screen.getByRole('radio', { name: /A standing alert/ }))
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  })

  it('confirm POSTs the chosen choice and renders success text', async () => {
    const spec = { filters: [{ key: 'price', op: 'gte', min: 10 }] }
    const fetcher = vi.fn(async (url, init = {}) => (init.method === 'POST'
      ? res(200, { choice: 'definition', saved_screen: { id: 7, name: 'Untitled screen' } })
      : res(200, OFFER)))
    render(<SaveForkDialog open onClose={() => {}} spec={spec} fetcher={fetcher} />)
    await screen.findByText('A re-runnable screen')

    fireEvent.click(screen.getByRole('radio', { name: /A re-runnable screen/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved as a re-runnable screen.')).toBeTruthy()

    const post = fetcher.mock.calls.find(([, i]) => i?.method === 'POST')
    expect(post).toBeTruthy()
    expect(JSON.parse(post[1].body)).toEqual({ choice: 'definition', spec })
  })

  it('renders the server error sentence when the POST fails', async () => {
    const fetcher = vi.fn(async (url, init = {}) => (init.method === 'POST'
      ? res(409, { detail: 'Standing screen alerts are not switched on yet.' })
      : res(200, OFFER)))
    render(<SaveForkDialog open onClose={() => {}} spec={{}} fetcher={fetcher} />)
    await screen.findByText('A frozen list')

    fireEvent.click(screen.getByRole('radio', { name: /A frozen list/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Standing screen alerts are not switched on yet.')).toBeTruthy()
  })

  it('renders nothing while closed', () => {
    const fetcher = vi.fn()
    const { container } = render(<SaveForkDialog open={false} onClose={() => {}} spec={{}} fetcher={fetcher} />)
    expect(container.textContent).toBe('')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

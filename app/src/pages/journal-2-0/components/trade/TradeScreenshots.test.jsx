import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TradeScreenshots from './TradeScreenshots'

// SWR is mocked so the test drives the attachment list directly (same idiom as
// TradeDetailPage.test.jsx). `mutate` is a spy we assert the component calls
// after a successful upload / delete.
let swrData
const mutateSpy = vi.fn()
vi.mock('swr', () => ({
  default: () => ({ data: swrData, isLoading: false, mutate: mutateSpy }),
}))

const TRADE_ID = 't1'

function fileInput() {
  return document.querySelector('input[type="file"]')
}

beforeEach(() => {
  swrData = { attachments: [] }
  mutateSpy.mockClear()
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'a9', url: '/x.png', label: 'x', createdAt: 'now' }) }),
  )
})

describe('TradeScreenshots', () => {
  it('renders the empty-state drop-zone copy', () => {
    render(<TradeScreenshots tradeId={TRADE_ID} />)
    expect(screen.getByText('Paste or drop a chart screenshot')).toBeInTheDocument()
  })

  it('uploads a browsed file via FormData POST then mutates + fires telemetry', async () => {
    render(<TradeScreenshots tradeId={TRADE_ID} />)
    const file = new File(['bytes'], 'chart.png', { type: 'image/png' })
    fireEvent.change(fileInput(), { target: { files: [file] } })

    await waitFor(() => expect(mutateSpy).toHaveBeenCalled())

    const uploadCall = global.fetch.mock.calls.find(
      (c) => c[0] === `/api/j2/trades/${TRADE_ID}/attachments` && c[1]?.method === 'POST',
    )
    expect(uploadCall).toBeTruthy()
    expect(uploadCall[1].body).toBeInstanceOf(FormData)
    expect(uploadCall[1].body.get('file')).toBe(file)

    // fire-and-forget telemetry
    const telem = global.fetch.mock.calls.find((c) => c[0] === '/api/j2/telemetry')
    expect(telem).toBeTruthy()
    expect(JSON.parse(telem[1].body)).toEqual({ event: 'screenshot_added' })
  })

  it('deletes a thumbnail (confirm-click) via DELETE then mutates', async () => {
    swrData = { attachments: [{ id: 'att5', url: '/api/j2/trades/attachments/u/ref/att5.png', label: 'shot', createdAt: 'now' }] }
    render(<TradeScreenshots tradeId={TRADE_ID} />)

    // First click arms the confirm; second click deletes (no window.confirm).
    fireEvent.click(screen.getByRole('button', { name: /remove screenshot/i }))
    fireEvent.click(screen.getByRole('button', { name: /click again/i }))

    await waitFor(() => expect(mutateSpy).toHaveBeenCalled())
    const del = global.fetch.mock.calls.find(
      (c) => c[0] === '/api/j2/trades/attachments/att5' && c[1]?.method === 'DELETE',
    )
    expect(del).toBeTruthy()
  })

  it('surfaces the server 400 detail inline', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ detail: 'Image must be < 5 MB' }) }),
    )
    render(<TradeScreenshots tradeId={TRADE_ID} />)
    fireEvent.change(fileInput(), {
      target: { files: [new File(['x'], 'big.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Image must be < 5 MB')).toBeInTheDocument()
    expect(mutateSpy).not.toHaveBeenCalled()
  })

  it('opens a lightbox on thumbnail click and closes on Escape', async () => {
    swrData = { attachments: [{ id: 'att5', url: '/api/j2/trades/attachments/u/ref/att5.png', label: 'shot', createdAt: 'now' }] }
    render(<TradeScreenshots tradeId={TRADE_ID} />)

    fireEvent.click(screen.getByRole('button', { name: /view screenshot/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

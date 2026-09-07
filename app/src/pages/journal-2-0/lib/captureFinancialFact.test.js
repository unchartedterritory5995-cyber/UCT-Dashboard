import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./captureTargets', () => ({ freshLastNote: vi.fn() }))

import { freshLastNote } from './captureTargets'
import { capturePriceToNotebook } from './captureFinancialFact'

const realFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn()
  freshLastNote.mockReset()
  try { localStorage.clear() } catch { /* noop */ }
})
afterEach(() => { global.fetch = realFetch })

describe('capturePriceToNotebook', () => {
  it('captures into the last-active note when one is fresh', async () => {
    freshLastNote.mockReturnValue({ id: 'note-1', title: 'Existing' })
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ fact: { id: 'fact-1' } }) })
      .mockResolvedValueOnce({ ok: true })
    const msg = await capturePriceToNotebook('NVDA')
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/j2/notes/note-1/facts', expect.objectContaining({
      body: JSON.stringify({ ticker: 'NVDA', factType: 'price' }),
    }))
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/j2/notes/note-1/facts/fact-1/insert', expect.objectContaining({
      method: 'POST',
    }))
    expect(msg).toBe('NVDA price captured to Notebook')
  })

  it('starts a new note when there is no fresh last-active note', async () => {
    freshLastNote.mockReturnValue(null)
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ note: { id: 'note-new', title: 'NVDA' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ fact: { id: 'fact-1' } }) })
      .mockResolvedValueOnce({ ok: true })
    const msg = await capturePriceToNotebook('NVDA')
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/j2/notes', expect.objectContaining({
      body: JSON.stringify({ title: 'NVDA' }),
    }))
    expect(msg).toBe('NVDA price captured to Notebook')
  })

  it('a failed fact creation returns a friendly message, never throws', async () => {
    freshLastNote.mockReturnValue({ id: 'note-1' })
    global.fetch.mockResolvedValueOnce({ ok: false })
    const msg = await capturePriceToNotebook('NVDA')
    expect(msg).toBe('Capture failed — try again')
  })

  it('a network error never throws onto the caller', async () => {
    freshLastNote.mockReturnValue({ id: 'note-1' })
    global.fetch.mockRejectedValue(new Error('network down'))
    await expect(capturePriceToNotebook('NVDA')).resolves.toBe('Capture failed — try again')
  })

  it('a failed note-creation fallback returns a friendly message', async () => {
    freshLastNote.mockReturnValue(null)
    global.fetch.mockResolvedValueOnce({ ok: false })
    const msg = await capturePriceToNotebook('NVDA')
    expect(msg).toBe('Capture failed — try again')
  })
})

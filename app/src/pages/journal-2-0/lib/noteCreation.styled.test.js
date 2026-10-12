import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNoteViaApi } from './noteCreation'

afterEach(() => vi.restoreAllMocks())

describe('createNoteViaApi with a style', () => {
  it('sends styleId/kindId, no bodyJson or properties, and makes ONE request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ note: { id: 'n1', updatedAt: 'x' }, skippedBlocks: [] }),
    })
    const note = await createNoteViaApi({ kindId: 'trade_plan', ticker: 'NVDA' })
    expect(note.id).toBe('n1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(sent).toEqual({ title: '', ticker: 'NVDA', kindId: 'trade_plan' })
  })
  it('sends a styleId the same way, and leaves an unset one off the wire', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ note: { id: 'n2' }, skippedBlocks: [] }),
    })
    await createNoteViaApi({ title: 'T', styleId: 'builtin:thesis' })
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ title: 'T', styleId: 'builtin:thesis' })
    await createNoteViaApi({ title: 'Plain' })
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({ title: 'Plain' })
  })
  it('a refusal carries its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })
    await expect(createNoteViaApi({ styleId: 's1' })).rejects.toMatchObject({ status: 402 })
  })
})

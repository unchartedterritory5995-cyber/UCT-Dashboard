import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNoteViaApi } from './noteCreation'
import { contractBody, contractResponse } from '../__fixtures__/contract'

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

  // Review M-3: the server's sentence travels on the error (the recorded answer, never typed here); the message
  // every other caller reads is what it was.
  it('a refusal carries the server\'s own sentence as .detail, and the message is unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(contractResponse('notes.create.kind.unknown'))
    const err = await createNoteViaApi({ kindId: 'nope' }).catch((e) => e)
    expect(err).toMatchObject({ status: 400, detail: contractBody('notes.create.kind.unknown').detail })
    expect(err.message).toBe('Could not create note (400)')
  })

  it('a body that is not JSON (or a detail that is not text) leaves .detail off, and still throws the refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('html') } })
    const html = await createNoteViaApi({ kindId: 'thesis' }).catch((e) => e)
    expect(html).toMatchObject({ status: 502, message: 'Could not create note (502)' })
    expect(html.detail).toBeUndefined()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'x' }] }) })
    expect((await createNoteViaApi({ kindId: 'thesis' }).catch((e) => e)).detail).toBeUndefined()
  })
})

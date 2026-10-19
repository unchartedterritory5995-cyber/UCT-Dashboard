import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNoteViaApi } from './noteCreation'
import { contractBody, contractResponse } from '../__fixtures__/contract'

afterEach(() => vi.restoreAllMocks())

// P5 Task 6: a styled create also posts `style_applied` to the telemetry door. The rails below are about the
// NOTE request, so they read the note calls; the telemetry call is railed on its own at the end.
const TELEMETRY = '/api/j2/telemetry'
const noteCalls = (spy) => spy.mock.calls.filter(([url]) => url !== TELEMETRY)
const telemetryBodies = (spy) => spy.mock.calls.filter(([url]) => url === TELEMETRY).map(([, init]) => JSON.parse(init.body))

describe('createNoteViaApi with a style', () => {
  it('sends styleId/kindId, no bodyJson or properties, and makes ONE request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ note: { id: 'n1', updatedAt: 'x' }, skippedBlocks: [] }),
    })
    const note = await createNoteViaApi({ kindId: 'trade_plan', ticker: 'NVDA' })
    expect(note.id).toBe('n1')
    expect(noteCalls(fetchSpy)).toHaveLength(1)
    const sent = JSON.parse(noteCalls(fetchSpy)[0][1].body)
    expect(sent).toEqual({ title: '', ticker: 'NVDA', kindId: 'trade_plan' })
  })
  it('sends a styleId the same way, and leaves an unset one off the wire', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ note: { id: 'n2' }, skippedBlocks: [] }),
    })
    await createNoteViaApi({ title: 'T', styleId: 'builtin:thesis' })
    expect(JSON.parse(noteCalls(fetchSpy)[0][1].body)).toEqual({ title: 'T', styleId: 'builtin:thesis' })
    await createNoteViaApi({ title: 'Plain' })
    expect(JSON.parse(noteCalls(fetchSpy)[1][1].body)).toEqual({ title: 'Plain' })
  })
  // Tier 2 part A (/plan): planPrefill rides the wire only when it is EXACTLY true, like the other optional keys.
  it('planPrefill: true is in the body; anything else is left off the wire', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ note: { id: 'n3' }, skippedBlocks: [] }),
    })
    await createNoteViaApi({ kindId: 'trade_plan', ticker: 'NVDA', planPrefill: true })
    expect(JSON.parse(noteCalls(fetchSpy)[0][1].body)).toEqual({
      title: '', ticker: 'NVDA', kindId: 'trade_plan', planPrefill: true,
    })
    for (const [i, bad] of ['yes', 1, 'true', {}, [], null, undefined, false].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await createNoteViaApi({ kindId: 'trade_plan', ticker: 'NVDA', planPrefill: bad })
      expect(JSON.parse(noteCalls(fetchSpy)[i + 1][1].body)).not.toHaveProperty('planPrefill')
    }
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

// P5 Task 6: a create the server composed from a style (a styleId, or a kindId it resolves to that kind's
// style: both take journal_styles.create_styled_note) counts once as `style_applied` 'new_note', after the
// server said yes. Nothing about the note or the style rides along.
describe('createNoteViaApi and style_applied', () => {
  const ok = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (url === TELEMETRY
    ? { ok: true }
    : { ok: true, json: async () => ({ note: { id: 'n1', title: 'My NVDA plan' }, skippedBlocks: [] }) }))

  it('a create with a styleId fires style_applied {via: new_note} once, after the note request', async () => {
    const spy = ok()
    await createNoteViaApi({ title: 'My NVDA plan', styleId: 'builtin:thesis', ticker: 'NVDA' })
    expect(telemetryBodies(spy)).toEqual([{ event: 'style_applied', props: { via: 'new_note' } }])
    expect(spy.mock.calls.map(([u]) => u)).toEqual(['/api/j2/notes', TELEMETRY])   // after, never before
    expect(JSON.stringify(telemetryBodies(spy))).not.toContain('NVDA')
  })

  it("a create with a kindId counts the same way (the server applies that kind's style)", async () => {
    const spy = ok()
    await createNoteViaApi({ kindId: 'trade_plan' })
    expect(telemetryBodies(spy)).toEqual([{ event: 'style_applied', props: { via: 'new_note' } }])
  })

  it('a plain create fires nothing (control)', async () => {
    const spy = ok()
    await createNoteViaApi({ title: 'Plain', bodyJson: { type: 'doc', content: [] } })
    expect(telemetryBodies(spy)).toEqual([])
  })

  it('a refused styled create fires nothing', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })
    await expect(createNoteViaApi({ styleId: 's1' })).rejects.toMatchObject({ status: 402 })
    expect(telemetryBodies(spy)).toEqual([])
  })
})

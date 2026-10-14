import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./noteCreation', () => ({ createNoteViaApi: vi.fn() }))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { createPlanNote, planTitle } from './planCreate'

describe('createPlanNote', () => {
  beforeEach(() => { createNoteViaApi.mockReset(); settleNoteWrite.mockClear() })
  it('asks the server for a prefilled Trade plan and lands the answer', async () => {
    createNoteViaApi.mockResolvedValue({ id: 'n9', title: 'NVDA trade plan' })
    const note = await createPlanNote({ symbol: 'nvda', folderId: 'f1' })
    expect(createNoteViaApi).toHaveBeenCalledWith({
      title: 'NVDA trade plan', kindId: 'trade_plan', ticker: 'NVDA', planPrefill: true, folderId: 'f1',
    })
    expect(settleNoteWrite).toHaveBeenCalledWith('n9', note)
  })
  it('a cashtag is the same symbol, and no folder leaves folderId off the call', async () => {
    createNoteViaApi.mockResolvedValue({ id: 'n8' })
    await createPlanNote({ symbol: '$amd' })
    expect(createNoteViaApi).toHaveBeenCalledWith({
      title: 'AMD trade plan', kindId: 'trade_plan', ticker: 'AMD', planPrefill: true,
    })
  })
  it('refuses a symbol that is not one, and calls nothing', async () => {
    await expect(createPlanNote({ symbol: '12$' })).rejects.toThrow()
    await expect(createPlanNote({})).rejects.toThrow()
    expect(createNoteViaApi).not.toHaveBeenCalled()
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
  it('a refused create is not landed', async () => {
    createNoteViaApi.mockRejectedValue(Object.assign(new Error('x'), { status: 400 }))
    await expect(createPlanNote({ symbol: 'NVDA' })).rejects.toThrow()
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
  it('names the plan after the ticker', () => { expect(planTitle('amd')).toBe('AMD trade plan') })
})

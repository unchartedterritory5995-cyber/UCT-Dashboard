import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./noteCreation', () => ({ createNoteViaApi: vi.fn() }))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { createFollowupNote, followupTitle, followupWhen, parseFollowupParams, MAX_TICKER_LENGTH } from './followupCreate'

describe('createFollowupNote', () => {
  beforeEach(() => { createNoteViaApi.mockReset(); settleNoteWrite.mockClear() })
  it('asks the server for an earnings follow-up and lands the answer', async () => {
    createNoteViaApi.mockResolvedValue({ id: 'n7' })
    const note = await createFollowupNote({ symbol: 'orcl', reportDate: '2026-10-14', folderId: 'f1' })
    expect(createNoteViaApi).toHaveBeenCalledWith({
      title: 'Earnings follow-up — ORCL (Oct 14)', kindId: 'earnings_followup', ticker: 'ORCL',
      tags: ['earnings', 'earnings-followup'], earningsFollowup: { reportDate: '2026-10-14' }, folderId: 'f1',
    })
    expect(settleNoteWrite).toHaveBeenCalledWith('n7', note)
  })
  it('refuses a symbol or a date that is not one, and calls nothing', async () => {
    await expect(createFollowupNote({ symbol: '12$', reportDate: '2026-10-14' })).rejects.toThrow()
    await expect(createFollowupNote({ symbol: 'ORCL', reportDate: '2026-02-30' })).rejects.toThrow()
    expect(createNoteViaApi).not.toHaveBeenCalled()
  })
  it("a ticker with a digit is a ticker (the server's _validate_ticker allows it)", async () => {
    createNoteViaApi.mockResolvedValue({ id: 'n8' })
    await createFollowupNote({ symbol: '3m', reportDate: '2026-10-14' })
    expect(createNoteViaApi.mock.calls[0][0]).toMatchObject({ ticker: '3M', title: 'Earnings follow-up — 3M (Oct 14)' })
  })
})

describe('parseFollowupParams', () => {
  it('reads the link the bell carries, and nothing else', () => {
    expect(parseFollowupParams(new URLSearchParams('followup=BRK.B&reportDate=2026-10-14')))
      .toEqual({ symbol: 'BRK.B', reportDate: '2026-10-14' })
    for (const q of ['followup=ORCL', 'reportDate=2026-10-14', 'followup=ORCL&reportDate=10/14/2026',
      'followup=<b>&reportDate=2026-10-14', 'followup=ORCL&reportDate=2026-13-01']) {
      expect(parseFollowupParams(new URLSearchParams(q)), q).toBeNull()
    }
  })
  it("accepts exactly what the server's _validate_ticker accepts: digits, dot, hyphen, 16 characters", () => {
    const ok = (s) => parseFollowupParams(new URLSearchParams({ followup: s, reportDate: '2026-10-14' }))?.symbol
    expect(ok('3M')).toBe('3M')
    expect(ok('BF-B')).toBe('BF-B')
    expect(ok('  orcl ')).toBe('ORCL')
    expect(ok('A'.repeat(MAX_TICKER_LENGTH))).toBe('A'.repeat(MAX_TICKER_LENGTH))
    expect(ok('A'.repeat(MAX_TICKER_LENGTH + 1))).toBeUndefined()
    for (const bad of ['', '   ', 'A B', 'ORCL$', 'A_B', 'ÉCL', '<b>']) expect(ok(bad), JSON.stringify(bad)).toBeUndefined()
  })
  it('CONTROL -- the pattern the plan door uses (letters only) would have refused 3M', () => {
    expect(/^[A-Za-z][A-Za-z.-]{0,9}$/.test('3M')).toBe(false)
  })
})

describe('the words', () => {
  it('names the note after the ticker and the day', () => { expect(followupTitle('amd', '2026-01-05')).toBe('Earnings follow-up — AMD (Jan 5)') })
  it('says the day with its year', () => { expect(followupWhen('2026-10-14')).toBe('Oct 14, 2026') })
})

import { listRecents, pushRecent } from './mobileRecents'

beforeEach(() => localStorage.clear())

describe('mobileRecents — the phone search rail', () => {
  test('newest first, deduped, capped at 12', () => {
    for (const s of ['AAPL', 'NVDA', 'AAPL', 'TSLA']) pushRecent(s)
    expect(listRecents()).toEqual(['TSLA', 'AAPL', 'NVDA'])
    for (let i = 0; i < 15; i++) pushRecent(`T${i}`)
    expect(listRecents()).toHaveLength(12)
    expect(listRecents()[0]).toBe('T14')
  })

  test('normalizes case/whitespace and refuses synthetic pseudo-tickers', () => {
    pushRecent(' spy ')
    pushRecent('$IDX:memory-hbm')
    pushRecent('')
    expect(listRecents()).toEqual(['SPY'])
  })

  test('a corrupted blob degrades to empty, never throws', () => {
    localStorage.setItem('uct.charts.mobileRecents', '{not json')
    expect(listRecents()).toEqual([])
    localStorage.setItem('uct.charts.mobileRecents', JSON.stringify({ a: 1 }))
    expect(listRecents()).toEqual([])
    localStorage.setItem('uct.charts.mobileRecents', JSON.stringify(['OK', 7, null, 'X']))
    expect(listRecents()).toEqual(['OK', 'X'])
  })
})

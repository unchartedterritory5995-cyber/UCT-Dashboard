import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as base from '../exportCsv'
import { exportScreen } from './csvExport'

describe('exportScreen', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('downloads the full set and reports the row count', async () => {
    vi.spyOn(base, 'fetchAllRows').mockResolvedValue({
      rows: [{ ticker: 'AAA', price: 1 }], view_columns: ['ticker', 'price'], total: 1 })
    const dl = vi.spyOn(base, 'downloadCsv').mockImplementation(() => {})
    const out = await exportScreen({ spec: {}, columns: ['ticker', 'price'], snapshotDate: '2026-08-21' })
    expect(out.rows).toBe(1)
    expect(dl).toHaveBeenCalledWith('screen_2026-08-21.csv', expect.stringContaining('AAA'))
  })

  it('a failed fetch THROWS and downloads nothing — no silent partial file', async () => {
    vi.spyOn(base, 'fetchAllRows').mockRejectedValue(new Error('network'))
    const dl = vi.spyOn(base, 'downloadCsv').mockImplementation(() => {})
    await expect(exportScreen({ spec: {} })).rejects.toThrow()
    expect(dl).not.toHaveBeenCalled()
  })
})

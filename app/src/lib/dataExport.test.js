import { describe, it, expect, vi } from 'vitest'
import { exportQuota, downloadExport } from './dataExport'

const resp = (status, { json, blob = 'x', headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => json,
  blob: async () => blob,
  headers: { get: (k) => headers[k] ?? null },
})

describe('exportQuota — the server decides whether the door exists', () => {
  it('is null when the server door is dark (404)', async () => {
    expect(await exportQuota(async () => resp(404, { json: { detail: 'Not Found' } }))).toBeNull()
  })
  it('is null for a free plan (402)', async () => {
    expect(await exportQuota(async () => resp(402))).toBeNull()
  })
  it('is null on a network error', async () => {
    expect(await exportQuota(async () => { throw new Error('offline') })).toBeNull()
  })
  it('is the quota when armed', async () => {
    const q = { used: 1, cap: 25, remaining: 24 }
    expect(await exportQuota(async () => resp(200, { json: q }))).toEqual(q)
  })
})

describe('downloadExport', () => {
  it('posts the body, asks for the format and saves under the server filename', async () => {
    const fetcher = vi.fn(async () => resp(200, {
      headers: { 'Content-Disposition': 'attachment; filename="screen_2026-10-01_20261002.xlsx"', 'X-Export-Rows': '42' } }))
    const saver = vi.fn()
    const out = await downloadExport('/api/exports/screener', { method: 'POST', format: 'xlsx', body: { filters: [] }, fetcher, saver })
    expect(fetcher.mock.calls[0][0]).toBe('/api/exports/screener?format=xlsx')
    expect(fetcher.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ filters: [] })
    expect(saver).toHaveBeenCalledWith('x', 'screen_2026-10-01_20261002.xlsx')
    expect(out.rows).toBe(42)
  })
  it('a refused export downloads nothing and throws the server sentence', async () => {
    const saver = vi.fn()
    const fetcher = async () => resp(429, { json: { detail: "You've reached today's export limit (25 files)." } })
    await expect(downloadExport('/api/exports/news', { fetcher, saver })).rejects.toThrow(/export limit/)
    expect(saver).not.toHaveBeenCalled()
  })
})

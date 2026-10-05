// dataExport.js — the member's server-side export door (FT-041/042/043).
//
// ⛔ THE SERVER DECIDES WHETHER THIS DOOR EXISTS. `/api/exports/quota` answers
// 404 while DATA_EXPORTS_ENABLED is off and 402 for a free plan, so
// `exportQuota()` returning null is the ONLY signal a surface reads: no flag is
// restated in the client, and a dark server can never show a working button.
//
// ⛔ A FAILED EXPORT DOWNLOADS NOTHING AND SAYS WHY. The server's `detail`
// sentence (the daily cap, the burst limit, a provider outage) is thrown as the
// Error's message so the surface can print it verbatim.

export async function exportQuota(fetcher = fetch) {
  try {
    const r = await fetcher('/api/exports/quota', { credentials: 'include' })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

function filenameFrom(r, fallback) {
  const cd = r.headers?.get?.('Content-Disposition') || ''
  const m = /filename="([^"]+)"/.exec(cd)
  return m ? m[1] : fallback
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadExport(path, { format = 'csv', method = 'GET', body,
  fetcher = fetch, saver = saveBlob } = {}) {
  const sep = path.includes('?') ? '&' : '?'
  const init = { method, credentials: 'include' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const r = await fetcher(`${path}${sep}format=${encodeURIComponent(format)}`, init)
  if (!r.ok) {
    let detail = `Export failed (${r.status})`
    try { const j = await r.json(); if (j?.detail) detail = String(j.detail) } catch { /* not json */ }
    throw new Error(detail)
  }
  const blob = await r.blob()
  const rows = Number(r.headers?.get?.('X-Export-Rows') || 0)
  saver(blob, filenameFrom(r, `export.${format}`))
  return { rows }
}

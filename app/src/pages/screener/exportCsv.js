// Build + download a CSV from result rows.
export function toCsv(rows, columns, labels = {}) {
  const esc = v => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map(c => esc(labels[c] || c)).join(',')
  const body = (rows || []).map(r => columns.map(c => esc(r[c])).join(',')).join('\n')
  return body ? `${header}\n${body}` : header
}

// Default page fetcher — POSTs one page of a scan spec.
async function _postScan(spec) {
  const r = await fetch('/api/screener/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  })
  if (!r.ok) throw new Error(`scan ${r.status}`)
  return r.json()
}

// Page through the full match set (not just the visible page) for CSV export.
// Returns { rows, view_columns, total, snapshot_date }.
export async function fetchAllRows(spec, { pageSize = 500, max = 5000, fetcher = _postScan } = {}) {
  const rows = []
  let view_columns = []
  let snapshot_date = null
  let total = Infinity
  let page = 1
  while (rows.length < total && rows.length < max) {
    const res = await fetcher({ ...spec, page, page_size: pageSize })
    if (!res || !Array.isArray(res.rows) || res.rows.length === 0) break
    if (page === 1) { view_columns = res.view_columns || []; snapshot_date = res.snapshot_date || null }
    total = res.total != null ? res.total : rows.length + res.rows.length
    rows.push(...res.rows)
    if (res.rows.length < pageSize) break
    page += 1
  }
  return { rows, view_columns, total, snapshot_date }
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

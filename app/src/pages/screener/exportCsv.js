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

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

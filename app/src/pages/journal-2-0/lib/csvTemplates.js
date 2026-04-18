/**
 * Client-side CSV template generators for the Import modal.
 * Spec §13.3: "⬇ Pre-matched template" and "⬇ Raw executions template"
 * generated client-side.
 */

/** Pre-matched — what csv_import.parse_pre_matched expects. */
export const PRE_MATCHED_TEMPLATE_HEADERS = [
  'symbol', 'side', 'shares',
  'entry_price', 'entry_date',
  'exit_price', 'exit_date',
  'setup', 'notes', 'original_stop',
]

const PRE_MATCHED_SAMPLE_ROWS = [
  ['NVDA', 'Long', '100', '500.00', '2026-04-01', '520.00', '2026-04-02', 'VCP', '', '490.00'],
  ['AAPL', 'Long', '50', '190.50', '2026-04-01', '195.25', '2026-04-02', 'Breakout', 'scaled out', ''],
]

const RAW_EXEC_TEMPLATE_HEADERS = [
  'date', 'action', 'symbol', 'quantity', 'price',
]

const RAW_EXEC_SAMPLE_ROWS = [
  ['2026-04-01', 'Buy', 'NVDA', '100', '500.00'],
  ['2026-04-02', 'Buy', 'NVDA', '50', '505.00'],
  ['2026-04-03', 'Sell', 'NVDA', '150', '520.00'],
]

/**
 * Serialize headers + rows to a CSV string.
 * Handles cells with commas, quotes, or newlines by double-quoting.
 */
export function toCsv(headers, rows) {
  const quote = (cell) => {
    if (cell == null) return ''
    const s = String(cell)
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  const lines = [headers.map(quote).join(',')]
  for (const row of rows) lines.push(row.map(quote).join(','))
  return lines.join('\n') + '\n'
}

/** Trigger a client-side download of a CSV file. */
export function downloadCsv(filename, headers, rows) {
  const csv = toCsv(headers, rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadPreMatchedTemplate() {
  downloadCsv(
    'j2_pre_matched_template.csv',
    PRE_MATCHED_TEMPLATE_HEADERS,
    PRE_MATCHED_SAMPLE_ROWS,
  )
}

export function downloadRawExecutionsTemplate() {
  downloadCsv(
    'j2_raw_executions_template.csv',
    RAW_EXEC_TEMPLATE_HEADERS,
    RAW_EXEC_SAMPLE_ROWS,
  )
}

/** Exported for tests. */
export const _internal = {
  PRE_MATCHED_SAMPLE_ROWS,
  RAW_EXEC_TEMPLATE_HEADERS,
  RAW_EXEC_SAMPLE_ROWS,
}

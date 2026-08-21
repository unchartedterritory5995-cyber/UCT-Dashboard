// csvExport.js — the loud path. The old ResultsTable silently exported only
// the on-screen rows when the full fetch failed; a member could not tell a
// 5,000-row export from a 100-row fallback. Here failure THROWS and downloads
// nothing — the shell names the failure out loud.
import * as base from '../exportCsv'
import { toCsv } from '../exportCsv'

export async function exportScreen({ spec, columns, labels = {}, snapshotDate,
  fetcher = base.fetchAllRows, downloader = base.downloadCsv } = {}) {
  const all = await fetcher(spec || {})
  const cols = columns?.length ? columns : (all.view_columns || [])
  if (!all.rows.length) throw new Error('the scan returned no rows to export')
  downloader(`screen_${snapshotDate || 'export'}.csv`, toCsv(all.rows, cols, labels))
  return { rows: all.rows.length, truncated: all.rows.length < (all.total ?? all.rows.length) }
}

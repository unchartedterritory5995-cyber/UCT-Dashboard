// EXPORT-FLOW: the member's door onto `GET /api/exports/flow/{symbol}` from the Options Flow
// Search view.
//
// ⛔ THE SERVER DECIDES WHETHER THIS DOOR EXISTS. Same rule as the Screener and Watchlists export
// buttons: `exportQuota()` is null while `DATA_EXPORTS_ENABLED` is off (404) or the plan is free
// (402), and then this renders nothing. No flag is restated in the client.
//
// ⛔ A FAILED EXPORT DOWNLOADS NOTHING AND SAYS WHY, in the server's own sentence (daily cap,
// burst limit, no flow for that ticker), beside the button rather than in a blocking dialog.
//
// ⛔ PARTNER FILE, REBASE-SAFE HOOK. `OptionsFlow.jsx` mounts this once in the Search view with
// the selected ticker and the page's data mode; every string and style lives here and in
// `FlowExportButton.module.css`.

import { useEffect, useState } from 'react'
import { exportQuota, downloadExport } from '../../lib/dataExport'
import styles from './FlowExportButton.module.css'

/** The export path for one ticker. Blank date = the newest session the server holds for it. */
export function flowExportPath(sym, source) {
  const src = source === 'indexes' ? 'indexes' : 'stocks'
  return `/api/exports/flow/${encodeURIComponent(sym)}?source=${src}`
}

/**
 * @param {object} props
 * @param {string} props.sym the selected ticker
 * @param {'stocks'|'indexes'} [props.source]
 * @param {Function} [props.quotaFn] test seam, defaults to `exportQuota`
 * @param {Function} [props.downloadFn] test seam, defaults to `downloadExport`
 */
export default function FlowExportButton({ sym, source = 'stocks', quotaFn = exportQuota, downloadFn = downloadExport }) {
  const [armed, setArmed] = useState(null)
  const [state, setState] = useState({})

  useEffect(() => {
    let live = true
    quotaFn().then((q) => { if (live) setArmed(q) })
    return () => { live = false }
  }, [quotaFn])

  if (!armed || !sym) return null

  const run = async () => {
    setState({ busy: true })
    try {
      const out = await downloadFn(flowExportPath(sym, source), { format: 'csv' })
      setState({ note: `Exported ${out.rows.toLocaleString()} rows of ${sym} flow (CSV, latest session).` })
    } catch (e) {
      setState({ error: `${(e && e.message) || 'Export failed.'} Nothing was downloaded.` })
    }
  }

  return (
    <div className={styles.row}>
      {state.note && <span className={styles.ok} role="status">{state.note}</span>}
      {state.error && <span className={styles.err} role="alert">{state.error}</span>}
      <button
        type="button"
        className={styles.btn}
        onClick={run}
        disabled={!!state.busy}
        title={`Download ${sym}'s latest session of options flow as a CSV file`}
      >
        {state.busy ? 'Exporting…' : 'Export'}
      </button>
    </div>
  )
}

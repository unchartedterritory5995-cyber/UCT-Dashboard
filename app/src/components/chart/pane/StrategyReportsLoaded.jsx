// app/src/components/chart/pane/StrategyReportsLoaded.jsx
//
// ─── W9-T13b (engine-40 bytes fix) — THE PART OF THE REPORT MOUNT THAT IS LOADED ON DEMAND ──
//
// `AttachedStrategyReports.jsx` is in ChartPane's chunk; everything that only the report needs
// lives here and is reached ONLY by its `React.lazy(() => import('./StrategyReportsLoaded'))`,
// which runs only when the broker gate is on AND a run published a record. Gate off: this module
// (and `brokerReport.js`, `broker.js` through it, `StrategyReportPanel.jsx`
// and both CSS modules) is never requested. Measured reason: engine 40 put these in shared
// chunks and tipped `bytes.notebook_first_open` over its budget (`tools/notebook_perf_budgets.py`).
import { useMemo } from 'react'
import { strategyReportOf } from '../engine/runtime/brokerReport.js'
import StrategyReportPanel from './StrategyReportPanel'
import styles from './AttachedStrategyReports.module.css'

/** @param {{items: {instanceId: string, name: string, record: object}[]}} props */
export default function StrategyReportsLoaded({ items }) {
  const reports = useMemo(() => items.map((it) => ({ ...it, report: strategyReportOf(it.record) })), [items])
  return (
    <div className={styles.reports} data-testid="strategy-reports">
      {reports.map((it) => (
        <details key={it.instanceId} className={styles.item}>
          <summary className={styles.summary}>{it.name}: strategy report</summary>
          <StrategyReportPanel report={it.report} name={it.name} />
        </details>
      ))}
    </div>
  )
}

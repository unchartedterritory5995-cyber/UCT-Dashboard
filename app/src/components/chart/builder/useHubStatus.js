// app/src/components/chart/builder/useHubStatus.js
//
// ⭐⭐ THE PASTE WORKER (2026-11-21): THE EDITOR STATUS PANEL'S STATUS, MADE IN THE REPORT'S WORKER (`inspectAsync.js`,
// the hub), READ HERE BY NAME: the report's key and the door answer's key and page state (or the door answer this page
// made, handed to the report's worker once). While the status of the current pair has not come, the status of the
// report alone stands (it came with the report), marked pending (the panel says it is checking).
// Without workers, or for a report this page computed, the status is computed here, as it always was.
import { useEffect, useMemo, useState } from 'react'
import { editorStatus } from './editorStatus'
import { inspectService, reportKeyOf, hubStatusOf, subscribeHubStatuses, pageDoorRefOf, linkHub } from './inspectAsync'
import { doorRefOf } from './memberPane/memberDoorAsync'

/** @returns {{status: object|null, pending: boolean}} */
export function useHubStatus({ enabled, report, pane = null, savedRow = null, inspectedSource = null }) {
  const reportKey = enabled && inspectService().offThread ? reportKeyOf(report) : null
  // here: no workers, or a report this page computed (as it always was)
  const here = useMemo(() => (enabled && !reportKey ? editorStatus({ report, pane, savedRow, inspectedSource }) : null),
    [enabled, reportKey, report, pane, savedRow, inspectedSource])
  // the door answer's name in the hub (idempotent: a door answer this page made is handed over once)
  const ref = useMemo(() => (reportKey && pane ? (doorRefOf(pane) || pageDoorRefOf(pane, inspectedSource)) : null),
    [reportKey, pane, inspectedSource])
  useEffect(() => { if (reportKey) linkHub() }, [reportKey])
  const [, landed] = useState(0)
  useEffect(() => (reportKey ? subscribeHubStatuses(() => landed((n) => n + 1)) : undefined), [reportKey])
  const found = reportKey && (!pane || ref) ? hubStatusOf(reportKey, ref ? ref.key : null, ref ? ref.version : null) : null
  // while the status with the door's answer has not come: this report's own (it came with the report)
  const alone = reportKey ? hubStatusOf(reportKey, null, null) : null
  if (!reportKey) return { status: here, pending: false }
  return { status: found || alone, pending: !found }
}

// app/src/components/chart/pane/AttachedStrategyReports.jsx
//
// ─── ⭐ W9-T13b — THE ONE MOUNT OF THE STRATEGY REPORT PANEL ────────────────────
//
// Under each chart pane, beside `AttachedPineDisclosures`: for every strategy this pane DRAWS
// (a hidden instance draws nothing) whose run carries a `strategy` record (published by the
// binder into `engine/strategyReportNotice.js`), a collapsed "strategy report" disclosure that
// opens the panel. The report is `brokerReport.js::strategyReportOf(record)`, computed here at
// render and never stored.
//
// ⛔⛔ DARK, BEHIND THE EXISTING GATE, NO NEW ARMING PATH. This reads
// `engine/strategyBrokerGate.js::strategyBrokerEnabled` — `VITE_PINE_STRATEGY_BROKER_ENABLED
// === '1'`, the build flag that already gates the broker itself (docs/feature_flags.json, dark,
// UNSET on every service). Off: this returns null BEFORE it reads the store, so nothing of the
// panel reaches the DOM (rail: `strategyReportPanel.test.jsx`, "gate off"). And off, no strategy
// is drawn bar by bar at all (W9-T11), so there is no record to show either way.
// Arming is the owner's act, per W2 stage (ruling D6). Nothing here arms anything.
import { useEffect, useMemo, useState } from 'react'
import { strategyBrokerEnabled } from '../engine/strategyBrokerGate'
import { strategyRecordFor, onStrategyRecordChange } from '../engine/strategyReportNotice'
import { strategyReportOf } from '../engine/runtime/brokerReport.js'
import * as defaultRegistry from '../engine/nativeRegistry'
import StrategyReportPanel from './StrategyReportPanel'
import styles from './AttachedStrategyReports.module.css'

/** The drawn instances of `settings` with a published record, in list order. */
export function attachedStrategyRecords(settings, registry = defaultRegistry, scope = '') {
  const instances = (settings && Array.isArray(settings.indicatorInstances)) ? settings.indicatorInstances : []
  const out = []
  for (const inst of instances) {
    if (!inst || typeof inst !== 'object' || inst.hidden || typeof inst.instanceId !== 'string') continue
    const record = strategyRecordFor(inst.instanceId, scope)
    if (!record) continue
    const def = typeof registry.getDefinition === 'function' ? registry.getDefinition(inst.defId) : null
    out.push({ instanceId: inst.instanceId, name: (def && def.meta && def.meta.name) || 'Strategy', record })
  }
  return out
}

function Reports({ settings, registry, noticeScope }) {
  const [tick, setTick] = useState(0)
  useEffect(() => onStrategyRecordChange(() => setTick((n) => n + 1)), [])
  const generation = typeof registry.registryGeneration === 'function' ? registry.registryGeneration() : 0
  const items = useMemo(
    () => attachedStrategyRecords(settings, registry, noticeScope)
      .map((it) => ({ ...it, report: strategyReportOf(it.record) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, registry, noticeScope, tick, generation],
  )
  if (!items.length) return null
  return (
    <div className={styles.reports} data-testid="strategy-reports">
      {items.map((it) => (
        <details key={it.instanceId} className={styles.item}>
          <summary className={styles.summary}>{it.name}: strategy report</summary>
          <StrategyReportPanel report={it.report} name={it.name} />
        </details>
      ))}
    </div>
  )
}

/**
 * @param {object} props
 * @param {object|null} props.settings  the pane's resolved chart settings
 * @param {object} [props.registry]
 * @param {string} [props.noticeScope]  this pane's binder scope (`createBinder({scope})`)
 */
export default function AttachedStrategyReports({ settings = null, registry = defaultRegistry, noticeScope = '' }) {
  if (!strategyBrokerEnabled()) return null
  return <Reports settings={settings} registry={registry} noticeScope={noticeScope} />
}

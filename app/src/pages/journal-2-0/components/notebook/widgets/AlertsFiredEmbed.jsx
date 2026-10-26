// Wave 10 (Task 10.15): Alerts that fired since the last session (shelf_compose.my_alerts_fired, ruling W10-R10):
// the server's count sentence, then the fires newest first (when, symbol, the log's own words).
import { etDateTime } from '../captureStamp'
import { snapshotStyles as s } from './SnapshotFrame'
import { DedicatedShell, Lines, dedicatedStyles as d } from './DedicatedParts'

export const KIND = 'myAlertsFired'

export default function AlertsFiredEmbed({ attrs, height = 340, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const rows = Array.isArray(p.rows) ? p.rows.filter((r) => r && typeof r === 'object') : []
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="alerts-fired-embed">
      <Lines lines={p.lines} testId="alerts-lines" />
      {rows.length > 0 && (
        <ul className={d.alerts} aria-label="Alerts that fired" data-testid="alerts-rows">
          {rows.map((r, i) => (
            <li key={i} className={d.alert}>
              <span className={d.alertAt}>{etDateTime(r.at) || 'at an unrecorded time'}</span>
              {r.symbol && <span className={`${d.alertSym} ${s.sym}`}>{r.symbol}</span>}
              <span>{r.what}</span>
            </li>
          ))}
        </ul>
      )}
    </DedicatedShell>
  )
}

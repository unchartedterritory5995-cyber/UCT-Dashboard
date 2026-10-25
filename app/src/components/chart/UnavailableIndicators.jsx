// app/src/components/chart/UnavailableIndicators.jsx
//
// ⭐ A1.4 — "⚠ 2 indicators can't be shown". The member-facing half of
// `engine/unavailableInstances.js`: one row per stored record the chart cannot draw, saying
// why, with the actions that reason allows — Remove, Keep (hide this notice for the tab),
// Repair (inputs that no longer fit), Open in Builder (a formula that no longer passes, where
// the host offers its editor), Copy details (a damaged record).
//
// Two shapes: `variant="chip"` (on the chart: a chip that opens a popover) and
// `variant="group"` (Chart Settings → Indicators, the phone ƒx sheet: an inline section).
// Every write goes through the host's own sink; Remove and Repair are undoable (the chart's
// Undo stack). It reads the member's formulas itself (`useInstalledUserDefinitions`) so a
// formula still installing never flashes a false notice.

import { useMemo, useState } from 'react'
import { unavailableInstances, unavailableSentence, unavailableActions } from './engine/unavailableInstances'
import { removeUnavailable, repairInstance } from './engine/instanceControls'
import { useInstalledUserDefinitions } from '../../hooks/useUserDefinitions'
import { recordIndicatorChange } from './indicatorHistoryStore'
import styles from './UnavailableIndicators.module.css'

// ⛔ EXACT KEY, prefix spelled literally (persistence census entry
// `uct.indicators.unavailable.dismissed.v1:*`): the ids the member chose to Keep, per surface,
// for this tab only. The records themselves stay in the chart.
function readDismissed(surfaceKey) {
  try {
    const raw = window.sessionStorage.getItem(`uct.indicators.unavailable.dismissed.v1:${surfaceKey}`)
    const a = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [])
  } catch { return new Set() }
}
function writeDismissed(surfaceKey, set) {
  try { window.sessionStorage.setItem(`uct.indicators.unavailable.dismissed.v1:${surfaceKey}`, JSON.stringify([...set])) } catch { /* memory only */ }
}

const ACTION_LABEL = { remove: 'Remove', keep: 'Keep', repair: 'Repair', openInBuilder: 'Open in Builder', copy: 'Copy details' }

/**
 * @param {object} p
 * @param {'chip'|'group'} [p.variant]
 * @param {object} p.cs              the settings this surface shows
 * @param {object} p.registry        the engine registry
 * @param {(next:object)=>void} p.write  the surface's own sink
 * @param {string} [p.surfaceKey]    the chart's Undo / dismiss surface (`global` if absent)
 * @param {string|null} [p.userId]
 * @param {(defId:string)=>void} [p.onOpenBuilder]  offered for refused formulas when present
 */
export default function UnavailableIndicators({ variant = 'chip', cs, registry, write, surfaceKey = 'global', userId = null, onOpenBuilder = null }) {
  const { isLoading, storeDefIds, generation } = useInstalledUserDefinitions()
  const [dismissed, setDismissed] = useState(() => readDismissed(surfaceKey))
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(null)
  const rows = useMemo(
    () => unavailableInstances(cs, registry, { userDefsReady: !isLoading, storeDefIds })
      .filter((r) => !dismissed.has(r.instanceId)),
    // `generation` re-reads after the member's formulas (re)install
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cs, registry, isLoading, storeDefIds, dismissed, generation],
  )
  if (!rows.length) return null

  const act = (action, row) => {
    setNote(null)
    if (action === 'keep') {
      const next = new Set(dismissed); next.add(row.instanceId)
      writeDismissed(surfaceKey, next); setDismissed(next)
      return
    }
    if (action === 'copy') {
      const rec = (cs.indicatorInstances || []).find((i) => i && i.instanceId === row.instanceId)
      try { navigator.clipboard?.writeText(JSON.stringify({ reason: row.reason, detail: row.detail, record: rec }, null, 2)) } catch { /* no clipboard */ }
      setNote('Details copied.')
      return
    }
    if (action === 'openInBuilder') { if (onOpenBuilder && row.defId) onOpenBuilder(row.defId); return }
    const next = action === 'remove' ? removeUnavailable(cs, row.instanceId, registry) : repairInstance(cs, row.instanceId, registry)
    if (next === cs) { setNote(action === 'repair' ? `Couldn't repair ${row.name} — remove it instead.` : null); return }
    try {
      recordIndicatorChange(surfaceKey, cs, next, { userId, label: action === 'remove' ? `Removed ${row.name}` : `Repaired ${row.name}`, kind: action })
    } catch { /* recording never blocks a write */ }
    write(next)
  }

  const list = (
    <ul className={styles.list} data-testid="unavailable-list">
      {rows.map((r) => (
        <li key={r.instanceId} className={styles.row} data-instance-id={r.instanceId}>
          <span className={styles.name}>{r.name}</span>
          <span className={styles.why}>{unavailableSentence(r)}</span>
          <span className={styles.actions}>
            {unavailableActions(r, { canEdit: !!onOpenBuilder }).map((a) => (
              <button key={a} type="button" className={a === 'remove' ? styles.danger : styles.action} onClick={() => act(a, r)}>
                {ACTION_LABEL[a]}
              </button>
            ))}
          </span>
        </li>
      ))}
      {note && <li className={styles.note} role="status">{note}</li>}
    </ul>
  )
  const title = `${rows.length} indicator${rows.length === 1 ? '' : 's'} can't be shown`

  if (variant === 'group') {
    return (
      <section className={styles.group} data-testid="unavailable-group" aria-label="Unavailable indicators">
        <div className={styles.groupHead}>⚠ Unavailable · {title}</div>
        {list}
      </section>
    )
  }
  return (
    <div className={styles.chipWrap}>
      <button type="button" className={styles.chip} data-testid="unavailable-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⚠ {title}
      </button>
      {open && <div className={styles.popover} role="dialog" aria-label={title}>{list}</div>}
    </div>
  )
}

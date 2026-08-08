// app/src/components/chart/IndicatorAlertManager.jsx
//
// ─── THE ALERT MANAGER (audit-not-wired finding 5) ──────────────────────────
//
// 🔴 `indicator_alert_service.list_for_user`'s own docstring says *"Omitting
// `scope` returns EVERYTHING, which is what the alert manager wants"*. THERE WAS
// NO ALERT MANAGER. `IndicatorAlertPopover` was the sole consumer of
// `useIndicatorAlerts()`, and it filters the response to the chart's own symbol
// (`a.sym === ownSym`) — so a member with alerts on twelve names had no page
// that listed them, no way to audit what was armed, and no way to find an alert
// whose symbol they had forgotten. Every one of those rows was already being
// FETCHED, and then discarded.
//
// ⛔ NO NEW ENDPOINT, AND NO SECOND HOOK. `useIndicatorAlerts()` with no chart
// id is byte-for-byte the request the popover has always made; the only
// difference on this surface is that the symbol filter is not applied. A second
// listing route would have been a second thing to keep in step with `scope`,
// with `instance_label`, and with whatever the sweep writes next.
//
// ⭐ IT SHOWS `state` / `state_detail`, AND THAT IS THE REASON THIS SCREEN
// EXISTS RATHER THAN A NICETY. `sweep_silent_alerts` diagnoses a mute alert
// every five minutes; the popover renders that diagnosis, but only for the one
// symbol the chart happens to be on. This is the surface where a member
// DISCOVERS that an alert of theirs can never fire — including the
// `ichimoku.chikou` alerts that go permanently silent at the cutover. The
// presentation is `AlertStateLine`, the same component the popover mounts, so
// the two can never describe one diagnosis two ways.
//
// ⛔ READ-ONLY, DELIBERATELY. Toggle and delete are `POST`/`DELETE` doors that
// already exist on the chart, beside the form that explains what an alert IS;
// duplicating them here would put two write paths on one row without the
// context (the catalog, the instance list, the current value) that makes a
// change safe. Finding the alert is the gap this closes — the audit's "smallest
// fix" is a read.
import { useMemo } from 'react'
import { useIndicatorAlerts } from '../../hooks/useIndicatorAlerts'
import AlertStateLine, { alertNeedsAttention } from './alertState'
import { formatET } from '../../utils/timeAgo'
import UIcon from '../ui/UIcon'
import styles from './IndicatorAlertManager.module.css'

/** Alerts grouped by symbol.
 *
 *  ⛔ EXPORTED AND PURE, so the grouping can be asserted without a DOM and so
 *  the "no symbol filter" claim is a property of a function rather than of a
 *  render. Symbols A→Z (a member scanning for one they half-remember reads
 *  alphabetically); within a symbol, newest first, which is the order the
 *  popover's list uses and the order `list_for_user` already returns.
 *
 *  ⚠️ A ROW WITH NO `sym` IS NOT DROPPED. It is not a shape the create path can
 *  produce, and silently hiding one would be this whole finding in miniature —
 *  a row that is fetched and then discarded. It files under `—`.
 *
 *  @param {object[]} alerts
 *  @returns {{sym: string, rows: object[]}[]}
 */
export function groupBySymbol(alerts) {
  const bySym = new Map()
  for (const a of Array.isArray(alerts) ? alerts : []) {
    const sym = String(a?.sym || '').toUpperCase() || '—'
    if (!bySym.has(sym)) bySym.set(sym, [])
    bySym.get(sym).push(a)
  }
  return [...bySym.keys()].sort().map((sym) => ({
    sym,
    rows: [...bySym.get(sym)].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
  }))
}

/** One row's headline. `instance_label` is computed SERVER-SIDE from the row's
 *  own `params_json` by the module that evaluates it, so "RSI(7)" and the number
 *  that fires come from the same field; the raw address is the fallback for a
 *  row served before that shipped. ⛔ No second parameter table here — that twin
 *  is what `list_for_user` was written to retire. */
function headline(a) {
  const label = a.instance_label || a.indicator
  const thr = a.threshold !== null && a.threshold !== undefined ? ` @ ${a.threshold}` : ''
  return `${label} ${a.condition}${thr} · ${a.tf}`
}

export default function IndicatorAlertManager() {
  // ⛔ NO CHART ID. `useIndicatorAlerts(null)` keys on the bare
  // `/api/indicator-alerts`, which the server reads as the alert manager's view
  // — every alert this member owns, scoped and global alike. Passing one here
  // would narrow the one screen whose entire purpose is not to narrow.
  const { alerts, isLoading } = useIndicatorAlerts()

  const groups = useMemo(() => groupBySymbol(alerts), [alerts])
  const attention = useMemo(() => alerts.filter(alertNeedsAttention).length, [alerts])

  if (isLoading) {
    return <div className={styles.empty}>Loading your alerts…</div>
  }

  if (!alerts.length) {
    return (
      <div className={styles.empty}>
        No indicator alerts yet. Open a chart, click the bell in the toolbar, and arm one.
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.summary}>
        <span>{alerts.length} alert{alerts.length === 1 ? '' : 's'} across {groups.length} symbol{groups.length === 1 ? '' : 's'}</span>
        {/* ⭐ THE HEADLINE NUMBER, because the reason to open this screen is to
            find out whether anything is broken — and a member with twelve
            alerts should not have to read twelve rows to learn that none is. */}
        {attention > 0 && (
          <span className={styles.summaryWarn} data-testid="alerts-needing-attention">
            <UIcon name="warning" size={13} />
            {attention} not firing
          </span>
        )}
      </div>

      {groups.map(({ sym, rows }) => (
        <section key={sym} className={styles.group} aria-label={`Alerts on ${sym}`}>
          <h4 className={styles.groupHead}>
            <span className={styles.sym}>{sym}</span>
            <span className={styles.count}>{rows.length}</span>
          </h4>
          <ul className={styles.list}>
            {rows.map((a) => {
              const trigAt = a.triggered_at ? formatET(a.triggered_at * 1000) : null
              return (
                <li
                  key={a.id}
                  className={`${styles.row} ${a.active ? '' : styles.inactive}`}
                  data-alert-id={a.id}
                  data-sym={sym}
                >
                  <div className={styles.main}>
                    <div className={styles.headline}>{headline(a)}</div>
                    <div className={styles.sub}>
                      {/* ⭐ WHICH CHART. A scoped alert shows on ONE chart, so
                          this list is the only place it is discoverable at all —
                          saying so is the difference between "where did my alert
                          go" and "it is on that chart". */}
                      {a.scope && (
                        <span className={styles.scopeChip} data-testid="alert-scope-chip">
                          One chart only
                        </span>
                      )}
                      {a.instance_missing && (
                        <span className={styles.cannotFire}>
                          The chart indicator this alert was armed from was removed
                        </span>
                      )}
                      {/* ⭐ THE SWEEP'S OWN DIAGNOSIS — the SAME component the
                          popover mounts. See `alertState.jsx`. */}
                      <AlertStateLine alert={a} className={styles.needsAttention} />
                      {trigAt && <span>Triggered {trigAt}</span>}
                      {a.trigger_count > 0 && <span>· {a.trigger_count}×</span>}
                    </div>
                  </div>
                  <span className={`${styles.state} ${a.active ? styles.on : ''}`}>
                    {a.active ? 'ON' : 'OFF'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

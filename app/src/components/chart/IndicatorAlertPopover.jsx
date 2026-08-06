// app/src/components/chart/IndicatorAlertPopover.jsx
//
// ─── THIS POPOVER NO LONGER NAMES AN INDICATOR ──────────────────────────────
//
// It used to hand-write INDICATORS (8 entries), OSCILLATOR_CONDITIONS,
// CONDITIONS (a per-indicator map), THRESHOLD_CONDITIONS and INDICATOR_LABELS.
// All five were a TWIN of `api/services/indicator_alert_evaluator.INDICATOR_FUNCS`
// — the dict that decides what can actually be EVALUATED — and the twin had
// already drifted: nothing validates `indicator` at any of the create path's
// three layers, so a `vwap` alert can be STORED and can never FIRE, and no
// surface reported it.
//
// The module that evaluates is now the module that names, and this asks it:
// `GET /api/indicator-alerts/catalog`.
//
// ⛔ THERE IS NO FALLBACK LIST, AND THAT IS THE WHOLE SAFETY ARGUMENT. A
// hardcoded eight kept "just in case the fetch fails" would restore the twin AND
// hide it, because a fallback is only ever seen when the fetch fails — i.e.
// exactly when nobody is looking. So: while the catalog is loading this offers
// NOTHING and cannot be submitted; if it cannot be fetched it SAYS SO. Both
// directions are asserted in `IndicatorAlertPopover.test.jsx`, plus a source
// probe, because the absence of a literal is not behaviourally observable.
//
// Pattern mirrors ComparisonPicker.jsx (top:40px, right:8px, position absolute inside the chart wrapper).
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import styles from './IndicatorAlertPopover.module.css'
import {
  useIndicatorAlerts,
  useIndicatorAlertCatalog,
  createIndicatorAlert,
  deleteIndicatorAlert,
  toggleIndicatorAlert,
} from '../../hooks/useIndicatorAlerts'
import { formatET } from '../../utils/timeAgo'
import UIcon from '../ui/UIcon'

// Timeframes are NOT an indicator list — they are the bar sizes the evaluator
// reads from `bars_sqlite`, and no definition declares one. They stay here.
const TFS = [
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '60', label: '1h' },
  { value: 'D', label: 'Daily' },
]

// ─── PICKING A PLOT (B5) ────────────────────────────────────────────────────
//
// "Alert me on Ichimoku" names FIVE different series; adx and donchian name
// three, macd three, bb three, stoch two. So an alert stores a PLOT ADDRESS
// (`ichimoku.tenkan`, `adx.plusDI`) and the served entry carries the plots it
// can be addressed by.
//
// ⛔ THE ADDRESS TO SUBMIT IS ALWAYS `plot.value`, NEVER `entry.indicator`. For
// `adx`, `donchian` and `ichimoku` the entry id is a GROUP NAME with no value
// function behind it — submitting it would store an alert the evaluator cannot
// evaluate, which is the precise defect this whole task exists to close.
//
// Normalising here (rather than branching at four call sites) also keeps the
// component working against an entry that carries no `plots` at all: the served
// shape is backward-compatible on purpose, and so is this.
const plotsOf = (entry) =>
  entry?.plots?.length
    ? entry.plots
    : entry
      ? [{
          value: entry.indicator,
          label: entry.label,
          conditions: entry.conditions,
          default_threshold: entry.default_threshold,
        }]
      : []

function fmtTriggeredAt(epochSec) {
  if (!epochSec) return null
  return formatET(epochSec * 1000)
}

export default function IndicatorAlertPopover({ sym, onClose }) {
  const ownSym = sym ? String(sym).toUpperCase() : ''
  const { alerts } = useIndicatorAlerts()
  const { catalog, isLoading: catalogLoading, error: catalogError } = useIndicatorAlertCatalog()

  const [indicator, setIndicator] = useState('')
  const [plot, setPlot] = useState('')
  const [condition, setCondition] = useState('')
  const [threshold, setThreshold] = useState('')
  const [tf, setTf] = useState('D')
  const [submitting, setSubmitting] = useState(false)
  const firstFieldRef = useRef(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  const byIndicator = useMemo(
    () => new Map(catalog.map((e) => [e.indicator, e])),
    [catalog],
  )

  /** Every ADDRESS the catalog can produce → its plot descriptor.
   *
   *  Keyed on the address, not on `entry.indicator`, because that is what a
   *  stored alert holds. Keying on the entry id would report every grouped
   *  alert (`adx.plusDI`, `ichimoku.tenkan`) as un-evaluatable. */
  const byAddress = useMemo(() => {
    const m = new Map()
    for (const e of catalog) for (const p of plotsOf(e)) m.set(p.value, p)
    return m
  }, [catalog])

  const entry = byIndicator.get(indicator) || null
  const plotOptions = useMemo(() => plotsOf(entry), [entry])
  const plotEntry = plotOptions.find((p) => p.value === plot) || null
  const conditionOptions = plotEntry ? plotEntry.conditions || [] : []

  /** Adopt a served PLOT: its first condition and its declared default
   *  threshold. Both come from the CATALOG, not from a per-indicator `if` ladder
   *  in this file — that ladder was a sixth hand-written list. */
  const selectPlot = useCallback((p) => {
    if (!p) return
    setPlot(p.value)
    setCondition(p.conditions?.[0]?.value || '')
    setThreshold(
      p.default_threshold === null || p.default_threshold === undefined
        ? ''
        : String(p.default_threshold),
    )
  }, [])

  /** Adopt a served entry, then its FIRST plot. `plots[0]` is the legacy address
   *  for every indicator that had one, so an existing user's dropdown opens on
   *  exactly the alert the bare id has always meant. */
  const selectEntry = useCallback((e) => {
    if (!e) return
    setIndicator(e.indicator)
    selectPlot(plotsOf(e)[0])
  }, [selectPlot])

  // Seed (and re-seed) from whatever the server actually offers. While the
  // catalog is empty — loading, or failed — `indicator` stays '' and the form
  // has nothing to submit, which is the intended state, not a bug to paper over.
  useEffect(() => {
    if (!catalog.length) return
    if (byIndicator.has(indicator)) return
    selectEntry(catalog[0])
  }, [catalog, byIndicator, indicator, selectEntry])

  const conditionEntry = conditionOptions.find((c) => c.value === condition) || null
  const needsThreshold = !!conditionEntry?.needs_threshold
  const catalogReady = !catalogLoading && !catalogError && catalog.length > 0

  /** A stored alert's display label, from the served catalog. An alert naming
   *  something the evaluator cannot evaluate gets its raw id back AND is flagged
   *  below — that class of row exists (see the module header) and used to render
   *  indistinguishably from a live one. */
  const labelForAlert = useCallback(
    (a) => byAddress.get(a.indicator)?.label || a.indicator,
    [byAddress],
  )
  const conditionLabelForAlert = useCallback(
    (a) =>
      byAddress.get(a.indicator)?.conditions?.find((c) => c.value === a.condition)?.label ||
      a.condition,
    [byAddress],
  )

  // Alerts filtered to this symbol; most-recently created first.
  const symAlerts = useMemo(() => {
    return alerts
      .filter((a) => String(a.sym || '').toUpperCase() === ownSym)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }, [alerts, ownSym])

  async function handleAdd(e) {
    e?.preventDefault?.()
    if (!ownSym || submitting) return
    // ⛔ `plot`, NEVER `indicator`. See `plotsOf` — for a grouped indicator the
    // entry id has no value function behind it.
    if (!plot) return
    const payload = {
      sym: ownSym,
      indicator: plot,
      condition,
      tf,
    }
    if (needsThreshold) {
      const num = parseFloat(threshold)
      if (!Number.isFinite(num)) return
      payload.threshold = num
    }
    setSubmitting(true)
    try {
      await createIndicatorAlert(payload)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.popover} role="dialog" aria-label="Indicator alerts">
      <div className={styles.header}>
        <span className={styles.title}>
          Indicator Alerts
          {ownSym && <span className={styles.sym}>{ownSym}</span>}
        </span>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <form className={styles.form} onSubmit={handleAdd}>
        {catalogError && (
          <div className={styles.catalogError} role="alert">
            Alert types are unavailable right now — try again in a moment.
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label} id="ia-indicator-label">Indicator</span>
          <select
            ref={firstFieldRef}
            className={styles.select}
            aria-label="Indicator"
            value={indicator}
            disabled={!catalogReady}
            onChange={(e) => selectEntry(byIndicator.get(e.target.value))}
          >
            {catalog.map((i) => (
              <option key={i.indicator} value={i.indicator}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        {/* Only when there is a choice to make. A single-plot indicator showing
            a one-option "Plot" dropdown is noise, and every pre-B5 indicator
            except macd/bb/stoch has exactly one. */}
        {plotOptions.length > 1 && (
          <div className={styles.row}>
            <span className={styles.label}>Plot</span>
            <select
              className={styles.select}
              aria-label="Plot"
              value={plot}
              disabled={!catalogReady}
              onChange={(e) =>
                selectPlot(plotOptions.find((p) => p.value === e.target.value))
              }
            >
              {plotOptions.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Condition</span>
          <select
            className={styles.select}
            aria-label="Condition"
            value={condition}
            disabled={!catalogReady}
            onChange={(e) => setCondition(e.target.value)}
          >
            {conditionOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {needsThreshold && (
          <div className={styles.row}>
            <span className={styles.label}>Threshold</span>
            <input
              className={styles.input}
              type="number"
              step="any"
              aria-label="Threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="e.g. 70"
            />
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Timeframe</span>
          <select
            className={styles.select}
            aria-label="Timeframe"
            value={tf}
            onChange={(e) => setTf(e.target.value)}
          >
            {TFS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className={styles.addBtn}
          disabled={!ownSym || submitting || !catalogReady || !plot || (needsThreshold && !threshold)}
        >
          {submitting ? 'Adding…' : 'Add Alert'}
        </button>
      </form>

      <div className={styles.listHeader}>
        Active alerts {ownSym ? `for ${ownSym}` : ''} ({symAlerts.length})
      </div>

      <div className={styles.list}>
        {symAlerts.length === 0 ? (
          <div className={styles.empty}>
            {ownSym ? 'No alerts on this symbol yet.' : 'Select a symbol to manage alerts.'}
          </div>
        ) : (
          symAlerts.map((a) => {
            const trigAt = fmtTriggeredAt(a.triggered_at)
            const indLbl = labelForAlert(a)
            const condLbl = conditionLabelForAlert(a)
            const thrTxt =
              a.threshold !== null && a.threshold !== undefined ? ` @ ${a.threshold}` : ''
            // ⭐ THE ROW NOTHING USED TO REPORT. A stored alert naming something
            // the evaluator has no value function for is accepted by the API and
            // silently never fires. Only assertable once the catalog has
            // ACTUALLY arrived — while it is loading every row would look dead.
            const cannotFire = catalogReady && !byAddress.has(a.indicator)
            return (
              <div
                key={a.id}
                className={`${styles.alertRow} ${!a.active ? styles.inactive : ''} ${
                  trigAt ? styles.triggered : ''
                }`}
              >
                <div className={styles.alertMain}>
                  <div className={styles.alertText}>
                    {indLbl} {condLbl}
                    {thrTxt} · {a.tf}
                  </div>
                  <div className={styles.alertSub}>
                    {cannotFire && (
                      <span className={styles.cannotFire}>
                        Cannot fire — this alert type is no longer evaluated
                      </span>
                    )}
                    {trigAt && (
                      <>
                        <span className={styles.trigCheck}><UIcon name="check" size={13} /></span>
                        <span>Triggered {trigAt}</span>
                      </>
                    )}
                    {!trigAt && a.last_value !== null && a.last_value !== undefined && (
                      <span>last: {Number(a.last_value).toFixed(2)}</span>
                    )}
                    {a.trigger_count > 0 && <span>· {a.trigger_count}×</span>}
                  </div>
                </div>
                <button
                  className={`${styles.toggle} ${a.active ? styles.on : ''}`}
                  onClick={() => toggleIndicatorAlert(a.id)}
                  title={a.active ? 'Disable' : 'Enable'}
                >
                  {a.active ? 'ON' : 'OFF'}
                </button>
                <button
                  className={styles.remove}
                  onClick={() => deleteIndicatorAlert(a.id)}
                  title="Delete alert"
                  aria-label="Delete alert"
                >
                  ×
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

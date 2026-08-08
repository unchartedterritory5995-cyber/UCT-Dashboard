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
  fetchCurrentValue,
} from '../../hooks/useIndicatorAlerts'
import { formatET } from '../../utils/timeAgo'
import { instancesForAddress } from './engine/alertSets'
import { NATIVE_TFS, tfLabel } from './timeframes'
import UIcon from '../ui/UIcon'

// Timeframes are NOT an indicator list — they are the bar sizes the evaluator
// reads from `bars_sqlite`. But they are not a list to write down HERE either.
//
// ⛔ THIS USED TO HAND-WRITE FIVE — 5/15/30/60/D — while the chart drew eight,
// so a user on a WEEKLY chart could not set an alert on what they were looking
// at, and neither could one on a 1-minute chart. A hand-typed eighth list would
// have been a fourth place the timeframe vocabulary can drift, so both the codes
// and their labels come from `timeframes.js`, the module the chart's own
// timeframe bar and menu read.
//
// ⚠️ ONLY THE NATIVE CODES. `TF_MENU` also offers CUSTOM codes (2m, 45m, 3D…)
// which exist only as a CLIENT-SIDE RESAMPLE of a native base — `/api/bars`
// never serves them and `bars_sqlite` never stores them, so the evaluator would
// read an empty column forever. `_TF_SECONDS` in `api/routers/indicator_alerts.py`
// is the alert path's own enumeration and carries exactly these eight; the test
// asserts the two are the same SET rather than trusting this comment.
const TFS = NATIVE_TFS.map((value) => ({ value, label: tfLabel(value) }))

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

// ─── THE LIFECYCLE STATES A USER HAS TO BE TOLD ABOUT ───────────────────────
//
// ⭐ `sweep_silent_alerts` (api/services/indicator_alert_service.py:1358) runs
// in production every five minutes, DIAGNOSES an alert that has gone quiet, and
// writes `state='needs_attention'` with a `state_detail` sentence naming the
// cause — missing tzdata, no stored bars, an address that resolves to nothing.
// Both fields have been served by `_row_to_dict` since Task 11 and NO FRONTEND
// MODULE READ EITHER ONE, so a broken alert rendered byte-identically to a
// healthy one that simply had not triggered.
//
// 🔴 AND IT IS LOAD-BEARING FOR A DECISION MADE TODAY: `ichimoku.chikou` alerts
// can never fire on a closed bar and the ruling was that they stay ACTIVE and
// "surface as `needs_attention` with a `state_detail`". With nothing rendering
// the pair, that ruling produces a silent death with a database column.
//
// ⛔ ONLY THE FAULT STATES. `state_detail` is NOT a fault marker on its own —
// `rearm` writes one under `armed` ("re-armed by …") and `snooze` writes
// "snoozed for 60 min" under `snoozed`. Rendering every detail as an error line
// would report a snooze the user just asked for as a broken alert. The two
// members below are `STATE_NEEDS_ATTENTION` and `STATE_ERROR`; that they still
// spell these exact strings is asserted against the service's own source, so
// this cannot rot into silence the way the missing read did.
const ATTENTION_STATES = new Set(['needs_attention', 'error'])

/**
 * @param {object} [initial] `{instanceId, plotKey}` — the legend chip this
 *   popover was opened from (chart-UX-walls Task 4). ONE prop, and it is the
 *   whole difference between "Add alert on MACD" opening a MACD form and opening
 *   whatever the catalog happens to list first. Absent ⇒ byte-identical
 *   behaviour to before it existed.
 * @param {string|null} [chartId] ⭐ PHASE C TASK 12 — the surface's own stable
 *   chart id (a `/charts` widget slot, a Multi-Chart grid cell). It is what
 *   makes the listing request carry `?scope=`, and what a "this chart only"
 *   alert is scoped TO. Absent ⇒ the unscoped listing and no scope control,
 *   which is exactly what every mount site had before a producer existed.
 */
export default function IndicatorAlertPopover({
  sym, onClose, chartInstances = [], initial = null, chartId = null,
}) {
  const ownSym = sym ? String(sym).toUpperCase() : ''
  // ⭐ THE CHART ID REACHES THE REQUEST. `useIndicatorAlerts` turns it into
  // `GET /api/indicator-alerts?scope=<chartId>` — the parameter the backend has
  // implemented since Task 12 and that no client had ever sent.
  const { alerts } = useIndicatorAlerts(chartId)
  const { catalog, isLoading: catalogLoading, error: catalogError } = useIndicatorAlertCatalog()

  const [indicator, setIndicator] = useState('')
  const [plot, setPlot] = useState('')
  const [condition, setCondition] = useState('')
  const [threshold, setThreshold] = useState('')
  // ⭐ SPEC §8 — WHICH INSTANCE. `{period: 7}` vs `{period: 14}` is what makes
  // "RSI(7) crossed 70" a different alert from "RSI(14)". Until this existed
  // the popover sent NO params at all, so every alert a user could create was
  // on the default instance and the spec's two sentences were unrepresentable.
  // The shape comes from the served plot's `inputs`, never from a list here.
  const [params, setParams] = useState({})
  // ⭐ SPEC §8, THE OTHER HALF — WHICH CHART INSTANCE. Task 10 shipped the
  // column and the deletion guard with no producer; this is it. The list comes
  // from the chart that mounted this popover, the match is derived
  // (`instancesForAddress`), and an address that names no definition yields
  // NOTHING rather than a plausible wrong id.
  const [instanceId, setInstanceId] = useState('')
  // ⭐ PHASE C TASK 12 — WHICH CHART. Unchecked is GLOBAL, and that default is
  // the migration: every alert that exists carries `scope = NULL`, which the
  // server reads as "on every chart", so an unchecked box creates exactly the
  // row this popover has always created. Only offered when the mount site
  // actually supplies a chart id — a "this chart only" box on a surface with no
  // chart identity would scope an alert to nothing.
  const [chartOnly, setChartOnly] = useState(false)
  const [tf, setTf] = useState('D')
  const [submitting, setSubmitting] = useState(false)
  // ⭐ WHY THE LAST ATTEMPT WAS REFUSED — the server's own sentence, held so it
  // can be rendered. The create path writes three of them (the price-alias
  // routing message, "not an indicator this chart can evaluate", and
  // `refusal_for`'s "this could never fire" gates) and until this existed every
  // one of them was discarded by `createIndicatorAlert` and the user saw the
  // button flicker.
  const [submitError, setSubmitError] = useState(null)
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

  /** The instances THIS chart draws for the selected address, derived — see
   *  `alertSets.instancesForAddress`. `[]` for an address that names no
   *  definition (`price_vs_ma`, `close`), which is the honest answer. */
  const addressInstances = useMemo(
    () => instancesForAddress(chartInstances, plot),
    [chartInstances, plot],
  )

  // ⛔ THE SELECTION MUST STAY LEGAL, AND A DEFAULT IS ONLY OFFERED WHEN THERE
  // IS NOTHING TO CHOOSE. One instance means the answer is not ambiguous, so it
  // is adopted; two or more means the user has to say which RSI they mean, and
  // guessing would attach the alert to an instance nobody picked. Zero clears
  // it, so switching to `close` cannot carry the previous plot's instance id.
  useEffect(() => {
    setInstanceId((prev) => {
      if (addressInstances.length === 1) return addressInstances[0].instanceId
      if (prev && addressInstances.some((i) => i.instanceId === prev)) return prev
      return ''
    })
  }, [addressInstances])

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
    setParams({ ...(p.inputs || {}) })
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

  /** The served ADDRESS this popover was opened ON, when it was opened from a
   *  legend chip (`initial = {instanceId, plotKey}`), else ''.
   *
   *  ⛔ DERIVED THROUGH `instancesForAddress`, NOT THROUGH A SECOND BRIDGE. The
   *  caller knows a definition (`williamsR`) and this file knows an address
   *  (`williams_r`); `alertSets` measured the naive `address === defId` map as a
   *  LIE for exactly that pair and solved it in ONE direction only. So the search
   *  runs that shipped, tested bridge FORWARDS over every served address and asks
   *  which one owns the instance the chip named — no new mapping, and an address
   *  that names no definition (`close`, `price_vs_ma`) simply never matches.
   *
   *  The chip's PLOT breaks the tie: a MACD signal chip opens on `macd.signal`
   *  rather than on `macd`, because `ichimoku` alone names five different series
   *  and picking the first would be a guess with a tick beside it. */
  const initialAddress = useMemo(() => {
    const wantInstance = initial && initial.instanceId
    if (!wantInstance || !catalog.length) return ''
    const owning = [...byAddress.keys()].filter((addr) =>
      instancesForAddress(chartInstances, addr).some((i) => i.instanceId === wantInstance))
    if (!owning.length) return ''
    const suffix = initial.plotKey ? `.${initial.plotKey}` : null
    return (suffix && owning.find((a) => a.endsWith(suffix))) || owning[0]
  }, [initial, catalog, byAddress, chartInstances])

  // Seed (and re-seed) from whatever the server actually offers. While the
  // catalog is empty — loading, or failed — `indicator` stays '' and the form
  // has nothing to submit, which is the intended state, not a bug to paper over.
  //
  // ⭐ …AND FROM THE CHIP THAT OPENED IT, WHEN THERE WAS ONE (chart-UX-walls
  // Task 4). "Add alert…" on the MACD chip opening an RSI form is the row that
  // looks live and is not; `initialAddress` is resolved through the catalog, so a
  // chip whose definition the evaluator cannot evaluate falls back to
  // `catalog[0]` exactly as before rather than seeding something unsubmittable.
  useEffect(() => {
    if (!catalog.length) return
    if (byIndicator.has(indicator)) return
    if (initialAddress) {
      const entry = catalog.find((e) => plotsOf(e).some((p) => p.value === initialAddress))
      const plot = entry && plotsOf(entry).find((p) => p.value === initialAddress)
      if (entry && plot) {
        setIndicator(entry.indicator)
        selectPlot(plot)
        if (initial && initial.instanceId) setInstanceId(initial.instanceId)
        return
      }
    }
    selectEntry(catalog[0])
  }, [catalog, byIndicator, indicator, selectEntry, selectPlot, initialAddress, initial])

  const conditionEntry = conditionOptions.find((c) => c.value === condition) || null
  const needsThreshold = !!conditionEntry?.needs_threshold
  const catalogReady = !catalogLoading && !catalogError && catalog.length > 0
  const inputKeys = useMemo(
    () => Object.keys(plotEntry?.inputs || {}),
    [plotEntry],
  )

  // ⭐ SPEC §8: "threshold prefilled from current value".
  //
  // ⛔ ONLY WHERE THE CATALOG DECLARES NO DEFAULT, AND THAT LINE IS THE WHOLE
  // DESIGN. The declared defaults are CONVENTIONAL LEVELS — RSI 70, ADX 25,
  // Stochastic 80 — and replacing "70" with "RSI is 43.2 right now" would
  // remove the meaning from the box. Every address WITHOUT one is price-scale
  // (vwap, atr, the bands, every Ichimoku line, `close`), where no default is
  // possible without knowing the symbol, and those are exactly the ones that
  // render an empty box today. So the prefill fills the empty boxes and touches
  // nothing else.
  //
  // ⚠️ It also never overwrites what the user has typed: the effect only writes
  // when the field is still empty at the moment the value lands.
  useEffect(() => {
    if (!plot || !ownSym || !needsThreshold) return
    if (plotEntry?.default_threshold !== null
        && plotEntry?.default_threshold !== undefined) return
    let live = true
    fetchCurrentValue({ sym: ownSym, tf, indicator: plot, params }).then((v) => {
      if (!live || v === null) return
      setThreshold((current) => (current === ''
        ? String(Number(v.toFixed(4)))
        : current))
    })
    return () => { live = false }
  }, [plot, plotEntry, ownSym, tf, needsThreshold, params])

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
    // The INSTANCE this alert names. Sent verbatim so the stored row records
    // which one it was armed on, rather than inheriting whatever the compute
    // default happens to be on the day it fires.
    if (inputKeys.length) payload.params = params
    // ⚠️ ONLY WHEN THERE IS ONE TO NAME. An absent `instance_id` is what every
    // legacy row has and it is never reported as orphaned, so an unnamed alert
    // behaves exactly as it did before this producer existed. `params_json` is
    // still the truth the evaluator reads — the id says which instance it was
    // armed FROM, so that deleting that instance can be reported.
    if (instanceId) payload.instance_id = instanceId
    // ⚠️ ONLY WHEN THE USER ASKED FOR IT. An omitted `scope` is GLOBAL on the
    // server (`_clean_scope` stores NULL), so the unchecked path is the shape
    // every existing row has and the shape every previous client sent.
    if (chartOnly && chartId) payload.scope = chartId
    if (needsThreshold) {
      const num = parseFloat(threshold)
      if (!Number.isFinite(num)) return
      payload.threshold = num
    }
    setSubmitting(true)
    try {
      const res = await createIndicatorAlert(payload)
      // ⛔ WHAT THE SERVER SAID, NOT A RESTATEMENT OF IT. Paraphrasing a refusal
      // here would be a second source of truth for one decision, and the two rot
      // apart the first time a gate is reworded. `createIndicatorAlert` is
      // contracted never to answer null, so `.ok` is read unconditionally.
      setSubmitError(res.ok ? null : res.error)
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

        {/* The instance's knobs. Rendered from the SERVED plot's `inputs`, so
            this cannot offer a parameter the compute ignores and cannot miss
            one it gained — the two failure modes a hand-written map has. */}
        {inputKeys.map((key) => (
          <div className={styles.row} key={key}>
            <span className={styles.label}>{key}</span>
            <input
              className={styles.input}
              type={typeof plotEntry.inputs[key] === 'number' ? 'number' : 'text'}
              step="any"
              aria-label={`${key} input`}
              value={params[key] ?? ''}
              disabled={!catalogReady}
              onChange={(e) => {
                const raw = e.target.value
                setParams((prev) => ({
                  ...prev,
                  [key]: typeof plotEntry.inputs[key] === 'number'
                    ? (raw === '' ? '' : Number(raw))
                    : raw,
                }))
              }}
            />
          </div>
        ))}

        {/* ⭐ WHICH INSTANCE. Rendered ONLY when this chart draws more than one
            of the selected indicator — "RSI(7) crossed 70" and "RSI(14) crossed
            70" are different alerts (spec §8) and only the user knows which one
            they are looking at. One instance is adopted silently; none leaves
            the field absent, which is what every alert created before this
            producer existed carries. */}
        {addressInstances.length > 1 && (
          <div className={styles.row}>
            <span className={styles.label}>Instance</span>
            <select
              className={styles.select}
              aria-label="Instance"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
            >
              {addressInstances.map((i) => (
                <option key={i.instanceId} value={i.instanceId}>
                  {Object.keys(i.inputs || {}).length
                    ? Object.entries(i.inputs).map(([k, v]) => `${k} ${v}`).join(' · ')
                    : 'defaults'}
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

        {/* ⭐ WHICH CHART THIS ALERT BELONGS TO (spec §5 / Task 12). Rendered
            only where a chart id exists, unchecked by default, so a surface
            that supplies none — and a user who leaves it alone — creates the
            GLOBAL alert this popover has always created. */}
        {chartId && (
          <label className={styles.scopeRow}>
            <input
              type="checkbox"
              checked={chartOnly}
              aria-label="Only on this chart"
              onChange={(e) => setChartOnly(e.target.checked)}
            />
            <span>Only on this chart</span>
          </label>
        )}

        {/* ⭐ WHY THE LAST ATTEMPT WAS REFUSED, immediately above the button
            that was pressed. Rendered verbatim — the create path's 400s explain
            themselves ("a live price alert belongs to the watchlist alert
            lane", "VWAP is only defined on an intraday timeframe… arm it on one
            of 1, 15, 30, 5, 60") and a paraphrase would be a second, rotting
            copy of the same refusal. */}
        {submitError && (
          <div className={styles.catalogError} role="alert">
            {submitError}
          </div>
        )}

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
            // ⭐ SPEC §8: the ROW NAMES THE INSTANCE. `instance_label` is
            // computed server-side from this row's own `params_json` by the
            // module that evaluates it, so the name a user reads and the number
            // that fired come from the same field. The catalog label remains
            // the fallback for a row served before this shipped.
            const indLbl = a.instance_label || labelForAlert(a)
            const condLbl = conditionLabelForAlert(a)
            const thrTxt =
              a.threshold !== null && a.threshold !== undefined ? ` @ ${a.threshold}` : ''
            // ⭐ THE ROW NOTHING USED TO REPORT. A stored alert naming something
            // the evaluator has no value function for is accepted by the API and
            // silently never fires. Only assertable once the catalog has
            // ACTUALLY arrived — while it is loading every row would look dead.
            const cannotFire = catalogReady && !byAddress.has(a.indicator)
            // ⭐ THE LIFECYCLE STATE THE SWEEP WRITES. See `ATTENTION_STATES`.
            // Unlike `cannotFire` this needs NO catalog: the server has already
            // decided, and it says why.
            const needsAttention = ATTENTION_STATES.has(a.state)
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
                    {/* ⭐ SPEC §6/§8, THE DELETION GUARD FROM THE OTHER SIDE.
                        The indicator this alert was armed from is gone from the
                        chart. The alert is NOT dead — it keeps evaluating from
                        the inputs it recorded — and saying so is the whole
                        point: an orphaned binding used to be invisible. */}
                    {a.instance_missing && (
                      <span className={styles.cannotFire}>
                        The chart indicator this alert was armed from was removed
                        — still watching {indLbl}
                      </span>
                    )}
                    {/* ⭐ THE SERVER'S OWN DIAGNOSIS, VERBATIM. `state_detail`
                        is written by `sweep_silent_alerts` after it re-runs the
                        compute and names the cause; a paraphrase here would be
                        a second, rotting copy of a sentence the server already
                        wrote for this exact row. The fallback names the STATE
                        rather than guessing a cause — a fault with no recorded
                        detail is still a fault the member must be told about. */}
                    {needsAttention && (
                      <span
                        className={styles.needsAttention}
                        data-testid="alert-state-detail"
                        data-state={a.state}
                      >
                        {a.state_detail || `This alert is not firing (${a.state}).`}
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

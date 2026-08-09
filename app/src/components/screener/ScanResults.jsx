// app/src/components/screener/ScanResults.jsx
//
// ─── SCAN → CHART, IN ONE CLICK (AMENDMENT 2 §A2.2) ─────────────────────────
//
// ⭐ SCAN → CHART, AND IT CARRIES THE DEFINITION (E9-A1).
// A2.2: TC2000's strongest habit-forming loop is scan → chart → back, and the
// claim "the formula you charted is the scan you ran" is only believable when a
// member SEES it — the same definition drawn on the chart of a symbol the scan
// returned.
//
// ⛔ NOT A NEW CHART MODE. The chart already installs `ast` definitions (Phase D
// Task 16 — `nativeRegistry.installUserDefinitions` + `instanceControls.addInstance`,
// the two doors `BuilderSheet` uses on save); this hands it the one the scan ran,
// by hash. Nothing about `StockChart` or `ChartPane` moved for this file.
//
// ⛔ THE BUTTON CARRIES THE DEFINITION, NEVER JUST THE TICKER. Handing over only
// the symbol makes the two surfaces agree by COINCIDENCE: the chart would draw
// whatever the member last had on it and the product claim — "the formula you
// charted is the scan you ran" — becomes unverifiable at exactly the moment it is
// being demonstrated. `ScanResultRow`'s `onChart` therefore takes `{ticker,
// definition}` and `ScanToChart.wire.test.jsx` is the only case that can see it.
//
// ⛔ AND `data-definition` IS RE-DERIVED FROM THE TREE, NOT COPIED OFF THE
// DOCUMENT. `def_hash` IS `astHash(compute.ast)` IS `compute.fn` — the tree is
// the implementation, so there is no third thing for the handle to name. Reading
// `compute.fn` here would publish a FIELD; hashing the tree the chart is about to
// resolve publishes the MATHS. The two are equal by `defSchema.validateAstCompute`,
// which is exactly why re-deriving costs nothing and catches a document whose
// field and tree ever disagree.
//
// ⛔ THE CONDITION IS THE TREE'S READ-BACK, NEVER THE STORED `source` TEXT.
// D-A5's reason on a new surface: `compute.source` is what a member TYPED and
// `sentenceFor(compute.ast)` is what the engine will RUN. Showing the first
// beside a chart drawn from the second is two descriptions of one tree, and the
// member is being asked to trust the one that is not running. This renders what
// `sentence.js` returns and adds not one word of its own — the same refusal
// `BuilderSheet` makes about the read-back it shows on save.
//
// ⛔ AN INSTALL THAT REFUSES OPENS NO CHART. `installUserDefinitions` re-lints,
// re-budgets and re-checks the lane every time (a stored verdict goes stale), so
// a formula that was legal the day it was written can stop being drawable. The
// honest outcome is that the chart does not open and the refusal is shown —
// never a chart carrying the symbol and quietly missing the formula, which is
// the "chart this ticker" degrade this whole file exists to make impossible.
//
// ⛔ A DROPPED OR NOT-COMPUTABLE SYMBOL IS NOT A HIT AND GETS NO BUTTON. E-3's
// envelope has FOUR outcomes; only `tickers` are symbols the screen actually
// ANSWERED true for. Offering a chart from `dropped_symbols` would imply we had
// the data to answer, which is the one reading the four-bucket receipt exists to
// keep impossible.
//
// ⚠️ THE PAYLOAD SHAPE IS THE SHIPPED ROUTE'S. `GET /api/scans/definition-results`
// (E-4, `api/routers/scan_results.py`) answers `{def_hash, tf, as_of, status,
// coverage, tickers, truncated}` — `tickers`, a list of strings. The E-9 brief's
// sketch reads `rows: [{ticker}]`; the SHIPPED endpoint is the authority and the
// deviation is recorded in the task report rather than reconciled by accepting
// both, which would be two wire vocabularies for one answer.
//
// ⚠️ `status: "not-run"` IS "NOBODY LOOKED", NOT "NO MATCHES" (E6-A2). The route
// answers `coverage: null` for a window that was never swept or has been pruned,
// and this renders that in words rather than as an empty list — an unrun screen
// presented as a quiet market is a lie a member would act on.

import { useCallback, useEffect, useMemo, useState } from 'react'
import UIcon from '../ui/UIcon'
import CoverageLine from './CoverageLine'
import ChartPane from '../chart/pane/ChartPane'
import { astHash } from '../chart/engine/ast/parse'
import { sentenceFor } from '../chart/engine/ast/sentence'
import { declaredInputs } from '../chart/engine/ast/lint'
import * as engineRegistry from '../chart/engine/nativeRegistry'
import { installUserDefinitions } from '../chart/engine/nativeRegistry'
import { addInstance } from '../chart/engine/instanceControls'
import styles from './ScanResults.module.css'

/** The route E-4 registered. Spelled once, and the query builder below is the
 *  only thing that spells its parameter names. */
export const RESULTS_ENDPOINT = '/api/scans/definition-results'

/** ⛔ EVERY VALUE IS ENCODED. A `def_hash` is `sha256:` + 64 hex today, but the
 *  colon is already a character a query string has an opinion about, and a
 *  surface that concatenates raw is one rename away from a broken read. */
export function scanResultsUrl(defHash, tf, asOf) {
  return `${RESULTS_ENDPOINT}?def_hash=${encodeURIComponent(defHash)}`
    + `&tf=${encodeURIComponent(tf)}&as_of=${encodeURIComponent(asOf)}`
}

/**
 * ONE HIT, AND THE BUTTON THAT CHARTS IT WITH THE DEFINITION THAT FOUND IT.
 *
 * ⚠️ The accessible name is `Chart {TICKER}` rather than a bare "Chart": a list
 * of twenty identical buttons is unusable with a screen reader and untestable by
 * role, and `getByRole('button', {name: /chart NVDA/i})` is what the wire-cut
 * case binds to.
 */
export function ScanResultRow({ ticker, definition, onChart }) {
  return (
    <li className={styles.row} data-testid={`scan-hit-${ticker}`}>
      <span className={styles.ticker}>{ticker}</span>
      <button
        type="button"
        className={styles.chartBtn}
        aria-label={`Chart ${ticker}`}
        // ⭐ E9-A1 — BOTH, ALWAYS. The ticker says WHICH symbol; the definition
        // says WHICH FORMULA the chart must draw beside it. Dropping the second
        // argument is mutation M1 and it is the only reason this handler takes
        // an object rather than a string.
        onClick={() => onChart({ ticker, definition })}
      >
        <UIcon name="chart" size={13} />
        <span className={styles.chartBtnLabel}>Chart</span>
      </button>
    </li>
  )
}

/**
 * The scan-result surface: the receipt, the hits, and the chart one click away.
 *
 * @param {object}  props.definition  the saved `ast` document the scan ran —
 *        the SAME object the builder wrote, the store holds and the alert lane
 *        arms on. Not an id, not a hash: the thing itself.
 * @param {string|number} props.asOf  the session whose receipt to read.
 * @param {string}  props.tf          the bars-store timeframe CODE (`D`).
 */
export default function ScanResults({ definition, asOf, tf = 'D' }) {
  const defHash = definition && definition.compute ? definition.compute.fn : null

  const [payload, setPayload] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [charted, setCharted] = useState(null)
  const [refusal, setRefusal] = useState(null)
  // This surface's OWN chart settings. `stored` + `onStore` is ChartPane's
  // "isolated surface" contract — the alternative (stored=null, no onStore)
  // resolves the member's /charts widget settings, and adding a scan's formula
  // to those would put an instance on the member's real chart from a panel they
  // opened to look at a list.
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    if (!defHash || asOf === null || asOf === undefined || asOf === '') return undefined
    let alive = true
    setPayload(null)
    setLoadError(null)
    // 🔴 THE OPEN CHART BELONGS TO THE ANSWER SET THAT IS BEING REPLACED, so it
    // goes with it. Without this, switching screens leaves the PREVIOUS
    // definition drawn — and its read-back sentence — beside the NEW screen's
    // hits: a chart claiming a formula that did not return the symbols on screen,
    // which is the exact falsehood this surface exists to make impossible. The
    // same argument covers a change of session: the charted symbol was a hit for
    // the session that is no longer being asked about.
    setCharted(null)
    setRefusal(null)
    fetch(scanResultsUrl(defHash, tf, asOf), { credentials: 'include' })
      .then((r) => {
        // ⚠️ A NON-OK ANSWER IS REPORTED, NOT RENDERED AS EMPTY. A swallowed 402
        // reads exactly like "this screen found nothing", and the difference is
        // whether the member should be looking at a paywall.
        if (!r.ok) throw new Error(`definition-results ${r.status}`)
        return r.json()
      })
      .then((body) => { if (alive) setPayload(body) })
      .catch((err) => { if (alive) setLoadError(String((err && err.message) || err)) })
    return () => { alive = false }
  }, [defHash, tf, asOf])

  const chartHit = useCallback(({ ticker, definition: doc }) => {
    setRefusal(null)
    if (!doc || typeof doc !== 'object') {
      // The M1 state, and it is a REFUSAL rather than a degrade. A chart opened
      // with the symbol and without the formula is the coincidence this surface
      // exists to rule out.
      setCharted(null)
      setRefusal('This result arrived without its definition, so there is nothing '
        + 'to draw beside the symbol — charting it would show a price and imply a '
        + 'formula that is not there.')
      return
    }
    const { installed, errors } = installUserDefinitions([doc])
    if (installed.length !== 1) {
      setCharted(null)
      setRefusal(errors.join('\n')
        || 'This formula could not be added to the chart.')
      return
    }
    const live = installed[0]
    let hash
    try {
      hash = astHash(live.compute.ast)
    } catch (err) {
      setCharted(null)
      setRefusal(`This formula's tree could not be named (${String((err && err.message) || err)}).`)
      return
    }
    // ⛔ THROUGH `addInstance`, THE ONE CONTROL DOOR — the same one the builder
    // and the indicator library use. A hand-built instance object is a second
    // shape of instance, and `normalizeInstances` reports that by making the
    // series disappear on the next paint.
    setSettings((prev) => addInstance(prev || {}, live.id, engineRegistry))
    setCharted({ ticker, definition: live, defHash: hash })
  }, [])

  const condition = useMemo(() => {
    if (!charted) return null
    try {
      return sentenceFor(charted.definition.compute.ast,
        declaredInputs(charted.definition))
    } catch {
      // ⛔ NOT A FALLBACK TO `compute.source`. A read-back this surface cannot
      // derive is reported as one; substituting the typed text would put the
      // second description of the tree on screen precisely when the first one
      // failed.
      return null
    }
  }, [charted])

  const status = payload && payload.status
  const tickers = payload && Array.isArray(payload.tickers) ? payload.tickers : []

  return (
    <div className={styles.wrap}>
      {loadError && (
        <p className={styles.error} role="alert" data-testid="scan-results-error">
          <UIcon name="warning" size={14} />
          This screen&rsquo;s results could not be read ({loadError}).
        </p>
      )}

      {status === 'not-run' && (
        <p className={styles.notRun} role="status" data-testid="scan-results-not-run">
          <UIcon name="clock" size={14} />
          Nobody has run this screen for that session yet — that is not the same
          {' '}as a session where nothing matched.
        </p>
      )}

      {status === 'evaluated' && <CoverageLine coverage={payload.coverage} />}

      {status === 'evaluated' && tickers.length > 0 && (
        <ul className={styles.hits} data-testid="scan-hits">
          {tickers.map((ticker) => (
            <ScanResultRow
              key={ticker}
              ticker={ticker}
              definition={definition}
              onChart={chartHit}
            />
          ))}
        </ul>
      )}

      {status === 'evaluated' && tickers.length === 0 && (
        // ⛔ "NO MATCHES" IS SAID IN WORDS, and it is the OTHER half of
        // `CoverageLine`'s pair. That component deliberately refuses to brand an
        // empty screen at full coverage a data outage — which presumes something
        // else says "nothing matched". Without this line a member sees counts and
        // an empty space, and an empty space reads as "still loading".
        <p className={styles.notRun} role="status" data-testid="scan-results-empty">
          <UIcon name="check" size={14} />
          This screen ran and no symbol matched.
        </p>
      )}

      {refusal && (
        <p className={styles.error} role="alert" data-testid="scan-chart-refused">
          <UIcon name="warning" size={14} />
          {refusal}
        </p>
      )}

      {charted && (
        <div
          className={styles.pane}
          data-testid="chart-pane"
          data-symbol={charted.ticker}
          data-definition={charted.defHash}
        >
          {condition ? (
            <p className={styles.condition} data-testid="chart-scan-condition">
              {condition}
            </p>
          ) : (
            <p className={styles.condition} role="alert" data-testid="chart-scan-condition-refused">
              This screen&rsquo;s condition could not be read back from its own tree.
            </p>
          )}
          <ChartPane
            sym={charted.ticker}
            tf={tf}
            density="compact"
            stored={settings}
            onStore={setSettings}
          />
        </div>
      )}
    </div>
  )
}

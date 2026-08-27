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
//
// ⭐ `payload` (W4a): a caller that already HOLDS an answer set — the on-demand
// run, whose hits came back on `GET /api/scans/run/{job}` rather than from this
// route — hands it in and no fetch happens. The shape is the route's own;
// `toScanResultsPayload` in `RunNowButton.jsx` derives `tickers` from the job's
// `hits` and forwards the receipt whole. ⛔ ONE MOUNT FOR BOTH ANSWERS: the
// nightly receipt and the on-demand one render through the same code path, so
// `CoverageLine` keeps exactly one door into the app (the planted-cut control in
// `reachable.test.js`) and the two surfaces cannot drift apart.
//
// ⭐ AND THE LIVE-ONLY TAIL IS RENDERED, NOT DISCARDED (X43).
// `api/routers/scan_results.py` builds `hits` as the nightly page PLUS every
// fresh live row the nightly scan did NOT return (`in_nightly: false`), bounds
// it by the same page limit and reports the cut under `truncated`. Until now
// this surface iterated `tickers` — which that route derives from the nightly
// half alone — so the tail was assembled, capped and thrown away on every
// single request, for an audience of nobody.
//
// ⛔ WHICH IS WHY ARMING THE LIVE SWEEP WOULD HAVE LOOKED LIKE A NO-OP. A6 says
// a scan runs the full universe nightly AND every five minutes in session, and
// that "a member sees live vs nightly per hit". `SCAN_LIVE_SWEEP_ENABLED` is
// unset today, so `scan_hits_live` is empty, so the tail is empty — the surface
// is byte-identical either way. The day that variable is set the tail fills up
// and, before this, still rendered nothing: the "built, flagged, scheduled and
// writes nothing" failure this program has already hit twice. That is the whole
// reason the option taken here is RENDER rather than STOP ASSEMBLING.
//
// ⛔ AND A LIVE-ONLY HIT IS NOT MIXED INTO THE NIGHTLY LIST. The two sets answer
// DIFFERENT questions — this tick's forming bar vs. that session's closed bar —
// so they are two blocks under a line that says which is which, and each row's
// own chip says it a second time for a reader who meets one row out of context.

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
import Sheet from '../mobile/Sheet'
import EvidenceTab from '../chart/builder/EvidenceTab'
import { SESSION_TZ } from './scanSession'
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

/** ⛔ THE SESSION TIMEZONE IS `scanSession`'s, never typed here — and the
 *  locale is explicit for `CoverageLine`'s reason: an unqualified formatter
 *  answers a different string per member. */
const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: SESSION_TZ, hour: 'numeric', minute: '2-digit' })

/** The tick a live row was written at, as an ET clock time — or `null`.
 *
 *  ⛔ `typeof === 'number'` FIRST, NEVER `Number(v)`. `Number(null)`,
 *  `Number('')` and `Number(false)` are all `0`, which IS finite, so a
 *  Number()-based guard formats the Unix epoch into a confident-looking
 *  "7:00 PM ET" from 1969 and prints it beside a hit as if it were this
 *  morning. A stamp this surface cannot vouch for is not shown at all.
 */
function liveStamp(tick) {
  if (typeof tick !== 'number' || !Number.isFinite(tick) || tick <= 0) return null
  return ET_TIME.format(new Date(tick * 1000))
}

/** The chip for one hit's provenance, read off the route's OWN row.
 *
 *  ⚠️ MEASURED, NOT ASSUMED. `api/routers/scan_results.py` answers an
 *  evaluated session with `hits` — an ARRAY of rows shaped by
 *  `scan_store.hits_for`: `{symbol, tier, in_nightly, live_as_of, value,
 *  src_price, live_cols}`, `tier` one of `LIVE_TIERS = ("nightly", "live")`.
 *  There is NO `tiers` map on this payload and the tick is `live_as_of`, not
 *  `as_of`. Reading a shape this route does not speak would render a chip that
 *  is green in a fixture and absent for every member.
 *
 *  `null` for anything else: an unknown tier is not rendered as one we know.
 */
export function tierLabel(row) {
  if (!row || typeof row !== 'object') return null
  if (row.tier === 'live') {
    // ⭐ "ONLY" IS THE ROW'S SECOND FACT, and it is the one a member acts on
    // differently: `in_nightly: false` means the nightly scan did not return
    // this symbol at all, so the hit rests entirely on this tick's forming bar.
    // A live row that IS in the nightly set says plain "live".
    // ⛔ `=== false`, NEVER FALSY. A row the route sent no `in_nightly` for has
    // said nothing, and manufacturing "only" out of a missing key is exactly the
    // fabrication `hits_for` refuses one layer up.
    const only = row.in_nightly === false
    const at = liveStamp(row.live_as_of)
    if (at) return only ? `live only ${at} ET` : `live ${at} ET`
    return only ? 'live only' : 'live'
  }
  if (row.tier === 'nightly') return 'nightly'
  return null
}

/** The route's `hits` rows keyed by symbol. The route sends a LIST (its order is
 *  the page's) and this surface renders by ticker, so the keying happens here
 *  rather than asking the route for a second spelling of one answer. */
function hitsBySymbol(payload) {
  const rows = payload && Array.isArray(payload.hits) ? payload.hits : []
  const out = {}
  for (const row of rows) {
    if (row && typeof row.symbol === 'string') out[row.symbol] = row
  }
  return out
}

/**
 * ONE HIT, AND THE BUTTON THAT CHARTS IT WITH THE DEFINITION THAT FOUND IT.
 *
 * ⚠️ The accessible name is `Chart {TICKER}` rather than a bare "Chart": a list
 * of twenty identical buttons is unusable with a screen reader and untestable by
 * role, and `getByRole('button', {name: /chart NVDA/i})` is what the wire-cut
 * case binds to.
 */
export function ScanResultRow({ ticker, definition, onChart, tier = null }) {
  // ⭐ THE ROW SAYS WHERE IT CAME FROM. A live hit and a nightly hit answer
  // DIFFERENT questions — this tick's forming bar vs. that session's closed bar
  // — and `hits_for` already decided which; this renders that decision and adds
  // nothing to it. A row the route sent no provenance for gets NO chip: silence
  // is honest, and defaulting it to "nightly" would claim a fact nobody stated.
  const label = tierLabel(tier)
  return (
    <li className={styles.row} data-testid={`scan-hit-${ticker}`}>
      <span className={styles.tickerCell}>
        <span className={styles.ticker}>{ticker}</span>
        {label && <span className={styles.tier} data-testid={`scan-hit-tier-${ticker}`}>{label}</span>}
      </span>
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
 * @param {object|null} props.payload an answer set the CALLER already holds
 *        (W4a's on-demand run). Non-null means this surface fetches nothing.
 */
export default function ScanResults({ definition, asOf, tf = 'D', payload: given = null }) {
  const defHash = definition && definition.compute ? definition.compute.fn : null

  const [payload, setPayload] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [charted, setCharted] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  // This surface's OWN chart settings. `stored` + `onStore` is ChartPane's
  // "isolated surface" contract — the alternative (stored=null, no onStore)
  // resolves the member's /charts widget settings, and adding a scan's formula
  // to those would put an instance on the member's real chart from a panel they
  // opened to look at a list.
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    // ⭐ W4a — A PAYLOAD HANDED IN IS THE ANSWER SET, so nothing is fetched and
    // the open chart goes with the set it belonged to, exactly as a session
    // change does below. `ScreensManager` hands the on-demand run's payload here
    // so the receipt, the hits and the chart button are the SAME code path the
    // nightly answer uses — one mount, one door to `CoverageLine`.
    if (given) {
      setPayload(given)
      setLoadError(null)
      setCharted(null)
      setRefusal(null)
      // ⛔ AND THE OPEN EVIDENCE SHEET GOES WITH THE ANSWER SET TOO. It is a
      // receipt ABOUT the definition on screen; left open across a switch it
      // would show one screen's study over another screen's hits.
      setEvidenceOpen(false)
      return undefined
    }
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
    setEvidenceOpen(false)
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
  }, [defHash, tf, asOf, given])

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
  // Keyed ONCE per answer set, not per row: N rows x a linear scan of N hits is
  // the same N+1 shape `hits_for`'s own docstring warns about, one layer up.
  const provenance = useMemo(() => hitsBySymbol(payload), [payload])
  // ⭐ THE LIVE-ONLY TAIL, READ OFF THE ROUTE'S OWN ROWS. `tickers` is the
  // nightly half by construction, so these rows are exactly the hits the list
  // above can never show.
  // ⛔ `=== false`: the W4a on-demand payload carries `hits` rows with no
  // `in_nightly` key at all, and reading those as live-only would invent a
  // second block for an answer set that has no live half.
  const liveOnly = useMemo(() => {
    const rows = payload && Array.isArray(payload.hits) ? payload.hits : []
    return rows.filter((r) => r && typeof r.symbol === 'string' && r.in_nightly === false)
  }, [payload])
  const screenName = (definition && definition.meta && definition.meta.name)
    || (definition && definition.id) || ''

  return (
    <div className={styles.wrap}>
      {/* ⭐ EVERY AFFORDANCE IS TRUE OF THE DEFINITION IT SITS ON. Evidence keys
          on BOTH a hash (the receipt is bound to it) and a saved id (the study
          replays by id and the forward record is filed under one). A definition
          missing either can never have evidence — so it gets a NAMED SENTENCE
          rather than a button that does nothing, or worse, a silent gap beside a
          list of hits that leaves the member wondering what they did wrong. */}
      {definition && !defHash && (
        <p className={styles.notRun} role="status" data-testid="scan-evidence-no-hash">
          <UIcon name="warning" size={14} />
          This screen&rsquo;s formula carries no hash here, so a study receipt could not be
          {' '}checked against it — Evidence stays shut rather than binding a receipt to the
          {' '}wrong definition.
        </p>
      )}

      {definition && defHash && !definition.id && (
        <p className={styles.notRun} role="status" data-testid="scan-evidence-unsaved">
          <UIcon name="clock" size={14} />
          This screen has not been saved, so there is no forward record filed under it and
          {' '}nothing to replay by id. Save it and Evidence opens.
        </p>
      )}

      {definition && definition.id && defHash && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.chartBtn}
            data-testid="scan-evidence-open"
            aria-label={`Evidence for ${screenName}`}
            onClick={() => setEvidenceOpen(true)}
          >
            <UIcon name="equity" size={13} />
            <span className={styles.chartBtnLabel}>Evidence</span>
          </button>
        </div>
      )}

      {/* ⭐ THE SAME COMPONENT THE BUILDER MOUNTS, behind a Sheet: one door
          fewer to keep honest. No study is requested until a member asks for
          one, because `Sheet` returns null while closed (its own L120) and so
          never renders these children.

          ⚠️ WHICH MAKES THE `evidenceOpen &&` BELOW REDUNDANT TODAY, and it is
          recorded as such rather than described as a guard that fires: the
          W5a.6 sweep deleted it and all 32 tests stayed green (the lane's ONE
          survivor, named in the report). It is kept as the local statement of
          "this costs a paid backtest POST, so it mounts only when asked" — if
          Sheet ever renders closed children, this is what stops it. */}
      <Sheet
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        variant="auto"
        title={`Evidence — ${screenName}`}
        maxWidth={760}
      >
        {evidenceOpen && definition && (
          <EvidenceTab defId={definition.id} defHash={defHash} tf={tf} />
        )}
      </Sheet>

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
              tier={provenance[ticker] || null}
            />
          ))}
        </ul>
      )}

      {status === 'evaluated' && liveOnly.length > 0 && (
        // ⭐ THE BLOCK SAYS WHERE IT CAME FROM BEFORE THE FIRST ROW DOES. A
        // member scanning two lists must be able to tell them apart without
        // reading a badge on every line — and a live-only hit is a DIFFERENT
        // claim from a nightly one, not a stronger version of it.
        <p className={styles.liveOnly} role="status" data-testid="scan-live-only-note">
          <UIcon name="clock" size={14} />
          Found by the live sweep only — these matched on this session&rsquo;s forming bar and
          {' '}were not hits in the nightly scan.
        </p>
      )}

      {status === 'evaluated' && liveOnly.length > 0 && (
        <ul className={styles.hits} data-testid="scan-live-only-hits">
          {liveOnly.map((row) => (
            <ScanResultRow
              key={row.symbol}
              ticker={row.symbol}
              definition={definition}
              onChart={chartHit}
              // The row IS its own provenance here — it came off `hits`, not out
              // of a lookup keyed by a ticker this list does not carry.
              tier={row}
            />
          ))}
        </ul>
      )}

      {status === 'evaluated' && tickers.length === 0 && liveOnly.length === 0 && (
        // ⛔ "NO MATCHES" IS SAID IN WORDS, and it is the OTHER half of
        // `CoverageLine`'s pair. That component deliberately refuses to brand an
        // empty screen at full coverage a data outage — which presumes something
        // else says "nothing matched". Without this line a member sees counts and
        // an empty space, and an empty space reads as "still loading".
        //
        // ⛔ AND A LIVE-ONLY HIT IS A MATCH. Printing "no symbol matched" above a
        // block of live-only rows would be false on the face of one screen, so
        // the sentence waits for BOTH lists to be empty.
        <p className={styles.notRun} role="status" data-testid="scan-results-empty">
          <UIcon name="check" size={14} />
          This screen ran and no symbol matched.
        </p>
      )}

      {status === 'evaluated' && payload.truncated === true && (
        // ⛔ A CUT PAGE MUST SAY SO. The route sets this when the nightly page OR
        // the live-only tail was cut by the row cap; a short list that does not
        // admit it is the "looks like a quiet market" lie `CoverageLine` exists
        // to refuse, one list further down.
        //
        // ⚠️ AND IT IS THE PAGE'S WORD, NOT THE RECEIPT'S. `truncated` HERE means
        // "this page is short of the hits". `coverage.truncated` — a different
        // key, on a different object — means the DROPPED ENUMERATION was capped.
        // `RunNowButton.toScanResultsPayload` forwarded the second under the
        // first, and nothing rendered either, which is how the collision
        // survived; it is fixed there rather than papered over here.
        <p className={styles.notRun} role="status" data-testid="scan-results-truncated">
          <UIcon name="warning" size={14} />
          This page is short of the hits this screen found — a row cap cut it. The counts above
          {' '}are the authority on how many there were.
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

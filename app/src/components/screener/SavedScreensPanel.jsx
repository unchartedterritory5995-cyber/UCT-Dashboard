// app/src/components/screener/SavedScreensPanel.jsx
//
// ─── 🔴 THE MOUNT. THE ONLY REASON THIS FILE EXISTS ─────────────────────────
//
// `ScanResults` was built, tested and green, and **imported by nothing**;
// `CoverageLine` was imported only by `ScanResults`, so the four-outcome receipt
// spec §6.3 requires a screen to state could not be reached from any route a
// member can navigate to. E-4's own report called it *"exactly the shape the '8
// features green and unreachable' lesson warns about"* (concern 4) and named the
// debt: **whoever mounts it owes a wire-cut test, not another component test.**
// This is the mount; `app/src/pages/Screener.scanmount.test.jsx` is the test.
//
// ⛔ NOT A NEW PAGE. The brief for this fix forbids inventing a surface to hang
// the component on, and it would be the wrong answer anyway: `/screener` is
// already the Scanner Hub — the destination `NavBar` labels "Screener" and the
// place a member goes to run a screen. A definition scan IS a screen; it belongs
// beside the column screener, not on a URL nobody has a reason to type.
//
// ⛔ AND NOT INSIDE THE `/api/candidates` BRANCH. `Screener.jsx` guards its
// non-`scanner` tabs on the 7 AM candidate board's SWR — `error ? … : !data ?
// <SkeletonTable/> : …`. A saved-formula screen has nothing to do with that
// feed, and mounting it behind that gate would make this surface blank on every
// morning the pre-market scan failed: a mount that is reachable only when an
// unrelated job succeeded is barely a mount at all.
//
// ⚠️ WHICH SESSION IS THE MEMBER'S QUESTION, NOT THIS FILE'S ANSWER, AND THAT
// DISTINCTION IS LOAD-BEARING. `GET /api/scans/definition-results` REQUIRES
// `as_of`, and no route on this box publishes the session the sweep records
// (`scan_evaluator.expected_session()` is server-side only). So the session is a
// CONTROL the member drives, seeded with today in the exchange's own timezone —
// a default for a request parameter, not a re-derivation of a value the server
// owns. ⛔ Nothing here ever computes what a session CONTAINS: when the store
// holds no receipt for the day asked for, the route answers `status: "not-run"`
// and `ScanResults` says "nobody has run this screen for that session yet" in
// those words. A surface that quietly walked the date back until it found a
// receipt would be answering a question the member did not ask.
// ⏳ HAND-OFF: the honest fix is a server-published list of the sessions a
// definition has receipts for. That is a backend route, in a router two other
// agents co-own, and it is not this task's to add. Recorded in the report.
//
// ⛔ THE LIST IS FILTERED ON THE DOCUMENT'S OWN SHAPE, NEVER ON A RESTATED KIND.
// A screen this surface can ASK about is one that carries a canonical tree and
// the handle that names it — `compute.ast` + `compute.fn` — because `compute.fn`
// IS `astHash(compute.ast)` IS the `def_hash` the sweep filed the receipt under
// (`defSchema.validateAstCompute` refuses a disagreement). Hand-listing the
// string `'ast'` here would be a fourth vocabulary for the lane, and it would
// agree with today's schema right up until a rename.
//
// ⛔ AND NO STORED READ-BACK IS SHOWN. `meta.description` holds the sentence the
// builder wrote at save time; D-A5's rule is that a description beside a result
// must be derived from the tree that RUNS, and `ScanResults` already derives one
// through `sentenceFor` when a hit is charted. Rendering the stored copy here
// would put a second, older description of the same maths on the same screen.

import { useMemo, useState } from 'react'
import UIcon from '../ui/UIcon'
import ScanResults from './ScanResults'
import { useUserDefinitions } from '../../hooks/useUserDefinitions'
import styles from './SavedScreensPanel.module.css'

/** The exchange's timezone. The session control is seeded from the market's
 *  calendar day, not the browser's — a member in London asking for "today"
 *  means today's US session. */
export const SESSION_TZ = 'America/New_York'

/** The bars-store timeframe CODE the nightly sweep runs on
 *  (`scan_evaluator.DEFAULT_TF`). Spelled once, here, and handed down. */
export const SCAN_TF = 'D'

/** `YYYY-MM-DD` for the market's current calendar day.
 *
 *  ⚠️ `en-CA` IS THE LOCALE THAT FORMATS ISO, and the explicit locale is the
 *  point: `toLocaleDateString()` with no argument answers `8/9/2026` for one
 *  member and `09/08/2026` for another, and the route parses neither.
 *  `_normalise_as_of` accepts the ISO spelling and collapses it to the same
 *  YYYYMMDD key `scan_store` files receipts under. */
export function defaultSession(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SESSION_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** The saved definitions this surface can ask the scan route about.
 *
 *  Exported so the mount test can assert the FILTER rather than infer it from
 *  what happened to render. */
export function scannableScreens(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const compute = row && row.definition && row.definition.compute
    if (!compute || typeof compute !== 'object') return false
    if (compute.ast === undefined || compute.ast === null) return false
    return typeof compute.fn === 'string' && compute.fn.length > 0
  })
}

/** The name the member gave it, or the handle, so a row is never blank.
 *  ⛔ Read off the document — this file invents no label. */
function screenName(row) {
  const meta = row && row.definition && row.definition.meta
  const name = meta && typeof meta.name === 'string' ? meta.name.trim() : ''
  return name || (row && row.def_id) || 'Untitled screen'
}

/**
 * The member's saved formulas, and the scan receipt for the one they picked.
 *
 * The whole chain a member reaches: `/screener` → this panel → `ScanResults` →
 * `CoverageLine`. Cutting ANY link in it is what
 * `Screener.scanmount.test.jsx` exists to turn red.
 */
export default function SavedScreensPanel() {
  const { rows, isLoading, error } = useUserDefinitions()
  const screens = useMemo(() => scannableScreens(rows), [rows])
  const [pickedId, setPickedId] = useState(null)
  const [session, setSession] = useState(defaultSession)

  // ⚠️ THE PICK FALLS BACK TO THE FIRST ROW RATHER THAN TO NOTHING. A member who
  // has not clicked anything yet still has a screen selected, so the receipt is
  // on screen on arrival — an empty panel that only fills after a click reads as
  // "no data" and is the degrade this whole mount exists to end.
  const selected = useMemo(() => {
    if (!screens.length) return null
    return screens.find((r) => r.def_id === pickedId) || screens[0]
  }, [screens, pickedId])

  if (error) {
    // ⛔ A REFUSAL IS NOT AN EMPTY LIST. `useUserDefinitions` throws on a non-ok
    // answer precisely so a 402 cannot render as "you have no screens" — the two
    // pictures look identical and they send the member to different fixes.
    return (
      <div className={styles.wrap}>
        <p className={styles.notice} role="alert" data-testid="saved-screens-error">
          <UIcon name="warning" size={14} />
          Your saved screens could not be read ({String(error.message || error)}).
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={styles.wrap}>
        <p className={styles.notice} data-testid="saved-screens-loading">Loading your screens…</p>
      </div>
    )
  }

  if (!screens.length) {
    return (
      <div className={styles.wrap}>
        <p className={styles.notice} data-testid="saved-screens-empty">
          <UIcon name="info" size={14} />
          You have no saved formula screens yet. Build one from a chart&rsquo;s formula
          {' '}builder and it will appear here with the coverage of every session it runs on.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-testid="saved-screens">
      <div className={styles.bar}>
        <div className={styles.list} role="tablist" aria-label="Saved formula screens">
          {screens.map((row) => (
            <button
              key={row.def_id}
              type="button"
              role="tab"
              aria-selected={selected && selected.def_id === row.def_id}
              className={`${styles.screen}${selected && selected.def_id === row.def_id ? ` ${styles.screenOn}` : ''}`}
              onClick={() => setPickedId(row.def_id)}
            >
              {screenName(row)}
            </button>
          ))}
        </div>
        <label className={styles.session}>
          <span className={styles.sessionLabel}>Session</span>
          <input
            type="date"
            className={styles.sessionInput}
            value={session}
            onChange={(e) => setSession(e.target.value)}
          />
        </label>
      </div>

      {/* 🔴 THE MOUNT ITSELF. Delete this element and `CoverageLine` is
          unreachable from every route in the app — which is the state this file
          was written to end, and the state `Screener.scanmount.test.jsx` and
          `reachable.test.js` both go red on. */}
      {selected && (
        <ScanResults definition={selected.definition} asOf={session} tf={SCAN_TF} />
      )}
    </div>
  )
}

// app/src/pages/screener/SharedScreen.jsx
//
// ─── 🔴 THE DOOR AT THE FAR END OF A SHARE LINK ─────────────────────────────
//
// `GET /api/screener/shared/{share_token}` has been SERVED this whole time, and
// `saved_screens.get_public` re-checks `is_public=1` on every read — a complete,
// deliberately-public backend with **no route that renders its answer**. There
// was no Share button either, so `is_public` was never sent true from anywhere
// in the app, `share_token` was therefore never minted, and the route could not
// have matched a row even if somebody had guessed a token. Built end to end and
// reachable from nothing: the thirteenth measured instance of this repo's
// signature defect (`.superpowers/sdd/audit/reachability-report.md` §3a).
//
// ⛔ THIS PAGE IS OUTSIDE `AuthGuard`, DELIBERATELY, AND THAT IS THE WHOLE
// POINT OF THE FEATURE. A share link that only opens for people who already
// have an account is not sharing. The server route takes no auth for exactly
// this reason, and `api/routers/screener.py`'s module docstring is explicit
// about the bound: the payload is a saved FILTER SPEC — no ticker rows, no
// prices, nothing the paid screen computes — and a recipient still needs a paid
// plan to RUN it, because `/api/screener/scan` is gated.
//
// ⭐ SO THE PAGE SAYS THAT, IN THOSE WORDS. Sharing is outward-facing: the
// member who published it and the stranger who opened it should both be able to
// read, off the screen, exactly what crossed the line. A share surface that
// leaves the recipient guessing whether they are looking at somebody's
// positions is the failure mode worth spending pixels on.
//
// ⛔ NO `/api/screener/meta` READ. Pretty filter labels live behind
// `require_paid`, and this page's whole reason to exist is that the reader may
// have no plan at all. `chipLabel` already takes a `{label, presets}` def and
// `FilterChips` already passes `{label: key, presets: []}` for keys the
// registry does not know — so the same fallback renders `rs_rank: ≥ 80` for
// everybody rather than a blank chip for the logged-out.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import { chipLabel } from './chipLabel'
import { scannerPathForSharedScreen, sharedScreenReadUrl } from './screenShareLink'
import styles from './SharedScreen.module.css'

/** One filter of the shared spec, in words.
 *  ⛔ Derived from the spec that was shared — this file invents no label. */
function filterLabel(f) {
  if (!f || !f.key) return ''
  const { key, ...rest } = f
  return chipLabel({ label: key, presets: [] }, rest) || key
}

/** The screen's sort, in words, or `null` when the spec did not carry one. */
export function sortLabel(spec) {
  const sort = spec && spec.sort
  if (!sort || !sort.key) return null
  return `${sort.key} ${sort.dir === 'asc' ? '↑' : '↓'}`
}

/**
 * The page a share link opens.
 *
 * The whole chain a recipient reaches: a link → `App.jsx`'s
 * `SHARED_SCREEN_ROUTE` → this page → `GET /api/screener/shared/{token}`.
 * Cutting any link in it is what `sharedScreen.route.test.jsx` turns red.
 */
export default function SharedScreen() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', screen: null })

  useEffect(() => {
    if (!token) {
      setState({ status: 'missing', screen: null })
      return undefined
    }
    let alive = true
    setState({ status: 'loading', screen: null })
    fetch(sharedScreenReadUrl(token))
      .then((r) => (r.ok ? r.json() : null))
      .then((rec) => {
        if (!alive) return
        // ⛔ A 404 AND AN UNPUBLISHED SCREEN ARE THE SAME ANSWER ON PURPOSE.
        // `get_public` filters on `is_public=1`, so the moment an owner
        // unpublishes, their link stops resolving — and the recipient must not
        // be able to tell "never existed" from "was withdrawn".
        if (rec && rec.spec) setState({ status: 'ok', screen: rec })
        else setState({ status: 'missing', screen: null })
      })
      .catch(() => { if (alive) setState({ status: 'missing', screen: null }) })
    return () => { alive = false }
  }, [token])

  if (state.status === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.notice} data-testid="shared-screen-loading">Opening this screen…</p>
      </div>
    )
  }

  if (state.status === 'missing') {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="shared-screen-missing" role="alert">
          <h1 className={styles.title}>This screen isn&rsquo;t shared</h1>
          <p className={styles.body}>
            The link may have been withdrawn by whoever created it, or it may never
            have been published. Ask them for a fresh link.
          </p>
          <Link className={styles.cta} to="/screener">Go to the Scanner</Link>
        </div>
      </div>
    )
  }

  const { screen } = state
  const spec = screen.spec || {}
  const filters = Array.isArray(spec.filters) ? spec.filters : []
  const sort = sortLabel(spec)

  return (
    <div className={styles.page}>
      <div className={styles.card} data-testid="shared-screen">
        <div className={styles.eyebrow}>
          <UIcon name="library" size={13} /> Shared screen
        </div>
        <h1 className={styles.title}>{screen.name}</h1>

        <h2 className={styles.sectionHdr}>What it filters on</h2>
        {filters.length === 0 ? (
          <p className={styles.body} data-testid="shared-screen-nofilters">
            This screen carries no filters — it scans the whole market and sorts it.
          </p>
        ) : (
          <ul className={styles.chipRow} data-testid="shared-screen-filters">
            {filters.map((f) => (
              <li key={f.key} className={styles.chip}>{filterLabel(f)}</li>
            ))}
          </ul>
        )}

        <dl className={styles.meta}>
          {spec.view && (<><dt>View</dt><dd>{spec.view}</dd></>)}
          {sort && (<><dt>Sorted by</dt><dd>{sort}</dd></>)}
        </dl>

        {/* ⭐ THE SENTENCE THAT MAKES THIS SAFE TO SEND. Both the publisher and
            the recipient can read what did and did not cross the line. */}
        <p className={styles.disclosure} data-testid="shared-screen-disclosure">
          <UIcon name="info" size={13} />{' '}
          A shared screen is a set of <strong>filters</strong>, nothing else. It carries
          no results, no watchlist, no positions and no personal data — and running it
          against the market needs your own UCT&nbsp;Intelligence plan.
        </p>

        <Link
          className={styles.cta}
          to={scannerPathForSharedScreen(screen.share_token || token)}
        >
          Open it in the Scanner
        </Link>
      </div>
    </div>
  )
}

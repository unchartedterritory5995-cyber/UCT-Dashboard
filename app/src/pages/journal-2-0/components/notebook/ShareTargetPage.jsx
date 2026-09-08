import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import BrandSplash from '../../../../components/BrandSplash'
import { useAuth } from '../../../../context/AuthContext'
import {
  SHARE_ROUTE, scrubShareUrlFromHistory, shareFromSearch, writePendingShare,
} from '../../lib/shareTarget'
// ⭐ The SAME interstitial styling as the Browser Capture authorization page,
// imported rather than restated. Both are first-party "you arrived from outside
// the app shell" cards, and one of them already carries the 44px tap-target
// floor Slice 2's phone certification established.
import styles from './CaptureConnectPage.module.css'

/**
 * Where an Android/desktop share sheet lands (Wave L Slice 4 §5).
 *
 * ⛔ OUTSIDE `<AuthGuard/>` DELIBERATELY, for the reason the Browser Capture
 * page is: AuthGuard bounces an unauthenticated visitor to `/login` with no
 * record of where they were going, so a member whose session lapsed would share
 * an article, sign in, and land on the dashboard with the article GONE. That is
 * the exact class App.jsx records fixing once already for `/calendar?earnings=`.
 * This page owns its own signed-out case.
 *
 * ⛔ IT IS NOT A HOLE. The page mints nothing and reads nothing. It parses a
 * query string the member's own share sheet produced, hands it to the ONE
 * capture dialog, and every write that follows is the session-authenticated
 * `POST /api/j2/capture` (or `/api/j2/notes`) that 401s without a cookie.
 *
 * ⭐ IT IS A DOOR, NOT A SECOND CAPTURE UI. There is no share-specific dialog,
 * no share-specific write path, and no share-specific field. It prefills the
 * shared dialog through the same `captureBus` channel the palette and hotkey
 * use — which is why a change to capture semantics can never miss this door.
 */
export default function ShareTargetPage() {
  const { user, isPaid, loading, authTransient } = useAuth()
  const navigate = useNavigate()
  // ⛔ THE ROUTER'S location, never the global `window.location`. Without this
  // binding `location.search` silently resolves to the browser global, which
  // works in a real browser and is empty under a MemoryRouter — so the rails
  // below would exercise a door that had been handed nothing.
  const location = useLocation()

  // ⛔ READ ONCE, AND PERSIST IN THE SAME BREATH. A `useState` initializer runs
  // during the first render — before any child, any effect, and any auth branch
  // — so the payload is already carried by the time this component decides to
  // send the member to /login. It is also why the URL can be scrubbed
  // immediately afterwards without the component losing what it was given.
  const [share] = useState(() => shareFromSearch(location.search))
  const [carried] = useState(() => writePendingShare(share))

  useEffect(() => { document.title = 'Save to UCT' }, [])

  // Is this render about to hand the member on to the Notebook?
  const forwarding = !!user && isPaid

  // ⛔ TAKE THE MEMBER'S TEXT OUT OF THE VISIBLE URL AS EARLY AS WE CAN REACH
  // IT. `navigate` rather than a raw `replaceState` so react-router's own
  // location stays in step; `replace` so Back/Forward cannot resurrect the
  // payload. `share` is already captured above, so re-rendering with an empty
  // search loses nothing. This does NOT undo the request that already reached
  // Railway's edge — see the slice doc §10.
  //
  // ⛔⛔ NOT WHEN WE ARE FORWARDING, and a rail caught this the hour it was
  // written. The paid branch renders `<Navigate to="/journal/notebook" replace/>`
  // during the SAME render whose effect this is; effects run after, so an
  // unconditional scrub navigated back to `/journal/share` and STRANDED the
  // member one route short of the capture dialog. The redirect already removes
  // the share URL from history — it is a `replace` — so there is nothing left
  // for the scrub to do on that path.
  useEffect(() => {
    if (forwarding) return
    scrubShareUrlFromHistory(navigate, location.search)
  }, [forwarding, navigate, location.search])

  // A backend that could not ANSWER the session question has not said "logged
  // out" (the R2 ruling in AuthGuard). Same splash, never a bounce.
  if (loading || (!user && authTransient)) return <BrandSplash label="Signing you in" />

  if (!user) {
    // ⛔⛔ `next` NAMES THE ROUTE AND CARRIES NOTHING ELSE (privacy gate,
    // 2026-09-08). It used to append the whole share, which duplicated the
    // member's prose into a second request, the login page's address bar and
    // browser history — and bought nothing: the only consumer reads
    // sessionStorage, so in the storage-blocked browser that carrier existed
    // for, the payload came back here and died. `safeNextPath` in Login.jsx
    // refuses anything not starting with a single `/`, so this stays same-site.
    const next = SHARE_ROUTE
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            <UIcon name="journal" size={20} /> Sign in to save this
          </h1>
          {carried ? (
            <p className={styles.body}>
              Sign in to UCT and this will be waiting for you — nothing you
              shared has been lost.
            </p>
          ) : (
            /* ⛔ SAID PLAINLY, NOT PAPERED OVER. This browser is refusing
               storage, so the share cannot survive the trip to sign-in. The
               alternative was to smuggle it through the URL, which is the
               privacy defect above — and which never actually restored the
               capture anyway. Telling the member costs them one re-share; the
               URL carrier cost them their privacy and delivered nothing. */
            <p className={styles.body} data-testid="share-not-carried">
              Your browser is blocking storage for this site, so this share
              can’t be held while you sign in. Sign in first, then share again.
            </p>
          )}
          <div className={styles.actions}>
            <a className={styles.primary} data-testid="share-signin"
               href={`/login?next=${encodeURIComponent(next)}`}>Sign in</a>
          </div>
        </div>
      </div>
    )
  }

  // ⛔ A FREE MEMBER GETS AN ANSWER, NOT A BOUNCE. Notebook is paid-only, so
  // navigating on would hand them AuthGuard's redirect to Morning Wire with a
  // capture dialog opening over a page they cannot save from. Saying so is the
  // honest outcome, and it is the one place this door tells them anything.
  if (!isPaid) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            <UIcon name="lock" size={20} /> Notebook is part of a paid plan
          </h1>
          <p className={styles.body}>
            Saving research into your Notebook needs an upgraded plan. Nothing
            was saved.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="/subscribe">See plans</a>
            <a className={styles.secondary} href="/morning-wire">Not now</a>
          </div>
        </div>
      </div>
    )
  }

  // ⭐ `replace` so the share URL is not left in history: Back from the Notebook
  // must return to whatever the member was reading, and never re-fire the share.
  // `CaptureHost` (mounted in `Layout`, which mounts on this navigation because
  // this page is outside it) consumes the pending payload and opens the dialog.
  return <Navigate to="/journal/notebook" replace />
}

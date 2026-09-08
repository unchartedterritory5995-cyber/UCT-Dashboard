import { useEffect, useMemo } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import BrandSplash from '../../../../components/BrandSplash'
import { useAuth } from '../../../../context/AuthContext'
import {
  SHARE_ROUTE, shareFromSearch, writePendingShare,
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
  const location = useLocation()

  const share = useMemo(() => shareFromSearch(location.search), [location.search])

  useEffect(() => { document.title = 'Save to UCT' }, [])

  // ⛔ PERSIST BEFORE ANY AUTH DECISION IS RENDERED. The payload must already
  // be safe by the time this component decides to send the member to /login —
  // writing it in the signed-in branch only would lose it in precisely the case
  // it exists for.
  useEffect(() => { writePendingShare(share) }, [share])

  // A backend that could not ANSWER the session question has not said "logged
  // out" (the R2 ruling in AuthGuard). Same splash, never a bounce.
  if (loading || (!user && authTransient)) return <BrandSplash label="Signing you in" />

  if (!user) {
    // ⭐ THE SECOND CARRIER. sessionStorage above covers a member who finishes
    // sign-in in this tab; `?next=` covers one whose storage is blocked or who
    // is bounced through a fresh context. Either alone has a real failure mode,
    // so the payload rides both. `safeNextPath` in Login.jsx refuses anything
    // not starting with a single `/`, so this cannot become an open redirect.
    const next = `${SHARE_ROUTE}${location.search}`
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            <UIcon name="journal" size={20} /> Sign in to save this
          </h1>
          <p className={styles.body}>
            Sign in to UCT and this will be waiting for you — nothing you shared
            has been lost.
          </p>
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

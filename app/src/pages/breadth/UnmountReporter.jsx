/**
 * Reports that a mounted subtree ACTUALLY went away — regardless of why.
 *
 * 🔴 THE BUG THIS EXISTS FOR. `pages/Breadth.jsx` has to know when a mounted
 * `BreadthViews` has been left, so a shared `?view=` link is spent once and
 * never re-applied over the reader's later choice (and never persisted). Wave C
 * inferred that from the TAB (`activeTab !== 'heatmap'`), and a tab check can
 * only catch the unmount reasons someone thought of. It missed the ordinary one:
 * the child is also gated on `rows.length > 0`, and `rows` empties on any
 * first-of-session window change — a successful, everyday fetch, not a failure.
 * The child unmounted, the link was never marked spent, and the remount reverted
 * the reader's style and wrote that reversion to localStorage and the server.
 *
 * ⭐ SO THE REPORT COMES FROM INSIDE THE SUBTREE. An effect cleanup fires for
 * every reason a mount can end — a condition flipping, a parent re-keying, an
 * error boundary swapping in a fallback — and needs no second copy of the
 * conditions that render it.
 *
 * ⛔ `onReattached` IS NOT DEAD CODE, AND IT IS NOT A PRODUCTION PATH.
 * `main.jsx` wraps the app in `<StrictMode>`, which in development runs
 * setup → cleanup → setup on the SAME instance in one commit. Without the second
 * callback that spurious cleanup would spend the link on the very first mount,
 * and `?date=`'s "widen the window and the link lands" retry would be dead in
 * dev while working in production — a divergence that reads as a broken feature
 * to the next engineer who tests a link locally. `reported` is an instance ref,
 * so it survives StrictMode's double-invoke and is fresh for a genuine remount:
 * only a re-setup of the instance that just reported can take the report back.
 * `UnmountReporter.test.jsx` watches both halves fire.
 *
 * Both callbacks are read through a ref so a parent that passes an inline
 * function does not re-run the lifecycle effect on every render — the effect's
 * empty dep array is the mount lifetime, and it has to stay that way.
 */
import { useEffect, useRef } from 'react'

export default function UnmountReporter({ onUnmount, onReattached, children }) {
  const cbs = useRef({ onUnmount, onReattached })
  useEffect(() => { cbs.current = { onUnmount, onReattached } })

  const reported = useRef(false)
  useEffect(() => {
    if (reported.current) {
      reported.current = false
      cbs.current.onReattached?.()
    }
    return () => {
      reported.current = true
      cbs.current.onUnmount?.()
    }
  }, [])

  return children
}

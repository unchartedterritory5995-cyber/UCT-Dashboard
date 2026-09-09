import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import styles from './CaptureConnectPage.module.css'

/**
 * The first-party authorization page for UCT Browser Capture.
 *
 * ⛔ WHY A PAGE AND NOT A SILENT GRANT. This is the ONE moment a capture
 * credential comes into existence, and §15 requires it to be a member
 * deliberately connecting the extension — not something a page can cause to
 * happen to them. Two independent things make that true, and neither relies on
 * the other:
 *
 *   1. The POST below is authenticated by the `SameSite=Lax` session cookie,
 *      which a browser does not attach to a cross-site POST. A hostile page
 *      cannot make this call as the member at all.
 *   2. The code is minted BOUND to a `chromiumapp.org` redirect, an origin only
 *      the extension can receive on. A code obtained some other way still
 *      cannot be steered to a web page.
 *
 * ⛔ THE CODE LEAVES IN THE URL FRAGMENT. A fragment is never sent to a server,
 * never appears in an access log, and is not carried in a Referer. The bearer
 * token itself never touches a URL at all — the extension exchanges the code
 * for it over POST.
 *
 * Reached by `chrome.identity.launchWebAuthFlow` as a TOP-LEVEL navigation,
 * which is why the Lax session cookie is present: Lax refuses subrequests, not
 * top-level navigations. So there is no second login, and the extension never
 * sees a password.
 */

// Client-side mirror of the server's policy, for the error the member can
// actually act on. The SERVER is the authority — this only avoids a confusing
// round trip, and is deliberately not the check anything depends on.
const EXT_REDIRECT = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/?$/

// Said in the member's language, not in scope strings. The strings themselves
// are a machine's vocabulary; what a member is agreeing to is this list.
const GRANTS = [
  'Save a link or a passage you select into your Notebook',
  'See the names of your recent notes, so it can ask where to save',
]
const NOT_GRANTED = [
  'Read what is inside your notes',
  'Sign in as you anywhere on UCT',
  'See your trades, positions or account',
]

export default function CaptureConnectPage() {
  const [params] = useSearchParams()
  const redirectUri = params.get('redirect_uri') || ''
  const state = params.get('state') || ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  // null = still asking. The signed-out case is a real first-run state (install
  // the extension, click Connect, never signed in on this browser), so it gets
  // an answer rather than a redirect that loses the flow.
  const [signedIn, setSignedIn] = useState(null)

  const validTarget = useMemo(() => EXT_REDIRECT.test(redirectUri), [redirectUri])

  useEffect(() => { document.title = 'Connect UCT Browser Capture' }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => { if (alive) setSignedIn(r.ok) })
      .catch(() => { if (alive) setSignedIn(false) })
    return () => { alive = false }
  }, [])

  const connect = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/j2/capture/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ redirectUri }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.detail || `Could not connect (${res.status})`)
      setDone(true)
      // Fragment, never query. `replace` so the code is not left in history.
      const frag = new URLSearchParams({ code: body.code })
      if (state) frag.set('state', state)
      window.location.replace(`${redirectUri}#${frag.toString()}`)
    } catch (e) {
      setError(e.message || 'Could not connect')
      setBusy(false)
    }
  }, [redirectUri, state])

  if (!validTarget) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            <UIcon name="warning" size={20} /> That connection request is not valid
          </h1>
          <p className={styles.body}>
            This page connects the UCT Browser Capture extension. Open it from the
            extension itself rather than from a link.
          </p>
        </div>
      </div>
    )
  }

  if (signedIn === false) {
    const next = `/journal/capture-connect${window.location.search}`
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            <UIcon name="shield" size={20} /> Sign in to connect
          </h1>
          <p className={styles.body}>
            Sign in to UCT and you will come straight back here to finish
            connecting Browser Capture.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href={`/login?next=${encodeURIComponent(next)}`}
               data-testid="capture-connect-signin">Sign in</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          <UIcon name="shield" size={20} /> Connect UCT Browser Capture
        </h1>
        <p className={styles.body}>
          The extension will be able to save research into your Notebook from any
          page you are reading. It never receives your UCT sign-in.
        </p>

        <div className={styles.grants}>
          <h2 className={styles.grantHead}>It will be able to</h2>
          <ul className={styles.list}>
            {GRANTS.map((g) => (
              <li key={g}><UIcon name="check" size={14} /> {g}</li>
            ))}
          </ul>
          <h2 className={styles.grantHead}>It will not be able to</h2>
          <ul className={`${styles.list} ${styles.listNo}`}>
            {NOT_GRANTED.map((g) => (
              <li key={g}><UIcon name="noEntry" size={14} /> {g}</li>
            ))}
          </ul>
        </div>

        <p className={styles.fine}>
          The connection expires after 30 days, and you can disconnect it at any
          time in Settings.
        </p>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={connect}
                  disabled={busy || done || signedIn === null}
                  data-testid="capture-connect-approve">
            {done ? 'Connected' : busy ? 'Connecting…' : 'Connect'}
          </button>
          <button type="button" className={styles.secondary} disabled={busy || done}
                  onClick={() => window.close()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

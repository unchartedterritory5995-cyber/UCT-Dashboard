// What a challenge shows when its pool could not load. A member-level refusal (401 signed out, 403) is NOT a load
// failure: it is a lapsed session, so it says so and offers the sign-in, instead of "Couldn't load the Blitz pool"
// with a Try again that can never work (the owner hit exactly that on the workbench, 2026-11-04: a 401 read as a
// broken page). The workbench passes its own one-click sandbox sign-in as `signedOut`; the product links to /login.
import LoadFailed from '../../journal-2-0/components/LoadFailed'
import StartCard, { StartButton } from '../../../lab/StartCard'

export const isSignedOut = (e) => !!e && (e.status === 401 || e.status === 403)

export default function ChallengeError({ what, error, onRetry, signedOut = null }) {
  if (isSignedOut(error)) {
    if (signedOut) return signedOut
    return (
      <StartCard eyebrow="Signed out" title="Your session ended" lead="Sign in again and the challenge picks up where the bank left off."
        button={<StartButton icon="play" label="Sign in" sub="back to this page after" onClick={() => { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}` }} />}
        below={<button type="button" onClick={onRetry} style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>I am signed in, try again</button>} />
    )
  }
  return <LoadFailed what={what} error={error} onRetry={onRetry} />
}

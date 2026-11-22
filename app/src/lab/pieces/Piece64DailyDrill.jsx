import DrillPlayer from '../../pages/study/DrillPlayer'
import SandboxSignIn from '../SandboxSignIn'
import { useEffect, useState } from 'react'

/** Round 16: THE DAILY DRILL ITSELF, the real member component, in the workbench look, on the sandbox's Today set.
 *  (owner, 2026-11-04: "it looks nothing like the work we did in the local host"). */
export default function Piece64DailyDrill() {
  const [signedOut, setSignedOut] = useState(null)
  const [initial, setInitial] = useState(null)
  // ?set=free starts a FRESH free set each load (the rig, or the owner after Today's set is done); default = Today's set.
  const fresh = new URLSearchParams(window.location.search).get('set') === 'free'
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' }).then((r) => setSignedOut(!r.ok)).catch(() => setSignedOut(true))
  }, [])
  useEffect(() => {
    if (!fresh || signedOut !== false) return
    fetch('/api/study/sessions', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'free', lesson: true }) })
      .then((r) => r.json()).then(setInitial).catch(() => setInitial(null))
  }, [fresh, signedOut])
  if (signedOut == null) return null
  if (signedOut) return <SandboxSignIn onDone={() => window.location.reload()} />
  if (fresh && !initial) return null
  return <DrillPlayer open initial={initial} onClose={() => {}} onFinished={() => {}} reviewer={false} />
}

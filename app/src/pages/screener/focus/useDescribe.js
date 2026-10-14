import { useCallback, useEffect, useState } from 'react'
import { grammarAvailable, compileAvailable, compileEnglish } from '../shell/criteriaApi'

// The probe itself is memoised inside criteriaApi (one grammar and one compile request per
// page, shared with CriteriaBox, a failed answer forgotten), so this hook keeps no cache.
const probe = () => grammarAvailable().then(ok => (ok ? compileAvailable() : false)).catch(() => false)

// A HARD failure (the server or the network broke, not a refusal of the words) hides the box
// for the rest of the session: a member who saw it fail once is not offered it again. Module
// state on purpose: the drawer mounts this hook again on every open.
let hardDown = false
export function __resetDescribeSession() { hardDown = false }

export const DESCRIBE_DOWN = "Describe a setup isn't working right now. Use the filters below instead."
const PLAIN_RETRY = 'Could not read that. Try different words.'

// What the member is shown for a failed compile. The server's own sentence is kept when it
// is one (a refusal: "Describe the screen you want.", the daily cap); anything that names an
// exception class ("(RuntimeError)"), a bare status ("compile 502") or a dropped connection
// is a hard failure and gets plain copy instead.
export function describeFailure(err) {
  const msg = String(err?.message || '').trim()
  const status = /^compile (\d{3})$/.exec(msg)
  const exceptionName = /\b[A-Z][A-Za-z]*(Error|Exception)\b/.test(msg)
  const network = err instanceof TypeError || /failed to fetch|network/i.test(msg)
  const unavailable = /unavailable/i.test(msg)
  if (exceptionName || network || unavailable || (status && Number(status[1]) >= 500)) return { hard: true, text: DESCRIBE_DOWN }
  if (!msg || status) return { hard: false, text: PLAIN_RETRY }
  return { hard: false, text: msg }
}

// "Describe a setup": plain English in, a compiled screen out. Available only when
// the server has both the grammar door and the compile door open (same two probes
// CriteriaBox uses). `enabled` lets a closed drawer skip the probe entirely.
export default function useDescribe(enabled = true) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // After a hard failure the box stays up for the rest of THIS open (so its sentence is read)
  // and is gone from the next open on. Tracked per open, adjusted during render.
  const [openState, setOpenState] = useState({ enabled, keep: false })
  if (openState.enabled !== enabled) setOpenState({ enabled, keep: false })
  useEffect(() => {
    if (!enabled || hardDown) return undefined
    let live = true
    probe().then(ok => { if (live) setAvailable(ok) })
    return () => { live = false }
  }, [enabled])
  const run = useCallback(async text => {
    setBusy(true)
    setError(null)
    try {
      return await compileEnglish(text)
    } catch (e) {
      const f = describeFailure(e)
      // The box stays up for THIS open so the sentence is read; the next open hides it.
      if (f.hard) { hardDown = true; setOpenState(o => ({ ...o, keep: true })) }
      setError(f.text)
      return null
    } finally {
      setBusy(false)
    }
  }, [])
  return { available: available && (!hardDown || openState.keep), busy, error, run }
}

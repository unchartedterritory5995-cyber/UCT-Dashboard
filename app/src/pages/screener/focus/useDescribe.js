import { useCallback, useContext, useEffect, useState } from 'react'
import { AuthContext } from '../../../context/AuthContext'
import { grammarAvailable, compileAvailable, compileEnglish } from '../shell/criteriaApi'

// The probe itself is memoised inside criteriaApi (one grammar and one compile request per
// page, shared with CriteriaBox, a failed answer forgotten), so this hook keeps no cache.
const probe = () => grammarAvailable().then(ok => (ok ? compileAvailable() : false)).catch(() => false)

// A HARD failure (the door is shut: flag off, plan, permission) hides the box for the rest of
// the session: a member who saw it refused once is not offered it again. Session-scoped module
// state on purpose (the drawer mounts this hook again on every open), but KEYED BY THE SIGNED-IN
// USER, so a sign-out/sign-in as someone else in the same tab starts clean.
let hardDownFor = null // user key the box was hidden for, or null
const userKey = user => String(user?.id ?? user?.email ?? 'anon')
export function __resetDescribeSession() { hardDownFor = null }

export const DESCRIBE_DOWN = "Describe a setup isn't available on your account right now. Use the filters below instead."
export const DESCRIBE_BUSY = "Describe a setup couldn't answer just now. Try again shortly."
const PLAIN_RETRY = 'Could not read that. Try different words.'
const SHUT = new Set([402, 403, 404])

// What the member is shown for a failed compile, and whether it hides the box.
//  · HARD (hidden from the next open): the door is shut. 404 "Not Found" (flag off), 402 "requires
//    a paid plan", 403, or an answer that says disabled/not enabled. Plain copy, never "Not Found".
//  · SOFT (shown, box stays): everything else. A transient 503 "unavailable right now. Try again
//    shortly." keeps its own plain sentence; anything naming an exception class ("(RuntimeError)"),
//    a bare status ("compile 502") or a dropped connection gets plain copy instead of the raw text.
//    Refusals ("Describe the screen you want.", the daily cap) keep the server's sentence.
export function describeFailure(err) {
  const msg = String(err?.message || '').trim()
  const bare = /^compile (\d{3})$/.exec(msg)
  const status = Number(err?.status) || (bare ? Number(bare[1]) : 0)
  if (SHUT.has(status) || /^not found$/i.test(msg) || /paid plan|not enabled|disabled|forbidden/i.test(msg)) {
    return { hard: true, text: DESCRIBE_DOWN }
  }
  const exceptionName = /\b[A-Z][A-Za-z]*(Error|Exception)\b/.test(msg)
  const network = err instanceof TypeError || /failed to fetch|network/i.test(msg)
  if (exceptionName || network || bare && status >= 500) return { hard: false, text: DESCRIBE_BUSY }
  if (status === 503 || /try again shortly/i.test(msg)) return { hard: false, text: msg || DESCRIBE_BUSY }
  if (!msg || bare) return { hard: false, text: PLAIN_RETRY }
  return { hard: false, text: msg }
}

// "Describe a setup": plain English in, a compiled screen out. Available only when
// the server has both the grammar door and the compile door open (same two probes
// CriteriaBox uses). `enabled` lets a closed drawer skip the probe entirely.
export default function useDescribe(enabled = true) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const who = userKey(useContext(AuthContext)?.user)
  const hardDown = hardDownFor === who
  // After a hard failure the box stays up for the rest of THIS open (so its sentence is read)
  // and is gone from the next open on. Tracked per open, adjusted during render.
  const [openState, setOpenState] = useState({ enabled, keep: false })
  if (openState.enabled !== enabled) setOpenState({ enabled, keep: false })
  useEffect(() => {
    if (!enabled || hardDown) return undefined
    let live = true
    probe().then(ok => { if (live) setAvailable(ok) })
    return () => { live = false }
  }, [enabled, hardDown])
  const run = useCallback(async text => {
    setBusy(true)
    setError(null)
    try {
      return await compileEnglish(text)
    } catch (e) {
      const f = describeFailure(e)
      // The box stays up for THIS open so the sentence is read; the next open hides it.
      if (f.hard) { hardDownFor = who; setOpenState(o => ({ ...o, keep: true })) }
      setError(f.text)
      return null
    } finally {
      setBusy(false)
    }
  }, [who])
  return { available: available && (!hardDown || openState.keep), busy, error, run }
}

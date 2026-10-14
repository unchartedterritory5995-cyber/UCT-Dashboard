import { useCallback, useEffect, useState } from 'react'
import { grammarAvailable, compileAvailable, compileEnglish } from '../shell/criteriaApi'

// One grammar+compile probe per page lifetime; a failed probe is forgotten so the next open retries.
let probe = null
export function __resetDescribeProbe() { probe = null }
function probeOnce() {
  if (!probe) {
    probe = grammarAvailable()
      .then(ok => (ok ? compileAvailable() : false))
      .then(ok => { if (!ok) probe = null; return !!ok })
      .catch(() => { probe = null; return false })
  }
  return probe
}

// "Describe a setup": plain English in, a compiled screen out. Available only when
// the server has both the grammar door and the compile door open (same two probes
// CriteriaBox uses). `enabled` lets a closed drawer skip the probe entirely.
export default function useDescribe(enabled = true) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    probeOnce().then(ok => { if (live) setAvailable(ok) })
    return () => { live = false }
  }, [enabled])
  const run = useCallback(async text => {
    setBusy(true)
    setError(null)
    try {
      return await compileEnglish(text)
    } catch (e) {
      setError(e?.message || 'Could not read that. Try different words.')
      return null
    } finally {
      setBusy(false)
    }
  }, [])
  return { available, busy, error, run }
}

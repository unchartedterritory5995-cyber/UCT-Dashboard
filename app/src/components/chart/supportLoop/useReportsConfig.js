// app/src/components/chart/supportLoop/useReportsConfig.js
//
// Whether the A3 report door is switched on (`docs/pine/support-loop/PHASE-A.md`).

import { useEffect, useState } from 'react'
import { reportsConfig } from './supportApi'

/** `{reportsEnabled, maxSourceBytes, maxNoteChars}` once known, else null. One
 *  request per page load (`reportsConfig` caches), and none until `active`. */
export default function useReportsConfig(active = true) {
  const [cfg, setCfg] = useState(null)
  useEffect(() => {
    if (!active) return undefined
    let alive = true
    reportsConfig().then((c) => { if (alive) setCfg(c) })
    return () => { alive = false }
  }, [active])
  return cfg
}

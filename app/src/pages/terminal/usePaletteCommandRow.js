// The palette's terminal row, loaded OFF the first-open path (notebook bytes budget, 2026-10-09).
//
// `paletteGrammar` pulls in the shell's whole parser (parseCommand, grammar, args). The palette
// is mounted on every page, so a static import put that parser in the app's entry chunk and on
// every route's first open. This hook fetches it with a dynamic import as soon as the palette
// mounts for a member who has the shell — long before a first keystroke in practice — and
// re-renders once it lands, so the row the member sees is the same row `terminalCommandRow`
// has always produced. ⛔ Still ONE grammar: this file only defers the import.
import { useEffect, useMemo, useState } from 'react'

let loaded = null
let loading = null
function loadGrammar() {
  if (!loading) loading = import('./paletteGrammar').then((m) => { loaded = m; return m })
  return loading
}

export default function usePaletteCommandRow(query, enabled) {
  const [mod, setMod] = useState(loaded)
  useEffect(() => {
    if (!enabled || mod) return undefined
    let live = true
    loadGrammar().then((m) => { if (live) setMod(m) }, () => {})
    return () => { live = false }
  }, [enabled, mod])
  return useMemo(() => (enabled && mod ? mod.terminalCommandRow(query) : null), [enabled, mod, query])
}

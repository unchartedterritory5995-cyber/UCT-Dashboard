// A chip that writes its choice back into its panel's own command (UPDG, HILO, SCTR; data wave 1).
//
// The shell keys a panel's body on its code and arguments (TerminalShell `identity`), so a chip that
// re-runs `CODE ARG` remounts the panel with the argument as a prop, and a reload, `?cmd=` and the
// history keep the choice. That only works when the registry DECLARES the argument: a token the
// variant does not take is echoed as "not applied" and the remounted panel falls back to its
// default, so the chip would snap back.
//
// So the write-back asks the registry first. `writeBackCommand` returns the command only when the
// code's market variant applies EVERY token (args.js `applyArgs`, the same pure function the shell
// runs); otherwise it returns null and the panel keeps the choice in component state. A panel
// registered before its arguments are wired therefore still has working chips.
import { useCallback } from 'react'
import { useInTerminalPanel, usePanelRerun } from '../../../components/terminal'
import { variantFor } from '../functions'
import { applyArgs } from '../args'

/** Pure: `CODE TOKEN ...` when the registered market variant of `code` applies every token, else null. */
export function writeBackCommand(code, tokens = []) {
  const c = String(code || '').trim().toUpperCase()
  if (!c) return null
  const { variant } = variantFor(c, false)
  if (!variant) return null
  const toks = (tokens || []).filter((t) => t != null && String(t).trim() !== '').map((t) => String(t).trim())
  if (applyArgs(variant, toks).ignored.length) return null
  return [c, ...toks].join(' ')
}

/**
 * `writeBack(tokens)` for the panel it is called in: re-runs the panel's own command with those
 * arguments and returns true, or returns false (outside the shell, or the registry does not take
 * them) so the caller keeps the choice in its own state.
 */
export function usePanelWriteBack() {
  const rerun = usePanelRerun()
  const code = useInTerminalPanel()?.code || null
  return useCallback((tokens) => {
    const cmd = rerun ? writeBackCommand(code, tokens) : null
    if (!cmd) return false
    rerun(cmd)
    return true
  }, [rerun, code])
}

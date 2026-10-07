// UCT Terminal — what an EMBEDDED component may know about the terminal panel it sits in.
//
// Terminal panels render EXISTING page/tab components, never forks (pages/terminal/panels.jsx).
// The panel frame (header, inset, density, loading skeleton) belongs to the shell; this module is
// the one wire from that frame down into the component, so a page can drop what the frame
// already draws — its own page title, its own page padding — without a copy of the page.
//
// ⭐ STABLE IMPORT PATH for every page and tab: `components/terminal/terminalPanel`
// (or the `components/terminal` barrel). Outside a terminal panel every hook here is a harmless
// no-op: `useInTerminalPanel()` returns null, `usePanelFreshness()` reports nowhere.
//
//   const inPanel = useInTerminalPanel()
//   {!inPanel && <PageHeader … />}            // the panel header already names the function
//   <div className={inPanel?.inset ? styles.pageInPanel : styles.page}>   // the shell insets
//
// The context value is `{ code, density, inset }`:
//   code     the function code the panel runs ('CAL', 'DES', …)
//   density  the board density: 'comfortable' | 'compact' | 'dense'
//   inset    true when the shell already pads the panel body (`--panel-inset`); false for the
//            few panels the shell leaves flush (the chart, the calendar) — see FLUSH_PANELS.
import { createContext, useContext, useEffect } from 'react'

/** `null` outside a terminal panel. Provided by `Panel` in pages/terminal/TerminalShell.jsx. */
export const TerminalPanelContext = createContext(null)

/** `{ code, density, inset }` inside a terminal panel, `null` everywhere else. */
export function useInTerminalPanel() {
  return useContext(TerminalPanelContext)
}

// ── V8 — a panel's freshness, reported UP to its own header ─────────────────────────────────
// The chrome around a panel body — where a freshness badge belongs — is owned by the shell's
// `Panel`. This carries, from the body to its own header, the exact prop shape `<FreshnessBadge>`
// already accepts; it decides NOTHING about freshness itself. OPT-IN: a panel that never calls
// `usePanelFreshness()` leaves the setter uncalled and no badge renders.

/** `null` outside a `Panel` — calling the hook there is a harmless no-op. */
export const PanelFreshnessContext = createContext(null)

/**
 * A panel body reports its own freshness up to the terminal panel header.
 *
 * `freshness` is the exact prop shape `<FreshnessBadge>` consumes — any subset of
 * `{ freshnessClass, asOf, age, sessionState, sessionStale }` the panel has a real,
 * already-computed answer for (never invent one). `null` (the default) reports nothing,
 * which is also what happens before a panel's first successful fetch.
 */
export function usePanelFreshness(freshness = null) {
  const setFreshness = useContext(PanelFreshnessContext)
  useEffect(() => {
    setFreshness?.(freshness)
    return () => setFreshness?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFreshness, JSON.stringify(freshness)])
}

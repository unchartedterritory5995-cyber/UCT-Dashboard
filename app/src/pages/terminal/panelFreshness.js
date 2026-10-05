// UCT Terminal — a panel's freshness, reported UP to its own header (V8).
//
// Panels in this shell are EXISTING page/tab components, embedded (`panels.jsx`'s header
// comment: "existing components, embedded, never forked"). The `<FreshnessBadge>` +
// `freshnessAge.js`/`freshnessContract.js` authority (TERM-006) is already how a research tab
// states its own as-of (`research/tabs/NewsTab.jsx`'s `TrustStrip`) or how a Monitor cell states
// its age (`Breadth.jsx`). A terminal panel has nowhere to put that: its body is the embedded
// component, and the chrome around it — where a badge would actually sit — is owned by
// `TerminalShell.jsx`'s `Panel`, one level up.
//
// This module is the wire between the two, and it decides NOTHING about freshness itself — it
// only carries, from a panel body to its own header, the exact shape `<FreshnessBadge>` already
// accepts. ⛔ No new freshness logic lives here: a panel computes its own verdict the same way
// `pages/breadth/naaimAge.js` does (through `freshnessAge.js`'s authority) or states a D1 class
// it already has (the `TrustStrip` pattern), and hands the RESULT through `usePanelFreshness`.
//
// OPT-IN, by construction: a panel that never calls `usePanelFreshness()` leaves the context's
// setter uncalled, `Panel` holds `null`, and no badge renders — backward-compatible with every
// panel already in `panels.jsx`.
import { createContext, useContext, useEffect } from 'react'

/** `null` outside a `Panel` (e.g. a panel rendered standalone in a test, or on a full page
 *  outside the terminal shell) — calling the hook there is a harmless no-op, matching this
 *  codebase's other panel-host contexts (`WorkspaceContext`'s documented null-safe default). */
export const PanelFreshnessContext = createContext(null)

/**
 * A panel body reports its own freshness up to the terminal Panel header.
 *
 * `freshness` is the exact prop shape `<FreshnessBadge>` consumes — pass any subset of
 * `{ freshnessClass, asOf, age, sessionState, sessionStale }` that the panel has a real,
 * already-computed answer for (never invent one). Pass `null` (the default) to report nothing,
 * which is also what happens before a panel's first successful fetch.
 *
 * ⛔ NOT a `useState`-return — a panel calls this as an effect-style reporter, so the context
 * value is a stable setter function (`Panel` memoises it per panel instance) rather than a
 * value a panel could read back. Reading freshness belongs to the header, which owns the badge.
 */
export function usePanelFreshness(freshness = null) {
  const setFreshness = useContext(PanelFreshnessContext)
  useEffect(() => {
    setFreshness?.(freshness)
    return () => setFreshness?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFreshness, JSON.stringify(freshness)])
}

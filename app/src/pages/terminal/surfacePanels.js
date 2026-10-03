// UCT Terminal — whole PAGES as panels, through the TERM-037 panel set (TERMINAL-NEXT V13).
//
// ONE PANEL VOCABULARY. `surfaces/panelSet.js` derives a registered panel manifest for every
// page-shaped surface (manifest × NAV label); the /charts board's native widgets walk through
// the same `registerPanel` door. The shell's `surface` variants resolve HERE, against that set
// — so a page is embeddable in the shell only if the panel set already says it is a panel, and
// its header label is the panel set's label, not a third copy.
//
// What this file adds is the one thing the panel set deliberately does not carry: the module
// to render. `SURFACE_IMPORTERS` is keyed by the manifest `element`, and each importer names
// the SAME module App.jsx lazy-loads for that route (functions.rail.test.js reads App.jsx's
// AST and fails on any drift). The page is rendered as-is, with no props: unforked.
//
// Only pages that neither read route params nor need an Outlet are listed. Every other page
// the panel set promotes stays a door in functions.js, and there it must carry a `why`.
import { SURFACE_PANELS } from '../../surfaces/panelSet.js'

export const SURFACE_IMPORTERS = {
  MorningWire: () => import('../MorningWire'),
  UCT20: () => import('../UCT20'),
  Breadth: () => import('../Breadth'),
  Screener: () => import('../Screener'),
  FlowScoreboard: () => import('../FlowScoreboard'),
  CatalystsHistory: () => import('../CatalystsHistory'),
  PortfolioHeat: () => import('../PortfolioHeat'),
}

/** Pages that write the URL they are mounted under (the screener's `?s=` spec). Like the
 *  calendar, at most one panel may show one of these. */
export const URL_WRITING_SURFACES = new Set(['Screener'])

const BY_PATH = new Map(Object.entries(SURFACE_PANELS).map(([id, p]) => [p.surface, { id, ...p }]))

/** The panel-set entry a `surface` path embeds as, or null when the panel set does not
 *  promote that path or no page module is bound to it. */
export function surfacePanel(path) {
  const p = BY_PATH.get(path)
  if (!p || !SURFACE_IMPORTERS[p.element]) return null
  return { id: p.id, element: p.element, label: p.labels.header, path: p.surface }
}

/** Every panel-set path the panel set promotes (bound or not) — for the "a door to a
 *  promotable page must say why" rail. */
export function promotedPaths() {
  return new Set(BY_PATH.keys())
}

/** The panel-set ids of the URL-writing pages (derived from the element names above). */
export const URL_WRITING_SURFACE_IDS = Object.freeze([...BY_PATH.values()]
  .filter((p) => URL_WRITING_SURFACES.has(p.element)).map((p) => p.id))

/** id → importer, for `panels.jsx`'s one lazy() cache. */
export const SURFACE_IMPORTERS_BY_ID = Object.freeze(Object.fromEntries(
  [...BY_PATH.values()].filter((p) => SURFACE_IMPORTERS[p.element])
    .map((p) => [p.id, SURFACE_IMPORTERS[p.element]]),
))

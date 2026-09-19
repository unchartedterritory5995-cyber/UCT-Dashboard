/**
 * S1 CP2 — THE SHELL READS THE MANIFEST, FOR ONE PROPERTY: `kind`.
 *
 * Gate: `s1-terminal-shell-pre-implementation-gate.md`, CP2.
 *
 * CP1 declared the manifest as inert data with zero consumers by design. CP2 is
 * where the shell reads ONE property from it -- here, `kind` -- to decide the
 * browser tab TITLE: a route the manifest classifies `'surface'` (a real,
 * addressable top-level page) gets a per-page title; every other kind (`child`,
 * `detail`, `redirect`, `admin`) and every surface NOT covered below leaves
 * `document.title` at whatever it already was.
 *
 * ⛔ NO NEW COPY IS INVENTED. The manifest carries no title TEXT (CP1's own
 * schema is `path`/`pathKind`/`element`/`kind`/`order`) -- the actual label
 * strings come from `NAV_ITEMS` in `NavBar.jsx`, the SAME already-approved,
 * `tools/nav_manifest.mjs`-derived array CLAUDE.md documents and the sidebar
 * itself renders. Two real, already-shipped data sources are joined; nothing
 * here is a product decision about what a page should be CALLED.
 *
 * ⛔ ADDITIVE, NEVER REGRESSIVE. Before this, no route ever set `document.title`
 * at all -- the browser tab held index.html's static SEO title
 * ("UCT Intelligence — 10 subscriptions in 1...") on every page, forever. A
 * route this module does not cover keeps that exact behaviour; nothing is
 * removed or made worse for any path.
 */
import { MANIFEST } from './manifest.js'
import { NAV_ITEMS } from '../components/NavBar.jsx'

export const APP_BRAND = 'UCT Intelligence'

/** Literal `'surface'`-kind paths CP1 declared, longest-prefix-first (mirrors
 * MobileNav.jsx's own `titleFor()` matcher, which does the identical thing for
 * the mobile top bar's page-title chip off a hand-typed, incomplete list).
 * Exported so the test asks THIS derivation rather than keeping a second one. */
export const SURFACE_PATHS = MANIFEST
  .filter((m) => m.kind === 'surface' && m.pathKind === 'literal')
  .map((m) => m.path)
  .sort((a, b) => b.length - a.length)

const NAV_LABEL_BY_PATH = new Map(NAV_ITEMS.map((i) => [i.to, i.label]))

/** The document title for `pathname`, or `null` when this route is out of
 * scope (the caller must leave `document.title` untouched, not clear it). */
export function titleForPath(pathname) {
  const match = SURFACE_PATHS.find((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (!match) return null
  const label = NAV_LABEL_BY_PATH.get(match)
  if (!label) return null
  return `${label} — ${APP_BRAND}`
}

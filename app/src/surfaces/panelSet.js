/**
 * TERM-037 (FB-S1-03) — THE PANEL SET AS A BY-PRODUCT OF THE SURFACE SET.
 *
 * Spec: `docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md`
 * FB-S1-03 (band 4 is register-only, so there is no `#### TERM-037` package). The item
 * warns about itself by name: *"Worth it only if the manifest set is DERIVED from the
 * surfaces and `registry.test.js`'s pinning is extended rather than replaced; a
 * hand-maintained promotion list is the same defect with a new name."*
 *
 * ── ONE AUTHORITY, ONE DERIVATION ───────────────────────────────────────────
 *
 *   AUTHORITY  `MANIFEST` (./manifest.js) — the surface set, itself derived from
 *              `App.jsx`'s route table and railed by `manifest.test.js`.
 *   DERIVED    `SURFACE_PANELS` — one registered panel manifest for every page-shaped
 *              surface, produced by `registerPanel` (the ONE door every native entry in
 *              `widgets/registry.js` also walks through). Adding a route to `App.jsx`
 *              forces a manifest row (CP1's rail), and that row becomes a panel here with
 *              ZERO edits to this file or to the registry.
 *   UNION      `PANEL_SET` — the native board tools (`WIDGET_IDS`, which are not surfaces:
 *              chart, nhnl, volumescan...) followed by the surface-derived ids. The
 *              registry is no longer the bound on what the set can hold.
 *
 * ⛔ THIS FILE TYPES NO ROUTE. Every path, label and element below comes from an import.
 * `panelSet.test.js` walks this file's own AST and fails on any route-shaped string
 * literal, so a hand-typed promotion list cannot be slipped back in.
 *
 * ── WHICH SURFACES PROMOTE, AND WHY THE OTHERS ARE REFUSED BY NAME ──────────
 *
 * Every manifest row lands in exactly one of `SURFACE_PANELS` or `REFUSED_SURFACES`,
 * each refusal carrying its reason — a silently dropped surface is how a set quietly
 * stops meaning what it says.
 *   `kind`             only `kind: 'surface'` is page-shaped. A `detail` needs a route
 *                      param the board cannot supply, a `child` belongs to its shell, a
 *                      `redirect` has no page, and `admin` is not a member surface.
 *   `identifier-path`  the manifest names the path by an identifier it does not resolve.
 *   `board-host`       the surface that HOSTS the board (`BOARD_HOST_ELEMENT`) cannot be
 *                      a panel on itself.
 *   `no-nav-label`     no NAV_ITEMS label. A panel needs a header, and no copy is invented
 *                      here (the same rule `pageTitle.js` follows for the tab title).
 *
 * ── MOUNTED THROUGH ONE DOOR (TERMINAL-NEXT lane T1, 2026-10-02) ───────────
 *
 * Landed INERT (the S1 CP1 shape) on 2026-09-29. The UCT Terminal shell is now its one
 * consumer: `pages/terminal/surfacePanels.js` resolves the shell's `surface` functions
 * against `SURFACE_PANELS` and binds, per surface, the SAME page module App.jsx loads,
 * rendered with NO props (so not ledger C9's abandoned `embedded` pattern, which forked
 * pages behind "20-prop signatures"). The per-surface mount decision is that file's
 * `SURFACE_IMPORTERS`; every promoted surface it does not bind stays a door in the shell's
 * registry, with a stated reason. Still offered by NO menu and bound in NO
 * `WORKSPACE_WIDGETS` slot (the /charts board is unchanged), so `menus` stays all false.
 * `panelSet.test.js` fails if a second production file imports this module.
 */
import { MANIFEST } from './manifest.js'
import { NAV_ITEMS } from '../components/NavBar.jsx'
import { WIDGET_REGISTRY, registerPanel } from '../widgets/registry.js'

/** The one manifest kind that is page-shaped enough to become a panel. */
export const PROMOTABLE_KIND = 'surface'

/** Every surface-derived panel id starts with this, so it can never collide with a native id. */
export const SURFACE_PANEL_PREFIX = 'surface'

/** The manifest element that hosts the board (`pages/charts/ChartsWorkspace.jsx` renders
 *  `WidgetHost`). The rail asserts exactly one manifest row carries it. */
export const BOARD_HOST_ELEMENT = 'ChartsWorkspace'

/** Why a surface did not become a panel. */
export const REFUSAL = Object.freeze({
  KIND: 'kind',
  PATH: 'identifier-path',
  HOST: 'board-host',
  LABEL: 'no-nav-label',
})

const MENUS_OFFERED_NOWHERE = Object.freeze({
  workspace: false, tab: false, mobile: false, journal: false, terminal: false,
})

function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v)
  }
  return Object.freeze(obj)
}

/** A registry-legal id for a surface path: the prefix plus each path word, capitalised. */
export function surfacePanelId(path) {
  const words = String(path).split(/[^A-Za-z0-9]+/).filter(Boolean)
  return SURFACE_PANEL_PREFIX + words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

/** The size a promoted page opens at: no smaller than the largest native panel, per
 *  dimension. Derived from the registry, so it moves when the registry moves. */
export function pageDefaults(registry) {
  const out = { w: 0, h: 0, minW: 0, minH: 0 }
  for (const entry of Object.values(registry)) {
    for (const k of Object.keys(out)) out[k] = Math.max(out[k], entry.defaults[k])
  }
  return out
}

function refusalOf(row, labelByPath) {
  if (row.kind !== PROMOTABLE_KIND) return REFUSAL.KIND
  if (row.pathKind !== 'literal') return REFUSAL.PATH
  if (row.element === BOARD_HOST_ELEMENT) return REFUSAL.HOST
  if (!labelByPath.get(row.path)) return REFUSAL.LABEL
  return null
}

/**
 * Pure: the panel set a given surface manifest produces. The module's own exports are
 * this function applied to the real imports; the rail applies it to a planted manifest
 * to prove that moving the source moves the set.
 */
export function derivePanelSet({ manifest, navItems, registry }) {
  const labelByPath = new Map(navItems.map((i) => [i.to, i.label]))
  // G-040: a CAPTURE-ONLY registry entry (Screener / COT / Model Book Notebook
  // captures) is a capture kind, not a board tool — no board can hold it, so it is
  // not in the set. It still guards collisions: a surface id may not reuse it.
  const allIds = Object.keys(registry)
  const nativeIds = allIds.filter((id) => registry[id].captureOnly !== true)
  const defaults = pageDefaults(registry)
  const promoted = {}
  const refused = []

  for (const row of manifest) {
    const reason = refusalOf(row, labelByPath)
    if (reason) {
      refused.push({ path: row.path, element: row.element, kind: row.kind, reason })
      continue
    }
    const id = surfacePanelId(row.path)
    if (id in promoted) throw new Error(`surface panel id ${id} is derived twice (${promoted[id].surface}, ${row.path})`)
    if (allIds.includes(id)) throw new Error(`surface panel id ${id} collides with a native registry id`)
    const label = labelByPath.get(row.path)
    promoted[id] = registerPanel(id, {
      labels: { header: label, menu: label, tab: label },
      defaults: { ...defaults },
      paramsSchema: [],
      menus: { ...MENUS_OFFERED_NOWHERE },
      surface: row.path,
      element: row.element,
      order: row.order,
      plainText: () => `[${label}]`,
      reconstructable: false,
      liveCapable: false,
    })
  }

  return {
    promoted: deepFreeze(promoted),
    refused: deepFreeze(refused),
    panelSet: Object.freeze([...nativeIds, ...Object.keys(promoted)]),
  }
}

const DERIVED = derivePanelSet({ manifest: MANIFEST, navItems: NAV_ITEMS, registry: WIDGET_REGISTRY })

/** id -> registered panel manifest, one per promotable surface. */
export const SURFACE_PANELS = DERIVED.promoted
export const SURFACE_PANEL_IDS = Object.freeze(Object.keys(SURFACE_PANELS))
/** Every manifest row that did not become a panel, with its reason. */
export const REFUSED_SURFACES = DERIVED.refused
/** The whole set a board could hold: native board tools, then surface-derived panels. */
export const PANEL_SET = DERIVED.panelSet

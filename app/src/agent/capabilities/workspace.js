// ── WORKSPACE capabilities: widgets on the Charts board ─────────────────────
//
// Registered through the same public seam as charts (agent/capabilities.js).
// Nothing in the orchestrator, planner, runtime or server names a widget.
//
//   target kind 'workspace'  one target — the visible board. Commits go through
//                            ChartsWorkspace's OWN handlers (handleAddWidget /
//                            handleRemoveWidget), reached via host.widgets.
//   context 'workspace'      widget count / limit and the visible widget types
//   widget.add               ONE widget per turn, ONLY when it fits in empty
//                            space. When placement would resize other widgets the
//                            product shows its own ghost preview and waits for the
//                            member — the Agent says so instead of moving things.
//
// ⛔ widget.remove is deliberately NOT here: its undo would have to re-insert the
// exact widget (id, geometry, opts) and the product has no canonical writer for
// that — re-adding mints a new id and re-places it. See agent/README.md.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { WORKSPACE_MENU_TYPES, labelMap } from '../../widgets/registry'

const LABEL = labelMap('menu')
const label = (t) => LABEL[t] || t
const geom = (w) => [w.id, w.type, w.x, w.y, w.w, w.h]

export const workspaceKind = {
  name: 'workspace',
  list: (host) => (host?.widgets ? [host.widgets.snapshot()] : []),
  read: (host, ref) => (host?.widgets && ref === 'workspace' ? host.widgets.snapshot() : null),
  stateOf: (snap) => ({ adds: [], ids: snap.widgets.map(w => w.id) }),
  patch: (before, after) => (after.adds.length ? { add: after.adds, beforeIds: before.ids } : null),
  commit(host, ref, patch) {
    if (patch.add) for (const t of patch.add) host.widgets.add(t)
    if (patch.remove) for (const id of patch.remove) host.widgets.remove(id)
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.remove) return patch.remove.every(id => !snap.widgets.some(w => w.id === id))
    const fresh = snap.widgets.filter(w => !patch.beforeIds.includes(w.id)).map(w => w.type).sort()
    return JSON.stringify(fresh) === JSON.stringify([...patch.add].sort())
  },
  // Undo closes exactly the widget(s) this turn added, through the manual close path.
  undoPatch: (item) => ({ remove: (item.after?.widgets || []).filter(w => !item.patch.beforeIds.includes(w.id)).map(w => w.id) }),
  fingerprint: (snap) => JSON.stringify(snap.widgets.map(geom).sort()),
}

let registered = false
export function registerWorkspaceCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(workspaceKind)
  registerContextProvider({
    key: 'workspace',
    // A one-item LIST so the workspace gets a minted short ref like every target.
    build: (host, refFor) => {
      if (!host?.widgets) return undefined
      const s = host.widgets.snapshot()
      return [{
        ref: refFor('workspace', 'workspace'), label: 'Workspace',
        widgetCount: s.count, widgetLimit: s.max,
        visibleWidgets: s.visible.map(w => ({ type: w.type, label: label(w.type), position: w.position || null })),
      }]
    },
  })
  registerCapability({
    name: 'widget.add',
    target: 'workspace',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    summary: 'Add ONE widget of a given type to the Charts workspace; it is placed automatically in empty space. One per request.',
    hints: `Types: ${WORKSPACE_MENU_TYPES.map(t => `${t} (${label(t)})`).join(', ')}. target = the ref of the workspace entry in workspace_context.`,
    args: { type: 'object', properties: { type: { type: 'string', enum: [...WORKSPACE_MENU_TYPES] } }, required: ['type'], additionalProperties: false },
    fast: ({ lower }) => {
      const m = /^add (?:a |an |another |one more |a new |new )?(.+?)(?: widget)?$/.exec(lower)
      if (!m) return null
      const want = m[1].trim()
      const hit = WORKSPACE_MENU_TYPES.find(t => t === want || label(t).toLowerCase() === want
        || `${label(t).toLowerCase()}s` === want)
      return hit ? { type: hit } : null
    },
    check(st, { type }, env) {
      const snap = env?.target
      if (!WORKSPACE_MENU_TYPES.includes(type)) return `“${type}” isn't a widget you can add.`
      if (st.adds.length) return 'I can add one widget at a time for now.'
      if (!snap) return 'The workspace is not available.'
      if (!snap.canGrow) return `The workspace already has ${snap.count} widgets — the most it holds. Close one first.`
      if (!snap.fits[type]) {
        return `There's no empty space for a ${label(type)} without resizing other widgets. Use Widgets ▾ → ${label(type)} — it shows where it will go before placing it.`
      }
      return null
    },
    apply: (st, { type }) => ({ ...st, adds: [...st.adds, type] }),
    describe: (b, a, { type }) => (a.adds.length > b.adds.length ? `Added a ${label(type)}` : null),
  })
}

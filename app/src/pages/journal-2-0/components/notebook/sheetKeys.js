// The Notebook sheets' keys (My tools' open tab, the routine/tracker editor, the widget builder), held through the
// shared key registry (pages/command/shortcutRegistry.js, where each binding is declared with its scope).
//
// Why a holder and not a bare `registerShortcuts` in each component: every one of these sheets is mounted on its OWN
// root by a door that unmounts it in a `setTimeout(0)` after it closes (openMyTools, mountEditor, openWidgetBuilder),
// so a sheet closed and opened again in one tick is briefly mounted TWICE. The raw window listeners these replaced
// simply ran side by side then, each acting only while its own sheet panel was the topmost one. The registry allows one
// live registration per binding, so this module holds ONE registration per binding while any instance holds it, and
// calls every live instance's handler, in the order they took hold: what two raw listeners on one node did. Each
// handler keeps its own topmost-panel test, so only the top sheet acts. Same node (window), same phase (capture).
import { registerShortcuts } from '../../../command/shortcutRegistry'

// The registry's rail reads registrants by AST, so each binding set is a literal call here.
const BIND = {
  myToolsTab: (fn) => registerShortcuts({ 'myTools.tabEscape': fn }),
  toolEditor: (fn) => registerShortcuts({ 'notebook.toolEditorEscape': fn }),
  builder: (fn) => registerShortcuts({
    'notebook.builderEscape': fn,
    'notebook.builderSave': fn,
    'notebook.builderUndo': fn,
  }),
}

const held = new Map() // name -> { handlers: Function[], release: Function }

/** Hold the `name` key set with `handler` until the returned release is called (idempotent). */
export function holdSheetKeys(name, handler) {
  if (!BIND[name]) throw new Error(`holdSheetKeys: unknown key set '${name}'`)
  let entry = held.get(name)
  if (!entry) {
    const handlers = []
    // A holder released by an earlier handler in this same dispatch is skipped (it has unmounted).
    const dispatch = (e) => { for (const fn of handlers.slice()) if (handlers.includes(fn)) fn(e) }
    entry = { handlers, release: BIND[name](dispatch) }
    held.set(name, entry)
  }
  entry.handlers.push(handler)
  let done = false
  return () => {
    if (done) return
    done = true
    const i = entry.handlers.indexOf(handler)
    if (i >= 0) entry.handlers.splice(i, 1)
    if (entry.handlers.length === 0 && held.get(name) === entry) {
      held.delete(name)
      entry.release()
    }
  }
}

// Test helper (customization pass 1): a stand-in for the shell's panel-view wire, so a panel test
// can prove its sort / columns / filters survive a remount from the saved record.
//
//   const saved = savedView()
//   const first = render(<ViewHost saved={saved}><Panel /></ViewHost>)   … change the sort …
//   first.unmount(); render(<ViewHost saved={saved}><Panel /></ViewHost>) … it is still sorted
import { useMemo } from 'react'
import { PanelViewContext } from '../../../components/terminal'
import { normalizeView } from '../../../components/terminal/panelView'

export function savedView(initial = null) {
  return { view: normalizeView(initial) || null, writes: 0 }
}

export function ViewHost({ saved, children }) {
  const value = useMemo(() => ({
    view: saved.view,
    setView: (v) => { saved.view = normalizeView(v) || null; saved.writes += 1 },
    get: () => saved.view,
  }), [saved])
  return <PanelViewContext.Provider value={value}>{children}</PanelViewContext.Provider>
}

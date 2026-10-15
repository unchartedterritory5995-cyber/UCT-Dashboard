import Menu, { MenuItem, MenuDivider } from './Menu'
import { useShortcutsSheet } from './useShortcutsSheet'

// The trigger is the top bar's ordinary button (Menu's default), like Save and the other
// controls beside it (P11).
//
// "Keyboard shortcuts" opens the shortcuts SHEET, never a toast (B10/N6). A host that binds the
// "?" key passes its own `shortcuts` (the useShortcutsSheet() result: it renders `sheet` and
// puts `onKeyDown` on its root); only then does the item carry the "?" hint, because only then
// is the hint true. Without one, Help keeps a sheet of its own. `onShortcuts` is the older
// prop: it still decides whether the item is offered, but the item opens the sheet.
export default function HelpMenu({ onHowTo, onMethodology, onLibrary, onGlossary, onShortcuts, shortcuts }) {
  const own = useShortcutsSheet({ keyBound: false })
  const sheet = shortcuts || own
  const offer = !!shortcuts || typeof onShortcuts === 'function'
  return (
    <>
      <Menu label="Help" trigger="Help ▾" align="right" testId="focus-help-menu" width={260}>
        {typeof onHowTo === 'function' && <MenuItem onSelect={onHowTo}>How to use this screen</MenuItem>}
        {typeof onMethodology === 'function' && <MenuItem onSelect={onMethodology}>Methodology</MenuItem>}
        {typeof onLibrary === 'function' && <MenuItem onSelect={onLibrary}>Structure library</MenuItem>}
        {typeof onGlossary === 'function' && <MenuItem onSelect={onGlossary}>What each filter means</MenuItem>}
        {offer && <MenuDivider />}
        {offer && <MenuItem onSelect={sheet.open} hint={shortcuts ? '?' : undefined}>Keyboard shortcuts</MenuItem>}
      </Menu>
      {!shortcuts && own.sheet}
    </>
  )
}

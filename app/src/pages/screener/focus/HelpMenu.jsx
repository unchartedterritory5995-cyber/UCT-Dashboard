import Menu, { MenuItem, MenuDivider } from './Menu'

// The trigger is the top bar's ordinary button (Menu's default), like Save and the other
// controls beside it (P11). The "?" hint is true: useShortcutsSheet binds the key.
export default function HelpMenu({ onHowTo, onMethodology, onLibrary, onGlossary, onShortcuts }) {
  return (
    <Menu label="Help" trigger="Help ▾" align="right" testId="focus-help-menu" width={260}>
      {typeof onHowTo === 'function' && <MenuItem onSelect={onHowTo}>How to use this screen</MenuItem>}
      {typeof onMethodology === 'function' && <MenuItem onSelect={onMethodology}>Methodology</MenuItem>}
      {typeof onLibrary === 'function' && <MenuItem onSelect={onLibrary}>Structure library</MenuItem>}
      {typeof onGlossary === 'function' && <MenuItem onSelect={onGlossary}>What each filter means</MenuItem>}
      {typeof onShortcuts === 'function' && <MenuDivider />}
      {typeof onShortcuts === 'function' && <MenuItem onSelect={onShortcuts} hint="?">Keyboard shortcuts</MenuItem>}
    </Menu>
  )
}

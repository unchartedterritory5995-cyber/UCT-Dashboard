import Menu, { MenuItem, MenuDivider } from './Menu'
import styles from './FocusScreener.module.css'

export default function HelpMenu({ onHowTo, onMethodology, onLibrary, onGlossary, onShortcuts }) {
  return (
    <Menu label="Help" trigger="?" align="right" triggerClassName={styles.iconBtn} testId="focus-help-menu" width={260}>
      {typeof onHowTo === 'function' && <MenuItem onSelect={onHowTo}>How to use this screen</MenuItem>}
      {typeof onMethodology === 'function' && <MenuItem onSelect={onMethodology}>Methodology</MenuItem>}
      {typeof onLibrary === 'function' && <MenuItem onSelect={onLibrary}>Structure library</MenuItem>}
      {typeof onGlossary === 'function' && <MenuItem onSelect={onGlossary}>What each filter means</MenuItem>}
      {typeof onShortcuts === 'function' && <MenuDivider />}
      {typeof onShortcuts === 'function' && <MenuItem onSelect={onShortcuts} hint="?">Keyboard shortcuts</MenuItem>}
    </Menu>
  )
}

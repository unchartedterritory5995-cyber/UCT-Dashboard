import Menu, { MenuItem, MenuDivider } from './Menu'
import styles from './FocusScreener.module.css'

export default function HelpMenu({ onHowTo, onMethodology, onLibrary, onGlossary, onShortcuts }) {
  return (
    <Menu label="Help" trigger="?" align="right" triggerClassName={styles.iconBtn} testId="focus-help-menu" width={260}>
      {onHowTo && <MenuItem onSelect={onHowTo}>How to use this screen</MenuItem>}
      <MenuItem onSelect={onMethodology}>Methodology</MenuItem>
      <MenuItem onSelect={onLibrary}>Structure library</MenuItem>
      <MenuItem onSelect={onGlossary}>What each filter means</MenuItem>
      <MenuDivider />
      <MenuItem onSelect={onShortcuts} hint="?">Keyboard shortcuts</MenuItem>
    </Menu>
  )
}

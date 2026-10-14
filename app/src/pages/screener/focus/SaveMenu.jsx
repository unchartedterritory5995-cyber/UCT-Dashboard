import Menu, { MenuItem, MenuHeading } from './Menu'

export default function SaveMenu({ canSaveScreen, canFrozenList, canAlert, canNotebook, onSaveScreen, onFrozenList, onAlert, onNotebook, count }) {
  if (!canSaveScreen && !canFrozenList && !canAlert && !canNotebook) return null
  return (
    <Menu label="Save" trigger="Save ▾" align="right" testId="focus-save-menu" width={300}>
      <MenuHeading>Save as…</MenuHeading>
      {canSaveScreen && <MenuItem onSelect={onSaveScreen} hint="reruns live">Save as a screen</MenuItem>}
      {canFrozenList && <MenuItem onSelect={onFrozenList} hint={count ? `${count} names, frozen` : 'frozen'}>Save today&apos;s list</MenuItem>}
      {canAlert && <MenuItem onSelect={onAlert} hint="new names">Alert me on new names</MenuItem>}
      {canNotebook && <MenuItem onSelect={onNotebook} hint="snapshot">Add to Notebook</MenuItem>}
    </Menu>
  )
}

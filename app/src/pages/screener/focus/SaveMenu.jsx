import Menu, { MenuItem, MenuHeading } from './Menu'

// Always rendered, so the top bar never shifts when it becomes usable (B12): disabled until
// the list has answered (`hasResult === false`) or while nothing can be saved yet. A caller
// that does not pass `hasResult` is disabled only when every outcome is switched off.
export default function SaveMenu({ canSaveScreen, canFrozenList, canAlert, canNotebook, onSaveScreen, onFrozenList, onAlert, onNotebook, count, hasResult }) {
  const none = !canSaveScreen && !canFrozenList && !canAlert && !canNotebook
  const disabled = hasResult === false || none
  return (
    <Menu label="Save" trigger="Save ▾" align="right" testId="focus-save-menu" width={300}
      disabled={disabled} disabledTitle="Available once the list has loaded">
      <MenuHeading>Save as…</MenuHeading>
      {canSaveScreen && <MenuItem onSelect={onSaveScreen} hint="reruns live">Save as a screen</MenuItem>}
      {canFrozenList && <MenuItem onSelect={onFrozenList} hint={count ? `${count} names, frozen` : 'frozen'}>Save today&apos;s list</MenuItem>}
      {canAlert && <MenuItem onSelect={onAlert} hint="new names">Alert me on new names</MenuItem>}
      {canNotebook && <MenuItem onSelect={onNotebook} hint="snapshot">Add to Notebook</MenuItem>}
    </Menu>
  )
}

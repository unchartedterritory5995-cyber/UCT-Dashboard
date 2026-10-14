import Menu, { MenuItem, MenuDivider } from './Menu'

export default function MoreMenu({ onExportCsv, onExportXlsx, liveSortEligible, liveSortOn, onToggleLiveSort, density, onDensity, showCompany, onToggleCompany }) {
  return (
    <Menu label="More actions" trigger="⋯" align="right" testId="focus-more-menu" width={260}>
      <MenuItem onSelect={onExportCsv}>Export CSV</MenuItem>
      {onExportXlsx && <MenuItem onSelect={onExportXlsx}>Export Excel</MenuItem>}
      <MenuDivider />
      {liveSortEligible && <MenuItem onSelect={onToggleLiveSort} hint={liveSortOn ? 'on' : 'off'}>Re-sort by live price</MenuItem>}
      <MenuItem onSelect={() => onDensity(density === 'compact' ? 'comfortable' : 'compact')} hint={density}>Row density</MenuItem>
      <MenuItem onSelect={onToggleCompany} hint={showCompany ? 'on' : 'off'}>Show company names</MenuItem>
    </Menu>
  )
}

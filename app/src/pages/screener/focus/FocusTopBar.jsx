import styles from './FocusScreener.module.css'
import { AgentDockButton } from '../../../agent/AgentProvider'

// List | Charts | Map | Table. Exported so Table mode, which renders today's page under a slim bar, shows the same control.
// Charts is the screen's results on the /charts Multi-Chart grid (ScreenerChartGrid); Map is the
// same results as a market-cap treemap (ScreenerHeatMap).
export const MODES = [['list', 'List'], ['grid', 'Charts'], ['map', 'Map'], ['table', 'Table']]

// `only` (the scan board): the views offered on the switch; the rest move to the More menu.
export function ModeSwitch({ mode, onMode, only = null }) {
  return (
    <div role="group" aria-label="View" className={styles.seg}>
      {MODES.filter(([m]) => !only || only.includes(m)).map(([m, label]) => (
        <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? styles.segOn : styles.segOff} onClick={() => onMode(m)}>
          {label}
        </button>
      ))}
    </div>
  )
}

// The page's ONE bar. Left: what you are looking at (the Stocks | Options switch when the member
// has Options, the screen, its filters). Right: the data's age, how you look at it (the view),
// then Save, More and Help.
export default function FocusTopBar({ screenMenu, filterCount, onOpenFilters, dataReceipt, mode, onMode, saveMenu, moreMenu, helpMenu, optionsTab, modesOnly = null, layoutMenu = null }) {
  return (
    <header className={styles.topBar}>
      {optionsTab}
      {screenMenu}
      <button type="button" className={styles.btn} onClick={onOpenFilters} data-guide="screener.filters" aria-label={`Filters, ${filterCount} active`}>
        Filters {filterCount > 0 && <span className={styles.badge}>{filterCount}</span>}
      </button>
      <span className={styles.spacer} />
      {dataReceipt}
      <ModeSwitch mode={mode} onMode={onMode} only={modesOnly} />
      {layoutMenu}
      {saveMenu}
      {moreMenu}
      {helpMenu}
      <AgentDockButton />
    </header>
  )
}

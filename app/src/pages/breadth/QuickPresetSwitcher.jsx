// app/src/pages/breadth/QuickPresetSwitcher.jsx
/** Compact preset dropdown for the Breadth Views bar — flips the active view's
 *  preset without opening the Customize panel. */
import styles from './QuickPresetSwitcher.module.css'

export default function QuickPresetSwitcher({ presetNames, activePreset, onSwitch }) {
  return (
    <select className={styles.select} aria-label="Switch preset" value={activePreset}
            onChange={(e) => onSwitch(e.target.value)}>
      {presetNames.map(n => <option key={n} value={n}>{n === 'Default' ? 'Default preset' : n}</option>)}
    </select>
  )
}

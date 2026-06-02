// app/src/pages/breadth/QuickPresetSwitcher.jsx
/** Compact preset dropdown for the Breadth Views bar — flips the active view's
 *  preset without opening the Customize panel. */
export default function QuickPresetSwitcher({ presetNames, activePreset, onSwitch }) {
  return (
    <select aria-label="Switch preset" value={activePreset}
            onChange={(e) => onSwitch(e.target.value)}
            style={{ font: '600 11px Instrument Sans, sans-serif', color: '#cbd5e1',
                     background: '#0e131a', border: '1px solid rgba(255,255,255,0.1)',
                     borderRadius: 6, padding: '3px 6px', cursor: 'pointer' }}>
      {presetNames.map(n => <option key={n} value={n}>{n === 'Default' ? 'Default preset' : n}</option>)}
    </select>
  )
}

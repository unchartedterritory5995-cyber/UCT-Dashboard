// app/src/pages/charts/grid/MultiChartMenu.jsx
//
// The "Multi Charts ▾" dropdown rendered in the ChartsWorkspace header: layout
// presets (with mini grid-shape icons), a custom N×M form, the Sync-crosshair
// toggle, chart-settings access, saved multichart layouts (backed by the same
// /api/charts/layouts service as workspace templates, marked kind:'multichart'
// and filtered by kind on both sides), and Back to workspace.
//
// Unlike workspace templates (arrangement-only), grid templates DO save the
// tickers + timeframes — a saved multi-chart layout IS its watch set.

import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import useChartLayouts from '../../../hooks/useChartLayouts'
import { LAYOUTS, GRID_MAX_CELLS, makeLayout } from './gridLayouts'
import GroupPicker from './GroupPicker'
import wsStyles from '../ChartsWorkspace.module.css'
import styles from './MultiChartGrid.module.css'

function LayoutIcon({ rows, cols }) {
  return (
    <span
      className={styles.layoutIcon}
      style={{ gridTemplateRows: `repeat(${rows}, 5px)`, gridTemplateColumns: `repeat(${cols}, 5px)` }}
      aria-hidden="true"
    >
      {Array.from({ length: rows * cols }, (_, i) => (
        <span key={i} className={styles.layoutIconCell} />
      ))}
    </span>
  )
}

export default function MultiChartMenu({ mc, onClose, flyout = false }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { global: globalLayouts, mine: myLayouts, saveLayout, deleteLayout } = useChartLayouts()
  const gridGlobal = globalLayouts.filter(t => t.layout?.kind === 'multichart')
  const gridMine = myLayouts.filter(t => t.layout?.kind === 'multichart')

  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [saveName, setSaveName] = useState('')
  const [saveScope, setSaveScope] = useState('user')
  const [saveErr, setSaveErr] = useState('')

  const inGrid = mc.state.mode === 'grid'

  const pickPreset = (id) => { mc.enterGrid(id); onClose() }

  const applyCustom = () => {
    const l = makeLayout(rows, cols)
    if (l.cellCount > GRID_MAX_CELLS) return
    mc.applyCustomLayout(rows, cols)
    onClose()
  }

  const applyTemplate = (tpl) => { mc.applyGridTemplate(tpl); onClose() }

  const handleSaveAs = async () => {
    const nm = saveName.trim()
    if (!nm) { setSaveErr('Name required'); return }
    try {
      await saveLayout({
        name: nm,
        // widgets:[] satisfies the backend's arrangement-shape validation;
        // kind marks it so the workspace Open-layout menu filters it out.
        layout: {
          kind: 'multichart',
          widgets: [],
          layout: mc.state.layout,
          cells: mc.state.cells.map(c => ({ sym: c.sym, tf: c.tf, chartType: c.chartType || null })),
        },
        groups: null,
        scope: isAdmin ? saveScope : 'user',
      })
      setSaveName(''); setSaveErr('')
      onClose()
    } catch (e) {
      setSaveErr(e.message || 'Save failed')
    }
  }

  return (
    <div
      className={wsStyles.addMenu}
      style={{
        minWidth: 240,
        // Flyout: open BESIDE the hosting "Multi Chart ▸" row of the Open-layout
        // dropdown instead of below a header button.
        ...(flyout ? { left: '100%', top: -6, marginLeft: 4 } : {}),
      }}
    >
      <div className={wsStyles.menuSection}>Layout</div>
      {LAYOUTS.map(l => (
        <button
          key={l.id}
          type="button"
          className={wsStyles.addMenuItem}
          style={inGrid && mc.state.layout === l.id ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
          onClick={() => pickPreset(l.id)}
        >
          <LayoutIcon rows={l.rows} cols={l.cols} />
          {l.label}
        </button>
      ))}
      <div className={styles.nxmForm}>
        <input
          className={styles.nxmInput}
          type="number" min="1" max="4"
          value={rows}
          onChange={e => setRows(e.target.value)}
          aria-label="Rows"
        />
        <span className={styles.nxmX}>×</span>
        <input
          className={styles.nxmInput}
          type="number" min="1" max="4"
          value={cols}
          onChange={e => setCols(e.target.value)}
          aria-label="Columns"
        />
        <button type="button" className={wsStyles.toolbarBtn} onClick={applyCustom}>Apply</button>
      </div>

      <div className={wsStyles.menuDivider} />
      <label className={wsStyles.menuCheck}>
        <input
          type="checkbox"
          checked={mc.state.syncCrosshair}
          onChange={e => mc.setSyncCrosshair(e.target.checked)}
        />
        Sync crosshair across charts
      </label>
      {inGrid && (
        <button
          type="button"
          className={wsStyles.addMenuItem}
          onClick={() => { mc.setSettingsOpen(true); onClose() }}
        >Chart settings…</button>
      )}

      {(gridGlobal.length > 0 || gridMine.length > 0) && <div className={wsStyles.menuDivider} />}
      {gridGlobal.length > 0 && <div className={wsStyles.menuSection}>Prebuilt grids</div>}
      {gridGlobal.map(t => (
        <div key={`g${t.id}`} className={wsStyles.menuRow}>
          <button type="button" className={wsStyles.addMenuItem} style={{ flex: 1 }} onClick={() => applyTemplate(t)}>{t.name}</button>
          {isAdmin && (
            <button type="button" className={wsStyles.menuDel} title="Delete prebuilt grid" onClick={() => deleteLayout(t.id)}>✕</button>
          )}
        </div>
      ))}
      {gridMine.length > 0 && <div className={wsStyles.menuSection}>My grids</div>}
      {gridMine.map(t => (
        <div key={`m${t.id}`} className={wsStyles.menuRow}>
          <button type="button" className={wsStyles.addMenuItem} style={{ flex: 1 }} onClick={() => applyTemplate(t)}>{t.name}</button>
          <button type="button" className={wsStyles.menuDel} title="Delete" onClick={() => deleteLayout(t.id)}>✕</button>
        </div>
      ))}

      {inGrid && (
        <>
          <div className={wsStyles.menuDivider} />
          <div className={wsStyles.menuForm}>
            <div className={wsStyles.menuSection} style={{ padding: 0 }}>Save grid as…</div>
            <input
              className={wsStyles.menuInput}
              placeholder="Grid name"
              value={saveName}
              maxLength={60}
              onChange={e => { setSaveName(e.target.value); setSaveErr('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveAs() }}
            />
            {isAdmin && (
              <label className={wsStyles.menuCheck}>
                <input
                  type="checkbox"
                  checked={saveScope === 'global'}
                  onChange={e => setSaveScope(e.target.checked ? 'global' : 'user')}
                />
                Prebuilt (available to all users)
              </label>
            )}
            <button type="button" className={wsStyles.toolbarBtn} style={{ alignSelf: 'flex-start' }} onClick={handleSaveAs}>
              Save grid
            </button>
            {saveErr && <div className={wsStyles.menuErr}>{saveErr}</div>}
          </div>
          <div className={wsStyles.menuDivider} />
          <button
            type="button"
            className={wsStyles.addMenuItem}
            onClick={() => { mc.exitGrid(); onClose() }}
          >← Back to workspace</button>
        </>
      )}

      <div className={wsStyles.menuDivider} />
      <GroupPicker mc={mc} onClose={onClose} />
    </div>
  )
}

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
import { fetchGroups, fetchGroupTop, fetchPeers, pinEtf } from './groupsApi'
import { neighborGroup } from './groupRecents'
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
  const [nxmErr, setNxmErr] = useState('')
  const [groupErr, setGroupErr] = useState('')
  const [saveName, setSaveName] = useState('')
  const [saveScope, setSaveScope] = useState('user')
  const [saveErr, setSaveErr] = useState('')

  const inGrid = mc.state.mode === 'grid'
  // Industry cohorts (orphan fallback) aren't themes: they have no Prev/Next
  // neighbors in the theme list and no /top endpoint to refresh from.
  const isIndustryGroup = String(mc.state.group?.id || '').startsWith('industry:')

  const pickPreset = (id) => { mc.enterGrid(id); onClose() }

  const applyCustom = () => {
    const r = Math.max(1, parseInt(rows, 10) || 0)
    const c = Math.max(1, parseInt(cols, 10) || 0)
    // Cap by TOTAL cells, not per-dimension: ultrawide 2×6 / 1×8 boards are
    // legal (mega-review — the old max-4-per-dimension made them impossible).
    if (r * c > GRID_MAX_CELLS) {
      setNxmErr(`Max ${GRID_MAX_CELLS} charts (${r}×${c} = ${r * c}) — try 2×6, 2×8, or 4×4`)
      return
    }
    setNxmErr('')
    mc.applyCustomLayout(r, c)
    onClose()
  }

  const applyTemplate = (tpl) => { mc.applyGridTemplate(tpl); onClose() }

  const stepGroup = async (dir) => {
    // Never silent: every path either fills or explains (mega-review).
    setGroupErr('')
    if (isIndustryGroup) { setGroupErr('Industry cohorts have no Prev/Next — pick a group below'); return }
    try {
      const list = await fetchGroups()
      const nextId = neighborGroup(list, mc.state.group.id, dir)
      if (!nextId) { setGroupErr('No neighboring group'); return }
      const n = mc.state.cells.length
      const { syms, etf } = await fetchGroupTop(nextId, { n, by: mc.state.group.by || 'today' })
      const filled = pinEtf(syms, etf, n)
      const nextName = list.find(x => x.id === nextId)?.name
      if (!filled.length) { setGroupErr(`${nextName || 'That group'} has no chartable names`); return }
      mc.fillCells(filled, { id: nextId, by: mc.state.group.by || 'today', n, name: nextName })
    } catch {
      setGroupErr('Group fetch failed — try again')
    }
  }

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
          group: mc.state.group || null,
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
        // Viewport-bounded: on laptops the full menu (layouts + groups + save)
        // is taller than the screen — without a scroll, Save grid / Back to
        // workspace / Exit Groups fall off-screen (mega-review #11).
        maxHeight: flyout ? 'calc(100vh - 220px)' : 'calc(100vh - 160px)',
        overflowY: 'auto',
        // Flyout: open BESIDE the hosting "Multi Chart ▸" row, CONTIGUOUS with
        // it — a marginLeft gap meant the pointer crossed dead space and the
        // row's mouseleave killed the flyout mid-reach (mega-review #16). The
        // border supplies the visual separation the margin used to.
        ...(flyout ? { left: '100%', top: -6, marginLeft: 0 } : {}),
      }}
    >
      <div className={wsStyles.menuSection}>Layout</div>
      <div className={styles.presetGrid}>
        {LAYOUTS.map(l => (
          <button
            key={l.id}
            type="button"
            className={`${styles.presetBtn} ${inGrid && mc.state.layout === l.id ? styles.presetBtnActive : ''}`}
            onClick={() => pickPreset(l.id)}
            title={l.label}
          >
            <LayoutIcon rows={l.rows} cols={l.cols} />
            <span className={styles.presetLabel}>{l.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.nxmForm}>
        <span className={styles.nxmX} style={{ marginRight: 2 }}>Custom</span>
        <input
          className={styles.nxmInput}
          type="number" min="1" max="8"
          value={rows}
          onChange={e => { setRows(e.target.value); setNxmErr('') }}
          aria-label="Rows"
        />
        <span className={styles.nxmX}>×</span>
        <input
          className={styles.nxmInput}
          type="number" min="1" max="8"
          value={cols}
          onChange={e => { setCols(e.target.value); setNxmErr('') }}
          aria-label="Columns"
        />
        <button type="button" className={wsStyles.toolbarBtn} onClick={applyCustom}>Apply</button>
      </div>
      {nxmErr && <div className={wsStyles.menuErr}>{nxmErr}</div>}

      <div className={wsStyles.menuDivider} />
      <label className={wsStyles.menuCheck}>
        <input
          type="checkbox"
          checked={mc.state.syncCrosshair}
          onChange={e => mc.setSyncCrosshair(e.target.checked)}
        />
        Sync crosshair across charts
      </label>
      <label className={wsStyles.menuCheck}>
        <input
          type="checkbox"
          checked={mc.state.syncTimeRange}
          onChange={e => mc.setSyncTimeRange(e.target.checked)}
        />
        Sync time range across charts
      </label>
      <label className={wsStyles.menuCheck}>
        <input
          type="checkbox"
          checked={mc.state.groupsMode}
          onChange={e => mc.setGroupsMode(e.target.checked)}
        />
        Groups Mode (type a ticker to fill its group)
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

      {mc.state.group && (
        <>
          <div className={wsStyles.menuDivider} />
          {!isIndustryGroup && (
            <div className={styles.nxmForm} style={{ justifyContent: 'space-between' }}>
              <button type="button" className={wsStyles.toolbarBtn} onClick={() => stepGroup(-1)} aria-label="Previous group">‹ Prev</button>
              <button type="button" className={wsStyles.toolbarBtn} onClick={() => stepGroup(1)} aria-label="Next group">Next ›</button>
            </div>
          )}
          <button type="button" className={wsStyles.addMenuItem} onClick={async () => {
            setGroupErr('')
            const g = mc.state.group
            const n = mc.state.cells.length
            try {
              if (isIndustryGroup) {
                // Industry cohorts have no /top endpoint — re-resolve from the
                // seed (same call that built the cohort; 60s server cache).
                if (!g.seed) { setGroupErr('Nothing to refresh — type a ticker'); return }
                const res = await fetchPeers(g.seed, { n: Math.max(1, n - 1) })
                const syms = [g.seed, ...((res && res.peers) || [])].slice(0, n)
                if (syms.length <= 1) { setGroupErr('No cohort right now'); return }
                mc.fillCells(syms, { ...g, n })
                onClose()
                return
              }
              const { syms, etf } = await fetchGroupTop(g.id, { n, by: g.by || 'today' })
              const filled = pinEtf(syms, etf, n)
              if (!filled.length) { setGroupErr('Group has no chartable names right now'); return }
              mc.fillCells(filled, { ...g, n })
              onClose()
            } catch {
              setGroupErr('Refresh failed — try again')
            }
          }}>↻ Refresh group</button>
          {groupErr && <div className={wsStyles.menuErr}>{groupErr}</div>}
          <button type="button" className={wsStyles.addMenuItem} onClick={() => { mc.setGroupsMode(false); onClose() }}>
            Exit Groups
          </button>
        </>
      )}
    </div>
  )
}

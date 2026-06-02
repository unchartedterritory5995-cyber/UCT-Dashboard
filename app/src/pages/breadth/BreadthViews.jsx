/**
 * Breadth Views container — owns the date cursor, forward-fill, percentile
 * computation, the useBreadthViews preset hook, and dispatch to the active
 * visualization style. Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */
import { useState, useEffect, useMemo } from 'react'
import { HM_METRICS, PCTILE_KEYS, FFILL_KEYS } from '../Breadth'
import useBreadthViews from './useBreadthViews'
import { normalizeMetric } from './views/breadthViewShared'
import BreadthViewSwitcher from './BreadthViewSwitcher'
import CustomizePanel from './CustomizePanel'
import customizeStyles from './CustomizePanel.module.css'
import TreemapView from './views/TreemapView'
import RingsView from './views/RingsView'
import TugView from './views/TugView'
import MetersView from './views/MetersView'

export default function BreadthViews({ rows, onDrill }) {
  // Computed inside the component (not module top-level) to dodge the
  // Breadth.jsx ⇆ BreadthViews circular-import TDZ: HM_METRICS is only
  // initialized by render time, not during module evaluation.
  const ALL_METRICS = useMemo(() => HM_METRICS.filter(m => !m.isHeader), [])
  const views = useBreadthViews()
  const [rowIdx, setRowIdx] = useState(0)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  useEffect(() => {
    const handler = e => {
      if (e.key === 'ArrowLeft')  setRowIdx(p => Math.min(p + 1, rows.length - 1))
      if (e.key === 'ArrowRight') setRowIdx(p => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rows.length])

  const filledRows = useMemo(() => {
    const asc = [...rows].reverse()
    const carry = {}
    const result = []
    for (const row of asc) {
      const filled = { ...row }
      for (const k of FFILL_KEYS) {
        if (filled[k] == null && carry[k] != null) filled[k] = carry[k]
        else if (filled[k] != null) carry[k] = filled[k]
      }
      result.push(filled)
    }
    return result.reverse()
  }, [rows])

  const currentRow = filledRows[rowIdx] ?? filledRows[0]
  const prevRow = filledRows[rowIdx + 3]

  const pctileByKey = useMemo(() => {
    const out = {}
    for (const k of PCTILE_KEYS) {
      const vals = rows.map(r => r[k]).filter(v => v != null && !isNaN(Number(v)))
      if (vals.length > 1) out[k] = vals.map(Number).sort((a, b) => a - b)
    }
    return out
  }, [rows])

  const visibleMetrics = useMemo(
    () => ALL_METRICS.filter(m => !views.hidden.has(m.key)),
    [ALL_METRICS, views.hidden],
  )
  const visibleKeys = useMemo(() => new Set(visibleMetrics.map(m => m.key)), [visibleMetrics])
  const normalize = useMemo(
    () => (metric, row) => normalizeMetric(metric, row, pctileByKey),
    [pctileByKey],
  )

  // Views call onDrill(metric); Breadth's openDrill expects (date, metric). Bridge
  // here so view components stay date-agnostic.
  const drill = useMemo(
    () => (metric) => onDrill(currentRow?.date, metric),
    [onDrill, currentRow],
  )

  if (!currentRow) return null

  const common = { currentRow, prevRow, metrics: visibleMetrics, normalize, onDrill: drill }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', flexWrap: 'wrap' }}>
        <BreadthViewSwitcher viewStyle={views.viewStyle} onSelect={views.setViewStyle} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setRowIdx(p => Math.min(p + 1, rows.length - 1))}
                  disabled={rowIdx >= rows.length - 1} aria-label="Previous day">←</button>
          <span style={{ font: '600 12px Instrument Sans, sans-serif', color: '#cbd5e1' }}>{currentRow.date}</span>
          <button onClick={() => setRowIdx(p => Math.max(p - 1, 0))}
                  disabled={rowIdx === 0} aria-label="Next day">→</button>
          {rowIdx > 0 && <button onClick={() => setRowIdx(0)}>LATEST</button>}
        </div>
        <div className={customizeStyles.anchor} style={{ marginLeft: 'auto' }}>
          <button className={`${customizeStyles.triggerBtn} ${customizeOpen ? customizeStyles.triggerBtnActive : ''}`}
                  onClick={() => setCustomizeOpen(o => !o)} title="Customize which metrics show">
            <span className={customizeStyles.triggerIcon}>⚙</span> Customize
          </button>
          {customizeOpen && (
            <CustomizePanel
              title="Customize Breadth Views"
              cols={ALL_METRICS}
              activePreset={views.activePreset}
              hidden={views.hidden}
              presetNames={views.presetNames}
              isDefaultActive={views.isDefaultActive}
              onToggleHidden={views.toggleHidden}
              onSavePreset={views.savePreset}
              onRenamePreset={views.renamePreset}
              onDeletePreset={views.deletePreset}
              onSwitchPreset={views.switchPreset}
              onResetActive={views.resetActive}
              onClose={() => setCustomizeOpen(false)}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {views.viewStyle === 'treemap' && (
          <TreemapView currentRow={currentRow} prevRow={prevRow} pctileByKey={pctileByKey}
                       visibleKeys={visibleKeys} onDrill={drill} />
        )}
        {views.viewStyle === 'rings'  && <RingsView  {...common} />}
        {views.viewStyle === 'tug'    && <TugView    {...common} />}
        {views.viewStyle === 'meters' && <MetersView {...common} />}
      </div>
    </div>
  )
}

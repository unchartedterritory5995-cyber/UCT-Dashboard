/**
 * Breadth Views container — owns the date cursor, forward-fill, percentile
 * computation, the useBreadthViews preset hook, and dispatch to the active
 * visualization style. Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { HM_METRICS, PCTILE_KEYS, FFILL_KEYS } from './heatmapMetrics'
import useBreadthViews from './useBreadthViews'
import { drillTarget } from './liveDrill'
import { normalizeMetric, pickSignals } from './views/breadthViewShared'
import { buildDateIndex, resolveSeekIndex } from './views/seek'
import BreadthSignalStrip from './views/BreadthSignalStrip'
import BreadthScrubber from './BreadthScrubber'
import BreadthViewSwitcher from './BreadthViewSwitcher'
import BreadthViewsCustomizePanel from './BreadthViewsCustomizePanel'
import QuickPresetSwitcher from './QuickPresetSwitcher'
import { VIEW_CONFIG, optionsSchema } from './views/viewMetricConfig'
import { VIEW_COMPONENTS } from './views/viewRegistry'
import customizeStyles from './CustomizePanel.module.css'
import signalStyles from './views/signals.module.css'
import UIcon from '../../components/ui/UIcon'

export default function BreadthViews({ rows, onDrill, live = null, liveStamp = null }) {
  // Computed inside the component (not module top-level) to dodge the
  // Breadth.jsx ⇆ BreadthViews circular-import TDZ: HM_METRICS is only
  // initialized by render time, not during module evaluation.
  const ALL_METRICS = useMemo(() => HM_METRICS.filter(m => !m.isHeader), [])
  const views = useBreadthViews(ALL_METRICS)
  const [rowIdx, setRowIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const viewLabel = VIEW_CONFIG[views.viewStyle]?.label ?? views.viewStyle
  const panelMetrics = useMemo(() => views.eligibleMetrics(), [views])

  // ⭐ ONE keydown binding, unchanged from the day the cursor shipped — except
  // that arrow navigation now PAUSES playback. A user reaching for the arrows
  // while the scrubber is running is taking the cursor back; leaving the
  // interval alive would have them fighting it a tick later.
  useEffect(() => {
    const handler = e => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft')  { setPlaying(false); setRowIdx(p => Math.min(p + 1, rows.length - 1)) }
      if (e.key === 'ArrowRight') { setPlaying(false); setRowIdx(p => Math.max(p - 1, 0)) }
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

  // ── the seekable cursor ────────────────────────────────────────────────────
  //
  // ⭐ `onSeek` and `canSeek` are ONE decision asked twice. Both resolve through
  // `resolveSeekIndex`, so a view can render an affordance disabled (canSeek
  // said no) in the certain knowledge that clicking it would have been refused
  // for the same reason. Two independent copies of "is this date reachable?" is
  // how a dead link ships looking live.
  const dateIndex = useMemo(() => buildDateIndex(filledRows), [filledRows])

  const canSeek = useCallback(
    (target) => resolveSeekIndex(target, dateIndex, filledRows.length) != null,
    [dateIndex, filledRows.length],
  )

  // Returns TRUE when the cursor moved, FALSE when the target is unreachable —
  // so a caller that did not ask first still gets an answer instead of a
  // silent no-op. Any manual seek pauses playback.
  const onSeek = useCallback((target) => {
    const idx = resolveSeekIndex(target, dateIndex, filledRows.length)
    if (idx == null) return false
    setPlaying(false)
    setRowIdx(idx)
    return true
  }, [dateIndex, filledRows.length])

  // The playback advance — deliberately NOT `onSeek`, which pauses. The
  // scrubber owns the interval; this is the only door that moves the cursor
  // without stopping the run.
  const stepTo = useCallback((idx) => setRowIdx(idx), [])

  const currentRow = filledRows[rowIdx] ?? filledRows[0]
  const isLiveRow = !!currentRow?._live
  const prevRow = filledRows[rowIdx + 3]
  // Newest-first window up to the current cursor, for time-series styles
  // (Timeline grid, Scoreboard sparklines).
  const recentRows = useMemo(() => filledRows.slice(rowIdx, rowIdx + 30), [filledRows, rowIdx])

  // ⚠️ DELIBERATELY OVER ALL LOADED ROWS, NOT `rows.slice(rowIdx)` — and that is
  // the one place on this tab where the cursor is ignored on purpose.
  //
  // This is the BOARD-level normalizer: `normalizeMetric` uses it to put a
  // dozen metrics with different units onto one 0..100 scale so Rings, Radar,
  // Meters and Levels can be read side by side, and `pickSignals` compares them
  // against each other. That scale has to be the same object whichever session
  // the cursor sits on, or scrubbing back a day silently re-scales every board
  // and a metric's ring appears to move when only its yardstick did.
  //
  // `PercentileLadderView` asks a DIFFERENT question — "where does today sit in
  // its own history?" — which is a claim about the past, so it slices at the
  // cursor (`rows.slice(rowIdx)`) and would be reading the future if it did
  // not. Both are right; the difference is not an oversight, and the ladder is
  // not the one to "fix".
  const pctileByKey = useMemo(() => {
    const out = {}
    for (const k of PCTILE_KEYS) {
      const vals = rows.map(r => r[k]).filter(v => v != null && !isNaN(Number(v)))
      if (vals.length > 1) out[k] = vals.map(Number).sort((a, b) => a - b)
    }
    return out
  }, [rows])

  // The live row's lists now exist — `/live/drill` serves them from the same
  // masks that produced the counts. What is still NOT drillable live is a
  // CARRIED metric with no session to attribute its names to, so `drillTarget`
  // decides per metric and `drillKey` is dropped only where it says no. Same
  // decision the monitor table makes, from the same module, so the two surfaces
  // cannot disagree about a cell.
  const visibleMetrics = useMemo(() => {
    const shown = ALL_METRICS.filter(m => views.visibleKeys.has(m.key))
    if (!isLiveRow) return shown
    return shown.map(m => {
      if (drillTarget(currentRow, m, live)) return m
      const stripped = { ...m }
      delete stripped.drillKey
      return stripped
    })
  }, [ALL_METRICS, views.visibleKeys, isLiveRow, currentRow, live])
  const visibleKeys = useMemo(() => new Set(visibleMetrics.map(m => m.key)), [visibleMetrics])
  const normalize = useMemo(
    () => (metric, row) => normalizeMetric(metric, row, pctileByKey),
    [pctileByKey],
  )

  // Signal of the Day + auto-notable divergence, computed once and shared across
  // every style (rendered consistently in the strip + highlighted inline per view).
  const signals = useMemo(
    () => pickSignals(visibleMetrics, currentRow, prevRow, pctileByKey),
    [visibleMetrics, currentRow, prevRow, pctileByKey],
  )
  const signalMetric  = useMemo(() => visibleMetrics.find(m => m.key === signals.signalKey) ?? null, [visibleMetrics, signals.signalKey])
  const notableMetric = useMemo(() => visibleMetrics.find(m => m.key === signals.notableKey) ?? null, [visibleMetrics, signals.notableKey])

  // Views call onDrill(metric); Breadth's openDrill expects (row, metric, live).
  // Bridge here so view components stay row-agnostic.
  //
  // The refusal below is deliberately NOT `if (!isLiveRow)` any more, but it is
  // still a refusal: a view that ignores `drillKey` and drills anything it can
  // click would otherwise open a carried metric's list with no date to caption
  // it. `drillTarget` returning null is the same answer, checked twice.
  const drill = useMemo(
    () => (metric) => {
      if (drillTarget(currentRow, metric, live)) onDrill(currentRow, metric, live)
    },
    [onDrill, currentRow, live],
  )

  if (!currentRow) return null

  const ActiveView = VIEW_COMPONENTS[views.viewStyle]
  const activeKind = VIEW_CONFIG[views.viewStyle]?.kind ?? 'board'

  const viewProps = activeKind === 'lens'
    ? { rows: filledRows, currentRow, prevRow, rowIdx, onDrill: drill,
        onSeek, canSeek, options: views.options }
    : {
        currentRow, prevRow, recentRows, rows: filledRows, rowIdx,
        metrics: visibleMetrics, normalize, onDrill: drill, onSeek, canSeek,
        signalKey: signals.signalKey, notableKey: signals.notableKey,
        options: views.options, pctileByKey, visibleKeys,
      }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', flexWrap: 'wrap' }}>
        <BreadthViewSwitcher viewStyle={views.viewStyle} onSelect={views.setViewStyle} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => onSeek(rowIdx + 1)}
                  disabled={rowIdx >= rows.length - 1} aria-label="Previous day">←</button>
          {currentRow._live ? (
            <span
              data-testid="cursor-live"
              className={signalStyles.liveTag}
              title={`Provisional — computed ${liveStamp ?? 'now'} ET. The 4:15 PM `
                + `collector writes the day's authoritative reading.`}
            >
              <span className={signalStyles.livePulse} aria-hidden="true" />
              LIVE · {liveStamp ?? 'now'}
            </span>
          ) : (
            <span data-testid="cursor-date"
                  style={{ font: '600 12px Instrument Sans, sans-serif', color: '#cbd5e1' }}>{currentRow.date}</span>
          )}
          <button onClick={() => onSeek(rowIdx - 1)}
                  disabled={rowIdx === 0} aria-label="Next day">→</button>
          {rowIdx > 0 && <button onClick={() => onSeek(0)}>LATEST</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <QuickPresetSwitcher presetNames={views.presetNames}
                               activePreset={views.activePreset} onSwitch={views.switchPreset} />
          <div className={customizeStyles.anchor}>
            <button className={`${customizeStyles.triggerBtn} ${customizeOpen ? customizeStyles.triggerBtnActive : ''}`}
                    onClick={() => setCustomizeOpen(o => !o)} title="Customize this view">
              <span className={customizeStyles.triggerIcon}><UIcon name="gear" size={13} /></span> {viewLabel}
              {!views.isDefaultActive ? ` · ${views.activePreset}` : ''}
            </button>
            {customizeOpen && (
              <BreadthViewsCustomizePanel
                viewLabel={viewLabel}
                metrics={panelMetrics}
                optionsSchema={optionsSchema(views.viewStyle)}
                options={views.options}
                activePreset={views.activePreset}
                visibleKeys={views.visibleKeys}
                presetNames={views.presetNames}
                isDefaultActive={views.isDefaultActive}
                onToggleVisible={views.toggleVisible}
                onSetOption={views.setOption}
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
      </div>

      <BreadthScrubber
        rows={filledRows} rowIdx={rowIdx} playing={playing}
        onSeek={onSeek} onStep={stepTo} onPlayingChange={setPlaying}
      />

      <BreadthSignalStrip
        signalMetric={signalMetric} signalReason={signals.signalReason}
        notableMetric={notableMetric} notableReason={signals.notableReason}
        currentRow={currentRow} onDrill={drill}
      />

      <div style={{ flex: 1, minHeight: 0 }}>
        {ActiveView && <ActiveView {...viewProps} />}
      </div>
    </div>
  )
}

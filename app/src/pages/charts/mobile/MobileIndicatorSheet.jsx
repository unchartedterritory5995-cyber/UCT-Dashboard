import { useMemo, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import * as engineRegistry from '../../../components/chart/engine/nativeRegistry'
import { catalogRows, userCatalogRows, catalogGeneration } from '../../../components/chart/indicatorCatalog'
import { isRowOn, toggledRow } from '../../../components/chart/IndicatorLibraryDialog'
import { fieldFromInput } from '../../../components/chart/indicatorRegistry'
import { setInstanceInput } from '../../../components/chart/engine/instanceControls'
import { isInstanceTombstone } from '../../../components/chart/instanceShape'
import styles from './MobileCharts.module.css'

// Preset swatches for the phone param editors — the desktop ColorPicker's
// anchored popover doesn't fit a bottom sheet; eight good lines cover it.
const SWATCHES = ['#7b68ee', '#38bdf8', '#f472b6', '#c9a84c', '#4ade80', '#f87171', '#e0dac8', '#fb923c']

/** First LIVE instance of a definition in the RESOLVED settings — the one the
 *  chart is drawing and the one a param edit must land on. */
function liveInstanceOf(cs, defId) {
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return list.find((i) => i && typeof i === 'object' && !isInstanceTombstone(i) && i.defId === defId) || null
}

/** Stepper row for an int/float input — the TradingView-mobile idiom: big −/+
 *  around the value, clamped to the definition's declared range. The VALUE is
 *  tappable (wave 11): it opens an inline numeric input, because a stepper
 *  alone made period 20→200 a 180-tap trip. Commit on Enter/blur clamps to the
 *  declared range; Escape abandons the draft. */
function StepRow({ label, value, min, max, step = 1, onChange }) {
  const v = Number(value)
  const [draft, setDraft] = useState(null)   // null = showing the value, string = typing
  const dec = () => onChange(Math.max(min ?? -Infinity, +(v - step).toFixed(4)))
  const inc = () => onChange(Math.min(max ?? Infinity, +(v + step).toFixed(4)))
  const commit = () => {
    if (draft == null) return
    const n = parseFloat(draft)
    setDraft(null)
    if (!Number.isFinite(n)) return
    onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)))
  }
  return (
    <div className={styles.paramRow}>
      <span className={styles.indName}>{label}</span>
      <div className={styles.stepper}>
        <button type="button" className={styles.stepBtn} onClick={dec} aria-label={`Decrease ${label}`}>−</button>
        {draft == null ? (
          <button
            type="button"
            className={styles.stepVal}
            onClick={() => setDraft(String(value))}
            aria-label={`Type ${label}`}
          >{value}</button>
        ) : (
          <input
            className={styles.stepInput}
            type="number"
            inputMode="decimal"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Enter commits. Escape clears the draft — the topmost Sheet
              // ALSO answers Escape on its own document listener (sibling
              // listeners are unstoppable by design — see Sheet.jsx), so the
              // editor closes too: draft abandoned, nothing written. Phones
              // have no Escape key; this is desktop-keyboard courtesy only.
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setDraft(null)
            }}
            aria-label={label}
          />
        )}
        <button type="button" className={styles.stepBtn} onClick={inc} aria-label={`Increase ${label}`}>+</button>
      </div>
    </div>
  )
}

/** Enum input as wrap-friendly chips — covers 3-option line styles and the
 *  7-anchor AVWAP list alike. Options are `[value, label]` pairs normalized by
 *  the desktop's own `fieldFromInput` (one type-vocabulary authority — a
 *  hand-copied option list here is how a pickable value the compute refuses
 *  gets shipped). Writes the RAW typed value, never the label. */
function ChipRow({ label, value, options, onChange }) {
  return (
    <div className={styles.paramRow}>
      <span className={styles.indName}>{label}</span>
      <div className={styles.chipsWrap}>
        {options.map(([val, lab]) => (
          <button
            key={String(val)}
            type="button"
            className={`${styles.chipOpt} ${value === val ? styles.chipOptOn : ''}`}
            onClick={() => onChange(val)}
            aria-pressed={value === val}
          >{lab}</button>
        ))}
      </div>
    </div>
  )
}

function SwatchRow({ label, value, onChange }) {
  return (
    <div className={styles.paramRow}>
      <span className={styles.indName}>{label}</span>
      <div className={styles.swatches}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.swatch} ${String(value).toLowerCase() === c ? styles.swatchOn : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={`${label} ${c}`}
          />
        ))}
      </div>
    </div>
  )
}

/* Quick indicator control — the moving-average overlay slots as iOS switches,
 * a STUDIES section (below), plus the two doors deeper: the full Indicator
 * Library (the SAME dialog the chart toolbar owns, reached through StockChart's
 * toolbarApiRef — never a second mount) and the full settings modal.
 *
 * ⚠️ cs.overlays is POSITIONAL (chartDefaults merges stored blobs by index), so
 * rows are toggled by index and the array is never filtered or reordered here.
 */

/* The studies a trader reaches for most, one switch each — TradingView mobile's
 * add-RSI is two taps and this matches it (ƒx → switch) instead of routing the
 * common case through the full library dialog. Everything else stays one tap
 * deeper behind "Browse indicator library…". The section also unions in ANY
 * other study currently ON (library adds, member formulas, carved-out rows), so
 * what this sheet shows always agrees with the toolbar's ƒx badge — a running
 * study the sheet hides would read as a badge counting ghosts. */
const QUICK_STUDY_IDS = ['rsi', 'macd', 'bb', 'vwap', 'atr', 'stoch']

export default function MobileIndicatorSheet({ open, onClose, cs, onWrite, onBrowseLibrary, onOpenSettings, className = '', initialEditing = null }) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []
  // Wave 8: tap a row's NAME to edit its parameters in a stacked mini-sheet —
  // period/color without the trip through the desktop settings modal.
  // null | {kind:'ma', idx} | {kind:'study', defId, instanceId?}
  const [editing, setEditing] = useState(null)
  // Wave 10: a legend-chip tap opens this sheet ALREADY INSIDE the tapped
  // study's editor. The sheet stays mounted across opens (visibility is the
  // `open` prop), so a bare useState seed would fire once ever — this is the
  // codebase's render-time prop-change adjustment instead of an effect.
  const [seenInitial, setSeenInitial] = useState(null)
  if (initialEditing !== seenInitial) {
    setSeenInitial(initialEditing)
    if (initialEditing) setEditing(initialEditing)
  }

  const toggle = (idx) => {
    haptics.tap()
    const next = overlays.map((o, i) => (i === idx ? { ...o, enabled: !o.enabled } : o))
    onWrite({ ...cs, overlays: next, preset: 'custom' })
  }

  const writeOverlay = (idx, patch) => {
    const next = overlays.map((o, i) => (i === idx ? { ...o, ...patch } : o))
    onWrite({ ...cs, overlays: next, preset: 'custom' })
  }

  // The instance an edit lands on. A legend-chip tap names the EXACT instance
  // (two MACDs → the tapped one); name-taps from this sheet's own rows fall
  // back to the first live instance. editTarget and the write door MUST share
  // this — resolving them differently writes one instance while showing another.
  const editInstanceOf = (defId, instanceId) => {
    const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
    const byId = instanceId
      ? list.find((i) => i && typeof i === 'object' && !isInstanceTombstone(i) && i.instanceId === instanceId && i.defId === defId)
      : null
    return byId || liveInstanceOf(cs, defId)
  }

  // ONE write door per param — instanceControls' setInstanceInput validates
  // against the definition and refuses (identity return) anything the engine
  // would drop, so a bad value can never vanish an indicator.
  const writeStudyInput = (defId, key, value) => {
    const inst = editInstanceOf(defId, editing?.instanceId)
    if (!inst) return
    const next = setInstanceInput(cs, inst.instanceId, key, value, engineRegistry)
    if (next !== cs) onWrite({ ...next, preset: 'custom' })
  }

  // Same union + generation discipline as IndicatorLibraryDialog: the registry
  // module namespace never changes identity, so a memo keyed on it alone would
  // miss user-formula installs — `catalogGeneration` is the recompute key.
  const generation = catalogGeneration(engineRegistry)
  const rows = useMemo(
    () => [...catalogRows(engineRegistry), ...userCatalogRows(engineRegistry)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation],
  )
  const studyRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const quick = QUICK_STUDY_IDS.map((id) => byId.get(id)).filter(Boolean)
    const extras = rows.filter((r) => !QUICK_STUDY_IDS.includes(r.id) && isRowOn(r, cs))
    return [...quick, ...extras]
  }, [rows, cs])

  // ONE write door for a flipped study — the same `toggledRow` the library
  // dialog commits through, so this switch and that checkbox can never disagree
  // about what a toggle does. Identity return = refused write = persist nothing.
  const toggleStudy = (row) => {
    haptics.tap()
    const next = toggledRow(row, cs, engineRegistry)
    if (next !== cs) onWrite({ ...next, preset: 'custom' })
  }

  // The stacked param editor (portal order puts the LAST panel on top).
  const editTarget = (() => {
    if (!editing) return null
    if (editing.kind === 'ma') {
      const o = overlays[editing.idx]
      return o ? { title: `${o.type || 'MA'} ${o.period}`, o } : null
    }
    const def = engineRegistry.getDefinition(editing.defId)
    const inst = editInstanceOf(editing.defId, editing.instanceId)
    return def && inst ? { title: def.meta?.name || def.id, def, inst } : null
  })()

  return (
    <>
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Indicators" ariaLabel="Indicators" className={className}>
      <div className={styles.sheetList}>
        <div className={styles.sectionLabel}>Moving averages</div>
        {overlays.map((o, i) => (
          <div key={i} className={styles.indRow}>
            <button
              type="button"
              className={styles.indNameBtn}
              onClick={() => setEditing({ kind: 'ma', idx: i })}
              aria-label={`Edit ${o.type || 'MA'} ${o.period}`}
            >
              <span className={styles.indDot} style={{ background: o.color || 'var(--text-dim)' }} aria-hidden="true" />
              <span className={styles.indName}>{o.type || 'MA'} {o.period}</span>
              <span className={styles.rowRight}><UIcon name="chevronRight" size={13} gold={false} /></span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={!!o.enabled}
              aria-label={`${o.type || 'MA'} ${o.period}`}
              className={`${styles.switch} ${o.enabled ? styles.switchOn : ''}`}
              onClick={() => toggle(i)}
            >
              <span className={styles.knob} />
            </button>
          </div>
        ))}

        <div className={styles.sectionLabel}>Studies</div>
        {studyRows.map((r) => {
          const on = isRowOn(r, cs)
          const editable = on && !r.carvedOut && liveInstanceOf(cs, r.id)
          return (
            <div key={r.id} className={styles.indRow}>
              <button
                type="button"
                className={styles.indNameBtn}
                onClick={() => (editable ? setEditing({ kind: 'study', defId: r.id }) : toggleStudy(r))}
                aria-label={editable ? `Edit ${r.name}` : r.name}
              >
                <span className={styles.indName}>
                  {r.name}
                  {r.sessionOnly && <span className={styles.indNote}> · intraday</span>}
                </span>
                {editable && <span className={styles.rowRight}><UIcon name="chevronRight" size={13} gold={false} /></span>}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={r.name}
                className={`${styles.switch} ${on ? styles.switchOn : ''}`}
                onClick={() => toggleStudy(r)}
              >
                <span className={styles.knob} />
              </button>
            </div>
          )
        })}

        <div className={styles.sectionLabel}>More</div>
        <button
          type="button"
          className={styles.row}
          disabled={!onBrowseLibrary}
          onClick={() => { onClose(); onBrowseLibrary?.() }}
        >
          <span className={styles.rowIcon}><UIcon name="library" size={17} gold={false} /></span>
          <span className={styles.rowLabel}>Browse indicator library…</span>
          <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
        </button>
        <button
          type="button"
          className={styles.row}
          onClick={() => { onClose(); onOpenSettings?.() }}
        >
          <span className={styles.rowIcon}><UIcon name="gear" size={17} gold={false} /></span>
          <span className={styles.rowLabel}>All chart settings…</span>
          <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
        </button>
      </div>
    </Sheet>

    <Sheet
      open={!!(open && editTarget)}
      onClose={() => setEditing(null)}
      variant="bottom-sheet"
      title={editTarget?.title || ''}
      ariaLabel={`${editTarget?.title || 'Indicator'} settings`}
      className={className}
    >
      <div className={styles.sheetList}>
        {editing?.kind === 'ma' && editTarget?.o && (
          <>
            <div className={styles.paramRow}>
              <span className={styles.indName}>Average type</span>
              <div className={styles.segRow} role="radiogroup" aria-label="Average type">
                {['SMA', 'EMA'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={(editTarget.o.type || 'SMA') === t}
                    className={`${styles.segBtn} ${(editTarget.o.type || 'SMA') === t ? styles.segBtnOn : ''}`}
                    onClick={() => writeOverlay(editing.idx, { type: t })}
                  >{t}</button>
                ))}
              </div>
            </div>
            <StepRow
              label="Period"
              value={editTarget.o.period}
              min={1}
              max={400}
              onChange={(v) => writeOverlay(editing.idx, { period: v })}
            />
            <SwatchRow
              label="Color"
              value={editTarget.o.color}
              onChange={(c) => writeOverlay(editing.idx, { color: c })}
            />
          </>
        )}

        {editing?.kind === 'study' && editTarget?.def && (
          <>
            {(editTarget.def.inputs || []).map((inp) => {
              const cur = editTarget.inst.inputs?.[inp.key] ?? inp.default
              if (inp.type === 'int' || inp.type === 'float') {
                return (
                  <StepRow
                    key={inp.key}
                    label={inp.label || inp.key}
                    value={cur}
                    min={inp.min}
                    max={inp.max}
                    step={inp.step || (inp.type === 'float' ? 0.1 : 1)}
                    onChange={(v) => writeStudyInput(editing.defId, inp.key, v)}
                  />
                )
              }
              if (inp.type === 'color') {
                return (
                  <SwatchRow
                    key={inp.key}
                    label={inp.label || inp.key}
                    value={cur}
                    onChange={(c) => writeStudyInput(editing.defId, inp.key, c)}
                  />
                )
              }
              if (inp.type === 'bool') {
                return (
                  <div key={inp.key} className={styles.paramRow}>
                    <span className={styles.indName}>{inp.label || inp.key}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!cur}
                      aria-label={inp.label || inp.key}
                      className={`${styles.switch} ${cur ? styles.switchOn : ''}`}
                      onClick={() => writeStudyInput(editing.defId, inp.key, !cur)}
                    >
                      <span className={styles.knob} />
                    </button>
                  </div>
                )
              }
              // Anything else goes through the desktop's own type→field mapper
              // (indicatorRegistry.fieldFromInput) rather than a fourth hand-
              // written copy of the type vocabulary. Today that catches `enum`
              // (AVWAP's anchor, VWAP/AVWAP line style, RS Line's benchmark) —
              // inputs this editor silently DROPPED before, worst of them the
              // anchor that defines what AVWAP is.
              const field = fieldFromInput(inp)
              if (field?.type === 'select') {
                return (
                  <ChipRow
                    key={inp.key}
                    label={field.label}
                    value={cur}
                    options={field.options}
                    onChange={(v) => writeStudyInput(editing.defId, inp.key, v)}
                  />
                )
              }
              return null
            })}
            <button
              type="button"
              className={`${styles.row} ${styles.removeRow}`}
              onClick={() => {
                const r = studyRows.find((x) => x.id === editing.defId)
                if (r) toggleStudy(r)
                setEditing(null)
              }}
            >
              <span className={styles.rowIcon}><UIcon name="trash" size={16} gold={false} /></span>
              <span className={styles.rowLabel}>Remove from chart</span>
            </button>
          </>
        )}
      </div>
    </Sheet>
    </>
  )
}

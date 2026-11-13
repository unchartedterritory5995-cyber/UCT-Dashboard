import { useMemo, useState, useId, useSyncExternalStore } from 'react'
import OptionsSourcePicker from '../../../components/chart/OptionsSourcePicker'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import * as engineRegistry from '../../../components/chart/engine/nativeRegistry'
import { catalogRows, userCatalogRows, catalogGeneration } from '../../../components/chart/indicatorCatalog'
import { isRowOn, toggledRow, rowVisibility } from '../../../components/chart/IndicatorLibraryDialog'
import { fieldsForInstance, evalActiveWhen, sectionize, initialCollapsed,
         visiblePresets, textInputCommit, textInputDraft } from '../../../components/chart/indicatorRegistry'
// ⭐ UCT RS Phase 3, unit 3-02 — what the LIVE server row declares (the gate).
import { serverDeclares, subscribeServerDefinitions,
         // ⭐ RS split U1 — the definition-level gate for the sheet's add list.
         isCatalogRowOffered, serverDefinitionsVersion } from '../../../components/chart/engine/serverCompute'
import { setInstanceInput, removeInstance, applyPresetInputs,
         presetsOf, detectPreset, CUSTOM_PRESET,
         saveInstanceAsDefault, resetInstanceToUctDefault, memberDefaultState } from '../../../components/chart/engine/instanceControls'
import { memberDefaultNote, saveDefaultIsNoop, SAVE_DEFAULT_LABEL, RESET_DEFAULT_LABEL } from '../../../components/chart/memberDefaultCopy'
import IndicatorHistoryButtons from '../../../components/chart/IndicatorHistoryButtons'
import UnavailableIndicators from '../../../components/chart/UnavailableIndicators'
import { isInstanceTombstone } from '../../../components/chart/instanceShape'
import { useChartIqAllowed } from '../../../components/chart/chartIq/chartIqGate'
import Switch from '../../../components/ui/Switch'
import styles from './MobileCharts.module.css'

// Preset swatches for the phone param editors — the desktop ColorPicker's
// anchored popover doesn't fit a bottom sheet; eight good lines cover it.
const SWATCHES = ['#7b68ee', '#38bdf8', '#f472b6', '#c9a84c', '#4ade80', '#f87171', '#e0dac8', '#fb923c']

// ─── STACKED ROWS (UCT RS Phase 2a visual, A5b / A5c) ─────────────────────────
//
// A chip row whose options cannot sit beside their label on a 390 px screen
// STACKS: the label on its own line, the chips under it, left-aligned and
// wrapping. The rule is generic to the sheet's chip rows and reads the options,
// never a key name: more than three options, or any option label longer than
// twelve characters. So the RS Preset (seven) and Benchmark (six) rows stack and
// Average type (Exponential / Simple) stays inline. ⚰️ Before this a long row
// right-aligned its chips into a 70% column and printed one chip per line.
const CHIP_STACK_MAX_OPTIONS = 3
const CHIP_STACK_MAX_LABEL = 12

/** Does a chip row with these option labels stack under its label? */
function chipRowStacks(labels) {
  const list = Array.isArray(labels) ? labels : []
  return list.length > CHIP_STACK_MAX_OPTIONS || list.some((l) => String(l ?? '').length > CHIP_STACK_MAX_LABEL)
}

/**
 * The swatches a colour row offers: the input's CURRENT colour when the palette
 * does not hold it, then the definition DEFAULT when it differs, then the eight
 * palette colours, deduped case-insensitively. ⭐ So the row always shows, and can
 * mark, what the chart is drawing: UCT RS's `#6ba3be` and `#8a8574` are not in the
 * palette, and before this a fresh RS editor showed eight swatches and marked none.
 * Only a CSS-safe colour becomes a swatch (`safeCssColour`); the values come back
 * lower-cased, which is the comparison `SwatchRow` marks the current one by.
 */
function swatchSet(current, fallback) {
  const out = []
  const seen = new Set()
  const add = (c) => {
    const css = safeCssColour(c)
    if (!css) return
    const k = css.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(k)
  }
  const inPalette = (c) => typeof c === 'string' && SWATCHES.includes(c.trim().toLowerCase())
  for (const c of [current, fallback]) if (!inPalette(c)) add(c)
  for (const c of SWATCHES) add(c)
  return out
}

/** First LIVE instance of a definition in the RESOLVED settings — the one the
 *  chart is drawing and the one a param edit must land on. */
function liveInstanceOf(cs, defId) {
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return list.find((i) => i && typeof i === 'object' && !isInstanceTombstone(i) && i.defId === defId) || null
}

// ─── THE PRESET STATE (UCT RS Phase 2a, unit 2a-11 → 2a-15) ─────────────────
//
// `presetsOf`, `detectPreset` and `CUSTOM_PRESET` are the ENGINE's
// (`instanceControls.js`, since unit 2a-12), read by this sheet and the desktop
// dialog alike. Unit 2a-11 carried verbatim copies here because it could not
// edit the dialog they lived in; unit 2a-15 collapsed the pair into that one
// export. The rule is unchanged: a preset matches when EVERY key it declares
// equals the resolved value; the first match wins; a preset with no keys never
// matches. Nothing is stored on the instance — "which preset is this" is
// derived from the instance, so it cannot drift from the chart. The sheet passes
// the engine's third `{instance, def, cs}` argument, so a preset's non-input
// fields (visibility, dot size, display target) must match too, exactly as in
// the desktop dialog. (U8 #27, 2026-11-07: it used to pass none and read inputs
// alone, so after Trend plus a Large dot the dialog said Custom and the phone
// still pressed Trend.)

// ─── ONE FIELD ROW ───────────────────────────────────────────────────────────
//
// Every editor row is a `ParamRow`: the label-and-control line (`.paramRow`,
// unchanged) and, under it, the input's `tooltip` as plain help text — there is
// no hover on a phone, so the help is always visible and reaches assistive
// tech through `aria-describedby` on the controls, never through their name.
//
// ⛔ `activeWhen` DIMS, NEVER REMOVES. A control that vanishes teaches the
// member it does not exist; one that is visibly inert teaches them what to
// change first. The row keeps its place and its text at reduced opacity, the
// controls are `disabled` + `aria-disabled`, and `data-active` says which.
function ParamRow({ inputKey, label, labelId, tip, tipId, active = true, stacked = false, miss = null, missId = null, children }) {
  return (
    <div
      className={`${styles.paramField} ${active ? '' : styles.paramFieldOff}`}
      data-input-key={inputKey}
      data-active={active ? 'true' : 'false'}
      role="group"
      aria-labelledby={labelId}
      aria-disabled={active ? undefined : 'true'}
      data-stacked={stacked ? 'true' : undefined}
    >
      <div className={`${styles.paramRow} ${stacked ? styles.paramRowStacked : ''}`}>
        <span className={styles.indName} id={labelId}>{label}</span>
        {children}
      </div>
      {tip && <span className={styles.paramTip} id={tipId}>{tip}</span>}
      {miss && <span className={`${styles.paramTip} ${styles.paramMiss}`} id={missId} role="status">{miss}</span>}
    </div>
  )
}

/** The aria every control in a row shares: its help text and its inert state. */
const controlAria = (tipId, active) => ({
  ...(tipId ? { 'aria-describedby': tipId } : null),
  disabled: !active,
  'aria-disabled': String(!active),
})

/** Stepper row for an int/float input — the TradingView-mobile idiom: big −/+
 *  around the value, clamped to the definition's declared range. The VALUE is
 *  tappable (wave 11): it opens an inline numeric input, because a stepper
 *  alone made period 20→200 a 180-tap trip. Commit on Enter/blur clamps to the
 *  declared range; Escape abandons the draft. */
function StepRow({ inputKey, label, labelId, tip, tipId, active = true, value, min, max, step = 1, onChange }) {
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
  const aria = controlAria(tipId, active)
  return (
    <ParamRow inputKey={inputKey} label={label} labelId={labelId} tip={tip} tipId={tipId} active={active}>
      <div className={styles.stepper}>
        <button type="button" className={styles.stepBtn} onClick={dec} aria-label={`Decrease ${label}`} {...aria}>−</button>
        {draft == null ? (
          <button
            type="button"
            className={styles.stepVal}
            onClick={() => setDraft(String(value))}
            aria-label={`Type ${label}`}
            {...aria}
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
            {...aria}
          />
        )}
        <button type="button" className={styles.stepBtn} onClick={inc} aria-label={`Increase ${label}`} {...aria}>+</button>
      </div>
    </ParamRow>
  )
}

/** Enum input as wrap-friendly chips — covers 3-option line styles and the
 *  7-anchor AVWAP list alike. Options are `[value, label]` pairs normalized by
 *  the desktop's own `fieldFromInput` (one type-vocabulary authority — a
 *  hand-copied option list here is how a pickable value the compute refuses
 *  gets shipped). Writes the RAW typed value, never the label. */
function ChipRow({ inputKey, label, labelId, tip, tipId, active = true, value, options, onChange }) {
  const aria = controlAria(tipId, active)
  const stacked = chipRowStacks(options.map(([, lab]) => lab))
  return (
    <ParamRow inputKey={inputKey} label={label} labelId={labelId} tip={tip} tipId={tipId} active={active} stacked={stacked}>
      <div className={`${styles.chipsWrap} ${stacked ? styles.chipsStacked : ''}`}>
        {options.map(([val, lab, extra]) => {
          // ⭐ 3-02 — `{disabled: true}` is a STORED gated value the live server does
          // not declare (`fieldsForInstance`): pressed, so the row tells the truth,
          // and inert, so it cannot be chosen again.
          const unavailable = !!(extra && extra.disabled)
          return (
            <button
              key={String(val)}
              type="button"
              className={`${styles.chipOpt} ${value === val ? styles.chipOptOn : ''}`}
              onClick={() => { if (!unavailable) onChange(val) }}
              aria-pressed={value === val}
              {...aria}
              disabled={!active || unavailable}
              aria-disabled={String(!active || unavailable)}
              data-unavailable={unavailable ? 'true' : undefined}
            >{lab}</button>
          )
        })}
      </div>
    </ParamRow>
  )
}

/** A colour row. ⭐ STACKED, ALWAYS (A5c): the label on its own line, the swatches
 *  under it, so "Line below avg" never wraps beside eight circles. Each swatch is a
 *  44 px button around a 30 px circle (the circle is the `::before`, painted from
 *  `--sw`), and exactly one is marked — `aria-pressed` plus the ring — because
 *  `swatchSet` always includes the current colour. `fallback` is the definition's
 *  declared default, offered so a member can get back to it. */
function SwatchRow({ inputKey, label, labelId, tip, tipId, active = true, value, fallback, onChange }) {
  const aria = controlAria(tipId, active)
  const current = String(value ?? '').trim().toLowerCase()
  return (
    <ParamRow inputKey={inputKey} label={label} labelId={labelId} tip={tip} tipId={tipId} active={active} stacked>
      <div className={`${styles.swatches} ${styles.swatchesStacked}`}>
        {swatchSet(value, fallback).map((c) => {
          const on = current === c
          return (
            <button
              key={c}
              type="button"
              className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
              style={{ '--sw': c }}
              data-colour={c}
              onClick={() => onChange(c)}
              aria-label={`${label} ${c}`}
              aria-pressed={on}
              {...aria}
            />
          )
        })}
      </div>
    </ParamRow>
  )
}

/** ⭐ UCT RS Phase 3, unit 3-02 — a `string` input as a text box, the phone half
 *  of the dialog's control. Commits on Enter or blur, and only a value the input
 *  accepts (`textInputCommit`: trimmed, upper-cased when told to, then the
 *  engine's own `validateInputValue`); a miss writes NOTHING, keeps the typed text
 *  so it can be fixed, marks the box `aria-invalid` and prints the input's own
 *  `hint` as a muted line under the row. The box is 44 px tall (the tap floor)
 *  with 16 px text, or iOS zooms on focus. */
function TextRow({ inputKey, label, labelId, tip, tipId, active = true, value, field, onChange }) {
  const [draft, setDraft] = useState(null)   // null = showing the stored value
  const [miss, setMiss] = useState(null)
  const missId = `${labelId}-miss`
  const stored = value == null ? '' : String(value)
  const commit = () => {
    if (draft == null) return
    const c = textInputCommit(field, draft)
    if (!c.ok) { setMiss(c.hint); return }
    setDraft(null)
    setMiss(null)
    if (c.value !== stored) onChange(c.value)
  }
  const aria = controlAria(tipId, active)
  return (
    <ParamRow inputKey={inputKey} label={label} labelId={labelId} tip={tip} tipId={tipId} active={active}
      miss={miss} missId={missId}>
      <input
        type="text"
        className={styles.textInput}
        aria-labelledby={labelId}
        {...aria}
        aria-describedby={[tipId, miss ? missId : null].filter(Boolean).join(' ') || undefined}
        aria-invalid={miss ? 'true' : undefined}
        placeholder={field.placeholder}
        maxLength={Number.isInteger(field.maxLength) ? field.maxLength : undefined}
        autoCapitalize={field.case === 'upper' ? 'characters' : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        value={draft == null ? stored : draft}
        onChange={(e) => {
          const text = textInputDraft(field, e.target.value)
          setDraft(text)
          if (miss && textInputCommit(field, text).ok) setMiss(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
    </ParamRow>
  )
}

/** ⭐ 2026-11-12 — a `string` input naming a server-owned list (`optionsSource`,
 *  the RS "Pick a theme" benchmark): the shared searchable chooser, the same one
 *  the dialog and the inspector render, in the text box's 44 px / 16 px chrome.
 *  One write per pick. */
function PickRow({ inputKey, label, labelId, tip, tipId, active = true, value, field, onChange }) {
  const aria = controlAria(tipId, active)
  return (
    // stacked: the label above, the chooser and its list the row's full width
    <ParamRow inputKey={inputKey} label={label} labelId={labelId} tip={tip} tipId={tipId} active={active} stacked>
      <OptionsSourcePicker
        field={field} value={value == null ? '' : String(value)} disabled={!active}
        inputClassName={`${styles.textInput} ${styles.pickInput}`}
        idBase={`${labelId}-pick`}
        aria={{ 'aria-labelledby': labelId, ...aria }}
        onPick={onChange}
      />
    </ParamRow>
  )
}

/** Bool input as the sheet's iOS-style switch. */
function SwitchRow({ inputKey, label, labelId, tip, tipId, active = true, value, onChange }) {
  const aria = controlAria(tipId, active)
  return (
    <ParamRow inputKey={inputKey} label={label} labelId={labelId} tip={tip} tipId={tipId} active={active}>
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        aria-label={label}
        className={`${styles.switch} ${value ? styles.switchOn : ''}`}
        onClick={() => onChange(!value)}
        {...aria}
      >
        <span className={styles.knob} />
      </button>
    </ParamRow>
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
// ⭐ The default averages are `movingAverage` INSTANCES (`maAdoption.js`); this
// sheet still lists them by slot, reading and writing through the adopted
// instance so the switch here and the chart agree.
import { averageSlotView, writeAverageSlot, MA_DEF_ID } from '../../../components/chart/maAdoption'
import { safeCssColour } from '../../../components/chart/engine/objectColour'

const QUICK_STUDY_IDS = ['rsi', 'macd', 'bb', 'vwap', 'atr', 'stoch']

export default function MobileIndicatorSheet({ open, onClose, cs, onWrite, onBrowseLibrary, onOpenSettings, className = '', initialEditing = null, historyKey = null, historyUserId = null }) {
  const uid = useId()
  const chartIqAllowed = useChartIqAllowed()
  const overlays = averageSlotView(cs)
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
    const o = overlays[idx]
    if (!o) return
    const next = writeAverageSlot(cs, idx, 'enabled', !o.enabled)
    if (next !== cs) onWrite({ ...next, preset: 'custom' })
  }

  const writeOverlay = (idx, patch) => {
    let next = cs
    for (const [field, value] of Object.entries(patch)) next = writeAverageSlot(next, idx, field, value)
    if (next !== cs) onWrite({ ...next, preset: 'custom' })
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
  // ⭐ RS split U1 — a `meta.requiresServer` definition is OFFERED only once the
  // live server lists it (`isCatalogRowOffered`, the same fail-closed fetch as
  // `declared` below); `serverVersion` re-lists the moment the answer lands.
  // ⛔ THE GATE IS ON THE OFFER, NEVER ON A RUNNING STUDY: `extras` unions in
  // every study that is ON so the ƒx badge never counts ghosts, and a gated
  // study a member already placed stays listed exactly as it draws.
  const serverVersion = useSyncExternalStore(subscribeServerDefinitions, serverDefinitionsVersion, () => 0)
  const studyRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const quick = QUICK_STUDY_IDS.map((id) => byId.get(id))
      .filter((r) => r && (isRowOn(r, cs) || isCatalogRowOffered(r, engineRegistry)))
    // ⛔ NOT THE MOVING AVERAGE. Its instances are listed ABOVE, one switch per
    // average; a per-DEFINITION switch here would tombstone every one of them —
    // the member's default EMA 9 included — with one tap (`toggledRow` turns a
    // definition off by tombstoning ALL its live instances).
    const extras = rows.filter((r) => !QUICK_STUDY_IDS.includes(r.id) && r.id !== MA_DEF_ID && isRowOn(r, cs))
    return [...quick, ...extras]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `serverVersion` IS the gate's version
  }, [rows, cs, serverVersion])

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

  // ── the study editor's model (UCT RS Phase 2a, unit 2a-11) ───────────────
  //
  // ⛔ NOT A SECOND GENERATOR. `fieldsForInstance` is the call the desktop
  // dialog makes: the generated fields in declaration order, each carrying its
  // `group` / `inline` / `tooltip` / `activeWhen`, and `values` resolved as
  // "declared default under the stored input". The hand loop over `def.inputs`
  // this replaced read the raw types and dropped the presentation modifiers.
  // `sectionize` (the registry's export, the dialog's own rule) turns the
  // fields into ordered sections; a definition with no `group` yields one
  // headerless section, so RSI renders the rows it always did.
  const studyDef = editing?.kind === 'study' ? editTarget?.def || null : null
  const studyInst = editing?.kind === 'study' ? editTarget?.inst || null : null
  // ⭐ UCT RS Phase 3, unit 3-02 — the server gate, read the dialog's way: only a
  // `server` definition can carry one, so only one asks (an RSI editor never
  // spends the page's one definitions GET). The snapshot is memoised and frozen.
  const gateId = studyDef && studyDef.compute && studyDef.compute.kind === 'server' ? studyDef.id : null
  const declared = useSyncExternalStore(
    subscribeServerDefinitions,
    () => (gateId ? serverDeclares(gateId) : null),
    () => null,
  )
  const studyModel = useMemo(
    () => (studyDef && studyInst ? fieldsForInstance(studyDef, studyInst, { declared }) : null),
    [studyDef, studyInst, declared],
  )
  const sections = useMemo(
    () => (studyDef && studyModel ? sectionize(studyDef, studyModel.all) : []),
    [studyDef, studyModel],
  )
  // ⭐ 3-02 — through `visiblePresets`, the dialog's filter, so the two surfaces
  // list the same presets for one instance.
  const presets = useMemo(() => {
    const shownPresets = new Set(visiblePresets(studyDef, declared))
    return presetsOf(studyDef).filter((p) => shownPresets.has(p))
  }, [studyDef, declared])
  // ⭐ U8 #27 (2026-11-07): the third argument compares a preset's visibility, dot
  // size and display target too, exactly as the desktop dialog does, so the two
  // surfaces cannot name different presets for one instance.
  const currentPreset = studyModel
    ? detectPreset(presets, studyModel.values, { instance: studyInst, def: studyDef, cs })
    : null

  // Collapse state, SEEDED from the definition's `meta.groupsCollapsed` hint
  // (`initialCollapsed`) each time the editor target changes — a group the
  // member has toggled keeps their choice for the life of that editor, and the
  // next editor starts from its own definition's hint. Render-time adjustment,
  // the same idiom as `initialEditing` above, so the first paint of a new
  // editor is already folded (an effect would paint it open, then fold).
  const [collapsed, setCollapsed] = useState({})
  const [collapsedFor, setCollapsedFor] = useState(null)
  if (editing !== collapsedFor) {
    setCollapsedFor(editing)
    const seed = {}
    for (const g of initialCollapsed(studyDef)) seed[g] = true
    setCollapsed(seed)
  }

  // The preset chips write through `applyPresetInputs` — a loop over
  // `setInstanceInput`, the one door every row here writes through — so a
  // preset value the definition would refuse never lands, and the write is
  // ONE `onWrite` whatever the preset's key count. Identity return = nothing
  // changed (every key already stored at the preset's value) = persist nothing.
  const applyPreset = (preset) => {
    if (!studyDef || !studyInst || !preset) return
    haptics.tap()
    // (the `rs_preset` count was retired with the presets, RS split U9)
    const next = applyPresetInputs(cs, studyInst.instanceId, studyDef, preset, engineRegistry)
    if (next !== cs) onWrite({ ...next, preset: 'custom' })
  }

  // ⭐ VA2 (UCT RS §17.8) — "Save as my default" / "Reset to UCT default", the
  // desktop dialog's two controls through the same engine writers. One `onWrite`
  // each; identity = nothing changed = nothing persisted.
  const studyDefault = memberDefaultState(cs, studyInst, studyDef)
  const writeDefault = (next) => {
    if (next && next !== cs) { haptics.tap(); onWrite({ ...next, preset: 'custom' }) }
  }

  const renderStudyField = (f) => {
    const cur = studyModel.values[f.key]
    const active = evalActiveWhen(f.activeWhen, studyModel.values)
    const id = `${uid}-${f.key}`
    const common = {
      inputKey: f.key,
      label: f.label,
      labelId: `${id}-lbl`,
      tip: f.tooltip || null,
      tipId: f.tooltip ? `${id}-tip` : null,
      active,
    }
    const write = (v) => writeStudyInput(editing.defId, f.key, v)
    switch (f.type) {
      case 'number':
        return <StepRow key={f.key} {...common} value={cur} min={f.min} max={f.max} step={f.step} onChange={write} />
      case 'color': {
        const declared = (studyDef.inputs || []).find((i) => i && i.key === f.key)
        return <SwatchRow key={f.key} {...common} value={cur} fallback={declared ? declared.default : undefined} onChange={write} />
      }
      case 'toggle':
        return <SwitchRow key={f.key} {...common} value={!!cur} onChange={write} />
      case 'select':
        return <ChipRow key={f.key} {...common} value={cur} options={f.options || []} onChange={write} />
      case 'text':
        // keyed by instance too, so a half-typed draft never follows the member
        // into another copy's editor
        return <TextRow key={`${studyInst.instanceId}:${f.key}`} {...common} value={cur} field={f} onChange={write} />
      case 'pick':
        return <PickRow key={`${studyInst.instanceId}:${f.key}`} {...common} value={cur} field={f} onChange={write} />
      default:
        // `source`, `datetime`, `session`: no phone control yet — the same gap
        // the hand loop had (returned null for them), named rather than hidden.
        return null
    }
  }

  const renderSection = (section, si) => {
    const gid = `${uid}-g${si}`
    const body = section.rows.map((item, ii) => (
      item.kind === 'row'
        ? renderStudyField(item.field)
        : (
          // `inline` packs keep their identity on the phone but render one
          // control per line: two steppers side by side do not clear 44px on a
          // 390px screen.
          <div key={`${gid}-p${ii}`} data-inline-group={item.inline}>
            {item.fields.map(renderStudyField)}
          </div>
        )
    ))
    if (!section.group) return <div key={gid} className={styles.paramGroup}>{body}</div>
    const isOpen = !collapsed[section.group]
    return (
      <div key={gid} className={styles.paramGroup} data-group={section.group}>
        <button
          type="button"
          className={styles.groupHead}
          aria-expanded={isOpen}
          aria-controls={`${gid}-body`}
          onClick={() => setCollapsed((c) => ({ ...c, [section.group]: isOpen }))}
        >
          <span>{section.label}</span>
          <span className={styles.groupHeadIcon} aria-hidden="true">
            <UIcon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} gold={false} />
          </span>
        </button>
        {isOpen && <div id={`${gid}-body`}>{body}</div>}
      </div>
    )
  }

  return (
    <>
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Indicators" ariaLabel="Indicators" className={className}>
      <div className={styles.sheetList}>
        {/* ⭐ A1.2 — Undo / Redo for this chart's indicator changes (absent without a key). */}
        {historyKey && (
          <div className={styles.sectionLabel} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <IndicatorHistoryButtons surfaceKey={historyKey} userId={historyUserId} cs={cs} write={onWrite} />
          </div>
        )}
        {/* ⭐ A1.4 — stored indicators this chart cannot show. */}
        <UnavailableIndicators variant="group" cs={cs} registry={engineRegistry} write={(next) => onWrite({ ...next, preset: 'custom' })}
          surfaceKey={historyKey || 'global'} userId={historyUserId} />
        <div className={styles.sectionLabel}>Moving averages</div>
        {/* ⛔ INDEX FIRST, FILTER SECOND — `toggleMa(i)` / `patchMa(i, …)` address
            the slot in the STORED array, so `i` must stay the real index. A moving
            average the member removed keeps its slot (positional merge; see
            `chartDefaults`'s tombstone header) and only stops being LISTED. */}
        {overlays.map((o, i) => [o, i]).filter(([o]) => !!o).map(([o, i]) => (
          <div key={i} className={styles.indRow}>
            <button
              type="button"
              className={styles.indNameBtn}
              onClick={() => setEditing({ kind: 'ma', idx: i })}
              aria-label={`Edit ${o.type || 'MA'} ${o.period}`}
            >
              <span className={styles.indDot} style={{ background: safeCssColour(o.color) || 'var(--text-dim)' }} aria-hidden="true" />
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
          // ⭐ A1 (D3/D5): the switch shows VISIBILITY; a hidden study keeps its row (and its
          // editor) and the switch shows it again. `isRowOn` ("exists") still gates editing.
          const vis = rowVisibility(r, cs)
          const on = vis.state === 'shown'
          const editable = isRowOn(r, cs) && !r.carvedOut && liveInstanceOf(cs, r.id)
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
                  {vis.state === 'hidden' && <span className={styles.indNote}> · hidden</span>}
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

        {chartIqAllowed && (
          <>
            <div className={styles.sectionLabel}>Chart IQ</div>
            {/* The touch door for Chart IQ (the desktop door is the toolbar button). Same setting, same server gate. */}
            <div className={styles.indRow}>
              <span className={styles.indNameBtn}>
                <span className={styles.indName}>
                  Pattern recognition
                  <span className={styles.indNote}> · daily charts</span>
                </span>
              </span>
              <Switch
                checked={!!cs?.showChartIq}
                aria-label="Chart IQ pattern recognition"
                data-testid="chart-iq-mobile-toggle"
                className={styles.switch}
                checkedClassName={styles.switchOn}
                knobClassName={styles.knob}
                onClick={() => { haptics.tap(); onWrite({ ...cs, showChartIq: !cs?.showChartIq, preset: 'custom' }) }}
              />
            </div>
          </>
        )}

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
            <div className={styles.paramRow} data-input-key="type">
              <span className={styles.indName}>Average type</span>
              <div className={styles.segRow} role="radiogroup" aria-label="Average type">
                {/* ⭐ An adopted average may be any kit type (HMA, WMA, …): it is
                    listed so the segment never claims an HMA is an SMA. */}
                {['SMA', 'EMA', ...(['SMA', 'EMA'].includes(editTarget.o.type || 'SMA') ? [] : [editTarget.o.type])].map((t) => (
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
              inputKey="period"
              label="Period"
              labelId={`${uid}-ma-period-lbl`}
              value={editTarget.o.period}
              min={1}
              max={400}
              onChange={(v) => writeOverlay(editing.idx, { period: v })}
            />
            <SwatchRow
              inputKey="color"
              label="Color"
              labelId={`${uid}-ma-color-lbl`}
              value={editTarget.o.color}
              onChange={(c) => writeOverlay(editing.idx, { color: c })}
            />
          </>
        )}

        {editing?.kind === 'study' && studyDef && studyModel && (
          <>
            {/* The preset row — first, and only when the definition declares
                presets (`meta.presets`). One gold chip = the preset the resolved
                values match (gold is "look here", and there is at most one).
                "Custom" is a STATE, not a control: it is where a tweak lands and
                there is nothing to apply, so it is a chip that cannot be
                pressed — the dialog's CUSTOM_PRESET option, which is a no-op
                when chosen. The matched preset's origin line reads as help
                text under the chips, as the dialog shows it under its select. */}
            {presets.length > 0 && (
              <div
                className={`${styles.paramField} ${styles.presetRow}`}
                data-testid="preset-row"
                data-preset={currentPreset ? currentPreset.id : CUSTOM_PRESET}
                role="group"
                aria-labelledby={`${uid}-preset-lbl`}
              >
                {/* ⭐ A5b: STACKED — the label alone at the top-left, the seven chips
                    under it, wrapping left to right (4 lines at most on a 390 px
                    phone), and the origin line under the chips. */}
                <div className={`${styles.paramRow} ${styles.paramRowStacked}`}>
                  <span className={styles.indName} id={`${uid}-preset-lbl`}>Preset</span>
                  <div className={`${styles.chipsWrap} ${styles.chipsStacked}`}>
                    {presets.map((p) => {
                      const on = !!currentPreset && currentPreset.id === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`${styles.chipOpt} ${on ? styles.chipPresetOn : ''}`}
                          aria-pressed={on}
                          data-preset-id={p.id}
                          onClick={() => applyPreset(p)}
                        >{p.label}</button>
                      )
                    })}
                    {/* B7 (2026-11-07): the preset row keeps the gold selection
                        (`chipPresetOn`); every other enum chip selects neutral. */}
                    <span
                      className={`${styles.chipOpt} ${styles.presetCustom} ${currentPreset ? '' : styles.chipPresetOn}`}
                      aria-current={currentPreset ? undefined : 'true'}
                      data-preset-id={CUSTOM_PRESET}
                    >Custom</span>
                  </div>
                </div>
                {currentPreset && currentPreset.origin && (
                  <span className={`${styles.paramTip} ${styles.presetOrigin}`} data-testid="preset-origin">{currentPreset.origin}</span>
                )}
              </div>
            )}
            {sections.map(renderSection)}
            {studyDefault.available && (
              <div className={`${styles.paramField} ${styles.defaultField}`} data-testid="my-default">
                <div className={styles.defaultBtns}>
                  <button
                    type="button" className={styles.chipOpt} data-testid="save-default"
                    disabled={saveDefaultIsNoop(studyDefault)}
                    onClick={() => writeDefault(saveInstanceAsDefault(cs, studyInst.instanceId, engineRegistry))}
                  >{SAVE_DEFAULT_LABEL}</button>
                  <button
                    type="button" className={styles.chipOpt} data-testid="reset-default"
                    disabled={studyDefault.atUct}
                    onClick={() => writeDefault(resetInstanceToUctDefault(cs, studyInst.instanceId, engineRegistry))}
                  >{RESET_DEFAULT_LABEL}</button>
                </div>
                <span className={styles.paramTip} data-testid="my-default-note" role="status">{memberDefaultNote(studyDefault)}</span>
              </div>
            )}
            <button
              type="button"
              className={`${styles.row} ${styles.removeRow}`}
              onClick={() => {
                // ⭐ A1 (D6): remove THE INSTANCE THIS EDITOR SHOWS — never every copy of the
                // definition (the old `toggleStudy` here deleted all of them).
                const inst = editInstanceOf(editing.defId, editing.instanceId)
                if (inst) {
                  haptics.tap()
                  const next = removeInstance(cs, inst.instanceId, engineRegistry)
                  if (next !== cs) onWrite({ ...next, preset: 'custom' })
                }
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

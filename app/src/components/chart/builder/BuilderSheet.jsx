// app/src/components/chart/builder/BuilderSheet.jsx
//
// ─── THE BUILDER (spec §6) ──────────────────────────────────────────────────
//
// A trader types a formula; the parser turns it into the tree that IS the
// persisted artifact; the read-back tells them, in English derived from that
// tree, what they are about to save; the linter decides the badge; the store
// appends a version.
//
// ⛔ THE READ-BACK IS SHOWN, NOT PARAPHRASED. `sentence.js` deliberately refuses
// to smooth: `&&`, `||` and `?:` state all three cases with NaN as "nothing",
// because the tempting reading of `?:` — *"{1} when {0}, otherwise {2}"* — is a
// LIE for the NaN case, and NaN is what the binder actually draws there. So this
// file renders what `sentenceFor` returns and adds not one word of its own. A UI
// that re-words the read-back is a second description of the maths, and the
// user would be confirming the one that is not running.
//
// ⛔ THE BADGE IS MACHINE-ASSIGNED AND IT IS A GATE (spec §1.3). `meta.repaint`
// on the saved document is `lintRepaint(ast).mode` — not a field this form
// offers. `nativeRegistry.validateAstLane` then refuses the document in BOTH
// directions if the declaration disagrees with its own re-measurement, because
// under-claiming is as false as over-claiming.
//
// ⛔ IT NEVER WRITES `chart_settings`. `mergeChartSettings` is a hard allow-list
// whose return literal DESTROYS an unknown top-level key on every read — the
// mechanism that deleted `engineEnabled` at seven sites and that Task 10
// re-measured against a key called `userDefinitions`. A feature that silently
// forgets is worse than one that refuses.
//
// ✅ IT ADDS AN INSTANCE TO THE CHART ON SAVE — PHASE D TASK 16 — AND UNTIL
// TASK 16 IT DELIBERATELY DID NOT.
//
// What stood here, in Task 11's own words: *"AND IT DOES NOT ADD AN INSTANCE TO
// THE CHART, WHICH IS A DELIBERATE REFUSAL, MEASURED. `StockChart` hands the
// binder `registry: engineRegistry` and calls `normalizeInstances(source,
// engineRegistry).kept` — a module-level index built at import from
// `[...NATIVE_DEFS, ...SERVER_DEFS, ...AST_DEFS]`, where `AST_DEFS` is
// deliberately `[]`. Nothing in the product installs a USER definition into it,
// so an instance written here would validate against a definition the renderer
// cannot resolve and be DROPPED on the next paint. Writing it anyway is exactly
// the 'live control that writes nowhere' defect this phase retires."*
//
// Every sentence of that was TRUE and is now FALSE, and it is kept rather than
// deleted because it is the reason the wiring below is in this order.
// `nativeRegistry.installUserDefinitions` is the door that did not exist; the
// instance is written only AFTER the saved document installs through it, and
// only after the STORE has minted the real id — so the instance names a
// definition the renderer can already resolve, on this chart, on this paint. If
// the install refuses (a stored verdict gone stale, a shipped id), the save
// still stands, the instance is NOT written, and the refusal is shown: a formula
// that cannot draw is reported as one, never quietly added to the chart.
//
// ✅ AND A SAVED FORMULA CAN NOW BE OPENED AND CHANGED — THE EDIT PATH.
//
// `PUT /api/user-definitions/{def_id}` shipped with Task 10 and had NO PRODUCT
// CALLER, which is why `compute.rev` in every stored blob had stayed `1` since
// Phase D shipped: the store models an edit exactly right — append a version,
// bump `rev` iff the maths moved, force-migrate every bound alert — and nothing
// on any screen could reach it. A member could author a formula, chart it, find
// it and alert on it, and never change it.
//
// ⛔ ONE WRITE DOOR, NOT TWO. Editing reuses `buildDefinition` →
// `validateUserDefinitions` → `saveUserDefinition` → `installUserDefinitions`
// verbatim; the ONLY differences are the id (the store's, not a fresh draft),
// the HTTP verb (`saveUserDefinition`'s second argument), and that an edit does
// NOT call `addInstance` — the instance already exists and naming it twice would
// draw the same formula twice on the same chart. A second save routine would be
// a second set of gates to keep in step, which is the shape this phase retires.
//
// ⛔ AND A REFUSED EDIT LEAVES THE OLD VERSION WORKING. The validation door runs
// BEFORE the network write, so a formula the registry refuses never reaches the
// store: no version is appended, no `rev` moves, no migration fires, and the
// definition the chart is already drawing is never re-installed. A broken edit
// must not brick a working indicator.

import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../mobile/Sheet'
import UIcon from '../../ui/UIcon'
import { PORTAL_POPUP_ATTR } from '../ColorPicker'
import { SCHEMA_VERSION } from '../engine/defSchema'
import { astHash } from '../engine/ast/parse'
// ⛔ THE SECOND MACHINE-ASSIGNED BADGE, AND IT IS MEASURED HERE FOR THE SAME
// REASON `repaint` IS: `validateUserDefinitions` REQUIRES `meta.freshness` on
// the `ast` lane and refuses a disagreement in both directions, so a document
// this form built without it would be refused at its own save door.
import { freshnessFor } from '../engine/ast/freshness'
// ⛔ THE INPUTS THE SAVED DOCUMENT DECLARES AND THE SCOPE THE READ-BACK IS GIVEN
// COME FROM ONE MODULE, so "the sentence may name it" and "the document declares
// it" are the same fact rather than two lists somebody keeps in step.
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from './builderInputs'
import * as engineRegistry from '../engine/nativeRegistry'
import { validateUserDefinitions, installUserDefinitions } from '../engine/nativeRegistry'
import { addInstance } from '../engine/instanceControls'
import {
  useUserDefinitions, saveUserDefinition, deleteUserDefinition,
} from '../../../hooks/useUserDefinitions'
import FormulaField, { evaluateFormula, canSaveFormula } from './FormulaField'
import ConciergeBox from './ConciergeBox'
import CriteriaPicker from './CriteriaPicker'
import StarterLibrary from './StarterLibrary'
import styles from './BuilderSheet.module.css'

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),'
  + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** The badge vocabulary, cased for display. ⛔ The definition's vocabulary is
 *  the authority (`lint.REPAINT_MODES`); this only cases it. Informational
 *  styling for the clean value, warning styling for the other two — a factual
 *  property is not an error, but a forward reference is a warning. */
const REPAINT_LABEL = {
  'non-repainting': 'Non-repainting',
  'preview-repaints': 'Preview-repaints',
  repaints: 'Repaints',
}

/** A client-side id, replaced by the server on a create.
 *
 *  ⛔ THE SERVER MINTS THE REAL ONE. This exists only so the document can be run
 *  through `validateUserDefinitions` — the shipped validation door — BEFORE it
 *  is sent, and `defSchema`'s `ID_RE` needs something to look at. Sending a
 *  guessed id as authoritative would let one member write into another's
 *  namespace, which is why `POST` overwrites whatever arrives. */
export function draftDefId() {
  const bytes = new Uint8Array(6)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return 'u_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The document that gets stored — and it is the ONLY place this surface decides
 * what a user definition looks like.
 *
 * ⭐ `compute.fn` IS `astHash(ast)`, and that is Task 8's ruling rather than a
 * convention: the tree is the implementation, so there is no third thing to
 * name and "the handle changed" and "the maths changed" become one event.
 *
 * ⭐ `meta.description` IS THE READ-BACK. Derived from the tree, never written
 * by a model and never typed by the author — so the sentence in the indicator
 * library is the same sentence the author confirmed before saving.
 */
export function buildDefinition({ defId, name, source, ast, mode, rev = 1, version = 1, readback = '' }) {
  const trimmed = String(name || '').trim()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: defId,
    version,
    compute: { kind: 'ast', fn: astHash(ast), rev, ast, source },
    meta: {
      name: trimmed,
      shortName: trimmed.slice(0, 12),
      category: 'Custom',
      description: readback,
      tags: ['custom'],
      // Every `/api/user-definitions` route declares `Depends(require_paid)` on
      // its own handler, so a `free` claim here would be a definition promising
      // data its lane refuses to hand over.
      tier: 'premium',
      // ⛔ MACHINE-ASSIGNED. See the header.
      repaint: mode,
      // ⛔ MACHINE-ASSIGNED TOO, AND IT IS NOT THE SAME QUESTION. The repaint
      // linter answers 0 for a table-declared scalar — correctly, because a
      // per-symbol value reads no future bar — so `market_cap > 1e9` is branded
      // `non-repainting` and its staleness goes unsaid. Derived from the SAME
      // tree by the SAME kind of reader, never typed and never offered as a
      // form field. `BUILDER_INPUTS` is the scope the read-back already uses.
      freshness: freshnessFor(ast, {
        inputs: Object.fromEntries(BUILDER_INPUTS.map((s) => [s.key, true])),
      }).mode,
    },
    placement: { target: 'pane', pane: { height: 0.15 } },
    // ⛔ SPREAD FROM `BUILDER_INPUTS`, WHICH IS ALSO WHAT THE READ-BACK'S SCOPE IS
    // DERIVED FROM. Copied so a caller cannot mutate the frozen source array's
    // members through the document it just received.
    inputs: BUILDER_INPUTS.map((spec) => ({ ...spec })),
    // ⛔ EXACTLY ONE DATA-BEARING PLOT. One formula is one series
    // (`nativeRegistry.validateAstLane`); a second plot is a key nothing fills.
    plots: [{
      key: 'value',
      label: trimmed.slice(0, 12) || 'Value',
      style: 'line',
      color: '$color',
      width: '$lineWidth',
      role: 'primary',
    }],
  }
}

/**
 * ⛔ SPEC §6's INSTANCE STATES HAVE TEN MEMBERS AND NONE OF THEM IS "THE PAGE
 * DIED". A parse failure is the normal case on this surface, so `parseFormula`
 * never throws and `evaluateFormula` never throws — but a boundary is what makes
 * "and it did not crash" an assertion something can FAIL rather than a hope.
 * `queryByTestId('builder-crash')` is null only because nothing threw.
 */
export class BuilderBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }

  static getDerivedStateFromError(err) { return { err } }

  render() {
    if (this.state.err) {
      return (
        <div className={styles.crash} data-testid="builder-crash" role="alert">
          The formula builder stopped responding. Close this panel and try again.
        </div>
      )
    }
    return this.props.children
  }
}

export default function BuilderSheet({
  open, onClose, onSaved = null, settings = null, onChange = null, bars = null,
}) {
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [result, setResult] = useState(() => evaluateFormula('', BUILDER_INPUT_SCOPE))
  const [acknowledged, setAcknowledged] = useState(false)
  const [storeError, setStoreError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedRow, setSavedRow] = useState(null)
  const [copied, setCopied] = useState(false)
  // ⭐ THE EDIT TARGET: `{defId, version}` off the STORE's row, or null for a
  // create. It is the id the store minted — never `draftDefId()`'s — because the
  // instance already on the chart names that one and a PUT at any other id is a
  // second definition wearing an edit's clothes.
  const [editing, setEditing] = useState(null)
  // ⭐ WHICH DOOR IS OPEN, AND NOTHING MORE. `buildMode` decides whether the
  // picker is on screen; it is NOT persisted, NOT written into the document and
  // NOT read back — the saved artifact is the same one either door produces.
  //
  // ⭐⭐ A NEW FORMULA OPENS ON THE LIBRARY, AND AN EDIT OPENS ON THE FORMULA.
  // (E-8 raised this and left it as an owner call; the owner delegated it.)
  //
  // The argument that settles it is that `FormulaField` is rendered in EVERY
  // mode and autofocused in every mode — the tab only decides what sits ABOVE
  // the box. So "Formula" as the default renders nothing above a focused box,
  // and "Library" renders the firm's own worked scans above the same focused
  // box: their names, what each one computes in the tree's own words, and their
  // source. Nobody loses the ability to type; a member who does not know the
  // syntax gains three examples of it and a one-click way to put one in the box
  // and change it, which is how TC2000 and TradingView onboard.
  //
  // ⛔ AN EDIT IS THE OTHER CASE AND IT IS NOT THE SAME ONE. A member editing a
  // formula they already own has no use for starters above their own work, so
  // `openForEdit` moves the sheet to Formula. `BuilderSheet.starters.test.jsx`
  // holds both halves.
  const [buildMode, setBuildMode] = useState('library')
  const [pickerNote, setPickerNote] = useState(null)
  const rootRef = useRef(null)

  const { rows, error: listError } = useUserDefinitions()

  // A new sheet is a new formula. Leaving the previous one behind would offer a
  // Save button whose read-back describes a tree the box no longer shows.
  useEffect(() => {
    if (!open) return
    setSource(''); setName(''); setResult(evaluateFormula('', BUILDER_INPUT_SCOPE))
    setAcknowledged(false); setStoreError(null); setSavedRow(null); setCopied(false)
    setEditing(null); setBuildMode('library'); setPickerNote(null)
  }, [open])

  /** Open a stored formula for editing — its SOURCE, its name, and its id.
   *
   *  ⛔ `compute.source` IS WHAT GOES BACK IN THE BOX, NOT THE TREE. The source is
   *  what the author typed and what `parseFormula` round-trips; re-deriving text
   *  from the AST would put a sentence the user never wrote into the field they
   *  are about to edit, and the two would diverge the first time the printer and
   *  the parser disagreed about precedence. A row with no stored source cannot be
   *  edited here and says so rather than opening an empty box over a live
   *  definition. */
  const openForEdit = useCallback((row) => {
    const src = row?.definition?.compute?.source
    setStoreError(null); setSavedRow(null); setCopied(false); setAcknowledged(false)
    if (typeof src !== 'string' || src.trim() === '') {
      setEditing(null)
      setStoreError('This formula was stored without its source text, so it cannot be edited here.')
      return
    }
    setEditing({ defId: row.def_id, version: Number(row.version) || 1 })
    setName(String(row?.definition?.meta?.name || ''))
    setSource(src)
    setResult(evaluateFormula(src, BUILDER_INPUT_SCOPE))
    // ⛔ AND THE SHEET MOVES TO THE FORMULA. A new sheet opens on the Library
    // because a member with nothing in the box is helped by worked examples; a
    // member editing their OWN definition is not, and leaving a gallery of
    // starters above their work invites a click that replaces it.
    setBuildMode('formula')
    setPickerNote(null)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditing(null); setSource(''); setName('')
    setResult(evaluateFormula('', BUILDER_INPUT_SCOPE))
    setAcknowledged(false); setStoreError(null); setSavedRow(null)
  }, [])

  // A new evaluation invalidates an acknowledgement of the OLD one. Carrying it
  // forward would let a user acknowledge a bounded forward reference and then
  // save a different formula under that acknowledgement.
  const handleEvaluated = useCallback((next) => {
    setResult((prev) => {
      if (prev && prev.source === next.source) return prev
      setAcknowledged(false)
      setStoreError(null)
      setSavedRow(null)
      // A note about a formula the picker could not show describes the OLD
      // source; carrying it past an edit would leave a warning on screen about
      // a formula that is no longer in the box.
      setPickerNote(null)
      return next
    })
  }, [])

  const mode = result?.verdict?.mode || null
  const canSave = canSaveFormula(result, acknowledged) && name.trim() !== '' && !saving

  // ── focus trap ─────────────────────────────────────────────────────────────
  //
  // ⚠️ `Sheet` SHIPS NO TRAP. It focuses the panel on open, handles Escape,
  // locks body scroll and restores focus on close — and nothing stops Tab
  // walking out of the modal into the page behind it. (The plan and this task's
  // brief both say otherwise; Task 5 measured it and so did this one.)
  // `ContextPopover` ships neither a trap nor focus movement into its
  // `role="menu"`, which is a separate finding and not this surface's.
  //
  // ⛔ BOUND TO THE PANEL, NOT TO THIS SUBTREE. `Sheet`'s header — and its ×
  // button, the FIRST focusable in the ring — is a SIBLING of the body this
  // component renders into, so a React `onKeyDown` here would never see the
  // Shift+Tab that leaks out of the modal from the very element the ring starts
  // at. Measured on `IndicatorSettingsDialog`: the forward wrap passed and the
  // backward one walked to `body`.
  const trapTab = useCallback((e) => {
    if (e.key !== 'Tab') return
    const panel = rootRef.current?.closest('[role="dialog"]') || rootRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll(FOCUSABLE)]
    if (items.length < 2) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // Focus on the PANEL itself is the normal state right after open (`Sheet`
    // focuses it on an rAF) and it is not in `items` (tabindex="-1"). Tab from
    // there must ENTER the ring, not walk out of the modal.
    if (items.indexOf(active) === -1) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }, [])

  const trapRef = useRef(trapTab)
  trapRef.current = trapTab
  useEffect(() => {
    if (!open) return undefined
    const panel = rootRef.current?.closest('[role="dialog"]')
    if (!panel) return undefined
    const h = (e) => trapRef.current(e)
    panel.addEventListener('keydown', h)
    return () => panel.removeEventListener('keydown', h)
  }, [open])

  /** Spec §6 state 4's "copy diagnostic" — the GUARD's name and the door's own
   *  sentence, so a support message names the gate rather than describing the
   *  symptom. */
  const copyDiagnostic = useCallback(() => {
    const text = JSON.stringify({
      source: result?.source ?? '',
      guard: result?.guard ?? null,
      error: result?.error ?? null,
      repaint: mode,
      measured: result?.measured ?? null,
    }, null, 2)
    try { navigator?.clipboard?.writeText?.(text) } catch { /* a clipboard-less browser still gets the chip */ }
    setCopied(true)
  }, [result, mode])

  const save = useCallback(async () => {
    if (!canSaveFormula(result, acknowledged) || !name.trim()) return
    setSaving(true)
    setStoreError(null)
    // ⚠️ THE DOCUMENT'S OWN `version` MOVES ON AN EDIT, AND IT HAS TO.
    // `nativeRegistry.installKey` is `id@version#compute.fn`, so a rename — same
    // id, same tree, same hash — is byte-identical to the installed document and
    // is SKIPPED, leaving the registry (and therefore the legend, the settings row
    // and the pane label) showing the old name. The store's `version` column moves
    // on every append; the blob's copy of it now moves with it.
    const doc = buildDefinition({
      defId: editing ? editing.defId : draftDefId(),
      version: editing ? editing.version + 1 : 1,
      name,
      source: result.source,
      ast: result.ast,
      mode: result.verdict.mode,
      readback: result.readback,
    })
    // ⭐ THE SHIPPED VALIDATION DOOR, NOT A SECOND ONE. `validateUserDefinitions`
    // is `defSchema` + the `supportedKinds` filter + the ast lane's own gates
    // (one formula is one series · the budget, naming the guard that fired · the
    // repaint badge and the freshness badge, each refused in both directions ·
    // the tier · a plot's own forward window). ⚠️ NAMED, NOT COUNTED — this said
    // "three gates" while the function carried five. A form that validated its
    // own document would be a second authority on what a definition is, and the
    // two rot apart the first time a gate moves.
    //
    // ⚠️ VALIDATE FIRST, INSTALL LATER. Installing the DRAFT would put a
    // definition under `draftDefId()` into the registry — an id the store is
    // about to replace — so the tab would carry a resolvable definition that
    // nothing stored and nothing else can ever name. The refusal has to happen
    // before the network write either way, which is what this call is for.
    const { defs, errors } = validateUserDefinitions([doc])
    if (errors.length || defs.length !== 1) {
      setStoreError(errors.join('\n') || 'The registry refused this definition.')
      setSaving(false)
      return
    }
    // ⭐ THE SECOND ARGUMENT IS THE WHOLE DIFFERENCE BETWEEN A CREATE AND AN EDIT.
    // `saveUserDefinition` POSTs without it and PUTs with it — one function, one
    // set of error words, one SWR invalidation. The route it reaches then bumps
    // `compute.rev` if the maths moved and force-migrates every bound alert.
    const res = await saveUserDefinition(doc, editing ? editing.defId : null)
    setSaving(false)
    if (!res.ok) { setStoreError(res.error); return }
    const row = res.row || { def_id: doc.id, version: doc.version, rev: 1 }
    setSavedRow(row)
    if (editing && row.def_id) setEditing({ defId: row.def_id, version: Number(row.version) || editing.version + 1 })

    // ── the definition the STORE holds, not the draft ────────────────────────
    //
    // ⛔ THE SERVER MINTS THE ID (`user_definitions.create_definition` overwrites
    // `definition["id"]`), so the document that must be installed and the id the
    // instance must name are the STORE's, never `draftDefId()`'s. An instance
    // pointing at the draft id would be dropped by `normalizeInstances` on the
    // very next paint — the defect this task exists to close, re-created one
    // field over. ⚠️ `compute.rev` is reconciled from the row for the same
    // reason: the store computes the authoritative rev and Task 11 recorded that
    // the blob's copy was left to lag it.
    const storedDoc = {
      ...doc,
      id: row.def_id || doc.id,
      ...(Number.isInteger(row.version) ? { version: row.version } : {}),
      compute: {
        ...doc.compute,
        ...(Number.isInteger(row.rev) ? { rev: row.rev } : {}),
      },
    }
    const { installed, errors: installErrors } = installUserDefinitions([storedDoc])
    if (installErrors.length || installed.length !== 1) {
      // Saved, but not drawable. Saying so is the whole point: the alternative
      // is a checkbox-shaped silence where a formula exists in the list and
      // never appears on a chart, which is the state this phase retires.
      setStoreError(
        installErrors.join('\n')
        || 'Saved, but this formula could not be added to the chart.',
      )
    } else if (!editing && settings && onChange) {
      // ⛔ THROUGH `addInstance`, THE ONE CONTROL DOOR — not a hand-built
      // instance object. It reads the DEFINITION for the input defaults and the
      // placement, mints the id `newInstanceId` would, sorts the list into the
      // shipped stack order and sets the legacy mirror, exactly as the indicator
      // library's checkbox does. A second way to add an instance is a second
      // shape of instance, and `normalizeInstances` is the thing that would tell
      // us — on the user's chart, by making it disappear.
      //
      // ⛔ ON A CREATE ONLY. An EDIT's instance is already on the chart naming
      // this very id, and `installUserDefinitions` above has just replaced the
      // definition it resolves through — so the existing binding redraws with the
      // new maths and adding a second instance would draw the same formula twice.
      onChange(addInstance(settings, installed[0].id, engineRegistry))
    }
    onSaved?.(res.row)
  }, [result, acknowledged, name, onSaved, settings, onChange, editing])

  const remove = useCallback(async (defId) => { await deleteUserDefinition(defId) }, [])

  const badge = useMemo(() => (mode ? (REPAINT_LABEL[mode] || mode) : null), [mode])

  if (!open) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="auto"
      title={editing ? 'Edit formula' : 'New formula'}
      maxWidth={640}
    >
      {/* The portal exemption — `ChartToolbar` closes its settings panel on any
          outside mousedown, and `Sheet` renders into `document.body`, so without
          this the mousedown of the very click that opens this sheet would unmount
          the panel underneath it. Same trap `IndicatorLibraryDialog` documents. */}
      <div className={styles.body} ref={rootRef} {...{ [PORTAL_POPUP_ATTR]: 'formula-builder' }}>
        <BuilderBoundary>
          {/* ── THE AI DOOR (Phase D Task 13) ────────────────────────────────
              ⭐ IT IS MOUNTED HERE, ABOVE THE TYPED FIELD, AND UNTIL NOW IT WAS
              MOUNTED NOWHERE. `ConciergeBox` shipped complete — a prop
              contract, a derived read-back, a full test file — with ZERO
              non-test importers, so `POST /api/user-definitions/propose` (cost
              -guarded, `MAX_MODEL_CALLS = 2`) had no product caller and
              "describe an indicator in English" existed on no screen.

              ⛔ `onAccept` WRITES THE SOURCE AND NOTHING ELSE. The box
              deliberately never saves; handing its `source` to the field the
              user already types in means the proposal goes through the SAME
              parse, the SAME budget walk, the SAME linter and the SAME
              read-back as a typed formula, and the Save button below stays the
              one and only write path. Taking `body.ast` straight to
              `buildDefinition` would be a second door with a second set of
              gates to keep in step — the exact shape this phase retires.

              ⚠️ NO `fetchImpl`. The box's injection point is for tests only;
              production uses the global `fetch`, so what this surface issues is
              a real request (`lesson_injected_dependency_hides_the_fetch`).

              ⭐ AND THE KIND IS THE MODE THE MEMBER IS IN (Phase E, E-5). On the
              Conditions tab they are building a SCREEN, so the request says so
              and the server's condition stage can refuse a tree that produces a
              number — `sma(close,20)` handed back as a screen would silently
              match every symbol on the board. A box that always asked for an
              indicator would be a box whose scan stage can never fire, and no
              component test on either side could see it. */}
          <ConciergeBox
            bars={bars}
            kind={buildMode === 'picker' ? 'scan' : 'indicator'}
            disabled={saving}
            onAccept={(proposal) => setSource(proposal?.source || '')}
          />

          {/* ── THE SECOND DOOR ONTO ONE OBJECT (Phase E, E-4) ───────────────────
              ⛔ A MODE, NOT A SECOND BUILDER. The picker's only output is the SAME
              `source` string the text box holds, so a picked condition goes through
              the same parse, the same budget walk, the same linter, the same
              read-back and the same Save button as a typed one. A second builder
              would be a second grammar — the seam this task exists to close.

              ⛔ AND THE PICKER IS DERIVED FROM THE TREE, NOT STORED. Switching to it
              reads `result.ast`; a formula it cannot show is REPORTED, and the
              picker stays empty rather than half-right. */}
          {/* ── THE THIRD DOOR ONTO THE SAME OBJECT (Phase E, E-8) ──────────────
              ⭐ A BLANK FORMULA BOX LOSES THE WIDE AUDIENCE. The library is the
              onboarding path: a member picks one of the FIRM'S OWN setups, gets
              a working scan in the box below, and edits it — which is how people
              learn a syntax.

              ⛔ AND IT IS A MODE, NOT A THIRD BUILDER. Its only output is the
              same `source` string the other two doors write, so a starter meets
              the same parse, the same budget, the same linter, the same
              read-back and the same Save button. There is no starter save path,
              no starter flag on the document and no starter column on the store
              — a starter that was special-cased would be a second class of
              object, and `BuilderSheet.starters.test.jsx` asserts the saved
              blob carries no trace of where it came from. */}
          <div className={styles.modeRow} role="tablist" aria-label="How to build this">
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'library' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'library'}
              onClick={() => setBuildMode('library')}
            >Library</button>
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'picker' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'picker'}
              onClick={() => setBuildMode('picker')}
            >Conditions</button>
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'formula' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'formula'}
              onClick={() => setBuildMode('formula')}
            >Formula</button>
          </div>

          {buildMode === 'library' && (
            <StarterLibrary
              activeSource={source}
              onPick={(entry) => {
                // ⛔ THE SOURCE AND NOTHING ELSE. Not the tree, not a prebuilt
                // document, not a hash — the starter arrives at the typed box the
                // way a member's own keystrokes do, so the ONE write path stays
                // the one write path. Landing on the Formula tab is the point of
                // the gesture: *"here is a working scan, now change it"*.
                setSource(entry.source)
                setBuildMode('formula')
              }}
            />
          )}

          {buildMode === 'picker' && (
            <CriteriaPicker
              ast={result?.ast || null}
              onSourceChange={setSource}
              onUnrepresentable={(refusal) => setPickerNote(refusal.reason)}
            />
          )}

          {buildMode === 'picker' && pickerNote && (
            <p className={styles.pickerNote} role="status" data-testid="picker-note">{pickerNote}</p>
          )}

          <FormulaField
            value={source}
            onChange={setSource}
            onEvaluated={handleEvaluated}
            result={result}
            autoFocus
            inputs={BUILDER_INPUT_SCOPE}
          />

          {/* ── THE READ-BACK ────────────────────────────────────────────────
              ⛔ `{result.readback}` AND NOTHING ELSE. See the header. */}
          {result?.ok && (
            <section className={styles.readbackWrap} aria-labelledby="uct-readback-head">
              <h3 className={styles.sectionHead} id="uct-readback-head">This is what will be computed</h3>
              <p className={styles.readback} data-testid="readback">{result.readback}</p>
              <p className={styles.measured}>
                {result.measured
                  ? `${result.measured.maxNodes} nodes · ${result.measured.maxLookback}-bar lookback · `
                    + `${result.measured.maxSeriesRefs} series`
                  : null}
              </p>
            </section>
          )}

          {/* ── THE BADGE ────────────────────────────────────────────────────
              Shown only for an ADMISSIBLE formula: a repaint verdict printed
              beside "unknown function `foo`" describes a formula that does not
              exist, and would read as the reason it was refused. */}
          {result?.ok && badge && (
            <p
              className={`${styles.badge} ${mode === 'non-repainting' ? styles.badgeClean : styles.badgeWarn}`}
              data-testid="repaint-badge"
              data-mode={mode}
            >
              <UIcon name={mode === 'non-repainting' ? 'check' : 'warning'} size={14} />
              {badge}
              <span className={styles.badgeWhy}>{(result.verdict.reasons || []).join('; ')}</span>
            </p>
          )}

          {mode === 'preview-repaints' && result?.ok && (
            <label className={styles.ack}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                data-testid="repaint-ack"
              />
              <span>
                I understand this value is not final until {result.verdict.forward} more bar(s) close.
              </span>
            </label>
          )}

          {result?.error && (
            <div className={styles.diagRow}>
              <button type="button" className={styles.ghostBtn} onClick={copyDiagnostic}>
                <UIcon name="copy" size={14} />{copied ? 'Copied' : 'Copy diagnostic'}
              </button>
            </div>
          )}

          <div className={styles.fieldWrap}>
            <label className={styles.label} htmlFor="uct-formula-name">Name</label>
            <input
              id="uct-formula-name"
              className={styles.nameField}
              type="text"
              maxLength={48}
              placeholder="20-bar average"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {storeError && (
            <p className={styles.storeError} role="alert" data-testid="store-error">{storeError}</p>
          )}
          {listError && (
            <p className={styles.storeError} role="alert" data-testid="list-error">
              {listError.status === 402
                ? 'Custom indicators require a paid plan.'
                : 'Your saved formulas could not be loaded.'}
            </p>
          )}
          {savedRow && (
            <p className={styles.saved} data-testid="saved-note">
              <UIcon name="check" size={14} />
              Saved — version {savedRow.version}, rev {savedRow.rev}.
              {/* ⭐ THE MIGRATION, SAID OUT LOUD. Spec §3.1's contract is *"you
                  will never be silently switched"*, and the store returns the
                  count it actually migrated — so this is the number of alerts
                  that were reset and suppressed for one cycle, not a guess about
                  them. Rendered only when it is non-zero: "0 alerts" beside a
                  rename is noise, and `rev_bumped` alone would claim a migration
                  on a definition nothing is bound to. */}
              {savedRow.rev_bumped && savedRow.migrated > 0 && (
                <span data-testid="migrated-note">
                  {' '}The maths changed, so {savedRow.migrated} alert
                  {savedRow.migrated === 1 ? '' : 's'} bound to it moved onto the new
                  calculation and will skip one evaluation.
                </span>
              )}
            </p>
          )}

          <div className={styles.actions}>
            {editing && (
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={cancelEdit}
              >New formula</button>
            )}
            <button type="button" className={styles.ghostBtn} onClick={onClose}>Cancel</button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={save}
              disabled={!canSave}
            >{saving ? 'Saving…' : (editing ? 'Save changes' : 'Save')}</button>
          </div>

          {rows.length > 0 && (
            <section className={styles.listWrap} aria-labelledby="uct-saved-head">
              <h3 className={styles.sectionHead} id="uct-saved-head">Your formulas</h3>
              <ul className={styles.list}>
                {rows.map((row) => (
                  <li key={row.def_id} className={styles.listRow}>
                    <span className={styles.listName}>{row.definition?.meta?.name || row.def_id}</span>
                    <span className={styles.listSource}>{row.definition?.compute?.source}</span>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      aria-label={`Edit ${row.definition?.meta?.name || row.def_id}`}
                      onClick={() => openForEdit(row)}
                    ><UIcon name="edit" size={14} /></button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      aria-label={`Delete ${row.definition?.meta?.name || row.def_id}`}
                      onClick={() => remove(row.def_id)}
                    ><UIcon name="trash" size={14} /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </BuilderBoundary>
      </div>
    </Sheet>
  )
}

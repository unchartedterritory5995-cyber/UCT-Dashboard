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
// ⚠️ AND IT DOES NOT ADD AN INSTANCE TO THE CHART, WHICH IS A DELIBERATE
// REFUSAL, MEASURED. `StockChart` hands the binder `registry: engineRegistry`
// and calls `normalizeInstances(source, engineRegistry).kept` (StockChart.jsx
// ~:6443) — a module-level index built at import from
// `[...NATIVE_DEFS, ...SERVER_DEFS, ...AST_DEFS]`, where `AST_DEFS` is
// deliberately `[]`. Nothing in the product installs a USER definition into it,
// so an instance written here would validate against a definition the renderer
// cannot resolve and be DROPPED on the next paint. Writing it anyway is exactly
// the "live control that writes nowhere" defect this phase retires. The
// definition is saved and listed — every claim this surface makes is one it
// keeps — and installing user definitions into the registry the binder reads is
// a change to `StockChart.jsx` / `nativeRegistry.js`, which this task does not
// own.

import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../mobile/Sheet'
import UIcon from '../../ui/UIcon'
import { PORTAL_POPUP_ATTR } from '../ColorPicker'
import { SCHEMA_VERSION } from '../engine/defSchema'
import { astHash } from '../engine/ast/parse'
import { registerUserDefinitions } from '../engine/nativeRegistry'
import {
  useUserDefinitions, saveUserDefinition, deleteUserDefinition,
} from '../../../hooks/useUserDefinitions'
import FormulaField, { evaluateFormula, canSaveFormula } from './FormulaField'
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
 *  through `registerUserDefinitions` — the shipped registration door — BEFORE it
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
    },
    placement: { target: 'pane', pane: { height: 0.15 } },
    inputs: [
      { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
      { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
    ],
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

export default function BuilderSheet({ open, onClose, onSaved = null }) {
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [result, setResult] = useState(() => evaluateFormula(''))
  const [acknowledged, setAcknowledged] = useState(false)
  const [storeError, setStoreError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedRow, setSavedRow] = useState(null)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef(null)

  const { rows, error: listError } = useUserDefinitions()

  // A new sheet is a new formula. Leaving the previous one behind would offer a
  // Save button whose read-back describes a tree the box no longer shows.
  useEffect(() => {
    if (!open) return
    setSource(''); setName(''); setResult(evaluateFormula(''))
    setAcknowledged(false); setStoreError(null); setSavedRow(null); setCopied(false)
  }, [open])

  // A new evaluation invalidates an acknowledgement of the OLD one. Carrying it
  // forward would let a user acknowledge a bounded forward reference and then
  // save a different formula under that acknowledgement.
  const handleEvaluated = useCallback((next) => {
    setResult((prev) => {
      if (prev && prev.source === next.source) return prev
      setAcknowledged(false)
      setStoreError(null)
      setSavedRow(null)
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
    const doc = buildDefinition({
      defId: draftDefId(),
      name,
      source: result.source,
      ast: result.ast,
      mode: result.verdict.mode,
      readback: result.readback,
    })
    // ⭐ THE SHIPPED REGISTRATION DOOR, NOT A SECOND ONE. `registerUserDefinitions`
    // is `defSchema` + the `supportedKinds` filter + the ast lane's three gates
    // (one formula is one series · the budget, naming the guard that fired · the
    // repaint badge, refused in both directions). A form that validated its own
    // document would be a second authority on what a definition is, and the two
    // rot apart the first time a gate moves.
    const { defs, errors } = registerUserDefinitions([doc])
    if (errors.length || defs.length !== 1) {
      setStoreError(errors.join('\n') || 'The registry refused this definition.')
      setSaving(false)
      return
    }
    const res = await saveUserDefinition(doc)
    setSaving(false)
    if (!res.ok) { setStoreError(res.error); return }
    setSavedRow(res.row || { def_id: doc.id, version: 1, rev: 1 })
    onSaved?.(res.row)
  }, [result, acknowledged, name, onSaved])

  const remove = useCallback(async (defId) => { await deleteUserDefinition(defId) }, [])

  const badge = useMemo(() => (mode ? (REPAINT_LABEL[mode] || mode) : null), [mode])

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="New formula" maxWidth={640}>
      {/* The portal exemption — `ChartToolbar` closes its settings panel on any
          outside mousedown, and `Sheet` renders into `document.body`, so without
          this the mousedown of the very click that opens this sheet would unmount
          the panel underneath it. Same trap `IndicatorLibraryDialog` documents. */}
      <div className={styles.body} ref={rootRef} {...{ [PORTAL_POPUP_ATTR]: 'formula-builder' }}>
        <BuilderBoundary>
          <FormulaField
            value={source}
            onChange={setSource}
            onEvaluated={handleEvaluated}
            result={result}
            autoFocus
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
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.ghostBtn} onClick={onClose}>Cancel</button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={save}
              disabled={!canSave}
            >{saving ? 'Saving…' : 'Save'}</button>
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

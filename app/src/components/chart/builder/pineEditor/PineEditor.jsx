// app/src/components/chart/builder/pineEditor/PineEditor.jsx
//
// ─── A1 — THE MEMBER PINE EDITOR (DARK: `VITE_PINE_AUTHORING_ENABLED`) ──────
//
// Write Pine, see what the member door makes of it on every settle, jump to the
// exact token it refused, and put it on the chart — then keep editing and put
// the new version on the chart IN PLACE.
//
// ⛔ A SURFACE, NOT A PIPELINE. It adds no translator, no save path and no
// document format:
//   * compile   = `memberPaneDefinition`, the build `MemberPane` draws and the
//                 attach button saves (so the problems list and "Apply" can
//                 never disagree about whether the script works);
//   * diagnose  = `authoringDiagnostics`, which only collects the door's own
//                 sentences, verbatim, with their line/column/token;
//   * apply     = the host's `onApply(definition)` — `BuilderSheet` routes it
//                 through the same four doors `attachPine` uses.
//
// ⛔ THE EDITOR CHUNK IS LAZY, as `FormulaField` / `PineBox` load it: CodeMirror
// stays out of the sheet's own chunk, and a failed load leaves the textarea —
// never a reload that would throw away a member's script.
//
// ⛔ ONE SETTLE. `value` is the host's and updates per keystroke (so the
// sheet's discard prompt sees every character); the COMPILE runs on the
// settled copy only, `PINE_DEBOUNCE_MS` after the last keystroke — the figure
// `PineBox` settled on for the same reason (a lexer, a parser and a re-parse per
// keystroke is a frame budget).
//
// ⛔ APPLY IS INSIDE THE PANE FLAG. `memberPaneEnabled()` is the one authority
// over "may a member's script reach a chart"; with it off the editor still
// compiles and lists problems but offers no Apply, and says why.
//
// ⭐⭐ A2–A5 (2026-10-04):
//   * the stored document carries the script it was built from
//     (`meta.pineSource`, `withPineSource`) — the SETTLED text, never a newer
//     keystroke (Apply is disabled while a settle is pending), so what is stored
//     is exactly what was compiled. The server decides whether it is kept (the
//     member's `PINE_AUTHORING_STAGE`) and says so; a withheld source is shown;
//   * a NAME field (`meta.name`), applied at store time so typing a name never
//     re-translates the script;
//   * "Save" stores (create or update) without putting the script on the chart;
//   * the INPUTS panel (`InputsPanel`) edits the preview and what Apply stores,
//     atomically, never the source.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from '../memberPane/memberPaneDefinition'
import { memberPaneEnabled } from '../../engine/memberPaneGate'
import { usePineLibraries } from '../usePineLibraries'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import { authoringDiagnostics, offsetOf } from './authoringDiagnostics'
import { applyInputValues, withName, withPineSource } from './pineScripts'
import InputsPanel from './InputsPanel'
import styles from './PineEditor.module.css'

const STARTER = `//@version=5
indicator("My indicator", overlay = false)
length = input.int(14, "Length", minval = 1)
r = ta.rsi(close, length)
plot(r, "RSI", color = color.orange)
hline(70)
hline(30)`

/** Same lazy edge as `PineBox.loadEditor`: a failed load is the textarea. */
function loadEditor() {
  return import('../editor/CodeEditor').then((m) => m.default).catch(() => null)
}

const where = (it) => (it.line != null
  ? `Line ${it.line}${it.column != null ? `, column ${it.column}` : ''}`
  : 'Whole script')

/**
 * @param {string}   value                 the member's script (host state)
 * @param {Function} onChange              (text) => void, per keystroke
 * @param {Function} [onSettled]           (text) => void, once per settle — the
 *                                          host feeds its preview pane from it
 * @param {Function} [onApply]             (definition, {addToChart}) =>
 *                                          Promise<{ok, error?, updated?, pineSource?}>
 * @param {{defId: string}|null} [applied] set once this session's script is
 *                                          stored (or a saved one was opened);
 *                                          Apply then UPDATES it
 * @param {string}   [name]                the script's name (`meta.name`)
 * @param {Function} [onNameChange]        (name) => void
 * @param {object}   [inputValues]         {inputName: value} — the inputs panel
 * @param {Function} [onInputValuesChange] (values) => void
 * @param {boolean}  [disabled]
 */
export default function PineEditor({
  value = '', onChange = null, onSettled = null, onApply = null, applied = null, disabled = false,
  name = '', onNameChange = null, inputValues = null, onInputValuesChange = null,
}) {
  const [settled, setSettled] = useState(value)
  const [Editor, setEditor] = useState(null)
  const editorRef = useRef(null)
  const areaRef = useRef(null)
  const [applyState, setApplyState] = useState({ state: 'idle', message: null })

  useEffect(() => {
    let alive = true
    loadEditor().then((E) => { if (alive && E) setEditor(() => E) })
    return () => { alive = false }
  }, [])

  // ── the one settle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (value === settled) return undefined
    const t = setTimeout(() => setSettled(value), PINE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, settled])
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled
  useEffect(() => { onSettledRef.current?.(settled) }, [settled])

  // ⭐ L1 — an `import`ed library arrives from the store; recompile when it lands.
  const libRevision = usePineLibraries(settled)
  const built = useMemo(
    () => (settled.trim()
      ? memberPaneDefinition({ source: settled, id: (applied && applied.defId) || MEMBER_PANE_DEF_PREFIX })
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- libRevision: rebuild when a library lands
    [settled, applied, libRevision],
  )
  const report = useMemo(() => authoringDiagnostics(built, settled), [built, settled])
  const pending = value !== settled
  // ⭐ A5 — the document as the inputs panel has it (atomic; see `applyInputValues`).
  const shown = useMemo(
    () => (built && built.ok && built.definition
      ? applyInputValues(built.definition, inputValues || {}) : null),
    [built, inputValues],
  )

  // ── jump to the token the door named ────────────────────────────────────
  const jump = useCallback((it) => {
    if (!it || it.line == null) return
    const len = it.token ? it.token.length : 0
    const view = editorRef.current && editorRef.current.view ? editorRef.current.view() : null
    if (view) {
      const doc = view.state.doc
      const line = doc.line(Math.min(Math.max(it.line, 1), doc.lines))
      const from = Math.min(line.from + (it.column || 1) - 1, line.to)
      const to = Math.min(from + len, line.to)
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
      view.focus()
      return
    }
    const area = areaRef.current
    if (!area) return
    const from = offsetOf(value, it.line, it.column)
    area.focus()
    try { area.setSelectionRange(from, Math.min(from + len, value.length)) } catch { /* jsdom */ }
  }, [value])

  // ── apply ───────────────────────────────────────────────────────────────
  const paneOn = memberPaneEnabled()
  const canApply = !!(onApply && paneOn && !disabled && !pending
    && report.state === 'ok' && report.saveable && built && built.definition
    && shown && shown.ok)
  const apply = useCallback(async (opts = {}) => {
    if (!canApply) return
    const addToChart = opts.addToChart !== false
    setApplyState({ state: 'busy', message: null })
    let res = null
    try {
      // ⭐ A2 — the document, named, carrying the SETTLED script it was built from.
      res = await onApply(withPineSource(withName(shown.definition, name), settled), { addToChart })
    } catch {
      setApplyState({ state: 'error', message: 'Could not reach the store. Nothing was saved.' })
      return
    }
    if (res && res.ok) {
      const what = addToChart
        ? (res.updated ? 'Updated on your chart.' : 'Added to your chart.')
        : (res.updated ? 'Saved.' : 'Saved to My scripts.')
      // ⭐ the store's own answer about the source, verbatim when it was withheld
      const kept = res.pineSource && res.pineSource.pine_source === 'withheld'
        ? ` Your code was not kept with it: ${res.pineSource.reason}.` : ''
      setApplyState({ state: 'done', message: what + kept })
      return
    }
    // ⛔ THE STORE'S SENTENCE, VERBATIM (the server's input/compute refusals
    // start with their field path; the member reads exactly that).
    setApplyState({
      state: 'error',
      message: (res && typeof res.error === 'string' && res.error.trim())
        ? res.error : 'The store refused this script.',
    })
  }, [canApply, onApply, shown, name, settled])
  // A new keystroke retires the last apply's outcome — it described other text.
  useEffect(() => { setApplyState({ state: 'idle', message: null }) }, [value])

  const errors = report.items.filter((it) => it.severity === 'error').length
  const warnings = report.items.filter((it) => it.severity === 'warning').length
  let status
  if (!value.trim()) status = 'Write or paste a Pine script.'
  else if (pending) status = 'Checking…'
  else if (report.state === 'ok') {
    status = 'Compiles — ready for the chart'
      + (warnings ? ` (${warnings} output${warnings === 1 ? '' : 's'} not drawn)` : '')
  } else status = `${errors} problem${errors === 1 ? '' : 's'}`

  return (
    <section className={styles.wrap} aria-labelledby="uct-pine-editor-head" data-testid="pine-editor-panel">
      <div className={styles.headRow}>
        <h3 className={styles.head} id="uct-pine-editor-head">Pine Editor</h3>
        {!value.trim() && onChange && (
          <button type="button" className={styles.ghost} onClick={() => onChange(STARTER)}
            data-testid="pine-editor-starter">Start from a template</button>
        )}
      </div>

      {onNameChange && (
        <label className={styles.nameRow}>
          <span className={styles.nameLabel}>Name</span>
          <input className={styles.nameInput} value={name} maxLength={40}
            placeholder={(built && built.ok && built.definition && built.definition.meta
              && built.definition.meta.name) || 'My indicator'}
            onChange={(e) => onNameChange(e.target.value)} disabled={disabled}
            data-testid="pine-editor-name" />
        </label>
      )}

      <textarea
        ref={areaRef}
        className={styles.area}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        rows={14}
        placeholder={STARTER}
        aria-label="Pine source"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        tabIndex={Editor ? -1 : undefined}
        aria-hidden={Editor ? 'true' : undefined}
        hidden={!!Editor}
      />
      {Editor && (
        <div className={styles.editorBox}>
          <Editor
            ref={editorRef}
            value={value}
            onChange={(t) => onChange?.(t)}
            dialect="pine"
            lineNumbers
            // ⭐ THE PRIMARY PROBLEM, STAMPED WITH THE TEXT IT WAS MEASURED ON —
            // `CodeEditor` marks it only while that stamp equals its document.
            diagnostics={report.primary}
            onApply={() => apply()}
            ariaLabel="Pine source editor"
            testId="pine-source-editor"
          />
        </div>
      )}

      <div className={styles.statusRow}>
        <p
          className={styles.status}
          role="status"
          data-testid="pine-editor-status"
          data-state={pending ? 'pending' : report.state}
        >{status}</p>
        {onApply && paneOn && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={!canApply || applyState.state === 'busy'}
              onClick={() => apply({ addToChart: false })}
              data-testid="pine-editor-save"
            >
              Save
            </button>
            <button
              type="button"
              className={styles.apply}
              disabled={!canApply || applyState.state === 'busy'}
              onClick={() => apply()}
              data-testid="pine-editor-apply"
              title="Ctrl/Cmd + Enter"
            >
              {applyState.state === 'busy' ? 'Applying…' : (applied ? 'Update on chart' : 'Add to chart')}
            </button>
          </div>
        )}
      </div>
      {onApply && !paneOn && (
        <p className={styles.note} data-testid="pine-editor-apply-off">
          Drawing a member script on a chart is switched off on this build, so this
          editor checks your script but cannot add it to a chart.
        </p>
      )}
      {applyState.state === 'done' && (
        <p className={styles.ok} role="status" data-testid="pine-editor-applied">{applyState.message}</p>
      )}
      {applyState.state === 'error' && (
        <p className={styles.err} role="alert" data-testid="pine-editor-apply-error">{applyState.message}</p>
      )}

      {!pending && onInputValuesChange && (
        <InputsPanel built={built} values={inputValues || {}} onValues={onInputValuesChange} />
      )}
      {!pending && shown && !shown.ok && (
        <p className={styles.err} role="alert" data-testid="pine-editor-inputs-refused">
          {`Your input values no longer apply to this script, so it is drawn at its own values: ${shown.error}`}
        </p>
      )}

      {!pending && report.items.length > 0 && (
        <ul className={styles.problems} data-testid="pine-editor-problems" aria-label="Problems">
          {report.items.map((it, i) => (
            <li key={`${it.severity}-${it.line}-${it.column}-${i}`} data-severity={it.severity}
              data-guard={it.guard || ''}>
              <button
                type="button"
                className={styles.problem}
                onClick={() => jump(it)}
                disabled={it.line == null}
                data-testid="pine-editor-problem"
              >
                <span className={styles.where} data-severity={it.severity}>{where(it)}</span>
                {/* ⛔ VERBATIM. The refusing door owns the sentence. */}
                <span className={styles.message}>{it.message}</span>
                {it.excerpt && <pre className={styles.excerpt}>{it.excerpt}</pre>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

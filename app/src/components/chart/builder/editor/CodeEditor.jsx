// app/src/components/chart/builder/editor/CodeEditor.jsx
//
// ─── THE EDITOR ─────────────────────────────────────────────────────────────
//
// A CodeMirror 6 view over a CONTROLLED value. `value` in → the doc; a doc
// change from the view → `onChange(text)` at once.
//
// ⛔ NO DEBOUNCE OVER `value`. `FormulaField` owns the one 250 ms settle
// (`FORMULA_DEBOUNCE_MS`), and a second timer over the same value would let the
// `value` prop snap the doc back mid-keystroke — a second authority over one
// value, in time. (The declared-input settle further down is over a DIFFERENT
// value, one nothing else owns, and it is never round-tripped to the caller.)
//
// ⛔⛔ A REFUSAL IS SHOWN ONLY AGAINST THE TEXT IT WAS MEASURED ON, AND THAT IS
// THE MOUNT'S JOB, NOT `diagnostics.js`'s. Every range that module produces is
// an offset into the `doc` IT WAS HANDED; with the 250 ms settle the live
// document is newer than the last refusal, so re-placing an old refusal on the
// new text mis-marks on every derivation path — measured on this branch, a
// `let a = 1 / let a = 2 / a` refusal carried onto `let aaa = 1 / let aaa = 2 /
// aaa` underlines `aaa`, which is fine, under a sentence about `a`, which is
// gone. Of the two ways out — re-evaluate here on the doc we mark, or hold the
// marks until the refusal catches up — THIS COMPONENT HOLDS. It evaluates
// nothing (that is `FormulaField`'s door), and it applies a refusal only while
// the door's own `source` stamp equals the doc. ⛔ The fix is NOT for
// `diagnostics.js` to read `refusal.source`: that would hand that module two
// texts and put a second authority over what its own offsets mean.
//
// ⛔ ESCAPE. `mobile/Sheet.jsx` answers Escape at DOCUMENT CAPTURE and closes the
// topmost sheet (`BuilderSheet` turns that into the discard prompt — the 8/10
// rail). The only listener that runs earlier is one on `window` in the capture
// phase (measured: window capture, then document capture), so that is where an
// open completion popup claims Escape for itself. With no popup open the key is
// untouched and the sheet's rail is exactly what it was.

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, bracketMatching } from '@codemirror/language'
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  completionStatus, closeCompletion,
} from '@codemirror/autocomplete'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { languageFor, highlightStyle, languageKey } from './languages'
import { formulaCompletionSource } from './completions'
import { toDiagnostics } from './diagnostics'
import styles from './CodeEditor.module.css'

/**
 * How long a declared-input NAME SET must hold still before it re-mints a
 * tokenizer.
 *
 * ⭐ THIS IS NOT A COPY OF THE FORMULA SETTLE — it is a different value with a
 * different reason, which is why it is a number here and not an import (and an
 * import would be circular the moment `FormulaField` mounts this component).
 * `languages.js` memoises one `StreamLanguage` per distinct declared-input name
 * set, and `@codemirror/language`'s module-global `typeArray` grows once per
 * `define` and is never reclaimed — the Map does not own it, so evicting an
 * entry frees nothing there AND forces a fresh define on the next hit. An LRU
 * therefore makes it strictly worse. The only thing that reduces mints is
 * fewer distinct sets reaching the door, and this component IS the door:
 * `BuilderSheet` memoises its input scope on per-keystroke state, so naming one
 * input `slowLen` would otherwise mint seven languages on the way to one.
 */
const INPUT_SETTLE_MS = 250

/** What this component actually does with `inputs`: `formulaLanguage` keys its
 *  memo on `languageKey(inputs)` (imported above, not restated — see its own
 *  comment in `languages.js`), and `completions.js` reads the same keys for its
 *  options and for the `let` shadow gate. So the sorted names ARE the whole of
 *  it — two objects with the same names are the same input to every door
 *  below, and re-minting on a fresh identity would be work for no answer. */

const CodeEditor = forwardRef(function CodeEditor({
  value = '',
  onChange = null,
  dialect = 'formula',
  inputs = undefined,
  diagnostics = null,
  ariaLabel = 'Formula editor',
  testId = 'code-editor',
  onApply = null,
}, ref) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const applyingRef = useRef(false)
  const markedRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const inputsRef = useRef(inputs)
  inputsRef.current = inputs
  const languageComp = useRef(new Compartment()).current
  const completionComp = useRef(new Compartment()).current
  // What the view is CURRENTLY configured for, so a rerender that changes
  // neither dispatches nothing at all.
  const installedRef = useRef({ dialect, names: languageKey(inputs) })
  const names = useMemo(() => languageKey(inputs), [inputs])

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    view: () => viewRef.current,
  }), [])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          languageComp.of(languageFor(dialect, inputsRef.current)),
          completionComp.of(autocompletion({ override: [formulaCompletionSource({ inputs: inputsRef.current })] })),
          syntaxHighlighting(highlightStyle(styles)),
          history(),
          // ⛔ NO `drawSelection()`. It replaces the native caret with a drawn
          // `.cm-cursor`, which would make `caret-color` in the stylesheet a
          // second authority over the same caret — and it measures client rects
          // jsdom does not implement, so every test that lets the measure loop
          // run printed a stack trace. Nothing here needs multiple cursors or a
          // rectangular selection; the browser's own caret is the answer.
          bracketMatching(),
          closeBrackets(),
          lintGutter(),
          // Long formulas WRAP rather than scroll horizontally. The `<textarea>`
          // this box replaces soft-wraps by default, and CM's own scroller
          // defaults to `overflow-x: auto` (a side-scroll) — a real downgrade on
          // the mobile bottom sheet this editor is meant to sit in.
          EditorView.lineWrapping,
          keymap.of([
            // ⛔ ALWAYS CONSUMED, AND THIS BINDING MUST STAY AHEAD OF
            // `defaultKeymap`. `@codemirror/commands` binds Mod-Enter to
            // `insertBlankLine` (dist/index.js L1806), so falling through would
            // put a blank line into the member's formula on the chord that is
            // supposed to APPLY it — a doc change nobody asked for, and one that
            // would fire `onChange` on its way out. The apply chord never edits.
            {
              key: 'Mod-Enter',
              run: () => { onApplyRef.current?.(); return true },
            },
            ...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            if (!applyingRef.current) onChangeRef.current?.(update.state.doc.toString())
            // ⛔ FRESHNESS COMES FROM THE DOC, NOT FROM WHETHER THE CALLER
            // ROUND-TRIPS `value`/`diagnostics` BACK. `onChange` defaults to
            // `null` and there is no `readOnly` prop, so an un-wired mount is a
            // configuration these props declare legal — and without this, a
            // keystroke the caller never feeds back as a new `value` (or simply
            // hasn't re-rendered yet) leaves a stale mark standing over text
            // that has already moved on, because the diagnostics effect below
            // only re-runs when `diagnostics`/`value` actually change. Every
            // edit clears first, here; the diagnostics effect re-applies only
            // if the CURRENT `diagnostics` prop still names the doc that now
            // exists. (Safe to dispatch from inside this listener — CM resets
            // `updateState` to Idle in a `finally` BEFORE invoking update
            // listeners, measured at `@codemirror/view`'s `update()`/`measure()`
            // listener-firing sites.)
            if (markedRef.current) {
              markedRef.current = false
              view.dispatch(setDiagnostics(view.state, []))
            }
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, tabindex: '0' }),
        ],
      }),
      parent: host,
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // Mount once; `value`, `dialect` and `inputs` reach the view again through
    // the effects below on every later change — `ariaLabel` does not: it is
    // baked into this same mount-time `contentAttributes` extension and stays
    // whatever it was when the editor first mounted, for the life of this DOM
    // node. (Listing any of the four as a dependency here would tear the whole
    // editor down on a keystroke — that is why this effect stays `[]`, not why
    // `ariaLabel` in particular is frozen.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── value → doc, without an echo through onChange ─────────────────────────
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    // The controlled round trip: what the caller hands back is what we sent, so
    // the common case dispatches nothing and the caret never moves.
    if (current === value) return
    applyingRef.current = true
    try {
      // The caret goes to the END of the new text, not the front. Measured
      // without this: caret at 4 in `sma(close, 20)`, an external replace to
      // `ema(close, 50)` left it at 0 — every planned external-write path
      // (Concierge, Starter Library, loading a saved definition) put the
      // member's cursor at the front of a formula they did not just type. The
      // old head cannot be mapped meaningfully across two different strings, so
      // this is a `selection`, not a re-map — CM applies it against the doc
      // that results from `changes`, not the one before it.
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: value.length },
      })
    } finally {
      applyingRef.current = false
    }
  }, [value])

  // ── dialect / declared inputs → tokenizer + completion source ─────────────
  //
  // A DIALECT SWITCH IS A DELIBERATE ACT and lands at once; a declared input's
  // NAME IS TYPED and settles first (see INPUT_SETTLE_MS). Both ride the same
  // pair of compartments, so whichever fires reconfigures from the values that
  // are current at that moment.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return undefined
    const installed = installedRef.current
    if (installed.dialect === dialect && installed.names === names) return undefined
    const apply = () => {
      const live = viewRef.current
      if (!live) return
      installedRef.current = { dialect, names }
      live.dispatch({
        effects: [
          languageComp.reconfigure(languageFor(dialect, inputsRef.current)),
          completionComp.reconfigure(
            autocompletion({ override: [formulaCompletionSource({ inputs: inputsRef.current })] }),
          ),
        ],
      })
    }
    if (installed.dialect !== dialect) { apply(); return undefined }
    const id = setTimeout(apply, INPUT_SETTLE_MS)
    return () => clearTimeout(id)
  }, [dialect, names, languageComp, completionComp])

  // ── refusal → lint marks, only against the text it was measured on ────────
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // ⛔⛔ ONE DOOR, NOT TWO. A `Diagnostic[]` array branch used to stand here
    // and bypass the `=== source` gate entirely — measured mis-mark: an array
    // `[{from:9,to:12}]` marked `"oo("`, and after `value` changed to a
    // DIFFERENT formula the SAME array kept marking, now over `"ma("`, a token
    // in text it was never measured on. CONTROLLER RULING: deleted, not
    // stamped — nothing in this app passes an array today (`CodeEditor` has one
    // caller, its own test file), so stamping it would have imposed a new
    // obligation on callers that do not exist. A caller with pre-resolved
    // ranges stamps `source` on its object instead — the same shape
    // `evaluateFormula` already returns — and comes through the one gate below
    // like everything else. The stamp IS the contract.
    let diags = []
    if (diagnostics && diagnostics.source === view.state.doc.toString()) {
      // ⛔ `=== source` AND NOTHING LOOSER. A refusal that names no text cannot
      // be told apart from a stale one, and a wrong mark — the right token
      // underlined under the wrong sentence — is worse than no mark. The fix for
      // a door that has a position but no stamp is the stamp, at the door that
      // knows, which is what `evaluateFormula` already does.
      diags = toDiagnostics(view.state.doc, diagnostics)
    }
    // Nothing to say and nothing said: no transaction. The alternative is one
    // lint transaction per keystroke for a document with no refusal on it.
    if (!diags.length && !markedRef.current) return
    markedRef.current = diags.length > 0
    view.dispatch(setDiagnostics(view.state, diags))
  }, [diagnostics, value])

  // ── Escape belongs to an open completion popup; otherwise to the sheet ────
  useEffect(() => {
    const onKey = (e) => {
      const view = viewRef.current
      if (!view || e.key !== 'Escape') return
      // Only ours: a key pressed anywhere else on the page is the sheet's, even
      // while this editor happens to have a popup open.
      if (!view.dom.contains(e.target)) return
      if (completionStatus(view.state) === null) return
      e.stopPropagation()
      e.preventDefault()
      closeCompletion(view)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return <div ref={hostRef} className={styles.editor} data-testid={testId} data-dialect={dialect} />
})

export default CodeEditor

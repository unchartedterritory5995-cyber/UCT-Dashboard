// app/src/components/chart/builder/editor/CodeEditor.test.jsx
//
// The component's CONTRACT under jsdom — CodeMirror mounts, edits, tokenizes and
// lints there (all measured on this branch 2026-08-26). Layout is NOT measurable
// here and is not claimed; W1a.8's live audit is where pixels are checked.
//
// ⛔ ONE THING THIS FILE CANNOT SEE, STATED ONCE SO NOBODY TRUSTS IT TWICE:
// vitest runs with `css: false`, and its CSS-modules stand-in is a Proxy that
// answers EVERY key with `_<key>_<hash>` — measured: `styles.nope` read
// `"_nope_abf318"` for a class no stylesheet declares. So a DOM assertion that a
// token wears the module's class passes whether or not `CodeEditor.module.css`
// declares it. The DOM cases below therefore claim only what they can prove —
// that the TOKENIZER's answer reaches the DOM as a class — and the stylesheet
// itself is checked separately, off disk, the way `styles/tokens.test.js` does it.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startCompletion, completionStatus, currentCompletions } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { language } from '@codemirror/language'
import CodeEditor from './CodeEditor'
import { highlightStyle } from './languages'
import { toDiagnostics } from './diagnostics'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUT_SCOPE } from '../builderInputs'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

// ⚠️ EVERY RERENDER GOES THROUGH `set`, AND IT KEEPS THE REF. RTL's `rerender`
// replaces the element wholesale, so a rerender written without `ref={ref}`
// detaches the handle and every later `view()` reads `null` — which looks like a
// component bug and is a test bug. (The four rerenders in the brief's draft were
// all written that way.)
function mount(props = {}) {
  const ref = createRef()
  const onChange = vi.fn()
  const base = { value: 'sma(close, 20)', onChange, testId: 'code-editor', ...props }
  const utils = render(<CodeEditor ref={ref} {...base} />)
  const set = (next) => utils.rerender(<CodeEditor ref={ref} {...base} {...next} />)
  return { ...utils, ref, onChange, set, view: () => ref.current.view() }
}

const host = () => screen.getByTestId('code-editor')
const marks = () => host().querySelectorAll('.cm-lintRange-error')
const spanClass = (text) =>
  [...host().querySelectorAll('.cm-line span')].find((s) => s.textContent === text)?.className

describe('the doc and the value', () => {
  it('mounts CodeMirror with the value as its document, labelled, in the tab ring', () => {
    const { view } = mount()
    expect(host().querySelector('.cm-editor')).toBeTruthy()
    expect(view().state.doc.toString()).toBe('sma(close, 20)')
    const content = host().querySelector('.cm-content')
    expect(content.getAttribute('aria-label')).toBe('Formula editor')
    expect(content.getAttribute('tabindex')).toBe('0')
    expect(content.getAttribute('role')).toBe('textbox')
  })

  it('long formulas WRAP — no `EditorView.lineWrapping` means a horizontal scroll instead', () => {
    // `EditorView.lineWrapping` is `contentAttributes.of({class:'cm-lineWrapping'})`
    // (`@codemirror/view`), so its presence is a plain DOM class — provable in
    // jsdom without measuring any actual layout. CM's `.cm-scroller` defaults to
    // `overflow-x: auto` (a side-scroll) without it — a real downgrade from the
    // `<textarea>` this box replaces, which soft-wraps.
    mount()
    expect(host().querySelector('.cm-content').classList.contains('cm-lineWrapping')).toBe(true)
  })

  it('the lint gutter is there for the refusal marker to land in', () => {
    // The stylesheet has a `.cm-gutters` rule; without `lintGutter()` that rule
    // styles an element that never renders, and the only standing sign of a
    // refusal is the underline itself.
    mount()
    expect(host().querySelector('.cm-gutters')).toBeTruthy()
  })

  it('brackets match under the caret, and history undoes an edit', () => {
    const { view, onChange } = mount()
    act(() => { view().dispatch({ selection: { anchor: 3 } }) })
    expect(host().querySelectorAll('.cm-matchingBracket').length).toBeGreaterThan(0)
    act(() => { view().dispatch({ changes: { from: view().state.doc.length, insert: ' + 1' } }) })
    expect(view().state.doc.toString()).toBe('sma(close, 20) + 1')
    act(() => {
      view().contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(view().state.doc.toString()).toBe('sma(close, 20)')
    expect(onChange).toHaveBeenLastCalledWith('sma(close, 20)')
  })

  it('takes the label it is given — the box is not always called "Formula"', () => {
    mount({ ariaLabel: 'Plot 2 formula editor' })
    expect(host().querySelector('.cm-content').getAttribute('aria-label')).toBe('Plot 2 formula editor')
  })

  it('a new value prop replaces the doc WITHOUT echoing back through onChange', () => {
    const { set, view, onChange } = mount()
    set({ value: 'close > open' })
    expect(view().state.doc.toString()).toBe('close > open')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an external whole-doc replace puts the caret at the END of the new text, not the front', () => {
    // Measured without this: caret at 4 in `sma(close, 20)`, an external
    // replace to `ema(close, 50)` (14 chars) left the caret at 0 — every
    // planned external-write path (Concierge, Starter Library, loading a
    // saved definition) put the member's cursor at the front of a formula
    // they did not just type.
    const { view, set } = mount()
    act(() => { view().dispatch({ selection: { anchor: 4 } }) })
    expect(view().state.selection.main.head).toBe(4)
    set({ value: 'ema(close, 50)' })
    expect(view().state.doc.toString()).toBe('ema(close, 50)')
    expect(view().state.selection.main.head).toBe('ema(close, 50)'.length)
  })

  it('typing (a doc change from the view) calls onChange synchronously with the whole text', () => {
    const { view, onChange } = mount()
    act(() => { view().dispatch({ changes: { from: view().state.doc.length, insert: ' + 1' } }) })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('sma(close, 20) + 1')
  })

  it('⛔ THE CONTROL — the value coming BACK from the caller never re-writes the doc', () => {
    // This is the case that decides whether the box is usable: every keystroke
    // round-trips through the caller's state, so without the `current === value`
    // short-circuit the doc is replaced wholesale on each one and the caret jumps
    // to the end. ⚠️ A rerender with an UNCHANGED `value` proves nothing here —
    // React skips the effect on dep equality, so the guard is never reached. The
    // text has to have genuinely moved, and come back.
    const { view, set, onChange } = mount()
    act(() => { view().dispatch({ changes: { from: 3, insert: 'X' } }) })
    const afterTyping = view().state
    const caret = afterTyping.selection.main.head
    set({ value: onChange.mock.lastCall[0] })
    expect(view().state).toBe(afterTyping)
    expect(view().state.selection.main.head).toBe(caret)
  })
})

describe('the tokenizer reaches the DOM', () => {
  it('each token wears the class the CSS module names for it', () => {
    mount()
    expect(spanClass('sma')).toMatch(/fn/)
    expect(spanClass('close')).toMatch(/series/)
    expect(spanClass('20')).toMatch(/number/)
  })

  it('the dialect prop chooses the tokenizer, at once — a switch is not typing', () => {
    mount({ value: 'ta.crossover(close, open)', dialect: 'pine' })
    expect(host().getAttribute('data-dialect')).toBe('pine')
    expect(spanClass('ta')).toMatch(/namespace/)
    expect(spanClass('crossover')).toMatch(/fn/)
  })

  it('a dialect CHANGE lands at once — the mount seed is not the only path', () => {
    // Without this the "at once" claim is untestable: a fresh mount seeds
    // `languageFor(dialect)` in its own state, so a settled reconfigure would
    // look identical. Here the editor is already alive on the formula dialect
    // and no timer is advanced.
    // CodeMirror merges adjacent same-class tokens into one span, so under the
    // formula tokenizer `ta`, `.` and `crossover` are all `unknown` and arrive as
    // a single span; under Pine they split three ways.
    const { set } = mount({ value: 'ta.crossover(close, open)' })
    expect(spanClass('ta.crossover')).toMatch(/unknown/)
    set({ dialect: 'pine' })
    expect(spanClass('ta')).toMatch(/namespace/)
    expect(spanClass('crossover')).toMatch(/fn/)
  })

  it('the MOUNT already knows the declared inputs — no settle is owed on the first paint', () => {
    // The reconfigure effect only ever fires on a CHANGE, so an editor opened on
    // a definition that already declares knobs gets its scope from the mount seed
    // or not at all — and "not at all" paints every declared name as `unknown`,
    // in red, for a formula that is perfectly correct.
    mount({ value: 'slowLen', inputs: { slowLen: true } })
    expect(spanClass('slowLen')).toMatch(/input/)
  })

  it('brackets close themselves — the input handler is wired', () => {
    // ⚠️ WHAT THIS PROVES AND WHAT IT DOES NOT. jsdom cannot deliver a real
    // `beforeinput` through contenteditable, so the door the view would call is
    // called here with the arguments the view would pass. That the KEY produces
    // the character is the browser's part, and W1a.8's to confirm.
    const { view } = mount({ value: 'sma' })
    // The handler refuses anything that is not AT the caret, so the caret goes
    // there first — the same precondition a real keystroke satisfies.
    act(() => { view().dispatch({ selection: { anchor: 3 } }) })
    const handled = view().state
      .facet(EditorView.inputHandler)
      .some((h) => h(view(), 3, 3, '('))
    expect(handled).toBe(true)
    expect(view().state.doc.toString()).toBe('sma()')
  })

  it('⛔ AND THE STYLESHEET IS READ OFF DISK — every token the highlighter can emit has a class', () => {
    // The token names are RECORDED off `highlightStyle`, never retyped: it reads
    // `map[key]` for every key of `languages.js`'s closed TOKEN_TABLE, so a Proxy
    // that logs its reads IS the list. A sixteenth token added there shows up here
    // the day it lands.
    const seen = new Set()
    highlightStyle(new Proxy({}, { get(_, k) { if (typeof k === 'string') seen.add(k); return 'x' } }))
    expect(seen.size).toBeGreaterThanOrEqual(15)
    // ⚠️ `import.meta.dirname`, NOT `new URL('./literal', import.meta.url)`.
    // Vite's asset plugin statically rewrites that exact literal form into a
    // served asset URL, and `fileURLToPath` then throws "The URL must be of
    // scheme file" — measured here. (`styles/tokens.test.js` survives the same
    // idiom only because its path argument is a variable.)
    const css = readFileSync(join(import.meta.dirname, 'CodeEditor.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    // ⛔ THE BASE RULE, ANCHORED TO THE START OF A LINE. An unanchored `.number`
    // is satisfied by `:global([data-theme='light']) .number` too, so deleting a
    // base colour and keeping only its light override would read as covered —
    // measured: that exact mutation survived the unanchored form.
    const base = (name) => new RegExp(`^\\.${name}\\s*\\{([^}]*)\\}`, 'm').exec(css)
    const missing = [...seen].filter((name) => !base(name))
    expect(missing).toEqual([])

    // ⛔ AND A RAW HEX OWES A LIGHT ANSWER. The token layer inverts itself, so a
    // `var(--…)` colour needs nothing; a literal is tuned for the dark themes and
    // renders pastel-on-white without an override. Which classes are which is
    // READ off the file, so a sixteenth hex lands under this rail, not past it.
    const rawHex = [...seen].filter((name) => !/color:\s*var\(/.test(base(name)[1]))
    expect(rawHex.length).toBeGreaterThan(0)
    const noLight = rawHex.filter(
      (name) => !new RegExp(`\\[data-theme='light'\\]\\)\\s*\\.${name}\\s*[,{]`).test(css),
    )
    expect(noLight).toEqual([])
  })

  it('⛔⛔ THE HOST DOES NOT CLIP — jsdom has no layout, so this is read off the stylesheet, not rendered', () => {
    // Finding 3: `.editor { overflow: hidden }` used to round the box's own
    // corners and, as a side effect, clip the completion popup with it — the
    // popup's container is `view.dom` (`.cm-editor`), a DOM child of `.editor`,
    // positioned `absolute` on iOS always and on every platform once CM's
    // transformed-ancestor kludge fires (permanently, per view). An
    // `overflow: hidden` ancestor clips an absolutely-positioned descendant
    // regardless of what its own containing block resolves to — jsdom cannot
    // render that, so a green jsdom assertion here would prove nothing; this
    // reads the actual rule text off disk instead, the way the token-class
    // rail above does.
    const css = readFileSync(join(import.meta.dirname, 'CodeEditor.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const editorRule = /^\.editor\s*\{([^}]*)\}/m.exec(css)
    expect(editorRule).toBeTruthy()
    expect(editorRule[1]).not.toMatch(/overflow\s*:/)
    // The corner clip moved to `.cm-scroller` — a SIBLING of the tooltip
    // container inside `.cm-editor`, never an ancestor of it — so rounding the
    // scrolling text no longer touches the popup.
    const scrollerRule = /\.editor\s*:global\(\.cm-scroller\)\s*\{([^}]*)\}/.exec(css)
    expect(scrollerRule).toBeTruthy()
    expect(scrollerRule[1]).toMatch(/overflow\s*:\s*hidden/)
  })
})

describe('a refusal is shown ONLY against the text it was measured on', () => {
  it('a refusal measured on THIS text becomes a lint mark that repeats it', () => {
    const src = 'close > foo(close, 3)'
    const refusal = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    mount({ value: src, diagnostics: refusal })
    expect(marks()).toHaveLength(1)
    expect(marks()[0].textContent).toBe('foo')
  })

  it('⛔⛔ THE MEASURED MIS-MARK: a refusal whose text has since changed marks NOTHING', () => {
    // The hazard is not hypothetical and this case is the one measured on this
    // branch: every range `diagnostics.js` produces is an offset into the doc it
    // was handed, so a `let:shadow` refusal about `a` re-placed on a doc that now
    // says `aaa` underlines `aaa` — text with nothing wrong with it — under the
    // OLDER sentence.
    const measuredOn = 'let a = 1\nlet a = 2\na'
    const nowInTheBox = 'let aaa = 1\nlet aaa = 2\naaa'
    const refusal = evaluateFormula(measuredOn, BUILDER_INPUT_SCOPE)
    expect(refusal.guard).toBe('let:shadow')
    expect(refusal.source).toBe(measuredOn)

    const { view, set } = mount({ value: measuredOn, diagnostics: refusal })
    expect(marks()).toHaveLength(1)
    set({ value: nowInTheBox })
    // ⭐ THE CONTROL: hand `toDiagnostics` the NEWER doc with the OLDER refusal
    //   and it DOES produce a range — over `aaa`. That is what the gate stops, so
    //   this case cannot be passing because there was nothing to mark.
    const wouldMark = toDiagnostics(view().state.doc, refusal)
    expect(nowInTheBox.slice(wouldMark[0].from, wouldMark[0].to)).toBe('aaa')
    // …and the editor shows none of it.
    expect(marks()).toHaveLength(0)
  })

  it('a refusal for other text is not shown, and the SAME refusal returns when the text does', () => {
    const src = 'close > foo(close, 3)'
    const refusal = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    const { set } = mount({ value: src, diagnostics: refusal })
    expect(marks()).toHaveLength(1)
    set({ value: 'close > open' })
    expect(marks()).toHaveLength(0)
    set({ value: src })
    expect(marks()).toHaveLength(1)
  })

  it('⛔ AND A MARK DOES NOT SURVIVE AN EDIT THAT MISSES IT', () => {
    // The commonest stale mark of all, and the one the range mapping will NOT
    // take down for you: an edit somewhere else in the line maps the mark on
    // `foo` through untouched, so it sits there under a sentence measured on text
    // that has moved on. Only an explicit clear removes it.
    const src = 'close > foo(close, 3)'
    const refusal = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    const { view, set, onChange } = mount({ value: src, diagnostics: refusal })
    expect(marks()).toHaveLength(1)
    // ⚠️ IT HAS TO BE A REAL KEYSTROKE. Setting `value` from outside replaces the
    // whole doc, which deletes the marked range and takes the mark with it — so
    // that path proves nothing. A keystroke is a NARROW change: CodeMirror maps
    // the mark on `foo` straight through it, and only an explicit clear removes
    // it. This is the exact shape the 250 ms settle produces on every character.
    act(() => { view().dispatch({ changes: { from: view().state.doc.length, insert: ' + 1' } }) })
    set({ value: onChange.mock.lastCall[0] })
    expect(marks()).toHaveLength(0)
  })

  it('an accepted result marks nothing', () => {
    const src = 'sma(close, 20)'
    const ok = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    expect(ok.ok).toBe(true)
    mount({ value: src, diagnostics: ok })
    expect(marks()).toHaveLength(0)
  })

  it('⛔ a refusal that does not NAME the text it was measured on is not shown — fail closed', () => {
    // A translator refusal (`pine.js` → `{guard, message, line, column, token}`)
    // carries no `source`, so nothing here can tell a fresh one from a stale one.
    // Marking it anyway is the defect above with the stamp removed; the fix is a
    // one-line stamp at the door that knows, exactly as `evaluateFormula` does.
    mount({ value: 'close > open', diagnostics: { guard: 'pine:call', message: 'nope', line: 1, column: 1 } })
    expect(marks()).toHaveLength(0)
  })

  it('⛔⛔ THE DELETED ARRAY DOOR: a bare Diagnostic[] has no `source` to check and marks nothing', () => {
    // A `Diagnostic[]` branch used to stand here and apply an array exactly as
    // handed in, bypassing the `=== source` gate entirely. Measured mis-mark on
    // this branch: mounted with `diagnostics=[{from:9,to:12}]` against
    // `'close > foo(1)'`, the mark landed on `"oo("`; after `value` changed to
    // a DIFFERENT formula (`'close > sma(close, 20)'`) the SAME array was still
    // applied and now marked `"ma("` — a token in text the diagnostic was never
    // measured on. CONTROLLER RULING: deleted, not stamped (no caller in the
    // app passes an array today). This is the replacement rail: an array has
    // no `.source`, so `diagnostics.source === doc` is false and the gate
    // refuses it exactly like any other unstamped refusal — there is no
    // second, weaker door.
    mount({ value: 'close > open', diagnostics: [{ from: 0, to: 5, severity: 'error', message: 'mine' }] })
    expect(marks()).toHaveLength(0)
  })

  it('⛔⛔ AND THE FRESHNESS GUARD DOES NOT DEPEND ON THE CALLER ROUND-TRIPPING ANYTHING', () => {
    // Finding 2: `onChange` defaults to `null` and there is no `readOnly` prop,
    // so an un-wired mount is a configuration the props declare legal. Without
    // a clear keyed to the DOC ITSELF, a mount nobody wires back would leave a
    // mark standing over text that has already moved on — the freshness
    // invariant held only as long as the caller chose to feed a new `value`
    // back. Measured here with NO `set({value})` call at all, and no
    // `onChange` handler: a bare keystroke clears the mark by itself.
    const src = 'close > foo(close, 3)'
    const refusal = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    const { view } = mount({ value: src, diagnostics: refusal, onChange: undefined })
    expect(marks()).toHaveLength(1)
    act(() => { view().dispatch({ changes: { from: view().state.doc.length, insert: ' + 1' } }) })
    expect(marks()).toHaveLength(0)
  })
})

describe('keys stay inside the editor', () => {
  it('Escape with a completion open closes the popup and never reaches a document-capture listener', () => {
    const sheet = vi.fn()
    document.addEventListener('keydown', sheet, true)
    const { view } = mount({ value: 's' })
    act(() => { view().dispatch({ selection: { anchor: 1 } }); startCompletion(view()) })
    expect(completionStatus(view().state)).not.toBe(null)
    act(() => {
      view().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(sheet).not.toHaveBeenCalled()
    expect(completionStatus(view().state)).toBe(null)
    document.removeEventListener('keydown', sheet, true)
  })

  it('⛔ THE CONTROL — Escape with NO popup is left for the sheet (the 8/10 discard-prompt rail)', () => {
    const sheet = vi.fn()
    document.addEventListener('keydown', sheet, true)
    const { view } = mount()
    act(() => {
      view().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(sheet).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', sheet, true)
  })

  it('⛔ AND AN ESCAPE FROM OUTSIDE THIS EDITOR IS NEVER CLAIMED, popup or no popup', () => {
    const sheet = vi.fn()
    document.addEventListener('keydown', sheet, true)
    const { view } = mount({ value: 's' })
    act(() => { view().dispatch({ selection: { anchor: 1 } }); startCompletion(view()) })
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(sheet).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', sheet, true)
  })

  it('the window listener is removed on unmount — the SAME handler, off the window', () => {
    // ⚠️ Behaviour alone cannot see this. The handler early-returns once the view
    // is destroyed, so a leaked listener is silent — and a builder sheet opened
    // and closed twenty times would leave twenty of them on `window`. The
    // identity of the function added and the function removed is the evidence.
    const added = []
    const removed = []
    // ⚠️ The REAL methods are captured and re-called. `EditorView` registers
    // window listeners of its own during construction, and routing them through
    // `EventTarget.prototype.addEventListener.call(window, ...)` fails jsdom's
    // brand check ("called on an object that is not a valid instance of
    // EventTarget") — which crashes the view rather than observing it.
    const realAdd = window.addEventListener.bind(window)
    const realRemove = window.removeEventListener.bind(window)
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
      if (type === 'keydown' && opts === true) added.push(fn)
      return realAdd(type, fn, opts)
    })
    const rmSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, fn, opts) => {
      if (type === 'keydown' && opts === true) removed.push(fn)
      return realRemove(type, fn, opts)
    })
    try {
      const { unmount } = mount({ value: 's' })
      expect(added).toHaveLength(1)
      unmount()
      expect(removed).toEqual(added)
    } finally {
      addSpy.mockRestore()
      rmSpy.mockRestore()
    }
  })

  it('Mod-Enter calls onApply and is consumed', () => {
    const onApply = vi.fn()
    const { view } = mount({ onApply })
    const ev = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => { view().contentDOM.dispatchEvent(ev) })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('⛔ THE CONTROL — the apply chord never EDITS: with no onApply it still writes nothing', () => {
    // `defaultKeymap` binds Mod-Enter to `insertBlankLine`. Delete this
    // component's binding and that one wins: the doc gains a newline and
    // `onChange` fires — on the chord that is supposed to apply the formula.
    const { view, onChange } = mount()
    const ev = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => { view().contentDOM.dispatchEvent(ev) })
    expect(view().state.doc.toString()).toBe('sma(close, 20)')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ref.focus() puts focus on the content', () => {
    const { ref, view } = mount()
    act(() => { ref.current.focus() })
    expect(document.activeElement).toBe(view().contentDOM)
  })
})

describe('the declared inputs settle before they mint a tokenizer', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })

  const langOf = (view) => view.state.facet(language)
  const NAME = 'slowLen'
  const typed = NAME.split('').map((_, i) => NAME.slice(0, i + 1)) // s, sl, slo, …

  it('typing a declared input’s name mints ONE language, not one per keystroke', () => {
    // `languages.js` memoises one StreamLanguage per declared-input NAME SET, and
    // `@codemirror/language`'s module-global `typeArray` grows once per define and
    // is never reclaimed — so the cost is the number of distinct sets that reach
    // the door, and this component IS the door.
    const { set, view } = mount({ value: NAME, inputs: {} })
    const seen = new Set([langOf(view())])
    for (const partial of typed) {
      set({ inputs: { [partial]: true } })
      seen.add(langOf(view()))
    }
    expect(typed.length).toBe(7)
    act(() => { vi.advanceTimersByTime(5000) })
    seen.add(langOf(view()))
    expect(seen.size).toBe(2)
  })

  it('⛔ THE CONTROL — and the settled set DOES reach the tokenizer', () => {
    const { set, view } = mount({ value: NAME, inputs: {} })
    expect(spanClass(NAME)).toMatch(/unknown/)
    set({ inputs: { [NAME]: true } })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(spanClass(NAME)).toMatch(/input/)
    expect(langOf(view())).toBeTruthy()
  })

  it('⛔ a mount does not turn around and reconfigure what it just configured', () => {
    // The mount seeds both compartments from `dialect` + `inputs`, and the
    // reconfigure effect runs once on mount with those same values. Without the
    // installed-state guard that settles into a transaction which swaps the
    // language for an identical one and mints a fresh `autocompletion()` — work
    // for no answer, on every editor the sheet opens.
    // ⚠️ A STATE COMPARISON CANNOT SEE THIS ONE: a mount-time reconfigure lands
    // inside the mount effect, before the test can take its `before` snapshot. The
    // transactions themselves are the evidence — a correctly configured editor
    // dispatches NONE after construction.
    const spy = vi.spyOn(EditorView.prototype, 'dispatch')
    try {
      mount({ value: NAME, inputs: { [NAME]: true } })
      act(() => { vi.advanceTimersByTime(5000) })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('⛔ AND THE SETTLED SCOPE REACHES THE COMPLETION SOURCE, not only the tokenizer', async () => {
    // Two compartments are reconfigured together and only one of them colours
    // text, so a scope dropped on the completion side is invisible to every
    // token assertion above — the popup simply stops offering the knob the
    // member just declared.
    // ⚠️ REAL TIMERS FOR THIS ONE. `@codemirror/autocomplete` reaches 'active'
    // through a resolved Promise as well as a timer, and a microtask is not
    // something `advanceTimersByTime` can flush — measured: it stops at 'pending'
    // forever. So the two waits are real, and each is a state change rather than
    // a duration.
    vi.useRealTimers()
    const { view, set } = mount({ value: 'slow', inputs: {} })
    const before = view().state.facet(language)
    set({ inputs: { [NAME]: true } })
    await waitFor(() => expect(view().state.facet(language)).not.toBe(before))
    act(() => { view().dispatch({ selection: { anchor: 4 } }); startCompletion(view()) })
    await waitFor(() => expect(completionStatus(view().state)).toBe('active'))
    expect(currentCompletions(view().state).map((o) => o.label)).toContain(NAME)
  })

  it('⛔ and a NEW inputs object with the SAME names reconfigures nothing at all', () => {
    const { set, view } = mount({ value: NAME, inputs: { [NAME]: true } })
    act(() => { vi.advanceTimersByTime(5000) })
    const settled = view().state
    set({ inputs: { [NAME]: true } })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(view().state).toBe(settled)
  })
})

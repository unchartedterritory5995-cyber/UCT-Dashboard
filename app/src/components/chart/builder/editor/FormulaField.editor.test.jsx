// 🔴 THE WIRE: FormulaField mounts the editor, and every sheet test that drives
// the textarea keeps working because the textarea never leaves.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { EditorView } from '@codemirror/view'
import FormulaField, { evaluateFormula, FORMULA_DEBOUNCE_MS } from '../FormulaField'
import { BUILDER_INPUT_SCOPE } from '../builderInputs'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** The sheet's contract in miniature: a controlled value, the settle callback. */
function Harness({ initial = '', onEvaluated = () => {}, result = null }) {
  const [value, setValue] = useState(initial)
  return <FormulaField value={value} onChange={setValue} onEvaluated={onEvaluated} result={result} inputs={BUILDER_INPUT_SCOPE} />
}

describe('the editor mounts over the textarea', () => {
  it('the textarea renders first, then the editor arrives and the textarea becomes the hidden model', async () => {
    render(<Harness initial="sma(close, 20)" />)
    const box = screen.getByLabelText('Formula')
    expect(box.tagName).toBe('TEXTAREA')
    expect(screen.queryByTestId('formula-editor')).toBeNull()
    const editor = await screen.findByTestId('formula-editor')
    expect(editor.querySelector('.cm-content').textContent).toBe('sma(close, 20)')
    // still the ONE element the nine sheet test files resolve by label
    expect(screen.getAllByLabelText('Formula')).toHaveLength(1)
    expect(screen.getByLabelText('Formula')).toBe(box)
    expect(box.getAttribute('tabindex')).toBe('-1')
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.value).toBe('sma(close, 20)')
  })

  it('a change on the textarea (the sheet tests\' idiom) reaches the editor doc', async () => {
    render(<Harness initial="" />)
    await screen.findByTestId('formula-editor')
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'close > open' } })
    await waitFor(() => expect(screen.getByTestId('formula-editor').querySelector('.cm-content').textContent).toBe('close > open'))
    expect(screen.getByLabelText('Formula').value).toBe('close > open')
  })

  it('typing in the editor reaches the textarea and evaluates ONCE after the one settle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onEvaluated = vi.fn()
    render(<Harness initial="" onEvaluated={onEvaluated} />)
    const editor = await screen.findByTestId('formula-editor')
    onEvaluated.mockClear()
    const content = editor.querySelector('.cm-content')
    await act(async () => {
      content.focus()
      document.execCommand?.('insertText', false, 'sma(close, 20)')
    })
    // execCommand is not implemented by jsdom; fall back to CodeMirror's own input
    // door. ⛔ NOT `.cmView` — measured against the installed @codemirror/view
    // (6.43.9): that property does not exist anywhere in the package, so a
    // fallback keyed on it would never fire and this test would never prove the
    // thing its name claims. `EditorView.findFromDOM` is CodeMirror's own public,
    // documented API for the identical purpose ("retrieve an editor view instance
    // from the view's DOM representation") — not a test-only global, and it
    // dispatches a REAL transaction through the SAME `updateListener` a keystroke
    // would, which is what "typing in the editor" is actually testing.
    if (screen.getByLabelText('Formula').value !== 'sma(close, 20)') {
      const view = EditorView.findFromDOM(editor)
      expect(view, 'EditorView.findFromDOM must resolve the mounted view').toBeTruthy()
      await act(async () => { view.dispatch({ changes: { from: 0, insert: 'sma(close, 20)' } }) })
    }
    expect(screen.getByLabelText('Formula').value).toBe('sma(close, 20)')
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    expect(onEvaluated).toHaveBeenCalledTimes(1)
    expect(onEvaluated.mock.calls[0][0].source).toBe('sma(close, 20)')
    vi.useRealTimers()
  })

  it('a refusal in `result` shows as a lint mark AND the verbatim chip', async () => {
    const result = evaluateFormula('close > foo(close, 3)', BUILDER_INPUT_SCOPE)
    render(<Harness initial="close > foo(close, 3)" result={result} />)
    const editor = await screen.findByTestId('formula-editor')
    await waitFor(() => expect(editor.querySelectorAll('.cm-lintRange-error')).toHaveLength(1))
    expect(screen.getByTestId('formula-error').textContent).toContain(result.error)
    expect(screen.getByTestId('formula-error').getAttribute('data-guard')).toBe('resolve:function')
  })

  it('the dialect the editor wears is READ OFF the result — TC2000 result → pcf tokenizer', async () => {
    const result = evaluateFormula('C > AVGC50', BUILDER_INPUT_SCOPE)
    expect(result.dialect).toBe('pcf')
    render(<Harness initial="C > AVGC50" result={result} />)
    const editor = await screen.findByTestId('formula-editor')
    expect(editor.getAttribute('data-dialect')).toBe('pcf')
  })
})

describe('the fallback', () => {
  it('when the chunk fails to load the textarea stays the visible, focusable box', async () => {
    vi.doMock('./CodeEditor', () => { throw new Error('Failed to fetch dynamically imported module') })
    vi.resetModules()
    const { default: Field } = await import('../FormulaField')
    render(<Field value="sma(close, 20)" onChange={() => {}} onEvaluated={() => {}} inputs={BUILDER_INPUT_SCOPE} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('formula-editor')).toBeNull()
    const box = screen.getByLabelText('Formula')
    expect(box.getAttribute('tabindex')).toBeNull()
    expect(box.getAttribute('aria-hidden')).toBeNull()
    vi.doUnmock('./CodeEditor')
  })
})

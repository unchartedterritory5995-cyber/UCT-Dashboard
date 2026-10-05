// A6 — the mounted editor: the Pine dialect completes from the ENGINE'S Pine
// vocabulary (version-aware) and folds by indentation; the formula dialect is
// untouched (its own closed-table source, no fold gutter).
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { startCompletion, completionStatus, currentCompletions } from '@codemirror/autocomplete'
import { foldable } from '@codemirror/language'

import CodeEditor from './CodeEditor'

afterEach(() => cleanup())

function mount(props) {
  const { container } = render(<CodeEditor {...props} />)
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor'))
  return { container, view }
}

async function completionsAt(view, pos) {
  act(() => { view.dispatch({ selection: { anchor: pos } }); startCompletion(view) })
  await waitFor(() => expect(completionStatus(view.state)).toBe('active'))
  return currentCompletions(view.state).map((o) => o.label)
}

describe('A6 — CodeEditor in the Pine dialect', () => {
  it('⭐ v5: completes `ta.sma`, never the formula dialect\'s bare `sma`', async () => {
    const doc = '//@version=5\nindicator("x")\nplot(ta.sm'
    const { view } = mount({ value: doc, dialect: 'pine' })
    const got = await completionsAt(view, doc.length)
    expect(got).toContain('ta.sma')
    expect(got).not.toContain('sma')
  })

  it('⭐ v4: the same keystrokes complete the bare v4 spelling', async () => {
    const doc = '//@version=4\nstudy("x")\nplot(sm'
    const { view } = mount({ value: doc, dialect: 'pine' })
    const got = await completionsAt(view, doc.length)
    expect(got).toContain('sma')
    expect(got).not.toContain('ta.sma')
  })

  it('⭐ an indented block is foldable and the fold gutter is drawn', () => {
    const doc = '//@version=5\nindicator("x")\nif close > open\n    a = 1\nplot(close)'
    const { container, view } = mount({ value: doc, dialect: 'pine' })
    expect(container.querySelector('.cm-foldGutter')).not.toBe(null)
    const line = view.state.doc.line(3)
    expect(foldable(view.state, line.from, line.to)).toEqual({ from: line.to, to: view.state.doc.line(4).to })
  })

  it('⛔ the formula dialect is unchanged: closed-table completions, no fold gutter', async () => {
    const { container, view } = mount({ value: 'sm', dialect: 'formula' })
    expect(container.querySelector('.cm-foldGutter')).toBe(null)
    const got = await completionsAt(view, 2)
    expect(got).toContain('sma')
    expect(got).not.toContain('ta.sma')
  })
})

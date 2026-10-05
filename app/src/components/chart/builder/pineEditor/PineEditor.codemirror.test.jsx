// A1 — the Pine Editor on its REAL editor: CodeMirror, Pine highlighting, a
// numbered gutter, the primary refusal marked in the lint gutter, and a
// problem click that moves the CodeMirror selection to the refused token.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { EditorView } from '@codemirror/view'
import { forceLinting } from '@codemirror/lint'

import PineEditor from './PineEditor'
import { PINE_DEBOUNCE_MS } from '../PineBox'

const BROKEN = '//@version=5\nindicator("x")\nplot(ta.foo(close, 14))'

function Host({ initial = '' }) {
  const [v, setV] = useState(initial)
  return <PineEditor value={v} onChange={setV} />
}

const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

beforeEach(() => { vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

async function mounted(initial) {
  render(<Host initial={initial} />)
  const host = await screen.findByTestId('pine-source-editor')
  await wait(PINE_DEBOUNCE_MS + 30)
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor'))
  expect(view).toBeTruthy()
  return { host, view }
}

describe('PineEditor — the CodeMirror path', () => {
  it('⭐ mounts the Pine dialect with a numbered gutter, the textarea stepping aside', async () => {
    const { host, view } = await mounted(BROKEN)
    expect(host.dataset.dialect).toBe('pine')
    const numbers = [...host.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
      .map((e) => e.textContent).filter(Boolean)
    expect(numbers).toEqual(expect.arrayContaining(['1', '2', '3']))
    expect(view.state.doc.toString()).toBe(BROKEN)
    // the fallback textarea is still the labelled control, but hidden and out of the tab order
    const area = screen.getByLabelText('Pine source')
    expect(area.hidden).toBe(true)
    expect(area.tabIndex).toBe(-1)
  })

  it('⭐ the refused token is marked as an error in the lint gutter', async () => {
    const { host, view } = await mounted(BROKEN)
    await act(async () => { forceLinting(view) })
    await wait(10)
    expect(host.querySelectorAll('.cm-lint-marker-error').length).toBeGreaterThan(0)
  })

  it('⭐ clicking the problem selects the refused token in the editor', async () => {
    const { view } = await mounted(BROKEN)
    fireEvent.click(screen.getByTestId('pine-editor-problem'))
    const sel = view.state.selection.main
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe('ta.foo')
  })

  it('without the opt-in, CodeEditor draws no line-number gutter (existing callers unchanged)', async () => {
    const { default: CodeEditor } = await import('../editor/CodeEditor')
    const { container } = render(<CodeEditor value="close" dialect="formula" testId="plain" />)
    expect(container.querySelector('.cm-lineNumbers')).toBe(null)
  })
})

// A1 — the Pine Editor surface, on its TEXTAREA path (CodeMirror's chunk is
// made to fail here, which is also the "a failed load is the textarea" rail).
// The CodeMirror path has its own file: PineEditor.codemirror.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'

vi.mock('../editor/CodeEditor', () => { throw new Error('chunk failed to load') })

import PineEditor from './PineEditor'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'

const OK = '//@version=5\nindicator("x")\nlen = input.int(14, "Len")\nplot(ta.rsi(close, len))'
const BROKEN = '//@version=5\nindicator("x")\nplot(ta.foo(close, 14))'

function Host({ initial = '', onApply, applied = null, onSettled }) {
  const [v, setV] = useState(initial)
  return <PineEditor value={v} onChange={setV} onApply={onApply} applied={applied} onSettled={onSettled} />
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const settle = async () => { await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) }); await flush() }
const area = () => screen.getByLabelText('Pine source')
const type = (text) => fireEvent.change(area(), { target: { value: text } })

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1') })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs() })

describe('PineEditor — compile on settle, problems with positions', () => {
  it('⭐ a refusal is listed at its line and column, in the door\'s own words', async () => {
    render(<Host />)
    await flush()
    type(BROKEN)
    // ⛔ NOT BEFORE THE SETTLE — the list describes text the door has read.
    expect(screen.getByTestId('pine-editor-status').textContent).toBe('Checking…')
    expect(screen.queryByTestId('pine-editor-problems')).toBe(null)
    await settle()
    const want = memberPaneDefinition({ source: BROKEN, id: 'x' }).translation.refusal
    const problems = screen.getAllByTestId('pine-editor-problem')
    expect(problems).toHaveLength(1)
    expect(problems[0].textContent).toContain('Line 3, column 6')
    expect(problems[0].textContent).toContain(want.message)
    expect(problems[0].closest('li').dataset.guard).toBe('pine:function')
    expect(screen.getByTestId('pine-editor-status').textContent).toBe('1 problem')
  })

  it('⭐ clicking a problem selects the exact token in the source', async () => {
    render(<Host initial={BROKEN} />)
    await settle()
    fireEvent.click(screen.getByTestId('pine-editor-problem'))
    const a = area()
    expect(BROKEN.slice(a.selectionStart, a.selectionEnd)).toBe('ta.foo')
    expect(document.activeElement).toBe(a)
  })

  it('a clean script reports it compiles and lists no errors', async () => {
    render(<Host initial={OK} />)
    await settle()
    expect(screen.getByTestId('pine-editor-status').dataset.state).toBe('ok')
    const errs = [...document.querySelectorAll('[data-severity="error"]')]
    expect(errs).toHaveLength(0)
  })

  it('onSettled fires with the settled text, once per settle — not per keystroke', async () => {
    const onSettled = vi.fn()
    render(<Host onSettled={onSettled} />)
    await flush()
    onSettled.mockClear()
    type('a'); type('ab'); type('abc')
    expect(onSettled).not.toHaveBeenCalled()
    await settle()
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('abc')
  })

  it('the template button seeds a script that compiles', async () => {
    render(<Host />)
    fireEvent.click(screen.getByTestId('pine-editor-starter'))
    await settle()
    expect(screen.getByTestId('pine-editor-status').dataset.state).toBe('ok')
  })
})

describe('PineEditor — Apply', () => {
  it('⭐ applies the document the door built for the text on screen', async () => {
    const onApply = vi.fn(async () => ({ ok: true }))
    render(<Host initial={OK} onApply={onApply} />)
    await settle()
    const btn = screen.getByTestId('pine-editor-apply')
    expect(btn.textContent).toBe('Add to chart')
    expect(btn.disabled).toBe(false)
    await act(async () => { fireEvent.click(btn) })
    await flush()
    expect(onApply).toHaveBeenCalledTimes(1)
    const want = memberPaneDefinition({ source: OK, id: 'u_member-pane' }).definition
    expect(onApply.mock.calls[0][0].compute).toEqual(want.compute)
    expect(screen.getByTestId('pine-editor-applied').textContent).toBe('Added to your chart.')
  })

  it('once applied, the button UPDATES and says so', async () => {
    const onApply = vi.fn(async () => ({ ok: true, updated: true }))
    render(<Host initial={OK} onApply={onApply} applied={{ defId: 'u_aaaaaaaaaaaa' }} />)
    await settle()
    const btn = screen.getByTestId('pine-editor-apply')
    expect(btn.textContent).toBe('Update on chart')
    await act(async () => { fireEvent.click(btn) })
    await flush()
    expect(screen.getByTestId('pine-editor-applied').textContent).toBe('Updated on your chart.')
  })

  it('⛔ Apply is disabled while refused, and while the text is newer than the verdict', async () => {
    const onApply = vi.fn(async () => ({ ok: true }))
    render(<Host initial={BROKEN} onApply={onApply} />)
    await settle()
    expect(screen.getByTestId('pine-editor-apply').disabled).toBe(true)
    type(OK)
    expect(screen.getByTestId('pine-editor-apply').disabled).toBe(true)   // pending
    await settle()
    expect(screen.getByTestId('pine-editor-apply').disabled).toBe(false)
  })

  it('⛔ a GOOD verdict does not carry over to newer text — Apply waits for the settle', async () => {
    const onApply = vi.fn(async () => ({ ok: true }))
    render(<Host initial={OK} onApply={onApply} />)
    await settle()
    expect(screen.getByTestId('pine-editor-apply').disabled).toBe(false)
    type(`${OK}\nplot(close)`)
    // the last verdict was ok, but it describes the OLD text
    expect(screen.getByTestId('pine-editor-apply').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('pine-editor-apply'))
    await flush()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('⛔ the store\'s refusal is rendered verbatim', async () => {
    const sentence = 'inputs[2].key: "close" is already a name this engine computes'
    const onApply = vi.fn(async () => ({ ok: false, error: sentence }))
    render(<Host initial={OK} onApply={onApply} />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('pine-editor-apply')) })
    await flush()
    expect(screen.getByTestId('pine-editor-apply-error').textContent).toBe(sentence)
  })

  it('⛔ with the member-pane flag OFF there is no Apply, and the editor says why', async () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '')
    const onApply = vi.fn()
    render(<Host initial={OK} onApply={onApply} />)
    await settle()
    expect(screen.queryByTestId('pine-editor-apply')).toBe(null)
    expect(screen.getByTestId('pine-editor-apply-off')).toBeTruthy()
    // the editor itself still works
    expect(screen.getByTestId('pine-editor-status').dataset.state).toBe('ok')
  })
})

// ⛔⛔ FOCUS CONTRACT + KEYBOARD ISOLATION — 2026-10-06 production defect.
// Opened inside the Breadth drill board, the composer never got focus (a
// one-frame-late requestAnimationFrame that does not run in a hidden tab), so
// typing drove the drill list / chart, and Escape closed the whole board.
// ASKED / CLAIMED / DID per case.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import CreateIndicatorPanel from './CreateIndicatorPanel'

const props = () => ({
  settings: mergeChartSettings({}), onChange: () => {}, sym: 'AAPL', tf: 'D',
  onPreview: () => {}, onClose: () => {}, converse: scriptedConverse,
})
const input = () => screen.getByTestId('create-indicator-input')

afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('focus contract', () => {
  it('the composer is focused in the SAME commit it opens — no animation frame needed', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)   // a hidden tab: frames never run
    render(<CreateIndicatorPanel {...props()} />)
    expect(document.activeElement).toBe(input())
    expect(raf).not.toHaveBeenCalled()
  })

  it('the panel is visible from its first commit (a hidden placeholder cannot take focus)', () => {
    render(<CreateIndicatorPanel {...props()} />)
    expect(screen.getByTestId('create-indicator').style.visibility).not.toBe('hidden')
  })

  it('opening takes focus from the drill dialog / the button that opened it', () => {
    const dialog = document.createElement('div'); dialog.tabIndex = -1
    document.body.appendChild(dialog); dialog.focus()
    expect(document.activeElement).toBe(dialog)
    render(<CreateIndicatorPanel {...props()} />)
    expect(document.activeElement).toBe(input())
  })

  it('opening does NOT take focus out of a text field the member is typing in', () => {
    const other = document.createElement('input')
    document.body.appendChild(other); other.focus()
    render(<CreateIndicatorPanel {...props()} />)
    expect(document.activeElement).toBe(other)
  })

  it('a completed turn re-focuses the composer, but never steals from where the member moved', async () => {
    render(<CreateIndicatorPanel {...props()} />)
    fireEvent.change(input(), { target: { value: 'Add a 20 EMA' } })
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
    await act(async () => {})
    expect(document.activeElement).toBe(input())

    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    fireEvent.change(input(), { target: { value: 'Make it 50' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    elsewhere.focus()                         // member clicked away mid-turn
    await act(async () => {})
    await act(async () => {})
    expect(document.activeElement).toBe(elsewhere)
  })
})

describe('focus contract — a clarification asks for explicit interaction', () => {
  const asking = async (message, view) => ({
    ok: true, turn: 'question', disposition: 'clarify', reply: '',
    envelope: { contract: 'uct.authoring.patch/1', baseRevision: (view && view.revision) || 0, ops: [],
      questions: [{ id: 'q1', text: 'Which moving average?', choices: ['EMA', 'SMA'] }] },
  })

  it('the composer is NOT pulled to; focus lost to <body> lands on the first choice (inside the panel)', async () => {
    render(<CreateIndicatorPanel {...props()} converse={asking} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })   // past the open-time focus
    fireEvent.change(input(), { target: { value: 'add a moving average' } })
    const send = screen.getByTestId('create-indicator-send')
    send.focus()
    await act(async () => { fireEvent.click(send) })   // Send disables itself → focus drops to <body>
    await act(async () => {})
    const choices = screen.getByTestId('create-indicator-choices')
    expect(choices.contains(document.activeElement)).toBe(true)
    expect(document.activeElement.textContent).toBe('EMA')
  })

  it('a member who answered from the composer keeps typing there', async () => {
    render(<CreateIndicatorPanel {...props()} converse={asking} />)
    fireEvent.change(input(), { target: { value: 'add a moving average' } })
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }) })
    await act(async () => {})
    expect(screen.getByTestId('create-indicator-choices')).toBeTruthy()
    expect(document.activeElement).toBe(input())
  })
})

describe('keyboard isolation — scoped to the panel', () => {
  const KEYS = ['a', 'J', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', ' ', 'Tab']

  it('no key typed in the composer reaches document or window handlers underneath', () => {
    const seen = []
    const onDoc = (e) => seen.push(`doc:${e.type}:${e.key}`)
    const onWin = (e) => seen.push(`win:${e.type}:${e.key}`)
    document.addEventListener('keydown', onDoc); window.addEventListener('keydown', onWin)
    document.addEventListener('keyup', onDoc); window.addEventListener('keyup', onWin)
    document.addEventListener('keypress', onDoc)
    try {
      render(<CreateIndicatorPanel {...props()} />)
      for (const key of KEYS) {
        fireEvent.keyDown(input(), { key, ctrlKey: key === 'J', altKey: key === 'J' })
        fireEvent.keyPress(input(), { key, charCode: 65 })
        fireEvent.keyUp(input(), { key })
      }
      expect(seen).toEqual([])
    } finally {
      document.removeEventListener('keydown', onDoc); window.removeEventListener('keydown', onWin)
      document.removeEventListener('keyup', onDoc); window.removeEventListener('keyup', onWin)
      document.removeEventListener('keypress', onDoc)
    }
  })

  it('Escape in the composer does not close the board underneath (window Escape handler)', () => {
    const closeBoard = vi.fn()
    const onKey = (e) => { if (e.key === 'Escape') closeBoard() }
    window.addEventListener('keydown', onKey)
    try {
      render(<CreateIndicatorPanel {...props()} />)
      fireEvent.keyDown(input(), { key: 'Escape' })
      expect(closeBoard).not.toHaveBeenCalled()
    } finally { window.removeEventListener('keydown', onKey) }
  })

  it('React ancestors (the drill list / chart tree the portal lives in) do not see composer keys either', () => {
    const ancestor = vi.fn()
    render(<div onKeyDown={ancestor}><CreateIndicatorPanel {...props()} /></div>)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(ancestor).not.toHaveBeenCalled()
  })

  it('the composer itself still works: Enter submits, Shift+Enter does not', async () => {
    render(<CreateIndicatorPanel {...props()} />)
    fireEvent.change(input(), { target: { value: 'Add a 20 EMA' } })
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(screen.queryByTestId('create-indicator-readback')).toBeNull()
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }) })
    await act(async () => {})
    expect(screen.getByTestId('create-indicator-readback').textContent).toMatch(/EMA 20/)
  })

  it('keys OUTSIDE the panel are untouched — chart shortcuts are not globally disabled', () => {
    const seen = []
    const onDoc = (e) => seen.push(e.key)
    document.addEventListener('keydown', onDoc)
    try {
      render(<CreateIndicatorPanel {...props()} />)
      const chart = document.createElement('div'); document.body.appendChild(chart)
      fireEvent.keyDown(chart, { key: 'ArrowLeft' })
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(seen).toEqual(['ArrowLeft', 'Escape'])
    } finally { document.removeEventListener('keydown', onDoc) }
  })
})

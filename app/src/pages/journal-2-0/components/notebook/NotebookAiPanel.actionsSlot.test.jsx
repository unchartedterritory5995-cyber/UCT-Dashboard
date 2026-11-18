// Follow-up B fix round 1, item 5: "Or tell Notebook what to change" (AiActionsPanel) is held (NotebookAiPanel.jsx
// `AiActionsSlot`), not `lazyChunk` + Suspense. With the chunk in hand the box is drawn in the section's own commit and
// its toggle opens the request field with focus at once; before it lands a frame with the same toggle is drawn, a press
// puts focus on a status line at once, and the box opens with the request field focused when it lands; a failed fetch
// says so with a Reload the member presses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AiActionsSlot, AI_ACTIONS_LOADING, AI_ACTIONS_UNAVAILABLE, aiActionsLoaders, aiActionsModule } from './NotebookAiPanel'
import { RELOAD_TO_RECOVER, pageReload } from '../../lib/heldModule'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const REAL = { ...aiActionsLoaders }
const TOGGLE = 'Or tell Notebook what to change'
const renderSlot = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><AiActionsSlot onOpenNote={vi.fn()} /></SWRConfig>)
const request = () => screen.queryByRole('textbox', { name: 'What should Notebook do?' })

beforeEach(() => {
  aiActionsModule.resetForTests()
  latchNotebookFlags({ notebook_ai_actions_enabled: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  cleanup()
  Object.assign(aiActionsLoaders, REAL)
  aiActionsModule.resetForTests()
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('the AI actions slot', () => {
  it('with the chunk in hand, the real box is drawn at once and its toggle focuses the request field', async () => {
    await act(async () => { await aiActionsModule.warm() })
    renderSlot()
    expect(document.querySelector('[data-ai-actions-stand-in]')).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('button', { name: TOGGLE })) })
    expect(document.activeElement).toBe(request())
  })

  it('a press before it lands: focus on the status line at once, then the box opens with the request field focused', async () => {
    let resolve
    aiActionsLoaders.box = () => new Promise((r) => { resolve = r })
    renderSlot()
    expect(document.querySelector('[data-ai-actions-stand-in]')).not.toBeNull()
    act(() => { fireEvent.click(screen.getByRole('button', { name: TOGGLE })) })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(AI_ACTIONS_LOADING)
    expect(document.activeElement).toBe(status)
    await act(async () => { await Promise.resolve() })
    await act(async () => { resolve(await REAL.box()) })
    expect(document.querySelector('[data-ai-actions-stand-in]')).toBeNull()
    expect(document.activeElement).toBe(request())
  })

  it('a failed fetch says so in plain words, with a Reload the member presses, once the member has pressed the toggle', async () => {
    aiActionsLoaders.box = () => Promise.reject(new Error('boom'))
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    renderSlot()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByRole('alert')).toBeNull()                      // fix round 2: nothing the member did not ask for
    fireEvent.click(screen.getByRole('button', { name: TOGGLE }))
    const alert = await screen.findByRole('alert')
    expect(AI_ACTIONS_UNAVAILABLE).toBe('This could not be loaded.')
    expect(alert.textContent).toContain(`${AI_ACTIONS_UNAVAILABLE} ${RELOAD_TO_RECOVER}`)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('fix round 2: a second press of the frame toggle closes it again', () => {
    aiActionsLoaders.box = () => new Promise(() => {})
    renderSlot()
    const toggle = screen.getByRole('button', { name: TOGGLE })
    act(() => { fireEvent.click(toggle) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('status')).toBeTruthy()
    act(() => { fireEvent.click(toggle) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('status')).toBeNull()
  })

  // Final fix pass (E-AI): one offline blip used to leave the section unable to load until a page reload.
  it('after a failed fetch, each press of the toggle asks again, one attempt per press, never a loop', async () => {
    let fail = true
    const box = vi.fn(() => (fail ? Promise.reject(new Error('offline blip')) : REAL.box()))
    aiActionsLoaders.box = box
    renderSlot()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    const afterMount = box.mock.calls.length
    expect(afterMount).toBeGreaterThan(0)
    const toggle = screen.getByRole('button', { name: TOGGLE })
    await act(async () => { fireEvent.click(toggle); await new Promise((r) => setTimeout(r, 30)) })
    const afterPress = box.mock.calls.length
    expect(afterPress).toBeGreaterThan(afterMount)
    expect((await screen.findByRole('alert')).textContent).toContain(AI_ACTIONS_UNAVAILABLE)
    // Nothing asks again on its own.
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(box.mock.calls.length).toBe(afterPress)
    // The network is back: the next press (it closes the frame) asks again, and the press after it opens the box.
    fail = false
    await act(async () => { fireEvent.click(toggle); await new Promise((r) => setTimeout(r, 30)) })
    expect(box.mock.calls.length).toBeGreaterThan(afterPress)
    expect(document.querySelector('[data-ai-actions-stand-in]')).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('button', { name: TOGGLE })) })
    expect(document.activeElement).toBe(request())
  })

  it('keyboard focus resting on the frame toggle (not pressed) moves to the real toggle when the box lands', async () => {
    let resolve
    aiActionsLoaders.box = () => new Promise((r) => { resolve = r })
    renderSlot()
    const frameToggle = screen.getByRole('button', { name: TOGGLE })
    act(() => { frameToggle.focus() })
    expect(document.activeElement).toBe(frameToggle)
    await act(async () => { await Promise.resolve() })
    await act(async () => { resolve(await REAL.box()) })
    expect(document.querySelector('[data-ai-actions-stand-in]')).toBeNull()
    const realToggle = screen.getByRole('button', { name: TOGGLE })
    expect(realToggle).not.toBe(frameToggle)
    expect(document.activeElement).toBe(realToggle)
    expect(realToggle.getAttribute('aria-expanded')).toBe('false')   // focus moved; nothing opened that was not pressed
  })

  it('control: focus elsewhere when the box lands stays where it is', async () => {
    let resolve
    aiActionsLoaders.box = () => new Promise((r) => { resolve = r })
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    renderSlot()
    act(() => { outside.focus() })
    await act(async () => { await Promise.resolve() })
    await act(async () => { resolve(await REAL.box()) })
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('the panel mounts the slot, never a lazy wrapper', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NotebookAiPanel.jsx'), 'utf8')
    expect(src).toContain('<AiActionsSlot ')
    expect(src).not.toMatch(/lazyChunk\(|<Suspense/)
  })
})

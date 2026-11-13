// Go-live wave 1, fix round 2: the notes list's AI section, drawn from a warmed slot (NotebookAiPanelSlot.jsx).
// With the chunk in hand the panel is drawn in the press's own act (React.lazy held it back about 300 ms on its first
// render); a failed fetch says so with Try again and never reloads or throws.
import { Component, useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import NotebookAiPanelSlot, { aiPanelLoaders, aiPanelModule, ASK_UNAVAILABLE, ASK_LOADING } from './NotebookAiPanelSlot'
import { pageReload, RELOAD_TO_RECOVER } from '../../lib/heldModule'

const REAL = { ...aiPanelLoaders }
const RELOAD_FLAG = 'uct.chunk-reload-attempted'

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <p data-testid="boundary">{String(this.state.error)}</p> : this.props.children }
}

function List() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>AI</button>
      {open && <NotebookAiPanelSlot id="notebook-ai-panel" onClose={() => setOpen(false)} onOpenNote={() => {}} />}
    </div>
  )
}

beforeEach(() => {
  aiPanelModule.resetForTests()
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch {}
})
afterEach(() => {
  Object.assign(aiPanelLoaders, REAL)
  aiPanelModule.resetForTests()
  vi.restoreAllMocks()
})

describe('the AI section slot', () => {
  it('with the chunk in hand, pressing AI draws the panel in the same act', async () => {
    const Panel = ({ id }) => <section id={id} aria-label="Ask your Notebook"><input aria-label="Question" /></section>
    aiPanelLoaders.panel = () => Promise.resolve({ default: Panel })
    await aiPanelModule.warm()
    render(<List />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'AI' })) })
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
  })

  it('a failed fetch says so with Try again, never reloads and never throws', async () => {
    aiPanelLoaders.panel = () => Promise.reject(new Error('boom'))
    render(<Boundary><List /></Boundary>)
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ASK_UNAVAILABLE)
    expect(screen.queryByTestId('boundary')).toBeNull()
    let flag = null
    try { flag = sessionStorage.getItem(RELOAD_FLAG) } catch {}
    expect(flag).toBeNull()
    aiPanelLoaders.panel = () => Promise.resolve({ default: () => <p>panel</p> })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('panel')).toBeInTheDocument())
  })

  // Final fix (B1): a cold press drew nothing (aria-controls named an id that did not exist yet).
  it('a cold press draws the panel frame at once, with its id and "Loading Ask…"; the panel replaces it when it lands', async () => {
    let resolve
    const held = new Promise((r) => { resolve = r })
    aiPanelLoaders.panel = () => held
    render(<List />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'AI' })) })
    const frame = document.getElementById('notebook-ai-panel')
    expect(frame).not.toBeNull()
    expect(frame.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status')).toHaveTextContent(ASK_LOADING)
    await act(async () => { resolve({ default: ({ id }) => <section id={id}><input aria-label="Question" /></section> }) })
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeInTheDocument()
    expect(screen.queryByText(ASK_LOADING)).toBeNull()
  })

  // Final fix (B2 + C5): Try again kept focus on the page; a repeat failure is a stale tab.
  it('Try again keeps focus on the status line, hands it to the panel when it lands; a repeat failure returns it to Try again and offers Reload', async () => {
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    aiPanelLoaders.panel = () => Promise.reject(new Error('boom'))
    render(<List />)
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    await screen.findByText(ASK_UNAVAILABLE)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()   // one failure: Try again only
    // Repeat failure: focus is back on Try again, the sentence says to reload, and Reload waits for the member.
    let reject
    const failing = new Promise((_, rej) => { reject = rej })
    aiPanelLoaders.panel = () => failing
    act(() => { screen.getByRole('button', { name: 'Try again' }).focus() })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(document.activeElement).toBe(screen.getByRole('status'))
    expect(document.activeElement).toHaveTextContent(ASK_LOADING)
    await act(async () => { reject(new Error('gone')) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('alert')).toHaveTextContent(`${ASK_UNAVAILABLE} ${RELOAD_TO_RECOVER}`)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    // And a Try again that lands: the panel takes focus (its field), from the status line that held it.
    let resolve
    const landing = new Promise((r) => { resolve = r })
    aiPanelLoaders.panel = () => landing
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(document.activeElement).toBe(screen.getByRole('status'))
    await act(async () => { resolve({ default: ({ id }) => <section id={id}><input aria-label="Question" autoFocus /></section> }) })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Question' }))
  })
})

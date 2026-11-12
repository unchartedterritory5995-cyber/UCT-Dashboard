// Go-live wave 1, fix round 2: the notes list's AI section, drawn from a warmed slot (NotebookAiPanelSlot.jsx).
// With the chunk in hand the panel is drawn in the press's own act (React.lazy held it back about 300 ms on its first
// render); a failed fetch says so with Try again and never reloads or throws.
import { Component, useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import NotebookAiPanelSlot, { aiPanelLoaders, aiPanelModule, ASK_UNAVAILABLE } from './NotebookAiPanelSlot'

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
})

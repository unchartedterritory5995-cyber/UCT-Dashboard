import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalPanelContext } from '../../../components/terminal'
import { DepthStackContext, useDepthChrome, DepthLoading } from './depthChrome'

function Probe() {
  const c = useDepthChrome()
  return (
    <div>
      <span data-testid="title">{String(c.showTitle)}</span>
      <DepthLoading inPanel={c.inPanel} label="Loading events" />
    </div>
  )
}
const PANEL = { code: 'EVTS', density: 'comfortable', inset: true }

describe('depth panel chrome follows where it is mounted', () => {
  it('on the research page: own title, muted loading line', () => {
    render(<Probe />)
    expect(screen.getByTestId('title').textContent).toBe('true')
    expect(screen.getByText('Loading events…')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-skeleton')).toBeNull()
  })

  it('alone in a terminal panel: the header already names it, so no title; the panel skeleton loads', () => {
    render(<TerminalPanelContext.Provider value={PANEL}><Probe /></TerminalPanelContext.Provider>)
    expect(screen.getByTestId('title').textContent).toBe('false')
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
  })

  it('inside the DPTH stack: several panels share one frame, so each keeps its title', () => {
    render(
      <TerminalPanelContext.Provider value={{ ...PANEL, code: 'DPTH' }}>
        <DepthStackContext.Provider value={true}><Probe /></DepthStackContext.Provider>
      </TerminalPanelContext.Provider>,
    )
    expect(screen.getByTestId('title').textContent).toBe('true')
  })
})

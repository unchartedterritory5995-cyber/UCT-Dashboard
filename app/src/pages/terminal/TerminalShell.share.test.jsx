// UCT Terminal: the Share control IN THE PANEL FRAME (owner pick 2026-11-17).
//
// ONE control, drawn by the frame, never by a panel:
//   * offered for a panel the rule allows (share/shareRule.js) while it shows a list, beside the
//     frame's other actions,
//     with the frame's own action class (so it gets the 44px touch floor with them);
//   * NOT offered for licensed data, a whole page, a popped-out panel or a pop-out window;
//   * end to end through the real lazy module: the file carries the frame's own title (the
//     command and the function's plain name), the panel's own as-of and source report, and the
//     rows in the panel body, and the outcome is handed to the shell as ONE notice.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false, useIsTouch: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))
vi.mock('../../components/chart/chartScreenshot', () => ({ downloadBlob: vi.fn(), copyBlobToClipboard: vi.fn(async () => false) }))

// The REAL panels module with only the components stubbed: each stub draws a small list (or none)
// and reports a source and an as-of date to its header, as the real panels do.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const { panelAsOf, usePanelFreshness } = await import('../../components/terminal/terminalPanel')
  const stubs = new Map()
  return {
    ...real,
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub() {
          usePanelFreshness(panelAsOf(name === 'Performance' ? 'Your journal' : 'A licensed feed', '2026-11-14'))
          if (name === 'Learn') return <p data-testid={`stub-${name}`}>No list here, only words.</p>
          return (
            <table data-testid={`stub-${name}`}>
              <thead><tr><th scope="col">Setup</th><th scope="col">Expectancy</th></tr></thead>
              <tbody><tr><td>Flag breakout</td><td>+$188.10</td></tr><tr><td>Episodic pivot</td><td>-$74.25</td></tr></tbody>
            </table>
          )
        })
      }
      return stubs.get(name)
    },
  }
})

import { downloadBlob } from '../../components/chart/chartScreenshot'
import { Panel } from './TerminalShell'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderPanel(panel, extra = {}) {
  const onNotice = vi.fn()
  render(
    <MemoryRouter>
      <Panel index={0} panel={{ id: 'p1', args: [], ...panel }} focused syms={{}} auth={{}} channel={null}
        onFocus={() => {}} onChannelMenu={() => {}} onRun={() => {}} helpProps={{}} canClose isPhone={false}
        onClose={() => {}} onDuplicate={() => {}} onPopout={() => {}} onBringBack={() => {}} onNotice={onNotice} {...extra} />
    </MemoryRouter>,
  )
  return onNotice
}
const share = () => screen.queryByTestId('terminal-share-0')
const textOf = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(blob) })

describe('where the frame offers Share', () => {
  it('a panel of the member\'s own numbers has it, beside the frame\'s other actions, in their class', async () => {
    renderPanel({ code: 'PERF' })
    await screen.findByTestId('stub-Performance')
    const b = share()
    expect(b).toBeTruthy()
    expect(b.getAttribute('aria-label')).toBe('Share panel 1: copy its list as an image or a file')
    const actions = b.parentElement
    expect([...actions.querySelectorAll('button')].map((x) => x.getAttribute('data-testid'))).toEqual(
      ['terminal-share-0', 'terminal-dup-0', 'terminal-popout-0', 'terminal-close-0'])
    expect(b.className).toBe(screen.getByTestId('terminal-close-0').className)
  })

  it('licensed data, analytics over it and a whole page do not', async () => {
    for (const [code, stub, sym] of [['MOST', 'stub-Movers'], ['RSL', 'stub-RsLeaders'], ['TOPF', 'stub-TopFlow'], ['OWN', 'stub-Ownership', 'NVDA']]) {
      renderPanel({ code, ...(sym ? { sym } : {}) })
      await screen.findByTestId(stub)
      expect(share(), code).toBeNull()
      expect(screen.getByTestId('terminal-close-0')).toBeTruthy()
      cleanup()
    }
  })

  it('a popped-out panel, a pop-out window and a panel that needs a ticker have none; a phone keeps it', async () => {
    renderPanel({ code: 'PERF', popout: true })
    expect(share()).toBeNull()
    cleanup()
    renderPanel({ code: 'PERF' }, { standalone: true })
    await screen.findByTestId('stub-Performance')
    expect(share()).toBeNull()
    cleanup()
    renderPanel({ code: 'FTD' })   // a security function with no security: nothing is drawn to share
    expect(share()).toBeNull()
    cleanup()
    renderPanel({ code: 'PERF' }, { isPhone: true })
    await screen.findByTestId('stub-Performance')
    expect(share()).toBeTruthy()
    expect(screen.queryByTestId('terminal-dup-0')).toBeNull()
  })

  it('an allowed panel that draws words and no table has no Share button', async () => {
    renderPanel({ code: 'LEARN', sym: 'NVDA' })
    await screen.findByTestId('stub-Learn')
    expect(share()).toBeNull()
    expect(screen.getByTestId('terminal-close-0')).toBeTruthy()
  })
})

describe('end to end through the frame', () => {
  it('the file holds the frame\'s title, the panel\'s own as-of and source, and the rows in the body', async () => {
    const onNotice = renderPanel({ code: 'PERF', args: ['2'] })
    await screen.findByTestId('stub-Performance')
    // The header shows the report the share will carry.
    await waitFor(() => expect(screen.getByTestId('terminal-panel-source-0').textContent).toContain('Your journal'))
    fireEvent.click(share())
    const menu = await screen.findByRole('menu', { name: 'Share PERF' })
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download spreadsheet (CSV)' })) })
    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1))
    expect(onNotice.mock.calls[0][0]).toMatchObject({ kind: 'info', text: expect.stringMatching(/^Downloaded uct-perf-\d{4}-\d{2}-\d{2}\.csv: 2 rows, as shown\.$/) })
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [blob, name] = downloadBlob.mock.calls[0]
    expect(name).toMatch(/^uct-perf-\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = (await textOf(blob)).replace(/^\uFEFF/, '').split('\r\n')
    expect(lines[0]).toContain('My trading stats (from your Journal) (PERF 2)')
    expect(lines[0]).toContain('As of 2026-11-14')
    expect(lines[0]).toContain('Source: Your journal')
    expect(lines.slice(2, 5)).toEqual(['Setup,Expectancy', 'Flag breakout,+$188.10', 'Episodic pivot,-$74.25'])
  })

  it('a one-stock panel carries its stock into the title and the file name', async () => {
    const onNotice = renderPanel({ code: 'FTD', sym: 'NVDA' }, { auth: { researchDepth: { ftd_dataset_enabled: true } } })
    await screen.findByTestId('stub-Ftd')
    fireEvent.click(share())
    const menu = await screen.findByRole('menu', { name: 'Share FTD' })
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download spreadsheet (CSV)' })) })
    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1))
    const [blob, name] = downloadBlob.mock.calls[0]
    expect(name).toMatch(/^uct-ftd-nvda-\d{4}-\d{2}-\d{2}\.csv$/)
    const first = (await textOf(blob)).replace(/^\uFEFF/, '').split('\r\n')[0]
    expect(first.startsWith('NVDA \u00B7 Fails to deliver (NVDA FTD),')).toBe(true)
  })

  it('a picture this browser cannot draw is said plainly, in the same notice line', async () => {
    const onNotice = renderPanel({ code: 'PERF' })
    await screen.findByTestId('stub-Performance')
    fireEvent.click(share())
    const menu = await screen.findByRole('menu', { name: 'Share PERF' })
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy as image' })) })
    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1))
    // jsdom has no canvas: the honest outcome, not a silent nothing and not a fake "Copied".
    expect(onNotice.mock.calls[0][0]).toMatchObject({ kind: 'error', text: expect.stringMatching(/could not be drawn.*nothing was copied/) })
    expect(downloadBlob).not.toHaveBeenCalled()
  })
})

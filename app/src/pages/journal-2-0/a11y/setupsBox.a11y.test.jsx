// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/setupsBox.a11y.test.jsx
//
// P0.5's Active setups box on Research Home (components/notebook/SetupsBox.jsx) through 8A's axe
// harness. It arrived with no entry in a11y/notebookSurfaces.js, so `surfaceCoverage.test.js` would
// fail by name. It gets a recipe of its own: Research Home's rail runs with the setups board switch
// off, so the box (which renders nothing while the switch is off) is never on screen there. Each
// state proves it rendered before axe runs -- the count line, the link and its description -- so axe
// is not run over an empty shell:
//   * setups-box          -- "Active setups · 2 open", the link, the hidden description;
//   * the count unreadable -- "Active setups" alone, the link still there;
//   * none open           -- "Active setups · none open".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { axeSurface } from './surface'
import { expectNoAxeViolations } from './axeHarness'
import SetupsBox from '../components/notebook/SetupsBox'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'

const json = (body) => ({ ok: true, status: 200, json: async () => body })

function stub(answer) {
  globalThis.fetch = vi.fn(async () => (typeof answer === 'function' ? answer() : json(answer)))
}

function mount() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <main>
          <SetupsBox />
        </main>
      </MemoryRouter>
    </SWRConfig>,
  )
}

describe('Research Home\'s Active setups box', () => {
  beforeEach(() => latchNotebookFlags({ notebook_setups_board_enabled: true }))
  afterEach(() => __resetNotebookFlags())

  axeSurface('setups-box', async () => {
    stub({ cards: [{ noteId: 'a', example: false }, { noteId: 'b', example: false }, { noteId: 'x', example: true }] })
    const { container } = mount()
    await screen.findByText('Active setups · 2 open')
    const link = screen.getByRole('link', { name: 'Open the setups board' })
    if (!document.getElementById(link.getAttribute('aria-describedby'))) throw new Error('the link has no description')
    return { root: container }
  })

  it('none open: axe finds 0 violations', async () => {
    stub({ cards: [{ noteId: 'x', example: true }] })
    const { container } = mount()
    await screen.findByText('Active setups · none open')
    await expectNoAxeViolations(container, { level: 'component' })
  }, 30000)

  it('the count could not be read: the box is still there, and axe finds 0 violations', async () => {
    stub(() => ({ ok: false, status: 500, json: async () => ({}) }))
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 40))
    expect(screen.getByText('Active setups')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the setups board' })).toBeTruthy()
    await expectNoAxeViolations(container, { level: 'component' })
  }, 30000)
})

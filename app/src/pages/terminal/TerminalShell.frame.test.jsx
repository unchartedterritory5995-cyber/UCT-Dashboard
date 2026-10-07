// UCT Terminal — the PANEL FRAME (visual pass, lane 1): one shared inset, one header per panel
// (the in-panel context), one loading treatment, icon actions, density as variables, and app
// tokens only. Rendered output is asserted wherever jsdom can see it; geometry jsdom cannot
// compute (padding, variables) is asserted on the CSS source, like the tap-floor rails.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { lazy } from 'react'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))

// The REAL panels module with only the components stubbed. Each stub reports what it was told:
// the in-panel context and the props the shell handed it. `Overview` never finishes loading, so
// the shell's Suspense fallback can be inspected.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const { useInTerminalPanel } = await import('../../components/terminal/terminalPanel')
  const stubs = new Map()
  const never = lazy(() => new Promise(() => {}))
  return {
    ...real,
    panelComponent: (name) => {
      if (name === 'Overview') return never
      if (!stubs.has(name)) {
        stubs.set(name, function Stub(props) {
          const frame = useInTerminalPanel()
          const plain = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'))
          return (
            <div data-testid={`stub-${name}`} data-frame={JSON.stringify(frame)} data-props={JSON.stringify(plain)} />
          )
        })
      }
      return stubs.get(name)
    },
  }
})

import { Panel } from './TerminalShell'
import { useInTerminalPanel } from '../../components/terminal'
import CalendarHeader from '../calendar/CalendarHeader'
import { TerminalPanelContext } from '../../components/terminal/terminalPanel'
import { BY_CODE } from './functions'

afterEach(cleanup)

function renderPanel(panel, extra = {}) {
  return render(
    <MemoryRouter>
      <Panel index={0} panel={{ id: 'p1', args: [], ...panel }} focused syms={{}} auth={{}} channel={null}
        onFocus={() => {}} onChannelMenu={() => {}} onRun={() => {}} helpProps={{}} canClose isPhone={false}
        onClose={() => {}} onDuplicate={() => {}} onPopout={() => {}} onBringBack={() => {}} {...extra} />
    </MemoryRouter>,
  )
}

const frameOf = (testId) => JSON.parse(screen.getByTestId(testId).getAttribute('data-frame'))

describe('one shared panel inset', () => {
  it('an embedded tab sits in an INSET body and is told so', () => {
    renderPanel({ code: 'CN', sym: 'NVDA' })
    expect(screen.getByTestId('terminal-body-0').getAttribute('data-inset')).toBe('inset')
    expect(frameOf('stub-News')).toEqual({ code: 'CN', density: 'comfortable', inset: true })
  })

  it('the chart and the calendar are the flush exceptions, and are told so', () => {
    renderPanel({ code: 'GP', sym: 'NVDA' })
    expect(screen.getByTestId('terminal-body-0').getAttribute('data-inset')).toBe('flush')
    expect(frameOf('stub-Chart').inset).toBe(false)
    cleanup()
    renderPanel({ code: 'CAL' })
    expect(screen.getByTestId('terminal-body-0').getAttribute('data-inset')).toBe('flush')
    expect(frameOf('stub-Calendar')).toMatchObject({ code: 'CAL', inset: false })
  })

  it('the board density reaches the component through the frame', () => {
    renderPanel({ code: 'CN', sym: 'NVDA' }, { density: 'dense' })
    expect(frameOf('stub-News').density).toBe('dense')
  })

  it('the CSS gives the body ONE inset from the density variables, and the flush class removes it', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/TerminalShell.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.panelBody\s*\{[^}]*padding:\s*var\(--panel-inset\)/)
    expect(css).toMatch(/\.panelBody\s*\{[^}]*font-size:\s*var\(--panel-fs\)/)
    expect(css).toMatch(/\.panelBodyFlush\s*\{[^}]*padding:\s*0/)
  })

  it('My Research no longer patches its own inset (the shared one covers it)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/panels/MyResearchPanel.jsx'), 'utf8')
    expect(src).not.toMatch(/style=\{\{/)
    expect(src).not.toMatch(/rsch-inset/)
  })
})

describe('density changes panel spacing, not only inherited text', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/TerminalShell.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const desktop = (() => {
    const i = css.indexOf('@media (min-width: 1025px)')
    let depth = 0
    for (let j = css.indexOf('{', i); j < css.length; j++) {
      if (css[j] === '{') depth++
      if (css[j] === '}' && --depth === 0) return css.slice(i, j + 1)
    }
    return ''
  })()

  it.each(['compact', 'dense'])('%s re-declares all four panel variables (desktop only)', (d) => {
    const block = new RegExp(`\\.shell\\[data-density='${d}'\\]\\s*\\{([^}]*)\\}`).exec(desktop)?.[1] || ''
    for (const v of ['--panel-inset', '--panel-gap', '--panel-fs', '--panel-row-h']) expect(block, `${d} ${v}`).toContain(`${v}:`)
  })

  it.each(['compact', 'dense'])('%s reaches the tables inside a panel body: row height and cell padding from the variables', (d) => {
    for (const cell of ['td', 'th']) {
      expect(desktop).toContain(`.shell[data-density='${d}'] .panelBody ${cell}`)
    }
    const rule = /\.panelBody th\s*\{([^}]*)\}/.exec(desktop)?.[1] || ''
    expect(rule).toMatch(/height:\s*var\(--panel-row-h\)/)
    expect(rule).toMatch(/padding-block:\s*calc\(var\(--panel-gap\)/)
  })

  it('panel content outside the shell stylesheet reads the same variables (calendar rows, research cards)', () => {
    const read = (f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    const cal = read('src/pages/calendar/Calendar.module.css')
    expect(/\.dtRow\s*\{[^}]*min-height:\s*calc\(var\(--panel-row-h\)/.test(cal)).toBe(true)
    expect(/\.wrow\s*\{[^}]*padding:\s*calc\(var\(--panel-gap\)/.test(cal)).toBe(true)
    const card = read('src/components/research-kit/GlassCard.module.css')
    expect(/\.card\s*\{[^}]*gap:\s*var\(--panel-gap\)/.test(card)).toBe(true)
    expect(/\.card\s*\{[^}]*padding:\s*calc\(var\(--panel-inset\)/.test(card)).toBe(true)
  })

  it.each(['compact', 'dense'])('%s reaches the non-table lists that opt in with data-panel-row / -list / -tile(s)', (d) => {
    const ruleFor = (attr) => {
      const sel = `.shell[data-density='${d}'] [${attr}]`
      const at = desktop.indexOf(sel)
      expect(at, `${d}: no ${attr} rule`).toBeGreaterThan(-1)
      return desktop.slice(desktop.indexOf('{', at), desktop.indexOf('}', at))
    }
    expect(ruleFor('data-panel-row')).toMatch(/min-height:\s*var\(--panel-row-h\)/)
    expect(ruleFor('data-panel-row')).toMatch(/padding-block:\s*calc\(var\(--panel-gap\)/)
    expect(ruleFor('data-panel-list')).toMatch(/gap:\s*calc\(var\(--panel-gap\)/)
    expect(ruleFor('data-panel-tiles')).toMatch(/gap:\s*var\(--panel-gap\)/)
    expect(ruleFor('data-panel-tile')).toMatch(/padding:\s*var\(--panel-inset\)/)
  })

  it('the list panels carry the density markers on the element that is the row / list / tile', () => {
    const read = (f) => fs.readFileSync(path.join(process.cwd(), 'src', f), 'utf8')
    const OPTED_IN = {
      'pages/UCT20.jsx': [/className=\{styles\.row\}\s+data-panel-row/],
      'pages/research/tabs/NewsTab.jsx': [/className=\{styles\.newsItem\} data-panel-row/],
      'pages/research/tabs/CatalystsTab.jsx': [/className=\{styles\.newsItem\} data-panel-row/],
      'components/research-kit/RatingChangeList.jsx': [/data-testid="rk-rc-row" data-panel-row/],
      'pages/research/tabs/RatingsTab.jsx': [/styles\.checkRow\} data-panel-row/, /styles\.ratingGrid\} data-panel-tiles/, /styles\.ratingCard\} data-panel-tile/],
      'pages/research/tabs/FilingsTab.jsx': [/styles\.filingRow\} data-panel-row/],
      'components/AlertBell.jsx': [/key=\{a\.id\}\s+data-panel-row/],
      'pages/terminal/panels/HelpPanel.jsx': [/data-panel-row className=\{`\$\{styles\.helpRow\}/],
      'pages/research/depth/FilingSearchPanel.jsx': [/styles\.hits\} data-panel-list/],
      'pages/research/depth/NewsDeskPanel.jsx': [/styles\.hits\} data-panel-list/],
      'pages/research/depth/CallReplayPanel.jsx': [/styles\.turns\}`\} data-panel-list/],
    }
    for (const [f, pats] of Object.entries(OPTED_IN)) {
      const src = read(f)
      for (const p of pats) expect(src, `${f} lost ${p}`).toMatch(p)
    }
  })

  it('the comfortable values are declared once, in tokens.css, so pages outside the terminal resolve them', () => {
    const tokens = fs.readFileSync(path.join(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    for (const v of ['--panel-inset', '--panel-gap', '--panel-fs', '--panel-row-h']) expect(tokens).toMatch(new RegExp(`${v}:`))
  })
})

describe('one header per panel', () => {
  it('useInTerminalPanel is null outside a terminal panel', () => {
    function Probe() { return <span data-testid="probe">{JSON.stringify(useInTerminalPanel())}</span> }
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('null')
  })

  it('SCR and FREC pass the page its OWN embedded prop', () => {
    expect(BY_CODE.SCR.market.props).toEqual({ embedded: true })
    expect(BY_CODE.FREC.market.props).toEqual({ embedded: true })
    renderPanel({ code: 'SCR' })
    const stub = screen.getByTestId(/^stub-/)
    expect(JSON.parse(stub.getAttribute('data-props')).embedded).toBe(true)
  })

  it('the calendar drops its "UCT Terminal" title inside a terminal panel, and keeps it on its page', () => {
    const props = {
      view: 'table', setView: () => {}, weekLabel: 'Week of Jun 9–13',
      filters: { audience: 'mine', minMcap: 0, sort: 'mine', minAvgVol: null, priceMin: null, priceMax: null },
      setFilters: () => {}, mySources: ['watchlist'], setMySources: () => {},
      monthCursor: { year: 2026, month: 6 }, setMonthCursor: () => {},
      eventTypes: new Set(['earnings']), setEventTypes: () => {},
    }
    render(
      <MemoryRouter>
        <TerminalPanelContext.Provider value={{ code: 'CAL', density: 'comfortable', inset: false }}>
          <CalendarHeader {...props} />
        </TerminalPanelContext.Provider>
      </MemoryRouter>,
    )
    expect(screen.queryByText('UCT Terminal')).toBeNull()
    cleanup()
    render(<MemoryRouter><CalendarHeader {...props} /></MemoryRouter>)
    expect(screen.getByText('UCT Terminal')).toBeTruthy()
  })
})

describe('one loading treatment', () => {
  it('a loading panel shows ONE skeleton (role=status), not a "Loading CODE…" text line', () => {
    renderPanel({ code: 'DES', sym: 'NVDA' })
    const body = screen.getByTestId('terminal-body-0')
    const statuses = within(body).getAllByRole('status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0].getAttribute('data-testid')).toBe('terminal-loading-0')
    // The words exist once, for assistive tech, inside the skeleton — not as a visible line.
    expect(statuses[0].textContent).toBe('Loading DES…')
    expect(body.querySelectorAll('[class*="panelEmpty"]')).toHaveLength(0)
  })
})

describe('icon actions and shell states', () => {
  it('duplicate / pop out / close are UIcons with their accessible labels, never text glyphs', () => {
    renderPanel({ code: 'CN', sym: 'NVDA' })
    for (const [id, label] of [['terminal-dup-0', 'Duplicate panel 1'], ['terminal-popout-0', 'Pop out panel 1'], ['terminal-close-0', 'Close panel 1']]) {
      const btn = screen.getByTestId(id)
      expect(btn.getAttribute('aria-label')).toBe(label)
      expect(btn.querySelector('svg')).not.toBeNull()
      expect(btn.textContent.trim()).toBe('')
    }
    expect(document.body.textContent).not.toMatch(/[⧉↗×★☆]/)
  })

  it('a code that needs a ticker says so in the shared state block, with the command to type', () => {
    renderPanel({ code: 'CN' })
    const body = screen.getByTestId('terminal-body-0')
    expect(body.querySelector('[data-kind="input"]')).not.toBeNull()
    expect(body.querySelector('kbd').textContent).toBe('NVDA CN')
  })

  it('a popped-out panel keeps its testid and its Bring it back action', () => {
    renderPanel({ code: 'CN', sym: 'NVDA', popout: true })
    const popped = screen.getByTestId('terminal-popped-0')
    expect(popped.textContent).toMatch(/CN is open in its own window/)
    expect(within(popped).getByRole('button', { name: 'Bring it back' })).toBeTruthy()
  })
})

describe('the shell reads app tokens only', () => {
  const read = (f) => fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it.each(['TerminalShell.module.css', 'L0Strip.module.css'])('%s has no colour literal, bridge alias or phantom token', (f) => {
    const css = read(f)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/rgba?\(/)
    expect(css).not.toMatch(/var\(--(text-faint|text-secondary|text-primary|text-dim|color-text|color-danger|color-success|color-warning|bg-base|danger)\b/)
  })

  it('TerminalRoutes.jsx carries no hex colour', () => {
    expect(read('TerminalRoutes.jsx')).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/)
  })
})

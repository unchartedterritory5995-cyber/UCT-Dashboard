// The Ticker Hub sheet's height does not depend on what loads after it opens.
//
// Measured in WebKit (live site, 834 touch, bottom-anchored sheet): the "Why it's moving" section
// (`.why`, tweets, ~172px) comes from its own fetch and often lands AFTER the slide-up, after the
// chart and price (t~1972ms): the sheet grew 773 -> 957px and its top went 421 -> 237, moving
// everything above the section by 184px. Reproduced locally (route-mocked /api, the tweets answered
// 2.5s late): top 528 -> 440. With "no tweets" a reserve would have had to collapse just as late,
// so the panel instead takes the bottom sheet's own height cap as its height (the phone already
// opens at it: its content is taller), and late content fills space that is already there.
// After: top 95.5 in every frame at 834 with tweets late AND with none; 390 unchanged (53.1).
//
// A STRUCTURAL RAIL (jsdom lays nothing out); the WebKit trace is the measurement.
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi, describe, it, expect } from 'vitest'

vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({ default: () => ({ createAlert: vi.fn(), hasAlert: () => false }) }))
vi.mock('../../hooks/useTickerTweets', () => ({ default: () => ({ data: undefined }) }))
vi.mock('../../hooks/useFilingWatch', () => ({
  default: () => ({ enabled: false, watchState: () => 'NOT_WATCHING', getWatch: () => null, createOrReactivate: vi.fn(), suspend: vi.fn() }),
}))
vi.mock('../chart/pane/ChartPane', () => ({ default: () => <div data-testid="chart-pane" /> }))
vi.mock('../voice/CompassAssistButton', () => ({ default: ({ label }) => <button>{label}</button> }))
vi.mock('../CompareSymbolSearch', () => ({ default: () => <button>Compare</button> }))

import { TickerHubProvider, useTickerHub } from './TickerHubContext'
import TickerHubSheet from './TickerHubSheet'
import hubStyles from './TickerHubSheet.module.css'

const SRC = join(process.cwd(), 'src')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const HUB_CSS = strip(readFileSync(join(SRC, 'components/mobile/TickerHubSheet.module.css'), 'utf8'))
const SHEET_CSS = strip(readFileSync(join(SRC, 'components/mobile/Sheet.module.css'), 'utf8'))

/** The value of `prop` in the top-level rule whose selector is exactly `selector`. */
function decl(css, selector, prop) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue
    const v = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`).exec(m[2].trim())
    if (v) return v[1]
  }
  return null
}

function Opener() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('ENPH')}>open ENPH</button>
}

describe('Ticker Hub sheet: late content never changes its height', () => {
  it('the panel takes a fixed height, equal to the bottom sheet\'s own cap', () => {
    const cap = decl(SHEET_CSS, '.panel_bottom-sheet', 'max-height')
    expect(cap, 'Sheet.module.css .panel_bottom-sheet max-height').toBeTruthy()
    expect(decl(HUB_CSS, '.panel', 'height')).toBe(cap)
  })

  it('the hub hands that class to the Sheet panel (the dialog itself), while the tweets are still loading', () => {
    render(<MemoryRouter><TickerHubProvider><Opener /><TickerHubSheet /></TickerHubProvider></MemoryRouter>)
    fireEvent.click(screen.getByText('open ENPH'))
    const dialog = screen.getByRole('dialog')
    expect(hubStyles.panel, 'the CSS module exports .panel').toBeTruthy()
    expect(dialog.className.split(/\s+/)).toContain(hubStyles.panel)
  })
})

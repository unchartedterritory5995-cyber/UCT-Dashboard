// Owner ruling 2026-09-29: the themes letter panel (/r/themes) is redrawn in the
// house card style — header "THEMES · 1W LEADERS & LAGGARDS" with the UCT
// INTELLIGENCE mark, FULL theme names (wrap, never truncate), one bar per row
// with the % at the end, top leaders then bottom laggards. Route params
// (period, n, holds, w) keep working.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ThemesRender, { fmtRet } from '../ThemesRender'

const LEADERS = [
  { name: 'Semiconductor Equipment & Materials', ret: 8.4, holdings: ['AMAT', 'LRCX', 'KLAC', 'ASML'] },
  { name: 'Nuclear & Uranium', ret: 6.1, holdings: ['CCJ', 'OKLO'] },
  { name: 'Quantum Computing', ret: 5.0, holdings: ['IONQ'] },
  { name: 'Space', ret: 3.2, holdings: ['RKLB'] },
  { name: 'Robotics', ret: 2.1, holdings: ['ISRG'] },
  { name: 'Sixth Leader', ret: 1.9, holdings: [] },
]
const LAGGARDS = [
  { name: 'Homebuilders & Residential Construction', ret: -6.2, holdings: ['DHI', 'LEN'] },
  { name: 'Regional Banks', ret: -4.0, holdings: ['KRE'] },
  { name: 'Airlines', ret: -3.1, holdings: ['DAL'] },
  { name: 'Cannabis', ret: -2.2, holdings: [] },
  { name: 'Solar', ret: -1.4, holdings: ['ENPH'] },
]

let lastUrl = ''
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    lastUrl = String(url)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ period: '1W', leaders: LEADERS, laggards: LAGGARDS, max_abs: 8.4 }),
    })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const renderAt = (qs = '') => render(
  <MemoryRouter initialEntries={[`/r/themes?w=728${qs}`]}><ThemesRender /></MemoryRouter>)

describe('fmtRet', () => {
  it('signs from the rounded value and never prints -0.0', () => {
    expect(fmtRet(8.44)).toBe('+8.4%')
    expect(fmtRet(-6.2)).toBe('-6.2%')
    expect(fmtRet(-0.04)).toBe('0.0%')
    expect(fmtRet(null)).toBe('—')
  })
})

describe('ThemesRender', () => {
  it('house header with the UCT INTELLIGENCE mark and no em dash', async () => {
    renderAt()
    await screen.findByText('Nuclear & Uranium')
    const head = screen.getByText(/^THEMES/)
    expect(head.textContent).toBe('THEMES · 1W LEADERS & LAGGARDS')
    expect(screen.getByText('UCT INTELLIGENCE')).toBeInTheDocument()
  })

  it('prints FULL theme names (no ellipsis) and lets them wrap', async () => {
    renderAt()
    const name = await screen.findByText('Semiconductor Equipment & Materials')
    expect(name.style.whiteSpace).toBe('normal')
    expect(name.style.textOverflow).not.toBe('ellipsis')
    expect(screen.getByText('Homebuilders & Residential Construction')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/…/)
  })

  it('defaults to top 5 leaders then 5 laggards, each with a bar and the % at the end', async () => {
    renderAt()
    await screen.findByText('Robotics')
    expect(screen.queryByText('Sixth Leader')).not.toBeInTheDocument()
    const rows = screen.getAllByTestId('theme-row')
    expect(rows).toHaveLength(10)
    expect(rows[0]).toHaveTextContent('Semiconductor Equipment & Materials')
    expect(rows[0].textContent.endsWith('+8.4%')).toBe(true)
    expect(rows[5]).toHaveTextContent('Homebuilders & Residential Construction')
    expect(rows[5].textContent.endsWith('-6.2%')).toBe(true)
    // the biggest move shown fills its track; bars scale to it
    const bars = screen.getAllByTestId('theme-bar')
    expect(bars[0].style.width).toBe('100%')
    expect(bars[5].style.width).toBe('74%')          // 6.2 / 8.4
    expect(bars[0].style.background).toBe('rgb(34, 197, 94)')
    expect(bars[5].style.background).toBe('rgb(239, 68, 68)')
    expect(lastUrl).toContain('n=5')
  })

  it('route params keep working: period, n, holds', async () => {
    renderAt('&period=1M&n=6&holds=2')
    await screen.findByText('Sixth Leader')
    expect(lastUrl).toContain('period=1M')
    expect(lastUrl).toContain('n=6')
    expect(lastUrl).toContain('holds=2')
    expect(screen.getByText('AMAT · LRCX')).toBeInTheDocument()
    expect(screen.queryByText(/KLAC/)).not.toBeInTheDocument()
  })

  it('holds=0 hides the holdings line', async () => {
    renderAt('&holds=0')
    await screen.findByText('Robotics')
    expect(screen.queryByText(/AMAT/)).not.toBeInTheDocument()
  })
})

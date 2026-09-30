// Owner rulings 2026-09-29 for the "Set to Report" letter panel (/r/earncards):
//   - `badge` is shown verbatim; without it the old on_board -> "ON OUR BOARD"
//     behaviour is unchanged (the control below);
//   - the company name wraps instead of ellipsing ("Micron Technolog…");
//   - negative EPS reads "-$1.20", never "$-1.20";
//   - a growth figure that rounds to 0% has no arrow and is neutral grey.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import EarnCardsRender from '../EarnCardsRender'

const enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function renderRows(rows) {
  const url = `/r/earncards?w=728&data=${enc({ rows })}`
  return render(<MemoryRouter initialEntries={[url]}><EarnCardsRender /></MemoryRouter>)
}

const MU = {
  sym: 'MU', name: 'Micron Technology', session: 'AMC', label: 'Wed Oct 1',
  last_q: { eps: 1.18, rev_m: 9301 }, eps_est: 2.85, rev_est: 11200,
  proj_eps_yoy: 141, proj_rev_yoy: 20, exp_move_pct: 9.1,
}

describe('EarnCardsRender — 2026-09-29 rulings', () => {
  it('prints a wire-supplied badge verbatim, even when on_board is also set', () => {
    renderRows([{ ...MU, on_board: true, badge: 'ON OUR WATCH LIST' }])
    expect(screen.getByTestId('row-badge')).toHaveTextContent('ON OUR WATCH LIST')
    expect(screen.queryByText('ON OUR BOARD')).not.toBeInTheDocument()
  })

  it('CONTROL: an old payload (on_board, no badge) still reads ON OUR BOARD', () => {
    renderRows([{ ...MU, on_board: true }])
    expect(screen.getByTestId('row-badge')).toHaveTextContent('ON OUR BOARD')
  })

  it('shows no pill at all when neither badge nor on_board is set (and a blank badge is not a badge)', () => {
    renderRows([{ ...MU, badge: '   ' }])
    expect(screen.queryByTestId('row-badge')).not.toBeInTheDocument()
  })

  it('lets the company name wrap instead of ellipsing it', () => {
    renderRows([{ ...MU, badge: 'ON OUR WATCH LIST' }])
    const name = screen.getByTestId('company-name')
    expect(name).toHaveTextContent('Micron Technology')
    expect(name.style.whiteSpace).toBe('normal')
    expect(name.style.textOverflow).not.toBe('ellipsis')
    // the row wraps, so the badge can drop below the name instead of squeezing it
    expect(name.parentElement.style.flexWrap).toBe('wrap')
  })

  it('puts the minus sign before the dollar on negative EPS', () => {
    renderRows([{ ...MU, last_q: { eps: -5.34, rev_m: 120 }, eps_est: -1.2 }])
    expect(screen.getByText('-$5.34')).toBeInTheDocument()
    expect(screen.getByText('-$1.20')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$-\d/)
  })

  it('a growth figure that rounds to 0% shows no arrow and is grey', () => {
    renderRows([{ ...MU, proj_eps_yoy: 0.3, proj_rev_yoy: -0.4 }])
    const eps = document.querySelector('[data-growth="EPS"]')
    const rev = document.querySelector('[data-growth="REV"]')
    expect(eps.textContent).toBe('EPS0%')
    expect(rev.textContent).toBe('REV0%')
    expect(eps.style.color).toBe('rgb(154, 160, 143)')
    expect(rev.style.color).toBe('rgb(154, 160, 143)')
  })

  it('CONTROL: a real move keeps its arrow and colour', () => {
    renderRows([{ ...MU, proj_eps_yoy: 141, proj_rev_yoy: -12 }])
    const eps = document.querySelector('[data-growth="EPS"]')
    const rev = document.querySelector('[data-growth="REV"]')
    expect(eps.textContent).toBe('EPS▲ +141%')
    expect(rev.textContent).toBe('REV▼ -12%')
    expect(eps.style.color).toBe('rgb(34, 197, 94)')
    expect(rev.style.color).toBe('rgb(239, 68, 68)')
  })
})

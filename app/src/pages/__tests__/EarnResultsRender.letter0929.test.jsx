// Owner rulings 2026-09-29 for the "Earnings Results" letter panel (/r/earnresults):
//   - negative EPS reads "-$5.34" (and "est -$5.10"), never "$-5.34";
//   - a YoY change that rounds to 0% has NO arrow and is neutral grey (the letter
//     printed a green "EPS ▲ 0%" in GROWTH vs LAST YEAR);
//   - the same `badge` contract as Set to Report, with the on_board control.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import EarnResultsRender from '../EarnResultsRender'

const enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function renderRows(rows) {
  const url = `/r/earnresults?w=728&data=${enc({ rows })}`
  return render(<MemoryRouter initialEntries={[url]}><EarnResultsRender /></MemoryRouter>)
}

const ROW = {
  sym: 'NKE', name: 'Nike, Inc.', session: 'AMC', is_beat: true,
  eps_act: 0.49, eps_est: 0.27, eps_surp: 81, rev_act: 11720, rev_est: 11000, rev_surp: 6.5,
  eps_yoy: -30, rev_yoy: 2,
}

describe('EarnResultsRender — 2026-09-29 rulings', () => {
  it('puts the minus before the dollar in the reported figure AND the est line', () => {
    renderRows([{ ...ROW, eps_act: -5.34, eps_est: -5.1, eps_surp: -4.7 }])
    expect(screen.getByText('-$5.34')).toBeInTheDocument()
    expect(screen.getByText('est -$5.10')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$-\d/)
  })

  it('CONTROL: a positive EPS still reads $0.49 / est $0.27', () => {
    renderRows([ROW])
    expect(screen.getByText('$0.49')).toBeInTheDocument()
    expect(screen.getByText('est $0.27')).toBeInTheDocument()
  })

  it('GROWTH vs LAST YEAR: a figure that rounds to 0% has no arrow and is grey', () => {
    renderRows([{ ...ROW, eps_yoy: 0.2, rev_yoy: -0.4 }])
    const eps = document.querySelector('[data-growth="EPS"]')
    const rev = document.querySelector('[data-growth="REV"]')
    expect(eps.textContent).toBe('EPS0%')
    expect(rev.textContent).toBe('REV0%')
    expect(eps.style.color).toBe('rgb(154, 160, 143)')
    expect(rev.style.color).toBe('rgb(154, 160, 143)')
    expect(eps.textContent).not.toMatch(/[▲▼]/)
  })

  it('CONTROL: real growth keeps its arrow and colour', () => {
    renderRows([ROW])
    const eps = document.querySelector('[data-growth="EPS"]')
    const rev = document.querySelector('[data-growth="REV"]')
    expect(eps.textContent).toBe('EPS▼ -30%')
    expect(rev.textContent).toBe('REV▲ +2%')
    expect(eps.style.color).toBe('rgb(239, 68, 68)')
    expect(rev.style.color).toBe('rgb(34, 197, 94)')
  })

  it('a surprise that rounds to 0% still shows no chip (unchanged)', () => {
    renderRows([{ ...ROW, eps_surp: 0.3 }])
    expect(screen.queryByText(/▲\+0%|▼0%/)).not.toBeInTheDocument()
  })

  it('badge wins verbatim; CONTROL on_board alone still reads ON OUR BOARD', () => {
    const { unmount } = renderRows([{ ...ROW, on_board: true, badge: 'IN THE BOOK' }])
    expect(screen.getByTestId('row-badge')).toHaveTextContent('IN THE BOOK')
    unmount()
    renderRows([{ ...ROW, on_board: true }])
    expect(screen.getByTestId('row-badge')).toHaveTextContent('ON OUR BOARD')
  })

  it('lets the company name wrap instead of ellipsing it', () => {
    renderRows([{ ...ROW, name: 'Micron Technology', badge: 'ON OUR WATCH LIST' }])
    const name = screen.getByTestId('company-name')
    expect(name).toHaveTextContent('Micron Technology')
    expect(name.style.whiteSpace).toBe('normal')
  })
})

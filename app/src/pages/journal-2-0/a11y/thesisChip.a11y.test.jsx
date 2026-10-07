// app/src/pages/journal-2-0/a11y/thesisChip.a11y.test.jsx
//
// Wave 13 lane 13G-2 -- the thesis chip (status + distance-to-stop, on Positions/Holdings
// rows). Two states, because the closed chip and its open preview are different DOM:
//   * thesis-chip-closed -- the chip alone, as every row renders it by default;
//   * thesis-chip-open   -- the hover/tap/keyboard-opened preview (title, levels, the
//     link into the note), proven open before axe runs so an empty popover can't pass.
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axeSurface } from './surface'
import ThesisChip from '../components/notebook/ThesisChip'

const CHIP = {
  noteId: 'n1',
  title: 'NVDA swing plan',
  thesisStatus: 'active',
  entry: 100,
  stop: 90,
  target: 120,
  link: '/journal/notebook?note=n1',
}

describe('lane 13G-2 surface (thesis chip)', () => {
  axeSurface('thesis-chip-closed', async () => {
    render(<MemoryRouter><ThesisChip chip={CHIP} currentPrice={105} /></MemoryRouter>)
    screen.getByRole('button', { name: /Thesis note: Active/ })
  })

  axeSurface('thesis-chip-open', async () => {
    render(<MemoryRouter><ThesisChip chip={CHIP} currentPrice={105} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Thesis note: Active/ }))
    screen.getByText('NVDA swing plan')
    screen.getByRole('link', { name: 'Open note' })
  })
})

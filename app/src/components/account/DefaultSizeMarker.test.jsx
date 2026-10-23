import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import DefaultSizeMarker from './DefaultSizeMarker'

// Round B fix 2, finding 9: a surface computing on the default size says so.
describe('DefaultSizeMarker', () => {
  it("shows 'Default size' with the Portfolio Risk page's sentence when the size is the default", () => {
    render(<DefaultSizeMarker settings={{ accountSize: 100000, accountSizeIsDefault: true }} />)
    const el = screen.getByText('Default size')
    expect(el.getAttribute('title')).toBe(
      'No account size on file — these numbers use a default account size, not your real one.')
  })
  it("renders nothing for the member's own size or a payload without the answer", () => {
    const { container } = render(<>
      <DefaultSizeMarker settings={{ accountSize: 100000, accountSizeIsDefault: false }} />
      <DefaultSizeMarker settings={{ accountSize: 100000 }} />
      <DefaultSizeMarker settings={undefined} />
    </>)
    expect(container.textContent).toBe('')
  })
  it.each([
    'pages/journal-2-0/tabs/OpenPositionsTab.jsx',
    'pages/journal-2-0/surfaces/today/TodayMarketLead.jsx',
    'components/tiles/JournalSnapshotTile.jsx',
    'pages/journal-2-0/components/AddPositionModal.jsx',
  ])('%s renders it from its settings', (rel) => {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8')
    expect(src).toMatch(/import DefaultSizeMarker from '[./a-z]*account\/DefaultSizeMarker'/)
    expect(src).toMatch(/<DefaultSizeMarker settings=\{settings\}/)
  })
})

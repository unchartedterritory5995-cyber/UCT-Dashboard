import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import DefaultSizeMarker from './DefaultSizeMarker'

// Round B fix 2, finding 9: a surface computing on the default size says so.
describe('DefaultSizeMarker', () => {
  it("shows 'Default size' with the server's sentence (the pinned client copy) when the size is the default", () => {
    render(<DefaultSizeMarker settings={{ accountSize: 100000, accountSizeIsDefault: true }} />)
    const el = screen.getByText('Default size')
    // DEFAULTS.defaultSizeSentence is pinned to voice_position_sizing.default_size_sentence() by
    // tests/test_account_size_authority.py; the marker restates nothing (R2-3).
    const DEFAULTS = JSON.parse(readFileSync(resolve(__dirname, '../../constants/accountSizeDefault.json'), 'utf8'))
    expect(el.getAttribute('title')).toBe(DEFAULTS.defaultSizeSentence)
    expect(DEFAULTS.defaultSizeSentence).toContain('($100,000)')
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

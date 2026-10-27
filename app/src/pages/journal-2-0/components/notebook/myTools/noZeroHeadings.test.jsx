// Task 11.19 fix round 2 (W9-R7, no zeros): every My tools tab, in each of its three lists, with nothing in it. The
// heading names the list ("Your widgets", "Archived", "Recently deleted") and no "0" is drawn anywhere in the tab.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { listHeadingText } from './myToolsLib'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => {
  const real = await orig()
  return { ...real, widgetsWaveOn: (w) => (w === 11 ? true : real.widgetsWaveOn(w)) }
})

const json = (body) => ({ ok: true, status: 200, json: async () => body })
function emptyServer() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/widget-definitions?view=')) return json({ widgets: [] })
    if (u.startsWith('/api/j2/routines?filter=')) return json({ routines: [] })
    if (u.startsWith('/api/j2/trackers?filter=')) return json({ trackers: [] })
    if (u.startsWith('/api/j2/journal-styles?view=')) return json({ kinds: [], styles: [] })
    return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) }
  }))
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const TABS = [
  ['Widgets', 'Your widgets'], ['Routines', 'Your routines'], ['Trackers', 'Your trackers'], ['Templates', 'Your templates'],
]

describe('no zeros in any My tools list heading', () => {
  it('every tab, every list, empty: the heading names the list and the tab draws no 0', async () => {
    emptyServer()
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    let seen = 0
    for (const [tab, first] of TABS) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      const panel = screen.getByRole('tabpanel', { name: tab })
      for (const [filter, heading] of [[null, first], ['Archived', 'Archived'], ['Recently deleted', 'Recently deleted']]) {
        if (filter) fireEvent.click(within(panel).getByRole('button', { name: filter, pressed: false }))
        expect(await within(panel).findByRole('heading', { name: heading }), `${tab} / ${heading}`).toBeInTheDocument()
        await within(panel).findByTestId('my-tools-empty')
        expect(panel.textContent, `${tab} / ${heading}`).not.toMatch(/\b0\b/)
        seen += 1
      }
    }
    expect(seen).toBe(12)                                                    // non-vacuity: 4 tabs x 3 lists
  })

  it('the one heading rule counts when there is something, and never says 0', () => {
    expect(listHeadingText('live', 1, 'widget', 'widgets')).toBe('1 widget')
    expect(listHeadingText('active', 3, 'routine', 'routines')).toBe('3 routines')
    expect(listHeadingText('archived', 2)).toBe('2 archived')
    expect(listHeadingText('deleted', 1)).toBe('1 recently deleted')
    for (const f of ['live', 'active', 'archived', 'deleted']) expect(listHeadingText(f, 0, 'x', 'xs')).not.toMatch(/\b0\b/)
    expect(/\b0\b/.test('0 archived')).toBe(true)                            // CONTROL: the check sees a zero
  })
})

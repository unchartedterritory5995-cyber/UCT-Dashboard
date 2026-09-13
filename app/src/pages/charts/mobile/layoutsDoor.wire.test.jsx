/* MOB-01 — the WIRE, not the component.
 *
 * `MobileLayoutsSheet.test.jsx` proves the sheet behaves. This file proves the
 * sheet is REACHABLE, because the original defect was neither a bug in a
 * component nor a missing feature: the layout data existed, the handlers
 * existed, the API existed — and two `const` declarations sat on the wrong side
 * of `if (isMobile) { return … }`, so the phone could never see any of it.
 *
 * ⭐ That is a defect a component test is structurally blind to. Both rails
 * below carry a NON-VACUITY control so they cannot pass for the wrong reason.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileMoreSheet from './MobileMoreSheet'

// The Tools sheet's flag row reads auth-backed state; it is not what this file tests.
// Same mock the neighbouring mobile tests use.
vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }),
}))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8')

describe('the Tools sheet carries the door', () => {
  const base = {
    open: true, onClose: vi.fn(), sym: 'SPY',
    widgets: [], onOpenWidget: vi.fn(), onAddWidget: vi.fn(),
    onOpenSettings: vi.fn(),
  }

  it('renders a Layouts row and calls onOpenLayouts', async () => {
    const onOpenLayouts = vi.fn()
    render(<MobileMoreSheet {...base} onOpenLayouts={onOpenLayouts} activeLayoutName="Swing board" />)
    const row = screen.getByRole('button', { name: 'Layouts' })
    expect(row).toBeInTheDocument()
    // the open layout's name rides the row, so the sheet is not the only place it shows
    expect(row).toHaveTextContent('Swing board')
    await userEvent.click(row)
    expect(onOpenLayouts).toHaveBeenCalledTimes(1)
  })

  it('CONTROL — the row is absent when no handler is supplied, so the assertion above is real', () => {
    render(<MobileMoreSheet {...base} />)
    expect(screen.queryByRole('button', { name: 'Layouts' })).toBeNull()
    expect(screen.getByText('Chart settings')).toBeInTheDocument()   // …and the sheet still rendered
  })
})

describe('⛔ the template lists must be computed ABOVE the mobile return', () => {
  const src = read('../ChartsWorkspace.jsx')
  const at = (needle) => src.indexOf(needle)

  const MOBILE_RETURN = 'if (isMobile) {'

  it('the file still has the shapes this rail reasons about', () => {
    // If any of these moves, the rail must be re-read rather than trusted.
    expect(at(MOBILE_RETURN), 'the isMobile branch moved or was renamed').toBeGreaterThan(-1)
    expect(at('const wsGlobalLayouts'), 'wsGlobalLayouts was renamed').toBeGreaterThan(-1)
    expect(at('const wsMyLayouts'), 'wsMyLayouts was renamed').toBeGreaterThan(-1)
    expect(at('<MobileChartsApp'), 'the phone shell is no longer rendered here').toBeGreaterThan(-1)
  })

  it('wsGlobalLayouts and wsMyLayouts are declared before the phone branch returns', () => {
    // THE REGRESSION, stated as a position: declared after the return === invisible to mobile.
    expect(at('const wsGlobalLayouts'),
      'wsGlobalLayouts is declared AFTER `if (isMobile)` — the phone cannot see the firm templates again',
    ).toBeLessThan(at(MOBILE_RETURN))
    expect(at('const wsMyLayouts'),
      'wsMyLayouts is declared AFTER `if (isMobile)` — the phone cannot see the user\'s layouts again',
    ).toBeLessThan(at(MOBILE_RETURN))
  })

  it('the phone shell is handed the same handlers the desktop menu uses', () => {
    const call = src.slice(at('<MobileChartsApp'), at('<MobileChartsApp') + 1400)
    for (const [prop, handler] of [
      ['onApplyLayout', 'applyTemplate'],
      ['onApplyUctDefault', 'applyUctDefault'],
      ['onSaveLayout', 'handleSaveLayout'],
      ['onSaveLayoutAs', 'handleSaveAsTemplate'],
      ['onDeleteLayout', 'handleDeleteTemplate'],
    ]) {
      expect(call, `${prop} must be wired to the existing ${handler}, not to a mobile-only copy`)
        .toContain(`${prop}={${handler}}`)
    }
    expect(call).toContain('layoutsMine={wsMyLayouts}')
    expect(call).toContain('layoutsPrebuilt={wsGlobalLayouts}')
  })

  it('CONTROL — the probe can see a prop that is NOT there', () => {
    const call = src.slice(at('<MobileChartsApp'), at('<MobileChartsApp') + 1400)
    expect(call).not.toContain('onInventedLayoutThing=')
  })
})

describe('the phone shell mounts the sheet', () => {
  const src = read('./MobileChartsApp.jsx')

  it('imports and renders MobileLayoutsSheet on its own sheet key', () => {
    expect(src).toContain("import MobileLayoutsSheet from './MobileLayoutsSheet'")
    expect(src).toContain('<MobileLayoutsSheet')
    expect(src).toContain("open={sheet === 'layouts'}")
    expect(src).toContain("onOpenLayouts={() => setSheet('layouts')}")
  })
})

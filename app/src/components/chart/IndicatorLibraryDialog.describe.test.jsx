// app/src/components/chart/IndicatorLibraryDialog.describe.test.jsx
//
// ─── CREATE INDICATOR FROM THE LIBRARY ───────────────────────────────────────
//
// Measured on production at 390px, 2026-11-15, the day Create Indicator opened to every
// account: this dialog is the only way into indicators on a phone, and it offered "New
// formula" and nothing else. A member on a phone could not reach the feature at all.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'

const settings = mergeChartSettings(JSON.stringify({}))
const open = (props = {}) => render(
  <IndicatorLibraryDialog open onClose={() => {}} settings={settings} onChange={() => {}}
    registry={engineRegistry} {...props} />)

afterEach(cleanup)

describe('the library offers Create Indicator when the host passes its door', () => {
  it('shows "Describe an indicator" above "New formula", and a press calls the door once', () => {
    const describeIt = vi.fn()
    const formula = vi.fn()
    open({ onCreateIndicator: describeIt, onCreateFormula: formula })
    const d = screen.getByTestId('library-describe')
    const f = screen.getByTestId('library-new-formula')
    expect(d).toHaveTextContent('Describe an indicator')
    // DOM order: the plain-words door comes first.
    expect(d.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(d)
    expect(describeIt).toHaveBeenCalledTimes(1)
    expect(formula).not.toHaveBeenCalled()
  })

  it('says what will happen, in the member\'s terms', () => {
    open({ onCreateIndicator: () => {} })
    expect(screen.getByTestId('library-describe'))
      .toHaveTextContent(/previews on this chart.*nothing is saved until you say so/i)
  })

  it('no door from the host means no row: an account without access sees the library as before', () => {
    open({ onCreateFormula: () => {} })
    expect(screen.queryByTestId('library-describe')).toBeNull()
    expect(screen.getByTestId('library-new-formula')).toBeInTheDocument()      // control: the other row is untouched
  })

  it('it is not filtered by what is typed: a search that finds nothing still offers it', () => {
    open({ onCreateIndicator: () => {} })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz no such indicator' } })
    expect(screen.getByTestId('library-describe')).toBeInTheDocument()
  })
})

describe('wiring and the phone layout (read from source)', () => {
  const src = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
  // Comments are stripped first: a rule that only appears in prose must not satisfy these.
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the toolbar passes the door only to an account its own Create Indicator button would open for', () => {
    const t = code(src('./ChartToolbar.jsx'))
    expect(t).toMatch(/onCreateIndicator=\{canModifyWithIntelligence && typeof onStudioPreview === 'function'\s*\?\s*\(\) => \{[^}]*setCreateOpen\(true\)[^}]*\}\s*:\s*null\}/)
  })

  it('at the touch tier the dock is a bottom sheet, and the docked variant is left alone', () => {
    const css = code(src('./builder/studio/CreateIndicatorPanel.module.css'))
    const m = css.match(/@media \(max-width: 1024px\) \{\s*\.panel:not\(\.panelDocked\) \{([^}]*)\}/)
    expect(m, 'no touch-tier rule for the floating panel').not.toBeNull()
    const rule = m[1]
    expect(rule).toMatch(/bottom:\s*0/)
    expect(rule).toMatch(/top:\s*auto\s*!important/)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/height:\s*min\(58dvh, 560px\)\s*!important/)
  })

  it('⛔ CONTROL: the rule check can tell a missing rule from a present one', () => {
    const without = '.panel { position: fixed; width: 360px; }'
    expect(without.match(/@media \(max-width: 1024px\) \{\s*\.panel:not\(\.panelDocked\) \{([^}]*)\}/)).toBeNull()
  })
})

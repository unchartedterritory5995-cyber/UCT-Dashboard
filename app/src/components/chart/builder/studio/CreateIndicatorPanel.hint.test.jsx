// THE HINT INSIDE THE MESSAGE BOX IS ONE SHORT LINE.
//
// The box is one row tall until something is typed. On a phone (2026-11-17, production, 390 px)
// the hint "Describe the indicator you want to build…" wrapped and its second line was cut off.
// Two guards: every hint is short, and the stylesheet keeps the hint on one line whatever it says.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import CreateIndicatorPanel, { BOX_HINT, BOX_HINT_MAX } from './CreateIndicatorPanel'

const props = () => ({
  settings: mergeChartSettings({}), onChange: () => {}, sym: 'AAPL', tf: 'D',
  onPreview: () => {}, onClose: () => {}, converse: scriptedConverse,
})
const input = () => screen.getByTestId('create-indicator-input')
const CSS = fs.readFileSync(path.join(__dirname, 'CreateIndicatorPanel.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('the hint inside the message box', () => {
  it('a new indicator shows the short opening hint, and it changes once something is built', async () => {
    render(<CreateIndicatorPanel {...props()} />)
    expect(input().getAttribute('placeholder')).toBe(BOX_HINT.fresh)
    fireEvent.change(input(), { target: { value: 'Add a 20 EMA' } })
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
    await act(async () => {})
    expect(input().getAttribute('placeholder')).toBe(BOX_HINT.working)
  })

  it('every hint fits one line of the box: three of them, none over the limit, all different', () => {
    const hints = Object.values(BOX_HINT)
    expect(hints).toHaveLength(3)
    expect(new Set(hints).size).toBe(3)
    for (const h of hints) {
      expect(h.length, h).toBeLessThanOrEqual(BOX_HINT_MAX)
      expect(h.trim(), h).toBe(h)
    }
    // CONTROL: the sentence that was cut off on a phone is over the limit, so the check can fail
    expect('Describe the indicator you want to build…'.length).toBeGreaterThan(BOX_HINT_MAX)
  })

  it('the stylesheet keeps the hint on one line whatever it says', () => {
    const rule = /\.input::placeholder\s*\{([^}]*)\}/.exec(CSS)
    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/white-space:\s*nowrap/)
    expect(rule[1]).toMatch(/overflow:\s*hidden/)
    expect(rule[1]).toMatch(/text-overflow:\s*ellipsis/)
    // CONTROL: the box itself may still grow as the member types; only the hint is held to a line
    const box = /\.input\s*\{([^}]*)\}/.exec(CSS)
    expect(box).not.toBeNull()
    expect(box[1]).not.toMatch(/white-space:\s*nowrap/)
  })
})

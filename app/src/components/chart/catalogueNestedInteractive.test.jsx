// app/src/components/chart/catalogueNestedInteractive.test.jsx
//
// ⛔ NO CATALOGUE ROW IS A CONTROL THAT HOLDS A CONTROL.
//
// Measured by axe in a Playwright walk of the chart's Indicator sheet:
// `nested-interactive` (serious) on `li[data-def-id="movingAverage"]`. A result
// row was a `role="option"` `<li>` with `tabIndex={0}`, and a row that is ALREADY
// ON carries "+ Add another" — a button inside an option. Only `movingAverage`
// was flagged because it was the only row on that chart; every other row was off
// and had no button inside it. A member's own formula (Modify / Edit formula /
// Custom copy) hit the same pattern in the Add surface.
//
// The row is a plain `<li>` now; its keyboard door is a real `<button>` round
// the title line, and the secondary buttons are its siblings. This rail renders
// both real surfaces with a row ON, so the case that failed is the case on
// screen, and checks:
//   1. no interactive element contains a focusable one (our own walk + axe);
//   2. the keyboard still adds — Enter and Space on the title button, once each;
//   3. the on-state a screen reader used to hear from `aria-selected` is still
//      said (`aria-pressed` in the dialog, `aria-describedby` → "Active" in the
//      Add surface).
// CONTROLS prove the walk and axe both go red on the old markup.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import { runAxe, formatViolations } from '../../pages/journal-2-0/a11y/axeHarness'
import { nestedInteractive, resultRows, getResultRow, primaryOf, resultIsOn } from './__tests__/resultRows'

afterEach(cleanup)

// The axe rules this defect lives under: the nesting itself, and the two a
// half-fix (an option list holding a stray button) would trade it for.
const RULES = ['nested-interactive', 'aria-required-children', 'aria-required-parent', 'list', 'listitem']
async function axeFindings(container) {
  const { violations } = await runAxe(container)
  return violations.filter((v) => RULES.includes(v.id))
}

const base = (extra) => mergeChartSettings(JSON.stringify(extra || {}))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

// Session VWAP ON, so its row carries "+ Add another" — the measured shape.
const WITH_VWAP = {
  indicators: { vwap: { enabled: true, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 } },
  indicatorInstances: [{
    instanceId: 'legacy:vwap', defId: 'vwap', hidden: false,
    inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  }],
}

/** The old row, built with appendChild because the HTML parser would not nest
 *  them (see `axeHarness.contract.test.js`). */
function oldRow({ innerTabIndex } = {}) {
  const ul = document.createElement('ul')
  ul.setAttribute('role', 'listbox')
  ul.setAttribute('aria-label', 'Volume')
  const li = document.createElement('li')
  li.setAttribute('role', 'option')
  li.setAttribute('aria-selected', 'true')
  li.setAttribute('tabindex', '0')
  li.setAttribute('data-def-id', 'movingAverage')
  li.appendChild(document.createTextNode('Moving Average '))
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Add another Moving Average'
  if (innerTabIndex !== undefined) btn.setAttribute('tabindex', String(innerTabIndex))
  li.appendChild(btn)
  ul.appendChild(li)
  const host = document.createElement('div')
  host.appendChild(ul)
  document.body.appendChild(host)
  return host
}

describe('CONTROL — the checks go red on the markup that shipped', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('our walk names the option that holds a button', () => {
    const host = oldRow()
    expect(nestedInteractive(host)).toEqual(['<li role="option" "movingAverage"> contains <button>'])
  })

  it('…and does not count a child a person cannot Tab to', () => {
    expect(nestedInteractive(oldRow({ innerTabIndex: -1 }))).toEqual([])
  })

  it('axe reports it as nested-interactive, through the same harness the rail uses', async () => {
    const found = await axeFindings(oldRow())
    expect(found.map((v) => v.id)).toContain('nested-interactive')
  })
})

describe('the Indicator library dialog', () => {
  const mount = (onChange = vi.fn()) => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={base(WITH_VWAP)}
      onChange={onChange} registry={engineRegistry} />)
    return onChange
  }

  it('an ON row still offers "Add another" — the case that failed is on screen', () => {
    mount()
    const row = getResultRow(/Session VWAP/)
    expect(row.querySelector('button[aria-label="Add another Session VWAP"]')).toBeTruthy()
  })

  it('⛔ no row is a control that holds a control — our walk and axe agree', async () => {
    mount()
    const dialog = screen.getByRole('dialog')
    expect(resultRows(dialog).length).toBeGreaterThan(10)
    expect(nestedInteractive(dialog)).toEqual([])
    const found = await axeFindings(dialog)
    expect(found, formatViolations(found)).toEqual([])
  })

  it('the title button is the keyboard door: Enter and Space each toggle once', async () => {
    const user = userEvent.setup()
    const onChange = mount()
    const atr = primaryOf(getResultRow(/Average True Range/))
    atr.focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(lastCall(onChange).indicatorInstances.some((i) => i.defId === 'atr' && !i.deleted)).toBe(true)
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('the on-state is still announced — aria-pressed on the title button', () => {
    mount()
    expect(primaryOf(getResultRow(/Session VWAP/)).getAttribute('aria-pressed')).toBe('true')
    expect(primaryOf(getResultRow(/Average True Range/)).getAttribute('aria-pressed')).toBe('false')
  })

  it('"Add another" does not also toggle the row it sits in', () => {
    const onChange = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add another Session VWAP' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const vwaps = lastCall(onChange).indicatorInstances.filter((i) => i.defId === 'vwap' && !i.deleted)
    expect(vwaps.length).toBe(2)
  })
})

describe('the Add surface in Chart Settings', () => {
  const mount = (onChange = vi.fn()) => {
    render(<ChartSettingsModal open settings={base(WITH_VWAP)} onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
    if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }), { target: { value: 'v' } })
    return onChange
  }
  const surface = () => screen.getByTestId('add-surface')

  it('⛔ no result is a control that holds a control — our walk and axe agree', async () => {
    mount()
    const row = getResultRow(/Session VWAP/, surface())
    expect(row.querySelector('button[aria-label="Add another Session VWAP"]'),
      'the ON row lost its second-instance button, so this case proves nothing').toBeTruthy()
    expect(nestedInteractive(surface())).toEqual([])
    const found = await axeFindings(surface())
    expect(found, formatViolations(found)).toEqual([])
  })

  it('the title button is the keyboard door: Enter adds once, through the row', async () => {
    const user = userEvent.setup()
    const onChange = mount()
    // The first offered TECHNICAL definition — a symbol row would need the network.
    const row = resultRows(surface()).find((r) => !r.dataset.resultKind
      && primaryOf(r).getAttribute('aria-disabled') !== 'true')
    expect(row, 'no addable technical result to drive').toBeTruthy()
    const defId = row.dataset.defId
    primaryOf(row).focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(lastCall(onChange).indicatorInstances.some((i) => i.defId === defId && !i.deleted),
      `Enter on ${defId} did not add it`).toBe(true)
  })

  it('an ON row is still reachable, says "Active", and its title does nothing', async () => {
    const user = userEvent.setup()
    const onChange = mount()
    const row = getResultRow(/Session VWAP/, surface())
    expect(resultIsOn(row)).toBe(true)
    expect(primaryOf(row).getAttribute('aria-disabled')).toBe('true')
    primaryOf(row).focus()
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })
})

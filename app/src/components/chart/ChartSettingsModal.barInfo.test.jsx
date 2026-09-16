// app/src/components/chart/ChartSettingsModal.barInfo.test.jsx
//
// ─── LEGEND V2 §9/§10/§11 — CHART SETTINGS → CHART LEGEND ───────────────────
//
// The section used to carry a Vertical/Horizontal layout selector. There is one
// legend now, so the useful question moved from SHAPE to CONTENT: which readings
// of the candle the bar-info strip prints.
//
// ⛔ THE POINT OF DRIVING THE REAL MODAL is the wiring the resolver's own unit
// suite cannot see — that a pill writes `header.barInfo` through the ONE writer
// and in canonical order, that the three-way visibility control is untouched, and
// that the retired selector left no dead control behind.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { BAR_INFO_FIELDS, DEFAULT_BAR_INFO_FIELDS, barInfoFieldsOf } from './barInfoFields'

const base = (over) => mergeChartSettings(JSON.stringify(over || {}))
const openHeaderTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Header' }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]
const group = () => screen.getByRole('group', { name: 'Bar info fields' })
const pill = (label) => within(group()).getByRole('button', { name: label })

describe('§10 — the field pills', () => {
  it('there is one pill per field, and no Volume pill', () => {
    // §10: "Do not include Volume in these field toggles." Volume is a plot; it
    // is managed from its own row in the study stack.
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openHeaderTab()
    const labels = within(group()).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(BAR_INFO_FIELDS.map((f) => f.label))
    expect(labels.some((l) => /vol/i.test(l))).toBe(false)
  })

  it('a chart that has never chosen shows all seven ON', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openHeaderTab()
    for (const f of BAR_INFO_FIELDS) {
      expect(pill(f.label).getAttribute('aria-pressed'), f.label).toBe('true')
    }
  })

  it('⛔ …AND SHOWING THEM ON DOES NOT WRITE THEM. Opening settings is not a choice', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('turning Date off writes the other six, in canonical order', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()
    fireEvent.click(pill('Date'))
    expect(lastCall(onChange).header.barInfo)
      .toEqual(['open', 'high', 'low', 'close', 'change', 'changePct'])
  })

  it('a stored set drives the pills, and a second toggle builds on it', () => {
    const onChange = vi.fn()
    const cs = base({ header: { barInfo: ['open', 'high', 'low', 'close', 'changePct'] } })
    render(<ChartSettingsModal open settings={cs} onChange={onChange} />)
    openHeaderTab()
    expect(pill('Date').getAttribute('aria-pressed')).toBe('false')
    expect(pill('Net Chg').getAttribute('aria-pressed')).toBe('false')
    expect(pill('Close').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(pill('Date'))                  // back on
    expect(lastCall(onChange).header.barInfo)
      .toEqual(['date', 'open', 'high', 'low', 'close', 'changePct'])
  })

  it('every field can be turned off, and that is stored as an empty set', () => {
    // The strip then prints nothing. Turning the WHOLE strip off is the
    // three-way control's job (§10) and it still has it; this is the degenerate
    // end of the field list, and it must not silently read back as "all seven".
    const onChange = vi.fn()
    let cs = base()
    const { rerender } = render(<ChartSettingsModal open settings={cs} onChange={onChange} />)
    openHeaderTab()
    for (const f of BAR_INFO_FIELDS) {
      fireEvent.click(pill(f.label))
      cs = { ...cs, ...lastCall(onChange) }
      rerender(<ChartSettingsModal open settings={cs} onChange={onChange} />)
      openHeaderTab()
    }
    expect(lastCall(onChange).header.barInfo).toEqual([])
    expect(barInfoFieldsOf(lastCall(onChange))).toEqual([])
  })

  it('the write is marked custom, like every other settings write', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()
    fireEvent.click(pill('Low'))
    expect(lastCall(onChange).preset).toBe('custom')
  })
})

describe('⚰ §9 — the retired layout selector', () => {
  it('there is no Vertical/Horizontal control anywhere in the modal', () => {
    // ⛔ DELETED RATHER THAN DISABLED. A dead layout control that still renders is
    // a control a member will click and be confused by.
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openHeaderTab()
    expect(screen.queryByText('Legend layout')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Vertical' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Horizontal' })).toBeNull()
  })

  it('an old blob carrying `legendLayout` opens normally, with all seven fields', () => {
    for (const legacy of ['vertical', 'horizontal']) {
      const { unmount } = render(
        <ChartSettingsModal open settings={base({ header: { legendLayout: legacy } })} onChange={vi.fn()} />)
      openHeaderTab()
      expect(within(group()).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true'))
        .toHaveLength(DEFAULT_BAR_INFO_FIELDS.length)
      unmount()
    }
  })
})

describe('⛔ §9 — `Always / Hold / Off` is untouched', () => {
  it('the three-way control is still there and still writes `legendMode`', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()
    fireEvent.click(screen.getByRole('tab', { name: 'Hold' }))
    expect(lastCall(onChange).header.legendMode).toBe('hold')
    expect(lastCall(onChange).header).not.toHaveProperty('showLegend', false)
  })

  it('⛔ AND `Off` STILL HIDES THE WHOLE READOUT — so it hides the field pills too', () => {
    // The fields are a property of a strip that is being drawn. Offering them for
    // a legend that is off would be a control with no subject.
    render(<ChartSettingsModal open settings={base({ header: { legendMode: 'off' } })} onChange={vi.fn()} />)
    openHeaderTab()
    expect(screen.queryByRole('group', { name: 'Bar info fields' })).toBeNull()
  })
})

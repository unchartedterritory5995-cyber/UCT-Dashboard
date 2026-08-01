// Reviewer-authored (7/7 green against d693b4a2), reviewed + extended by the
// implementer with the lock accessible-name assertion (fix round 1, F2).
// Drop at app/src/components/chart/ChartToolbar.signature.test.jsx to gate the
// premium lock + the Shape-B no-mutation write against future regression.
//
// ⚠️ NEVER use fireEvent.click to assert a disabled control is inert — it
// dispatches a raw MouseEvent straight at the node, bypassing the `disabled`
// check no real browser bypasses, and React's ChangeEventPlugin then turns it
// into onChange. The test would pass while asserting the OPPOSITE of the truth.
// Use userEvent.click and/or the native element.click().
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { CHART_DEFAULTS, mergeChartSettings } from './chartDefaults'
import { SIGNATURE_ROWS, SIGNATURE_LOCKED_TITLE } from './signatureToggles'
import { AuthContext } from '../../context/AuthContext'

function mount({ isPaid, settings, onUpdateSettings }) {
  return render(
    <AuthContext.Provider value={{ isPaid, user: null, loading: false }}>
      <ChartToolbar
        activeTool="cursor"
        setActiveTool={() => {}}
        chartSettings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </AuthContext.Provider>
  )
}

const openPanel = (user) => user.click(screen.getByTitle('Chart Settings'))
const rowFor = (label) => screen.getByText(label, { selector: 'label' })

describe('ChartToolbar — UCT Signature group', () => {
  let spy
  beforeEach(() => { spy = vi.fn() })

  it('paid: every row renders enabled with its own tooltip', async () => {
    const user = userEvent.setup()
    mount({ isPaid: true, settings: mergeChartSettings(null), onUpdateSettings: spy })
    await openPanel(user)
    for (const [, label, tip] of SIGNATURE_ROWS) {
      const row = rowFor(label)
      expect(within(row).getByRole('checkbox').disabled, label).toBe(false)
      expect(row.getAttribute('title')).toBe(tip)
    }
  })

  it('paid click writes Shape-B: a NEW signature object, nothing mutated in place', async () => {
    const user = userEvent.setup()
    const settings = mergeChartSettings(null)
    const defaultsSnapshot = JSON.stringify(CHART_DEFAULTS.signature)
    const csRef = settings.signature
    const csSnapshot = JSON.stringify(settings.signature)

    mount({ isPaid: true, settings, onUpdateSettings: spy })
    await openPanel(user)
    await user.click(within(rowFor('GEX Walls')).getByRole('checkbox'))

    expect(spy).toHaveBeenCalledTimes(1)
    const next = spy.mock.calls[0][0]
    expect(next.signature).toEqual({ darkPoolLevels: false, gexWalls: true, flowSignals: false })
    expect(next.preset).toBe('custom')
    expect(next).not.toBe(settings)
    expect(next.signature).not.toBe(csRef)
    expect(next.candles).toBe(settings.candles)          // siblings carried, not cloned away
    expect(JSON.stringify(CHART_DEFAULTS.signature)).toBe(defaultsSnapshot)
    expect(JSON.stringify(settings.signature)).toBe(csSnapshot)
  })

  it('paid click on a pre-ON toggle turns it OFF', async () => {
    const user = userEvent.setup()
    const settings = mergeChartSettings(JSON.stringify({ signature: { flowSignals: true } }))
    mount({ isPaid: true, settings, onUpdateSettings: spy })
    await openPanel(user)
    const box = within(rowFor('Flow Signals')).getByRole('checkbox')
    expect(box.checked).toBe(true)
    await user.click(box)
    expect(spy.mock.calls[0][0].signature.flowSignals).toBe(false)
  })

  it('free: rows stay VISIBLE but disabled + locked (merchandise, do not hide)', async () => {
    const user = userEvent.setup()
    mount({ isPaid: false, settings: mergeChartSettings(null), onUpdateSettings: spy })
    await openPanel(user)
    expect(screen.getByText('UCT Signature')).toBeTruthy()
    for (const [, label] of SIGNATURE_ROWS) {
      const row = rowFor(label)
      expect(within(row).getByRole('checkbox').disabled, label).toBe(true)
      expect(row.getAttribute('title')).toBe(SIGNATURE_LOCKED_TITLE)
      expect(row.querySelector('svg'), `${label} lock glyph`).toBeTruthy()
      // The lock must be ANNOUNCED, not just drawn. A UIcon without `title`
      // renders aria-hidden, and the disabled checkbox is out of tab order —
      // so without an accessible name a screen-reader user gets NO premium
      // signal at all. getByRole('img') only matches once UIcon flips off
      // aria-hidden, so this fails if the title prop is ever dropped.
      expect(within(row).getByRole('img', { name: 'Premium' }), `${label} lock a11y name`).toBeTruthy()
    }
  })

  it('free click is inert on both spec-faithful paths', async () => {
    const user = userEvent.setup()
    mount({ isPaid: false, settings: mergeChartSettings(null), onUpdateSettings: spy })
    await openPanel(user)
    const box = within(rowFor('GEX Walls')).getByRole('checkbox')
    await user.click(box)
    box.click()
    expect(spy).not.toHaveBeenCalled()
    expect(box.checked).toBe(false)
  })

  it('lapsed paid: a persisted-true toggle renders checked AND disabled', async () => {
    const user = userEvent.setup()
    const settings = mergeChartSettings(JSON.stringify({ signature: { gexWalls: true } }))
    mount({ isPaid: false, settings, onUpdateSettings: spy })
    await openPanel(user)
    const box = within(rowFor('GEX Walls')).getByRole('checkbox')
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
  })

  it('a legacy blob with no signature section does not crash the panel', async () => {
    const user = userEvent.setup()
    const settings = { ...mergeChartSettings(null) }
    delete settings.signature
    mount({ isPaid: true, settings, onUpdateSettings: spy })
    await openPanel(user)
    const box = within(rowFor('Dark Pool Levels')).getByRole('checkbox')
    expect(box.checked).toBe(false)
    await user.click(box)
    expect(spy.mock.calls[0][0].signature).toEqual({ darkPoolLevels: true })
  })
})

// THE LOAD LINE ON THE PAGES, AND THE TIME ON THIS DEVICE (deviceDrawTime.js, loadWords.js; Studio R6).
//
// The server measures a listed indicator and sends `load`; the cards word it. The share page adds
// the time a fresh run took in this browser, beside a measured class only. Nothing here decides a
// class, and no number is shown for a run that did not finish whole.
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { measureDeviceDraw, SLOW_RUN_MS, UNMEASURED_LANE_OFF } from './deviceDrawTime'
import SharedFormula from './SharedFormula'
import FormulaLibrary from './FormulaLibrary'
import IndicatorMembersTab from '../../components/chart/IndicatorMembersTab'
import { SHARED_FORMULA_ROUTE, sharedFormulaPath } from './formulaShareLink'

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete global.fetch })

const FORMULA = { meta: { name: 'Leaders pulling back' }, repaint: 'non-repainting',
  compute: { kind: 'ast', scanPlot: 'value', source: 'close > ema(close, 20)' } }
const BARS = Array.from({ length: 5000 }, (_, i) => ({ t: i, o: 1, h: 1, l: 1, c: 1, v: 1 }))

/** An engine whose runs take the given times (ms), read off a clock the test owns. */
function engine(times, { result = { lane: 'ast', outputs: [], work: 9 } } = {}) {
  let t = 0
  let run = 0
  const computeHeadless = vi.fn(() => { t += times[Math.min(run, times.length - 1)]; run += 1; return typeof result === 'function' ? result() : result })
  return {
    // `laneOn`: the engine's script-lane switch, on, as on production (off is its own test below)
    options: { load: async () => ({ computeHeadless, referenceBars: () => BARS, referenceOptions: () => ({ tf: 'D' }) }), now: () => t, laneOn: true },
    computeHeadless,
  }
}

describe('the time on this device', () => {
  it('is the faster of two runs over the reference bars', async () => {
    const e = engine([12, 3])
    expect(await measureDeviceDraw(FORMULA, e.options)).toEqual({ ms: 3, bars: 5000 })
    expect(e.computeHeadless).toHaveBeenCalledTimes(2)
    expect(e.computeHeadless.mock.calls[0][0]).toBe(FORMULA)
    expect(e.computeHeadless.mock.calls[0][1]).toBe(BARS)
    expect(e.computeHeadless.mock.calls[0][2]).toEqual({ tf: 'D' })
  })

  it('a slow first run is not repeated', async () => {
    const e = engine([SLOW_RUN_MS + 1, 1])
    expect(await measureDeviceDraw(FORMULA, e.options)).toEqual({ ms: SLOW_RUN_MS + 1, bars: 5000 })
    expect(e.computeHeadless).toHaveBeenCalledTimes(1)
  })

  it('⛔ a pasted script is never run on the page to time it', async () => {
    const e = engine([1])
    const load = vi.fn(e.options.load)
    for (const def of [{ compute: { kind: 'runtime', source: 'plot(close)' } }, { compute: { kind: 'native' } }, {}, null]) {
      expect(await measureDeviceDraw(def, { ...e.options, load })).toBeNull()
    }
    expect(load).not.toHaveBeenCalled()                       // the engine is not even loaded
    expect(e.computeHeadless).not.toHaveBeenCalled()
  })

  it('⛔ no number for a run that did not finish whole', async () => {
    const refused = engine([2], { result: { lane: 'ast', outputs: null, work: null, refusal: { code: 'x', message: 'm' } } })
    expect(await measureDeviceDraw(FORMULA, refused.options)).toBeNull()
    const threw = engine([2], { result: () => { throw new Error('engine') } })
    expect(await measureDeviceDraw(FORMULA, threw.options)).toBeNull()
    expect(await measureDeviceDraw(FORMULA, { load: async () => { throw new Error('chunk') }, now: () => 0, laneOn: true })).toBeNull()
    const noBars = { load: async () => ({ computeHeadless: () => ({ outputs: [] }), referenceBars: () => [], referenceOptions: () => ({}) }), now: () => 0, laneOn: true }
    expect(await measureDeviceDraw(FORMULA, noBars)).toBeNull()
  })
})

describe('the engine\'s script-lane switch closes this path too', () => {
  it('⛔ switched off: the engine is never loaded, and the answer says by name that nothing was measured', async () => {
    const e = engine([1])
    const load = vi.fn(e.options.load)
    expect(await measureDeviceDraw(FORMULA, { ...e.options, load, laneOn: false })).toEqual({ unmeasured: UNMEASURED_LANE_OFF })
    expect(load).not.toHaveBeenCalled()
    expect(e.computeHeadless).not.toHaveBeenCalled()
    // anything but an explicit yes is off
    for (const laneOn of [undefined, null, 0, '1', 'true']) {
      if (laneOn === undefined) continue
      expect(await measureDeviceDraw(FORMULA, { ...e.options, load, laneOn })).toEqual({ unmeasured: UNMEASURED_LANE_OFF })
    }
    expect(load).not.toHaveBeenCalled()
  })

  it('with no option given it reads the engine\'s own gate (off in this test build, as in any build without the flag)', async () => {
    const e = engine([1])
    const load = vi.fn(e.options.load)
    const { laneOn, ...rest } = e.options
    expect(laneOn).toBe(true)
    expect(await measureDeviceDraw(FORMULA, { ...rest, load })).toEqual({ unmeasured: UNMEASURED_LANE_OFF })
    expect(load).not.toHaveBeenCalled()
  })

  it('a pasted script is still answered first: not a formula, nothing to say', async () => {
    expect(await measureDeviceDraw({ compute: { kind: 'runtime', source: 'plot(close)' } }, { laneOn: false })).toBeNull()
  })
})

describe('on the share page', () => {
  const TOKEN = `sh_${'0123456789abcdef'.repeat(2)}`
  const open = (extra, deviceOptions) => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definition: FORMULA, origin_version: 3, ...extra }) }))
    render(
      <MemoryRouter initialEntries={[sharedFormulaPath(TOKEN)]}>
        <Routes><Route path={SHARED_FORMULA_ROUTE} element={<SharedFormula deviceOptions={deviceOptions} />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('the class the server measured, then the time on this device', async () => {
    const e = engine([9, 4])
    open({ load: { class: 'light', work: 37 }, headline: 'Runs fully', engine_version: 'e71' }, e.options)
    const line = await screen.findByTestId('shared-formula-load')
    expect(line.getAttribute('data-load')).toBe('light')
    expect(line.textContent).toMatch(/^Light to draw\./)
    const time = await screen.findByTestId('shared-formula-device-time')
    expect(time.textContent.trim()).toBe('Drew 5,000 bars in 4.0 ms on this device.')
    // directly under the verdict, above everything else
    expect(screen.getByTestId('shared-formula-verdict').nextElementSibling).toBe(line)
  })

  it('⛔ with the engine\'s switch off the page says this device\'s time was not measured, and makes up no number', async () => {
    const e = engine([9, 4])
    const load = vi.fn(e.options.load)
    open({ load: { class: 'light', work: 37 } }, { ...e.options, load, laneOn: false })
    const line = await screen.findByTestId('shared-formula-load')
    const time = await screen.findByTestId('shared-formula-device-time')
    expect(line.textContent).toBe('Light to draw. The time on this device was not measured.')
    expect(time.textContent).not.toMatch(/\d/)
    expect(load).not.toHaveBeenCalled()
  })

  it('⛔ "not measured yet" is said in words and nothing is timed', async () => {
    const e = engine([1])
    const load = vi.fn(e.options.load)
    open({ load: { class: null, measured: false } }, { ...e.options, load })
    const line = await screen.findByTestId('shared-formula-load')
    expect(line.textContent).toBe('How heavy it is to draw has not been measured yet.')
    await new Promise((r) => setTimeout(r, 400))
    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByTestId('shared-formula-device-time')).toBeNull()
  })

  it('⛔ a share with no load draws no line and loads no engine', async () => {
    const e = engine([1])
    const load = vi.fn(e.options.load)
    open({}, { ...e.options, load })
    await waitFor(() => expect(screen.getByTestId('shared-formula')).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.queryByTestId('shared-formula-load')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('a measured class whose run did not finish here keeps the class and shows no time', async () => {
    const refused = engine([2], { result: { lane: 'ast', outputs: null, work: null, refusal: { code: 'x', message: 'm' } } })
    open({ load: { class: 'heavy', work: 8000 } }, refused.options)
    const line = await screen.findByTestId('shared-formula-load')
    await waitFor(() => expect(refused.computeHeadless).toHaveBeenCalled())
    expect(line.textContent).toMatch(/^Heavy to draw/)
    expect(screen.queryByTestId('shared-formula-device-time')).toBeNull()
  })
})

describe('in the Members tab of the Indicators window', () => {
  it('each listed indicator says its own load, and one with none says nothing more', async () => {
    const entries = [
      { token: 'sh_one', name: 'Tight Weekly Closes', repaint: 'non-repainting', placement: 'overlay', inputs: 2, load: { class: 'light', work: 16 } },
      { token: 'sh_two', name: 'A pasted script', repaint: 'non-repainting', placement: 'pane', inputs: 0, load: { class: null, measured: false } },
      { token: 'sh_three', name: 'Listed before this', repaint: 'repaints', placement: 'pane', inputs: 0 },
    ]
    render(<IndicatorMembersTab fetchLibrary={async () => ({ ok: true, entries, next: null })} install={async () => ({ ok: false })} />)
    await waitFor(() => expect(screen.getAllByTestId('members-entry')).toHaveLength(3))
    const card = (token) => screen.getAllByTestId('members-entry').find((r) => r.dataset.token === token)
    expect(within(card('sh_one')).getByTestId('members-entry-load').textContent).toBe('Light to draw.')
    expect(within(card('sh_two')).getByTestId('members-entry-load').textContent).toBe('How heavy it is to draw has not been measured yet.')
    expect(within(card('sh_three')).queryByTestId('members-entry-load')).toBeNull()
  })
})

describe('on a library card', () => {
  const entry = (token, extra) => ({ token, name: `Entry ${token}`, repaint: 'non-repainting', inputs: 0, published_at: 1, ...extra })

  it('each card says its own load, and a card with none says nothing', async () => {
    const entries = [
      entry('sh_a', { load: { class: 'moderate', work: 3000 } }),
      entry('sh_b', { load: { class: null, measured: false } }),
      entry('sh_c', {}),
    ]
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ entries, next: null, table_version: 2 }) }))
    render(<MemoryRouter><FormulaLibrary /></MemoryRouter>)
    const a = await screen.findByTestId('library-entry-sh_a')
    expect(within(a).getByTestId('library-load-sh_a').textContent).toMatch(/^Moderate to draw/)
    expect(within(a).getByTestId('library-load-sh_a').getAttribute('data-load')).toBe('moderate')
    expect(screen.getByTestId('library-load-sh_b').textContent).toBe('How heavy it is to draw has not been measured yet.')
    expect(screen.queryByTestId('library-load-sh_c')).toBeNull()
  })
})

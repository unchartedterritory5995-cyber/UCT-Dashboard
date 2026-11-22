// INSPECT A BAR: the routine and the panel, with the engine's three doors faked.
//
// The fakes behave like the doors: `build` refuses a copy that plots a non-number, `compute` answers
// an ordered list of { key, title, values }. What is under test is everything around them: which
// copies are made, what one bad variable costs, what a row says, and that nothing runs before the
// member opens the panel.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { inspectScript, probeTitle, INSPECT_MAX_NAMES } from './barInspection'
import InspectBar, { barWhen } from './InspectBar'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const N = NaN
const SCRIPT = 'len = input.int(14)\nr = ta.rsi(close, len)\nlabelText = "hi"\nf(a) => a\nplot(r)'
const BARS = Array.from({ length: 6 }, (_, i) => ({ time: 1762732800 + i * 86400, close: 100 + i }))   // 10 Nov 2025 on
const VALUES = { len: [14, 14, 14, 14, 14, 14], r: [N, N, N, 55.25, 58, 61.5] }

function doors({ refuseWhole = false, lane = () => 'runtime' } = {}) {
  const calls = { names: 0, build: [], compute: 0 }
  const names = () => { calls.names += 1; return [
    { name: 'len', line: 1, kind: 'input' }, { name: 'r', line: 2, kind: 'series' },
    { name: 'labelText', line: 3, kind: 'simple' }, { name: 'f', line: 4, kind: 'function' },
  ] }
  const build = (src) => {
    calls.build.push(src)
    if (refuseWhole && src === SCRIPT) return { ok: false, reason: 'this script is not drawn: it reads another symbol' }
    if (/plot\(labelText,/.test(src)) return { ok: false, reason: 'plot() takes a number, and labelText is text' }
    return { ok: true, definition: { src } }
  }
  const compute = async (definition) => {
    calls.compute += 1
    const outputs = [{ key: 'plot0', title: null, values: VALUES.r }]
    for (const m of definition.src.matchAll(/plot\((\w+), title="([^"]+)"\)/g)) {
      outputs.push({ key: `p${outputs.length}`, title: m[2], values: VALUES[m[1]] })
    }
    return { lane: lane(definition.src), outputs, work: 1 }
  }
  return { names, build, compute, calls }
}

describe('the routine', () => {
  it('one variable that cannot be plotted costs that variable, not the others', async () => {
    const d = doors()
    const out = await inspectScript({ source: SCRIPT, bars: BARS, names: d.names, build: d.build, compute: d.compute })
    expect(out.ok).toBe(true)
    expect(out.probes.map((p) => p.name)).toEqual(['len', 'r'])
    expect(Object.keys(out.columns).sort()).toEqual([probeTitle('len'), probeTitle('r')])
    expect(out.failed).toEqual([{ name: 'labelText', line: 3, kind: 'simple', reason: 'plot() takes a number, and labelText is text' }])
    expect(out.skipped.map((s) => s.name)).toEqual(['f'])
    // the script itself, the copy with all three, then one copy per name
    expect(d.calls.build).toHaveLength(1 + 1 + 3)
    expect(out.lane).toBe('runtime')
    expect(out.laneDiffers).toBe(false)
  })

  it('a script the door refuses has nothing to read, and says the door\'s reason', async () => {
    const d = doors({ refuseWhole: true })
    const out = await inspectScript({ source: SCRIPT, bars: BARS, names: d.names, build: d.build, compute: d.compute })
    expect([out.ok, out.reason]).toEqual([false, 'this script is not drawn: it reads another symbol'])
    expect(d.calls.compute).toBe(0)
    expect((await inspectScript({ source: '  ', bars: BARS, names: d.names, build: d.build, compute: d.compute })).ok).toBe(false)
  })

  it('says when the copy ran differently from the script, and caps how many names it reads', async () => {
    const d = doors({ lane: (src) => (src === SCRIPT ? 'host' : 'runtime') })
    const out = await inspectScript({ source: SCRIPT, bars: BARS, names: d.names, build: d.build, compute: d.compute })
    expect([out.lane, out.laneDiffers]).toEqual(['host', true])
    const many = Array.from({ length: INSPECT_MAX_NAMES + 5 }, (_, i) => ({ name: `v${i}`, line: i + 1, kind: 'series' }))
    const big = await inspectScript({ source: 'x = 1', bars: BARS, names: () => many,
      build: (src) => ({ ok: true, definition: { src } }),
      compute: async (definition) => ({ lane: 'runtime',
        outputs: [...definition.src.matchAll(/title="([^"]+)"\)/g)].map((m, i) => ({ key: `p${i}`, title: m[1], values: [1] })) }) })
    expect([big.probes.length, big.truncated]).toEqual([INSPECT_MAX_NAMES, 5])
  })

  it('a name the plain copy gives no column for is asked once more as a constant; none again is "not a number"', async () => {
    // the engine gives no column for a plot of a value that never changes (an input, a literal)
    const asked = []
    const compute = async (definition) => {
      asked.push(definition.src)
      const outputs = []
      for (const m of definition.src.matchAll(/plot\((\w+)( \+ 0 \* close)?, title="([^"]+)"\)/g)) {
        const [, name, constant, title] = m
        if (name === 'r') outputs.push({ key: title, title, values: VALUES.r })
        if (name === 'len' && constant) outputs.push({ key: title, title, values: VALUES.len })
        // `ghost` gets no column in either form
      }
      return { lane: 'host', outputs }
    }
    const out = await inspectScript({ source: SCRIPT, bars: BARS, compute,
      names: () => [{ name: 'len', line: 1 }, { name: 'r', line: 2 }, { name: 'ghost', line: 3 }],
      build: (src) => ({ ok: true, definition: { src } }) })
    expect(out.probes.map((p) => p.name)).toEqual(['len', 'r'])
    expect(out.columns[probeTitle('len')]).toBe(VALUES.len)
    expect(out.failed).toEqual([{ name: 'ghost', line: 3, kind: 'series', reason: 'it gave no value' }])
    // the constant form is asked only for the names that needed it, one at a time
    const constantAsks = asked.filter((s) => / \+ 0 \* close, title=/.test(s))
    expect(constantAsks).toHaveLength(2)
    expect(constantAsks.every((s) => (s.match(/title="/g) || []).length === 1)).toBe(true)
    expect(constantAsks.some((s) => /plot\(r /.test(s))).toBe(false)
  })
})

describe('the panel', () => {
  const mount = (d, extra = {}) => render(
    <InspectBar source={SCRIPT} bars={BARS} tf="D" names={d.names} build={d.build} compute={d.compute} {...extra} />,
  )
  const openPanel = async () => {
    await act(async () => { fireEvent.click(screen.getByTestId('inspect-bar-toggle')) })
    await act(async () => {})
    await act(async () => {})
  }
  const row = (name) => screen.getAllByTestId('inspect-bar-row').find((r) => r.dataset.name === name)

  it('⛔ reads nothing until it is opened; then the latest bar, one row per variable', async () => {
    const d = doors()
    mount(d)
    expect(d.calls.build).toHaveLength(0)
    expect(screen.queryByTestId('inspect-bar-rows')).toBeNull()
    await openPanel()
    expect(screen.getByTestId('inspect-bar-when').textContent).toMatch(/2025 \(latest\)$/)
    expect(within(row('len')).getByTestId('inspect-bar-value').textContent).toBe('14')
    expect(within(row('r')).getByTestId('inspect-bar-value').textContent).toBe('61.5')
    expect(row('len').textContent).toContain('line 1')
    expect(row('labelText').textContent).toMatch(/not a number on each bar/)
    expect(screen.getByTestId('inspect-bar-limits').textContent)
      .toBe('Variables inside an if, a loop or a function are not listed. A yes/no value reads 1 for yes and 0 for no. Not read: f (a function).')
  })

  it('moving to another bar re-reads the columns it has; it does not run the script again', async () => {
    const d = doors()
    mount(d)
    await openPanel()
    const builds = d.calls.build.length
    const computes = d.calls.compute
    fireEvent.change(screen.getByTestId('inspect-bar-range'), { target: { value: '3' } })
    expect(within(row('r')).getByTestId('inspect-bar-value').textContent).toBe('55.25')
    await act(async () => { fireEvent.click(screen.getByTestId('inspect-bar-prev')) })
    expect(row('r').dataset.empty).toBe('starts-later')
    expect([d.calls.build.length, d.calls.compute]).toEqual([builds, computes])
    expect(screen.getByTestId('inspect-bar-when').textContent).not.toMatch(/latest/)
  })

  it('an empty variable says why when asked, and offers its line', async () => {
    const d = doors()
    const onGoToLine = vi.fn()
    mount(d, { onGoToLine })
    await openPanel()
    fireEvent.change(screen.getByTestId('inspect-bar-range'), { target: { value: '1' } })
    expect(within(row('r')).queryByTestId('inspect-bar-reason')).toBeNull()        // not until asked
    fireEvent.click(within(row('r')).getByTestId('inspect-bar-why'))
    expect(within(row('r')).getByTestId('inspect-bar-reason').textContent)
      .toMatch(/^Its first value is on .*2025, 2 bars after this one: it needs that much history first\.$/)
    fireEvent.click(within(row('r')).getByTestId('inspect-bar-line'))
    expect(onGoToLine).toHaveBeenCalledWith(2)
  })

  it('a script the door refuses shows the door\'s reason and no rows; a changed script is read again', async () => {
    const d = doors({ refuseWhole: true })
    const { rerender } = mount(d)
    await openPanel()
    expect(screen.getByTestId('inspect-bar-refused').textContent).toBe('this script is not drawn: it reads another symbol')
    expect(screen.queryByTestId('inspect-bar-rows')).toBeNull()
    const before = d.calls.build.length
    rerender(<InspectBar source={`${SCRIPT}\n`} bars={BARS} tf="D" names={d.names} build={d.build} compute={d.compute} />)
    await act(async () => {})
    await act(async () => {})
    expect(d.calls.build.length).toBeGreaterThan(before)
  })

  it('CONTROL: without the engine\'s doors there is no panel at all; with no bars it says so', async () => {
    const { container } = render(<InspectBar source={SCRIPT} bars={BARS} />)
    expect(container.firstChild).toBeNull()
    cleanup()
    const d = doors()
    render(<InspectBar source={SCRIPT} bars={[]} names={d.names} build={d.build} compute={d.compute} />)
    await openPanel()
    expect(screen.getByTestId('inspect-bar-nobars')).toBeInTheDocument()
    expect(d.calls.build).toHaveLength(0)
  })

  it('a bar\'s time is a date, with the clock time on intraday bars', () => {
    expect(barWhen({ time: 1762732800 })).toMatch(/2025/)
    expect(barWhen({ time: 1762732800 + 52200 }, true)).toMatch(/2025, \d{2}:\d{2}/)
    expect(barWhen(null)).toBe('')
  })
})

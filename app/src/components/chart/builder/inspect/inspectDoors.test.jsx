// INSPECT A BAR THROUGH THE ENGINE'S OWN DOORS (inspectDoors.js, InspectBarPanel.jsx; Studio lane R5).
//
// Nothing faked below the panel: the names come from the engine's parser, the probe copy goes
// through the door a pasted script goes through, and its values come from the engine's headless
// export over real bars. The values are checked against arithmetic done here.
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { names, build, computeFor } from './inspectDoors'
import { inspectScript, readBar } from './barInspection'
import InspectBarPanel from './InspectBarPanel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// 60 daily bars, closes 101..160: every average is exact arithmetic
const BARS = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 5 + i))
  const c = 101 + i
  return { t: d.toISOString().slice(0, 10), o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const SCRIPT = [
  '//@version=6',
  'indicator("Two averages", overlay=true)',
  'len = input.int(5, "Length")',
  'fast = ta.sma(close, len)',
  'slow = ta.sma(close, 20)',
  'spread = fast - slow',
  'f(x) => x * 2',
  'if close > open',
  '    inner = 1',
  'plot(fast, "Fast")',
  'plot(slow, "Slow")',
].join('\n')

describe('the three doors', () => {
  it('names: the script\'s own top-level names with their lines, no function, nothing from a block', () => {
    expect(names(SCRIPT)).toEqual([
      { name: 'len', line: 3 }, { name: 'fast', line: 4 }, { name: 'slow', line: 5 }, { name: 'spread', line: 6 },
    ])
  })

  it('build: the door a pasted script goes through', () => {
    const own = build(SCRIPT)
    expect(own.ok).toBe(true)
    expect(own.definition.compute.kind).toMatch(/^(ast|runtime)$/)
    expect(build('').ok).toBe(false)
  })

  it('compute: a refusal comes back as its sentence, never as empty columns', () => {
    const compute = computeFor({ tf: 'D', sym: 'TEST' })
    const out = compute(build(SCRIPT).definition, BARS)
    expect(Array.isArray(out.outputs)).toBe(true)
    expect(out.outputs.map((o) => o.title)).toEqual(['Fast', 'Slow'])
    // a document the engine refuses by name (the stamp a served row carries): its own sentence
    const own = build(SCRIPT).definition
    const why = 'This script is on the list of scripts whose values differ from TradingView.'
    const refused = compute({ ...own, meta: { ...(own.meta || {}), hostKnownDivergence: why } }, BARS)
    expect(refused.outputs).toBeNull()
    expect(refused.reason).toBe(why)
    expect(refused.refusal).toBeUndefined()                      // the sentence, not the raw record
    // a lane the export does not compute: the reason in words, no outputs
    const none = compute({ compute: { kind: 'native' }, plots: [] }, BARS)
    expect(none.outputs).toBeNull()
    expect(typeof none.reason).toBe('string')
    expect(none.reason.length).toBeGreaterThan(10)
  })
})

describe('end to end, on real bars', () => {
  it('every named variable reads the value arithmetic gives, and an early bar says why it is empty', async () => {
    const got = await inspectScript({ source: SCRIPT, bars: BARS, names, build, compute: computeFor({ tf: 'D', sym: 'TEST' }) })
    expect(got.ok).toBe(true)
    expect(got.failed).toEqual([])
    const last = BARS.length - 1
    const at = Object.fromEntries(readBar({ columns: got.columns }, got.probes, last).map((r) => [r.name, r]))
    // closes 156..160 average 158; closes 141..160 average 150.5
    expect(at.len.value).toBe(5)                                 // an input: the same on every bar, still read
    expect(at.fast.value).toBeCloseTo(158, 9)
    expect(at.slow.value).toBeCloseTo(150.5, 9)
    expect(at.spread.value).toBeCloseTo(7.5, 9)
    expect(at.fast.line).toBe(4)
    // bar 10 (the 11th): the 20-bar average has not started; the 5-bar one has
    const early = Object.fromEntries(readBar({ columns: got.columns }, got.probes, 10).map((r) => [r.name, r]))
    expect(early.fast.value).toBeCloseTo(109, 9)                 // closes 107..111
    expect(early.slow.value).toBeNull()
    expect(early.slow.empty).toEqual({ code: 'starts-later', firstAt: 19 })
    expect(early.spread.empty.code).toBe('starts-later')
  })

  it('a yes/no reads 1 or 0, a constant reads its value, and text is said not to be a number', async () => {
    const script = ['//@version=6', 'indicator("Kinds", overlay=true)', 'k = 3', 'up = close > open', 'txt = "a"', 'plot(close)'].join(String.fromCharCode(10))
    const got = await inspectScript({ source: script, bars: BARS, names, build, compute: computeFor({ tf: 'D', sym: 'TEST' }) })
    expect(got.ok).toBe(true)
    const at = Object.fromEntries(readBar({ columns: got.columns }, got.probes, BARS.length - 1).map((r) => [r.name, r.value]))
    expect(at).toEqual({ k: 3, up: 1 })                          // every bar here closes above its open
    expect(got.failed.map((f) => f.name)).toEqual(['txt'])
  })

  it('the panel: closed until opened, then one row per variable with its line; "line N" asks the host', async () => {
    const onGoToLine = vi.fn()
    render(<InspectBarPanel source={SCRIPT} bars={BARS} tf="D" sym="TEST" onGoToLine={onGoToLine} />)
    expect(screen.queryByTestId('inspect-bar-rows')).toBeNull()         // nothing read before it is opened
    fireEvent.click(screen.getByTestId('inspect-bar-toggle'))
    await waitFor(() => expect(screen.getAllByTestId('inspect-bar-row')).toHaveLength(4))
    const row = (name) => screen.getAllByTestId('inspect-bar-row').find((r) => r.dataset.name === name)
    expect(within(row('fast')).getByTestId('inspect-bar-value').textContent).toBe('158')
    expect(within(row('slow')).getByTestId('inspect-bar-value').textContent).toBe('150.5')
    expect(screen.getByTestId('inspect-bar-when').textContent).toMatch(/2026.*\(latest\)/)
    fireEvent.click(within(row('spread')).getByTestId('inspect-bar-line'))
    expect(onGoToLine).toHaveBeenCalledWith(6)
    // an earlier bar: the slow average is empty, and says why in words
    fireEvent.change(screen.getByTestId('inspect-bar-range'), { target: { value: '10' } })
    fireEvent.click(within(row('slow')).getByTestId('inspect-bar-why'))
    expect(within(row('slow')).getByTestId('inspect-bar-reason').textContent)
      .toMatch(/^Its first value is on .*2026, 9 bars after this one: it needs that much history first\.$/)
    expect(screen.getByTestId('inspect-bar-limits').textContent).toMatch(/inside an if, a loop or a function are not listed/)
  })
})

describe('the builder mounts it under the script preview (source rail; comments stripped)', () => {
  const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sheet = code(fs.readFileSync(path.resolve(__dirname, '../BuilderSheet.jsx'), 'utf8'))
  const box = code(fs.readFileSync(path.resolve(__dirname, '../PineBox.jsx'), 'utf8'))

  it('loaded on demand, only with a script and bars, on the chart the window was opened over', () => {
    expect(sheet).toMatch(/const InspectBarPanel = lazy\(\(\) => import\('\.\/inspect\/InspectBarPanel'\)\)/)
    expect(sheet).toMatch(/pineText\.trim\(\) && Array\.isArray\(bars\) && bars\.length > 0 \? \(/)
    expect(sheet).toMatch(/<InspectBarPanel source=\{pineText\} bars=\{bars\} tf=\{tf\} sym=\{sym\}/)
    // after the preview, inside the same panel
    expect(sheet.indexOf('<InspectBarPanel')).toBeGreaterThan(sheet.indexOf('<MemberPane'))
  })

  it('"line N" is the script box\'s own jump, handed out through one ref', () => {
    expect(sheet).toMatch(/lineJumpRef=\{scriptLineJump\}/)
    expect(sheet).toMatch(/onGoToLine=\{\(n\) => \{ if \(scriptLineJump\.current\) scriptLineJump\.current\(n\) \}\}/)
    expect(box).toMatch(/lineJumpRef\.current = goToLine/)
    // CONTROL: the stripper leaves code and takes comments
    expect(code('// lineJumpRef.current = goToLine\nconst a = 1')).not.toMatch(/lineJumpRef/)
  })
})

// app/src/components/chart/legend/IndicatorChip.textChip.test.jsx
//
// ─── UCT RS Phase 2a visual round, unit VA3 · the phone text chip (A5a, A8, A9) ─
//
// A readout definition's chip (UCT RS) passes three opt-in props: `name` (the
// one grammar, `UCT RS · SPY`), `textChip` (stay text on the phone, with a 6 px
// dot) and `fallbackValue` (the last known value, muted, with its date). Every
// other chip passes none and renders byte for byte what it did — the RSI/MACD
// control below. Decision C4 (2026-11-07): the legend passes `textChip` alone for
// every chip drawn outside the price pane; decision B8 put the text chips on the
// dots' row.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import IndicatorChip from './IndicatorChip'
import styles from './IndicatorChip.module.css'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(path.join(HERE, 'IndicatorChip.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

afterEach(() => cleanup())

const rs = (over = {}) => ({
  defId: 'rsLine', plotKey: 'rsLine', instanceId: 'inst:rs', label: 'UCT RS(SPY)', suffix: ' · SPY',
  color: '#6ba3be', decimals: 4, value: 0.4187, hidden: false, text: 'UCT RS(SPY) 0.4187', ...over,
})
const chipOf = (container) => container.querySelector('[data-instance-id="inst:rs"]')

describe('A5a / A9 — the text chip', () => {
  it('reads `UCT RS · SPY 0.4187`, never `RS(`, and carries the text-chip class', () => {
    const { container } = render(<IndicatorChip chip={rs()} name="UCT RS · SPY" textChip onMenu={() => {}} />)
    const el = chipOf(container)
    expect(el.textContent).toBe('UCT RS · SPY 0.4187')
    expect(el.textContent).not.toMatch(/RS\(/)
    expect(el.className).toContain(styles.chipText)
    // the name splits so the STEM truncates and the benchmark tail and value do not
    expect(el.querySelector(`.${styles.chipTextHead}`).textContent).toBe('UCT RS')
    expect(el.querySelector(`.${styles.chipTextTail}`).textContent).toBe(' · SPY')
    expect(el.querySelector(`.${styles.chipVal}`).textContent).toBe('0.4187')
    expect(el.getAttribute('aria-label')).toBe('UCT RS · SPY options')
  })

  it('rated: the suffix grammar applies — `UCT RS · SPY · 94 0.4187`', () => {
    const { container } = render(<IndicatorChip chip={rs({ suffix: ' · SPY · 94' })} name="UCT RS · SPY · 94" textChip />)
    expect(chipOf(container).textContent).toBe('UCT RS · SPY · 94 0.4187')
  })

  it('hidden: the name only, in the muted ink (no line colour on the text)', () => {
    const { container } = render(<IndicatorChip chip={rs({ hidden: true, value: null, text: 'UCT RS(SPY)' })}
      name="UCT RS · SPY" textChip fallbackValue={{ text: '0.4700 · Nov 4', muted: true }} />)
    const el = chipOf(container)
    expect(el.textContent).toBe('UCT RS · SPY')
    expect(el.style.color).toBe('')
    expect(el.querySelector('[data-stale-value]'), 'no number for an undrawn line').toBeNull()
  })

  it('A8: no live value → the last known one, muted, with its date', () => {
    const { container } = render(<IndicatorChip chip={rs({ value: null, text: 'UCT RS(SPY)' })}
      name="UCT RS · SPY" textChip fallbackValue={{ text: '0.4700 · Nov 4', muted: true }} />)
    const el = chipOf(container)
    expect(el.textContent).toBe('UCT RS · SPY 0.4700 · Nov 4')
    const stale = el.querySelector('[data-stale-value]')
    expect(stale.className).toContain(styles.chipValStale)
  })

  it('the grid variant prints the short name and the stale value too', () => {
    const { container } = render(<IndicatorChip grid chip={rs({ value: null })} name="UCT RS · SPY"
      fallbackValue={{ text: '—', muted: true }} />)
    expect(container.textContent).toBe('UCT RS · SPY—')
    expect(container.querySelector('[data-stale-value]').textContent).toBe('—')
  })
})

describe('C4 — a pane chip with no readout passes `textChip` alone', () => {
  const rsi = { defId: 'rsi', plotKey: 'rsi', instanceId: 'i:rsi', label: 'RSI(14)', color: '#7b68ee', decimals: 1, value: 54.3, hidden: false, text: 'RSI(14) 54.3' }
  it('stays text under its own label, value split out, no short name and no stale value', () => {
    const { container } = render(<IndicatorChip chip={rsi} textChip onMenu={() => {}} />)
    const el = container.querySelector('[data-instance-id="i:rsi"]')
    expect(el.className).toContain(styles.chipText)
    expect(el.textContent).toBe('RSI(14) 54.3')
    expect(el.querySelector(`.${styles.chipTextHead}`), 'no ` · ` to split on').toBeNull()
    expect(el.querySelector(`.${styles.chipVal}`).textContent).toBe('54.3')
    expect(el.querySelector('[data-stale-value]')).toBeNull()
    expect(el.getAttribute('aria-label')).toBe('RSI(14) options')
  })
  it('hidden: the bare label in the muted ink, no value', () => {
    const { container } = render(<IndicatorChip chip={{ ...rsi, hidden: true, value: null, text: 'RSI(14)' }} textChip />)
    const el = container.querySelector('[data-instance-id="i:rsi"]')
    expect(el.textContent).toBe('RSI(14)')
    expect(el.style.color).toBe('')
  })
})

describe('the stylesheet — phone text chip, 168 px, 6 px dot, one row, no tap floor lost', () => {
  const phone = (() => {
    const i = CSS.indexOf('.chip.chipText')
    const at = CSS.lastIndexOf('@media (max-width: 640px)', i)
    return CSS.slice(at, CSS.indexOf('@media', i))
  })()
  const rule = (sel) => {
    const m = new RegExp(`${sel.replace(/\./g, '\\.').replace(/:/g, '\\:')}\\s*\\{([^}]*)\\}`).exec(phone)
    expect(m, sel).toBeTruthy()
    return m[1]
  }
  it('stays text at 640 px and below, 168 px max, 11 px / 600, tabular', () => {
    const r = rule('.chip.chipText')
    expect(r).toMatch(/max-width:\s*168px/)
    expect(r).toMatch(/text-indent:\s*0/)
    expect(r).toMatch(/font:\s*600 11px 'Instrument Sans'/)
    expect(r).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(r).not.toMatch(/height:\s*\d/) // the `.chip` phone rule's 44 px height and min-width stay
  })
  it('the dot is 6 px and sits in the flow beside the text', () => {
    const r = rule('.chip.chipText::before')
    expect(r).toMatch(/width:\s*6px/)
    expect(r).toMatch(/height:\s*6px/)
    expect(r).toMatch(/position:\s*static/)
  })
  it('the stem ellipsizes; the tail and the value never do', () => {
    expect(rule('.chipTextHead')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.chipTextTail')).toMatch(/flex:\s*none/)
    expect(rule('.chip.chipText .chipVal')).toMatch(/flex:\s*none/)
  })
  it('B8 — one row: the text chips follow the dots on the same line; A5a\'s forced break is gone', () => {
    // ordered after every order-0 item (the dots and the `+N` that folds them)…
    expect(rule('.chip.chipText')).toMatch(/order:\s*2/)
    // …and no zero-height full-width item forces them onto a line of their own
    expect(CSS).not.toMatch(/\.chipBreak\b/)
    expect(CSS).not.toMatch(/flex:\s*0 0 100%/)
  })
  it('B8 — on the phone chart shell a chip keeps its 44 px tap box but takes only the 18 px text line', () => {
    const at = CSS.indexOf(':global(html[data-mobile-chart-shell]) .chip')
    expect(at, 'the shell rule').toBeGreaterThan(-1)
    const mq = CSS.lastIndexOf('@media', at)
    expect(CSS.slice(mq, at)).toMatch(/^@media \(max-width: 640px\)\s*\{\s*$/)
    const body = /\{([^}]*)\}/.exec(CSS.slice(at))[1]
    expect(body).toMatch(/margin-block:\s*calc\(\(18px - var\(--tap-min\)\) \/ 2\)/)
    // the tap box itself is untouched: no height or width override in the shell rule
    expect(body).not.toMatch(/(^|[^-])(height|width)\s*:/)
    // and the base phone `.chip` rule still declares the 44 px box
    expect(CSS).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.chip\s*\{[^}]*\bheight:\s*var\(--tap-min\)/)
  })
  it('B8 — once the chips wrap, each line takes the full tap floor, so no two targets overlap (review, 2026-11-07)', () => {
    const at = CSS.indexOf(':global(html[data-mobile-chart-shell] [data-chips-wrapped]) .chip')
    expect(at, 'the wrapped rule').toBeGreaterThan(-1)
    expect(CSS.slice(CSS.lastIndexOf('@media', at), at)).toMatch(/^@media \(max-width: 640px\)/)
    expect(/\{([^}]*)\}/.exec(CSS.slice(at))[1]).toMatch(/margin-block:\s*0/)
    // it comes AFTER the overhang rule, so it wins: same block, one more attribute
    expect(at).toBeGreaterThan(CSS.indexOf(':global(html[data-mobile-chart-shell]) .chip'))
    // and StockChart is what marks a wrapped legend, measured after each render
    const src = readFileSync(path.join(HERE, '..', '..', 'StockChart.jsx'), 'utf8')
    expect(src).toMatch(/setAttribute\('data-chips-wrapped', ''\)/)
    expect(src).toMatch(/removeAttribute\('data-chips-wrapped'\)/)
  })

  it('⛔ no class in this file contains "legend" (the export-route hide)', () => {
    expect(CSS.match(/\.[A-Za-z][\w-]*/g).filter((c) => /legend/i.test(c))).toEqual([])
  })
})

describe('⛔ the control — RSI and MACD chips are byte-identical without the props', () => {
  for (const c of [
    { defId: 'rsi', plotKey: 'rsi', instanceId: 'i:rsi', label: 'RSI(14)', color: '#7b68ee', decimals: 1, value: 54.3, hidden: false, text: 'RSI(14) 54.3' },
    { defId: 'macd', plotKey: 'macd', instanceId: 'i:macd', label: 'MACD', color: '#2962ff', decimals: 2, value: 1.23, hidden: false, text: 'MACD 1.23' },
  ]) {
    it(`${c.defId}: same text, same classes, no text-chip class, no stale value`, () => {
      const { container } = render(<IndicatorChip chip={c} onMenu={() => {}} />)
      const el = container.querySelector(`[data-instance-id="${c.instanceId}"]`)
      expect(el.textContent).toBe(c.text)
      expect(el.className).not.toContain(styles.chipText)
      expect(el.querySelector('[data-stale-value]')).toBeNull()
      expect(el.innerHTML).toBe(`${c.label} <span class="${styles.chipVal}" style="color: inherit;">${c.text.slice(c.label.length + 1)}</span>`)
    })
  }
})

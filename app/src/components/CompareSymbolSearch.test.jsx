// THE "+ Compare" door: one visible label, one accessible name, one component.
// The bare `<SymbolSearch displayLabel="+ Compare">` was named "QQQ -- click to search a
// different ticker" at seven call sites: the wrong action, without the visible word
// (WCAG 2.5.3). The fix is only real while NO site renders the bare form again.
import { render, screen } from '@testing-library/react'
import { test, expect, vi, beforeEach, describe } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import CompareSymbolSearch, { COMPARE_LABEL, compareAriaLabel } from './CompareSymbolSearch'

const SRC = join(process.cwd(), 'src')
const WRAPPER = 'components/CompareSymbolSearch.jsx'

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ symbols: [] }) }))
})

/** Every `<SymbolSearch ...>` opening tag in `src`, brace-aware (`=>` inside a prop is not the end). */
function symbolSearchTags(src) {
  const out = []
  const re = /<SymbolSearch\b/g
  let m
  while ((m = re.exec(src))) {
    let depth = 0
    let i = m.index + m[0].length
    for (; i < src.length; i += 1) {
      const c = src[i]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    out.push(src.slice(m.index, i + 1))
  }
  return out
}

/** A compare door rendered WITHOUT the wrapper: a SymbolSearch whose label is the compare label. */
function rawCompareDoors(src) {
  return symbolSearchTags(src).filter((t) => /displayLabel=\{?\s*['"`]\+ Compare['"`]|displayLabel=\{\s*COMPARE_LABEL\s*\}/.test(t))
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, acc) }
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\.|\.spec\./.test(name)) acc.push(p)
  }
  return acc
}
// Comments are prose, not doors (the wrapper's own header quotes the bare form).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const FILES = walk(SRC).map((p) => [relative(SRC, p).replace(/\\/g, '/'), stripComments(readFileSync(p, 'utf8'))])

describe('CompareSymbolSearch', () => {
  test('names the compare action and shows the visible label', () => {
    render(<CompareSymbolSearch sym="AAPL" onSymbolChange={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Compare AAPL with another ticker' })
    expect(btn).toHaveTextContent(COMPARE_LABEL)
    // label in name: the visible word is in the name
    expect(btn.getAttribute('aria-label')).toContain('Compare')
  })

  test('the name never reads "null" or "undefined" for a missing symbol', () => {
    expect(compareAriaLabel(null)).toBe('Compare with another ticker')
    expect(compareAriaLabel(undefined)).toBe('Compare with another ticker')
    expect(compareAriaLabel(' ')).toBe('Compare with another ticker')
    expect(compareAriaLabel('brk-b')).toBe('Compare brk-b with another ticker')
  })

  test('no file renders a bare "+ Compare" SymbolSearch -- every compare door is this component', () => {
    const offenders = FILES.filter(([rel, src]) => rel !== WRAPPER && rawCompareDoors(src).length)
      .map(([rel]) => rel)
    expect(offenders).toEqual([])
  })

  test('NON-VACUITY: the seven known compare doors all render the wrapper', () => {
    const users = FILES.filter(([, src]) => /import CompareSymbolSearch from '[^']*CompareSymbolSearch'/.test(src)
      && /<CompareSymbolSearch\b/.test(src)).map(([rel]) => rel).sort()
    expect(users).toEqual([
      'components/TickerActions.jsx',
      'components/TickerPopup.jsx',
      'components/mobile/TickerHubSheet.jsx',
      'pages/journal-2-0/components/TradeDrawer.jsx',
      'pages/journal-2-0/components/position/PositionDetailPage.jsx',
      'pages/journal-2-0/components/trade/TradeDetailPage.jsx',
      'pages/research/ResearchHeader.jsx',
    ])
    // and the scan actually saw SymbolSearch tags (the wrapper's own, at least)
    expect(symbolSearchTags(FILES.find(([rel]) => rel === WRAPPER)[1])).toHaveLength(1)
  })

  test('CONTROL: the scanner catches a bare door, whatever its props contain', () => {
    expect(rawCompareDoors('<SymbolSearch sym={s} displayLabel="+ Compare" onSymbolChange={(x) => go(x)} />')).toHaveLength(1)
    expect(rawCompareDoors("<SymbolSearch onSymbolChange={(x) => go(x)} displayLabel={'+ Compare'} sym={s} />")).toHaveLength(1)
    expect(rawCompareDoors('<SymbolSearch sym={s} displayLabel={COMPARE_LABEL} />')).toHaveLength(1)
    // a symbol search that is NOT a compare door is fine
    expect(rawCompareDoors('<SymbolSearch sym={s} onSymbolChange={(x) => go(x)} />')).toHaveLength(0)
    expect(rawCompareDoors('<SymbolSearch sym={s} displayLabel={headerLabel} />')).toHaveLength(0)
  })
})

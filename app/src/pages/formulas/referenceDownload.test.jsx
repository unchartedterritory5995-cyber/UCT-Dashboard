// The reference as one file for a member's own assistant.
//
// The file must say exactly what the page says (same objects, same sentence helper),
// be the same bytes for the same data, and every formula it tells an assistant to
// write must be one this engine accepts.

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, afterEach, vi } from 'vitest'

import { buildVocabulary } from '../../components/chart/engine/ast/vocabulary'
import { parseFormula } from '../../components/chart/engine/ast/parse'
import { withoutGuardIds } from '../../components/chart/engine/ast/guardIdText'
import { referenceSentence } from './referenceSentence'
import { pineForDownload } from './referencePineData'
import { buildReferenceText, saveTextFile, reachFor, HOW_TO_USE, REFERENCE_FILE_NAME } from './referenceDownload'
import { memberExcluded } from './memberReason'
import FormulaReference from './FormulaReference'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Does the shipped parser accept this formula? (It answers `{ok}`; a throw is a no.) */
const accepts = (src) => { try { return parseFormula(src).ok === true } catch { return false } }
// jsdom has no object URLs; the page test replaces these two, so they must exist to be replaced.
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:none'
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {}

const vocab = buildVocabulary()
const full = () => buildReferenceText(vocab, { plain: withoutGuardIds, ...pineForDownload() })

describe('the text', () => {
  it('carries every name on the page, once, with the page\'s own sentence', () => {
    const text = full()
    for (const g of vocab.groups) {
      expect(text).toContain(`## ${g.title} (${g.items.length})`)
      for (const it of g.items) {
        const line = `- \`${it.signature}\`: ${withoutGuardIds(referenceSentence(it)).replace(/\s+/g, ' ').trim()}`
        expect(text.split('\n').filter((l) => l === line), line).toHaveLength(1)
      }
    }
    const names = vocab.groups.reduce((n, g) => n + g.items.length, 0)
    // the roster as a member reads it: unreleased and internal entries are not in the file
    const shown = memberExcluded(vocab.excluded)
    expect(shown.length).toBeLessThan(vocab.excluded.length)
    expect(text).toContain(`${names} names can be written. ${shown.length} are deliberately not available.`)
  })

  it('a function\'s reach is under it, in the engine\'s words; a bar field has none', () => {
    const fn = vocab.groups.find((g) => g.id === 'functions').items.find((it) => reachFor(it))
    expect(fn).toBeTruthy()
    const lines = full().split('\n')
    const at = lines.findIndex((l) => l.startsWith(`- \`${fn.signature}\`: `))
    expect(lines[at + 1]).toBe(`  - ${reachFor(fn).replace(/\s+/g, ' ').trim()}`)
    expect(reachFor({ name: 'close', kind: 'series' })).toBeNull()
  })

  it('no sentence is left with a raw placeholder or a guard id', () => {
    const text = full()
    expect(text).not.toMatch(/\{\d+\}/)
    expect(text).not.toMatch(/\bpine:[a-z-]+/)
  })

  it('lists what is deliberately absent with its reason, and every "Write ..." is a formula the engine parses', () => {
    const text = full()
    const shown = memberExcluded(vocab.excluded)
    expect(shown.length).toBeGreaterThan(0)
    for (const e of shown) expect(text).toContain(`- \`${e.name}\`: ${e.says}`)
    // and an entry that is left out of the member's roster is not in the file at all
    const leftOut = vocab.excluded.filter((e) => !shown.some((s) => s.name === e.name))
    expect(leftOut.length).toBeGreaterThan(0)
    const absent = text.slice(text.indexOf('## Deliberately not available')).split('\n## ')[0]
    for (const e of leftOut) expect(absent).not.toContain(`- \`${e.name}\`: `)
    const instead = shown.filter((e) => e.instead)
    expect(instead.length).toBeGreaterThan(0)                 // control: there is something to check
    for (const e of instead) {
      expect(text).toContain(`  - Write \`${e.instead}\``)
      expect(accepts(e.instead), e.instead).toBe(true)
    }
  })

  it('says whether each TradingView name runs, from the same data as the page\'s section', () => {
    const { pine } = pineForDownload()
    const text = full()
    expect(text).toContain(`## TradingView names (${pine.runs} of ${pine.total} run)`)
    expect(text).toMatch(/- `ta\.rsi`: Runs as `/)
    expect(text).toMatch(/- `request\.security`: Not yet/)
    const rows = text.split('\n').filter((l) => /^- `[a-z_.0-9A-Z]+`: (Runs|Not yet|Not checked)/.test(l))
    expect(rows).toHaveLength(pine.total)
  })

  it('without the TradingView names it is still the whole formula vocabulary', () => {
    const text = buildReferenceText(vocab, { plain: withoutGuardIds })
    expect(text).not.toContain('## TradingView names')
    expect(text).toContain('## Deliberately not available')
    expect(text.startsWith('# UCT formula reference\n')).toBe(true)
  })

  it('is the same bytes for the same data', () => {
    expect(full()).toBe(full())
    expect(full().endsWith('\n')).toBe(true)
    expect(full()).not.toMatch(/\n{3,}/)
  })

  it('the example formula in the instructions is one the engine parses', () => {
    const m = HOW_TO_USE.join(' ').match(/for example `([^`]+)`/)
    expect(m).not.toBeNull()
    expect(accepts(m[1])).toBe(true)
    // control: the same check refuses text that is not a formula
    expect(accepts('sma(close,')).toBe(false)
  })
})

describe('saving it', () => {
  const env = () => {
    const made = []
    const clicks = []
    const doc = { body: { appendChild: (a) => made.push(a) },
      createElement: () => ({ click() { clicks.push(this.download) }, remove() {} }) }
    const urls = []
    return { made, clicks, urls, env: { document: doc, Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type } },
      URL: { createObjectURL: (b) => { urls.push(b); return 'blob:x' }, revokeObjectURL: () => {} }, setTimeout: (f) => f() } }
  }
  it('offers a Markdown file under the stated name', () => {
    const e = env()
    expect(saveTextFile('hello', REFERENCE_FILE_NAME, e.env)).toBe(true)
    expect(e.clicks).toEqual(['uct-formula-reference.md'])
    expect(e.urls[0].parts).toEqual(['hello'])
    expect(e.urls[0].type).toMatch(/^text\/markdown/)
  })
  it('says no where the browser cannot make a file', () => {
    expect(saveTextFile('x', 'a.md', {})).toBe(false)
    expect(saveTextFile('x', 'a.md', { document: {}, URL: {}, Blob: class {} })).toBe(false)
  })
})

describe('on the page', () => {
  it('one press builds the file from the page\'s own data and says where it went', async () => {
    const blobs = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blobs.push(b); return 'blob:test' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<MemoryRouter><FormulaReference /></MemoryRouter>)
    expect(screen.getByTestId('reference-download-note').textContent).toMatch(/One file with every name on this page/)
    fireEvent.click(screen.getByTestId('reference-download'))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1), { timeout: 45000 })
    expect(screen.getByTestId('reference-download-note').textContent).toMatch(/Saved as uct-formula-reference\.md/)
    expect(blobs).toHaveLength(1)
    expect(blobs[0].size).toBe(new Blob([full()]).size)        // the same text the builder gives
    // the page's own TradingView section is still closed: the download did not open it
    expect(screen.queryByTestId('pine-names')).toBeNull()
  }, 60000)

  it('a browser that cannot save says so instead of appearing to do nothing', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('no') })
    render(<MemoryRouter><FormulaReference /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('reference-download'))
    await waitFor(() => expect(screen.getByTestId('reference-download-note').textContent).toMatch(/would not save the file/), { timeout: 45000 })
  }, 60000)
})

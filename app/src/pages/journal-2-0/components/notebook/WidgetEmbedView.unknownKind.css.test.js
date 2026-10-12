// P1.7(b): jsdom computes no layout, so the unknown-kind card's two layout promises are pinned
// at the stylesheet: the Reload button keeps its 44px touch floor at <=1024px (phone AND
// tablet; tapFloor.test.js only checks "390 implies 820", so deleting the block outright
// would pass it), and the card stacks the button under the sentence instead of sharing the
// row. Declaration-level checks: necessary, not sufficient (tools/mobile_audit.py is the
// ground truth for rendered boxes).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** The text of every `@media <query> { ... }` block (one nesting level), keyed by query. */
function mediaBlocks(src) {
  const out = []
  const re = /@media\s*([^{]+)\{/g
  let m
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push({ query: m[1].trim().replace(/\s+/g, ' '), body: src.slice(re.lastIndex, i - 1) })
  }
  return out
}
const rule = (src, selector) => {
  const sel = selector.replace('.', '[.]')
  const m = new RegExp(sel + '[ \t\r\n]*[{]([^}]*)[}]').exec(src)
  return m ? m[1] : null
}

describe('the unknown-kind card stylesheet', () => {
  it('the Reload button holds the 44px floor inside the 1024px touch block', () => {
    const touch = mediaBlocks(css).filter((b) => b.query === '(max-width: 1024px)')
    expect(touch.length).toBeGreaterThan(0) // non-vacuity: the block exists to be searched
    const body = touch.map((b) => rule(b.body, '.placeholderReload')).find(Boolean)
    expect(body).toBeTruthy()
    expect(body).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(body).toMatch(/min-width:\s*var\(--tap-min\)/)
  })

  it('uses only the two canonical breakpoints for the Reload rules', () => {
    const queries = mediaBlocks(css).filter((b) => b.body.includes('.placeholderReload')).map((b) => b.query)
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) expect(['(max-width: 640px)', '(max-width: 1024px)']).toContain(q)
  })

  it('the unknown card stacks its button under the sentence; other placeholders stay a row', () => {
    const unknown = rule(css, '.placeholderUnknown')
    expect(unknown).toBeTruthy()
    expect(unknown).toMatch(/flex-direction:\s*column/)
    const base = rule(css, '.placeholder')
    expect(base).toBeTruthy()
    expect(base).not.toMatch(/flex-direction/) // the shared rule is untouched
  })
})

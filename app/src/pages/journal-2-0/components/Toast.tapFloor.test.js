// W11-R81 PD-3 (the 50-user campaign, P28/P29 at 820 and 390): the Journal Toast's "Dismiss" measured 23x22 px on the
// touch tier. Inside the <=1024px query (styles/breakpoints.css) it is at least --tap-min in both directions, its
// glyph centred; desktop is unchanged (CONTROL: no floor at rest).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/Toast.module.css'), 'utf8')
  .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(body)
  return m ? m[1].trim() : null
}
/** [{selectors, body, media}] in source order, one level of @media. */
function rules(css) {
  const out = []
  const walk = (src, media = null) => {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open < 0) break
      const head = src.slice(i, open).trim()
      let depth = 0
      let j = open
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++
        else if (src[j] === '}' && --depth === 0) break
      }
      const body = src.slice(open + 1, j)
      if (head.startsWith('@media')) walk(body, head)
      else if (!head.startsWith('@')) out.push({ selectors: head.split(',').map((s) => s.trim()), body, media })
      i = j + 1
    }
  }
  walk(css)
  return out
}

describe('the Toast Dismiss is a whole finger target on the touch tier (W11-R81 PD-3)', () => {
  const touch = rules(CSS).filter((r) => r.media && /max-width:\s*1024px/.test(r.media) && r.selectors.includes('.dismiss'))
  it('min-width and min-height are var(--tap-min) inside the <=1024px query, the glyph centred', () => {
    expect(touch.length).toBeGreaterThan(0)
    expect(touch.map((r) => decl(r.body, 'min-width')).filter(Boolean)).toContain('var(--tap-min)')
    expect(touch.map((r) => decl(r.body, 'min-height')).filter(Boolean)).toContain('var(--tap-min)')
    expect(touch.map((r) => decl(r.body, 'justify-content')).filter(Boolean)).toContain('center')
  })
  it('CONTROL: at rest the Dismiss declares no floor', () => {
    const rest = rules(CSS).filter((r) => !r.media && r.selectors.includes('.dismiss'))
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.map((r) => decl(r.body, 'min-width') || decl(r.body, 'min-height')).filter(Boolean)).toEqual([])
  })
})

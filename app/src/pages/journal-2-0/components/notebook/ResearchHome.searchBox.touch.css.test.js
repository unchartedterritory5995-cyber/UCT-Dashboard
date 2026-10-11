// P0.13 final fix (I2): the Home search box is a real <input> now, so on iOS a font-size under
// 16px makes Safari zoom the page on focus. The sidebar's own box is already 16px on touch
// (FolderSidebar.module.css); the Home box must match it at the touch tier (<= 1024px).
// jsdom lays nothing out, so this reads the DECLARATIONS.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'ResearchHome.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// The body of every `@media (max-width: 1024px) { ... }` block, found by brace depth.
function touchBlocks(source) {
  const out = []
  const re = /@media\s*\(max-width:\s*1024px\)\s*\{/g
  let m
  while ((m = re.exec(source))) {
    let depth = 1
    let i = re.lastIndex
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') depth -= 1
      i += 1
    }
    out.push(source.slice(re.lastIndex, i - 1))
  }
  return out
}
const ruleBody = (block, selector) => {
  const esc = selector.split('.').join(String.raw`\.`)
  const m = block.match(new RegExp(String.raw`(?:^|\})\s*` + esc + String.raw`\s*\{([^}]*)\}`))
  return m ? m[1] : null
}

describe('Home search box on touch (iOS focus zoom)', () => {
  it('the desktop rule keeps its 13.5px type (the control being corrected exists)', () => {
    const base = css.match(/(?:^|\})\s*\.searchBox\s*\{([^}]*)\}/)
    expect(base, '.searchBox base rule').toBeTruthy()
    expect(base[1]).toMatch(/font-size:\s*13\.5px/)
  })

  it('is 16px inside the 1024px touch block', () => {
    const bodies = touchBlocks(css).map((b) => ruleBody(b, '.searchBox')).filter(Boolean)
    expect(bodies.length, 'a .searchBox rule in a (max-width: 1024px) block').toBeGreaterThan(0)
    expect(bodies.some((b) => /font-size:\s*16px/.test(b))).toBe(true)
  })

  it('never uses a non-canonical breakpoint literal for it', () => {
    const lits = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => m[1])
    for (const l of lits) expect(['640', '1024']).toContain(l)
  })
})

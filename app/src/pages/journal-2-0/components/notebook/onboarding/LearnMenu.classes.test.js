// M1 (final review): LearnMenu.jsx put `styles.catalogItem` on the catalog row and the module never
// defined it, so the row rendered the literal class "undefined" and lost the divider every other
// section row has. vitest does not process CSS modules (they come back as a proxy that answers every
// name), so a render cannot see an undefined class: this reads the SOURCE and the CSS instead.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const jsx = readFileSync(join(__dirname, 'LearnMenu.jsx'), 'utf8')
const css = readFileSync(join(__dirname, 'LearnMenu.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('LearnMenu.module.css defines every class LearnMenu.jsx uses', () => {
  const used = [...new Set([...jsx.matchAll(/styles\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))]
  const defined = new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]))

  it('non-vacuity: the component uses classes and the stylesheet defines some', () => {
    expect(used.length).toBeGreaterThan(5)
    expect(defined.size).toBeGreaterThan(5)
    expect(used).toContain('catalogItem')
  })

  it('no styles.X is undefined in the module (it would render the class "undefined")', () => {
    const missing = used.filter((name) => !defined.has(name))
    expect(missing, `classes used but not defined: ${missing.join(', ')}`).toEqual([])
  })

  it('the catalog row has the divider the other section rows have (a top border of its own)', () => {
    const body = css.match(/(?:^|\})\s*\.catalogItem\s*\{([^}]*)\}/)
    expect(body, '.catalogItem rule').toBeTruthy()
    expect(body[1]).toMatch(/border-top:\s*1px solid var\(--border\)/)
  })
})

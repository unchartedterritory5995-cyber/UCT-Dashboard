// Final polish (the live scorecard after Tiers 3b and 4, master ae5c1e9d15): the phone Journal page measured CLS 0.1036,
// one shift at ~1.08 s. Attributed on production at 390x844 (scratchpad ux/visual/hdrprobe.py): the account pill read
// "All Accounts" (132 px) until the account read landed and named the account ("Default", 99 px). The Journal header's
// row wraps, so a narrower pill pulled "Generate report" up a row, Settings and More moved, and the Today cards dropped
// with the header. On a phone the pill now has ONE width whatever it says. jsdom lays nothing out, so this reads the
// stylesheet; the walk that measured it is the probe above.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/accounts/AccountSelector.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** The bodies of every rule for `sel` inside `@media (max-width: 640px)` blocks. */
function phoneRule(sel) {
  const out = []
  const re = /@media \(max-width: 640px\)\s*\{/g
  let m
  while ((m = re.exec(CSS))) {
    let depth = 1
    let i = re.lastIndex
    for (; i < CSS.length && depth; i++) {
      if (CSS[i] === '{') depth++
      else if (CSS[i] === '}') depth--
    }
    const block = CSS.slice(re.lastIndex, i - 1)
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const r of block.matchAll(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g'))) out.push(r[1])
  }
  return out.join(';')
}
const decl = (b, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(b || '')
  return m ? m[1].trim() : null
}

describe('the account pill holds one width on a phone', () => {
  it('the wrap is a fixed width (the "All Accounts" width it first paints at), and the pill fills it', () => {
    expect(decl(phoneRule('.wrap'), 'width')).toBe('132px')
    expect(decl(phoneRule('.pill'), 'width')).toBe('100%')
  })

  it('a longer account name ends in an ellipsis instead of growing the pill', () => {
    const name = phoneRule('.pill .name')
    expect(decl(name, 'overflow')).toBe('hidden')
    expect(decl(name, 'text-overflow')).toBe('ellipsis')
    expect(decl(name, 'white-space')).toBe('nowrap')
  })
})

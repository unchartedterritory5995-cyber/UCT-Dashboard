// F2 (ruling R58, UX I-13): at phone width (<= 640px) the snapshot frame's header is compact and a table never
// scrolls sideways. jsdom computes no layout, so this reads the DECLARATIONS in the phone block of the module;
// tools/mobile_audit.py at 390 px is the ground truth. Passing here is necessary, not sufficient.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/widgets/SnapshotFrame.module.css'), 'utf8')
  .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the module's `@media (max-width: 640px)` block, or '' when there is none. */
function phoneBlock(css) {
  const at = css.indexOf('@media (max-width: 640px) {')
  if (at < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(css.indexOf('{', at) + 1, i) }
  }
  return ''
}
/** The declarations of the first rule in `block` whose selector list names `selector` exactly. */
function rule(block, selector) {
  for (const m of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim()).includes(selector)) return m[2]
  }
  return ''
}

describe('SnapshotFrame at phone width', () => {
  const phone = phoneBlock(CSS)

  it('the phone block exists (non-vacuity)', () => {
    expect(phone).toContain('.stats')
  })

  it('a table wraps its cells instead of scrolling sideways', () => {
    expect(rule(phone, '.tableWrap')).toMatch(/overflow-x:\s*visible/)
    expect(rule(phone, '.table td')).toMatch(/white-space:\s*normal/)
    expect(rule(phone, '.table td')).toMatch(/overflow-wrap:\s*break-word/)
    expect(rule(phone, '.table td')).toMatch(/word-break:\s*normal/)
    expect(rule(phone, '.table td')).not.toMatch(/anywhere|break-all/)       // review m-6: a figure stays whole
    expect(rule(phone, '.table')).toMatch(/table-layout:\s*fixed/)
  })

  it('the header is compact: tighter gaps and no spacer row', () => {
    expect(rule(phone, '.head')).toMatch(/gap:\s*4px 6px/)
    expect(rule(phone, '.spacer')).toMatch(/display:\s*none/)
  })

  it('control: at every width outside the phone block the table may still scroll (desktop keeps its columns)', () => {
    const outside = CSS.replace(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/, '')
    expect(rule(outside, '.tableWrap')).toMatch(/overflow-x:\s*auto/)
  })
})

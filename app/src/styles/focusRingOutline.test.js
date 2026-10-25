// app/src/styles/focusRingOutline.test.js
//
// `--focus-ring` is a BOX-SHADOW value (tokens.css: `0 0 0 2px ...`). Used inside `outline`, the declaration is
// invalid, the browser drops it, and the element's outline computes to `none` — and because the rule still matches,
// it also out-ranks the global :focus-visible ring. The keyboard ring simply disappears, with no error anywhere.
// Found in the widget builder and in My tools (Task 8.15 fix 3, I-3; the 8.17 review). jsdom computes no styles, so
// this reads every Notebook *.module.css and fails any `outline` declaration that names `var(--focus-ring`.
// Use `outline: 2px solid var(--ut-gold)` or `box-shadow: var(--focus-ring)`.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const NOTEBOOK = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')

// ⛔ PENDING, not exempt: My tools has the same defect and the Task 8.17 agent is fixing it in parallel. The
// CONTROLLER removes this entry once 8.17 lands; nothing else may be added here.
export const PENDING = Object.freeze(['myTools/myTools.module.css'])

function cssFiles(dir = NOTEBOOK, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) cssFiles(p, out)
    else if (name.endsWith('.module.css')) out.push(p)
  }
  return out
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))

/** Lines of `outline` / `outline-*` declarations whose value names `var(--focus-ring`. */
export function outlineFocusRing(css) {
  const text = stripComments(css)
  const out = []
  const re = /(^|[;{\s])outline(?:-[a-z]+)?\s*:\s*([^;}]*)/g
  let m
  while ((m = re.exec(text))) {
    if (/var\(\s*--focus-ring\b/.test(m[2])) out.push(text.slice(0, m.index).split('\n').length)
  }
  return out
}

describe('no outline uses the --focus-ring box-shadow value', () => {
  it('every Notebook module stylesheet (non-vacuity: the walk found them)', () => {
    const files = cssFiles()
    expect(files.length).toBeGreaterThan(20)
    const bad = []
    for (const f of files) {
      const rel = relative(NOTEBOOK, f).replace(/\\/g, '/')
      if (PENDING.includes(rel)) continue
      for (const line of outlineFocusRing(readFileSync(f, 'utf8'))) bad.push(`${rel}:${line}`)
    }
    expect(bad).toEqual([])
  })

  it('the pending list holds only My tools files, and each still exists', () => {
    for (const rel of PENDING) {
      expect(rel.startsWith('myTools/')).toBe(true)
      expect(statSync(join(NOTEBOOK, rel)).isFile()).toBe(true)
    }
  })

  it('CONTROL: a planted outline with var(--focus-ring) is SEEN; a box-shadow or a gold outline is not', () => {
    expect(outlineFocusRing('.a:focus-visible {\n  outline: 2px solid var(--focus-ring, var(--ut-gold));\n}')).toEqual([2])
    expect(outlineFocusRing('.a:focus-visible { outline: var(--focus-ring); }')).toEqual([1])
    expect(outlineFocusRing('.a:focus-visible { box-shadow: var(--focus-ring); outline: 2px solid var(--ut-gold); }')).toEqual([])
    expect(outlineFocusRing('/* outline: var(--focus-ring) */ .a { color: red }')).toEqual([])
  })
})

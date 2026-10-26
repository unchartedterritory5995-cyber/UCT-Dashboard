// Wave 8 (Task 8.15 fix 2, C-N1): a `//` comment written between JSX tags is not a comment; it is TEXT, and it
// renders. One shipped in every row of the measure picker ("// ⛔ aria-disabled, never `disabled`: ..."). This
// parses every .jsx under components/notebook (acorn + acorn-jsx, a real JSX parse, never a grep) and fails for any
// JSX text child that starts with `//` or `/*`, or carries the ⛔ marker this codebase uses only in comments.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')
const JSXParser = Parser.extend(jsx())

function files(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, out)
    else if (name.endsWith('.jsx')) out.push(p)
  }
  return out
}

/** JSX text children that read like a comment. */
export function commentLikeText(src) {
  const ast = JSXParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const found = []
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'JSXText') {
      const t = node.value.trim()
      if (t.startsWith('//') || t.startsWith('/*') || t.includes('⛔')) {
        const lead = node.value.slice(0, node.value.length - node.value.trimStart().length)
        found.push({ line: node.loc.start.line + lead.split('\n').length - 1, text: t.slice(0, 60) })
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const v = node[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast)
  return found
}

describe('no comment is rendered as JSX text', () => {
  it('every .jsx under components/notebook parses, and none has comment-like JSX text', () => {
    const all = files()
    expect(all.length).toBeGreaterThan(50)                          // non-vacuity: the walk found the files
    const bad = []
    for (const f of all) {
      for (const hit of commentLikeText(readFileSync(f, 'utf8'))) bad.push(`${relative(ROOT, f)}:${hit.line} ${hit.text}`)
    }
    expect(bad).toEqual([])
  })

  it('CONTROL: a planted `//` comment between tags, and a ⛔ note, are SEEN; a real comment is not', () => {
    const planted = 'const A = () => (\n  <li>\n    // ⛔ looks like a comment\n    <b>x</b>\n  </li>\n)\n'
    expect(commentLikeText(planted)).toEqual([{ line: 3, text: '// ⛔ looks like a comment' }])
    const fine = 'const A = () => (\n  <li>\n    {/* a real comment */}\n    <a href="https://example.com">https://example.com</a>\n  </li>\n)\n'
    expect(commentLikeText(fine)).toEqual([])
  })
})

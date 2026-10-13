// O8: ONE map for the regime's display word. `regimeWords.js` is the only file under app/src that may
// declare a table from a regime id to a word; every surface reads it through regimeWord(). This
// sweep is what turns a future hand-typed table ({ amber: 'Amber' }, { amber: { label: 'Amber' } },
// { id: 'amber', label: 'Amber' }) red. It reads CODE, never prose (comments are stripped first), and
// it proves it can fail: a table inside a comment is not a match, a planted real table is.
// A colour NAMED amber is a colour, not a regime word; those never carry a word value in a table
// keyed `amber`, except the one account-colour palette allowlisted below with its reason.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const THE_MAP = 'pages/journal-2-0/lib/blocks/regimeWords.js'
// file -> why it is not a regime table. An entry that stops matching fails (a stale allowlist hides nothing).
const NOT_A_REGIME_TABLE = {
  'pages/journal-2-0/lib/accountColors.js': 'the account colour palette: amber is a swatch name for an account, not a market regime',
}

/** Block comments, then line comments that start a line or follow whitespace (a `//` glued to a
 *  non-space character is a URL inside a string and is kept). Code, never prose. */
export const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/g, '$1')

// A table keyed (or listed) by the id `amber` that carries a WORD.
const SHAPES = [
  /\bamber['"]?\s*:\s*(['"`])[A-Za-z][A-Za-z ]*\1/,                           // { amber: 'Yellow' }
  /\bamber['"]?\s*:\s*\{[^{}]*\blabel\s*:\s*['"`]/,                           // { amber: { label: 'Yellow', ... } }
  /\b(?:id|key|value)\s*:\s*['"]amber['"][^{}]*\blabel\s*:\s*['"`]/,          // { id: 'amber', label: 'Yellow' }
  /\blabel\s*:\s*['"`][^'"`]*['"`][^{}]*\b(?:id|key|value)\s*:\s*['"]amber['"]/, // { label: 'Yellow', id: 'amber' }
]
export const declaresRegimeWordTable = (src) => {
  const code = stripComments(src)
  return SHAPES.some((re) => re.test(code))
}

function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__fixtures__' || e.name === '__tests__') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) sourceFiles(full, out)
    else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(full)
  }
  return out
}
const rel = (f) => relative(SRC, f).split(sep).join('/')

describe('the regime word map is ONE (O8)', () => {
  const files = sourceFiles(SRC)
  const declaring = files.filter((f) => declaresRegimeWordTable(readFileSync(f, 'utf8'))).map(rel)

  it('no file under app/src but regimeWords.js declares a regime-word table', () => {
    const stray = declaring.filter((f) => f !== THE_MAP && !Object.hasOwn(NOT_A_REGIME_TABLE, f))
    expect(stray, `hand-typed regime table(s): import regimeWord from lib/blocks/regimeWords instead`).toEqual([])
  })

  it('non-vacuity: the sweep read the tree, and it sees the one real table', () => {
    expect(files.length).toBeGreaterThan(300)
    expect(declaring).toContain(THE_MAP)
  })

  it('every allowlist entry still matches, so none is stale', () => {
    for (const f of Object.keys(NOT_A_REGIME_TABLE)) expect(declaring, f).toContain(f)
  })

  describe('controls', () => {
    it('a table inside a comment is not a match', () => {
      const commented = [
        "// const T = { green: 'Green', amber: 'Amber', orange: 'Orange', red: 'Red' }",
        "/* amber: { label: 'Amber', color: '#e0a83a' } */",
        "{/* { id: 'amber', label: 'Amber' } */}",
        "const x = 1",
      ].join('\n')
      expect(declaresRegimeWordTable(commented)).toBe(false)
    })
    it('a planted table of any shape IS a match', () => {
      const planted = [
        "const T = { green: 'Green', amber: 'Amber', orange: 'Orange', red: 'Red' }",
        "const M = { amber: { label: 'Amber', color: '#e0a83a' } }",
        "const L = [{ id: 'amber', label: 'Yellow' }]",
        "const K = [{ label: 'AMBER', key: 'amber', tint: '#fbbf24' }]",
        'const Q = { "amber": "Amber" }',
      ]
      for (const s of planted) expect(declaresRegimeWordTable(s), s).toBe(true)
    })
    it('a colour or an id that carries no word is not a match', () => {
      for (const s of ["const c = { amber: '#dcbb5e' }", "const d = { amber: styles.dotAmber }", "return 'amber'",
        "const o = ['green', 'amber', 'orange', 'red']"]) expect(declaresRegimeWordTable(s), s).toBe(false)
    })
  })
})

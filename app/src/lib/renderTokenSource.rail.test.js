// One check, on the server: no file under app/src reads the render token from the build.
//
// The /r/* pages forward `?token=` and take the server's answer (see renderToken.js). This rail
// fails if a source file reads either build variable again, in either form the flag index
// (tools/vite_flag_index.py) counts as a read:
//   - the direct form, the env object followed by the variable name, in ANY file here, tests included;
//   - the late-bound form: a shipped (non-test) file that mentions the env object and names the
//     variable anywhere in its text.
// The needles are built from parts so this file is not itself a match.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(globalThis.process.cwd(), 'src')
const ENV_OBJECT = ['import', 'meta', 'env'].join('.')
const NAME = ['VITE', 'CHART', 'RENDER', 'TOKEN'].join('_') // also the start of the ..._PREVIOUS name
const SOURCE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

const escaped = (s) => s.replace(/[.]/g, '\\.')
// `<env>.NAME`, `<env>?.NAME`, `<env>['NAME']`, `<env>?.["NAME"]`
const DIRECT_READ = new RegExp(
  `${escaped(ENV_OBJECT)}\\s*(?:\\?\\.|\\.)?\\s*(?:\\[\\s*['"\`])?${NAME}`,
)

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      sourceFiles(full, out)
    } else if (SOURCE_EXT.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

// Pure, so the cases below can hand it text that must be caught.
function readsOfTheBuildToken(files) {
  const found = []
  for (const { rel, text } of files) {
    if (DIRECT_READ.test(text)) found.push(`${rel}: direct read`)
    else if (!rel.includes('.test.') && text.includes(ENV_OBJECT) && text.includes(NAME)) {
      found.push(`${rel}: names the variable in a file that uses the env object`)
    }
  }
  return found
}

const FILES = sourceFiles(ROOT).map((full) => ({
  rel: path.relative(ROOT, full).split(path.sep).join('/'),
  text: fs.readFileSync(full, 'utf8'),
}))

describe('no file under app/src reads the render token from the build', () => {
  it('walks the real source tree', () => {
    expect(FILES.length).toBeGreaterThan(500)
    expect(FILES.some((f) => f.rel === 'lib/renderToken.js')).toBe(true)
    expect(FILES.some((f) => f.rel === 'pages/ChartRender.jsx')).toBe(true)
  })

  it('finds no read of either variable', () => {
    expect(readsOfTheBuildToken(FILES)).toEqual([])
  })

  it('catches the direct read of the current slot and of the previous slot', () => {
    const current = `const T = ${ENV_OBJECT}.${NAME} || ''`
    const previous = `const P = ${ENV_OBJECT}.${NAME}_PREVIOUS || ''`
    expect(readsOfTheBuildToken([{ rel: 'lib/a.js', text: current }])).toEqual(['lib/a.js: direct read'])
    expect(readsOfTheBuildToken([{ rel: 'lib/b.js', text: previous }])).toEqual(['lib/b.js: direct read'])
  })

  it('catches the optional-chained and the bracket forms, and a direct read inside a test file', () => {
    expect(readsOfTheBuildToken([{ rel: 'a.js', text: `${ENV_OBJECT}?.${NAME}` }])).toHaveLength(1)
    expect(readsOfTheBuildToken([{ rel: 'b.js', text: `${ENV_OBJECT}['${NAME}']` }])).toHaveLength(1)
    expect(readsOfTheBuildToken([{ rel: 'c.js', text: `${ENV_OBJECT}?.["${NAME}_PREVIOUS"]` }])).toHaveLength(1)
    expect(readsOfTheBuildToken([{ rel: 'd.test.js', text: `${ENV_OBJECT}.${NAME}` }])).toHaveLength(1)
  })

  it('catches a late-bound read: the env object taken first, the name used afterwards', () => {
    const text = `const source = env === undefined ? ${ENV_OBJECT} : env\nexport const t = source.${NAME}\n`
    expect(readsOfTheBuildToken([{ rel: 'lib/late.js', text }])).toEqual([
      'lib/late.js: names the variable in a file that uses the env object',
    ])
  })

  it('does not flag the name alone, the env object alone, or a test fixture that only names it', () => {
    expect(readsOfTheBuildToken([{ rel: 'a.js', text: `// ${NAME} is no longer read` }])).toEqual([])
    expect(readsOfTheBuildToken([{ rel: 'b.js', text: `${ENV_OBJECT}.VITE_FLOW_PARTS === '1'` }])).toEqual([])
    const fixture = `const env = { ${NAME}: 'x' }\nconst mode = ${ENV_OBJECT}.MODE\n`
    expect(readsOfTheBuildToken([{ rel: 'x.rail.test.js', text: fixture }])).toEqual([])
  })
})

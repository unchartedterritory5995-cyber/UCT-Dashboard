// app/src/pages/journal-2-0/a11y/notebookContrast.test.js
//
// A5: the Notebook's colour contrast, measured from its own stylesheets in
// dark, oled and light (wave 8, lane 8A). The pairs, the bars and the parsing
// are in contrastAudit.js; the ONE formula is styles/__tests__/contrastMath.js.
//
// A failure is FIXED inside Notebook CSS by switching to an existing token that
// passes (no new custom properties). A failure that only a tokens.css value
// change can fix is recorded in EXPECTED_FAILURES with the ruling id the
// controller assigns (D-A4-…); the rail fails on an entry without one, on an
// entry that no longer fails (stale), and on any failure not in the table.
//
// Regenerate the measured table (docs/notebook/accessibility-contrast.md):
//   NOTEBOOK_CONTRAST_DOC=1 npx vitest run src/pages/journal-2-0/a11y/notebookContrast.test.js
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { contrast } from '../../../styles/__tests__/contrastMath'
import { auditNotebook, literalTextColours, pairKey, BARS, CONTEXTS, LANE_OWNED } from './contrastAudit'
import { themeVars, resolveVars, parseColor, THEMES } from './cssAudit'
import { EXPECTED_FAILURES, OTHER_LANES, RULINGS } from './contrastExpectedFailures'

const failing = (row, theme) => {
  const t = row.themes[theme]
  if (!t) return false
  if (t.error) return true
  return t.ratio < t.bar
}

describe('Notebook colour contrast, all three themes', () => {
  const { files, rows } = auditNotebook()
  const measured = rows.filter((r) => r.kind !== 'keyword')

  it('non-vacuity: the audit reads the stylesheets and finds pairs of every kind', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(measured.length).toBeGreaterThan(300)
    for (const kind of ['text', 'ui-focus', 'ui-input-border', 'ui-graph-ring']) {
      expect(measured.some((r) => r.kind === kind), kind).toBe(true)
    }
    expect(rows.some((r) => r.kind === 'keyword'), 'keyword colours are counted, not dropped').toBe(true)
  })

  it('control: the formula and the token resolver agree with known values', () => {
    const vars = themeVars()
    const white = [255, 255, 255]
    expect(contrast([0, 0, 0], white)).toBeCloseTo(21, 5)
    // the light theme really is light and the dark one dark
    expect(parseColor(resolveVars('var(--bg)', vars.light)).rgb).toEqual(white)
    expect(parseColor(resolveVars('var(--bg)', vars.oled)).rgb).toEqual([0, 0, 0])
    // a chain resolves; an unknown token throws BY NAME
    expect(resolveVars('var(--color-danger)', vars.dark)).toBe(resolveVars('var(--loss)', vars.dark))
    expect(() => resolveVars('var(--no-such-token-8a)', vars.dark)).toThrow('--no-such-token-8a')
  })

  it('no literal colour on `color:` in Notebook CSS (G-104: zero remain -- proved here)', () => {
    expect(literalTextColours(files)).toEqual([])
  })

  it('every pair meets its bar in every theme, or is an expected failure with a ruling id', () => {
    const expected = new Set([...EXPECTED_FAILURES, ...OTHER_LANES].map((e) => `${e.pair} @${e.theme}`))
    const unexplained = []
    for (const row of measured) {
      for (const theme of THEMES) {
        if (!failing(row, theme)) continue
        if (expected.has(`${pairKey(row)} @${theme}`)) continue
        const t = row.themes[theme]
        unexplained.push(t.error
          ? `${row.file}:${row.line} ${row.selector} [${row.kind}] ${theme}: ${t.error}`
          : `${row.file}:${row.line} ${row.selector} [${row.kind} ${row.prop}: ${row.value}] ${theme}: ${t.ratio.toFixed(2)}:1 < ${t.bar} on ${t.on}`)
      }
    }
    expect(unexplained, unexplained.join('\n')).toEqual([])
  })

  it('every EXPECTED_FAILURES entry carries a D-A4 ruling id and still fails as recorded', () => {
    expect(EXPECTED_FAILURES.length).toBeGreaterThan(0)
    for (const e of EXPECTED_FAILURES) {
      expect(e.rulingId, JSON.stringify(e)).toMatch(/^D-A4-\S+/)
      expect(Object.keys(RULINGS), `${e.rulingId} is not described in RULINGS`).toContain(e.rulingId)
      const row = measured.find((r) => pairKey(r) === e.pair)
      expect(row, `no such pair any more: ${e.pair}`).toBeTruthy()
      expect(failing(row, e.theme), `${e.pair} @${e.theme} passes now -- remove the entry`).toBe(true)
      expect(row.themes[e.theme].ratio.toFixed(2), `${e.pair} @${e.theme}`).toBe(Number(e.measured).toFixed(2))
    }
  })

  it('control: an entry with no ruling id is refused (the check above can fail)', () => {
    const bad = { pair: 'x', theme: 'dark', measured: 1 }
    expect(() => expect(bad.rulingId).toMatch(/^D-A4-\S+/)).toThrow()
  })

  it('every OTHER_LANES entry is in a stylesheet that lane owns, and still fails', () => {
    for (const e of OTHER_LANES) {
      const file = e.pair.split(' ')[0]
      expect(LANE_OWNED[file], `${file} is not another lane's stylesheet -- fix it here`).toBe(e.lane)
      const row = measured.find((r) => pairKey(r) === e.pair)
      expect(row, `no such pair any more: ${e.pair}`).toBeTruthy()
      expect(failing(row, e.theme), `${e.pair} @${e.theme} passes now -- remove the entry`).toBe(true)
    }
  })

  it('every declared image-overlay context still names a real rule', () => {
    const keys = new Set(rows.map((r) => `${r.file} ${r.selector}`))
    for (const [key, why] of Object.entries(CONTEXTS)) {
      expect(keys.has(key), `${key} is gone -- remove it from CONTEXTS`).toBe(true)
      expect(why.length).toBeGreaterThan(20)
    }
  })

  it.runIf(process.env.NOTEBOOK_CONTRAST_DOC)('writes docs/notebook/accessibility-contrast.md', () => {
    const repo = join(process.cwd(), '..')
    const sha = execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim()
    const out = []
    out.push('# Notebook colour contrast -- measured')
    out.push('')
    out.push(`Generated by \`app/src/pages/journal-2-0/a11y/notebookContrast.test.js\` at \`${sha}\` (wave 8, lane 8A, A5).`)
    out.push('Do not edit by hand; regenerate:')
    out.push('')
    out.push('```sh')
    out.push('cd app && NOTEBOOK_CONTRAST_DOC=1 npx vitest run src/pages/journal-2-0/a11y/notebookContrast.test.js')
    out.push('```')
    out.push('')
    out.push(`**Method.** Every rule in the ${files.length} derived Notebook stylesheets (\`a11y/cssAudit.js deriveNotebookCss\`),`)
    out.push('comments stripped. TEXT: the rule\'s `color` against its own background, else against `--bg`, `--bg-surface`')
    out.push('and `--bg-elevated` (worst of the three); translucent colours composited onto the surface first. Bars:')
    out.push(`${BARS.text}:1 normal text, ${BARS.large}:1 large text (>= 24px, or >= 18.66px at weight 700+, read from the same rule),`)
    out.push(`${BARS.ui}:1 non-text UI (focus indicators, input borders, the graph selection ring). Tokens are read from`)
    out.push('`app/src/styles/tokens.css` `:root` (dark), `[data-theme="oled"]` and `[data-theme="light"]`, `var()` chains resolved.')
    out.push('The ONE formula is `app/src/styles/__tests__/contrastMath.js`.')
    out.push('')
    const keywords = rows.filter((r) => r.kind === 'keyword').length
    out.push(`**Counts.** ${measured.length} measured pairs x 3 themes; ${keywords} keyword colours (inherit, currentColor, transparent) counted, not measured.`)
    out.push('')
    out.push('## Expected failures (need a tokens.css ruling)')
    out.push('')
    for (const [id, text] of Object.entries(RULINGS)) {
      const n = EXPECTED_FAILURES.filter((e) => e.rulingId === id).length
      out.push(`- **${id}** (${n} pair-theme rows) -- ${text}`)
    }
    out.push('')
    out.push('<details><summary>Every expected failure</summary>')
    out.push('')
    out.push('| pair | theme | measured | ruling |')
    out.push('|---|---|---|---|')
    for (const e of EXPECTED_FAILURES) out.push(`| \`${e.pair.replace(/\|/g, '\\|')}\` | ${e.theme} | ${Number(e.measured).toFixed(2)}:1 | ${e.rulingId} |`)
    out.push('')
    out.push('</details>')
    out.push('')
    out.push('## Another lane\'s to fix')
    out.push('')
    out.push('| pair | theme | measured | lane | fix |')
    out.push('|---|---|---|---|---|')
    for (const e of OTHER_LANES) out.push(`| \`${e.pair.replace(/\|/g, '\\|')}\` | ${e.theme} | ${Number(e.measured).toFixed(2)}:1 | ${e.lane} | ${e.fix} |`)
    out.push('')
    out.push('## Measured over a picture, not the page')
    out.push('')
    out.push('These are composited over black AND white (the extremes of the image underneath):')
    out.push('')
    for (const [key, why] of Object.entries(CONTEXTS)) out.push(`- \`${key}\` -- ${why}`)
    out.push('')
    for (const theme of THEMES) {
      const done = measured.filter((r) => r.themes[theme] && !r.themes[theme].error)
      const fails = measured.filter((r) => failing(r, theme))
      const min = Math.min(...done.map((r) => r.themes[theme].ratio))
      out.push(`## ${theme}`)
      out.push('')
      out.push(`${done.length} pairs measured, ${fails.length} below their bar, lowest ${min.toFixed(2)}:1.`)
      out.push('')
      out.push('<details><summary>Every pair</summary>')
      out.push('')
      out.push('| file:line | selector | kind | value | ratio | bar | worst surface |')
      out.push('|---|---|---|---|---|---|---|')
      for (const r of [...done].sort((a, b) => a.themes[theme].ratio - b.themes[theme].ratio)) {
        const t = r.themes[theme]
        const sel = r.selector.length > 60 ? `${r.selector.slice(0, 57)}...` : r.selector
        out.push(`| ${r.file}:${r.line} | \`${sel.replace(/\|/g, '\\|')}\` | ${r.kind} | \`${r.value.replace(/\|/g, '\\|')}\` | ${t.ratio.toFixed(2)} | ${t.bar} | ${t.on.replace(/\|/g, '\\|')} |`)
      }
      out.push('')
      out.push('</details>')
      out.push('')
    }
    writeFileSync(join(repo, 'docs', 'notebook', 'accessibility-contrast.md'), out.join('\n'), 'utf8')
  })
})

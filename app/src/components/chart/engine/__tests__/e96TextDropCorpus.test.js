// app/src/components/chart/engine/__tests__/e96TextDropCorpus.test.js
//
// ─── ⭐⭐ e96 (2026-11-23) — CORPUS CLASS: NO DRAWING'S TEXT VANISHES UNNAMED ─────────────────────
//
// The studio found a label whose text was arithmetic on a value read back from its line: not drawn,
// `errors: {}`, and its `createDropWhy` read "no refusal recorded" (`e96GetterArithLabels.test.js`
// holds that case by value). That fix is one shape; THIS is the class. Across every committed script
// that writes a drawing's text, each text the object pass loses (a create's, a setter's, a table
// cell's) carries a guard and a sentence, recorded as `objectDiagnostics.textDrops` where the drop is
// (`pine.js::textDropRefusal`), and the drop's own `*Why` line never says "no refusal recorded".
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { translatePine } from '../ast/pine'
import { TEXT_DROPS_KEPT } from '../ast/objectLoss'
import { ENUM_DROPS } from '../enumNaRule'

const diag = (src) => translatePine(src, { strict: true }).objectDiagnostics || {}

describe('D — CORPUS CLASS: no drawing\'s text vanishes unnamed, across the committed scripts that draw text', () => {
  const REPO = path.resolve(process.cwd(), '..')
  const DIRS = ['corpus/committed', 'tests/fixtures/pine_oos', 'tests/fixtures/pine_community', 'tests/fixtures/c3b_live',
    'tests/fixtures/pine', 'tests/fixtures/member', 'app/src/components/chart/engine/ast/__fixtures__/e96GetterArith']
  const TEXT_DRAWING = /\blabel\.new\(|\bbox\.new\(|\btable\.cell\(|\.set_text\(/
  /** The guards a drawing is withheld under for a STYLE or another property, never its text (`enumNaRule.js`). */
  const PROP_GUARDS = new Set(Object.values(ENUM_DROPS).map((e) => e.guard))
  const files = DIRS.flatMap((d) => {
    const dir = path.join(REPO, d)
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pine')).sort().map((f) => path.join(dir, f)) : []
  }).filter((f) => TEXT_DRAWING.test(fs.readFileSync(f, 'utf8')))

  it('every text a drawing loses carries a guard and a sentence, recorded where the drop is', () => {
    expect(files.length).toBeGreaterThanOrEqual(40)
    const silent = []
    let named = 0
    for (const f of files) {
      const key = path.relative(REPO, f).split(path.sep).join('/')
      let d
      try { d = diag(fs.readFileSync(f, 'utf8')) } catch { continue }              // a refused script draws nothing at all
      const drops = d.textDrops || []
      // a full list is a floor (`TEXT_DROPS_KEPT`): past it, a drop is still named in its own `*Why` line
      const full = drops.length >= TEXT_DROPS_KEPT
      const has = (family, line) => full || drops.some((e) => e.family === family && e.line === (line === '?' ? null : Number(line)))
      for (const w of d.createDropWhy || []) {
        const m = /^create (\w+)@(\d+|\?) text: (\S+)/.exec(w)
        if (!m || PROP_GUARDS.has(m[3])) continue                     // a style / colour withheld by name, not the text
        if (w.includes('no refusal recorded') || !has(m[1], m[2])) silent.push(`${key}: ${w.slice(0, 160)}`)
      }
      for (const w of d.cellTextWhy || []) {
        const m = /^cell@(\d+|\?): (\S+)/.exec(w)
        if (!m || PROP_GUARDS.has(m[2])) continue                     // a cell's colour / width / size, not its text
        if (w.includes('no refusal recorded') || !has('table', m[1])) silent.push(`${key}: ${w.slice(0, 160)}`)
      }
      for (const e of drops) {
        named += 1
        if (!(typeof e.guard === 'string' && e.guard && typeof e.sentence === 'string' && e.sentence.length > 20)) {
          silent.push(`${key}: an unnamed text drop ${JSON.stringify(e).slice(0, 160)}`)
        }
      }
    }
    expect(silent).toEqual([])
    // ⭐ the rail has something to hold: the committed scripts lose some text today, each by name
    expect(named).toBeGreaterThan(0)
  }, 600_000)
})

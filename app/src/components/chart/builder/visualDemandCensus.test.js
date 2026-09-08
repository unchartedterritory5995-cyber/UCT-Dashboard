// app/src/components/chart/builder/visualDemandCensus.test.js
//
// ─── C3A.1: WHAT THE CORPUS ACTUALLY ASKS FOR, VISUALLY ─────────────────────
//
// A MEASUREMENT over the frozen 60 (`5df718c2`). It answers one question and
// refuses to answer a different, easier one:
//
//   HOW MANY SCRIPTS ASK FOR EACH VISUAL PRIMITIVE
//
// ⛔ NOT "how many could we support". Supportability may not be allowed to
// change a count — that is the failure mode this whole program keeps naming, and
// it is how a roadmap comes to be sorted by what is easy instead of by what
// members paste.
//
// ⛔⛔ THE DECLARATIVE / LIFECYCLE SPLIT IS THE POINT OF THE FILE. C3A is
// authorised for primitives that can stay DECLARATIVE — a value per bar, or an
// event on a bar — and explicitly NOT for the mutable object model
// (`line.new`/`label.new`/`box.new`/`table.new`, object arrays, ids you can
// update and delete). Counting them together would produce one big number that
// justifies building the wrong thing first, so they are counted apart and
// printed apart.
//
// ⚠️ THIS IS A SOURCE-TEXT CENSUS, AND SAYS SO. It counts what authors WROTE,
// which is the demand signal; it does not claim the translator accepts any of
// it. Where a call sits inside a comment or a string it is over-counted, which
// is why the raw regex is reported beside a comment-stripped count rather than
// instead of it — the gap between the two is itself a fact about the corpus.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const OOS = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')

/** Pine line comments only — `//` to end of line, outside a string literal. */
function stripComments(src) {
  const out = []
  for (const line of src.split(/\r?\n/)) {
    let inStr = null
    let cut = line.length
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (inStr) {
        if (ch === '\\') { i += 1; continue }
        if (ch === inStr) inStr = null
        continue
      }
      if (ch === '"' || ch === "'") { inStr = ch; continue }
      if (ch === '/' && line[i + 1] === '/') { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return out.join('\n')
}

/** `name(` as a CALL, not as a substring of a longer identifier. */
const callRe = (name) => new RegExp(`(^|[^A-Za-z0-9_.])${name}\\s*\\(`, 'g')
const countCalls = (src, name) => (src.match(callRe(name)) || []).length

/** ⭐ THE TWO FAMILIES, DECLARED SEPARATELY AND NEVER SUMMED. */
const DECLARATIVE = [
  'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar',
  'bgcolor', 'barcolor', 'fill', 'hline', 'plot',
]
const LIFECYCLE = [
  'line.new', 'label.new', 'box.new', 'table.new', 'polyline.new', 'linefill.new',
  'line.set_xy1', 'label.set_text', 'box.set_top', 'table.cell',
  'line.delete', 'label.delete', 'box.delete', 'table.delete',
]

describe('C3A.1 — the visual demand census', () => {
  it('scripts and call sites, declarative vs object lifecycle', () => {
    const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBe(60)

    const scripts = {}
    const sites = {}
    const rawSites = {}
    for (const n of [...DECLARATIVE, ...LIFECYCLE]) {
      scripts[n] = 0; sites[n] = 0; rawSites[n] = 0
    }
    let anyDeclarative = 0
    let anyLifecycle = 0
    let bothFamilies = 0
    const perScript = []

    for (const f of files) {
      const raw = fs.readFileSync(path.join(OOS, f), 'utf8')
      const src = stripComments(raw)
      let d = 0
      let l = 0
      const row = { name: f.replace(/\.pine$/, ''), decl: {}, life: {} }
      for (const n of DECLARATIVE) {
        const c = countCalls(src, n)
        rawSites[n] += countCalls(raw, n)
        if (c) { scripts[n] += 1; sites[n] += c; row.decl[n] = c }
        // `plot`/`hline`/`fill` are already-supported baselines, not C3A demand
        if (c && !['plot', 'hline', 'fill'].includes(n)) d += c
      }
      for (const n of LIFECYCLE) {
        const c = countCalls(src, n)
        rawSites[n] += countCalls(raw, n)
        if (c) { scripts[n] += 1; sites[n] += c; row.life[n] = c }
        l += c
      }
      if (d) anyDeclarative += 1
      if (l) anyLifecycle += 1
      if (d && l) bothFamilies += 1
      perScript.push({ ...row, d, l })
    }

    const line = (n) => `    ${n.padEnd(16)} ${String(scripts[n]).padStart(2)}/60 scripts  `
      + `${String(sites[n]).padStart(5)} sites`
      + (rawSites[n] !== sites[n] ? `   (${rawSites[n]} incl. comments)` : '')

    // eslint-disable-next-line no-console
    console.log('\n=== C3A.1 VISUAL DEMAND, frozen 60, source-text census ===\n'
      + '  DECLARATIVE / EVENT (C3A is authorised for these)\n'
      + DECLARATIVE.filter((n) => !['plot', 'hline', 'fill'].includes(n)).map(line).join('\n')
      + '\n  ALREADY SUPPORTED (the baseline C1 established)\n'
      + ['plot', 'hline', 'fill'].map(line).join('\n')
      + '\n  MUTABLE OBJECT LIFECYCLE (explicitly NOT C3A)\n'
      + LIFECYCLE.filter((n) => scripts[n]).map(line).join('\n')
      + `\n\n  scripts wanting ANY C3A primitive:      ${anyDeclarative}/60`
      + `\n  scripts wanting ANY object lifecycle:   ${anyLifecycle}/60`
      + `\n  scripts wanting BOTH:                   ${bothFamilies}/60`
      + `\n  scripts wanting ONLY C3A primitives:    ${anyDeclarative - bothFamilies}/60`
      + '\n\n  the eight heaviest by C3A demand:\n'
      + perScript.sort((a, b) => b.d - a.d).slice(0, 8).map(
        (r) => `    ${String(r.d).padStart(3)} sites  ${Object.entries(r.decl)
          .filter(([k]) => !['plot', 'hline', 'fill'].includes(k))
          .map(([k, v]) => `${k}×${v}`).join(' ')}  ${r.name}`).join('\n'))

    // ⛔ THE FINDING, ASSERTED. If the corpus is ever re-frozen and this stops
    // being true, the C3A ordering argument has to be re-made rather than
    // inherited.
    expect(anyDeclarative).toBeGreaterThan(0)
    expect(anyLifecycle).toBeGreaterThan(0)
    // …and the two families are genuinely different populations, not one.
    expect(anyDeclarative - bothFamilies).toBeGreaterThan(0)
  })
})

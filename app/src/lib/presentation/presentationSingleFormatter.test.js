// app/src/lib/presentation/presentationSingleFormatter.test.js
//
// ─── ONE FORMATTER FOR THE S8 FAMILY, AND THE SCOPE IS STATED, NOT ASSUMED ──
//
// S10 exists because "118 files define their own" (TD-08). This rail does NOT
// claim to have fixed that — it claims exactly one thing, over exactly the
// files S10's approval covers:
//
//     inside `components/provenance/**`, no file formats a value for a human
//     any more. Every such decision is `lib/presentation/`'s.
//
// ⛔ THE POPULATION IS NAMED, NOT COUNTED. A rail asserting "N files are clean"
// goes red the day a legitimate file joins the directory, which is measuring
// the population rather than the property. This names the files and fails BY
// NAME on a new offender.
//
// ⛔ CODE, NEVER PROSE. Every one of these files' headers TALKS about
// `toLocaleString` at length — `CoverageLine.jsx` quotes its own retired
// implementation, `presentationFormat.js` quotes its whole retired header.
// A grep would match all of it and this rail would be red on its own
// documentation. The comment stripper below is load-bearing, and the control
// underneath proves it strips a comment AND still sees real code.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../..')

/** The S8 family — S10's approved adoption scope, listed so a new file in this
 *  directory fails here loudly rather than joining silently. */
const S8_DIR = path.join(SRC, 'components', 'provenance')

/** The formatting calls a presentation layer exists to own. */
const FORMATTERS = /\.toLocale(?:String|TimeString|DateString)\s*\(|\bnew\s+Intl\.(?:NumberFormat|DateTimeFormat)\s*\(/

/**
 * Strip `//` line comments and block comments, leaving string and template
 * literals intact.
 *
 * ⛔ A regex-only stripper mangles `'http://x'` and a `//` inside a template
 * literal. This is a character scanner instead, with the string/template states
 * it needs and nothing more. It does NOT understand regex literals — none of
 * the files it runs over contain one, which is asserted below rather than
 * hoped.
 */
export function stripJsComments(src) {
  let out = ''
  let i = 0
  let state = 'code' // code | line | block | single | double | tpl
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue }
      if (c === "'") { state = 'single' }
      else if (c === '"') { state = 'double' }
      else if (c === '`') { state = 'tpl' }
      out += c; i += 1; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c }
      i += 1; continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; continue }
      if (c === '\n') out += c
      i += 1; continue
    }
    // inside a literal
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"')
      || (state === 'tpl' && c === '`')) state = 'code'
    out += c; i += 1
  }
  return out
}

function jsFilesIn(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.(js|jsx)$/.test(f))
    .sort()
}

describe('the S8 provenance family formats nothing of its own', () => {
  const files = jsFilesIn(S8_DIR)

  it('the directory is non-empty and contains the four components', () => {
    // ⛔ NON-VACUITY. A directory read that returned `[]` would make every
    // assertion below pass over nothing. Named members, never a count — the
    // population is meant to grow.
    expect(files).toContain('Provenance.jsx')
    expect(files).toContain('FreshnessBadge.jsx')
    expect(files).toContain('Cited.jsx')
    expect(files).toContain('CoverageLine.jsx')
    expect(files).toContain('presentationFormat.js')
  })

  it('no file in it calls a locale formatter in CODE', () => {
    const offenders = []
    for (const f of files) {
      const code = stripJsComments(fs.readFileSync(path.join(S8_DIR, f), 'utf8'))
      const m = code.match(FORMATTERS)
      if (m) offenders.push(`${f}: ${m[0]}`)
    }
    expect(offenders, 'these must format through lib/presentation instead').toEqual([])
  })

  it('and at least one of them still MENTIONS one in prose — so the strip matters', () => {
    // ⛔ THE CONTROL FOR THE CONTROL. If the stripper were over-eager and
    // returned '' for everything, the assertion above would pass for the wrong
    // reason. This proves (a) the raw text contains the needle, (b) the
    // stripped text does not, for a specific named file.
    const raw = fs.readFileSync(path.join(S8_DIR, 'CoverageLine.jsx'), 'utf8')
    expect(raw).toMatch(FORMATTERS)
    expect(stripJsComments(raw)).not.toMatch(FORMATTERS)
  })

  it('the stripper still sees real code — it does not just return empty', () => {
    const stripped = stripJsComments(fs.readFileSync(path.join(S8_DIR, 'CoverageLine.jsx'), 'utf8'))
    expect(stripped).toContain('export default function CoverageLine')
    expect(stripped).toContain("from '../../lib/presentation/presentationPrimitives'")
    expect(stripped.length).toBeGreaterThan(500)
  })

  it('none of these files contains a regex literal the stripper cannot model', () => {
    // The one shape this scanner does not understand. Asserted, not assumed —
    // if one appears the rail must be taught about it rather than quietly
    // mis-parsing the file.
    for (const f of files) {
      const code = stripJsComments(fs.readFileSync(path.join(S8_DIR, f), 'utf8'))
      expect(code, f).not.toMatch(/[=(,]\s*\/[^/*\s][^\n]*\/[gimsuy]*/)
    }
  })
})

describe('the stripper itself', () => {
  it('keeps a formatter in code and drops one in a line comment', () => {
    const src = [
      "// const x = (1).toLocaleString('en-US')",
      "const y = (2).toLocaleString('en-US')",
    ].join('\n')
    const out = stripJsComments(src)
    expect(out).toContain('const y')
    expect(out).not.toContain('const x')
    expect(out.match(/toLocaleString/g)).toHaveLength(1)
  })

  it('drops a block comment, including a multi-line one', () => {
    const src = "/* (1).toLocaleString('en-US')\n more */\nconst z = 1\n"
    const out = stripJsComments(src)
    expect(out).not.toMatch(FORMATTERS)
    expect(out).toContain('const z = 1')
  })

  it('does NOT mangle a // inside a string or template literal', () => {
    const src = 'const u = "https://example.com/x"\nconst t = `a//b`\n'
    const out = stripJsComments(src)
    expect(out).toContain('https://example.com/x')
    expect(out).toContain('a//b')
  })

  it('does not lose an escaped quote', () => {
    const src = "const s = 'it\\'s fine' // gone\n"
    const out = stripJsComments(src)
    expect(out).toContain("it\\'s fine")
    expect(out).not.toContain('gone')
  })
})

describe('S10 itself is pure', () => {
  it('the primitives module imports nothing', () => {
    const src = fs.readFileSync(path.join(HERE, 'presentationPrimitives.js'), 'utf8')
    const code = stripJsComments(src)
    // ⛔ NO REACT, NO CLOCK, NO CONTRACT MODULE. A presentation primitive that
    // imported `freshnessContract` would put S8's FreshnessClass mapping behind
    // an S10 door and give it two owners; one that imported the market clock
    // would let a formatter decide what session it is.
    expect(code).not.toMatch(/^\s*import\s/m)
    expect(code).not.toContain('react')
    expect(code).not.toContain('marketClock')
    expect(code).not.toContain('freshnessContract')
  })
})

describe('⚠️ formatPercent is DECLARED AND ADOPTED BY NOTHING — stated, not hidden', () => {
  // ⛔ THIS IS `lesson_built_tested_green_and_unreachable` CAUGHT IN THE ACT AND
  // WRITTEN DOWN RATHER THAN SHIPPED QUIETLY. S10's approval names five
  // primitives. Four of them had an adopter inside the approved scope; the
  // percent one does not, because not one of `Provenance`, `FreshnessBadge`,
  // `Cited` or `CoverageLine` renders a percentage.
  //
  // ⛔ It was built anyway — the approval asked for five — and this test is the
  // honest record of the consequence. It goes RED the moment somebody adopts
  // it, which is the point: the next reader is forced to come here, delete this
  // test, and record that the state changed, instead of the fact quietly
  // becoming false.
  //
  // The named first consumer, when a line authorizes it:
  // `components/chart/drawingLabels.js::formatPercent`, whose six importers all
  // render a percent for a member today.
  // ⚰️ THIS WALKED THE WHOLE TREE TWICE — ONCE PER TEST — AND THAT MADE IT
  // LOAD-SENSITIVE. Each pass read and comment-stripped every `.js`/`.jsx` under
  // `app/src` (~1,400 files, ~1s alone), so under a parallel multi-file run the
  // work doubled against the same timeout. It went RED once in an 8-file run on
  // 2026-09-12 and GREEN both alone and on an immediate re-run of the identical
  // eight — `lesson_a_rail_can_be_green_alone_and_red_in_company` exactly.
  //
  // ⛔ A LOAD-SENSITIVE RED IS NOT BANKED AS PERMITTED BREAKAGE. It leaves a slot
  // in the baseline that a real failure can occupy unnoticed. Fixed by walking
  // ONCE and memoizing the stripped corpus.
  //
  // ⭐ AND SHARING THE CORPUS MAKES THE NON-VACUITY CONTROL STRONGER, NOT WEAKER.
  // Two independently-built walks could in principle disagree about which files
  // they visited, so the control proved a property of ITS OWN walk and not of the
  // assertion's. One corpus, queried twice, means the control now witnesses the
  // exact set the assertion ran over.
  const corpus = (() => {
    let cached = null
    return () => {
      if (cached) return cached
      const out = []
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name)
          if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
          if (!/\.(js|jsx)$/.test(e.name)) continue
          if (p.startsWith(HERE)) continue
          out.push({ p, code: stripJsComments(fs.readFileSync(p, 'utf8')) })
        }
      }
      walk(SRC)
      cached = out
      return cached
    }
  })()

  it('nothing outside lib/presentation imports formatPercent from S10', () => {
    const hits = corpus()
      .filter(({ code }) => /formatPercent[^\n]*presentationPrimitives|presentationPrimitives[^\n]*formatPercent/s.test(code))
      .map(({ p }) => path.relative(SRC, p))
    expect(hits, 'formatPercent has a consumer now — delete this test and record the change').toEqual([])
  })

  it('non-vacuity: the SAME corpus DOES find the four real S10 adopters', () => {
    // Without this, the assertion above would pass identically if the walk were
    // broken and visited nothing at all.
    const files = corpus()
    expect(files.length, 'the corpus walk visited almost nothing').toBeGreaterThan(500)
    const hits = files
      .filter(({ code }) => /from '.*lib\/presentation\/presentationPrimitives'/.test(code))
      .map(({ p }) => path.basename(p))
    for (const f of ['Provenance.jsx', 'FreshnessBadge.jsx', 'Cited.jsx',
      'CoverageLine.jsx', 'presentationFormat.js']) {
      expect(hits, `expected ${f} to import S10`).toContain(f)
    }
  })
})

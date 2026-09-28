// app/src/lib/presentation/handRolledFormatters.census.test.js
//
// ─── TERM-066 · WHO STILL FORMATS A VALUE BY HAND, AND A RATCHET THAT ONLY SHRINKS ─
//
// `lib/presentation/presentationPrimitives.js` is the one module that owns turning
// a number, a price, a percent, a volume or a date into text for a member. This
// file counts every place OUTSIDE that module that still does it by hand, and
// holds the count to a committed per-file baseline that can only go DOWN.
//
//     cd app && npx vitest run src/lib/presentation/handRolledFormatters.census.test.js
//
// ── WHAT COUNTS AS A HAND-ROLLED FORMATTER (read off the AST, never grepped) ─
//
//   toFixed · toPrecision · toLocaleString · toLocaleDateString ·
//   toLocaleTimeString        a member access with that property name
//   Intl.NumberFormat ·
//   Intl.DateTimeFormat       a member access on the `Intl` global
//   magnitudeSuffix           ad-hoc K/M/B/T suffixing: a division by 1e3 /
//                             1e6 / 1e9 / 1e12 that lands directly in front of a
//                             "K"/"M"/"B"/"T" — either the next template-literal
//                             chunk or a `+ 'M'` string concatenation
//
// ⚠️ The first seven are the same property set `panelAdoption.measure.test.js`
// uses for its "formats a value" narrowing (plus the magnitude suffix, which that
// census does not need). Keep the two in step: they answer related questions and
// a reader will compare them.
//
// ⛔ A `${(n / 1e9).toFixed(1)}B` site counts TWICE — once as toFixed, once as a
// magnitude suffix. That is deliberate: they are two decisions (the rounding and
// the unit), and migrating one without the other is a real, partial state.
//
// ── THE POPULATION, DERIVED ─────────────────────────────────────────────────
//
// Every code file git knows about under `app/src` — tracked OR untracked-but-not-
// ignored, so a brand-new file is seen before its first `git add` — that is not a
// test (`*.test.*` / `*.spec.*`, or anything under a `__tests__/` directory) and is
// not inside `lib/presentation/` itself, which is where formatting is SUPPOSED to
// live. ⛔ No hand-typed roster: the rail below proves the owner exclusion is doing
// work (the owner module really does call `toFixed`) rather than assuming it.
//
// ⚠️ PARTNER-OWNED FILES ARE BASELINED, NOT DROPPED. `pages/OptionsFlow.jsx` is
// Ravi's; it is in the baseline like every other file and printed on its own line
// below so the number is visible rather than filtered.
//
// ── THE RATCHET ─────────────────────────────────────────────────────────────
//
// `handRolledFormatters.baseline.json` records, per file, how many sites that file
// had when the baseline was last written. That is a fact about HISTORY, which is
// the one thing the tree cannot derive — every count this file prints is derived.
//
//   • A file whose count GREW fails BY NAME.
//   • A file NOT in the baseline that has any site fails BY NAME — a new
//     hand-rolled formatter file is exactly what this rail exists to catch.
//   • A file whose count FELL also fails, with the command that banks it: a
//     baseline with slack in it would let the count creep back up to the old
//     number unnoticed, so progress is locked in the same commit that makes it.
//
// ⛔ THE UPDATE MODE ONLY TIGHTENS. `UPDATE_FORMAT_CENSUS_BASELINE=1` lowers counts
// and drops files that reached zero, and REFUSES — writes nothing — if any file
// grew or appeared. So growth cannot be laundered by re-running the generator: it
// costs a deliberate, reviewable hand edit to the committed JSON, with the reason
// in the commit message.
//
//     cd app && UPDATE_FORMAT_CENSUS_BASELINE=1 npx vitest run \
//       src/lib/presentation/handRolledFormatters.census.test.js

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = (() => {
  let dir = HERE
  for (;;) {
    if (fs.existsSync(path.join(dir, 'app', 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) throw new Error('could not find the repo root above ' + HERE)
    dir = up
  }
})()
const BASELINE_PATH = path.join(HERE, 'handRolledFormatters.baseline.json')
const OWNER_DIR = 'app/src/lib/presentation/'
const PARTNER_OWNED = ['app/src/pages/OptionsFlow.jsx']
const CODE_EXT = /\.(js|jsx|mjs|cjs)$/

const JsxParser = Parser.extend(jsx())
const parse = (src) => JsxParser.parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true,
})

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

export const METHOD_KINDS = ['toFixed', 'toPrecision', 'toLocaleString',
  'toLocaleDateString', 'toLocaleTimeString']
export const INTL_KINDS = ['NumberFormat', 'DateTimeFormat']
const MAGNITUDES = new Set([1e3, 1e6, 1e9, 1e12])
const SUFFIX = /^[KMBT]/

function hasMagnitudeDivision(node) {
  let hit = false
  walk(node, (n) => {
    if (n.type === 'BinaryExpression' && n.operator === '/'
      && n.right?.type === 'Literal' && MAGNITUDES.has(n.right.value)) hit = true
  })
  return hit
}

/**
 * Count the hand-rolled formatter sites in one source text, by kind.
 * ⛔ Takes SOURCE, not a path, so the controls can plant a site without touching
 * the working tree. Comments never reach the AST, so prose that talks about
 * `toFixed` is not counted — and a control below proves that.
 */
export function countSites(src) {
  // ⛔ A NULL-PROTOTYPE TALLY, AND IT IS LOAD-BEARING. Two of the kinds ARE
  // Object.prototype methods: on a plain `{}`, `kinds.toLocaleString` is the
  // inherited function, so `(kinds[k] || 0) + 1` string-concatenates source text
  // into the count. Measured while bootstrapping this file — the first tally
  // printed "function toLocaleString() { [native code] }1" as a count.
  const kinds = Object.create(null)
  const bump = (k) => { kinds[k] = (kinds[k] || 0) + 1 }
  walk(parse(src), (n) => {
    if (n.type === 'MemberExpression' && !n.computed) {
      const prop = n.property?.name
      if (METHOD_KINDS.includes(prop)) bump(prop)
      else if (INTL_KINDS.includes(prop) && n.object?.type === 'Identifier'
        && n.object.name === 'Intl') bump(`Intl.${prop}`)
    }
    if (n.type === 'TemplateLiteral') {
      n.expressions.forEach((e, i) => {
        const next = n.quasis[i + 1]?.value?.cooked ?? ''
        if (SUFFIX.test(next) && hasMagnitudeDivision(e)) bump('magnitudeSuffix')
      })
    }
    if (n.type === 'BinaryExpression' && n.operator === '+'
      && n.right?.type === 'Literal' && typeof n.right.value === 'string'
      && SUFFIX.test(n.right.value) && hasMagnitudeDivision(n.left)) bump('magnitudeSuffix')
  })
  const total = Object.values(kinds).reduce((a, b) => a + b, 0)
  return { total, kinds: { ...kinds } }
}

/** The population: repo-relative, forward slashes, sorted. ⛔ Asked of git, and a
 *  failed git read throws rather than returning [] — every rail below would pass
 *  over an empty population. */
export function population() {
  const out = execFileSync('git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'app/src'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))]
    .filter((p) => CODE_EXT.test(p))
    .filter((p) => !/\.(test|spec)\.[cm]?jsx?$/.test(p))
    .filter((p) => !p.split('/').includes('__tests__'))
    .filter((p) => !p.startsWith(OWNER_DIR))
    .filter((p) => fs.existsSync(path.join(ROOT, p)))
    .sort()
}

let _census = null
/** { file -> {total, kinds} } for every file in the population with ≥1 site. */
export function census() {
  if (_census) return _census
  const files = population()
  const out = {}
  const parseFailures = []
  for (const f of files) {
    let r
    try { r = countSites(fs.readFileSync(path.join(ROOT, f), 'utf8')) }
    catch (e) { parseFailures.push(`${f}: ${e.message}`); continue }
    if (r.total > 0) out[f] = r
  }
  _census = { files, sites: out, parseFailures }
  return _census
}

/**
 * The ratchet decision, pure. `current` and `baseline` are {file -> count}.
 *   added — a file with sites that the baseline has never seen
 *   grew  — a baselined file with MORE sites than recorded
 *   slack — a baselined file with FEWER sites than recorded (bank it)
 */
export function ratchetVerdict(current, baseline) {
  const added = []; const grew = []; const slack = []
  for (const [f, now] of Object.entries(current)) {
    if (!Object.hasOwn(baseline, f)) added.push({ file: f, now })
    else if (now > baseline[f]) grew.push({ file: f, was: baseline[f], now })
  }
  for (const [f, was] of Object.entries(baseline)) {
    const now = current[f] || 0
    if (now < was) slack.push({ file: f, was, now })
  }
  return { added, grew, slack }
}

const NOTE = [
  'TERM-066 HAND-ROLLED FORMATTER CENSUS BASELINE. Read by handRolledFormatters.census.test.js.',
  'Per file: how many hand-rolled formatter sites it had when this was last written.',
  'SHRINK-ONLY. Tightening is mechanical:',
  '  cd app && UPDATE_FORMAT_CENSUS_BASELINE=1 npx vitest run src/lib/presentation/handRolledFormatters.census.test.js',
  'The update mode REFUSES to raise a count or add a file. Growth is a HAND EDIT to this',
  'file, with the reason in the commit message, so it cannot be laundered by a re-run.',
  'Keys are repo-relative with forward slashes, sorted; LF; trailing newline. The rail',
  'asserts these bytes are exactly what its writer produces.',
]

export function serializeBaseline(sites) {
  const sorted = {}
  for (const k of Object.keys(sites).sort()) sorted[k] = sites[k]
  return JSON.stringify({ note: NOTE, sites: sorted }, null, 2) + '\n'
}

function readBaseline() {
  // ⚠️ `core.autocrlf=true` on this box checks the file out with CRLF; the blob
  // git stores is LF, and that blob is what the byte check is about. Same
  // normalisation as `panelAdoption.ratchet.test.js`'s `read()`.
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8').replace(/\r\n/g, '\n')
  return { raw, sites: JSON.parse(raw).sites }
}

const currentCounts = () => Object.fromEntries(
  Object.entries(census().sites).map(([f, r]) => [f, r.total]))

const fmtList = (rows, render) => rows.map(render).join('\n  ')
const UPDATE_CMD = 'cd app && UPDATE_FORMAT_CENSUS_BASELINE=1 npx vitest run '
  + 'src/lib/presentation/handRolledFormatters.census.test.js'

// ── update mode (only ever TIGHTENS) ────────────────────────────────────────
if (process.env.UPDATE_FORMAT_CENSUS_BASELINE === '1') {
  const { sites: base } = readBaseline()
  const cur = currentCounts()
  const v = ratchetVerdict(cur, base)
  if (v.added.length || v.grew.length) {
    throw new Error('REFUSING to update the formatter baseline — it only shrinks. '
      + 'Grew/new:\n  ' + fmtList([...v.grew, ...v.added],
        (r) => `${r.file}: ${r.was ?? 'new'} -> ${r.now}`))
  }
  const next = {}
  for (const [f, was] of Object.entries(base)) {
    const now = Math.min(was, cur[f] || 0)
    if (now > 0) next[f] = now
  }
  fs.writeFileSync(BASELINE_PATH, serializeBaseline(next))
}

// ── the detector ────────────────────────────────────────────────────────────

describe('the detector reads CODE, and can see every kind it claims to', () => {
  // ⛔ Needles are built by concatenation so this test file never carries the
  // literal call it plants — a grep over the tree cannot be fooled by it, and
  // neither can a reader.
  const TF = 'to' + 'Fixed'
  const TLS = 'to' + 'LocaleString'

  it('counts each kind once in code', () => {
    const src = [
      `const a = n.${TF}(2)`,
      `const b = n.${TLS}('en-US')`,
      `const c = d.toLocale${'Date'}String('en-US')`,
      `const e = new Intl.Number${'Format'}('en-US')`,
      `const f = Intl.DateTime${'Format'}('en-US')`,
      `const g = n.toPre${'cision'}(3)`,
    ].join('\n')
    const r = countSites(src)
    expect(r.kinds).toEqual({
      [TF]: 1, [TLS]: 1, toLocaleDateString: 1, 'Intl.NumberFormat': 1,
      'Intl.DateTimeFormat': 1, toPrecision: 1,
    })
    expect(r.total).toBe(6)
  })

  it('sees a magnitude suffix in a template literal AND in a string concatenation', () => {
    const tpl = 'const s = `${(v / 1' + 'e9).' + TF + '(1)}B`'
    const cat = "const s = (v / 1" + "e6)." + TF + "(1) + 'M'"
    expect(countSites(tpl).kinds.magnitudeSuffix).toBe(1)
    expect(countSites(cat).kinds.magnitudeSuffix).toBe(1)
    // numeric separators resolve to the same value, so they are seen too
    expect(countSites('const s = `${Math.round(v / 1_000)}K`').kinds.magnitudeSuffix).toBe(1)
  })

  it('a kind named like an Object.prototype method still counts as a NUMBER', () => {
    // The regression control for the null-prototype tally above.
    const r = countSites(`const a = n.${TLS}()\nconst b = m.${TLS}()\n`)
    expect(r.kinds[TLS]).toBe(2)
    expect(r.total).toBe(2)
  })

  it('does NOT count a division that is not followed by a unit, or a unit with no division', () => {
    expect(countSites('const s = `${v / 1' + 'e6} shares`').total).toBe(0)
    expect(countSites("const s = `${v}M`").total).toBe(0)
    expect(countSites("const s = (v / 7) + 'K'").total).toBe(0)
  })

  it('ignores comments and string contents — and the control proves code IS seen', () => {
    const prose = `// n.${TF}(2)\n/* n.${TLS}() */\nconst q = 'n.${TF}(2)'\n`
    expect(countSites(prose).total).toBe(0)
    expect(countSites(prose + `const r = n.${TF}(2)\n`).total).toBe(1)
  })

  it('a computed access or a look-alike name is not a site', () => {
    expect(countSites(`const a = n['${TF}'](2)`).total).toBe(0)
    expect(countSites(`const a = n.${TF}ed(2)`).total).toBe(0)
    expect(countSites('const a = Other.NumberFormat').total).toBe(0)
  })
})

// ── the population ──────────────────────────────────────────────────────────

describe('the population is real, and the owner exclusion does work', () => {
  it('git returned a real tree, and parse failures are zero', () => {
    const { files, parseFailures } = census()
    expect(files.length, 'the population read returned almost nothing').toBeGreaterThan(1000)
    expect(parseFailures, 'a file the AST cannot read is a file the census cannot see').toEqual([])
  }, 120_000)

  it('names a known offender — the census is not silently empty', () => {
    const { sites } = census()
    for (const f of PARTNER_OWNED) {
      expect(sites[f]?.total ?? 0, `${f} should still carry hand-rolled sites`).toBeGreaterThan(0)
    }
  }, 120_000)

  it('the owner module is excluded, and the exclusion is load-bearing', () => {
    const owner = 'app/src/lib/presentation/presentationPrimitives.js'
    const { files } = census()
    expect(files).not.toContain(owner)
    // Without the exclusion the owner WOULD be counted — so it is doing work.
    const own = countSites(fs.readFileSync(path.join(ROOT, owner), 'utf8'))
    expect(own.total).toBeGreaterThan(0)
  }, 120_000)
})

// ── the ratchet ─────────────────────────────────────────────────────────────

describe('the ratchet verdict, pure', () => {
  it('a planted new file with sites is ADDED, by name', () => {
    const v = ratchetVerdict({ 'app/src/a.js': 2, 'app/src/new.js': 1 }, { 'app/src/a.js': 2 })
    expect(v.added).toEqual([{ file: 'app/src/new.js', now: 1 }])
    expect(v.grew).toEqual([])
    expect(v.slack).toEqual([])
  })

  it('growth is caught by name, and a shrink is slack to bank', () => {
    const v = ratchetVerdict({ 'app/src/a.js': 3, 'app/src/b.js': 1 },
      { 'app/src/a.js': 2, 'app/src/b.js': 4, 'app/src/gone.js': 1 })
    expect(v.grew).toEqual([{ file: 'app/src/a.js', was: 2, now: 3 }])
    expect(v.slack).toEqual([
      { file: 'app/src/b.js', was: 4, now: 1 },
      { file: 'app/src/gone.js', was: 1, now: 0 },
    ])
  })
})

describe('⭐ HAND-ROLLED FORMATTERS MAY NOT GROW', () => {
  it('no file gained a site, and no new file appeared', () => {
    const { sites: base } = readBaseline()
    const v = ratchetVerdict(currentCounts(), base)
    expect(v.added, 'NEW hand-rolled formatter file(s) — format through '
      + 'lib/presentation/presentationPrimitives instead:\n  '
      + fmtList(v.added, (r) => `${r.file} (${r.now} site(s))`)).toEqual([])
    expect(v.grew, 'these files gained hand-rolled formatter sites:\n  '
      + fmtList(v.grew, (r) => `${r.file}: ${r.was} -> ${r.now}`)).toEqual([])
  }, 120_000)

  it('the baseline is tight — progress is banked in the commit that makes it', () => {
    const { sites: base } = readBaseline()
    const v = ratchetVerdict(currentCounts(), base)
    expect(v.slack, 'these files SHRANK — bank it so it cannot creep back:\n  '
      + fmtList(v.slack, (r) => `${r.file}: ${r.was} -> ${r.now}`)
      + `\n  run: ${UPDATE_CMD}`).toEqual([])
  }, 120_000)

  it('the committed baseline is byte-exactly what its writer produces', () => {
    const { raw, sites } = readBaseline()
    expect(raw).toBe(serializeBaseline(sites))
  })
})

describe('the census, printed', () => {
  it('reports totals, by kind, the largest files and the partner line', () => {
    const { files, sites } = census()
    const byKind = Object.create(null)
    let total = 0
    for (const r of Object.values(sites)) {
      total += r.total
      for (const [k, c] of Object.entries(r.kinds)) byKind[k] = (byKind[k] || 0) + c
    }
    const top = Object.entries(sites).sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1))
      .slice(0, 15).map(([f, r]) => `    ${String(r.total).padStart(4)}  ${f}`)
    const partner = PARTNER_OWNED.map((f) => `    partner-owned (baselined, not dropped): ${f} = ${sites[f]?.total ?? 0}`)
    console.log([
      '[term-066 census]',
      `    population ${files.length} files · with sites ${Object.keys(sites).length} · sites ${total}`,
      `    by kind ${JSON.stringify(byKind)}`,
      ...partner,
      '    largest:',
      ...top,
    ].join('\n'))
    expect(total).toBeGreaterThan(0)
  }, 120_000)
})

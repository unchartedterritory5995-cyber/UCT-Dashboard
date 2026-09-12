// app/src/pages/research/i1S8Boundary.test.js
//
// ─── 🔴 F-I1-1 — THE S8 / I1 OWNERSHIP BOUNDARY, AS A MECHANISM INSTEAD OF A
//     SENTENCE ────────────────────────────────────────────────────────────────
//
// ⭐ THE DEFECT THIS EXISTS FOR. Phase 2's adversarial validation found S8 and
// I1 BOTH claiming ownership of "the one provenance renderer" — two teams, one
// concept, each believing it owned it. The fix was a paragraph in an
// architecture document. A paragraph cannot fail, so it is not a boundary; it
// is a record that somebody once agreed where the boundary was
// (`lesson_a_comment_claiming_agreement_is_not_agreement`). This file is the
// same boundary expressed as something that can go red.
//
// THE RULE, mechanically: nothing in the I1 surface may RENDER citation,
// freshness, coverage or provenance itself. It composes S8's primitives in
// `app/src/components/provenance/`, or it is a finding here.
//
// ⛔ AN AST, NEVER A GREP — the idiom of `components/screener/reachable.test.js`
// and `chart/engine/__tests__/singleWriterIndex.test.js`, both of which derive
// their facts from a parsed tree. A grep for "citation" reports the import
// line, the comment above it, and every piece of prose that happens to use the
// word; this repo has already measured a probe that "found 5 call sites, all
// five of them prose". Only a parsed JSX element with a parsed className is a
// render site, and the last control in this file asserts exactly that.
//
// ⛔ AND NOTHING HERE IS HAND-TYPED THAT CAN BE DERIVED:
//   * the I1 SURFACE is the Ask-AI tab that `ResearchPage.jsx` actually mounts,
//     found by parsing that file, plus everything the tab transitively imports;
//   * S8's PRIMITIVES are read off the `components/provenance/` directory;
//   * the CONCEPT VOCABULARY (`cit…`, `freshness…`, `coverage…`, `provenance…`)
//     is derived from those primitives' own names, so the day S8 adds a fifth
//     primitive its concept is guarded here without anyone editing this file.
//
// ⚠️ WHAT IT DOES NOT SEE, stated so nobody reads more into a green run than is
// there: it reads JSX element names and className style keys. A field rendered
// as bare text — `{c.source} · {c.date}` — is invisible to it. That is a real
// limit, and it is why the finding it recorded (now fixed — see
// RECORDED_BOUNDARY_DEBT) described the whole Sources block rather than only
// the three class names that named it.
//
// ⚠️ AND WHAT IS OUTSIDE ITS SURFACE BY CONSTRUCTION: it guards the Ask-AI tab
// `ResearchPage.jsx` mounts, plus what that tab imports. `pages/research/
// components/ComparisonAskAi.jsx` — a DIFFERENT door, reached from the compare
// page — still draws its own citation list through the very classes this rail
// was opened for, and this file cannot see it. Widening the surface to the
// whole `pages/research/**` tree is a one-line change to `i1Surface`'s roots
// and a decision somebody has to make, not a gap to paper over here.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`i1S8Boundary: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')
const PROVENANCE_DIR = path.join(SRC, 'components', 'provenance')
const RESEARCH_PAGE = path.join(SRC, 'pages', 'research', 'ResearchPage.jsx')

/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', locations: true,
})

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

/** Resolve a module specifier to a real file under `app/src`, or null.
 *  ⛔ CSS modules and packages are not modules in this graph — a stylesheet
 *  cannot render a citation and a package leaves `app/src` entirely. */
function resolve(fromFile, specRaw) {
  const spec = String(specRaw).split('?')[0]
  if (!spec.startsWith('.') && !spec.startsWith('/src/')) return null
  const base = spec.startsWith('.')
    ? path.resolve(path.dirname(fromFile), spec)
    : path.join(ROOT, 'app', spec.slice(1))
  const candidates = [base, ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (!CODE_EXT.includes(path.extname(c))) continue
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/**
 * Follow a pure re-export shim to the module that really implements it.
 *
 * ⭐ LOAD-BEARING, AND FOUND BY READING THE TREE: `components/screener/
 * CoverageLine.jsx` is four lines — `export { default } from '../provenance/
 * CoverageLine'` — left behind when S8 consolidated the two coverage renderers
 * into one. A boundary check that stopped at the first hop would call an
 * importer of that shim a violation for using S8's own component through the
 * door S8 itself left open. A control below cuts this off and watches the
 * classification change, so the hop is proven rather than assumed.
 */
function followReexport(file, depth = 0) {
  if (!file || depth > 4) return file
  let src
  try { src = read(file) } catch { return file }
  const body = parse(src).body
  const meaningful = body.filter((n) => n.type !== 'ImportDeclaration')
  const onlyReexports = meaningful.length > 0
    && meaningful.every((n) => (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && typeof n.source.value === 'string')
  if (!onlyReexports) return file
  const target = resolve(file, meaningful[0].source.value)
  return target ? followReexport(target, depth + 1) : file
}

/** Local binding name -> the resolved module it came from (shims followed). */
function importBindings(file, src) {
  const out = new Map()
  for (const n of parse(src).body) {
    if (n.type !== 'ImportDeclaration' || typeof n.source?.value !== 'string') continue
    const resolved = followReexport(resolve(file, n.source.value))
    for (const s of n.specifiers || []) out.set(s.local.name, resolved)
  }
  return out
}

/** Every LOCAL module this source imports, by AST. */
function localImports(file, src) {
  const out = []
  walk(parse(src), (n) => {
    const isDecl = (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration') && n.source && typeof n.source.value === 'string'
    const isDynamic = n.type === 'ImportExpression' && n.source?.type === 'Literal'
      && typeof n.source.value === 'string'
    if (isDecl || isDynamic) {
      const r = resolve(file, n.source.value)
      if (r) out.push(r)
    }
  })
  return out
}

// ── S8's primitives, and the concept vocabulary DERIVED from their names ─────

/** Every renderer S8 owns — read off the directory, never listed. */
export function s8Primitives() {
  return fs.readdirSync(PROVENANCE_DIR)
    .filter((f) => f.endsWith('.jsx') && !/\.(test|spec)\.jsx$/.test(f))
    .map((f) => path.join(PROVENANCE_DIR, f))
}

const camelWords = (s) => String(s)
  .replace(/[-_]+/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase().split(/\s+/).filter(Boolean)

/**
 * The concepts S8 owns, as stems, DERIVED from the primitives' file names.
 *
 * A primitive is named for its concept and then qualified — `FreshnessBadge`,
 * `CoverageLine` — so the LEADING word is the concept and the rest is the form
 * it takes. Taking only the leading word is what keeps `badge` and `line` out
 * of the vocabulary; those are far too generic to mean "this renders
 * provenance", and a vocabulary that matches everything reports everything.
 * A past-tense name (`Cited`) is stemmed so its noun forms match too
 * (`citation`, `citations`, `cite`).
 */
export function conceptStems(primitives = s8Primitives()) {
  return [...new Set(primitives
    .map((p) => camelWords(path.basename(p, '.jsx'))[0])
    .filter(Boolean)
    .map((w) => w.replace(/ed$/, '')))]
}

const STEMS = conceptStems()
const namesAConcept = (identifier) => camelWords(identifier)
  .some((w) => STEMS.some((stem) => w.startsWith(stem)))

// ── The detector ─────────────────────────────────────────────────────────────

const jsxElementName = (opening) => {
  const n = opening.name
  if (!n) return null
  if (n.type === 'JSXIdentifier') return n.name
  if (n.type === 'JSXMemberExpression') return n.property?.name || null
  return null
}

/** Style keys a className attribute names — `styles.foo`, a bare string, or
 *  either branch of a conditional. */
function classNameKeys(attr) {
  const keys = []
  walk(attr.value, (n) => {
    if (n.type === 'MemberExpression' && !n.computed
      && n.object?.type === 'Identifier' && n.property?.type === 'Identifier') {
      keys.push(n.property.name)
    }
    if (n.type === 'Literal' && typeof n.value === 'string') {
      keys.push(...n.value.split(/\s+/).filter(Boolean))
    }
  })
  return keys
}

/**
 * Everywhere `src` renders — or imports — citation / freshness / coverage /
 * provenance WITHOUT going through S8.
 *
 * A JSX element is COMPLIANT when its component resolves, through this file's
 * own import table (re-export shims followed), to a module under
 * `components/provenance/`. Anything else that names a concept — by element
 * name or by a className style key — is a finding.
 */
export function boundaryFindings(file, src = read(file)) {
  const bindings = importBindings(file, src)
  const inS8 = (abs) => !!abs && abs.startsWith(PROVENANCE_DIR + path.sep)
  const out = []
  const add = (line, what, detail) => out.push({
    file: key(file), line, what, detail, id: `${key(file)}::${what}`,
  })

  // (1) An imported renderer whose NAME claims a concept but whose module is
  //     not S8's — "I1 imports its own citation renderer".
  for (const [local, resolved] of bindings) {
    if (!namesAConcept(local)) continue
    if (inS8(resolved)) continue
    add(0, `import:${local}`,
      `imports '${local}' from ${resolved ? key(resolved) : 'a package'}, not from `
      + 'components/provenance/')
  }

  // (2) A JSX element that renders a concept itself.
  walk(parse(src), (n) => {
    if (n.type !== 'JSXOpeningElement') return
    const name = jsxElementName(n)
    if (!name) return
    if (inS8(bindings.get(name))) return          // composed on S8 — compliant
    const line = n.loc?.start?.line || 0
    if (namesAConcept(name) && !bindings.has(name)) {
      add(line, `element:${name}`, `<${name}> renders a provenance concept locally`)
    }
    for (const attr of n.attributes || []) {
      if (attr.type !== 'JSXAttribute' || attr.name?.name !== 'className') continue
      for (const k of classNameKeys(attr)) {
        if (namesAConcept(k)) {
          add(line, k, `<${name} className={…${k}}> renders a provenance concept locally`)
        }
      }
    }
  })
  return out
}

// ── The I1 surface: the Ask-AI tab ResearchPage mounts, plus what it composes ─

/** The tab file `ResearchPage.jsx` really imports for "Ask AI" — parsed out of
 *  that page, never a path typed here, so a move or a rename follows. */
export function askAiTabFile() {
  const src = read(RESEARCH_PAGE)
  const hits = []
  for (const n of parse(src).body) {
    if (n.type !== 'ImportDeclaration' || typeof n.source?.value !== 'string') continue
    if (!n.source.value.includes('/tabs/')) continue
    for (const s of n.specifiers || []) {
      if (s.type !== 'ImportDefaultSpecifier') continue
      if (s.local.name.toLowerCase().replace(/[^a-z]/g, '').includes('askai')) {
        hits.push(resolve(RESEARCH_PAGE, n.source.value))
      }
    }
  }
  return hits.filter(Boolean)
}

/** Everything the Ask-AI tab is, transitively, inside `app/src`. */
export function i1Surface(roots = askAiTabFile()) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length) {
    const f = queue.pop()
    if (!f || seen.has(f)) continue
    seen.add(f)
    for (const next of localImports(f, read(f))) if (!seen.has(next)) queue.push(next)
  }
  return [...seen]
}

const SURFACE = i1Surface()
const ALL_FINDINGS = SURFACE.flatMap((f) => boundaryFindings(f))

/**
 * ⛔ RECORDED BOUNDARY DEBT — EMPTY, AND IT WAS NOT BORN THAT WAY.
 *
 * GATE-I1's FIRST slice was rails only, so the violation this rail was built to
 * detect was RECORDED here rather than fixed beside the instrument that found
 * it: three entries naming AskAiTab's own citation list (`explainCitations`,
 * `explainCitation`, `explainCitationMark`). That is why the rail is
 * trustworthy — it did not come into existence green.
 *
 * ✅ SLICE 2 (owner-authorized, 2026-09-11) FIXED IT IN CODE. The Sources block
 * composes S8's `<Provenance>` (see `tabs/AskAiTab.jsx`'s own header for why
 * `<Provenance>` and not `<Cited>`), so the findings are gone and the entries
 * were deleted in the same PR. ⭐ THE ORDER WAS THE EVIDENCE: the entries were
 * deleted FIRST, with the violation still in the tree, and this file was run to
 * watch it go RED naming all three sites with live line numbers — proving the
 * rail was watching the real thing and not the ledger. Then the fix landed and
 * it went green. A green that follows only a deletion proves nothing.
 *
 * ⭐ THIS LIST CAN ONLY SHRINK, and two tests enforce that, exactly as
 * `reachable.test.js`'s AWAITING_A_DECISION does. An entry cannot outlive its
 * violation — the alternative is an allow-list that keeps excusing a path
 * nobody is watching any more, and the day somebody re-introduces the local
 * renderer it would stay green.
 *
 * ⛔ AND IT IS NOT A PARKING SPACE FOR THE NEXT ONE. Adding a line is a
 * decision recorded in a diff with a reason beside it.
 *
 * ⚠️ KNOWN AND DELIBERATELY NOT RECORDED HERE: `pages/research/components/
 * ComparisonAskAi.jsx` still draws the same local citation list through the
 * same three CSS classes. It is NOT in this rail's surface (this rail follows
 * what `ResearchPage.jsx` mounts as the Ask-AI tab, and the compare page is a
 * different door), so an entry for it would be a line in a ledger nothing
 * checks. It is a reported finding, not debt this file can hold.
 */
export const RECORDED_BOUNDARY_DEBT = {}

describe('🔴 F-I1-1 — the I1 surface composes S8\'s provenance primitives', () => {
  it('the derivation is not vacuous', () => {
    // ⛔ Every assertion below iterates a derived set. A derivation that came
    // back empty would satisfy all of them over nothing
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(askAiTabFile().length,
      'ResearchPage.jsx imports no Ask-AI tab — the I1 surface resolved to nothing '
      + 'and this rail is guarding an empty set').toBe(1)
    expect(SURFACE.length).toBeGreaterThan(0)
    expect(SURFACE.map(key)).toContain('app/src/pages/research/tabs/AskAiTab.jsx')

    const primitives = s8Primitives().map((p) => path.basename(p, '.jsx'))
    expect(primitives, 'components/provenance/ yielded no renderers, so the concept '
      + 'vocabulary below is empty and nothing can ever be flagged')
      .toEqual(expect.arrayContaining(['Provenance', 'FreshnessBadge', 'CoverageLine', 'Cited']))
    // The vocabulary really is derived from those names, and really does cover
    // the three concepts the boundary is about.
    expect(STEMS).toEqual(expect.arrayContaining(['cit', 'coverage', 'freshness', 'provenance']))
    expect(STEMS, 'a generic word entered the vocabulary — `badge`/`line`/`state` '
      + 'would match half the app and this rail would report everything')
      .not.toEqual(expect.arrayContaining(['badge', 'line', 'state', 'wrap']))
  })

  it('and nothing in it renders citation/freshness/coverage on its own', () => {
    const unrecorded = ALL_FINDINGS.filter((f) => !(f.id in RECORDED_BOUNDARY_DEBT))
    expect(unrecorded.map((f) => `${f.id} (line ${f.line}) — ${f.detail}`),
      'I1-authored code renders a provenance concept itself instead of composing '
      + 'S8\'s primitives in app/src/components/provenance/. S8 owns ONE provenance '
      + 'renderer; a second one in I1 is the double-ownership Phase 2\'s adversarial '
      + 'validation found, and a paragraph in an architecture document is what failed '
      + 'to stop it last time. Compose <Provenance>/<FreshnessBadge>/<CoverageLine>/'
      + '<Cited>, or record the decision in RECORDED_BOUNDARY_DEBT with a reason.')
      .toEqual([])
  })

  it('the recorded debt cannot outlive the violation it records', () => {
    const ids = new Set(ALL_FINDINGS.map((f) => f.id))
    const fixed = Object.keys(RECORDED_BOUNDARY_DEBT).filter((k) => !ids.has(k))
    expect(fixed, 'these are recorded as known S8-boundary debt and the rail no longer '
      + 'finds them — delete their RECORDED_BOUNDARY_DEBT entries in the same commit '
      + 'that fixed them. An entry that outlives its violation is a standing excuse: '
      + 'the day the local renderer comes back, this rail would stay green.')
      .toEqual([])
  })
})

describe('the controls — a rail nobody has seen fail cannot be trusted', () => {
  it('⭐ IT SEES THE VIOLATION IT WAS BUILT FOR: the pre-slice-2 Sources block is RED', () => {
    // ⛔ UNTIL 2026-09-11 THIS CONTROL WAS NOT SYNTHETIC — the thing this rail
    // exists to catch was in the working tree, and emptying the ledger was the
    // whole mutation. GATE-I1 slice 2 fixed it, so that control would now pass
    // by finding nothing, which is the failure mode
    // `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` names.
    //
    // What replaces it is the SAME violation, reconstructed verbatim from the
    // block slice 2 deleted (`git show 22a0367fe^:app/src/pages/research/tabs/
    // AskAiTab.jsx`, the Sources block), classified against the real AskAiTab
    // anchor so module resolution is the real thing. Three findings, the three
    // ids the ledger used to carry, at real line numbers — so the day somebody
    // re-introduces the local renderer, the detector that catches it is one
    // that has been SEEN catching it.
    const anchor = path.join(SRC, 'pages', 'research', 'tabs', 'AskAiTab.jsx')
    const preSlice2 = [
      "import styles from '../ResearchPage.module.css'",
      'export default ({ data }) => (',
      '  <div className={styles.explainCitations}>',
      '    {data.citations.map(c => (',
      '      <div key={c.id} className={styles.explainCitation}>',
      '        <span className={styles.explainCitationMark}>[{c.id}]</span>',
      '        <span>{c.source} · {c.date}</span>',
      '      </div>',
      '    ))}',
      '  </div>',
      ')',
      '',
    ].join('\n')

    const findings = boundaryFindings(anchor, preSlice2)
    expect(findings.map((f) => f.id), 'the detector no longer reports the exact block '
      + 'GATE-I1 was opened for — it is broken, whatever the live tree says').toEqual([
      'app/src/pages/research/tabs/AskAiTab.jsx::explainCitations',
      'app/src/pages/research/tabs/AskAiTab.jsx::explainCitation',
      'app/src/pages/research/tabs/AskAiTab.jsx::explainCitationMark',
    ])
    // Real render sites with real line numbers, not names matched out of prose.
    for (const f of findings) {
      expect(f.line).toBeGreaterThan(0)
      expect(preSlice2.split('\n')[f.line - 1]).toContain(f.what)
    }
  })

  it('AND THE SHIPPED TAB IS NOW CLEAN — the fix, not the ledger, is what is green', () => {
    // The other half of the red/green pair, asserted on the real file: slice 2
    // composes S8 in the Sources block, so the live I1 surface has nothing to
    // record. Pairing it with the reconstruction above means "green" can only
    // mean "the code changed", never "the detector stopped looking".
    const askAi = path.join(SRC, 'pages', 'research', 'tabs', 'AskAiTab.jsx')
    const src = read(askAi)
    expect(src, 'AskAiTab stopped composing S8 — the slice-2 fix has been reverted')
      .toContain('<Provenance')
    expect(boundaryFindings(askAi, src)).toEqual([])
    expect(ALL_FINDINGS).toEqual([])
  })

  it('AND IT STAYS SILENT ON REAL COMPLIANT CODE: NewsTab composes S8', () => {
    // The other half of the pair. Without it, "no unrecorded findings" is also
    // satisfied by a detector that reports nothing at all. NewsTab is a sibling
    // tab on the same page, with the same styles module, that DOES compose
    // `<Provenance>` and `<FreshnessBadge>` — so a detector that cannot tell
    // the two apart fails here.
    const news = path.join(SRC, 'pages', 'research', 'tabs', 'NewsTab.jsx')
    const src = read(news)
    expect(src, 'NewsTab stopped composing S8 — this control measures nothing')
      .toContain('<FreshnessBadge')
    expect(boundaryFindings(news, src)).toEqual([])
  })

  it('A LOCAL RENDERER IS REPORTED AND AN S8-COMPOSED ONE IS NOT', () => {
    // The classifier, exercised directly on synthetic sources so its boundary
    // is a proven property and not a comment.
    const anchor = path.join(SRC, 'pages', 'research', 'tabs', 'AskAiTab.jsx')

    const local = "import styles from '../ResearchPage.module.css'\n"
      + 'export default () => <span className={styles.myFreshnessTag}>LIVE</span>\n'
    expect(boundaryFindings(anchor, local).map((f) => f.what)).toEqual(['myFreshnessTag'])

    const composed = "import FreshnessBadge from '../../../components/provenance/FreshnessBadge'\n"
      + 'export default () => <FreshnessBadge freshnessClass="real_time" />\n'
    expect(boundaryFindings(anchor, composed),
      'composing S8\'s own primitive was reported as a violation — this rail would '
      + 'punish the correct code and get deleted').toEqual([])

    const localComponent = 'function CitationRow() { return <b /> }\n'
      + 'export default () => <CitationRow />\n'
    expect(boundaryFindings(anchor, localComponent).map((f) => f.what))
      .toEqual(['element:CitationRow'])
  })

  it('THE RE-EXPORT HOP IS LOAD-BEARING: cut it and the shim stops counting as S8', () => {
    // `components/screener/CoverageLine.jsx` re-exports S8's CoverageLine.
    // Importing it is compliant — but only because `followReexport` follows the
    // hop, and an unproven hop is an assumption.
    const shim = path.join(SRC, 'components', 'screener', 'CoverageLine.jsx')
    expect(fs.existsSync(shim), 'the screener CoverageLine shim moved — this control '
      + 'cannot measure the hop').toBe(true)
    expect(followReexport(shim).startsWith(PROVENANCE_DIR + path.sep),
      'the shim did not resolve into components/provenance/ — the hop is not being '
      + 'followed and an importer of S8\'s own component would be called a violation')
      .toBe(true)
    // The negative: a module that is NOT a pure re-export must not be followed
    // anywhere, or the hop would launder any import into compliance.
    const real = path.join(PROVENANCE_DIR, 'CoverageLine.jsx')
    expect(followReexport(real)).toBe(real)
  })

  it('a concept named in PROSE is not a render site', () => {
    // The grep failure mode, asserted directly — the reason this file parses.
    const anchor = path.join(SRC, 'pages', 'research', 'tabs', 'AskAiTab.jsx')
    const prose = "// renders the citation list, see FreshnessBadge for coverage\n"
      + "const label = 'citation'\n"
      + 'export default () => <div className={styles.explainSummary}>{label}</div>\n'
    expect(boundaryFindings(anchor, prose)).toEqual([])
  })
})

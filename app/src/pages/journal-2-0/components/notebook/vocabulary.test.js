// Audit 2026-11-05, spec S7: ONE VOCABULARY. The same object was called TEMPLATES, Template and styles, "Use" took
// three names and two sheets, the note menu said Delete where the sidebar said Trash, and one page had three names.
// The member now reads, everywhere:
//
//   Style · Journal style · Kind of note · Outline · Preset  ->  Template   ("Note type" only where a filter needs it)
//   Adopt · "Use this template" + "Make it yours"            ->  Use
//   Community styles · Community gallery                      ->  Template library
//   "Save as template with blocks"                        ->  Save as template
//   Delete (note menu) · Trash (sidebar)                       ->  Move to Trash
//   Active setups · "Active setups and find more like this"   ->  Setups
//
// ⛔ AN INTERFACE NAMING LAYER ONLY: internal models, API fields and stored keys keep their names (journal styles,
//    `styleId`, `kindId`, /api/j2/journal-styles ...). So this rail reads only what a member SEES: JSX text, and the
//    string literals given to `aria-label`, `title`, `placeholder`, `label`, `alt` and a Sheet's `title`, in every
//    component under components/notebook/** (the template library and the styles surfaces included) and NotebookTab.
//    Module-level `const X = '...'` strings rendered as copy are read too when their name says they are words
//    (`*_LABEL`, `*_TITLE`, `*_SENTENCE`, `*_WORDS`, `TITLE`, `LABEL`).
//
// Parsed (acorn + acorn-jsx, the tree the a11y rails use), never grepped: a comment or an identifier that says
// "style" is not copy, and a regex over source cannot tell them apart.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const J2 = join(process.cwd(), 'src', 'pages', 'journal-2-0')
// Fix round 1 (review finding 4): `.js` too (the tours, the capability list, the copy modules), and the two member
// surfaces outside components/notebook that name the same objects: the Settings card and the library's sort words.
const ROOTS = [
  join(J2, 'components', 'notebook'),
  join(J2, 'tabs', 'NotebookTab.jsx'),
  join(J2, 'components', 'JournalStylesCard.jsx'),
  join(J2, 'lib', 'styleLibrary.js'),
  join(J2, 'lib', 'templateSlots.js'),
  // Fix round 2 (re-review R1-1): the walkthrough title a template's note opens with.
  join(J2, 'lib', 'templateBlocks.js'),
]
const rel = (p) => relative(J2, p).split(sep).join('/')

/** The retired words, as a member would read them. Each is a whole-word, case-insensitive match. */
export const RETIRED = [
  { re: /\bjournal styles?\b/i, now: 'Template' },
  { re: /\bkind of note\b/i, now: 'Template (or "Note type" in a filter)' },
  { re: /\bcommunity (styles|gallery|library)\b/i, now: 'Template library' },
  { re: /\bmake it yours\b/i, now: 'Use' },
  { re: /\buse this template\b/i, now: 'Use' },
  { re: /\buse template\b/i, now: 'Use (or "Add to my templates" for a copy)' },
  { re: /\bsetup as a style\b/i, now: 'Save as template' },
  { re: /\bactive setups\b/i, now: 'Setups' },
  { re: /\badopt(ed|s)?\b/i, now: 'Use' },
  { re: /\bstyles?\b/i, now: 'Template' },
  { re: /\bpresets?\b/i, now: 'Template' },
]

/**
 * ⛔ THE ALLOWLIST: copy that uses a retired word in ANOTHER meaning, each entry `file|exact text` with why. A new
 * use of a retired word fails BY NAME until it is renamed or argued for here.
 */
const ALLOW = new Map([
  // "Style" as a visual style, never the journal-style object.
  ['components/notebook/TextColorMenu.jsx|*', 'text colour and highlight styles'],
  ['components/notebook/TableToolbar.jsx|*', 'table cell styles'],
  // "Trading style": how the member trades (swing, day, ...), a filter and a share field, never a template.
  ['components/notebook/library/SharePreviewSheet.jsx|Trading style (optional)', 'how the member trades, not a template'],
  ['components/notebook/library/SharePreviewSheet.jsx|No trading style', 'how the member trades, not a template'],
  ['components/notebook/styles/ShareStyleForm.jsx|Trading style (optional)', 'how the member trades, not a template'],
  ['components/notebook/styles/ShareStyleForm.jsx|No trading style', 'how the member trades, not a template'],
  ['components/notebook/TemplateGallery.jsx|Filter by trading style', 'how the member trades, a filter, not a template'],
  // "Preset" as a CHART preset (lib/notebookSets: a saved chart setup), never a note template.
  ['components/notebook/widgets/SnapshotFrame.jsx|*', 'a chart widget preset (lib/notebookSets), not a note template'],
  ['components/notebook/widgets/SetsDialog.jsx|*', 'chart sets and presets (lib/notebookSets), not note templates'],
  ['components/notebook/WidgetPalette.jsx|*', 'chart presets in the widget palette (lib/notebookSets)'],
  // The server's own recorded refusal, pinned word for word to the contract fixture: a server change, not this layer's.
  ['components/notebook/styles/LibraryUpdateSheet.jsx|This style changed since you opened the update. Nothing was changed. Look again.',
    "the server's recorded sentence (StyleLibraryDoors.test.jsx pins it to the contract)"],
  // Fix round 2: a slash row's search KEYWORDS are never shown; "journal style" keeps /journal style finding the row.
  ['components/notebook/SlashMenu.jsx|journal style', 'a search keyword, never displayed'],
  // The slot type label is pinned word for word to the server's TYPE_LABELS (templateSlots.test.js reads share.py) and
  // names the server-side "Kind of note" property (data from the API): a server change, not this naming layer's.
  ['lib/templateSlots.js|Kind of note', "pinned to the server's TYPE_LABELS and the property's own name"],
  // A note made before this rename carries the old walkthrough title in its OWN body; it is still recognised.
  ['lib/templateBlocks.js|How to use this template', 'the legacy title, recognised in stored notes, never written'],
  ['components/notebook/SlashMenu.jsx|My presets', 'the slash menu group of CHART presets (lib/notebookSets), not note templates'],
  ['components/notebook/NoteEditorPage.jsx|Insert a chart or preset — pick ticker and timeframe by clicking',
    'the insert palette offers chart presets (lib/notebookSets), not note templates'],
])

function walk(p, out = []) {
  if (statSync(p).isFile()) { out.push(p); return out }
  for (const name of readdirSync(p)) {
    if (name === '__fixtures__' || name === 'node_modules') continue
    walk(join(p, name), out)
  }
  return out
}
const FILES = ROOTS.flatMap((r) => walk(r)).filter((p) => /\.jsx?$/.test(p) && !/\.test\.jsx?$/.test(p))

const JsxParser = Parser.extend(jsx())
const COPY_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'label', 'alt', 'aria-description', 'confirmLabel', 'body',
  'what'])
const COPY_CONST = /(^|_)(LABEL|TITLE|SENTENCE|WORDS|HEADING|HINT|FAILED|TEXT|COPY|MESSAGE)$|^(TITLE|LABEL)$/
// An object's member copy: a tour step's title/body, a capability's label, a sort's label (fix round 1).
const COPY_KEYS = new Set(['title', 'label', 'body', 'text', 'line', 'description', 'heading', 'what', 'message', 'hint'])
/** A string given to a call reads as member copy when it is a sentence: a capital letter and a space (heuristic, fix
 *  round 1: `onMessage({text: ...})`, `setSaid('...')`, `refusalSentence(err, '...')`). */
const LOOKS_LIKE_COPY = (t) => /[A-Z]/.test(t) && / /.test(t.trim())
/** Fix round 2 (re-review R1-1): the known COPY SINKS. Every string argument they get is member copy, lowercase
 *  included (`plural(n, 'style you had deleted', ...)`), with no capital-letter test. */
const COPY_SINKS = new Set(['onMessage', 'onDone', 'setStatus', 'setSaid', 'setChromeMsg', 'refusalSentence', 'plural',
  'setActionError', 'setDoorProblem', 'setNotice', 'setMessage', 'notify', 'say', 'libraryError'])
/** A JSX prop whose name says it is words: `useLabel`, `backLabel`, `emptyTitle`, `helpText` (fix round 2). */
const COPY_PROP = /(Label|Title|Text)$/
/** Any ALL_CAPS module constant is read when its value is a phrase (holds a space): `OFFER_LINE`, `IN_USE_NOTE`, and the
 *  values of a constant map such as `WHY` (fix round 2). */
const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/
const calleeName = (c) => (c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' && !c.computed ? c.property?.name : null)

/** Every member-visible string in one file: `[{text, line}]`. */
export function visibleStrings(src) {
  const tree = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const out = []
  const push = (text, node) => { if (typeof text === 'string' && text.trim()) out.push({ text: text.trim(), line: node.loc.start.line }) }
  const literalStrings = (node) => {
    if (!node) return
    if (node.type === 'Literal' && typeof node.value === 'string') push(node.value, node)
    else if (node.type === 'TemplateLiteral') {
      node.quasis.forEach((q) => push(q.value.cooked, q))
      // Fix round 2 (re-review R1-1): a literal INSIDE `${...}` (`${style?.name || 'this style'}`) is copy too.
      node.expressions.forEach(literalStrings)
    }
    else if (node.type === 'ConditionalExpression') { literalStrings(node.consequent); literalStrings(node.alternate) }
    else if (node.type === 'LogicalExpression') { literalStrings(node.left); literalStrings(node.right) }
    else if (node.type === 'JSXExpressionContainer') literalStrings(node.expression)
  }
  /** The phrases (strings holding a space) anywhere in a constant's value: literals, map values, list items. */
  const phrases = (node) => {
    if (!node) return
    if (node.type === 'Literal' && typeof node.value === 'string') { if (/ /.test(node.value.trim())) push(node.value, node) }
    else if (node.type === 'TemplateLiteral') {
      if (node.quasis.some((q) => / /.test(q.value.cooked.trim()))) node.quasis.forEach((q) => push(q.value.cooked, q))
      node.expressions.forEach(phrases)
    } else if (node.type === 'ObjectExpression') node.properties.forEach((pr) => phrases(pr.value))
    else if (node.type === 'ArrayExpression') node.elements.forEach(phrases)
    else if (node.type === 'CallExpression') node.arguments.forEach(phrases)          // Object.freeze({...})
    else if (node.type === 'ConditionalExpression') { phrases(node.consequent); phrases(node.alternate) }
    else if (node.type === 'LogicalExpression') { phrases(node.left); phrases(node.right) }
    else if (node.type === 'ArrowFunctionExpression') phrases(node.body)              // (name) => `... ${name} ...`
  }
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'JSXText') push(node.value, node)
    if (node.type === 'JSXExpressionContainer' && parent?.type === 'JSXElement') literalStrings(node.expression)
    if (node.type === 'JSXAttribute' && node.name?.type === 'JSXIdentifier'
      && (COPY_ATTRS.has(node.name.name) || COPY_PROP.test(node.name.name))) {
      literalStrings(node.value)
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && COPY_CONST.test(node.id.name)) {
      literalStrings(node.init)
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && ALL_CAPS.test(node.id.name)) {
      phrases(node.init)
    }
    if (node.type === 'Property' && !node.computed) {
      const k = node.key?.type === 'Identifier' ? node.key.name : node.key?.value
      if (COPY_KEYS.has(k)) literalStrings(node.value)
    }
    if (node.type === 'CallExpression' && COPY_SINKS.has(calleeName(node.callee))) {
      node.arguments.forEach(literalStrings)
    } else if (node.type === 'CallExpression') {
      for (const a of node.arguments) {
        if ((a.type === 'Literal' && typeof a.value === 'string' && LOOKS_LIKE_COPY(a.value))
          || (a.type === 'TemplateLiteral' && LOOKS_LIKE_COPY(a.quasis.map((q) => q.value.cooked).join(' x ')))) literalStrings(a)
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const v = node[key]
      if (Array.isArray(v)) v.forEach((c) => visit(c, node))
      else if (v && typeof v.type === 'string') visit(v, node)
    }
  }
  visit(tree, null)
  return out
}

function hits() {
  const found = []
  for (const file of FILES) {
    const r = rel(file)
    if (ALLOW.has(`${r}|*`)) continue
    for (const { text, line } of visibleStrings(readFileSync(file, 'utf8'))) {
      if (ALLOW.has(`${r}|${text}`)) continue
      for (const { re, now } of RETIRED) {
        if (re.test(text)) { found.push(`${r}:${line} "${text}" -> ${now}`); break }
      }
    }
  }
  return found
}

describe('S7: one vocabulary in everything a member reads', () => {
  it('no retired word in member-visible copy (renamed, or argued for in ALLOW)', () => {
    expect(hits()).toEqual([])
  })

  it('CONTROL: the reader finds copy in every place it looks, and skips what is not copy', () => {
    const src = `
      // A comment about journal styles is not copy.
      const styleId = 'journal-style'
      export const USE_LABEL = 'Use this template'
      export default function X({ open }) {
        return <div aria-label="Community styles" title={open ? 'Make it yours' : 'Fine'}>Kind of note {'Adopt'}</div>
      }`
    const seen = visibleStrings(src).map((s) => s.text)
    expect(seen).toEqual(expect.arrayContaining(['Use this template', 'Community styles', 'Make it yours', 'Kind of note', 'Adopt']))
    expect(seen).not.toContain('journal-style')
    const caught = seen.filter((t) => RETIRED.some(({ re }) => re.test(t)))
    expect(caught.length).toBe(5)
  })

  // Fix round 2 (re-review R1-1): one control per new reach, so the rail proves it can see each one.
  it('CONTROL: the reader sees a literal inside ${...}, a lowercase sink argument, a *Label prop and a phrase constant', () => {
    const src = `
      const OFFER_LINE = 'Three styles to start from'
      const WHY = { a: 'not a style block yet', b: 'x' }
      const SLUG = 'style'
      export default function X({ s }) {
        notify(plural(2, 'style you had deleted', 'styles you had deleted'))
        return <Sheet title={\`Share \${s?.name || 'this style'} now\`}><K useLabel="Use this style" backLabel={'Back to styles'} /></Sheet>
      }`
    const seen = visibleStrings(src).map((x) => x.text)
    expect(seen).toEqual(expect.arrayContaining(['this style', 'style you had deleted', 'styles you had deleted',
      'Use this style', 'Back to styles', 'Three styles to start from', 'not a style block yet']))
    // A one-word constant is a key, not copy: never read.
    expect(seen).not.toContain('style')
  })

  it('every allowlist entry still names a file that exists (a stale exemption fails by name)', () => {
    const names = new Set(FILES.map(rel))
    for (const key of ALLOW.keys()) expect(names.has(key.split('|')[0]), key).toBe(true)
  })
})
